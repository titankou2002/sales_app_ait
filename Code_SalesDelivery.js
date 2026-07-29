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

const LOGISTICS_SS_ID = getScriptPropOrDefault_('LOGISTICS_SS_ID', '1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA');
const DELIVERY_FOLDER_ID = getScriptPropOrDefault_('DELIVERY_FOLDER_ID', '1hbNDk90bax55PFjdCSCzGTPTCGy8ztwn');

/**
 * 抓取專屬於該業務的配送清單
 * @param {string} salesName 目前登入的業務姓名
 * @param {string} targetDateStr 指定日期 (yyyy/MM/dd)，若不傳則預設今日
 */
function getSalesDeliveryTasks(salesName, targetDateStr) {
  try {
    if (!salesName) return { success: false, msg: "未傳入業務姓名" };
    
    var now = new Date();
    var todayStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd");
    var filterDateStr = targetDateStr || todayStr;
    
    var ss = SpreadsheetApp.openById(LOGISTICS_SS_ID);
    var sheet = ss.getSheetByName("業務配送清單");
    if (!sheet) return { success: false, msg: "找不到業務配送清單" };
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };
    
    var headers = data[0].map(function(v){ return String(v).trim(); });
    
    function findCol(keyArr) {
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i].toLowerCase();
        for (var k = 0; k < keyArr.length; k++) {
          if (h.indexOf(keyArr[k].toLowerCase()) !== -1) return i;
        }
      }
      return -1;
    }
    
    // 🚀 [新增] 預加載撿貨明細映射圖表
    var pickingMap = _loadAllPickingItemsMap(ss);
    
    // 依照您的試算表欄位精準讀取
    var idx = {
      handler: findCol(["派遣司機", "司機", "業務員"]), 
      id: findCol(["單號", "編號"]),
      customer: findCol(["客戶", "名稱"]),
      address: findCol(["地址", "地點"]),
      status: findCol(["狀態"]),
      note: findCol(["備註"]),
      weight: findCol(["重量"]),
      thumbnail: findCol(["貨單縮圖", "縮圖", "照片"]),
      phone: findCol(["電話", "手機"]),
      shippingType: findCol(["配送方式", "任務類型", "類型"]),
      finishTime: findCol(["完成時間", "配送完成時間", "結案時間"]),
      date: findCol(["日期"])
    };

    var results = [];
    for (var i = 1; i < data.length; i++) {
      // 1. 📌 關鍵過濾：比對「派遣司機」是否就是登入者！
      var rowHandler = idx.handler !== -1 ? String(data[i][idx.handler] || "").trim() : "";
      if (rowHandler !== salesName.trim()) continue;
      
      var status = idx.status !== -1 ? String(data[i][idx.status]).trim() : "";
      var isFinished = (status === "已完成" || status === "結案" || status === "退貨完成");
      
      var rawDate = idx.date !== -1 ? data[i][idx.date] : "";
      var dateStr = "";
      if (rawDate) {
        try {
          var dObj = new Date(rawDate);
          if (!isNaN(dObj.getTime())) {
             dateStr = Utilities.formatDate(dObj, "GMT+8", "yyyy/MM/dd");
          } else { dateStr = String(rawDate); }
        } catch(e) { dateStr = String(rawDate); }
      }
      
      // 🕒 獲取結案完成日期，用來補強判定
      var fRaw = idx.finishTime !== -1 ? data[i][idx.finishTime] : "";
      var fDateStr = "";
      if (fRaw) {
        try {
          var fObj = new Date(fRaw);
          if (!isNaN(fObj.getTime())) {
            fDateStr = Utilities.formatDate(fObj, "GMT+8", "yyyy/MM/dd");
          }
        } catch(e) {}
      }
      
      // 🚀 [核心過濾邏輯]
      // 1. 如果任務日期符合 filterDateStr，不論是否結案都顯示 (除非它是別天的結案)
      // 2. 如果任務是今天結案的 (fDateStr === todayStr)，為了讓業務看到「已完成」印章，也顯示
      
      var shouldShow = false;
      if (dateStr === filterDateStr) {
        shouldShow = true;
      } else if (fDateStr === todayStr) {
        // 即使任務日期不是目標日期，但如果是今天才結案的，在「今日」視圖中也要出現
        if (filterDateStr === todayStr) shouldShow = true;
      }
      
      if (!shouldShow) continue;
      
      var typeRaw = idx.shippingType !== -1 ? String(data[i][idx.shippingType] || "") : "";
      var customerStr = idx.customer !== -1 ? String(data[i][idx.customer] || "") : "";
      var noteStr = idx.note !== -1 ? String(data[i][idx.note] || "") : "";
      
      // 🧠 智慧判定：優先順序 門市/入店 > 樣品 > 退貨 > 配送
      var scanStr = (customerStr + "|" + noteStr + "|" + typeRaw).toLowerCase();
      var finalType = "送貨"; // 預設
      
      if (scanStr.indexOf("入店") !== -1 || scanStr.indexOf("門市") !== -1) {
        finalType = "入店";
      } else if (scanStr.indexOf("樣品") !== -1) {
        finalType = "樣品";
      } else if (scanStr.indexOf("退貨") !== -1) {
        finalType = "退貨";
      } else if (typeRaw && typeRaw.trim() !== "") {
        finalType = typeRaw;
      }
      
      // 🧩 [新增] 關聯抓取撿貨明細 (用單號 id 當 Key)
      var taskId = String(data[i][idx.id] || "").trim();
      var itemsList = pickingMap[taskId] || [];
      
      // 💡 [修補] 若查無資料，自動嘗試反轉比對或模糊比對
      if (itemsList.length === 0) {
        // A. 反轉比對 (因總表為 123-高，物流表可能存 高-123)
        if (taskId.indexOf("-") !== -1) {
          var parts = taskId.split("-");
          if (parts.length === 2) {
            var altKey = parts[1].trim() + "-" + parts[0].trim();
            if (pickingMap[altKey]) itemsList = pickingMap[altKey];
          }
        }
        
        // B. 模糊比對 (若單號是 12345，撿貨明細是 公司-12345-業務)
        if (itemsList.length === 0 && taskId.length >= 5) {
          var allKeys = Object.keys(pickingMap);
          for (var k = 0; k < allKeys.length; k++) {
            var pKey = allKeys[k];
            if (pKey.indexOf(taskId) !== -1 || taskId.indexOf(pKey) !== -1) {
              itemsList = pickingMap[pKey];
              break; 
            }
          }
        }
      }

      results.push({
        rowIdx: i + 1,
        id: taskId,
        customer: customerStr,
        address: idx.address !== -1 ? String(data[i][idx.address]) : "",
        status: status || "待指派",
        note: noteStr,
        weight: idx.weight !== -1 ? String(data[i][idx.weight]) : "0",
        thumbnail: idx.thumbnail !== -1 ? String(data[i][idx.thumbnail] || "") : "",
        phone: idx.phone !== -1 ? String(data[i][idx.phone] || "") : "",
        shippingType: finalType,
        date: dateStr,
        items: itemsList,
        isFinished: isFinished,
        finishTime: fRaw ? Utilities.formatDate(new Date(fRaw), "GMT+8", "HH:mm") : ""
      });
    }
    
    return { success: true, data: results };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 私有輔助：從「撿貨明細」分頁建立子表項目的快速檢索映射圖
 */
