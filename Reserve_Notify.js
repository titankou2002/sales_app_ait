/**
 * 保留系統 — Service_Notify.js
 * 保留單帳齡通知（30 / 45 / 60 天）與保留額滿 80% 告警
 * 業務 Telegram 對照已移至 Service_Reserve.js 的 BRANCHES[salesTg]，依目前分支自動切換
 * （高雅瓷：謝博皓 @HQWWSX、潘右森 6417913737、陳勁多無 TG）。
 */

// 帳齡通知門檻（天）
const AGING_D1 = 30;  // 階段一（30 天）：跟進提醒（Email + TG 給業務）
const AGING_D2 = 45;  // 階段二（45 天）：未更新警告（Email 業務+主管 + TG 群組標記）
const AGING_D3 = 60;  // 階段三（60 天）：逾期待處理（Email 給主管與 LYNN，人工決定刪除）

// 60 天階段收件人改依分支計算（見 sendAgingNoticesForBranch_），此處不再保留全域常數。

// 保留額滿門檻
const RESERVE_FULL_RATIO = 0.8;

/**
 * 工具：列出目前有跟 bot 講過話的使用者 chat_id
 * 請各業務先在 Telegram 私訊 bot 一次（送 /start），再執行此函式，
 * 把印出來的 chat_id 填進上方 SALES_TG。
 */
function captureTelegramChatIds() {
  const token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  if (!token) { console.log('尚未設定 TG_TOKEN'); return; }
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  if (!data.ok) { console.log('取得 updates 失敗：' + res.getContentText()); return; }
  const seenChat = {};
  const seenUser = {};
  (data.result || []).forEach(u => {
    const msg = u.message || u.edited_message || u.my_chat_member || {};

    // 對話本身（私訊＝個人，群組＝群組）
    const chat = msg.chat;
    if (chat && !seenChat[String(chat.id)]) {
      seenChat[String(chat.id)] = true;
      const who = chat.title || ((chat.first_name || '') + (chat.last_name || ''));
      console.log(`[對話] chat_id=${chat.id}　type=${chat.type}　@${chat.username || '-'}　${who}`);
    }

    // 發言者本人（群組發言也抓得到 user_id；私訊時 user_id === chat_id）
    const from = msg.from;
    if (from && !from.is_bot && !seenUser[String(from.id)]) {
      seenUser[String(from.id)] = true;
      const canDM = chat && chat.type === 'private' ? '✅ 可私訊' : '⚠️ 僅能群組標記（尚未私訊過 bot）';
      console.log(`[人員] user_id=${from.id}　@${from.username || '無帳號'}　${(from.first_name || '') + (from.last_name || '')}　${canDM}`);
    }
  });

  if (!Object.keys(seenChat).length && !Object.keys(seenUser).length) {
    console.log('目前沒有任何紀錄。請業務私訊 bot 送 /start，或在群組中 @Titankou2002_bot 發一則訊息。');
  }
}



/** 移除 Webhook（恢復 getUpdates / captureTelegramChatIds 可用） */
function deleteTelegramWebhook() {
  const token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  if (!token) return;
  const res = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/deleteWebhook',
    { muteHttpExceptions: true }
  );
  console.log('deleteWebhook → ' + res.getContentText());
}

/** 發送 Telegram 到指定 chat_id（個人或群組）
 *  disable_web_page_preview:true 一定要開——Telegram 收到訊息裡的網址會自動幫忙「預覽抓取」，
 *  這會搶在業務真的點擊之前，先對我們的續保/取消連結發一次 GET，把單次使用的 token 提前用掉，
 *  業務點進去就變成「連結已失效」。關掉預覽等於不讓 Telegram 自己先戳一次連結。 */
function pushTelegramTo_(chatId, text) {
  const token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  if (!token || !chatId) return false;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: String(chatId), text: text, disable_web_page_preview: true }),
      muteHttpExceptions: true
    });
    return true;
  } catch (e) {
    console.error('Telegram 發送至 ' + chatId + ' 失敗: ' + e.message);
    return false;
  }
}

/** 取得業務的 @username 標記，用於群組中 tag 對方（會觸發個人通知）。可傳 br 明確指定分公司 */
function salesMention_(salesRep, br) {
  const tg = branchSalesTg_(salesRep, br);
  if (tg && tg.username && tg.username.charAt(0) === '@') return tg.username;
  return '';
}

