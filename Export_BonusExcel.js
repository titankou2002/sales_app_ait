/**
 * 📥 業務獎金精算 — 區間匯出 Excel
 *
 * 設計原則：
 *  1. 計算邏輯 100% 沿用 Sales.js 的 _computeAdminBonusReport，本檔一行都不重算，
 *     避免匯出的數字跟畫面上的對不起來。
 *  2. 跨月匯出時，銷貨表/同行價/睡美人/系列/配送資料「只讀一次」共用（見 _loadBonusContext_），
 *     否則 5 個月會把整張銷貨表讀 5 遍，容易撞 google.script.run 的 6 分鐘上限。
 *  3. GAS 不能直接產 .xlsx：先建暫存 Google 試算表 → 套版面 → 用 export?format=xlsx
 *     轉成真正的 Excel blob → 存 Drive 給下載連結 → 暫存表刪掉。
 */

const BONUS_EXPORT_FOLDER_NAME = '獎金報表匯出(暫存)';
const BONUS_EXPORT_KEEP_DAYS = 7; // 匯出檔保留天數，超過自動清掉

/**
 * 🗂️ 一次載入所有月份共用的資料來源
 */
function _loadBonusContext_(year) {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
  const salesSheet = ss.getSheetByName(SALES_CONFIG.SHEET_SALES);
  const salesData = salesSheet.getDataRange().getValues();
  const sh = salesData[0];
  const deliveryRes = getDeliveryBonusData(year);
  return {
    ss: ss,
    activeConfig: getActiveBonusConfig(),
    salesData: salesData,
    sIdx: {
      date: findHeaderIndex(sh, ["單據日期", "銷貨日期", "日期"]),
      sales: findHeaderIndex(sh, ["負責業務", "業務", "負責人", "業務員"]),
      amt: findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
      cust: findHeaderIndex(sh, ["客戶名稱", "客戶"]),
      custCode: findHeaderIndex(sh, ["客戶編號", "客戶代碼"]),
      note: findHeaderIndex(sh, ["備註", "說明"]),
      code: findHeaderIndex(sh, ["產品編號", "編號", "品碼", "序號"]),
      qty: findHeaderIndex(sh, ["數量", "片數"]),
      price: findHeaderIndex(sh, ["單價", "成交單價"])
    },
    peerPriceMap: getPeerPriceMap(ss),
    deliveryMap: deliveryRes.success ? deliveryRes.data : {},
    sleeperMap: getSleeperConfigMap(ss),
    seriesMap: getSeriesMap(ss)
  };
}

/**
 * 🧾 產生一行純文字算式（Excel 用，對應畫面上的「系統試算」）
 */
function _bonusFormulaText_(p) {
  const wan = function(v) {
    return (Math.round(Number(v) || 0) / 10000).toFixed(1).replace(/\.0$/, '') + '萬';
  };
  const usd = function(v) { return '$' + (Math.round(Number(v) || 0)).toLocaleString('en-US'); };
  const rule = p.rule;
  if (!rule) return '未設定獎金規則';

  let s = '';
  if (p.monthlySales < rule.minThreshold) {
    s += '實銷 ' + wan(p.monthlySales) + ' 未達門檻 ' + wan(rule.minThreshold) + ' → 達成獎金 $0';
  } else {
    s += '實銷 ' + wan(p.monthlySales)
       + ' − 基底 ' + wan(rule.stepBase)
       + ' = ' + wan(p.exceed)
       + ' ÷ ' + wan(rule.stepValue)
       + ' = ' + p.steps + ' 級 × ' + usd(rule.stepBonus)
       + ' = ' + usd(p.baseBonus);
  }
  s += '　＋　突破 ' + (p.breakthroughBonus > 0
        ? usd(p.breakthroughBonus) + '（達 ' + wan(p.reachedBreakthroughLimit) + '）'
        : '$0');
  s += '　＝　獎金小計 ' + usd(p.totalBonus);
  return s;
}

/**
 * 📥 主要進入點：匯出指定年份、起訖月份的獎金精算 Excel
 * @param {number} year 西元年
 * @param {number} startMonthIdx 起始月 (0-based，1月=0)
 * @param {number} endMonthIdx 結束月 (0-based)
 * @return {{success:boolean, url?:string, fileName?:string, msg?:string}}
 */
