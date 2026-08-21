/**
 * 🚢 到貨明細 (Incoming Cargo Forecast)
 * ------------------------------------------------
 * 讀取「鈦傳速-薪資出缺勤表」試算表的「到貨明細(唯讀)」分頁（國貿小姐維護的在途貨櫃預告），
 * 解析邏輯移植自「倉庫日誌」專案的 CargoInspection.js（已驗證可行，不重造輪子）。
 *
 * 單位換算鏈（依使用者確認）：
 *   數量(m²，原廠報價單位) × 0.3025 = 坪數
 *   坪數 × 片/坪(編號價目表) = 片數
 *   片數 ÷ 片/箱(編號價目表) = 箱數
 *   箱數 ÷ 箱/板(編號價目表，沒填就不顯示棧板數) = 棧板數
 *
 * 對外入口：getIncomingCargoContainers(branch) → 前端 google.script.run 呼叫
 */

const INCOMING_CARGO_SS_ID = '13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY';
const INCOMING_CARGO_SHEET_NAME = '到貨明細(唯讀)';
const INCOMING_CARGO_M2_TO_PING = 0.3025;
const INCOMING_CARGO_BRANCHES = ['高雅瓷', '安帝嘉', '喜悅納', '漢樺'];

// 🏢 集團分公司各自獨立的「編號價目表」試算表 ID（來源：睡美人戰情室 PHP 專案 config.php）
// 漢樺不是集團自己的分公司（是客戶/專案名稱），查不到品項時一律退回高雅瓷主表比對。
const INCOMING_CARGO_BRANCH_SS_ID = {
  '高雅瓷': null, // null = 用 CONFIG.SS_ID_MAIN
  '安帝嘉': '16QNID9hLs2K1iy_ePo7MxYxhW4kpDrDlfEIZ2p83ixo',
  '喜悅納': '1uFKKWBfulg-GmCbJsSomimT5LW5r0N2w28rubrPveTA'
};

// 🚢 港口代碼 → 中文全名
const INCOMING_CARGO_PORT_NAMES = {
  'KEE': '基隆港', 'KEEL': '基隆港', 'KAO': '高雄港', 'K.O.': '高雄港', 'KO': '高雄港', 'TPE': '台北港'
};

function _cargoPortName_(rawPort) {
  const p = String(rawPort || '').trim().toUpperCase().replace(/\./g, '');
  if (!p) return '';
  return INCOMING_CARGO_PORT_NAMES[p] || INCOMING_CARGO_PORT_NAMES[rawPort.trim().toUpperCase()] || rawPort;
}

