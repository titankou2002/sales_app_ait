/**
 * 外勤工作管理系統 - 後端核心 (Field Work Management) 🚀
 * 統一寫入主系統試算表：CONFIG.SS_ID
 */

/**
 * ✂️ 工作日誌存檔用的客戶名稱縮短（保留特殊值「回公司(永安)」原樣）
 */
function fwShortenCustomerForSave_(name) {
  const s = String(name || '').trim();
  if (!s || s === '回公司(永安)') return s;
  return getCustomerShortName(s);
}

const FW_CONFIG = {
  get SS_ID() { return CONFIG.SS_ID; },

  // 📍 公司座標設定
  COMPANY_LOCATION: {
    lat: 25.00048642501761,
    lng: 121.03391437844508
  },
  SAFE_RADIUS: 300, // 允許打卡半徑 (公尺)
  WORK_START_TIME: "08:30", // 上班標準時間

  SHEETS: {
    ATTENDANCE: "智能_打卡紀錄",
    WORKLOG: "智能_工作日誌",
    DRIVING_LOG: "智能_行駛日誌",
    MAINTENANCE: "智能_保養紀錄",
    SETTINGS: "系統設定",
    LEAVE: "外勤_請假報備"
  },

  // 📧 通訊錄設定
  EMAILS: {
    "高弘治": "titankou2002@gmail.com",
    "謝博皓": "sb780910@gmail.com",
    "陳勁多": "ghosts0125@gmail.com",
    "潘右森": "panus081231@gmail.com"
  },
  // 🚀 全知視角預設觀察名單
  OMNISCIENT_LIST: ["高弘治", "謝博皓", "潘右森", "陳勁多"]
};

/**
 * 📅 格式化日期並加上星期 (例如: 2024-05-08 (三))
 */
function formatDateWithDay(date) {
  if (!date) return "--";
  let d = date;
  if (!(d instanceof Date)) {
    d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
  }
  const days = ["(日)", "(一)", "(二)", "(三)", "(四)", "(五)", "(六)"];
  const dateStr = Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd");
  return dateStr + " " + days[d.getDay()];
}

/**
 * 標準化日期欄位值為 yyyy-MM-dd 字串
 */
function fwNormaliseDate_(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
  var s = String(val).trim().split(' ')[0].replace(/\//g, '-');
  if (/^\d+$/.test(s) && s.length > 4) {
    var epoch = new Date(1899, 11, 30);
    return Utilities.formatDate(new Date(epoch.getTime() + parseInt(s) * 86400000), "GMT+8", "yyyy-MM-dd");
  }
  var parts = s.split('-');
  if (parts.length === 3) {
    var y = parts[0], m = parts[1], d = parts[2];
    if (d.length === 4) { y = d; m = parts[0]; d = parts[1]; }
    if (y.length === 2) y = '20' + y;
    return y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
  }
  return s;
}

/**
 * 🚀 取得表單實例 (支援自動建立工作表與標題列)
 */
let _fw_ss_cache = null;
function getFwSs() {
  if (!_fw_ss_cache) {
    _fw_ss_cache = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
  }
  return _fw_ss_cache;
}

function getFwSheet(name) {
  const ss = getFwSs();
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    const headers = {
      // 🚀 重新設計的標題列
      [FW_CONFIG.SHEETS.ATTENDANCE]: ["記錄ID", "業務姓名", "打卡類型", "打卡時間", "日期", "打卡狀態", "備註/距離", "地圖查看", "緯度", "經度", "設備ID", "系統時間"],
      [FW_CONFIG.SHEETS.WORKLOG]: ["日期", "業務姓名", "客戶名稱", "任務摘要", "詳細內容", "GPS資訊", "建立時間", "記錄ID", "線上圖片"],
      [FW_CONFIG.SHEETS.DRIVING_LOG]: ["日期", "業務姓名", "車牌號碼", "開始里程", "結束里程", "行駛距離", "今日行程", "加油公升", "加油金額", "備註", "記錄ID"],
      [FW_CONFIG.SHEETS.MAINTENANCE]: ["保養日期", "業務姓名", "車牌號碼", "本次里程", "下次保養里程", "保養項目", "保養金額", "照片", "備註", "記錄ID"],
      [FW_CONFIG.SHEETS.LEAVE]: ["時間戳記", "人員", "類型", "開始日期", "結束日期", "原因說明", "證明照片", "設備ID"]
    };

    if (headers[name]) {
      sheet.appendRow(headers[name]);
      sheet.getRange(1, 1, 1, headers[name].length)
        .setFontWeight("bold")
        .setBackground("#2c3e50")
        .setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
    // 🔧 自我修復/升級：如果現有試算表欄位數不足，自動校正第一列標題，確保 GPS 等欄位對齊
    try {
      if (sheet.getLastColumn() < headers[name].length) {
        sheet.getRange(1, 1, 1, headers[name].length).setValues([headers[name]])
          .setFontWeight("bold").setBackground("#2c3e50").setFontColor("#ffffff");
      }
    } catch (e) {
      console.warn("標題自動校正跳過:", e);
    }
  } else {
    // 已經存在分頁，同樣進行欄位數比對來確保升級
    try {
      const refHeaders = {
        [FW_CONFIG.SHEETS.WORKLOG]: ["日期", "業務姓名", "客戶名稱", "任務摘要", "詳細內容", "GPS資訊", "建立時間", "記錄ID", "線上圖片"]
      };
      if (refHeaders[name] && sheet.getLastColumn() < refHeaders[name].length) {
        sheet.getRange(1, 1, 1, refHeaders[name].length).setValues([refHeaders[name]])
          .setFontWeight("bold").setBackground("#2c3e50").setFontColor("#ffffff");
      }
    } catch (e) { }
  }
  return sheet;
}

/**
 * 🛠️ 強制更新所有外勤分頁標題 (解決標題錯位問題)
 */
function forceUpdateAllFwHeaders() {
  const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
  const headers = {
    [FW_CONFIG.SHEETS.ATTENDANCE]: ["記錄ID", "業務姓名", "打卡類型", "打卡時間", "日期", "打卡狀態", "備註/距離", "地圖查看", "緯度", "經度", "設備ID", "系統時間"],
    [FW_CONFIG.SHEETS.WORKLOG]: ["日期", "業務姓名", "客戶名稱", "任務摘要", "詳細內容", "GPS資訊", "建立時間", "記錄ID", "線上圖片"],
    [FW_CONFIG.SHEETS.DRIVING_LOG]: ["日期", "業務姓名", "車牌號碼", "開始里程", "結束里程", "行駛距離", "今日行程", "加油公升", "加油金額", "備註", "記錄ID"],
    [FW_CONFIG.SHEETS.MAINTENANCE]: ["保養日期", "業務姓名", "車牌號碼", "本次里程", "下次保養里程", "保養項目", "保養金額", "照片", "備註", "記錄ID"]
  };

  for (let sheetName in headers) {
    let sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      const headerRow = headers[sheetName];
      sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).clearContent();
      sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow])
        .setFontWeight("bold")
        .setBackground("#2c3e50")
        .setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
  }
  return "所有分頁標題已校正完成！";
}

/**
 * 📍 打卡報班 API (重新設計類別版)
 */
function saveAttendance(payload) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.ATTENDANCE);
    const now = new Date();
    const dateStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
    const timeStr = Utilities.formatDate(now, "GMT+8", "HH:mm");

    // 1️⃣ 設備綁定驗證
    const deviceError = checkDeviceBinding(payload.employeeName, payload.deviceId);
    if (deviceError) return { success: false, msg: deviceError };

    // 2️⃣ 取得今日狀態 (判定是否已上班)
    const status = getTodayStatus(payload.employeeName);
    if (payload.type === 'checkout' && !status.checkin) {
      return { success: false, msg: "❌ 尚未進行上班打卡，無法執行下班操作。" };
    }

    // 3️⃣ 地理圍欄判定
    const dist = getDistance(
      payload.location.latitude,
      payload.location.longitude,
      FW_CONFIG.COMPANY_LOCATION.lat,
      FW_CONFIG.COMPANY_LOCATION.lng
    );

    // 🚀 重新設計類別名稱
    let finalType = "";
    if (payload.type === 'checkin') {
      finalType = payload.isBusinessTrip ? "出差上班" : "上班";
    } else {
      finalType = payload.isBusinessTrip ? "出差下班" : "下班";
    }

    let punchStatus = "正常";
    let remark = payload.isBusinessTrip ? "出差模式" : `距離公司 ${Math.round(dist)}m`;

    if (payload.type === 'checkin' && !payload.isBusinessTrip && dist > FW_CONFIG.SAFE_RADIUS) {
      return { success: false, msg: `❌ 超出打卡範圍（目前距離公司 ${Math.round(dist)} 公尺）` };
    }

    // 4️⃣ 遲到判定 (僅上班)
    if (payload.type === 'checkin') {
      if (timeStr > FW_CONFIG.WORK_START_TIME) {
        punchStatus = "遲到";
      }
    }

    const mapLink = `=HYPERLINK("https://www.google.com/maps?q=${payload.location.latitude},${payload.location.longitude}", "點我查看地圖")`;
    const id = "ATT_" + now.getTime();

    // 標題列：["打卡編號", "業務姓名", "打卡類別", "打卡時間", "日期", "打卡狀態", "備註/距離", "地圖查看", "緯度", "經度", "手機編號", "系統寫入時間"]
    const row = [
      id,
      payload.employeeName,
      finalType,
      now,
      dateStr,
      punchStatus,
      remark,
      mapLink,
      payload.location.latitude,
      payload.location.longitude,
      payload.deviceId,
      now
    ];

    sheet.appendRow(row);
    return { success: true, id: id, punchStatus: punchStatus, distance: Math.round(dist), type: finalType };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🔒 設備綁定檢查邏輯 (整合至「系統設定」分頁)
 * E 欄 (4): 業務姓名, F 欄 (5): 手機編號, G 欄 (6): 首次綁定, H 欄 (7): 最後使用
 */
function checkDeviceBinding(name, deviceId) {
  const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
  const sheet = ss.getSheetByName(FW_CONFIG.SHEETS.SETTINGS);
  if (!sheet) return null; // 找不到設定則跳過檢查

  const data = sheet.getDataRange().getValues();
  const now = new Date();

  let userRowIndex = -1;
  let existingDeviceId = "";

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === name) { // E 欄
      userRowIndex = i + 1;
      existingDeviceId = data[i][5]; // F 欄
      break;
    }
  }

  if (userRowIndex === -1) {
    // 首次記錄：找第一個空白行或 append
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 5, 1, 4).setValues([[name, deviceId, now, now]]);
    return null;
  } else {
    // 🚀 已關閉設備綁定檢查限制，允許隨意更換手機
    sheet.getRange(userRowIndex, 8).setValue(now); // 更新 H 欄：最後使用時間 (index 7, column 8)
    if (!existingDeviceId || existingDeviceId !== deviceId) {
      sheet.getRange(userRowIndex, 6).setValue(deviceId); // 更新手機編號
    }
    return null;
  }
}

/**
 * 🔒 原「解除設備綁定」功能已移除，目前系統不限制設備。
 */


/**
 * 📏 Haversine 距離計算 (單位: 公尺)
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 地球半徑
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * 📝 工作日誌 API (欄位順序：日期/業務姓名/客戶名稱/任務/詳細內容/建立時間/記錄ID)
 */
/**
 * 📝 核心存儲邏輯：依據使用者要求「一天每人僅留一列」進行橫向字串串接儲存
 */
