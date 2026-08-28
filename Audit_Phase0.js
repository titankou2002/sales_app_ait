/**
 * 🔍 Phase 0 審計工具（整合版客戶分析專案）
 * ------------------------------------------------
 * 全部唯讀，不寫入任何既有資料表，不影響線上功能。
 * 目的：在動手改任何東西之前，量出「以戰情室為準」到底會動到多少資料。
 *
 * 對外入口：auditPhase0() — 一次跑完三項審計，回傳精簡摘要（可直接看 log）
 * 明細會寫進「業務庫」的 SYS_審計_* 分頁（純新增，不覆蓋既有分頁）。
 */

const AUDIT_DETAIL_SS_ID = CONFIG.SS_ID_BUSINESS;
const AUDIT_SHEET_NAME_DRIFT = 'SYS_審計_名稱漂移';
const AUDIT_SHEET_NAME_SKU = 'SYS_審計_SKU碰撞';

// ── 戰情室 displayCustomerName() 的逐行移植（SleeperService.php:56-103）──
// 順序與 break 行為都必須跟 PHP 版一致，否則審計出來的差異數字本身就不可信。

const AUDIT_CUST_SUFFIXES = [
  '企業股份有限公司', '開發有限公司', '股份有限公司', '有限公司',
  '企業', '建材', '國際', '磁磚', '磁藝', '工程', '設計部', '出貨',
  '保留收訂', '公司', '實業', '精品', '工作室', '開發', '室內裝修',
  '室內設計', '設計', '行銷', '商行', '建業', '綜合'
];

const AUDIT_CUST_EXCEPTIONS = [
  '夏綠蒂', '德思特尼', '百事得', '百達富麗', '鑫東聖', '海格斯',
  '信義星', '好仕齊', '新睦豐', '富利鴻', '金豪益'
];

/**
 * 對應 PHP normalizeCustomerName()：去括號、標點與空白
 *
 * ⚠️ 空白必須只匹配 ASCII，不能用 JS 的 \s。
 * PHP 端是 preg_replace('/[...\s]+/u', ...)，而 PCRE 在 /u 模式下 \s 仍然只匹配
 * ASCII 空白（要另外開 PCRE_UCP 才會涵蓋 Unicode 空白，PHP 預設沒開）。
 * JS 的 \s 卻會連全形空格 U+3000、NBSP U+00A0 一起吃掉——中文客戶名很常出現全形空格，
 * 若照抄 \s，同一個名字兩邊會算出不同結果，審計就會報出一堆假差異。
 */
function auditNormalizeCustomerName_(name) {
  return auditPhpTrim_(String(name == null ? '' : name))
    .replace(/[()（）【】\[\]「」『』,，.。\/／:： \t\n\r\f\v]+/g, '');
}

/**
 * PHP trim() 的預設行為：只剝 " \t\n\r\0\x0B"。
 * JS 的 .trim() 會連全形空格等 Unicode 空白一起剝，同樣會造成兩邊不一致。
 */
function auditPhpTrim_(s) {
  return s.replace(/^[ \t\n\r\0\x0B]+/, '').replace(/[ \t\n\r\0\x0B]+$/, '');
}

/** 對應 PHP displayCustomerName()：戰情室的權威規則，取前 4 字 */
function auditDisplayCustomerNameV2_(name) {
  let s = auditNormalizeCustomerName_(name);
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

  // 前二字匹配
  const prefix2 = s.substring(0, 2);
  if (prefix2 === '專岩') return '專岩';
  if (prefix2 === '禾昇') return '禾昇';

  s = s.split(/[-－—]/)[0] || s;

  for (let i = 0; i < AUDIT_CUST_EXCEPTIONS.length; i++) {
    if (s.indexOf(AUDIT_CUST_EXCEPTIONS[i]) !== -1) return AUDIT_CUST_EXCEPTIONS[i];
  }

  // 迴圈剝除公司後綴至穩定（照 PHP：找到第一個 pos>0 就 break 重跑）
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < AUDIT_CUST_SUFFIXES.length; i++) {
      const pos = s.indexOf(AUDIT_CUST_SUFFIXES[i]);
      if (pos > 0) {
        s = s.substring(0, pos);
        changed = true;
        break;
      }
    }
  }
  return s.substring(0, 4);
}

