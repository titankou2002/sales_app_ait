/**
 * 📂 客戶管理核心邏輯 (Customer Management) - 內部查庫存旗艦版
 */

/**
 * 取得指定客戶的綜合戰情資料 (保留單)
 */
function getCustomerDashboardData(custName) {
  try {
    // 🚀 安全開啟保留單試算表，若失敗則回退到主試算表
    var ss = null;
    if (CONFIG.RESERVE_SS_ID) {
      try { ss = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID); } catch(e) { console.warn("無法開啟預約單試算表:", e); }
    }
    if (!ss) ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    
    var cleanName = mergeCustomer(custName);
    
    // 1. 抓取保留單資料 (採用內部查庫存分組邏輯)
    var reservedGroups = getReservedOrdersGrouped(ss, cleanName);
    
    // 2. 提取所有獨特的業務名稱
    var bizSet = {};
    for (var i = 0; i < reservedGroups.length; i++) {
      bizSet[reservedGroups[i].biz] = true;
    }
    var uniqueBiz = Object.keys(bizSet).sort();
    
    return {
      success: true,
      data: {
        reserved: reservedGroups,
        uniqueBiz: uniqueBiz
      }
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📦 讀取保留單 (案名分組版)
 */
function getReservedOrdersGrouped(ss, cleanName) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
  if (!sheet) return [];
  
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  
  // 🚀 頂級對位函式
  var c = function(targets) {
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var idx = header.indexOf(t);
      if (idx !== -1) return idx;
    }
    for (var j = 0; j < header.length; j++) {
      var h = String(header[j] || "").trim();
      for (var k = 0; k < targets.length; k++) {
        if (h.indexOf(targets[k]) !== -1) return j;
      }
    }
    return -1;
  };

  var idx = {
    sku:    c(['編號', '產品編號']),
    qty:    c(['保留數量', '數量', '片數']),
    date:   c(['保留日期', '日期']),
    cust:   c(['客戶', '公司']),
    biz:    c(['業務', '負責業務']),
    case:   c(['案名', '工程名稱']),
    addr:   c(['工地', '地址']),
    deposit:c(['訂金確認', '是否付訂']),
    status: c(['業務更新', '處理進度', '狀態', '進度']),
    note:   header.indexOf('備註')
  };
  
  // 預載產品資訊 (為了坪數與圖片)
  // 🚀 重要：庫存資訊一律從主試算表讀取
  var mainSs = SpreadsheetApp.openById(CONFIG.SS_ID);
  var metaMap = getInventoryMap(mainSs);
  var now = new Date();
  var groups = {};
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (mergeCustomer(row[idx.cust]) !== cleanName) continue;
    
    var skuRaw = String(row[idx.sku] || "").trim();
    var skuKey = skuRaw.replace(/[\s\-]/g, '');
    
    // 💡 修正對位：內部查庫存的 meta 結構 (使用標準化後的 skuKey)
    var meta = metaMap[skuKey] || { perPing: 36, singleImg: "", series: "一般", size: "" };
    
    var qty = parseFloat(row[idx.qty]) || 0;
    var pyeong = meta.perPing > 0 ? (qty / meta.perPing).toFixed(1) : "0.0";
    
    var dateRaw = row[idx.date];
    var dObj = dateRaw instanceof Date ? dateRaw : (typeof parseDate === 'function' ? parseDate(dateRaw) : null);
    var days = dObj ? Math.floor((now.getTime() - dObj.getTime()) / 86400000) : 0;
    
    var caseName = String(row[idx.case] || row[idx.addr] || "其他項目").trim();
    if (!groups[caseName]) {
      groups[caseName] = {
        name: caseName,
        biz: String(row[idx.biz] || "未指定").trim(),
        maxDays: 0,
        items: []
      };
    }
    
    if (days > groups[caseName].maxDays) groups[caseName].maxDays = days;
    
    // 🚀 圖片網址轉換邏輯
    var thumbUrl = meta.singleImg;
    if (thumbUrl && typeof extractIdFromUrl === 'function') {
      var driveId = extractIdFromUrl(thumbUrl);
      if (driveId) thumbUrl = "https://lh3.googleusercontent.com/d/" + driveId + "=w200";
    }

    groups[caseName].items.push({
      sku: skuRaw,
      qty: qty,
      pyeong: pyeong,
      img: thumbUrl,
      series: meta.series,
      size: meta.size,
      date: dObj ? Utilities.formatDate(dObj, "GMT+8", "MM/dd") : "未知",
      days: days,
      deposit: (idx.deposit >= 0 && String(row[idx.deposit]).trim() !== "") ? "已付訂" : "未付訂",
      status: (idx.status >= 0) ? String(row[idx.status] || "保留中").trim() : "保留中",
      note: idx.note >= 0 ? String(row[idx.note] || "").trim() : "",
      rowIdx: i + 1 // 紀錄 Excel 列號以便回寫
    });
  }
  
  var result = [];
  for (var key in groups) {
    result.push(groups[key]);
  }
  
  // 預設排序：天數愈久愈上面
  result.sort(function(a, b) { return b.maxDays - a.maxDays; });
  return result;
}

