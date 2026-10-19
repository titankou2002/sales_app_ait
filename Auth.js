/**
 * 🔐 AIT 業務端登入 + 操作記錄（v2，2026-09-30，取代 @578 的 Google Email 守門版）
 *
 * 帳號：不在這裡管，共用「鈦傳速物流」的「系統白名單」(姓名／身分類型／所屬分公司／帳號啟用／Email帳號／line id)。
 *   1. bigt.cc/ait/inventory.html 外殼頁放 LINE / Google 登入 (Google、LINE 都只認登記過的 bigt.cc)，
 *      拿到身分證明後用 postMessage 交給 iframe 裡的頁面 → aitLogin()。
 *   2. aitLogin 把身分證明轉給物流系統 (doPost ?ait=1) 驗證並查白名單，回傳本人的姓名／身分／分公司；
 *      通過就發這個專案自己的登入憑證 (HMAC 簽章，30 天，常用自動延長)。
 *      白名單沒有這個人 → 填申請 (aitApply) → 同樣轉給物流系統 → 依分公司發 Telegram，主管按鈕核准。
 *   3. 每個後端功能都經過 _aitCall_ (AitGuard.js 自動產生的同名外殼，原函式改名 xxx_impl_)：
 *      前端 JS_AitAuth 會在每次 google.script.run 最後自動多帶一個 {__ait: 憑證}，這裡驗證後才執行，
 *      並把會改資料的動作寫進「鈦傳速_操作記錄」(與物流共用，系統欄 =「版面神器」)。
 *   4. 停用／改身分：直接改物流白名單，60 秒內所有裝置失效。
 *
 * 權限分級 (AitGuard.js 的 AIT_SPECS.tier)：
 *   open  客戶端 (view=client) 用的，維持原本金鑰制，不必登入
 *   staff 登入就能用：主管、行政、業務、倉管 (司機不行)
 *   admin 主管、行政 (全知視角)
 *   king  只有主管 (機密中心：金鑰、客戶白名單、出勤、請假、薪資、獎金)
 *   sys   排程觸發 (預熱、每日同步、LINE 佇列)，內部呼叫一律放行
 */

var AIT_LOGIS_EXEC = 'https:' + '/' + '/script.google.com/macros/s/AKfycbz3DuFG6dOC5O0aXQ-7Ng6SOH-Su3MYQe7iVid5OuMFCKTDQ70ecxzror78asPHfiyUTw/exec';
var AIT_LOGIS_SS_ID = '1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA';   // 鈦傳速物流主資料庫 (系統白名單)
var AIT_AUDIT_SS_ID = '1N-tOQEP26akmcGRV34OwDusg0yFrtKfnJ79W3O-uNLM';   // 鈦傳速_操作記錄 (物流共用)
var AIT_TOKEN_TTL_SEC = 30 * 86400;
var AIT_ALLOWED_TITLES = ['主管', '行政', '業務', '倉管'];

var __AIT_CTX__ = null;     // 這次請求是誰 (驗證通過後才有)
var __AIT_DEPTH__ = 0;      // >0 代表是後端內部互相呼叫，不再驗證
var __AIT_SYS__ = false;    // doGet / doPost / 排程觸發 → 內部呼叫放行