/** 標準 SKU 鍵：大寫 → 先剝 -掛/-期 → 再去空白與連字號 */
function auditNormalizeSku_(raw) {
  return String(raw == null ? '' : raw).trim().toUpperCase()
    .replace(/[-\s]*(掛|期)\s*$/, '')
    .replace(/[\s\-]/g, '');
}

/** 只大寫去空白、保留連字號（用來比對「剝連字號會不會撞在一起」） */
function auditSkuKeepHyphen_(raw) {
  return String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s/g, '');
}

// ─────────────────────────────────────────────────────────

/**
 * 審計 (v)：列出主資料庫與業務庫實際存在的分頁名稱
 * 用途：確認 Sales.js:2097 讀的「年度銷售快取」到底存不存在
 *（其他所有地方都叫「產品年度銷售快取」，而 getSheetByName 是精確比對）
 */
function auditSheetNames() {
  const out = {};
  [
    ['主資料庫 SS_ID_MAIN', CONFIG.SS_ID_MAIN],
    ['業務庫 SS_ID_BUSINESS', CONFIG.SS_ID_BUSINESS]
  ].forEach(function (pair) {
    try {
      out[pair[0]] = SpreadsheetApp.openById(pair[1]).getSheets().map(function (sh) {
        return sh.getName();
      });
    } catch (e) {
      out[pair[0]] = '讀取失敗：' + e;
    }
  });

  const names = out['主資料庫 SS_ID_MAIN'] || [];
  out['_結論'] = {
    '有「年度銷售快取」': Array.isArray(names) && names.indexOf('年度銷售快取') !== -1,
    '有「產品年度銷售快取」': Array.isArray(names) && names.indexOf('產品年度銷售快取') !== -1
  };
  return out;
}

/**
 * 審計 (ii)：客戶名稱漂移
 * 掃四張表的原始客戶名，比對 mergeCustomer / getCustomerShortName / 戰情室V2 三者
 */
function auditCustomerNameDrift() {
  const rawNames = {}; // 原始名 → {來源: true}

  function collect_(ssId, sheetName, headerRowIdx, candidates, source, splitWorklog) {
    try {
      const sh = SpreadsheetApp.openById(ssId).getSheetByName(sheetName);
      if (!sh) return;
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow <= headerRowIdx + 1) return;
      const data = sh.getRange(1, 1, lastRow, lastCol).getValues();
      const idx = findHeaderIndex(data[headerRowIdx], candidates);
      if (idx === -1) return;

      for (let i = headerRowIdx + 1; i < data.length; i++) {
        const cell = String(data[i][idx] || '').trim();
        if (!cell) continue;
        // 智能_工作日誌：一列是一位業務一天，客戶用 " || " 串接、前綴 [HH:mm]
        const pieces = splitWorklog
          ? cell.split(' || ').map(function (p) { return p.replace(/^\[\d{1,2}:\d{2}\]\s*/, '').trim(); })
          : [cell];
        pieces.forEach(function (p) {
          if (!p) return;
          if (!rawNames[p]) rawNames[p] = {};
          rawNames[p][source] = true;
        });
      }
    } catch (e) {
      console.error('【名稱審計】讀 ' + sheetName + ' 失敗：' + e);
    }
  }

  collect_(CONFIG.SS_ID_MAIN, CONFIG.SHEET_NAME_SALES, 0, ['客戶名稱', '客戶'], '經銷銷售報表', false);
  collect_(CONFIG.SS_ID_MAIN, '業務分區', 0, ['客戶名稱', '客戶'], '業務分區', false);
  // 版面上架清單的標題在第 2 列（index 1）
  collect_(CONFIG.SS_ID_BUSINESS, CONFIG.SHEET_NAME_LAYOUT, 1, ['客戶名稱', '客戶'], '版面上架清單', false);
  collect_(CONFIG.SS_ID_BUSINESS, CONFIG.SHEET_NAME_LOG, 0, ['客戶名稱', '客戶'], '智能_工作日誌', true);

  const rows = [];
  let sameAll = 0;
  const v2GroupSizes = {};

  Object.keys(rawNames).forEach(function (raw) {
    const a = mergeCustomer(raw);
    const b = getCustomerShortName(raw);
    const v2 = auditDisplayCustomerNameV2_(raw);
    v2GroupSizes[v2] = (v2GroupSizes[v2] || 0) + 1;

    const agree = (a === v2 && b === v2);
    if (agree) { sameAll++; return; }

    rows.push([
      raw,
      Object.keys(rawNames[raw]).join('、'),
      a, b, v2,
      a === v2 ? '' : 'merge≠V2',
      b === v2 ? '' : 'short≠V2'
    ]);
  });

  rows.sort(function (x, y) { return String(x[4]).localeCompare(String(y[4]), 'zh-TW'); });

  // 寫明細到審計分頁
  const ss = SpreadsheetApp.openById(AUDIT_DETAIL_SS_ID);
  let sheet = ss.getSheetByName(AUDIT_SHEET_NAME_DRIFT);
  if (!sheet) sheet = ss.insertSheet(AUDIT_SHEET_NAME_DRIFT);
  sheet.clear();
  const header = ['原始名稱', '出現於', 'mergeCustomer(前2字)', 'getCustomerShortName(前4字)', '戰情室V2(前4字)', '差異1', '差異2'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);

  const total = Object.keys(rawNames).length;
  return {
    掃到的原始名稱數: total,
    三者一致: sameAll,
    有差異: rows.length,
    差異比例: total ? (Math.round(rows.length / total * 1000) / 10) + '%' : 'n/a',
    V2歸戶後的客戶數: Object.keys(v2GroupSizes).length,
    明細分頁: AUDIT_SHEET_NAME_DRIFT,
    前20筆差異: rows.slice(0, 20)
  };
}

