/**
 * 保留系統 — Service_Email.js
 * 每週一自動寄送保留單週報
 */

// 業務 Email／主管 Email 已移至 Service_Reserve.js 的 BRANCHES 設定（branchSalesEmail_()／branchManagerEmail_()），
// 依目前分支（gaoyaci／antigravity／joyina）自動切換，在此不再定義全域常數。

// 設定每週一 09:00 自動觸發
function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendWeeklyReserveEmail')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sendWeeklyReserveEmail')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  console.log('✅ 週報觸發器已設定：每週一 09:00');
}

// 每週一 09:00 自動觸發，依分公司分別寄送週報（只寄 hasWeeklyReport 的分支）
function sendWeeklyReserveEmail() {
  forEachBranch_(function() {
    if (!getBranch_().hasWeeklyReport) return;
    sendWeeklyReserveForBranch_();
  });
}

function sendWeeklyReserveForBranch_() {
  const br = getBranch_();
  const data = getReserveData();
  if (data.error || !data.sites) { console.error(data.error); return; }

  // 依負責業務分組
  const byRep = {};
  data.sites.forEach(s => {
    if (!byRep[s.salesRep]) byRep[s.salesRep] = [];
    byRep[s.salesRep].push(s);
  });

  // 寄給每位業務（只看自己的）
  for (const [name, email] of Object.entries(br.salesEmails)) {
    if (!email) continue;
    const sites = byRep[name] || [];
    if (sites.length === 0) continue;
    const urgent = sites.filter(s => s.days >= 60).length;
    const subject = `[保留單週報] ${name} — ${sites.length} 筆 ${urgent > 0 ? `(🔴 ${urgent} 筆逾期)` : ''}`;
    MailApp.sendEmail({ to: email, subject, htmlBody: buildEmailHtml_(name, sites) });
  }

  // 寄給主管（看全部）
  const managerTo = String(br.managerEmail || '').split(',').filter(Boolean).join(',');
  if (managerTo) {
    const totalUrgent = data.sites.filter(s => s.days >= 60).length;
    MailApp.sendEmail({
      to: managerTo,
      subject: `[保留單週報-主管] 全部 ${data.sites.length} 筆 ${totalUrgent > 0 ? `(🔴 ${totalUrgent} 筆逾期)` : ''}`,
      htmlBody: buildEmailHtml_('主管（全部業務）', data.sites)
    });
  }
}

function buildEmailHtml_(recipientName, sites) {
  const grouped = {
    crit:   sites.filter(s => s.days >= 60),
    urgent: sites.filter(s => s.days >= 45 && s.days < 60),
    warn:   sites.filter(s => s.days >= 30 && s.days < 45),
    ok:     sites.filter(s => s.days < 30)
  };

  const sectionHtml = (title, color, bgColor, list) => {
    if (!list.length) return '';
    const rows = list.map(s => `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:8px 12px;font-weight:700;">${esc_(s.cust)}</td>
        <td style="padding:8px 12px;font-size:11px;color:#64748b;">${esc_(s.site)}</td>
        <td style="padding:8px 12px;">${esc_(s.salesRep)}</td>
        <td style="padding:8px 12px;">${s.dateRes}</td>
        <td style="padding:8px 12px;font-weight:900;color:${color};">${s.days} 天</td>
        <td style="padding:8px 12px;font-size:11px;">${esc_(s.products.map(p => p.code + ' x' + p.qty).join('、'))}</td>
        <td style="padding:8px 12px;font-size:11px;color:#64748b;">${esc_(s.progress || '尚未更新')}</td>
      </tr>`).join('');
    return `
      <h3 style="color:${color};margin:20px 0 8px;">${title}（${list.length} 筆）</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:${bgColor};">
          <th style="padding:8px 12px;text-align:left;">客戶</th>
          <th style="padding:8px 12px;text-align:left;">工地</th>
          <th>業務</th><th>保留日期</th><th>天數</th><th>保留品項</th><th>最新進度</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:860px;margin:0 auto;color:#1e293b;">
    <div style="background:#1e293b;color:#f1f5f9;padding:20px 24px;border-radius:12px 12px 0 0;">
      <h2 style="margin:0;">📋 保留單週報</h2>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">收件人：${esc_(recipientName)}｜共 ${sites.length} 筆保留案場</p>
    </div>
    <div style="background:#f8fafc;padding:20px 24px;border-radius:0 0 12px 12px;">
      ${sectionHtml('🔴 60天以上逾期 (人工刪除處置)', '#ef4444', '#fef2f2', grouped.crit)}
      ${sectionHtml('🔶 45–60天警告 (未更新預警)', '#f97316', '#fff7ed', grouped.urgent)}
      ${sectionHtml('⚠️ 30–45天跟进提醒', '#eab308', '#fefce8', grouped.warn)}
      ${sectionHtml('🟢 30天以內正常', '#22c55e', '#f0fdf4', grouped.ok)}
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;">Titan System 保留單監控系統 自動發送</p>
    </div>
  </body></html>`;
}

/**
 * 缺貨追蹤每日匯整信：每天固定時間將當天「缺貨進榜歷程」更新匯整，
 * 依產品的保留客戶負責業務分組寄送，主管收全部。
 */
function setupShortageDigestTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendShortageDailyDigest')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sendShortageDailyDigest')
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .create();

  console.log('✅ 缺貨追蹤每日匯整觸發器已設定：每天 18:00');
}