function saveWorkLog(payload) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, "GMT+8", "HH:mm");
    const dateStr = payload.date || Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
    const newId = "LOG_" + now.getTime() + "_" + Math.floor(Math.random() * 1000);

    const custToSave = "[" + timeStr + "] " + fwShortenCustomerForSave_(payload.customerName || "未知客戶");
    const taskToSave = "[" + timeStr + "] " + (payload.result || "");
    const descToSave = "[" + timeStr + "] " + (payload.content || "");

    const searchName = String(payload.employeeName || "").trim().replace(/\s/g, '');

    // 用快取記住今日該業務的列號，避免每次掃全表
    const cache = CacheService.getScriptCache();
    const cacheKey = "WORKLOG_ROW_" + searchName + "_" + dateStr;
    const cachedRow = cache.get(cacheKey);
    let existingRowIdx = cachedRow ? parseInt(cachedRow, 10) : -1;

    // 驗證快取的列號是否還正確（只讀一列而非全表）
    if (existingRowIdx > 0) {
      try {
        const checkVal = sheet.getRange(existingRowIdx, 1, 1, 2).getValues()[0];
        const rDate = fwNormaliseDate_(checkVal[0]);
        const rName = String(checkVal[1] || "").trim().replace(/\s/g, '');
        if (rDate !== dateStr || rName !== searchName) existingRowIdx = -1;
      } catch(e) { existingRowIdx = -1; }
    }

    // 快取未命中才掃全表
    if (existingRowIdx === -1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const rDate = fwNormaliseDate_(data[i][0]);
        const rName = String(data[i][1] || "").trim().replace(/\s/g, '');
        if (rDate === dateStr && rName === searchName) {
          existingRowIdx = i + 1;
          break;
        }
      }
    }

    if (existingRowIdx !== -1) {
      const range = sheet.getRange(existingRowIdx, 1, 1, 8);
      const rowData = range.getValues()[0];

      const finalCust = (rowData[2] ? rowData[2] + " || " : "") + custToSave;
      const finalTask = (rowData[3] ? rowData[3] + " || " : "") + taskToSave;
      const finalDesc = (rowData[4] ? rowData[4] + " || " : "") + descToSave;

      range.setValues([[
        dateStr, payload.employeeName, finalCust, finalTask, finalDesc,
        payload.gps || "", now, newId
      ]]);
      cache.put(cacheKey, String(existingRowIdx), 43200);
    } else {
      sheet.appendRow([
        dateStr, payload.employeeName, custToSave, taskToSave, descToSave,
        payload.gps || "", now, newId
      ]);
      cache.put(cacheKey, String(sheet.getLastRow()), 43200);
    }

    // 排序與格式化延後：只在非版面操作的直接呼叫時執行
    if (!payload._skipHeavyOps) {
      // deferred sort: 每 20 次寫入才排序一次
      try {
        var sc = parseInt(cache.get("WORKLOG_SORT_COUNT") || "0", 10);
        sc++;
        cache.put("WORKLOG_SORT_COUNT", String(sc), 21600);
        if (sc >= 20) {
          var lr = sheet.getLastRow();
          if (lr > 1) {
            sheet.getRange(2, 3, lr - 1, 3).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
            sheet.getRange(2, 1, lr - 1, 9).sort([{ column: 1, ascending: false }, { column: 2, ascending: true }]);
          }
          cache.put("WORKLOG_SORT_COUNT", "0", 21600);
        }
      } catch(e) { console.warn("saveWorkLog deferred sort failed:", e); }
      syncTodayRouteToDrivingLog(payload.employeeName, dateStr);
    }

    clearWorkLogCache_(payload.employeeName, dateStr);
    return { success: true, id: newId };
  } catch (e) {
    console.error("saveWorkLog Error:", e);
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📅 取得指定日期的工作日誌（歷史查詢用）
 */
function getWorkLogHistory(employeeName, dateStr) {
  try {
    const searchName = String(employeeName || "").trim().replace(/\s/g, '');

    // 🚀 快取：過去日期 30 分鐘、今天 2 分鐘（寫入時會主動清除）
    const cache = CacheService.getScriptCache();
    const wlhKey = "WLH_" + searchName + "_" + dateStr;
    const cachedWlh = cache.get(wlhKey);
    if (cachedWlh) return JSON.parse(cachedWlh);

    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    // 🚀 兩段式：先只讀「日期+姓名」兩欄定位，再單獨抓命中的列（一天每人僅一列）
    const lastRow = sheet.getLastRow();
    const logs = [];
    if (lastRow > 1) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (let i = 0; i < keys.length; i++) {
        const rowName = String(keys[i][1] || "").trim().replace(/\s/g, '');
        if (rowName !== searchName) continue;
        const rawDate = keys[i][0];
        let rowDate = "";
        if (rawDate instanceof Date) {
          rowDate = Utilities.formatDate(rawDate, "GMT+8", "yyyy-MM-dd");
        } else {
          rowDate = String(rawDate).trim().split(' ')[0].replace(/\//g, '-');
          const parts = rowDate.split('-');
          if (parts.length === 3) {
            rowDate = parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
          }
        }
        if (rowDate !== dateStr) continue;

        const row = sheet.getRange(i + 2, 1, 1, 8).getValues()[0];
        const expanded = parseVisitsFromRow_(row);
        // 注意：為歷史記錄注入 row[6] 的紀錄ID (儘管新制共用一個ID)
        expanded.forEach(x => { x.id = String(row[6] || ""); });
        logs.push(...expanded);
      }
    }

    logs.sort((a, b) => String(a.time).localeCompare(String(b.time)));

    const result = { success: true, logs: logs, date: dateStr };
    const isToday = dateStr === Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
    try { cache.put(wlhKey, JSON.stringify(result), isToday ? 120 : 1800); } catch (e) {}
    return result;
  } catch (e) {
    return { success: false, logs: [], msg: e.toString() };
  }
}

/**
 * 🧹 清除工作日誌相關快取（寫入/修改/刪除時呼叫）
 */
function clearWorkLogCache_(employeeName, dateStr) {
  try {
    const cache = CacheService.getScriptCache();
    const searchName = String(employeeName || "").trim().replace(/\s/g, '');
    cache.remove("WLH_" + searchName + "_" + dateStr);
    cache.remove("OMNI_" + dateStr);
  } catch (e) {}
}

/**
 * 🏆 客戶到訪排行榜（依業務）：客戶 → 到訪次數（以「不同日期」計算）＋各次到訪的日期與當日明細
 * 全知視角「客戶到訪紀錄」分頁使用
 */
// 🚫 客戶名稱欄位偶爾誤存成工作項目文字，這些一律不算「客戶」
const FW_JUNK_CUSTOMER_NAMES_ = new Set([
  '送貨入店', '入店退貨', '送樣品', '案件追蹤', '版面上架', '版面下架', '版面巡視',
  '客訴處理', '送帳單', '對帳/收款', '對帳', '收款', '聊天', '吃飯/下午茶',
  '到訪客戶', '未知客戶', '支援送貨', '工地收退', '下架記錄', '公司', '客戶', ''
]);

// 📌 單筆工作摘要對應的分類（中文單字，固定順序：送貨→樣→帳→上→下→巡→版→退→聊）
const FW_TAG_ORDER_ = ['送貨', '樣', '帳', '上', '下', '巡', '版', '退', '聊'];
const FW_TAG_COLORS_ = {
  '送貨': '#facc15', '樣': '#f87171', '帳': '#60a5fa', '上': '#4ade80', '下': '#4ade80',
  '巡': '#2dd4bf', '版': '#a78bfa', '退': '#facc15', '聊': '#c084fc'
};
function fwClassifySummary_(summary) {
  const t = String(summary || '');
  const tags = [];
  if (t.includes('送貨入店')) tags.push('送貨');
  if (t.includes('樣')) tags.push('樣'); // 送樣品／樣品結案／手機自動樣品結案
  if (t.includes('對帳') || t.includes('收款') || t.includes('送帳單')) tags.push('帳');
  if (t.includes('版面上架')) tags.push('上');
  if (t.includes('版面下架')) tags.push('下');
  if (t.includes('版面巡視')) tags.push('巡');
  if (t.includes('版面更新') || t.includes('業務更新')) tags.push('版');
  if (t.includes('退貨') || t.includes('收退')) tags.push('退');
  if (t.includes('聊天')) tags.push('聊');
  return tags;
}

// 📌 依當日工作摘要判斷要標示的小徽章
function fwComputeDayBadges_(items) {
  const tagSet = new Set();
  items.forEach(v => fwClassifySummary_(v.summary).forEach(t => tagSet.add(t)));
  return FW_TAG_ORDER_.filter(t => tagSet.has(t)).map(t => ({ label: t, color: FW_TAG_COLORS_[t] }));
}

// 📇 讀「業務分區」表原始列（客戶短名＋負責業務欄原文），供各業務各自過濾客戶名單使用
function fwGetZoningAssignments_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'fw_zoning_rows_v2';
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const rows = [];
  try {
    const ss = getSafeSsMain();
    const sheet = ss.getSheetByName("業務分區");
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const custColIdx = findHeaderIndex(headers, ["客戶名稱", "客戶"]);
      const salesColIdx = findHeaderIndex(headers, ["負責業務", "業務", "負責人"]);
      if (custColIdx !== -1) {
        for (let i = 1; i < data.length; i++) {
          const raw = String(data[i][custColIdx] || '').trim();
          if (!raw) continue;
          const short = getCustomerShortName(raw);
          if (!short) continue;
          rows.push({ cust: short, sales: salesColIdx !== -1 ? String(data[i][salesColIdx] || '').trim() : '' });
        }
      }
    }
  } catch (e) {
    console.warn("fwGetZoningAssignments_ error: " + e);
  }
  try { cache.put(cacheKey, JSON.stringify(rows), 600); } catch (e) {}
  return rows;
}

// 📇 取得「業務分區」裡指定業務名下的客戶（正規化短名集合），漢樺/波爾泰比照全站規則歸謝博皓/潘右森/陳勁多三人共用
const FW_SHARED_CUST_MEMBERS_ = ['謝博皓', '潘右森', '陳勁多'];
function fwGetValidCustomerSetForBiz_(employeeName) {
  const rows = fwGetZoningAssignments_();
  const set = new Set();
  rows.forEach(r => {
    const isShared = (r.cust === '漢樺');
    if (isShared) {
      if (FW_SHARED_CUST_MEMBERS_.includes(employeeName)) set.add(r.cust);
    } else if (r.sales.includes(employeeName)) {
      set.add(r.cust);
    }
  });
  return set;
}

