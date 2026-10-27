/**
 * 保留系統 — Service_Reserve.js
 * 讀取保留單、依工地分組、寫回進度
 */

/**
 * ── 多分公司參數化設定 ──────────────────────────────
 * 高雅瓷（gaoyaci）／安帝嘉（antigravity）／喜悅納（joyina）三家共用同一份程式碼
 * 與同一個 Web App 部署，靠網址參數 ?branch= 切換：
 *   - 不帶參數 → 預設高雅瓷（向後相容，原有網址行為不變）
 *   - doGet 收到 e.parameter.branch 時寫進 ScriptProperties（CURRENT_BRANCH_KEY），
 *     後端 getSheet_()／getReserveData() 等一律透過 getBranch_() 取得目前分支設定。
 * 背景觸發器（時間觸發、onEdit 編輯觸發）沒有 request 參數，統一用 forEachBranch_()
 * 迭代全部分支依序處理（見 checkMeltdownAndAlert / sendReserveAgingNotices 等）。
 */
const CURRENT_BRANCH_KEY = 'CURRENT_BRANCH';

const BRANCHES = {
  gaoyaci: {
    label: '高雅瓷',
    brand: 'ELITILE',
    // 🚀 「保留單」的正確來源／寫入目標。dbSS(1G5q) 是從 reserveSS(1WpBX) 自動同步
    // 過來的唯讀複本，絕對不能把更新寫進 dbSS，否則下一次同步會被覆蓋、或造成兩邊資料分歧。
    reserveSS: '1WpBX1Bj-H0_452itfV38B7aIywRsqh-LTUKRfAkxpVs',
    dbSS: '1G5q-GixMWSdJJeF8ZiXWMOfrx4FMobER25jNc8m4Zds',
    sheetName: '保留單',
    salesSheetName: '經銷銷售報表',
    // 品牌白名單：貨櫃到貨品項歸屬判斷用（Step3）
    brands: ['REFIN', 'GEOTILES', 'BESTILE', 'DADO', 'CVA', 'GAYAFORES', 'VITACER', 'BAYKER'],
    // 貨櫃到貨排程系統（倉庫日誌專案）的「到貨明細(唯讀)」與「入庫資料」，僅高雅瓷啟用
    containerSS: '13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY',
    containerSheetName: '到貨明細(唯讀)',
    inspectionSS: '13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY',
    inspectionSheetName: '入庫資料',
    managerEmail: 'titankou2002@gmail.com',
    salesEmails: {
      '謝博皓': 'sb780910@gmail.com',
      '陳勁多': 'ghosts0125@gmail.com',
      '潘右森': 'panus081231@gmail.com'
    },
    tgChatIds: ['-5042638784'],
    hasTelegram: true,
    hasWeeklyReport: true,
    agingQuickActions: true,   // 帳齡 Telegram 通知帶「續保／取消」快速動作連結（僅高雅瓷）
    // 帳齡通知業務 Telegram 對照（@username 用於群組標記）— 高雅瓷專屬
    salesTg: {
      '謝博皓': { username: '@HQWWSX',       chatId: '' },
      '潘右森': { username: '@shadowkidman', chatId: '6417913737' },
      '陳勁多': { username: '',              chatId: '' }
    }
  },
  antigravity: {
    label: '安帝嘉',
    brand: 'ANTIGA',
    reserveSS: '1pcwphU6WGyjzp0CXzAB9JSUIa2nA6ygmLDhNSOb8Rn8', // live 寫入表「安帝嘉_保留表」
    dbSS: '16QNID9hLs2K1iy_ePo7MxYxhW4kpDrDlfEIZ2p83ixo',       // 讀取來源
    sheetName: '安帝嘉_保留表',
    salesSheetName: '經銷銷售報表',
    // 品牌白名單：貨櫃到貨品項歸屬判斷用（Step3，依 MD讀取/貨櫃欄位.md 四-1）
    brands: ['PROCONCEPT', 'REALONDA', 'EQUIPE', 'ALAPLANA', 'ICON'],
    // 貨櫃到貨排程系統（倉庫日誌專案）的「到貨明細(唯讀)」，與高雅瓷共用同一份試算表，靠 Remark 關鍵字區分分公司
    containerSS: '13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY',
    containerSheetName: '到貨明細(唯讀)',
    inspectionSS: null,
    inspectionSheetName: null,
    managerEmail: 'ronnie549539@gmail.com,titankou2002@gmail.com',
    salesEmails: { '孫宇宏': '', '陳元勲': '', '陳唯凱': '', '李世興': '', '呂偉賓': '' },
    tgChatIds: ['8647321891', '-1004388719757'],
    hasTelegram: true,
    hasWeeklyReport: false,
    agingQuickActions: false,  // 安帝嘉／喜悅納帳齡通知不帶續保取消按鈕
    salesTg: {}
  },
  joyina: {
    label: '喜悅納',
    brand: 'SIENA',
    reserveSS: '1uFKKWBfulg-GmCbJsSomimT5LW5r0N2w28rubrPveTA',
    dbSS: '1uFKKWBfulg-GmCbJsSomimT5LW5r0N2w28rubrPveTA',
    sheetName: '保留單',
    salesSheetName: '經銷銷售報表',   // 舊名「月報表」，統一改名；目前只有診斷函式會讀這個分頁，已兩個名字都認
    // 品牌白名單：貨櫃到貨品項歸屬判斷用（Step3，依 MD讀取/貨櫃欄位.md 四-1）
    brands: ['STN', 'SINTESI', 'RONDINE', 'KERADOM', 'KEOPE', 'ELIOS'],
    // 貨櫃到貨排程系統（倉庫日誌專案）的「到貨明細(唯讀)」，與高雅瓷共用同一份試算表，靠 Remark 關鍵字區分分公司
    containerSS: '13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY',
    containerSheetName: '到貨明細(唯讀)',
    inspectionSS: null,
    inspectionSheetName: null,
    managerEmail: 'sienabambi@gmail.com,edison710527@gmail.com',
    salesEmails: {},
    tgChatIds: ['8642811087', '-5418269706'],
    hasTelegram: true,
    hasWeeklyReport: false,
    agingQuickActions: false,  // 安帝嘉／喜悅納帳齡通知不帶續保取消按鈕
    salesTg: {}
  }
};

// 背景觸發器迭代理順序（先高雅瓷後分公司）
const ACTIVE_BRANCHES = ['gaoyaci', 'antigravity', 'joyina'];

const M2_PER_PING = 3.305785; // 1 坪 = 3.305785 m²

// 2026-10-01：分支改記在「這一次執行」的記憶體裡，不再寫進 ScriptProperties。
// 以前 CURRENT_BRANCH 是整個專案共用的一格：背景預熱 (每 5 分鐘，三家輪流) 會把它切成安帝嘉／喜悅納，
// 同時間高雅瓷使用者沒帶 __branch 的請求就讀到別家的資料 (戰情室、補貨決策出現安帝嘉的產品)。
// 現在每個請求由前端帶 __branch (Reserve_UI 自動補)，沒帶就是高雅瓷；背景任務用 forEachBranch_ 逐家切換。
var __RSV_BRANCH_MEM__ = '';

/** 取得目前分支名稱（這次執行設定的分支，無則預設 gaoyaci） */
function currentBranchName_() {
  const v = String(__RSV_BRANCH_MEM__ || '').toLowerCase();
  return BRANCHES[v] ? v : 'gaoyaci';
}

/** 取得分支設定；可傳入明確分支名（如 onEdit 依試算表反查），否則用 CURRENT_BRANCH */
function getBranch_(b) {
  if (b && BRANCHES[b]) return BRANCHES[b];
  return BRANCHES[currentBranchName_()];
}

/** 設定目前分支（doGet 用）；傳非白名單值會退回預設 */
function setBranch_(b) {
  __RSV_BRANCH_MEM__ = (b && BRANCHES[b]) ? b : '';
}

/** 依試算表 ID 反查分支（onEdit 等容器觸發器用：被編輯的是哪一家的表就是哪一家） */
function branchBySpreadsheetId_(ssId) {
  ssId = String(ssId || '');
  for (const key in BRANCHES) {
    const br = BRANCHES[key];
    if (br.reserveSS && ssId.indexOf(br.reserveSS) >= 0) return key;
    if (br.dbSS && ssId.indexOf(br.dbSS) >= 0) return key;
  }
  return '';
}

/** 背景任務通用：依序切換 CURRENT_BRANCH 執行 fn，最後還原原先分支 */
function forEachBranch_(fn) {
  const prev = __RSV_BRANCH_MEM__;
  ACTIVE_BRANCHES.forEach(b => {
    __RSV_BRANCH_MEM__ = b;
    try {
      fn(BRANCHES[b], b);
    } catch (e) {
      console.error('分支「' + b + '」處理失敗：' + e.message);
    }
  });
  __RSV_BRANCH_MEM__ = prev;
}

/** 主管信箱（分支） */
function branchManagerEmail_() { return getBranch_().managerEmail || ''; }

/** 業務 Email（分支）；查無回傳空字串。可傳 br 明確指定分公司 */
function branchSalesEmail_(rep, br) { const m = (br || getBranch_()).salesEmails[rep]; return m || ''; }

/** 業務 Telegram 對照（分支，salesTg[biz]，無則 null）。可傳 br 明確指定分公司 */
function branchSalesTg_(rep, br) { return (br || getBranch_()).salesTg[rep] || null; }

/** 由分支設定物件反查分支名稱（BRANCHES 單例物件，用身分比對）；查無回退 CURRENT_BRANCH */
function branchNameOf_(br) {
  for (const k in BRANCHES) {
    if (BRANCHES[k] === br) return k;
  }
  return currentBranchName_();
}

/**
 * 讀「貨櫃來源表單」的「入庫資料」分頁，取得驗貨完成、確認實到數量的真實進貨批次。
 * 只取歸屬分公司＝高雅瓷、驗貨狀態含「完成」、實到片數>0 的列。
 * 編號優先用「現貨編號(分公司)」（跟保留系統的 SKU 格式一致），沒有才退回「總公司編號」。
 * @return {Object} { [cleanCode]: [{date, dateStr, qtyPieces, qtyPing}, ...] }（新到舊排序）
 */
function getInspectionImportMap_(perPingMap) {
  const map = {};
  try {
    if (!getBranch_().inspectionSS) return map; // 僅高雅瓷使用貨櫃驗貨資料
    const ss = SpreadsheetApp.openById(getBranch_().inspectionSS);
    const sh = ss.getSheetByName(getBranch_().inspectionSheetName) || ss.getSheets()[0];
    if (!sh || sh.getLastRow() < 2) return map;

    const rows = sh.getDataRange().getValues();
    const headers = rows[0].map(v => String(v || '').trim());
    const idx = {
      branch: rsvFindHeaderIndex_(headers, ['歸屬分公司']),
      codeBranch: rsvFindHeaderIndex_(headers, ['現貨編號(分公司)', '現貨編號']),
      codeHQ: rsvFindHeaderIndex_(headers, ['總公司編號']),
      pickupDate: rsvFindHeaderIndex_(headers, ['確切領櫃日']),
      inspectTime: rsvFindHeaderIndex_(headers, ['驗貨時間']),
      status: rsvFindHeaderIndex_(headers, ['驗貨狀態']),
      actualPieces: rsvFindHeaderIndex_(headers, ['實到總片數']),
      expectedPieces: rsvFindHeaderIndex_(headers, ['應到總片數'])
    };
    if (idx.codeBranch < 0 && idx.codeHQ < 0) return map;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (idx.branch >= 0 && String(row[idx.branch] || '').trim() !== '高雅瓷') continue;
      const status = idx.status >= 0 ? String(row[idx.status] || '').trim() : '';
      if (!status.includes('完成')) continue; // 只算驗貨完成、實到數量已確認的批次

      const rawCode = (idx.codeBranch >= 0 ? String(row[idx.codeBranch] || '').trim() : '')
        || (idx.codeHQ >= 0 ? String(row[idx.codeHQ] || '').trim() : '');
      const code = normalizeSku_(rawCode);
      if (!code) continue;

      const qtyPieces = idx.actualPieces >= 0 ? (parseFloat(row[idx.actualPieces]) || 0) : 0;
      if (qtyPieces <= 0) continue;

      const rawDate = (idx.pickupDate >= 0 && row[idx.pickupDate]) ? row[idx.pickupDate] : (idx.inspectTime >= 0 ? row[idx.inspectTime] : '');
      const dateObj = parseAnyDate_(rawDate);
      if (!dateObj) continue;

      const perPing = (perPingMap && perPingMap[code]) || 36;
      const qtyPing = Math.round((qtyPieces / perPing) * 10) / 10;

      if (!map[code]) map[code] = [];
      map[code].push({
        date: dateObj,
        dateStr: Utilities.formatDate(dateObj, 'Asia/Taipei', 'yyyy/MM/dd'),
        qtyPieces: qtyPieces,
        qtyPing: qtyPing
      });
    }

    Object.keys(map).forEach(c => map[c].sort((a, b) => b.date - a.date));
  } catch (e) {
    console.error('讀取貨櫃入庫資料失敗：' + e.message);
  }
  return map;
}

/**
 * 判斷貨櫃品項是否屬於「目前分支」的分公司（3 步驟優先順序，依 MD讀取/貨櫃欄位.md 四）。
 * Step1：Remark 關鍵字 100% 決定（高雅瓷／安帝嘉／喜悅納／漢樺／彩創／璞石麗緻）。
 * Step2（商品編號反查商品對照快取）：保留系統目前沒有對應快取表，略過，僅用 Step1/Step3。
 * Step3：品牌白名單（各分公司 brands）。
 */
function isBranchContainerRow_(remark, brand) {
  const label = getBranch_().label;
  const branchNames = ['高雅瓷', '安帝嘉', '喜悅納'];
  const groupNames  = ['漢樺', '彩創', '璞石麗緻'];
  const r = String(remark || '');
  const hit = branchNames.filter(b => r.indexOf(b) >= 0);
  if (hit.length) return hit[0] === label;
  if (groupNames.some(b => r.indexOf(b) >= 0)) return false;
  const b = String(brand || '').trim().toUpperCase();
  return getBranch_().brands.indexOf(b) >= 0;
}

/** 從 ETA / 備註等模糊文字中抽出 M/D，補全年份（若該日期已過超過 6 個月則視為明年） */
function parseFuzzyEtaDate_(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  const s = String(val).trim();
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date();
  let year = now.getFullYear();
  let d = new Date(year, month - 1, day);
  const diffDays = (d - now) / 86400000;
  if (diffDays < -180) { year += 1; d = new Date(year, month - 1, day); }
  return d;
}

/**
 * 讀取「到貨明細(唯讀)」，回傳 { [產品編號]: [ { date, dateStr, qtyPieces, qtyPing, containerNo, shipName }, ... ] }
 * 依日期升序排序。只保留高雅瓷分公司歸屬的品項。數量欄位來源為 m²，換算為坪／片數時
 * 一律採用保留系統自己的「片/坪」（perPingMap），確保與全站其他頁面的坪/片換算一致。
 */
function getIncomingContainerMap_(perPingMap, br) {
  const map = {};
  try {
    const b = br ? getBranch_(br) : getBranch_();
    if (!b.containerSS) return map; // 僅高雅瓷使用貨櫃到貨排程
    const ss = SpreadsheetApp.openById(b.containerSS);
    const sh = ss.getSheetByName(b.containerSheetName) || ss.getSheets()[0];
    if (!sh || sh.getLastRow() < 2) return map;

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(v => String(v || '').trim());
    // 2026/08/17 修正：實際試算表欄名是「編號」不是「產品編號」，原本 exact match 抓不到欄位直接整份回空，
    // 導致「在途」永遠是0（跟哪個試算表ID無關，欄名對不上才是真正原因）。改用多別名比對。
    const idx = {
      brand: rsvFindHeaderIndex_(headers, ['品牌']),
      code: rsvFindHeaderIndex_(headers, ['產品編號', '編號']),
      qty: rsvFindHeaderIndex_(headers, ['數量']),
      perPing: rsvFindHeaderIndex_(headers, ['片/坪', '每坪片數']),
      eta: rsvFindHeaderIndex_(headers, ['ETA']),
      remark: rsvFindHeaderIndex_(headers, ['Remark']),
      note: rsvFindHeaderIndex_(headers, ['備註']),
      shipName: rsvFindHeaderIndex_(headers, ['船名']),
      containerNo: rsvFindHeaderIndex_(headers, ['櫃號'])
    };
    if (idx.code < 0 || idx.qty < 0) return map;

    // 跨欄合併向下繼承：把每個合併區塊的首列值，回填到區塊內其餘列
    const filledCols = [idx.eta, idx.remark, idx.note, idx.containerNo, idx.shipName].filter(c => c >= 0);
    if (filledCols.length) {
      const merges = sh.getRange(1, 1, lastRow, lastCol).getMergedRanges();
      merges.forEach(range => {
        const col = range.getColumn() - 1; // 轉 0-index
        if (filledCols.indexOf(col) < 0) return;
        const topRow = range.getRow() - 1; // 0-index，對應 values 陣列
        const numRows = range.getNumRows();
        const fillVal = values[topRow][col];
        for (let r = topRow; r < topRow + numRows && r < values.length; r++) {
          values[r][col] = fillVal;
        }
      });
    }

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const rawCode = String(row[idx.code] || '').trim();
      if (!rawCode || rawCode.toUpperCase() === 'NEW') continue;

      const brand = row[idx.brand];
      const remark = row[idx.remark >= 0 ? idx.remark : -1];
      if (!isBranchContainerRow_(remark, brand)) continue;

      // 斜線後為分公司編號（主要），如 "60120192 / AA61251"
      const codeParts = rawCode.split('/');
      const branchCode = codeParts.length > 1 ? codeParts[codeParts.length - 1].trim() : rawCode;
      const clean = normalizeSku_(branchCode);
      if (!clean) continue;

      const qtyM2 = parseFloat(row[idx.qty]) || 0;
      if (qtyM2 <= 0) continue;
      const qtyPing = qtyM2 / M2_PER_PING;
      const perPing = (perPingMap && perPingMap[clean]) || 36;
      const qtyPieces = Math.round(qtyPing * perPing);

      const etaRaw = idx.eta >= 0 ? row[idx.eta] : (idx.note >= 0 ? row[idx.note] : '');
      let date = parseFuzzyEtaDate_(etaRaw);
      if (!date && idx.note >= 0) date = parseFuzzyEtaDate_(row[idx.note]);
      if (!date) continue;
      date.setHours(0, 0, 0, 0);
      const dateStr = Utilities.formatDate(date, 'Asia/Taipei', 'yyyy/MM/dd');

      if (!map[clean]) map[clean] = [];
      map[clean].push({
        date: date,
        dateStr: dateStr,
        qtyPing: Math.round(qtyPing * 10) / 10,
        qtyPieces: qtyPieces,
        containerNo: idx.containerNo >= 0 ? String(row[idx.containerNo] || '').trim() : '',
        shipName: idx.shipName >= 0 ? String(row[idx.shipName] || '').trim() : ''
      });
    }

    Object.keys(map).forEach(code => map[code].sort((a, b) => a.date - b.date));
  } catch (e) {
    console.error('讀取貨櫃到貨明細失敗：' + e.message);
  }
  return map;
}

/**
 * 診斷工具（唯讀）：針對單一編號印出貨櫃到貨明細解析結果，方便核對來源資料與換算是否正確。
 */
function diagnoseContainerShipments(code) {
  const clean = normalizeSku_(code || 'AA61251');
  const perPingMap = {};
  const meta = getPriceMetaMap_()[clean];
  if (meta) perPingMap[clean] = meta.perPing;
  const map = getIncomingContainerMap_(perPingMap);
  const list = map[clean] || [];
  const log = [`【貨櫃到貨明細】編號：${clean}　片/坪：${perPingMap[clean] || 36}（預設36）`, `共 ${list.length} 筆：`];
  list.forEach(s => log.push(`  ${s.dateStr}　${s.qtyPing} 坪 / ${s.qtyPieces} 片　櫃號：${s.containerNo || '-'}　船名：${s.shipName || '-'}`));
  if (!list.length) log.push('  （查無資料，可能是：分公司歸屬非高雅瓷／編號對不上／ETA 解析失敗）');
  console.log(log.join('\n'));
  return log.join('\n');
}

function getSheet_(br) {
  const b = br ? getBranch_(br) : getBranch_();
  const ss = SpreadsheetApp.openById(b.reserveSS);
  return ss.getSheetByName(b.sheetName) || ss.getSheets()[0];
}

// 欄位名稱對應（動態尋找，不鎖死欄號）
const COL = {
  code:         '編號',
  qty:          '數量',
  cust:         '客戶',
  site:         '工地',
  dateRes:      '保留日期',
  projName:     '案名',
  note:         '備註',
  deposit:      '訂金確認',
  salesRep:     '負責業務',
  customerRep:  '客戶業務',
  size:         '尺寸',
  prodName:     '品名',          // 新增：產品名稱
  progress:     '業務更新',      // 修改：讀取/寫回 '業務更新' 欄位
  progressAlt:  '最新進度',      // 備用：支援原本的 '最新進度' 欄位
  progressDate: '最後更新日期',   // 新欄位（不存在會自動建立）
  progressHistory: '進度歷程',    // 新欄位（不存在會自動建立，儲存所有歷史變更）
  reason: '理由'                 // 新欄位（不存在會自動建立）：刪除／取消保留時勾選的理由，可複選、逗號分隔存文字
};

// 支援多個備用欄位名稱，任一命中即可
// 各分公司表頭略有差異：喜悅納的「工地」欄名是「詳細住址／詳細地址」，日期欄可能是「日期」
const COL_ALT = {
  salesRep: ['負責業務', '負責\n業務', '負責 業務'],
  customerRep: ['客戶業務', '客戶\n業務', '客戶 業務'],
  progress: ['業務更新', '最新進度'],
  site: ['工地', '工地地址', '詳細住址', '詳細地址', '地址'],
  cust: ['客戶', '客戶名稱', '客戶姓名'],
  dateRes: ['保留日期', '日期', '保留日']
};

function normalizeHeader_(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function findCol_(headers, colName) {
  const cleanHeaders = headers.map(normalizeHeader_);
  const alts = COL_ALT[colName];
  if (alts) {
    for (const n of alts) {
      const i = cleanHeaders.indexOf(normalizeHeader_(n));
      if (i >= 0) return i;
    }
    return -1;
  }
  const target = normalizeHeader_(COL[colName] || '');
  return cleanHeaders.indexOf(target);
}

function buildIdx_(headers) {
  const idx = {};
  for (const key in COL) {
    idx[key] = findCol_(headers, key);
  }
  // 喜悅納等表的「產品編號」欄沒有表頭標題：首欄（第 0 欄）就是產品編號，後備回第 0 欄
  if (idx.code < 0) idx.code = 0;
  return idx;
}

function parseDate_(str) {
  if (!str) return new Date(0);
  const cleanStr = String(str).replace(/\//g, '-').trim();
  const d = new Date(cleanStr);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function getCurrentUserLabel_() {
  // 有通過白名單驗證 → 直接用白名單上的姓名（與操作記錄分頁顯示一致）
  try {
    if (typeof getIdentity_ === 'function') {
      const id = getIdentity_();
      if (id && id.ok && id.name) return id.name;
    }
  } catch (e) {}
  try {
    const active = Session.getActiveUser && Session.getActiveUser().getEmail();
    if (active) return active;
  } catch (e) {}
  try {
    const effective = Session.getEffectiveUser && Session.getEffectiveUser().getEmail();
    if (effective) return effective;
  } catch (e) {}
  return 'App使用者';
}

function isArchiveProgress_(status, progressText) {
  const text = String(status || '') + ' ' + String(progressText || '');
  return text.indexOf('結案') >= 0 || text.indexOf('取消') >= 0 || text.indexOf('刪除') >= 0;
}

/**
 * 算「保留量」專用：已結案／取消／刪除，或「已過期釋出」（逾期未付訂被自動放掉，貨已放回去可賣）的保留單，都不佔庫存。
 * 注意：這跟 isArchiveProgress_ 不同——後者還用在保留單清單顯示、自動封存、通知，不能把「過期釋出」併進去。
 */
function isNotHoldingStock_(status, progressText) {
  return stockRuleIsReleased_(status, progressText); // 標準規則見 Stock_Core.js
}

/**
 * 封存原因分類，供「保留封存」的「狀態」欄與棄單統計使用。
 * 已結案＝出貨、保留有效；取消／刪除都算棄單（保留無效）。
 */
function deriveArchiveStatus_(status, progressText) {
  const text = String(status || '') + ' ' + String(progressText || '');
  if (text.indexOf('結案') >= 0) return '已結案';
  if (text.indexOf('取消') >= 0 || text.indexOf('刪除') >= 0) return '棄單';
  return '其他';
}

// 保留封存精簡後要保留的來源欄位（依使用者指定順序），前面會再自動加上「刪除日期」「刪除者」「狀態」三欄。
const ARCHIVE_KEEP_FIELDS_ = ['編號', '數量', '客戶', '工地', '客戶業務', '保留日期', '備註', '保留更新', '業務更新', '理由', '進度歷程', '最後更新日期'];

function columnToLetter_(column) {
  let temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

/**
 * 在「保留單」試算表設定條件式格式：只要該列「訂金確認」／「業務更新」／「最新進度」
 * 任一欄位含「結案」「取消」「刪除」，整列自動套用刪除線（視覺上跟 isArchiveProgress_() 判斷一致）。
 * 只需執行一次；之後新增的資料列也會自動套用，不用重跑。
 */
function setupArchiveStrikethroughFormat() {
  const sh = getSheet_();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = buildIdx_(headers);

  const cols = [idx.deposit, idx.progress, idx.progressAlt].filter(i => i >= 0);
  if (cols.length === 0) {
    console.log('找不到「訂金確認」「業務更新」「最新進度」任一欄位，請確認欄位名稱。');
    return;
  }

  const refs = cols.map(i => '$' + columnToLetter_(i + 1) + '2').join('&"|"&');
  const formula = '=REGEXMATCH(' + refs + ',"結案|取消|刪除")';

  const lastCol = sh.getLastColumn();
  const lastRow = Math.max(sh.getMaxRows(), 2000);
  const range = sh.getRange(2, 1, lastRow - 1, lastCol);

  // 移除舊的同款規則，避免重複疊加
  const existingRules = sh.getConditionalFormatRules().filter(r => {
    const cond = r.getBooleanCondition();
    return !(cond && cond.getCriteriaValues() && cond.getCriteriaValues()[0] === formula);
  });

  const newRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setStrikethrough(true)
    .setRanges([range])
    .build();

  existingRules.push(newRule);
  sh.setConditionalFormatRules(existingRules);
  console.log('✅ 已設定刪除線條件式格式，公式：' + formula);
}

/**
 * 一次性清理工具：把「保留封存」既有分頁上的「刪除者」「最新進度」欄位整欄刪掉。
 * 在 Apps Script 編輯器手動選這支函式執行一次即可，不會被 doGet/網頁流程自動呼叫。
 * 從後面欄位往前刪，避免刪除後欄位編號位移導致刪錯欄。
 */
function cleanupReserveArchiveHeaders() {
  const ss = SpreadsheetApp.openById(getBranch_().reserveSS);
  const archive = ss.getSheetByName('保留封存');
  if (!archive) { console.log('找不到「保留封存」分頁'); return; }

  const lastCol = archive.getLastColumn();
  const headers = archive.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const toRemove = ['刪除者', '最新進度'];
  const removeCols = headers
    .map((h, i) => ({ h: h, col: i + 1 }))
    .filter(x => toRemove.indexOf(x.h) >= 0)
    .map(x => x.col)
    .sort((a, b) => b - a); // 由右往左刪，避免刪除後欄位編號位移

  if (!removeCols.length) { console.log('沒有找到「刪除者」或「最新進度」欄位，可能已經刪過了'); return; }

  removeCols.forEach(col => archive.deleteColumn(col));
  console.log('✅ 已刪除欄位：' + removeCols.length + ' 欄');
}

/**
 * 在「保留封存」設定條件式格式：「狀態」欄＝棄單的整列自動套紅字，方便一眼辨識棄單紀錄。
 * 只需在 Apps Script 編輯器手動執行一次；之後新增的封存列也會自動套用，不用重跑。
 */
function setupArchiveAbandonedRedFormat() {
  const ss = SpreadsheetApp.openById(getBranch_().reserveSS);
  const archive = ss.getSheetByName('保留封存');
  if (!archive) { console.log('找不到「保留封存」分頁'); return; }

  const lastCol = archive.getLastColumn();
  const headers = archive.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const statusColIdx = headers.indexOf('狀態');
  if (statusColIdx < 0) { console.log('找不到「狀態」欄位，請確認欄位名稱。'); return; }

  const statusColLetter = columnToLetter_(statusColIdx + 1);
  const lastRow = Math.max(archive.getMaxRows(), 2000);
  const range = archive.getRange(2, 1, lastRow - 1, lastCol);
  // 舊資料的「狀態」欄可能是「刪除」「已結案」這種舊寫法（不是這次新增的 deriveArchiveStatus_
  // 產生的「棄單」），改用 REGEXMATCH 同時接受「棄單」「刪除」「取消」三種寫法都套紅字。
  const formula = '=REGEXMATCH($' + statusColLetter + '2,"棄單|刪除|取消")';

  // 移除舊的同款規則（包含上一版精確比對「棄單」的舊公式），避免重複疊加
  const oldFormula = '=$' + statusColLetter + '2="棄單"';
  const existingRules = archive.getConditionalFormatRules().filter(r => {
    const cond = r.getBooleanCondition();
    const val = cond && cond.getCriteriaValues() && cond.getCriteriaValues()[0];
    return val !== formula && val !== oldFormula;
  });

  const newRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setFontColor('#ff0000')
    .setRanges([range])
    .build();

  existingRules.push(newRule);
  archive.setConditionalFormatRules(existingRules);
  console.log('✅ 已設定棄單紅字格式，公式：' + formula);
}

function getReserveArchiveSheet_(ss) {
  const archiveName = '保留封存';
  let archive = ss.getSheetByName(archiveName);
  const desiredHeaders = ['刪除日期', '狀態'].concat(ARCHIVE_KEEP_FIELDS_);

  if (!archive) {
    archive = ss.insertSheet(archiveName);
    archive.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
    archive.setFrozenRows(1);
    return { sheet: archive, headers: desiredHeaders };
  }

  // 沿用既有表頭（若是舊版留下的完整欄位表），寫入時只會填有對應到白名單的欄位，其餘留空，
  // 不重排、不刪舊欄，避免破壞既有封存資料的欄位對齊。
  const lastCol = archive.getLastColumn();
  let existingHeaders = lastCol > 0 ? archive.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim()) : [];
  if (!existingHeaders.length || existingHeaders.every(h => !h)) {
    archive.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
    archive.setFrozenRows(1);
    existingHeaders = desiredHeaders;
  }
  return { sheet: archive, headers: existingHeaders };
}

function archiveReserveRows_(sh, data, headers, matchedRowIndexes, today, deletedBy, archiveStatus) {
  if (!matchedRowIndexes.length) return 0;

  const ss = sh.getParent();
  const archiveInfo = getReserveArchiveSheet_(ss);
  const archive = archiveInfo.sheet;
  const archiveHeaders = archiveInfo.headers;

  const srcIdx = {};
  headers.forEach((h, i) => { srcIdx[String(h || '').trim()] = i; });

  const archiveRows = matchedRowIndexes.map(i => archiveHeaders.map(h => {
    if (h === '刪除日期') return today;
    if (h === '刪除者') return deletedBy;
    if (h === '狀態') return archiveStatus || '';
    const si = srcIdx[h];
    return si !== undefined ? data[i][si] : '';
  }));
  // 新封存的列插在表頭正下方（第2列），日期愈新的愈上面，不用每次都要捲到最底下找
  if (archiveRows.length > 0) {
    archive.insertRowsAfter(1, archiveRows.length);
  }
  const targetStartRow = 2;

  archive.getRange(targetStartRow, 1, archiveRows.length, archiveHeaders.length).setValues(archiveRows);

  matchedRowIndexes
    .map(i => i + 1)
    .sort((a, b) => b - a)
    .forEach(rowNumber => sh.deleteRow(rowNumber));

  return archiveRows.length;
}

/**
 * 讀取「業務分區」表，組出「客戶 → 負責業務（本公司指派的業務）」對照表。
 * 業務分區表才是公司正式指派業務的來源，保留單上的「負責業務」欄只是現場填寫，
 * 常常漏填或打錯字，所以「負責業務」一律以這裡查到的為準，查不到才退回保留單原始欄位。
 * （跟「客戶版機器人」專案的 _getBusinessZoneBizMap_() 邏輯、資料源完全一致，同一份業務分區表）
 */
function getBusinessZoneSalesMap_() {
  const map = {};
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const sh = dbSs.getSheetByName('業務分區');
    if (!sh || sh.getLastRow() < 2) return map;
    const rows = sh.getDataRange().getValues();
    const h = rows[0].map(v => String(v || '').trim());
    const custIdx = rsvFindHeaderIndex_(h, ['客戶', '客戶名稱']);
    const bizIdx = rsvFindHeaderIndex_(h, ['負責業務', '業務']);
    if (custIdx < 0 || bizIdx < 0) return map;
    for (let i = 1; i < rows.length; i++) {
      const cust = normalizeCustomerName_(rows[i][custIdx]);
      const biz = String(rows[i][bizIdx] || '').trim();
      if (cust && biz) map[cust] = biz;
    }
  } catch (e) {
    console.error('讀取業務分區負責業務對照失敗：' + e.message);
  }
  return map;
}

/**
 * 讀取所有保留資料，依「工地 + 客戶」分組
 */
function getReserveData() {
  const sh = getSheet_();
  if (!sh) return { error: '找不到工作表：' + getBranch_().sheetName };

  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return { sites: [] };

  const idx = buildIdx_(rows[0]);
  const now = new Date();
  const siteMap = {};
  const bizMap = getBusinessZoneSalesMap_();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[idx.code] || '').trim();
    const qty  = parseFloat(row[idx.qty]) || 0;
    if (!code || qty <= 0) continue;

    const site    = String(row[idx.site]    || '').trim();
    const cust    = String(row[idx.cust]    || '').trim();
    const siteKey = site + '||' + cust;

    const rawDate  = row[idx.dateRes];
    const dateObj  = rawDate instanceof Date ? rawDate : new Date(rawDate);
    const days     = (!isNaN(dateObj)) ? Math.floor((now - dateObj) / 86400000) : 0;
    const dateStr  = (!isNaN(dateObj)) ? Utilities.formatDate(dateObj, 'Asia/Taipei', 'yyyy/MM/dd') : '';

    const progressRaw    = idx.progress     >= 0 ? row[idx.progress]     : '';
    const progressAltRaw = idx.progressAlt  >= 0 ? row[idx.progressAlt]  : '';
    const currentProgress = String(progressRaw || progressAltRaw || '').trim();

    const progDateRaw  = idx.progressDate >= 0 ? row[idx.progressDate] : '';
    const progDateStr  = progDateRaw instanceof Date
      ? Utilities.formatDate(progDateRaw, 'Asia/Taipei', 'yyyy/MM/dd')
      : String(progDateRaw || '').trim();
    const progressHistoryRaw = idx.progressHistory >= 0 ? row[idx.progressHistory] : '';

    const bizSalesRep = bizMap[normalizeCustomerName_(cust)] || '';

    if (!siteMap[siteKey]) {
      siteMap[siteKey] = {
        siteKey:      siteKey,
        site:         site,
        cust:         cust,
        salesRep:     bizSalesRep || (idx.salesRep >= 0 ? String(row[idx.salesRep] || '').trim() : ''),
        customerRep:  idx.customerRep >= 0 ? String(row[idx.customerRep] || '').trim() : '',
        projName:     String(row[idx.projName] || '').trim(),
        deposit:      String(row[idx.deposit]  || '').trim(),
        dateRes:      dateStr,
        days:         days,
        progress:     currentProgress,
        progressDate: progDateStr,
        progressHistory: String(progressHistoryRaw || '').trim(),
        products:     []
      };
    } else {
      // 聚合進度：若此列有進度，且（原本沒進度 或 此列更新日期較新），則覆蓋進度
      if (currentProgress) {
        if (!siteMap[siteKey].progress) {
          siteMap[siteKey].progress = currentProgress;
          siteMap[siteKey].progressDate = progDateStr;
          siteMap[siteKey].progressHistory = String(progressHistoryRaw || '').trim();
        } else {
          const d1 = parseDate_(siteMap[siteKey].progressDate);
          const d2 = parseDate_(progDateStr);
          if (d2 > d1) {
            siteMap[siteKey].progress = currentProgress;
            siteMap[siteKey].progressDate = progDateStr;
            siteMap[siteKey].progressHistory = String(progressHistoryRaw || '').trim();
          }
        }
      }
      // 聚合公司業務、客戶業務與付訂狀態
      if (!siteMap[siteKey].salesRep) {
        siteMap[siteKey].salesRep = bizSalesRep || (idx.salesRep >= 0 ? String(row[idx.salesRep] || '').trim() : '');
      }
      if (!siteMap[siteKey].customerRep) {
        siteMap[siteKey].customerRep = idx.customerRep >= 0 ? String(row[idx.customerRep] || '').trim() : '';
      }
      if (!siteMap[siteKey].deposit || siteMap[siteKey].deposit === '口頭保留') {
        const currentDeposit = String(row[idx.deposit] || '').trim();
        if (currentDeposit && currentDeposit !== '口頭保留') {
          siteMap[siteKey].deposit = currentDeposit;
        }
      }
    }

    siteMap[siteKey].products.push({
      code: code,
      qty:  qty,
      name: idx.prodName >= 0 ? String(row[idx.prodName] || '').trim() : '',
      size: idx.size >= 0 ? String(row[idx.size] || '').trim() : '',
      note: idx.note >= 0 ? String(row[idx.note] || '').trim() : ''
    });
  }

  // 依天數降序（最緊急在最上面），排除已結案/取消/刪除的死案
  const sites = Object.values(siteMap)
    .map(function(s) {
      s.progressDays = -1;
      if (s.progressDate) {
        const pd = parseDate_(s.progressDate);
        if (pd.getTime() > 0) s.progressDays = Math.floor((now - pd) / 86400000);
      }
      return s;
    })
    .filter(s => !isNotHoldingStock_(s.deposit, s.progress)) // 保留單清單：不佔庫存的（結案／取消／刪除／過期釋出）不列
    .sort((a, b) => b.days - a.days);
  return { sites, webAppUrl: RESERVE_EXEC_URL_ + '?view=reserve' };
}

