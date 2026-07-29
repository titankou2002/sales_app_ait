/**
 * 版面記錄神器 - 後端核心 (戰情室旗艦版)
 */

function getScriptProp_(key) {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
  } catch (e) {
    return '';
  }
}

function getScriptPropOrDefault_(key, fallback) {
  const val = getScriptProp_(key);
  return val || fallback;
}

const CONFIG = {
  VERSION: "v1.3.1",
  SHEET_NAME_LAYOUT: "版面上架清單",
  SHEET_NAME_LOG: "智能_工作日誌",
  SHEET_NAME_GPS: "SYS_GPS_MAP",
  SHEET_NAME_PRODUCTS: "編號價目表",
  SHEET_NAME_SALES: "經銷銷售報表",
  SS_ID: getScriptPropOrDefault_('SS_ID', '1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0'), // 業務庫
  SS_ID_MAIN: getScriptPropOrDefault_('SS_ID_MAIN', '1G5q-GixMWSdJJeF8ZiXWMOfrx4FMobER25jNc8m4Zds'), // 主庫存與產品
  SS_ID_BUSINESS: getScriptPropOrDefault_('SS_ID_BUSINESS', '1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0'), // 業務與版面紀錄
  RESERVE_SS_ID: getScriptPropOrDefault_('RESERVE_SS_ID', '1WpBX1Bj-H0_452itfV38B7aIywRsqh-LTUKRfAkxpVs'), // 保留單專用試算表
  SHEET_NAME_RESERVE: "保留單", 
  IMG_FOLDER_ID: getScriptPropOrDefault_('IMG_FOLDER_ID', '1Yu_-1AXmH7fgVRuAcmABZMkYziaZebY2')
};

/**
 * 🚀 取得業務試算表物件 (版面上架、智能日誌、GPS)
 */
function getSafeSsBusiness() {
  let ss = null;
  try { ss = SpreadsheetApp.openById(CONFIG.SS_ID_BUSINESS); } catch(e) { console.warn(e); }
  if (!ss) throw new Error("無法連線至業務試算表(Business DB)。");
  return ss;
}

/**
 * 🚀 取得主庫試算表物件 (編號價目表、銷售報表、業務分區)
 */
function getSafeSsMain() {
  let ss = null;
  try { ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN); } catch(e) { console.warn(e); }
  if (!ss) throw new Error("無法連線至主庫試算表(Main DB)。");
  return ss;
}

/**
 * 🔐 產生業務專屬的加密直達金鑰 (8碼MD5)
 */
function getSalesDirectKey(salesName) {
  if (!salesName) return '';
  const salt = "AIT_SECRET_SALT_2026";
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, salesName + salt);
  let hashStr = "";
  for (let i = 0; i < rawHash.length; i++) {
    let byteVal = rawHash[i];
    if (byteVal < 0) byteVal += 256;
    let byteString = byteVal.toString(16);
    if (byteString.length == 1) byteString = "0" + byteString;
    hashStr += byteString;
  }
  return hashStr.substring(0, 8);
}

/**
 * 🧪 測試用：把 GAS 算出的張三金鑰寫到試算表 Z1 儲存格
 */
function writeTestKeyToSheet() {
  try {
    const ss = getSafeSsMain();
    const sheet = ss.getSheetByName("業務分區");
    sheet.getRange("Z1").setValue(getSalesDirectKey("張三"));
    return "成功寫入 Z1";
  } catch(e) {
    return "錯誤: " + e.message;
  }
}

/**
 * 📝 記錄業務查庫存的行為至 log 工作表 (維持原有 8 欄位格式)
 */
function logSalespersonSearch(salesName, q, sz, minP, minQ) {
  try {
    const ss = SpreadsheetApp.openById("1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0"); // 業務庫
    const logSheet = ss.getSheetByName("LOG") || ss.getSheetByName("log") || ss.getSheetByName("智能_工作日誌");
    if (!logSheet) return { success: false, msg: "找不到日誌表" };
    
    // 取得業務權限等級
    let level = "sales";
    try {
      const wlSheet = ss.getSheetByName("白名單");
      if (wlSheet) {
        const wlData = wlSheet.getDataRange().getValues();
        const row = wlData.find(r => String(r[2]).trim() === String(salesName).trim()); // 名字在第3欄 (索引2)
        if (row) level = String(row[1]).toUpperCase(); // 等級在第2欄 (索引1)
      }
    } catch(e){}
    
    let queryParts = [];
    if (q) queryParts.push(`關鍵字: ${q}`);
    if (sz) queryParts.push(`尺寸: ${sz}`);
    if (minP > 0) queryParts.push(`低標坪數: ${minP}`);
    if (minQ > 0) queryParts.push(`低標片數: ${minQ}`);
    
    const inputStr = `直達查詢庫存: ` + queryParts.join(", ");
    
    logSheet.appendRow([
      new Date(),
      "INVENTORY_DIRECT",
      "DIRECT_ACCESS",
      salesName,
      level,
      inputStr,
      "網頁版極速過濾查詢"
    ]);
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 👔 取得所有業務的直達金鑰清單 (供管理端或後台查閱，整合手動新增與失效名單)
 */
function getSalesKeysList() {
  const salesRes = getSalesList();
  let baseList = [];
  if (salesRes && salesRes.success && salesRes.data) {
    baseList = salesRes.data;
  }
  
  // 合併手動新增的業務名單
  const props = PropertiesService.getScriptProperties();
  let customSales = [];
  try {
    customSales = JSON.parse(props.getProperty("DIRECT_ACCESS_CUSTOM") || "[]");
  } catch(e){}
  
  const allSales = Array.from(new Set([...baseList, ...customSales]));
  
  // 取得已失效/已停用的業務名單
  let blockedSales = [];
  try {
    blockedSales = JSON.parse(props.getProperty("DIRECT_ACCESS_BLOCKED") || "[]");
  } catch(e){}
  
  const list = [];
  allSales.forEach(name => {
    if (!name) return;
    const isBlocked = blockedSales.includes(name);
    list.push({
      name: name,
      key: getSalesDirectKey(name),
      isBlocked: isBlocked,
      url: "?view=inventory&sales=" + encodeURIComponent(name) + "&key=" + getSalesDirectKey(name)
    });
  });
  return { success: true, data: list };
}

/**
 * 📝 記錄金鑰管理操作至專屬內部業務試算表 (Business DB) 的「LOG」分頁中 (具備自動建立與格式化)
 */
function logAdminKeyAction_(actionType, targetSales, detail) {
  try {
    const ss = getSafeSsBusiness(); // 連結至 1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0 業務表單
    let logSheet = ss.getSheetByName("LOG");
    
    // 🚀 自癒防禦機制：若 LOG 分頁不存在，自動插入並初始化頂部欄位與格式
    if (!logSheet) {
      logSheet = ss.insertSheet("LOG");
      logSheet.appendRow(["操作時間", "功能代碼", "類別", "操作人", "身分等級", "詳細內容", "執行備註"]);
      logSheet.getRange("A1:G1")
              .setFontWeight("bold")
              .setBackground("#1f2937") // 暗灰色精緻標題背景
              .setFontColor("#facc15")  // 黃金色標題字
              .setHorizontalAlignment("center");
      logSheet.setFrozenRows(1);
      // 自動調整欄寬
      logSheet.autoResizeColumns(1, 7);
    }
    
    logSheet.appendRow([
      new Date(),
      "ADMIN_KEY_ACTION",
      "DIRECT_ACCESS",
      "ADMIN",
      "ADMIN",
      `金鑰操作：${actionType} [${targetSales}]`,
      detail || ""
    ]);
  } catch (e) {
    console.warn("Log key action error:", e);
  }
}

/**
 * ➕ 新增直達同仁並發配金鑰
 */
function addDirectSalesperson(name) {
  name = String(name || '').trim();
  if (!name) return { success: false, msg: "姓名不能為空" };
  
  const props = PropertiesService.getScriptProperties();
  let customSales = [];
  try {
    customSales = JSON.parse(props.getProperty("DIRECT_ACCESS_CUSTOM") || "[]");
  } catch(e){}
  
  if (!customSales.includes(name)) {
    customSales.push(name);
    props.setProperty("DIRECT_ACCESS_CUSTOM", JSON.stringify(customSales));
  }
  
  // 如果之前被停用過，自動解除停用
  let blockedSales = [];
  try {
    blockedSales = JSON.parse(props.getProperty("DIRECT_ACCESS_BLOCKED") || "[]");
  } catch(e){}
  if (blockedSales.includes(name)) {
    blockedSales = blockedSales.filter(n => n !== name);
    props.setProperty("DIRECT_ACCESS_BLOCKED", JSON.stringify(blockedSales));
  }
  
  const generatedKey = getSalesDirectKey(name);
  logAdminKeyAction_("發佈並配發金鑰", name, `金鑰 ${generatedKey} 已成功啟用`);
  return { success: true, msg: "同仁「" + name + "」新增成功並已成功配發金鑰！" };
}

/**
 * ❌ 一鍵停用/失效業務金鑰
 */
function revokeDirectSalesperson(name) {
  name = String(name || '').trim();
  if (!name) return { success: false, msg: "姓名不能為空" };
  
  const props = PropertiesService.getScriptProperties();
  let blockedSales = [];
  try {
    blockedSales = JSON.parse(props.getProperty("DIRECT_ACCESS_BLOCKED") || "[]");
  } catch(e){}
  
  if (!blockedSales.includes(name)) {
    blockedSales.push(name);
    props.setProperty("DIRECT_ACCESS_BLOCKED", JSON.stringify(blockedSales));
  }
  
  logAdminKeyAction_("註銷並停用金鑰", name, "專屬網址已停用失效");
  return { success: true, msg: "同仁「" + name + "」的直達金鑰已成功失效！" };
}

/**
 * 🟢 一鍵恢復啟用業務金鑰
 */
function enableDirectSalesperson(name) {
  name = String(name || '').trim();
  if (!name) return { success: false, msg: "姓名不能為空" };
  
  const props = PropertiesService.getScriptProperties();
  let blockedSales = [];
  try {
    blockedSales = JSON.parse(props.getProperty("DIRECT_ACCESS_BLOCKED") || "[]");
  } catch(e){}
  
  blockedSales = blockedSales.filter(n => n !== name);
  props.setProperty("DIRECT_ACCESS_BLOCKED", JSON.stringify(blockedSales));
  
  logAdminKeyAction_("恢復並啟用金鑰", name, "專屬網址已重新恢復啟用");
  return { success: true, msg: "同仁「" + name + "」的直達金鑰已重新恢復啟用！" };
}

/**
 * 🛡️ 前端金鑰全局安全校正 API (方案 1 核心)
 */
function verifySalesKey(sales, key) {
  sales = String(sales || '').trim();
  key = String(key || '').trim();
  if (!sales || !key) return { success: false, msg: "資訊不完整" };
  
  const expectedKey = getSalesDirectKey(sales);
  
  // 檢查是否被停用
  let blockedSales = [];
  try {
    blockedSales = JSON.parse(PropertiesService.getScriptProperties().getProperty("DIRECT_ACCESS_BLOCKED") || "[]");
  } catch(e){}
  
  if (key === expectedKey && !blockedSales.includes(sales)) {
    return { success: true };
  }
  return { success: false, msg: "金鑰已失效或無效存取" };
}

/**
 * 🛡️ 客戶直達安全驗證 API (免登入免 LINE 綁定)
 */
function verifyClientDirectAccess(clientName, key) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) return { success: false, isAuthorized: false, msg: "找不到白名單" };
    
    const data = wlSheet.getDataRange().getValues();
    const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    const idx = {
      name: findHeaderIndex(h, ["名字", "姓名"]),
      level: findHeaderIndex(h, ["等級"]),
      company: findHeaderIndex(h, ["公司", "客戶"]),
      key: findHeaderIndex(h, ["金鑰", "安全金鑰", "KEY"])
    };
    
    if (idx.name === -1 || idx.key === -1) {
      return { success: false, isAuthorized: false, msg: "資料表格式不符" };
    }
    
    const user = data.find(r => {
      const nameMatch = String(r[idx.name]).trim() === String(clientName).trim();
      if (!key) return nameMatch; // 鬆散對位模式：金鑰為空時只比對名字
      return nameMatch && String(r[idx.key]).trim() === String(key).trim();
    });
    
    if (!user) {
      return { success: true, isAuthorized: false, msg: key ? "安全金鑰或姓名不正確" : "找不到白名單登記客戶" };
    }
    
    // 同時預載入產品資訊，讓客戶直達讀取進度更順暢
    const productsRes = getClientFullData();
    const products = (productsRes && productsRes.success) ? productsRes.data : [];
    
    return {
      success: true,
      isAuthorized: true,
      name: user[idx.name],
      level: String(user[idx.level]).toLowerCase(),
      company: user[idx.company],
      products: products
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🔑 取得白名單客戶的預期金鑰
 */
function getClientDirectKey(clientName) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) return "";
    const data = wlSheet.getDataRange().getValues();
    const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    const idxName = findHeaderIndex(h, ["名字", "姓名"]);
    const idxKey = findHeaderIndex(h, ["金鑰", "安全金鑰", "KEY"]);
    if (idxName === -1 || idxKey === -1) return "";
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idxName]).trim() === String(clientName).trim()) {
        return String(data[i][idxKey]).trim();
      }
    }
  } catch(e) {}
  return "";
}

/**
 * 👔 取得真正的業務/業務助理名單（白名單「等級」欄 = sales 或 KING，且狀態為 approved）
 * 全知視角等內部管理畫面用這份名單，排除一般客戶端 free/Premium 帳號
 */
function getSalesStaffNames() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'sales_staff_names_v2';
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const names = [];
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const wlSheet = ss.getSheetByName("白名單");
    if (wlSheet) {
      const data = wlSheet.getDataRange().getValues();
      const h = data[0].map(v => String(v || '').replace(/[\s﻿]/g, '').trim());
      const idxLevel = findHeaderIndex(h, ["等級"]);
      const idxName = findHeaderIndex(h, ["名字", "姓名"]);
      const idxStatus = findHeaderIndex(h, ["狀態"]);

      const seen = new Set();
      for (let i = 1; i < data.length; i++) {
        const level = idxLevel !== -1 ? String(data[i][idxLevel] || '').trim().toUpperCase() : '';
        if (level !== 'SALES' && level !== 'KING') continue;
        if (idxStatus !== -1) {
          const status = String(data[i][idxStatus] || '').trim().toLowerCase();
          if (status && status !== 'approved') continue;
        }
        let name = idxName !== -1 ? String(data[i][idxName] || '').trim() : '';
        if (!name) continue;
        name = name.replace(/^高雅瓷-/, '').trim(); // 去除品牌前綴，例如「高雅瓷-高弘治」→「高弘治」
        if (!seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
    }
  } catch (e) {
    console.warn("getSalesStaffNames error: " + e);
  }

  try { cache.put(cacheKey, JSON.stringify(names), 600); } catch (e) {}
  return names;
}

/**
 * 👥 讀取客戶白名單 (自動升級金鑰欄位與自動補鍵值)
 */
function getClientWhitelist() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    let wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) return { success: true, data: [] };
    
    let data = wlSheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };
    
    let h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    let idxKey = findHeaderIndex(h, ["金鑰", "安全金鑰", "KEY"]);
    
    if (idxKey === -1) {
      wlSheet.getRange(1, h.length + 1).setValue("安全金鑰")
        .setFontWeight("bold")
        .setBackground("#1f2937")
        .setFontColor("#facc15")
        .setHorizontalAlignment("center");
      SpreadsheetApp.flush();
      data = wlSheet.getDataRange().getValues();
      h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
      idxKey = h.length - 1;
    }
    
    const idx = {
      uid: findHeaderIndex(h, ["USERID", "LINEID"]),
      name: findHeaderIndex(h, ["名字", "姓名"]),
      level: findHeaderIndex(h, ["等級"]),
      company: findHeaderIndex(h, ["公司", "客戶", "公司/客戶"]),
      key: idxKey
    };
    
    const list = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[idx.name] && !row[idx.company]) continue;
      
      let clientKey = idx.key !== -1 ? String(row[idx.key] || '').trim() : '';
      if (!clientKey) {
        clientKey = "C" + Math.random().toString(36).substring(2, 10).toUpperCase();
        wlSheet.getRange(i + 1, idx.key + 1).setValue(clientKey);
        row[idx.key] = clientKey;
      }
      
      list.push({
        rowIdx: i + 1,
        uid: idx.uid !== -1 ? String(row[idx.uid] || '').trim() : '',
        name: idx.name !== -1 ? String(row[idx.name] || '').trim() : '',
        level: idx.level !== -1 ? String(row[idx.level] || '').trim() : 'LEVEL 2',
        company: idx.company !== -1 ? String(row[idx.company] || '').trim() : '',
        key: clientKey
      });
    }
    
    return { success: true, data: list };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function addOrBatchClients(clientsList) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    let wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) {
      wlSheet = ss.insertSheet("白名單");
      wlSheet.appendRow(["LINEID", "姓名", "等級", "公司/客戶", "安全金鑰"]);
      wlSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#1f2937").setFontColor("#facc15").setHorizontalAlignment("center");
      wlSheet.setFrozenRows(1);
    }
    
    let data = wlSheet.getDataRange().getValues();
    let h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    let idxKey = findHeaderIndex(h, ["金鑰", "安全金鑰", "KEY"]);
    
    if (idxKey === -1) {
      wlSheet.getRange(1, h.length + 1).setValue("安全金鑰")
        .setFontWeight("bold")
        .setBackground("#1f2937")
        .setFontColor("#facc15")
        .setHorizontalAlignment("center");
      SpreadsheetApp.flush();
      data = wlSheet.getDataRange().getValues();
      h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
      idxKey = h.length - 1;
    }
    
    let idxUid = findHeaderIndex(h, ["USERID", "LINEID"]);
    const idx = {
      uid: idxUid,
      name: findHeaderIndex(h, ["名字", "姓名"]),
      level: findHeaderIndex(h, ["等級"]),
      company: findHeaderIndex(h, ["公司", "客戶", "公司/客戶"]),
      key: idxKey
    };
    
    const addedNames = [];
    const newRows = [];
    
    clientsList.forEach(c => {
      const name = String(c.name || '').trim();
      const company = String(c.company || '').trim();
      const level = String(c.level || 'LEVEL 2').trim();
      const uid = String(c.uid || '').trim();
      
      if (!name && !company) return;
      
      let duplicateRowIdx = -1;
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowName = idx.name !== -1 ? String(row[idx.name] || '').trim() : '';
        const rowCompany = idx.company !== -1 ? String(row[idx.company] || '').trim() : '';
        const rowUid = idx.uid !== -1 ? String(row[idx.uid] || '').trim() : '';
        const uidMatches = uid && rowUid && uid === rowUid;
        const nameCompMatches = rowName === name && rowCompany === company;
        if (uidMatches || nameCompMatches) {
          duplicateRowIdx = i + 1;
          break;
        }
      }
      
      if (duplicateRowIdx === -1) {
        const rowData = new Array(h.length).fill("");
        if (idx.uid !== -1) rowData[idx.uid] = uid;
        if (idx.name !== -1) rowData[idx.name] = name;
        if (idx.level !== -1) rowData[idx.level] = level;
        if (idx.company !== -1) rowData[idx.company] = company;
        if (idx.key !== -1) {
          rowData[idx.key] = "C" + Math.random().toString(36).substring(2, 10).toUpperCase();
        }
        newRows.push(rowData);
        addedNames.push(`${name}(${company})`);
      } else {
        if (idx.uid !== -1 && uid) wlSheet.getRange(duplicateRowIdx, idx.uid + 1).setValue(uid);
        if (idx.name !== -1 && name) wlSheet.getRange(duplicateRowIdx, idx.name + 1).setValue(name);
        if (idx.level !== -1 && level) wlSheet.getRange(duplicateRowIdx, idx.level + 1).setValue(level);
        if (idx.company !== -1 && company) wlSheet.getRange(duplicateRowIdx, idx.company + 1).setValue(company);
      }
    });
    
    if (newRows.length > 0) {
      wlSheet.getRange(wlSheet.getLastRow() + 1, 1, newRows.length, h.length).setValues(newRows);
      logAdminKeyAction_("批量新增客戶", "ADMIN", `新增客戶: ${addedNames.join(", ")}`);
    }
    
    return { success: true, msg: `成功儲存外部客戶名單！` };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function removeClientFromWhitelist(rowIdx) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) return { success: false, msg: "找不到白名單工作表" };
    
    const data = wlSheet.getDataRange().getValues();
    const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    const idxName = findHeaderIndex(h, ["名字", "姓名"]);
    const idxComp = findHeaderIndex(h, ["公司", "客戶", "公司/客戶"]);
    
    const name = idxName !== -1 ? wlSheet.getRange(rowIdx, idxName + 1).getValue() : '';
    const company = idxComp !== -1 ? wlSheet.getRange(rowIdx, idxComp + 1).getValue() : '';
    
    wlSheet.deleteRow(rowIdx);
    logAdminKeyAction_("刪除外部客戶", "ADMIN", `移除客戶: ${name} (${company})`);
    
    return { success: true, msg: "客戶已成功移出白名單！" };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🤖 讀取 LINE 機器人白名單 (內部管理, CONFIG.SS_ID_MAIN)
 */
function getLineBotWhitelist() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    let wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) return { success: true, data: [] };
    
    ensureLineBotWhitelistHeaders_(wlSheet);
    let data = wlSheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };
    
    let h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    
    const idx = {
      uid: findHeaderIndex(h, ["USERID", "LINEID"]),
      name: findHeaderIndex(h, ["名字", "姓名"]),
      level: findHeaderIndex(h, ["等級"]),
      company: findHeaderIndex(h, ["公司", "客戶"]),
      status: findHeaderIndex(h, ["狀態"])
    };
    
    const list = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const uid = idx.uid !== -1 ? String(row[idx.uid] || '').trim() : '';
      const name = idx.name !== -1 ? String(row[idx.name] || '').trim() : '';
      const company = idx.company !== -1 ? String(row[idx.company] || '').trim() : '';
      const status = idx.status !== -1 ? String(row[idx.status] || 'approved').trim() : 'approved';
      
      if (!uid && !name && !company) continue;
      
      list.push({
        rowIdx: i + 1,
        uid: uid,
        name: name,
        level: idx.level !== -1 ? String(row[idx.level] || 'free').trim() : 'free',
        company: company,
        status: status
      });
    }
    
    return { success: true, data: list };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * ➕ 新增或編輯 LINE 機器人白名單 (同步至物流白名單)
 */
function addOrBatchLineClients(clientsList) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    let wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) {
      wlSheet = ss.insertSheet("白名單");
      wlSheet.appendRow(["userid", "等級", "名字", "協定業務 ID", "EMAIL", "公司", "狀態"]);
      wlSheet.getRange("A1:G1").setFontWeight("bold").setBackground("#1f2937").setFontColor("#facc15").setHorizontalAlignment("center");
      wlSheet.setFrozenRows(1);
    } else {
      ensureLineBotWhitelistHeaders_(wlSheet);
    }
    
    let data = wlSheet.getDataRange().getValues();
    let h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    
    const idx = {
      uid: findHeaderIndex(h, ["USERID", "LINEID"]),
      name: findHeaderIndex(h, ["名字", "姓名"]),
      level: findHeaderIndex(h, ["等級"]),
      company: findHeaderIndex(h, ["公司"]),
      status: findHeaderIndex(h, ["狀態"])
    };
    
    clientsList.forEach(c => {
      const company = String(c.company || '').trim();
      const name = String(c.name || '').trim();
      const fullName = company ? (company + "-" + name) : name;
      const level = String(c.level || 'free').trim();
      const uid = String(c.uid || '').trim();
      const status = String(c.status || 'approved').trim();
      
      if (!uid) return;
      
      let duplicateRowIdx = -1;
      if (idx.uid !== -1) {
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][idx.uid]).trim() === uid) {
            duplicateRowIdx = i + 1;
            break;
          }
        }
      }
      
      if (duplicateRowIdx === -1) {
        const rowData = new Array(h.length).fill("");
        if (idx.uid !== -1) rowData[idx.uid] = uid;
        if (idx.name !== -1) rowData[idx.name] = fullName;
        if (idx.level !== -1) rowData[idx.level] = level;
        if (idx.company !== -1) rowData[idx.company] = company;
        if (idx.status !== -1) rowData[idx.status] = status;
        wlSheet.appendRow(rowData);
        
        if (uid && status === "approved") {
          sendLinePushFromKeyVault_(uid, "🎉 您的 AI 查詢與物流查詢權限已核准開通！😊");
          syncToLogisticsWhitelist_(uid, name, company, "add");
        }
      } else {
        const prevStatus = idx.status !== -1 ? String(wlSheet.getRange(duplicateRowIdx, idx.status + 1).getValue() || '').trim() : '';
        
        if (idx.name !== -1) wlSheet.getRange(duplicateRowIdx, idx.name + 1).setValue(fullName);
        if (idx.level !== -1) wlSheet.getRange(duplicateRowIdx, idx.level + 1).setValue(level);
        if (idx.company !== -1) wlSheet.getRange(duplicateRowIdx, idx.company + 1).setValue(company);
        if (idx.status !== -1) wlSheet.getRange(duplicateRowIdx, idx.status + 1).setValue(status);
        
        if (uid && status === "approved" && (prevStatus === "待審核" || !prevStatus)) {
          sendLinePushFromKeyVault_(uid, "🎉 您的 AI 查詢與物流查詢權限已核准開通！😊");
          syncToLogisticsWhitelist_(uid, name, company, "add");
        } else if (uid && status === "待審核") {
          syncToLogisticsWhitelist_(uid, name, company, "delete");
        }
      }
    });
    
    return { success: true, msg: `成功儲存 LINE 機器人白名單！` };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * ❌ 移除 LINE 機器人白名單
 */
function removeLineClientFromWhitelist(rowIdx) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) return { success: false, msg: "找不到白名單工作表" };
    
    ensureLineBotWhitelistHeaders_(wlSheet);
    const data = wlSheet.getDataRange().getValues();
    const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    const idxUid = findHeaderIndex(h, ["USERID", "LINEID"]);
    const idxName = findHeaderIndex(h, ["名字", "姓名"]);
    const idxComp = findHeaderIndex(h, ["公司"]);
    
    const name = idxName !== -1 ? wlSheet.getRange(rowIdx, idxName + 1).getValue() : '';
    const company = idxComp !== -1 ? wlSheet.getRange(rowIdx, idxComp + 1).getValue() : '';
    const uid = idxUid !== -1 ? wlSheet.getRange(rowIdx, idxUid + 1).getValue() : '';
    
    wlSheet.deleteRow(rowIdx);
    logAdminKeyAction_("刪除 LINE 機器人白名單", "ADMIN", `移除 LINE 好友: ${name} (${company})`);
    
    if (uid) {
      syncToLogisticsWhitelist_(uid, name, company, "delete");
    }
    
    return { success: true, msg: "客戶已成功從 LINE 白名單中移除！" };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function ensureLineBotWhitelistHeaders_(wlSheet) {
  const data = wlSheet.getDataRange().getValues();
  const headers = data[0].map(v => String(v || '').trim());
  const required = ["userid", "等級", "名字", "協定業務 ID", "EMAIL", "公司", "狀態"];
  
  let changed = false;
  required.forEach(req => {
    const exists = headers.some(h => h.replace(/[\s\uFEFF]/g, '').toLowerCase() === req.replace(/[\s\uFEFF]/g, '').toLowerCase());
    if (!exists) {
      headers.push(req);
      changed = true;
    }
  });
  
  if (changed) {
    wlSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    wlSheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground("#1f2937")
      .setFontColor("#facc15")
      .setHorizontalAlignment("center");
  }
}

/**
 * 🔄 同步到物流庫 (LOGISTICS_SS_ID) -> 經銷商白名單
 */
function syncToLogisticsWhitelist_(uid, name, company, action) {
  try {
    const logisSsId = '1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA';
    const logisSs = SpreadsheetApp.openById(logisSsId);
    const logisSheet = logisSs.getSheetByName("經銷商白名單");
    if (logisSheet) {
      const data = logisSheet.getDataRange().getValues();
      const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
      const idx = {
        uid: findHeaderIndex(h, ["USERID", "LINEID"]),
        name: findHeaderIndex(h, ["名字", "姓名"]),
        company: findHeaderIndex(h, ["公司"])
      };

      if (idx.uid !== -1) {
        let existingRow = -1;
        const cleanUid = String(uid).trim();
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][idx.uid]).trim() === cleanUid) {
            existingRow = i + 1;
            break;
          }
        }

        if (action === "delete") {
          if (existingRow !== -1) {
            logisSheet.deleteRow(existingRow);
          }
        } else {
          if (existingRow !== -1) {
            if (idx.name !== -1) logisSheet.getRange(existingRow, idx.name + 1).setValue(name);
            if (idx.company !== -1) logisSheet.getRange(existingRow, idx.company + 1).setValue(company);
          } else {
            const rowData = new Array(h.length).fill("");
            rowData[idx.uid] = cleanUid;
            if (idx.name !== -1) rowData[idx.name] = name;
            if (idx.company !== -1) rowData[idx.company] = company;
            logisSheet.appendRow(rowData);
          }
        }
      }
    }
  } catch (e) {
    console.warn("同步至物流白名單失敗:", e);
  }
}