function _loadAllPickingItemsMap(ss) {
  try {
    var sheet = ss.getSheetByName("撿貨明細");
    if (!sheet) return {};
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return {};
    
    // 讀取最近 2000 筆，效能最佳化且涵蓋當前區間
    var readStart = Math.max(2, lastRow - 1999);
    var readRows = lastRow - readStart + 1;
    var data = sheet.getRange(readStart, 1, readRows, Math.min(sheet.getLastColumn(), 10)).getValues();
    
    var map = {};
    for (var i = 0; i < data.length; i++) {
      var key = String(data[i][0]).trim(); // 單號KEY
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push({
        code: String(data[i][2] || "").trim(), // 產品編號
        qty: String(data[i][3] || "").trim(),  // 片數
        name: String(data[i][6] || "").trim()  // 中文系列
      });
    }
    return map;
  } catch(e) { 
    console.error("Loading picking map failed: " + e);
    return {}; 
  }
}

/**
 * 輕量化任務計數器 (供 Dashboard Badge 使用)
 */
function getSalesDeliveryTaskCount(salesName) {
  try {
    if (!salesName) return 0;
    var res = getSalesDeliveryTasks(salesName);
    if (res && res.success && Array.isArray(res.data)) {
      // 🔔 關鍵修整：首頁徽章指針只算「未完成」的數量！
      var count = res.data.filter(function(t){
        return t.status !== "已完成" && t.status !== "結案" && t.status !== "退貨完成";
      }).length;
      return count;
    }
    return 0;
  } catch(e) { return 0; }
}