function exportBonusRangeToExcel_impl_(year, startMonthIdx, endMonthIdx) {
  try {
    const y = parseInt(year);
    let mStart = parseInt(startMonthIdx);
    let mEnd = parseInt(endMonthIdx);
    if (isNaN(y) || isNaN(mStart) || isNaN(mEnd)) {
      return { success: false, msg: '年份或月份參數不正確' };
    }
    if (mStart > mEnd) { const t = mStart; mStart = mEnd; mEnd = t; }
    mStart = Math.max(0, Math.min(11, mStart));
    mEnd = Math.max(0, Math.min(11, mEnd));

    // ── 1. 一次載入資料，逐月計算（共用 context，不重複讀表）
    const ctx = _loadBonusContext_(y);
    const months = [];
    for (let m = mStart; m <= mEnd; m++) {
      const res = _computeAdminBonusReport(y, m, ctx);
      if (!res.success) return { success: false, msg: (m + 1) + ' 月計算失敗：' + res.msg };
      months.push({ monthIdx: m, data: res.data });
    }

    // ── 2. 決定要不要留「運費扣除」欄（整個區間都是 0 就整欄拿掉）
    let hasFreight = false;
    months.forEach(function(mo) {
      mo.data.salespeople.forEach(function(p) {
        if (Math.round(p.freightDeductionAmount || 0) !== 0) hasFreight = true;
      });
    });

    const globalConfig = months[0].data.globalConfig;
    const built = _buildBonusSheet_(y, mStart, mEnd, months, hasFreight, globalConfig);

    // ── 3. 轉 xlsx → 存 Drive → 拿下載連結
    const fileName = '業務獎金精算_' + y + '年'
      + String(mStart + 1).padStart(2, '0') + '-' + String(mEnd + 1).padStart(2, '0') + '月_'
      + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd_HHmm') + '.xlsx';

    const url = _exportSpreadsheetAsXlsx_(built.ssId, fileName);

    // ── 4. 暫存試算表刪掉，順手清理過期匯出檔
    try { DriveApp.getFileById(built.ssId).setTrashed(true); } catch (e) {}
    _cleanupOldBonusExports_();

    return { success: true, url: url, fileName: fileName, hasFreight: hasFreight };
  } catch (e) {
    return { success: false, msg: '匯出失敗：' + e.toString() };
  }
}

/**
 * 🎨 建立暫存試算表並套上版面
 */