/**
 * 送給負責業務：
 * 1. 有個人 chat_id → 私訊
 * 2. 否則發群組，並在訊息開頭 tag @username（Telegram 會單獨通知該員）
 */
function notifySalesTelegram_(salesRep, text, br) {
  const tg = branchSalesTg_(salesRep, br);
  if (tg && tg.chatId) {
    if (pushTelegramTo_(tg.chatId, text)) return;
  }
  const mention = salesMention_(salesRep, br);
  pushTelegram(mention ? mention + '\n' + text : text, br);
}

/** 判斷業務自某個基準日之後是否有更新過進度 */
function hasUpdatedSince_(site, baseDateStr) {
  if (!site.progressDate) return false;
  const prog = parseAnyDate_(site.progressDate);
  if (!prog) return false;
  if (!baseDateStr) return true;
  const base = parseAnyDate_(baseDateStr);
  if (!base) return true;
  return prog >= base;
}

// key 加入分支名，避免三家公司各自「已通知」狀態互撞
function agingPropKey_(stage, siteKey) {
  return 'RESV_N' + stage + '_' + currentBranchName_() + '_' + String(siteKey || '').replace(/\s+/g, '_').slice(0, 200);
}

/** 移除保留單帳齡/跟進提醒的每日觸發器（Telegram 通知太亂，使用者要求先拿掉；程式邏輯都還在，之後要恢復直接重跑 setupReserveAgingTrigger() / setupAllTelegramTriggers() 即可） */
function deleteReserveNotifyTriggers() {
  const removed = [];
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'sendReserveAgingNotices' || fn === 'sendFollowUpReminders') {
      ScriptApp.deleteTrigger(t);
      removed.push(fn);
    }
  });
  console.log('已移除觸發器：' + (removed.join(', ') || '(無，可能本來就沒設定)'));
  return removed;
}

/** 建立每日帳齡通知觸發器（每天 09:00） */
function setupReserveAgingTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendReserveAgingNotices')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendReserveAgingNotices')
    .timeBased().everyDays(1).atHour(9).create();
  console.log('✅ 保留帳齡通知觸發器已設定：每天 09:00');
}

/**
 * 每日掃描保留單帳齡，依 30 / 45 / 60 天分別發送通知。
 * 每個階段每案只發一次，用 ScriptProperties 記錄（key 含分支名，三家互不干擾）。
 * 背景觸發呼叫時無 request 參數 → 依 ACTIVE_BRANCHES 迭代全部分支。
 */
function sendReserveAgingNotices() {
  forEachBranch_(function() {
    sendAgingNoticesForBranch_();
  });
}

