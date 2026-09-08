/**
 * 📊 整合版客戶分析 — 手機端資料層
 * ------------------------------------------------
 * 設計原則：**這裡不做任何計算。**
 * 所有數字都直接向睡美人戰情室既有的 API 拿，因為戰情室本來就是這些數字的權威來源。
 * 手機跟戰情室之所以會顯示一樣的數字，是因為根本是同一份計算，不是靠兩邊對帳維持一致。
 *
 * 戰情室端對應的改動（commit 8d03195）：auth.php 開了一組唯讀白名單，
 * 只放行下面這四支讀取用 action，並且要帶 X-App-Token 標頭。
 */

const CA_CONFIG = {
  BASE_URL: 'https://bigt.cc/sleeping-beauty/api.php',
  COMPANY: 'elitile',        // 高雅瓷；戰情室用 elitile/antiga/siena 區分三家公司
  TIMEOUT_MS: 60000,
  CACHE_TTL_ALL: 1800,       // 全客戶總表：戰情室要掃整份銷售報表，較貴，快取 30 分鐘
  CACHE_TTL_ONE: 600         // 單一客戶的細項：快取 10 分鐘
};

/** 戰情室唯讀金鑰放在指令碼屬性，不寫進程式碼 */
function caGetToken_() {
  return PropertiesService.getScriptProperties().getProperty('WARROOM_APP_READ_TOKEN') || '';
}

/**
 * 呼叫戰情室 API。
 * token 走 X-App-Token 標頭而不是網址參數，這樣不會出現在伺服器存取記錄裡。
 */
function caFetch_(action, extraParams) {
  const token = caGetToken_();
  if (!token) {
    return { success: false, msg: '尚未設定戰情室金鑰（指令碼屬性 WARROOM_APP_READ_TOKEN）' };
  }

  let url = CA_CONFIG.BASE_URL + '?action=' + encodeURIComponent(action) +
            '&company=' + encodeURIComponent(CA_CONFIG.COMPANY);
  if (extraParams) {
    Object.keys(extraParams).forEach(function (k) {
      const v = extraParams[k];
      if (v !== undefined && v !== null && v !== '') {
        url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
      }
    });
  }

  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'X-App-Token': token },
      muteHttpExceptions: true,
      followRedirects: true
    });
    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code === 401) {
      return { success: false, msg: '戰情室拒絕存取（金鑰不符或尚未設定）' };
    }
    if (code !== 200) {
      return { success: false, msg: '戰情室回應 HTTP ' + code };
    }

    try {
      return JSON.parse(body);
    } catch (parseErr) {
      // 戰情室發生 PHP 錯誤時可能回傳 HTML 而不是 JSON，把前段內容帶回來方便查
      return { success: false, msg: '戰情室回應不是有效 JSON：' + body.substring(0, 200) };
    }
  } catch (e) {
    return { success: false, msg: '無法連線戰情室：' + e };
  }
}

// ─────────────────────────────────────────────────────────
// 客戶名稱對位
// 手機這邊拿到的是「業務分區」的原始客戶名，戰情室回傳的則是它自己正規化過的名稱。
// 下面是戰情室 displayCustomerName()（SleeperService.php:56-103）的逐行移植，
// 已用 35 個涵蓋各分支的測試驗證過（含東春/滿財、專岩、禾昇、春發磁磚、全形空格）。
// ─────────────────────────────────────────────────────────

const CA_CUST_SUFFIXES = [
  '企業股份有限公司', '開發有限公司', '股份有限公司', '有限公司',
  '企業', '建材', '國際', '磁磚', '磁藝', '工程', '設計部', '出貨',
  '保留收訂', '公司', '實業', '精品', '工作室', '開發', '室內裝修',
  '室內設計', '設計', '行銷', '商行', '建業', '綜合'
];

const CA_CUST_EXCEPTIONS = [
  '夏綠蒂', '德思特尼', '百事得', '百達富麗', '鑫東聖', '海格斯',
  '信義星', '好仕齊', '新睦豐', '富利鴻', '金豪益'
];