// ───────── 登入憑證 ─────────
function _aitSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('AIT_SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('AIT_SESSION_SECRET', s); }
  return s;
}
function _aitB64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function _aitSign_(p) { return _aitB64_(Utilities.computeHmacSha256Signature(p, _aitSecret_())); }
function _aitIssue_(payload) {
  var now = Date.now(), body = {};
  for (var k in payload) body[k] = payload[k];
  body.iat = now; body.exp = now + AIT_TOKEN_TTL_SEC * 1000;
  var p = _aitB64_(Utilities.newBlob(JSON.stringify(body)).getBytes());
  return p + '.' + _aitSign_(p);
}
function _aitParse_(token) {
  if (!token || typeof token !== 'string' || token.length > 3000) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var sig = _aitSign_(parts[0]);
  if (sig.length !== parts[1].length) return null;
  var diff = 0;
  for (var i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ parts[1].charCodeAt(i);
  if (diff !== 0) return null;
  try {
    var pad = parts[0] + '==='.slice((parts[0].length + 3) % 4);
    var body = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch (e) { return null; }
}

// ───────── 物流白名單：帳號目前狀態 (停用／改身分 60 秒內生效) ─────────
// 開 App 時同時有 5~6 個請求：以前快取一過 60 秒，每個請求都各自整本打開物流主資料庫 (很大，每次 1~3 秒)。
// 現在：60 秒內直接用快取；超過 60 秒只讓一個請求去重讀，其他請求先用前一份 (最舊 10 分鐘)，停用仍約 1 分鐘生效。
var AIT_ACCT_FRESH_MS = 60 * 1000;
var AIT_ACCT_STALE_MS = 10 * 60 * 1000;

function _aitStatusMap_(fresh) {
  var cache = CacheService.getScriptCache();
  var now = Date.now();
  if (!fresh) {
    var hit = null;
    try { hit = JSON.parse(cache.get('ait_acct_status_v2') || 'null'); } catch (e) { }
    if (hit && hit.map && now - hit.at < AIT_ACCT_STALE_MS) {
      if (now - hit.at < AIT_ACCT_FRESH_MS || cache.get('ait_acct_refreshing')) return hit.map;
      try { cache.put('ait_acct_refreshing', '1', 20); } catch (e) { }
    }
  }
  var map = _aitReadAcctMap_();
  try { cache.put('ait_acct_status_v2', JSON.stringify({ at: now, map: map }), 21600); } catch (e) { }
  try { cache.remove('ait_acct_refreshing'); } catch (e) { }
  return map;
}

/** 只讀「系統白名單」這一頁 (Sheets API，不必整本打開物流主資料庫)；API 失敗才用舊寫法 */
function _aitReadAcctMap_() {
  var data = null;
  try {
    if (typeof Sheets !== 'undefined') data = Sheets.Spreadsheets.Values.get(AIT_LOGIS_SS_ID, "'系統白名單'").values;
  } catch (e) { console.warn('白名單 Sheets API 讀取失敗，改用一般寫法：' + (e && e.message)); }
  if (!data || !data.length) data = SpreadsheetApp.openById(AIT_LOGIS_SS_ID).getSheetByName('系統白名單').getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  var col = function (names) { for (var i = 0; i < names.length; i++) { var k = h.indexOf(names[i]); if (k !== -1) return k; } return -1; };
  var cA = col(['帳號啟用']), cE = col(['Email帳號', 'Email', '電郵']), cN = col(['姓名']), cT = col(['身分類型']), cB = col(['所屬分公司', '分公司']);
  var cL = -1; h.forEach(function (x, i) { if (cL === -1 && /^line\s*_?\s*id$/i.test(x)) cL = i; });
  var map = {};
  for (var r = 1; r < data.length; r++) {
    var g = function (c) { return c === -1 ? '' : String(data[r][c] == null ? '' : data[r][c]).trim(); };
    var st = { active: g(cA) !== '否', title: g(cT), name: g(cN), branch: g(cB) };
    var keys = [];
    if (g(cE)) keys.push(g(cE).toLowerCase());
    if (g(cL)) keys.push('line:' + g(cL));
    keys.forEach(function (k) { map[k] = map[k] ? { active: false, title: '', dup: true } : st; }); // 重複身分一律擋
  }
  return map;
}
function _aitKeyOf_(s) { return s.v === 'line' ? 'line:' + s.l : String(s.e || '').toLowerCase(); }

/** 驗證憑證 + 確認帳號仍有效 + 權限等級；回傳 {name,title,branch,...} */
function _aitRequire_(token, tier) {
  var s = _aitParse_(token);
  if (!s) throw new Error('🔒 AUTH_REQUIRED：請先用 Google 登入');
  var key = _aitKeyOf_(s);
  var st = _aitStatusMap_()[key];
  if (!st) st = _aitStatusMap_(true)[key]; // 剛核准／剛綁定的人：快取裡還沒有，重讀一次最新白名單
  if (!st || !st.active) throw new Error('🔒 AUTH_REQUIRED：此帳號已停用或不在白名單，請聯繫主管');
  if (st.title !== s.t) throw new Error('🔒 AUTH_REQUIRED：你的權限已變更，請重新登入');
  if (AIT_ALLOWED_TITLES.indexOf(s.t) === -1) throw new Error('🔒 AUTH_FORBIDDEN：你的帳號不能使用業務系統');
  if (tier === 'king' && s.t !== '主管') throw new Error('🔒 AUTH_FORBIDDEN：只有主管可以使用這個功能');
  if (tier === 'admin' && s.t !== '主管' && s.t !== '行政') throw new Error('🔒 AUTH_FORBIDDEN：只有主管、行政可以使用這個功能');
  return { name: s.n, title: s.t, branch: s.b, via: s.v, email: s.e || '', lineId: s.l || '', lt: s.lt, iat: s.iat };
}

// ───────── 身分證明驗證 (與物流 Accounts.js 相同規則；在這裡直接驗，不必繞物流系統) ─────────
var AIT_GOOGLE_CLIENT_ID = '488092523611-2012hnf14cch4s7p6sl3dp37dvihjsdm.apps.googleusercontent.com';
var AIT_LINE_CHANNEL_ID = '2007666611';

function _aitVerifyIdentity_(idToken, provider) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 6000 || idToken.split('.').length !== 3) throw new Error('登入資料無效，請重新登入');
  if (provider === 'line') {
    var r = UrlFetchApp.fetch('https:' + '/' + '/api.line.me/oauth2/v2.1/verify', { method: 'post', payload: { id_token: idToken, client_id: AIT_LINE_CHANNEL_ID }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('LINE 登入驗證失敗，請重新登入');
    var p = JSON.parse(r.getContentText());
    if (String(p.aud) !== AIT_LINE_CHANNEL_ID || p.iss !== 'https:' + '/' + '/access.line.me' || !p.sub || Number(p.exp) * 1000 < Date.now()) throw new Error('LINE 登入驗證失敗，請重新登入');
    return { key: 'line:' + String(p.sub), email: '', lineId: String(p.sub), via: 'line' };
  }
  var g = UrlFetchApp.fetch('https:' + '/' + '/oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (g.getResponseCode() !== 200) throw new Error('Google 登入驗證失敗，請重新登入');
  var q = JSON.parse(g.getContentText());
  if (q.aud !== AIT_GOOGLE_CLIENT_ID || ['accounts.google.com', 'https:' + '/' + '/accounts.google.com'].indexOf(q.iss) === -1 || String(q.email_verified) !== 'true' || Number(q.exp) * 1000 < Date.now() || !q.email) throw new Error('Google 登入驗證失敗，請重新登入');
  var em = String(q.email).trim().toLowerCase();
  return { key: em, email: em, lineId: '', via: 'google' };
}

// ───────── 登入／申請：白名單找得到就直接發憑證；找不到才轉給物流系統 (申請狀態、送申請) ─────────
function _aitLogis_(body) {
  var resp = UrlFetchApp.fetch(AIT_LOGIS_EXEC + '?ait=1', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true, followRedirects: true
  });
  var txt = resp.getContentText();
  try { return JSON.parse(txt); } catch (e) { throw new Error('帳號系統暫時連不上，請稍後再試'); }
}

function _aitSessionInfo_(s, token) {
  return {
    status: 'ok', token: token, name: s.n, title: s.t, branch: s.b, via: s.v, email: s.e || '',
    loginAt: s.lt || s.iat, expiresAt: s.exp, salesKey: getSalesDirectKey(s.n),
    canSwitch: s.t === '主管' || s.t === '行政', isKing: s.t === '主管'
  };
}

/** 前端登入：idToken 是外殼頁拿到的 LINE / Google 身分證明 */
function aitLogin(idToken, provider) {
  var t0 = Date.now();
  __AIT_CTX__ = null;
  provider = provider === 'line' ? 'line' : 'google';
  var res;
  try {
    var ident = _aitVerifyIdentity_(String(idToken || ''), provider);
    var st = _aitStatusMap_(true)[ident.key];
    if (st && st.dup) res = { status: 'error', message: '這個帳號在白名單出現多次，請主管修正後再登入' };
    else if (st && !st.active) res = { status: 'disabled', name: st.name, message: '你的帳號已停用，請聯繫主管' };
    else if (st) res = { status: 'ok', name: st.name, title: st.title, branch: st.branch, email: ident.email, lineId: ident.lineId, via: ident.via };
    else res = _aitLogis_({ op: 'login', idToken: String(idToken || ''), provider: provider }); // 查不到 → 問物流：申請中／要申請
    if (res && res.status === 'ok') {
      if (AIT_ALLOWED_TITLES.indexOf(res.title) === -1) {
        res = { status: 'error', name: res.name, message: '你的帳號（' + res.name + '／' + res.title + '）不能使用業務系統' };
      } else {
        var payload = { n: res.name, t: res.title, b: res.branch, v: res.via, lt: Date.now() };
        if (res.email) payload.e = res.email;
        if (res.lineId) payload.l = res.lineId;
        var token = _aitIssue_(payload);
        __AIT_CTX__ = { name: res.name, title: res.title, branch: res.branch };
        res = _aitSessionInfo_(_aitParse_(token), token);
        _aitUsageAdd_(res.name, res.title, res.branch, 0, 1);
      }
    }
  } catch (e) {
    res = { status: 'error', message: e.message };
  }
  _aitLog_({ label: '登入', who: res && (res.name || res.email), target: provider === 'line' ? 'LINE' : 'Google', result: res, ms: Date.now() - t0, fn: 'aitLogin' });
  return res;
}

/** 新人申請 (白名單還沒有的人) */
function aitApply(idToken, form, provider) {
  try { return _aitLogis_({ op: 'apply', idToken: String(idToken || ''), form: form || {}, provider: provider === 'line' ? 'line' : 'google' }); }
  catch (e) { return { status: 'error', message: e.message }; }
}

/** 開頁時確認憑證還有效；用超過 1 天就換發新的 (常用的人幾乎不用再登入) */
function aitCheck(token) {
  try {
    _aitRequire_(token, 'staff');
    var s = _aitParse_(token);
    var out = _aitSessionInfo_(s, token);
    out.valid = true;
    _aitUsageAdd_(s.n, s.t, s.b, 0, 1); // 開啟 App 一次
    if (Date.now() - s.iat > 86400000) {
      var p = { n: s.n, t: s.t, b: s.b, v: s.v, lt: s.lt };
      if (s.e) p.e = s.e;
      if (s.l) p.l = s.l;
      out.renewed = _aitIssue_(p);
      out.token = out.renewed;
    }
    return out;
  } catch (e) {
    return { valid: false, message: e.message };
  }
}

function aitLogout(token) {
  var s = _aitParse_(token);
  if (s) { __AIT_CTX__ = { name: s.n, title: s.t, branch: s.b }; _aitLog_({ label: '登出', fn: 'aitLogout', ms: 0 }); }
  return { success: true };
}

// ───────── 實際使用時間 (給每日 Telegram 日報用；日報由物流系統每天 20:00 發送) ─────────
var AIT_USAGE_SHEET = '版面神器_使用時間';
var AIT_USAGE_HEADERS = ['日期', '姓名', '職位', '分公司', '開啟次數', '實際使用(分)', '第一次', '最後'];

/** 前端每累積幾分鐘「畫面開著而且有在操作」就回報一次 */
function aitPing_impl_(minutes) {
  var ctx = __AIT_CTX__;
  if (!ctx) return { ok: false };
  var m = Math.max(0, Math.min(30, Math.floor(Number(minutes) || 0)));
  if (m) _aitUsageAdd_(ctx.name, ctx.title, ctx.branch, m, 0);
  return { ok: true };
}

function _aitUsageAdd_(name, title, branch, addMin, addOpen) {
  if (!name) return;
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(5000)) return;
    var ss = SpreadsheetApp.openById(AIT_AUDIT_SS_ID);
    var sh = ss.getSheetByName(AIT_USAGE_SHEET);
    if (!sh) {
      sh = ss.insertSheet(AIT_USAGE_SHEET);
      sh.getRange(1, 1, 1, AIT_USAGE_HEADERS.length).setValues([AIT_USAGE_HEADERS]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
    var now = new Date();
    var day = Utilities.formatDate(now, 'GMT+8', 'yyyy/MM/dd'), hm = Utilities.formatDate(now, 'GMT+8', 'HH:mm');
    var last = sh.getLastRow();
    var from = Math.max(2, last - 300);
    var hit = -1;
    if (last >= 2) {
      var keys = sh.getRange(from, 1, last - from + 1, 2).getDisplayValues();
      for (var i = keys.length - 1; i >= 0; i--) { if (keys[i][0] === day && keys[i][1] === name) { hit = from + i; break; } }
    }
    if (hit === -1) {
      sh.appendRow(["'" + day, name, title || '', branch || '', addOpen || 0, addMin || 0, "'" + hm, "'" + hm]);
    } else {
      var r = sh.getRange(hit, 5, 1, 4).getValues()[0];
      sh.getRange(hit, 5, 1, 4).setValues([[(Number(r[0]) || 0) + (addOpen || 0), (Number(r[1]) || 0) + (addMin || 0), r[2] instanceof Date ? "'" + Utilities.formatDate(r[2], 'GMT+8', 'HH:mm') : r[2], "'" + hm]]);
    }
  } catch (e) {
    console.warn('使用時間寫入失敗：' + (e && e.message));
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

// ───────── 所有後端功能的外殼 (AitGuard.js 產生) ─────────
function _aitCall_(name, impl, args) {
  var a = Array.prototype.slice.call(args);
  var tok = null;
  var last = a.length ? a[a.length - 1] : null;
  if (last && typeof last === 'object' && Object.prototype.hasOwnProperty.call(last, '__ait')) { tok = last.__ait; a.pop(); }
  var spec = AIT_SPECS[name] || { tier: 'staff' };

  // 後端內部互相呼叫、或 doGet/doPost/排程觸發 → 不再驗證
  if (__AIT_DEPTH__ > 0 || __AIT_SYS__) {
    __AIT_DEPTH__++;
    try { return impl.apply(this, a); } finally { __AIT_DEPTH__--; }
  }
  if (spec.tier === 'sys') {
    __AIT_SYS__ = true;
    return impl.apply(this, a);
  }

  var t0 = Date.now();
  if (spec.tier === 'open') {
    if (tok) { try { __AIT_CTX__ = _aitRequire_(tok, 'staff'); } catch (e0) { } }
  } else {
    try { __AIT_CTX__ = _aitRequire_(tok, spec.tier); }
    catch (eA) {
      var sx = _aitParse_(tok); // 權限不足時也記下是誰
      if (sx) __AIT_CTX__ = { name: sx.n, title: sx.t, branch: sx.b };
      _aitLog_({ label: spec.label || name, target: _aitTarget_(spec, a), result: null, err: eA, ms: 0, fn: name });
      throw eA;
    }
  }

  var result, err = null;
  __AIT_DEPTH__++;
  try {
    result = impl.apply(this, a);
    return result;
  } catch (e) {
    err = e;
    throw e;
  } finally {
    __AIT_DEPTH__--;
    if (spec.label) {
      try {
        var detail = '';
        if (!spec.noArgs) { try { detail = _aitDetail_(name, spec, a); } catch (eD) { } }
        _aitLog_({ label: spec.label, target: _aitTarget_(spec, a), detail: detail, result: result, err: err, ms: Date.now() - t0, fn: name });
      } catch (eL) { console.error('操作記錄寫入失敗：' + (eL && eL.message)); }
    }
  }
}

function _aitTarget_(spec, a) {
  try {
    if (spec.target) return _aitStr_(spec.target(a), 120);
    var x = a[0];
    if (typeof x === 'string' || typeof x === 'number') return _aitStr_(x, 60);
    if (x && typeof x === 'object') {
      var keys = ['customerName', 'custName', 'customer', 'clientName', 'name', 'empName', 'employeeName', 'sku'];
      for (var i = 0; i < keys.length; i++) if (x[keys[i]]) return _aitStr_(x[keys[i]], 60);
    }
    return '';
  } catch (e) { return ''; }
}

// ───────── 操作記錄 (與物流共用「鈦傳速_操作記錄」，欄位與物流 AuditLog.js 一致) ─────────
var AIT_AUDIT_HEADERS = ['時間', '人員', '角色', '分公司', '動作', '對象', '內容', '修改前 → 修改後', '結果', '錯誤訊息', '耗時(ms)', '功能代號', '系統'];

function _aitStr_(v, n) { var s = String(v == null ? '' : v).trim(); n = n || 60; return s.length > n ? s.slice(0, n) + '…' : s; }

/** 參數摘要：照片、檔案、登入憑證一律不記 */
function _aitSummary_(args) {
  var SECRET_KEY = /token|pwd|password|photo|img|image|b64|base64|blob|thumbnail|signature|__ait/i;
  var seen = 0;
  var clean = function (x, depth) {
    if (++seen > 400) return '…';
    if (x == null) return x;
    if (typeof x === 'string') {
      if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}={0,2}$/.test(x)) return '[登入憑證]';
      if (/^data:|^[A-Za-z0-9+\/=]{500,}$/.test(x)) return '[檔案]';
      return x.length > 120 ? x.slice(0, 120) + '…' : x;
    }
    if (typeof x !== 'object') return x;
    if (depth > 3) return '…';
    if (Array.isArray(x)) {
      var arr = x.slice(0, 15).map(function (y) { return clean(y, depth + 1); });
      if (x.length > 15) arr.push('…共 ' + x.length + ' 筆');
      return arr;
    }
    var o = {};
    Object.keys(x).forEach(function (k) { o[k] = SECRET_KEY.test(k) ? (x[k] ? '[略]' : '') : clean(x[k], depth + 1); });
    return o;
  };
  try {
    var s = JSON.stringify(Array.prototype.slice.call(args).map(function (a) { return clean(a, 0); }));
    return s.length > 1500 ? s.slice(0, 1500) + '…' : s;
  } catch (e) { return ''; }
}

// ───────── 操作記錄「內容」欄：寫成看得懂的中文句子 (2026-10-01，以前是整包 JSON) ─────────
// 客戶／對象已經在「對象」欄，這裡只寫做了什麼。座標、照片、裝置代號、列號這類雜訊不寫。

var AIT_KEY_LABELS_ = {
  date: '日期', customerName: '客戶', customer: '客戶', custName: '客戶', cust: '客戶', clientName: '客戶',
  content: '內容', result: '結果', note: '備註', reportNote: '備註', reason: '原因', remark: '備註',
  plateNumber: '車牌', route: '路線', startOdometer: '起始里程', endOdometer: '結束里程', fuelLiters: '加油(公升)', fuelAmount: '油資',
  type: '類別', isBusinessTrip: '出差', start: '開始', end: '結束', status: '狀態', newStatus: '新狀態',
  series: '系列', sku: '編號', code: '編號', productCode: '編號', qty: '數量', items: '品項', skus: '編號',
  site: '工地', projName: '案名', case: '案名', salesperson: '業務', salesName: '業務', salesRep: '業務',
  deposit: '訂金', amount: '金額', price: '單價', unitPrice: '單價', cost: '成本', peerPrice: '同行價',
  month: '月份', year: '年', name: '姓名', empName: '員工', employee: '員工', value: '數值', title: '標題'
};
var AIT_SKIP_KEY_ = /^(gps|location|lat|lng|latitude|longitude|deviceId|id|rowIdx|row|rowIndex|photo|photos|photoUrl|photoData|image|images|imageData|imagesJson|newPhotoData|onlinePhotoUrls|originalTime|bypassPassword|employeeName|timestamp|__ait)$|token|pwd|password|base64|blob|signature|thumbnail/i;

function _aitVal_(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+8', 'yyyy/MM/dd HH:mm');
  if (typeof v === 'string') {
    if (/^data:|^https?:/.test(v) || /^[A-Za-z0-9+\/=_-]{200,}$/.test(v)) return '';
    return _aitStr_(v.replace(/\s+/g, ' '), 80);
  }
  return String(v);
}
function _aitList_(v, n) {
  if (!Array.isArray(v)) return _aitVal_(v);
  var xs = v.map(function (x) { return x && typeof x === 'object' ? _aitItem_(x) : _aitVal_(x); }).filter(String);
  n = n || 10;
  return xs.slice(0, n).join('、') + (xs.length > n ? ' 等 ' + xs.length + ' 項' : '');
}
/** 一個物件 → 一小段中文。常見形狀特別處理：工作項目 (內容＋結果)、品項 (編號×數量) */
function _aitItem_(o) {
  if (!o || typeof o !== 'object') return _aitVal_(o);
  if (Array.isArray(o)) return _aitList_(o);
  var sku = o.sku || o.code || o.productCode;
  if (sku && (o.qty != null || o.quantity != null)) return sku + '×' + (o.qty != null ? o.qty : o.quantity);
  if (o.content != null && Object.keys(o).every(function (k) { return /^(content|result|onlinePhotoUrls|photo|photos|time)$/.test(k); })) {
    var c = _aitVal_(o.content), r = _aitVal_(o.result);
    return c + (r ? '（' + r + '）' : '');
  }
  return Object.keys(o).filter(function (k) { return !AIT_SKIP_KEY_.test(k); }).map(function (k) {
    var v = o[k], label = AIT_KEY_LABELS_[k];
    var txt = (v && typeof v === 'object') ? _aitList_(Array.isArray(v) ? v : [v]) : _aitVal_(v);
    if (!txt) return '';
    if (k === 'tasks') return txt;
    return label ? label + ' ' + txt : ''; // 不認得的欄位不寫 (寫出來也只是看不懂的英文代號)
  }).filter(String).join('，');
}
/** 沒有專屬寫法的功能：把每個參數轉成中文，跳過已經寫在「對象」欄的客戶名 */
function _aitHuman_(args, target) {
  return Array.prototype.slice.call(args).map(function (x) {
    if (typeof x === 'string' && target && x === target) return '';
    if (x && typeof x === 'object') {
      var copy = Array.isArray(x) ? x : Object.keys(x).reduce(function (o, k) {
        if (!(target && x[k] === target && /cust|client/i.test(k))) o[k] = x[k];
        return o;
      }, {});
      return Array.isArray(copy) ? _aitList_(copy) : _aitItem_(copy);
    }
    return _aitVal_(x);
  }).filter(String).join('｜').slice(0, 500);
}

/** 常用功能的專屬寫法 (參數是一個一個傳的，光看值看不出意思) */
var AIT_DETAIL_ = {
  saveWorkLogBatch: function (a) {
    var p = a[0] || {};
    var list = Array.isArray(p) ? p : [p];
    return list.map(function (x) { return [_aitVal_(x.date), _aitList_(x.tasks || [])].filter(String).join(' '); }).filter(String).join('；');
  },
  updateWorkLog: function (a) {
    var p = a[0] || {};
    var moved = p.originalCustomer && p.originalCustomer !== p.customerName ? '客戶改成 ' + p.customerName + '；' : '';
    return [_aitVal_(p.date), moved + _aitVal_(p.content) + (p.result ? '（' + _aitVal_(p.result) + '）' : '')].filter(String).join(' ');
  },
  deleteWorkLogEntry: function (a) { var p = a[0] || {}; return '刪除 ' + (_aitVal_(p.time) || '') + ' 的工作日誌'; },
  saveDrivingFuelRecord: function (a) {
    var p = a[0] || {}, out = [_aitVal_(p.date)];
    if (p.plateNumber) out.push('車牌 ' + p.plateNumber);
    if (p.startOdometer || p.endOdometer) out.push('里程 ' + (p.startOdometer || '?') + ' → ' + (p.endOdometer || '?'));
    if (Number(p.fuelLiters) || Number(p.fuelAmount)) out.push('加油 ' + (p.fuelLiters || 0) + ' 公升／' + (p.fuelAmount || 0) + ' 元');
    if (p.route) out.push('路線 ' + _aitVal_(p.route));
    if (p.note) out.push(_aitVal_(p.note));
    return out.filter(String).join('，');
  },
  createReservation: function (a) {
    var p = a[0] || {};
    return [_aitList_(p.items || []), p.caseName ? '案名 ' + _aitVal_(p.caseName) : '', p.hasDeposit ? '已付訂' : '', p.note ? _aitVal_(p.note) : ''].filter(String).join('，');
  },
  getAdminBonusReport: function (a) { return _aitVal_(a[0]) + ' 年 ' + (Number(a[1]) + 1) + ' 月'; },
  saveNewLayout: function (a) { var p = a[0] || {}; return [p.series ? '系列 ' + p.series : '', _aitList_(p.items || [])].filter(String).join('：'); },
  updateLayoutFieldBatch: function (a) { return '把 ' + _aitList_(a[1] || []) + ' 的「' + _aitVal_(a[2]) + '」改成 ' + (_aitVal_(a[3]) || '（空白）'); },
  updateDisplayBatch: function (a) { return '陳列改成：' + _aitList_(a[2] || []); },
  offShelfDisplayBatch: function (a) { return '下架 ' + _aitList_(a[1] || []); },
  deleteDisplayBatchPermanent: function (a) { return '永久刪除 ' + _aitList_(a[1] || []); },
  addDisplayNote: function (a) { return (a[2] ? a[2] + '：' : '') + _aitVal_(a[4]); },
  setCustomerVisibility: function (a) { return a[1] ? '改成顯示' : '改成隱藏'; },
  addCustomerToZoning: function (a) { return '加入 ' + _aitVal_(a[1]) + ' 的業務分區'; },
  updateReservedStatus: function (a) { return (Array.isArray(a[0]) ? a[0].length : 1) + ' 筆改成「' + _aitVal_(a[1]) + '」'; },
  completeSalesDeliveryTask: function (a) { return '配送完成' + (a[2] ? '：' + _aitVal_(a[2]) : '') + (a[3] ? '（有破損）' : ''); },
  completeSampleTask: function () { return '樣品任務完成'; },
  transferSalesDeliveryTask: function (a) { return '轉交給 ' + _aitVal_(a[1]); },
  aiAssistantAsk: function (a) { return '問：' + _aitVal_(a[0]); },
  sendLayoutReport: function (a) { return '寄給 ' + _aitVal_(a[0]); },
  saveAttendance: function (a) { var p = a[0] || {}; return [_aitVal_(p.type), p.isBusinessTrip ? '出差' : ''].filter(String).join('，'); },
  submitLeaveRequest: function (a) { var p = a[0] || {}; return [_aitVal_(p.type), _aitVal_(p.start) + (p.end ? ' ～ ' + _aitVal_(p.end) : ''), p.reason ? '原因：' + _aitVal_(p.reason) : ''].filter(String).join('，'); },
  updateLeaveStatus: function (a) { return '改成「' + _aitVal_(a[1]) + '」'; },
  updateLeaveBalance: function (a) { return '剩餘 ' + _aitVal_(a[1]) + ' 天'; },
  updateLeaveBalanceFull: function (a) { return '年假 ' + _aitVal_(a[1]) + ' 天，已用 ' + _aitVal_(a[2]) + ' 天'; },
  deleteAttendanceStaff: function (a) { return '刪除員工 ' + _aitVal_(a[0]); },
  removeClientFromWhitelist: function (a) { return '白名單第 ' + _aitVal_(a[0]) + ' 列'; },
  removeLineClientFromWhitelist: function (a) { return '白名單第 ' + _aitVal_(a[0]) + ' 列'; },
  deleteDrivingRecord: function (a) { return '第 ' + _aitVal_(a[0]) + ' 列'; },
  generateAttendanceReport: function (a) { return [_aitVal_(a[0]), _aitVal_(a[1])].filter(String).join(' '); },
  exportBonusRangeToExcel: function (a) { return _aitVal_(a[0]) + ' 年，第 ' + (Number(a[1]) + 1) + '～' + (Number(a[2]) + 1) + ' 月'; },
  setSleeperAnnualTarget: function (a) { return '年度目標改成 ' + _aitVal_(a[0]); },
  saveSalesBonusRow: function (a) { return _aitVal_(a[1]) + ' ' + _aitVal_(a[2]) + ' 片，單價 ' + _aitVal_(a[3]) + '，成本 ' + _aitVal_(a[4]) + '，同行價 ' + _aitVal_(a[5]); }
};

function _aitDetail_(name, spec, a) {
  if (spec.detail) return spec.detail(a);
  if (AIT_DETAIL_[name]) return _aitStr_(AIT_DETAIL_[name](a), 500);
  return _aitHuman_(a, _aitTarget_(spec, a));
}

function _aitOutcome_(result, err) {
  var msg = '';
  if (err) msg = err.message || String(err);
  else if (result && typeof result === 'object') {
    if (result.success === false || result.ok === false) msg = String(result.error || result.msg || result.message || '失敗');
    else if (result.status === 'error' || result.status === 'disabled') msg = String(result.message || '失敗');
  }
  var status = '成功';
  if (/AUTH_REQUIRED|AUTH_FORBIDDEN|🔒/.test(msg)) status = '拒絕';
  else if (msg) status = '失敗';
  else if (result && typeof result === 'object' && (result.status === 'pending' || result.status === 'need_apply')) status = result.status === 'pending' ? '申請審核中' : '尚未申請';
  return { status: status, msg: _aitStr_(msg, 300) };
}

function _aitLog_(o) {
  try {
    var ctx = __AIT_CTX__;
    var oc = _aitOutcome_(o.result, o.err);
    var who = (ctx && ctx.name) || o.who || (oc.status === '拒絕' ? '（未登入／憑證無效）' : '');
    _auditPutRow_([
      Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm:ss'),
      who, (ctx && ctx.title) || '', (ctx && ctx.branch) || '',
      o.label || o.fn || '', o.target || '', o.detail || '', '',
      oc.status, oc.msg, o.ms || 0, o.fn || '', '版面神器'
    ]);
    if (oc.status === '成功' && /saveNewLayout|updateLayoutFieldBatch|updateDisplayBatch|offShelfDisplayBatch|deleteDisplayBatchPermanent|addDisplayNote/i.test(o.fn || '')) {
      try { if (typeof CacheManager !== 'undefined') CacheManager.removeLarge('latest_layout_activities_v3'); } catch (eC) {}
    }
  } catch (e) { console.error('操作記錄寫入失敗：' + (e && e.message)); }
}

// ───────── 寫入記錄檔 (與物流 AuditLog.js 同一段寫法，兩邊要保持一致) ─────────
function _auditSheet_() {
  var ss = SpreadsheetApp.openById(AIT_AUDIT_SS_ID);
  var tab = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM');
  var sh = ss.getSheetByName(tab);
  if (!sh) {
    try { sh = ss.insertSheet(tab, 0); } catch (eIns) { sh = ss.getSheetByName(tab); if (!sh) throw eIns; return _auditEnsureHeader_(sh); }
    sh.getRange(1, 1, 1, AIT_AUDIT_HEADERS.length).setValues([AIT_AUDIT_HEADERS])
      .setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(5, 150); sh.setColumnWidth(6, 180); sh.setColumnWidth(7, 320); sh.setColumnWidth(8, 360);
  }
  return _auditEnsureHeader_(sh);
}

function _auditEnsureHeader_(sh) {
  try {
    var cache = CacheService.getScriptCache(), key = 'audit_hdr_' + sh.getSheetId();
    if (cache.get(key)) return sh;
    var n = AIT_AUDIT_HEADERS.length;
    if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
    var cur = sh.getRange(1, 1, 1, n).getValues()[0];
    for (var i = 0; i < n; i++) {
      if (String(cur[i]).trim() === '') sh.getRange(1, i + 1).setValue(AIT_AUDIT_HEADERS[i]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
    }
    cache.put(key, '1', 21600);
  } catch (e) { }
  return sh;
}

function _auditPutRow_(row) {
  row = row.map(function (v) {
    if (typeof v === 'string' && v.length > 40000) v = v.slice(0, 40000) + '…';
    return v;
  });
  var sh = _auditSheet_();
  if (_auditApiInsert_(sh, row)) return;
  var safe = row.map(function (v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; });
  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(8000); } catch (e) { locked = false; }
  try {
    if (locked) {
      sh.insertRowsAfter(1, 1);
      var r2 = sh.getRange(2, 1, 1, safe.length);
      try {
        r2.setFontWeight('normal').setBackground(null).setFontColor(null);
        r2.setValues([safe]);
      } catch (eW) {
        try { sh.deleteRow(2); } catch (eD) { }
        sh.appendRow(safe);
      }
    } else {
      sh.appendRow(safe);
    }
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) { } }
  }
}