/**
 * 更新進度並寫回試算表
 * 若「業務更新」、「最後更新日期」欄不存在，自動新增
 */
function updateReserveProgress_(siteKey, status, progressText, salesRep, productCodes, actionType, reasonText) {
  try {
    const br  = getBranch_();  // 記錄這次操作的分公司，發送通知時用同一家，避免被併發請求蓋掉 CURRENT_BRANCH
    const sh   = getSheet_();
    const data = sh.getDataRange().getValues();
    const h    = data[0];
    let   idx  = buildIdx_(h);

    // 確保新欄位存在
    const lastCol = h.length;
    
    // 優先使用 '業務更新' 欄位，若不存在但存在 '最新進度'，則使用 '最新進度'
    let progressColIdx = idx.progress;
    if (progressColIdx < 0) {
      if (idx.progressAlt >= 0) {
        progressColIdx = idx.progressAlt;
      } else {
        sh.getRange(1, lastCol + 1).setValue(COL.progress);
        progressColIdx = lastCol;
        idx.progress = lastCol;
        h[lastCol] = COL.progress; // 同步更新記憶體裡的表頭陣列，避免同一次呼叫內archive時用舊表頭比對抓不到這欄
      }
    }

    if (idx.progressDate < 0) {
      const nextCol = sh.getLastColumn() + 1;
      sh.getRange(1, nextCol).setValue(COL.progressDate);
      idx.progressDate = nextCol - 1;
      h[idx.progressDate] = COL.progressDate;
    }
    if (idx.progressHistory < 0) {
      const nextCol = sh.getLastColumn() + 1;
      sh.getRange(1, nextCol).setValue(COL.progressHistory);
      idx.progressHistory = nextCol - 1;
      h[idx.progressHistory] = COL.progressHistory;
    }
    if (idx.reason < 0) {
      const nextCol = sh.getLastColumn() + 1;
      sh.getRange(1, nextCol).setValue(COL.reason);
      idx.reason = nextCol - 1;
      h[idx.reason] = COL.reason;
    }

    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    const [site, cust] = siteKey.split('||');
    let updated = 0;
    const matchedRowIndexes = [];

    // productCodes 若有值則只更新指定品項（逗號分隔），否則全部更新
    const targetCodes = (typeof productCodes === 'string' && productCodes)
      ? productCodes.split(',').map(function(c){ return c.trim().toUpperCase(); }).filter(Boolean)
      : [];

    for (let i = 1; i < data.length; i++) {
      const rowSite = String(data[i][idx.site] || '').trim();
      const rowCust = String(data[i][idx.cust] || '').trim();
      if (rowSite !== site || rowCust !== cust) continue;
      // 若有指定品項，只處理符合的行
      if (targetCodes.length > 0) {
        const rowCode = String(data[i][idx.code] || '').trim().toUpperCase();
        if (targetCodes.indexOf(rowCode) < 0) continue;
      }
      matchedRowIndexes.push(i);

      // 取得既有歷程並追加新紀錄 (新紀錄在最上方)
      const oldHistory = String(data[i][idx.progressHistory] || '').trim();
      const entry = progressText;
      const newHistory = oldHistory ? entry + '\n' + oldHistory : entry;

      sh.getRange(i + 1, progressColIdx   + 1).setValue(progressText);
      sh.getRange(i + 1, idx.progressDate + 1).setValue(today);
      sh.getRange(i + 1, idx.progressHistory + 1).setValue(newHistory);
      if (status && idx.deposit >= 0) {
        sh.getRange(i + 1, idx.deposit + 1).setValue(status);
      }
      if (salesRep && idx.salesRep >= 0) {
        sh.getRange(i + 1, idx.salesRep + 1).setValue(salesRep);
      }
      if (reasonText && idx.reason >= 0) {
        sh.getRange(i + 1, idx.reason + 1).setValue(reasonText);
      }
      data[i][progressColIdx] = progressText;
      data[i][idx.progressDate] = today;
      data[i][idx.progressHistory] = newHistory;
      if (reasonText && idx.reason >= 0) data[i][idx.reason] = reasonText;
      if (status && idx.deposit >= 0) data[i][idx.deposit] = status;
      if (salesRep && idx.salesRep >= 0) data[i][idx.salesRep] = salesRep;
      updated++;
    }

    let archived = 0;
    if (updated > 0 && isArchiveProgress_(status, progressText)) {
      archived = archiveReserveRows_(sh, data, h, matchedRowIndexes, today, getCurrentUserLabel_(), deriveArchiveStatus_(status, progressText));
    }

    // 發送 Telegram 進度更新通知
    if (updated > 0) {
      try {
        var tgMsg = '📝 【保留單進度更新】\n' +
                    '客戶：' + cust + '\n' +
                    '工地：' + site + '\n' +
                    '負責業務：' + (salesRep || '未指定') + '\n' +
                    '更新進度：' + progressText + '\n' +
                    '付訂狀態：' + (status || '無變更');
        pushTelegram(tgMsg, br);
      } catch(tgErr) {
        console.error('發送 TG 進度更新失敗: ' + tgErr.message);
      }
    }

    // 依據 actionType 執行額外動作 (待辦事項、email 等)
    if (updated > 0 && actionType) {
      const firstRow = data[matchedRowIndexes[0]];
      if (actionType === 'deposit') {
        writeTodoItem_(sh.getParent(), '訂金單', firstRow, idx, today);
        sendDepositEmail_(firstRow, idx, site, cust);
        
        // 發送 Telegram 需開立訂金單通知
        try {
          var code = String(firstRow[idx.code] || '').trim();
          var qty = firstRow[idx.qty] || 0;
          var repName = idx.salesRep >= 0 ? String(firstRow[idx.salesRep] || '').trim() : '';
          var tgMsg = '💰 【需開立訂金單】\n' +
                      '客戶：' + cust + '\n' +
                      '工地：' + site + '\n' +
                      '產品編號：' + code + '\n' +
                      '數量：' + qty + ' 片\n' +
                      '負責業務：' + (repName || salesRep || '未指定') + '\n' +
                      '請協助開立訂金確認單。';
          pushTelegram(tgMsg, br);
        } catch(tgErr) {
          console.error('發送 TG 訂金單通知失敗: ' + tgErr.message);
        }
      } else if (actionType === 'confirm') {
        writeTodoItem_(sh.getParent(), '客戶確認單', firstRow, idx, today);
      } else if (actionType === 'report') {
        writeTodoItem_(sh.getParent(), '轉報備', firstRow, idx, today);
      }
    }

    // 在成功寫入後，清除快取以防止 retrieved stale data
    try {
      clearShortageCaches_();
      clearWarRoomCaches_();
    } catch (cacheErr) {
      // 忽略快取清除失敗
    }

    return { success: true, updated, archived: archived };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// 保留單續保／取消 快速動作連結（帳齡通知裡「續保」「取消」按鈕點進來走這裡）
// 用 siteKey（工地||客戶）直接比對，不像客戶版機器人那套用「列號」比對——
// 列號會因為插入/刪除/排序整個位移失效，siteKey 比對值不會，連結不會因為表格變動而打不開。
//
// ⚠️ 網址一律用寫死的部署網址（RESERVE_EXEC_URL_），不要用 ScriptApp.getService().getUrl()：
// 實測發現從「時間觸發器」執行時，這個函式回傳的網址會是別的、甚至不存在的部署 ID
// （跟這個 session 稍早修過的「複製篩選連結」沙盒網址問題是同一類：不能信任它在背景執行時的回傳值）。
// ─────────────────────────────────────────────────────────────

const RESERVE_EXEC_URL_ = 'https:' + '/' + '/script.google.com/macros/s/AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg/exec'; // 版面神器 (保留系統頁面走 ?view=reserve)
/** 給人點的連結 (Email、複製篩選連結、未登入頁)：走 bigt.cc 外殼，先用版面神器登入再開保留日誌 */
function rsvAppLink_(query) { return 'https:' + '/' + '/bigt.cc/ait/inventory.html?rsv=' + encodeURIComponent(query || 'tab=reserve'); }

function _rsvDecode_(v) {
  try { return decodeURIComponent(String(v || '')); } catch (e) { return String(v || ''); }
}

function _rsvTodayShort_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'M/d');
}

/** 產生短代碼 token，把 siteKey/業務/分支存進 ScriptProperties，連結才不會因為中文網址編碼變得又臭又長。
 *  記住產生當下的分支，續保／取消點下去時才能正確操作到該公司的保留表。 */
function _rsvMakeToken_(siteKey, salesRep) {
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  PropertiesService.getScriptProperties().setProperty(
    'RSVTOK_' + token,
    JSON.stringify({ k: siteKey, biz: salesRep, b: currentBranchName_(), ts: Date.now() })
  );
  return token;
}

/** 用短代碼查回 siteKey/業務；查到後即刪除（單次連結用完即失效，也順便避免 ScriptProperties 無限累積） */
function _rsvResolveToken_(token) {
  const props = PropertiesService.getScriptProperties();
  const key = 'RSVTOK_' + token;
  const raw = props.getProperty(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data;
  } catch (e) {
    return null;
  } finally {
    props.deleteProperty(key);
  }
}

/** 建立「續保」「取消」快速動作連結（帳齡通知裡的按鈕用），threshold>=45 續保會先跳續保原因表單。
 *  30天續保／取消都先進「確認頁」而不是連結一開就直接改資料——
 *  這樣就算哪個 App（Telegram/LINE/WhatsApp…）又對連結做了預覽抓取，最多只是打開一個唯讀確認頁，
 *  不會誤觸真的動作；真的要改資料一定要使用者在確認頁上再按一次按鈕才會送出。 */
function buildReserveActionLinks_(s, threshold, branchName) {
  const branch = branchName || currentBranchName_();
  const renewToken = _rsvMakeToken_(s.siteKey || '', s.salesRep || '');
  const cancelToken = _rsvMakeToken_(s.siteKey || '', s.salesRep || '');
  const renewAc = threshold >= 45 ? 'reserveRenewForm' : 'reserveRenewConfirm';
  const renewUrl = RESERVE_EXEC_URL_ + '?view=reserve&branch=' + branch + '&ac=' + renewAc + '&tk=' + renewToken;
  const cancelUrl = RESERVE_EXEC_URL_ + '?view=reserve&branch=' + branch + '&ac=reserveCancelConfirm&tk=' + cancelToken;
  return { renewUrl: renewUrl, cancelUrl: cancelUrl };
}

/** doGet 收到 ac= 開頭的參數時走這裡（見 Main.js） */
function handleReserveQuickAction_(p) {
  try {
    const ac = String(p.ac || '').trim();

    const tokenData = p.tk ? _rsvResolveToken_(p.tk) : null;
    if (!tokenData) {
      return _rsvResultPage_('連結已失效', '#dc2626', '這個連結已經使用過或已過期，請至系統確認最新狀態，或請小姐重新發送通知。');
    }
    // 用 token 裡記的分支切換 CURRENT_BRANCH，確保後續 updateReserveProgress 操作到同一家公司的保留表
    if (tokenData.b) setBranch_(tokenData.b);
    const siteKey = tokenData.k || '';
    const salesRep = tokenData.biz || '';
    const parts = siteKey.split('||');
    const site = parts[0] || '';
    const cust = parts[1] || '';

    if (!siteKey) {
      return _rsvResultPage_('操作失敗', '#dc2626', '缺少必要參數，連結可能不完整');
    }

    // ── 續保（45天以上，需填原因）──
    if (ac === 'reserveRenewForm') {
      return _rsvReasonFormPage_(siteKey, salesRep, cust, site);
    }
    if (ac === 'reserveRenewSubmit') {
      const reason = _rsvDecode_(p.reason || '');
      if (!reason) return _rsvReasonFormPage_(siteKey, salesRep, cust, site, '請填寫續保原因');
      return _rsvDoRenew_(siteKey, salesRep, cust, site, reason);
    }

    // ── 續保（30天，唯讀確認頁 → 再按一次才真的送出）──
    if (ac === 'reserveRenewConfirm') {
      return _rsvConfirmPage_('確認續保', '#059669', cust, site, 'reserveRenewDo', _rsvMakeToken_(siteKey, salesRep));
    }
    if (ac === 'reserveRenewDo') {
      return _rsvDoRenew_(siteKey, salesRep, cust, site, '');
    }

    // ── 取消（唯讀確認頁 → 再按一次才真的送出）──
    if (ac === 'reserveCancelConfirm') {
      return _rsvConfirmPage_('確認取消保留', '#dc2626', cust, site, 'reserveCancelDo', _rsvMakeToken_(siteKey, salesRep));
    }
    if (ac === 'reserveCancelDo') {
      const progressText2 = '[' + _rsvTodayShort_() + '] 客戶未回應，取消保留';
      const res2 = updateReserveProgress_(siteKey, '', progressText2, salesRep, '', 'cancel', '客戶逾期未確認續保');
      if (!res2.success) return _rsvResultPage_('操作失敗', '#dc2626', res2.error || '找不到符合的保留資料，可能已被更新');
      return _rsvResultPage_('已取消保留', '#dc2626', '客戶：' + cust + '\n案名：' + site + '\n共更新 ' + res2.updated + ' 筆');
    }

    return _rsvResultPage_('操作失敗', '#dc2626', '未知動作');
  } catch (e) {
    return _rsvResultPage_('操作發生例外', '#dc2626', e.message);
  }
}

function _rsvDoRenew_(siteKey, salesRep, cust, site, reason) {
  const progressText = '[' + _rsvTodayShort_() + '] 業務確認續保' + (reason ? '：' + reason : '');
  const res = updateReserveProgress_(siteKey, '', progressText, salesRep, '', null, reason);
  if (!res.success) return _rsvResultPage_('操作失敗', '#dc2626', res.error || '找不到符合的保留資料，可能已被更新');
  return _rsvResultPage_('已續保', '#059669', '客戶：' + cust + '\n案名：' + site + '\n共更新 ' + res.updated + ' 筆');
}

/** 唯讀確認頁：只顯示資訊+一個按鈕，按下去才真的送出動作（GET 預覽抓取只會停在這頁，不會誤觸資料變更） */
function _rsvConfirmPage_(title, color, cust, site, nextAc, token) {
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc_(title) + '</title>' +
    '<style>body{font-family:-apple-system,"PingFang TC",sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f4f8}' +
    '.card{background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;margin:20px;width:100%;text-align:center}' +
    'h2{color:#1e293b;margin:0 0 12px;font-size:20px}.row{color:#334155;font-size:14px;margin:4px 0;text-align:left}' +
    'button{width:100%;margin-top:20px;padding:14px;background:' + color + ';color:#fff;border:none;border-radius:10px;font-size:16px;cursor:pointer}</style></head><body>' +
    '<div class="card"><h2>' + esc_(title) + '</h2>' +
    '<div class="row">客戶：' + esc_(cust) + '</div><div class="row">案名：' + esc_(site) + '</div>' +
    '<form method="get" action="' + RESERVE_EXEC_URL_ + '">' +
    '<input type=\"hidden\" name=\"view\" value=\"reserve\">' +
    '<input type="hidden" name="ac" value="' + esc_(nextAc) + '">' +
    '<input type="hidden" name="tk" value="' + esc_(token) + '">' +
    '<button type="submit">確定，送出</button></form></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function _rsvReasonFormPage_(siteKey, salesRep, cust, site, errMsg) {
  // 表單提交是走原本這個 token，重新存一次（因為原 token 在 handleReserveQuickAction_ 一開始就已經被刪除消耗掉了）
  const token = _rsvMakeToken_(siteKey, salesRep);
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>續保原因</title>' +
    '<style>body{font-family:-apple-system,"PingFang TC",sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f4f8}' +
    '.card{background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px;margin:20px;width:100%}' +
    'h2{color:#1e293b;margin:0 0 6px;font-size:20px}.sub{color:#64748b;font-size:14px;margin-bottom:16px}.row{color:#334155;font-size:14px;margin:4px 0}' +
    '.err{color:#dc2626;font-size:13px;margin-top:8px}' +
    'textarea{width:100%;min-height:110px;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;font-family:inherit;margin-top:16px}' +
    'button{width:100%;margin-top:16px;padding:14px;background:#1e40af;color:#fff;border:none;border-radius:10px;font-size:16px;cursor:pointer}</style></head><body>' +
    '<div class="card"><h2>✅ 續保原因</h2><p class="sub">保留已滿 45 天，請填寫續保原因</p>' +
    '<div class="row">客戶：' + esc_(cust) + '</div><div class="row">案名：' + esc_(site) + '</div>' +
    (errMsg ? '<div class="err">⚠️ ' + esc_(errMsg) + '</div>' : '') +
    '<form method="get" action="' + RESERVE_EXEC_URL_ + '" onsubmit="var b=document.getElementById(\'r\');if(!b.value.trim()){alert(\'請填寫續保原因\');return false;}">' +
    '<input type=\"hidden\" name=\"view\" value=\"reserve\">' +
    '<input type="hidden" name="ac" value="reserveRenewSubmit">' +
    '<input type="hidden" name="tk" value="' + esc_(token) + '">' +
    '<textarea id="r" name="reason" placeholder="請輸入續保原因…" required></textarea>' +
    '<button type="submit">送出</button></form></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('續保原因')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function _rsvResultPage_(title, color, bodyText) {
  var icon = color === '#dc2626' ? '✕' : '✓';
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc_(title) + '</title>' +
    '<style>body{font-family:-apple-system,"PingFang TC",sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8fafc}' +
    '.card{background:#fff;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:400px;margin:20px}' +
    '.icon{width:64px;height:64px;background:' + color + ';color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:16px}' +
    'h2{color:#1e293b;margin:0 0 8px}p{color:#64748b;margin:0 0 4px;font-size:14px;white-space:pre-line}</style></head><body>' +
    '<div class="card"><div class="icon">' + icon + '</div><h2>' + esc_(title) + '</h2><p>' + esc_(bodyText || '') + '</p></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ── 待辦事項寫入 ──────────────────────────────────────
function writeTodoItem_(ss, todoType, row, idx, today) {
  const sheetName = '待辦事項';
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
    const headers = ['日期','待辦事項','客戶','編號','數量','工地','客戶業務','保留日期','待辦結果'];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }

  const code   = String(row[idx.code] || '').trim();
  const qty    = row[idx.qty] || 0;
  const cust   = String(row[idx.cust] || '').trim();
  const site   = String(row[idx.site] || '').trim();
  const custRep = idx.customerRep >= 0 ? String(row[idx.customerRep] || '').trim() : '';
  const dateRes = row[idx.dateRes] instanceof Date
    ? Utilities.formatDate(row[idx.dateRes], 'Asia/Taipei', 'yyyy/MM/dd')
    : String(row[idx.dateRes] || '').trim();

  const newRow = [today, todoType, cust, code, qty, site, custRep, dateRes, ''];
  const targetRow = sh.getLastRow() + 1;
  sh.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);

  // 設定待辦結果下拉選單
  const lastCol = newRow.length;
  const resultRange = sh.getRange(targetRow, lastCol);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['給客戶', '已回簽', '其它'], true)
    .build();
  resultRange.setDataValidation(rule);

  // 依待辦事項類型設定顏色
  if (todoType === '訂金單') {
    sh.getRange(targetRow, 1, 1, lastCol).setBackground('#FFF3CD').setFontColor('#DC3545');
  } else if (todoType === '客戶確認單') {
    sh.getRange(targetRow, 1, 1, lastCol).setBackground('#D4EDDA').setFontColor('#000000');
  } else {
    sh.getRange(targetRow, 1, 1, lastCol).setBackground('#FFFFFF').setFontColor('#000000');
  }

  // 自動調整欄寬
  for (let c = 1; c <= lastCol; c++) {
    sh.autoResizeColumn(c);
  }
}

function sendDepositEmail_(row, idx, site, cust) {
  const code   = String(row[idx.code] || '').trim();
  const qty    = row[idx.qty] || 0;
  const siteName = site || '';
  const custName = cust || '';
  const repName  = idx.salesRep >= 0 ? String(row[idx.salesRep] || '').trim() : '';

  const subject = '【需開立訂金確認單】' + custName + ' - ' + code;
  const body = '客戶：' + custName + '\n'
    + '工地：' + siteName + '\n'
    + '產品編號：' + code + '\n'
    + '數量：' + qty + ' 片\n'
    + '業務：' + repName + '\n'
    + '請協助開立訂金確認單。';

  try {
    MailApp.sendEmail({
      to: branchManagerEmail_(),
      subject: subject,
      body: body
    });
  } catch (e) {
    console.error('寄送訂金通知信失敗：' + e.message);
  }
}