/**
 * PHP trim() 的預設行為：只剝 " \t\n\r\0\x0B"。
 * 不能用 JS 的 .trim()，它會連全形空格等 Unicode 空白一起剝掉。
 */
function caPhpTrim_(s) {
  return s.replace(/^[ \t\n\r\0\x0B]+/, '').replace(/[ \t\n\r\0\x0B]+$/, '');
}

/**
 * 對應 PHP normalizeCustomerName()。
 *
 * ⚠️ 空白只能匹配 ASCII，不可用 JS 的 \s。
 * PHP 端是 preg_replace('/[...\s]+/u', ...)，而 PCRE 在 /u 模式下 \s 仍只匹配 ASCII 空白
 * （要另外開 PCRE_UCP 才涵蓋 Unicode 空白，PHP 預設沒開）。JS 的 \s 卻會把全形空格
 * U+3000、NBSP 一起吃掉——中文客戶名很常有全形空格，照抄會讓「滿　財」被誤併成「滿財」。
 */
function caNormalizeCustomerName_(name) {
  return caPhpTrim_(String(name == null ? '' : name))
    .replace(/[()（）【】\[\]「」『』,，.。\/／:： \t\n\r\f\v]+/g, '');
}

/** 對應 PHP displayCustomerName()：戰情室的權威規則，取前 4 字 */
function caDisplayCustomerName_(name) {
  let s = caNormalizeCustomerName_(name);
  if (s === '') return '未知客戶';

  // 固定合併清單（順序重要：長名在前）
  if (s.indexOf('德思特尼') !== -1 || s.indexOf('德思') !== -1) return '德思特尼';
  if (s.indexOf('漢樺') !== -1 || s.indexOf('波爾泰') !== -1) return '漢樺';
  if (s.indexOf('大永') !== -1 || s.indexOf('新大永') !== -1) return '大永';
  if (s.indexOf('伊特') !== -1 || s.indexOf('喬弈') !== -1 || s.indexOf('喬翌') !== -1) return '伊特';
  if (s.indexOf('鏷城') !== -1 || s.indexOf('璞城') !== -1) return '鏷城';
  if (s.indexOf('鼎康') !== -1 || s.indexOf('鼎晨') !== -1) return '鼎晨';
  if (s.indexOf('今冠') !== -1 || s.indexOf('金冠') !== -1) return '金冠';
  if (s.indexOf('東春') !== -1 || s.indexOf('滿財') !== -1) return '滿財';
  if (s.indexOf('傅邦') !== -1 || s.indexOf('盛邦') !== -1) return '傅邦';
  if (s.indexOf('錦義') !== -1 || s.indexOf('睿敏') !== -1) return '錦義';
  if (s.indexOf('高頓') !== -1 || s.indexOf('馬來高') !== -1) return '馬來高';
  if (s.indexOf('太爾') !== -1) return '信義星';
  if (s.indexOf('琮達') !== -1) return '琮威';

  const prefix2 = s.substring(0, 2);
  if (prefix2 === '專岩') return '專岩';
  if (prefix2 === '禾昇') return '禾昇';

  s = s.split(/[-－—]/)[0] || s;

  for (let i = 0; i < CA_CUST_EXCEPTIONS.length; i++) {
    if (s.indexOf(CA_CUST_EXCEPTIONS[i]) !== -1) return CA_CUST_EXCEPTIONS[i];
  }

  // 迴圈剝除公司後綴至穩定（照 PHP：找到第一個 pos>0 就 break 重跑）
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < CA_CUST_SUFFIXES.length; i++) {
      const pos = s.indexOf(CA_CUST_SUFFIXES[i]);
      if (pos > 0) {
        s = s.substring(0, pos);
        changed = true;
        break;
      }
    }
  }
  return s.substring(0, 4);
}

// ─────────────────────────────────────────────────────────