/** Sheets API 的儲存格：「yyyy/MM/dd HH:mm:ss」寫成真正的日期時間 (跟舊記錄一樣可排序、篩選)，其他照原樣 */
function _auditApiCell_(v) {
  var m = typeof v === 'string' && /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(v);
  if (m) {
    var serial = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 86400000 + 25569;
    return { userEnteredValue: { numberValue: serial }, userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy/mm/dd hh:mm:ss' } } };
  }
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  return { userEnteredValue: { stringValue: String(v == null ? '' : v) } };
}

function _auditApiInsert_(sh, row) {
  var cache = CacheService.getScriptCache();
  if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets || cache.get('audit_api_off')) return false;
  try {
    var sid = sh.getSheetId();
    Sheets.Spreadsheets.batchUpdate({
      requests: [
        { insertDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, inheritFromBefore: false } },
        {
          updateCells: {
            start: { sheetId: sid, rowIndex: 1, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat.numberFormat',
            rows: [{ values: row.map(_auditApiCell_) }]
          }
        }
      ]
    }, sh.getParent().getId());
    return true;
  } catch (e) {
    console.warn('操作記錄 Sheets API 寫入失敗，改用一般寫法：' + (e && e.message));
    try { cache.put('audit_api_off', '1', 3600); } catch (e2) { }
    return false;
  }
}