const INCOMING_CARGO_WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 日期格式化成「8月19日(週三)」 */
function _cargoFormatDateWithWeekday_(dateVal) {
  const d = parseDate(dateVal);
  if (!d || isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '月' + d.getDate() + '日(週' + INCOMING_CARGO_WEEKDAY_CN[d.getDay()] + ')';
}

/** 距今天還有幾天（負數＝已過期幾天） */
function _cargoDaysUntil_(dateVal) {
  const d = parseDate(dateVal);
  if (!d || isNaN(d.getTime())) return null;
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((dOnly - todayOnly) / 86400000);
}

/** ETA + N 個「工作日」（跳過六日），常規預估入庫時間 = ETA + 10 個工作日 */
function _cargoAddBusinessDays_(dateVal, businessDays) {
  const d = parseDate(dateVal);
  if (!d || isNaN(d.getTime())) return null;
  const result = new Date(d.getTime());
  let added = 0;
  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay(); // 0=日, 6=六
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

/**
 * 重量與櫃號解析器（「櫃號」欄常是多行文字，例如 "BEAU2639889\n20557kg"）
 */
function _cargoParseContainerNoAndWeight_(rawText) {
  if (!rawText) return { containerNo: '', totalWeightKg: 0, weightDetailStr: '' };
  const str = String(rawText).trim();
  const lines = str.split('\n').map(s => s.trim()).filter(Boolean);

  let containerNo = lines[0] || '';
  let weightLines = lines.slice(1).join(' ');
  if (!weightLines && lines[0] && lines[0].toLowerCase().includes('kg')) {
    weightLines = lines[0];
    containerNo = '';
  }

  const matches = str.match(/([\d.]+)\s*kg/gi) || [];
  let totalWeightKg = 0;
  const detailWeights = [];
  matches.forEach(m => {
    const num = parseFloat(m.replace(/kg/gi, '').trim());
    if (!isNaN(num) && num > 0) {
      totalWeightKg += num;
      detailWeights.push(num);
    }
  });

  return {
    containerNo: containerNo,
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    weightDetailStr: detailWeights.length > 1 ? detailWeights.join(' + ') + ' kg' : (totalWeightKg ? totalWeightKg + ' kg' : '')
  };
}

/**
 * 編號解析器：「總公司編號 / 分公司編號」，斜線後半段是我們要拿去對「編號價目表」的 key。
 * - 展示磚／展示架／樣品／計價棧板／紙箱：真正的「附加項目」，沒有實際尺寸換算意義，isSpecial=true 不做任何轉換。
 * - NEW／期貨：雖然還沒建檔進價目表，但有真實尺寸與數量，isNewLike=true，改用尺寸幾何反推片數/坪數（見 _cargoParseSizeCm_）。
 */
function _cargoParseProductCode_(codeStr) {
  const raw = String(codeStr || '').trim();
  const nonProductKeywords = ['展示磚', '展示架', '樣品', '計價棧板', '紙箱'];
  const newLikeMap = { 'NEW': '新品', '期貨': '期貨' };

  const isNonProduct = !raw || nonProductKeywords.some(k => raw.toUpperCase().includes(k.toUpperCase()));
  if (isNonProduct) {
    return { mainCode: raw || '', hqCode: '', isSpecial: true, isNewLike: false, newTag: '' };
  }

  const upperRaw = raw.toUpperCase();
  const newLikeKey = Object.keys(newLikeMap).find(k => upperRaw.includes(k.toUpperCase()));
  if (newLikeKey) {
    return { mainCode: raw, hqCode: '', isSpecial: false, isNewLike: true, newTag: newLikeMap[newLikeKey] };
  }

  if (raw.includes('/')) {
    const parts = raw.split('/').map(s => s.trim());
    return { mainCode: parts[1] || parts[0], hqCode: parts[0] || '', isSpecial: false, isNewLike: false, newTag: '' };
  }

  // 無斜線但看起來像純數字總公司編號（無分公司對應編號），一樣嘗試直接拿去比對
  return { mainCode: raw, hqCode: '', isSpecial: false, isNewLike: false, newTag: '' };
}

/**
 * 尺寸字串解析成「寬cm × 長cm」，支援 60x120cm / 60X120CM / 60＊120 / 60×120 等寫法。
 * 解析失敗（例如空白、非兩段數字）回傳 null。
 */
function _cargoParseSizeCm_(sizeStr) {
  const s = String(sizeStr || '').toUpperCase().replace(/CM|㎝/g, '').replace(/[＊×]/g, 'X').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = parseFloat(m[1]), h = parseFloat(m[2]);
  if (!w || !h) return null;
  return { w: w, h: h };
}

/**
 * 尺寸幾何反推：每平方公尺片數 = 10000 ÷ (寬cm × 長cm)
 * 用於 NEW/期貨這類還沒建進「編號價目表」、但實際有標尺寸與數量(m²)的品項。
 */
function _cargoCalcFromSize_(qtyM2, sizeStr) {
  const dim = _cargoParseSizeCm_(sizeStr);
  if (!dim) return null;
  const piecesPerM2 = 10000 / (dim.w * dim.h);
  const pieces = Math.round(qtyM2 * piecesPerM2);
  const pyeong = Math.floor(qtyM2 * INCOMING_CARGO_M2_TO_PING); // 坪數無條件捨去、不留小數
  return { pieces: pieces, pyeong: pyeong };
}

/**
 * Google Drive 分享連結 → 縮圖網址（跟 Inventory.js 其他模組同一套轉換慣例）
 */
function _cargoToThumbUrl_(rawUrl) {
  if (!rawUrl) return '';
  const id = _extractDriveId(rawUrl);
  return id ? ('https://lh3.googleusercontent.com/d/' + id + '=w400') : rawUrl;
}

/**
 * Remark 分公司識別器
 */
function _cargoParseBranchesFromRemark_(remarkStr) {
  const str = String(remarkStr || '').trim();
  const list = INCOMING_CARGO_BRANCHES.filter(b => str.includes(b));
  return list.length ? list : ['總公司'];
}

/**
 * 依分公司找對應的「編號價目表」SKU 對照表；查不到就退回高雅瓷主表比對（漢樺/總公司都走這條）
 */
function _cargoLookupMeta_(pKey, branches) {
  if (!pKey) return null;
  for (let i = 0; i < branches.length; i++) {
    const ssId = INCOMING_CARGO_BRANCH_SS_ID[branches[i]];
    if (ssId === undefined) continue; // 該分公司沒有獨立試算表設定，跳過
    const map = _getProductMasterMap_(ssId || undefined);
    if (map[pKey]) return map[pKey];
  }
  // 都沒找到，退回高雅瓷主表當最後備援
  const mainMap = _getProductMasterMap_();
  return mainMap[pKey] || null;
}

/**
 * 🎯 對外主入口：取得到貨明細（依分公司篩選），回傳貨櫃列表（每櫃內含品項明細）
 * 這份「到貨明細(唯讀)」資料不常更新（國貿小姐才會改），所以整包結果依分公司快取，預設 1 小時；
 * 點畫面上的 ⟳ 重新整理按鈕會強制略過快取重讀。
 * @param {string} branch 分公司名稱，預設「高雅瓷」；傳 "全部" 則不篩選
 * @param {boolean} [forceRefresh] 為 true 時忽略快取，強制重新讀取試算表
 */
function getIncomingCargoContainers(branch, forceRefresh) {
  const targetBranch = String(branch || '高雅瓷').trim();
  const cacheKey = 'INCOMING_CARGO_v2_' + targetBranch; // v2: 修正 ETA 排序失準/NaN 天數 bug，改用 etaTs 時間戳

  if (!forceRefresh) {
    try {
      const cached = CacheManager.getLarge(cacheKey);
      if (cached) return cached;
    } catch (e) {}
  }

  const result = _getIncomingCargoContainersUncached_(targetBranch);
  if (result && result.success) {
    try { CacheManager.putLarge(cacheKey, result, 3600); } catch (e) {} // 1 小時快取
  }
  return result;
}

function _getIncomingCargoContainersUncached_(targetBranch) {
  try {
    const ss = SpreadsheetApp.openById(INCOMING_CARGO_SS_ID);
    const sheet = ss.getSheetByName(INCOMING_CARGO_SHEET_NAME);
    if (!sheet) return { success: false, msg: '找不到「' + INCOMING_CARGO_SHEET_NAME + '」分頁' };

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, containers: [], branch: targetBranch };

    const headers = data[0];
    const idx = {
      brand: findHeaderIndex(headers, ['品牌']),
      pi: findHeaderIndex(headers, ['PI']),
      containerCount: findHeaderIndex(headers, ['櫃數']),
      isProject: findHeaderIndex(headers, ['專案']),
      productName: findHeaderIndex(headers, ['原廠品名']),
      code: findHeaderIndex(headers, ['編號']),
      size: findHeaderIndex(headers, ['尺寸']),
      qty: findHeaderIndex(headers, ['數量']),
      etd: findHeaderIndex(headers, ['ETD']),
      eta: findHeaderIndex(headers, ['ETA']),
      port: findHeaderIndex(headers, ['港口']),
      note: findHeaderIndex(headers, ['備註']),
      remark: findHeaderIndex(headers, ['Remark']),
      vessel: findHeaderIndex(headers, ['船名']),
      containerNo: findHeaderIndex(headers, ['櫃號'])
    };
    if (idx.brand === -1 && idx.code === -1) return { success: false, msg: '到貨明細分頁格式不符（找不到品牌/編號欄位）' };

    const containers = [];
    let current = null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const brand = idx.brand !== -1 ? String(row[idx.brand] || '').trim() : '';
      const containerNoRaw = idx.containerNo !== -1 ? String(row[idx.containerNo] || '').trim() : '';
      const etaRaw = idx.eta !== -1 ? row[idx.eta] : '';

      // 標頭列（合併儲存格的頂端才會有值）：出現品牌或櫃號或 ETA 視為新貨櫃開始
      if (brand || containerNoRaw || etaRaw) {
        const parsedCtn = _cargoParseContainerNoAndWeight_(containerNoRaw);
        const remark = idx.remark !== -1 ? String(row[idx.remark] || '').trim() : '';
        const rawPort = idx.port !== -1 ? String(row[idx.port] || '').trim() : '';

        // 🚀 ETA 只解析一次，後面排序/格式化/天數計算/入庫日全部共用同一個 Date 物件，避免「先轉字串再重新解析」造成排序錯亂
        const etaDateObj = etaRaw ? parseDate(etaRaw) : null;
        const etaValid = !!(etaDateObj && !isNaN(etaDateObj.getTime()));
        const warehouseInDate = etaValid ? _cargoAddBusinessDays_(etaDateObj, 10) : null;

        current = {
          key: parsedCtn.containerNo || ('CTN_' + i),
          containerNo: parsedCtn.containerNo || '未填櫃號',
          totalWeightKg: parsedCtn.totalWeightKg,
          weightDetail: parsedCtn.weightDetailStr,
          brand: brand,
          pi: idx.pi !== -1 ? String(row[idx.pi] || '').trim() : '',
          containerCount: idx.containerCount !== -1 ? String(row[idx.containerCount] || '').trim() : '',
          etd: idx.etd !== -1 && row[idx.etd] ? String(row[idx.etd]).trim() : '',
          eta: etaValid ? Utilities.formatDate(etaDateObj, 'Asia/Taipei', 'yyyy/MM/dd') : '',
          etaTs: etaValid ? etaDateObj.getTime() : null, // 排序專用的可靠時間戳，不再用字串重新解析
          etaFormatted: etaValid ? _cargoFormatDateWithWeekday_(etaDateObj) : '未定',
          daysUntilEta: etaValid ? _cargoDaysUntil_(etaDateObj) : null,
          warehouseInFormatted: warehouseInDate ? _cargoFormatDateWithWeekday_(warehouseInDate) : '',
          port: rawPort,
          portName: _cargoPortName_(rawPort),
          note: idx.note !== -1 ? String(row[idx.note] || '').trim() : '',
          remark: remark,
          branches: _cargoParseBranchesFromRemark_(remark),
          vessel: idx.vessel !== -1 ? String(row[idx.vessel] || '').trim() : '',
          items: []
        };
        containers.push(current);
      }

      // 品項列
      if (current) {
        const productName = idx.productName !== -1 ? String(row[idx.productName] || '').trim() : '';
        const codeRaw = idx.code !== -1 ? String(row[idx.code] || '').trim() : '';
        const qtyM2 = idx.qty !== -1 ? (parseFloat(row[idx.qty]) || 0) : 0;
        if (!productName && !codeRaw) continue; // 純標頭列，沒有品項資料，跳過

        const isProject = idx.isProject !== -1 && String(row[idx.isProject] || '').trim() !== '';
        const size = idx.size !== -1 ? String(row[idx.size] || '').trim() : '';
        const codeParsed = _cargoParseProductCode_(codeRaw);
        const pKey = codeParsed.mainCode.replace(/[\s\-]/g, '').toUpperCase();
        const meta = (!codeParsed.isSpecial && !codeParsed.isNewLike && pKey) ? _cargoLookupMeta_(pKey, current.branches) : null;

        const pyeongExact = qtyM2 * INCOMING_CARGO_M2_TO_PING;
        let pyeong = Math.floor(pyeongExact); // 坪數無條件捨去，不留小數
        let pieces = null, pallets = null;

        if (meta && meta.perPing) {
          pieces = Math.round(pyeongExact * meta.perPing);
          if (meta.perBox && meta.boxPerPallet) {
            const boxesExact = pieces / meta.perBox;
            pallets = Math.ceil(boxesExact / meta.boxPerPallet); // 棧板數無條件進位，不留小數
          }
        } else if (codeParsed.isNewLike && size) {
          const calc = _cargoCalcFromSize_(qtyM2, size);
          if (calc) { pieces = calc.pieces; pyeong = calc.pyeong; } // 新品/期貨：用尺寸幾何反推，沒有箱/板資料所以沒有棧板數
        }

        current.items.push({
          productName: productName,
          rawCode: codeRaw,
          mainCode: codeParsed.mainCode,
          hqCode: codeParsed.hqCode,
          isSpecial: codeParsed.isSpecial,
          isNewLike: codeParsed.isNewLike,
          newTag: codeParsed.newTag,
          isProject: isProject,
          size: size,
          qtyM2: qtyM2,
          pyeong: pyeong,
          pieces: pieces,
          pallets: pallets,
          series: meta ? meta.series : '',
          image: meta ? _cargoToThumbUrl_(meta.image) : '',
          matched: !!meta
        });
      }
    }

    // 分公司篩選（"全部" 不篩）
    let filtered = containers;
    if (targetBranch && targetBranch !== '全部') {
      filtered = containers.filter(c => c.branches.includes(targetBranch));
    }

    // 彙總每櫃總片數/總坪數/品項數，並依 ETA → 分公司 → 系列排序
    const result = filtered.map(c => {
      const totalPyeong = Math.floor(c.items.reduce((s, it) => s + (it.pyeong || 0), 0)); // 坪數無條件捨去、不留小數
      const totalPieces = c.items.reduce((s, it) => s + (it.pieces || 0), 0);
      return Object.assign({}, c, {
        totalPyeong: totalPyeong,
        totalPieces: totalPieces,
        itemCount: c.items.length
      });
    });

    result.sort((a, b) => {
      // 到港日愈靠近的愈上面；用先前解析好的 etaTs 時間戳，未定的排最後
      const tA = (a.etaTs === null || a.etaTs === undefined) ? Infinity : a.etaTs;
      const tB = (b.etaTs === null || b.etaTs === undefined) ? Infinity : b.etaTs;
      if (tA !== tB) return tA - tB;
      const branchA = (a.branches[0] || ''), branchB = (b.branches[0] || '');
      if (branchA !== branchB) return branchA.localeCompare(branchB, 'zh-TW');
      const seriesA = (a.items[0] && a.items[0].series) || '';
      const seriesB = (b.items[0] && b.items[0].series) || '';
      return seriesA.localeCompare(seriesB, 'zh-TW');
    });

    return { success: true, containers: result, branch: targetBranch, availableBranches: INCOMING_CARGO_BRANCHES };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}