function doGet(e) {
  const params = e.parameter || {};
  // 🚀 自訂網域相容性極致修復：若自訂網頁 iframe 僅轉發 sales 與 key，我們將客戶名稱包裝在 sales 中 (CLIENT_客戶名稱)
  if (params.sales && params.sales.startsWith("CLIENT_")) {
    params.clientName = params.sales.replace("CLIENT_", "");
    params.view = 'client';
  }
  if (params.clientName) {
    params.view = 'client';
  }
  
  // 👔 業務直達金鑰與網址總表生成管理後台
  if (params.view === 'getkeys') {
    const res = getSalesKeysList();
    if (!res.success) {
      return HtmlService.createHtmlOutput("<h1 style='color:red;'>無法載入業務名單: " + res.msg + "</h1>");
    }
    const clientRes = getClientWhitelist();
    const clientsData = clientRes.success ? clientRes.data : [];
    const lineRes = getLineBotWhitelist();
    const lineData = lineRes.success ? lineRes.data : [];
    
    // 🔀 排序邏輯
    if (res.data) {
      res.data.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'));
    }
    
    clientsData.sort((a, b) => {
      const compA = String(a.company || '');
      const compB = String(b.company || '');
      if (compA !== compB) return compA.localeCompare(compB, 'zh-TW');
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW');
    });
    
    lineData.sort((a, b) => {
      const isPendingA = a.status === '待審核';
      const isPendingB = b.status === '待審核';
      if (isPendingA && !isPendingB) return -1;
      if (!isPendingA && isPendingB) return 1;
      const compA = String(a.company || '');
      const compB = String(b.company || '');
      if (compA !== compB) return compA.localeCompare(compB, 'zh-TW');
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW');
    });
    
    let html = `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <base target="_top">
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
      <title>高雅瓷機密中心</title>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
        /* ========== 日間模式（預設）========== */
        :root {
          --bg-color: #f5f0e8;
          --panel-bg: #ffffff;
          --neon-cyan: #0284c7;
          --neon-pink: #db2777;
          --neon-green: #16a34a;
          --neon-yellow: #b45309;
          --pixel-white: #1f2937;
          --pixel-gray: #6b7280;
          --surface-1: #ffffff;
          --surface-2: #f0ebe3;
          --surface-3: #faf7f2;
          --surface-input: #ffffff;
          --surface-topbar: rgba(245, 240, 232, 0.95);
          --crt-opacity: 0.3;
          --inline-bg: #faf7f2;
          --inline-input: #ffffff;
        }
        /* ========== 夜間模式（賽博龐克）========== */
        .dark-mode {
          --bg-color: #0c0914;
          --panel-bg: #161226;
          --neon-cyan: #00f0ff;
          --neon-pink: #ff007f;
          --neon-green: #39ff14;
          --neon-yellow: #fffb00;
          --pixel-white: #f0f0f5;
          --pixel-gray: #7a7593;
          --surface-1: #161226;
          --surface-2: #1a1530;
          --surface-3: #17122a;
          --surface-input: #000000;
          --surface-topbar: rgba(12, 9, 20, 0.95);
          --crt-opacity: 1;
          --inline-bg: #17122a;
          --inline-input: #0d0a1a;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          background-color: var(--bg-color);
          color: var(--pixel-white);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Microsoft JhengHei", Arial, sans-serif;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          position: relative;
          min-height: 100vh;
        }

        /* CRT Scanline Overlay */
        body::after {
          content: " ";
          display: block;
          position: fixed;
          top: 0; left: 0; bottom: 0; right: 0;
          background: linear-gradient(
            rgba(18, 16, 16, 0) 50%, 
            rgba(0, 0, 0, 0.04) 50%
          );
          z-index: 99999;
          background-size: 100% 2px;
          pointer-events: none;
          opacity: var(--crt-opacity);
        }

        .topbar {
          position: sticky;
          top: 0;
          z-index: 20;
          background: var(--surface-topbar);
          backdrop-filter: blur(12px);
          border-bottom: 2px solid var(--neon-cyan);
          box-shadow: 0 0 15px rgba(0, 240, 255, 0.25);
        }

        .nav {
          max-width: 1600px;
          margin: 0 auto;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          gap: 12px;
        }
        .nav-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .theme-toggle {
          background: var(--surface-3);
          border: 2px solid var(--neon-cyan);
          color: var(--neon-cyan);
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 700;
          transition: all 0.25s;
          white-space: nowrap;
        }
        .theme-toggle:hover {
          filter: brightness(1.15);
        }

        .brand h1 {
          font-size: 22px;
          font-weight: 900;
          color: var(--neon-cyan);
          text-shadow: none;
          letter-spacing: 0.5px;
        }

        .brand p {
          color: var(--neon-pink);
          font-size: 13px;
          margin-top: 3px;
          text-shadow: none;
          font-weight: bold;
        }

        .wrap {
          max-width: 1600px;
          margin: 0 auto;
          padding: 24px 20px 40px;
          width: 100%;
          flex: 1;
        }

        /* 💎 Tabs CSS */
        .tabs-container {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
          border-bottom: 2px solid var(--pixel-gray);
          padding-bottom: 12px;
          width: 100%;
        }

        .tab-btn {
          background: var(--surface-2);
          color: var(--pixel-gray);
          border: 2px solid var(--pixel-gray);
          padding: 10px 20px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
          transition: all 0.25s;
          outline: none;
        }

        .tab-btn:hover {
          background: var(--neon-cyan);
          color: #fff;
          border-color: var(--neon-cyan);
        }

        .tab-btn.active {
          background: var(--neon-pink);
          color: #fff;
          border-color: var(--neon-pink);
          box-shadow: 0 0 15px rgba(255, 0, 127, 0.6);
        }

        .tab-content {
          display: none;
        }

        .tab-content.active {
          display: block;
        }

        /* 📊 Dashboard Grid */
        .dashboard-grid {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 20px;
        }

        @media (max-width: 900px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
        }

        .panel-card {
          background: var(--panel-bg);
          border: 2px solid var(--neon-cyan);
          border-radius: 14px;
          padding: 24px;
          box-shadow: 0 0 15px rgba(0, 240, 255, 0.2), 0 4px 10px rgba(0,0,0,0.5);
          height: fit-content;
        }

        .panel-card h3 {
          font-size: 20px;
          font-weight: 800;
          color: var(--neon-cyan);
          margin-bottom: 18px;
          border-bottom: 2px solid rgba(0, 240, 255, 0.2);
          padding-bottom: 8px;
          letter-spacing: 0.5px;
          text-shadow: none;
        }

        .panel-pink {
          border-color: var(--neon-pink);
          box-shadow: 0 0 15px rgba(255, 0, 127, 0.2), 0 4px 10px rgba(0,0,0,0.5);
        }

        .panel-pink h3 {
          color: var(--neon-pink);
          border-bottom-color: rgba(255, 0, 127, 0.2);
          text-shadow: none;
        }

        .form-group {
          margin-bottom: 16px;
        }

        label {
          display: block;
          color: var(--neon-cyan);
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-shadow: none;
        }

        .panel-pink label {
          color: var(--neon-pink);
          text-shadow: none;
        }

        input, select, textarea {
          width: 100%;
          height: 42px;
          border-radius: 8px;
          border: 2px solid var(--pixel-gray);
          background: var(--surface-input);
          color: var(--pixel-white);
          text-shadow: none;
          outline: none;
          padding: 0 14px;
          font-size: 16px;
          transition: all 0.3s;
          font-family: inherit;
        }

        input:focus, select:focus, textarea:focus {
          border-color: var(--neon-cyan);
          color: var(--pixel-white);
          text-shadow: none;
        }

        select {
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg fill='%230284c7' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/><path d='M0 0h24v24H0z' fill='none'/></svg>");
          background-repeat: no-repeat;
          background-position: right 10px center;
        }
        .dark-mode select {
          background-image: url("data:image/svg+xml;utf8,<svg fill='%2300f0ff' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/><path d='M0 0h24v24H0z' fill='none'/></svg>");
        }

        textarea {
          height: auto;
          padding: 12px 14px;
          resize: vertical;
          line-height: 1.5;
        }

        .btn {
          width: 100%;
          height: 42px;
          border-radius: 8px;
          background: var(--neon-pink);
          color: #ffffff;
          font-weight: bold;
          border: 2px solid var(--neon-pink);
          cursor: pointer;
          font-size: 14px;
          transition: all 0.25s;
          box-shadow: 0 0 10px rgba(255,0,127,0.4);
        }

        .btn:hover {
          filter: brightness(1.2);
          box-shadow: 0 0 15px rgba(255, 0, 127, 0.7);
        }

        .btn-green {
          background: var(--neon-cyan);
          box-shadow: 0 0 10px rgba(0,240,255,0.4);
          color: #ffffff;
          border-color: var(--neon-cyan);
        }

        .btn-green:hover {
          box-shadow: 0 0 15px rgba(0, 240, 255, 0.7);
        }

        .btn:active {
          transform: scale(0.98);
        }

        .btn:disabled {
          background: var(--surface-2);
          color: var(--pixel-gray);
          border-color: var(--pixel-gray);
          cursor: not-allowed;
          box-shadow: none;
        }

        /* 📋 Table design */
        .table-container {
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        th {
          text-align: left;
          color: var(--neon-yellow);
          font-weight: bold;
          padding: 14px 12px;
          border-bottom: 2px solid var(--neon-cyan);
          background-color: var(--surface-2);
          text-shadow: none;
          font-size: 15px;
        }

        td {
          padding: 14px 12px;
          border-bottom: 1px dashed var(--pixel-gray);
          vertical-align: middle;
          background-color: transparent;
        }

        tr:hover td {
          background-color: var(--surface-2);
        }

        .blocked-row td {
          background-color: rgba(255, 0, 127, 0.05);
          color: var(--pixel-gray);
        }
        .dark-mode .blocked-row td {
          background-color: rgba(255, 0, 127, 0.05);
        }

        /* Status Badges */
        .tag {
          display: inline-flex;
          padding: 4px 8px;
          border: 2px solid;
          font-size: 11px;
          font-weight: 800;
        }

        .tag-active {
          border-color: var(--neon-green);
          color: var(--neon-green);
          background: rgba(57, 255, 20, 0.05);
          text-shadow: none;
        }

        .tag-disabled {
          border-color: var(--neon-pink);
          color: var(--neon-pink);
          background: rgba(255, 0, 127, 0.05);
          text-shadow: none;
        }

        /* Codes & Buttons */
        code {
          background: var(--surface-3);
          color: var(--neon-cyan);
          padding: 4px 8px;
          border-radius: 6px;
          font-family: monospace;
          font-size: 13px;
          border: 1px solid var(--neon-cyan);
          text-shadow: none;
        }

        .copy-btn {
          background: var(--surface-3);
          border: 2px solid var(--neon-cyan);
          border-radius: 6px;
          color: var(--neon-cyan);
          padding: 6px 12px;
          font-size: 11px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .copy-btn:hover {
          background: var(--neon-cyan);
          color: #fff;
          box-shadow: 0 0 10px var(--neon-cyan);
        }

        /* 3D Pressed Active Animations */
        .btn:active, .btn-green:active, .copy-btn:active, .tab-btn:active, .act-btn:active {
          transform: translateY(2px) scale(0.96) !important;
          box-shadow: 0 0 3px rgba(0, 240, 255, 0.1) !important;
          transition: transform 0.05s ease !important;
        }
        .att-sub-btn {
          background: var(--surface-2); border: 1px solid var(--neon-cyan); color: var(--neon-cyan);
          padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; transition: all 0.2s;
        }
        .att-sub-btn:hover { background: var(--neon-cyan); color: #fff; }
        .att-sub-btn.active { background: var(--neon-cyan); color: #fff; font-weight: bold; }
        .att-table { width:100%; border-collapse:collapse; font-size:13px; }
        .att-table th { background:var(--surface-2); color:var(--neon-cyan); padding:8px 10px; text-align:left; border-bottom:1px solid var(--neon-cyan); white-space:nowrap; }
        .att-table td { padding:8px 10px; border-bottom:1px solid var(--pixel-gray); color:var(--pixel-white); vertical-align:middle; }
        .att-table tr:hover td { background:var(--surface-2); }
        .badge-ok { background:#0a3a0a; color:#0f0; border-radius:4px; padding:2px 8px; font-size:12px; }
        .badge-late { background:#3a2000; color:orange; border-radius:4px; padding:2px 8px; font-size:12px; }
        .badge-absent { background:#3a0000; color:#f55; border-radius:4px; padding:2px 8px; font-size:12px; }
        .badge-leave { background:#1a1a3a; color:#aaf; border-radius:4px; padding:2px 8px; font-size:12px; }
        .badge-pending { background:#2a2a00; color:#ff0; border-radius:4px; padding:2px 8px; font-size:12px; }
        .badge-approved { background:#0a3a0a; color:#0f0; border-radius:4px; padding:2px 8px; font-size:12px; }
        .badge-rejected { background:#3a0000; color:#f55; border-radius:4px; padding:2px 8px; font-size:12px; }

        .act-btn {
          background: none;
          border: none;
          color: var(--neon-cyan);
          cursor: pointer;
          font-size: 12px;
          font-weight: 800;
          text-decoration: underline;
          margin-right: 12px;
          transition: all 0.15s ease;
        }

        .act-btn.disabled-btn {
          color: var(--neon-pink);
        }

        .act-btn:hover {
          color: var(--pixel-white);
        }
        .dark-mode .act-btn:hover {
          color: #fff;
        }

        /* Toast Alert */
        #toast {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--surface-3);
          border: 2px solid var(--neon-pink);
          color: var(--pixel-white);
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: bold;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s;
          pointer-events: none;
          box-shadow: 0 0 15px rgba(255, 0, 127, 0.5);
        }

        /* 📊 業績獎金精算與折半明細報表專屬美化 (去除所有霓虹光暈，改為清晰高質感，加大字體) */
        #bonus-report-container, 
        #bonus-report-container * {
          text-shadow: none !important;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Microsoft JhengHei", Arial, sans-serif !important;
        }

        #bonus-report-container table {
          font-size: 17px !important;
        }

        #bonus-report-container .table-container {
          overflow-x: auto;
        }

        #bonus-report-container table {
          min-width: 1500px;
        }

        #bonus-report-container th {
          font-size: 17px !important;
          color: #ffeb3b !important; /* 精美無光暈黃色 */
          background-color: #1a1530 !important;
          border-bottom: 2px solid var(--neon-cyan) !important;
          padding: 14px 12px !important;
          text-shadow: none !important;
        }

        #bonus-report-container td {
          font-size: 17px !important;
          padding: 14px 12px !important;
          text-shadow: none !important;
        }

        .dark-mode #bonus-report-container tr:hover td {
          background-color: #17122a !important;
        }
        #bonus-report-container tr:hover td {
          background-color: #e5e0d8 !important;
        }

        #bonus-report-container code {
          font-size: 15px !important;
          text-shadow: none !important;
        }

        #bonus-report-container .copy-btn {
          font-size: 14px !important;
          text-shadow: none !important;
          padding: 8px 16px !important;
        }

        /* 詳細折半明細表格的字體大小微調 */
        #bonus-report-container table.discount-table {
          font-size: 15px !important;
          min-width: 1450px;
        }

        #bonus-report-container table.discount-table th,
        #bonus-report-container table.discount-table td {
          font-size: 15px !important;
          padding: 10px 8px !important;
        }

        .dark-mode #bonus-report-container .bonus-sheet-wrap {
          background: rgba(255,255,255,0.03) !important;
          border: 1px solid rgba(255,255,255,0.15) !important;
          border-radius: 6px;
          padding: 10px;
          color: #fff !important;
        }
        #bonus-report-container .bonus-sheet-wrap {
          background: #faf7f2 !important;
          border: 1px solid #d1d5db !important;
          border-radius: 6px;
          padding: 10px;
          color: #1f2937 !important;
        }

        .dark-mode #bonus-report-container table.bonus-sheet-table {
          background: rgba(255,255,255,0.02) !important;
          color: #fff !important;
          font-size: 11px !important;
        }
        #bonus-report-container table.bonus-sheet-table {
          width: 100%;
          min-width: 980px;
          table-layout: fixed;
          border-collapse: collapse;
          background: #f0ebe3 !important;
          color: #1f2937 !important;
          font-size: 11px !important;
        }

        .dark-mode #bonus-report-container table.bonus-sheet-table th,
        .dark-mode #bonus-report-container table.bonus-sheet-table td {
          border: 1px solid rgba(255,255,255,0.18) !important;
          color: #fff !important;
          background: rgba(255,255,255,0.02) !important;
          text-shadow: none !important;
        }
        #bonus-report-container table.bonus-sheet-table th,
        #bonus-report-container table.bonus-sheet-table td {
          border: 1px solid #d1d5db !important;
          padding: 3px 4px !important;
          text-align: center !important;
          vertical-align: middle !important;
          font-size: 11px !important;
          color: #1f2937 !important;
          background: #ffffff !important;
          text-shadow: none !important;
          word-break: break-word;
        }

        #bonus-report-container table.bonus-sheet-table tbody td:first-child {
          font-size: 13px !important;
          font-weight: 800 !important;
          letter-spacing: 0.2px;
        }

        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(2),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(3),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(4),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(5),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(6),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(7),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(8),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(9),
        #bonus-report-container table.bonus-sheet-table tbody td:nth-child(10) {
          font-size: 15px !important;
          font-weight: 900 !important;
        }

        .dark-mode #bonus-report-container table.bonus-sheet-table th.group-head {
          background: rgba(255,255,255,0.18) !important;
        }
        #bonus-report-container table.bonus-sheet-table th.group-head {
          background: #f0ebe3 !important;
          font-weight: 700 !important;
          font-size: 12px !important;
        }

        .dark-mode #bonus-report-container table.bonus-sheet-table th.sub-head {
          background: rgba(255,255,255,0.12) !important;
          color: #8bdcff !important;
        }
        #bonus-report-container table.bonus-sheet-table th.sub-head {
          background: #f0ebe3 !important;
          color: #0284c7 !important;
          font-weight: 700 !important;
          font-size: 10px !important;
        }

        .dark-mode #bonus-report-container table.bonus-sheet-table tbody tr:nth-child(even) td {
          background: rgba(255,255,255,0.04) !important;
        }
        #bonus-report-container table.bonus-sheet-table tbody tr:nth-child(even) td {
          background: #f0ebe3 !important;
        }

        .dark-mode #bonus-report-container table.bonus-sheet-table tfoot td {
          background: rgba(255,255,255,0.08) !important;
        }
        #bonus-report-container table.bonus-sheet-table tfoot td {
          background: #f0ebe3 !important;
          font-size: 15px !important;
          font-weight: 900 !important;
        }

        .dark-mode #bonus-report-container .bonus-sheet-input {
          color: #fff !important;
        }
        #bonus-report-container .bonus-sheet-input {
          width: 100%;
          border: none !important;
          outline: none !important;
          background: transparent !important;
          font-size: 15px !important;
          color: #1f2937 !important;
          text-align: center;
          font-weight: 900;
          padding: 0 !important;
          box-shadow: none !important;
        }

        #bonus-report-container .bonus-deduct-input {
          color: #ff6b6b !important;
          font-weight: 700 !important;
        }

        #bonus-report-container .bonus-deduct-text {
          color: #ff6b6b !important;
          font-weight: 700 !important;
        }

        #bonus-report-container .bonus-deduct-head {
          color: #ff6b6b !important;
        }

        #bonus-report-container .bonus-sheet-toolbar {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: nowrap;
        }

        #bonus-report-container .bonus-sheet-toolbar .copy-btn {
          white-space: nowrap;
          padding: 6px 10px !important;
          font-size: 13px !important;
          line-height: 1 !important;
        }

        #bonus-report-container .bonus-sheet-input[type="number"] {
          text-align: right;
        }

        #bonus-report-container .bonus-sheet-table th:nth-child(1) { width: 16%; }
        #bonus-report-container .bonus-sheet-table th:nth-child(2) { width: 12%; }
        #bonus-report-container .bonus-sheet-table th:nth-child(3) { width: 12%; }
        #bonus-report-container .bonus-sheet-table th:nth-child(4) { width: 8%; }
        #bonus-report-container .bonus-sheet-table th:nth-child(5),
        #bonus-report-container .bonus-sheet-table th:nth-child(6),
        #bonus-report-container .bonus-sheet-table th:nth-child(7),
        #bonus-report-container .bonus-sheet-table th:nth-child(8),
        #bonus-report-container .bonus-sheet-table th:nth-child(9) { width: 8%; }
        #bonus-report-container .bonus-sheet-table th:nth-child(10) { width: 12%; }

        #bonus-report-container .bonus-sheet-input::-webkit-outer-spin-button,
        #bonus-report-container .bonus-sheet-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        #bonus-report-container .bonus-sheet-input::-webkit-input-placeholder {
          color: #777;
        }

        #bonus-report-container .bonus-settle-cell {
          font-weight: 700;
        }

        #bonus-report-container .bonus-settle-text {
          font-size: 16px !important;
          font-weight: 900 !important;
          letter-spacing: 0.2px;
        }

        #bonus-report-container .bonus-sheet-toolbar {
          display: flex;
          flex-wrap: nowrap;
          gap: 8px;
          justify-content: flex-end;
          margin-bottom: 10px;
          align-items: center;
        }

        .dark-mode #bonus-report-container .bonus-sheet-toolbar .copy-btn {
          background: rgba(255,255,255,0.08);
          color: #fff;
          border-color: rgba(255,255,255,0.2);
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          min-width: 82px;
          line-height: 1;
          writing-mode: horizontal-tb;
        }
        #bonus-report-container .bonus-sheet-toolbar .copy-btn {
          background: var(--surface-3);
          color: var(--pixel-white);
          border-color: var(--neon-cyan);
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          min-width: 82px;
          line-height: 1;
          writing-mode: horizontal-tb;
        }

        #bonus-report-container .bonus-sheet-wrap .note-line {
          font-size: 13px !important;
          line-height: 1.4 !important;
        }

        .dark-mode #bonus-report-container .bonus-sheet-toolbar .copy-btn:hover {
          background: rgba(255,255,255,0.14);
          color: #fff;
          box-shadow: none;
        }
        #bonus-report-container .bonus-sheet-toolbar .copy-btn:hover {
          background: var(--neon-cyan);
          color: var(--pixel-white);
          box-shadow: none;
        }
      </style>
      <script>
        const getKeysUrl = "${ScriptApp.getService().getUrl()}?view=getkeys";

        function toggleTheme() {
          const isDark = document.documentElement.classList.toggle('dark-mode');
          const btn = document.getElementById('themeToggleBtn');
          btn.textContent = isDark ? '☀️ 日間模式' : '🌙 夜間模式';
          try { localStorage.setItem('gc-theme', isDark ? 'dark' : 'light'); } catch(e) {}
        }
        function initTheme() {
          try { var saved = localStorage.getItem('gc-theme'); } catch(e) { var saved = null; }
          const btn = document.getElementById('themeToggleBtn');
          if (saved === 'dark') {
            document.documentElement.classList.add('dark-mode');
            btn.textContent = '☀️ 日間模式';
          } else {
            btn.textContent = '🌙 夜間模式';
          }
        }
        document.addEventListener('DOMContentLoaded', initTheme);
      </script>
      <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
      <script>

        function switchTab(tabId, btn) {
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.getElementById(tabId).classList.add('active');
          btn.classList.add('active');
        }

        /* ===== 出缺勤管理 JS ===== */
        var attState = { staffList: [], initialized: false };

        function switchAttTab(id, btn) {
          document.querySelectorAll('.att-sub-content').forEach(function(c) { c.style.display = 'none'; });
          document.querySelectorAll('.att-sub-btn').forEach(function(b) { b.classList.remove('active'); });
          document.getElementById(id).style.display = '';
          btn.classList.add('active');
        }

        function initAttendanceTab() {
          if (attState.initialized) return;
          attState.initialized = true;
          // 初始化年月選單
          var now = new Date();
          ['att-report-year','att-salary-year'].forEach(function(id) {
            var sel = document.getElementById(id);
            if (!sel) return;
            for (var y = now.getFullYear(); y >= 2020; y--) {
              sel.appendChild(new Option(y + '年', y));
            }
          });
          ['att-report-month','att-salary-month'].forEach(function(id) {
            var sel = document.getElementById(id);
            if (!sel) return;
            for (var m = 1; m <= 12; m++) {
              var opt = new Option(m + '月', m);
              if (m === now.getMonth() + 1) opt.selected = true;
              sel.appendChild(opt);
            }
          });
          // 今日日期
          var todayEl = document.getElementById('att-today-date');
          if (todayEl) todayEl.textContent = now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate() + ' (' + ['日','一','二','三','四','五','六'][now.getDay()] + ')';
          // 載入員工清單
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) return;
            attState.staffList = res.data || [];
            ['mp-staff','al-staff','att-report-staff'].forEach(function(selId) {
              var sel = document.getElementById(selId);
              if (!sel) return;
              if (selId === 'att-report-staff') sel.innerHTML = '<option value="">全部員工</option>';
              else sel.innerHTML = '';
              attState.staffList.forEach(function(s) {
                sel.appendChild(new Option(s.name + '（' + s.title + '）', s.empId));
              });
            });
            // 快速輸入員工選單
            ['qi-staff','qi-leave-staff'].forEach(function(selId) {
              var sel = document.getElementById(selId);
              if (!sel) return;
              sel.innerHTML = '';
              attState.staffList.forEach(function(s) {
                sel.appendChild(new Option(s.name + '（' + s.title + '）', s.empId));
              });
            });
            loadTodayAttendance();
            loadLeaveList();
          }).withFailureHandler(function(e) {
            console.error('載入員工失敗', e);
          }).getAttendanceStaffList();
        }

        function quickInputPunch() {
          var empId = document.getElementById('qi-staff').value;
          var date = document.getElementById('qi-date').value;
          var clockIn = document.getElementById('qi-in').value;
          var clockOut = document.getElementById('qi-out').value;
          var note = document.getElementById('qi-note').value;
          if (!empId || !date) { alert('請選擇員工和日期'); return; }
          if (!clockIn && !clockOut) { alert('請輸入至少一個打卡時間'); return; }
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '✔ 打卡登入成功' : '失敗：' + res.msg);
            if (res.success) {
              document.getElementById('qi-in').value = '';
              document.getElementById('qi-out').value = '';
              document.getElementById('qi-note').value = '';
              loadTodayAttendance();
            }
          }).savePunchRecord({ empId: empId, date: date, clockIn: clockIn, clockOut: clockOut, note: note, method: '手動補登' });
        }

        function quickInputLeave() {
          var empId = document.getElementById('qi-leave-staff').value;
          var leaveType = document.getElementById('qi-leave-type').value;
          var startDate = document.getElementById('qi-leave-start').value;
          var endDate = document.getElementById('qi-leave-end').value;
          var hours = document.getElementById('qi-leave-hours').value;
          if (!empId || !startDate || !endDate) { alert('請填入完整資訊'); return; }
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '✔ 請假登入成功' : '失敗：' + res.msg);
            if (res.success) loadTodayAttendance();
          }).addLeaveRecord({ empId: empId, leaveType: leaveType, startDate: startDate, endDate: endDate, hours: hours, note: '', status: '核准' });
        }

        function loadTodayAttendance() {
          var c = document.getElementById('att-today-container');
          c.innerHTML = '<p style="color:var(--pixel-gray);text-align:center;">載入中...</p>';
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) { c.innerHTML = '<p style="color:var(--neon-pink);">' + res.msg + '</p>'; return; }
            renderTodayAttendance(res.data);
          }).withFailureHandler(function(e) {
            c.innerHTML = '<p style="color:var(--neon-pink);">載入失敗：' + e.message + '</p>';
          }).getTodayAttendance();
        }

        function renderTodayAttendance(rows) {
          var c = document.getElementById('att-today-container');
          var html = '<table class="att-table"><thead><tr><th>姓名</th><th>職稱</th><th>狀態</th><th>上班時間</th><th>下班時間</th><th>遲到</th><th>備註</th><th>操作</th></tr></thead><tbody>';
          if (!rows || rows.length === 0) { c.innerHTML = '<p style="text-align:center;color:var(--pixel-gray);">今日無出勤資料</p>'; return; }
          rows.forEach(function(r) {
            var statusBadge = r.status === '出勤' ? '<span class="badge-ok">出勤</span>'
              : r.status === '遲到' ? '<span class="badge-late">遲到</span>'
              : r.status === '請假' ? '<span class="badge-leave">請假</span>'
              : '<span class="badge-absent">缺勤</span>';
            var lateTxt = r.lateMinutes > 0 ? r.lateMinutes + ' 分' : '-';
            html += '<tr><td>' + r.name + '</td><td>' + r.title + '</td><td>' + statusBadge + '</td>'
              + '<td>' + (r.clockIn || '-') + '</td><td>' + (r.clockOut || '-') + '</td>'
              + '<td>' + lateTxt + '</td><td>' + (r.note || '-') + '</td>'
              + '<td><button class="copy-btn" style="font-size:11px;padding:3px 8px;" onclick="openEditPunchModal(' + JSON.stringify(r).replace(/"/g,'&quot;') + ')">編輯</button></td></tr>';
          });
          html += '</tbody></table>';
          c.innerHTML = html;
        }

        function loadMonthlyReport() {
          var year = document.getElementById('att-report-year').value;
          var month = document.getElementById('att-report-month').value;
          var empId = document.getElementById('att-report-staff').value;
          var c = document.getElementById('att-monthly-container');
          c.innerHTML = '<p style="color:var(--pixel-gray);text-align:center;">查詢中...</p>';
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) { c.innerHTML = '<p style="color:var(--neon-pink);">' + res.msg + '</p>'; return; }
            renderMonthlyReport(res.data, year, month);
          }).withFailureHandler(function(e) {
            c.innerHTML = '<p style="color:var(--neon-pink);">查詢失敗：' + e.message + '</p>';
          }).getMonthlyAttendance(year, month, empId);
        }

        function renderMonthlyReport(rows, year, month) {
          var c = document.getElementById('att-monthly-container');
          if (!rows || rows.length === 0) { c.innerHTML = '<p style="text-align:center;color:var(--pixel-gray);">無資料</p>'; return; }
          var html = '<table class="att-table"><thead><tr><th>日期</th><th>姓名</th><th>上班</th><th>下班</th><th>遲到</th><th>工時</th><th>加班</th><th>方式</th><th>備註</th></tr></thead><tbody>';
          rows.forEach(function(r) {
            html += '<tr><td>' + r.date + '</td><td>' + r.name + '</td><td>' + (r.clockIn||'-') + '</td><td>' + (r.clockOut||'-') + '</td>'
              + '<td>' + (r.lateMinutes > 0 ? r.lateMinutes+'分' : '-') + '</td>'
              + '<td>' + (r.workHours||'-') + '</td><td>' + (r.overtime||'-') + '</td>'
              + '<td>' + (r.method||'-') + '</td><td>' + (r.note||'-') + '</td></tr>';
          });
          html += '</tbody></table>';
          c.innerHTML = html;
        }

        function loadLeaveList() {
          var status = document.getElementById('att-leave-status').value;
          var c = document.getElementById('att-leave-container');
          c.innerHTML = '<p style="color:var(--pixel-gray);text-align:center;">載入中...</p>';
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) { c.innerHTML = '<p style="color:var(--neon-pink);">' + res.msg + '</p>'; return; }
            renderLeaveList(res.data);
          }).withFailureHandler(function(e) {
            c.innerHTML = '<p style="color:var(--neon-pink);">載入失敗：' + e.message + '</p>';
          }).getLeaveList(status);
        }

        function renderLeaveList(rows) {
          var c = document.getElementById('att-leave-container');
          if (!rows || rows.length === 0) { c.innerHTML = '<p style="text-align:center;color:var(--pixel-gray);">無假單</p>'; return; }
          var html = '<table class="att-table"><thead><tr><th>假單號</th><th>姓名</th><th>假別</th><th>開始</th><th>結束</th><th>時數</th><th>狀態</th><th>操作</th></tr></thead><tbody>';
          rows.forEach(function(r) {
            var badge = r.status === '待審' ? '<span class="badge-pending">待審</span>'
              : r.status === '核准' ? '<span class="badge-approved">核准</span>'
              : '<span class="badge-rejected">駁回</span>';
            html += '<tr><td>' + r.leaveId + '</td><td>' + r.name + '</td><td>' + r.leaveType + '</td>'
              + '<td>' + r.startDate + '</td><td>' + r.endDate + '</td><td>' + r.hours + 'h</td>'
              + '<td>' + badge + '</td><td style="display:flex;gap:4px;">'
              + (r.status === '待審' ? '<button class="copy-btn" style="font-size:11px;padding:3px 8px;background:var(--neon-green);color:#000;" onclick="approveLeave(' + JSON.stringify(r.leaveId) + ',true)">核准</button>'
                + '<button class="copy-btn" style="font-size:11px;padding:3px 8px;background:var(--neon-pink);color:#fff;" onclick="approveLeave(' + JSON.stringify(r.leaveId) + ',false)">駁回</button>' : '')
              + '</td></tr>';
          });
          html += '</tbody></table>';
          c.innerHTML = html;
        }

        function approveLeave(leaveId, approved) {
          google.script.run.withSuccessHandler(function(res) {
            if (res.success) { loadLeaveList(); showToast(approved ? '已核准' : '已駁回'); }
            else showToast('操作失敗：' + res.msg);
          }).updateLeaveStatus(leaveId, approved ? '核准' : '駁回');
        }

        function loadLeaveBalance() {
          var c = document.getElementById('att-balance-container');
          c.innerHTML = '<p style="color:var(--pixel-gray);text-align:center;">載入中...</p>';
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) { c.innerHTML = '<p style="color:var(--neon-pink);">' + res.msg + '</p>'; return; }
            renderLeaveBalance(res.data);
          }).withFailureHandler(function(e) {
            c.innerHTML = '<p style="color:var(--neon-pink);">載入失敗：' + e.message + '</p>';
          }).getLeaveBalance();
        }

        function renderLeaveBalance(rows) {
          var c = document.getElementById('att-balance-container');
          if (!rows || rows.length === 0) { c.innerHTML = '<p style="text-align:center;color:var(--pixel-gray);">無資料</p>'; return; }
          var html = '<table class="att-table"><thead><tr><th>姓名</th><th>到職日</th><th>年資</th><th>特休應有（天）</th><th>已用特休（天）</th><th>剩餘特休</th><th>到期日</th><th>操作</th></tr></thead><tbody>';
          rows.forEach(function(r) {
            var remain = Math.max(0, (Number(r.annualLeave)||0) - (Number(r.usedAnnual)||0));
            html += '<tr data-empid="' + r.empId + '">'
              + '<td>' + r.name + '</td><td>' + r.joinDate + '</td><td>' + r.tenure + '年</td>'
              + '<td><input type="number" class="bonus-input" value="' + r.annualLeave + '" style="width:60px;" onchange="updateBalanceField(this,&apos;' + r.empId + '&apos;,&apos;annual&apos;)"></td>'
              + '<td><input type="number" class="bonus-input" value="' + r.usedAnnual + '" style="width:60px;" onchange="updateBalanceField(this,&apos;' + r.empId + '&apos;,&apos;used&apos;)"></td>'
              + '<td id="bal-remain-' + r.empId + '" style="color:' + (remain <= 3 ? 'orange' : 'var(--neon-green)') + ';font-weight:bold;">' + remain + '天</td>'
              + '<td>' + (r.expireDate||'-') + '</td>'
              + '<td><button class="copy-btn" style="font-size:11px;padding:3px 8px;" onclick="saveLeaveBalance(&apos;' + r.empId + '&apos;,this)">儲存</button></td></tr>';
          });
          html += '</tbody></table>';
          c.innerHTML = html;
        }

        function updateBalanceField(input, empId, field) {
          var row = input.closest('tr');
          var annualInput = row.querySelector('td:nth-child(4) input');
          var usedInput = row.querySelector('td:nth-child(5) input');
          var remain = Math.max(0, Number(annualInput.value||0) - Number(usedInput.value||0));
          var remainEl = document.getElementById('bal-remain-' + empId);
          if (remainEl) { remainEl.textContent = remain + '天'; remainEl.style.color = remain <= 3 ? 'orange' : 'var(--neon-green)'; }
        }

        function saveLeaveBalance(empId, btn) {
          var row = btn.closest('tr');
          var annual = Number(row.querySelector('td:nth-child(4) input').value) || 0;
          var used = Number(row.querySelector('td:nth-child(5) input').value) || 0;
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '✔ 儲存成功' : '失敗：' + res.msg);
          }).updateLeaveBalanceFull(empId, annual, used);
        }

        function recalcAllLeaveBalance() {
          if (!confirm('重新試算全員特休餘額？這會根據到職日和請假紀錄重新計算。')) return;
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '試算完成' : '失敗：' + res.msg);
            if (res.success) loadLeaveBalance();
          }).recalcLeaveBalance();
        }

        function loadSalaryReport() {
          var year = document.getElementById('att-salary-year').value;
          var month = document.getElementById('att-salary-month').value;
          var c = document.getElementById('att-salary-container');
          c.innerHTML = '<p style="color:var(--pixel-gray);text-align:center;">計算中，請稍候...</p>';
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) { c.innerHTML = '<p style="color:var(--neon-pink);">' + res.msg + '</p>'; return; }
            renderSalaryReport(res.data, year, month);
          }).withFailureHandler(function(e) {
            c.innerHTML = '<p style="color:var(--neon-pink);">計算失敗：' + e.message + '</p>';
          }).calcMonthlySalary(year, month);
        }

        function renderSalaryReport(rows, year, month) {
          var c = document.getElementById('att-salary-container');
          if (!rows || rows.length === 0) { c.innerHTML = '<p style="text-align:center;color:var(--pixel-gray);">無資料</p>'; return; }
          var html = '<p style="color:var(--pixel-gray);margin-bottom:8px;">' + year + ' 年 ' + month + ' 月薪資計算結果</p>'
            + '<table class="att-table"><thead><tr><th>姓名</th><th>底薪</th><th>加給</th><th>全勤</th><th>業績達成</th><th>加班費</th><th>其他</th><th>應領小計</th><th>勞保</th><th>健保</th><th>其他扣</th><th>應扣小計</th><th style="color:var(--neon-yellow);">實領</th><th>操作</th></tr></thead><tbody>';
          rows.forEach(function(r) {
            html += '<tr><td>' + r.name + '</td><td>' + r.baseSalary.toLocaleString() + '</td><td>' + r.allowance.toLocaleString() + '</td>'
              + '<td>' + r.attendanceBonus.toLocaleString() + '</td><td>' + r.perfBonus.toLocaleString() + '</td>'
              + '<td>' + r.overtime.toLocaleString() + '</td><td>' + r.others.toLocaleString() + '</td>'
              + '<td>' + r.grossPay.toLocaleString() + '</td>'
              + '<td>' + r.laborInsurance.toLocaleString() + '</td><td>' + r.healthInsurance.toLocaleString() + '</td>'
              + '<td>' + r.otherDeductions.toLocaleString() + '</td><td>' + r.totalDeductions.toLocaleString() + '</td>'
              + '<td style="color:var(--neon-yellow);font-weight:bold;">$' + r.netPay.toLocaleString() + '</td>'
              + '<td><button class="copy-btn" style="font-size:11px;padding:3px 8px;" onclick="editSalaryRow(' + JSON.stringify(r).replace(/"/g,'&quot;') + ')">編輯</button></td></tr>';
          });
          html += '</tbody></table>';
          c.innerHTML = html;
        }

        function exportSalarySlips() {
          var year = document.getElementById('att-salary-year').value;
          var month = document.getElementById('att-salary-month').value;
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '薪資條已儲存至試算表' : '失敗：' + res.msg);
          }).saveSalarySlips(year, month);
        }

        function loadRaiseRecords() {
          var c = document.getElementById('att-raise-container');
          c.innerHTML = '<p style="color:var(--pixel-gray);text-align:center;">載入中...</p>';
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) { c.innerHTML = '<p style="color:var(--neon-pink);">' + res.msg + '</p>'; return; }
            renderRaiseRecords(res.data);
          }).withFailureHandler(function(e) {
            c.innerHTML = '<p style="color:var(--neon-pink);">載入失敗：' + e.message + '</p>';
          }).getRaiseRecords();
        }

        function renderRaiseRecords(rows) {
          var c = document.getElementById('att-raise-container');
          if (!rows || rows.length === 0) { c.innerHTML = '<p style="text-align:center;color:var(--pixel-gray);">無資料</p>'; return; }
          var html = '<table class="att-table"><thead><tr><th>姓名</th><th>到職日</th><th>年資</th><th>原底薪</th><th>目前底薪</th><th>目前加給</th><th>全勤</th><th>餐費</th><th>電話費</th><th style="color:var(--neon-yellow);">合計實領</th><th>加薪幅度</th><th>年化報酬率</th></tr></thead><tbody>';
          rows.forEach(function(r) {
            html += '<tr><td>' + r.name + '</td><td>' + r.joinDate + '</td><td>' + r.tenure + '</td>'
              + '<td>$' + Number(r.origSalary||0).toLocaleString() + '</td>'
              + '<td>$' + Number(r.currSalary||0).toLocaleString() + '</td>'
              + '<td>$' + Number(r.allowance||0).toLocaleString() + '</td>'
              + '<td>$' + Number(r.attendanceBonus||0).toLocaleString() + '</td>'
              + '<td>' + (r.meal||'-') + '</td>'
              + '<td>' + (r.phone||'-') + '</td>'
              + '<td style="color:var(--neon-yellow);font-weight:bold;">$' + Number(r.total||0).toLocaleString() + '</td>'
              + '<td>' + (r.raiseRate||'-') + '</td>'
              + '<td>' + (r.annualRate||'-') + '</td></tr>';
          });
          html += '</tbody></table>';
          c.innerHTML = html;
        }

        function loadStaffList() {
          var c = document.getElementById('att-staff-container');
          c.innerHTML = '<p style="color:var(--pixel-gray);text-align:center;">載入中...</p>';
          google.script.run.withSuccessHandler(function(res) {
            if (!res.success) { c.innerHTML = '<p style="color:var(--neon-pink);">' + res.msg + '</p>'; return; }
            renderStaffList(res.data);
          }).withFailureHandler(function(e) {
            c.innerHTML = '<p style="color:var(--neon-pink);">載入失敗：' + e.message + '</p>';
          }).getAttendanceStaffList();
        }

        function renderStaffList(rows) {
          var c = document.getElementById('att-staff-container');
          if (!rows || rows.length === 0) { c.innerHTML = '<p style="text-align:center;color:var(--pixel-gray);">尚無員工資料</p>'; return; }
          var html = '<table class="att-table"><thead><tr><th>員工ID</th><th>姓名</th><th>職稱</th><th>到職日</th><th>底薪</th><th>投保薪資</th><th>餐費</th><th>電話費</th><th>全勤獎金</th><th>LINE綁定</th><th>狀態</th><th>操作</th></tr></thead><tbody>';
          rows.forEach(function(r) {
            html += '<tr data-empid="' + r.empId + '">'
              + '<td style="color:var(--pixel-gray);font-size:12px;">' + r.empId + '</td>'
              + '<td><input class="bonus-input" value="' + (r.name||'') + '" style="width:70px;"></td>'
              + '<td><input class="bonus-input" value="' + (r.title||'') + '" style="width:70px;"></td>'
              + '<td><input type="date" class="bonus-input" value="' + (r.joinDate||'') + '" style="width:120px;"></td>'
              + '<td><input type="number" class="bonus-input" value="' + (r.salary||0) + '" style="width:80px;"></td>'
              + '<td><input type="number" class="bonus-input" value="' + (r.insuredSalary||0) + '" style="width:80px;"></td>'
              + '<td><input type="number" class="bonus-input" value="' + (r.meal||0) + '" style="width:60px;"></td>'
              + '<td><input type="number" class="bonus-input" value="' + (r.phone||0) + '" style="width:60px;"></td>'
              + '<td><input type="number" class="bonus-input" value="' + (r.attendanceBonus||0) + '" style="width:60px;"></td>'
              + '<td>' + (r.lineUserId ? '<span class="badge-ok">已綁定</span>' : '<span class="badge-absent">未綁定</span>') + '</td>'
              + '<td><select class="bonus-input" style="width:70px;"><option' + (r.status==='在職'?' selected':'') + '>在職</option><option' + (r.status==='離職'?' selected':'') + '>離職</option></select></td>'
              + '<td style="display:flex;gap:4px;">'
              + '<button class="copy-btn" style="font-size:11px;padding:3px 8px;white-space:nowrap;" onclick="saveStaffRow(this)">儲存</button>'
              + '<button class="copy-btn" style="font-size:11px;padding:3px 8px;background:#5a0000;" onclick="deleteStaff(&apos;' + r.empId + '&apos;,&apos;' + r.name + '&apos;)">刪除</button>'
              + '</td></tr>';
          });
          html += '</tbody></table>';
          c.innerHTML = html;
        }

        function saveStaffRow(btn) {
          var row = btn.closest('tr');
          var cells = row.querySelectorAll('td');
          var data = {
            empId: row.getAttribute('data-empid'),
            name: cells[1].querySelector('input').value,
            title: cells[2].querySelector('input').value,
            joinDate: cells[3].querySelector('input').value,
            salary: cells[4].querySelector('input').value,
            insuredSalary: cells[5].querySelector('input').value,
            meal: cells[6].querySelector('input').value,
            phone: cells[7].querySelector('input').value,
            attendanceBonus: cells[8].querySelector('input').value,
            status: cells[10].querySelector('select').value
          };
          if (!data.name || !data.title) { alert('姓名和職稱不能空白'); return; }
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '✔ ' + data.name + ' 儲存成功' : '失敗：' + res.msg);
          }).saveAttendanceStaff(data);
        }

        function deleteStaff(empId, name) {
          if (!confirm('確定要刪除 ' + name + '？(標記為離職)')) return;
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '✔ 已標記離職' : '失敗：' + res.msg);
            if (res.success) loadStaffList();
          }).deleteAttendanceStaff(empId);
        }

        function openManualPunchModal() {
          var today = new Date().toISOString().slice(0,10);
          document.getElementById('qi-date').value = today;
          document.getElementById('qi-leave-start').value = today;
          document.getElementById('qi-leave-end').value = today;
          document.getElementById('mp-date').value = today;
          document.getElementById('mp-clock-in').value = '';
          document.getElementById('mp-clock-out').value = '';
          document.getElementById('mp-note').value = '';
          showModal('manual-punch-modal');
        }

        function submitManualPunch() {
          var empId = document.getElementById('mp-staff').value;
          var date = document.getElementById('mp-date').value;
          var clockIn = document.getElementById('mp-clock-in').value;
          var clockOut = document.getElementById('mp-clock-out').value;
          var note = document.getElementById('mp-note').value;
          if (!empId || !date) { alert('請選擇員工和日期'); return; }
          google.script.run.withSuccessHandler(function(res) {
            closeModal('manual-punch-modal');
            showToast(res.success ? '補登成功' : '失敗：' + res.msg);
            if (res.success) loadTodayAttendance();
          }).savePunchRecord({ empId: empId, date: date, clockIn: clockIn, clockOut: clockOut, note: note, method: '手動補登' });
        }

        function openAddLeaveModal() {
          document.getElementById('al-start').value = '';
          document.getElementById('al-end').value = '';
          document.getElementById('al-note').value = '';
          showModal('add-leave-modal');
        }

        function submitAddLeave() {
          var empId = document.getElementById('al-staff').value;
          var leaveType = document.getElementById('al-type').value;
          var startDate = document.getElementById('al-start').value;
          var endDate = document.getElementById('al-end').value;
          var hours = document.getElementById('al-hours').value;
          var note = document.getElementById('al-note').value;
          if (!empId || !startDate || !endDate) { alert('請填入必要欄位'); return; }
          google.script.run.withSuccessHandler(function(res) {
            closeModal('add-leave-modal');
            showToast(res.success ? '新增成功' : '失敗：' + res.msg);
            if (res.success) loadLeaveList();
          }).addLeaveRecord({ empId: empId, leaveType: leaveType, startDate: startDate, endDate: endDate, hours: hours, note: note, status: '核准' });
        }

        function openAddStaffModal() {
          document.getElementById('staff-modal-title').textContent = '新增員工';
          document.getElementById('sm-emp-id').value = '';
          ['sm-name','sm-title','sm-salary','sm-insured','sm-meal','sm-phone','sm-attendance-bonus','sm-supervisor'].forEach(function(id) {
            document.getElementById(id).value = '';
          });
          document.getElementById('sm-joindate').value = '';
          document.getElementById('sm-status').value = '在職';
          showModal('add-staff-modal');
        }

        function openEditStaffModal(r) {
          document.getElementById('staff-modal-title').textContent = '編輯員工';
          document.getElementById('sm-emp-id').value = r.empId || '';
          document.getElementById('sm-name').value = r.name || '';
          document.getElementById('sm-title').value = r.title || '';
          document.getElementById('sm-joindate').value = r.joinDate || '';
          document.getElementById('sm-salary').value = r.salary || '';
          document.getElementById('sm-insured').value = r.insuredSalary || '';
          document.getElementById('sm-meal').value = r.meal || '';
          document.getElementById('sm-phone').value = r.phone || '';
          document.getElementById('sm-attendance-bonus').value = r.attendanceBonus || '';
          document.getElementById('sm-supervisor').value = r.supervisorId || '';
          document.getElementById('sm-status').value = r.status || '在職';
          showModal('add-staff-modal');
        }

        function submitStaff() {
          var data = {
            empId: document.getElementById('sm-emp-id').value,
            name: document.getElementById('sm-name').value,
            title: document.getElementById('sm-title').value,
            joinDate: document.getElementById('sm-joindate').value,
            salary: document.getElementById('sm-salary').value,
            insuredSalary: document.getElementById('sm-insured').value,
            meal: document.getElementById('sm-meal').value,
            phone: document.getElementById('sm-phone').value,
            attendanceBonus: document.getElementById('sm-attendance-bonus').value,
            supervisorId: document.getElementById('sm-supervisor').value,
            status: document.getElementById('sm-status').value
          };
          if (!data.name || !data.title || !data.joinDate || !data.salary) { alert('請填入必要欄位（姓名、職稱、到職日、底薪）'); return; }
          google.script.run.withSuccessHandler(function(res) {
            closeModal('add-staff-modal');
            showToast(res.success ? '儲存成功' : '失敗：' + res.msg);
            if (res.success) { loadStaffList(); initAttendanceTab(); }
          }).saveAttendanceStaff(data);
        }

        function openEditPunchModal(r) {
          document.getElementById('mp-date').value = r.date || '';
          document.getElementById('mp-clock-in').value = r.clockIn || '';
          document.getElementById('mp-clock-out').value = r.clockOut || '';
          document.getElementById('mp-note').value = r.note || '';
          // 選對員工
          var sel = document.getElementById('mp-staff');
          for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === r.empId) { sel.selectedIndex = i; break; }
          }
          showModal('manual-punch-modal');
        }

        function openEditBalanceModal(r) {
          var newVal = prompt(r.name + ' 的特休剩餘天數（目前：' + r.remainAnnual + '天）', r.remainAnnual);
          if (newVal === null) return;
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '更新成功' : '失敗：' + res.msg);
            if (res.success) loadLeaveBalance();
          }).updateLeaveBalance(r.empId, parseFloat(newVal));
        }

        function editSalaryRow(r) {
          var netPay = prompt(r.name + ' 的實領金額（目前：' + r.netPay + '）', r.netPay);
          if (netPay === null) return;
          r.netPay = parseFloat(netPay);
          google.script.run.withSuccessHandler(function(res) {
            showToast(res.success ? '更新成功' : '失敗：' + res.msg);
          }).updateSalaryRow(r);
        }

        function showModal(id) {
          var el = document.getElementById(id);
          el.style.display = 'flex';
        }

        function closeModal(id) {
          document.getElementById(id).style.display = 'none';
        }

        function showToast(msg) {
          var t = document.getElementById('toast');
          t.textContent = msg;
          t.style.opacity = '1';
          setTimeout(function() { t.style.opacity = '0'; }, 2500);
        }

        function filterTable(tableId, query) {
          const q = query.toLowerCase().trim();
          const rows = document.querySelectorAll('#' + tableId + ' tbody tr');
          rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (row.cells.length === 1 && row.cells[0].getAttribute('colspan')) return;
            if (text.includes(q)) {
              row.style.display = '';
            } else {
              row.style.display = 'none';
            }
          });
        }

        function showToast(msg) {
          var toast = document.getElementById('toast');
          toast.innerText = msg;
          toast.style.opacity = 1;
          setTimeout(function() {
            toast.style.opacity = 0;
          }, 2000);
        }

        function copyLink(link, btn) {
          navigator.clipboard.writeText(link).then(function() {
            const originalText = btn.innerHTML;
            btn.innerHTML = "已複製！";
            btn.style.background = "var(--neon-green)";
            btn.style.color = "#000";
            btn.style.borderColor = "var(--neon-green)";
            btn.style.boxShadow = "0 0 8px var(--neon-green)";
            setTimeout(function() {
              btn.innerHTML = originalText;
              btn.style.background = "";
              btn.style.color = "";
              btn.style.borderColor = "";
              btn.style.boxShadow = "";
            }, 1500);
            showToast("連結複製成功！");
          });
        }
        
        // 業務app金鑰管理
        function addSalesperson() {
          const input = document.getElementById('new-sales-name');
          const name = input.value.trim();
          if (!name) { alert('請輸入同仁姓名！'); return; }
          
          const btn = document.getElementById('add-btn');
          btn.disabled = true;
          btn.innerText = '處理中...';
          
          google.script.run
            .withSuccessHandler(function(res) {
              btn.disabled = false;
              btn.innerText = '發行金鑰並產生連結';
              if (res.success) {
                input.value = '';
                showToast("同仁新增成功！");
                window.location.replace(getKeysUrl);
              } else {
                alert('新增失敗：' + res.msg);
              }
            })
            .addDirectSalesperson(name);
        }
        
        function toggleStatus(name, action) {
          if (!confirm('您確定要將 ' + name + ' 的金鑰' + (action === 'revoke' ? '停用失效' : '恢復啟用') + '嗎？')) return;
          
          google.script.run
            .withSuccessHandler(function(res) {
              if (res.success) {
                showToast(res.msg);
                window.location.replace(getKeysUrl);
              } else {
                alert('操作失敗：' + res.msg);
              }
            })[action === 'revoke' ? 'revokeDirectSalesperson' : 'enableDirectSalesperson'](name);
        }
        
        // 👥 客戶查庫存金鑰管理 - 單筆
        function addSingleClient(btn) {
          const name = document.getElementById('cust-name').value.trim();
          const company = document.getElementById('cust-company').value.trim();
          const level = document.getElementById('cust-level').value;
          const uid = document.getElementById('cust-uid') ? document.getElementById('cust-uid').value.trim() : '';
          
          if (!name && !company) { alert('請至少輸入「客戶姓名」或「公司名稱」！'); return; }
          
          if (btn) {
            btn.disabled = true;
            btn.innerText = '處理中...';
          }
          
          google.script.run
            .withSuccessHandler(res => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '儲存單筆客戶';
              }
              if (res.success) {
                document.getElementById('cust-name').value = '';
                document.getElementById('cust-company').value = '';
                document.getElementById('cust-uid').value = '';
                showToast("客戶金鑰開通/更新成功！");
                window.location.replace(getKeysUrl);
              } else {
                alert('建檔失敗: ' + res.msg);
              }
            })
            .withFailureHandler(err => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '儲存單筆客戶';
              }
              alert('連線失敗: ' + err.toString());
            })
            .addOrBatchClients([{ name, company, level, uid }]);
        }

        // 載入編輯外部客戶
        function editClient(name, company, level, uid) {
          document.getElementById('cust-name').value = name;
          document.getElementById('cust-company').value = company;
          document.getElementById('cust-level').value = level;
          document.getElementById('cust-uid').value = uid;
          
          const formCard = document.getElementById('cust-name').closest('.panel-card');
          if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
          showToast("已載入客戶資料至表單，修改後點擊「儲存單筆客戶」按鈕即可更新！");
        }
        
        // 外部客戶批次導入
        function addBatchClients(btn) {
          const raw = document.getElementById('cust-batch-input').value.trim();
          if (!raw) { alert('請在文字框內輸入要批次建檔的客戶名單！'); return; }
          
          const lines = raw.split(String.fromCharCode(10));
          const list = [];
          lines.forEach(line => {
            if (!line.trim()) return;
            const parts = line.split(/[,，\\t]/);
            const name = parts[0] ? parts[0].trim() : '';
            const company = parts[1] ? parts[1].trim() : '';
            const level = (parts[2] && parts[2].trim()) ? parts[2].trim() : 'LEVEL 2';
            const uid = (parts[3] && parts[3].trim()) ? parts[3].trim() : '';
            if (name || company) {
              list.push({ name, company, level, uid });
            }
          });
          
          if (list.length === 0) { alert('查無有效的客戶格式，請確認是否以「姓名,公司名稱,等級,LINEID」分隔！'); return; }
          
          if (!confirm('您確定要批次建檔這 ' + list.length + ' 筆客戶名單嗎？')) return;
          
          if (btn) {
            btn.disabled = true;
            btn.innerText = '處理中...';
          }
          
          google.script.run
            .withSuccessHandler(res => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '執行批次建檔並儲存';
              }
              if (res.success) {
                document.getElementById('cust-batch-input').value = '';
                showToast("批次建檔成功！");
                window.location.replace(getKeysUrl);
              } else {
                alert('批次建檔失敗: ' + res.msg);
              }
            })
            .withFailureHandler(err => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '執行批次建檔並儲存';
              }
              alert('連線失敗: ' + err.toString());
            })
            .addOrBatchClients(list);
        }
        
        // 刪除外部客戶白名單
        function removeClient(rowIdx, name) {
          if (!confirm('您確定要將「' + name + '」從外部客戶白名單中移除嗎？')) return;
          google.script.run
            .withSuccessHandler(res => {
              if (res.success) {
                showToast("客戶已成功移出白名單！");
                window.location.replace(getKeysUrl);
              } else {
                alert('操作失敗: ' + res.msg);
              }
            })
            .removeClientFromWhitelist(rowIdx);
        }

        // 🤖 LINE 機器人白名單管理 - 單筆
        function addSingleLineClient(btn) {
          const uid = document.getElementById('line-uid').value.trim();
          const name = document.getElementById('line-name').value.trim();
          const company = document.getElementById('line-company').value.trim();
          const level = document.getElementById('line-level').value;
          const status = document.getElementById('line-status').value;
          
          if (!uid) { alert('請輸入 LINE ID (User ID)！'); return; }
          if (!name && !company) { alert('請至少輸入「客戶姓名」或「公司名稱」！'); return; }
          
          if (btn) {
            btn.disabled = true;
            btn.innerText = '處理中...';
          }
          
          google.script.run
            .withSuccessHandler(res => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '儲存單筆 LINE 客戶';
              }
              if (res.success) {
                document.getElementById('line-uid').value = '';
                document.getElementById('line-name').value = '';
                document.getElementById('line-company').value = '';
                showToast("LINE 機器人白名單儲存成功！");
                window.location.replace(getKeysUrl);
              } else {
                alert('儲存失敗: ' + res.msg);
              }
            })
            .withFailureHandler(err => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '儲存單筆 LINE 客戶';
              }
              alert('連線失敗: ' + err.toString());
            })
            .addOrBatchLineClients([{ name, company, level, uid, status }]);
        }

        // 載入編輯 LINE 機器人客戶
        function editLineClient(name, company, level, uid, status) {
          document.getElementById('line-uid').value = uid;
          document.getElementById('line-name').value = name;
          document.getElementById('line-company').value = company;
          document.getElementById('line-level').value = level;
          document.getElementById('line-status').value = status;
          
          const formCard = document.getElementById('line-uid').closest('.panel-card');
          if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
          showToast("已載入 LINE 客戶資料至表單，修改後點擊「儲存單筆 LINE 客戶」按鈕即可更新！");
        }

        // LINE 機器人客戶批次導入
        function addBatchLineClients(btn) {
          const raw = document.getElementById('line-batch-input').value.trim();
          if (!raw) { alert('請在文字框內輸入要批次建檔的名單！'); return; }
          
          const lines = raw.split(String.fromCharCode(10));
          const list = [];
          for (let line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(',');
            if (parts.length >= 4) {
              const name = parts[0].trim();
              const company = parts[1].trim();
              const level = parts[2].trim();
              const uid = parts[3].trim();
              const status = parts[4] ? parts[4].trim() : 'approved';
              list.push({ name, company, level, uid, status });
            }
          }
          if (list.length === 0) {
            alert('沒有解析到有效的客戶資料，請檢查格式是否正確！');
            return;
          }
          if (btn) {
            btn.disabled = true;
            btn.innerText = '處理中...';
          }
          google.script.run
            .withSuccessHandler(res => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '執行批次導入並儲存';
              }
              if (res.success) {
                document.getElementById('line-batch-input').value = '';
                showToast("批次導入成功！");
                window.location.replace(getKeysUrl);
              } else {
                alert('批次導入失敗: ' + res.msg);
              }
            })
            .withFailureHandler(err => {
              if (btn) {
                btn.disabled = false;
                btn.innerText = '執行批次導入並儲存';
              }
              alert('連線失敗: ' + err.toString());
            })
            .addOrBatchLineClients(list);
        }

        // 刪除 LINE 機器人白名單
        function removeLineClient(rowIdx, name) {
          if (!confirm('您確定要將「' + name + '」從 LINE 機器人白名單中移除嗎？')) return;
          google.script.run
            .withSuccessHandler(res => {
              if (res.success) {
                showToast("客戶已從 LINE 機器人白名單中移除！");
                window.location.replace(getKeysUrl);
              } else {
                alert('操作失敗: ' + res.msg);
              }
            })
            .removeLineClientFromWhitelist(rowIdx);
        }

        // 💰 業績獎金管理後台前端邏輯
        let currentBonusConfig = null;

        function loadBonusConfig() {
          google.script.run
            .withSuccessHandler(function(config) {
              currentBonusConfig = config;
              renderBonusConfigUI();
            })
            .getActiveBonusConfig();
        }

        function renderBonusConfigUI() {
          if (!currentBonusConfig) return;
          
          // 1. 填入全域欄位
          document.getElementById('bonus-global-staff-rate').value = Math.round((currentBonusConfig.STAFF_SHARE_RATE || 0) * 100);
          document.getElementById('bonus-global-discount-threshold').value = currentBonusConfig.PEER_PRICE_DISCOUNT_THRESHOLD || 0.60;
          document.getElementById('bonus-global-adj-factor').value = currentBonusConfig.PEER_PRICE_ADJUSTMENT_FACTOR || 0.50;

          // 2. 填入業務個人規則列表
          const container = document.getElementById('bonus-rules-container');
          container.innerHTML = '';

          const rules = currentBonusConfig.RULES || {};
          const names = Object.keys(rules);

          if (names.length === 0) {
            container.innerHTML = '<p style="color: var(--pixel-gray); text-align: center; padding: 20px;">目前尚無設定任何業務獎金規則</p>';
            return;
          }

          names.forEach(name => {
            const rule = rules[name];
            
            // 產生突破獎金 5 個設定檔位輸入欄
            let btInputsHtml = '';
            for (let k = 0; k < 5; k++) {
              const btVal = rule.breakthroughs && rule.breakthroughs[k] ? rule.breakthroughs[k] : null;
              const limitVal = btVal ? (btVal.limit / 10000) : '';
              const bonusVal = btVal ? btVal.bonus : '';
              btInputsHtml += 
                '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">' +
                  '<span style="font-size:13px; color:var(--pixel-gray); width: 60px;">門檻 ' + (k+1) + '：</span>' +
                  '<input type="number" class="bt-limit" value="' + limitVal + '" placeholder="例如：150" style="width: 80px; padding: 6px; border-radius: 4px; background: var(--inline-bg); border: 1px solid rgba(255,255,255,0.2); color:var(--pixel-white); font-size:13px; height: 32px;">' +
                  '<span style="font-size:13px; color:var(--pixel-white);">萬</span>' +
                  '<span style="font-size:13px; color:var(--pixel-gray); margin-left: 10px;">獎金：</span>' +
                  '<input type="number" class="bt-bonus" value="' + bonusVal + '" placeholder="例如：5000" style="width: 100px; padding: 6px; border-radius: 4px; background: var(--inline-bg); border: 1px solid rgba(255,255,255,0.2); color:var(--pixel-white); font-size:13px; height: 32px;">' +
                  '<span style="font-size:13px; color:var(--pixel-white);">元</span>' +
                '</div>';
            }

            const btToggleKey = 'bt-toggle-' + name.replace(/\\s/g, '');
            const isChecked = rule.enabled !== false ? 'checked' : '';
            const statusColor = rule.enabled !== false ? 'var(--neon-green)' : 'var(--neon-pink)';
            const statusLabel = '<span class="bonus-status-text" style="color:' + statusColor + '">' + (rule.enabled !== false ? '啟用中' : '未啟用') + '</span>';

            const card = document.createElement('div');
            card.className = 'bonus-card';
            card.dataset.name = name;
            card.style.background = 'rgba(255,255,255,0.03)';
            card.style.border = '1px solid rgba(255,255,255,0.1)';
            card.style.borderRadius = '12px';
            card.style.padding = '18px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '12px';

            card.innerHTML = 
              '<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">' +
                '<h4 style="font-size: 16px; color: var(--neon-cyan);">' + name + ' (' + statusLabel + ')</h4>' +
                '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px;">' +
                  '<input type="checkbox" id="bonus-chk-' + name + '" ' + isChecked + ' onchange="toggleRuleEnabled(this)"> 參與獎金計算' +
                '</label>' +
              '</div>' +
              
              '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">' +
                '<div class="form-group">' +
                  '<label style="font-size:11px; color:var(--pixel-gray);">最低額度 (元)</label>' +
                  '<input type="number" id="bonus-min-' + name + '" value="' + (rule.minThreshold || 0) + '" style="width: 100%; padding: 6px; border-radius: 4px; background: var(--inline-bg); border: 1px solid rgba(255,255,255,0.2); color:var(--pixel-white); font-size:12px;">' +
                '</div>' +
                '<div class="form-group">' +
                  '<label style="font-size:11px; color:var(--pixel-gray);">起算基底 (元)</label>' +
                  '<input type="number" id="bonus-base-' + name + '" value="' + (rule.stepBase || 0) + '" style="width: 100%; padding: 6px; border-radius: 4px; background: var(--inline-bg); border: 1px solid rgba(255,255,255,0.2); color:var(--pixel-white); font-size:12px;">' +
                '</div>' +
                '<div class="form-group">' +
                  '<label style="font-size:11px; color:var(--pixel-gray);">每超過多少元加發</label>' +
                  '<input type="number" id="bonus-step-' + name + '" value="' + (rule.stepValue || 100000) + '" style="width: 100%; padding: 6px; border-radius: 4px; background: var(--inline-bg); border: 1px solid rgba(255,255,255,0.2); color:var(--pixel-white); font-size:12px;">' +
                '</div>' +
                '<div class="form-group">' +
                  '<label style="font-size:11px; color:var(--pixel-gray);">加發金額 (元)</label>' +
                  '<input type="number" id="bonus-val-' + name + '" value="' + (rule.stepBonus || 1000) + '" style="width: 100%; padding: 6px; border-radius: 4px; background: var(--inline-bg); border: 1px solid rgba(255,255,255,0.2); color:var(--pixel-white); font-size:12px;">' +
                '</div>' +
              '</div>' +
              
              '<div class="form-group" style="margin-top: 10px;">' +
                '<div onclick="toggleReportDetailSection(&apos;' + btToggleKey + '&apos;)" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:10px 14px; background:var(--inline-bg); border:1px solid rgba(255,255,255,0.15); border-radius:6px; margin-bottom:10px;">' +
                  '<div style="font-size:14px; font-weight:bold; color: var(--neon-cyan);">🏆 突破獎金門檻設定 (點開：xx萬 獎金xx)</div>' +
                  '<div style="font-size:12px; color: var(--neon-cyan);">▼</div>' +
                '</div>' +
                '<div id="' + btToggleKey + '" style="display:none; padding:12px; background: rgba(0,0,0,0.15); border-radius: 6px; border: 1px dashed rgba(255,255,255,0.1);">' +
                  btInputsHtml +
                '</div>' +
              '</div>' +
              
              '<div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 5px;">' +
                '<button class="copy-btn" onclick="saveSalespersonBonus(this)" style="background:var(--neon-cyan); color:#000; border:none; padding:6px 12px; font-size:12px;">儲存此同仁設定</button>' +
                '<button class="act-btn disabled-btn" onclick="deleteSalespersonBonusRule(this)" style="padding:6px 12px; font-size:12px;">刪除規則</button>' +
              '</div>';
            container.appendChild(card);
          });
        }

        function toggleRuleEnabled(chk) {
          const card = chk.closest('.bonus-card');
          if (!card) return;
          const name = card.dataset.name;
          const enabled = chk.checked;
          if (!currentBonusConfig || !currentBonusConfig.RULES[name]) return;
          currentBonusConfig.RULES[name].enabled = enabled;
          
          const textEl = card.querySelector('.bonus-status-text');
          if (textEl) {
            textEl.innerText = enabled ? '啟用中' : '未啟用';
            textEl.style.color = enabled ? 'var(--neon-green)' : 'var(--neon-pink)';
          }
        }

        function saveGlobalBonusSettings(btn) {
          if (!currentBonusConfig) return;
          
          const rateVal = parseFloat(document.getElementById('bonus-global-staff-rate').value) || 0;
          const thresholdVal = parseFloat(document.getElementById('bonus-global-discount-threshold').value) || 0.60;
          const factorVal = parseFloat(document.getElementById('bonus-global-adj-factor').value) || 0.50;

          currentBonusConfig.STAFF_SHARE_RATE = rateVal / 100;
          currentBonusConfig.PEER_PRICE_DISCOUNT_THRESHOLD = thresholdVal;
          currentBonusConfig.PEER_PRICE_ADJUSTMENT_FACTOR = factorVal;

          btn.disabled = true;
          btn.innerText = '儲存中...';

          google.script.run
            .withSuccessHandler(function(res) {
              btn.disabled = false;
              btn.innerText = '儲存全域設定';
              if (res.success) {
                showToast("全域獎金設定儲存成功！");
                loadBonusConfig();
              } else {
                alert('儲存失敗：' + res.msg);
              }
            })
            .saveActiveBonusConfig(currentBonusConfig);
        }

        function saveSalespersonBonus(btn) {
          const card = btn.closest('.bonus-card');
          if (!card) return;
          const name = card.dataset.name;
          if (!currentBonusConfig || !currentBonusConfig.RULES[name]) return;

          const min = parseFloat(document.getElementById('bonus-min-' + name).value) || 0;
          const base = parseFloat(document.getElementById('bonus-base-' + name).value) || 0;
          const step = parseFloat(document.getElementById('bonus-step-' + name).value) || 100000;
          const val = parseFloat(document.getElementById('bonus-val-' + name).value) || 0;

          const breakthroughs = [];
          const limitInputs = card.querySelectorAll('.bt-limit');
          const bonusInputs = card.querySelectorAll('.bt-bonus');
          for (let i = 0; i < limitInputs.length; i++) {
            const limitVal = parseFloat(limitInputs[i].value);
            const bonusVal = parseFloat(bonusInputs[i].value);
            if (!isNaN(limitVal) && limitVal > 0 && !isNaN(bonusVal) && bonusVal > 0) {
              breakthroughs.push({ limit: limitVal * 10000, bonus: bonusVal });
            }
          }

          breakthroughs.sort((a, b) => a.limit - b.limit);

          currentBonusConfig.RULES[name].minThreshold = min;
          currentBonusConfig.RULES[name].stepBase = base;
          currentBonusConfig.RULES[name].stepValue = step;
          currentBonusConfig.RULES[name].stepBonus = val;
          currentBonusConfig.RULES[name].breakthroughs = breakthroughs;

          const chk = document.getElementById('bonus-chk-' + name);
          if (chk) {
            currentBonusConfig.RULES[name].enabled = chk.checked;
          }

          btn.disabled = true;
          btn.innerText = '儲存中...';

          google.script.run
            .withSuccessHandler(function(res) {
              btn.disabled = false;
              btn.innerText = '儲存此同仁設定';
              if (res.success) {
                showToast(name + " 規則儲存成功！");
                loadBonusConfig();
              } else {
                alert('儲存失敗：' + res.msg);
              }
            })
            .saveActiveBonusConfig(currentBonusConfig);
        }

        function addSalespersonBonusRule() {
          const input = document.getElementById('bonus-new-name');
          const name = input.value.trim();
          if (!name) { alert('請輸入同仁姓名！'); return; }

          if (currentBonusConfig.RULES[name]) {
            alert('此同仁已存在規則！');
            return;
          }

          currentBonusConfig.RULES[name] = {
            enabled: true,
            minThreshold: 800000,
            stepBase: 700000,
            stepValue: 100000,
            stepBonus: 1000,
            breakthroughs: [
              { limit: 1500000, bonus: 5000 },
              { limit: 2000000, bonus: 10000 },
              { limit: 2500000, bonus: 15000 },
              { limit: 3000000, bonus: 30000 }
            ]
          };

          google.script.run
            .withSuccessHandler(function(res) {
              if (res.success) {
                input.value = '';
                showToast("業務同仁獎金規則已新增！");
                loadBonusConfig();
              } else {
                alert('新增失敗：' + res.msg);
              }
            })
            .saveActiveBonusConfig(currentBonusConfig);
        }

        function deleteSalespersonBonusRule(btn) {
          const card = btn.closest('.bonus-card');
          if (!card) return;
          const name = card.dataset.name;
          if (!confirm('您確定要刪除 ' + name + ' 的獎金規則設定嗎？(這將使他無法計算業績獎金)')) return;

          delete currentBonusConfig.RULES[name];

          google.script.run
            .withSuccessHandler(function(res) {
              if (res.success) {
                showToast(name + " 規則已刪除！");
                loadBonusConfig();
              } else {
                alert('刪除失敗：' + res.msg);
              }
            })
            .saveActiveBonusConfig(currentBonusConfig);
        }

        function loadAdminBonusReport() {
          const container = document.getElementById('bonus-report-container');
          if (!container) return;

          const stages = [
            '讀取本月銷售與配送資料中...',
            '計算今友利雙倍業績中...',
            '計算睡美人加成倍數中...',
            '計算折半業績明細中...',
            '彙整各業務獎金總表中...',
            '即將完成，請再稍候...'
          ];
          let stageIdx = 0;
          container.innerHTML =
            '<p style="color: var(--pixel-gray); text-align:center;">' +
              '<span class="bonus-loading-spinner" style="display:inline-block; width:14px; height:14px; border:2px solid var(--neon-cyan); border-top-color:transparent; border-radius:50%; margin-right:8px; vertical-align:middle; animation: spin 0.8s linear infinite;"></span>' +
              '<span id="bonus-loading-stage">' + stages[0] + '</span>' +
            '</p>';

          const stageTimer = setInterval(function() {
            stageIdx = (stageIdx + 1) % stages.length;
            const stageEl = document.getElementById('bonus-loading-stage');
            if (stageEl) stageEl.textContent = stages[stageIdx];
          }, 1200);

          const year = document.getElementById('bonus-report-year').value;
          const month = document.getElementById('bonus-report-month').value;

          google.script.run
            .withSuccessHandler(function(res) {
              clearInterval(stageTimer);
              if (res.success) {
                renderAdminBonusReport(res.data);
              } else {
                container.innerHTML = '<p style="color: var(--neon-pink);">' + res.msg + '</p>';
              }
            })
            .withFailureHandler(function(err) {
              clearInterval(stageTimer);
              container.innerHTML = '<p style="color: var(--neon-pink);">載入失敗：' + (err && err.message ? err.message : err) + '</p>';
            })
            .getAdminBonusReport(year, month);
        }

        function renderAdminBonusReport(data) {
          window.adminBonusReportData = data;
          const container = document.getElementById('bonus-report-container');
          if (!container) return;
          container.innerHTML = '';
          
          if (!data.salespeople || data.salespeople.length === 0) {
            container.innerHTML = '<p style="color: var(--pixel-gray); text-align: center;">本月無任何啟用的業務業績紀錄</p>';
            return;
          }

          let html = 
            '<div class="table-container" style="margin-bottom: 24px;">' +
              '<table>' +
                '<thead>' +
                  '<tr>' +
                    '<th style="padding: 14px 12px;">業務姓名</th>' +
                    '<th style="padding: 14px 12px;">當月實銷金額</th>' +
                    '<th style="padding: 14px 12px;">運費扣除</th>' +
                    '<th style="padding: 14px 12px;">業績獎金小計</th>' +
                    '<th style="padding: 14px 12px;">內勤提撥 (' + Math.round(data.globalConfig.STAFF_SHARE_RATE * 100) + '%)</th>' +
                    '<th style="padding: 14px 12px;">業務業績實領</th>' +
                    '<th style="padding: 14px 12px;">配送獎金</th>' +
                    '<th style="padding: 14px 12px;">合計總實領</th>' +
                    '<th style="padding: 14px 12px;">操作</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody>';
                
          data.salespeople.forEach(p => {
            const combinedSalesBonus = p.baseBonus + p.breakthroughBonus;
            const totalActualPayout = p.netPayout + (p.deliveryBonus || 0);
            const freightDeduction = p.freightDeductionAmount || 0;
            html += 
              '<tr data-salesrow="' + p.name + '">' +
                '<td style="font-weight: 700; color: var(--neon-cyan); padding: 14px 12px;">' + p.name + '</td>' +
                '<td class="main-monthly-sales" style="font-weight: bold; padding: 8px 12px;"><input type="number" class="main-monthly-sales-input" value="' + p.monthlySales + '" style="width:100%;padding:4px 6px;border:1px solid var(--neon-cyan);background:var(--inline-bg);color:var(--pixel-white);font-weight:bold;text-align:right;" /></td>' +
                '<td class="main-freight-deduction" style="color: #f59e0b; font-weight: bold; padding: 8px 12px;"><input type="number" class="main-freight-deduction-input" value="' + freightDeduction + '" style="width:100%;padding:4px 6px;border:1px solid #f59e0b;background:var(--inline-bg);color:#f59e0b;font-weight:bold;text-align:right;" /></td>' +
                '<td class="main-combined-bonus" style="padding: 8px 12px;"><input type="number" class="main-combined-bonus-input" value="' + combinedSalesBonus + '" style="width:100%;padding:4px 6px;border:1px solid var(--neon-cyan);background:var(--inline-bg);color:var(--pixel-white);text-align:right;" /></td>' +
                '<td class="main-staff-share" style="color: var(--pixel-gray); padding: 8px 12px;"><input type="number" class="main-staff-share-input" value="' + p.staffShare + '" style="width:100%;padding:4px 6px;border:1px solid var(--pixel-gray);background:var(--inline-bg);color:var(--pixel-gray);text-align:right;" /></td>' +
                '<td class="main-net-payout" style="padding: 8px 12px;"><input type="number" class="main-net-payout-input" value="' + p.netPayout + '" style="width:100%;padding:4px 6px;border:1px solid var(--neon-cyan);background:var(--inline-bg);color:var(--pixel-white);text-align:right;" /></td>' +
                '<td style="color: var(--neon-pink); font-weight: bold; padding: 14px 12px;">$ ' + (p.deliveryBonus || 0).toLocaleString() + '</td>' +
                '<td class="main-total-actual" style="color: var(--neon-green); font-weight: bold; padding: 14px 12px;">$ ' + totalActualPayout.toLocaleString() + '</td>' +
                '<td style="padding: 14px 12px;">' +
                  '<button class="copy-btn" data-name="' + p.name + '" onclick="toggleReportDetail(this)">展開/收合明細</button>' +
                '</td>' +
              '</tr>';
          });
          
          html += 
                '</tbody>' +
              '</table>' +
            '</div>';
          function moneyText(v) {
            const n = Math.round(Number(v) || 0);
            if (n === 0) return '&nbsp;';
            return (n < 0 ? '<span style="color:#c0392b;">-' + Math.abs(n).toLocaleString() + '</span>' : n.toLocaleString());
          }

          function getCustomerShortName(name) {
            let s = String(name || '').trim();
            if (!s) return '';
            if (s.includes('漢樺') || s.includes('波爾泰')) return '漢樺';

            const exceptions = ['夏綠蒂', '德思特尼', '百事得', '百達富麗', '鑫東聖', '海格斯', '信義星', '好仕齊', '新睦豐', '富利鴻', '金豪益'];
            for (const ex of exceptions) {
              if (s.includes(ex)) return ex;
            }

            s = s
              .replace(/[()（）\[\]【】]/g, '')
              .replace(/[-_－—–\s]*(出貨|樣品|門市|倉庫)$/g, '')
              .trim();

            const suffixes = [
              '股份有限公司', '有限公司', '公司', '企業', '實業', '國際',
              '工程', '建材', '材料', '磁磚', '精品', '商行', '行',
              '建設', '開發', '設計', '裝潢', '裝修', '工業'
            ];

            let changed = true;
            while (changed) {
              changed = false;
              for (const suf of suffixes) {
                if (s.endsWith(suf)) {
                  s = s.slice(0, -suf.length).trim();
                  changed = true;
                  break;
                }
              }
            }

            s = s.replace(/[-_－—–\s]+$/g, '').trim();
            if (s.length > 4) s = s.slice(0, 4);
            return s || String(name || '').trim().slice(0, 4);
          }

          function mergeCustomer(name) {
            let s = String(name || '').trim();
            if (s.includes('漢樺') || s.includes('波爾泰')) return '漢樺';
            if (s.includes('大永') || s.includes('新大永')) return '大永';
            if (s.includes('錦義') || s.includes('睿敏')) return '錦義';
            if (s.includes('滿財') || s.includes('東春')) return '滿財';
            if (s.includes('傅邦') || s.includes('盛邦')) return '傅邦';
            if (s.includes('喬翌') || s.includes('伊特')) return '伊特';
            if (s.includes('太爾') || s.includes('信義星')) return '信義星';
            if (s.includes('鼎康') || s.includes('鼎晨')) return '鼎晨';
            if (s.includes('高頓') || s.includes('馬來高')) return '馬來高';
            if (s.includes('鏷城') || s.includes('璞城')) return '鏷城';
            if (s.includes('今冠') || s.includes('金冠')) return '金冠';
            if (s.includes('琮達') || s.includes('琮威')) return '琮威';
            return s;
          }

          // 存放各業務的客戶結算資料，供匯出用
          if (!window._bonusExportData) window._bonusExportData = {};

          function buildBonusWorksheetHtml(p) {
            const esc = s => String(s == null ? '' : s)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
            const editableInput = (value, cls, type = 'number', isDeduct = false) =>
              '<input type="' + type + '" class="bonus-sheet-input ' + cls + (isDeduct ? ' bonus-deduct-input' : '') + '" value="' + esc(value) + '" oninput="recalcBonusWorksheet(this.closest(&apos;.bonus-sheet-wrap&apos;))">';
            const groups = [];
            const groupMap = new Map();
            const totals = {
              sales: 0,
              sleeper: 0,
              freight: 0,
              returnDeduct: 0,
              discountDeduct: 0,
              halfDeduct: 0,
              noCalcDeduct: 0,
              settle: 0
            };

            (p.allTransactions || []).forEach(tx => {
              const mergedCustKey = mergeCustomer(tx.customer || '');
              const key = mergedCustKey;
              if (!groupMap.has(key)) {
                const group = {
                  customerCode: tx.customerCode || '',
                  customerName: getCustomerShortName(tx.customer || ''),
                  salesAmt: 0,
                  sleeperAmt: 0,
                  freightAmt: 0,
                  returnDeduct: 0,
                  discountDeduct: 0,
                  halfDeduct: 0,
                  noCalcDeduct: 0,
                  settle: 0
                };
                groupMap.set(key, group);
                groups.push(group);
              }
              const row = groupMap.get(key);
              const weight = tx.weight || 1;
              const multiplier = tx.multiplier || 1;
              const baseSales = tx.type === 'sleeper' || tx.type === 'freight' ? 0 : Math.round((tx.originalAmt || 0) * multiplier * weight);
              const sleeperAmt = tx.type === 'sleeper' ? Math.round((tx.originalAmt || 0) * multiplier * weight) : 0;
              const freightAmt = tx.type === 'freight' ? Math.round(Math.abs(tx.originalAmt || 0) * weight) : 0;
              const discountedFinal = Math.round(tx.weightedAmt || 0);
              const discountDeduct = (tx.type !== 'freight' && tx.isDiscounted) ? Math.max(0, baseSales - discountedFinal) : 0;
              // 退貨先扣改為人工填寫，避免與原始負數明細重複扣除
              const returnDeduct = 0;
              const halfDeduct = 0;
              const noCalcDeduct = 0;

              row.salesAmt += baseSales;
              row.sleeperAmt += sleeperAmt;
              row.freightAmt += freightAmt;
              row.returnDeduct += returnDeduct;
              row.discountDeduct += discountDeduct;
              row.halfDeduct += halfDeduct;
              row.noCalcDeduct += noCalcDeduct;
            });

            groups.forEach(row => {
              row.settle = row.salesAmt + row.sleeperAmt - row.freightAmt - row.returnDeduct - row.discountDeduct - row.halfDeduct - row.noCalcDeduct;
              totals.sales += row.salesAmt;
              totals.sleeper += row.sleeperAmt;
              totals.freight += row.freightAmt;
              totals.returnDeduct += row.returnDeduct;
              totals.discountDeduct += row.discountDeduct;
              totals.halfDeduct += row.halfDeduct;
              totals.noCalcDeduct += row.noCalcDeduct;
              totals.settle += row.settle;
            });

            // 預設按客戶編號排序
            groups.sort((a, b) => String(a.customerCode || '').localeCompare(String(b.customerCode || ''), 'zh-TW'));

            // 存供匯出用（避免從 DOM input 讀取不穩定）
            window._bonusExportData[p.name] = groups.map(g => ({ name: g.customerName, settle: g.settle }));

            const monthLabel = data.year + '年' + data.month + '月';
            let rowsHtml = '';
            groups.forEach(r => {
              rowsHtml +=
                '<tr data-custcode="' + esc(r.customerCode || '') + '" data-custname="' + esc(r.customerName || '') + '">' +
                  '<td>' + esc(r.customerName || '&nbsp;') + '</td>' +
                  '<td>' + editableInput(r.salesAmt, 'sales-input') + '</td>' +
                  '<td>' + editableInput(r.sleeperAmt, 'sleeper-input') + '</td>' +
                  '<td class="bonus-deduct-text">' + editableInput(r.freightAmt, 'freight-input', 'number', true) + '</td>' +
                  '<td class="bonus-deduct-text">' + editableInput(r.returnDeduct, 'return-input', 'number', true) + '</td>' +
                  '<td class="bonus-deduct-text">' + editableInput(r.discountDeduct, 'discount-input', 'number', true) + '</td>' +
                  '<td class="bonus-deduct-text">' + editableInput(r.halfDeduct, 'half-input', 'number', true) + '</td>' +
                  '<td class="bonus-deduct-text">' + editableInput(r.noCalcDeduct, 'nocalc-input', 'number', true) + '</td>' +
                  '<td class="bonus-settle-cell"><span class="bonus-settle-text">' + moneyText(r.settle) + '</span></td>' +
                '</tr>';
            });

            const grandGross = totals.sales + totals.sleeper;
            const grandDeduct = totals.freight + totals.returnDeduct + totals.discountDeduct + totals.halfDeduct + totals.noCalcDeduct;

          return (
              '<div class="bonus-sheet-wrap" data-salesname="' + esc(p.name) + '">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">' +
                  '<div style="font-size:24px; font-weight:800; color:var(--pixel-white);">' + monthLabel + ' 獎金計算表</div>' +
                  '<div style="font-size:20px; font-weight:700; color:var(--pixel-white);">業務：' + esc(p.name) + '</div>' +
                '</div>' +
                '<div style="margin-bottom:8px; font-size:14px; color:var(--pixel-gray);">' +
                  '可直接修改數字後再匯出 JPG，原始明細也會保留在下方。' +
                '</div>' +
                '<div style="margin-bottom:10px; font-size:13px; color:#ffb3b3;">退貨先扣請人工填寫，預設 0，避免與原始退貨明細重複扣除。</div>' +
                '<div class="bonus-sheet-toolbar">' +
                  '<button type="button" class="copy-btn" onclick="recalcBonusWorksheet(this.closest(&apos;.bonus-sheet-wrap&apos;))">計算</button>' +
                  '<button type="button" class="copy-btn" onclick="sortBonusSheet(this,&apos;code&apos;)">按編號排序</button>' +
                  '<button type="button" class="copy-btn" onclick="sortBonusSheet(this,&apos;settle&apos;)">按金額排序</button>' +
                  '<button type="button" class="copy-btn" onclick="exportBonusSheetJpg(this)">匯出 JPG</button>' +
                '</div>' +
                '<div class="table-container">' +
                  '<table class="bonus-sheet-table">' +
                    '<thead>' +
                      '<tr>' +
                        '<th class="group-head" rowspan="2" style="width: 16%;">客戶名稱</th>' +
                        '<th class="group-head" rowspan="2" style="width: 12%;">實銷金額</th>' +
                        '<th class="group-head" rowspan="2" style="width: 12%;">睡美人</th>' +
                        '<th class="group-head" colspan="5" style="width: 40%;">不可列入部分(應扣除)</th>' +
                        '<th class="group-head" rowspan="2" style="width: 12%;">結算可計業績</th>' +
                      '</tr>' +
                      '<tr>' +
                        '<th class="sub-head bonus-deduct-head">運費</th>' +
                        '<th class="sub-head bonus-deduct-head">退貨先扣</th>' +
                        '<th class="sub-head bonus-deduct-head">折讓</th>' +
                        '<th class="sub-head bonus-deduct-head">業績折半</th>' +
                        '<th class="sub-head bonus-deduct-head">業績不計算</th>' +
                      '</tr>' +
                    '</thead>' +
                    '<tbody>' +
                      rowsHtml +
                    '</tbody>' +
                    '<tfoot>' +
                      '<tr>' +
                        '<td style="text-align:right;">合計</td>' +
                        '<td class="bonus-footer-sales">' + moneyText(totals.sales) + '</td>' +
                        '<td class="bonus-footer-sleeper">' + moneyText(totals.sleeper) + '</td>' +
                        '<td class="bonus-footer-freight bonus-deduct-text">' + moneyText(totals.freight) + '</td>' +
                        '<td class="bonus-footer-return bonus-deduct-text">' + moneyText(totals.returnDeduct) + '</td>' +
                        '<td class="bonus-footer-discount bonus-deduct-text">' + moneyText(totals.discountDeduct) + '</td>' +
                        '<td class="bonus-footer-half bonus-deduct-text">' + moneyText(totals.halfDeduct) + '</td>' +
                        '<td class="bonus-footer-nocalc bonus-deduct-text">' + moneyText(totals.noCalcDeduct) + '</td>' +
                        '<td class="bonus-footer-settle">' + moneyText(totals.settle) + '</td>' +
                      '</tr>' +
                    '</tfoot>' +
                  '</table>' +
                '</div>' +
              '</div>'
            );
          }

          function recalcBonusWorksheet(sheetEl) {
            if (!sheetEl) return;
            const rows = sheetEl.querySelectorAll('tbody tr');
            let totals = { sales: 0, sleeper: 0, freight: 0, returnDeduct: 0, discountDeduct: 0, halfDeduct: 0, noCalcDeduct: 0, settle: 0 };
            rows.forEach(row => {
              const getVal = sel => {
                const el = row.querySelector(sel);
                return el ? (parseFloat(el.value) || 0) : 0;
              };
              const sales = getVal('.sales-input');
              const sleeper = getVal('.sleeper-input');
              const freight = getVal('.freight-input');
              const ret = getVal('.return-input');
              const discount = getVal('.discount-input');
              const half = getVal('.half-input');
              const noCalc = getVal('.nocalc-input');
              const settle = sales + sleeper - freight - ret - discount - half - noCalc;
              const settleText = row.querySelector('.bonus-settle-text');
              if (settleText) settleText.innerText = settle.toLocaleString();
              totals.sales += sales;
              totals.sleeper += sleeper;
              totals.freight += freight;
              totals.returnDeduct += ret;
              totals.discountDeduct += discount;
              totals.halfDeduct += half;
              totals.noCalcDeduct += noCalc;
              totals.settle += settle;
            });
            const setTxt = (cls, val) => {
              const el = sheetEl.querySelector(cls);
              if (el) el.innerText = Math.round(val).toLocaleString();
            };
            setTxt('.bonus-footer-sales', totals.sales);
            setTxt('.bonus-footer-sleeper', totals.sleeper);
            setTxt('.bonus-footer-freight', totals.freight);
            setTxt('.bonus-footer-return', totals.returnDeduct);
            setTxt('.bonus-footer-discount', totals.discountDeduct);
            setTxt('.bonus-footer-half', totals.halfDeduct);
            setTxt('.bonus-footer-nocalc', totals.noCalcDeduct);
            setTxt('.bonus-footer-settle', totals.settle);

            // 更新供匯出用的客戶結算資料
            const salesName = sheetEl.dataset.salesname || '';
            if (salesName && window._bonusExportData) {
              const custData = [];
              rows.forEach(row => {
                const name = row.dataset.custname || '';
                if (!name) return;
                const getVal = sel => {
                  const el = row.querySelector(sel);
                  return el ? (parseFloat(el.value) || 0) : 0;
                };
                const sales = getVal('.sales-input');
                const sleeper = getVal('.sleeper-input');
                const freight = getVal('.freight-input');
                const ret = getVal('.return-input');
                const discount = getVal('.discount-input');
                const half = getVal('.half-input');
                const noCalc = getVal('.nocalc-input');
                const settle = sales + sleeper - freight - ret - discount - half - noCalc;
                custData.push({ name, settle });
              });
              window._bonusExportData[salesName] = custData;

              // 重新載入獎金報表，自動根據新結算業績重新計算獎金
              google.script.run.loadAdminBonusReport();
            }
          }

          function sortBonusSheet(btn, mode) {
            const sheet = btn.closest('.bonus-sheet-wrap');
            if (!sheet) return;
            const tbody = sheet.querySelector('tbody');
            if (!tbody) return;
            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort((a, b) => {
              if (mode === 'code') {
                return String(a.dataset.custcode || '').localeCompare(String(b.dataset.custcode || ''), 'zh-TW');
              } else {
                const getSettle = tr => {
                  const sales = parseFloat(tr.querySelector('.sales-input')?.value) || 0;
                  const sleeper = parseFloat(tr.querySelector('.sleeper-input')?.value) || 0;
                  const freight = parseFloat(tr.querySelector('.freight-input')?.value) || 0;
                  const ret = parseFloat(tr.querySelector('.return-input')?.value) || 0;
                  const discount = parseFloat(tr.querySelector('.discount-input')?.value) || 0;
                  const half = parseFloat(tr.querySelector('.half-input')?.value) || 0;
                  const noCalc = parseFloat(tr.querySelector('.nocalc-input')?.value) || 0;
                  return sales + sleeper - freight - ret - discount - half - noCalc;
                };
                return getSettle(b) - getSettle(a);
              }
            });
            rows.forEach(r => tbody.appendChild(r));
          }

          function exportBonusSheetJpg(btn) {
            const sheet = btn.closest('.bonus-sheet-wrap');
            if (!sheet) return;
            if (typeof html2canvas === 'undefined') {
              alert('JPG 匯出工具尚未載入完成，請稍後再試。');
              return;
            }

            // 固定日間模式
            const bgColor = '#f5f0e8';
            const textColor = '#1f2937';
            const accentColor = '#7c5c28';
            const headerBg = '#e8dcc8';
            const borderColor = '#c9b99a';
            const redColor = '#c0392b';

            const salesName = sheet.dataset.salesname || '';
            const monthLabel = (data.year || '') + '年' + (data.month || '') + '月';

            // 從編輯後的摘要表讀數字
            let monthlySales = 0, salesBonus = 0, staffShare = 0, netPayout = 0;
            const summaryRow = document.querySelector('tr[data-salesrow="' + salesName + '"]');
            if (summaryRow) {
              monthlySales = parseInt(summaryRow.querySelector('.main-monthly-sales-input')?.value) || 0;
              salesBonus   = parseInt(summaryRow.querySelector('.main-combined-bonus-input')?.value) || 0;
              staffShare   = parseInt(summaryRow.querySelector('.main-staff-share-input')?.value) || 0;
              netPayout    = parseInt(summaryRow.querySelector('.main-net-payout-input')?.value) || 0;
            }
            const fmt = n => '$ ' + Math.round(n).toLocaleString();
            const salesWan = Math.round(monthlySales / 10000) + '萬';

            // 從預先儲存的資料讀取（比 DOM input 讀取可靠）
            const custItems = ((window._bonusExportData || {})[salesName] || []).slice();
            custItems.sort((a, b) => b.settle - a.settle);

            // 建立 HTML
            const cellStyle = 'padding:10px 16px;text-align:right;border:1px solid ' + borderColor + ';font-size:15px;min-width:120px;';
            const thStyle = 'padding:8px 16px;text-align:center;background:' + headerBg + ';border:1px solid ' + borderColor + ';font-size:13px;color:' + accentColor + ';font-weight:700;';
            // 客戶三欄格（table 排版，html2canvas 相容）
            const tdName = 'padding:7px 10px;border:1px solid ' + borderColor + ';background:#ffffff;font-size:14px;font-weight:600;vertical-align:middle;';
            const tdAmt  = 'padding:7px 10px;border:1px solid ' + borderColor + ';background:#ffffff;font-size:14px;text-align:right;vertical-align:middle;white-space:nowrap;';
            let custRows = '<table style="border-collapse:collapse;width:100%;table-layout:fixed;">';
            for (let i = 0; i < custItems.length; i += 3) {
              custRows += '<tr>';
              for (let j = 0; j < 3; j++) {
                const item = custItems[i + j];
                if (item) {
                  const color = item.settle < 0 ? redColor : textColor;
                  custRows +=
                    '<td style="' + tdName + 'color:' + color + ';">' + item.name + '</td>' +
                    '<td style="' + tdAmt  + 'color:' + color + ';">$ ' + Math.round(item.settle).toLocaleString() + '</td>';
                } else {
                  custRows += '<td style="' + tdName + '"></td><td style="' + tdAmt + '"></td>';
                }
              }
              custRows += '</tr>';
            }
            custRows += '</table>';

            const exportHtml =
              '<div style="font-family:Arial,sans-serif;background:' + bgColor + ';color:' + textColor + ';padding:28px 32px;box-sizing:border-box;width:900px;">' +
                // 標題
                '<div style="font-size:26px;font-weight:900;color:' + accentColor + ';margin-bottom:18px;letter-spacing:1px;">' +
                  monthLabel + ' 獎金計算　' + salesName +
                '</div>' +
                // 摘要表
                '<table style="border-collapse:collapse;margin-bottom:24px;width:100%;">' +
                  '<thead><tr>' +
                    '<th style="' + thStyle + '">實銷</th>' +
                    '<th style="' + thStyle + '">業績獎金</th>' +
                    '<th style="' + thStyle + '">內勤提撥</th>' +
                    '<th style="' + thStyle + '">業務實領</th>' +
                  '</tr></thead>' +
                  '<tbody><tr>' +
                    '<td style="' + cellStyle + 'font-size:18px;font-weight:700;">' + salesWan + '</td>' +
                    '<td style="' + cellStyle + '">' + fmt(salesBonus) + '</td>' +
                    '<td style="' + cellStyle + 'color:#c0392b;">' + fmt(staffShare) + '</td>' +
                    '<td style="' + cellStyle + 'font-weight:700;color:' + accentColor + ';">' + fmt(netPayout) + '</td>' +
                  '</tr></tbody>' +
                '</table>' +
                // 客戶業績標題
                '<div style="font-size:13px;font-weight:700;color:' + accentColor + ';margin-bottom:6px;border-bottom:2px solid ' + borderColor + ';padding-bottom:4px;">客戶業績明細（結算可計業績）</div>' +
                // 客戶三欄
                custRows +
              '</div>';

            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
            wrapper.innerHTML = exportHtml;
            document.body.appendChild(wrapper);

            html2canvas(wrapper.firstChild, {
              backgroundColor: bgColor,
              scale: 2,
              useCORS: true,
              scrollX: 0,
              scrollY: 0
            }).then(canvas => {
              const link = document.createElement('a');
              link.download = monthLabel + '_' + salesName + '_獎金.jpg';
              link.href = canvas.toDataURL('image/jpeg', 0.95);
              link.click();
              wrapper.remove();
            }).catch(err => {
              wrapper.remove();
              alert('匯出失敗：' + err);
            });
          }

          window.recalcBonusWorksheet = recalcBonusWorksheet;
          window.sortBonusSheet = sortBonusSheet;
          window.exportBonusSheetJpg = exportBonusSheetJpg;

          function buildCalcDetailHtml(p) {
            const esc = s => String(s == null ? '' : s)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
            let parts = [];
            if (p.jinyouliTransactions && p.jinyouliTransactions.length > 0) {
              let h = '<div style="margin-top:16px;"><h5 style="color:var(--neon-cyan);font-size:16px;margin-bottom:8px;font-weight:bold;">🏆 今友利詳細算式</h5><div class="table-container"><table class="discount-table"><thead><tr><th>客戶</th><th>案名(備註)</th><th>產品編號</th><th>數量</th><th>成交單價</th><th>原始銷額</th><th>雙倍採計</th></tr></thead><tbody>';
              p.jinyouliTransactions.forEach(tx => {
                h += '<tr><td>' + esc(getCustomerShortName(tx.customer || '')) + '</td><td>' + esc(tx.projectName || '') + '</td><td><code>' + esc(tx.productCode || '') + '</code></td><td>' + esc(tx.qty || 0) + '</td><td>' + esc(Math.round(tx.unitPrice || 0)) + '</td><td>$ ' + Math.round(tx.originalAmt || 0).toLocaleString() + '</td><td style="color:var(--neon-cyan);font-weight:bold;">$ ' + Math.round(tx.weightedAmt || 0).toLocaleString() + '</td></tr>';
              });
              h += '</tbody></table></div></div>';
              parts.push(h);
            }
            if (p.sleeperTransactions && p.sleeperTransactions.length > 0) {
              let h = '<div style="margin-top:16px;"><h5 style="color:#c084fc;font-size:16px;margin-bottom:8px;font-weight:bold;">🏆 睡美人詳細算式</h5><div class="table-container"><table class="discount-table"><thead><tr><th>客戶</th><th>案名(備註)</th><th>產品編號</th><th>數量</th><th>成交單價</th><th>等級/成本</th><th>毛利/比值</th><th>倍數</th><th>加成採計</th></tr></thead><tbody>';
              p.sleeperTransactions.forEach(tx => {
                const marginText = (tx.margin * 100).toFixed(1) + '% / ' + tx.priceCostRatio.toFixed(2);
                h += '<tr><td>' + esc(getCustomerShortName(tx.customer || '')) + '</td><td>' + esc(tx.projectName || '') + '</td><td><code>' + esc(tx.productCode || '') + '</code></td><td>' + esc(tx.qty || 0) + '</td><td>' + esc(Math.round(tx.unitPrice || 0)) + '</td><td>' + esc(tx.grade || '') + ' / $' + esc(Math.round(tx.cost || 0)) + '</td><td>' + esc(marginText) + '</td><td>x ' + esc(tx.multiplier || 1) + '</td><td style="color:#c084fc;font-weight:bold;">$ ' + Math.round(tx.weightedAmt || 0).toLocaleString() + '</td></tr>';
              });
              h += '</tbody></table></div></div>';
              parts.push(h);
            }
            if (p.discountedTransactions && p.discountedTransactions.length > 0) {
              let h = '<div style="margin-top:16px;"><h5 style="color:var(--neon-pink);font-size:16px;margin-bottom:8px;font-weight:bold;">⚠️ 六折以下折半詳細算式</h5><div class="table-container"><table class="discount-table"><thead><tr><th>客戶</th><th>案名(備註)</th><th>產品編號</th><th>數量</th><th>成交單價</th><th>同行價</th><th>折數</th><th>原銷售金額</th><th>折後採計</th></tr></thead><tbody>';
              p.discountedTransactions.forEach(tx => {
                h += '<tr><td>' + esc(getCustomerShortName(tx.customer || '')) + '</td><td>' + esc(tx.projectName || '') + '</td><td><code>' + esc(tx.productCode || '') + '</code></td><td>' + esc(tx.qty || 0) + '</td><td>' + esc(Math.round(tx.unitPrice || 0)) + '</td><td>' + esc(Math.round(tx.peerPrice || 0)) + '</td><td>' + esc(tx.discountRate || '') + '</td><td>$ ' + Math.round(tx.originalAmt || 0).toLocaleString() + '</td><td style="color:var(--neon-cyan);font-weight:bold;">$ ' + Math.round(tx.weightedAmt || 0).toLocaleString() + '</td></tr>';
              });
              h += '</tbody></table></div></div>';
              parts.push(h);
            }
            if (p.freightTransactions && p.freightTransactions.length > 0) {
              let h = '<div style="margin-top:16px;"><h5 style="color:#fbbf24;font-size:16px;margin-bottom:8px;font-weight:bold;">🚚 運費扣除明細</h5><div class="table-container"><table class="discount-table"><thead><tr><th>客戶</th><th>案名(備註)</th><th>產品編號</th><th>原始金額</th><th>扣除金額</th><th>權重</th></tr></thead><tbody>';
              p.freightTransactions.forEach(tx => {
                h += '<tr><td>' + esc(getCustomerShortName(tx.customer || '')) + '</td><td>' + esc(tx.projectName || '') + '</td><td><code>' + esc(tx.productCode || '') + '</code></td><td>$ ' + Math.round(tx.originalAmt || 0).toLocaleString() + '</td><td style="color:#fde68a;font-weight:bold;">- $ ' + Math.round(tx.deductedAmt || 0).toLocaleString() + '</td><td>' + (tx.weight < 1 ? '1/3' : '1.0') + '</td></tr>';
              });
              h += '</tbody></table></div></div>';
              parts.push(h);
            }
            return parts.join('');
          }

          data.salespeople.forEach(p => {
            html += 
              '<div id="report-detail-' + p.name + '" class="panel-card" style="display: none; margin-bottom: 20px; border-color: rgba(255, 255, 255, 0.15); background: rgba(255,255,255,0.01); padding: 20px;">' +
                '<h4 style="color: var(--neon-cyan); font-size: 18px; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 12px;">' + p.name + ' ' + data.month + '月份績效獎金明細</h4>' +
                buildBonusWorksheetHtml(p) +
                buildCalcDetailHtml(p) +
              '</div>';
          });
          
          container.innerHTML = html;
        }

        function calcSleeperMultiplierClient(grade, margin, priceCostRatio) {
          const g = String(grade || "").toUpperCase().trim();
          if (g === 'XXX') {
            if (priceCostRatio >= 0.7) return 3;
            if (priceCostRatio >= 0.5) return 2;
            return 1;
          }
          if (g === 'S') {
            if (margin > 0.15) return 3;
            if (priceCostRatio >= 0.85) return 2;
            return 1;
          }
          if (g === 'A') {
            if (margin > 0.15) return 2;
            if (margin >= -0.05) return 1.5;
            return 1;
          }
          if (g === 'B') {
            if (margin > 0.30) return 2;
            return 1;
          }
          return 1;
        }

        function syncAndRecalculate(inputEl, field) {
          const rowIdx = parseInt(inputEl.getAttribute('data-rowidx'));
          const salesName = inputEl.getAttribute('data-salesname');
          const val = parseFloat(inputEl.value) || 0;
          
          // 1. Find the salesperson and transaction in the global data model
          const p = window.adminBonusReportData.salespeople.find(s => s.name === salesName);
          if (!p) return;
          
          const tx = p.allTransactions.find(t => t.rowIdx === rowIdx);
          if (!tx) return;
          
          // Update the data model field
          tx[field] = val;
          
          // 2. Synchronize all inputs in the DOM with the same rowIdx and salesname
          const siblingInputs = document.querySelectorAll('input[data-rowidx="' + rowIdx + '"][data-salesname="' + salesName + '"]');
          siblingInputs.forEach(inp => {
            if (inp !== inputEl) {
              if (field === 'qty' && inp.classList.contains('qty-input')) inp.value = val;
              if (field === 'price' && inp.classList.contains('price-input')) inp.value = val;
              if (field === 'cost' && inp.classList.contains('cost-input')) inp.value = val;
              if (field === 'peerPrice' && inp.classList.contains('peerprice-input')) inp.value = val;
            }
          });
          
          // 3. Recalculate transaction derived values
          if (tx.type === 'freight') {
            const freightAmt = Math.abs(tx.originalAmt || 0) * (tx.weight || 1);
            tx.weightedAmt = -freightAmt;
            tx.originalAmt = Math.abs(tx.originalAmt || 0);
            
            if (p.freightTransactions) {
              const freightTx = p.freightTransactions.find(t => t.rowIdx === rowIdx);
              if (freightTx) {
                freightTx[field] = val;
                freightTx.originalAmt = tx.originalAmt;
                freightTx.deductedAmt = freightAmt;
                freightTx.weight = tx.weight || 1;
              }
            }
          } else {
            tx.originalAmt = tx.qty * tx.unitPrice;
            
            tx.isDiscounted = (tx.peerPrice > 0 && tx.unitPrice < tx.peerPrice * window.adminBonusReportData.globalConfig.PEER_PRICE_DISCOUNT_THRESHOLD);
            
            if (tx.type === 'sleeper') {
              const qtyAbs = Math.abs(tx.qty);
              const totalCost = tx.cost * qtyAbs;
              tx.margin = tx.originalAmt > 0 ? (tx.originalAmt - totalCost) / tx.originalAmt : 0;
              tx.priceCostRatio = tx.cost > 0 ? tx.unitPrice / tx.cost : 1;
              tx.multiplier = calcSleeperMultiplierClient(tx.grade, tx.margin, tx.priceCostRatio);
            } else if (tx.type === 'jinyouli') {
              tx.multiplier = 2;
            } else {
              tx.multiplier = 1;
            }
            
            const baseAmt = tx.originalAmt * tx.multiplier;
            const amtAfterDiscount = tx.isDiscounted ? baseAmt * window.adminBonusReportData.globalConfig.PEER_PRICE_ADJUSTMENT_FACTOR : baseAmt;
            tx.weightedAmt = amtAfterDiscount * tx.weight;
          }
          
          // Synchronize to other transaction lists in the data model
          if (p.jinyouliTransactions) {
            const jylTx = p.jinyouliTransactions.find(t => t.rowIdx === rowIdx);
            if (jylTx) {
              jylTx[field] = val;
              jylTx.originalAmt = tx.originalAmt;
              jylTx.isDiscounted = tx.isDiscounted;
              jylTx.multiplier = tx.multiplier;
              jylTx.weightedAmt = tx.weightedAmt;
            }
          }
          if (p.sleeperTransactions) {
            const slpTx = p.sleeperTransactions.find(t => t.rowIdx === rowIdx);
            if (slpTx) {
              slpTx[field] = val;
              slpTx.originalAmt = tx.originalAmt;
              slpTx.isDiscounted = tx.isDiscounted;
              slpTx.margin = tx.margin;
              slpTx.priceCostRatio = tx.priceCostRatio;
              slpTx.multiplier = tx.multiplier;
              slpTx.weightedAmt = tx.weightedAmt;
            }
          }
          if (p.discountedTransactions) {
            const discTx = p.discountedTransactions.find(t => t.rowIdx === rowIdx);
            if (discTx) {
              discTx[field] = val;
              discTx.originalAmt = tx.originalAmt;
              discTx.isDiscounted = tx.isDiscounted;
              discTx.multiplier = tx.multiplier;
              discTx.weightedAmt = tx.weightedAmt;
            }
          }
          if (p.freightTransactions) {
            const freightTx = p.freightTransactions.find(t => t.rowIdx === rowIdx);
            if (freightTx) {
              freightTx[field] = val;
              freightTx.originalAmt = tx.originalAmt;
              freightTx.weight = tx.weight || 1;
              freightTx.deductedAmt = Math.abs(tx.originalAmt || 0) * freightTx.weight;
            }
          }
          
          // 4. Update cells in all tables for this rowIdx
          const matchingRows = document.querySelectorAll('tr[data-rowidx="' + rowIdx + '"]');
          matchingRows.forEach(rowEl => {
            // Update Sleeper specific cells if present
            const marginRatioCell = rowEl.querySelector('.margin-ratio-cell');
            if (marginRatioCell) {
              const marginText = (tx.margin * 100).toFixed(1) + '%';
              const ratioText = tx.priceCostRatio.toFixed(2);
              marginRatioCell.innerText = marginText + ' / ' + ratioText;
            }
            
            const multiplierCell = rowEl.querySelector('.multiplier-cell');
            if (multiplierCell) {
              multiplierCell.innerText = 'x ' + tx.multiplier;
            }
            
            // Update Jinyouli / Sleeper discount status text
            const discountTextCell = rowEl.querySelector('.discount-text-cell');
            if (discountTextCell) {
              discountTextCell.innerHTML = tx.isDiscounted ? '<span style="color:var(--neon-pink)">低於六折打折</span>' : '無打折';
            }
            
            // Update Discounted table rate cell
            const discountRateCell = rowEl.querySelector('.discount-rate-cell');
            if (discountRateCell) {
              const rateVal = tx.peerPrice > 0 ? (tx.unitPrice / tx.peerPrice * 100) : 0;
              discountRateCell.innerText = (Math.round(rateVal) / 10).toFixed(1) + '折';
            }
            
            // Update Original Amount cell
            const originalAmtCell = rowEl.querySelector('.original-amt-cell');
            if (originalAmtCell) {
              originalAmtCell.innerText = '$ ' + Math.round(tx.originalAmt).toLocaleString();
            }
            
            // Update Weighted Amount cell
            const weightedAmtCell = rowEl.querySelector('.weighted-amt-cell');
            if (weightedAmtCell) {
              weightedAmtCell.innerText = '$ ' + Math.round(tx.weightedAmt).toLocaleString();
            }

            const freightAmtCell = rowEl.querySelector('.freight-amt-cell');
            if (freightAmtCell && tx.type === 'freight') {
              freightAmtCell.innerText = '- $ ' + Math.round(Math.abs(tx.weightedAmt)).toLocaleString();
            }
          });
          
          // 5. Recalculate summary card and update UI
          recalculateSalespersonSummary(salesName);
        }

        function syncParamAndRecalculate(inputEl, field) {
          const salesName = inputEl.getAttribute('data-salesname');
          const val = parseFloat(inputEl.value) || 0;
          
          const p = window.adminBonusReportData.salespeople.find(s => s.name === salesName);
          if (!p) return;
          
          p.rule[field] = val;
          
          // Also sync with the collapsible settings card if it exists in the DOM
          const minInput = document.getElementById('bonus-min-' + salesName);
          const baseInput = document.getElementById('bonus-base-' + salesName);
          const stepInput = document.getElementById('bonus-step-' + salesName);
          const valInput = document.getElementById('bonus-val-' + salesName);
          
          if (field === 'minThreshold' && minInput) minInput.value = val;
          if (field === 'stepBase' && baseInput) baseInput.value = val;
          if (field === 'stepValue' && stepInput) stepInput.value = val;
          if (field === 'stepBonus' && valInput) valInput.value = val;
          
          if (typeof currentBonusConfig !== 'undefined' && currentBonusConfig && currentBonusConfig.RULES && currentBonusConfig.RULES[salesName]) {
            const ruleObj = currentBonusConfig.RULES[salesName];
            if (field === 'minThreshold') ruleObj.minThreshold = val;
            if (field === 'stepBase') ruleObj.stepBase = val;
            if (field === 'stepValue') ruleObj.stepValue = val;
            if (field === 'stepBonus') ruleObj.stepBonus = val;
          }
          
          recalculateSalespersonSummary(salesName);
        }

        function recalculateSalespersonSummary(salesName) {
          const p = window.adminBonusReportData.salespeople.find(s => s.name === salesName);
          if (!p) return;
          
          let totalSalesAmount = 0;
          let generalSalesAmount = 0;
          let sleeperSalesAmount = 0;
          let jinyouliSalesAmount = 0;
          let discountReductionAmount = 0;
          let freightDeductionAmount = 0;

          p.allTransactions.forEach(tx => {
            if (tx.type === 'freight') {
              const freightAmt = Math.abs(tx.weightedAmt || 0);
              totalSalesAmount += (tx.weightedAmt || 0);
              freightDeductionAmount += freightAmt;
              return;
            }
            
            const baseAmt = tx.originalAmt * tx.multiplier;
            const amtAfterDiscount = tx.isDiscounted ? baseAmt * window.adminBonusReportData.globalConfig.PEER_PRICE_ADJUSTMENT_FACTOR : baseAmt;
            const weightedAmt = amtAfterDiscount * tx.weight;
            
            totalSalesAmount += weightedAmt;
            
            if (tx.type === 'general') {
              generalSalesAmount += tx.originalAmt * tx.weight;
            } else if (tx.type === 'sleeper') {
              sleeperSalesAmount += baseAmt * tx.weight;
            } else if (tx.type === 'jinyouli') {
              jinyouliSalesAmount += baseAmt * tx.weight;
            }
            
            if (tx.isDiscounted) {
              discountReductionAmount += (baseAmt - amtAfterDiscount) * tx.weight;
            }
          });

          p.monthlySales = Math.round(totalSalesAmount);
          p.generalSalesAmount = Math.round(generalSalesAmount);
          p.sleeperSalesAmount = Math.round(sleeperSalesAmount);
          p.jinyouliSalesAmount = Math.round(jinyouliSalesAmount);
          p.discountReductionAmount = Math.round(discountReductionAmount);
          p.freightDeductionAmount = Math.round(freightDeductionAmount);

          // Calculate bonuses
          const rule = p.rule;
          let baseBonus = 0;
          if (p.monthlySales >= rule.minThreshold) {
            const exceed = p.monthlySales - rule.stepBase;
            if (exceed > 0) {
              baseBonus = Math.floor(exceed / rule.stepValue) * rule.stepBonus;
            }
          }

          let breakthroughBonus = 0;
          let reachedLimit = 0;
          if (rule.breakthroughs && rule.breakthroughs.length > 0) {
            rule.breakthroughs.forEach(b => {
              if (p.monthlySales >= b.limit) {
                if (b.bonus > breakthroughBonus) {
                  breakthroughBonus = b.bonus;
                  reachedLimit = b.limit;
                }
              }
            });
          }

          p.baseBonus = baseBonus;
          p.breakthroughBonus = breakthroughBonus;
          p.totalBonus = baseBonus + breakthroughBonus;
          p.staffShare = Math.round(p.totalBonus * window.adminBonusReportData.globalConfig.STAFF_SHARE_RATE);
          p.netPayout = p.totalBonus - p.staffShare;
          p.reachedBreakthroughLimit = reachedLimit;

          const exceedAmt = p.monthlySales - rule.stepBase;
          const steps = exceedAmt > 0 ? Math.floor(exceedAmt / rule.stepValue) : 0;
          p.steps = steps;

          const combinedSalesBonus = p.baseBonus + p.breakthroughBonus;
          const totalActualPayout = p.netPayout + (p.deliveryBonus || 0);

          // Update summary values in top summary row
          const mainRow = document.querySelector('tr[data-salesrow="' + p.name + '"]');
          if (mainRow) {
            mainRow.querySelector('.main-monthly-sales').innerText = '$ ' + p.monthlySales.toLocaleString();
            mainRow.querySelector('.main-combined-bonus').innerText = '$ ' + combinedSalesBonus.toLocaleString();
            mainRow.querySelector('.main-staff-share').innerText = '$ ' + p.staffShare.toLocaleString();
            mainRow.querySelector('.main-net-payout').innerText = '$ ' + p.netPayout.toLocaleString();
            mainRow.querySelector('.main-total-actual').innerText = '$ ' + totalActualPayout.toLocaleString();
          }

          // Update detail panel items
          const detailPanel = document.getElementById('report-detail-' + p.name);
          if (detailPanel) {
            // Update Equation formulas
            detailPanel.querySelector('.summary-monthly-sales-title').innerText = '當月實銷金額：' + (p.monthlySales / 10000).toFixed(2) + ' 萬';
            detailPanel.querySelector('.summary-general-sales-val').innerText = (p.generalSalesAmount / 10000).toFixed(2) + ' 萬';
            detailPanel.querySelector('.summary-sleeper-sales-val').innerText = (p.sleeperSalesAmount / 10000).toFixed(2) + ' 萬';
            detailPanel.querySelector('.summary-jinyouli-sales-val').innerText = (p.jinyouliSalesAmount / 10000).toFixed(2) + ' 萬';
            detailPanel.querySelector('.summary-discount-reduction-val').innerText = (p.discountReductionAmount / 10000).toFixed(2) + ' 萬';
            const freightSummaryEl = detailPanel.querySelector('.summary-freight-deduction-val');
            if (freightSummaryEl) {
              freightSummaryEl.innerText = (p.freightDeductionAmount / 10000).toFixed(2) + ' 萬';
            }
            const freightMainCell = document.querySelector('tr[data-salesrow="' + p.name + '"] .main-freight-deduction');
            if (freightMainCell) {
              freightMainCell.innerText = '- $ ' + p.freightDeductionAmount.toLocaleString();
            }

            // Update Card 2 exceed Warning and Details
            const warningEl = detailPanel.querySelector('.calc-exceed-warning');
            const detailEl = detailPanel.querySelector('.calc-exceed-detail');
            if (p.monthlySales < rule.minThreshold) {
              if (warningEl) warningEl.style.display = 'block';
              if (detailEl) detailEl.style.display = 'none';
            } else {
              if (warningEl) warningEl.style.display = 'none';
              if (detailEl) {
                detailEl.style.display = 'block';
                detailEl.querySelector('.calc-exceed-amt-text').innerText = '超過金額：$ ' + Math.max(0, exceedAmt).toLocaleString() + ' 元';
                detailEl.querySelector('.calc-steps-text').innerHTML = '達成級數：<span style="color: #ffeb3b; font-weight: bold;">' + steps + '</span> 級';
                detailEl.querySelector('.calc-base-bonus-text').innerHTML = '達成獎金：' + steps + ' 級 * $ ' + rule.stepBonus.toLocaleString() + ' = <span style="color: var(--neon-green); font-weight: bold;">$ ' + p.baseBonus.toLocaleString() + '</span> 元';
              }
            }

            // Update breakthroughs
            const btLimitText = p.reachedBreakthroughLimit > 0 ? 
              '<span style="color: var(--neon-green); font-weight: bold;">已達 ' + (p.reachedBreakthroughLimit/10000) + '萬 門檻</span>' : 
              '<span style="color: var(--pixel-gray);">未達 any 突破門檻</span>';
            detailPanel.querySelector('.calc-breakthrough-limit-div').innerHTML = '突破門檻：' + btLimitText;
            detailPanel.querySelector('.calc-breakthrough-bonus-div').innerHTML = '突破獎金：<span style="color: var(--neon-green); font-weight: bold;">$ ' + p.breakthroughBonus.toLocaleString() + '</span> 元';

            // Update Card 3 Totals
            detailPanel.querySelector('.calc-total-bonus-div').innerHTML = '獎金小計：<span style="color:var(--pixel-white); font-weight:bold;">$ ' + p.totalBonus.toLocaleString() + '</span> 元';
            detailPanel.querySelector('.calc-staff-share-div').innerHTML = '內勤提撥 (' + Math.round(window.adminBonusReportData.globalConfig.STAFF_SHARE_RATE*100) + '%)：<span style="color: var(--neon-pink); font-weight: bold;">- $ ' + p.staffShare.toLocaleString() + '</span> 元';
            
            detailPanel.querySelector('.calc-net-payout-div').innerHTML = 
              '<span>業務實領 (90%)：</span>' +
              '<span style="color: #ffd700; font-weight: 900; font-size: 24px; text-shadow: none !important; border: 1px dashed #ffd700; padding: 4px 10px; border-radius: 6px; background: rgba(255, 215, 0, 0.1);">$' + p.netPayout.toLocaleString() + ' 元</span>';

            // Recalculate Jinyouli & Sleeper table subtotals in the DOM
            const jylSubtotalCell = detailPanel.querySelector('.jyl-subtotal-cell');
            if (jylSubtotalCell && p.jinyouliTransactions) {
              const currentJylSubtotal = p.jinyouliTransactions.reduce((acc, tx) => acc + tx.weightedAmt, 0);
              jylSubtotalCell.innerText = '$ ' + Math.round(currentJylSubtotal).toLocaleString();
            }
            
            const sleeperSubtotalCell = detailPanel.querySelector('.sleeper-subtotal-cell');
            if (sleeperSubtotalCell && p.sleeperTransactions) {
              const currentSleeperSubtotal = p.sleeperTransactions.reduce((acc, tx) => acc + tx.weightedAmt, 0);
              sleeperSubtotalCell.innerText = '$ ' + Math.round(currentSleeperSubtotal).toLocaleString();
            }
          }
        }

        function saveSalesBonusRowClick(btn) {
          const rowIdx = parseInt(btn.getAttribute('data-rowidx'));
          const salesName = btn.getAttribute('data-salesname');
          const productCode = btn.getAttribute('data-code');
          
          const qtyInput = document.querySelector('input.qty-input[data-rowidx="' + rowIdx + '"][data-salesname="' + salesName + '"]');
          const priceInput = document.querySelector('input.price-input[data-rowidx="' + rowIdx + '"][data-salesname="' + salesName + '"]');
          const costInput = document.querySelector('input.cost-input[data-rowidx="' + rowIdx + '"][data-salesname="' + salesName + '"]');
          const peerPriceInput = document.querySelector('input.peerprice-input[data-rowidx="' + rowIdx + '"][data-salesname="' + salesName + '"]');
          
          const qty = qtyInput ? parseFloat(qtyInput.value) || 0 : 0;
          const price = priceInput ? parseFloat(priceInput.value) || 0 : 0;
          const cost = costInput ? parseFloat(costInput.value) || 0 : 0;
          const peerPrice = peerPriceInput ? parseFloat(peerPriceInput.value) || 0 : 0;
          
          btn.disabled = true;
          btn.innerText = '儲存中...';
          
          google.script.run
            .withSuccessHandler(function(res) {
              btn.disabled = false;
              btn.innerText = '儲存';
              if (res.success) {
                showToast("資料已成功儲存並同步回雲端試算表！");
                loadAdminBonusReport();
              } else {
                alert("儲存失敗: " + res.msg);
              }
            })
            .withFailureHandler(function(err) {
              btn.disabled = false;
              btn.innerText = '儲存';
              alert("呼叫 API 發生錯誤: " + err.toString());
            })
            .saveSalesBonusRow(rowIdx, productCode, qty, price, cost, peerPrice);
        }

        function toggleReportDetail(btn) {
          const name = btn.getAttribute('data-name');
          const detail = document.getElementById('report-detail-' + name);
          if (detail) {
            if (detail.style.display === 'none') {
              detail.style.display = 'block';
            } else {
              detail.style.display = 'none';
            }
          }
        }

        function toggleReportDetailSection(id) {
          const section = document.getElementById(id);
          if (section) {
            if (section.style.display === 'none') {
              section.style.display = 'block';
            } else {
              section.style.display = 'none';
            }
          }
        }

        function toggleSettingsSection() {
          const content = document.getElementById('settings-collapsible-content');
          const icon = document.getElementById('settings-toggle-icon');
          if (content) {
            if (content.style.display === 'none') {
              content.style.display = 'block';
              icon.innerText = '▲ 收合設定';
            } else {
              content.style.display = 'none';
              icon.innerText = '▼ 展開設定';
            }
          }
        }

        window.addEventListener('DOMContentLoaded', function() {
          loadBonusConfig();
          loadAdminBonusReport();
        });
      </script>
    </head>
    <body>
      <div class="topbar">
        <div class="nav">
          <div class="brand">
            <h1>高雅瓷機密中心</h1>
            <p>簡易版庫存查詢專屬連結與白名單管理系統</p>
          </div>
          <div class="nav-right">
            <button class="theme-toggle" onclick="toggleTheme()" id="themeToggleBtn">🌙 夜間模式</button>
          </div>
        </div>
      </div>

      <div class="wrap">
        <!-- 💎 Tabs 控制區 -->
        <div class="tabs-container">
          <button class="tab-btn active" onclick="switchTab('sales-tab', this)">業務app金鑰管理</button>
          <button class="tab-btn" onclick="switchTab('client-tab', this)">客戶查庫存金鑰管理</button>
          <button class="tab-btn" onclick="switchTab('line-tab', this)">LINE 機器人白名單</button>
          <button class="tab-btn" onclick="switchTab('bonus-tab', this)">獎金計算</button>
          <button class="tab-btn" onclick="switchTab('attendance-tab', this); initAttendanceTab();">出缺勤管理</button>
        </div>
        
        <!-- 👔 業務app金鑰管理分頁 -->
        <div id="sales-tab" class="tab-content active">
          <div class="dashboard-grid">
            <!-- Left Side: Register -->
            <div class="panel-card">
              <h3>發行專屬庫存連結</h3>
              <div class="form-group">
                <label for="new-sales-name">同仁姓名</label>
                <input type="text" id="new-sales-name" placeholder="例如：高弘治">
              </div>
              <button id="add-btn" class="btn" onclick="addSalesperson()">發行金鑰並產生連結</button>
            </div>

            <!-- Right Side: Table -->
            <div class="panel-card">
              <h3>已發行業務金鑰列表</h3>
              <div style="margin-top: 10px; margin-bottom: 12px;">
                <input type="text" placeholder="🔍 搜尋同仁姓名或金鑰..." onkeyup="filterTable('sales-table', this.value)" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: var(--inline-bg); border: 1px solid var(--neon-cyan); color: var(--pixel-white); font-size: 13px;">
              </div>
              <div class="table-container">
                <table id="sales-table">
                  <thead>
                    <tr>
                      <th style="width: 15%;">業務姓名</th>
                      <th style="width: 15%;">安全金鑰</th>
                      <th style="width: 15%;">狀態</th>
                      <th style="width: 40%;">直達連結</th>
                      <th style="width: 15%;">操作</th>
                    </tr>
                  </thead>
                  <tbody>
        `;
        
        res.data.forEach(item => {
          const inventoryUrl = "https://bigt.cc/ait/inventory.html?view=inventory&sales=" + encodeURIComponent(item.name) + "&key=" + item.key;
          const appUrl = "https://bigt.cc/ait/inventory.html?sales=" + encodeURIComponent(item.name) + "&key=" + item.key;
          
          const trClass = item.isBlocked ? "blocked-row" : "";
          const statusBadge = item.isBlocked 
            ? `<span class="tag tag-disabled">已停用</span>`
            : `<span class="tag tag-active">已啟用</span>`;
            
          const actionButton = item.isBlocked
            ? `<button class="act-btn" onclick="toggleStatus('${item.name}', 'enable')">啟用</button>`
            : `<button class="act-btn disabled-btn" onclick="toggleStatus('${item.name}', 'revoke')">停用</button>`;
            
          html += `
              <tr class="${trClass}">
                <td style="font-weight: 700;">${item.name}</td>
                <td><code style="font-family: monospace; font-size:14px; color:var(--gold);">${item.key}</code></td>
                <td>${statusBadge}</td>
                <td style="white-space: nowrap; display: flex; gap: 8px;">
                  ${item.isBlocked 
                    ? `<span style="color:var(--red); font-size:11px; font-weight:700;">[ 已失效 ]</span>`
                    : `<button class="copy-btn" onclick="copyLink('${inventoryUrl}', this)">複製查庫存連結</button>
                       <button class="copy-btn" onclick="copyLink('${appUrl}', this)">複製主選單連結</button>`
                  }
                </td>
                <td>${actionButton}</td>
              </tr>
          `;
        });
        
        html += `
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 👥 客戶查庫存金鑰管理分頁 -->
        <div id="client-tab" class="tab-content">
          <div class="dashboard-grid">
            <!-- Left Side: Ingest -->
            <div class="panel-card" style="display: flex; flex-direction: column; gap: 16px;">
              <div>
                <h3>新增/修改 客戶查庫存金鑰</h3>
                <div class="form-group">
                  <label for="cust-name">客戶姓名</label>
                  <input type="text" id="cust-name" placeholder="例如：林設計師">
                </div>
                <div class="form-group">
                  <label for="cust-company">公司 / 工程建案名稱</label>
                  <input type="text" id="cust-company" placeholder="例如：大安帝寶">
                </div>
                <div class="form-group">
                  <label for="cust-level">權限等級</label>
                  <select id="cust-level">
                    <option value="VIP">VIP (無限制)</option>
                    <option value="LEVEL 1">LEVEL 1 (每小時 20 次)</option>
                    <option value="LEVEL 2" selected>LEVEL 2 (每小時 10 次)</option>
                  </select>
                </div>
                <div class="form-group" style="display:none;">
                  <input type="text" id="cust-uid" value="">
                </div>
                <button class="btn" onclick="addSingleClient(this)">儲存單筆客戶</button>
              </div>

              <div style="border-top: 1px solid rgba(52, 211, 153, 0.1); padding-top: 16px;">
                <h3 style="margin-bottom: 10px;">批次導入客戶</h3>
                <div class="form-group">
                  <label>批次名單資料 (每行一筆，格式：姓名,公司/建案,等級,LINEID)</label>
                  <textarea id="cust-batch-input" rows="4" placeholder="張小三,大三室內設計,LEVEL 1,U123...&#10;李小四,皇室建案,LEVEL 2"></textarea>
                </div>
                <button class="btn btn-green" onclick="addBatchClients(this)">執行批次建檔並儲存</button>
              </div>
            </div>

            <!-- Right Side: Whitelist Database -->
            <div class="panel-card">
              <h3>已授權客戶查庫存列表</h3>
              <div style="margin-top: 10px; margin-bottom: 12px;">
                <input type="text" placeholder="🔍 搜尋客戶姓名、公司或金鑰..." onkeyup="filterTable('client-table', this.value)" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: var(--inline-bg); border: 1px solid var(--neon-cyan); color: var(--pixel-white); font-size: 13px;">
              </div>
              <div class="table-container">
                <table id="client-table">
                  <thead>
                    <tr>
                      <th style="width: 15%;">客戶姓名</th>
                      <th style="width: 20%;">公司/建案</th>
                      <th style="width: 10%;">等級</th>
                      <th style="width: 10%;">安全金鑰</th>
                      <th style="width: 30%;">直達連結</th>
                      <th style="width: 15%;">操作</th>
                    </tr>
                  </thead>
                  <tbody>
        `;
        
        if (clientsData.length === 0) {
          html += `
            <tr>
              <td colspan="6" style="text-align: center; color: var(--muted); padding: 40px 0;">目前資料庫無任何登記客戶</td>
            </tr>
          `;
        } else {
          clientsData.forEach(client => {
            const escName = (client.name || '').replace(/'/g, "\\'");
            const escComp = (client.company || '').replace(/'/g, "\\'");
            const directUrl = "https://bigt.cc/ait/inventory.html?view=client&clientName=" + encodeURIComponent(client.name) + "&key=" + client.key;
            
            html += `
              <tr>
                <td style="font-weight: 700;">${client.name || '-'}</td>
                <td>${client.company || '-'}</td>
                <td><span style="color:var(--neon-yellow); font-weight:600;">${client.level || '-'}</span></td>
                <td><code style="font-family: monospace; font-size:12px; color:var(--gold);">${client.key || '-'}</code></td>
                <td>
                  <button class="copy-btn" onclick="copyLink('${directUrl}', this)">複製專屬連結</button>
                </td>
                <td style="white-space: nowrap; display: flex; gap: 8px; align-items: center;">
                  <button class="copy-btn" style="background:var(--neon-cyan); color:#000; padding: 4px 8px; border:none;" onclick="editClient('${escName}', '${escComp}', '${client.level}', '${client.uid || ''}')">編輯</button>
                  <button class="act-btn disabled-btn" style="padding: 4px 8px;" onclick="removeClient(${client.rowIdx}, '${escName || escComp}')">刪除</button>
                </td>
              </tr>
            `;
          });
        }
        
        html += `
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- 🤖 LINE 機器人白名單管理分頁 -->
        <div id="line-tab" class="tab-content">
          <div class="dashboard-grid">
            <!-- Left Side: Ingest -->
            <div class="panel-card" style="display: flex; flex-direction: column; gap: 16px;">
              <div>
                <h3>新增/修改 LINE 機器人好友</h3>
                <div class="form-group">
                  <label for="line-uid">LINE ID (User ID)</label>
                  <input type="text" id="line-uid" placeholder="例如：U5ae8fb4da7879addd35cf39fbf4b43d39">
                </div>
                <div class="form-group">
                  <label for="line-name">客戶姓名</label>
                  <input type="text" id="line-name" placeholder="例如：許老闆">
                </div>
                <div class="form-group">
                  <label for="line-company">客戶公司</label>
                  <input type="text" id="line-company" placeholder="例如：台北設計">
                </div>
                <div class="form-group">
                  <label for="line-level">權限等級</label>
                  <select id="line-level">
                    <option value="free" selected>free (一般客戶)</option>
                    <option value="Premium">Premium (高級客戶/經銷商)</option>
                    <option value="sales">sales (業務同仁)</option>
                    <option value="KING">KING (管理層)</option>
                    <option value="queen">queen (管理層)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="line-status">審核狀態</label>
                  <select id="line-status">
                    <option value="approved" selected>approved (已開通)</option>
                    <option value="待審核">待審核 (審核中)</option>
                  </select>
                </div>
                <button class="btn" onclick="addSingleLineClient(this)">儲存單筆 LINE 客戶</button>
              </div>

              <div style="border-top: 1px solid rgba(52, 211, 153, 0.1); padding-top: 16px;">
                <h3 style="margin-bottom: 10px;">批次導入 LINE 好友</h3>
                <div class="form-group">
                  <label>批次名單資料 (每行一筆，格式：姓名,公司,等級,LINEID,狀態)</label>
                  <textarea id="line-batch-input" rows="4" placeholder="張小三,大三設計,Premium,U123...,approved&#10;李小四,皇室建案,free,U456...,待審核"></textarea>
                </div>
                <button class="btn btn-green" onclick="addBatchLineClients(this)">執行批次導入並儲存</button>
              </div>
            </div>

            <!-- Right Side: Whitelist Database -->
            <div class="panel-card">
              <h3>已註冊 LINE 機器人好友列表</h3>
              <div style="margin-top: 10px; margin-bottom: 12px;">
                <input type="text" placeholder="🔍 搜尋 LINE ID、姓名或公司..." onkeyup="filterTable('line-table', this.value)" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: var(--inline-bg); border: 1px solid var(--neon-cyan); color: var(--pixel-white); font-size: 13px;">
              </div>
              <div class="table-container">
                <table id="line-table">
                  <thead>
                    <tr>
                      <th style="width: 25%;">客戶公司-姓名</th>
                      <th style="width: 15%;">權限等級</th>
                      <th style="width: 30%;">LINE ID (User ID)</th>
                      <th style="width: 15%;">審核狀態</th>
                      <th style="width: 15%;">操作</th>
                    </tr>
                  </thead>
                  <tbody>
        `;
        
        if (lineData.length === 0) {
          html += `
            <tr>
              <td colspan="5" style="text-align: center; color: var(--muted); padding: 40px 0;">目前資料庫無任何登記客戶</td>
            </tr>
          `;
        } else {
          lineData.forEach(client => {
            const escName = (client.name || '').replace(/'/g, "\\'");
            const escComp = (client.company || '').replace(/'/g, "\\'");
            const escStatus = (client.status || 'approved').replace(/'/g, "\\'");
            const tagColor = client.status === '待審核' ? 'var(--neon-pink)' : 'var(--neon-cyan)';
              
            html += `
              <tr>
                <td style="font-weight: 700;">${client.name || '-'}</td>
                <td><span style="color:var(--neon-yellow); font-weight:600;">${client.level || '-'}</span></td>
                <td><code style="font-family: monospace; font-size:11px; color:var(--pixel-gray);">${client.uid || '-'}</code></td>
                <td>
                  <span class="tag" style="border: 1px solid ${tagColor}; color:${tagColor};">
                    ${client.status || 'approved'}
                  </span>
                </td>
                <td style="white-space: nowrap; display: flex; gap: 8px; align-items: center;">
                  <button class="copy-btn" style="background:var(--neon-cyan); color:#000; padding: 4px 8px; border:none;" onclick="editLineClient('${escName}', '${escComp}', '${client.level}', '${client.uid || ''}', '${escStatus}')">編輯</button>
                  <button class="act-btn disabled-btn" style="padding: 4px 8px;" onclick="removeLineClient(${client.rowIdx}, '${escName || escComp}')">刪除</button>
                </td>
              </tr>
            `;
          });
        }
        
        html += `
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 💰 獎金計算分頁 -->
        <div id="bonus-tab" class="tab-content">
          <!-- 📊 當月業務業績獎金精算與折半明細 (放最上面) -->
          <div class="panel-card">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--neon-cyan); padding-bottom: 12px; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
              <h3 style="font-size: 22px; font-weight: 800; color: var(--neon-cyan); text-shadow: none !important;">📊 當月業務業績獎金精算與折半明細</h3>
              <div style="display: flex; align-items: center; gap: 10px;">
                <select id="bonus-report-year" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px; font-size:15px; font-weight:800; outline:none; text-shadow: none !important;" onchange="loadAdminBonusReport()">
                  <option value="2025">2025 年</option>
                  <option value="2026" selected>2026 年</option>
                  <option value="2027">2027 年</option>
                </select>
                <select id="bonus-report-month" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px; font-size:15px; font-weight:800; outline:none; text-shadow: none !important;" onchange="loadAdminBonusReport()">
                  ${[0,1,2,3,4,5,6,7,8,9,10,11].map(m => `
                    <option value="${m}" ${new Date().getMonth() === m ? 'selected' : ''}>${m+1} 月</option>
                  `).join('')}
                </select>
                <button class="copy-btn" onclick="loadAdminBonusReport()" style="padding:6px 12px; font-size:14px; text-shadow: none !important;">計算</button>
              </div>
            </div>
            
            <div id="bonus-report-container">
              <p style="color: var(--pixel-gray);">正在載入業績獎金報表...</p>
            </div>
          </div>

          <!-- ⚙️ 獎金計算與各業務規則參數設定 (收折在下面) -->
          <div class="panel-card" style="margin-top: 24px; border-color: rgba(255, 255, 255, 0.15);">
            <div onclick="toggleSettingsSection()" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 6px 0;">
              <h3 style="font-size: 20px; font-weight: 800; color: var(--neon-cyan); margin: 0; text-shadow: none !important;">⚙️ 獎金計算與個人規則參數設定</h3>
              <span id="settings-toggle-icon" style="font-size: 16px; color: var(--pixel-gray); font-weight: bold; border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 6px; background: rgba(255,255,255,0.02);">▼ 展開設定</span>
            </div>
            
            <div id="settings-collapsible-content" style="display: none; margin-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
              <div class="dashboard-grid">
                <!-- Left Side: Global Config -->
                <div class="panel-card" style="display: flex; flex-direction: column; gap: 16px; background: rgba(255,255,255,0.01); border-color: rgba(255,255,255,0.05); padding: 20px;">
                  <div>
                    <h3>全域獎金設定</h3>
                    <div class="form-group" style="margin-top: 10px;">
                      <label for="bonus-global-staff-rate">分給內勤同事比例 (%)</label>
                      <input type="number" id="bonus-global-staff-rate" min="0" max="100" placeholder="例如：10" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: var(--inline-bg); border: 1px solid var(--neon-cyan); color: var(--pixel-white); font-size: 13px;">
                    </div>
                    <div class="form-group" style="margin-top: 10px;">
                      <label for="bonus-global-discount-threshold">同行價折讓比率門檻</label>
                      <input type="number" step="0.01" id="bonus-global-discount-threshold" placeholder="例如：0.60 (即六折)" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: var(--inline-bg); border: 1px solid var(--neon-cyan); color: var(--pixel-white); font-size: 13px;">
                    </div>
                    <div class="form-group" style="margin-top: 10px;">
                      <label for="bonus-global-adj-factor">低於門檻業績折算係數</label>
                      <input type="number" step="0.01" id="bonus-global-adj-factor" placeholder="例如：0.50 (即業績打五折)" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: var(--inline-bg); border: 1px solid var(--neon-cyan); color: var(--pixel-white); font-size: 13px;">
                    </div>
                    <button class="btn btn-green" onclick="saveGlobalBonusSettings(this)" style="margin-top: 15px; width: 100%;">儲存全域設定</button>
                  </div>

                  <div style="border-top: 1px solid rgba(52, 211, 153, 0.1); padding-top: 16px;">
                    <h3>新增業務獎金規則</h3>
                    <div class="form-group" style="margin-top: 10px;">
                      <label for="bonus-new-name">業務同仁姓名</label>
                      <input type="text" id="bonus-new-name" placeholder="例如：張三" style="width: 100%; padding: 8px 12px; border-radius: 6px; background: var(--inline-bg); border: 1px solid var(--neon-cyan); color: var(--pixel-white); font-size: 13px;">
                    </div>
                    <button class="btn" onclick="addSalespersonBonusRule()" style="margin-top: 10px; width: 100%;">新增業務規則</button>
                  </div>
                </div>

                <!-- Right Side: Salesperson Configs -->
                <div class="panel-card" style="background: rgba(255,255,255,0.01); border-color: rgba(255,255,255,0.05); padding: 20px;">
                  <h3>業務個人獎金規則設定</h3>
                  <div id="bonus-rules-container" style="display: flex; flex-direction: column; gap: 20px; margin-top: 15px;">
                    <p style="color: var(--pixel-gray);">正在載入獎金設定資料...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 🕐 出缺勤管理分頁 -->
        <div id="attendance-tab" class="tab-content">
          <div style="padding: 8px 0 16px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap; border-bottom:1px solid var(--neon-cyan); padding-bottom:10px; margin-bottom:18px;">
              <button class="att-sub-btn active" onclick="switchAttTab('att-today', this)">今日出缺勤</button>
              <button class="att-sub-btn" onclick="switchAttTab('att-monthly', this)">月出勤報表</button>
              <button class="att-sub-btn" onclick="switchAttTab('att-leave', this)">請假管理</button>
              <button class="att-sub-btn" onclick="switchAttTab('att-balance', this)">特休餘額</button>
              <button class="att-sub-btn" onclick="switchAttTab('att-salary', this)">薪資計算</button>
              <button class="att-sub-btn" onclick="switchAttTab('att-raise', this)">加薪記錄</button>
              <button class="att-sub-btn" onclick="switchAttTab('att-staff', this)">員工管理</button>
            </div>

            <!-- 今日出缺勤 -->
            <div id="att-today" class="att-sub-content active">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap;">
                <h3 style="margin:0; color:var(--neon-cyan);">今日出缺勤</h3>
                <span id="att-today-date" style="color:var(--pixel-gray); font-size:13px;"></span>
                <button class="copy-btn" onclick="loadTodayAttendance()" style="padding:5px 12px; font-size:13px; margin-left:auto;">重新整理</button>
              </div>

              <!-- 快速輸入區 -->
              <div style="background:var(--inline-bg); border:1px solid var(--neon-cyan); border-radius:8px; padding:14px 16px; margin-bottom:16px;">
                <div style="color:var(--neon-cyan); font-size:13px; font-weight:bold; margin-bottom:10px;">⚡ 快速輸入（過渡期手動登打）</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
                  <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="color:var(--pixel-gray); font-size:11px;">員工</label>
                    <select id="qi-staff" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px; min-width:120px;"></select>
                  </div>
                  <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="color:var(--pixel-gray); font-size:11px;">日期</label>
                    <input type="date" id="qi-date" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;">
                  </div>
                  <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="color:var(--pixel-gray); font-size:11px;">上班時間</label>
                    <input type="time" id="qi-in" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;">
                  </div>
                  <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="color:var(--pixel-gray); font-size:11px;">下班時間</label>
                    <input type="time" id="qi-out" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;">
                  </div>
                  <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="color:var(--pixel-gray); font-size:11px;">備註（可留空）</label>
                    <input type="text" id="qi-note" placeholder="遲到/忘打卡..." style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px; width:140px;">
                  </div>
                  <button class="copy-btn" onclick="quickInputPunch()" style="padding:7px 18px; font-weight:bold; background:var(--neon-green); color:#000; white-space:nowrap;">✔ 儲存打卡</button>
                </div>
                <div style="border-top:1px solid rgba(0,240,255,0.15); margin-top:12px; padding-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
                  <div style="color:var(--pixel-gray); font-size:11px; align-self:center; white-space:nowrap;">🗓 請假登記：</div>
                  <select id="qi-leave-staff" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;"></select>
                  <select id="qi-leave-type" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;">
                    <option>特休</option><option>事假</option><option>病假</option><option>補休</option><option>婚假</option><option>喪假</option>
                  </select>
                  <input type="date" id="qi-leave-start" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;">
                  <input type="date" id="qi-leave-end" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;">
                  <select id="qi-leave-hours" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px 10px; border-radius:4px;">
                    <option value="8">全天</option><option value="4">半天</option>
                  </select>
                  <button class="copy-btn" onclick="quickInputLeave()" style="padding:7px 18px; font-weight:bold; background:var(--neon-yellow); color:#000; white-space:nowrap;">✔ 儲存請假</button>
                </div>
              </div>

              <div id="att-today-container" style="color:var(--pixel-gray); text-align:center; padding:20px;">載入中...</div>
            </div>

            <!-- 月出勤報表 -->
            <div id="att-monthly" class="att-sub-content" style="display:none;">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap;">
                <h3 style="margin:0; color:var(--neon-cyan);">月出勤報表</h3>
                <select id="att-report-staff" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px; border-radius:4px;">
                  <option value="">全部員工</option>
                </select>
                <select id="att-report-year" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px; border-radius:4px;"></select>
                <select id="att-report-month" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px; border-radius:4px;"></select>
                <button class="copy-btn" onclick="loadMonthlyReport()" style="padding:5px 12px; font-size:13px;">查詢</button>
              </div>
              <div id="att-monthly-container" style="color:var(--pixel-gray); text-align:center; padding:30px;">請選擇條件後查詢</div>
            </div>

            <!-- 請假管理 -->
            <div id="att-leave" class="att-sub-content" style="display:none;">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap;">
                <h3 style="margin:0; color:var(--neon-cyan);">請假管理</h3>
                <select id="att-leave-status" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px; border-radius:4px;">
                  <option value="待審">待審</option>
                  <option value="全部">全部</option>
                  <option value="核准">核准</option>
                  <option value="駁回">駁回</option>
                </select>
                <button class="copy-btn" onclick="loadLeaveList()" style="padding:5px 12px; font-size:13px;">查詢</button>
                <button class="copy-btn" onclick="openAddLeaveModal()" style="padding:5px 12px; font-size:13px; background:var(--neon-green); color:#000;">新增請假</button>
              </div>
              <div id="att-leave-container" style="color:var(--pixel-gray); text-align:center; padding:30px;">載入中...</div>
            </div>

            <!-- 特休餘額 -->
            <div id="att-balance" class="att-sub-content" style="display:none;">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
                <h3 style="margin:0; color:var(--neon-cyan);">特休餘額</h3>
                <button class="copy-btn" onclick="loadLeaveBalance()" style="padding:5px 12px; font-size:13px;">重新整理</button>
                <button class="copy-btn" onclick="recalcAllLeaveBalance()" style="padding:5px 12px; font-size:13px; background:var(--neon-yellow); color:#000;">重新試算全員</button>
              </div>
              <div id="att-balance-container" style="color:var(--pixel-gray); text-align:center; padding:30px;">載入中...</div>
            </div>

            <!-- 薪資計算 -->
            <div id="att-salary" class="att-sub-content" style="display:none;">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap;">
                <h3 style="margin:0; color:var(--neon-cyan);">薪資計算</h3>
                <select id="att-salary-year" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px; border-radius:4px;"></select>
                <select id="att-salary-month" style="background:var(--inline-bg); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:6px; border-radius:4px;"></select>
                <button class="copy-btn" onclick="loadSalaryReport()" style="padding:5px 12px; font-size:13px;">計算</button>
                <button class="copy-btn" onclick="exportSalarySlips()" style="padding:5px 12px; font-size:13px; background:var(--neon-green); color:#000;">產生薪資條</button>
              </div>
              <div id="att-salary-container" style="color:var(--pixel-gray); text-align:center; padding:30px;">請選擇月份後計算</div>
            </div>

            <!-- 加薪記錄 -->
            <div id="att-raise" class="att-sub-content" style="display:none;">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
                <h3 style="margin:0; color:var(--neon-cyan);">加薪記錄</h3>
                <button class="copy-btn" onclick="loadRaiseRecords()" style="padding:5px 12px; font-size:13px;">重新整理</button>
              </div>
              <div id="att-raise-container" style="color:var(--pixel-gray); text-align:center; padding:30px;">載入中...</div>
            </div>

            <!-- 員工管理 -->
            <div id="att-staff" class="att-sub-content" style="display:none;">
              <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
                <h3 style="margin:0; color:var(--neon-cyan);">員工管理</h3>
                <button class="copy-btn" onclick="loadStaffList()" style="padding:5px 12px; font-size:13px;">重新整理</button>
                <button class="copy-btn" onclick="openAddStaffModal()" style="padding:5px 12px; font-size:13px; background:var(--neon-green); color:#000;">新增員工</button>
              </div>
              <div id="att-staff-container" style="color:var(--pixel-gray); text-align:center; padding:30px;">載入中...</div>
            </div>
          </div>

          <!-- 手動補登 Modal -->
          <div id="manual-punch-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); z-index:99999; align-items:center; justify-content:center;">
            <div style="background:var(--inline-bg); border:1px solid var(--neon-cyan); border-radius:8px; padding:24px; min-width:320px; max-width:420px;">
              <h3 style="color:var(--neon-cyan); margin:0 0 16px;">手動補登打卡</h3>
              <div style="display:flex; flex-direction:column; gap:12px;">
                <select id="mp-staff" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;"></select>
                <input type="date" id="mp-date" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="time" id="mp-clock-in" placeholder="上班時間" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="time" id="mp-clock-out" placeholder="下班時間" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="text" id="mp-note" placeholder="備註" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
              </div>
              <div style="display:flex; gap:8px; margin-top:16px;">
                <button class="copy-btn" onclick="submitManualPunch()" style="flex:1;">儲存</button>
                <button class="copy-btn" onclick="closeModal('manual-punch-modal')" style="flex:1; background:#444;">取消</button>
              </div>
            </div>
          </div>

          <!-- 新增請假 Modal -->
          <div id="add-leave-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); z-index:99999; align-items:center; justify-content:center;">
            <div style="background:var(--inline-bg); border:1px solid var(--neon-cyan); border-radius:8px; padding:24px; min-width:320px; max-width:420px;">
              <h3 style="color:var(--neon-cyan); margin:0 0 16px;">新增請假</h3>
              <div style="display:flex; flex-direction:column; gap:12px;">
                <select id="al-staff" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;"></select>
                <select id="al-type" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                  <option>特休</option><option>事假</option><option>病假</option><option>補休</option><option>婚假</option><option>喪假</option>
                </select>
                <input type="date" id="al-start" placeholder="開始日期" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="date" id="al-end" placeholder="結束日期" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <select id="al-hours" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                  <option value="8">全天（8小時）</option>
                  <option value="4">半天（4小時）</option>
                  <option value="2">2小時</option>
                  <option value="1">1小時</option>
                </select>
                <input type="text" id="al-note" placeholder="備註" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
              </div>
              <div style="display:flex; gap:8px; margin-top:16px;">
                <button class="copy-btn" onclick="submitAddLeave()" style="flex:1;">儲存</button>
                <button class="copy-btn" onclick="closeModal('add-leave-modal')" style="flex:1; background:#444;">取消</button>
              </div>
            </div>
          </div>

          <!-- 新增/編輯員工 Modal -->
          <div id="add-staff-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); z-index:99999; align-items:center; justify-content:center;">
            <div style="background:var(--inline-bg); border:1px solid var(--neon-cyan); border-radius:8px; padding:24px; min-width:340px; max-width:460px; max-height:90vh; overflow-y:auto;">
              <h3 id="staff-modal-title" style="color:var(--neon-cyan); margin:0 0 16px;">新增員工</h3>
              <input type="hidden" id="sm-emp-id">
              <div style="display:flex; flex-direction:column; gap:10px;">
                <input type="text" id="sm-name" placeholder="姓名 *" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="text" id="sm-title" placeholder="職稱 *" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="date" id="sm-joindate" placeholder="到職日 *" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="number" id="sm-salary" placeholder="底薪 *" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="number" id="sm-insured" placeholder="投保底薪" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="number" id="sm-meal" placeholder="餐費（0或金額）" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="number" id="sm-phone" placeholder="電話費（0或金額）" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="number" id="sm-attendance-bonus" placeholder="全勤獎金" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <input type="text" id="sm-supervisor" placeholder="主管ID（可留空）" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                <select id="sm-status" style="background:var(--inline-input); border:1px solid var(--neon-cyan); color:var(--pixel-white); padding:8px; border-radius:4px;">
                  <option>在職</option><option>離職</option>
                </select>
              </div>
              <div style="display:flex; gap:8px; margin-top:16px;">
                <button class="copy-btn" onclick="submitStaff()" style="flex:1;">儲存</button>
                <button class="copy-btn" onclick="closeModal('add-staff-modal')" style="flex:1; background:#444;">取消</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="toast">複製成功</div>
    </body>
    </html>
    `;
    return HtmlService.createHtmlOutput(html).setTitle("高雅瓷機密中心");
  }
  
  // 🔐 獨立單獨查庫存安全金鑰驗證
  if (params.view === 'inventory') {
    const sales = params.sales || '';
    const key = params.key || '';
    const expectedKey = getSalesDirectKey(sales);
    
    // 🛡️ 檢查是否在黑名單中
    let blockedSales = [];
    try {
      blockedSales = JSON.parse(PropertiesService.getScriptProperties().getProperty("DIRECT_ACCESS_BLOCKED") || "[]");
    } catch(e){}
    const isBlocked = blockedSales.includes(sales);
    
    if (!sales || key !== expectedKey || isBlocked) {
      return HtmlService.createHtmlOutput(
        "<body style='background:#000; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif;'>" +
        "<div style='text-align:center; padding:30px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,59,48,0.3); border-radius:20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);'>" +
        "<h1 style='color:#ff3b30; font-size:60px; margin:0 0 20px;'>🔒</h1>" +
        "<h2 style='margin:0 0 10px; color:#fff;'>" + (isBlocked ? "存取遭拒：此專屬網址已被停用" : "存取遭拒：安全金鑰無效") + "</h2>" +
        "<p style='color:rgba(255,255,255,0.4); font-size:13px; margin:0;'>請確認您的直達專屬網址是否正確，或聯繫系統管理員。</p>" +
        "</div>" +
        "</body>"
      )
      .setTitle("AIT 存取拒絕")
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }
  
  // 🔐 獨立客戶直達安全驗證 (免 LINE 登入登出)
  if (params.view === 'client' && params.clientName && params.key) {
    const expectedKey = getClientDirectKey(params.clientName);
    if (!params.key || params.key !== expectedKey) {
      return HtmlService.createHtmlOutput(
        "<body style='background:#000; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif;'>" +
        "<div style='text-align:center; padding:30px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,59,48,0.3); border-radius:20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);'>" +
        "<h1 style='color:#ff3b30; font-size:60px; margin:0 0 20px;'>🔒</h1>" +
        "<h2 style='margin:0 0 10px; color:#fff;'>存取遭拒：安全金鑰無效</h2>" +
        "<p style='color:rgba(255,255,255,0.4); font-size:13px; margin:0;'>請確認您的直達專屬網址是否正確，或聯繫服務業務。</p>" +
        "</div>" +
        "</body>"
      )
      .setTitle("AIT 存取拒絕")
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }
  
  // 🚀 獨立分流：分公司/員工專用入口
  if (params.view === 'staff') {
    const template = HtmlService.createTemplateFromFile('Staff_Portal');
    template.params = params;
    template.scriptUrl = ScriptApp.getService().getUrl();
    return template.evaluate()
      .setTitle('AIT-內部查詢')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  let clientInfo = { name: "", company: "", level: "LEVEL 2" };
  try {
    const targetName = params.clientName || params.customer || "";
    if (targetName) {
      const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
      const wlSheet = ss.getSheetByName("白名單");
      if (wlSheet) {
        const data = wlSheet.getDataRange().getValues();
        const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
        const idx = {
          name: findHeaderIndex(h, ["名字", "姓名"]),
          company: findHeaderIndex(h, ["公司", "客戶"]),
          level: findHeaderIndex(h, ["等級", "權限等級", "LEVEL"])
        };
        const userRow = data.find(r => idx.name !== -1 && String(r[idx.name]).trim() === targetName.trim());
        if (userRow) {
          clientInfo.name = targetName;
          clientInfo.company = idx.company !== -1 ? String(userRow[idx.company]).trim() : "未知公司";
          clientInfo.level = idx.level !== -1 && String(userRow[idx.level]).trim() ? String(userRow[idx.level]).trim().toUpperCase() : "LEVEL 2";
        } else {
          // 白名單中如果沒找到，至少保留網址上的姓名以作記錄
          clientInfo.name = targetName;
          clientInfo.company = "訪客客戶";
          clientInfo.level = "LEVEL 2";
        }
      }
    }
  } catch(e) {
    console.warn("doGet 預解析客戶公司失敗:", e);
  }

  const template = HtmlService.createTemplateFromFile('index');
  template.params = params;
  template.clientInfo = clientInfo;
  template.scriptUrl = ScriptApp.getService().getUrl();
  template.clientLiffId = getScriptPropOrDefault_('CLIENT_LIFF_ID', '2007666611-y2vJrdKu');
  
  let title = 'AIT-業務專用';
  if (params.view === 'client') {
    title = 'AIT-查詢系統';
  }
  
  return template.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 👔 取得業務員清單 (從業務分區自動讀取)
 */
function getSalesList(onlySales = false) {
  try {
    // 🚀 效能優化：加入 Script Cache（5 分鐘），避免每次登入都重掃業務分區全表
    const cacheKey = onlySales ? 'sales_list_only' : 'sales_list_all';
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) {
      return { success: true, data: JSON.parse(cached) };
    }

    const ss = getSafeSsMain();
    const sheet = ss.getSheetByName("業務分區");
    if (!sheet) return { success: false, msg: "找不到業務分區工作表" };
    const data = sheet.getDataRange().getValues();
    const h = data[0].map(v => String(v || '').trim());
    
    const salesSet = new Set();
    const salesColIdx = findHeaderIndex(h, ["負責業務", "業務", "負責人"]);
    
    if (salesColIdx !== -1) {
      // --- 縱向佈局 ---
      for (let i = 1; i < data.length; i++) {
        const val = String(data[i][salesColIdx] || '').trim();
        if (val && val !== "負責業務") salesSet.add(val);
      }
    } else {
      // --- 水平佈局 (舊版兜底) ---
      h.forEach(val => {
        if (val && val !== "序號" && val !== "客戶名稱" && !/^\d+$/.test(val)) {
          salesSet.add(val);
        }
      });
    }

    // 🚀 核心強化：合併 SALES_CONFIG 中的固定名單 (確保即使沒分配客戶也能看到按鈕)
    if (typeof SALES_CONFIG !== 'undefined' && SALES_CONFIG.SALES_PEOPLE) {
      SALES_CONFIG.SALES_PEOPLE.forEach(p => {
        if (p.name) salesSet.add(p.name);
      });
    }

    // 🚀 核心增強：合併手動新增的業務/助理名單 (由管理後台金鑰發行而來)
    if (!onlySales) {
      try {
        const customSales = JSON.parse(PropertiesService.getScriptProperties().getProperty("DIRECT_ACCESS_CUSTOM") || "[]");
        customSales.forEach(name => {
          if (name) salesSet.add(name);
        });
      } catch(e){}
    }

    const result = Array.from(salesSet);
    // 快取 5 分鐘（業務名單變動頻率低）
    try { cache.put(cacheKey, JSON.stringify(result), 300); } catch(e){}
    return { success: true, data: result };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}


function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// -----------------------------------------------------------------------------
// 1. 戰情室旗艦邏輯移植 (歸併與標題)
// -----------------------------------------------------------------------------

function mergeCustomer(name) {
  let s = String(name || "").trim();
  if (s.includes('漢樺') || s.includes('波爾泰')) return '漢樺';
  if (s.includes('大永') || s.includes('新大永')) return '大永';
  if (s.includes('錦義') || s.includes('睿敏')) return '錦義';
  if (s.includes('滿財') || s.includes('東春')) return '滿財';
  if (s.includes('傅邦') || s.includes('盛邦')) return '傅邦';
  if (s.includes('喬翌') || s.includes('伊特')) return '伊特';
  if (s.includes('太爾') || s.includes('信義星')) return '信義星';
  if (s.includes('鼎康') || s.includes('鼎晨')) return '鼎晨';
  if (s.includes('高頓') || s.includes('馬來高')) return '馬來高';
  if (s.includes('鏷城') || s.includes('璞城')) return '鏷城';
  if (s.includes('今冠') || s.includes('金冠')) return '金冠';
  if (s.includes('琮達') || s.includes('琮威')) return '琮威';

  // 🚀 核心規則：特定客戶不抓前二字（保留完整名稱）
  const exceptions = ['夏綠蒂', '德思特尼', '百事得', '百達富麗', '鑫東聖', '海格斯', '信義星', '好仕齊', '新睦豐', '富利鴻', '金豪益'];
  for (const ex of exceptions) {
    if (s.includes(ex)) return ex;
  }

  const suffixes = ['企業','建材','國際','磁磚','工程','股份有限公司','有限公司','公司','實業','精品'];
  for (const suf of suffixes) {
    const idx = s.indexOf(suf);
    if (idx !== -1) { s = s.substring(0, idx); break; }
  }
  return s.slice(0, 2);
}

function getCustomerShortName(name) {
  let s = String(name || "").trim();
  if (!s) return '';
  // 固定合併對照（比照 mergeCustomer，統一顯示為單一名稱）
  if (s.includes('漢樺') || s.includes('波爾泰')) return '漢樺';
  if (s.includes('大永') || s.includes('新大永')) return '大永';
  if (s.includes('錦義') || s.includes('睿敏')) return '錦義';
  if (s.includes('滿財') || s.includes('東春')) return '滿財';
  if (s.includes('傅邦') || s.includes('盛邦')) return '傅邦';
  if (s.includes('喬翌') || s.includes('伊特')) return '伊特';
  if (s.includes('太爾') || s.includes('信義星')) return '信義星';
  if (s.includes('鼎康') || s.includes('鼎晨')) return '鼎晨';
  if (s.includes('高頓') || s.includes('馬來高')) return '馬來高';
  if (s.includes('鏷城') || s.includes('璞城')) return '鏷城';
  if (s.includes('今冠') || s.includes('金冠')) return '金冠';
  if (s.includes('琮達') || s.includes('琮威')) return '琮威';

  const exceptions = ['夏綠蒂', '德思特尼', '百事得', '百達富麗', '鑫東聖', '海格斯', '信義星', '好仕齊', '新睦豐', '富利鴻', '金豪益'];
  for (const ex of exceptions) {
    if (s.includes(ex)) return ex;
  }

  s = s
    .replace(/[()（）\[\]【】]/g, '')
    .replace(/[-_－—–\s]*(出貨|樣品|門市|倉庫)$/g, '')
    .trim();

  const suffixes = [
    '股份有限公司', '有限公司', '公司', '企業', '實業', '國際',
    '工程', '建材', '材料', '磁磚', '精品', '商行', '貿易', '行',
    '建設', '開發', '設計', '裝潢', '裝修', '工業'
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of suffixes) {
      if (s.endsWith(suf)) {
        s = s.slice(0, -suf.length).trim();
        changed = true;
        break;
      }
    }
  }

  s = s.replace(/[-_－—–\s]+$/g, '').trim();
  s = s.replace(/(股份有限公司|有限公司|公司|企業|實業|國際|工程|建材|材料|磁磚|精品|商行|貿易|建設|開發|設計|裝潢|裝修|工業)$/g, '').trim();
  if (s.length > 4) s = s.slice(0, 4);
  return s || String(name || '').trim().slice(0, 4);
}

function getSharedSalesWeight(name) {
  const s = String(name || '').trim();
  return (s.includes('漢樺') || s.includes('波爾泰')) ? 1 / 3 : 1;
}

function findHeaderIndex(headers, candidates) {
  if (!headers || headers.length === 0) return -1;
  const cleanHeaders = headers.map(h =>
    String(h).replace(/[\s\uFEFF\xA0"()（）]/g, '').trim().toUpperCase()
  );
  for (const cand of candidates) {
    const target = String(cand).replace(/[\s"()（）]/g, '').toUpperCase();
    const idx = cleanHeaders.indexOf(target);
    if (idx !== -1) return idx;
  }
  for (const cand of candidates) {
    const target = String(cand).replace(/[\s"()（）]/g, '').toUpperCase();
    const idx = cleanHeaders.findIndex(h => h.includes(target));
    if (idx !== -1) return idx;
  }
  return -1;
}

// -----------------------------------------------------------------------------
// 2. 業務清單同步 (採戰情室對位邏輯)
// -----------------------------------------------------------------------------

/**
 * ➕ 新增客戶到內部管理「業務分區」（App 內新增，馬上可選來上架）
 */
function addCustomerToZoning(custName, salesName) {
  try {
    const name = String(custName || '').trim();
    const sales = String(salesName || '').trim();
    if (!name) return { success: false, msg: "客戶名稱不可為空" };
    if (!sales) return { success: false, msg: "業務名稱不可為空" };

    const ss = getSafeSsMain();
    const sheet = ss.getSheetByName("業務分區");
    if (!sheet) return { success: false, msg: "找不到業務分區表" };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const custColIdx = findHeaderIndex(headers, ["客戶名稱", "客戶"]);
    const salesColIdx = findHeaderIndex(headers, ["負責業務", "業務", "負責人"]);
    if (custColIdx === -1 || salesColIdx === -1) return { success: false, msg: "業務分區表格式不符" };

    // 重複檢查（合併名比對）
    const targetMerged = mergeCustomer(name);
    for (let i = 1; i < data.length; i++) {
      const rowCust = String(data[i][custColIdx] || '').trim();
      if (rowCust && mergeCustomer(rowCust) === targetMerged) {
        return { success: false, msg: "客戶「" + rowCust + "」已存在（負責業務：" + String(data[i][salesColIdx] || '') + "）" };
      }
    }

    // 寫入新列（只填客戶名稱與負責業務）
    const newRow = new Array(headers.length).fill('');
    newRow[custColIdx] = name;
    newRow[salesColIdx] = sales;
    sheet.appendRow(newRow);

    // 清快取讓列表立即更新
    const cacheKey = 'cust_list_v2_' + sales.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '');
    try { CacheService.getScriptCache().remove(cacheKey); } catch (e) {}

    return { success: true, msg: "已新增客戶「" + name + "」" };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 👁️ 設定客戶版面顯示與否（寫入內部管理「業務分區」的「版面顯示」欄）
 * visible=false → 填 N；visible=true → 清空
 */
function setCustomerVisibility(custName, visible, salesName) {
  try {
    const ss = getSafeSsMain();
    const sheet = ss.getSheetByName("業務分區");
    if (!sheet) return { success: false, msg: "找不到業務分區表" };

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const custColIdx = findHeaderIndex(headers, ["客戶名稱", "客戶"]);
    let showColIdx = findHeaderIndex(headers, ["版面顯示", "上架顯示"]);

    // 沒有「版面顯示」欄就自動在最後面建立
    if (showColIdx === -1) {
      showColIdx = headers.length;
      sheet.getRange(1, showColIdx + 1).setValue("版面顯示").setFontWeight("bold");
    }

    const targetMerged = mergeCustomer(String(custName || '').trim());
    let updated = 0;
    for (let i = 1; i < data.length; i++) {
      const rowCust = String(data[i][custColIdx] || '').trim();
      if (rowCust && mergeCustomer(rowCust) === targetMerged) {
        sheet.getRange(i + 1, showColIdx + 1).setValue(visible ? '' : 'N');
        updated++;
      }
    }
    if (updated === 0) return { success: false, msg: "業務分區找不到客戶：" + custName };

    // 清該業務的客戶列表快取
    if (salesName) {
      const cacheKey = 'cust_list_v2_' + String(salesName).replace(/[^a-zA-Z一-龥]/g, '');
      try { CacheService.getScriptCache().remove(cacheKey); } catch (e) {}
    }
    return { success: true, msg: (visible ? "已顯示" : "已隱藏") + "「" + custName + "」" };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

function getCustomerList(salesName) {
  try {
    // 🚀 效能優化：加入 Script Cache（10 分鐘），業務點選後不再每次重掃業務分區全表
    const cacheKey = 'cust_list_v2_' + salesName.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '');
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) {
      return { success: true, data: JSON.parse(cached) };
    }

    const ss = getSafeSsMain();
    const zoningSheet = ss.getSheetByName("業務分區");
    const customerMap = {};

    if (zoningSheet) {
      const data = zoningSheet.getDataRange().getValues();
      const headers = data[0];
      
      const salesColIdx = findHeaderIndex(headers, ["負責業務", "業務", "負責人"]);
      const custColIdx = findHeaderIndex(headers, ["客戶名稱", "客戶"]);
      const showColIdx = findHeaderIndex(headers, ["版面顯示", "上架顯示"]);
      const levelColIdx = findHeaderIndex(headers, ["等級"]);

      if (salesColIdx !== -1 && custColIdx !== -1) {
        // --- 縱向佈局 (一列一個客戶) ---
        for (let i = 1; i < data.length; i++) {
          const rowSales = String(data[i][salesColIdx] || '').trim();
          const rowCust = String(data[i][custColIdx] || '').trim();
          if (!(rowSales.includes(salesName.trim()) && rowCust)) continue;

          // 🙈 版面顯示欄填 N/否 → hidden（仍回傳，由前端收進「未顯示版面」區）
          let hidden = false;
          if (showColIdx !== -1) {
            const showVal = String(data[i][showColIdx] || '').trim().toLowerCase();
            hidden = (showVal === 'n' || showVal === 'no' || showVal === '否' || showVal === '隱藏' || showVal === '0' || showVal === 'false');
          }
          const level = levelColIdx !== -1 ? String(data[i][levelColIdx] || '').trim() : '';

          const merged = mergeCustomer(rowCust);
          if (!customerMap[merged]) {
            customerMap[merged] = { name: rowCust, salesperson: rowSales, level: level, hidden: hidden };
          }
        }
      } else {
        // --- 橫向佈局 (舊版) ---
        const repCols = [];
        headers.forEach((h, idx) => {
          if (h && h.includes(salesName)) {
            repCols.push({ name: h, col: idx });
          }
        });
        if (repCols.length === 0) return { success: false, msg: "找不到業務: " + salesName };
        for (let i = 1; i < data.length; i++) {
          repCols.forEach(rep => {
            let nameRaw = String(data[i][rep.col + 1] || '').trim(); 
            if (!nameRaw || /^\d+$/.test(nameRaw)) {
               const fallback = String(data[i][rep.col] || '').trim();
               if (fallback && !/^\d+$/.test(fallback)) nameRaw = fallback;
            }
            if (nameRaw && nameRaw !== "客戶名稱" && nameRaw !== "序號" && nameRaw !== "客戶" && !/^\d+$/.test(nameRaw)) {
              const merged = mergeCustomer(nameRaw);
              if (!customerMap[merged]) {
                customerMap[merged] = { name: nameRaw, salesperson: rep.name };
              }
            }
          });
        }
      }
    }
    
    const result = Object.values(customerMap);
    // 快取 10 分鐘（客戶分區調整頻率低）
    try { cache.put(cacheKey, JSON.stringify(result), 600); } catch(e){}
    return { success: true, data: result };
  } catch (e) {
    return { success: false, msg: "清單載入失敗: " + e.toString() };
  }
}

// -----------------------------------------------------------------------------
// 3. 版面抓取 (100% 複刻戰情室圖片解析)
// -----------------------------------------------------------------------------

function getCustomerDisplays(customerName) {
  try {
    const ssBusiness = getSafeSsBusiness();
    const ssMain = getSafeSsMain();
    const sheet = ssBusiness.getSheetByName(CONFIG.SHEET_NAME_LAYOUT);
    const data = sheet.getDataRange().getValues();

    // 🚀 對齊戰情室標號：標題在第二列 (Index 1)，數據從第三列 (Index 2) 開始
    const headers = data[1] || data[0];
    const startRow = 2;

    const idx = {
      cust: findHeaderIndex(headers, ["客戶名稱", "客戶"]),
      series: findHeaderIndex(headers, ["中文系列", "系列"]),
      sku: findHeaderIndex(headers, ["編號", "產品編號"]),
      img: findHeaderIndex(headers, ["版面連結", "連結", "圖片", "照片"]),
      date: findHeaderIndex(headers, ["上架日期", "日期"]),
      qty: findHeaderIndex(headers, ["片數", "數量"]),
      batch: findHeaderIndex(headers, ["批號"]),
      size: findHeaderIndex(headers, ["尺寸"]),
      mode: findHeaderIndex(headers, ["展示方式"]),
      lastUpdate: findHeaderIndex(headers, ["最後更新時間", "更新時間"]),
      offDate: findHeaderIndex(headers, ["下架日期"])
    };

    if (idx.cust === -1) return { success: false, msg: "找不到客戶欄位", debug_headers: headers };

    const targetMerged = mergeCustomer(customerName);

    // 🚀 優化 1：快取庫存與單磚圖資料 (10 分鐘)
    let inventoryMap = {};
    try {
      inventoryMap = getInventoryMapCached(ssMain);
    } catch (e) {
      console.warn("Cache Error:", e);
      inventoryMap = getInventoryMap(ssMain); // 失敗則讀取實體
    }

    // 🚀 優化 2：快取銷售合計數據 (避免每次遍歷數萬行)
    let customerSalesMap = {};
    try {
      customerSalesMap = getCustomerSalesCached(ssMain, targetMerged, inventoryMap);
    } catch (e) {
      console.warn("Sales Cache Error:", e);
      customerSalesMap = calculateSalesManual(ssMain, targetMerged, inventoryMap);
    }

    // 🚀 新增：取得此客戶的專屬保留資料 (用於版面頁面標註)
    let customerReservedMap = {};
    try {
      if (typeof getReservedOrdersGrouped === 'function') {
        const reservedGroups = getReservedOrdersGrouped(ssMain, targetMerged);
        reservedGroups.forEach(group => {
          group.items.forEach(item => {
            const skuKey = item.sku.replace(/[\s\-]/g, '');
            if (!customerReservedMap[skuKey]) {
              customerReservedMap[skuKey] = { qty: 0, cases: new Set(), details: [] };
            }
            customerReservedMap[skuKey].qty += item.qty;
            if (group.name) customerReservedMap[skuKey].cases.add(group.name);
            
            // 🚀 紀錄詳細資訊：編號 數量片 業務 (使用 group.biz 修正 item.biz 遺漏問題)
            customerReservedMap[skuKey].details.push(item.sku + " " + item.qty + "片 " + (group.biz || '未指定'));
          });
        });
      }
    } catch (e) {
      console.warn("Reservation Load Error:", e);
    }

    const today = new Date().getTime();

    const allData = data.slice(startRow)
      .filter(row => {
        const rowCust = row[idx.cust];
        return rowCust && mergeCustomer(rowCust) === targetMerged;
      })
      .map(row => {
        const fullSku = String(row[idx.sku] || '').trim();
        const skuKey = fullSku.replace(/[\s\-]/g, '');
        const rawImg = String(row[idx.img] || '').trim();
        const date = row[idx.date] instanceof Date ? row[idx.date] : new Date();
        const days = Math.floor((today - date.getTime()) / 86400000);
        const offDateRaw = idx.offDate !== -1 ? row[idx.offDate] : null;

        const stock = inventoryMap[skuKey] || { level: 2, qty: 0, pyeong: 0, safe: 0, salesQty: 0, salesAmt: 0, singleImg: "" };
        const cSales = customerSalesMap[skuKey] || { pings: 0, amt: 0, count: 0 };

        let thumbUrl = rawImg;
        const driveId = extractIdFromUrl(rawImg);
        if (driveId) {
          thumbUrl = "https://lh3.googleusercontent.com/d/" + driveId + "=w1000";
        }

        let singleImgUrl = '';
        if (stock.singleImg && stock.singleImg.trim() !== '') {
          const singleDriveId = extractIdFromUrl(stock.singleImg);
          singleImgUrl = singleDriveId ? "https://lh3.googleusercontent.com/d/" + singleDriveId + "=w200" : stock.singleImg;
        }

        return {
          sku: fullSku,
          series: idx.series !== -1 ? String(row[idx.series] || '一般系列') : '一般系列',
          photoUrl: thumbUrl,
          daysOnDisplay: Math.max(0, days),
          installDate: Utilities.formatDate(date, "GMT+8", "yyyy/MM/dd"),
          offDate: offDateRaw ? Utilities.formatDate(new Date(offDateRaw), "GMT+8", "yyyy/MM/dd HH:mm") : null,
          stockLevel: stock.level,
          currentStock: stock.qty,
          currentPyeong: stock.pyeong,
          safeStock: stock.safe,
          salesQty: cSales.pings > 0 ? cSales.pings : stock.salesQty,
          salesAmt: cSales.amt > 0 ? cSales.amt : stock.salesAmt,
          customerSalesAmt: cSales.amt,
          customerSalesQty: cSales.pings,
          frequency: cSales.count || 0,
          customerReservedQty: customerReservedMap[skuKey] ? customerReservedMap[skuKey].qty : 0,
          customerReservedCases: customerReservedMap[skuKey] ? Array.from(customerReservedMap[skuKey].cases).join(', ') : '',
          customerReservedSummary: customerReservedMap[skuKey] ? customerReservedMap[skuKey].details.join('\n') : '',
          singleImg: singleImgUrl,
          originalQty: idx.qty !== -1 ? (row[idx.qty] || 1) : 1,
          batch: idx.batch !== -1 ? String(row[idx.batch] || '') : '',
          size: idx.size !== -1 ? String(row[idx.size] || '') : '',
          spec: idx.spec !== -1 ? String(row[idx.spec] || '') : '',
          mode: idx.mode !== -1 ? String(row[idx.mode] || '版面') : '版面',
          lastUpdate: idx.lastUpdate !== -1 && row[idx.lastUpdate]
            ? Utilities.formatDate(new Date(row[idx.lastUpdate]), "GMT+8", "yyyy/MM/dd HH:mm")
            : ''
        };
      });

    const active = allData.filter(d => !d.offDate);
    const history = allData.filter(d => d.offDate);

    return {
      success: true,
      active: active,
      history: history,
      debug: { active: active.length, history: history.length, target: targetMerged }
    };
  } catch (e) {
    return { success: false, msg: "資料抓取失敗: " + e.toString() };
  }
}

// -----------------------------------------------------------------------------
// 4. 工具函式組
// -----------------------------------------------------------------------------

function getInventoryMapCached(ss) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("inventory_map");
  if (cached) return JSON.parse(cached);

  const map = getInventoryMap(ss);
  const json = JSON.stringify(map);
  // GAS 快取限制 100KB (約 50,000 字元)
  if (json.length < 90000) {
    cache.put("inventory_map", json, 600);
  }
  return map;
}

function getCustomerSalesCached(ss, targetMerged, inventoryMap) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "sales_" + targetMerged;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const customerSalesMap = calculateSalesManual(ss, targetMerged, inventoryMap);
  const json = JSON.stringify(customerSalesMap);
  if (json.length < 90000) {
    cache.put(cacheKey, json, 300);
  }
  return customerSalesMap;
}

function calculateSalesManual(ss, targetMerged, inventoryMap) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_SALES);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  
  const headers = data[0];
  const sIdx = {
    cust: findHeaderIndex(headers, ["客戶名稱", "客戶"]),
    sku: findHeaderIndex(headers, ["產品編號", "編號", "序號"]),
    qty: findHeaderIndex(headers, ["數量", "片數"]),
    amt: findHeaderIndex(headers, ["金額", "銷售金額"]),
    date: findHeaderIndex(headers, ["單據日期", "日期"])
  };

  const customerSalesMap = {};
  const rows = data.slice(1);
  const target = targetMerged.trim();
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (mergeCustomer(row[sIdx.cust]) === target) {
      const rawSku = row[sIdx.sku];
      if (!rawSku) continue;
      const sku = String(rawSku).trim().replace(/[\s\-]/g, '');
      
      if (!customerSalesMap[sku]) customerSalesMap[sku] = { pings: 0, amt: 0, count: 0 };
      const meta = inventoryMap[sku] || { perPing: 36 };
      
      const qty = parseFloat(row[sIdx.qty]) || 0;
      const amt = parseFloat(row[sIdx.amt]) || 0;
      
      customerSalesMap[sku].pings += qty / (meta.perPing || 36);
      customerSalesMap[sku].amt += amt;
      customerSalesMap[sku].count += 1;
    }
  }
  return customerSalesMap;
}

function getInventoryMap(ss) {
  if (!ss) return {};
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_PRODUCTS);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idx = {
    sku: findHeaderIndex(headers, ["編號", "產品編號", "品碼"]),
    qty: findHeaderIndex(headers, ["庫存片數", "現有片數", "總片數"]),
    pyeong: findHeaderIndex(headers, ["庫存坪數", "現有坪數", "總坪數"]),
    safe: findHeaderIndex(headers, ["人工指定安全坪數", "安全庫存", "安全水位"]),
    salesQty: findHeaderIndex(headers, ["銷售坪數", "累計銷量", "銷量", "銷售數", "銷數"]),
    salesAmt: findHeaderIndex(headers, ["銷售金額", "成交金額", "銷額", "總金額", "銷價"]),
    singleImg: findHeaderIndex(headers, ["單片連結網址", "單片連結", "產品縮圖", "圖片"]),
    sceneFolder: findHeaderIndex(headers, ["雲端圖片", "雲端圖片(實景圖)", "實景照片"]),
    perPing: findHeaderIndex(headers, ["片/坪", "片坪"]),
    size: findHeaderIndex(headers, ["尺寸", "SIZE"]),
    series: findHeaderIndex(headers, ["中文系列", "系列"]),
    spec: findHeaderIndex(headers, ["規格"])
  };

  const map = {};
  data.slice(1).forEach(row => {
    const rawSku = String(row[idx.sku] || '').trim();
    if (rawSku) {
      const skuKey = rawSku.replace(/[\s\-]/g, '');
      const qty = parseFloat(row[idx.qty]) || 0;
      const pyeong = parseFloat(row[idx.pyeong]) || 0;
      const safe = parseFloat(row[idx.safe]) || 0;
      const sQty = idx.salesQty !== -1 ? parseFloat(row[idx.salesQty]) || 0 : 0;
      const sAmt = idx.salesAmt !== -1 ? parseFloat(row[idx.salesAmt]) || 0 : 0;
      const sImg = idx.singleImg !== -1 ? String(row[idx.singleImg] || '').trim() : '';
      const sFolder = idx.sceneFolder !== -1 ? String(row[idx.sceneFolder] || '').trim() : '';
      const perPing = idx.perPing !== -1 ? (parseFloat(row[idx.perPing]) || 36) : 36;
      const sz = idx.size !== -1 ? String(row[idx.size] || '').trim() : '';

      let level = 3;
      if (qty <= 0) level = 1;
      else if (pyeong < safe) level = 2;

      map[skuKey] = { 
        sku: rawSku, // 保留原始編號供顯示
        level, qty, pyeong, safe, 
        salesQty: sQty, salesAmt: sAmt, 
        singleImg: sImg, sceneFolder: sFolder,
        perPing: perPing,
        size: sz,
        series: idx.series !== -1 ? String(row[idx.series] || '').trim() : '一般',
        spec: idx.spec !== -1 ? String(row[idx.spec] || '').trim() : ''
      };
    }
  });
  return map;
}

/**
 * 🚮 永久刪除版面 (誤傳專用 - 不留紀錄)
 */
function deleteDisplayBatchPermanent(customerName, skus, photoUrl) {
  try {
    const ss = getSafeSsBusiness();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_LAYOUT);
    const data = sheet.getDataRange().getValues();
    const headers = data[1] || data[0];

    const idx = {
      cust: findHeaderIndex(headers, ["客戶名稱", "客戶"]),
      sku: findHeaderIndex(headers, ["產品編號", "編號"]),
      img: findHeaderIndex(headers, ["版面連結", "連結", "圖片", "照片"])
    };

    const targetMerged = mergeCustomer(customerName);
    const normalizedSkus = skus.map(s => String(s).replace(/[\s\-]/g, ''));
    const targetPhotoId = extractIdFromUrl(photoUrl);

    // 🚀 效能優化：先蒐集要刪除的列號，再逆向批次刪除
    // 避免在迴圈中逐行呼叫 deleteRow（每次皆為一個獨立 API call）
    const rowsToDelete = [];
    for (let i = data.length - 1; i >= 2; i--) {
      const rowCust = mergeCustomer(data[i][idx.cust]);
      const rowSku = String(data[i][idx.sku] || '').trim().replace(/[\s\-]/g, '');
      const rowImg = String(data[i][idx.img] || '').trim();
      const rowImgId = extractIdFromUrl(rowImg);

      const isSkuMatch = normalizedSkus.includes(rowSku);
      const isImgMatch = (targetPhotoId && rowImgId) ? (targetPhotoId === rowImgId) : (rowImg === photoUrl);

      if (rowCust === targetMerged && isSkuMatch && isImgMatch) {
        rowsToDelete.push(i + 1); // 記錄 1-based 列號
      }
    }

    // 批次刪除：將連續行合併為一次 deleteRows() 呼叫
    rowsToDelete.sort((a, b) => b - a);
    const deleted = rowsToDelete.length;
    if (deleted > 0) {
      let i = 0;
      while (i < rowsToDelete.length) {
        let start = rowsToDelete[i];
        let count = 1;
        while (i + count < rowsToDelete.length && rowsToDelete[i + count] === start - count) {
          count++;
        }
        sheet.deleteRows(start - count + 1, count);
        i += count;
      }
    }

    // 嘗試從 Drive 刪除照片
    if (targetPhotoId) {
      try { DriveApp.getFileById(targetPhotoId).setTrashed(true); } catch (e) { console.warn("照片刪除失敗", e); }
    }

    return { success: true, msg: "已永久刪除 " + deleted + " 筆資料與相關照片" };
  } catch (e) {
    return { success: false, msg: "刪除失敗: " + e.toString() };
  }
}

function offShelfDisplayBatch(customerName, skus, salesperson, photoUrl) {
  try {
    const ss = getSafeSsBusiness();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_LAYOUT);
    const data = sheet.getDataRange().getValues();
    const headers = data[1] || data[0];

    const idx = {
      cust: findHeaderIndex(headers, ["客戶名稱", "客戶"]),
      sku: findHeaderIndex(headers, ["產品編號", "編號"]),
      img: findHeaderIndex(headers, ["版面連結", "連結", "圖片", "照片"]),
      offDate: findHeaderIndex(headers, ["下架日期"]),
      lastUpdate: findHeaderIndex(headers, ["最後更新時間", "更新時間"]),
      creator: findHeaderIndex(headers, ["建立者"])
    };

    if (idx.cust === -1 || idx.sku === -1 || idx.offDate === -1) {
      return { success: false, msg: "工作表格式不支援下架操作" };
    }

    const targetMerged = mergeCustomer(customerName);
    const timestamp = new Date();
    const normalizedSkus = skus.map(s => String(s).replace(/[\s\-]/g, ''));
    const targetPhotoId = extractIdFromUrl(photoUrl);

    // 🚀 效能優化：蒐集所有需要更新的列資訊，批次寫入取代逐行 setValue
    const offDateUpdates = []; // { rowNum, offDateCol, lastUpdateCol }
    for (let i = 2; i < data.length; i++) {
      const rowCust = mergeCustomer(data[i][idx.cust]);
      const rowSku = String(data[i][idx.sku] || '').trim().replace(/[\s\-]/g, '');
      const rowImg = String(data[i][idx.img] || '').trim();
      const rowImgId = extractIdFromUrl(rowImg);

      const isSkuMatch = normalizedSkus.includes(rowSku);
      const isImgMatch = (targetPhotoId && rowImgId) ? (targetPhotoId === rowImgId) : (rowImg === photoUrl);

      if (rowCust === targetMerged && isSkuMatch && isImgMatch && !data[i][idx.offDate]) {
        offDateUpdates.push(i + 1); // 記錄 1-based 列號
      }
    }

    // 批次寫入：用 RangeList 一次更新所有匹配列
    if (offDateUpdates.length > 0) {
      const offDateA1s = offDateUpdates.map(r => sheet.getRange(r, idx.offDate + 1).getA1Notation());
      sheet.getRangeList(offDateA1s).setValue(timestamp);
      if (idx.lastUpdate !== -1) {
        const updateA1s = offDateUpdates.map(r => sheet.getRange(r, idx.lastUpdate + 1).getA1Notation());
        sheet.getRangeList(updateA1s).setValue(timestamp);
      }
    }

    return { success: true, msg: "已成功下架 " + offDateUpdates.length + " 個品項" };
  } catch (e) {
    return { success: false, msg: "後端錯誤: " + e.toString() };
  }
}

function updateDisplayBatch(customerName, photoUrl, newItems, newPhotoData, gpsData, salesperson) {
  try {
    // 1. 安全開啟試算表
    // 🚀 效能優化：只在確實需要時才開啟 ssMain（用快取版 inventoryMap 取代）
    const ssBusiness = getSafeSsBusiness();
    const sheet = ssBusiness.getSheetByName(CONFIG.SHEET_NAME_LAYOUT);
    if (!sheet) throw new Error("找不到工作表: " + CONFIG.SHEET_NAME_LAYOUT);
    
    const data = sheet.getDataRange().getValues();
    const headers = data[1] || data[0];

    const idx = {
      cust: findHeaderIndex(headers, ["客戶名稱", "客戶"]),
      sku: findHeaderIndex(headers, ["產品編號", "編號"]),
      qty: findHeaderIndex(headers, ["片數", "數量"]),
      img: findHeaderIndex(headers, ["版面連結", "照片", "圖片"]),
      series: findHeaderIndex(headers, ["系列"]),
      batch: findHeaderIndex(headers, ["批號"]),
      offDate: findHeaderIndex(headers, ["下架日期"]),
      date: findHeaderIndex(headers, ["上架日期", "日期"]),
      creator: findHeaderIndex(headers, ["建立者"]),
      createTime: findHeaderIndex(headers, ["建立時間"]),
      lastUpdate: findHeaderIndex(headers, ["最後更新時間", "更新時間"]),
      custId: findHeaderIndex(headers, ["客戶編號"]),
      size: findHeaderIndex(headers, ["尺寸"]),
      spec: findHeaderIndex(headers, ["規格"]),
      mode: findHeaderIndex(headers, ["展示方式"])
    };

    const targetMerged = mergeCustomer(customerName);
    const today = new Date();
    const timeStr = Utilities.formatDate(today, "GMT+8", "yyyy/MM/dd HH:mm:ss");

    // 2. 預備變量 (蒐集舊資料作為新資料的基礎)
    let baseSeries = "一般系列";
    let baseDate = today;
    let baseCreator = salesperson || "";
    let baseCreateTime = today;
    let baseCustId = "";
    let baseMode = "版面";
    let skuSizeMap = {};
    const deleteRows = []; // 紀錄需要刪除的列號

    const targetPhotoId = extractIdFromUrl(photoUrl);

    // 掃描找出要更新的行
    for (let i = data.length - 1; i >= 2; i--) {
      const rowImg = String(data[i][idx.img] || '').trim();
      const rowCustMerged = mergeCustomer(data[i][idx.cust]);
      const rowImgId = extractIdFromUrl(rowImg);
      const isImgMatch = (targetPhotoId && rowImgId) ? (targetPhotoId === rowImgId) : (rowImg === photoUrl);
      
      // 🚀 安全性強化：如果沒有照片 ID 且照片網址為空，強制比對系列，防止誤改其他無照片版面
      let isMatch = isImgMatch;
      if (!targetPhotoId && (!photoUrl || photoUrl.includes('placehold'))) {
        const rowSeries = String(data[i][idx.series] || '一般系列');
        // 從 newItems 取得當前編輯的系列名稱作為參考
        const targetSeries = (newItems && newItems[0] && newItems[0].series) ? newItems[0].series : "";
        if (targetSeries && rowSeries !== targetSeries) isMatch = false;
      }

      if (isMatch && rowCustMerged === targetMerged && !data[i][idx.offDate]) {
        if (data[i][idx.series]) baseSeries = data[i][idx.series];
        if (data[i][idx.date]) baseDate = data[i][idx.date];
        if (idx.creator !== -1 && data[i][idx.creator]) baseCreator = data[i][idx.creator];
        if (idx.createTime !== -1 && data[i][idx.createTime]) baseCreateTime = data[i][idx.createTime];
        if (idx.custId !== -1 && !baseCustId) baseCustId = data[i][idx.custId];
        if (idx.mode !== -1) baseMode = data[i][idx.mode];
        
        const s = String(data[i][idx.sku] || '').trim();
        skuSizeMap[s] = {
          size: idx.size !== -1 ? data[i][idx.size] : "",
          spec: idx.spec !== -1 ? data[i][idx.spec] : ""
        };
        deleteRows.push(i + 1);
      }
    }

    if (!baseCustId && idx.custId !== -1) {
      for (let i = 2; i < data.length; i++) {
        if (mergeCustomer(data[i][idx.cust]) === targetMerged && data[i][idx.custId]) {
          baseCustId = data[i][idx.custId];
          break;
        }
      }
    }

    // 3. 處理圖片上傳 (交易外預處理，失敗不刪資料)
    let finalPhotoUrl = photoUrl;
    if (newPhotoData) {
      const dateStr = Utilities.formatDate(today, "GMT+8", "yyyyMMdd");
      const fileName = [customerName, baseSeries, "", dateStr, salesperson].filter(Boolean).join("_") + ".jpg";
      const blob = Utilities.newBlob(Utilities.base64Decode(newPhotoData.base64), newPhotoData.mimeType || 'image/jpeg', fileName);
      
      let file;
      try {
        const folder = DriveApp.getFolderById(CONFIG.IMG_FOLDER_ID);
        file = folder.createFile(blob);
      } catch (e) {
        console.warn("圖片上傳至 CONFIG.IMG_FOLDER_ID 失敗，改用 eliTile_Uploads 資料夾:", e);
        const folders = DriveApp.getFoldersByName("eliTile_Uploads");
        const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("eliTile_Uploads");
        file = folder.createFile(blob);
      }
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      finalPhotoUrl = file.getUrl();

      // 📍 重新拍照時同步更新 GPS 客戶定位
      if (gpsData && gpsData.lat) {
        updateCustomerLocation(customerName, gpsData.lat, gpsData.lng);
      }
    }

    // 4. 準備新行數據
    // 🚀 效能優化：先嘗試快取，只在快取未命中時才開 ssMain
    const cachedInv = CacheService.getScriptCache().get("inventory_map");
    const invMap = cachedInv ? JSON.parse(cachedInv) : getInventoryMapCached(getSafeSsMain());
    
    // 🚀 關鍵修正：優先從 newItems 取得使用者輸入的「系列」與「尺寸」
    // 如果前端傳入的項目帶有 series/size，則以此為準，不再盲目採用舊資料
    const finalBaseSeries = (newItems[0] && newItems[0].series) ? newItems[0].series : baseSeries;
    const finalBaseSize = (newItems[0] && newItems[0].size) ? newItems[0].size : "";

    const newRowsToInsert = newItems.map(item => {
      const row = new Array(headers.length).fill("");
      if (idx.cust !== -1) row[idx.cust] = customerName;
      if (idx.date !== -1) row[idx.date] = baseDate;
      if (idx.sku !== -1) row[idx.sku] = item.sku.trim().toUpperCase();
      if (idx.qty !== -1) row[idx.qty] = item.qty || 1;
      if (idx.img !== -1) row[idx.img] = finalPhotoUrl;
      if (idx.series !== -1) row[idx.series] = finalBaseSeries;
      if (idx.batch !== -1) row[idx.batch] = item.batch || '';
      if (idx.creator !== -1) row[idx.creator] = baseCreator;
      if (idx.lastUpdate !== -1) row[idx.lastUpdate] = timeStr;
      if (idx.custId !== -1) row[idx.custId] = baseCustId;
      if (idx.mode !== -1) row[idx.mode] = baseMode;
      if (idx.size !== -1) {
        row[idx.size] = item.size || finalBaseSize || (skuSizeMap[item.sku] && skuSizeMap[item.sku].size) || (invMap[item.sku] ? invMap[item.sku].size : "");
      }
      if (idx.spec !== -1) {
        row[idx.spec] = item.spec || (skuSizeMap[item.sku] && skuSizeMap[item.sku].spec) || (invMap[item.sku] ? invMap[item.sku].spec : "");
      }
      return row;
    });

    // 5. 🚀 執行寫入 (交易式操作：先確認新資料準備好，最後才刪舊插新)
    // 批次刪除：將連續行合併為一次 deleteRows() 呼叫
    deleteRows.sort((a, b) => b - a);
    if (deleteRows.length > 0) {
      let i = 0;
      while (i < deleteRows.length) {
        let start = deleteRows[i];
        let count = 1;
        while (i + count < deleteRows.length && deleteRows[i + count] === start - count) {
          count++;
        }
        sheet.deleteRows(start - count + 1, count);
        i += count;
      }
    }

    // 插入到最上方 (Row 3)
    if (newRowsToInsert.length > 0) {
      sheet.insertRowsBefore(3, newRowsToInsert.length);
      sheet.getRange(3, 1, newRowsToInsert.length, headers.length).setValues(newRowsToInsert);
    }

    // 6. 🗑️ 刪除舊照片 (僅在有新照片且 ID 不同時執行)
    if (newPhotoData && targetPhotoId) {
      try {
        const oldFile = DriveApp.getFileById(targetPhotoId);
        oldFile.setTrashed(true);
        console.log("已刪除舊照片:", targetPhotoId);
      } catch (e) {
        console.warn("舊照片刪除失敗 (可能已不存在):", e);
      }
    }

    // 7. 📝 寫入工作日誌
    try {
      const actionStr = newPhotoData ? "更換版面照片" : "修改版面品項";
      const skuSummary = newItems.map(i => i.sku).join(", ");
      
      // 🚀 統一呼叫核心存儲邏輯，以利自動合併橫列與剪裁
      saveWorkLog({
        employeeName: salesperson || "系統",
        customerName: customerName,
        result: "業務更新",
        content: `${actionStr}: [${finalBaseSeries}] ${skuSummary}`,
        gps: gpsData ? `${gpsData.lat},${gpsData.lng}` : "",
        _skipHeavyOps: true
      });
    } catch (e) {
      console.warn("工作日誌寫入失敗:", e);
    }

    // 清除快取
    CacheService.getUserCache().remove("CUSTOMER_DISPLAYS_" + targetMerged);

    return { success: true, msg: "已成功更新並移至最上方", finalPhotoUrl: finalPhotoUrl };
  } catch (e) {
    console.error("Update Failed:", e);
    return { success: false, msg: "同步失敗: " + e.toString() };
  }
}

function updateLayoutFieldBatch(customerName, skus, fieldName, newVal) {
  try {
    const ss = getSafeSsBusiness();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_LAYOUT);
    const data = sheet.getDataRange().getValues();
    const headers = data[1] || data[0];

    const fieldIdx = findHeaderIndex(headers, [fieldName]);
    const skuIdx = findHeaderIndex(headers, ["編號", "產品編號"]);
    const updateIdx = findHeaderIndex(headers, ["最後更新時間", "更新日期"]);
    const customerIdx = findHeaderIndex(headers, ["客戶名稱", "客戶"]);

    if (fieldIdx === -1 || skuIdx === -1) return { success: false, msg: "找不到欄位: " + fieldName };

    const targetMerged = mergeCustomer(customerName);
    const timestamp = new Date();

    // 🚀 效能優化：蒐集所有需更新的列，批次一次寫入取代迴圈逐行 setValue
    const matchedRows = [];
    for (let i = 2; i < data.length; i++) {
      const rowSku = String(data[i][skuIdx] || '').trim();
      const rowCust = mergeCustomer(data[i][customerIdx]);
      if (rowCust === targetMerged && skus.includes(rowSku)) {
        matchedRows.push(i + 1); // 記錄 1-based 列號
      }
    }

    // 批次寫入：用 RangeList 一次更新所有匹配列
    if (matchedRows.length > 0) {
      const fieldA1s = matchedRows.map(r => sheet.getRange(r, fieldIdx + 1).getA1Notation());
      sheet.getRangeList(fieldA1s).setValue(newVal);
      if (updateIdx !== -1) {
        const updateA1s = matchedRows.map(r => sheet.getRange(r, updateIdx + 1).getA1Notation());
        sheet.getRangeList(updateA1s).setValue(timestamp);
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

function extractIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;

  // 1. 嘗試匹配常見的 Drive ID 格式 (28-50 字元)
  const idMatch = url.match(/[-\w]{28,50}/);
  if (idMatch) return idMatch[0];

  // 2. 備用：匹配特定的 URL 路徑模式
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{25,})/,
    /id=([a-zA-Z0-9_-]{25,})/,
    /\/file\/d\/([a-zA-Z0-9_-]{25,})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function submitRecord(payload) {
  // 基礎日誌紀錄功能
  return { success: true, msg: "紀錄已提交" };
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    let y = dateStr.getFullYear();
    if (y < 1000) y += 1911; // 處理已經是日期物件但年份為民國的情況
    return new Date(y, dateStr.getMonth(), dateStr.getDate());
  }

  if (typeof dateStr === 'number' && isFinite(dateStr)) {
    // Google Sheets 日期序號
    if (dateStr > 20000 && dateStr < 80000) {
      return new Date(Math.round((dateStr - 25569) * 86400000));
    }
  }
  
  let s = String(dateStr).trim();
  // 支援常見字串格式：2026/05/01、2026-05-01、2026年05月01日、115/05/01、1150501、20260501
  s = s.replace(/[年\.]/g, '/').replace(/月/g, '/').replace(/日/g, '').replace(/\s+/g, ' ').trim();
  const slashMatch = s.match(/^(\d{2,4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+.*)?$/);
  if (slashMatch) {
    let year = parseInt(slashMatch[1], 10);
    if (year < 1000) year += 1911;
    return new Date(year, parseInt(slashMatch[2], 10) - 1, parseInt(slashMatch[3], 10));
  }

  // 🚀 1. 匹配無分隔符的民國年 (例如 01150425)
  const compactMatch = s.match(/^(\d{3,4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    let year = parseInt(compactMatch[1], 10);
    if (year < 1000) year += 1911;
    return new Date(year, parseInt(compactMatch[2], 10) - 1, parseInt(compactMatch[3], 10));
  }
  
  return null;
}

function saveNewLayout(payload) {
  const now = new Date(); // 🚀 Move to top to avoid ReferenceError
  const ss = getSafeSsBusiness();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_LAYOUT);
  if (!sheet) return { success: false, msg: "找不到資料表：" + CONFIG.SHEET_NAME_LAYOUT };

  const dataRange = sheet.getDataRange().getValues();
  // 🚀 關鍵：第1列是說明，第2列是標題 (Index 1)
  const headers = dataRange[1] || dataRange[0];
  const startRow = 2; // 資料從第三行開始

  const idx = {
    custId: findHeaderIndex(headers, ["客戶編號"]),
    custName: findHeaderIndex(headers, ["客戶名稱"]),
    date: findHeaderIndex(headers, ["上架日期", "日期"]),
    series: findHeaderIndex(headers, ["系列"]),
    sku: findHeaderIndex(headers, ["編號", "產品編號"]),
    batch: findHeaderIndex(headers, ["批號"]),
    qty: findHeaderIndex(headers, ["片數", "數量"]),
    mode: findHeaderIndex(headers, ["展示方式"]),
    link: findHeaderIndex(headers, ["版面連結", "連結"]),
    creator: findHeaderIndex(headers, ["建立者"]),
    createTime: findHeaderIndex(headers, ["建立時間"]),
    lastUpdate: findHeaderIndex(headers, ["最後更新時間"]),
    size: findHeaderIndex(headers, ["尺寸"])
  };

  // 0. 安全開啟試算表 (再次確保 ss)
  if (!ss) throw new Error("試算表物件無效");

  // 1. 處理圖片儲存
  // 🚀 效能優化：移除 catch 區塊重複的 getInventoryMap 呼叫，改為先取快取再計算檔名
  let imageUrl = "";
  if (payload.image && payload.image.base64) {
    const ssMain = getSafeSsMain();
    const invMap = getInventoryMapCached(ssMain);
    const firstSku = payload.items[0] ? payload.items[0].sku : "";
    const size = (invMap[firstSku] && invMap[firstSku].size) ? invMap[firstSku].size : "";
    const dateStr = Utilities.formatDate(now, "GMT+8", "yyyyMMdd");
    const fileName = [payload.customerName, payload.series, size, dateStr, payload.salesperson].filter(Boolean).join("_") + ".jpg";
    const blob = Utilities.newBlob(Utilities.base64Decode(payload.image.base64), payload.image.mimeType, fileName);

    try {
      const parentFolder = DriveApp.getFolderById(CONFIG.IMG_FOLDER_ID || "");
      const file = parentFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      imageUrl = file.getUrl();
    } catch (e) {
      console.error("圖片上傳失敗，改用備援資料夾:", e);
      const folders = DriveApp.getFoldersByName("eliTile_Uploads");
      const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("eliTile_Uploads");
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      imageUrl = file.getUrl();
    }
  }

  // 2. 準備公共欄位
  // now 已經在函式開頭定義過
  const dateStrLong = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd");
  const timeStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd HH:mm:ss");

  // 3. 逐一寫入 SKU 行 (改為插入到最上方)
  const rowValues = [];
  payload.items.forEach(item => {
    const newRow = new Array(headers.length).fill("");
    if (idx.custId !== -1) newRow[idx.custId] = payload.customerId || "";
    if (idx.custName !== -1) newRow[idx.custName] = payload.customerName;
    if (idx.date !== -1) newRow[idx.date] = timeStr;
    if (idx.series !== -1) newRow[idx.series] = payload.series;
    if (idx.sku !== -1) newRow[idx.sku] = item.sku.trim().toUpperCase();
    if (idx.batch !== -1) newRow[idx.batch] = item.batch || "";
    if (idx.qty !== -1) newRow[idx.qty] = item.qty || 1;
    if (idx.size !== -1) newRow[idx.size] = payload.size || ""; // 🚀 寫入尺寸
    if (idx.mode !== -1) newRow[idx.mode] = "版面";
    if (idx.link !== -1) newRow[idx.link] = imageUrl;
    if (idx.creator !== -1) newRow[idx.creator] = payload.salesperson;
    if (idx.lastUpdate !== -1) newRow[idx.lastUpdate] = timeStr;
    rowValues.push(newRow);
  });

  if (rowValues.length > 0) {
    sheet.insertRowsBefore(3, rowValues.length);
    sheet.getRange(3, 1, rowValues.length, headers.length).setValues(rowValues);
  }

  // 4. 同步更新 GPS 客戶定位
  if (payload.gps && payload.gps.lat) {
    updateCustomerLocation(payload.customerName, payload.gps.lat, payload.gps.lng);
  }

  // 5. 清理快取
  const cache = CacheService.getScriptCache();
  cache.remove("displays_" + mergeCustomer(payload.customerName));

  return { success: true, count: payload.items.length };
}

function updateCustomerLocation(customerName, lat, lng) {
  try {
    const ss = getSafeSsBusiness();
    let sheet = ss.getSheetByName(CONFIG.SHEET_NAME_GPS);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEET_NAME_GPS);
      sheet.appendRow(["客戶名稱", "緯度", "經度", "更新時間"]);
    }
    const data = sheet.getDataRange().getValues();
    const targetMerged = mergeCustomer(customerName);
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (mergeCustomer(data[i][0]) === targetMerged) {
        foundRow = i + 1;
        break;
      }
    }
    const timestamp = new Date();
    if (foundRow !== -1) {
      sheet.getRange(foundRow, 1, 1, 4).setValues([[customerName, lat, lng, timestamp]]);
    } else {
      sheet.appendRow([customerName, lat, lng, timestamp]);
    }
    return true;
  } catch (e) {
    console.error("GPS 更新失敗:", e);
    return false;
  }
}
/**
 * 📦 大量快取處理工具 (解決 90KB 限制)
 * 讓大數據量的庫存清單與業績總覽能真正被緩存，避開 90KB 的天花板
 */
const CacheManager = {
  putLarge: function(key, data, expirationInSeconds = 600) {
    const cache = CacheService.getScriptCache();
    try {
      const json = JSON.stringify(data);
      const chunkSize = 80000; // 設為 80KB 確保穩定
      const chunks = [];
      
      for (let i = 0; i < json.length; i += chunkSize) {
        chunks.push(json.substring(i, i + chunkSize));
      }
      
      // 1. 存入分片資訊 (Metadata)
      cache.put(key + "_meta", JSON.stringify({ count: chunks.length, size: json.length, time: new Date().getTime() }), expirationInSeconds);
      
      // 2. 依序存入分片
      chunks.forEach((chunk, idx) => {
        cache.put(key + "_part_" + idx, chunk, expirationInSeconds);
      });
      return true;
    } catch(e) {
      console.error("CacheManager 儲存失敗:", e);
      return false;
    }
  },
  
  getLarge: function(key) {
    const cache = CacheService.getScriptCache();
    try {
      const metaStr = cache.get(key + "_meta");
      if (!metaStr) return null;
      
      const meta = JSON.parse(metaStr);
      let fullJson = "";
      for (let i = 0; i < meta.count; i++) {
        const part = cache.get(key + "_part_" + i);
        if (part === null) return null; // 碎片丟失，視為快取過期
        fullJson += part;
      }
      
      return JSON.parse(fullJson);
    } catch(e) {
      console.error("CacheManager 讀取失敗:", e);
      return null;
    }
  },
  
  removeLarge: function(key) {
    const cache = CacheService.getScriptCache();
    const metaStr = cache.get(key + "_meta");
    if (metaStr) {
      const meta = JSON.parse(metaStr);
      for (let i = 0; i < meta.count; i++) {
        cache.remove(key + "_part_" + i);
      }
      cache.remove(key + "_meta");
    }
  }
};

/**
 * 📡 取得戰情室最新缺貨新進榜品項
 */
/**
 * 📡 取得最近三筆缺貨新進榜（跑馬燈用）
 * 讀保留系統維護的新版欄位：產品編號 + 入榜日期，排除已結案/出清結案
 */
function getLatestStockoutEntries() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const sh = ss.getSheetByName('缺貨進榜追蹤');
    if (!sh) return { success: false, msg: "找不到缺貨進榜追蹤表" };
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { success: false, msg: "暫無資料" };

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const idxCode = headers.indexOf('產品編號');
    const idxDate = headers.indexOf('入榜日期');
    const idxCat = headers.indexOf('缺貨分類');
    const idxClosed = headers.indexOf('是否結案');
    const idxClear = headers.indexOf('出清結案');
    if (idxCode === -1 || idxDate === -1) return { success: false, msg: "格式不符" };

    const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    const entries = [];
    data.forEach(row => {
      const code = String(row[idxCode] || '').trim();
      if (!code) return;
      if (idxClosed !== -1 && String(row[idxClosed] || '').trim() === '是') return;
      if (idxClear !== -1 && String(row[idxClear] || '').trim()) return;
      const cat = idxCat !== -1 ? String(row[idxCat] || '').trim() : '';
      // 🚫 只有真正的缺貨警示分類才顯示在啟動畫面跑馬燈；「已復原」等已解決狀態不算新警示，跳過。
      if (cat && !/缺貨|斷貨/.test(cat)) return;
      const d = parseDate(row[idxDate]);
      entries.push({
        code: code,
        cat: cat,
        ts: d ? d.getTime() : 0,
        dateStr: d ? ((d.getMonth() + 1) + "/" + d.getDate()) : String(row[idxDate] || '').trim()
      });
    });
    if (!entries.length) return { success: false, msg: "暫無進榜資料" };

    entries.sort((a, b) => b.ts - a.ts);
    const top3 = entries.slice(0, 3).map(e => ({
      text: e.dateStr + " " + (e.cat || "新進榜缺貨") + "：" + e.code,
      severe: /完全|嚴重/.test(e.cat)
    }));
    return { success: true, msgs: top3 };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

function getLatestStockoutEntry() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const sh = ss.getSheetByName('缺貨進榜追蹤');
    if (!sh) return { success: false, msg: "找不到缺貨進榜追蹤表" };
    
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { success: false, msg: "暫無新缺貨資料" };
    
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const idxCode = headers.indexOf('編號');
    const idxFirstDate = headers.indexOf('首日進榜日');
    const idxActive = headers.indexOf('啟用中');
    
    if (idxCode === -1 || idxFirstDate === -1 || idxActive === -1) {
      return { success: false, msg: "格式不符" };
    }
    
    const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    
    // 找出所有啟用中，且按最近時間或倒序排列的最新一筆
    const activeEntries = data.filter(row => {
      const activeVal = String(row[idxActive] || '').trim().toLowerCase();
      return activeVal === 'true' || activeVal === '1' || activeVal === 'yes' || activeVal === '啟用';
    });
    
    if (activeEntries.length === 0) return { success: false, msg: "暫無最新缺貨新進榜" };
    
    // 取最後一筆 (最新進榜的)
    const latest = activeEntries[activeEntries.length - 1];
    const firstDate = latest[idxFirstDate];
    const code = latest[idxCode];
    
    let dateStr = "";
    if (firstDate instanceof Date) {
      dateStr = (firstDate.getMonth() + 1) + "/" + firstDate.getDate();
    } else if (firstDate) {
      const match = String(firstDate).match(/(\d{1,2})[\/\-\.](\d{1,2})/);
      if (match) {
        dateStr = parseInt(match[1]) + "/" + parseInt(match[2]);
      } else {
        dateStr = String(firstDate).trim();
      }
    }
    
    return {
      success: true,
      code: code,
      dateStr: dateStr,
      msg: `${dateStr} 新進榜缺貨：${code}`
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📧 寄送版面報告 Email (含 JPG 附件)
 */
function sendLayoutReport(recipientEmail, customerName, salesName, imagesJson) {
  try {
    var images = JSON.parse(imagesJson);
    var recipient = recipientEmail || Session.getActiveUser().getEmail();
    if (!recipient) recipient = Session.getEffectiveUser().getEmail();
    
    var attachments = [];
    images.forEach(function(img, i) {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(img.data),
        'image/jpeg',
        (img.name || ('版面_' + (i+1))) + '.jpg'
      );
      attachments.push(blob);
    });
    
    MailApp.sendEmail(recipient, '版面資料 - ' + (customerName || ''), 
      '客戶: ' + (customerName || '') + '\n業務: ' + (salesName || '') + '\n共 ' + images.length + ' 張圖片\n\n圖片檔名與系列對照:\n' +
      images.map(function(img, i){ return (i+1) + '. ' + (img.name || '未命名'); }).join('\n'),
      { attachments: attachments }
    );
    
    return { success: true, msg: '已寄送至 ' + recipient };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}
