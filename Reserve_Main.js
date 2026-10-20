/**
 * 保留系統 (2026-09-30 併入版面神器，原獨立 GAS 已停用、只做轉址)。網址：版面神器 ?view=reserve
 * Web App 入口 (reserveDoGet_，由版面神器 doGet 分流) 與 webGetData 路由
 */

/** 需要寫入操作記錄的動作 → 中文說明 */
const RSV_AUDIT_ACTIONS = {
  update_progress: '更新保留進度',
  delete_product: '刪除保留品項',
  update_shortage_tracking: '更新缺貨追蹤狀態',
  add_shortage_tracking: '新增缺貨追蹤',
  confirm_discontinue: '確認不續辦',
  close_shortage_product: '產品完結',
  confirm_safe_stock: '設定安全庫存',
  generate_restock_order_list: '生成補貨清單',
  run_product_analysis: '執行產品分析',
  send_war_room_email: '寄送戰情室郵件'
};

function reserveDoGet_(e) {
  if (e && e.parameter) {
    if (e.parameter.code) {
      return serveProductImage_(e.parameter.code);
    }
    // 保留單續保／取消 快速動作連結（帳齡通知裡的按鈕點進來會走這裡，不用開整個網頁 app）
    // 這條路徑有自己的一次性簽章 token（_rsvResolveToken_），且常常是從手機 LINE 點進來、
    // 使用者可能沒登入 Google，所以不擋；但一律寫進操作記錄
    if (e.parameter.ac) {
      return handleReserveQuickAction_(e.parameter);
    }
    // 測試：保留超過 50% 的 TG 告警（?test=50pct&branch=gaoyaci）
    if (e.parameter.test === '50pct') {
      setBranch_(e.parameter.branch || '');
      const result = testReserveHalfAlert_();
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
    // 診斷：安帝嘉／喜悅納資料庫是否足以跑缺貨週報（?test=shortage&branch=antigravity）
    if (e.parameter.test === 'shortage') {
      const result = testBranchShortage_(e.parameter.branch || 'gaoyaci');
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 🔐 白名單守門：身分拿不到就只回封鎖頁，App 的 HTML 一律不外流
  // v2: 身分 = 版面神器的登入憑證 (網址 ?t=)；擁有者直接開則用 Google 帳號比對 (見 Service_Auth.js)
  const aitToken = String((e && e.parameter && e.parameter.t) || '');
  const identity = getIdentity_(aitToken);
  if (!identity.ok) {
    try { logAuditDenied_(identity.email, '開啟保留系統', identity.message || identity.reason); } catch (e2) { }
    return _authDeniedPage_(identity, (e && e.parameter) || {});
  }

  // 解析分公司參數（白名單驗證），寫入 ScriptProperties 供後端 getBranch_() 使用
  const branchParam = e && e.parameter && String(e.parameter.branch || '').toLowerCase();
  setBranch_(branchParam);
  const branch = getBranch_();

  // 🚀 秒進 (2026-10-01)：開頁時只畫頁面，其他都不做。
  //  - 排程檢查改成 6 小時一次 (以前每次開頁都檢查 4 個排程，每日日報還每次刪掉重建，要好幾秒)
  //  - 「開啟保留系統」記錄與使用時間改由頁面載好後呼叫 webGetData('log_open') 補寫
  try { ensureReserveTriggers_(); } catch (e) { console.log('排程檢查略過：' + e.message); }
  const sessionId = Utilities.getUuid();

  var template = HtmlService.createTemplateFromFile('Reserve_UI');
  var paramsJson = JSON.stringify((e && e.parameter) || {}).replace(/</g, '\\u003c');
  template.initialParamsJson = paramsJson;
  template.branchLabel = branch.label;
  template.branchBrand = branch.brand;
  template.sessionId = sessionId;
  template.aitToken = aitToken;
  template.userName = identity.name;
  template.userRole = identity.isKing ? 'KING' : identity.role;
  template.isKing = identity.isKing;
  return template.evaluate()
    .setTitle(branch.label + '缺貨日誌 — 保留單監控中心')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 保留系統的排程不存在就補建 (6 小時才真的檢查一次)。時間與原本的 setup 函式相同；
 * 排程要等搬移完成 (RSV_MIGRATED_IN) 才補建，避免跟舊專案同時發通知。
 */
function ensureReserveTriggers_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('rsv_triggers_ok')) return;
  if (!PropertiesService.getScriptProperties().getProperty('RSV_MIGRATED_IN')) return;
  const have = {};
  ScriptApp.getProjectTriggers().forEach(t => { have[t.getHandlerFunction()] = true; });
  if (!have.prewarmShortageBoard) ScriptApp.newTrigger('prewarmShortageBoard').timeBased().everyMinutes(5).create();
  if (!have.prewarmWarRoom) ScriptApp.newTrigger('prewarmWarRoom').timeBased().everyMinutes(5).create();
  if (!have.sendDailyNewReserves_) ScriptApp.newTrigger('sendDailyNewReserves_').timeBased().everyDays(1).atHour(19).nearMinute(5).inTimezone('Asia/Taipei').create();
  if (!have.sendNewShortageEntries) ScriptApp.newTrigger('sendNewShortageEntries').timeBased().everyDays(1).atHour(18).create();
  if (!have.recordDailyInventorySnapshot) ScriptApp.newTrigger('recordDailyInventorySnapshot').timeBased().everyDays(1).atHour(3).nearMinute(30).inTimezone('Asia/Taipei').create();
  cache.put('rsv_triggers_ok', '1', 21600);
}

function serveProductImage_(code) {
  // 產品圖片一律從高雅瓷主資料庫撈（安帝嘉／喜悅納共用同一份產品主檔），不受 CURRENT_BRANCH 影響
  setBranch_('gaoyaci');
  code = String(code).trim().toUpperCase().replace(/[\s\-]/g, '');
  const imgUrl = getProductImageUrl(code);
  if (imgUrl) {
    const displayUrl = imgUrl.indexOf('drive.google.com/thumbnail') !== -1
      ? imgUrl.replace('sz=w200', 'sz=w1000')
      : imgUrl;
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${code} 產品圖片</title>
          <style>
            body {
              margin: 0;
              background-color: #0b0b0c;
              color: #f3f4f6;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
              box-sizing: border-box;
            }
            .card {
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid rgba(255, 255, 255, 0.08);
              border-radius: 16px;
              padding: 24px;
              max-width: 95%;
              width: 500px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.5);
              text-align: center;
              backdrop-filter: blur(10px);
            }
            .code {
              font-size: 26px;
              font-weight: 800;
              color: #facc15;
              margin-bottom: 20px;
              letter-spacing: 0.5px;
              text-shadow: 0 0 12px rgba(250, 204, 21, 0.3);
            }
            .img-container {
              width: 100%;
              border-radius: 12px;
              overflow: hidden;
              background: rgba(0,0,0,0.2);
              border: 1px solid rgba(255,255,255,0.05);
              margin-bottom: 20px;
              display: flex;
              justify-content: center;
              align-items: center;
            }
            img {
              max-width: 100%;
              max-height: 60vh;
              display: block;
              object-fit: contain;
            }
            .btn {
              background: #facc15;
              color: #0b0b0c;
              border: none;
              padding: 12px 28px;
              border-radius: 8px;
              font-size: 15px;
              font-weight: 700;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
              transition: all 0.2s ease;
              box-shadow: 0 4px 12px rgba(250, 204, 21, 0.2);
            }
            .btn:hover {
              background: #eab308;
              transform: translateY(-1px);
              box-shadow: 0 6px 16px rgba(250, 204, 21, 0.3);
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="code">${code}</div>
            <div class="img-container">
              <img src="${displayUrl}" alt="${code}">
            </div>
            <div>
              <a href="${displayUrl}" target="_blank" class="btn">查看原圖</a>
            </div>
          </div>
        </body>
        </html>
      `;
      return HtmlService.createHtmlOutput(html)
        .setTitle(code + ' 產品圖片')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    } else {
      return HtmlService.createHtmlOutput('<body style="background:#0b0b0c;color:#fff;text-align:center;padding-top:100px;font-family:sans-serif;"><h3>❌ 未找到該產品的圖片</h3></body>');
    }
}

function webGetData(action, payload) {
  // 🔐 伺服器端再驗一次身分。前端拿不到 App 本身（doGet 已擋），但保險起見這裡不信任任何前端欄位
  const identity = getIdentity_(String((payload && payload.__t) || ''));
  if (!identity.ok) {
    try { logAuditDenied_(identity.email, action, identity.message || identity.reason); } catch (e) { }
    return { error: 'AUTH_REQUIRED｜' + (identity.message || '沒有使用權限'), authRequired: true, reason: identity.reason };
  }
  const sessionId = (payload && payload.__sid) || '';

  try {
    // 前端每次呼叫都帶 __branch（見 index.html webGetData 呼叫鏈），這裡先確認目前分支，
    // 避免併發使用者／背景觸發器改動 CURRENT_BRANCH 造成資料或通知送錯公司
    // （google.script.run 是大小寫敏感的：前端鏈為 .webGetData(...)，函式名必須完全同名）
    const reqBranch = payload && String(payload.__branch || '').toLowerCase();
    if (reqBranch) {
      setBranch_(reqBranch);
      try { _auditSwitchBranch_(sessionId, getBranch_().label); } catch (e) { }
    }
    if (action === 'log_open') { // 頁面載好後才寫「開啟保留系統」記錄 (不擋開頁速度)
      try { _auditLogLogin_(identity, sessionId); } catch (e) { console.log('登入記錄略過：' + e.message); }
      return { success: true };
    }
    if (action === 'auth_heartbeat') {
      _auditHeartbeat_(sessionId);
      return { success: true, isKing: identity.isKing, name: identity.name, role: identity.role };
    }
    if (action === 'get_audit_logs')   return getAuditLogs_(identity, payload);
    if (action === 'test_get_sheets')    return testGetSheets();
    if (action === 'get_inventory_history') return getInventoryHistory_(payload && payload.code, payload && payload.days);
    if (action === 'run_inventory_snapshot') return identity.isKing ? (recordDailyInventorySnapshot(), { success: true }) : { error: '僅主管可用' };
    if (action === 'get_reserve_data')   return getReserveData();
    if (action === 'update_progress')    return rsvAudited_(identity, sessionId, action, payload, () => updateReserveProgress_(payload.siteKey, payload.status, payload.progress, payload.salesRep, payload.productCodes, payload.actionType, payload.reason));
    if (action === 'delete_product')     return rsvAudited_(identity, sessionId, action, payload, () => deleteProductRow_(payload.siteKey, payload.productCode, identity.name));
    if (action === 'get_restock_alerts') return getRestockAlerts();
    if (action === 'get_shortage_board') return getShortageBoardData();
    if (action === 'update_shortage_tracking') return rsvAudited_(identity, sessionId, action, payload, () => updateShortageTracking_(payload));
    if (action === 'add_shortage_tracking') return rsvAudited_(identity, sessionId, action, payload, () => addShortageTrackingManual_(payload));
    if (action === 'confirm_discontinue') return rsvAudited_(identity, sessionId, action, payload, () => confirmDiscontinueProduct_(payload));
    if (action === 'close_shortage_product') return rsvAudited_(identity, sessionId, action, payload, () => closeShortageProduct_(payload));
    if (action === 'confirm_safe_stock') return rsvAudited_(identity, sessionId, action, payload, () => confirmSafeStock_(payload));
    if (action === 'generate_restock_order_list') return rsvAudited_(identity, sessionId, action, payload, () => generateRestockOrderList_());
    if (action === 'run_product_analysis') return rsvAudited_(identity, sessionId, action, payload, () => runProductAnalysis_());
    if (action === 'get_war_room_data')    return getWarRoomData();
    if (action === 'get_product_insight')  return getProductInsight(payload && payload.code);
    if (action === 'get_product_insight_batch') return getProductInsightBatch(payload && payload.codes, payload && payload.force);
    if (action === 'get_probation_entry_dates') return getProbationEntryDates();
    if (action === 'send_war_room_email')  return rsvAudited_(identity, sessionId, action, payload, () => sendWarRoomEmail_());
    return { error: '未知動作: ' + action };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 變動類動作的外殼：執行 → 寫操作記錄（誰／什麼動作／對象／結果）→ 回傳原結果。
 * 記錄失敗不回拋，避免稽核問題拖垮正常功能。
 */
function rsvAudited_(identity, sessionId, action, payload, fn) {
  const label = RSV_AUDIT_ACTIONS[action] || action;
  const target = _rsvAuditTarget_(action, payload);
  let result = null, err = null;
  try {
    result = fn();
  } catch (e) {
    err = e;
  }
  const status = err ? '失敗'
    : (result && (result.success === false || result.ok === false)) ? '失敗'
    : (result && result.duplicated) ? '重複送出（已略過）'
    : '成功';
  const detail = err ? (err.message || String(err))
    : (result && (result.error || result.message)) ? String(result.error || result.message)
    : _rsvAuditDetail_(action, payload, result);
  try { logAuditAction_(identity, sessionId, label, target, detail, status); } catch (e2) { }
  if (err) throw err;
  return result;
}

function _rsvAuditTarget_(action, payload) {
  const p = payload || {};
  if (action === 'update_progress' || action === 'delete_product') {
    return _rsvShortSiteKey_(p.siteKey);
  }
  if (action === 'update_shortage_tracking' || action === 'confirm_discontinue' || action === 'close_shortage_product') {
    return String(p.code || p.productCode || '').trim();
  }
  if (action === 'confirm_safe_stock') return String(p.code || '').trim();
  if (action === 'add_shortage_tracking') return String(p.code || p.productCode || '').trim();
  return '';
}

/** 工地代號太長，只留前後段方便辨識 */
function _rsvShortSiteKey_(siteKey) {
  const s = String(siteKey || '').trim();
  if (!s) return '';
  if (s.length <= 30) return s;
  return s.slice(0, 18) + '…' + s.slice(-8);
}

function _rsvAuditDetail_(action, payload, result) {
  const p = payload || {};
  if (action === 'update_progress') {
    return '進度→' + (p.progress || p.status || '（清空）') + (p.actionType ? '｜' + p.actionType : '') + (p.reason ? '｜原因：' + p.reason : '');
  }
  if (action === 'delete_product') return '刪除品項 ' + (p.productCode || '');
  if (action === 'add_shortage_tracking') return '新增追蹤 ' + (p.code || p.productCode || '');
  if (result && result.message) return String(result.message);
  if (result && typeof result.count === 'number') return '共 ' + result.count + ' 筆';
  return '';
}

function testGetSheets() {
  const ss = SpreadsheetApp.openById(getBranch_().reserveSS);
  const sheets = ss.getSheets().map(s => s.getName());
  const sh = ss.getSheetByName(getBranch_().sheetName) || ss.getSheets()[0];
  const headers = sh ? sh.getDataRange().getValues()[0] : [];
  console.log('Sheets:', sheets);
  console.log('Headers:', headers);
  return { sheets: sheets, headers: headers };
}