/**
 * 審計 (iii)：SKU 連字號碰撞
 * 若把連字號剝掉會讓兩個原本相異的編號變成同一個 key，就不能統一剝連字號
 */
function auditSkuHyphenCollision() {
  const groups = {}; // 去連字號key → Set(保留連字號的原始key)
  const skuSample = {};

  try {
    const sh = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN).getSheetByName(CONFIG.SHEET_NAME_PRODUCTS);
    if (!sh) return { error: '找不到編號價目表' };
    const lastRow = sh.getLastRow();
    const data = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getValues();
    const idxSku = findHeaderIndex(data[0], ['編號', '產品編號', '品碼']);
    if (idxSku === -1) return { error: '編號價目表找不到編號欄' };

    for (let i = 1; i < data.length; i++) {
      const raw = String(data[i][idxSku] || '').trim();
      if (!raw) continue;
      const stripped = auditNormalizeSku_(raw);
      const kept = auditSkuKeepHyphen_(raw);
      if (!stripped) continue;
      if (!groups[stripped]) groups[stripped] = {};
      groups[stripped][kept] = true;
      if (!skuSample[stripped]) skuSample[stripped] = [];
      if (skuSample[stripped].length < 6) skuSample[stripped].push(raw);
    }
  } catch (e) {
    return { error: '讀取失敗：' + e };
  }

  const collisions = [];
  Object.keys(groups).forEach(function (k) {
    const variants = Object.keys(groups[k]);
    if (variants.length > 1) collisions.push([k, variants.length, (skuSample[k] || []).join('、')]);
  });
  collisions.sort(function (a, b) { return b[1] - a[1]; });

  const ss = SpreadsheetApp.openById(AUDIT_DETAIL_SS_ID);
  let sheet = ss.getSheetByName(AUDIT_SHEET_NAME_SKU);
  if (!sheet) sheet = ss.insertSheet(AUDIT_SHEET_NAME_SKU);
  sheet.clear();
  const header = ['去連字號後的key', '會被併在一起的相異編號數', '原始編號範例'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (collisions.length) sheet.getRange(2, 1, collisions.length, header.length).setValues(collisions);

  return {
    編號價目表SKU數: Object.keys(groups).length,
    碰撞組數: collisions.length,
    結論: collisions.length === 0
      ? '零碰撞 → 可以安全統一成「大寫+去連字號+剝掛期」'
      : '有碰撞 → 不可剝連字號，改成讓 A 與 B 向戰情室的 cleanSku 靠攏',
    明細分頁: AUDIT_SHEET_NAME_SKU,
    前20組碰撞: collisions.slice(0, 20)
  };
}

/**
 * 🎯 一次跑完 Phase 0 的三項資料審計
 */
function auditPhase0() {
  const result = {
    執行時間: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
    '(v)分頁名稱': auditSheetNames(),
    '(ii)客戶名稱漂移': auditCustomerNameDrift(),
    '(iii)SKU連字號碰撞': auditSkuHyphenCollision()
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