function sendShortageDailyDigest() {
  setBranch_('gaoyaci'); // 缺貨追蹤功能目前僅高雅瓷啟用，固定讀高雅瓷資料
  try {
    const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
    const sh = dbSs.getSheetByName(SHORTAGE_HISTORY_SHEET);
    if (!sh) return { success: false, error: '找不到缺貨進榜歷程' };
    const rows = sh.getDataRange().getValues();
    if (rows.length < 2) return { success: true, count: 0 };

    const headers = rows[0].map(v => String(v || '').trim());
    const idx = headerIndexMap_(headers);
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');

    const todays = [];
    for (let r = 1; r < rows.length; r++) {
      const t = String(rows[r][idx['時間']] || '');
      if (t.indexOf(today) === 0) {
        todays.push({
          time: t,
          code: String(rows[r][idx['產品編號']] || ''),
          action: String(rows[r][idx['動作']] || ''),
          operator: String(rows[r][idx['更新人']] || ''),
          oldStatus: String(rows[r][idx['原狀態']] || ''),
          newStatus: String(rows[r][idx['新狀態']] || ''),
          note: String(rows[r][idx['新備註']] || ''),
          summary: String(rows[r][idx['摘要']] || '')
        });
      }
    }
    if (!todays.length) return { success: true, count: 0 };

    // 依產品的保留客戶找出負責業務
    const reserveData = getReserveData();
    const codeToReps = {};
    (reserveData.sites || []).forEach(s => {
      (s.products || []).forEach(p => {
        const clean = normalizeSku_(p.code);
        if (!clean) return;
        if (!codeToReps[clean]) codeToReps[clean] = new Set();
        if (s.salesRep) codeToReps[clean].add(s.salesRep);
      });
    });

    const byRep = {};
    todays.forEach(rec => {
      const clean = normalizeSku_(rec.code);
      const reps = (codeToReps[clean] && codeToReps[clean].size) ? Array.from(codeToReps[clean]) : ['未指定業務'];
      reps.forEach(rep => {
        if (!byRep[rep]) byRep[rep] = [];
        byRep[rep].push(rec);
      });
    });

    let sentCount = 0;
    for (const [name, email] of Object.entries(getBranch_().salesEmails)) {
      if (!email) continue;
      const recs = byRep[name] || [];
      if (!recs.length) continue;
      MailApp.sendEmail({
        to: email,
        subject: `[缺貨追蹤日報] ${name} — ${today} 共 ${recs.length} 筆更新`,
        htmlBody: buildShortageDigestHtml_(name, recs, today)
      });
      sentCount++;
    }

    // 主管收全部更新
    MailApp.sendEmail({
      to: getBranch_().managerEmail,
      subject: `[缺貨追蹤日報-主管] ${today} 共 ${todays.length} 筆更新`,
      htmlBody: buildShortageDigestHtml_('主管（全部）', todays, today)
    });
    sentCount++;

    return { success: true, count: sentCount };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildShortageDigestHtml_(recipientName, recs, today) {
  const rows = recs.map(rec => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:8px 12px;font-family:monospace;font-weight:700;">${esc_(rec.code)}</td>
      <td style="padding:8px 12px;">${esc_(rec.action)}</td>
      <td style="padding:8px 12px;font-size:12px;color:#64748b;">${esc_(rec.oldStatus)} → <b style="color:#0284c7;">${esc_(rec.newStatus)}</b></td>
      <td style="padding:8px 12px;font-size:11px;">${esc_(rec.summary)}</td>
      <td style="padding:8px 12px;font-size:11px;color:#64748b;">${esc_(rec.note)}</td>
      <td style="padding:8px 12px;font-size:11px;color:#94a3b8;">${esc_(rec.operator)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:860px;margin:0 auto;color:#1e293b;">
    <div style="background:#1e293b;color:#f1f5f9;padding:20px 24px;border-radius:12px 12px 0 0;">
      <h2 style="margin:0;">📦 缺貨追蹤日報</h2>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">收件人：${esc_(recipientName)}｜${esc_(today)}｜共 ${recs.length} 筆更新</p>
    </div>
    <div style="background:#f8fafc;padding:20px 24px;border-radius:0 0 12px 12px;">
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#f1f5f9;">
          <th style="padding:8px 12px;text-align:left;">產品編號</th>
          <th style="padding:8px 12px;text-align:left;">動作</th>
          <th style="padding:8px 12px;text-align:left;">狀態變化</th>
          <th style="padding:8px 12px;text-align:left;">摘要</th>
          <th style="padding:8px 12px;text-align:left;">備註</th>
          <th style="padding:8px 12px;text-align:left;">更新人</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;">Titan System 缺貨追蹤系統 自動發送</p>
    </div>
  </body></html>`;
}

function esc_(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * 主動發送：將戰情室補庫決策報告與有限資金優先順序電郵給主管
 */

function sendWarRoomEmail_() {
  setBranch_('gaoyaci'); // 戰情室功能目前僅高雅瓷啟用
  try {
    const res = getWarRoomData();
    if (!res.success) return { success: false, error: '取得戰情數據失敗：' + res.error };
    
    // 僅過濾出需要補庫的品項 (suggestedRestock > 0)，已按照優先度排序
    const restockItems = res.items.filter(item => item.suggestedRestock > 0);
    
    let totalRestockPing = 0;
    let rowsHtml = '';
    
    restockItems.forEach(item => {
      totalRestockPing += item.suggestedRestock;
      
      const peakMonthNum = parseInt(item.peakMonth);
      let orderMonthNum = peakMonthNum - 3 - (item.isLarge ? 0.5 : 0);
      if (orderMonthNum <= 0) orderMonthNum += 12;
      const orderMonthStr = Math.floor(orderMonthNum) + '月' + (orderMonthNum % 1 !== 0 ? '中' : '初');
      
      rowsHtml += `
        <tr style="border-bottom:1px solid #e2e8f0; font-size:12px;">
          <td style="padding:10px 8px; text-align:center; font-weight:bold; color:#ef4444;">No.${item.priorityRank}</td>
          <td style="padding:10px 8px; font-family:monospace; font-weight:bold;">${esc_(item.code)}</td>
          <td style="padding:10px 8px;">${esc_(item.name)}</td>
          <td style="padding:10px 8px; text-align:center;">
            <span style="padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; background:${item.class === 'A+' ? '#fef2f2;color:#ef4444;' : item.class === 'A' ? '#fff7ed;color:#ea580c;' : '#fefce8;color:#ca8a04;'}">
              ${item.class}
            </span>
          </td>
          <td style="padding:10px 8px; text-align:center; font-size:11px;">${esc_(item.size)}</td>
          <td style="padding:10px 8px; text-align:center; color:${item.isLarge ? '#5e5ce6;font-weight:bold;' : '#64748b'};">${item.isLarge ? '是' : '否'}</td>
          <td style="padding:10px 8px; text-align:right;">${item.avail} / ${item.suggestedSafe} 坪</td>
          <td style="padding:10px 8px; text-align:right; font-weight:bold; color:#ef4444;">${item.suggestedRestock} 坪</td>
          <td style="padding:10px 8px; text-align:center; font-weight:bold; color:#0284c7;">${orderMonthStr}</td>
        </tr>`;
    });
    
    if (restockItems.length === 0) {
      rowsHtml = `<tr><td colspan="9" style="padding:20px; text-align:center; color:#64748b;">目前無任何低於安全存量需補庫之品項！庫存安全！</td></tr>`;
    }
    
    const htmlBody = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; max-width:960px; margin:0 auto; color:#1e293b; line-height:1.5;">
      <div style="background:#0284c7; color:#ffffff; padding:24px; border-radius:12px 12px 0 0; text-align:left;">
        <h2 style="margin:0; font-size:22px; font-weight:800; display:flex; align-items:center; gap:8px;">📊 產品庫存補貨決策報告 (建議優先級)</h2>
        <p style="margin:6px 0 0; color:#e0f2fe; font-size:13px;">資料產生時間：${Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm')} | 本報告已依【主力評級、大磚規格、缺水程度】進行科學排程</p>
      </div>
      <div style="background:#f8fafc; padding:24px; border-radius:0 0 12px 12px; border:1px solid #e2e8f0; border-top:none;">
        
        <!-- 建議坪數看板 -->
        <div style="margin-bottom:24px;">
          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,0.05); max-width:300px;">
            <div style="font-size:12px; color:#64748b; margin-bottom:4px;">建議補庫總坪數</div>
            <div style="font-size:24px; font-weight:900; color:#0284c7;">${Math.round(totalRestockPing * 10) / 10} <span style="font-size:14px; font-weight:500; color:#64748b;">坪</span></div>
          </div>
        </div>

        <h3 style="color:#0f172a; margin:0 0 12px 0; font-size:16px; border-left:4px solid #0284c7; padding-left:8px;">🎯 補庫建議順序清單</h3>
        <table style="width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
          <thead>
            <tr style="background:#f1f5f9; font-size:11px; color:#475569; text-align:left;">
              <th style="padding:10px 8px; text-align:center;">優先級</th>
              <th style="padding:10px 8px;">產品編號</th>
              <th style="padding:10px 8px;">系列名稱</th>
              <th style="padding:10px 8px; text-align:center;">戰情分類</th>
              <th style="padding:10px 8px; text-align:center;">規格</th>
              <th style="padding:10px 8px; text-align:center;">大磚</th>
              <th style="padding:10px 8px; text-align:right;">可用 / 安全</th>
              <th style="padding:10px 8px; text-align:right;">建議補庫</th>
              <th style="padding:10px 8px; text-align:center;">裝櫃發船死線</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        
        <div style="margin-top:24px; font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:16px; text-align:center;">
          本報告由 高雅瓷保留單戰情系統 依即時庫存與保留數據運算產生。
        </div>
      </div>
    </body></html>`;
    
    MailApp.sendEmail({
      to: getBranch_().managerEmail,
      subject: `[補庫決策報告] 共計 ${Math.round(totalRestockPing * 10) / 10} 坪 — ${restockItems.length} 款產品待採購建議`,
      htmlBody: htmlBody
    });
    
    return { success: true, count: restockItems.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 被動熔斷：當新接保留單或進度更新，導致可用庫存跌破安全存量時，發送最高級別熔斷告警信
 */
function sendMeltdownAlertEmail(item, triggeredReserve) {
  try {
    const peakMonthNum = parseInt(item.peakMonth);
    let orderMonthNum = peakMonthNum - 3 - (item.isLarge ? 0.5 : 0);
    if (orderMonthNum <= 0) orderMonthNum += 12;
    const orderMonthStr = Math.floor(orderMonthNum) + '月' + (orderMonthNum % 1 !== 0 ? '中' : '初');

    const htmlBody = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; max-width:700px; margin:0 auto; color:#1e293b; line-height:1.5;">
      <div style="background:#dc2626; color:#ffffff; padding:24px; border-radius:12px 12px 0 0; text-align:center; box-shadow:0 4px 6px rgba(220,38,38,0.2);">
        <div style="font-size:32px; margin-bottom:8px;">🚨</div>
        <h2 style="margin:0; font-size:22px; font-weight:900; letter-spacing:1px;">最高級別庫存熔斷告警</h2>
        <p style="margin:6px 0 0; color:#fee2e2; font-size:13px;">產品可用餘額跌破安全存量！請立即啟動補貨評估！</p>
      </div>
      <div style="background:#fdf2f2; padding:24px; border-radius:0 0 12px 12px; border:1px solid #fca5a5; border-top:none;">
        
        <!-- 告警產品資訊 -->
        <div style="background:#ffffff; border:1px solid #fee2e2; border-radius:10px; padding:16px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #fecaca; padding-bottom:8px; margin-bottom:12px;">
            <span style="font-family:monospace; font-size:18px; font-weight:bold; color:#dc2626;">SKU: ${esc_(item.code)}</span>
            <span style="padding:2px 8px; border-radius:4px; font-size:11px; font-weight:bold; background:#fef2f2; color:#ef4444; border:1px solid #fecaca;">
              ${item.class} 主力品
            </span>
          </div>
          <table style="width:100%; font-size:13px; text-align:left;">
            <tr><td style="color:#64748b; width:120px; padding:4px 0;">產品名稱</td><td style="font-weight:bold; color:#0f172a;">${esc_(item.name)}</td></tr>
            <tr><td style="color:#64748b; padding:4px 0;">規格尺寸</td><td>${esc_(item.size)} cm</td></tr>
            <tr><td style="color:#64748b; padding:4px 0;">大磚規格</td><td style="color:#5e5ce6; font-weight:bold;">${item.isLarge ? '是 (120x120+)' : '否'}</td></tr>
            <tr><td style="color:#64748b; padding:4px 0;">去峰值月均銷</td><td>${item.avgPeakShaved} 坪/月</td></tr>
          </table>
        </div>

        <!-- 熔斷庫存對比 -->
        <div style="display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap;">
          <div style="flex:1; background:#ffffff; border:1px solid #fee2e2; border-radius:10px; padding:14px; text-align:center;">
            <div style="font-size:11px; color:#64748b; margin-bottom:4px;">當前剩餘可用銷售餘額</div>
            <div style="font-size:22px; font-weight:900; color:#dc2626;">${item.avail} <span style="font-size:12px; font-weight:400; color:#64748b;">坪</span></div>
          </div>
          <div style="flex:1; background:#ffffff; border:1px solid #fee2e2; border-radius:10px; padding:14px; text-align:center;">
            <div style="font-size:11px; color:#64748b; margin-bottom:4px;">系統建議安全存量</div>
            <div style="font-size:22px; font-weight:900; color:#0284c7;">${item.suggestedSafe} <span style="font-size:12px; font-weight:400; color:#64748b;">坪</span></div>
          </div>
        </div>

        <!-- 觸發保留單資訊 -->
        <h4 style="margin:0 0 8px 0; color:#991b1b; font-size:13px; border-left:3px solid #dc2626; padding-left:6px;">💥 觸發熔斷之新保留單</h4>
        <div style="background:rgba(220,38,38,0.03); border:1px dashed #fca5a5; border-radius:8px; padding:14px; margin-bottom:20px; font-size:12px; line-height:1.6;">
          <table style="width:100%; text-align:left;">
            <tr><td style="color:#b91c1c; width:80px;">工地名稱:</td><td style="font-weight:bold; color:#0f172a;">${esc_(triggeredReserve.site)}</td></tr>
            <tr><td style="color:#b91c1c;">客戶名稱:</td><td style="font-weight:bold; color:#0f172a;">${esc_(triggeredReserve.cust)}</td></tr>
            <tr><td style="color:#b91c1c;">負責業務:</td><td>${esc_(triggeredReserve.salesRep)}</td></tr>
            <tr><td style="color:#b91c1c;">保留數量:</td><td style="font-weight:bold; color:#dc2626;">${triggeredReserve.qty} 坪</td></tr>
            <tr><td style="color:#b91c1c;">保留日期:</td><td>${triggeredReserve.date}</td></tr>
          </table>
        </div>

        <!-- 補庫對策建議 -->
        <h4 style="margin:0 0 8px 0; color:#0f172a; font-size:13px; border-left:3px solid #0284c7; padding-left:6px;">🛠️ 緊急補庫決策建議</h4>
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:16px; font-size:12px; line-height:1.6; color:#334155;">
          • <b>建議緊急起運補庫數量</b>：<b style="color:#dc2626; font-size:14px;">${item.suggestedRestock} 坪</b><br>
          • <b>船期截止月份</b>：歷史銷量巔峰在 <b>${item.peakMonth}</b>，依 3 個月海運起算，最遲應於 <b style="color:#0284c7; font-size:13px;">${orderMonthStr}</b> 之前在歐洲裝櫃發船！
        </div>

        <div style="margin-top:20px; font-size:10px; color:#94a3b8; text-align:center;">
          本告警信由 高雅瓷保留單熔斷監聽器 自動發送，當可用量跌破警戒線時即時觸發。
        </div>
      </div>
    </body></html>`;
    
    MailApp.sendEmail({
      to: getBranch_().managerEmail,
      subject: `【🔴 最高級別庫存熔斷告警】產品 ${esc_(item.code)} 因新接保留單跌破安全存量！`,
      htmlBody: htmlBody
    });
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// 信 A：庫存缺貨示警（有新進榜才寄）
// ─────────────────────────────────────────────────────────────

function setupShortageAlertTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendShortageAlertEmail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendShortageAlertEmail')
    .timeBased().everyHours(6).create();
  console.log('✅ 缺貨示警觸發器已設定：每 6 小時');
}

function sendShortageAlertEmail() {
  setBranch_('gaoyaci'); // 缺貨示警功能目前僅高雅瓷啟用
  try {
    const db = SpreadsheetApp.openById(getBranch_().dbSS);
    const trackSh = db.getSheetByName(SHORTAGE_TRACKING_SHEET);
    if (!trackSh) return;
    const rows = trackSh.getDataRange().getValues();
    const headers = rows[0];
    const idx = {};
    headers.forEach((h, i) => { idx[String(h).trim()] = i; });

    const todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');

    const newItems = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const cat = String(row[idx['缺貨分類']] || '').trim();
      // 全新產品觀察／新品觀察只是列入榜單觀察，不是真的缺貨，不觸發示警信
      if (cat === '預防性保留' || cat === '全新產品觀察' || cat === '新品觀察' || !cat) continue;
      if (String(row[idx['出清結案']] || '').trim()) continue;
      const entryDate = row[idx['入榜日期']];
      const entryDateStr = entryDate instanceof Date
        ? Utilities.formatDate(entryDate, 'Asia/Taipei', 'yyyy/MM/dd')
        : String(entryDate || '').trim();
      if (entryDateStr !== todayStr) continue;

      const avail  = parseFloat(row[idx['可用庫存']] || '') || 0;
      const inDate1 = idx['入倉日期1'] >= 0 ? String(row[idx['入倉日期1']] || '').trim() : '';
      const inQty1  = idx['入庫數量1'] >= 0 ? String(row[idx['入庫數量1']] || '').trim() : '';
      newItems.push({
        code:      String(row[idx['產品編號']] || '').trim(),
        series:    String(row[idx['系列名稱']] || '').trim(),
        cat:       cat,
        avail:     avail,
        inDate1:   inDate1,
        inQty1:    inQty1,
        entryDate: entryDateStr
      });
    }

    if (newItems.length === 0) return;

    const levelOrder = { '完全缺貨': 0, '嚴重缺貨': 1, '快要斷貨': 2, '即將缺貨': 3 };
    newItems.sort((a, b) => (levelOrder[a.cat] || 9) - (levelOrder[b.cat] || 9));

    const broken = newItems.filter(i => i.avail <= 0).length;
    const hasIncoming = newItems.filter(i => i.inDate1).length;

    const html = buildShortageAlertHtml_(newItems, todayStr, broken, hasIncoming);
    const allRecipients = [getBranch_().managerEmail, ...Object.values(getBranch_().salesEmails).filter(Boolean)].join(',');
    MailApp.sendEmail({
      to: allRecipients,
      subject: `[缺貨示警] ${todayStr} 新進榜 ${newItems.length} 項｜已斷貨 ${broken} 項`,
      htmlBody: html
    });
  } catch (e) {
    console.error('sendShortageAlertEmail 失敗：' + e.message);
  }
}

function buildShortageAlertHtml_(items, today, broken, hasIncoming) {
  const tableRows = items.map(item => {
    const availColor  = item.avail <= 0 ? '#ef4444' : '#f1f5f9';
    const availText   = item.avail <= 0 ? '已斷貨' : item.avail + ' 坪';
    const arrivalText  = item.inDate1 ? item.inDate1 + (item.inQty1 ? ' · ' + item.inQty1 + '片' : '') : '—';
    return `<tr>
      <td style="padding:8px 10px;font-size:12px;color:#94a3b8;">${esc_(item.entryDate)} <span style="background:#16a34a;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;">新</span></td>
      <td style="padding:8px 10px;font-size:13px;font-weight:700;color:#f1f5f9;">${esc_(item.code)}</td>
      <td style="padding:8px 10px;font-size:12px;color:#cbd5e1;">${esc_(item.series)}</td>
      <td style="padding:8px 10px;font-size:13px;font-weight:700;color:${availColor};text-align:right;">${availText}</td>
      <td style="padding:8px 10px;font-size:12px;color:#a3e635;text-align:right;">${arrivalText}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',sans-serif;">
  <div style="max-width:680px;margin:24px auto;background:#1e293b;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7f1d1d,#991b1b);padding:20px 24px;">
      <h1 style="margin:0;color:#fef2f2;font-size:18px;">🚨 庫存缺貨示警</h1>
      <p style="margin:6px 0 0;color:#fca5a5;font-size:13px;">${today}　新進榜 ${items.length} 項</p>
    </div>
    <div style="padding:16px 24px 8px;display:flex;gap:24px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <div><span style="color:#94a3b8;font-size:11px;">需補貨</span><br><b style="color:#f1f5f9;font-size:20px;">${items.length}</b></div>
      <div><span style="color:#94a3b8;font-size:11px;">已斷貨</span><br><b style="color:#ef4444;font-size:20px;">${broken}</b></div>
      <div><span style="color:#94a3b8;font-size:11px;">到貨在途</span><br><b style="color:#a3e635;font-size:20px;">${hasIncoming}</b></div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">進榜日</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">編號</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">系列</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#64748b;">可售</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#64748b;">到貨</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div style="padding:16px 24px;font-size:11px;color:#475569;">🟢 到貨 = 已有預計到貨批次（入倉日期）</div>
    <div style="padding:8px 24px 20px;text-align:center;">
      <a href="${rsvAppLink_('tab=shortage')}" style="background:#991b1b;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">查看缺貨公佈欄完整明細</a>
    </div>
    <div style="padding:0 24px 16px;text-align:center;font-size:10px;color:#475569;">Titan 保留系統 自動發送</div>
  </div></body></html>`;
}

// ─────────────────────────────────────────────────────────────
// 信 B：預防性保留提醒（有新進榜才寄）
// ─────────────────────────────────────────────────────────────

function setupProbationAlertTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendProbationAlertEmail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendProbationAlertEmail')
    .timeBased().everyHours(6).create();
  console.log('✅ 預防性保留觸發器已設定：每 6 小時');
}

function sendProbationAlertEmail() {
  setBranch_('gaoyaci'); // 新品觀察示警功能目前僅高雅瓷啟用
  try {
    const db = SpreadsheetApp.openById(getBranch_().dbSS);
    const trackSh = db.getSheetByName(SHORTAGE_TRACKING_SHEET);
    if (!trackSh) return;
    const rows = trackSh.getDataRange().getValues();
    const headers = rows[0];
    const idx = {};
    headers.forEach((h, i) => { idx[String(h).trim()] = i; });

    const todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');

    const newItems = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (String(row[idx['缺貨分類']] || '').trim() !== '預防性保留') continue;
      if (String(row[idx['出清結案']] || '').trim()) continue;
      const entryDate = row[idx['入榜日期']];
      const entryDateStr = entryDate instanceof Date
        ? Utilities.formatDate(entryDate, 'Asia/Taipei', 'yyyy/MM/dd')
        : String(entryDate || '').trim();
      if (entryDateStr !== todayStr) continue;

      const stock    = (parseFloat(row[idx['可用庫存']] || '') || 0) + (parseFloat(row[idx['保留量']] || '') || 0);
      const reserved = parseFloat(row[idx['保留量']] || '') || 0;
      const avail    = parseFloat(row[idx['可用庫存']] || '') || 0;
      const pct      = stock > 0 ? Math.round((reserved / stock) * 100) : 0;
      newItems.push({
        code:      String(row[idx['產品編號']] || '').trim(),
        series:    String(row[idx['系列名稱']] || '').trim(),
        stock:     Math.round(stock * 10) / 10,
        reserved:  Math.round(reserved * 10) / 10,
        avail:     Math.round(avail * 10) / 10,
        pct:       pct,
        entryDate: entryDateStr
      });
    }

    if (newItems.length === 0) return;

    newItems.sort((a, b) => b.pct - a.pct);

    const html = buildProbationAlertHtml_(newItems, todayStr);
    const allRecipients = [getBranch_().managerEmail, ...Object.values(getBranch_().salesEmails).filter(Boolean)].join(',');
    MailApp.sendEmail({
      to: allRecipients,
      subject: `[預防性保留] ${todayStr} 新增 ${newItems.length} 項超過 50% 保留`,
      htmlBody: html
    });
  } catch (e) {
    console.error('sendProbationAlertEmail 失敗：' + e.message);
  }
}

function buildProbationAlertHtml_(items, today) {
  const tableRows = items.map(item => `<tr>
    <td style="padding:8px 10px;font-size:12px;color:#94a3b8;">${esc_(item.entryDate)}</td>
    <td style="padding:8px 10px;font-size:13px;font-weight:700;color:#f1f5f9;">${esc_(item.code)}</td>
    <td style="padding:8px 10px;font-size:12px;color:#cbd5e1;">${esc_(item.series)}</td>
    <td style="padding:8px 10px;font-size:13px;text-align:right;color:#f1f5f9;">${item.stock} 坪</td>
    <td style="padding:8px 10px;font-size:13px;font-weight:700;text-align:right;color:#a78bfa;">${item.reserved} 坪</td>
    <td style="padding:8px 10px;font-size:13px;font-weight:700;text-align:right;color:#f59e0b;">${item.pct}%</td>
    <td style="padding:8px 10px;font-size:13px;text-align:right;color:#94a3b8;">${item.avail} 坪</td>
  </tr>`).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',sans-serif;">
  <div style="max-width:680px;margin:24px auto;background:#1e293b;border-radius:12px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#4c1d95,#6d28d9);padding:20px 24px;">
      <h1 style="margin:0;color:#ede9fe;font-size:18px;">⚠️ 預防性保留提醒</h1>
      <p style="margin:6px 0 0;color:#c4b5fd;font-size:13px;">${today}　新增 ${items.length} 項保留占比超過 50%</p>
    </div>
    <div style="padding:12px 24px 8px;font-size:12px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.08);">
      保留占比 &gt; 50% 代表現貨有過半已被保留，請確認保留單是否真實有效。
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">進榜日</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">編號</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;">系列</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#64748b;">現貨</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#a78bfa;">保留</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#f59e0b;">占比</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#64748b;">可售</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div style="padding:16px 24px 20px;text-align:center;">
      <a href="${rsvAppLink_('tab=reserve')}" style="background:#6d28d9;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">查看預防性保留完整清單</a>
    </div>
    <div style="padding:0 24px 16px;text-align:center;font-size:10px;color:#475569;">Titan 保留系統 自動發送</div>
  </div></body></html>`;
}
