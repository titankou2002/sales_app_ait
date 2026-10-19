/**
 * 保留系統 — 登入與操作記錄（2026-09-30 併入版面神器，原獨立 GAS 只做轉址）
 *
 * 保留系統是版面神器的一頁 (?view=reserve)，嵌在首頁「保留日誌」裡，不另外管帳號、不另外登入：
 *  1. 版面神器打開保留日誌時，網址帶上版面神器的登入憑證 (?t=...)，這裡直接用 Auth.js 的 _aitRequire_ 驗證。
 *     帳號來源 = 鈦傳速物流「系統白名單」(與版面神器、物流共用)，停用、改身分都在那裡改。
 *  2. 前端每次 webGetData 都帶 __t (憑證，Reserve_UI 會自動補)，後端每次都驗。
 *  3. 系統擁有者直接開 GAS 網址 (沒有憑證) 時，用 Google 帳號 Email 比對物流白名單，方便維護。
 *  4. 操作記錄寫進「鈦傳速_操作記錄」本月分頁 (與物流、版面神器同一格式，系統欄 =「版面神器」，功能代號 reserve:*)；
 *     使用時間寫進「版面神器_使用時間」 (只算畫面開著且有在操作的時間)，由物流每天 20:00 發 Telegram 日報。
 * 舊的「保留系統_帳號」「保留系統_操作記錄」分頁已不用 (第一次執行時自動刪除)。
 */

const AUTH_SS_ID = '1N-tOQEP26akmcGRV34OwDusg0yFrtKfnJ79W3O-uNLM';            // 鈦傳速_操作記錄
const LOGIS_SS_ID = '1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA';           // 鈦傳速物流主資料庫 (系統白名單)
const RSV_ALLOWED_TITLES = ['主管', '行政', '業務', '倉管'];
const RSV_USAGE_SHEET = '版面神器_使用時間';
const RSV_USAGE_HEADERS = ['日期', '姓名', '職位', '分公司', '開啟次數', '實際使用(分)', '第一次', '最後'];
const RSV_AUDIT_HEADERS = ['時間', '人員', '角色', '分公司', '動作', '對象', '內容', '修改前 → 修改後', '結果', '錯誤訊息', '耗時(ms)', '功能代號', '系統'];
const KING_LEVELS = ['KING', '主管'];

var __RSV_IDENTITY__ = null; // 這次請求驗證過的身分 (webGetData 設定，Service_Reserve 的 getCurrentUserLabel_ 會用)

function _isKingLevel_(level) { return KING_LEVELS.indexOf(String(level || '').trim()) !== -1; }

function _htmlEsc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ───────── 身分 ─────────

/** 版面神器的登入憑證 → 身分 (同一個專案，直接用 Auth.js 驗證，不必再繞網路) */
function _verifyAitToken_(token) {
  token = String(token || '');
  if (!token || token.length > 3000) return null;
  try {
    const c = _aitRequire_(token, 'staff');
    return { valid: true, name: c.name, title: c.title, branch: c.branch, isKing: c.title === '主管' };
  } catch (e) {
    return { valid: false, message: String((e && e.message) || e) };
  }
}

/** 擁有者直接開 GAS 網址時：Google 帳號 Email 比對物流白名單 */
function _identityByEmail_() {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) { }
  if (!email) return null;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('RSV_EMAIL_' + email);
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  const data = SpreadsheetApp.openById(LOGIS_SS_ID).getSheetByName('系統白名單').getDataRange().getValues();
  const h = data[0].map(v => String(v).trim());
  const c = n => h.indexOf(n);
  let out = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][c('Email帳號')] || '').trim().toLowerCase() !== email) continue;
    out = { valid: String(data[i][c('帳號啟用')]).trim() !== '否', name: String(data[i][c('姓名')] || '').trim(), title: String(data[i][c('身分類型')] || '').trim(), branch: String(data[i][c('所屬分公司')] || '').trim(), email: email };
    out.isKing = out.title === '主管';
    break;
  }
  if (out) cache.put('RSV_EMAIL_' + email, JSON.stringify(out), 120);
  return out;
}

/**
 * 取得目前使用者身分。token = 版面神器登入憑證 (網址 ?t= 或 webGetData 的 __t)。
 * 回傳 { ok:true, name, role, isKing, branch, title } 或 { ok:false, reason, message }
 */