/**
 * 全部客戶的分析總表（戰情室 customer-analysis）。
 * 這支在戰情室端要掃整份經銷銷售報表，比較貴，所以整包快取 30 分鐘。
 */
function caGetAllCustomersCached_(forceRefresh) {
  const cacheKey = 'ca_all_customers_v1_' + CA_CONFIG.COMPANY;
  if (!forceRefresh) {
    try {
      const cached = CacheManager.getLarge(cacheKey);
      if (cached) return cached;
    } catch (e) {}
  }

  const res = caFetch_('customer-analysis');
  if (res && res.success) {
    try { CacheManager.putLarge(cacheKey, res, CA_CONFIG.CACHE_TTL_ALL); } catch (e) {}
  }
  return res;
}

/**
 * 🎯 對外主入口：取得單一客戶的整合分析
 * @param {string} customerName 手機端當前選取的客戶（業務分區的原始名稱）
 * @param {boolean} [forceRefresh] 略過快取重新抓
 */
function getCustomerAnalysisSnapshot(customerName, forceRefresh) {
  const rawName = String(customerName || '').trim();
  if (!rawName) return { success: false, msg: '沒有指定客戶' };

  const all = caGetAllCustomersCached_(!!forceRefresh);
  if (!all || !all.success) {
    return { success: false, msg: (all && all.msg) || '戰情室沒有回應' };
  }

  // 用戰情室自己的正規化規則把手機端的原始名稱對到它回傳的 name
  const key = caDisplayCustomerName_(rawName);
  const list = all.data || [];
  let hit = null;
  for (let i = 0; i < list.length; i++) {
    // 一定要轉字串再比：戰情室回傳的 name 有一部分是數字型別
    //（試算表裡有整欄週期日期被誤當客戶名讀進去，例如 1226、1219），
    // 直接用 === 比對會因為型別不同而失配。
    if (list[i] && String(list[i].name) === key) { hit = list[i]; break; }
  }

  if (!hit) {
    return {
      success: false,
      notFound: true,
      msg: '戰情室沒有這家客戶的資料',
      lookedFor: key,
      rawName: rawName
    };
  }

  return {
    success: true,
    customer: hit,
    matchedKey: key,
    rawName: rawName,
    summary: all.summary || null,
    fetchedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm')
  };
}

/**
 * 單一客戶的細項（依需要延遲載入，避免第一次開就等太久）
 * @param {string} customerName 原始客戶名稱
 * @param {string} part 'timeline' | 'warroom' | 'breakdown'
 */
function getCustomerAnalysisDetail(customerName, part) {
  const rawName = String(customerName || '').trim();
  if (!rawName) return { success: false, msg: '沒有指定客戶' };

  const actionMap = {
    timeline: 'customer-timeline',
    warroom: 'customer-warroom',
    breakdown: 'customer-sales-breakdown',
    detail: 'customer-detail'   // 常銷商品下探用的逐筆交易明細
  };
  const action = actionMap[part];
  if (!action) return { success: false, msg: '未知的分析項目：' + part };

  // 戰情室這幾支是用前綴比對找客戶，傳正規化後的名稱比傳原始名稱穩
  const key = caDisplayCustomerName_(rawName);
  const cacheKey = 'ca_detail_v1_' + part + '_' + key;

  try {
    const cached = CacheManager.getLarge(cacheKey);
    if (cached) return cached;
  } catch (e) {}

  const res = caFetch_(action, { customer: key });
  if (res && res.success) {
    try { CacheManager.putLarge(cacheKey, res, CA_CONFIG.CACHE_TTL_ONE); } catch (e) {}
  }
  return res;
}

/**
 * 🎯 客戶清單（含健康度）：給客戶分析頁的清單畫面用。
 * 正規化刻意放在伺服器端做——前端若自己再實作一份 displayCustomerName，
 * 就會變成第二個會漂移的複本（這個專案群已經吃過這種虧）。
 * @param {string} salesName 業務姓名
 */