function _buildBonusSheet_(year, mStart, mEnd, months, hasFreight, globalConfig) {
  const title = year + ' 年 ' + (mStart + 1) + ' 月 ~ ' + (mEnd + 1) + ' 月　業務業績獎金精算表';
  const ss = SpreadsheetApp.create('__tmp_bonus_export_' + Date.now());
  const sheet = ss.getSheets()[0];
  sheet.setName((mStart + 1) + '-' + (mEnd + 1) + '月獎金精算');

  // 欄位定義（依 hasFreight 動態組）
  const cols = [
    { key: 'month',    head: '月份',      width: 62,  type: 'text' },
    { key: 'name',     head: '業務姓名',  width: 96,  type: 'text' },
    { key: 'sales',    head: '當月實銷',  width: 108, type: 'money' }
  ];
  if (hasFreight) cols.push({ key: 'freight', head: '運費扣除', width: 96, type: 'money' });
  cols.push(
    { key: 'base',     head: '達成獎金',  width: 92,  type: 'money' },
    { key: 'bt',       head: '突破獎金',  width: 92,  type: 'money' },
    { key: 'total',    head: '獎金小計',  width: 100, type: 'money' },
    { key: 'share',    head: '內勤提撥',  width: 92,  type: 'money' },
    { key: 'net',      head: '業績實領',  width: 100, type: 'money' },
    { key: 'delivery', head: '配送',      width: 84,  type: 'money' },
    { key: 'actual',   head: '實領',      width: 108, type: 'money' },
    { key: 'formula',  head: '系統試算說明（原始值，手改後不會更新）', width: 520, type: 'text' }
  );
  const nCol = cols.length;

  const HEAD_ROW = 4;
  const FIRST_DATA_ROW = HEAD_ROW + 1;

  // 欄位 key → Excel 欄號（A/B/C…），用來組公式
  const L = {};
  cols.forEach(function(c, i) { L[c.key] = _colLetter_(i + 1); });
  const shareRate = globalConfig.STAFF_SHARE_RATE;

  const rows = [];              // 二維資料（含 = 開頭的公式字串）
  const styleRows = [];         // 每列樣式：'data' | 'sub' | 'grand'
  const subtotalRowNums = [];   // 各月小計所在列號，供全期合計相加
  const sumKeys = ['sales', 'freight', 'base', 'bt', 'total', 'share', 'net', 'delivery', 'actual'];
  let rowNum = FIRST_DATA_ROW;

  months.forEach(function(mo) {
    const label = (mo.monthIdx + 1) + '月';
    const firstRow = rowNum;

    mo.data.salespeople.forEach(function(p) {
      const r = rowNum;
      // 💡 衍生欄位一律寫成公式，讓小姐直接在 Excel 改「達成/突破/獎金小計」時，
      //    內勤提撥 → 業績實領 → 實領 → 小計 → 合計 會自己連動。
      const vals = {
        month:    label,
        name:     p.name,
        sales:    Math.round(p.monthlySales || 0),
        freight:  Math.round(p.freightDeductionAmount || 0),
        base:     p.baseBonus || 0,
        bt:       p.breakthroughBonus || 0,
        total:    '=' + L.base + r + '+' + L.bt + r,
        share:    '=ROUND(' + L.total + r + '*' + shareRate + ')',
        net:      '=' + L.total + r + '-' + L.share + r,
        delivery: p.deliveryBonus || 0,
        actual:   '=' + L.net + r + '+' + L.delivery + r,
        formula:  _bonusFormulaText_(p)
      };
      rows.push(cols.map(function(c) { return vals[c.key]; }));
      styleRows.push('data');
      rowNum++;
    });

    // 月小計：SUM 該月資料列
    const lastRow = rowNum - 1;
    const subRow = cols.map(function(c) {
      if (c.key === 'month') return label;
      if (c.key === 'name') return '小計';
      if (sumKeys.indexOf(c.key) === -1) return '';
      if (lastRow < firstRow) return 0;
      return '=SUM(' + L[c.key] + firstRow + ':' + L[c.key] + lastRow + ')';
    });
    rows.push(subRow);
    styleRows.push('sub');
    subtotalRowNums.push(rowNum);
    rowNum++;
  });

  // 全期合計：相加各月小計（不重複加資料列）
  const grandRow = cols.map(function(c) {
    if (c.key === 'month') return '合計';
    if (c.key === 'name') return (mStart + 1) + '~' + (mEnd + 1) + '月';
    if (sumKeys.indexOf(c.key) === -1) return '';
    if (!subtotalRowNums.length) return 0;
    return '=' + subtotalRowNums.map(function(n) { return L[c.key] + n; }).join('+');
  });
  rows.push(grandRow);
  styleRows.push('grand');

  // ── 標題區
  // ⚠️ 這裡刻意「不用 merge」：下面有 setFrozenColumns(2)，而橫跨整列的合併儲存格
  //    會被凍結線切斷，Google 會丟「無法凍結僅包含部分合併儲存格的欄」。
  //    改成只寫進 A 欄、關掉自動換行，讓文字往右溢出，視覺效果一樣。
  sheet.getRange(1, 1, 1, nCol).setBackground('#0f172a');
  sheet.getRange(1, 1)
    .setValue(title)
    .setFontSize(16).setFontWeight('bold').setFontColor('#ffffff')
    .setHorizontalAlignment('left').setVerticalAlignment('middle').setWrap(false);
  sheet.setRowHeight(1, 40);

  const sub2 = '產生時間：' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm')
    + '　│　內勤提撥 ' + Math.round(globalConfig.STAFF_SHARE_RATE * 100) + '%'
    + '　│　低於同行價 ' + Math.round(globalConfig.PEER_PRICE_DISCOUNT_THRESHOLD * 100) + '% 之業績以 '
    + Math.round(globalConfig.PEER_PRICE_ADJUSTMENT_FACTOR * 100) + '% 採計'
    + (hasFreight ? '' : '　│　本區間無運費扣除')
    + '　│　灰色欄位為公式，改「達成／突破／配送」會自動連動到實領與合計';
  sheet.getRange(2, 1, 1, nCol).setBackground('#f1f5f9');
  sheet.getRange(2, 1)
    .setValue(sub2)
    .setFontSize(10).setFontColor('#475569')
    .setHorizontalAlignment('left').setVerticalAlignment('middle').setWrap(false);
  sheet.setRowHeight(2, 24);
  sheet.setRowHeight(3, 8);

  // ── 表頭
  const headRange = sheet.getRange(HEAD_ROW, 1, 1, nCol);
  headRange.setValues([cols.map(function(c) { return c.head; })])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1e293b')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(HEAD_ROW, 32);

  // ── 資料
  // ⚠️ 月份/姓名兩欄先鎖成純文字再寫入，否則像「1~8月」這種字串會被 Sheets 當日期解析掉。
  sheet.getRange(FIRST_DATA_ROW, 1, rows.length, 2).setNumberFormat('@');
  sheet.getRange(FIRST_DATA_ROW, 1, rows.length, nCol).setValues(rows);

  // 數字格式（0 顯示為 – ，負數紅色）
  const moneyFmt = '"$"#,##0;[Red]-"$"#,##0;"–"';
  cols.forEach(function(c, i) {
    if (c.type === 'money') {
      sheet.getRange(FIRST_DATA_ROW, i + 1, rows.length, 1)
        .setNumberFormat(moneyFmt).setHorizontalAlignment('right');
    }
  });

  // 逐列上色（交替底色 + 小計/合計）
  const bgs = [];
  const fonts = [];
  const colors = [];
  let dataSeq = 0;
  styleRows.forEach(function(kind) {
    let bg, weight, color;
    if (kind === 'grand')      { bg = '#0f172a'; weight = 'bold';   color = '#ffffff'; dataSeq = 0; }
    else if (kind === 'sub')   { bg = '#e2e8f0'; weight = 'bold';   color = '#0f172a'; dataSeq = 0; }
    else                       { bg = (dataSeq++ % 2 === 0) ? '#ffffff' : '#f8fafc'; weight = 'normal'; color = '#1e293b'; }
    bgs.push(new Array(nCol).fill(bg));
    fonts.push(new Array(nCol).fill(weight));
    colors.push(new Array(nCol).fill(color));
  });
  sheet.getRange(FIRST_DATA_ROW, 1, rows.length, nCol)
    .setBackgrounds(bgs).setFontWeights(fonts).setFontColors(colors)
    .setVerticalAlignment('middle');

  // 業務姓名欄加粗、月份欄置中
  sheet.getRange(FIRST_DATA_ROW, 1, rows.length, 1).setHorizontalAlignment('center');
  sheet.getRange(FIRST_DATA_ROW, 2, rows.length, 1).setFontWeight('bold');

  // 「實領」欄綠色強調
  const actualCol = _colIndexOf_(cols, 'actual');
  sheet.getRange(FIRST_DATA_ROW, actualCol, rows.length, 1).setFontWeight('bold');

  // 算式欄：小字、換行、灰字
  const formulaCol = _colIndexOf_(cols, 'formula');
  sheet.getRange(FIRST_DATA_ROW, formulaCol, rows.length, 1)
    .setWrap(true).setFontSize(9).setFontColor('#64748b').setHorizontalAlignment('left');

  // ── 框線
  sheet.getRange(HEAD_ROW, 1, rows.length + 1, nCol)
    .setBorder(true, true, true, true, true, true, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(HEAD_ROW, 1, 1, nCol)
    .setBorder(null, null, true, null, null, null, '#0f172a', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // ── 欄寬 / 凍結 / 收尾
  cols.forEach(function(c, i) { sheet.setColumnWidth(i + 1, c.width); });
  sheet.setFrozenRows(HEAD_ROW);
  sheet.setFrozenColumns(2);
  const maxCols = sheet.getMaxColumns();
  if (maxCols > nCol) sheet.deleteColumns(nCol + 1, maxCols - nCol);
  const usedRows = FIRST_DATA_ROW + rows.length - 1;
  const maxRows = sheet.getMaxRows();
  if (maxRows > usedRows) sheet.deleteRows(usedRows + 1, maxRows - usedRows);
  sheet.setHiddenGridlines(true);
  SpreadsheetApp.flush();

  return { ssId: ss.getId() };
}

/**
 * 📤 把 Google 試算表轉成真正的 .xlsx 存進 Drive，回傳下載連結
 */
function _exportSpreadsheetAsXlsx_(ssId, fileName) {
  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx&id=' + ssId;
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('轉檔失敗 (HTTP ' + resp.getResponseCode() + ')');
  }
  const blob = resp.getBlob().setName(fileName);
  const folder = _getBonusExportFolder_();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?export=download&id=' + file.getId();
}

function _getBonusExportFolder_() {
  const it = DriveApp.getFoldersByName(BONUS_EXPORT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BONUS_EXPORT_FOLDER_NAME);
}

/**
 * 🧹 清掉超過保留天數的匯出檔（避免 Drive 越積越多）
 */
function _cleanupOldBonusExports_() {
  try {
    const cutoff = new Date().getTime() - BONUS_EXPORT_KEEP_DAYS * 24 * 60 * 60 * 1000;
    const files = _getBonusExportFolder_().getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated().getTime() < cutoff) {
        try { f.setTrashed(true); } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('清理匯出檔失敗', e);
  }
}

function _colLetter_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function _colIndexOf_(cols, key) {
  for (let i = 0; i < cols.length; i++) { if (cols[i].key === key) return i + 1; }
  return 1;
}