function getCustomerVisitRanking(employeeName) {
  const searchName = String(employeeName || "").trim().replace(/\s/g, '');
  if (!searchName) return { success: false, msg: "缺少業務姓名" };

  const cache = CacheService.getScriptCache();
  const cacheKey = "CUST_VISIT_v12_" + searchName;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, customers: [] };

    const validCustomers = fwGetValidCustomerSetForBiz_(searchName);

    // 只讀需要的 5 欄（日期,姓名,客戶,任務,詳細內容），跳過 GPS/時間/ID；單次批次讀取比逐列個別讀取快
    const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();

    // customer → { dateMap: { dateStr: [ {time,summary,detail} ] } }
    const custMap = {};
    rows.forEach(row => {
      const rowName = String(row[1] || "").trim().replace(/\s/g, '');
      if (rowName !== searchName) return;
      const rawDate = row[0];
      const dateStr = (rawDate instanceof Date)
        ? Utilities.formatDate(rawDate, "GMT+8", "yyyy-MM-dd")
        : String(rawDate).trim().split(' ')[0].replace(/\//g, '-');
      if (!dateStr) return;

      const expanded = parseVisitsFromRow_(row);
      expanded.forEach(v => {
        const rawCust = String(v.customer || '').trim();
        if (!rawCust || rawCust === '回公司(永安)' || rawCust.startsWith('回公司')) return;
        // 🚀 不論舊資料是否已縮短過，這裡一律再正規化一次，前綴相同的客戶自動合併
        const custName = getCustomerShortName(rawCust);
        if (!custName || FW_JUNK_CUSTOMER_NAMES_.has(custName)) return;
        // 🚫 只算這個業務在「業務分區」名下的客戶。
        // 名字對位放寬：洗名後若非完全相同，允許「業務分區短名為其前綴」也算命中，並歸戶到業務分區的正式短名。
        // （例：樣品結案存「春發磁磚生活館-樣品」洗成「春發磁磚」，因「磁磚」夾在中間剝不掉，
        //   會併回業務分區的「春發」。取最長前綴避免誤併，如 春發 vs 春發鋼鐵。）
        let canonical = validCustomers.has(custName) ? custName : '';
        if (!canonical) {
          validCustomers.forEach(v => { if (custName.indexOf(v) === 0 && v.length > canonical.length) canonical = v; });
        }
        if (!canonical) return; // 不在此業務名下的客戶，不算他的到訪
        if (!custMap[canonical]) custMap[canonical] = {};
        if (!custMap[canonical][dateStr]) custMap[canonical][dateStr] = [];
        custMap[canonical][dateStr].push({ time: v.time, summary: v.summary, detail: v.detail });
      });
    });

    const today = new Date();
    const oneYearAgoStr = Utilities.formatDate(new Date(today.getTime() - 365 * 86400000), "GMT+8", "yyyy-MM-dd");

    const customers = Object.keys(custMap).map(name => {
      const dateMap = custMap[name];
      const dates = Object.keys(dateMap)
        .sort((a, b) => b.localeCompare(a)) // 最新日期在前
        .map(d => ({
          date: d,
          dateDisplay: d.slice(5).replace('-', '/'), // 年拿掉，只留 MM/DD
          items: dateMap[d].sort((a, b) => String(a.time).localeCompare(String(b.time))),
          badges: fwComputeDayBadges_(dateMap[d])
        }));

      // 📊 該客戶各分類累計次數（逐筆計算，同一天多筆各自累加）
      const tagCounts = {};
      FW_TAG_ORDER_.forEach(t => { tagCounts[t] = 0; });
      dates.forEach(d => d.items.forEach(v => fwClassifySummary_(v.summary).forEach(t => { tagCounts[t]++; })));

      // 🕒 最後到訪距今天數
      const lastVisitDate = dates[0] ? dates[0].date : '';
      const daysSince = lastVisitDate ? Math.floor((today.getTime() - new Date(lastVisitDate).getTime()) / 86400000) : null;

      // 📅 近一年月度到訪次數（依日曆月份彙總，1月~12月）
      const monthMap = {};
      dates.forEach(d => {
        if (d.date < oneYearAgoStr) return;
        const key = d.date.slice(0, 7); // yyyy-MM
        monthMap[key] = (monthMap[key] || 0) + 1;
      });
      const months = Object.keys(monthMap).sort().map(key => ({
        label: parseInt(key.slice(5, 7), 10) + '月',
        count: monthMap[key]
      }));

      return {
        name: name,
        visitCount: dates.length,
        lastVisit: lastVisitDate,
        lastVisitDisplay: lastVisitDate ? lastVisitDate.slice(5).replace('-', '/') : '',
        daysSince: daysSince,
        dates: dates,
        tagCounts: tagCounts,
        months: months
      };
    }).sort((a, b) => b.visitCount - a.visitCount || b.lastVisit.localeCompare(a.lastVisit));

    // 📈 附加「本日／當月／年度累計」業績——只讀現成的預熱快取，不現場觸發計算（不用即時，讀不到就先不顯示）
    try {
      const ovCached = CacheManager.getLarge('sales_overview_v3.2_monthly');
      if (!ovCached) {
        console.warn("業績總覽快取未預熱，本次略過業績合併（searchName=" + searchName + "）");
      } else {
        const person = (ovCached.people || []).find(p => p.name === searchName);
        if (!person || !person.customers || !person.customers.length) {
          console.warn("業績總覽找不到此業務的客戶明細（searchName=" + searchName + "）");
        } else {
          const custSalesMap = {};
          person.customers.forEach(c => { custSalesMap[c.name] = c; });
          const thisYearStr = String(new Date().getFullYear());
          customers.forEach(c => {
            const s = custSalesMap[c.name];
            if (!s) return;
            c.salesToday = s.today;
            c.salesMonth = s.month;
            c.salesYear = s.ytd;
            // 📊 每次到訪的業績＝今年業績 ÷ 今年到訪次數（同一段期間比較，避免被歷年舊資料稀釋）
            const visitsThisYear = c.dates.filter(d => d.date.startsWith(thisYearStr)).length;
            c.avgPerVisit = visitsThisYear > 0 ? Math.round(s.ytd / visitsThisYear * 10) / 10 : 0;
          });
        }
      }
    } catch (e) { console.warn("業績合併失敗：" + e); }

    const result = { success: true, customers: customers };
    try { cache.put(cacheKey, JSON.stringify(result), 1800); } catch (e) {} // 30 分鐘快取（全歷史掃描較重）
    return result;
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * ✂️ 一次性清理：把「智能_工作日誌」既有資料的客戶名稱統一縮短
 * （欄位可能是 " || " 串接多筆、每筆前面有 [HH:mm] 時間標籤）
 * 在 Apps Script 編輯器手動執行一次即可，會回報修改了幾列
 */
function shortenExistingWorkLogCustomerNames() {
  const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, changed: 0 };

  const range = sheet.getRange(2, 3, lastRow - 1, 1); // C 欄：客戶名稱
  const values = range.getValues();
  let changed = 0;

  const shortenSegment = seg => {
    const m = seg.match(/^(\[\d{1,2}:\d{2}\]\s*)(.*)$/);
    if (!m) return fwShortenCustomerForSave_(seg.trim());
    return m[1] + fwShortenCustomerForSave_(m[2].trim());
  };

  for (let i = 0; i < values.length; i++) {
    const raw = String(values[i][0] || '');
    if (!raw) continue;
    const parts = raw.split(' || ');
    const newParts = parts.map(shortenSegment);
    const newVal = newParts.join(' || ');
    if (newVal !== raw) {
      values[i][0] = newVal;
      changed++;
    }
  }

  if (changed > 0) range.setValues(values);
  console.log("【工作日誌客戶名稱縮短】共修改 " + changed + " 列");
  return { success: true, changed: changed };
}

/**
 * 🗑️ 刪除指定工作日誌
 */
function deleteWorkLog(logId) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const data = sheet.getDataRange().getValues();

    let deletedCount = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][6]) === String(logId)) {
        const rDate = fwNormaliseDate_(data[i][0]);
        clearWorkLogCache_(String(data[i][1] || ""), rDate);
        sheet.deleteRow(i + 1);
        deletedCount++;
      }
    }
    if (deletedCount > 0) return { success: true, count: deletedCount };
    return { success: false, msg: "找不到該筆紀錄" };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🗑️ 刪除同一天內「單一筆」任務（而非整天的紀錄列）
 * 一天內多筆任務是用 " || " 串接在同一列的同一欄位裡，此函式只把符合的那一段拿掉，
 * 若拿掉後該列已無任何任務才整列刪除。
 */
function deleteWorkLogEntry(payload) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const data = sheet.getDataRange().getValues();
    const targetId = String(payload.id || '');
    const targetTime = String(payload.time || '').trim();
    const targetCustomer = String(payload.customer || '').trim();

    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][6]) !== targetId) continue;
      const rowIdx = i + 1;

      const listC = String(data[i][2] || '').split(' || ');
      const listT = String(data[i][3] || '').split(' || ');
      const listD = String(data[i][4] || '').split(' || ');

      // 依 [HH:mm] 時間標籤 + 客戶名稱 找出要刪除的那一筆索引
      let matchIdx = -1;
      for (let k = 0; k < listC.length; k++) {
        const c = String(listC[k] || '').trim();
        const m = c.match(/^\[(\d{1,2}:\d{2})\]\s*(.*)$/);
        const t = m ? m[1] : '';
        const cName = m ? m[2].trim() : c;
        if (t === targetTime && cName === targetCustomer) { matchIdx = k; break; }
      }

      const rDate = fwNormaliseDate_(data[i][0]);
      const empName = String(data[i][1] || '');

      if (matchIdx === -1) {
        // 找不到精確比對（極少數舊格式資料），退回刪除整列避免卡住
        sheet.deleteRow(rowIdx);
        clearWorkLogCache_(empName, rDate);
        return { success: true, wholeRow: true };
      }

      listC.splice(matchIdx, 1);
      listT.splice(matchIdx, 1);
      listD.splice(matchIdx, 1);

      if (listC.length === 0 || (listC.length === 1 && !listC[0])) {
        sheet.deleteRow(rowIdx);
      } else {
        sheet.getRange(rowIdx, 3, 1, 3).setValues([[listC.join(' || '), listT.join(' || '), listD.join(' || ')]]);
      }
      clearWorkLogCache_(empName, rDate);
      return { success: true };
    }
    return { success: false, msg: "找不到該筆紀錄" };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📝 更新指定工作日誌（同一天內「單一筆」任務，不會動到同一天的其他任務）
 * payload: { id, employeeName, date, originalTime, originalCustomer, customerName, result, content }
 */
function updateWorkLog(payload) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const data = sheet.getDataRange().getValues();
    const targetTime = String(payload.originalTime || '').trim();
    const targetCustomer = String(payload.originalCustomer || '').trim();

    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][6]) !== String(payload.id)) continue;
      const rowIdx = i + 1;

      const listC = String(data[i][2] || '').split(' || ');
      const listT = String(data[i][3] || '').split(' || ');
      const listD = String(data[i][4] || '').split(' || ');

      // 依 [HH:mm] 時間標籤 + 原客戶名稱 找出要更新的那一筆索引
      let matchIdx = -1;
      for (let k = 0; k < listC.length; k++) {
        const c = String(listC[k] || '').trim();
        const m = c.match(/^\[(\d{1,2}:\d{2})\]\s*(.*)$/);
        const t = m ? m[1] : '';
        const cName = m ? m[2].trim() : c;
        if (t === targetTime && cName === targetCustomer) { matchIdx = k; break; }
      }

      if (matchIdx === -1) {
        // 找不到精確比對（極少數舊格式資料），退回整列覆蓋避免卡住
        sheet.getRange(rowIdx, 3, 1, 3).setValues([[
          "[" + targetTime + "] " + fwShortenCustomerForSave_(payload.customerName),
          "[" + targetTime + "] " + payload.result,
          "[" + targetTime + "] " + (payload.content || "")
        ]]);
      } else {
        listC[matchIdx] = "[" + targetTime + "] " + fwShortenCustomerForSave_(payload.customerName);
        listT[matchIdx] = "[" + targetTime + "] " + payload.result;
        listD[matchIdx] = "[" + targetTime + "] " + (payload.content || "");
        sheet.getRange(rowIdx, 3, 1, 3).setValues([[listC.join(' || '), listT.join(' || '), listD.join(' || ')]]);
      }

      clearWorkLogCache_(payload.employeeName, payload.date);
      // 🔄 同步行程至行駛日誌
      syncTodayRouteToDrivingLog(payload.employeeName, payload.date);
      return { success: true };
    }
    return { success: false, msg: "找不到該筆紀錄" };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📆 取得指定月份中有日誌紀錄的日期（用於日曆標點）
 */
function getWorkLogMonthDates(employeeName, monthStr) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const data = sheet.getDataRange().getValues();
    const datesSet = new Set();

    data.slice(1).forEach(row => {
      const rowDate = String(row[0]).trim().substring(0, 10);
      if (String(row[1]) === String(employeeName) && rowDate.startsWith(monthStr)) {
        datesSet.add(rowDate);
      }
    });

    return { success: true, dates: Array.from(datesSet) };
  } catch (e) {
    return { success: false, dates: [] };
  }
}

// 舊版單一紀錄功能已整合至 saveDrivingFuelRecord。

/**
 * 📊 取得今日打卡狀態
 */
function getTodayStatus(employeeName) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.ATTENDANCE);
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const dateStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
    const searchName = String(employeeName || "").trim();

    let checkin = null;
    let checkout = null;
    let checkinStatus = "正常";

    // 從最後面開始找
    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      const rowName = String(row[1] || "").trim();
      const rowDate = row[4];
      const rowDateStr = fwNormaliseDate_(rowDate);

      if (rowName === searchName && rowDateStr === dateStr) {
        const type = String(row[2]);
        if (type.includes("上班") && !checkin) {
          checkin = row[3];
          checkinStatus = row[5] || "正常";
        }
        if (type.includes("下班") && !checkout) {
          checkout = row[3];
        }
      }
      if (checkin && checkout) break;
    }

    return {
      success: true,
      checkin: checkin ? Utilities.formatDate(new Date(checkin), "GMT+8", "HH:mm") : null,
      checkout: checkout ? Utilities.formatDate(new Date(checkout), "GMT+8", "HH:mm") : null,
      checkinStatus: checkinStatus
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📅 取得月份打卡報表
 */
function getAttendanceReport(employeeName, monthStr) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.ATTENDANCE);
    const data = sheet.getDataRange().getValues();
    const today = new Date();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(today.getDate() - 7);
    oneWeekAgo.setHours(0, 0, 0, 0);

    const list = data.slice(1)
      .filter(row => {
        const rowName = String(row[1]).trim();
        if (rowName !== String(employeeName)) return false;

        const rowDate = row[4];
        if (!(rowDate instanceof Date)) return false;

        if (monthStr) {
          const rowMonth = Utilities.formatDate(rowDate, "GMT+8", "yyyy-MM");
          return rowMonth === monthStr;
        } else {
          // 🚀 預設僅抓取最近一周
          return rowDate >= oneWeekAgo;
        }
      })
      .map(row => ({
        date: (row[4] instanceof Date) ? Utilities.formatDate(row[4], "GMT+8", "MM/dd") + " " + ["(日)", "(一)", "(二)", "(三)", "(四)", "(五)", "(六)"][row[4].getDay()] : String(row[4]),
        type: row[2],
        time: (row[3] instanceof Date) ? Utilities.formatDate(row[3], "GMT+8", "HH:mm") : String(row[3]),
        status: row[5],
        remark: row[6]
      }))
      .sort((a, b) => {
        // 先按日期排序，同日則按時間排序
        const d1 = a.date + " " + a.time;
        const d2 = b.date + " " + b.time;
        return d2.localeCompare(d1); // 最新在前
      });

    return { success: true, list: list };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🔔 自動偵測未下班提醒 (建議設定每日 18:30 觸發)
 */
