/**
 * 💎 客戶端專屬庫存與圖檔查詢邏輯
 */

/**
 * 🔍 客戶專用查詢函式 (權限分流版)
 */
/**
 * 🚀 直接呼叫原始庫存查詢引擎 (100% 一模一樣)
 */
function getClientFullData() {
  // 直接調用 Inventory.gs 中的核心函式
  return getAggregatedInventory();
}


/**
 * 🔒 客戶坪數檢查 (不顯示具體庫存，僅顯示結果並記錄 Log)
 */
function checkClientStock(sku, requiredPyeong, userId, userName) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const stockSheet = ss.getSheetByName("庫存表");
    const stockData = stockSheet.getDataRange().getValues();
    const sh = stockData[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    
    const sIdx = {
      sku: findHeaderIndex(sh, ["品碼", "編號"]),
      total: findHeaderIndex(sh, ["帳上庫存"]),
      reserve: findHeaderIndex(sh, ["保留庫存"])
    };

    const targetSku = String(sku).toUpperCase().replace(/[\s\-]/g, '');
    let available = 0;
    
    for (let i = 1; i < stockData.length; i++) {
      const rowSku = String(stockData[i][sIdx.sku]).toUpperCase().replace(/[\s\-]/g, '');
      if (rowSku === targetSku) {
        available = (parseFloat(stockData[i][sIdx.total]) || 0) - (parseFloat(stockData[i][sIdx.reserve]) || 0);
        break;
      }
    }

    const isSufficient = available >= parseFloat(requiredPyeong);
    const resultMsg = isSufficient ? "庫存充足" : "庫存不足";
    
    // 📝 寫入日誌 (調用機器人的 writeLog 格式或自訂)
    const logSheet = ss.getSheetByName("log") || ss.getSheetByName("智能_工作日誌");
    if (logSheet) {
      logSheet.appendRow([
        new Date(),
        "WEB_CLIENT",
        userId || "Unknown",
        userName || "客戶",
        "FREE",
        `查詢庫存: ${sku} (${requiredPyeong}坪)`,
        `結果: ${resultMsg} (實際可用: ${available})`,
        ""
      ]);
    }

    return { 
      success: true, 
      isSufficient: isSufficient, 
      msg: isSufficient ? "🟢 庫存數量充足" : "🟡 庫存數量不足，請聯繫業務確認到貨時間" 
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🛡️ 驗證客戶權限 (對接白名單)
 */
function verifyClientMember(userId) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const wlSheet = ss.getSheetByName("白名單");
    if (!wlSheet) return { success: false, msg: "找不到白名單" };
    
    const data = wlSheet.getDataRange().getValues();
    const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
    const idx = {
      uid: findHeaderIndex(h, ["USERID", "LINEID"]),
      name: findHeaderIndex(h, ["名字", "姓名"]),
      level: findHeaderIndex(h, ["等級"]),
      company: findHeaderIndex(h, ["公司", "客戶"])
    };

    const user = data.find(r => String(r[idx.uid]).trim() === String(userId).trim());
    
    if (!user) {
      return { 
        success: true, 
        isAuthorized: false, 
        msg: "未報到成員", 
        detail: "請先向業務申請權限或在 LINE 機器人輸入「報到」" 
      };
    }

    return {
      success: true,
      isAuthorized: true,
      name: user[idx.name],
      level: String(user[idx.level]).toLowerCase(),
      company: user[idx.company]
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🖼️ 輔助：轉換 Google Drive 連結為可顯示圖片 (強化對齊機器人邏輯)
 */
function getDriveImageUrl(url, formula) {
  let s = String(url || "").trim();
  let fileId = "";

  // 1. 優先從公式中抓取 (處理 IMAGE 函數)
  if (formula && formula.toUpperCase().includes("IMAGE(")) {
    const match = formula.match(/"(https?:\/\/[^"]+)"/i) || formula.match(/'(https?:\/\/[^']+)'/i);
    if (match) s = match[1];
  }

  // 2. 處理各種連結格式
  if (s.includes("id=")) {
    const m = s.match(/id=([\w-]+)/);
    if (m) fileId = m[1];
  } else if (s.includes("/d/")) {
    const m = s.match(/\/d\/([\w-]+)/);
    if (m) fileId = m[1];
  } else if (s.includes("drive.google.com")) {
    const m = s.match(/[\w-]{25,}/);
    if (m) fileId = m[0];
  }

  if (fileId) {
    return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1000";
  }
  
  return s.startsWith("http") ? s : "";
}

/**
 * 📝 記錄外部客戶/遊客的庫存查詢行為至內部業務表單的 LOG 中，並執行分級查詢次數限制 (自動對位名稱、公司與負責業務)
 */
function logExternalClientSearch(sku, pyeong, result, userId, level, clientNamePassed, clientCompanyPassed) {
  try {
    userId = String(userId || 'GUEST_CLIENT').trim();
    level = String(level || 'LEVEL 2').toUpperCase().trim();
    
    // 🔍 優先使用傳入的姓名與公司，否則從白名單中查找
    let clientName = clientNamePassed || userId.replace("DIRECT_", "");
    let clientCompany = clientCompanyPassed || "未知公司";
    
    if (!clientNamePassed || !clientCompanyPassed) {
      try {
        const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
        const wlSheet = ss.getSheetByName("白名單");
        if (wlSheet) {
          const data = wlSheet.getDataRange().getValues();
          const h = data[0].map(v => String(v || '').replace(/[\s\uFEFF]/g, '').trim());
          const idx = {
            uid: findHeaderIndex(h, ["USERID", "LINEID"]),
            name: findHeaderIndex(h, ["名字", "姓名"]),
            company: findHeaderIndex(h, ["公司", "客戶"]),
            key: findHeaderIndex(h, ["金鑰", "安全金鑰", "KEY"])
          };
          
          const searchName = userId.replace("DIRECT_", "").trim();
          const userRow = data.find(r => 
            (idx.name !== -1 && String(r[idx.name]).trim() === searchName) ||
            (idx.uid !== -1 && String(r[idx.uid]).trim() === userId) ||
            (idx.key !== -1 && String(r[idx.key]).trim() === userId)
          );
          
          if (userRow) {
            clientName = idx.name !== -1 ? String(userRow[idx.name]).trim() : clientName;
            clientCompany = idx.company !== -1 ? String(userRow[idx.company]).trim() : clientCompany;
          }
        }
      } catch(err) {
        console.warn("後端自動尋找客戶資訊失敗:", err);
      }
    }
    
    // 格式化寫入日誌的操作人欄位
    let operatorStr = userId;
    if (clientName && clientName.indexOf("GUEST") === -1) {
      operatorStr = `${clientName} (${clientCompany})`;
    }
    
    // VIP 等級不限制查詢次數，直接記錄並回傳成功
    if (level === 'VIP') {
      writeSearchLog_(sku, pyeong, result, operatorStr, level);
      return { success: true };
    }
    
    const maxLimit = (level === 'LEVEL 1') ? 20 : 10;
    
    const cache = CacheService.getScriptCache();
    const cacheKey = "SEARCH_LIMIT_" + userId;
    const currentCount = parseInt(cache.get(cacheKey) || "0") + 1;
    
    if (currentCount > maxLimit) {
      return { success: false, exceeded: true, limit: maxLimit, level: level, msg: `已達每小時查詢上限 (${maxLimit} 次)！` };
    }
    
    // 儲存至 Cache (生命週期 1 小時)
    cache.put(cacheKey, String(currentCount), 3600);
    
    writeSearchLog_(sku, pyeong, result, operatorStr, level);
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function writeSearchLog_(sku, pyeong, result, operatorStr, level) {
  const ss = SpreadsheetApp.openById("1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0"); // 業務表單
  let logSheet = ss.getSheetByName("LOG");
  if (!logSheet) {
    logSheet = ss.insertSheet("LOG");
    logSheet.appendRow(["操作時間", "功能代碼", "類別", "操作人", "身分等級", "詳細內容", "執行備註"]);
    logSheet.getRange("A1:G1").setFontWeight("bold").setBackground("#1f2937").setFontColor("#facc15").setHorizontalAlignment("center");
    logSheet.setFrozenRows(1);
    logSheet.autoResizeColumns(1, 7);
  }
  
  const unitStr = (String(pyeong).indexOf("坪") !== -1 || String(pyeong).indexOf("片") !== -1) ? pyeong : pyeong + " 坪";
  
  logSheet.appendRow([
    new Date(),
    "EXTERNAL_CLIENT_SEARCH",
    "CLIENT_ACCESS",
    operatorStr,
    level,
    `外部客戶查詢庫存: ${sku} (${unitStr})`,
    `查詢結果: ${result}`
  ]);
}