function sendAgingNoticesForBranch_() {
  const br = getBranch_();
  try {
    const resData = getReserveData();
    if (resData.error || !resData.sites) {
      console.error('取得保留資料失敗：' + (resData.error || '無資料'));
      return;
    }

    const props = PropertiesService.getScriptProperties();
    const todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');

    const bucket30 = {};   // salesRep -> [site]
    const bucket45 = {};   // salesRep -> [site]
    const list60   = [];

    resData.sites.forEach(s => {
      if (isArchiveProgress_(s.deposit, s.progress)) return; // 已結案/取消/刪除
      const days = parseFloat(s.days) || 0;
      const rep  = s.salesRep || '未指定';

      const k30 = agingPropKey_(30, s.siteKey);
      const k45 = agingPropKey_(45, s.siteKey);
      const k60 = agingPropKey_(60, s.siteKey);
      const sent30 = props.getProperty(k30);
      const sent45 = props.getProperty(k45);
      const sent60 = props.getProperty(k60);

      // ── 30 天：跟進提醒 ──
      if (days >= AGING_D1 && !sent30) {
        (bucket30[rep] = bucket30[rep] || []).push(s);
        props.setProperty(k30, todayStr);
        return; // 同一天不連發下一階段
      }

      // ── 45 天：30 天通知後仍未更新進度 ──
      if (days >= AGING_D2 && sent30 && !sent45 && !hasUpdatedSince_(s, sent30)) {
        (bucket45[rep] = bucket45[rep] || []).push(s);
        props.setProperty(k45, todayStr);
        return;
      }

      // ── 60 天：45 天通知後仍未更新，交由主管人工決定是否刪除 ──
      if (days >= AGING_D3 && sent45 && !sent60 && !hasUpdatedSince_(s, sent45)) {
        list60.push(s);
        props.setProperty(k60, todayStr);
      }
    });

    // 30 天：Email 給負責業務（主管副本）+ Telegram 私訊/群組
    Object.keys(bucket30).forEach(rep => {
      const sites = bucket30[rep];
      const tail30 = '請確認客戶意願並點擊案件下方連結更新進度。';
      const text30 = buildAgingTgText_('⏰ 保留 30 天跟進提醒', rep, sites, tail30, AGING_D1, br);
      notifySalesTelegram_(rep, text30, br);
    });

    // 45 天：Email 給業務 + 主管，Telegram 發群組標記
    Object.keys(bucket45).forEach(rep => {
      const sites = bucket45[rep];
      const m45 = salesMention_(rep, br);
      const tail45 = '自 30 天通知後仍未更新，15 天後將刪除保留，請點擊連結填寫原因或更新進度。';
      const text45 = buildAgingTgText_('⚠️ 保留未更新警告（45 天）', rep, sites, tail45, AGING_D2, br);
      pushTelegram((m45 ? m45 + '\n' : '') + text45, br);
    });

    // 60 天：Email 給各分公司主管（高雅瓷另通知 LYNN 助理），人工決定刪除
    if (list60.length > 0) {
      const d3To = [];
      String(br.managerEmail || '').split(',').forEach(function(e) {
        const trimmed = String(e).trim();
        if (trimmed && d3To.indexOf(trimmed) < 0) d3To.push(trimmed);
      });
      if (br.label === '高雅瓷' && d3To.indexOf('lynnloveshumi@gmail.com') < 0) d3To.push('lynnloveshumi@gmail.com');
      MailApp.sendEmail({
        to: d3To.join(','),
        subject: `[保留逾期待處理] ${todayStr} 共 ${list60.length} 案已滿 ${AGING_D3} 天未更新`,
        htmlBody: buildAgingEmailHtml_(
          '保留逾期待處理 (60 天)', `${todayStr}　共 ${list60.length} 案`, '#991b1b',
          list60, '這些案子已滿 60 天且業務始終未更新，請確認是否強制刪除保留。'
        )
      });
    }

    console.log(`✅ 帳齡通知完成：30天 ${Object.keys(bucket30).length} 位業務、45天 ${Object.keys(bucket45).length} 位業務、60天 ${list60.length} 案`);
  } catch (e) {
    console.error('sendReserveAgingNotices 失敗：' + e.message);
  }
}

/** 組 Telegram 純文字訊息（地址部分優先顯示案名，沒案名才退回工地地址；品項逐行列出，手機上比較好讀。
 *  numbered=true 時（高雅瓷帶按鈕版），每案前面加編號 1..N，與下面 buildAgingButtons_ 的按鈕編號對應。
 *  不再內嵌續保／取消網址——高雅瓷改用 inline 按鈕（見 buildAgingButtons_），安帝嘉／喜悅納不提供快速動作。 */
function buildAgingTgText_(title, salesRep, sites, tail, threshold, br) {
  const brName = branchNameOf_(br || getBranch_());
  const lines = sites.slice(0, 15).map(function(s, i) {
    const place = s.projName || s.site;
    const codes = (s.products || []).map(p => `　・${p.code}×${p.qty}片`).join('\n');
    const links = buildReserveActionLinks_(s, threshold || 30, brName);
    const renewLink = links.renewUrl ? `\n　🔗 更新保留進度: ${links.renewUrl}` : '';
    return `${i + 1}. ${s.cust}／${place}\n${codes}\n　保留 ${s.days} 天（${s.dateRes}）　進度：${s.progress || '未填寫'}${renewLink}`;
  }).join('\n\n');
  const more = sites.length > 15 ? `\n…另 ${sites.length - 15} 案` : '';
  return `${title}\n負責業務：${salesRep}　共 ${sites.length} 案\n\n${lines}${more}\n\n💡 ${tail}`;
}

// ─────────────────────────────────────────────────────────────
// 保留額滿 80% 告警（由 checkMeltdownAndAlert 即時觸發）
// ─────────────────────────────────────────────────────────────

