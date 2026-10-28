/**
 * 庫存與保留量「標準算法」（2026-10-27 定案，全系統共用這一份規則）
 *
 *  1. 來源：高雅瓷一律讀「庫存機器人表單」(1WpBX…) 的「庫存表」「保留單」；讀不到才退回內部管理(1G5q)的同名複本。
 *     安帝嘉、喜悅納各讀自己的保留表與庫存表。
 *  2. 單位：以「片數」為準，坪＝片 ÷ 片/坪（編號價目表，缺值用 36）。不用庫存表的「坪數」欄
 *     （那欄是每列各自四捨五入到 0.01，加總會有誤差）。
 *  3. 庫存表：品名含「小計」的列不算；編號正規化（大寫、去空白與連字號）後加總。
 *  4. 保留單：「訂金確認」「業務更新（或最新進度）」含 結案／取消／刪除／過期釋出 的列，不佔庫存。
 *     （前三個字眼跟試算表自己的刪除線條件式格式一致；過期釋出是逾期未付訂被放掉的保留。）
 *     客戶名含「樣品」「扣帶」的列：照算（STOCK_RULE.excludeCustomerWords 要排除時再填）。
 *  5. 可用 ＝ 庫存 － 保留（可以是負的，代表保留超賣）。
 *
 * 修改規則只改這個檔案。睡美人戰情室 (PHP) 的對應實作在 classes/InventoryHistory.php 與
 * classes/traits/DataTrait.php（getStockStd／getReservationStd），兩邊要一起改。
 */
var STOCK_RULE = {
  releasedWords: ['結案', '取消', '刪除', '過期釋出'],
  excludeCustomerWords: [],
  defaultPerPing: 36
};

function stockRuleSku_(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/[\s\-]+/g, '');
}

/** 這筆保留單是否「不佔庫存」 */
function stockRuleIsReleased_(deposit, progress) {
  const text = String(deposit || '') + ' ' + String(progress || '');
  for (let i = 0; i < STOCK_RULE.releasedWords.length; i++) {
    if (text.indexOf(STOCK_RULE.releasedWords[i]) >= 0) return true;
  }
  return false;
}

function stockRuleExcludesCustomer_(cust) {
  const c = String(cust || '');
  for (let i = 0; i < STOCK_RULE.excludeCustomerWords.length; i++) {
    if (c.indexOf(STOCK_RULE.excludeCustomerWords[i]) >= 0) return true;
  }
  return false;
}

function stockRuleFindCol_(headers, aliases) {
  const norm = h => String(h == null ? '' : h).replace(/[\s﻿]+/g, '');
  for (let a = 0; a < aliases.length; a++) {
    for (let i = 0; i < headers.length; i++) {
      if (norm(headers[i]) === aliases[a]) return i;
    }
  }
  return -1;
}

/**
 * 庫存表 → { 編號: 片數 }。
 * 高雅瓷優先讀 1WpBX 的庫存表，缺「編號」「片數」欄或讀不到就退回內部管理複本。
 * 庫存表沒有「片數」欄（舊格式只有坪數）時，用坪數 × 片/坪 換回片數。
 * @param {Object} perPingOf  (code) => 片/坪
 * @return {{map:Object, source:string}}
 */
function stockRuleReadStock_(br, perPingOf) {
  const b = br ? getBranch_(br) : getBranch_();
  const candidates = [];
  if (b.reserveSS && b.reserveSS !== b.dbSS) candidates.push(b.reserveSS); // 正式主檔優先（高雅瓷）
  candidates.push(b.dbSS);
  let lastErr = '';
  for (let c = 0; c < candidates.length; c++) {
    try {
      const sh = SpreadsheetApp.openById(candidates[c]).getSheetByName('庫存表');
      if (!sh) { lastErr = '沒有庫存表分頁'; continue; }
      const rows = sh.getDataRange().getValues();
      if (rows.length < 2) { lastErr = '庫存表沒有資料'; continue; }
      const h = rows[0];
      const iCode = stockRuleFindCol_(h, ['編號', '產品編號']);
      const iName = stockRuleFindCol_(h, ['品名']);
      let iPcs = stockRuleFindCol_(h, ['片數', '庫存片數']);
      const iPing = stockRuleFindCol_(h, ['坪數', '庫存坪數']);
      if (iCode < 0 || (iPcs < 0 && iPing < 0)) { lastErr = '庫存表缺編號或數量欄'; continue; }
      const map = {};
      for (let i = 1; i < rows.length; i++) {
        const code = stockRuleSku_(rows[i][iCode]);
        if (!code) continue;
        if (iName >= 0 && String(rows[i][iName]).indexOf('小計') >= 0) continue;
        let pcs;
        if (iPcs >= 0) pcs = parseFloat(String(rows[i][iPcs] == null ? '' : rows[i][iPcs]).replace(/,/g, ''));
        else pcs = (parseFloat(String(rows[i][iPing] == null ? '' : rows[i][iPing]).replace(/,/g, '')) || 0) * ((perPingOf && perPingOf(code)) || STOCK_RULE.defaultPerPing);
        if (isNaN(pcs)) continue;
        map[code] = (map[code] || 0) + pcs;
      }
      return { map: map, source: (candidates[c] === b.dbSS ? '內部管理(複本)' : '庫存機器人表單') };
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error('讀不到庫存表：' + lastErr);
}

/**
 * 保留單 → { 編號: {pieces, count} }（只算佔庫存的）。
 */
function stockRuleReadReserve_(br) {
  const b = br ? getBranch_(br) : getBranch_();
  const sh = SpreadsheetApp.openById(b.reserveSS).getSheetByName(b.sheetName);
  const rows = sh.getDataRange().getValues();
  const h = rows[0];
  const iCode = stockRuleFindCol_(h, ['編號', '產品編號']);
  const iQty = stockRuleFindCol_(h, ['數量', '片數']);
  const iProg = stockRuleFindCol_(h, ['業務更新', '最新進度']);
  const iDep = stockRuleFindCol_(h, ['訂金確認']);
  const iCust = stockRuleFindCol_(h, ['客戶']);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const code = stockRuleSku_(rows[i][iCode >= 0 ? iCode : 0]);
    if (!code) continue;
    if (stockRuleIsReleased_(iDep >= 0 ? rows[i][iDep] : '', iProg >= 0 ? rows[i][iProg] : '')) continue;
    if (iCust >= 0 && stockRuleExcludesCustomer_(rows[i][iCust])) continue;
    const qty = parseFloat(String(rows[i][iQty >= 0 ? iQty : 1] == null ? '' : rows[i][iQty >= 0 ? iQty : 1]).replace(/,/g, '')) || 0;
    if (!map[code]) map[code] = { pieces: 0, count: 0 };
    map[code].pieces += qty;
    map[code].count += 1;
  }
  return map;
}

/**
 * 業務庫存卡（Inventory.js）要的「庫存表」分頁：高雅瓷優先用 1WpBX 的（有「編號」「片數」欄才用），否則回傳 null 讓呼叫端退回舊來源。
 */
function stockRuleLiveStockSheet_() {
  try {
    if (typeof CONFIG === 'undefined' || !CONFIG.RESERVE_SS_ID) return null;
    const sh = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID).getSheetByName('庫存表');
    if (!sh || sh.getLastRow() < 2) return null;
    const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (stockRuleFindCol_(h, ['編號']) < 0 || stockRuleFindCol_(h, ['片數']) < 0) return null;
    return sh;
  } catch (e) {
    return null;
  }
}