/**
 * 更換任務負責業務 (轉派單據)
 */
function transferSalesDeliveryTask(rowIdx, newSalesName) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(15000)) return { success: false, msg: "系統正在忙碌，請稍候再試" };
    if (!rowIdx || !newSalesName) return { success: false, msg: "資料不齊全" };
    
    var ss = SpreadsheetApp.openById(LOGISTICS_SS_ID);
    var sheet = ss.getSheetByName("業務配送清單");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(v){ return String(v).trim(); });
    
    function findCol(keyArr) {
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i].toLowerCase();
        for (var k = 0; k < keyArr.length; k++) {
          if (h.indexOf(keyArr[k].toLowerCase()) !== -1) return i + 1;
        }
      }
      return -1;
    }
    
    var colIdx = findCol(["派遣司機", "司機", "業務員"]);
    if (colIdx === -1) return { success: false, msg: "找不到白名單人員對應欄位" };
    
    // 直接寫入新的承接業務姓名
    sheet.getRange(parseInt(rowIdx), colIdx).setValue(newSalesName);
    
    return { success: true, msg: "成功轉派" };
  } catch (e) {
    return { success: false, msg: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 上傳完工照並完成任務
 */
function completeSalesDeliveryTask(rowIdx, imageData, reportNote, isDamaged) {
  try {
    var ss = SpreadsheetApp.openById(LOGISTICS_SS_ID);
    var sheet = ss.getSheetByName("業務配送清單");
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function(v){ return String(v).trim(); });
    
    function findCol(keyArr) {
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i].toLowerCase();
        for (var k = 0; k < keyArr.length; k++) {
          if (h.indexOf(keyArr[k].toLowerCase()) !== -1) return i;
        }
      }
      return -1;
    }
    
    var colStatus = findCol(["狀態"]);
    var colFinish = findCol(["完成時間", "結案時間", "配送完成時間"]);
    var colThumb = findCol(["貨單縮圖", "縮圖", "照片"]);
    
    // 用來寫日誌的背景欄位讀取
    var cOrder = findCol(["單號"]), cCust = findCol(["客戶"]), cAddr = findCol(["地址"]), cNote = findCol(["備註"]), cDrv = findCol(["派遣司機", "司機"]), cVeh = findCol(["車牌"]);
    var dataRow = sheet.getRange(rowIdx, 1, 1, Math.max(1, headers.length)).getValues()[0];

    var fileUrl = "";
    if (imageData && imageData.base64) {
      var folder = _getSafeFolder();
      var blob = Utilities.newBlob(Utilities.base64Decode(imageData.base64), imageData.mimeType, "DELIVERY_OK_" + Date.now() + ".jpg");
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileUrl = file.getUrl();
    }
    
    var nowStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd HH:mm");
    if (colStatus !== -1) sheet.getRange(rowIdx, colStatus + 1).setValue("已完成");
    if (colFinish !== -1) sheet.getRange(rowIdx, colFinish + 1).setValue(nowStr);
    if (colThumb !== -1 && fileUrl) sheet.getRange(rowIdx, colThumb + 1).setValue(fileUrl);
    
    var finalNote = (reportNote || "") || (cNote !== -1 ? String(dataRow[cNote]) : "");
    var customerName = cCust !== -1 ? String(dataRow[cCust]) : "";
    var address = cAddr !== -1 ? String(dataRow[cAddr]) : "";
    var driver = cDrv !== -1 ? String(dataRow[cDrv]) : "";
    var orderId = cOrder !== -1 ? String(dataRow[cOrder]) : "";
    
    // 📝 [自動寫入工作日誌]
    _writeToLogSheet(ss, {
      driver: driver,
      car: cVeh !== -1 ? String(dataRow[cVeh]) : "業務自送",
      orderId: orderId,
      customer: customerName,
      address: address,
      note: finalNote,
      photo: fileUrl,
      isDamaged: isDamaged ? "是" : "否"
    });

    // 🚀 [新增] 寫入業務個人工作日誌 (以便在全知視角顯示)
    try {
      if (typeof saveWorkLog === 'function') {
        saveWorkLog({
          employeeName: driver,
          customerName: getCustomerShortName(customerName) || customerName,
          result: "配送完工",
          content: "單號:" + orderId + " / 備註:" + (reportNote || "無") + (isDamaged ? " / ⚠️貨損通報" : ""),
          gps: ""
        });
      }
    } catch(e) { console.warn("WorkLogSyncErr:", e); }

    // 🚀 [新增] LINE 通知
    try {
      var lineMsg = "\n✅ 配送完成通知\n";
      lineMsg += "👤 業務：" + driver + "\n";
      lineMsg += "🏢 客戶：" + customerName + "\n";
      lineMsg += "📍 地址：" + address + "\n";
      lineMsg += "🔢 單號：" + orderId + "\n";
      lineMsg += "⏰ 時間：" + nowStr.split(' ')[1] + "\n";
      if (isDamaged) lineMsg += "⚠️ 狀態：【貨物破損報修】\n";
      if (reportNote) lineMsg += "📝 備註：" + reportNote + "\n";
      if (fileUrl) lineMsg += "🖼️ 照片：" + fileUrl;
      
      _sendLineNotify_Sales(lineMsg, fileUrl);
    } catch(e) { console.warn("LineNotifyErr:", e); }

    return { success: true, msg: "已回報完成" };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * ⚡ 樣品快速打勾結案 (不需拍照，直接結案並寫入日誌)
 */
function completeSampleTask(rowIdx) {
  try {
    var ss = SpreadsheetApp.openById(LOGISTICS_SS_ID);
    var sheet = ss.getSheetByName("業務配送清單");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(v){ return String(v).trim(); });
    
    function findCol(keyArr) {
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i].toLowerCase();
        for (var k = 0; k < keyArr.length; k++) {
          if (h.indexOf(keyArr[k].toLowerCase()) !== -1) return i;
        }
      }
      return -1;
    }
    
    var colStatus = findCol(["狀態"]), colFinish = findCol(["完成時間", "配送完成時間"]);
    var cOrder = findCol(["單號"]), cCust = findCol(["客戶"]), cAddr = findCol(["地址"]), cNote = findCol(["備註"]), cDrv = findCol(["派遣司機", "司機"]), cVeh = findCol(["車牌"]);
    
    var dataRow = sheet.getRange(rowIdx, 1, 1, Math.max(1, headers.length)).getValues()[0];
    var nowStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd HH:mm");
    
    if (colStatus !== -1) sheet.getRange(rowIdx, colStatus + 1).setValue("已完成");
    if (colFinish !== -1) sheet.getRange(rowIdx, colFinish + 1).setValue(nowStr);
    
    // 📝 [自動寫入工作日誌]
    var driver = cDrv !== -1 ? String(dataRow[cDrv]) : "";
    var customerName = cCust !== -1 ? String(dataRow[cCust]) : "";
    var orderId = cOrder !== -1 ? String(dataRow[cOrder]) : "";

    _writeToLogSheet(ss, {
      driver: driver,
      car: cVeh !== -1 ? String(dataRow[cVeh]) : "業務自送",
      orderId: orderId,
      customer: customerName,
      address: cAddr !== -1 ? String(dataRow[cAddr]) : "",
      note: "[樣品打勾結案] " + (cNote !== -1 ? String(dataRow[cNote]) : ""),
      photo: ""
    });

    // 🚀 [新增] 寫入業務個人工作日誌
    try {
      if (typeof saveWorkLog === 'function') {
        saveWorkLog({
          employeeName: driver,
          customerName: getCustomerShortName(customerName) || customerName,
          result: "樣品結案",
          content: "單號:" + orderId + " (手機端快速結案)",
          gps: ""
        });
      }
    } catch(e) { console.warn("WorkLogSyncErr:", e); }
    
    return { success: true, msg: "已完成樣品結案" };
  } catch (e) { return { success: false, msg: e.toString() }; }
}