// ── 刪除單一品項行 ──────────────────────────────────────
function deleteProductRow_(siteKey, productCode, operator) {
  try {
    const br  = getBranch_();  // 記錄這次操作的分公司，發送通知時用同一家
    const sh   = getSheet_();
    const data = sh.getDataRange().getValues();
    const h    = data[0];
    const idx  = buildIdx_(h);
    const [site, cust] = siteKey.split('||');
    const targetCode = String(productCode || '').trim().toUpperCase();
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    const deletedBy = operator || getCurrentUserLabel_();

    const matchedRowIndexes = [];
    for (let i = 1; i < data.length; i++) {
      const rowSite = String(data[i][idx.site] || '').trim();
      const rowCust = String(data[i][idx.cust] || '').trim();
      const rowCode = String(data[i][idx.code] || '').trim().toUpperCase();
      if (rowSite === site && rowCust === cust && rowCode === targetCode) {
        matchedRowIndexes.push(i);
      }
    }
    if (!matchedRowIndexes.length) return { success: false, error: '找不到該品項行' };

    // 獲取刪除前保留的詳情
    var deletedDetails = [];
    matchedRowIndexes.forEach(function(ri) {
      var qty = parseFloat(data[ri][idx.qty]) || 0;
      var code = String(data[ri][idx.code] || '').trim();
      deletedDetails.push(code + ' (' + qty + '片/坪)');
    });

    // 傳送 Telegram 刪除通知
    try {
      var tgMsg = '🗑️ 【產品保留刪除】\n' +
                  '操作人：' + deletedBy + '\n' +
                  '客戶：' + cust + '\n' +
                  '工地：' + site + '\n' +
                  '已移除產品：' + deletedDetails.join('、');
      pushTelegram(tgMsg, br);
    } catch(tgErr) {
      console.error('發送 TG 刪除通知失敗: ' + tgErr.message);
    }

    // 封存（archiveReserveRows_ 內部已經會刪除來源列，這裡不用再刪一次——
    // 原本這裡還有一段用同一批 matchedRowIndexes 再刪一次的迴圈，但列已經被搬走、
    // row number 也變了，等於用過期的索引砍到別的列，是個既有 bug，一併修掉）
    archiveReserveRows_(sh, data, h, matchedRowIndexes, today, deletedBy, '棄單');
    return { success: true, deleted: matchedRowIndexes.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 統一的缺貨等級判斷（runway 為主），供缺貨公佈欄/預防性保留（getRestockAlerts）
 * 與戰情室（getWarRoomData）共用，確保三個頁面的等級判定完全一致。
 * 2026/08：依使用者決策移除「主檔安全水位」判定，判斷完全以 runway（可用坪能撐幾個月）為主。
 * @param {Object} p { avail, effectiveAvgSales, stockPing, reservedPing, meta }
 * @return {Object} { level, msg, runway } level: 0=正常 1=完全/嚴重缺貨 2=快要斷貨 3=即將缺貨 4=預防性保留 99=新品觀察
 */
function classifyShortageLevel_(p) {
  const avail = p.avail;
  const effectiveAvgSales = p.effectiveAvgSales;
  const stockPing = p.stockPing;
  const reservedPing = p.reservedPing;
  const meta = p.meta || {};

  const runway = effectiveAvgSales > 0 ? (avail / effectiveAvgSales) : 99;
  const reserveRatio = stockPing > 0 ? (reservedPing / stockPing) : 0;

  let level = 0;
  let msg = '';

  // 120×120 特例：可用 < 20 坪一律跳缺貨
  const is120x120 = String(meta.size || '').includes('120');
  const force120 = is120x120 && avail < 20 && avail > 0;

  // 全新品／新品判定：以「首次進貨日」計算天數
  // 全新產品：首進 3 個月內；新品：首進 3 個月~1 年內。這兩種都不納入缺貨判定。
  const firstImportDt = parseAnyDate_(meta.firstImportDate);
  const importAgeDays = firstImportDt ? Math.floor((new Date() - firstImportDt) / 86400000) : -1;
  const isFreshProduct = importAgeDays >= 0 && importAgeDays <= 90;
  const isNewProduct = importAgeDays > 90 && importAgeDays <= 365;

  // 特價品／不續辦／睡美人判斷
  const isSpecialSale = meta.isStop || meta.isSleep || String(meta.series || '').includes('特價');

  if (isFreshProduct) {
    level = 99; msg = '全新產品觀察';
  } else if (isNewProduct) {
    level = 99; msg = '新品觀察';
  } else if (isSpecialSale) {
    if (stockPing > 0 && reservedPing > stockPing * 0.5) {
      level = 4; msg = '預防性保留';
    } else {
      level = 0; msg = '';
    }
  } else {
    if (avail <= 0) {
      level = 1; msg = '完全缺貨';
    } else if (reserveRatio >= 0.8 && runway < 1.5) {
      level = 1; msg = '嚴重缺貨';
    } else if (runway < 1.0) {
      level = 1; msg = '嚴重缺貨';
    } else if (runway < 3.0) {
      level = 2; msg = '快要斷貨';
    } else if (force120) {
      level = 3; msg = '即將缺貨';
    } else if (runway < 4.5) {
      level = 3; msg = '即將缺貨';
    } else if (stockPing > 0 && reservedPing > stockPing * 0.5) {
      level = 4; msg = '預防性保留';
    }
  }

  return { level: level, msg: msg, runway: Math.round(runway * 10) / 10 };
}

function getRestockAlerts(br, forceFresh) {
  try {
    const cached = forceFresh ? null : getCachedJson_(restockAlertsCacheKey_(br));
    if (cached) return cached;

    const b = br ? getBranch_(br) : getBranch_();
    const dbSs = SpreadsheetApp.openById(b.dbSS);
    
    // 1. 讀取「編號價目表」
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    const priceRows = priceSh.getDataRange().getValues();
    const priceHeaders = priceRows[0];
    const pIdx = {
      code: priceHeaders.indexOf('編號'),
      series: priceHeaders.indexOf('中文系列'),
      perPing: priceHeaders.indexOf('片/坪'),
      linkSingle: priceHeaders.indexOf('單片連結網址'),
      isStop: priceHeaders.indexOf('不續辦'),
      isSleep: priceHeaders.indexOf('睡美人'),
      isNew: priceHeaders.indexOf('新品'),
      firstImportDate: (function() {
        const aliases = ['首次進貨日', '首次進貨', '首進日'];
        for (let a = 0; a < aliases.length; a++) {
          const idx = priceHeaders.indexOf(aliases[a]);
          if (idx !== -1) return idx;
        }
        return -1;
      })(),
      safePing: priceHeaders.indexOf('人工指定安全坪數'),
      inDate1: priceHeaders.indexOf('入倉日期1'),
      inQty1: priceHeaders.indexOf('數量1'),
      inDate2: priceHeaders.indexOf('入倉日期2'),
      inQty2: priceHeaders.indexOf('數量2')
    };
    
    // 建立 metaMap
    const metaMap = {};
    for (let i = 1; i < priceRows.length; i++) {
      const code = String(priceRows[i][pIdx.code] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (!code) continue;
      metaMap[code] = {
        series: priceRows[i][pIdx.series] || '',
        perPing: parseFloat(priceRows[i][pIdx.perPing]) || 36,
        linkSingle: priceRows[i][pIdx.linkSingle] || '',
        isStop: !!String(priceRows[i][pIdx.isStop] || '').trim(),
        isSleep: !!String(priceRows[i][pIdx.isSleep] || '').trim(),
        isNew: !!String(priceRows[i][pIdx.isNew] || '').trim(),
        firstImportDate: pIdx.firstImportDate >= 0 ? priceRows[i][pIdx.firstImportDate] : '',
        safePing: parseFloat(priceRows[i][pIdx.safePing]) || 0,
        inDate1: priceRows[i][pIdx.inDate1] || '',
        inQty1: priceRows[i][pIdx.inQty1] || '',
        inDate2: priceRows[i][pIdx.inDate2] || '',
        inQty2: priceRows[i][pIdx.inQty2] || ''
      };
    }
    
    function rsvFindHeaderIndex_(headers, aliases) {
      for (let i = 0; i < aliases.length; i++) {
        const idx = headers.indexOf(aliases[i]);
        if (idx !== -1) return idx;
      }
      return -1;
    }

    // 🚀 貨櫃到貨明細（取代編號價目表的入倉日期1/2 舊船期來源）
    const perPingMapForContainer = {};
    Object.keys(metaMap).forEach(c => { perPingMapForContainer[c] = metaMap[c].perPing; });
    const containerMap = getIncomingContainerMap_(perPingMapForContainer, br);

    // 2、3. 庫存與保留：一律走標準算法（Stock_Core.js）——片數為準、保留排除結案／取消／刪除／過期釋出
    const stockStd = stockRuleReadStock_(br, c => (metaMap[c] && metaMap[c].perPing) || STOCK_RULE.defaultPerPing);
    const stockMap = stockStd.map;                // 編號 → 片數
    const reserveStd = stockRuleReadReserve_(br); // 編號 → {pieces, count}
    const reserveMap = {};
    Object.keys(reserveStd).forEach(k => { reserveMap[k] = reserveStd[k].pieces; });

    // 4. 讀取「產品戰情分類」，跟戰情室共用同一份 getWarRoomMapFast_()，統一計算來源
    //    （不再各自重讀，也不再用人工指定安全坪數，一律採系統算出的有效月均銷/建議安全庫存）
    const wrMapForAlerts = getWarRoomMapFast_(dbSs);

    // 5. 結合數據並評估缺貨等級
    const alerts = [];
    const over50Codes = [];
    for (const code in metaMap) {
      const meta = metaMap[code];
      const perPing = meta.perPing || 36;
      const stockPing = (stockMap[code] || 0) / perPing;
      const reservedPieces = reserveMap[code] || 0;
      
      const reservedPing = reservedPieces / perPing;
      const availPing = stockPing - reservedPing;
      
      if (stockPing > 0 && reservedPing > stockPing * 0.5) {
        over50Codes.push(code);
      }
      
      const stock = stockPing;
      const reserved = reservedPing;
      const avail = availPing;
      
      const wrItem = wrMapForAlerts[code] || {};
      const avgMonthly = wrItem.avgMonthly || 0;
      const peakShaved = wrItem.avgPeakShaved;
      const effectiveAvgSales = wrItem.effectiveAvgSales > 0
        ? wrItem.effectiveAvgSales
        : ((peakShaved !== undefined && !isNaN(peakShaved) && peakShaved >= 0) ? peakShaved : avgMonthly);

      // 🚀 統一來源：judgment 已移除人工安全坪數，safeStock 僅保留系統建議（供參考輸出）
      const safeStock = parseFloat(wrItem.suggestedSafe) > 0 ? parseFloat(wrItem.suggestedSafe) : 0;

      // 🚀 統一判斷：跟戰情室共用同一套 runway 分級（含120x120特例/新品排除/特價品排除）
      const classified = classifyShortageLevel_({
        avail: avail, effectiveAvgSales: effectiveAvgSales,
        stockPing: stockPing, reservedPing: reservedPing, meta: meta
      });
      const level = classified.level;
      const msg = classified.msg;
      const runway = classified.runway;

      const formatDateStr = (val) => {
        if (val instanceof Date) {
          return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy/MM/dd');
        }
        return String(val || '').trim();
      };

      if (level > 0) {
        const containerShipments = containerMap[code] || [];
        alerts.push({
          code: code,
          series: meta.series,
          size: meta.size || '',
          stock: Math.round(stockPing * 10) / 10,
          reserved: Math.round(reservedPing * 10) / 10,
          avail: Math.round(availPing * 10) / 10,
          perPing: perPing,
          runway: Math.round(runway * 10) / 10,
          inDate1: containerShipments[0] ? containerShipments[0].dateStr : '',
          inQty1: containerShipments[0] ? String(containerShipments[0].qtyPieces) : '',
          inDate2: containerShipments[1] ? containerShipments[1].dateStr : '',
          inQty2: containerShipments[1] ? String(containerShipments[1].qtyPieces) : '',
          imgUrl: meta.linkSingle ? getThumbnailLink_(meta.linkSingle) : '',
          msg: msg,
          btnLevel: level,
          isNew: meta.isNew,
          isStop: meta.isStop,
          isSleep: meta.isSleep
        });
      }
    }
    
    const result = { success: true, alerts: alerts, over50Codes: over50Codes };
    putCachedJson_(restockAlertsCacheKey_(br), result, 300);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

const SHORTAGE_TRACKING_SHEET = '缺貨進榜追蹤';
const SHORTAGE_HISTORY_SHEET = '缺貨進榜歷程';
const RESTOCK_ORDER_SHEET = '補貨清單';
const LISTING_SS_ID = '1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0';

/** 快取 key 全部掛上目前分支，避免三家公司（高雅瓷/安帝嘉/喜悅納）共用同一把 key 而互相讀到對方的資料 */
function restockAlertsCacheKey_(br) { return 'restock-alerts-v7-' + (br || currentBranchName_()); }
function shortageBoardCacheKey_(br) { return 'shortage-board-v13-' + (br || currentBranchName_()); }
const SHORTAGE_TRACKING_HEADERS = [
  '廠牌', '產品編號', '系列名稱', '缺貨分類', '入榜日期', '最後系統同步時間',
  '可用庫存', '保留量', '去峰值月均銷', '年銷量', '系統建議補貨',
  '每板坪數', '建議板數', '主檔安全水位', '系統建議安全水位', '安全水位判讀',
  '人工建議補貨', '人工補貨板數', '人工補貨坪數', '人工補貨片數',
  '處理狀態', '預計日期', '國外生產日', '預定到貨日', '實際訂貨量', '負責人',
  '最新備註', '最後更新人', '最後更新時間', '是否結案', '結案日期',
  '是否已回寫主檔', '人工調整安全水位', '安全水位備註', '不續辦決議日',
  '出清結案', '出清結案日期'
];
const SHORTAGE_MANUAL_HEADERS = [
  '人工建議補貨', '人工補貨板數', '人工補貨坪數', '人工補貨片數',
  '處理狀態', '預計日期', '國外生產日', '預定到貨日', '實際訂貨量', '負責人',
  '最新備註', '最後更新人', '最後更新時間', '是否結案', '結案日期',
  '是否已回寫主檔', '人工調整安全水位', '安全水位備註', '不續辦決議日',
  '出清結案', '出清結案日期'
];
const SHORTAGE_HISTORY_HEADERS = [
  '時間', '產品編號', '動作', '更新人', '原狀態', '新狀態',
  '原人工建議', '新人工建議', '原備註', '新備註', '摘要'
];
const RESTOCK_ORDER_HEADERS = [
  '廠牌', '編號', '系列名稱', '補貨板數', '換算坪數', '換算片數',
  '處理狀態', '預定到貨日', '修改人', '備註'
];

function getCachedJson_(key) {
  try {
    const cached = CacheService.getScriptCache().get(key);
    if (!cached) return null;
    const blob = Utilities.newBlob(Utilities.base64Decode(cached), 'application/gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString());
  } catch (e) {
    return null;
  }
}

function putCachedJson_(key, value, seconds) {
  try {
    const payload = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(value))).getBytes());
    CacheService.getScriptCache().put(key, payload, seconds);
  } catch (e) {
    // 快取大小或壓縮失敗不影響主流程
  }
}

function clearShortageCaches_() {
  try {
    const cache = CacheService.getScriptCache();
    // 三家公司各自獨立一把 key，一次全清（併發使用者可能落在不同分支）
    Object.keys(BRANCHES).forEach(function (b) {
      cache.remove('restock-alerts-v7-' + b);
      cache.remove('shortage-board-v13-' + b);
    });
  } catch (e) {}
}

function clearWarRoomCaches_() {
  try {
    const cache = CacheService.getScriptCache();
    Object.keys(BRANCHES).forEach(function (b) {
      cache.remove('warroom-data-v17-' + b);
    });
  } catch (e) {}
}

function normalizeSku_(code) {
  return String(code || '').trim().toUpperCase().replace(/[\s\-]/g, '');
}

function parseNumeric_(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  const cleaned = String(value).replace(/,/g, '').replace(/NT\$|[$％%]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function ensureSheetHeaders_(ss, sheetName, headers) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());
  if (!String(current[0] || '').trim()) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }
  const missing = [];
  headers.forEach(h => {
    if (current.indexOf(h) === -1 && missing.indexOf(h) === -1) {
      missing.push(h);
    }
  });
  if (missing.length > 0) {
    sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

function headerIndexMap_(headers) {
  const idx = {};
  headers.forEach((h, i) => { idx[String(h || '').trim()] = i; });
  return idx;
}

function serializeCell_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Taipei', 'yyyy/MM/dd');
  return value === null || value === undefined ? '' : value;
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = serializeCell_(row[i]); });
  return obj;
}

function findProductRow_(sheet, codeIdx, cleanCode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, codeIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (normalizeSku_(values[i][0]) === cleanCode) return i + 2;
  }
  return -1;
}

function applyDiscontinuedPriceRowStyle_(sheet, row, stopIdx) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1 || row < 2) return;
  sheet.getRange(row, 1, 1, lastCol)
    .setBackground('#f4cccc');
  sheet.getRange(row, stopIdx + 1)
    .setBackground('#ea9999')
    .setFontColor('#990000')
    .setFontWeight('bold');
}

function applySleepingPriceRowStyle_(sheet, row, sleepIdx) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1 || row < 2) return;
  sheet.getRange(row, 1, 1, lastCol)
    .setBackground('#d9d9d9')
    .setFontColor('#666666');
  sheet.getRange(row, sleepIdx + 1)
    .setBackground('#b7b7b7')
    .setFontColor('#000000')
    .setFontWeight('bold');
}

function getPriceMetaMap_(br) {
  const dbSs = SpreadsheetApp.openById((br ? getBranch_(br) : getBranch_()).dbSS);
  const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
  if (!priceSh) return {};
  const rows = priceSh.getDataRange().getValues();
  if (rows.length < 2) return {};
  const h = rows[0];
  const idx = {
    brand: rsvFindHeaderIndex_(h, ['廠牌', '品牌']),
    code: rsvFindHeaderIndex_(h, ['編號', '產品編號']),
    name: rsvFindHeaderIndex_(h, ['中文系列', '系列名稱', '產品名稱']),
    size: rsvFindHeaderIndex_(h, ['尺寸(cm)', '尺寸']),
    perPing: rsvFindHeaderIndex_(h, ['片/坪']),
    pcsPerBox: rsvFindHeaderIndex_(h, ['片/箱']),
    boxesPerPallet: rsvFindHeaderIndex_(h, ['箱/板']),
    kgPerPallet: rsvFindHeaderIndex_(h, ['KG/板']),
    safePing: rsvFindHeaderIndex_(h, ['人工指定安全坪數']),
    discontinue: rsvFindHeaderIndex_(h, ['不續辦']),
    sleep: rsvFindHeaderIndex_(h, ['睡美人'])
  };
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const cleanCode = normalizeSku_(rows[i][idx.code]);
    if (!cleanCode) continue;
    const perPing = idx.perPing >= 0 ? parseFloat(rows[i][idx.perPing]) || 0 : 0;
    const pcsPerBox = idx.pcsPerBox >= 0 ? parseFloat(rows[i][idx.pcsPerBox]) || 0 : 0;
    const boxesPerPallet = idx.boxesPerPallet >= 0 ? parseFloat(rows[i][idx.boxesPerPallet]) || 0 : 0;
    const palletPing = perPing > 0 && pcsPerBox > 0 && boxesPerPallet > 0
      ? Math.round(((pcsPerBox * boxesPerPallet) / perPing) * 10) / 10
      : 0;
    map[cleanCode] = {
      brand: idx.brand >= 0 ? String(rows[i][idx.brand] || '').trim() : '',
      code: String(rows[i][idx.code] || '').trim(),
      name: idx.name >= 0 ? String(rows[i][idx.name] || '').trim() : '',
      size: idx.size >= 0 ? String(rows[i][idx.size] || '').trim() : '',
      perPing: perPing,
      pcsPerBox: pcsPerBox,
      boxesPerPallet: boxesPerPallet,
      kgPerPallet: idx.kgPerPallet >= 0 ? parseFloat(rows[i][idx.kgPerPallet]) || 0 : 0,
      palletPing: palletPing,
      safePing: idx.safePing >= 0 ? parseFloat(rows[i][idx.safePing]) || 0 : 0,
      discontinue: idx.discontinue >= 0 ? rows[i][idx.discontinue] : '',
      sleep: idx.sleep >= 0 ? rows[i][idx.sleep] : ''
    };
  }
  return map;
}

function calculateRestockFromCases_(caseCount, meta) {
  const cases = parseFloat(caseCount) || 0;
  const palletPing = parseFloat(meta && meta.palletPing) || 0;
  const pcsPerBox = parseFloat(meta && meta.pcsPerBox) || 0;
  const boxesPerPallet = parseFloat(meta && meta.boxesPerPallet) || 0;
  const ping = cases > 0 && palletPing > 0 ? Math.round((cases * palletPing) * 10) / 10 : 0;
  const pieces = cases > 0 && pcsPerBox > 0 && boxesPerPallet > 0
    ? Math.round(cases * pcsPerBox * boxesPerPallet)
    : 0;
  return { cases: cases, ping: ping, pieces: pieces };
}

function formatCasesAndPing_(cases, ping) {
  const caseCount = Math.ceil(parseFloat(cases) || 0);
  const pingCount = Math.floor(parseFloat(ping) || 0);
  if (caseCount > 0 && pingCount > 0) return caseCount + '板/' + pingCount + '坪';
  if (caseCount > 0) return caseCount + '板';
  if (pingCount > 0) return pingCount + '坪';
  return '暫無';
}

function appendShortageHistory_(ss, payload) {
  const sh = ensureSheetHeaders_(ss, SHORTAGE_HISTORY_SHEET, SHORTAGE_HISTORY_HEADERS);
  const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
  sh.appendRow([
    now,
    payload.code || '',
    payload.action || '',
    payload.operator || 'web',
    payload.oldStatus || '',
    payload.newStatus || '',
    payload.oldManual || '',
    payload.newManual || '',
    payload.oldNote || '',
    payload.newNote || '',
    payload.summary || ''
  ]);
}

function getRecentShortageHistoryMap_(ss) {
  const sh = ss.getSheetByName(SHORTAGE_HISTORY_SHEET);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  const rows = sh.getDataRange().getValues();
  const h = rows[0].map(v => String(v || '').trim());
  const idx = headerIndexMap_(h);
  for (let r = rows.length - 1; r >= 1; r--) {
    const code = normalizeSku_(rows[r][idx['產品編號']]);
    if (!code) continue;
    if (!map[code]) map[code] = [];
    if (map[code].length >= 5) continue;
    map[code].push({
      time: serializeCell_(rows[r][idx['時間']]),
      action: serializeCell_(rows[r][idx['動作']]),
      operator: serializeCell_(rows[r][idx['更新人']]),
      oldStatus: serializeCell_(rows[r][idx['原狀態']]),
      newStatus: serializeCell_(rows[r][idx['新狀態']]),
      summary: serializeCell_(rows[r][idx['摘要']])
    });
  }
  return map;
}

function formatRestockByPallet_(needPing, palletPing, annualSales) {
  const needRaw = Math.max(0, parseFloat(needPing) || 0);
  const need = Math.floor(needRaw);
  const perPallet = parseFloat(palletPing) || 0;
  if ((parseFloat(annualSales) || 0) < 10) return { text: '是否續辦?', cases: 0 };
  if (needRaw <= 0) return { text: '暫無', cases: 0 };
  if (perPallet <= 0) return { text: need + '坪', cases: 0 };
  const cases = Math.max(1, Math.ceil(needRaw / perPallet));
  const displayPing = needRaw > perPallet ? needRaw : cases * perPallet;
  return { text: formatCasesAndPing_(cases, displayPing), cases: cases };
}

function buildShortageBoardRestock_(a, wr, meta, annualSales) {
  const classification = String(wr && wr.class || '').trim();
  const suggestedSafe = parseFloat(wr && wr.suggestedSafe) || 0;
  const suggestedTarget = parseFloat(wr && wr.suggestedTarget) || 0;
  const avail = parseFloat(a && a.avail) || 0;
  const perPing = parseFloat(a && a.perPing) || parseFloat(meta && meta.perPing) || 36;
  const caseSizePing = parseFloat(meta && meta.palletPing) || 0;
  const incomingQtyPieces = (parseFloat(a && a.inQty1) || 0) + (parseFloat(a && a.inQty2) || 0);
  const totalIncomingPing = perPing > 0 ? incomingQtyPieces / perPing : 0;
  const minimumAnnualSalesPing = 10;

  // 與戰情室相同觸發邏輯：C 類僅可用<0，其餘可用< 建議安全水位才補貨
  let isReplenishTriggered = false;
  let shortageTarget = 0;
  if (classification === 'C') {
    if (avail < 0) {
      isReplenishTriggered = true;
      shortageTarget = -avail;
    }
  } else {
    if (avail < suggestedSafe) {
      isReplenishTriggered = true;
      shortageTarget = Math.max(0, suggestedTarget - avail);
    }
  }
  if (!isReplenishTriggered || shortageTarget <= 0) return { text: '暫無', cases: 0 };

  if (totalIncomingPing >= shortageTarget) return { text: '已安排補庫', cases: 0 };

  const remainingNeedPing = Math.max(0, shortageTarget - totalIncomingPing);
  if ((parseFloat(annualSales) || 0) < minimumAnnualSalesPing) return { text: '是否續辦?', cases: 0 };

  if (caseSizePing > 0) {
    const cases = Math.max(1, Math.ceil(remainingNeedPing / caseSizePing));
    return { text: formatCasesAndPing_(cases, remainingNeedPing > caseSizePing ? remainingNeedPing : cases * caseSizePing), cases: cases };
  }
  return { text: Math.ceil(remainingNeedPing) + '坪', cases: 0 };
}

function buildSafeStockSuggestion_(meta, wrItem) {
  const avg = wrItem ? parseFloat(wrItem.avgPeakShaved) || 0 : 0;
  const palletPing = parseFloat(meta.palletPing) || 0;
  let suggested = 0;
  let note = '資料不足，請人工確認';
  if (avg > 0) {
    suggested = Math.ceil(Math.max(avg * 3.5, palletPing || 0));
    note = '系統建議安全水位 = 去峰值月均銷 × 3.5（低於每板坪數時以每板坪數保底）';
  } else if (palletPing > 0) {
    suggested = Math.ceil(palletPing);
    note = '銷售資料不足，以每板坪數作為安全水位保底';
  }
  return { suggested: suggested, note: note };
}

function normalizeCustomerName_(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()（）【】\[\]「」『』,，.。／\/:：]/g, '');
}

function displayCustomerName_(name) {
  let s = normalizeCustomerName_(name);
  if (!s) return '未知客戶';
  if (s.indexOf('漢樺') >= 0 || s.indexOf('波爾泰') >= 0) return '漢樺';
  if (s.indexOf('大永') >= 0 || s.indexOf('新大永') >= 0) return '大永';
  if (s.indexOf('伊特') >= 0 || s.indexOf('喬弈') >= 0 || s.indexOf('喬翌') >= 0) return '伊特';
  if (s.indexOf('鏷城') >= 0 || s.indexOf('璞城') >= 0) return '鏷城';
  if (s.indexOf('鼎康') >= 0 || s.indexOf('鼎晨') >= 0) return '鼎晨';
  if (s.indexOf('今冠') >= 0 || s.indexOf('金冠') >= 0) return '金冠';
  if (s.indexOf('東春') >= 0 || s.indexOf('滿財') >= 0) return '東春';
  if (s.indexOf('德思特尼') >= 0) return '德思特尼';

  s = s.split(/[-－—]/)[0];
  const suffixes = [
    '企業股份有限公司', '開發有限公司', '股份有限公司', '有限公司',
    '企業', '建材', '國際', '磁磚', '磁藝', '工程', '設計部', '出貨',
    '保留收訂', '公司', '實業', '精品', '工作室', '開發', '室內裝修',
    '室內設計', '設計', '行銷', '商行', '建業', '綜合'
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < suffixes.length; i++) {
      const idx = s.indexOf(suffixes[i]);
      if (idx > 0) {
        s = s.substring(0, idx);
        changed = true;
        break;
      }
    }
  }
  if (!s) return '未知客戶';
  if (s.length <= 4) return s;
  return s.slice(0, 4);
}

function findRegionForCustomer_(customerKey, regionMap, regionKeys, fallbackKey) {
  if (!customerKey && !fallbackKey) return '未分類';
  const keysToTry = [customerKey, fallbackKey].filter(Boolean);
  for (let i = 0; i < keysToTry.length; i++) {
    if (regionMap[keysToTry[i]]) return regionMap[keysToTry[i]];
  }
  customerKey = customerKey || fallbackKey;
  if (regionMap[customerKey]) return regionMap[customerKey];
  for (let i = 0; i < regionKeys.length; i++) {
    const key = regionKeys[i];
    if (!key) continue;
    if (customerKey.indexOf(key) >= 0 || key.indexOf(customerKey) >= 0) return regionMap[key];
  }
  for (let len = 4; len >= 2; len--) {
    const prefix = customerKey.slice(0, len);
    if (!prefix) continue;
    for (let i = 0; i < regionKeys.length; i++) {
      const key = regionKeys[i];
      if (key.indexOf(prefix) >= 0 || prefix.indexOf(key.slice(0, len)) >= 0) return regionMap[key];
    }
  }
  return '未分類';
}

function normalizeSalesRegion_(region) {
  const r = String(region || '').trim();
  if (!r) return '未分類';
  if (r.indexOf('台北') >= 0 || r.indexOf('臺北') >= 0 || r.indexOf('新北') >= 0 || r.indexOf('雙北') >= 0) return '雙北';
  if (r.indexOf('桃園') >= 0) return '桃園';
  if (r.indexOf('新竹') >= 0 || r.indexOf('竹苗') >= 0 || r.indexOf('苗栗') >= 0) return '新竹';
  if (/[中彰投雲]/.test(r) || r.indexOf('台中') >= 0 || r.indexOf('臺中') >= 0 || r.indexOf('彰化') >= 0 || r.indexOf('南投') >= 0 || r.indexOf('雲林') >= 0) return '中彰投雲';
  if (r.indexOf('嘉義') >= 0 || r.indexOf('台南') >= 0 || r.indexOf('臺南') >= 0 || r.indexOf('高雄') >= 0 || r.indexOf('屏東') >= 0 || r.indexOf('嘉南高屏') >= 0) return '嘉南高屏';
  if (r.indexOf('宜蘭') >= 0 || r.indexOf('花蓮') >= 0 || r.indexOf('台東') >= 0 || r.indexOf('臺東') >= 0 || r.indexOf('宜花東') >= 0) return '宜花東';
  return r;
}

function getPreviousImportInfo_(importInfo) {
  const history = importInfo && importInfo.history ? importInfo.history : [];
  return history.length ? history[0] : null;
}