function getCustomerAnalysisListForSales(salesName) {
  const name = String(salesName || '').trim();
  if (!name) return { success: false, msg: '沒有指定業務' };

  let customers = [];
  try {
    const listRes = getCustomerList(name);
    customers = (listRes && listRes.success && listRes.data) ? listRes.data : [];
  } catch (e) {
    return { success: false, msg: '客戶清單讀取失敗：' + e };
  }

  // 分析資料拿不到也不該讓清單開不出來，降級成只有名字與等級
  const map = {};
  try {
    const all = caGetAllCustomersCached_(false);
    if (all && all.success) {
      (all.data || []).forEach(function (a) { map[String(a.name)] = a; });
    }
  } catch (e) {}

  return {
    success: true,
    data: customers.map(function (c) {
      const a = map[caDisplayCustomerName_(c.name)] || null;
      return {
        name: c.name,
        level: c.level || '',
        hidden: !!c.hidden,
        health: a ? a.health : null,
        yoyPct: a ? a.yoyPct : null,
        thisYearAmount: a ? a.thisYearAmount : null,
        daysSinceLastOrder: a ? a.daysSinceLastOrder : null
      };
    })
  };
}

/**
 * 🖼 SKU → 單片縮圖對照表。
 * 圖片來源是本專案自己的「編號價目表」（getAggregatedInventory 已有 img 欄位），
 * 不必向戰情室要，也不用多開一支 API 權限。
 * key 用 normalizeIncomingSkuKey_ 正規化過的編號，因為戰情室回傳的編號
 * 是 cleanSku() 處理過的（大寫去空白），兩邊要對得起來。
 */
function getSkuImageMap() {
  const cacheKey = 'ca_sku_img_v1';
  try {
    const cached = CacheManager.getLarge(cacheKey);
    if (cached) return { success: true, data: cached };
  } catch (e) {}

  const map = {};
  try {
    const inv = getAggregatedInventory();
    if (inv && inv.success && inv.data) {
      inv.data.forEach(function (p) {
        if (!p || !p.sku || !p.img) return;
        const key = String(p.sku).trim().toUpperCase().replace(/[\s\-]/g, '');
        if (key && !map[key]) map[key] = p.img;
      });
    }
  } catch (e) {
    return { success: false, msg: '庫存資料讀取失敗：' + e };
  }

  try { CacheManager.putLarge(cacheKey, map, 1800); } catch (e) {}
  return { success: true, data: map };
}

// ─────────────────────────────────────────────────────────
// 樣品紀錄：直接讀本專案的「經銷銷售報表」
// 戰情室的分析一律把樣品排除在業績外（isSampleRow），所以那邊查不到；
// 但業務要知道「這家有沒有拿過樣、多久前」，只能自己掃一次原始報表。
// ─────────────────────────────────────────────────────────

/** 判斷是否為樣品列：編號 -S/-S1 結尾，或備註/品名含樣品類關鍵字 */
function caIsSampleRow_(sku, note) {
  const s = String(sku || '').trim().toUpperCase();
  if (/-S\d*$/.test(s)) return true;
  const t = String(note || '');
  return /樣品|送樣|樣板|SAMPLE|扣帶|陳列/i.test(t);
}

/**
 * 🎯 某客戶的樣品紀錄：整體最後拿樣時間 + 每個 SKU 的最後拿樣時間
 * @param {string} customerName 原始客戶名稱
 */