/**
 * 內部函式：標準化寫入「送貨日誌」表格
 */
function _writeToLogSheet(ss, logData) {
  try {
    var logSheet = ss.getSheetByName("送貨日誌");
    if (!logSheet) return;
    var logH = logSheet.getRange(1, 1, 1, Math.max(1, logSheet.getLastColumn())).getValues()[0].map(function(v){ return String(v).trim(); });
    var logRow = new Array(logH.length).fill("");
    var setLog = function(name, val) { 
      var p = logH.indexOf(name); 
      if (p >= 0) logRow[p] = val; 
    };
    
    setLog("司機", logData.driver);
    setLog("車牌號碼", logData.car || "業務自送");
    setLog("單號", logData.orderId);
    setLog("客戶名稱", logData.customer);
    setLog("送貨地址", logData.address);
    setLog("配送完成時間", Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd HH:mm"));
    setLog("備註", "[業務配送App] " + (logData.note || ""));
    setLog("貨物破損", logData.isDamaged || "否");
    setLog("簽收單照片", logData.photo || "");
    
    logSheet.appendRow(logRow);
  } catch (e) {
    console.error("WriteLog Error: " + e);
  }
}

/**
 * 🏆 核心分析：統計業務配送獎金與歷史
 * 規則：每天第 2 個點起，每個點 50 元 (即：當日配送點數 - 1) * 50
 */
function getDeliveryBonusData(yearParam) {
  try {
    var ss = SpreadsheetApp.openById(LOGISTICS_SS_ID);
    var sheet = ss.getSheetByName("業務配送清單");
    if (!sheet) return { success: false, msg: "找不到業務配送清單" };
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: {} };
    
    var h = data[0].map(function(v){ return String(v).trim(); });
    
    function findCol(keys) {
      for(var i=0;i<h.length;i++){
        var col = h[i].toLowerCase();
        for(var k=0;k<keys.length;k++){
          if(col.indexOf(keys[k].toLowerCase()) !== -1) return i;
        }
      }
      return -1;
    }
    
    var idx = {
      date: findCol(["日期"]),
      driver: findCol(["派遣司機", "司機"]),
      status: findCol(["狀態"]),
      addr: findCol(["地址", "地點"]),
      cust: findCol(["客戶", "名稱"]),
      id: findCol(["單號", "id"])
    };
    
    // 🧩 [新增] 抓取撿貨明細對照表
    var pickingMap = {};
    try {
      var pickingSheet = ss.getSheetByName("撿貨明細");
      if (pickingSheet) {
        var pData = pickingSheet.getDataRange().getValues();
        var pH = pData[0].map(function(v){ return String(v).trim(); });
        var pIdIdx = -1, pCodeIdx = -1, pQtyIdx = -1;
        for(var k=0;k<pH.length;k++){
          if(pH[k].indexOf("單號")!==-1) pIdIdx=k;
          if(pH[k].indexOf("編號")!==-1) pCodeIdx=k;
          if(pH[k].indexOf("數量")!==-1) pQtyIdx=k;
        }
        if (pIdIdx!==-1 && pCodeIdx!==-1) {
          for(var j=1;j<pData.length;j++){
            var pId = String(pData[j][pIdIdx]).trim();
            if(!pickingMap[pId]) pickingMap[pId]=[];
            pickingMap[pId].push({ code: String(pData[j][pCodeIdx]), qty: pData[j][pQtyIdx] });
          }
        }
      }
    } catch(e) { console.warn("PickingMapErr:", e); }
    
    var now = new Date();
    var currentYear = yearParam ? parseInt(yearParam) : now.getFullYear();
    
    // 結構：{ 業務名: { 日期: [地址1, 地址2] } }
    var records = {};
    
    for (var i = 1; i < data.length; i++) {
      var status = idx.status !== -1 ? String(data[i][idx.status]).trim() : "";
      // 只統計已完成的紀錄
      if (status !== "已完成") continue;
      
      var name = idx.driver !== -1 ? String(data[i][idx.driver]).trim() : "";
      var rawDate = idx.date !== -1 ? data[i][idx.date] : null;
      var addr = idx.addr !== -1 ? String(data[i][idx.addr]).trim() : "";
      var typeRaw = idx.shippingType !== -1 ? String(data[i][idx.shippingType] || "") : "";
      var customerStr = idx.cust !== -1 ? String(data[i][idx.cust] || "") : "";
      
      if (!name || !rawDate) continue;

      // 🧠 [核心邏輯更新] 排除 樣品、門市、入店，不列入獎金計點
      var scanStr = (customerStr + "|" + typeRaw).toLowerCase();
      if (scanStr.indexOf("樣品") !== -1 || scanStr.indexOf("門市") !== -1 || scanStr.indexOf("入店") !== -1) {
         continue; 
      }
      
      // 正規化日期
      var dObj = new Date(rawDate);
      if (isNaN(dObj.getTime())) continue; // 無效日期
      
      // 只統計今年
      if (dObj.getFullYear() !== currentYear) continue;
      
      var dateStr = Utilities.formatDate(dObj, "GMT+8", "yyyy/MM/dd");
      var monthStr = Utilities.formatDate(dObj, "GMT+8", "yyyy/MM");
      
      if (!records[name]) records[name] = {};
      if (!records[name][dateStr]) {
        records[name][dateStr] = {
          month: monthStr,
          points: new Set(), // 用 Set 儲存，自動過濾重複的地址 (同一天同地址算一個點)
          detail: []
        };
      }
      
      // 若地址是空的，就拿客戶名稱當指標，防止遺漏
      var pointKey = addr || String(data[i][idx.cust] || "無名點");
      records[name][dateStr].points.add(pointKey);
      
      var taskId = idx.id !== -1 ? String(data[i][idx.id]).trim() : "";
      var items = pickingMap[taskId] || [];
      // 模糊比對備案
      if (items.length === 0 && taskId.indexOf("-") !== -1) {
         var alt = taskId.split("-")[1].trim() + "-" + taskId.split("-")[0].trim();
         if (pickingMap[alt]) items = pickingMap[alt];
      }

      records[name][dateStr].detail.push({
        customer: String(data[i][idx.cust] || ""),
        address: addr,
        items: items
      });
    }
    
    // 將資料轉換為最後聚合格式
    var aggregated = {};
    
    for (var sales in records) {
      var totalBonus = 0;
      var totalPoints = 0;
      var monthGroups = {};
      
      for (var dayStr in records[sales]) {
        var dayData = records[sales][dayStr];
        var pCount = dayData.points.size; // 實際配送點數 (不重複地址)
        
        // 核心獎金計算：當天第 2 個點起算 (即減 1)，最低 0 元
        var bonus = (pCount > 1) ? (pCount - 1) * 50 : 0;
        
        totalBonus += bonus;
        totalPoints += pCount;
        
        var mKey = dayData.month;
        if (!monthGroups[mKey]) {
          monthGroups[mKey] = { totalBonus: 0, totalPoints: 0, days: [] };
        }
        
        monthGroups[mKey].totalBonus += bonus;
        monthGroups[mKey].totalPoints += pCount;
        monthGroups[mKey].days.push({
          date: dayStr,
          points: pCount,
          bonus: bonus,
          details: dayData.detail
        });
      }
      
      // 排序日誌 (新的日期排前面)
      for (var m in monthGroups) {
        monthGroups[m].days.sort(function(a, b) { return b.date.localeCompare(a.date); });
      }
      
      aggregated[sales] = {
        totalBonus: totalBonus,
        totalPoints: totalPoints,
        months: monthGroups
      };
    }
    
    return { success: true, data: aggregated, year: currentYear };
    
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * LINE Notify 整合模組
 */
function _sendLineNotify_Sales(msg, imgUrl) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_NOTIFY_TOKEN');
  if (!token) {
    console.warn("LINE_NOTIFY_TOKEN 未設定，略過 LINE Notify 發送。");
    return;
  }
  
  var payload = { "message": msg };
  if (imgUrl) {
    // 轉換為直接顯示連結，確保 LINE Notify 能抓到圖片
    var directUrl = imgUrl.replace("view?usp=drivesdk", "view").replace("open?id=", "uc?export=view&id=");
    if (directUrl.indexOf("drive.google.com") !== -1 && directUrl.indexOf("uc?export=view&id=") === -1) {
      var idMatch = directUrl.match(/[-\w]{25,}/);
      if (idMatch) directUrl = "https://drive.google.com/uc?export=view&id=" + idMatch[0];
    }
    payload.imageThumbnail = directUrl;
    payload.imageFullsize = directUrl;
  }
  
  var options = {
    "method": "post",
    "payload": payload,
    "headers": { "Authorization": "Bearer " + token },
    "muteHttpExceptions": true
  };
  UrlFetchApp.fetch("https://notify-api.line.me/api/notify", options);
}

/**
 * 輔助：安全取得存檔資料夾，若預設 ID 失敗則自動建立備援資料夾
 */
function _getSafeFolder() {
  try {
    return DriveApp.getFolderById(DELIVERY_FOLDER_ID);
  } catch (e) {
    var backupName = "業務配送照片備援_" + (new Date().getFullYear());
    var it = DriveApp.getFoldersByName(backupName);
    if (it.hasNext()) return it.next();
    return DriveApp.createFolder(backupName);
  }
}