/**
 * 🚀 批量更新保留單進度
 */
function updateReservedStatus(rowIndices, newStatus) {
  try {
    var ss = null;
    if (CONFIG.RESERVE_SS_ID) {
      try { ss = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID); } catch(e) {}
    }
    if (!ss) ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
    if (!sheet) throw new Error("找不到保留單工作表 [" + (CONFIG.SHEET_NAME_RESERVE || "保留單") + "]");
    
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var statusColIdx = -1;
    var candidates = ['業務更新', '處理進度', '狀態', '進度'];
    
    for (var i = 0; i < candidates.length; i++) {
      var idx = header.indexOf(candidates[i]);
      if (idx !== -1) { statusColIdx = idx + 1; break; }
    }
    
    if (statusColIdx === -1) {
       // 如果沒有業務更新欄位，自動在最後新增一欄
       statusColIdx = header.length + 1;
       sheet.getRange(1, statusColIdx).setValue("業務更新");
    }
    
    rowIndices.forEach(function(rIdx) {
      sheet.getRange(rIdx, statusColIdx).setValue(newStatus);
    });
    
    return { success: true, msg: "已更新 " + rowIndices.length + " 筆資料狀態為: " + newStatus };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📝 建立新的保留單記錄
 * @param {Object} payload { customerName, salesperson, caseName, date, items, note, hasDeposit }
 * items: Array of { sku, qty }
 */
function createReservation(payload) {
  try {
    var ss = null;
    if (CONFIG.RESERVE_SS_ID) {
      try { ss = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID); } catch(e) { console.warn("無法開啟預約單試算表:", e); }
    }
    if (!ss) ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
    if (!sheet) throw new Error("找不到保留單工作表 [" + (CONFIG.SHEET_NAME_RESERVE || "保留單") + "]");
    
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    // 頂級對位函式
    var c = function(targets) {
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        var idx = header.indexOf(t);
        if (idx !== -1) return idx;
      }
      for (var j = 0; j < header.length; j++) {
        var h = String(header[j] || "").trim();
        for (var k = 0; k < targets.length; k++) {
          if (h.indexOf(targets[k]) !== -1) return j;
        }
      }
      return -1;
    };

    var idx = {
      sku:    c(['編號', '產品編號']),
      qty:    c(['保留數量', '數量', '片數']),
      date:   c(['保留日期', '日期']),
      cust:   c(['客戶', '公司']),
      biz:    c(['業務', '負責業務']),
      case:   c(['案名', '工程名稱']),
      addr:   c(['工地', '地址']),
      deposit:c(['訂金確認', '是否付訂']),
      status: c(['業務更新', '處理進度', '狀態', '進度']),
      note:   header.indexOf('備註')
    };
    
    var now = new Date();
    var dateObj = payload.date ? new Date(payload.date) : now;
    var dateStr = Utilities.formatDate(dateObj, "GMT+8", "yyyy/MM/dd");
    
    var newRows = [];
    payload.items.forEach(function(item) {
      var newRow = new Array(header.length).fill("");
      if (idx.cust !== -1) newRow[idx.cust] = payload.customerName;
      if (idx.sku !== -1) newRow[idx.sku] = String(item.sku).trim().toUpperCase();
      if (idx.qty !== -1) newRow[idx.qty] = parseFloat(item.qty) || 0;
      if (idx.date !== -1) newRow[idx.date] = dateStr;
      if (idx.biz !== -1) newRow[idx.biz] = payload.salesperson || "系統";
      if (idx.case !== -1) newRow[idx.case] = payload.caseName || "其他項目";
      if (idx.addr !== -1) newRow[idx.addr] = payload.addr || "";
      if (idx.status !== -1) newRow[idx.status] = "保留中";
      if (idx.deposit !== -1) newRow[idx.deposit] = payload.hasDeposit ? "已付訂" : "未付訂";
      if (idx.note !== -1) newRow[idx.note] = payload.note || "";
      
      newRows.push(newRow);
    });
    
    if (newRows.length > 0) {
      sheet.insertRowsBefore(2, newRows.length);
      sheet.getRange(2, 1, newRows.length, header.length).setValues(newRows);
    }
    
    // 📝 寫入工作日誌
    try {
      var itemSummary = payload.items.map(function(i) { return i.sku + " (" + i.qty + "片)"; }).join(", ");
      saveWorkLog({
        employeeName: payload.salesperson || "系統",
        customerName: payload.customerName,
        result: "業務更新",
        content: "新建保留單: [" + (payload.caseName || "其他項目") + "] " + itemSummary,
        gps: ""
      });
    } catch (e) {
      console.warn("工作日誌寫入失敗:", e);
    }
    
    // 清除快取以確保資料即時性
    var cleanCust = mergeCustomer(payload.customerName);
    CacheService.getUserCache().remove("CUSTOMER_DISPLAYS_" + cleanCust);
    CacheService.getScriptCache().remove("inv_full_v3");
    
    return { 
      success: true, 
      msg: "已成功建立保留單！共 " + payload.items.length + " 個品項，可用庫存已動態扣減。" 
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🕛 自動排程引擎：釋出過期未付訂之保留單 (7天限制)
 * 每日凌晨執行，掃描「高雅瓷保留」中狀態為「保留中」且「未付訂」的項目，
 * 若保留日期超過 7 天，自動變更狀態為「已過期釋出」，並寫入系統工作日誌。
 */
function jobAutoExpireReservations() {
  try {
    var ss = null;
    if (CONFIG.RESERVE_SS_ID) {
      try { ss = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID); } catch(e) { console.warn("無法開啟預約單試算表:", e); }
    }
    if (!ss) ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
    if (!sheet) throw new Error("找不到保留單工作表 [" + (CONFIG.SHEET_NAME_RESERVE || "保留單") + "]");
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      console.log("保留單為空，無需執行釋出作業。");
      return { success: true, count: 0 };
    }
    
    var header = data[0];
    // 頂級對位
    var c = function(targets) {
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        var idx = header.indexOf(t);
        if (idx !== -1) return idx;
      }
      for (var j = 0; j < header.length; j++) {
        var h = String(header[j] || "").trim();
        for (var k = 0; k < targets.length; k++) {
          if (h.indexOf(targets[k]) !== -1) return j;
        }
      }
      return -1;
    };

    var idx = {
      sku:    c(['編號', '產品編號']),
      qty:    c(['保留數量', '數量', '片數']),
      date:   c(['保留日期', '日期']),
      cust:   c(['客戶', '公司']),
      biz:    c(['業務', '負責業務']),
      case:   c(['案名', '工程名稱']),
      deposit:c(['訂金確認', '是否付訂']),
      status: c(['業務更新', '處理進度', '狀態', '進度'])
    };
    
    if (idx.date === -1 || idx.status === -1) {
      throw new Error("無法定位保留日期或處理狀態欄位，自動釋出作業中止。");
    }
    
    var today = new Date();
    var MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
    var expireLimitDays = 7;
    var expiredCount = 0;
    
    for (var i = 1; i < data.length; i++) {
      var status = String(data[i][idx.status] || '').trim();
      var deposit = idx.deposit !== -1 ? String(data[i][idx.deposit] || '').trim() : '';
      
      // 僅處理「保留中」且「未付訂」的保留單
      if (status === "保留中" && deposit !== "已付訂") {
        var dateVal = data[i][idx.date];
        if (!dateVal) continue;
        
        var dateObj = new Date(dateVal);
        if (isNaN(dateObj.getTime())) continue;
        
        var diffTime = today.getTime() - dateObj.getTime();
        var diffDays = Math.floor(diffTime / MILLIS_PER_DAY);
        
        if (diffDays >= expireLimitDays) {
          sheet.getRange(i + 1, idx.status + 1).setValue("已過期釋出");
          expiredCount++;
          
          var sku = idx.sku !== -1 ? String(data[i][idx.sku] || '') : '';
          var qty = idx.qty !== -1 ? String(data[i][idx.qty] || '') : '';
          var cust = idx.cust !== -1 ? String(data[i][idx.cust] || '') : '';
          var biz = idx.biz !== -1 ? String(data[i][idx.biz] || '') : '系統';
          var caseName = idx.case !== -1 ? String(data[i][idx.case] || '') : '';
          
          // 📝 寫入工作日誌
          try {
            saveWorkLog({
              employeeName: "系統排程",
              customerName: getCustomerShortName(cust) || cust,
              result: "自動過期",
              content: "自動釋出過期保留單(已留" + diffDays + "天且未付訂): [" + caseName + "] " + sku + " (" + qty + "片)",
              gps: ""
            });
          } catch(logErr) {
            console.warn("系統排程日誌寫入失敗:", logErr);
          }
        }
      }
    }
    
    // 清除快取
    CacheService.getScriptCache().remove("inv_full_v3");
    
    console.log("辦公室排程：過期保留自動釋出掃描完成。");
    return { success: true, count: expiredCount };
  } catch (e) {
    console.error("排程執行失敗:", e.toString());
    return { success: false, error: e.toString() };
  }
}