function buildProductInsightMap_(dbSs, importMap, perPingMap, costMap) {
  const insightMap = {};
  const regionMap = {};
  const regionSh = dbSs.getSheetByName('業務分區');
  if (regionSh && regionSh.getLastRow() >= 2) {
    const rows = regionSh.getDataRange().getValues();
    const h = rows[0].map(v => String(v || '').trim());
    const custIdx = rsvFindHeaderIndex_(h, ['客戶', '客戶名稱']);
    const regionIdx = rsvFindHeaderIndex_(h, ['區域', '地區']);
    if (custIdx >= 0 && regionIdx >= 0) {
      for (let i = 1; i < rows.length; i++) {
        const key = normalizeCustomerName_(rows[i][custIdx]);
        if (key) regionMap[key] = normalizeSalesRegion_(rows[i][regionIdx]);
      }
    }
  }
  const regionKeys = Object.keys(regionMap).sort((a, b) => b.length - a.length);

  const listingMap = {};
  let listingSh = null;
  try {
    const listingSs = SpreadsheetApp.openById(LISTING_SS_ID);
    listingSh = listingSs.getSheetByName('版面上架清單') || listingSs.getSheets()[0];
  } catch (listingErr) {
    listingSh = dbSs.getSheetByName('版面上架清單');
  }
  if (listingSh && listingSh.getLastRow() >= 2) {
    const rows = listingSh.getDataRange().getValues();
    let headerRow = 0;
    let h = rows[0].map(v => String(v || '').trim());
    if (rsvFindHeaderIndex_(h, ['編號', '產品編號']) < 0 && rows.length > 1) {
      headerRow = 1;
      h = rows[1].map(v => String(v || '').trim());
    }
    const codeIdx = rsvFindHeaderIndex_(h, ['編號', '產品編號']);
    const custIdx = rsvFindHeaderIndex_(h, ['客戶名稱', '客戶']);
    const offIdx = rsvFindHeaderIndex_(h, ['下架日期', '撤架日期']);
    if (codeIdx >= 0) {
      for (let i = headerRow + 1; i < rows.length; i++) {
        if (offIdx >= 0 && String(rows[i][offIdx] || '').trim()) continue;
        const code = normalizeSku_(rows[i][codeIdx]);
        if (!code) continue;
        if (!listingMap[code]) listingMap[code] = { count: 0, customers: {} };
        listingMap[code].count += 1;
        const customerName = custIdx >= 0 ? displayCustomerName_(rows[i][custIdx]) : '';
        if (customerName) listingMap[code].customers[customerName] = true;
      }
    }
  }

  const salesSh = dbSs.getSheetByName('經銷銷售報表');
  if (!salesSh || salesSh.getLastRow() < 2) return insightMap;
  const rows = salesSh.getDataRange().getValues();
  const h = rows[0].map(v => String(v || '').trim());
  const idx = {
    code: rsvFindHeaderIndex_(h, ['產品編號', '編號']),
    date: rsvFindHeaderIndex_(h, ['單據日期', '銷貨日期', '日期']),
    qty: rsvFindHeaderIndex_(h, ['數量', '銷貨數量']),
    amt: rsvFindHeaderIndex_(h, ['金額', '銷貨金額', '未稅金額']),
    cost: rsvFindHeaderIndex_(h, ['成本', '銷貨成本', '成本金額']),
    marginRate: rsvFindHeaderIndex_(h, ['毛利率', '毛利%', '平均毛利']),
    type: rsvFindHeaderIndex_(h, ['類別']),
    cust: rsvFindHeaderIndex_(h, ['客戶名稱', '客戶'])
  };
  if (idx.code < 0 || idx.date < 0 || idx.qty < 0) return insightMap;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // 銷售數據篩選（去年／近一年／近半年）用的三個時間窗，跟主要的「自上一批進貨以來」統計是獨立的兩套算法，
  // 因為主統計會跳過上一批進貨之前的舊資料，但去年/近半年這種日曆區間常常會落在進貨之前，不能沿用同一個 continue。
  const lastYearNum = now.getFullYear() - 1;
  const trailing365Start = new Date(now.getTime() - 365 * 86400000);
  const trailing180Start = new Date(now.getTime() - 180 * 86400000);
  const acc = {};
  for (let i = 1; i < rows.length; i++) {
    const code = normalizeSku_(rows[i][idx.code]);
    if (!code || !importMap[code]) continue;
    if (idx.type >= 0 && String(rows[i][idx.type] || '').trim() === '退') continue;
    const date = parseAnyDate_(rows[i][idx.date]);
    if (!date) continue;
    if (date > now) continue;
    const qtyPieces = parseFloat(rows[i][idx.qty]) || 0;
    if (qtyPieces <= 0) continue;
    const perPing = perPingMap[code] || 36;
    const ping = qtyPieces / perPing;
    const ymKey = date.getFullYear() * 100 + (date.getMonth() + 1);
    const unitCost = costMap && costMap[code] ? costMap[code] : 0;
    const cost = unitCost > 0
      ? qtyPieces * unitCost
      : (idx.cost >= 0 ? parseNumeric_(rows[i][idx.cost]) : 0);
    // 🚩 [修正] 漏宣告的金額變數，原本 idx.amt 有查欄位索引但從沒把值抓出來，
    // 下面 9 處直接用 amt 當成未宣告變數，執行到第一筆就丟 ReferenceError 導致戰情室整頁掛掉
    const amt = idx.amt >= 0 ? parseNumeric_(rows[i][idx.amt]) : 0;
    const cust = idx.cust >= 0 ? String(rows[i][idx.cust] || '').trim() : '未知客戶';
    const displayCust = displayCustomerName_(cust);
    const custKey = normalizeCustomerName_(cust);
    const displayCustKey = normalizeCustomerName_(displayCust);
    const region = normalizeSalesRegion_(findRegionForCustomer_(custKey, regionMap, regionKeys, displayCustKey));

    if (!acc[code]) {
      const pi = getPreviousImportInfo_(importMap[code]);
      const sDate = pi && pi.dateMs ? new Date(pi.dateMs) : parseAnyDate_(pi && pi.dateStr);
      acc[code] = {
        startDate: sDate,
        importPing: pi ? Math.floor(parseFloat(pi.qtyPing) || 0) : 0,
        lastSaleDate: null,
        lastSalePing: 0,
        totalPing: 0,
        totalAmt: 0,
        totalCost: 0,
        marginWeighted: 0,
        marginWeight: 0,
        customers: {},
        regions: {},
        custLastYear: {}, amtLastYear: 0,
        custYear1: {}, amtYear1: 0,
        custHalf1: {}, amtHalf1: 0,
        monthPing: {}
      };
    }
    const a = acc[code];
    a.monthPing[ymKey] = (a.monthPing[ymKey] || 0) + ping;

    // 效能：deals 只存 epoch ms，不在這裡逐列呼叫 Utilities.formatDate（GAS 內建函式，數千列會拖慢整體）；
    // 真正要格式化成字串，留到最後只對「有機會進到前12大客戶」的少量資料做（見 sortDealsDesc_）。
    const dateMs = date.getTime();

    // ── 去年／近一年／近半年 三個時間窗的客戶明細，不受「自上一批進貨以來」限制 ──
    const bucketInto = (custMap) => {
      if (!custMap[displayCust]) custMap[displayCust] = { name: displayCust, ping: 0, amount: 0, deals: [] };
      custMap[displayCust].ping += ping;
      custMap[displayCust].amount += amt;
      custMap[displayCust].deals.push({ dateMs: dateMs, ping: Math.round(ping * 10) / 10 });
    };
    if (date.getFullYear() === lastYearNum) { bucketInto(a.custLastYear); a.amtLastYear += amt; }
    if (date >= trailing365Start) { bucketInto(a.custYear1); a.amtYear1 += amt; }
    if (date >= trailing180Start) { bucketInto(a.custHalf1); a.amtHalf1 += amt; }

    // ── 主統計（銷售期間/集中度/上架比對等既有邏輯）：只看自上一批進貨以來的資料 ──
    if (a.startDate && date < a.startDate) continue;
    a.totalPing += ping;
    a.totalAmt += amt;
    a.totalCost += cost;
    if (idx.marginRate >= 0) {
      let mr = parseFloat(rows[i][idx.marginRate]);
      if (!isNaN(mr)) {
        if (mr > 0 && mr <= 1) mr = mr * 100;
        a.marginWeighted += mr * Math.max(amt, 1);
        a.marginWeight += Math.max(amt, 1);
      }
    }
    if (!a.customers[displayCust]) a.customers[displayCust] = { name: displayCust, ping: 0, amount: 0, rawNames: {}, deals: [] };
    a.customers[displayCust].ping += ping;
    a.customers[displayCust].amount += amt;
    a.customers[displayCust].rawNames[cust || displayCust] = true;
    a.customers[displayCust].deals.push({ dateMs: dateMs, ping: Math.round(ping * 10) / 10 });
    if (!a.regions[region]) a.regions[region] = { region: region, ping: 0, amount: 0, customers: {} };
    a.regions[region].ping += ping;
    a.regions[region].amount += amt;
    a.regions[region].customers[displayCust] = true;
    if (!a.lastSaleDate || date > a.lastSaleDate) {
      a.lastSaleDate = date;
      a.lastSalePing = ping;
    }
  }

  const sortDealsDesc_ = (deals) => (deals || [])
    .slice()
    .sort((x, y) => y.dateMs - x.dateMs)
    .slice(0, 20)
    .map(d => ({ date: Utilities.formatDate(new Date(d.dateMs), 'Asia/Taipei', 'yyyy/MM/dd'), ping: d.ping }));
  const buildPeriodCustomerList_ = (custMap, totalAmt) => Object.keys(custMap).map(k => {
    const c = custMap[k];
    return {
      name: c.name,
      ping: Math.round(c.ping * 10) / 10,
      amountWan: Math.round((c.amount / 10000) * 10) / 10,
      pct: totalAmt > 0 ? Math.round((c.amount / totalAmt) * 1000) / 10 : 0,
      deals: sortDealsDesc_(c.deals)
    };
  }).sort((x, y) => y.amountWan - x.amountWan).slice(0, 12);

  Object.keys(acc).forEach(code => {
    const a = acc[code];
    const endDate = a.lastSaleDate || now;
    const salesDays = a.startDate ? Math.max(0, Math.floor((endDate - a.startDate) / 86400000)) : 0;
    const totalAmt = a.totalAmt || 0;
    const salesByPeriod = {
      lastYear: buildPeriodCustomerList_(a.custLastYear, a.amtLastYear),
      year1: buildPeriodCustomerList_(a.custYear1, a.amtYear1),
      half1: buildPeriodCustomerList_(a.custHalf1, a.amtHalf1)
    };
    const customers = Object.keys(a.customers).map(k => {
      const c = a.customers[k];
      return {
        name: c.name,
        ping: Math.round(c.ping * 10) / 10,
        amountWan: Math.round((c.amount / 10000) * 10) / 10,
        pct: totalAmt > 0 ? Math.round((c.amount / totalAmt) * 1000) / 10 : 0,
        rawNames: Object.keys(c.rawNames || {}),
        deals: sortDealsDesc_(c.deals)
      };
    }).sort((x, y) => y.amountWan - x.amountWan);
    const top1 = customers.length ? customers[0].pct : 0;
    const top3 = customers.slice(0, 3).reduce((sum, c) => sum + c.pct, 0);
    const top4 = Math.round(customers.slice(0, 4).reduce((sum, c) => sum + c.pct, 0) * 10) / 10;
    const regions = Object.keys(a.regions).map(k => {
      const r = a.regions[k];
      return {
        region: r.region,
        ping: Math.round(r.ping * 10) / 10,
        amountWan: Math.round((r.amount / 10000) * 10) / 10,
        pct: totalAmt > 0 ? Math.round((r.amount / totalAmt) * 1000) / 10 : 0,
        customers: Object.keys(r.customers || {}).sort()
      };
    }).sort((x, y) => y.pct - x.pct);
    let margin = null;
    if (a.marginWeight > 0) margin = Math.round((a.marginWeighted / a.marginWeight) * 10) / 10;
    else if (a.totalAmt > 0 && a.totalCost > 0) margin = Math.round(((a.totalAmt - a.totalCost) / a.totalAmt) * 1000) / 10;
    const listingInfo = listingMap[code] || { count: 0, customers: {} };
    const listingCustomers = Object.keys(listingInfo.customers || {}).sort();
    const monthlyStatsWr = computeMonthlyStats_(a.monthPing);
    insightMap[code] = {
      startDate: a.startDate ? Utilities.formatDate(a.startDate, 'Asia/Taipei', 'yyyy/MM/dd') : '',
      salesDays: salesDays,
      importPing: a.importPing,
      customerCount: customers.length,
      customers: customers.slice(0, 12),
      salesByPeriod: salesByPeriod,
      concentration: {
        top1Pct: top1,
        top3Pct: top3,
        top4Pct: top4,
        label: top4 >= 80 ? '前四集中' : (top3 >= 75 ? '前三集中' : (top1 >= 60 ? '單一集中' : '分散'))
      },
      listing: {
        count: listingInfo.count || 0,
        customerCount: listingCustomers.length,
        customers: listingCustomers,
        soldCustomerCount: customers.length,
        diff: (listingInfo.count || 0) - customers.length
      },
      avgMargin: margin,
      regions: regions,
      latestImport: {
        date: importMap[code] && importMap[code].latestImportDate || '無資料',
        ping: importMap[code] && importMap[code].latestImportQty || 0
      },
      lastSale: {
        date: a.lastSaleDate ? Utilities.formatDate(a.lastSaleDate, 'Asia/Taipei', 'yyyy/MM/dd') : '無資料',
        ping: Math.round(a.lastSalePing * 10) / 10
      },
      medianMonthlyPing: monthlyStatsWr.medianMonthlyPing,
      median3Ping: monthlyStatsWr.median3Ping,
      median6Ping: monthlyStatsWr.median6Ping,
      avg3Ping: monthlyStatsWr.avg3Ping,
      avg6Ping: monthlyStatsWr.avg6Ping,
      avg12Ping: monthlyStatsWr.avg12Ping,
      recent12TotalPing: monthlyStatsWr.recent12TotalPing,
      velocityTrend: monthlyStatsWr.velocityTrend,
      projectTotalPing: monthlyStatsWr.projectTotalPing,
      retailTotalPing: monthlyStatsWr.retailTotalPing,
      projectMonths: monthlyStatsWr.projectMonths
    };
  });
  return insightMap;
}

/**
 * 預熱缺貨公佈欄快取，避免使用者進入分頁時遇到快取過期需現算的延遲。
 * 搭配 setupShortageBoardPrewarmTrigger 設定每 5 分鐘自動執行。
 */
function setupShortageBoardPrewarmTrigger() {
  const existing = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'prewarmShortageBoard');
  if (existing.length) {
    console.log('⏭ 缺貨公佈欄預熱觸發器已存在，跳過');
    return;
  }

  ScriptApp.newTrigger('prewarmShortageBoard')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('✅ 缺貨公佈欄預熱觸發器已設定：每 5 分鐘');
}

function prewarmShortageBoard() {
  // 三家各自預熱自家的缺貨板（key 已帶分支），不影響 CURRENT_BRANCH
  // forceFresh=true：強制跳過「同為 300 秒的快取 TTL」自我鎖死，一定重算並重寫追蹤表，
  // 重算結果仍寫回快取，前端開公告欄照樣秒開。
  forEachBranch_(function (br, key) {
    getShortageBoardData(key, true);
  });
}

/**
 * 戰情室資料預熱：跟缺貨公佈欄同一套機制。原本 warroom-data-v14 快取只有180秒(3分鐘)、
 * 又沒有預熱觸發器，使用者間隔超過3分鐘再進來就會撞到完整重算（含銷售數據期間篩選新增的
 * 大量客戶明細掃描），變成每次登入都在等現算、容易逾時。改成跟缺貨公佈欄一樣每5分鐘背景預熱、
 * 快取延長到 6 分鐘，讓使用者幾乎不會撞到現算的冷啟動路徑。
 */
function setupWarRoomPrewarmTrigger() {
  const existing = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'prewarmWarRoom');
  if (existing.length) {
    console.log('⏭ 戰情室預熱觸發器已存在，跳過');
    return;
  }

  ScriptApp.newTrigger('prewarmWarRoom')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('✅ 戰情室預熱觸發器已設定：每 5 分鐘');
}

function prewarmWarRoom() {
  // 三家各自預熱自家的戰情室快取（key 已帶分支），不影響 CURRENT_BRANCH
  forEachBranch_(function () {
    getWarRoomData();
  });
}

function getWarRoomMapFast_(dbSs) {
  const map = {};
  const sh = dbSs.getSheetByName('產品戰情分類');
  if (!sh || sh.getLastRow() < 2) return map;
  const rows = sh.getDataRange().getValues();
  const headers = rows[0].map(v => String(v || '').trim());
  const aIdx = headerIndexMap_(headers);
  for (let r = 1; r < rows.length; r++) {
    const code = normalizeSku_(rows[r][aIdx['產品編號']]);
    if (!code) continue;
    const avgPeakShaved = parseFloat(rows[r][aIdx['去峰值均銷(坪)']]) || 0;
    const avgMonthly = parseFloat(rows[r][aIdx['常規月均銷(坪)']]) || 0;
    const annualSales = parseFloat(rows[r][aIdx['累積總銷量(坪)']]) || Math.round(avgMonthly * 12 * 10) / 10;
    map[code] = {
      code: rows[r][aIdx['產品編號']],
      class: serializeCell_(rows[r][aIdx['產品戰情分類']]),
      avgMonthly: avgMonthly,
      avgPeakShaved: avgPeakShaved,
      avg3M: aIdx['3個月均銷(坪)'] >= 0 ? parseFloat(rows[r][aIdx['3個月均銷(坪)']]) || 0 : 0,
      avg6M: aIdx['6個月均銷(坪)'] >= 0 ? parseFloat(rows[r][aIdx['6個月均銷(坪)']]) || 0 : 0,
      effectiveAvgSales: aIdx['有效月均銷(坪)'] >= 0 ? parseFloat(rows[r][aIdx['有效月均銷(坪)']]) || 0 : avgPeakShaved,
      isLargeFloorApplied: aIdx['大磚保底套用'] >= 0 ? String(rows[r][aIdx['大磚保底套用']] || '').trim() === '是' : false,
      annualSales: annualSales,
      suggestedSafe: serializeCell_(rows[r][aIdx['系統建議安全坪數']]),
      suggestedTarget: serializeCell_(rows[r][aIdx['系統建議補貨目標']]),
      importDate: serializeCell_(rows[r][aIdx['最新進貨日']]),
      importQty: serializeCell_(rows[r][aIdx['最新批次進貨坪數']]),
      batchRatio: serializeCell_(rows[r][aIdx['最新批次銷售佔比']]),
      lastSaleDate: serializeCell_(rows[r][aIdx['最後銷貨日']]),
      stagnantDays: parseNumeric_(rows[r][aIdx['滯銷天數']]),
      peakMonth: serializeCell_(rows[r][aIdx['銷量峰值月份']])
    };
  }
  return map;
}

const PRODUCT_ANNUAL_CACHE_SHEET = '產品年度銷售快取';

/**
 * 依編號從「產品年度銷售快取」（已聚合的月×產品×客戶彙總表，非現場掃萬筆銷貨）
 * 現算客戶明細／集中度／銷售天數／上架比對，供缺貨公佈欄卡片展開時延遲載入。
 * 刻意不塞進 getShortageBoardData() 的主要回應（避免重蹈 CacheService 100KB 上限的舊問題）。
 */
/**
 * 讀取「缺貨進榜追蹤」表中缺貨分類＝「預防性保留」的品項入榜日期，供預防性保留頁顯示。
 * 輕量查詢，不現算，供前端在該分頁載入時單獨呼叫。
 */