function getCustomerSampleInfo(customerName) {
  const rawName = String(customerName || '').trim();
  if (!rawName) return { success: false, msg: '沒有指定客戶' };

  const key = caDisplayCustomerName_(rawName);
  const cacheKey = 'ca_sample_v1_' + key;
  try {
    const cached = CacheManager.getLarge(cacheKey);
    if (cached) return cached;
  } catch (e) {}

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const sh = ss.getSheetByName(CONFIG.SHEET_NAME_SALES);
    if (!sh) return { success: false, msg: '找不到經銷銷售報表' };

    const lastRow = sh.getLastRow();
    const data = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getValues();

    // 標題列自動偵測（同 getSalesOverview 的做法：找同時有日期與金額的那列）
    let hIdx = 0;
    for (let i = 0; i < Math.min(25, data.length); i++) {
      const rowStr = data[i].join('');
      if (rowStr.indexOf('日期') !== -1 && (rowStr.indexOf('金額') !== -1 || rowStr.indexOf('銷額') !== -1)) { hIdx = i; break; }
    }
    const h = data[hIdx];
    const idx = {
      date: findHeaderIndex(h, ['單據日期', '銷貨日期', '日期']),
      cust: findHeaderIndex(h, ['客戶名稱', '客戶']),
      code: findHeaderIndex(h, ['產品編號', '編號', '品碼', '序號']),
      note: findHeaderIndex(h, ['備註', '說明', '案名']),
      prod: findHeaderIndex(h, ['產品名稱', '品名']),
      qty:  findHeaderIndex(h, ['數量', '片數'])
    };
    if (idx.cust === -1 || idx.date === -1) return { success: false, msg: '經銷銷售報表格式不符' };

    let lastDate = null, total = 0;
    const bySku = {};

    for (let i = hIdx + 1; i < data.length; i++) {
      const r = data[i];
      const custRaw = String(r[idx.cust] || '').trim();
      if (!custRaw || caDisplayCustomerName_(custRaw) !== key) continue;

      const sku = idx.code !== -1 ? String(r[idx.code] || '').trim() : '';
      const note = (idx.note !== -1 ? String(r[idx.note] || '') : '') + ' ' +
                   (idx.prod !== -1 ? String(r[idx.prod] || '') : '');
      if (!caIsSampleRow_(sku, note)) continue;

      const d = parseDate(r[idx.date]);
      if (!d || isNaN(d.getTime())) continue;
      const ds = Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');

      total++;
      if (!lastDate || ds > lastDate) lastDate = ds;

      // SKU 去掉 -S 尾碼後歸戶，讓「拿過樣的正式編號」對得起來
      const baseSku = String(sku).trim().toUpperCase().replace(/[\s\-]/g, '').replace(/S\d*$/, '');
      if (baseSku) {
        if (!bySku[baseSku] || ds > bySku[baseSku].date) {
          bySku[baseSku] = { date: ds, sku: sku, qty: idx.qty !== -1 ? (parseFloat(r[idx.qty]) || 0) : 0 };
        }
      }
    }

    const daysSince = lastDate
      ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000) : null;

    const out = {
      success: true,
      hasSample: total > 0,
      count: total,
      lastDate: lastDate,
      daysSince: daysSince,
      bySku: bySku
    };
    try { CacheManager.putLarge(cacheKey, out, 1800); } catch (e) {}
    return out;
  } catch (e) {
    return { success: false, msg: '樣品紀錄讀取失敗：' + e };
  }
}

// ─────────────────────────────────────────────────────────
// 業務詢問紀錄
// 存在「業務庫」(CONFIG.SS_ID_BUSINESS) 的「版面詢問紀錄」分頁。
// 選這裡的理由：版面上架清單、工作日誌、客戶備註歷史都在同一本，
// 屬於「業務日常操作產生的資料」，跟主庫存/產品那本（SS_ID_MAIN）分開。
// 分頁不存在時自動建立並寫入標題列，不需要人工先開表。
// ─────────────────────────────────────────────────────────

const CA_NOTE_SHEET = '版面詢問紀錄';
const CA_NOTE_HEADERS = ['建立時間', '客戶名稱', '版面連結', '系列', '業務姓名', '詢問內容'];

function caGetNoteSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID_BUSINESS);
  let sh = ss.getSheetByName(CA_NOTE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CA_NOTE_SHEET);
    sh.getRange(1, 1, 1, CA_NOTE_HEADERS.length).setValues([CA_NOTE_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 新增一筆版面詢問紀錄 */
function addDisplayNote(customerName, photoUrl, series, salesName, content) {
  const text = String(content || '').trim();
  if (!text) return { success: false, msg: '內容不可空白' };
  try {
    const sh = caGetNoteSheet_();
    sh.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'),
      String(customerName || '').trim(),
      String(photoUrl || '').trim(),
      String(series || '').trim(),
      String(salesName || '').trim(),
      text
    ]);
    try { CacheManager.removeLarge('ca_notes_v1_' + String(customerName || '').trim()); } catch (e) {}
    return { success: true };
  } catch (e) {
    return { success: false, msg: '寫入失敗：' + e };
  }
}

/**
 * 訪問紀錄的日期一律顯示成 2026/9/8。
 * 寫入時雖然是字串，但試算表會自動轉成日期值，讀回來是 Date 物件，
 * 直接 String() 會變成 "Tue Sep 08 2026 16:16:22 GMT+0800 (台灣標準時間)"。
 * 這裡不管拿到的是 Date 還是字串都轉成短格式。
 */
function caFmtNoteDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/M/d');
  }
  const t = String(v || '').trim();
  if (!t) return '';
  const m = t.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return m[1] + '/' + parseInt(m[2], 10) + '/' + parseInt(m[3], 10);
  const d = new Date(t);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy/M/d');
  return t;
}

/** 讀取某客戶的版面詢問紀錄，依版面連結分組 */
function getDisplayNotes(customerName) {
  const name = String(customerName || '').trim();
  if (!name) return { success: false, msg: '沒有指定客戶' };
  const cacheKey = 'ca_notes_v1_' + name;
  try {
    const cached = CacheManager.getLarge(cacheKey);
    if (cached) return cached;
  } catch (e) {}

  try {
    const sh = caGetNoteSheet_();
    const lastRow = sh.getLastRow();
    const byPhoto = {};
    if (lastRow >= 2) {
      const data = sh.getRange(2, 1, lastRow - 1, CA_NOTE_HEADERS.length).getValues();
      data.forEach(function (r) {
        if (String(r[1] || '').trim() !== name) return;
        const photo = String(r[2] || '').trim();
        if (!byPhoto[photo]) byPhoto[photo] = [];
        byPhoto[photo].push({
          time: caFmtNoteDate_(r[0]),
          series: String(r[3] || ''),
          sales: String(r[4] || ''), content: String(r[5] || '')
        });
      });
    }
    // 每個版面內由新到舊
    Object.keys(byPhoto).forEach(function (k) {
      byPhoto[k].sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); });
    });
    const out = { success: true, byPhoto: byPhoto };
    try { CacheManager.putLarge(cacheKey, out, 300); } catch (e) {}
    return out;
  } catch (e) {
    return { success: false, msg: '讀取失敗：' + e };
  }
}

/**
 * 🔧 連線自我檢查：在 Apps Script 編輯器直接執行這支，確認金鑰與連線是否正常
 */
function caSelfTest() {
  const out = { 金鑰是否已設定: !!caGetToken_() };

  const all = caGetAllCustomersCached_(true);
  out.取全客戶總表 = all && all.success
    ? ('成功，共 ' + ((all.data || []).length) + ' 家客戶')
    : ('失敗：' + (all && all.msg));

  if (all && all.success && (all.data || []).length) {
    const first = all.data[0];
    out.第一家客戶 = {
      name: first.name,
      今年業績: first.thisYearAmount,
      去年同期: first.lastYearAmount,
      YoY: first.yoyPct,
      健康度: first.health,
      最後下單: first.lastOrderDate
    };
    out.名稱對位測試 = {
      '好時光空間美學': caDisplayCustomerName_('好時光空間美學'),
      '東春建材': caDisplayCustomerName_('東春建材'),
      '專岩建材行': caDisplayCustomerName_('專岩建材行')
    };
  }

  console.log(JSON.stringify(out, null, 2));
  return out;
}