function checkReserveFullAlert_(items, brName) {
  try {
    const props = PropertiesService.getScriptProperties();
    const stateKey = 'RESERVE_RATIO_STATES_' + (brName || currentBranchName_());
    const rawPrev = props.getProperty(stateKey);
    const prevStates = JSON.parse(rawPrev || '{}');
    const isFirstRun = !rawPrev;
    const newStates = {};
    let fired = 0;

    (items || []).forEach(item => {
      const code = String(item.code || '').toUpperCase().replace(/[\s\-]/g, '');
      if (!code) return;
      const stock = parseFloat(item.stock) || 0;
      const reserved = parseFloat(item.reserved) || 0;
      if (stock <= 0) { newStates[code] = 'normal'; return; }

      const ratio = reserved / stock;
      const isFull = ratio >= RESERVE_FULL_RATIO;
      newStates[code] = isFull ? 'full' : 'normal';

      if (isFull && !isFirstRun && prevStates[code] !== 'full') {
        sendReserveFullAlert_(item, Math.round(ratio * 100), brName);
        fired++;
      }
    });

    props.setProperty(stateKey, JSON.stringify(newStates));
    if (fired) console.log(`✅ 保留額滿告警發出 ${fired} 筆`);
  } catch (e) {
    console.error('checkReserveFullAlert_ 失敗：' + e.message);
  }
}

/** 發送單一編號的保留額滿 80% 告警（Telegram @業務） */
function sendReserveFullAlert_(item, pct, brName) {
  const code = String(item.code || '');
  const clean = code.toUpperCase().replace(/[\s\-]/g, '');

  const targetBr = brName || currentBranchName_();
  if (currentBranchName_() !== targetBr) setBranch_(targetBr);
  const br = getBranch_();

  const resData = getReserveData();
  const repSet = {};
  (resData.sites || []).forEach(s => {
    if (isArchiveProgress_(s.deposit, s.progress)) return;
    let qty = 0;
    (s.products || []).forEach(p => {
      if (String(p.code || '').toUpperCase().replace(/[\s\-]/g, '') === clean) qty += (parseFloat(p.qty) || 0);
    });
    if (qty > 0 && s.salesRep) repSet[s.salesRep] = true;
  });

  const reps = Object.keys(repSet);
  const stock = Math.round((parseFloat(item.stock) || 0) * 10) / 10;
  const reserved = Math.round((parseFloat(item.reserved) || 0) * 10) / 10;
  const avail = Math.round((parseFloat(item.avail) || 0) * 10) / 10;
  const name = item.name || '';

  const mentions = reps.map(r => salesMention_(r, br)).filter(Boolean).join(' ');
  const title = (name ? name + ' - ' : '') + code;

  const line =
    '🔥 【' + br.label + ' 保留額滿 80% 告警】\n' +
    (mentions ? mentions + '\n' : '') +
    '1、' + title + ' - 現貨 ' + stock + ' 坪／保留 ' + reserved + ' 坪 剩 ' + avail + ' 坪';

  pushTelegram(line, br);
}

function sendReserveHalfAlert_(item, pct, brName) {
  const targetBr = brName || currentBranchName_();
  if (currentBranchName_() !== targetBr) setBranch_(targetBr);
  const br = getBranch_();
  if (!br.hasTelegram || !br.tgChatIds || !br.tgChatIds.length) return;

  const stock = Math.round((parseFloat(item.stock) || 0) * 10) / 10;
  const reserved = Math.round((parseFloat(item.reserved) || 0) * 10) / 10;
  const avail = Math.round((parseFloat(item.avail) || 0) * 10) / 10;
  const code = String(item.code || '');
  const clean = code.toUpperCase().replace(/[\s\-]/g, '');
  const name = item.name || '';

  const resData = getReserveData();
  const repSet = {};
  (resData.sites || []).forEach(s => {
    if (isArchiveProgress_(s.deposit, s.progress)) return;
    let qty = 0;
    (s.products || []).forEach(p => {
      if (String(p.code || '').toUpperCase().replace(/[\s\-]/g, '') === clean) qty += (parseFloat(p.qty) || 0);
    });
    if (qty > 0 && s.salesRep) repSet[s.salesRep] = true;
  });

  const reps = Object.keys(repSet);
  const mentions = reps.map(r => salesMention_(r, br)).filter(Boolean).join(' ');
  const title = (name ? name + ' - ' : '') + code;

  const line =
    '⚠️ 【' + br.label + ' 保留超過 50% 告警】\n' +
    (mentions ? mentions + '\n' : '') +
    '1、' + title + ' - 現貨 ' + stock + ' 坪／保留 ' + reserved + ' 坪 剩 ' + avail + ' 坪';

  pushTelegram(line, br);
}