function getProbationEntryDates() {
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const trackSh = dbSs.getSheetByName(SHORTAGE_TRACKING_SHEET);
    if (!trackSh || trackSh.getLastRow() < 2) return { success: true, map: {} };
    const rows = trackSh.getDataRange().getValues();
    const headers = rows[0].map(v => String(v || '').trim());
    const idx = headerIndexMap_(headers);
    const map = {};
    for (let r = 1; r < rows.length; r++) {
      const cat = idx['缺貨分類'] >= 0 ? String(rows[r][idx['缺貨分類']] || '').trim() : '';
      if (cat !== '預防性保留') continue;
      const code = normalizeSku_(rows[r][idx['產品編號']]);
      if (!code) continue;
      const entryDate = idx['入榜日期'] >= 0 ? rows[r][idx['入榜日期']] : '';
      map[code] = entryDate instanceof Date ? Utilities.formatDate(entryDate, 'Asia/Taipei', 'yyyy/MM/dd') : String(entryDate || '');
    }
    return { success: true, map: map };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getProductInsight(code) {
  try {
    const clean = normalizeSku_(code);
    if (!clean) return { success: false, error: '編號空白' };

    const cacheKey = 'product-insight-v2-' + currentBranchName_() + '-' + clean;
    const cachedInsight = getCachedJson_(cacheKey);
    // 舊版快取缺月銷統計欄位 → 視為無效重新現算，與戰情室/批次同源
    if (cachedInsight && (cachedInsight.recent12TotalPing === undefined || cachedInsight.medianMonthlyPing === undefined)) {
      putCachedJson_(cacheKey, null, 0);
      return getProductInsight(code);
    }
    if (cachedInsight) return { success: true, insight: cachedInsight, syncedAt: cachedInsight._syncedAt || '' };

    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const cacheSh = dbSs.getSheetByName(PRODUCT_ANNUAL_CACHE_SHEET);
    if (!cacheSh || cacheSh.getLastRow() < 2) return { success: true, insight: {}, syncedAt: '' };

    const rows = cacheSh.getDataRange().getValues();
    const insight = buildProductInsightFromCache_(clean, rows);

    putCachedJson_(cacheKey, insight, 3600);

    return { success: true, insight: insight, syncedAt: insight._syncedAt || '' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getProductInsightBatch(codes, forceRefresh) {
  try {
    const cleanList = (codes || []).map(c => normalizeSku_(c)).filter(Boolean);
    if (!cleanList.length) return { success: true, insights: {}, syncedAt: '' };

    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const cacheSh = dbSs.getSheetByName(PRODUCT_ANNUAL_CACHE_SHEET);
    const rows = (cacheSh && cacheSh.getLastRow() >= 2) ? cacheSh.getDataRange().getValues() : [];

    let syncedAt = '';
    const insights = {};
    const priceMetaMap = getPriceMetaMap_(); // 只讀一次，批次共用

    // 業務分區與版面上架清單各只讀一次，避免 N 個品項重複讀 N 次
    const ctx = {};
    try {
      const regionSh = dbSs.getSheetByName('業務分區');
      if (regionSh && regionSh.getLastRow() >= 2) ctx.regionRows = regionSh.getDataRange().getValues();
    } catch (e) { /* 略過 */ }
    try {
      let listingSh = null;
      try {
        listingSh = SpreadsheetApp.openById(LISTING_SS_ID).getSheetByName('版面上架清單');
      } catch (e2) {
        listingSh = dbSs.getSheetByName('版面上架清單');
      }
      if (listingSh && listingSh.getLastRow() >= 2) ctx.listingRows = listingSh.getDataRange().getValues();
    } catch (e3) { /* 略過 */ }

    cleanList.forEach(clean => {
      const cacheKey = 'product-insight-v2-' + currentBranchName_() + '-' + clean;
      let insight = null;
      if (!forceRefresh) {
        insight = getCachedJson_(cacheKey);
        // 舊版快取缺月銷統計欄位（recent12TotalPing/medianMonthlyPing）→ 視為無效重新現算，
        // 確保缺貨公佈欄與戰情室數字同源（都是 computeMonthlyStats_ 產出）
        if (insight && (insight.recent12TotalPing === undefined || insight.medianMonthlyPing === undefined)) {
          insight = null;
        }
      }
      if (!insight) {
        insight = rows.length ? buildProductInsightFromCache_(clean, rows, priceMetaMap, ctx) : {};
        putCachedJson_(cacheKey, insight, 3600);
      }
      if (!syncedAt && insight && insight._syncedAt) syncedAt = insight._syncedAt;
      insights[clean] = insight;
    });

    return { success: true, insights: insights, syncedAt: syncedAt };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 統一「月銷統計」：中位數月銷（剔除專案爆單等極端值）、3/6/12 月實際均銷、近12月總銷、
 * 動能（近3月中位數 vs 近12月中位數）、以及「正常零售 / 專案爆單」拆解。
 * 戰情室 buildProductInsightMap_ 與缺貨公佈欄 buildProductInsightFromCache_ 共用此函式，
 * 確保兩邊數據完全同源、不再各算一套。
 * @param {Object} monthPing { YYYYMM: ping } 逐月銷售坪數
 */
function computeMonthlyStats_(monthPing) {
  const median_ = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };
  const yms = Object.keys(monthPing || {}).map(Number).sort((a, b) => a - b);
  const recent12Yms = yms.slice(-12);
  const recent12 = recent12Yms.map(ym => monthPing[ym]);
  const recent3 = yms.slice(-3).map(ym => monthPing[ym]);
  const recent6 = yms.slice(-6).map(ym => monthPing[ym]);
  const medianMonthlyPing = Math.round(median_(recent12) * 10) / 10;
  const median3Ping = Math.round(median_(recent3) * 10) / 10;
  const median6Ping = Math.round(median_(recent6) * 10) / 10;
  const mean_ = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 10) / 10 : 0;
  const avg3Ping = mean_(recent3);
  const avg6Ping = mean_(recent6);
  const avg12Ping = mean_(recent12);
  const recent12TotalPing = Math.round(recent12.reduce((s, v) => s + v, 0) * 10) / 10;
  let velocityTrend = '平穩 ➡️';
  if (medianMonthlyPing > 0 && median3Ping > 0) {
    const ratio = median3Ping / medianMonthlyPing;
    if (ratio >= 1.25) velocityTrend = '近期轉強 🚀';
    else if (ratio <= 0.75) velocityTrend = '動能走弱 📉';
  }
  // 專案爆單判定：單月銷售 ≥ 中位數×3（且至少 5 坪，避免雜訊誤判），
  // 剩下月份視為「正常零售」，供「年銷量 = 零售 + 專案」拆解呈現。
  const projThreshold = Math.max(medianMonthlyPing * 3, 5);
  const projectMonths = [];
  let projectTotalPing = 0;
  recent12.forEach((v, idx) => {
    if (v >= projThreshold) {
      projectTotalPing += v;
      projectMonths.push({ ym: String(recent12Yms[idx]), ping: Math.round(v * 10) / 10 });
    }
  });
  const projectTotalPingR = Math.round(projectTotalPing * 10) / 10;
  return {
    medianMonthlyPing: medianMonthlyPing,
    median3Ping: median3Ping,
    median6Ping: median6Ping,
    avg3Ping: avg3Ping,
    avg6Ping: avg6Ping,
    avg12Ping: avg12Ping,
    recent12TotalPing: recent12TotalPing,
    velocityTrend: velocityTrend,
    projectTotalPing: projectTotalPingR,
    retailTotalPing: Math.round((recent12TotalPing - projectTotalPing) * 10) / 10,
    projectMonths: projectMonths
  };
}

function buildProductInsightFromCache_(clean, rows, priceMetaMap, ctx) {
  const headers = rows[0].map(v => String(v || '').trim());
  const idx = headerIndexMap_(headers);
  if (idx['產品編號'] === undefined || idx['產品編號'] < 0) return {};

  const perPingMeta = (priceMetaMap || getPriceMetaMap_())[clean] || {};
  const perPing = perPingMeta.perPing || 36;

  const customers = {}; // displayName -> { name, ping, amountWan, rawNames:{} }
  let totalAmt = 0, totalPing = 0;
  let minYm = null, maxYm = null;
  let lastSaleDate = null, lastSalePing = 0;

  // 🚀 銷售數據期間分窗（去年／近一年／近半年）＋ 逐月銷售彙總（算中位數月銷用）
  const nowW = new Date();
  nowW.setHours(0, 0, 0, 0);
  const lastYearNumW = nowW.getFullYear() - 1;
  const trailing365W = new Date(nowW.getTime() - 365 * 86400000);
  const trailing180W = new Date(nowW.getTime() - 180 * 86400000);
  const custLastYear = {}, custYear1 = {}, custHalf1 = {};
  let amtLastYear = 0, amtYear1 = 0, amtHalf1 = 0;
  const monthPing = {}; // ym(YYYYMM) -> ping（該月所有客戶合計，供中位數/動能）
  const monthAmt = {};  // ym -> amount

  const bucketByWindow_ = (custMap, dispCust, rawCust, ping, amt) => {
    if (!custMap[dispCust]) custMap[dispCust] = { name: dispCust, ping: 0, amountWan: 0, rawNames: {} };
    custMap[dispCust].ping += ping;
    custMap[dispCust].amountWan += amt / 10000;
    if (rawCust) custMap[dispCust].rawNames[rawCust] = true;
  };

  for (let r = 1; r < rows.length; r++) {
    const rc = normalizeSku_(rows[r][idx['產品編號']]);
    if (rc !== clean) continue;

    // 銷售日期：優先讀「最後交易日」，再依此欄位推今年月鍵（快取表可能沒有獨立的「年度/月份」欄，
    // 只用「最後交易日」一欄日期；沒有日期欄時才退回「年度/月份」兩個數值欄）
    const saleDateW = idx['最後交易日'] >= 0 ? parseAnyDate_(rows[r][idx['最後交易日']]) : null;

    let ym = 0;
    if (saleDateW) {
      ym = saleDateW.getFullYear() * 100 + (saleDateW.getMonth() + 1);
    } else {
      const year = parseInt(rows[r][idx['年度']], 10) || 0;
      const month = parseInt(rows[r][idx['月份']], 10) || 0;
      if (year >= 1000) ym = year * 100 + month;
      else if (year > 0 && year < 1000) ym = (year + 1911) * 100 + month;
    }
    if (ym > 0) {
      if (minYm === null || ym < minYm) minYm = ym;
      if (maxYm === null || ym > maxYm) maxYm = ym;
    }

    const salesPing = idx['銷售坪數'] >= 0 ? (parseFloat(rows[r][idx['銷售坪數']]) || 0) : 0;
    const salesAmt = idx['銷售金額'] >= 0 ? (parseFloat(rows[r][idx['銷售金額']]) || 0) : 0;
    totalPing += salesPing;
    totalAmt += salesAmt;
    if (ym > 0) {
      monthPing[ym] = (monthPing[ym] || 0) + salesPing;
      monthAmt[ym] = (monthAmt[ym] || 0) + salesAmt;
    }

    const rawCust = idx['客戶名稱'] >= 0 ? String(rows[r][idx['客戶名稱']] || '').trim() : '';
    const dispCust = displayCustomerName_(rawCust);
    if (!customers[dispCust]) customers[dispCust] = { name: dispCust, ping: 0, amountWan: 0, rawNames: {} };
    customers[dispCust].ping += salesPing;
    customers[dispCust].amountWan += salesAmt / 10000;
    if (rawCust) customers[dispCust].rawNames[rawCust] = true;

    if (saleDateW) {
      if (saleDateW.getFullYear() === lastYearNumW) { bucketByWindow_(custLastYear, dispCust, rawCust, salesPing, salesAmt); amtLastYear += salesAmt; }
      if (saleDateW >= trailing365W) { bucketByWindow_(custYear1, dispCust, rawCust, salesPing, salesAmt); amtYear1 += salesAmt; }
      if (saleDateW >= trailing180W) { bucketByWindow_(custHalf1, dispCust, rawCust, salesPing, salesAmt); amtHalf1 += salesAmt; }
    }

    if (saleDateW && (!lastSaleDate || saleDateW > lastSaleDate)) { lastSaleDate = saleDateW; lastSalePing = salesPing; }
  }

    const customerList = Object.keys(customers).map(k => {
      const c = customers[k];
      return {
        name: c.name,
        ping: Math.round(c.ping * 10) / 10,
        amountWan: Math.round(c.amountWan * 10) / 10,
        pct: totalAmt > 0 ? Math.round((c.amountWan * 10000 / totalAmt) * 1000) / 10 : 0,
        rawNames: Object.keys(c.rawNames)
      };
    }).sort((x, y) => y.amountWan - x.amountWan);

    const top1 = customerList.length ? customerList[0].pct : 0;
    const top3 = customerList.slice(0, 3).reduce((s, c) => s + c.pct, 0);
    const top4 = Math.round(customerList.slice(0, 4).reduce((s, c) => s + c.pct, 0) * 10) / 10;

    let salesDays = 0;
    if (minYm !== null && maxYm !== null) {
      const startDate = new Date(Math.floor(minYm / 100), (minYm % 100) - 1, 1);
      const endDate = lastSaleDate || new Date(Math.floor(maxYm / 100), (maxYm % 100) - 1, 28);
      salesDays = Math.max(0, Math.floor((endDate - startDate) / 86400000));
    }

    // 上架/銷售比對：讀「版面上架清單」目前仍上架（無下架日期）的客戶數
    let listingCount = 0;
    try {
      let listingSh = null;
      if (ctx && ctx.listingRows) {
        listingSh = { getDataRange: () => ({ getValues: () => ctx.listingRows }), getLastRow: () => ctx.listingRows.length };
      } else {
        try {
          listingSh = SpreadsheetApp.openById(LISTING_SS_ID).getSheetByName('版面上架清單');
        } catch (e) {
          listingSh = SpreadsheetApp.openById(getBranch_().dbSS).getSheetByName('版面上架清單');
        }
      }
      if (listingSh && listingSh.getLastRow() >= 2) {
        const lRows = listingSh.getDataRange().getValues();
        let hRow = 0;
        let lh = lRows[0].map(v => String(v || '').trim());
        if (rsvFindHeaderIndex_(lh, ['編號', '產品編號']) < 0 && lRows.length > 1) {
          hRow = 1;
          lh = lRows[1].map(v => String(v || '').trim());
        }
        const lCodeIdx = rsvFindHeaderIndex_(lh, ['編號', '產品編號']);
        const lOffIdx = rsvFindHeaderIndex_(lh, ['下架日期', '撤架日期']);
        const lCustSet = {};
        if (lCodeIdx >= 0) {
          for (let r = hRow + 1; r < lRows.length; r++) {
            if (lOffIdx >= 0 && String(lRows[r][lOffIdx] || '').trim()) continue;
            if (normalizeSku_(lRows[r][lCodeIdx]) !== clean) continue;
            lCustSet[r] = true;
          }
        }
        listingCount = Object.keys(lCustSet).length;
      }
    } catch (e) {
      console.error('讀取版面上架清單失敗：' + e.message);
    }

    // 區域銷售：依客戶查「業務分區」表，把客戶銷售額分群到區域
    const regionMap = {};
    const regionKeys = [];
    try {
      const regionSh = ctx && ctx.regionRows
        ? { getLastRow: () => ctx.regionRows.length, getDataRange: () => ({ getValues: () => ctx.regionRows }) }
        : SpreadsheetApp.openById(getBranch_().dbSS).getSheetByName('業務分區');
      if (regionSh && regionSh.getLastRow() >= 2) {
        const rRows = regionSh.getDataRange().getValues();
        const rh = rRows[0].map(v => String(v || '').trim());
        const rCustIdx = rsvFindHeaderIndex_(rh, ['客戶', '客戶名稱']);
        const rRegionIdx = rsvFindHeaderIndex_(rh, ['區域', '地區']);
        if (rCustIdx >= 0 && rRegionIdx >= 0) {
          for (let i = 1; i < rRows.length; i++) {
            const key = normalizeCustomerName_(rRows[i][rCustIdx]);
            if (key) {
              regionMap[key] = normalizeSalesRegion_(rRows[i][rRegionIdx]);
              if (regionKeys.indexOf(key) < 0) regionKeys.push(key);
            }
          }
        }
      }
    } catch (e) {
      console.error('讀取業務分區失敗：' + e.message);
    }
    const regionAgg = {};
    customerList.forEach(c => {
      const rawKey = c.rawNames && c.rawNames.length ? normalizeCustomerName_(c.rawNames[0]) : normalizeCustomerName_(c.name);
      const region = findRegionForCustomer_(rawKey, regionMap, regionKeys, normalizeCustomerName_(c.name));
      if (!regionAgg[region]) regionAgg[region] = { region: region, ping: 0, amountWan: 0, customers: {} };
      regionAgg[region].ping += c.ping;
      regionAgg[region].amountWan += c.amountWan;
      regionAgg[region].customers[c.name] = true;
    });
    const regionList = Object.keys(regionAgg).map(k => {
      const r = regionAgg[k];
      return {
        region: r.region,
        ping: Math.round(r.ping * 10) / 10,
        amountWan: Math.round(r.amountWan * 10) / 10,
        pct: totalAmt > 0 ? Math.round((r.amountWan * 10000 / totalAmt) * 1000) / 10 : 0,
        customers: Object.keys(r.customers).sort()
      };
    }).sort((x, y) => y.pct - x.pct);

    // 🚀 期間分窗客戶清單（去年／近一年／近半年），跟戰情室 buildProductInsightMap_ 同構，
    //    讓缺貨公佈欄的「銷售家數／集中度／銷售數據」也能顯示（原本 buildProductInsightFromCache_ 沒算這欄）。
    const buildWindowList_ = (custMap, totAmt) => Object.keys(custMap).map(k => {
      const c = custMap[k];
      return {
        name: c.name,
        ping: Math.round(c.ping * 10) / 10,
        amountWan: Math.round(c.amountWan * 10) / 10,
        pct: totAmt > 0 ? Math.round((c.amountWan * 10000 / totAmt) * 1000) / 10 : 0,
        deals: []
      };
    }).sort((x, y) => y.amountWan - x.amountWan).slice(0, 12);
    const salesByPeriod = {
      lastYear: buildWindowList_(custLastYear, amtLastYear),
      year1: buildWindowList_(custYear1, amtYear1),
      half1: buildWindowList_(custHalf1, amtHalf1)
    };

    // 🚀 中位數月銷（剔除專案爆單等極端值，反映真實零售月銷）＋ 動能（近3月中位數 vs 近12月中位數）
    //     ＋ 3/6/12 月實際均銷 ＋ 專案/零售拆解（統一函式，戰情室 buildProductInsightMap_ 同源）
    const monthlyStats = computeMonthlyStats_(monthPing);
    const medianMonthlyPing = monthlyStats.medianMonthlyPing;
    const median3Ping = monthlyStats.median3Ping;
    const median6Ping = monthlyStats.median6Ping;
    const avg3Ping = monthlyStats.avg3Ping;
    const avg6Ping = monthlyStats.avg6Ping;
    const avg12Ping = monthlyStats.avg12Ping;
    const recent12TotalPing = monthlyStats.recent12TotalPing;
    const velocityTrend = monthlyStats.velocityTrend;
    const projectTotalPing = monthlyStats.projectTotalPing;
    const retailTotalPing = monthlyStats.retailTotalPing;
    const projectMonths = monthlyStats.projectMonths;

    const insight = {
      salesDays: salesDays,
      importPing: 0,
      customerCount: customerList.length,
      customers: customerList.slice(0, 12),
      salesByPeriod: salesByPeriod,
      medianMonthlyPing: medianMonthlyPing,
      median3Ping: median3Ping,
      median6Ping: median6Ping,
      avg3Ping: avg3Ping,
      avg6Ping: avg6Ping,
      avg12Ping: avg12Ping,
      recent12TotalPing: recent12TotalPing,
      velocityTrend: velocityTrend,
      projectTotalPing: projectTotalPing,
      retailTotalPing: retailTotalPing,
      projectMonths: projectMonths,
      concentration: {
        top1Pct: top1,
        top3Pct: top3,
        top4Pct: top4,
        label: top4 >= 80 ? '前四集中' : (top3 >= 75 ? '前三集中' : (top1 >= 60 ? '單一集中' : '分散'))
      },
      listing: {
        count: listingCount,
        customerCount: listingCount,
        soldCustomerCount: customerList.length,
        diff: listingCount - customerList.length
      },
      avgMargin: null,
      regions: regionList,
      latestImport: { date: '', ping: 0 },
      lastSale: {
        date: lastSaleDate ? Utilities.formatDate(lastSaleDate, 'Asia/Taipei', 'yyyy/MM/dd') : '無資料',
        ping: Math.round(lastSalePing * 10) / 10
      }
    };

    insight._syncedAt = new Date().toISOString();

    return insight;
}

function getShortageBoardData(br, forceFresh) {
  try {
    const cached = forceFresh ? null : getCachedJson_(shortageBoardCacheKey_(br));
    if (cached) return cached;

    const b = br ? getBranch_(br) : getBranch_();
    const dbSs = SpreadsheetApp.openById(b.dbSS);
    const trackSh = ensureSheetHeaders_(dbSs, SHORTAGE_TRACKING_SHEET, SHORTAGE_TRACKING_HEADERS);
    const headers = trackSh.getRange(1, 1, 1, trackSh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const idx = headerIndexMap_(headers);
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');

    const alertsRes = getRestockAlerts(br, forceFresh);
    if (!alertsRes.success) return alertsRes;
    const wrMap = getWarRoomMapFast_(dbSs);
    const metaMap = getPriceMetaMap_(br);
    const historyMap = getRecentShortageHistoryMap_(dbSs);

    const trackRows = trackSh.getDataRange().getValues();
    const existing = {};
    for (let r = 1; r < trackRows.length; r++) {
      const clean = normalizeSku_(trackRows[r][idx['產品編號']]);
      if (clean) existing[clean] = { row: r + 1, data: trackRows[r] };
    }

    // 反查保留單，找出目前「還有」入倉日期1/2 的編號，供比對追蹤表上人工填的預定到貨日是否已過期
    const codesWithLiveIncoming = {};
    try {
      const resSh = getSheet_(br);
      const resRows = resSh.getDataRange().getValues();
      const resHeaders = resRows[0];
      const rCodeIdx = rsvFindHeaderIndex_(resHeaders, ['編號', '產品編號']);
      const rDate1Idx = rsvFindHeaderIndex_(resHeaders, ['入倉日期1', '入庫日期1']);
      const rDate2Idx = rsvFindHeaderIndex_(resHeaders, ['入倉日期2', '入庫日期2']);
      if (rCodeIdx >= 0 && (rDate1Idx >= 0 || rDate2Idx >= 0)) {
        for (let r = 1; r < resRows.length; r++) {
          const hasDate = (rDate1Idx >= 0 && String(resRows[r][rDate1Idx] || '').trim())
            || (rDate2Idx >= 0 && String(resRows[r][rDate2Idx] || '').trim());
          if (!hasDate) continue;
          const c = normalizeSku_(resRows[r][rCodeIdx]);
          if (c) codesWithLiveIncoming[c] = true;
        }
      }
    } catch (e) {
      console.error('反查保留單入倉日期失敗：' + e.message);
    }

    const items = [];
    let sheetChanged = false;
    // 缺貨等級 1~3 正式進榜；等級 4「預防性保留」（保留>50% 預警）一併列入顯示；
    // 等級 99（全新產品觀察／新品觀察）一併列入榜單供觀察，
    // 但不觸發缺貨示警信（見 sendShortageAlertEmail 排除邏輯）、也不計入復原掃描的「仍缺貨」判定。
    (alertsRes.alerts || []).filter(a => (a.btnLevel >= 1 && a.btnLevel <= 4) || a.btnLevel === 99).forEach(a => {
      const clean = normalizeSku_(a.code);
      const wr = wrMap[clean] || {};
      const meta = metaMap[clean] || {};
      const rowInfo = existing[clean];
      let rowData = rowInfo ? rowInfo.data : null;
      if (rowData && idx['出清結案'] >= 0 && String(rowData[idx['出清結案']] || '').trim()) return;
      const annualSales = parseFloat(wr.annualSales) || Math.round(((parseFloat(a.runway) > 0 && parseFloat(a.avail) > 0) ? (parseFloat(a.avail) / parseFloat(a.runway) * 12) : 0) * 10) / 10;
      const restock = buildShortageBoardRestock_(a, wr, meta, annualSales);
      const restockCalc = calculateRestockFromCases_(restock.cases, meta);
      const safe = buildSafeStockSuggestion_(meta, wr);
      if (!rowData) {
        rowData = new Array(headers.length).fill('');
        trackRows.push(rowData);
        existing[clean] = { row: trackRows.length, data: rowData };
        sheetChanged = true;
      }

      // 🔁 再度缺貨：上一輪已標「已補貨」，這次又掉回缺貨級別 → 視為新的一輪。
      //    入榜日期改成今天、清掉上一輪的人工處理紀錄（回到「要處理」），並在更新歷程留一筆，原本的值寫在摘要裡可還原。
      const prevCatForReshort = rowInfo && idx['缺貨分類'] >= 0 ? String(rowData[idx['缺貨分類']] || '').trim() : '';
      const isReshortage = !!rowInfo && prevCatForReshort === '已補貨' && a.btnLevel >= 1 && a.btnLevel <= 3;
      if (isReshortage) {
        const oldEnter = idx['入榜日期'] >= 0 ? String(rowData[idx['入榜日期']] || '') : '';
        const oldWho = idx['最後更新人'] >= 0 ? String(rowData[idx['最後更新人']] || '') : '';
        const oldWhen = idx['最後更新時間'] >= 0 ? String(rowData[idx['最後更新時間']] || '') : '';
        const oldSt = idx['處理狀態'] >= 0 ? String(rowData[idx['處理狀態']] || '') : '';
        if (idx['入榜日期'] >= 0) rowData[idx['入榜日期']] = today;
        if (idx['最後更新人'] >= 0) rowData[idx['最後更新人']] = '';
        if (idx['最後更新時間'] >= 0) rowData[idx['最後更新時間']] = '';
        if (idx['處理狀態'] >= 0) rowData[idx['處理狀態']] = ''; // 下面 defaults 會補回「等候開狀」
        sheetChanged = true;
        try {
          appendShortageHistory_(dbSs, {
            time: now, code: a.code, action: '再度缺貨，重新進榜', operator: '系統',
            oldStatus: '已補貨', newStatus: a.msg || '', oldManual: '', newManual: '', oldNote: '', newNote: '',
            summary: '補貨後又缺貨，入榜日期重設為 ' + today + '（原 ' + oldEnter + '）；上一輪處理狀態「' + oldSt + '」、更新人「' + oldWho + '」、時間「' + oldWhen + '」已清除，回到「要處理」'
          });
        } catch (histErr) {
          console.error('再度缺貨歷程寫入失敗：' + histErr.message);
        }
      }

      const systemValues = {
        '廠牌': meta.brand || '',
        '產品編號': a.code,
        '系列名稱': a.series || meta.name || '',
        '缺貨分類': a.msg || '',
        '入榜日期': rowInfo && rowData[idx['入榜日期']] ? rowData[idx['入榜日期']] : today,
        '最後系統同步時間': now,
        '可用庫存': a.avail,
        '保留量': a.reserved,
        '去峰值月均銷': wr.avgPeakShaved || '',
        '年銷量': annualSales || '',
        '系統建議補貨': restock.text,
        '每板坪數': meta.palletPing || '',
        '建議板數': restock.cases || '',
        '系統建議安全水位': safe.suggested || '',
        '安全水位判讀': safe.note
      };

      Object.keys(systemValues).forEach(h => {
        if (idx[h] >= 0 && String(rowData[idx[h]] || '') !== String(systemValues[h] || '')) {
          if (h !== '最後系統同步時間') {
            sheetChanged = true;
          }
          rowData[idx[h]] = systemValues[h];
        }
      });

      // 「人工補貨板數／坪數／片數」只放人工真的存過的數字。系統建議每次同步都即時重算（寫在「系統建議補貨／建議板數」），
      // 不再自動把建議值抄進人工欄——以前抄進去後永遠不更新，月均銷只有 1 坪的產品還掛著幾個月前的 9 板。
      const defaults = {
        '處理狀態': '等候開狀',
        '負責人': 'LYNN'
      };
      Object.keys(defaults).forEach(h => {
        if (idx[h] >= 0 && !String(rowData[idx[h]] || '').trim()) {
          rowData[idx[h]] = defaults[h];
          sheetChanged = true;
        }
      });

      // 🧹 從沒有人手動存過的列（沒有最後更新時間，或只有系統改過）：把以前自動抄進去的舊人工補貨數字清掉
      {
        const touchedBy = idx['最後更新人'] >= 0 ? String(rowData[idx['最後更新人']] || '').trim() : '';
        const touchedAt = idx['最後更新時間'] >= 0 ? String(rowData[idx['最後更新時間']] || '').trim() : '';
        if (!touchedAt || touchedBy === '系統') {
          ['人工建議補貨', '人工補貨板數', '人工補貨坪數', '人工補貨片數'].forEach(h => {
            if (idx[h] >= 0 && String(rowData[idx[h]] || '').trim() !== '') {
              rowData[idx[h]] = '';
              sheetChanged = true;
            }
          });
        }
      }

      const item = rowToObject_(headers, rowData);
      item.cleanCode = clean;
      // 人工填的預定到貨日，若保留單來源已無任何入倉日期，標記為過期資料（不自動清除，前端顯示警示）
      item.incomingDateStale = !!(item['預定到貨日'] && !codesWithLiveIncoming[clean]);
      item.lifecycle = meta.sleep ? '睡美人' : meta.discontinue ? '不續辦' : '';
      item.imgUrl = a.imgUrl || '';
      item.perPing = a.perPing || meta.perPing || '';
      item.pcsPerBox = meta.pcsPerBox || '';
      item.boxesPerPallet = meta.boxesPerPallet || '';
      item.palletPing = meta.palletPing || '';
      item.inDate1 = a.inDate1 || '';
      item.inQty1 = a.inQty1 || '';
      item.inDate2 = a.inDate2 || '';
      item.inQty2 = a.inQty2 || '';
      item.runway = a.runway || '';
      item.warRoom = {
        class: wr.class || '',
        suggestedSafe: wr.suggestedSafe || '',
        suggestedTarget: wr.suggestedTarget || '',
        importDate: wr.importDate || '',
        importQty: wr.importQty || '',
        lastSaleDate: wr.lastSaleDate || '',
        stagnantDays: wr.stagnantDays || 0,
        avg3M: wr.avg3M !== undefined ? wr.avg3M : '',
        avg6M: wr.avg6M !== undefined ? wr.avg6M : '',
        effectiveAvgSales: wr.effectiveAvgSales !== undefined ? wr.effectiveAvgSales : '',
        isLargeFloorApplied: !!wr.isLargeFloorApplied
      };
      item.history = historyMap[clean] || [];
      item.stock = a.stock;
      item.btnLevel = a.btnLevel;
      item.levelCategory = a.btnLevel === 4 ? '預警' : (a.btnLevel === 99 ? '觀察' : '缺貨');
      items.push(item);
    });

    // ── 復原掃描：追蹤表上還留著「完全缺貨/嚴重缺貨/快要斷貨/即將缺貨」，
    //    但這次掃描已不在 level 1~3 名單裡的品項，離開的原因分兩種：
    //    ① 真的補貨了 → 標記「已補貨」，由人工確認後按「產品完結」。
    //    ② 期間被改標成睡美人/不續辦 → classifyShortageLevel_ 本來就不會再把它算進正常缺貨判定，
    //       這種不算「補貨解決」，不該繼續留在追蹤表/跑馬燈/Email通知裡，直接視同人工按「產品完結」整筆退出。
    {
      const stillShortageCodes = {};
      (alertsRes.alerts || []).forEach(a => {
        if (a.btnLevel >= 1 && a.btnLevel <= 3) stillShortageCodes[normalizeSku_(a.code)] = true;
      });
      const shortageCatValues = ['完全缺貨', '嚴重缺貨', '快要斷貨', '即將缺貨'];
      let migratedCount = 0;
      let revivedCount = 0;
      let autoClosedSleepCount = 0;
      let retroClosedSleepCount = 0;
      for (let r = 1; r < trackRows.length; r++) {
        const rowData = trackRows[r];
        const clean = normalizeSku_(rowData[idx['產品編號']]);
        if (!clean) continue;
        if (idx['出清結案'] >= 0 && String(rowData[idx['出清結案']] || '').trim()) continue; // 已人工結案，跳過
        const cat = idx['缺貨分類'] >= 0 ? String(rowData[idx['缺貨分類']] || '').trim() : '';
        if (cat === '已復原') { // 一次性遷移：舊版寫的「已復原」統一改名「已補貨」
          rowData[idx['缺貨分類']] = '已補貨';
          if (idx['最後系統同步時間'] >= 0) rowData[idx['最後系統同步時間']] = now;
          sheetChanged = true;
          migratedCount++;
          continue;
        }
        if (cat === '已補貨') {
          // 🔙 回溯清理：先前版本把「補貨解決」跟「已轉睡美人/不續辦」混著標成「已補貨」，
          // 現在如果該編號目前確實是睡美人/不續辦，就一次性補做「產品完結」，退出追蹤。
          const metaRetro = metaMap[clean] || {};
          if (metaRetro.sleep || metaRetro.discontinue) {
            if (idx['出清結案'] >= 0) rowData[idx['出清結案']] = '是';
            if (idx['出清結案日期'] >= 0) rowData[idx['出清結案日期']] = today;
            if (idx['是否結案'] >= 0) rowData[idx['是否結案']] = '是';
            if (idx['結案日期'] >= 0) rowData[idx['結案日期']] = today;
            if (idx['處理狀態'] >= 0) rowData[idx['處理狀態']] = '出清結案';
            if (idx['最新備註'] >= 0) rowData[idx['最新備註']] = '回溯清理：已轉' + (metaRetro.sleep ? '睡美人' : '不續辦') + '，非正常缺貨判定範圍，系統自動排除缺貨公告欄';
            if (idx['最後更新人'] >= 0) rowData[idx['最後更新人']] = '系統';
            if (idx['最後更新時間'] >= 0) rowData[idx['最後更新時間']] = now;
            if (idx['最後系統同步時間'] >= 0) rowData[idx['最後系統同步時間']] = now;
            sheetChanged = true;
            retroClosedSleepCount++;
            if (dbSs && SHORTAGE_HISTORY_SHEET) {
              try {
                appendShortageHistory_(dbSs, {
                  time: now,
                  code: rowData[idx['產品編號']],
                  action: '回溯清理：已轉睡美人/不續辦，自動出清結案',
                  operator: '系統',
                  oldStatus: cat,
                  newStatus: '出清結案',
                  oldManual: '', newManual: '',
                  oldNote: '', newNote: '',
                  summary: '品項已被標記為睡美人或不續辦，不再納入正常缺貨判定，系統回溯清理自動出清結案'
                });
              } catch (histErr) {
                console.error('appendShortageHistory_ 失敗：' + histErr.message);
              }
            }
          }
          continue;
        }
        if (shortageCatValues.indexOf(cat) === -1) continue; // 不是缺貨分類（例如已是「預防性保留」），跳過
        if (stillShortageCodes[clean]) continue; // 仍在缺貨中，不動

        const oldCat = cat;
        const metaForClose = metaMap[clean] || {};
        const isNowSleepOrStop = !!(metaForClose.sleep || metaForClose.discontinue);

        if (isNowSleepOrStop) {
          // 🚀 不是補貨解決，是被改標睡美人/不續辦，比照「產品完結」整筆退出追蹤（出清結案=是）
          if (idx['出清結案'] >= 0) rowData[idx['出清結案']] = '是';
          if (idx['出清結案日期'] >= 0) rowData[idx['出清結案日期']] = today;
          if (idx['是否結案'] >= 0) rowData[idx['是否結案']] = '是';
          if (idx['結案日期'] >= 0) rowData[idx['結案日期']] = today;
          if (idx['處理狀態'] >= 0) rowData[idx['處理狀態']] = '出清結案';
          if (idx['最新備註'] >= 0) rowData[idx['最新備註']] = '已轉' + (metaForClose.sleep ? '睡美人' : '不續辦') + '，非正常缺貨判定範圍，系統自動排除缺貨公告欄';
          if (idx['最後更新人'] >= 0) rowData[idx['最後更新人']] = '系統';
          if (idx['最後更新時間'] >= 0) rowData[idx['最後更新時間']] = now;
          if (idx['最後系統同步時間'] >= 0) rowData[idx['最後系統同步時間']] = now;
          sheetChanged = true;
          autoClosedSleepCount++;

          if (dbSs && SHORTAGE_HISTORY_SHEET) {
            try {
              appendShortageHistory_(dbSs, {
                time: now,
                code: rowData[idx['產品編號']],
                action: '系統自動判定已轉睡美人/不續辦，自動出清結案',
                operator: '系統',
                oldStatus: oldCat,
                newStatus: '出清結案',
                oldManual: '', newManual: '',
                oldNote: '', newNote: '',
                summary: '品項已被標記為睡美人或不續辦，不再納入正常缺貨判定，系統自動出清結案，缺貨公告欄不再顯示'
              });
            } catch (histErr) {
              console.error('appendShortageHistory_ 失敗：' + histErr.message);
            }
          }
          continue;
        }

        rowData[idx['缺貨分類']] = '已補貨';
        if (idx['最後系統同步時間'] >= 0) rowData[idx['最後系統同步時間']] = now;
        sheetChanged = true;
        revivedCount++;

        if (dbSs && SHORTAGE_HISTORY_SHEET) {
          try {
            appendShortageHistory_(dbSs, {
              time: now,
              code: rowData[idx['產品編號']],
              action: '系統自動判定已補貨',
              operator: '系統',
              oldStatus: oldCat,
              newStatus: '已補貨',
              oldManual: '', newManual: '',
              oldNote: '', newNote: '',
              summary: '可用庫存已回到安全水位以上，不再列入缺貨清單；如已無需追蹤請按「產品完結」'
            });
          } catch (histErr) {
            console.error('appendShortageHistory_ 失敗：' + histErr.message);
          }
        }
      }
      console.log('復原掃描：新轉已補貨 ' + revivedCount + ' 筆／自動轉睡美人不續辦出清結案 ' + autoClosedSleepCount + ' 筆／回溯清理已補貨中的睡美人不續辦 ' + retroClosedSleepCount + ' 筆／舊已復原改名已補貨 ' + migratedCount + ' 筆／trackRows總列數 ' + (trackRows.length - 1) + '／缺貨分類欄位idx ' + idx['缺貨分類']);
    }

    // level 4「預防性保留」也寫進缺貨進榜追蹤，讓信 B 可判斷新進榜
    (alertsRes.alerts || []).filter(a => a.btnLevel === 4).forEach(a => {
      const clean = normalizeSku_(a.code);
      const meta = metaMap[clean] || {};
      const existingInfo = existing[clean];

      if (existingInfo) {
        // 已有列：只有目前分類「不是」預防性保留時才更新（避免每次跑都重設入榜日期）
        const rowData = existingInfo.data;
        const curCat = idx['缺貨分類'] >= 0 ? String(rowData[idx['缺貨分類']] || '').trim() : '';
        if (idx['出清結案'] >= 0 && String(rowData[idx['出清結案']] || '').trim()) return; // 已人工結案，跳過
        if (curCat === '預防性保留') return; // 已經是，不動
        if (idx['缺貨分類'] >= 0) rowData[idx['缺貨分類']] = '預防性保留';
        if (idx['入榜日期'] >= 0) rowData[idx['入榜日期']] = today;
        if (idx['最後系統同步時間'] >= 0) rowData[idx['最後系統同步時間']] = now;
        if (idx['可用庫存'] >= 0) rowData[idx['可用庫存']] = a.avail;
        if (idx['保留量'] >= 0) rowData[idx['保留量']] = a.reserved;
        sheetChanged = true;
        return;
      }

      const rowData = new Array(headers.length).fill('');
      if (idx['廠牌'] >= 0) rowData[idx['廠牌']] = meta.brand || '';
      if (idx['產品編號'] >= 0) rowData[idx['產品編號']] = a.code;
      if (idx['系列名稱'] >= 0) rowData[idx['系列名稱']] = a.series || meta.name || '';
      if (idx['缺貨分類'] >= 0) rowData[idx['缺貨分類']] = '預防性保留';
      if (idx['入榜日期'] >= 0) rowData[idx['入榜日期']] = today;
      if (idx['最後系統同步時間'] >= 0) rowData[idx['最後系統同步時間']] = now;
      if (idx['可用庫存'] >= 0) rowData[idx['可用庫存']] = a.avail;
      if (idx['保留量'] >= 0) rowData[idx['保留量']] = a.reserved;
      trackRows.push(rowData);
      existing[clean] = { row: trackRows.length, data: rowData };
      sheetChanged = true;
    });

    if (sheetChanged) {
      trackSh.getRange(1, 1, trackRows.length, headers.length).setValues(trackRows);
    }

    const result = {
      success: true,
      items: items,
      alerts: alertsRes.alerts || [],
      over50Codes: alertsRes.over50Codes || [],
      lastUpdated: now
    };
    putCachedJson_(shortageBoardCacheKey_(br), result, 300);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function closeShortageProduct_(payload) {
  try {
    const clean = normalizeSku_(payload && payload.code);
    if (!clean) return { success: false, error: '缺少產品編號' };
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const sh = ensureSheetHeaders_(dbSs, SHORTAGE_TRACKING_SHEET, SHORTAGE_TRACKING_HEADERS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const idx = headerIndexMap_(headers);
    const row = findProductRow_(sh, idx['產品編號'], clean);
    if (row < 0) return { success: false, error: '缺貨進榜追蹤找不到產品：' + clean };
    const before = rowToObject_(headers, sh.getRange(row, 1, 1, headers.length).getValues()[0]);
    const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    if (idx['出清結案'] >= 0) sh.getRange(row, idx['出清結案'] + 1).setValue('是');
    if (idx['出清結案日期'] >= 0) sh.getRange(row, idx['出清結案日期'] + 1).setValue(today);
    if (idx['是否結案'] >= 0) sh.getRange(row, idx['是否結案'] + 1).setValue('是');
    if (idx['結案日期'] >= 0) sh.getRange(row, idx['結案日期'] + 1).setValue(today);
    if (idx['處理狀態'] >= 0) sh.getRange(row, idx['處理狀態'] + 1).setValue('出清結案');
    if (idx['最新備註'] >= 0) sh.getRange(row, idx['最新備註'] + 1).setValue(payload.note || '產品已出清結案，缺貨公告欄不再顯示');
    if (idx['最後更新人'] >= 0) sh.getRange(row, idx['最後更新人'] + 1).setValue(payload.operator || 'web');
    if (idx['最後更新時間'] >= 0) sh.getRange(row, idx['最後更新時間'] + 1).setValue(now);
    appendShortageHistory_(dbSs, {
      code: before['產品編號'] || clean,
      action: '產品完結',
      operator: payload.operator || 'web',
      oldStatus: before['處理狀態'],
      newStatus: '出清結案',
      oldManual: before['人工建議補貨'],
      newManual: before['人工建議補貨'],
      oldNote: before['最新備註'],
      newNote: payload.note || '產品已出清結案，缺貨公告欄不再顯示',
      summary: '出清結案，從缺貨公告欄排除'
    });
    clearShortageCaches_();
    return { success: true, date: today };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateShortageTracking_(payload) {
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const sh = ensureSheetHeaders_(dbSs, SHORTAGE_TRACKING_SHEET, SHORTAGE_TRACKING_HEADERS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const idx = headerIndexMap_(headers);
    const clean = normalizeSku_(payload && payload.code);
    if (!clean) return { success: false, error: '缺少產品編號' };
    const row = findProductRow_(sh, idx['產品編號'], clean);
    if (row < 0) return { success: false, error: '缺貨進榜追蹤找不到產品：' + clean };
    const beforeRow = sh.getRange(row, 1, 1, headers.length).getValues()[0];
    const before = rowToObject_(headers, beforeRow);

    const allowed = [
      '人工建議補貨', '人工補貨板數', '人工補貨坪數', '人工補貨片數',
      '處理狀態', '預計日期', '國外生產日', '預定到貨日', '實際訂貨量', '負責人',
      '最新備註', '人工調整安全水位', '安全水位備註'
    ];
    allowed.forEach(h => {
      if (idx[h] >= 0 && Object.prototype.hasOwnProperty.call(payload, h)) {
        sh.getRange(row, idx[h] + 1).setValue(payload[h]);
      }
    });
    if (idx['最後更新人'] >= 0) sh.getRange(row, idx['最後更新人'] + 1).setValue(payload.operator || 'web');
    if (idx['最後更新時間'] >= 0) sh.getRange(row, idx['最後更新時間'] + 1).setValue(Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'));

    if (payload['預定到貨日']) {
      syncIncomingShipment_(clean, payload['預定到貨日'], payload['人工補貨片數'] || '');
    }
    const afterRow = sh.getRange(row, 1, 1, headers.length).getValues()[0];
    const after = rowToObject_(headers, afterRow);
    // 只有「有意義的欄位真的改變」才寫歷程，避免每次按儲存都塞一筆重複記錄
    const historyFields = ['處理狀態', '人工建議補貨', '人工補貨板數', '人工補貨坪數', '人工補貨片數',
                           '預定到貨日', '國外生產日', '最新備註', '人工調整安全水位'];
    const hasRealChange = historyFields.some(f => String(before[f] || '').trim() !== String(after[f] || '').trim());
    if (hasRealChange) {
      appendShortageHistory_(dbSs, {
        code: after['產品編號'] || clean,
        action: payload.action || '更新追蹤狀態',
        operator: payload.operator || 'web',
        oldStatus: before['處理狀態'],
        newStatus: after['處理狀態'],
        oldManual: before['人工建議補貨'],
        newManual: after['人工建議補貨'],
        oldNote: before['最新備註'],
        newNote: after['最新備註'],
        summary: '人工板數 ' + (after['人工補貨板數'] || '-') + '，坪數 ' + (after['人工補貨坪數'] || '-') + '，片數 ' + (after['人工補貨片數'] || '-')
      });
    }
    clearShortageCaches_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 手動納入追蹤：把「系統未自動判定缺貨」但使用者想盯的品項，建立進「缺貨進榜追蹤」表。
 * （level 4 預防性保留與 level 99 觀察品項會由系統自動進表，此 API 用於補足人力判斷的例外品項。）
 */
function addShortageTrackingManual_(payload) {
  try {
    const clean = normalizeSku_(payload && payload.code);
    if (!clean) return { success: false, error: '缺少產品編號' };
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const sh = ensureSheetHeaders_(dbSs, SHORTAGE_TRACKING_SHEET, SHORTAGE_TRACKING_HEADERS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const idx = headerIndexMap_(headers);
    const existingRow = findProductRow_(sh, idx['產品編號'], clean);
    if (existingRow >= 0) return { success: true, already: true, message: '產品已在追蹤表中：' + clean };

    const meta = getPriceMetaMap_()[clean] || {};
    const wr = getWarRoomMapFast_(dbSs)[clean] || {};
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');

    const rowData = new Array(headers.length).fill('');
    const values = {
      '廠牌': meta.brand || '',
      '產品編號': clean,
      '系列名稱': meta.name || meta.series || '',
      '缺貨分類': '人工追蹤',
      '入榜日期': today,
      '最後系統同步時間': now,
      '去峰值月均銷': wr.avgPeakShaved || '',
      '年銷量': wr.annualSales || '',
      '系統建議安全水位': wr.suggestedSafe || '',
      '處理狀態': '等候開狀',
      '負責人': payload.operator || 'web'
    };
    Object.keys(values).forEach(h => {
      if (idx[h] >= 0) rowData[idx[h]] = values[h];
    });
    sh.appendRow(rowData);
    clearShortageCaches_();
    return { success: true, already: false, message: '已將 ' + clean + ' 納入缺貨進榜追蹤（分類：人工追蹤）' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 將人工追蹤填寫的預定到貨日/數量同步寫回「保留單」分頁中該產品編號所有列的
 * 入倉日期1/數量1、入倉日期2/數量2。
 * 每一列各自判斷：若某一組日期已等於新日期就更新數量；否則找空格填入；
 * 兩組都滿且都不同就覆寫第1組。
 */
function syncIncomingShipment_(clean, dateStr, qtyPieces) {
  const sh = getSheet_();
  if (!sh) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
  const codeIdx = rsvFindHeaderIndex_(headers, ['編號', '產品編號']);
  const date1Idx = rsvFindHeaderIndex_(headers, ['入倉日期1', '入庫日期1']);
  const qty1Idx = rsvFindHeaderIndex_(headers, ['數量1', '入庫數量1']);
  const date2Idx = rsvFindHeaderIndex_(headers, ['入倉日期2', '入庫日期2']);
  const qty2Idx = rsvFindHeaderIndex_(headers, ['數量2', '入庫數量2']);
  if (codeIdx < 0 || date1Idx < 0 || qty1Idx < 0 || date2Idx < 0 || qty2Idx < 0) return;

  const toDateStr_ = (val) => val instanceof Date ? Utilities.formatDate(val, 'Asia/Taipei', 'yyyy/MM/dd') : String(val || '').trim();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const rows = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();

  rows.forEach((rowData, i) => {
    const code = normalizeSku_(rowData[codeIdx]);
    if (code !== clean) return;
    const sheetRow = i + 2;
    const date1 = toDateStr_(rowData[date1Idx]);
    const date2 = toDateStr_(rowData[date2Idx]);

    let dateCol, qtyCol;
    if (!date1 || date1 === dateStr) {
      dateCol = date1Idx; qtyCol = qty1Idx;
    } else if (!date2 || date2 === dateStr) {
      dateCol = date2Idx; qtyCol = qty2Idx;
    } else {
      dateCol = date1Idx; qtyCol = qty1Idx;
    }
    sh.getRange(sheetRow, dateCol + 1).setValue(dateStr);
    if (qtyPieces) sh.getRange(sheetRow, qtyCol + 1).setValue(qtyPieces);
  });
}

function confirmDiscontinueProduct_(payload) {
  try {
    const br = getBranch_();
    const clean = normalizeSku_(payload && payload.code);
    if (!clean) return { success: false, error: '缺少產品編號' };
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    const priceHeaders = priceSh.getRange(1, 1, 1, priceSh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const codeIdx = rsvFindHeaderIndex_(priceHeaders, ['編號', '產品編號']);
    const stopIdx = rsvFindHeaderIndex_(priceHeaders, ['不續辦']);
    if (codeIdx < 0 || stopIdx < 0) return { success: false, error: '編號價目表缺少 編號 或 不續辦 欄位' };
    const row = findProductRow_(priceSh, codeIdx, clean);
    if (row < 0) return { success: false, error: '編號價目表找不到產品：' + clean };
    const date = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    priceSh.getRange(row, stopIdx + 1).setValue(date);
    applyDiscontinuedPriceRowStyle_(priceSh, row, stopIdx);

    updateShortageTracking_({
      code: clean,
      '處理狀態': '不續辦',
      '最新備註': payload.note || '已列入不續辦並寫回主檔',
      operator: payload.operator || 'web',
      action: '列入不續辦'
    });
    const trackSh = ensureSheetHeaders_(dbSs, SHORTAGE_TRACKING_SHEET, SHORTAGE_TRACKING_HEADERS);
    const h = trackSh.getRange(1, 1, 1, trackSh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const tIdx = headerIndexMap_(h);
    const tRow = findProductRow_(trackSh, tIdx['產品編號'], clean);
    if (tRow > 0 && tIdx['不續辦決議日'] >= 0) trackSh.getRange(tRow, tIdx['不續辦決議日'] + 1).setValue(date);
    
    // 發送 Telegram 不續辦通知
    try {
      var tgMsg = '🚫 【產品決議不續辦】\n' +
                  '產品編號：' + clean + '\n' +
                  '決議日期：' + date + '\n' +
                  '最新備註：' + (payload.note || '已列入不續辦並寫回主檔') + '\n' +
                  '執行人：' + (payload.operator || 'web');
      pushTelegram(tgMsg, br);
    } catch(tgErr) {
      console.error('發送 TG 不續辦通知失敗: ' + tgErr.message);
    }

    clearShortageCaches_();
    return { success: true, date: date };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function confirmSafeStock_(payload) {
  try {
    const br = getBranch_();
    const clean = normalizeSku_(payload && payload.code);
    const safePing = parseFloat(payload && payload.safePing);
    if (!clean) return { success: false, error: '缺少產品編號' };
    if (isNaN(safePing) || safePing < 0) return { success: false, error: '安全水位必須是有效數字' };
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    const priceHeaders = priceSh.getRange(1, 1, 1, priceSh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const codeIdx = rsvFindHeaderIndex_(priceHeaders, ['編號', '產品編號']);
    const safeIdx = rsvFindHeaderIndex_(priceHeaders, ['人工指定安全坪數']);
    if (codeIdx < 0 || safeIdx < 0) return { success: false, error: '編號價目表缺少 編號 或 人工指定安全坪數 欄位' };
    const row = findProductRow_(priceSh, codeIdx, clean);
    if (row < 0) return { success: false, error: '編號價目表找不到產品：' + clean };
    priceSh.getRange(row, safeIdx + 1).setValue(safePing);
    updateShortageTracking_({
      code: clean,
      '人工調整安全水位': safePing,
      '安全水位備註': payload.note || '',
      operator: payload.operator || 'web',
      action: '確認回寫安全水位'
    });
    const trackSh = ensureSheetHeaders_(dbSs, SHORTAGE_TRACKING_SHEET, SHORTAGE_TRACKING_HEADERS);
    const h = trackSh.getRange(1, 1, 1, trackSh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const tIdx = headerIndexMap_(h);
    const tRow = findProductRow_(trackSh, tIdx['產品編號'], clean);
    if (tRow > 0 && tIdx['是否已回寫主檔'] >= 0) trackSh.getRange(tRow, tIdx['是否已回寫主檔'] + 1).setValue('是');
    
    // 發送 Telegram 水位調整通知
    try {
      var tgMsg = '🔧 【安全水位調整】\n' +
                  '產品編號：' + clean + '\n' +
                  '安全水位已調整為：' + safePing + ' 坪\n' +
                  '調整備註：' + (payload.note || '未填寫') + '\n' +
                  '執行人：' + (payload.operator || 'web');
      pushTelegram(tgMsg, br);
    } catch(tgErr) {
      console.error('發送 TG 水位調整通知失敗: ' + tgErr.message);
    }

    clearShortageCaches_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function generateRestockOrderList_() {
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const trackSh = ensureSheetHeaders_(dbSs, SHORTAGE_TRACKING_SHEET, SHORTAGE_TRACKING_HEADERS);
    const headers = trackSh.getRange(1, 1, 1, trackSh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const idx = headerIndexMap_(headers);
    const rows = trackSh.getLastRow() >= 2
      ? trackSh.getRange(2, 1, trackSh.getLastRow() - 1, headers.length).getValues()
      : [];
    const activeStatuses = ['待確認', '等候開狀', '國外缺貨', '生產中', '排船中', '海上飄'];
    const out = [];

    rows.forEach(row => {
      const obj = rowToObject_(headers, row);
      const status = String(obj['處理狀態'] || '').trim();
      if (activeStatuses.indexOf(status) === -1) return;
      // 人工存過才用人工填的數字；沒人存過一律用系統這一刻的建議板數，避免舊的自動數字流進訂貨清單
      const touchedBy = String(obj['最後更新人'] || '').trim();
      const touched = !!String(obj['最後更新時間'] || '').trim() && touchedBy !== '系統';
      const sysCases = parseFloat(obj['建議板數']) || 0;
      const palletPingVal = parseFloat(obj['每板坪數']) || 0;
      const cases = touched ? (parseFloat(obj['人工補貨板數']) || sysCases) : sysCases;
      const ping = touched ? (parseFloat(obj['人工補貨坪數']) || 0) : (sysCases > 0 && palletPingVal > 0 ? Math.floor(sysCases * palletPingVal) : 0);
      const pieces = touched ? (parseFloat(obj['人工補貨片數']) || 0) : 0;
      if (cases <= 0 && ping <= 0 && pieces <= 0) return;
      out.push([
        obj['廠牌'] || '未分類',
        obj['產品編號'] || '',
        obj['系列名稱'] || '',
        cases || '',
        ping || '',
        pieces || '',
        status,
        obj['預定到貨日'] || obj['預計日期'] || '',
        obj['負責人'] || '',
        obj['最新備註'] || ''
      ]);
    });

    out.sort((a, b) => {
      const brand = String(a[0]).localeCompare(String(b[0]));
      if (brand !== 0) return brand;
      return String(a[1]).localeCompare(String(b[1]));
    });

    const orderSh = ensureSheetHeaders_(dbSs, RESTOCK_ORDER_SHEET, RESTOCK_ORDER_HEADERS);
    orderSh.clearContents();
    orderSh.getRange(1, 1, 1, RESTOCK_ORDER_HEADERS.length).setValues([RESTOCK_ORDER_HEADERS]);
    if (out.length) {
      orderSh.getRange(2, 1, out.length, RESTOCK_ORDER_HEADERS.length).setValues(out);
    }
    orderSh.autoResizeColumns(1, RESTOCK_ORDER_HEADERS.length);
    return { success: true, count: out.length, sheetName: RESTOCK_ORDER_SHEET };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getThumbnailLink_(url) {
  if (!url) return "";
  const match = url.match(/[-\w]{25,35}/);
  if (match) return "https://drive.google.com/thumbnail?id=" + match[0] + "&sz=w200";
  return url;
}


function rsvFindHeaderIndex_(headers, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const idx = headers.indexOf(aliases[i]);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAnyDate_(val) {
  if (!val) return null;
  if (val instanceof Date) {
    let y = val.getFullYear();
    if (y < 1000) y += 1911;
    return new Date(y, val.getMonth(), val.getDate());
  }
  
  var s = String(val).trim();
  if (!s) return null;
  
  var mainPart = s.split('.')[0];
  
  var compactMatch = mainPart.match(/^(\d{3,4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    var year = parseInt(compactMatch[1], 10);
    if (year < 1000) year += 1911;
    return new Date(year, parseInt(compactMatch[2], 10) - 1, parseInt(compactMatch[3], 10));
  }
  
  var parts = s.split(/[\/\-\.]/);
  if (parts.length === 3) {
    var yr = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10);
    var da = parseInt(parts[2], 10);
    var realYr = yr < 1900 ? yr + 1911 : yr;
    var d = new Date(realYr, mo - 1, da);
    if (!isNaN(d.getTime())) return d;
  }
  
  var d2 = new Date(s);
  if (!isNaN(d2.getTime())) {
    var y2 = d2.getFullYear();
    if (y2 < 1000) y2 += 1911;
    return new Date(y2, d2.getMonth(), d2.getDate());
  }
  
  return null;
}

/**
 * 戰情室分析引擎：自動分析歷史銷售數據，對產品進行分類與安全存量建議，寫入「產品戰情分類」
 */
function runProductAnalysis_() {
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    
    // 1. 讀取「編號價目表」
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    if (!priceSh) return { success: false, error: '找不到價目表' };
    const priceRows = priceSh.getDataRange().getValues();
    const priceHeaders = priceRows[0];
    
    const pIdx = {
      code: rsvFindHeaderIndex_(priceHeaders, ['編號', '產品編號']),
      name: rsvFindHeaderIndex_(priceHeaders, ['中文系列', '系列名稱', '名稱']),
      size: rsvFindHeaderIndex_(priceHeaders, ['尺寸(cm)', '尺寸']),
      perPing: rsvFindHeaderIndex_(priceHeaders, ['片/坪', '每坪片數']),
      isStop: rsvFindHeaderIndex_(priceHeaders, ['不續辦', '狀態', '不續', '停止販售', '停辦', '不續辦標記']),
      isSleep: rsvFindHeaderIndex_(priceHeaders, ['睡美人', '冷凍', '休眠', '睡美人標記']),
      latestDate: rsvFindHeaderIndex_(priceHeaders, ['最新進貨日', '最近進貨日']),
      latestQty: rsvFindHeaderIndex_(priceHeaders, ['最新片數', '最近片數', '最新數量', '最新坪數']),
      prev1Date: rsvFindHeaderIndex_(priceHeaders, ['前1進貨', '前1進貨日', '前1日期', '入倉日期1']),
      prev1Qty: rsvFindHeaderIndex_(priceHeaders, ['前1數量', '數量1', '入庫數量1']),
      prev2Date: rsvFindHeaderIndex_(priceHeaders, ['前2進貨', '前2進貨日', '前2日期', '入倉日期2']),
      prev2Qty: rsvFindHeaderIndex_(priceHeaders, ['前2數量', '數量2', '入庫數量2']),
      prev3Date: rsvFindHeaderIndex_(priceHeaders, ['前3進貨', '前3進貨日', '前3日期', '入倉日期3']),
      prev3Qty: rsvFindHeaderIndex_(priceHeaders, ['前3數量', '數量3', '入庫數量3'])
    };
    
    const metaMap = {};
    for (let i = 1; i < priceRows.length; i++) {
      const code = String(priceRows[i][pIdx.code] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (!code) continue;
      
      const perPing = parseFloat(priceRows[i][pIdx.perPing]) || 36;
      
      const rawBatches = [];
      const pushBatch_ = (label, dateVal, qtyVal) => {
        const dateObj = parseAnyDate_(dateVal);
        const qtyPieces = parseFloat(qtyVal) || 0;
        if (!dateObj || qtyPieces <= 0) return;
        rawBatches.push({
          label: label,
          date: dateObj,
          dateStr: Utilities.formatDate(dateObj, 'Asia/Taipei', 'yyyy/MM/dd'),
          qtyPieces: qtyPieces,
          qtyPing: Math.round((qtyPieces / perPing) * 10) / 10
        });
      };
      
      pushBatch_('最新', pIdx.latestDate >= 0 ? priceRows[i][pIdx.latestDate] : '', pIdx.latestQty >= 0 ? priceRows[i][pIdx.latestQty] : '');
      pushBatch_('前1', pIdx.prev1Date >= 0 ? priceRows[i][pIdx.prev1Date] : '', pIdx.prev1Qty >= 0 ? priceRows[i][pIdx.prev1Qty] : '');
      pushBatch_('前2', pIdx.prev2Date >= 0 ? priceRows[i][pIdx.prev2Date] : '', pIdx.prev2Qty >= 0 ? priceRows[i][pIdx.prev2Qty] : '');
      pushBatch_('前3', pIdx.prev3Date >= 0 ? priceRows[i][pIdx.prev3Date] : '', pIdx.prev3Qty >= 0 ? priceRows[i][pIdx.prev3Qty] : '');
      
      rawBatches.sort((a, b) => b.date - a.date);
      const latest = rawBatches[0] || null;

      const stopVal = pIdx.isStop >= 0 ? String(priceRows[i][pIdx.isStop] || '').trim() : '';
      const sleepVal = pIdx.isSleep >= 0 ? String(priceRows[i][pIdx.isSleep] || '').trim() : '';

      metaMap[code] = {
        rawCode: String(priceRows[i][pIdx.code] || '').trim(),
        name: String(priceRows[i][pIdx.name] || '').trim() || '未命名',
        size: pIdx.size >= 0 ? String(priceRows[i][pIdx.size] || '').trim() : '',
        perPing: perPing,
        isStop: !!stopVal && stopVal !== '0' && stopVal.toLowerCase() !== 'false',
        isSleep: !!sleepVal && sleepVal !== '0' && sleepVal.toLowerCase() !== 'false',
        importDate: latest ? latest.date : null,
        importQtyPing: latest ? latest.qtyPing : 0,
        rawBatches: rawBatches,
        salesSinceImport: 0
      };
    }
    
    // 2. 讀取「經銷銷售報表」銷貨明細
    const salesSh = dbSs.getSheetByName('經銷銷售報表');
    if (!salesSh) return { success: false, error: '找不到經銷銷售報表' };
    const salesRows = salesSh.getDataRange().getValues();
    const salesHeaders = salesRows[0];
    
    const slIdx = {
      code: rsvFindHeaderIndex_(salesHeaders, ['產品編號', '編號']),
      qty: rsvFindHeaderIndex_(salesHeaders, ['數量', '銷貨數量']),
      date: rsvFindHeaderIndex_(salesHeaders, ['單據日期', '銷貨日期', '日期']),
      type: rsvFindHeaderIndex_(salesHeaders, ['類別'])
    };
    
    // 收集所有交易，按 SKU 及其月份歸檔
    const monthlySales = {}; // { SKU: { YYYY-MM: quantityInPing } }
    const monthSet = new Set();
    const monthlyTotalByMonth = {}; // 用於統計月度淡旺季 (1-12) -> total sales
    for (let m = 1; m <= 12; m++) monthlyTotalByMonth[m] = {}; // { monthNum: { SKU: totalSales } }
    
    const latestSaleDates = {}; // { SKU: Date }
    
    for (let i = 1; i < salesRows.length; i++) {
      const typeStr = slIdx.type !== -1 ? String(salesRows[i][slIdx.type]).trim() : '';
      if (typeStr === '退') continue; // 排除退貨
      
      const code = String(salesRows[i][slIdx.code] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (!code || !metaMap[code]) continue; // 排除無效產品或不存於價目表的產品
      
      let rawDate = salesRows[i][slIdx.date];
      let date = parseAnyDate_(rawDate);
      if (!date || isNaN(date.getTime())) continue;
      
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const monthKey = yyyy + '-' + mm;
      const monthNum = date.getMonth() + 1; // 1-12
      
      monthSet.add(monthKey);
      
      const qtyPieces = parseFloat(salesRows[i][slIdx.qty]) || 0;
      const perPing = metaMap[code].perPing || 36;
      const qtyPing = qtyPieces / perPing;
      
      if (!monthlySales[code]) monthlySales[code] = {};
      monthlySales[code][monthKey] = (monthlySales[code][monthKey] || 0) + qtyPing;
      
      if (!monthlyTotalByMonth[monthNum][code]) monthlyTotalByMonth[monthNum][code] = 0;
      monthlyTotalByMonth[monthNum][code] += qtyPing;
      
      // 記錄最後銷貨日
      if (!latestSaleDates[code] || date > latestSaleDates[code]) {
        latestSaleDates[code] = date;
      }
      
      const meta = metaMap[code];
      if (meta) {
        if (!meta.txs) meta.txs = [];
        meta.txs.push({ date: date, qtyPing: qtyPing });
        if (meta.importDate && date >= meta.importDate) {
          meta.salesSinceImport += qtyPing;
        }
      }
    }
    
    // 排序所有包含交易的月份
    const sortedMonths = Array.from(monthSet).sort();
    if (sortedMonths.length === 0) return { success: false, error: '銷售報表中無交易記錄' };
    
    // 我們分析的總月份數
    const totalMonthCount = sortedMonths.length;
    const recentMonths = sortedMonths.slice(-36);
    
    // 3. 開始計算各個 SKU 的分類與安全庫存
    const analysisResults = [];
    const now = new Date();
    
    for (const code in metaMap) {
      const meta = metaMap[code];
      
      // 獲取該 SKU 在各月份的銷量陣列
      const salesArr = [];
      let totalSales = 0;
      let peakSeasonSales = 0;
      let peakSeasonMonths = 0;
      let offSeasonSales = 0;
      let offSeasonMonths = 0;
      
      for (const mKey of sortedMonths) {
        const qty = (monthlySales[code] && monthlySales[code][mKey]) || 0;
        salesArr.push(qty);
        totalSales += qty;
        
        // 判斷淡旺季 (8-1月為旺季，2-7月為淡季)
        const monthNum = parseInt(mKey.split('-')[1]);
        if (monthNum >= 8 || monthNum === 1) {
          peakSeasonSales += qty;
          peakSeasonMonths++;
        } else {
          offSeasonSales += qty;
          offSeasonMonths++;
        }
      }
      
      // 計算常規均銷
      const avgMonthly = totalSales / totalMonthCount;

      // 去峰值月均銷量：近 24 個月為範圍，用「中位數 × 3」當異常大案門檻（不被單筆爆單拉高基準）
      // 護欄：最多剔 25% 月份；剔後至少留 6 個月，否則不剔；剔完若均值變 0 則回退常規均銷
      const window24 = sortedMonths.slice(-24);
      let avgPeakShaved = avgMonthly;
      {
        const windowSales = window24.map(mKey => (monthlySales[code] && monthlySales[code][mKey]) || 0);
        if (windowSales.length > 0) {
          const median_ = (arr) => {
            if (!arr.length) return 0;
            const s = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(s.length / 2);
            return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
          };
          let baseline = median_(windowSales);
          if (baseline === 0) baseline = median_(windowSales.filter(v => v > 0));
          const threshold = baseline * 3;
          const maxRemovable = Math.floor(windowSales.length * 0.25);
          let kept = windowSales;
          if (threshold > 0) {
            const normal = windowSales.filter(v => v <= threshold);
            const removedCount = windowSales.length - normal.length;
            if (removedCount > 0 && removedCount <= maxRemovable && normal.length >= 6) {
              kept = normal;
            }
          }
          const sumKept = kept.reduce((s, v) => s + v, 0);
          const avgKept = kept.length > 0 ? sumKept / kept.length : 0;
          avgPeakShaved = avgKept > 0 ? avgKept : avgMonthly;
        }
      }
      
      // 計算淡旺季月均銷量
      const avgPeakSeason = peakSeasonMonths > 0 ? (peakSeasonSales / peakSeasonMonths) : 0;
      const avgOffSeason = offSeasonMonths > 0 ? (offSeasonSales / offSeasonMonths) : 0;
      
      // 找出銷售峰值月份 (1-12月中銷量累積最大的月份)
      let peakMonthNum = 8; // 預設 8 月
      let maxMonthSales = -1;
      for (let m = 1; m <= 12; m++) {
        const mSales = monthlyTotalByMonth[m][code] || 0;
        if (mSales > maxMonthSales) {
          maxMonthSales = mSales;
          peakMonthNum = m;
        }
      }
      
      // 大磚識別（面積 ≥ 10,000 平方公分，涵蓋 75x150、90x180、120x120 等）
      const isLarge = isLargeTile_(meta.size);

      // 近3個月／近6個月均銷（用同一份近24月視窗資料，取最後3/6個月，不做去峰值處理）
      const avg3M = (function() {
        const recent3 = window24.slice(-3);
        if (!recent3.length) return 0;
        const sum3 = recent3.reduce((s, mk) => s + (((monthlySales[code] && monthlySales[code][mk]) || 0)), 0);
        return Math.round((sum3 / recent3.length) * 10) / 10;
      })();
      const avg6M = (function() {
        const recent6 = window24.slice(-6);
        if (!recent6.length) return 0;
        const sum6 = recent6.reduce((s, mk) => s + (((monthlySales[code] && monthlySales[code][mk]) || 0)), 0);
        return Math.round((sum6 / recent6.length) * 10) / 10;
      })();

      // 有效月均銷：去峰值均銷（近24月）／近6月／近3月，三者中取「有數字且大於0」的最小值
      // 避免近期真的在下滑卻還照舊高標準訂貨；若三者皆0則退回去峰值均銷（可能是0）
      const candidatesForMin = [avgPeakShaved, avg6M, avg3M].filter(v => v > 0);
      const effectiveAvgSales = candidatesForMin.length ? Math.min.apply(null, candidatesForMin) : avgPeakShaved;

      // 產品戰情分類
      // A+: >= 25坪; A: 10~25; B: 3~10; C: <3
      let classification = 'C';
      if (avgMonthly >= 25) {
        classification = 'A+';
      } else if (avgMonthly >= 10) {
        classification = 'A';
      } else if (avgMonthly >= 3) {
        classification = 'B';
      }

      // 系統建議安全存量 (警戒水位) (坪)
      const LARGE_TILE_SAFE_FLOOR = 30; // 大磚保底量：至少扛住一個案子的用量
      let suggestedSafe = 0;
      let isLargeFloorApplied = false;
      if (isLarge) {
        // 大磚至少應對一場案量，且考慮月銷量
        const calcSafe = Math.ceil(2.5 * effectiveAvgSales);
        suggestedSafe = Math.max(LARGE_TILE_SAFE_FLOOR, calcSafe);
        isLargeFloorApplied = suggestedSafe === LARGE_TILE_SAFE_FLOOR && calcSafe < LARGE_TILE_SAFE_FLOOR;
      } else {
        // 常規磚依級別推算安全期
        if (classification === 'A+') suggestedSafe = Math.ceil(3.0 * effectiveAvgSales);
        else if (classification === 'A') suggestedSafe = Math.ceil(2.5 * effectiveAvgSales);
        else if (classification === 'B') suggestedSafe = Math.ceil(2.0 * effectiveAvgSales);
        else suggestedSafe = Math.ceil(1.5 * effectiveAvgSales);
      }

      // 系統建議補貨目標 (坪) 5 / 4 / 3 / 0
      let suggestedTarget = 0;
      if (classification === 'A+') suggestedTarget = Math.ceil(5.0 * effectiveAvgSales);
      else if (classification === 'A') suggestedTarget = Math.ceil(4.0 * effectiveAvgSales);
      else if (classification === 'B') suggestedTarget = Math.ceil(3.0 * effectiveAvgSales);
      else suggestedTarget = 0; // C 類為 0 (接到保留才補)

      if (isLarge && suggestedTarget > 0) {
        suggestedTarget = Math.max(suggestedSafe, suggestedTarget);
      }
      
      // 進貨批次銷售佔比計算
      let latestBatchSalesRatio = 0;
      if (meta.importQtyPing > 0) {
        latestBatchSalesRatio = (meta.salesSinceImport / meta.importQtyPing) * 100;
        if (latestBatchSalesRatio > 100) latestBatchSalesRatio = 100;
      }
      
      // 滯銷天數 (最後銷貨日至今)
      const lastSaleDate = latestSaleDates[code];
      let daysSinceLastSale = -1;
      if (lastSaleDate) {
        daysSinceLastSale = Math.floor((now - lastSaleDate) / 86400000);
      }
      
      // Calculate FIFO batches tracking
      const rawBList = meta.rawBatches || [];
      const batches = rawBList.map(b => ({
        label: b.label,
        date: b.date,
        dateStr: b.dateStr,
        importQty: b.qtyPing,
        soldQty: 0,
        remainQty: b.qtyPing,
        status: '正常'
      })).sort((a, b) => a.date - b.date); // FIFO oldest first

      const txs = meta.txs || [];
      txs.sort((a, b) => a.date - b.date);
      txs.forEach(tx => {
        let remainingSale = tx.qtyPing;
        for (let i = 0; i < batches.length && remainingSale > 0; i++) {
          if (tx.date < batches[i].date) continue;
          const use = Math.min(remainingSale, batches[i].remainQty);
          batches[i].remainQty -= use;
          batches[i].soldQty += use;
          remainingSale -= use;
        }
      });

      batches.forEach(b => {
        const diffTime = now - b.date;
        let months = Math.round((diffTime / (1000 * 60 * 60 * 24 * 30)) * 10) / 10;
        if (months < 0.5) months = 0.5;
        b.months = months;
        b.soldQty = Math.round(b.soldQty * 10) / 10;
        b.remainQty = Math.round(b.remainQty * 10) / 10;
        b.pct = b.importQty > 0 ? Math.round((b.soldQty / b.importQty) * 100) : 0;
        if (b.pct > 100) b.pct = 100;
        b.velocity = Math.round((b.soldQty / months) * 10) / 10;
        if (b.pct >= 95) b.status = '完售 ✅';
        else if (months > 12 && b.pct < 50) b.status = '滯銷 🧊';
        else if (months < 3 && b.pct > 80) b.status = '熱銷 🔥';
        else b.status = '正常';
      });
      batches.sort((a, b) => b.date - a.date); // Display newest first

      analysisResults.push({
        code: meta.rawCode,
        cleanedCode: code,
        name: meta.name,
        size: meta.size,
        isLarge: isLarge ? '是' : '否',
        lifecycle: meta.isSleep ? '睡美人' : meta.isStop ? '不續辦' : '正常',
        class: classification,
        totalSales: Math.round(totalSales * 10) / 10,
        avgMonthly: Math.round(avgMonthly * 10) / 10,
        avgPeakShaved: Math.round(avgPeakShaved * 10) / 10,
        avgPeakSeason: Math.round(avgPeakSeason * 10) / 10,
        avgOffSeason: Math.round(avgOffSeason * 10) / 10,
        avg3M: avg3M,
        avg6M: avg6M,
        effectiveAvgSales: Math.round(effectiveAvgSales * 10) / 10,
        isLargeFloorApplied: isLargeFloorApplied ? '是' : '否',
        peakMonth: peakMonthNum + '月',
        suggestedSafe: suggestedSafe,
        suggestedTarget: suggestedTarget,
        importDate: meta.importDate,
        importQtyPing: Math.round(meta.importQtyPing * 10) / 10,
        latestBatchSalesRatio: latestBatchSalesRatio,
        monthlySeries: recentMonths.map(monthKey => [
          monthKey,
          Math.round((((monthlySales[code] && monthlySales[code][monthKey]) || 0)) * 10) / 10
        ]),
        batches: batches,
        lastSaleDate: lastSaleDate,
        daysSinceLastSale: daysSinceLastSale,
        updatedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss')
      });
    }
    
    // 🚀 銷售結構分析（客戶/區域/集中度/毛利率/上架對比）預算：一併算好存進分析表，
    //    讓戰情室 getWarRoomData() 直接讀表，不必每次冷啟動都重掃整張「經銷銷售報表」。
    const insightImportMap = {};
    Object.keys(metaMap).forEach(code => {
      const meta = metaMap[code];
      const b = (meta.rawBatches || []).slice().sort((x, y) => y.date - x.date);
      const latest = b[0];
      if (!latest) return;
      const oneYearAgo2 = new Date();
      oneYearAgo2.setDate(oneYearAgo2.getDate() - 365);
      const iHistory = b.filter(x => x.date >= oneYearAgo2).map(x => ({
        label: x.label, dateMs: x.date.getTime(), dateStr: x.dateStr,
        qtyPieces: x.qtyPieces, qtyPing: x.qtyPing
      }));
      insightImportMap[code] = {
        latestImportDate: latest.dateStr,
        latestImportQty: latest.qtyPing,
        hasRecentImport: iHistory.length > 0,
        history: iHistory,
        lastImportDateStr: latest.dateStr,
        lastImportQtyPing: latest.qtyPing,
        monthsSinceLastImport: Math.floor((new Date() - latest.date) / (86400000 * 30))
      };
    });
    const insightPerPingMap = {};
    Object.keys(metaMap).forEach(code => { insightPerPingMap[code] = metaMap[code].perPing || 36; });
    const insightCostMap = (function() {
      const cm = {};
      const cIdx = rsvFindHeaderIndex_(priceHeaders, ['成本', '單片成本']);
      if (cIdx >= 0) {
        for (let i = 1; i < priceRows.length; i++) {
          const code = String(priceRows[i][pIdx.code] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
          if (code) cm[code] = parseNumeric_(priceRows[i][cIdx]);
        }
      }
      return cm;
    })();
    const insightMapByCode = buildProductInsightMap_(dbSs, insightImportMap, insightPerPingMap, insightCostMap);

    // 依分類優先度（A+ -> A -> B -> C）及產品編號排序
    const priority = { 'A+': 1, 'A': 2, 'B': 3, 'C': 4 };
    analysisResults.sort((a, b) => {
      const pa = priority[a.class] || 99;
      const pb = priority[b.class] || 99;
      if (pa !== pb) return pa - pb;
      return a.code.localeCompare(b.code);
    });
    
    // 4. 寫入或重新覆蓋「產品戰情分類」工作表
    let analysisSh = dbSs.getSheetByName('產品戰情分類');
    if (!analysisSh) {
      analysisSh = dbSs.insertSheet('產品戰情分類');
    }
    analysisSh.clear();
    
    const headers = [
      '產品編號', '產品名稱', '尺寸(cm)', '大磚標記', '產品狀態', '產品戰情分類',
      '累積總銷量(坪)', '常規月均銷(坪)', '去峰值均銷(坪)', '3個月均銷(坪)', '6個月均銷(坪)', '有效月均銷(坪)', '大磚保底套用', '旺季月均銷(坪)', '淡季月均銷(坪)',
      '銷量峰值月份', '系統建議安全坪數', '系統建議補貨目標', '最新進貨日', '最新批次進貨坪數', '最新批次銷售佔比', '最後銷貨日', '滯銷天數', '每月銷量系列', '批次去化明細', '銷售結構分析', '上次更新時間'
    ];
    analysisSh.appendRow(headers);

    const rowsToWrite = analysisResults.map(r => [
      r.code, r.name, r.size, r.isLarge, r.lifecycle, r.class,
      r.totalSales, r.avgMonthly, r.avgPeakShaved, r.avg3M, r.avg6M, r.effectiveAvgSales, r.isLargeFloorApplied, r.avgPeakSeason, r.avgOffSeason,
      r.peakMonth, r.suggestedSafe, r.suggestedTarget,
      r.importDate ? Utilities.formatDate(r.importDate, 'Asia/Taipei', 'yyyy/MM/dd') : '無資料',
      r.importQtyPing,
      r.importQtyPing > 0 ? (Math.round(r.latestBatchSalesRatio * 10) / 10) + '%' : '0%',
      r.lastSaleDate ? Utilities.formatDate(r.lastSaleDate, 'Asia/Taipei', 'yyyy/MM/dd') : '無資料',
      r.daysSinceLastSale >= 0 ? r.daysSinceLastSale : -1,
      JSON.stringify(r.monthlySeries),
      JSON.stringify(r.batches),
      JSON.stringify(insightMapByCode[r.cleanedCode] || {}),
      r.updatedAt
    ]);
    
    if (rowsToWrite.length > 0) {
      const dataRange = analysisSh.getRange(2, 1, rowsToWrite.length, headers.length);
      dataRange.setValues(rowsToWrite);
      // 強制指定儲存格格式，避免 Sheets 把數字欄位誤判成日期格式顯示（例如插入新欄後右側欄位錯位撞到舊格式）
      const numericCols = ['累積總銷量(坪)', '常規月均銷(坪)', '去峰值均銷(坪)', '3個月均銷(坪)', '6個月均銷(坪)', '有效月均銷(坪)',
        '旺季月均銷(坪)', '淡季月均銷(坪)', '系統建議安全坪數', '系統建議補貨目標', '最新批次進貨坪數', '滯銷天數'];
      numericCols.forEach(h => {
        const colIdx = headers.indexOf(h);
        if (colIdx >= 0) {
          analysisSh.getRange(2, colIdx + 1, rowsToWrite.length, 1).setNumberFormat('0.0');
        }
      });
      const textCols = ['最新進貨日', '最新批次銷售佔比', '最後銷貨日', '上次更新時間'];
      textCols.forEach(h => {
        const colIdx = headers.indexOf(h);
        if (colIdx >= 0) {
          analysisSh.getRange(2, colIdx + 1, rowsToWrite.length, 1).setNumberFormat('@');
        }
      });
    }

    clearShortageCaches_();
    clearWarRoomCaches_();
    return { success: true, count: rowsToWrite.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 獲取戰情室完整數據（聯立庫存與保留單，計算即時安全狀況）
 */
function getWarRoomData() {
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const cache = CacheService.getScriptCache();
    // 戰情室快取 key 依分支區隔（高雅瓷仍為 warroom-data-v17-gaoyaci），三家各自獨立，避免預熱/併發時寫錯槽
    const cacheKey = 'warroom-data-v17-' + currentBranchName_();
    const cached = cache.get(cacheKey);
    if (cached) {
      const blob = Utilities.newBlob(Utilities.base64Decode(cached), 'application/gzip');
      const json = Utilities.ungzip(blob).getDataAsString();
      return JSON.parse(json);
    }

    // 🚀 現算路徑加鎖：避免「使用者請求」與「背景預熱觸發器」同時整批重算（數分鐘的運算疊兩倍）。
    //    鎖被佔用時回傳 syncing，前端會顯示「背景同步中」並自動輪詢，而不是卡到前端誤報逾時。
    const warLock = LockService.getScriptLock();
    if (!warLock.tryLock(30000)) {
      return { success: false, syncing: true, error: '戰情室資料正在背景同步中，請稍候再試' };
    }
    try {
      // 等待鎖的期間，背景預熱可能已完成並寫入快取，再檢查一次避免白算
      const cachedAgain = cache.get(cacheKey);
      if (cachedAgain) {
        const blobAgain = Utilities.newBlob(Utilities.base64Decode(cachedAgain), 'application/gzip');
        const jsonAgain = Utilities.ungzip(blobAgain).getDataAsString();
        return JSON.parse(jsonAgain);
      }

    // 1. 讀取「產品戰情分類」
    const analysisSh = dbSs.getSheetByName('產品戰情分類');
    if (!analysisSh) {
      // 若尚未建立，自動執行一次分析
      const res = runProductAnalysis_();
      if (!res.success) return { error: '戰情分類表不存在且重建失敗：' + res.error };
    }
    
    const analysisRows = dbSs.getSheetByName('產品戰情分類').getDataRange().getValues();
    if (analysisRows.length < 2) return { success: true, items: [] };
    
    const headers = analysisRows[0];
    const aIdx = {
      code: headers.indexOf('產品編號'),
      name: headers.indexOf('產品名稱'),
      size: headers.indexOf('尺寸(cm)'),
      isLarge: headers.indexOf('大磚標記'),
      lifecycle: headers.indexOf('產品狀態'),
      class: headers.indexOf('產品戰情分類'),
      avgMonthly: headers.indexOf('常規月均銷(坪)'),
      avgPeakShaved: headers.indexOf('去峰值均銷(坪)'),
      avg3M: headers.indexOf('3個月均銷(坪)'),
      avg6M: headers.indexOf('6個月均銷(坪)'),
      effectiveAvgSales: headers.indexOf('有效月均銷(坪)'),
      isLargeFloorApplied: headers.indexOf('大磚保底套用'),
      peakMonth: headers.indexOf('銷量峰值月份'),
      suggestedSafe: headers.indexOf('系統建議安全坪數'),
      suggestedTarget: headers.indexOf('系統建議補貨目標'),
      importDate: headers.indexOf('最新進貨日'),
      importQty: headers.indexOf('最新批次進貨坪數'),
      batchRatio: headers.indexOf('最新批次銷售佔比'),
      lastSaleDate: headers.indexOf('最後銷貨日'),
      stagnantDays: headers.indexOf('滯銷天數'),
      monthlySeries: headers.indexOf('每月銷量系列'),
      batches: headers.indexOf('批次去化明細'),
      insights: headers.indexOf('銷售結構分析'),
      updatedAt: headers.indexOf('上次更新時間')
    };

    // 🚀 統一判斷來源：跟缺貨公佈欄共用同一份 meta（尺寸/首次進貨日/不續辦/睡美人），
    //    讓 classifyShortageLevel_() 在戰情室也能套用 120x120 特例與新品排除
    const metaMapForClassify = getPriceMetaMap_();

    // 1.5 讀取「編號價目表」的最新與前 3 批進貨資訊
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    const priceRows = priceSh ? priceSh.getDataRange().getValues() : [];
    const priceHeaders = priceRows.length ? priceRows[0] : [];
    const priceCodeIdx = rsvFindHeaderIndex_(priceHeaders, ['編號', '產品編號']);
    const perPingIdx = rsvFindHeaderIndex_(priceHeaders, ['片/坪', '每坪片數', '每坪片']);
    const priceIdx = {
      code: priceCodeIdx,
      perPing: perPingIdx,
      pcsPerBox: rsvFindHeaderIndex_(priceHeaders, ['片/箱']),
      boxesPerPallet: rsvFindHeaderIndex_(priceHeaders, ['箱/板']),
      latestDate: rsvFindHeaderIndex_(priceHeaders, ['最新進貨日', '最近進貨日']),
      latestQty: rsvFindHeaderIndex_(priceHeaders, ['最新片數', '最近片數', '最新數量', '最新坪數']),
      prev1Date: rsvFindHeaderIndex_(priceHeaders, ['前1進貨', '前1進貨日', '前1日期', '入倉日期1']),
      prev1Qty: rsvFindHeaderIndex_(priceHeaders, ['前1數量', '數量1', '入庫數量1']),
      prev2Date: rsvFindHeaderIndex_(priceHeaders, ['前2進貨', '前2進貨日', '前2日期', '入倉日期2']),
      prev2Qty: rsvFindHeaderIndex_(priceHeaders, ['前2數量', '數量2', '入庫數量2']),
      prev3Date: rsvFindHeaderIndex_(priceHeaders, ['前3進貨', '前3進貨日', '前3日期', '入倉日期3']),
      prev3Qty: rsvFindHeaderIndex_(priceHeaders, ['前3數量', '數量3', '入庫數量3'])
    };

    function parseAnyDate_(val) {
      if (!val) return null;
      if (val instanceof Date) {
        let y = val.getFullYear();
        if (y < 1000) y += 1911;
        return new Date(y, val.getMonth(), val.getDate());
      }
      
      var s = String(val).trim();
      if (!s) return null;
      
      var mainPart = s.split('.')[0];
      
      var compactMatch = mainPart.match(/^(\d{3,4})(\d{2})(\d{2})$/);
      if (compactMatch) {
        var year = parseInt(compactMatch[1], 10);
        if (year < 1000) year += 1911;
        return new Date(year, parseInt(compactMatch[2], 10) - 1, parseInt(compactMatch[3], 10));
      }
      
      var parts = s.split(/[\/\-\.]/);
      if (parts.length === 3) {
        var yr = parseInt(parts[0], 10);
        var mo = parseInt(parts[1], 10);
        var da = parseInt(parts[2], 10);
        var realYr = yr < 1900 ? yr + 1911 : yr;
        var d = new Date(realYr, mo - 1, da);
        if (!isNaN(d.getTime())) return d;
      }
      
      var d2 = new Date(s);
      if (!isNaN(d2.getTime())) {
        var y2 = d2.getFullYear();
        if (y2 < 1000) y2 += 1911;
        return new Date(y2, d2.getMonth(), d2.getDate());
      }
      
      return null;
    }

    // 供貨櫃入庫資料換算片數→坪數用（提前建立，因為原本的 perPingMap 在後面才建立）
    const perPingMapEarly = {};
    for (let i = 1; i < priceRows.length; i++) {
      const c = String(priceRows[i][priceIdx.code] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (c) perPingMapEarly[c] = priceIdx.perPing >= 0 ? (parseFloat(priceRows[i][priceIdx.perPing]) || 36) : 36;
    }
    // 🚀 貨櫃系統驗貨完成的真實進貨批次，優先於編號價目表人工維護的欄位
    const inspectionImportMap = getInspectionImportMap_(perPingMapEarly);

    const importMap = {};
    for (let i = 1; i < priceRows.length; i++) {
      const code = String(priceRows[i][priceIdx.code] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (!code) continue;
      const perPing = priceIdx.perPing >= 0 ? (parseFloat(priceRows[i][priceIdx.perPing]) || 36) : 36;
      const batches = [];

      function pushBatch_(label, dateVal, qtyVal) {
        const dateObj = parseAnyDate_(dateVal);
        const qtyPieces = parseFloat(qtyVal) || 0;
        if (!dateObj || qtyPieces <= 0) return;
        batches.push({
          label: label,
          date: dateObj,
          dateStr: Utilities.formatDate(dateObj, 'Asia/Taipei', 'yyyy/MM/dd'),
          qtyPieces: qtyPieces,
          qtyPing: Math.round((qtyPieces / perPing) * 10) / 10
        });
      }

      // 🚀 優先用貨櫃系統驗貨完成的真實批次；這個編號查不到才退回人工維護的 4 個欄位
      const containerBatches = inspectionImportMap[code];
      let sourceLabel;
      if (containerBatches && containerBatches.length) {
        containerBatches.forEach(b => batches.push({ label: '貨櫃', date: b.date, dateStr: b.dateStr, qtyPieces: b.qtyPieces, qtyPing: b.qtyPing }));
        sourceLabel = '貨櫃系統';
      } else {
        pushBatch_('最新', priceIdx.latestDate >= 0 ? priceRows[i][priceIdx.latestDate] : '', priceIdx.latestQty >= 0 ? priceRows[i][priceIdx.latestQty] : '');
        pushBatch_('前1', priceIdx.prev1Date >= 0 ? priceRows[i][priceIdx.prev1Date] : '', priceIdx.prev1Qty >= 0 ? priceRows[i][priceIdx.prev1Qty] : '');
        pushBatch_('前2', priceIdx.prev2Date >= 0 ? priceRows[i][priceIdx.prev2Date] : '', priceIdx.prev2Qty >= 0 ? priceRows[i][priceIdx.prev2Qty] : '');
        pushBatch_('前3', priceIdx.prev3Date >= 0 ? priceRows[i][priceIdx.prev3Date] : '', priceIdx.prev3Qty >= 0 ? priceRows[i][priceIdx.prev3Qty] : '');
        sourceLabel = '人工更新';
      }

      if (!batches.length) continue;
      batches.sort((a, b) => b.date - a.date);

      // 「近一年進貨」= 真的只列近 365 天內的批次（不是固定抓幾個欄位就叫近一年）
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      const recentBatches = batches.filter(b => b.date >= oneYearAgo);
      const hasRecentImport = recentBatches.length > 0;
      const monthsSinceLastImport = Math.floor((new Date() - batches[0].date) / (86400000 * 30));

      importMap[code] = {
        latestImportDate: batches[0].dateStr,
        latestImportQty: batches[0].qtyPing,
        hasRecentImport: hasRecentImport,
        source: sourceLabel, // '貨櫃系統' 或 '人工更新'
        // 近一年有進貨：只列近一年內的批次；近一年沒進貨：改標示最近一次是多久前、進了多少
        history: hasRecentImport
          ? recentBatches.map(b => ({ label: b.label, dateMs: b.date.getTime(), dateStr: b.dateStr, qtyPieces: b.qtyPieces, qtyPing: b.qtyPing }))
          : [],
        lastImportDateStr: batches[0].dateStr,
        lastImportQtyPing: batches[0].qtyPing,
        monthsSinceLastImport: monthsSinceLastImport
      };
    }

    const perPingMap = {};
    const palletPingMap = {};
    const imgUrlMap = {};
    const linkSingleIdx = priceHeaders.indexOf('單片連結網址');
    const priceCostIdx = rsvFindHeaderIndex_(priceHeaders, ['成本', '單片成本']);
    const costMap = {};
    for (let i = 1; i < priceRows.length; i++) {
      const rawCode = String(priceRows[i][priceCodeIdx !== -1 ? priceCodeIdx : 0] || '').trim();
      const code = rawCode.toUpperCase().replace(/[\s\-]/g, '');
      const perPing = perPingIdx >= 0 ? parseFloat(priceRows[i][perPingIdx]) : 36;
      if (code) perPingMap[code] = perPing || 36;
      const pcsPerBox = priceIdx.pcsPerBox >= 0 ? parseFloat(priceRows[i][priceIdx.pcsPerBox]) || 0 : 0;
      const boxesPerPallet = priceIdx.boxesPerPallet >= 0 ? parseFloat(priceRows[i][priceIdx.boxesPerPallet]) || 0 : 0;
      if (code && perPing > 0 && pcsPerBox > 0 && boxesPerPallet > 0) {
        palletPingMap[code] = (pcsPerBox * boxesPerPallet) / perPing;
      }
      if (code && priceCostIdx >= 0) costMap[code] = parseNumeric_(priceRows[i][priceCostIdx]);
      if (code && linkSingleIdx !== -1) {
        const rawUrl = priceRows[i][linkSingleIdx];
        if (rawUrl) {
          const match = String(rawUrl).match(/[-\w]{25,35}/);
          imgUrlMap[code] = match ? "https://drive.google.com/thumbnail?id=" + match[0] + "&sz=w1000" : rawUrl;
        }
      }
    }

    // 🚀 效能優化：銷售結構分析（客戶/區域/集中度/毛利率/上架對比）改讀「產品戰情分類」表的
    //    「銷售結構分析」欄（runProductAnalysis 預算寫入），不再每次冷啟動重掃「經銷銷售報表」。
    //    舊表若沒有該欄（全空），才退回 buildProductInsightMap_() 現算。
    const productInsightMap = {};
    const insightCol = aIdx.insights;
    if (insightCol >= 0) {
      for (let i = 1; i < analysisRows.length; i++) {
        const c = normalizeSku_(analysisRows[i][aIdx.code]);
        if (!c) continue;
        const raw = String(analysisRows[i][insightCol] || '').trim();
        if (!raw) continue;
        try {
          const p = JSON.parse(raw);
          // 只認可「新版」銷售結構分析（含 recent12TotalPing/medianMonthlyPing 等月銷統計）；
          // 舊版存檔缺欄位時不視為有效，統一退回現算，確保戰情室與缺貨公佈欄數字同源。
          if (p && typeof p === 'object' && Object.keys(p).length
            && p.recent12TotalPing !== undefined && p.medianMonthlyPing !== undefined) {
            productInsightMap[c] = p;
          }
        } catch (insightJsonErr) {
          // 單列損壞不影響其他，退回時統一補算
        }
      }
    }
    if (Object.keys(productInsightMap).length < Math.max(1, Math.floor((analysisRows.length - 1) * 0.3))) {
      const liveInsight = buildProductInsightMap_(dbSs, importMap, perPingMap, costMap);
      Object.keys(liveInsight).forEach(c => { if (!productInsightMap[c]) productInsightMap[c] = liveInsight[c]; });
    }
    
    // 2、3. 庫存與保留：一律走標準算法（Stock_Core.js）——片數為準、保留排除結案／取消／刪除／過期釋出
    const stockStd = stockRuleReadStock_(null, c => perPingMap[c] || STOCK_RULE.defaultPerPing);
    const stockPcsMap = stockStd.map;           // 編號 → 片數
    const reserveStd = stockRuleReadReserve_(null);
    const stockMap = {};                        // 編號 → 坪
    Object.keys(stockPcsMap).forEach(c => { stockMap[c] = stockPcsMap[c] / (perPingMap[c] || STOCK_RULE.defaultPerPing); });
    const reserveMap = {};                      // 編號 → 坪
    Object.keys(reserveStd).forEach(c => { reserveMap[c] = reserveStd[c].pieces / (perPingMap[c] || STOCK_RULE.defaultPerPing); });

    // 🚀 即將入庫資訊改由貨櫃到貨明細（取代原本讀保留單入倉日期1/2 的舊機制）
    // 轉換成舊版消費端預期的形狀：{ code: { uniqueKey: {date, dateStr, qtyPieces} } }
    const incomingMap = {};
    const containerMapWr = getIncomingContainerMap_(perPingMap);
    Object.keys(containerMapWr).forEach(code => {
      incomingMap[code] = {};
      containerMapWr[code].forEach((s, si) => {
        incomingMap[code][s.dateStr + '||' + si] = { date: s.date, dateStr: s.dateStr, qtyPieces: s.qtyPieces };
      });
    });

    // 4. 組裝戰情室數據與評估狀態
    const items = [];
    let lastUpdatedTime = '';
    const today = new Date();
    today.setHours(0,0,0,0);
    
    for (let i = 1; i < analysisRows.length; i++) {
      const row = analysisRows[i];
      const rawCode = String(row[aIdx.code]).trim();
      const code = rawCode.toUpperCase().replace(/[\s\-]/g, '');
      
      const stock = stockMap[code] || 0;
      const reserved = reserveMap[code] || 0;
      const avail = stock - reserved;
      
      const suggestedSafeRaw = parseFloat(row[aIdx.suggestedSafe]) || 0;
      const suggestedSafe = suggestedSafeRaw > 0 ? suggestedSafeRaw : 0;
      const importInfo = importMap[code] || {};
      const productInsights = productInsightMap[code] || {};
      
      if (!lastUpdatedTime && row[aIdx.updatedAt]) {
        lastUpdatedTime = String(row[aIdx.updatedAt]);
      }
      
      // 🚀 健康狀態評估：統一改用 runway 分級（跟缺貨公佈欄/預防性保留同一套 classifyShortageLevel_）
      const effectiveAvgSalesForClassify = aIdx.effectiveAvgSales >= 0 ? parseFloat(row[aIdx.effectiveAvgSales]) || 0 : 0;
      const avgPeakShavedForClassify = aIdx.avgPeakShaved >= 0 ? parseFloat(row[aIdx.avgPeakShaved]) || 0 : 0;
      const effectiveAvgSalesFinal = effectiveAvgSalesForClassify > 0 ? effectiveAvgSalesForClassify : avgPeakShavedForClassify;
      const metaForClassify = metaMapForClassify[code] || {};
      const classifiedWr = classifyShortageLevel_({
        avail: avail, effectiveAvgSales: effectiveAvgSalesFinal, safeStock: suggestedSafe,
        stockPing: stock, reservedPing: reserved, meta: metaForClassify
      });
      let healthStatus = classifiedWr.msg || '庫存安全';
      if (classifiedWr.level === 0) healthStatus = '庫存安全';
      const shortageRunway = classifiedWr.runway;
      const shortageLevel = classifiedWr.level;

      // 處理即將入庫資訊 (篩選未來或今天的入倉日期)
      const incomingList = [];
      let totalIncomingPing = 0;
      const perPing = perPingMap[code] || 36;
      
      if (incomingMap[code]) {
        for (const key in incomingMap[code]) {
          const itemShipment = incomingMap[code][key];
          if (itemShipment.date >= today) {
            const qtyPing = itemShipment.qtyPieces / perPing;
            const daysLeft = Math.ceil((itemShipment.date - today) / 86400000);
            
            incomingList.push({
              dateStr: itemShipment.dateStr,
              qtyPieces: itemShipment.qtyPieces,
              qtyPing: Math.round(qtyPing * 10) / 10,
              daysLeft: daysLeft
            });
            totalIncomingPing += qtyPing;
          }
        }
      }
      
      // 依抵達日期升序排序
      incomingList.sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));
      
      // 依據即將入庫資訊，評估「是否已補庫」並進行決策建議
      const suggestedTargetRaw = parseFloat(row[aIdx.suggestedTarget]) || 0;
      const classification = String(row[aIdx.class]);
      const avgMonthlyForDecision = Math.round((parseFloat(row[aIdx.avgMonthly]) || 0) * 10) / 10;
      let monthlySeriesParsed = [];
      try {
        monthlySeriesParsed = row[aIdx.monthlySeries] ? JSON.parse(String(row[aIdx.monthlySeries])) : [];
      } catch (jsonErr) {
        monthlySeriesParsed = [];
      }
      const recent12Series = monthlySeriesParsed.slice(-12);
      const annualSalesRaw = recent12Series.length
        ? recent12Series.reduce((sum, p) => sum + (parseFloat(Array.isArray(p) ? p[1] : p.qty) || 0), 0)
        : avgMonthlyForDecision * 12;
      const annualSales = Math.round(annualSalesRaw * 10) / 10;
      let suggestedTarget = suggestedTargetRaw > 0 ? suggestedTargetRaw : 0;

      // 若分析表舊資料缺漏或欄位異常，於讀取時重算補貨目標，避免 A+/A/B 被誤寫成 0
      const effectiveAvgSalesRaw = aIdx.effectiveAvgSales >= 0 ? parseFloat(row[aIdx.effectiveAvgSales]) || 0 : 0;
      const effectiveForFallback = effectiveAvgSalesRaw > 0 ? effectiveAvgSalesRaw : (parseFloat(row[aIdx.avgPeakShaved]) || 0);
      if (suggestedTarget <= 0) {
        if (classification === 'A+') suggestedTarget = Math.ceil(5.0 * effectiveForFallback);
        else if (classification === 'A') suggestedTarget = Math.ceil(4.0 * effectiveForFallback);
        else if (classification === 'B') suggestedTarget = Math.ceil(3.0 * effectiveForFallback);
        else suggestedTarget = 0;

        if (String(row[aIdx.isLarge]) === '是' && suggestedTarget > 0) {
          suggestedTarget = Math.max(suggestedTarget, suggestedSafe);
        }
      }
      
      let isReplenishTriggered = false;
      let shortageTarget = 0;
      
      if (classification === 'C') {
        // C 類僅當可用低於 0 時觸發補貨
        if (avail < 0) {
          isReplenishTriggered = true;
          shortageTarget = -avail; // 補到 0
        }
      } else {
        // A+, A, B 類當可用低於警戒水位時觸發補貨
        if (avail < suggestedSafe) {
          isReplenishTriggered = true;
          shortageTarget = Math.max(0, suggestedTarget - avail); // 補到補貨目標
        }
      }
      
      let suggestedRestock = 0;
      let suggestedRestockCases = 0;
      let restockStatus = '正常'; // '正常', '已補庫', '部分補庫', '未安排'
      let restockAdvice = '無需補庫';
      let restockReview = false;
      const caseSizePing = palletPingMap[code] || 0;
      const minimumAnnualSalesPing = 10;
      
      if (isReplenishTriggered && shortageTarget > 0) {
        if (totalIncomingPing >= shortageTarget) {
          suggestedRestock = 0;
          restockStatus = '已補庫';
          restockAdvice = '已安排補庫';
        } else if (totalIncomingPing > 0) {
          const remainingNeedPing = Math.max(0, shortageTarget - totalIncomingPing);
          if (annualSales >= minimumAnnualSalesPing) {
            suggestedRestockCases = caseSizePing > 0 ? Math.max(1, Math.ceil(remainingNeedPing / caseSizePing)) : 0;
            suggestedRestock = Math.ceil(remainingNeedPing);
            restockStatus = '部分補庫';
            restockAdvice = caseSizePing > 0
              ? formatCasesAndPing_(suggestedRestockCases, remainingNeedPing > caseSizePing ? remainingNeedPing : suggestedRestockCases * caseSizePing)
              : suggestedRestock + '坪';
          } else {
            suggestedRestock = 0;
            restockStatus = '銷量過低';
            restockAdvice = '銷量過低，請思考補貨';
            restockReview = true;
          }
        } else {
          if (annualSales >= minimumAnnualSalesPing) {
            suggestedRestockCases = caseSizePing > 0 ? Math.max(1, Math.ceil(shortageTarget / caseSizePing)) : 0;
            suggestedRestock = Math.ceil(shortageTarget);
            restockStatus = '未安排';
            restockAdvice = caseSizePing > 0
              ? formatCasesAndPing_(suggestedRestockCases, shortageTarget > caseSizePing ? shortageTarget : suggestedRestockCases * caseSizePing)
              : suggestedRestock + '坪';
          } else {
            suggestedRestock = 0;
            restockStatus = '銷量過低';
            restockAdvice = '銷量過低，請思考補貨';
            restockReview = true;
          }
        }
      }
      
      const metaItem = metaMapForClassify[code] || {};
      const isSleepBool = (aIdx.lifecycle >= 0 && String(row[aIdx.lifecycle] || '').trim() === '睡美人') || !!metaItem.isSleep;
      const isStopBool = (aIdx.lifecycle >= 0 && String(row[aIdx.lifecycle] || '').trim() === '不續辦') || !!metaItem.isStop;

      items.push({
        code: rawCode,
        perPing: perPing,
        name: String(row[aIdx.name]),
        size: String(row[aIdx.size]),
        isLarge: String(row[aIdx.isLarge]) === '是',
        lifecycle: isSleepBool ? '睡美人' : isStopBool ? '不續辦' : (aIdx.lifecycle >= 0 ? String(row[aIdx.lifecycle] || '').trim() : ''),
        isSleep: isSleepBool,
        isStop: isStopBool,
        class: classification,
        avgMonthly: avgMonthlyForDecision,
        annualSales: annualSales,
        avgPeakShaved: Math.round((parseFloat(row[aIdx.avgPeakShaved]) || 0) * 10) / 10,
        effectiveAvgSales: Math.round(effectiveForFallback * 10) / 10,
        isLargeFloorApplied: aIdx.isLargeFloorApplied >= 0 ? String(row[aIdx.isLargeFloorApplied] || '').trim() === '是' : false,
        peakMonth: String(row[aIdx.peakMonth]),
        suggestedSafe: suggestedSafe,
        suggestedTarget: suggestedTarget,
        suggestedRestock: suggestedRestock,
        suggestedRestockCases: suggestedRestockCases,
        restockAdvice: restockAdvice,
        restockReview: restockReview,
        stock: Math.round(stock * 10) / 10,
        reserved: Math.round(reserved * 10) / 10,
        avail: Math.round(avail * 10) / 10,
        healthStatus: healthStatus,
        shortageRunway: shortageRunway,
        shortageLevel: shortageLevel,
        importDate: importInfo.latestImportDate || String(row[aIdx.importDate] || '無資料'),
        importQty: importInfo.latestImportQty || Math.round((parseFloat(row[aIdx.importQty]) || 0) * 10) / 10,
        importHistory: importInfo.history || [],
        hasRecentImport: importInfo.hasRecentImport !== undefined ? importInfo.hasRecentImport : (importInfo.history || []).length > 0,
        importSource: importInfo.source || '',
        lastImportDateStr: importInfo.lastImportDateStr || '',
        lastImportQtyPing: importInfo.lastImportQtyPing || 0,
        monthsSinceLastImport: importInfo.monthsSinceLastImport !== undefined ? importInfo.monthsSinceLastImport : -1,
        batchRatio: String(row[aIdx.batchRatio] || '0%'),
        lastSaleDate: String(row[aIdx.lastSaleDate] || '無資料'),
        stagnantDays: parseInt(row[aIdx.stagnantDays]) >= 0 ? parseInt(row[aIdx.stagnantDays]) : -1,
        monthlySeries: monthlySeriesParsed,
        batches: row[aIdx.batches] ? JSON.parse(String(row[aIdx.batches])) : [],
        avg3M: (function() {
          const mSeries = monthlySeriesParsed;
          let sum3 = 0, count3 = 0;
          const mSeriesRev = [...mSeries].reverse();
          mSeriesRev.forEach((p, idx) => {
            if (idx < 3) { sum3 += (parseFloat(p[1]) || 0); count3++; }
          });
          return count3 > 0 ? Math.round((sum3 / count3) * 10) / 10 : 0;
        })(),
        avg6M: (function() {
          const mSeries = monthlySeriesParsed;
          let sum6 = 0, count6 = 0;
          const mSeriesRev = [...mSeries].reverse();
          mSeriesRev.forEach((p, idx) => {
            if (idx < 6) { sum6 += (parseFloat(p[1]) || 0); count6++; }
          });
          return count6 > 0 ? Math.round((sum6 / count6) * 10) / 10 : 0;
        })(),
        momentum: (function() {
          const mSeries = monthlySeriesParsed;
          let sum3 = 0, count3 = 0;
          const mSeriesRev = [...mSeries].reverse();
          mSeriesRev.forEach((p, idx) => {
            if (idx < 3) { sum3 += (parseFloat(p[1]) || 0); count3++; }
          });
          const avg3 = count3 > 0 ? sum3 / count3 : 0;
          const peakShaved = parseFloat(row[aIdx.avgPeakShaved]) || 0;
          if (peakShaved > 0) {
            const ratio = avg3 / peakShaved;
            if (ratio >= 1.25) return '近期轉強 🚀';
            if (ratio <= 0.75) return '動能走弱 📉';
          }
          return '平穩 ➡️';
        })(),
        incomingList: incomingList,
        totalIncomingPing: Math.round(totalIncomingPing * 10) / 10,
        restockStatus: restockStatus,
        imgUrl: imgUrlMap[code] || '',
        productInsights: productInsights,
        series: String(row[aIdx.name] || '').trim(),
        reserveRatio: (function() {
          if (stock > 0) return Math.round((reserved / stock) * 100);
          return reserved > 0 ? 100 : 0;
        })(),
        demandType: (function() {
          const conc = (productInsights && productInsights.concentration) || {};
          if (avail <= 0) return '保留吃光';
          if (conc.top3Pct !== undefined && conc.top3Pct >= 75) return '專案型';
          if (conc.top1Pct !== undefined && conc.top1Pct >= 60) return '專案型';
          return '常態熱銷';
        })(),
        customerCount: (productInsights && productInsights.customerCount) || 0,
        top1Pct: (productInsights && productInsights.concentration && productInsights.concentration.top1Pct !== undefined) ? productInsights.concentration.top1Pct : null,
        top3Pct: (productInsights && productInsights.concentration && productInsights.concentration.top3Pct !== undefined) ? productInsights.concentration.top3Pct : null
      });
    }
    
    // 5. 有限資金補庫優先級排序
    const priorityOrder = { 'A+': 1, 'A': 2, 'B': 3, 'C': 4 };
    items.sort((a, b) => {
      // (1) 需補庫的排在前面
      const needA = (a.suggestedRestock > 0 || a.restockReview) ? 1 : 0;
      const needB = (b.suggestedRestock > 0 || b.restockReview) ? 1 : 0;
      if (needA !== needB) return needB - needA;
      
      if (needA > 0) {
        // (2) 產品戰情評級優先：A+ -> A -> B -> C
        const pa = priorityOrder[a.class] || 99;
        const pb = priorityOrder[b.class] || 99;
        if (pa !== pb) return pa - pb;
        
        // (3) 大磚有專案需求，同評級中大磚優先
        if (a.isLarge !== b.isLarge) return a.isLarge ? -1 : 1;
        
        // (4) 庫存比率（可用量 / 安全存量）升序：庫存見底最急的排最前面
        const ratioA = a.suggestedSafe > 0 ? (a.avail / a.suggestedSafe) : 0;
        const ratioB = b.suggestedSafe > 0 ? (b.avail / b.suggestedSafe) : 0;
        return ratioA - ratioB;
      } else {
        // 無需補庫的品項，依評級排序，同級依 SKU 字母
        const pa = priorityOrder[a.class] || 99;
        const pb = priorityOrder[b.class] || 99;
        if (pa !== pb) return pa - pb;
        return a.code.localeCompare(b.code);
      }
    });
    
    // 6. 為需補庫品項指配 Priority Rank 勳章號碼
    let rank = 1;
    items.forEach(item => {
      if (item.suggestedRestock > 0 || item.restockReview) {
        item.priorityRank = rank++;
      } else {
        item.priorityRank = 0;
      }
    });
    
    const result = { success: true, items: items, lastUpdated: lastUpdatedTime, webAppUrl: RESERVE_EXEC_URL_ + '?view=reserve' };
    try {
      const payload = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(result))).getBytes());
      cache.put(cacheKey, payload, 360); // 6分鐘，搭配每5分鐘的預熱觸發器，讓快取幾乎不會真的過期
    } catch (cacheErr) {
      // 快取失敗不影響主流程
    }
    return result;
    } finally {
      warLock.releaseLock();
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 判斷尺寸是否為大尺寸磚 (120x120以上)
 */
const LARGE_TILE_AREA_THRESHOLD = 10000; // 平方公分，涵蓋 75x150(11250)、90x180(16200)、120x120(14400)

function isLargeTile_(sizeStr) {
  if (!sizeStr) return false;
  const s = String(sizeStr).toUpperCase();
  const nums = s.match(/\d+/g);
  if (!nums || nums.length < 2) return false;
  const w = parseInt(nums[0], 10);
  const h = parseInt(nums[1], 10);
  return (w * h) >= LARGE_TILE_AREA_THRESHOLD;
}

/**
 * 熔斷檢測核心：分析 live 數據與上次儲存的庫存狀態，若出現「從充足跌破安全存量」則即時寄送熔斷電郵。
 * 分支感知：onEdit 會傳入被編輯試算表對應的分支；時間觸發呼叫時不帶參數 → 依 ACTIVE_BRANCHES 迭代所有分公司。
 */
function checkMeltdownAndAlert(branch) {
  if (branch) {
    setBranch_(branch);
    return checkMeltdownForBranch_();
  }
  const results = [];
  forEachBranch_(function() {
    results.push(checkMeltdownForBranch_());
  });
  return results.length === 1 ? results[0] : { success: true, triggeredCount: 0 };
}

function checkMeltdownForBranch_() {
  try {
    const br = getBranch_();  // 記住目前處理的分公司，熔斷告警／80%／50% 通知都用同一家
    const res = getWarRoomData();
    if (!res.success) return { success: false, error: '取得戰情數據失敗' };
    
    const prop = PropertiesService.getScriptProperties();
    const stockStatesKey = 'STOCK_STATES_' + currentBranchName_();
    const prevStatesStr = prop.getProperty(stockStatesKey) || '{}';
    const prevStates = JSON.parse(prevStatesStr);
    
    const newStates = {};
    let triggeredCount = 0;
    
    res.items.forEach(item => {
      const code = item.code.toUpperCase().replace(/[\s\-]/g, '');
      const isSufficient = item.avail >= item.suggestedSafe;
      
      const prev = prevStates[code] || 'sufficient'; // 預設為安全，避免對已有缺貨存量重複報警
      
      if (prev === 'sufficient' && !isSufficient && item.suggestedSafe > 0) {
        // 熔斷觸發！尋找是哪一筆保留單造成的
        const triggeredReserve = findTriggeredReserve_(item.code);
        sendMeltdownAlertEmail(item, triggeredReserve);
        
        // 若保留超過一半，加發 Telegram 告警
        if (item.reserved > item.stock * 0.5) {
          try {
            var reservePct = item.stock > 0 ? Math.round((item.reserved / item.stock) * 100) : 0;
            var tgMsg = '🚨 【庫存熔斷告警 — 保留過半】\n' +
                        '產品編號：' + item.code + ' (' + item.name + ')\n' +
                        '可用庫存：' + item.avail + ' 坪 / 安全水位：' + item.suggestedSafe + ' 坪\n' +
                        '目前現貨：' + item.stock + ' 坪 / 保留量：' + item.reserved + ' 坪 (佔比: ' + reservePct + '%)\n' +
                        '觸發保留案：' + triggeredReserve.cust + ' - ' + triggeredReserve.site + ' (' + triggeredReserve.qty + ' 坪)\n' +
                        '負責業務：' + triggeredReserve.salesRep;
            pushTelegram(tgMsg, br);
          } catch(tgErr) {
            console.error('發送 TG 熔斷告警失敗: ' + tgErr.message);
          }
        }
        
        newStates[code] = 'depleted';
        triggeredCount++;
      } else {
        newStates[code] = isSufficient ? 'sufficient' : 'depleted';
      }
    });
    
    prop.setProperty(stockStatesKey, JSON.stringify(newStates));

    // 保留佔比跨過 80% 時，通知所有保留該編號的業務
    checkReserveFullAlert_(res.items, branchNameOf_(br));

    // 保留首破 50%：首次超過一半時發 Telegram（ScriptProperties 記 key，只發一次）
    checkReserveHalfAlert_(res.items, branchNameOf_(br));

    return { success: true, triggeredCount: triggeredCount };
  } catch (e) {
    console.error('熔斷檢查出錯：' + e.message);
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// 保留首破 50% 即時 TG 告警（單獨功能，與 80% 額滿警報並行）
// 觸發條件（全部滿足才發）：
//   1. 保留量/現貨 ≥ 50%
//   2. 該品項「最近一筆保留」是近 7 天內留的（只抓近一週剛推破 50% 的品項，
//      避免對大量早就不足的老品項一次洗版）
//   3. ScriptProperties key：RESERVE_50PCT_{branch}_{code} 未寫入（每品項只報一次）
// 4. 每日上限 MAX_RESERVE_50PCT_DAILY 則（key：RESERVE_50PCT_DAILY_{yyyyMMdd}）
// 收件人依各分支 tgChatIds（高雅瓷公佈欄群／安帝嘉 李世興+到貨群／喜悅納 郭培瑋+到貨群）。
// ─────────────────────────────────────────────────────────────

function checkReserveHalfAlert_(items, brName) {
  try {
    const props = PropertiesService.getScriptProperties();
    const branch = brName || currentBranchName_();
    const todayKey = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
    const dailyKey = 'RESERVE_50PCT_DAILY_' + todayKey;
    let dailyCount = parseInt(props.getProperty(dailyKey) || '0', 10) || 0;
    const MAX_PER_DAY = 5;   // 每日上限，超過就留到明天再報
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const latestMap = mapLatestReserves_();
    const fired = [];
    (items || []).forEach(item => {
      const code = String(item.code || '').toUpperCase().replace(/[\s\-]/g, '');
      if (!code) return;
      const stock = parseFloat(item.stock) || 0;
      const reserved = parseFloat(item.reserved) || 0;
      if (stock <= 0) return;
      if (reserved / stock < 0.5) return;
      const key = 'RESERVE_50PCT_' + branch + '_' + code;
      if (props.getProperty(key)) return;   // 每品項只報一次
      // 只抓「近一週內剛留的保留」推破 50% 的品項
      const latest = latestMap[code];
      const dateMs = latest && latest.dateObj ? latest.dateObj.getTime() : NaN;
      if (isNaN(dateMs) || (nowMs - dateMs) > weekMs) return;
      if (dailyCount >= MAX_PER_DAY) return;   // 今日已達上限 → 此品項留待明日（key 不寫，之後仍會報）
      props.setProperty(key, '1');
      dailyCount++;
      props.setProperty(dailyKey, String(dailyCount));
      sendReserveHalfAlert_(item, Math.round((reserved / stock) * 100), branch);
      fired.push(code);
    });
    if (fired.length) console.log('✅ 保留首破50% 告警發出（' + branch + '）：' + fired.join(','));
  } catch (e) {
    console.error('checkReserveHalfAlert_ 失敗：' + e.message);
  }
}

/**
 * 一輪掃描該家保留表：從最後一行往前，建立各 SKU「最近一筆保留」對照表
 * （含客戶/工地/業務/坪數/保留日，供 50% 與熔斷告警使用）
 */
function mapLatestReserves_() {
  const map = {};
  try {
    const br = getBranch_();
    const resSh = SpreadsheetApp.openById(br.reserveSS).getSheetByName(br.sheetName);
    const resRows = resSh.getDataRange().getValues();
    const h = resRows[0];
    const iCode  = rsvFindHeaderIndex_(h, ['編號', '產品編號']);
    const iQty   = rsvFindHeaderIndex_(h, ['數量', '片數']);
    const iCust  = rsvFindHeaderIndex_(h, ['客戶名稱', '客戶']);
    const iSite  = rsvFindHeaderIndex_(h, ['工地名稱', '工地']);
    const iDate  = rsvFindHeaderIndex_(h, ['單據日期', '保留日期', '日期']);
    const iSales = rsvFindHeaderIndex_(h, ['負責業務']);
    if (iCode < 0) return map;

    // 片/坪 換算表（缺檔時預設 36）
    const dbSs = SpreadsheetApp.openById(br.dbSS);
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    const priceRows = priceSh.getDataRange().getValues();
    // 2026-10-01：品號欄改依表頭找（以前寫死第 A 欄，但第 A 欄是「廠牌」，片/坪永遠查不到而一律用 36）
    const priceHead = priceRows[0].map(v => String(v || '').trim());
    const ppCode = rsvFindHeaderIndex_(priceHead, ['編號', '產品編號']);
    const ppCol = priceHead.indexOf('片/坪');
    const ppMap = {};
    if (ppCode >= 0 && ppCol >= 0) {
      for (let i = 1; i < priceRows.length; i++) {
        ppMap[normalizeSku_(priceRows[i][ppCode])] = parseFloat(priceRows[i][ppCol]) || 36;
      }
    }

    for (let i = resRows.length - 1; i >= 1; i--) {
      const code = String(resRows[i][iCode] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (!code || map[code]) continue;   // 只留最上面（最新）那一筆
      const rawDate = iDate >= 0 ? resRows[i][iDate] : null;
      const dateObj = rawDate instanceof Date ? rawDate : new Date(rawDate);
      map[code] = {
        cust:     iCust  >= 0 ? String(resRows[i][iCust]).trim()  : '未知客戶',
        site:     iSite  >= 0 ? String(resRows[i][iSite]).trim()  : '未知工地',
        salesRep: iSales >= 0 ? String(resRows[i][iSales]).trim() : '未知業務',
        qty:      iQty   >= 0 ? Math.round((parseFloat(resRows[i][iQty]) || 0) / (ppMap[code] || 36) * 10) / 10 : 0,
        dateObj:  dateObj
      };
    }
  } catch (e) {
    console.error('mapLatestReserves_ 失敗：' + e.message);
  }
  return map;
}

function sendReserveHalfAlert_(item, pct, brName) {
  const br = getBranch_(brName);
  if (!br.hasTelegram || !br.tgChatIds || !br.tgChatIds.length) return;
  const stock = Math.round((parseFloat(item.stock) || 0) * 10) / 10;
  const reserved = Math.round((parseFloat(item.reserved) || 0) * 10) / 10;
  const avail = Math.round((parseFloat(item.avail) || 0) * 10) / 10;
  const line =
    '⚠️ 【' + br.label + ' 保留超過一半】\n' +
    '產品編號：' + item.code + (item.name ? ' (' + item.name + ')' : '') + '\n' +
    '目前現貨：' + stock + ' 坪 / 保留量：' + reserved + ' 坪（佔比 ' + pct + '%）\n' +
    '剩餘可售：' + avail + ' 坪\n\n' +
    '💡 該項商品現貨已有一半以上被保留，請相關業務確認保留單是否真實有效，避免影響其他客戶。';
  br.tgChatIds.forEach(function(chatId) {
    pushTelegramTo_(chatId, line);
  });
}

/**
 * 輔助定位：找出最近一次新增或修改的該 SKU 保留單，作為告警信中的「罪魁禍首」
 */
function findTriggeredReserve_(prodCode) {
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const resSh = SpreadsheetApp.openById(getBranch_().reserveSS).getSheetByName(getBranch_().sheetName); // 🚀 讀正確來源，不讀 1G5q 同步複本
    const resRows = resSh.getDataRange().getValues();
    const resHeaders = resRows[0];
    const rIdxCode = rsvFindHeaderIndex_(resHeaders, ['編號', '產品編號']);
    const rIdxQty = rsvFindHeaderIndex_(resHeaders, ['數量', '片數']);
    const rIdxCust = rsvFindHeaderIndex_(resHeaders, ['客戶名稱', '客戶']);
    const rIdxSite = rsvFindHeaderIndex_(resHeaders, ['工地名稱', '工地']);
    const rIdxDate = rsvFindHeaderIndex_(resHeaders, ['單據日期', '保留日期', '日期']);
    const rIdxSales = rsvFindHeaderIndex_(resHeaders, ['負責業務']);
    
    let latestReserve = { cust: '未知客戶', site: '未知工地', salesRep: '未知業務', qty: 0, date: '今日' };
    const cleanTargetCode = prodCode.toUpperCase().replace(/[\s\-]/g, '');
    
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    const priceRows = priceSh.getDataRange().getValues();
    // 2026-10-01：品號欄改依表頭找（以前寫死第 A 欄＝「廠牌」，永遠比對不到而用 36）
    const priceHead = priceRows[0].map(v => String(v || '').trim());
    const priceCodeIdx = rsvFindHeaderIndex_(priceHead, ['編號', '產品編號']);
    const perPingIdx = priceHead.indexOf('片/坪');
    let perPing = 36;
    for (let i = 1; priceCodeIdx >= 0 && perPingIdx >= 0 && i < priceRows.length; i++) {
      const c = normalizeSku_(priceRows[i][priceCodeIdx]);
      if (c === cleanTargetCode) {
        perPing = parseFloat(priceRows[i][perPingIdx]) || 36;
        break;
      }
    }
    
    // 從最後一行往前尋找該 SKU 最近一次寫入的保留明細
    for (let i = resRows.length - 1; i >= 1; i--) {
      const code = String(resRows[i][rIdxCode] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (code === cleanTargetCode) {
        latestReserve = {
          cust: rIdxCust >= 0 ? String(resRows[i][rIdxCust]).trim() : '未知客戶',
          site: rIdxSite >= 0 ? String(resRows[i][rIdxSite]).trim() : '未知工地',
          salesRep: rIdxSales >= 0 ? String(resRows[i][rIdxSales]).trim() : '未知業務',
          qty: rIdxQty >= 0 ? Math.round((parseFloat(resRows[i][rIdxQty]) || 0) / perPing * 10) / 10 : 0,
          date: rIdxDate >= 0 ? String(resRows[i][rIdxDate]).trim() : '今日'
        };
        break;
      }
    }
    return latestReserve;
  } catch (e) {
    return { cust: '系統檢查中', site: '保留單有變更', salesRep: '未知', qty: 0, date: '今日' };
  }
}

/**
 * 試算表安裝式觸發器：只要保留表有變更（如人工新增或更新進度），即時在背景執行熔斷檢查
 * (併入版面神器後改名，不叫 onEdit，避免被當成簡單觸發器)
 */
function rsvOnEditTrigger(e) {
  if (!e) return;
  const sh = e.range && e.range.getSheet ? e.range.getSheet() : null;
  if (!sh) return;
  // 依「被編輯的試算表」反查分支：被編輯的是哪一家的保留表就是哪一家
  const branch = branchBySpreadsheetId_(sh.getParent().getId());
  if (!branch) return;
  const sheetName = sh.getName();
  if (sheetName === BRANCHES[branch].sheetName || sheetName === '高雅瓷保留') {
    checkMeltdownAndAlert(branch);
  }
}

function getProductImageUrl(code) {
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const priceSh = dbSs.getSheetByName('編號價目表') || dbSs.getSheetByName('價目表');
    if (!priceSh) return null;
    const priceRows = priceSh.getDataRange().getValues();
    const priceHeaders = priceRows[0];
    const codeIdx = priceHeaders.indexOf('編號');
    const linkSingleIdx = priceHeaders.indexOf('單片連結網址');
    if (codeIdx === -1 || linkSingleIdx === -1) return null;
    const cleanTarget = String(code).trim().toUpperCase().replace(/[\s\-]/g, '');
    for (let i = 1; i < priceRows.length; i++) {
      const currentCode = String(priceRows[i][codeIdx] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
      if (currentCode === cleanTarget) {
        const rawUrl = priceRows[i][linkSingleIdx];
        if (rawUrl) {
          const match = String(rawUrl).match(/[-\w]{25,35}/);
          if (match) return "https://drive.google.com/thumbnail?id=" + match[0] + "&sz=w1000";
          return rawUrl;
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

// ─── 每日保留日報（每天 19:00 依業務分組列出當天新增保留）──────────────────────────────

/** 設定每天 19:00 觸發 sendDailyNewReserves_()，可在 doGet 中呼叫一次（冪等） */
function setupDailyReserveReportTrigger() {
  const fn = 'sendDailyNewReserves_';
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .nearMinute(5)
    .inTimezone('Asia/Taipei')
    .create();
  console.log('✅ 每日保留日報觸發器已設定（19:05 Asia/Taipei）');
}

/** 是否為工作日（週一～五）。週末停發；國定假日若要跳過，可在此新增日期（yyyy/MM/dd）。 */
function isWorkday_() {
  const d = new Date().getDay();
  return d >= 1 && d <= 5;
}

/** 從「工地」欄自動取簡碼：遇到完整地址（用 / 或 ／ 分隔）就取最後一段短名，沒有分隔就原樣回傳 */
function deriveSiteShort_(siteVal) {
  const s = String(siteVal || '').trim();
  if (!s) return '';
  const parts = s.split(/[/／]/).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return s;
  return parts[parts.length - 1];
}

/** 讀保留表，篩出今日新增，依業務分組，發 Telegram（三家分公司依序執行；僅工作日；當天無新增則安靜） */
function sendDailyNewReserves_() {
  if (!isWorkday_()) return; // 週末／假日不發
  forEachBranch_(function(br) {
    try {
      if (!br.hasTelegram || !br.tgChatIds || !br.tgChatIds.length) return;

      const sh = getSheet_();
      if (!sh) return;

      const rows = sh.getDataRange().getValues();
      if (rows.length < 2) return;

      const idx   = buildIdx_(rows[0]);
      const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');

      // 今日新增保留，依業務分組
      var byRep = {};
      var totalCount = 0;

      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        var code = String(row[idx.code] || '').trim();
        var qty  = parseFloat(row[idx.qty]) || 0;
        if (!code || qty <= 0) continue;

        // 保留日期比對（只抓今天）
        var rawDate = row[idx.dateRes];
        var dateObj = rawDate instanceof Date ? rawDate : new Date(rawDate);
        if (isNaN(dateObj)) continue;
        var dateStr = Utilities.formatDate(dateObj, 'Asia/Taipei', 'yyyy/MM/dd');
        if (dateStr !== today) continue;

        var salesRep = idx.salesRep >= 0 ? String(row[idx.salesRep] || '').trim() : '';
        var site     = idx.site     >= 0 ? String(row[idx.site]     || '').trim() : '';
        var cust     = idx.cust     >= 0 ? String(row[idx.cust]     || '').trim() : '';
        var proj     = idx.projName >= 0 ? String(row[idx.projName] || '').trim() : '';

        if (!salesRep) salesRep = '未指派';
        if (!byRep[salesRep]) byRep[salesRep] = [];
        byRep[salesRep].push({
          code:  code,
          qty:   qty,
          site:  site,
          cust:  cust,
          proj:  proj
        });
        totalCount++;
      }

      // 今日無新增 → 不發通知（安靜下班）
      if (totalCount === 0) return;

      // ── 組裝訊息 ──
      var dateLabel = Utilities.formatDate(new Date(), 'Asia/Taipei', 'MM/dd');
      var weekCn    = ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()];
      var msg = '📋 ' + br.label + ' 今日新增保留 ' + dateLabel + '（' + weekCn + '）\n\n';

      var repNames = Object.keys(byRep).sort();
      repNames.forEach(function(rep) {
        msg += rep + '\n';
        byRep[rep].forEach(function(item) {
          // 一行 = 客戶 ｜案名（無案名自動取工地簡碼）｜編號 × 片數
          var name = item.proj || deriveSiteShort_(item.site) || '未填案名';
          msg += (item.cust || '未填客戶') + ' ｜' + name + '｜' + item.code + ' × ' + item.qty + ' 片\n';
        });
        msg += '\n';
      });

      msg += '共 ' + totalCount + ' 筆 ｜ 更新時間 '
           + Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm');

      // 發送（該分公司全部 tgChatIds）
      br.tgChatIds.forEach(function(chatId) {
        pushTelegramTo_(chatId, msg);
      });

      console.log('✅ 每日保留日報已發送（' + br.label + '）：' + totalCount + ' 筆');
    } catch (e) {
      console.error('sendDailyNewReserves_ 失敗（' + br.label + '）：' + e.message);
    }
  });
}

// ─── 50% 保留測試（由 Main.js ?test=50pct 路由呼叫）───────────────────────────────

function testReserveHalfAlert_() {
  var branch = currentBranchName_();
  try {
    var res = getWarRoomData();
    if (!res.success) return { success: false, error: res.error };

    var halfItems = (res.items || []).filter(function(item) {
      var stock    = parseFloat(item.stock)    || 0;
      var reserved = parseFloat(item.reserved) || 0;
      return stock > 0 && reserved / stock >= 0.5;
    });

    if (!halfItems.length) {
      return { success: true, message: branch + ' 目前無保留超過 50% 的品項', items: [] };
    }

    // 發第一筆測試（不寫 RESERVE_50PCT_ 防重 key，純測試）
    var item = halfItems[0];
    var pct  = Math.round((item.reserved / item.stock) * 100);
    sendReserveHalfAlert_(item, pct, branch);

    return {
      success:   true,
      branch:    branch,
      message:   '已發送測試：' + item.code + ' (' + item.name + ') 保留 ' + pct + '%',
      total:     halfItems.length,
      items:     halfItems.map(function(i) {
        return {
          code:     i.code,
          name:     i.name,
          stock:    i.stock,
          reserved: i.reserved,
          pct:      Math.round((i.reserved / i.stock) * 100)
        };
      })
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── 缺貨看板試跑診斷（由 Main.js ?test=shortage&branch=X 呼叫）────────────────────────
// 驗證安帝嘉／喜悅納資料庫是否足以算出缺貨週報：逐表回報現況 + 乾跑 getShortageBoardData()，
// 並用週報同款邏輯預覽「缺貨 / 補貨中」各幾筆。不回寫任何「缺貨進榜追蹤」以外的常態資料。
function testBranchShortage_(branch) {
  const br = getBranch_(branch);
  const out = { branch: br.label, branchKey: branch, tables: {}, board: null, reportPreview: null };
  try {
    const dbSs = SpreadsheetApp.openById(br.dbSS);

    const tableInfo = function(name) {
      const sh = dbSs.getSheetByName(name);
      if (!sh) { out.tables[name] = { exists: false, rows: 0 }; return; }
      const lastRow = sh.getLastRow();
      let headers = [];
      if (lastRow >= 1 && sh.getLastColumn() >= 1) {
        headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
          .map(v => String(v || '').trim()).filter(Boolean);
      }
      out.tables[name] = { exists: true, rows: lastRow, headers: headers.slice(0, 10).join(' | ') };
    };

    ['價目表', '編號價目表'].forEach(tableInfo);
    ['庫存表'].forEach(tableInfo);
    ['產品戰情分類'].forEach(tableInfo);
    ['產品年度銷售快取'].forEach(tableInfo);
    ['缺貨進榜追蹤'].forEach(tableInfo);

    const resSh = SpreadsheetApp.openById(br.reserveSS).getSheetByName(br.sheetName);
    out.tables['保留表(' + br.sheetName + ')'] = resSh
      ? { exists: true, rows: resSh.getLastRow() }
      : { exists: false, rows: 0 };

    const salesSh = dbSs.getSheetByName(br.salesSheetName) || dbSs.getSheetByName('月報表');
    out.tables['銷貨報表(' + br.salesSheetName + ')'] = salesSh
      ? { exists: true, rows: salesSh.getLastRow() }
      : { exists: false, rows: 0 };

    // 清快取強制重算，確保看到的是「現在資料」算出來的結果
    clearShortageCaches_();

    const board = getShortageBoardData(branch);
    if (!board.success) {
      out.board = { error: board.error };
    } else {
      const items = board.items || [];
      const byStatus = {};
      const byStatusOk = items.length <= 200 ? byStatus : {}; // 資料量太大就不列細目
      items.forEach(function(it) {
        const k = String(it['處理狀態'] || '缺貨中').trim() || '缺貨中';
        if (byStatus[k] === undefined) byStatus[k] = 0;
        byStatus[k]++;
      });
      // 週一週報同款分類：補貨中（生產中／排船中）以外非完結的都算缺貨
      let shortageCount = 0;
      let orderingCount = 0;
      items.forEach(function(it) {
        const st = String(it['處理狀態'] || '').trim();
        if (st === '生產中' || st === '排船中') orderingCount++;
        else shortageCount++;
      });
      out.board = {
        success: true,
        itemCount: items.length,
        byStatus: byStatus,
        sample: items.slice(0, 5).map(function(it) {
          return { code: it.code, name: it.name, avail: it.avail, status: it['處理狀態'] };
        })
      };
      out.reportPreview = {
        shortage: shortageCount,
        ordering: orderingCount,
        wouldSend: shortageCount > 0 || orderingCount > 0
      };
    }
    return out;
  } catch (e) {
    return { success: false, error: e.message };
  }
}