function autoCheckMissingCheckout() {
  const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
  const sheet = ss.getSheetByName(FW_CONFIG.SHEETS.ATTENDANCE);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");

  let dailyMap = {}; // { name: { in: true, out: false } }

  data.slice(1).forEach(row => {
    const rowDate = fwNormaliseDate_(row[4]);
    if (rowDate === today) {
      const name = row[1];
      const type = row[2];
      if (!dailyMap[name]) dailyMap[name] = { in: false, out: false };
      if (type.includes("上班")) dailyMap[name].in = true;
      if (type.includes("下班")) dailyMap[name].out = true;
    }
  });

  let missing = [];
  for (let name in dailyMap) {
    if (dailyMap[name].in && !dailyMap[name].out) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    // 這裡可以發送 Email 給管理者或透過 LINE Notify
    console.log("今日尚未下班人員: " + missing.join(", "));
    // MailApp.sendEmail("admin@example.com", "【提醒】外勤人員未下班名單", "今日尚未打下班卡的人員：\n" + missing.join("\n"));
  }
}

/**
 * 📊 取得今日綜合日報數據 (強化版)
 */
function getDailyReportData(employeeName) {
  try {
    console.log("正在獲取業務今日報表:", employeeName);
    const now = new Date();
    const dateStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");

    // 1. 考勤狀態
    const status = getTodayStatus(employeeName);
    console.log("考勤狀態:", JSON.stringify(status));

    // 2. 拜訪紀錄
    const logsRes = getTodayLogs(employeeName);
    const logs = logsRes.success ? logsRes.logs : [];

    // 3. 里程與油資統計 (改從整合後的 DRIVING_LOG 讀取)
    let todayMileage = 0;
    let todayFuel = 0;
    const logSheet = getFwSheet(FW_CONFIG.SHEETS.DRIVING_LOG);
    const logData = logSheet.getDataRange().getValues();
    const searchName = String(employeeName || "").trim();

    logData.slice(1).forEach(row => {
      const rowDate = fwNormaliseDate_(row[0]);
      if (String(row[1]).trim() === searchName && rowDate === dateStr) {
        todayMileage += parseFloat(row[5]) || 0; // Index 5: 行駛距離
        todayFuel += parseFloat(row[8]) || 0;    // Index 8: 加油金額
      }
    });

    // 4. 業績數據 (串接 Sales.gs 的 getSalesOverview)
    let monthSales = 0;
    let yearSales = 0;
    try {
      const salesOverview = getSalesOverview();
      if (salesOverview.success && salesOverview.data.people) {
        const person = salesOverview.data.people.find(p => p.name === employeeName || p.alias === employeeName);
        if (person) {
          // 注意：Sales.gs 回傳的是以「萬」為單位的數字 (如 235.5 代表 235.5 萬)
          // 這裡我們轉回原始金額 (乘以 10000) 方便前端處理，或者直接傳萬
          monthSales = (person.month || 0) * 10000;
          yearSales = (person.year || 0) * 10000;
        }
      }
    } catch (err) {
      console.error("業績串接失敗:", err);
    }

    return {
      success: true,
      date: dateStr,
      attendance: status,
      punchIn: !!(status.checkin),             // ✅ 前端需要
      punchInTime: status.checkin || null,      // ✅ 前端需要
      checkin: status.checkin || null,           // ✅ 備用
      checkout: status.checkout || null,
      visitCount: logs.length,
      visits: logs,
      mileage: todayMileage,
      fuel: todayFuel,
      monthSales: monthSales,
      yearSales: yearSales,
      employeeName: employeeName
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 👁️ 管理者專用：取得全體業務員今日報表 (全知視角)
 */
/**
 * 🖥️ 每日總覽用：一次讀取「業務配送清單」(LOGISTICS_SS_ID)，依派遣司機分組出指定日期的電腦指派任務。
 * 過濾規則與 Code_SalesDelivery.js 的 getSalesDeliveryTasks 一致（含「今日結案的任務即使不是當天派送也顯示」規則），
 * 差別是這裡一次掃描給所有業務用，避免每人各自重新開表。
 * @param {string} dateStrHyphen yyyy-MM-dd
 * @return {Object} key=業務姓名(去空白) → [{customer, address, shippingType, status, isFinished}]
 */
function fwGetAssignedTasksForDate_(dateStrHyphen) {
  const map = {};
  try {
    const dateStrSlash = String(dateStrHyphen || '').replace(/-/g, '/');
    const todayStrSlash = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");

    const ss = SpreadsheetApp.openById(LOGISTICS_SS_ID);
    const sheet = ss.getSheetByName("業務配送清單");
    if (!sheet) return map;
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return map;

    const headers = data[0].map(v => String(v || '').trim());
    function findCol(keyArr) {
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i].toLowerCase();
        for (let k = 0; k < keyArr.length; k++) {
          if (h.indexOf(keyArr[k].toLowerCase()) !== -1) return i;
        }
      }
      return -1;
    }
    const idx = {
      handler: findCol(["派遣司機", "司機", "業務員"]),
      customer: findCol(["客戶", "名稱"]),
      address: findCol(["地址", "地點"]),
      status: findCol(["狀態"]),
      note: findCol(["備註"]),
      shippingType: findCol(["配送方式", "任務類型", "類型"]),
      finishTime: findCol(["完成時間", "配送完成時間", "結案時間"]),
      date: findCol(["日期"])
    };
    if (idx.handler === -1) return map;

    for (let i = 1; i < data.length; i++) {
      const rowHandler = String(data[i][idx.handler] || '').trim();
      if (!rowHandler) continue;

      const status = idx.status !== -1 ? String(data[i][idx.status] || '').trim() : '';
      const isFinished = (status === "已完成" || status === "結案" || status === "退貨完成");

      const rawDate = idx.date !== -1 ? data[i][idx.date] : '';
      let rowDateSlash = '';
      if (rawDate) {
        try {
          const dObj = new Date(rawDate);
          rowDateSlash = !isNaN(dObj.getTime()) ? Utilities.formatDate(dObj, "GMT+8", "yyyy/MM/dd") : String(rawDate);
        } catch (e) { rowDateSlash = String(rawDate); }
      }

      const fRaw = idx.finishTime !== -1 ? data[i][idx.finishTime] : '';
      let fDateSlash = '';
      if (fRaw) {
        try {
          const fObj = new Date(fRaw);
          if (!isNaN(fObj.getTime())) fDateSlash = Utilities.formatDate(fObj, "GMT+8", "yyyy/MM/dd");
        } catch (e) {}
      }

      let shouldShow = false;
      if (rowDateSlash === dateStrSlash) {
        shouldShow = true;
      } else if (fDateSlash === todayStrSlash && dateStrSlash === todayStrSlash) {
        shouldShow = true;
      }
      if (!shouldShow) continue;

      const typeRaw = idx.shippingType !== -1 ? String(data[i][idx.shippingType] || '') : '';
      const customerStr = idx.customer !== -1 ? String(data[i][idx.customer] || '') : '';
      const noteStr = idx.note !== -1 ? String(data[i][idx.note] || '') : '';
      const scanStr = (customerStr + "|" + noteStr + "|" + typeRaw).toLowerCase();
      let finalType = "送貨";
      if (scanStr.indexOf("入店") !== -1 || scanStr.indexOf("門市") !== -1) finalType = "入店";
      else if (scanStr.indexOf("樣品") !== -1) finalType = "樣品";
      else if (scanStr.indexOf("退貨") !== -1) finalType = "退貨";
      else if (typeRaw && typeRaw.trim() !== "") finalType = typeRaw;

      const key = rowHandler.replace(/\s/g, '');
      if (!map[key]) map[key] = [];
      map[key].push({
        customer: getCustomerShortName(customerStr) || customerStr,
        address: idx.address !== -1 ? String(data[i][idx.address] || '') : '',
        shippingType: finalType,
        status: status || "待指派",
        isFinished: isFinished
      });
    }
  } catch (e) {
    console.warn("fwGetAssignedTasksForDate_ error: " + e);
  }
  return map;
}

function getAllSalesDailyReports(targetDate) {
  try {
    // 快取：同一天內不重複讀表（今天短、過去日期長，比照全知視角口徑）
    const cache = CacheService.getScriptCache();
    const cacheKey = "ALL_SALES_v5_" + (targetDate || "AUTO"); // v5: 新增 assignedTasks(電腦指派)
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 🚀 核心效能優化：先只讀「日期/姓名/客戶」等輕欄位定位，避免整張表(含長字串明細)全部搬運
    const workSheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const workLastRow = workSheet.getLastRow();
    const workLite = workLastRow > 1 ? workSheet.getRange(2, 1, workLastRow - 1, 3).getValues() : []; // 日期,姓名,客戶

    // 1. 取得所有業務名單：白名單（等級=sales/KING）∪ 工作日誌實際出現過的姓名
    // 目的：避免白名單與工作日誌的姓名用字不同（例如同音異字）導致有真實紀錄的人漏列
    let salesList = getSalesStaffNames();
    if (!salesList || !salesList.length) salesList = SALES_CONFIG.SALES_PEOPLE.map(p => p.name); // 兜底
    const salesSet = new Set(salesList);
    workLite.forEach(r => {
      const n = String(r[1] || '').trim();
      if (n) salesSet.add(n);
    });
    salesSet.delete('高弘治'); // 指定不列入每日總覽
    salesList = Array.from(salesSet);
    const normalizedSalesList = salesList.map(n => String(n || "").trim().replace(/\s/g, ''));

    const drvSheet = getFwSheet(FW_CONFIG.SHEETS.DRIVING_LOG);
    const drvLastRow = drvSheet.getLastRow();
    const drvDates = drvLastRow > 1 ? drvSheet.getRange(2, 1, drvLastRow - 1, 1).getValues() : [];

    // 📵 打卡表已停用，不再讀取

    // 🚀 動態決定日期：如果未指定，則自動從「拜訪日誌表」中抓取最晚有客戶資料的日期
    let dateStr = targetDate;
    if (!dateStr) {
      const allPossibleDates = [];

      // 🚀 終極防爆解析函式：支援 Date物件、試算表數值序號、各式文字格式
      const extractSafeDate = (val) => {
        if (!val) return null;
        if (val instanceof Date) return Utilities.formatDate(val, "GMT+8", "yyyy-MM-dd");
        if (typeof val === 'number' && val > 30000 && val < 60000) {
          const epoch = new Date(1899, 11, 30);
          return Utilities.formatDate(new Date(epoch.getTime() + (val * 86400000)), "GMT+8", "yyyy-MM-dd");
        }
        const s = String(val).trim().split(' ')[0].replace(/\//g, '-');
        if (s.includes('-')) {
          const parts = s.split('-');
          if (parts.length >= 3) {
            let y = parts[0], m = parts[1], d = parts[2];
            if (d.length === 4) { y = d; m = parts[0]; d = parts[1]; } // 修正 MM-DD-YYYY
            if (y.length === 2) y = "20" + y; // 擴充 YY 為 20YY
            return y.padStart(4, '20') + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
          }
        }
        try {
          const nd = new Date(val);
          if (!isNaN(nd.getTime())) return Utilities.formatDate(nd, "GMT+8", "yyyy-MM-dd");
        } catch (e) { }
        return null;
      };

      // 🚀 A. 專注於「拜訪日誌表」，且嚴格限制「必須填寫了客戶名稱」才算是有資料的一天！
      if (workLite && workLite.length > 0) {
        workLite.forEach(r => {
          const customer = String(r[2] || "").trim();
          if (customer !== "") { // 👈 排除空白列或系統預存空列
            const d = extractSafeDate(r[0]);
            if (d) allPossibleDates.push(d);
          }
        });
      }

      // ❌ 移除了打卡表與里程表的判定，因為那不代表有業務上的「到訪數據」

      if (allPossibleDates.length > 0) {
        // 排序：由新到舊
        allPossibleDates.sort((a, b) => b.localeCompare(a));
        dateStr = allPossibleDates[0]; // 真正最近一次拜訪發生的那一天！
      }

      // 終極兜底：倘若整張雲端硬碟空空如也，才使用今天
      if (!dateStr) {
        dateStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
      }
    }

    // 🚀 dateStr 確定後，才對「日期欄」比對出命中列，逐列抓完整 8 欄資料（一天命中列數很少）
    const fmtLite = v => fwNormaliseDate_(v);
    const workRows = [];
    workLite.forEach((r, i) => {
      if (fmtLite(r[0]) === dateStr) {
        workRows.push(workSheet.getRange(i + 2, 1, 1, 8).getValues()[0]);
      }
    });
    const drvRows = [];
    drvDates.forEach((r, i) => {
      if (fmtLite(r[0]) === dateStr) {
        drvRows.push(drvSheet.getRange(i + 2, 1, 1, 6).getValues()[0]);
      }
    });

    // 🚀 同步拉取一次業績快照
    let salesLookup = {};
    try {
      const overview = getSalesOverview();
      if (overview.success && overview.data.people) {
        overview.data.people.forEach(p => {
          const key = String(p.name || '').trim();
          salesLookup[key] = p;
        });
      }
    } catch (e) {
      console.warn("SalesOverview load warning:", e);
    }

    // 🖥️ 電腦指派的今日行程（業務配送清單，一次讀取給所有人共用）
    const assignedTasksMap = fwGetAssignedTasksForDate_(dateStr);

    // 2. 記憶體內高效比對資料
    const reports = salesList.map((name, i) => {
      const searchName = normalizedSalesList[i];

      // A. 指定日期拜訪紀錄 (過濾)
      // A. 指定日期拜訪紀錄 (過濾並展平橫向聚合列)
      const myLogs = [];
      workRows.forEach(row => {
        const rName = String(row[1] || "").trim().replace(/\s/g, '');
        let rDate = fwNormaliseDate_(row[0])
        if (rDate.includes('-')) {
          const ps = rDate.split('-');
          if (ps.length >= 3) rDate = ps[0] + '-' + ps[1].padStart(2, '0') + '-' + ps[2].padStart(2, '0');
        }
        if (rName === searchName && rDate === dateStr) {
          const expanded = parseVisitsFromRow_(row);
          myLogs.push(...expanded);
        }
      });
      // 依照時間排序
      myLogs.sort((a, b) => String(a.time).localeCompare(String(b.time)));

      // B. 打卡已停用，不再讀取打卡表
      const checkin = null, checkout = null, checkinStatus = "正常";

      // C. 指定日期里程統計
      let todayMileage = 0;
      drvRows.forEach(row => {
        const rName = String(row[1] || "").trim().replace(/\s/g, '');
        let rDate = fwNormaliseDate_(row[0])
        if (rDate.includes('-')) {
          const ps = rDate.split('-');
          if (ps.length >= 3) rDate = ps[0] + '-' + ps[1].padStart(2, '0') + '-' + ps[2].padStart(2, '0');
        }
        if (rName === searchName && rDate === dateStr) {
          todayMileage += parseFloat(row[5]) || 0;
        }
      });

      const pData = salesLookup[name] || {};
      const mSales = (parseFloat(pData.month) || 0) * 10000;
      const ySales = (parseFloat(pData.year) || 0) * 10000;

      return {
        success: true,
        employeeName: name,
        date: dateStr,
        attendance: { checkin, checkout, checkinStatus },
        visitCount: myLogs.length,
        visits: myLogs,
        assignedTasks: assignedTasksMap[searchName] || [],
        mileage: todayMileage,
        monthSales: mSales,
        yearSales: ySales
      };
    });

    // 3. 業務動態排序：工作中的人排前頭
    reports.sort((a, b) => {
      const aActive = a.attendance.checkin && !a.attendance.checkout;
      const bActive = b.attendance.checkin && !b.attendance.checkout;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.visitCount - a.visitCount;
    });

    // 🚀 特別要求：強制將「高弘治」排至列表最下方
    const finalSortedReports = [];
    let targetPerson = null;
    reports.forEach(r => {
      if (r.employeeName === "高弘治") {
        targetPerson = r;
      } else {
        finalSortedReports.push(r);
      }
    });
    if (targetPerson) {
      finalSortedReports.push(targetPerson);
    }

    var result = { success: true, data: finalSortedReports, chosenDate: dateStr };
    const isToday = dateStr === Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
    try { cache.put(cacheKey, JSON.stringify(result), isToday ? 180 : 3600); } catch(e) {}
    return result;
  } catch (e) {
    console.error("getAllSalesDailyReports Optimized Error: ", e);
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📜 管理者專用：取得業務員過去 N 天的拜訪歷史
 */
function getSalesHistoryReport(employeeName, days = 5) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const data = sheet.getDataRange().getValues();
    const searchName = String(employeeName || "").trim();

    const results = [];
    const now = new Date();

    // 預計算過去 N 天的日期字串
    const validDates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      validDates.push(Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd"));
    }

    const logsByDate = {};
    validDates.forEach(d => logsByDate[d] = []);

    data.slice(1).forEach(row => {
      const rowName = String(row[1] || "").trim();
      if (rowName !== searchName) return;

      const rawDate = row[0];
      const rowDate = fwNormaliseDate_(rawDate);

      if (validDates.includes(rowDate)) {
        var expanded = parseVisitsFromRow_(row);
        expanded.forEach(function(v) {
          logsByDate[rowDate].push(v);
        });
      }
    });

    // 格式化輸出
    validDates.forEach(date => {
      if (logsByDate[date].length > 0) {
        results.push({
          date: date,
          logs: logsByDate[date].sort((a, b) => a.time.localeCompare(b.time))
        });
      }
    });

    return { success: true, history: results, employeeName: employeeName };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📧 自動化功能 1：每日傍晚發送今日行程總覽給高弘治 (titankou2002@gmail.com)
 */
function sendDailyAdminSummary() {
  const adminEmail = FW_CONFIG.EMAILS["高弘治"];
  const res = getAllSalesDailyReports();
  if (!res.success || res.data.length === 0) return;

  const today = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
  let body = `【高雅瓷】${today} 業務行程每日彙報\n\n`;

  res.data.forEach(r => {
    body += `────────────────\n`;
    body += `👤 業務：${r.employeeName}\n`;
    body += `🕒 上班：${r.attendance.checkin || "未打卡"} | 下班：${r.attendance.checkout || "未打卡"}\n`;
    body += `🚗 里程：${r.mileage.toFixed(1)} km | 拜訪：${r.visitCount} 家\n\n`;

    if (r.visits.length > 0) {
      r.visits.forEach((v, i) => {
        body += `  ${i + 1}. [${v.time}] ${v.customer}\n`;
        body += `     任務：${v.summary}\n`;
        if (v.detail) body += `     內容：${v.detail}\n`;
        body += `\n`;
      });
    } else {
      body += `  (今日無拜訪紀錄)\n\n`;
    }
  });

  body += `────────────────\n本信件由系統自動發送。`;

  MailApp.sendEmail(adminEmail, `【外勤日報】${today} 全體業務行程摘要`, body);
}

/**
 * 📧 自動化功能 2：每日晚上 7 點發送未打卡通知給業務員
 */
function sendMissingCheckoutReminders() {
  const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
  const sheet = ss.getSheetByName(FW_CONFIG.SHEETS.ATTENDANCE);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");

  let dailyMap = {}; // { name: { in: true, out: false } }
  data.slice(1).forEach(row => {
    const rowDate = fwNormaliseDate_(row[4]);
    if (rowDate === today) {
      const name = row[1];
      const type = row[2];
      if (!dailyMap[name]) dailyMap[name] = { in: false, out: false };
      if (type.includes("上班")) dailyMap[name].in = true;
      if (type.includes("下班")) dailyMap[name].out = true;
    }
  });

  for (let name in dailyMap) {
    if (dailyMap[name].in && !dailyMap[name].out) {
      const email = FW_CONFIG.EMAILS[name];
      if (email) {
        MailApp.sendEmail(email, "【打卡提醒】今日尚未打下班卡",
          `您好，${name}：\n\n系統偵測到您今日尚未打下班卡，請記得進入「智能報表」完成下班手續，以利工時統計。\n\n謝謝您的配合！`);
      }
    }
  }
}



/**
 * 📈 取得月度統計摘要
 */
function getFieldWorkSummary(employeeName, monthStr) {
  try {
    const stats = {
      workDays: 0,
      totalWorkingHours: 0,
      totalVisits: 0,
      totalMileage: 0,
      totalFuelCost: 0,
      totalLiters: 0,
      fuelRecords: []
    };

    const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);

    // 1. 統計打卡 (工時與天數)
    const attSheet = ss.getSheetByName(FW_CONFIG.SHEETS.ATTENDANCE);
    if (attSheet) {
      const attData = attSheet.getDataRange().getValues();
      const daysSet = new Set();
      attData.slice(1).forEach(row => {
        if (String(row[1]) === String(employeeName) && String(row[4]).startsWith(monthStr)) {
          daysSet.add(row[4]);
        }
      });
      stats.workDays = daysSet.size;
    }

    // 2. 統計日誌 (拜訪次數)
    const logSheet = ss.getSheetByName(FW_CONFIG.SHEETS.WORKLOG);
    if (logSheet) {
      const logData = logSheet.getDataRange().getValues();
      logData.slice(1).forEach(row => {
        if (String(row[1]) === String(employeeName)) {
          const d = row[2] instanceof Date ? row[2] : new Date(row[2]);
          if (Utilities.formatDate(d, "GMT+8", "yyyy-MM") === monthStr) {
            stats.totalVisits++;
          }
        }
      });
    }

    // 3. 統計行車與加油 (改從統合的 DRIVING_LOG 讀取)
    const drvLogSheet = ss.getSheetByName(FW_CONFIG.SHEETS.DRIVING_LOG);
    if (drvLogSheet) {
      const logData = drvLogSheet.getDataRange().getValues();
      const searchName = String(employeeName || "").trim();
      logData.slice(1).forEach(row => {
        if (String(row[1]).trim() === searchName) {
          const d = row[0] instanceof Date ? row[0] : new Date(row[0]);
          if (Utilities.formatDate(d, "GMT+8", "yyyy-MM") === monthStr) {
            stats.totalMileage += parseFloat(row[5]) || 0; // Index 5: 行駛距離
            stats.totalFuelCost += parseFloat(row[8]) || 0; // Index 8: 加油金額
            stats.totalLiters += parseFloat(row[7]) || 0;   // Index 7: 加油公升
            stats.fuelRecords.push({
              date: d,
              odometer: row[4], // Index 4: 結束里程 (用於計算油耗)
              liters: row[7]
            });
          }
        }
      });
    }

    // 計算平均油耗
    stats.fuelRecords.sort((a, b) => b.date - a.date);
    if (stats.fuelRecords.length >= 2) {
      const latest = stats.fuelRecords[0];
      const previous = stats.fuelRecords[stats.fuelRecords.length - 1];
      const dist = latest.odometer - previous.odometer;
      const litersUsed = stats.totalLiters - latest.liters;
      if (litersUsed > 0) {
        stats.avgFuelEconomy = (dist / litersUsed).toFixed(2);
      }
    }

    return { success: true, data: stats };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📄 生成出缺勤報告 (勞工局檢查格式)
 */
function generateAttendanceReport(employeeName, monthStr) {
  try {
    const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
    const sheet = ss.getSheetByName(FW_CONFIG.SHEETS.ATTENDANCE);
    if (!sheet) return { success: false, msg: "尚未有任何打卡資料" };

    const data = sheet.getDataRange().getValues();
    const [year, month] = monthStr.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const reportData = {};

    // 初始化當月每一天
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${monthStr}-${String(d).padStart(2, '0')}`;
      reportData[dayKey] = { date: dayKey, checkin: "", checkout: "", status: "", remark: "" };
    }

    // 填充數據
    data.slice(1).forEach(row => {
      const rowName = row[1];
      const rowType = String(row[2]);
      const rowTime = row[3];
      const rowDate = row[4];
      const rowStatus = row[5];
      const rowRemark = row[6];

      if (String(rowName) === String(employeeName) && String(rowDate).startsWith(monthStr)) {
        if (rowType.includes("上班")) {
          reportData[rowDate].checkin = Utilities.formatDate(new Date(rowTime), "GMT+8", "HH:mm");
          reportData[rowDate].status = rowStatus;
        } else if (rowType.includes("下班")) {
          reportData[rowDate].checkout = Utilities.formatDate(new Date(rowTime), "GMT+8", "HH:mm");
        }

        // 標記出差
        if (rowType.includes("出差")) {
          reportData[rowDate].remark = "出差模式";
        }
      }
    });

    return {
      success: true,
      employeeName: employeeName,
      month: monthStr,
      list: Object.values(reportData).sort((a, b) => a.date.localeCompare(b.date))
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 👥 取得該業務負責的客戶清單 (終極強化版)
 */
function getSalesCustomers(salesName) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName("業務分區");
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || "").trim());

    // 找出客戶、業務、等級欄位
    const custIdx = headers.findIndex(h => h.includes("客戶"));
    const salesIdx = headers.findIndex(h => h.includes("負責業務") || h.includes("業務") || h.includes("負責人"));
    const levelIdx = headers.findIndex(h => h.includes("等級"));

    if (custIdx === -1 || salesIdx === -1) return [];

    const targetSales = String(salesName || "").trim().toLowerCase();
    let alias = "";
    if (typeof SALES_CONFIG !== 'undefined' && SALES_CONFIG.SALES_PEOPLE) {
      const p = SALES_CONFIG.SALES_PEOPLE.find(p => p.name === salesName || p.alias === salesName);
      if (p) alias = String(p.alias || "").trim().toLowerCase();
    }

    const levelPriority = { "特": 1, "A": 2, "B": 3, "C": 4 };
    const customers = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowSales = String(row[salesIdx] || "").trim().toLowerCase();
      const rowLevel = String(row[levelIdx] || "").trim().toUpperCase();

      // 1. 等級過濾：只採計 特, A, B, C
      if (levelPriority[rowLevel]) {
        // 2. 業務比對 (直向佈局)
        if (rowSales && (rowSales.includes(targetSales) || (alias && rowSales.includes(alias)))) {
          const cust = String(row[custIdx]).trim();
          if (cust && cust.toLowerCase() !== targetSales && cust.toLowerCase() !== alias) {
            customers.push({ name: cust, level: rowLevel });
          }
        }
      }
    }

    // 3. 優先級排序 (特 > A > B > C)
    const sorted = customers.sort((a, b) => {
      const pA = levelPriority[a.level];
      const pB = levelPriority[b.level];
      if (pA !== pB) return pA - pB;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });

    const result = [...new Set(sorted.map(c => c.name))];
    console.log("過濾後客戶數量: " + result.length + " (業務: " + salesName + ")");
    return result;
  } catch (e) {
    console.error("getSalesCustomers Error: " + e.toString());
    return [];
  }
}

/**
 * 📅 取得今日行程紀錄 (預覽用)
 * 欄位順序：日期(0), 業務姓名(1), 客戶名稱(2), 任務(3), 詳細內容(4), 建立時間(5), 記錄ID(6)
 */
/**
 * 📝 提交請假報備
 */
function submitLeaveRequest(data) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.LEAVE);

    let photoUrl = '';
    if (data.photo) {
      const folder = getFwFolder('LeavePhotos');
      const blob = dataURItoBlob_(data.photo);
      const file = folder.createFile(blob);
      file.setName(`Leave_${data.salesName}_${Utilities.formatDate(new Date(), "GMT+8", "yyyyMMdd_HHmm")}`);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = file.getUrl();
    }

    sheet.appendRow([
      new Date(),
      data.salesName,
      data.type,
      data.start,
      data.end,
      data.reason,
      photoUrl,
      data.deviceId
    ]);

    return { success: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function getTodayLogs(employeeName) {
  try {
    // 快取 120 秒
    var cache = CacheService.getScriptCache();
    var cacheKey = "TODAY_LOGS_" + String(employeeName || "").trim().replace(/\s/g, '');
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const dateStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
    const searchName = String(employeeName || "").trim().replace(/\s/g, '');

    console.log(`[getTodayLogs] Searching for: ${searchName} on ${dateStr}`);

    const logs = data.slice(1)
      .filter(row => {
        const rowName = String(row[1] || "").trim().replace(/\s/g, '');
        const rawDate = row[0];
        let rowDate = "";
        if (rawDate instanceof Date) {
          rowDate = Utilities.formatDate(rawDate, "GMT+8", "yyyy-MM-dd");
        } else {
          rowDate = String(rawDate).trim().split(' ')[0].replace(/\//g, '-');
          const parts = rowDate.split('-');
          if (parts.length === 3) {
            rowDate = parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
          }
        }
        const isMatch = rowName === searchName && rowDate === dateStr;
        return isMatch;
      })
      .map(row => ({
        id: String(row[6] || ""),
        time: row[5] instanceof Date
          ? Utilities.formatDate(new Date(row[5]), "GMT+8", "HH:mm")
          : '--:--',
        customer: String(row[2]),
        summary: String(row[3]),
        detail: String(row[4])
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    console.log(`[getTodayLogs] Found ${logs.length} logs for ${searchName}`);
    var result = { success: true, logs: logs };
    try { cache.put(cacheKey, JSON.stringify(result), 120); } catch(e) {}
    return result;
  } catch (e) {
    console.error("[getTodayLogs] Error:", e);
    return { success: false, logs: [], msg: e.toString() };
  }
}

/**
 * 🚗 取得上一次結束里程（自動帶入開始里程）
 * 欄位：日期(0), 業務姓名(1), 開始里程(2), 結束里程(3), 行駛距離(4), 今日行程(5), 加油公升(6), 加油金額(7), 備註(8), 記錄ID(9)
 */
function getLastOdometer(employeeName) {
  try {
    // 快取該業務最後里程（5 分鐘有效）
    var cache = CacheService.getScriptCache();
    var cacheKey = "LAST_ODOM_" + String(employeeName || "").trim().replace(/\s/g, '');
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const sheet = getFwSheet(FW_CONFIG.SHEETS.DRIVING_LOG);
    const data = sheet.getDataRange().getValues();
    const searchName = String(employeeName || "").trim();

    // 找該業務「日期最新」的一筆（不能假設表格排序方向）
    let best = null;      // { time, rowIdx, endOdom, rawDate }
    for (let i = 1; i < data.length; i++) {
      const rowName = String(data[i][1]).trim();
      const endOdom = parseFloat(data[i][4]) || 0;
      if (rowName !== searchName || endOdom <= 0) continue;

      const d = parseDate(data[i][0]);
      const t = d ? d.getTime() : 0;
      // 日期較新者勝；日期相同（或都無法解析）時，取列數較後者
      if (!best || t > best.time || (t === best.time && i > best.rowIdx)) {
        best = { time: t, rowIdx: i, endOdom: endOdom, rawDate: data[i][0] };
      }
    }

    if (best) {
      const lastDate = best.rawDate;
      const dateStr = (lastDate instanceof Date) ? Utilities.formatDate(lastDate, "GMT+8", "MM/dd") : String(lastDate).slice(-5);
      var result = { success: true, odometer: best.endOdom, date: dateStr };
      try { cache.put(cacheKey, JSON.stringify(result), 300); } catch(e) {}
      return result;
    }
    var emptyResult = { success: true, odometer: 0, date: "" };
    try { cache.put(cacheKey, JSON.stringify(emptyResult), 300); } catch(e) {}
    return emptyResult;
  } catch (e) {
    return { success: false, odometer: 0, date: "", msg: e.toString() };
  }
}

/**
 * 🛣️ 自動生成今日行程字串（從工作日誌）
 * 格式：客戶(任務)→客戶(任務)→...
 */
function generateTodayRoute(employeeName, dateStr) {
  try {
    const targetDate = dateStr || Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
    const res = getWorkLogHistory(employeeName, targetDate);
    if (!res.success || res.logs.length === 0) return "";
    return res.logs.map(l => {
      const c = fwShortCustName(l.customer);
      const sum = fwSimplifyRouteSummary_(l.summary);
      return sum ? `${c}(${sum})` : c; // 沒摘要就不加空括號
    }).join(' → ');
  } catch (e) {
    return "";
  }
}

/**
 * 🧹 一次性批次：把行駛日誌「今日行程」欄的歷史舊列一起改：
 *   樣品結案→送樣、配送完工→送貨，並清掉空的 ()。
 *   在 Apps Script 編輯器選此函數按「執行」即可。跑一次就好。
 */
function batchFixDrivingRouteText() {
  const sheet = getFwSheet(FW_CONFIG.SHEETS.DRIVING_LOG);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, changed: 0, total: 0 };
  const rng = sheet.getRange(2, 7, lastRow - 1, 1); // 今日行程 = 第 7 欄
  const vals = rng.getValues();
  let changed = 0;
  const out = vals.map(row => {
    const orig = String(row[0] || '');
    if (!orig) return [orig];
    const s = orig
      .replace(/樣品結案/g, '送樣')
      .replace(/配送完工/g, '送貨')
      .replace(/（\s*）/g, '')
      .replace(/\(\s*\)/g, '');
    if (s !== orig) changed++;
    return [s];
  });
  if (changed > 0) rng.setValues(out);
  console.log('✅ 行駛日誌今日行程批次完成：共 ' + vals.length + ' 列，改動 ' + changed + ' 列。');
  return { success: true, changed: changed, total: vals.length };
}

/**
 * ✂️ 行程足跡摘要簡化：系統配送的「樣品結案」→送樣、「配送完工」→送貨；其餘原文；空字串維持空
 */
function fwSimplifyRouteSummary_(summary) {
  const s = String(summary || '').trim();
  if (!s) return '';
  if (s.indexOf('樣品結案') !== -1) return '送樣';
  if (s.indexOf('配送完工') !== -1) return '送貨';
  return s;
}

/**
 * ✂️ 客戶名稱簡化（去掉公司後綴與「-樣品」等冗字）
 */
function fwShortCustName(name) {
  let s = String(name || '').trim();
  if (!s) return '';
  s = s.replace(/[-_－—–\s]*(樣品|出貨|門市|倉庫)$/g, '').replace(/[()（）\[\]【】]/g, '').trim();
  const sufs = ['股份有限公司', '有限公司', '公司', '企業社', '企業', '實業', '國際',
    '工程', '建材行', '建材', '材料', '磁磚', '精品', '商行', '建設', '開發',
    '設計', '裝潢', '裝修', '工業', '生活館'];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < sufs.length; i++) {
      if (s.length > 2 && s.endsWith(sufs[i])) {
        s = s.slice(0, -sufs[i].length).trim();
        changed = true;
        break;
      }
    }
  }
  return s || String(name || '').trim();
}

/**
 * 🔄 將當日工作行程同步至行駛日誌
 */
function syncTodayRouteToDrivingLog(employeeName, dateStr) {
  try {
    const route = generateTodayRoute(employeeName, dateStr);
    if (!route) return;

    const sheet = getFwSheet(FW_CONFIG.SHEETS.DRIVING_LOG);
    const data = sheet.getDataRange().getValues();
    const searchName = String(employeeName).trim();

    for (let i = data.length - 1; i >= 1; i--) {
      const rowDate = fwNormaliseDate_(data[i][0]);
      if (rowDate === dateStr && String(data[i][1]).trim() === searchName) {
        // 今日行程在第 7 欄 (Index 6)
        sheet.getRange(i + 1, 7).setValue(route);
      }
    }
  } catch (e) {
    console.error("同步行程失敗:", e);
  }
}

/**
 * 🔍 API: 取得今日工作日誌摘要（用於前端自動帶入行程）
 */
function getTodayWorkRoute(employeeName) {
  try {
    const res = getTodayLogs(employeeName);
    if (!res.success) return { success: false, msg: res.msg };
    const routeStr = res.logs.map(l => {
      const sum = fwSimplifyRouteSummary_(l.summary);
      return sum ? `${l.customer}(${sum})` : l.customer;
    }).join(' → ');
    return { success: true, route: routeStr };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🚗 取得歷史行駛紀錄 (近 30 筆)
 */
function getDrivingHistory(employeeName) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.DRIVING_LOG);
    if (!sheet) return { success: false, logs: [] };
    const data = sheet.getDataRange().getValues();
    const searchName = String(employeeName || "").trim();

    // 欄位：日期(0), 業務姓名(1), 車牌(2), 開始里程(3), 結束里程(4), 距離(5), 行程(6), 公升(7), 金額(8), 備註(9)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    oneWeekAgo.setHours(0, 0, 0, 0);

    const logs = data.slice(1)
      .filter(row => {
        const rowName = String(row[1]).trim();
        if (rowName !== searchName) return false;
        const rowDate = (row[0] instanceof Date) ? row[0] : new Date(row[0]);
        return rowDate >= oneWeekAgo;
      })
      .map(row => ({
        date: formatDateWithDay(row[0]),
        plate: String(row[2]),
        start: row[3],
        end: row[4],
        dist: row[5],
        route: row[6],
        fuelLiters: row[7],
        fuelAmt: row[8],
        note: row[9]
      }))
      .sort((a, b) => {
        const dateA = new Date(a.date.split(' ')[0]).getTime();
        const dateB = new Date(b.date.split(' ')[0]).getTime();
        return dateB - dateA;
      });

    return { success: true, logs: logs };
  } catch (e) {
    return { success: false, logs: [], msg: e.toString() };
  }
}

// 重複定義已移除，統一使用上方 784 行的版本。

/**
 * 📋 儲存合併行駛日誌（行車+加油合一）
 * payload: { employeeName, startOdometer, endOdometer, fuelLiters, fuelAmount, note }
 */
// 已由下方 saveDrivingFuelRecord (修正版) 取代，刪除重複定義

/**
 * ⚙️ 取得系統設定 (車號與車主對應表)
 */
function getFwSettings() {
  try {
    forceUpdateAllFwHeaders(); // 🚀 自動校正標題列
    const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
    const sheet = ss.getSheetByName(FW_CONFIG.SHEETS.SETTINGS);
    if (!sheet) return { success: false, msg: "找不到系統設定分頁" };

    const data = sheet.getDataRange().getValues();
    const carMapping = {};
    const plateList = [];

    // 假設 D 欄是車號 (index 3), E 欄是車主 (index 4)
    for (let i = 1; i < data.length; i++) {
      const plate = String(data[i][3] || "").trim().toUpperCase();
      const owner = String(data[i][4] || "").trim();
      if (plate) {
        plateList.push(plate);
        if (owner) {
          carMapping[owner] = plate;
        }
      }
    }

    return {
      success: true,
      carMapping: carMapping,
      plateList: [...new Set(plateList)] // 去重
    };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📋 儲存合併行駛日誌 (修正版：加入車牌)
 */
function saveDrivingFuelRecord(payload) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.DRIVING_LOG);
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const dateStr = payload.date || Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
    const searchName = String(payload.employeeName).trim();
    const searchPlate = String(payload.plateNumber || "").trim();

    const start = parseFloat(payload.startOdometer) || 0;
    const end = parseFloat(payload.endOdometer) || 0;
    const fuelLit = parseFloat(payload.fuelLiters) || 0;
    const fuelAmt = parseFloat(payload.fuelAmount) || 0;
    const route = payload.route || generateTodayRoute(payload.employeeName, dateStr);

    // 嘗試尋找當天、同業務、同車牌的現有紀錄
    let existingRowIdx = -1;
    for (let i = data.length - 1; i >= 1; i--) {
      const rowDate = fwNormaliseDate_(data[i][0]);
      if (rowDate === dateStr && String(data[i][1]).trim() === searchName && String(data[i][2]).trim() === searchPlate) {
        existingRowIdx = i + 1;
        break;
      }
    }

    if (existingRowIdx > -1) {
      // 更新現有紀錄
      const rowData = data[existingRowIdx - 1];

      // 如果 payload 有里程資訊，更新里程 (Index 3, 4, 5)
      if (end > 0) {
        sheet.getRange(existingRowIdx, 4, 1, 3).setValues([[start, end, Math.max(0, end - start)]]);
      }

      // 🚗 今日行程 (Index 6) 不再綁在里程分支：只要這次算得出行程就更新，
      //    存里程或存加油都會寫，順序不再影響（先里程→再加油→最後行程也寫得進去）。
      //    空值不覆蓋既有行程，避免把已填的洗掉。
      if (route) {
        sheet.getRange(existingRowIdx, 7).setValue(route);
      }

      // 如果 payload 有加油資訊，累加加油 (Index 8, 9)
      if (fuelAmt > 0) {
        const oldLit = parseFloat(rowData[7]) || 0;
        const oldAmt = parseFloat(rowData[8]) || 0;
        sheet.getRange(existingRowIdx, 8, 1, 2).setValues([[oldLit + fuelLit, oldAmt + fuelAmt]]);
        if (payload.note) {
          const oldNote = String(rowData[9] || "");
          sheet.getRange(existingRowIdx, 10).setValue(oldNote + (oldNote ? ";" : "") + payload.note);
        }
      }
      // 排序：先依姓名(2) 升冪，再依日期(1) 降冪
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort([
          { column: 2, ascending: true },
          { column: 1, ascending: false }
        ]);
      }
      return { success: true, id: rowData[10], distance: Math.max(0, end - start), route: route, updated: true };
    } else {
      // 新增紀錄
      // 生成唯一 ID (LOG_ + 毫秒 + 隨機數) 避免循環提交時碰撞
      const id = "DRV_" + now.getTime() + "_" + Math.floor(Math.random() * 1000);
      const dist = Math.max(0, end - start);
      const row = [
        dateStr,
        payload.employeeName,
        payload.plateNumber || "",
        start,
        end,
        dist,
        route,
        fuelLit,
        fuelAmt,
        payload.note || "",
        id
      ];
      sheet.appendRow(row);

      // 排序
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort([
          { column: 2, ascending: true },
          { column: 1, ascending: false }
        ]);
      }
      return { success: true, id: id, distance: dist, route: route, updated: false };
    }
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🔧 儲存保養紀錄 (修正版：加入車牌)
 */
function saveMaintenanceRecord(payload) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.MAINTENANCE);
    const now = new Date();
    const id = "MNT_" + now.getTime();
    const dateStr = payload.date || Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");

    let photoUrls = [];
    if (payload.photos && payload.photos.length > 0) {
      payload.photos.forEach((p, idx) => {
        if (p) {
          const url = uploadFile(p, `MAINT_${payload.employeeName}_${idx}`);
          if (url) photoUrls.push(url);
        }
      });
    }

    // 欄位：保養日期, 業務姓名, 車牌號碼, 本次里程, 下次保養里程, 保養項目, 保養金額, 照片, 備註, 記錄ID
    const row = [
      dateStr,
      payload.employeeName,
      payload.plateNumber || "",
      parseFloat(payload.mileage) || 0,
      parseFloat(payload.nextMileage) || 0,
      payload.items || "",
      parseFloat(payload.amount) || 0,
      photoUrls.join(" / "),
      payload.note || "",
      id
    ];

    sheet.appendRow(row);
    return { success: true, id: id };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🔍 取得保養歷史 (用於顯示上次保養項目日期)
 */
function getMaintenanceHistory(employeeName, plateNumber) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.MAINTENANCE);
    const data = sheet.getDataRange().getValues();
    const history = {};
    let lastNote = "";
    let lastPlate = plateNumber || "";

    if (data.length < 2) return { success: true, history: {}, lastNote: "", lastPlate: lastPlate };

    const searchPlate = String(plateNumber || "").trim().toUpperCase();

    // 從後往前掃描
    for (let i = data.length - 1; i >= 1; i--) {
      // 🚀 改為以車牌作為主要過濾條件
      const rowPlate = String(data[i][2] || "").trim().toUpperCase();
      if (rowPlate === searchPlate && searchPlate !== "") {
        if (!lastNote) lastNote = String(data[i][8] || ""); // Index 8: 備註
        if (!lastPlate) lastPlate = String(data[i][2] || ""); // Index 2: 車牌

        const items = String(data[i][5]).split('、'); // Index 5: 保養項目
        const dateRaw = data[i][0];
        let date = "";
        if (dateRaw instanceof Date) {
          date = Utilities.formatDate(dateRaw, "GMT+8", "yyyy-MM-dd");
        } else {
          date = String(dateRaw).split(' ')[0].split('T')[0];
        }

        items.forEach(item => {
          const trimmed = item.trim();
          if (trimmed && !history[trimmed]) {
            history[trimmed] = date;
          }
        });
      }
    }
    return { success: true, history: history, lastNote: lastNote, lastPlate: lastPlate };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🔍 取得完整保養歷史清單
 */
function getFullMaintenanceHistory(employeeName, plateNumber) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.MAINTENANCE);
    const data = sheet.getDataRange().getValues();
    const searchPlate = String(plateNumber || "").trim().toUpperCase();

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    oneWeekAgo.setHours(0, 0, 0, 0);

    const list = data.slice(1)
      .filter(row => {
        const rowPlate = String(row[2] || "").trim().toUpperCase();
        if (rowPlate !== searchPlate || searchPlate === "") return false;
        const rowDate = (row[0] instanceof Date) ? row[0] : new Date(row[0]);
        return rowDate >= oneWeekAgo;
      })
      .map(row => ({
        date: formatDateWithDay(row[0]),
        plate: row[2],
        mileage: row[3],
        items: row[5],
        amount: row[6],
        photos: String(row[7] || "").split(/[,/]/).map(url => url.trim()).filter(url => url.startsWith("http")),
        note: row[8]
      }))
      .sort((a, b) => {
        const dateA = new Date(a.date.split(' ')[0]).getTime();
        const dateB = new Date(b.date.split(' ')[0]).getTime();
        return dateB - dateA;
      });

    return { success: true, list: list };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📦 檔案上傳輔助函數 (Base64)
 */
function uploadFile(photoData, namePrefix) {
  if (!photoData) return null;
  const base64Str = photoData.base64 || photoData.contents;
  if (!base64Str) return null;

  try {
    const decoded = Utilities.base64Decode(base64Str);
    const blob = Utilities.newBlob(decoded, photoData.mimeType || 'image/jpeg', `${namePrefix}_${new Date().getTime()}.jpg`);

    let folder;
    try {
      if (CONFIG.IMG_FOLDER_ID) {
        folder = DriveApp.getFolderById(CONFIG.IMG_FOLDER_ID);
      } else {
        throw new Error("No Folder ID");
      }
    } catch (e) {
      const folders = DriveApp.getFoldersByName("eliTile_Uploads");
      folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("eliTile_Uploads");
    }

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    console.error("uploadFile Final Error: " + e.toString());
    return null;
  }
}


/**
 * ⚙️ 系統設定：一鍵啟動自動化通知觸發器 (管理者手動執行一次即可)
 * 1. 每日 18:00 - 19:00 發送全體行程報表給 高弘治
 * 2. 每日 19:00 - 20:00 偵測未下班人員並發送通知
 */
function setupFieldWorkTriggers() {
  // 先清除舊的觸發器避免重複
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "sendDailyAdminSummary" ||
      t.getHandlerFunction() === "sendMissingCheckoutReminders") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 1. 每日行程彙報 (18:00 左右)
  ScriptApp.newTrigger("sendDailyAdminSummary")
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .inTimezone("GMT+8")
    .create();

  // 2. 未打卡提醒 (19:00 左右)
  ScriptApp.newTrigger("sendMissingCheckoutReminders")
    .timeBased()
    .atHour(19)
    .everyDays(1)
    .inTimezone("GMT+8")
    .create();

  console.log("✅ 自動化觸發器已設定完成：\n1. 每日 18:00 行程彙報\n2. 每日 19:00 未下班提醒");
}

/**
 * 📁 取得或建立外勤專用資料夾
 */
function getFwFolder(subFolderName) {
  const ss = SpreadsheetApp.openById(FW_CONFIG.SS_ID);
  const parentFolder = DriveApp.getFileById(ss.getId()).getParents().next();
  let fwFolder;
  const folders = parentFolder.getFoldersByName('FieldWork_Media');
  if (folders.hasNext()) {
    fwFolder = folders.next();
  } else {
    fwFolder = parentFolder.createFolder('FieldWork_Media');
  }

  if (subFolderName) {
    const subFolders = fwFolder.getFoldersByName(subFolderName);
    if (subFolders.hasNext()) {
      return subFolders.next();
    } else {
      return fwFolder.createFolder(subFolderName);
    }
  }
  return fwFolder;
}

/**
 * 🖼️ Base64 轉 Blob
 */
function dataURItoBlob_(dataURI) {
  const byteString = Utilities.base64Decode(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  return Utilities.newBlob(byteString, mimeString);
}

/**
 * 👁️ 全知視角：獲取多個業務的日誌與統計 (戰情室 2.0 版)
 */
function getOmniscientLogs(dateStr) {
  try {
    let names = Array.from(FW_CONFIG.OMNISCIENT_LIST || ["高弘治", "謝博皓", "潘右森", "陳勁多"]);
    try {
      const customSales = JSON.parse(PropertiesService.getScriptProperties().getProperty("DIRECT_ACCESS_CUSTOM") || "[]");
      customSales.forEach(n => {
        if (n && !names.includes(n)) names.push(n);
      });
    } catch(e){ console.warn("DIRECT_ACCESS_CUSTOM parse failed:", e); }

    const normalizedNames = names.map(n => String(n || "").trim().replace(/\s/g, ''));
    const now = new Date();
    // 預設為「昨天」(每天早上看前一天的回報)
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const defaultDate = Utilities.formatDate(yesterday, "GMT+8", "yyyy-MM-dd");
    const targetDate = dateStr || defaultDate;

    // 快取全知視角結果（同一天 10 分鐘內不重複讀表）
    const cache = CacheService.getScriptCache();
    const cacheKey = "OMNI_" + targetDate;
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 🚀 兩段式讀取：先只讀「日期」欄定位目標列（很輕），再單獨抓命中的那幾列
    // 工作日誌一天每人只有一列，命中列數極少，避免整表長字串全部載入
    const ss = getFwSs();
    const fmtRowDate = v => fwNormaliseDate_(v);
    const readMatchedRows = (sheetName, nCols) => {
      const sh = ss.getSheetByName(sheetName);
      if (!sh) return [];
      const lr = sh.getLastRow();
      if (lr < 2) return [];
      const dates = sh.getRange(2, 1, lr - 1, 1).getValues();
      const rows = [];
      for (let i = 0; i < dates.length; i++) {
        if (fmtRowDate(dates[i][0]) === targetDate) {
          rows.push(sh.getRange(i + 2, 1, 1, nCols).getValues()[0]);
        }
      }
      return rows;
    };
    const workRows = readMatchedRows(FW_CONFIG.SHEETS.WORKLOG, 8);
    const drvRows = readMatchedRows(FW_CONFIG.SHEETS.DRIVING_LOG, 6);  // 日期, 姓名, 車牌, 開始, 結束, 距離

    const results = names.map((name, i) => {
      const searchName = normalizedNames[i];

      // 1. 拜訪日誌
      // 1. 拜訪日誌
      const logs = [];
      workRows.forEach(row => {
        const rowName = String(row[1] || "").trim().replace(/\s/g, '');
        const rowDate = fwNormaliseDate_(row[0])
        if (rowName === searchName && rowDate === targetDate) {
          const expanded = parseVisitsFromRow_(row);
          logs.push(...expanded);
        }
      });
      logs.sort((a, b) => String(a.time).localeCompare(String(b.time)));

      // 2. 打卡已停用，不再讀取打卡表
      const checkinTime = "--:--";

      // 3. 行駛里程
      const drvRow = drvRows.find(row => {
        const rowName = String(row[1] || "").trim().replace(/\s/g, '');
        const rowDate = fwNormaliseDate_(row[0])
        return rowName === searchName && rowDate === targetDate;
      });
      const distance = drvRow ? (parseFloat(drvRow[5]) || 0) : 0;

      return {
        name: name,
        logs: logs,
        stats: {
          visitCount: logs.length,
          checkin: checkinTime,
          distance: distance
        }
      };
    });

    const result = {
      success: true,
      date: targetDate,
      dateDisplay: formatDateWithDay(targetDate),
      results: results
    };

    // 今天的資料仍在更新中快取短一點；過去日期不會再變，快取 1 小時
    const isToday = targetDate === Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
    const ttl = isToday ? 180 : 3600;
    try { cache.put(cacheKey, JSON.stringify(result), ttl); } catch(e) {}

    return result;
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📝 批次工作日誌儲存 (解決同客戶重複寫入問題)
 */
/**
 * 📷 線上任務照片上傳（LINE 對話截圖）：與業務配送共用同一個安全資料夾（業務配送照片備援_2026）
 * @param {string} base64 圖片 base64（不含 data:image/...;base64, 前綴）
 * @param {string} mimeType 例如 image/jpeg
 * @return {Object} { success, url }
 */
function uploadFwOnlinePhoto(base64, mimeType) {
  try {
    if (!base64) return { success: false, msg: '缺少圖片資料' };
    const folder = _getSafeFolder();
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType || 'image/jpeg', 'FW_ONLINE_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '.jpg');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success: true, url: file.getUrl() };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

function saveWorkLogBatch(payload) {
  try {
    const sheet = getFwSheet(FW_CONFIG.SHEETS.WORKLOG);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, "GMT+8", "HH:mm");
    const dateStr = payload.date || Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
    const newId = "LOG_" + now.getTime() + "_" + Math.floor(Math.random() * 1000);

    // 1. 批次內容前置聚合
    const results = payload.tasks.map(t => t.result).filter(Boolean);
    const contents = payload.tasks.map((t, i) => {
      if (!t.content) return "";
      return payload.tasks.length > 1 ? `(${i + 1}) ${t.content}` : t.content;
    }).filter(Boolean);

    const combinedResult = [...new Set(results)].join("、");
    const combinedContent = contents.join("\n");

    // 🚀 線上任務照片（LINE 對話截圖）：彙整本次所有任務上傳的圖片網址，同一任務內超過 2 張用逗號分隔
    const allPhotoUrls = [];
    payload.tasks.forEach(t => {
      if (t.onlinePhotoUrls && t.onlinePhotoUrls.length) allPhotoUrls.push(...t.onlinePhotoUrls.filter(Boolean));
    });

    // 2. 包裝成存儲字串
    const custToSave = "[" + timeStr + "] " + fwShortenCustomerForSave_(payload.customerName || "未知客戶");
    const taskToSave = "[" + timeStr + "] " + combinedResult;
    const descToSave = "[" + timeStr + "] " + combinedContent;
    const picToSave = allPhotoUrls.length ? ("[" + timeStr + "] " + allPhotoUrls.join(',')) : "";

    // 3. 查找現有列（先用快取）
    const searchName = String(payload.employeeName || "").trim().replace(/\s/g, '');
    let existingRowIdx = -1;

    const cache = CacheService.getScriptCache();
    const cacheKey = "WORKLOG_ROW_" + searchName + "_" + dateStr;
    const cachedRow = cache.get(cacheKey);
    if (cachedRow) {
      existingRowIdx = parseInt(cachedRow, 10);
      try {
        const checkVal = sheet.getRange(existingRowIdx, 1, 1, 2).getValues()[0];
        const rDate = fwNormaliseDate_(checkVal[0]);
        const rName = String(checkVal[1] || "").trim().replace(/\s/g, '');
        if (rDate !== dateStr || rName !== searchName) existingRowIdx = -1;
      } catch(e) { existingRowIdx = -1; }
    }

    if (existingRowIdx === -1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const rDate = fwNormaliseDate_(data[i][0]);
        const rName = String(data[i][1] || "").trim().replace(/\s/g, '');
        if (rDate === dateStr && rName === searchName) {
          existingRowIdx = i + 1;
          break;
        }
      }
    }

    if (existingRowIdx !== -1) {
      const range = sheet.getRange(existingRowIdx, 1, 1, 9);
      const rowData = range.getValues()[0];
      const finalCust = (rowData[2] ? rowData[2] + " || " : "") + custToSave;
      const finalTask = (rowData[3] ? rowData[3] + " || " : "") + taskToSave;
      const finalDesc = (rowData[4] ? rowData[4] + " || " : "") + descToSave;
      const finalPic = picToSave ? ((rowData[8] ? rowData[8] + " || " : "") + picToSave) : (rowData[8] || "");

      range.setValues([[
        dateStr,
        payload.employeeName,
        finalCust,
        finalTask,
        finalDesc,
        payload.gps || "",
        now,
        newId,
        finalPic
      ]]);
    } else {
      sheet.appendRow([
        dateStr,
        payload.employeeName,
        custToSave,
        taskToSave,
        descToSave,
        payload.gps || "",
        now,
        newId,
        picToSave
      ]);
    }

    // 快取列號
    try { cache.put(cacheKey, String(existingRowIdx !== -1 ? existingRowIdx : sheet.getLastRow()), 43200); } catch(e) {}

    // deferred sort: 每 50 次寫入才排序一次，避免每次寫入拖慢
    try {
      var sortCount = parseInt(cache.get("WORKLOG_SORT_COUNT") || "0", 10);
      sortCount++;
      cache.put("WORKLOG_SORT_COUNT", String(sortCount), 21600);
      if (sortCount >= 50) {
        var lr = sheet.getLastRow();
        if (lr > 1) {
          sheet.getRange(2, 1, lr - 1, 9).sort([{ column: 1, ascending: false }, { column: 2, ascending: true }]);
        }
        cache.put("WORKLOG_SORT_COUNT", "0", 21600);
      }
    } catch(e) { console.warn("saveWorkLogBatch deferred sort failed:", e); }
    clearWorkLogCache_(payload.employeeName, dateStr);

    return { success: true, id: newId, summary: combinedResult };
  } catch (e) {
    console.error("saveWorkLogBatch Error:", e);
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🕵️ 剖析工具：將單一試算表列還原成拜訪物件陣列 (支援舊式單列、新式多重列)
 */
function parseVisitsFromRow_(row) {
  const custRaw = String(row[2] || "");
  const taskRaw = String(row[3] || "");
  const detailRaw = String(row[4] || "");
  // 🚀 智慧相容：優先讀取第 7 欄 (Index 6)，若非日期則倒退讀取第 6 欄 (Index 5)
  const timeRaw = (row[6] instanceof Date) ? row[6] : ((row[5] instanceof Date) ? row[5] : null);

  // 辨識機制：如果包含了串接符號 " || " 或開頭就是 "[HH:mm]"
  const isComplex = custRaw.includes(" || ") || /^\s*\[\d{1,2}:\d{2}\]/.test(custRaw);

  if (isComplex) {
    const listC = custRaw.split(" || ");
    const listT = taskRaw.split(" || ");
    const listD = detailRaw.split(" || ");

    const len = Math.max(listC.length, listT.length, listD.length);
    const output = [];

    for (let i = 0; i < len; i++) {
      let c = String(listC[i] || "").trim();
      let t = String(listT[i] || "").trim();
      let d = String(listD[i] || "").trim();

      // 提取內嵌的時間標籤，例如 [14:30] 
      let timeStr = "--:--";
      const match = c.match(/^\[(\d{1,2}:\d{2})\]/);
      if (match) {
        timeStr = match[1];
        c = c.replace(/^\[\d{1,2}:\d{2}\]\s*/, ''); // 移去標籤讓畫面清爽
      }
      // 同時清理任務與詳細資訊中的殘留時間標籤
      t = t.replace(/^\[\d{1,2}:\d{2}\]\s*/, '');
      d = d.replace(/^\[\d{1,2}:\d{2}\]\s*/, '');

      if (c || t) {
        output.push({
          time: timeStr,
          customer: c,
          summary: t,
          detail: d
        });
      }
    }
    return output;
  } else {
    // 👴 舊式相容：單列即單一紀錄
    const fallbackTime = (timeRaw instanceof Date) ? Utilities.formatDate(timeRaw, "GMT+8", "HH:mm") : String(timeRaw || "--:--");
    return [{
      time: fallbackTime,
      customer: custRaw,
      summary: taskRaw,
      detail: detailRaw
    }];
  }
}