function buildReserveFullHtml_(item, pct, stock, reserved, avail, holders) {
  const rows = holders.map(h => `<tr>
    <td style="padding:8px 10px;font-size:13px;font-weight:700;color:#f1f5f9;">${esc_(h.cust)}</td>
    <td style="padding:8px 10px;font-size:12px;color:#cbd5e1;">${esc_(h.site)}</td>
    <td style="padding:8px 10px;font-size:12px;color:#a78bfa;">${esc_(h.salesRep) || '未指定'}</td>
    <td style="padding:8px 10px;font-size:13px;font-weight:900;color:#facc15;text-align:right;">${h.qty} 片</td>
    <td style="padding:8px 10px;font-size:12px;color:#94a3b8;text-align:right;">${h.days} 天</td>
    <td style="padding:8px 10px;font-size:12px;color:${h.progress ? '#34d399' : '#64748b'};">${esc_(h.progress) || '尚未更新'}</td>
  </tr>`).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',sans-serif;">
  <div style="max-width:720px;margin:24px auto;background:#1e293b;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#9a3412,#c2410c);padding:20px 24px;">
      <h1 style="margin:0;color:#fff7ed;font-size:18px;">🔥 保留即將額滿</h1>
      <p style="margin:6px 0 0;color:#fed7aa;font-size:13px;">${esc_(item.code)}${item.name ? '　' + esc_(item.name) : ''}　保留佔比 ${pct}%</p>
    </div>
    <div style="padding:16px 24px;display:flex;gap:28px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <div><span style="color:#94a3b8;font-size:11px;">現貨</span><br><b style="color:#f1f5f9;font-size:20px;">${stock} 坪</b></div>
      <div><span style="color:#94a3b8;font-size:11px;">保留</span><br><b style="color:#a78bfa;font-size:20px;">${reserved} 坪</b></div>
      <div><span style="color:#94a3b8;font-size:11px;">佔比</span><br><b style="color:#fb923c;font-size:20px;">${pct}%</b></div>
      <div><span style="color:#94a3b8;font-size:11px;">剩餘可售</span><br><b style="color:${avail <= 0 ? '#ef4444' : '#34d399'};font-size:20px;">${avail} 坪</b></div>
    </div>
    <div style="padding:12px 24px 4px;font-size:12px;color:#cbd5e1;">此編號現貨已有 ${pct}% 被保留，請相關業務確認保留單是否真實有效。</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">客戶</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">工地</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">業務</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#64748b;">數量</th>
        <th style="padding:8px 10px;text-align:right;font-size:11px;color:#64748b;">天數</th>
        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">進度</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding:16px 24px 20px;text-align:center;">
      <a href="${rsvAppLink_('tab=reserve')}" style="background:#c2410c;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">查看保留明細</a>
    </div>
    <div style="padding:0 24px 16px;text-align:center;font-size:10px;color:#475569;">Titan 保留系統 自動發送</div>
  </div></body></html>`;
}

// ─────────────────────────────────────────────────────────────
// 診斷工具（唯讀，不改任何資料）
// ─────────────────────────────────────────────────────────────

/**
 * 診斷單一編號的缺貨判定，比對「實際算出來的」與「追蹤表上寫的」。
 * 用法：在 Apps Script 編輯器把下面 CODE 改成要查的編號後執行 diagnoseShortage()
 */
function diagnoseShortage() {
  const CODE = 'RM36059';   // ← 要查的編號改這裡
  const clean = String(CODE).toUpperCase().replace(/[\s\-]/g, '');
  const log = [];

  // ── 1. 庫存表實際現貨 ──
  const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
  const stockRows = dbSs.getSheetByName('庫存表').getDataRange().getValues();
  const sh0 = stockRows[0];
  const sc = sh0.indexOf('產品編號') !== -1 ? sh0.indexOf('產品編號') : sh0.indexOf('編號');
  const sq = sh0.indexOf('庫存坪數') !== -1 ? sh0.indexOf('庫存坪數') : sh0.indexOf('坪數');
  let stock = 0;
  for (let i = 1; i < stockRows.length; i++) {
    if (String(stockRows[i][sc] || '').toUpperCase().replace(/[\s\-]/g, '') === clean) {
      stock += parseFloat(stockRows[i][sq]) || 0;
    }
  }
  log.push(`【庫存表】現貨合計：${Math.round(stock * 10) / 10} 坪`);

  // ── 2. 保留單逐筆明細（含是否已結案）──
  const resRows = SpreadsheetApp.openById(getBranch_().reserveSS).getSheetByName(getBranch_().sheetName).getDataRange().getValues();
  const rh = resRows[0];
  const idxOf = (names) => { for (const n of names) { const i = rh.indexOf(n); if (i !== -1) return i; } return -1; };
  const rc = idxOf(['編號', '產品編號']);
  const rq = idxOf(['數量', '片數']);
  const rCust = idxOf(['客戶']);
  const rSite = idxOf(['工地']);
  const rProg = idxOf(['業務更新', '最新進度']);
  const rDep = idxOf(['訂金確認']);

  let resTotalAll = 0, resTotalLive = 0, n = 0, nDead = 0;
  log.push('\n【保留單】逐筆明細：');
  for (let i = 1; i < resRows.length; i++) {
    if (String(resRows[i][rc] || '').toUpperCase().replace(/[\s\-]/g, '') !== clean) continue;
    const qty = parseFloat(resRows[i][rq]) || 0;
    const prog = String(resRows[i][rProg] || '').trim();
    const dep = String(resRows[i][rDep] || '').trim();
    const dead = isArchiveProgress_(dep, prog);
    resTotalAll += qty;
    if (!dead) resTotalLive += qty; else nDead++;
    n++;
    log.push(`  ${dead ? '💀已結案' : '✅有效  '} ${resRows[i][rCust]}／${resRows[i][rSite]}　${qty} 片　進度：${prog || '未填'}`);
  }
  log.push(`  共 ${n} 筆（其中已結案 ${nDead} 筆）`);

  // ── 3. 換算與判定 ──
  const meta = getPriceMetaMap_()[clean] || {};
  const perPing = meta.perPing || 36;
  const resPingAll = resTotalAll / perPing;
  const resPingLive = resTotalLive / perPing;
  log.push(`\n【換算】片/坪 = ${perPing}　尺寸 = ${meta.size || '-'}`);
  log.push(`  保留(全部計) ${Math.round(resPingAll * 10) / 10} 坪 → 可用 ${Math.round((stock - resPingAll) * 10) / 10} 坪  ← 系統目前算法`);
  log.push(`  保留(排除結案) ${Math.round(resPingLive * 10) / 10} 坪 → 可用 ${Math.round((stock - resPingLive) * 10) / 10} 坪  ← 排除死案後`);

  // ── 4. 目前 getRestockAlerts 是否還把它列為缺貨 ──
  const alerts = getRestockAlerts();
  const hit = (alerts.alerts || []).find(a => String(a.code).toUpperCase().replace(/[\s\-]/g, '') === clean);
  log.push(`\n【即時判定】${hit ? `仍在缺貨清單：level ${hit.btnLevel}「${hit.msg}」，可用 ${hit.avail} 坪` : '❗ 已不在缺貨清單（代表已復原）'}`);

  // ── 5. 追蹤表上實際寫著什麼 ──
  const trackRows = dbSs.getSheetByName(SHORTAGE_TRACKING_SHEET).getDataRange().getValues();
  const th = trackRows[0];
  const ti = {};
  th.forEach((h, i) => { ti[String(h).trim()] = i; });
  let found = false;
  for (let r = 1; r < trackRows.length; r++) {
    if (String(trackRows[r][ti['產品編號']] || '').toUpperCase().replace(/[\s\-]/g, '') !== clean) continue;
    found = true;
    log.push(`\n【追蹤表 第 ${r + 1} 列】`);
    ['缺貨分類', '入榜日期', '最後系統同步時間', '可用庫存', '保留量', '處理狀態', '出清結案', '最後更新人', '最後更新時間']
      .forEach(k => { if (ti[k] >= 0) log.push(`  ${k}：${trackRows[r][ti[k]]}`); });
  }
  if (!found) log.push('\n【追蹤表】查無此編號');

  // ── 6. 結論 ──
  log.push('\n────── 判讀 ──────');
  if (!hit && found) {
    log.push('🔴 確認為「沒更新」：實際已不缺貨，但追蹤表仍留著舊的缺貨分類。');
  } else if (hit && resTotalAll !== resTotalLive) {
    log.push('🟠 仍判缺貨，但保留量含已結案死案，排除後可能就不缺了（見上方兩組可用對比）。');
  } else if (hit) {
    log.push('🟡 目前確實仍缺貨，數字是算對的。');
  }

  console.log(log.join('\n'));
  return log.join('\n');
}