function getIdentity_(token) {
  if (!token && __RSV_IDENTITY__) return __RSV_IDENTITY__;
  const r = token ? _verifyAitToken_(token) : _identityByEmail_();
  if (!r) return { ok: false, reason: 'no_session', email: '', message: '請從版面神器（高雅瓷業務 APP）的「保留日誌」進入' };
  if (!r.valid) return { ok: false, reason: 'disabled', email: '', message: r.message ? String(r.message).replace(/^.*：/, '') : '帳號已停用或不在白名單' };
  if (RSV_ALLOWED_TITLES.indexOf(r.title) === -1) return { ok: false, reason: 'not_allowed', email: '', message: '你的帳號（' + r.title + '）不能使用保留系統' };
  const id = { ok: true, email: r.email || '', name: r.name, title: r.title, role: r.isKing ? 'KING' : r.title, isKing: !!r.isKing, branch: r.branch, salesCode: '' };
  __RSV_IDENTITY__ = id;
  return id;
}

/** 未授權時顯示的封鎖頁 */
function _authDeniedPage_(identity, params) {
  const title = identity.reason === 'no_session' ? '請從版面神器進入' : '沒有使用權限';
  const q = Object.keys(params || {}).filter(k => ['t', 'view', 'r'].indexOf(k) === -1).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const loginUrl = rsvAppLink_(q || 'tab=reserve');
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + '</title><style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0c;color:#f3f4f6;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans TC",sans-serif;padding:24px;}' +
    '.card{max-width:460px;width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);' +
    'border-radius:16px;padding:32px;text-align:center;}.icon{font-size:44px;margin-bottom:8px;}.t{font-size:22px;font-weight:800;margin:0 0 10px;}' +
    '.m{font-size:15px;line-height:1.7;color:#cbd5e1;margin:0;}</style></head><body><div class="card">' +
    '<div class="icon">🔒</div><p class="t">' + title + '</p><p class="m">' + _htmlEsc_(identity.message || '') + '</p>' +
    (identity.reason === 'no_session' ? '<a href="' + _htmlEsc_(loginUrl) + '" target="_top" style="display:inline-block;margin-top:18px;padding:12px 22px;border-radius:10px;background:#facc15;color:#000;font-weight:800;text-decoration:none">前往版面神器登入</a>' : '') +
    '</div></body></html>'
  ).setTitle(title).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ───────── 操作記錄 (鈦傳速_操作記錄 本月分頁；與物流 AuditLog.js、版面神器 Auth.js 同一段寫法) ─────────

function _auditFmt_(date) { return Utilities.formatDate(date || new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'); }

function _rsvLog_(o) {
  try {
    _removeOldAuthTabs_();
    const id = o.identity || {};
    _auditPutRow_([
      _auditFmt_(), o.who || id.name || '（未登入）', id.title || '', id.branch || '',
      o.label || '', String(o.target || '').slice(0, 120), String(o.detail || '').slice(0, 1500), '',
      o.status || '成功', o.error || '', o.ms || 0, 'reserve:' + (o.fn || ''), '版面神器'
    ]);
  } catch (e) { console.error('操作記錄寫入失敗：' + (e && e.message)); }
}

/** 開啟保留系統 (doGet 通過驗證時) */
function _auditLogLogin_(identity, sessionId) {
  _rsvLog_({ identity: identity, label: '開啟保留系統', target: _currentBranchLabel_(), fn: 'open' });
  _rsvUsageAdd_(identity, 0, 1);
  return 1;
}

/** 心跳：前端只在畫面開著、而且最近有操作時才送 (每 3 分鐘) → 算 3 分鐘使用時間 */
function _auditHeartbeat_(sessionId) {
  const id = __RSV_IDENTITY__;
  if (id && id.ok) _rsvUsageAdd_(id, 3, 0);
  return 1;
}

function _auditSwitchBranch_(sessionId, label) { return 0; }

function _currentBranchLabel_() {
  try { return getBranch_().label; } catch (e) { return ''; }
}

/** 變動事件：webGetData 的寫入動作統一走這裡 */
function logAuditAction_(identity, sessionId, label, target, detail, status) {
  if (!identity || !identity.ok) return;
  const failed = status === '失敗';
  _rsvLog_({ identity: identity, label: label, target: target, detail: failed ? '' : detail, status: status || '成功', error: failed ? String(detail || '').slice(0, 300) : '', fn: 'action' });
}

/** 未授權的呼叫也要留痕 */
function logAuditDenied_(email, action, reason) {
  _rsvLog_({ who: '（未登入／憑證無效）', label: String(action || ''), status: '拒絕', error: String(reason || ''), fn: 'denied' });
}

/** KING 專用：查操作記錄 (本月分頁裡的保留系統記錄，換成舊格式給前端顯示) */
function getAuditLogs_(identity, payload) {
  if (!identity || !identity.ok) return { success: false, error: '未登入' };
  if (!identity.isKing) return { success: false, error: '只有主管可以查看操作記錄' };
  const sh = _auditSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { success: true, total: 0, rows: [] };
  const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 200, 1), 1000);
  const values = sh.getRange(2, 1, Math.min(lastRow - 1, 5000), RSV_AUDIT_HEADERS.length).getDisplayValues();
  const rows = values.filter(r => String(r[11]).indexOf('reserve:') === 0).slice(0, limit).map(r => ({
    '時間': r[0], '登入時間': r[0], 'Session': '', 'Email': '', '姓名': r[1], '權限等級': r[2], '分公司': r[3],
    '事件': r[11] === 'reserve:open' ? '登入' : (r[8] === '拒絕' ? '拒絕' : '變動'),
    '動作/對象': r[4] + (r[5] ? '｜' + r[5] : ''), '內容': r[6] || r[9], '結果': r[8]
  }));
  return { success: true, total: rows.length, rows: rows };
}

/** 舊的「保留系統_帳號」「保留系統_操作記錄」分頁已經不用，第一次執行時刪掉 (使用者要求) */
function _removeOldAuthTabs_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('RSV_OLD_TABS_REMOVED')) return;
  try {
    const ss = SpreadsheetApp.openById(AUTH_SS_ID);
    ['保留系統_帳號', '保留系統_操作記錄'].forEach(n => { const s = ss.getSheetByName(n); if (s) ss.deleteSheet(s); });
    props.setProperty('RSV_OLD_TABS_REMOVED', new Date().toISOString());
  } catch (e) { console.warn('刪除舊分頁失敗：' + e.message); }
}

// ───────── 使用時間 (與版面神器同一個分頁) ─────────
function _rsvUsageAdd_(id, addMin, addOpen) {
  if (!id || !id.name) return;
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(3000)) return;
    const ss = SpreadsheetApp.openById(AUTH_SS_ID);
    let sh = ss.getSheetByName(RSV_USAGE_SHEET);
    if (!sh) {
      try { sh = ss.insertSheet(RSV_USAGE_SHEET); } catch (e) { sh = ss.getSheetByName(RSV_USAGE_SHEET); }
      if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, RSV_USAGE_HEADERS.length).setValues([RSV_USAGE_HEADERS]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
    }
    const now = new Date();
    const day = Utilities.formatDate(now, 'GMT+8', 'yyyy/MM/dd'), hm = Utilities.formatDate(now, 'GMT+8', 'HH:mm');
    const last = sh.getLastRow();
    const from = Math.max(2, last - 300);
    let hit = -1;
    if (last >= 2) {
      const keys = sh.getRange(from, 1, last - from + 1, 2).getDisplayValues();
      for (let i = keys.length - 1; i >= 0; i--) { if (keys[i][0] === day && keys[i][1] === id.name) { hit = from + i; break; } }
    }
    if (hit === -1) {
      sh.appendRow(["'" + day, id.name, id.title || '', id.branch || '', addOpen || 0, addMin || 0, "'" + hm, "'" + hm]);
    } else {
      const r = sh.getRange(hit, 5, 1, 4).getValues()[0];
      sh.getRange(hit, 5, 1, 4).setValues([[(Number(r[0]) || 0) + (addOpen || 0), (Number(r[1]) || 0) + (addMin || 0), r[2] instanceof Date ? "'" + Utilities.formatDate(r[2], 'GMT+8', 'HH:mm') : r[2], "'" + hm]]);
    }
  } catch (e) {
    console.warn('使用時間寫入失敗：' + (e && e.message));
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

// 寫入記錄檔 (_auditSheet_ / _auditPutRow_ …) 用版面神器 Auth.js 那份 (同一個試算表、同一組欄位)
