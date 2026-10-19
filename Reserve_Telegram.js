/**
 * 保留系統 — Service_Telegram.js
 * Telegram 通報、智能進度跟進提醒與週報排程
 */

// 初始化 Telegram 設定（Token）
function _initTelegram() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('TG_TOKEN', '8665549878:AAH3_HiXF6rZAbiGfs3buIkIYW8-i4a5tMM');

  // 發送測試訊息（收件人依目前分支設定）
  const br = getBranch_();
  pushTelegram('🧪 【系統初始化】\n保留系統 Telegram 通知設定成功！\n目前分支：' + br.label + '　收件：' + (br.tgChatIds || []).join(','), br);
  console.log('✅ Telegram 初始化設定完成，測試訊息已發送。');
}

// 基礎發送 Telegram 純文字訊息（收件人依目前分支 getBranch_().tgChatIds；可傳 br 明確指定分公司，
// 避免併發使用者／其他觸發器改動 CURRENT_BRANCH 造成訊息送錯群）
function pushTelegram(text, br) {
  // 寫入 TG_DEBUG 分頁供偵錯使用
  try {
    const dbSs = SpreadsheetApp.openById((br || getBranch_()).dbSS);
    const dbg = dbSs.getSheetByName('TG_DEBUG') || dbSs.insertSheet('TG_DEBUG');
    dbg.appendRow([new Date(), text.slice(0, 200)]);
  } catch(e) {
    console.error('寫入 TG_DEBUG 失敗: ' + e.message);
  }

  const br2 = br || getBranch_();
  if (!br2.hasTelegram || !br2.tgChatIds || !br2.tgChatIds.length) {
    console.warn('目前分支（' + br2.label + '）未設定 Telegram 收件人，取消發送。');
    return;
  }
  var token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  if (!token) {
    console.warn('Telegram token 尚未設定，取消發送。');
    return;
  }
  
  br2.tgChatIds.forEach(function(chatId) {
    chatId = String(chatId).trim();
    if (!chatId) return;
    try {
      // disable_web_page_preview 一定要開：Telegram 收到訊息裡的網址會自動預覽抓取一次，
      // 續保/取消連結是單次使用的 token，會被這個預覽動作提前用掉，害使用者點進去變成「連結已失效」。
      UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ chat_id: chatId, text: text, disable_web_page_preview: true }),
        muteHttpExceptions: true
      });
    } catch(e) {
      console.error('Telegram 發送至 ' + chatId + ' 失敗: ' + e.message);
    }
  });
}

// 基礎發送 Telegram 帶按鈕訊息（收件人依目前分支 getBranch_().tgChatIds；可傳 br 明確指定分公司）
function pushTelegramButtons(text, buttons, br) {
  var token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  const br2 = br || getBranch_();
  if (!token || !br2.hasTelegram || !br2.tgChatIds || !br2.tgChatIds.length) return;
  
  // buttons 格式: [[{text: '按鈕文字', url: '連結'}], ...]
  var keyboard = buttons.map(function(row) {
    return row.map(function(btn) { return { text: btn.text, url: btn.url }; });
  });
  
  br2.tgChatIds.forEach(function(chatId) {
    chatId = String(chatId).trim();
    if (!chatId) return;
    try {
      UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          chat_id: chatId,
          text: text,
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: keyboard }
        }),
        muteHttpExceptions: true
      });
    } catch(e) {
      console.error('Telegram 發送按鈕訊息至 ' + chatId + ' 失敗: ' + e.message);
    }
  });
}

// 發送 Telegram 帶按鈕訊息到指定 chat_id（業務個人私訊用；按鈕一樣用 disable_web_page_preview 保護 token 連結）
function pushTelegramButtonsTo_(chatId, text, buttons) {
  var token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  if (!token || !chatId) return false;
  var keyboard = buttons.map(function(row) {
    return row.map(function(btn) { return { text: btn.text, url: btn.url }; });
  });
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: String(chatId),
        text: text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard }
      }),
      muteHttpExceptions: true
    });
    return true;
  } catch(e) {
    console.error('Telegram 帶按鈕發送至 ' + chatId + ' 失敗: ' + e.message);
    return false;
  }
}

// 智能語意解析業務更新進度中的到期日
function parseFollowUpDate_(progressText, progressDateStr) {
  var lastUpdate = new Date();
  if (progressDateStr) {
    var parsed = parseAnyDate_(progressDateStr);
    if (parsed) lastUpdate = parsed;
  }
  
  var today = new Date();
  today.setHours(0,0,0,0);
  
  var text = String(progressText || '').trim();
  
  // 1. 匹配具體日期格式 (如 7/15, 07-15, 7月15日)
  var dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})/) || text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (dateMatch) {
    var m = parseInt(dateMatch[1], 10);
    var d = parseInt(dateMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      var targetDate = new Date(today.getFullYear(), m - 1, d);
      return targetDate;
    }
  }
  
  // 2. 匹配月份關鍵字 (如 7月, 八月)
  var monthMatch = text.match(/(\d{1,2})\s*月/);
  if (monthMatch) {
    var m = parseInt(monthMatch[1], 10);
    if (m >= 1 && m <= 12) {
      // 預設為該月 15 日
      var targetDate = new Date(today.getFullYear(), m - 1, 15);
      return targetDate;
    }
  }
  
  // 中文月份支援
  const cnMonths = {'一':0, '二':1, '三':2, '四':3, '五':4, '六':5, '七':6, '八':7, '九':8, '十':9, '十一':10, '十二':11};
  for (var key in cnMonths) {
    if (text.indexOf(key + '月') !== -1) {
      var targetDate = new Date(today.getFullYear(), cnMonths[key], 15);
      return targetDate;
    }
  }
  
  // 3. 相對月份關鍵字 (本月/下月/這個月/下個月)
  if (/(本月|這個月|當月)/.test(text)) {
    // 預設為當月 20 日
    var targetDate = new Date(today.getFullYear(), today.getMonth(), 20);
    if (today >= targetDate) {
      // 若已過當月 20 日，設定為今日往後加 7 天
      targetDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    return targetDate;
  }
  
  if (/(下月|下個月)/.test(text)) {
    // 預設為下個月 15 日
    var targetDate = new Date(today.getFullYear(), today.getMonth() + 1, 15);
    return targetDate;
  }
  
  // 4. 依狀態預設天數
  var daysToAdd = 14; // 預設 14 天
  if (text.indexOf('可付訂金') !== -1 || text.indexOf('可簽確認單') !== -1 || text.indexOf('訂金') !== -1) {
    daysToAdd = 7;
  } else if (text.indexOf('業務掛保證') !== -1 || text.indexOf('掛保證') !== -1 || text.indexOf('保證') !== -1) {
    daysToAdd = 14;
  } else if (text.indexOf('轉報備') !== -1 || text.indexOf('報備') !== -1) {
    daysToAdd = 30;
  }
  
  return new Date(lastUpdate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
}

// 每日 09:30 執行：掃描未結案案場，若跟進時間到則推播 Telegram
function sendFollowUpReminders() {
  setBranch_('gaoyaci'); // 進度跟進提醒目前僅高雅瓷啟用
  const br = getBranch_();
  try {
    var resData = getReserveData();
    if (resData.error || !resData.sites) {
      console.error('取得保留資料失敗: ' + resData.error);
      return;
    }
    
    var today = new Date();
    today.setHours(0,0,0,0);
    var props = PropertiesService.getScriptProperties();
    var remindCount = 0;
    
    resData.sites.forEach(function(s) {
      // 排除已結案、已取消、已刪除等完全結束的案子
      if (isArchiveProgress_(s.deposit, s.progress)) return;
      
      // 計算此案場的跟進到期日
      var followUpDate = parseFollowUpDate_(s.progress, s.progressDate || s.dateRes);
      followUpDate.setHours(0,0,0,0);
      
      if (today >= followUpDate) {
        // 防止洗版機制：7 天內不重複通知同一個 siteKey
        var propKey = 'TG_REMIND_SENT_' + s.siteKey.replace(/\s+/g, '_');
        var lastSentStr = props.getProperty(propKey);
        if (lastSentStr) {
          var lastSent = parseAnyDate_(lastSentStr);
          if (lastSent && (today - lastSent < 7 * 24 * 60 * 60 * 1000)) {
            // 已在 7 天內通知過，略過
            return;
          }
        }
        
        // 格式化推播訊息
        var ageDays = s.days;
        var progressDesc = s.progress ? s.progress : '尚未填寫進度';
        var lastUpdateDesc = s.progressDate ? s.progressDate : s.dateRes;
        
        var itemLines = (s.products || []).map(function(p) { return '　・' + p.code + '×' + p.qty + '片'; }).join('\n');
        var msg = '⏰ 【保留單進度跟進提醒】\n' +
                  '客戶：' + s.cust + '\n' +
                  '案名：' + (s.projName || s.site) + '\n' +
                  (itemLines ? itemLines + '\n' : '') +
                  '負責業務：' + (s.salesRep || '未指定') + '\n' +
                  '保留天數：' + ageDays + ' 天 (保留日期: ' + s.dateRes + ')\n' +
                  '最後更新：' + lastUpdateDesc + '\n' +
                  '前次進度：' + progressDesc + '\n\n' +
                  '💡 此案已達追蹤期限，請負責業務協助確認並更新最新進度！';
                  
        pushTelegram(msg, br);
        
        // 紀錄本次發送日期，避免重發
        props.setProperty(propKey, Utilities.formatDate(today, 'Asia/Taipei', 'yyyy/MM/dd'));
        remindCount++;
      }
    });
    
    console.log('✅ 每日跟進提醒執行完畢，共發出 ' + remindCount + ' 筆通知。');
  } catch(e) {
    console.error('執行跟進提醒出錯: ' + e.message);
  }
}

// 週一早上 09:00 執行：缺貨與訂貨明細報告（簡化版；三家分公司依序發送各自缺貨週報）
function sendMondayShortageReport() {
  forEachBranch_(function(br, key) {
    try {
      var board = getShortageBoardData(key);
      if (!board.success || !board.items) {
        console.error('取得缺貨看板資料失敗（' + br.label + '）: ' + board.error);
        return;
      }

      var items = board.items;

      // 1. 缺貨明細 (等候開狀, 國外缺貨, 尚未處理且非生產/排船/海上飄/已結案/不續辦)
      var shortList = [];
      // 2. 補貨中明細 (生產中, 排船中)
      var orderList = [];

      items.forEach(function(item) {
        var status = String(item['處理狀態'] || '').trim();
        var cleanCode = String(item['產品編號'] || '').trim();
        var series = String(item['系列名稱'] || '').trim();
        var avail = parseFloat(item['可用庫存']) || 0;

        if (status === '生產中' || status === '排船中') {
          var eta = String(item['預定到貨日'] || item['預計日期'] || '未定').trim();
          orderList.push(cleanCode + (series ? ' ' + series : '') + '\u3000ETA ' + (eta || '未定'));
        } else if (status !== '海上飄' && status !== '出清結案' && status !== '不續辦') {
          shortList.push(cleanCode + (series ? ' ' + series : '') + '\u3000可用 '
            + (Math.round(avail * 10) / 10) + ' 坪');
        }
      });

      var dateLabel = Utilities.formatDate(new Date(), 'Asia/Taipei', 'MM/dd');
      var msg = '📦 週一缺貨週報 ' + dateLabel + '\n\n';
      msg += '缺貨 ' + shortList.length + ' 筆｜補貨中 ' + orderList.length + ' 筆\n\n';
      msg += '🔴 缺貨\n' + (shortList.length > 0 ? shortList.join('\n') : '無') + '\n\n';
      msg += '🟡 補貨中\n' + (orderList.length > 0 ? orderList.join('\n') : '無');

      pushTelegram(msg, br);
      console.log('✅ 週一補庫與缺貨週報發送成功（' + br.label + '）。');
    } catch(e) {
      console.error('發送週一週報出錯（' + br.label + '）: ' + e.message);
    }
  });
}

// 近 3 天內「新進榜」的缺貨／保留滿品項通報（每天 18:00 執行）
// 規則：缺貨層（完全/嚴重/快要斷貨/即將缺貨）＋保留滿（預防性保留）才收，排除新品/全新品觀察；
//       每品項以「進榜週期」為單位只報一次（key 含入榜日期）；每日上限 15 筆，超過的明日續報（key 不寫）。
function sendNewShortageEntries() {
  forEachBranch_(function(br, key) {
    try {
      const board = getShortageBoardData(key);
      if (!board.success || !board.items) {
        console.error('取得缺貨看板資料失敗（' + br.label + '）: ' + board.error);
        return;
      }

      const realCats = { '完全缺貨': 0, '嚴重缺貨': 0, '快要斷貨': 1, '即將缺貨': 2, '預防性保留': 3 };
      const props = PropertiesService.getScriptProperties();
      const branch = currentBranchName_();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const windowStart = new Date(today.getTime() - 2 * 86400000); // 今、昨、前天＝近 3 天
      const dailyKey = 'SHORTAGE_NEW3D_DAILY_' + Utilities.formatDate(today, 'Asia/Taipei', 'yyyyMMdd') + '_' + branch;
      let dailyCount = parseInt(props.getProperty(dailyKey) || '0', 10) || 0;
      const MAX_PER_DAY = 15;

      const eligible = [];
      board.items.forEach(function(item) {
        const cat = String(item['缺貨分類'] || '').trim();
        if (!(cat in realCats)) return;                                   // 只要缺貨層＋保留滿
        if (String(item['出清結案'] || '').trim()) return;
        const raw = item['入榜日期'];
        const entryObj = raw instanceof Date ? raw : new Date(String(raw || '').replace(/\//g, '-'));
        if (isNaN(entryObj.getTime())) return;
        const entryDay = new Date(entryObj.getTime());
        entryDay.setHours(0, 0, 0, 0);
        if (entryDay < windowStart || entryDay > today) return;           // 近 3 天（不含未來）
        const code = String(item['產品編號'] || '').trim().toUpperCase().replace(/[\s\-]/g, '');
        if (!code) return;
        // 以「進榜週期」為單位只報一次：key 含入榜日期，之後重進榜（新日期）可再報
        const entryKey = 'SHORTAGE_NEW3D_' + branch + '_' + code + '_' + Utilities.formatDate(entryDay, 'Asia/Taipei', 'yyyyMMdd');
        if (props.getProperty(entryKey)) return;
        eligible.push({
          code: String(item['產品編號'] || '').trim(),
          series: String(item['系列名稱'] || '').trim(),
          cat: cat,
          avail: parseFloat(item['可用庫存']) || 0,
          entryDay: entryDay,
          entryKey: entryKey
        });
      });

      if (eligible.length === 0) return;   // 無新進榜 → 安靜

      // 依嚴重度排序（完全/嚴重缺貨最前），同級可用最少者在前
      eligible.sort(function(a, b) {
        if (realCats[a.cat] !== realCats[b.cat]) return realCats[a.cat] - realCats[b.cat];
        if (a.avail !== b.avail) return a.avail - b.avail;
        return a.entryDay - b.entryDay;
      });

      const capacity = Math.max(0, MAX_PER_DAY - dailyCount);
      const picks = eligible.slice(0, capacity);
      const deferredCount = eligible.length - picks.length;
      if (picks.length === 0) return;      // 今日配額已用完 → 全部延續，不發

      const dateLabel = Utilities.formatDate(today, 'Asia/Taipei', 'MM/dd');
      const prevPicks = picks.filter(p => p.cat === '預防性保留').length;
      let msg = '🆕 ' + br.label + ' 近3天新進榜 ' + dateLabel + '\n\n';
      msg += '缺貨 ' + (picks.length - prevPicks) + ' 筆｜保留滿 ' + prevPicks + ' 筆'
           + (deferredCount > 0 ? '｜另有 ' + deferredCount + ' 筆明日續報' : '') + '\n\n';

      const catIcon = { '完全缺貨': '🔴', '嚴重缺貨': '🔴', '快要斷貨': '🟠', '即將缺貨': '🟡', '預防性保留': '🔵' };
      Object.keys(realCats).forEach(function(catName) {
        const arr = picks.filter(p => p.cat === catName);
        if (!arr.length) return;
        msg += (catName === '預防性保留' ? '🔵 保留滿\n' : catIcon[catName] + ' ' + catName + '\n');
        arr.forEach(function(p) {
          msg += p.code + (p.series ? ' ' + p.series : '') + '\u3000可用 ' + (Math.round(p.avail * 10) / 10) + ' 坪\n';
        });
        msg += '\n';
      });

      // 按下單才記 key、記每日配額
      picks.forEach(function(p) { props.setProperty(p.entryKey, '1'); });
      dailyCount += picks.length;
      props.setProperty(dailyKey, String(dailyCount));

      pushTelegram(msg, br);
      console.log('✅ 近3天新進榜通報發送成功（' + br.label + '）：' + picks.length + ' 筆' + (deferredCount ? '，延續 ' + deferredCount + ' 筆' : ''));
    } catch (e) {
      console.error('sendNewShortageEntries 出錯（' + br.label + '）: ' + e.message);
    }
  });
}

function setupNewShortageEntryTrigger() {
  const existing = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendNewShortageEntries');
  if (existing.length) {
    console.log('⏭ 新進榜通報觸發器已存在，跳過');
    return;
  }
  ScriptApp.newTrigger('sendNewShortageEntries')
    .timeBased().everyDays(1).atHour(18).create();
  console.log('✅ 新進榜通報觸發器已設定：每天 18:00');
}

// 週二早上 09:00 執行：貨櫃系統在途船期公告（以船名/櫃號分組）
function sendTuesdayOnSeaReport() {
  forEachBranch_(function(br, key) {
    try {
      if (!br.containerSS) return; // 該分公司未啟用貨櫃到貨排程
      var metaMap = getPriceMetaMap_(key) || {};
      var containerMap = getIncomingContainerMap_(null, key) || {};

      var today = new Date();
      today.setHours(0, 0, 0, 0);

      var shipMap = {};

      Object.keys(containerMap).forEach(function(code) {
        var items = containerMap[code] || [];
        var meta = metaMap[code] || {};
        var seriesName = meta.series || meta.name || '';

        items.forEach(function(shipment) {
          if (!shipment.date) return;

          // 🚀 預定到貨日 (ETA) 加 10 天算實際到港/到庫日
          var arrivalDate = new Date(shipment.date.getTime() + 10 * 24 * 60 * 60 * 1000);
          arrivalDate.setHours(0, 0, 0, 0);

          if (arrivalDate < today) return;

          var daysLeft = Math.max(0, Math.round((arrivalDate - today) / (24 * 60 * 60 * 1000)));
          var arrivalDateStr = Utilities.formatDate(arrivalDate, 'Asia/Taipei', 'M/d');
          var shipName = shipment.shipName || shipment.containerNo || '在途船隻';
          var shipKey = shipName + '_' + arrivalDateStr;

          if (!shipMap[shipKey]) {
            shipMap[shipKey] = {
              shipName: shipName,
              arrivalDate: arrivalDate,
              arrivalDateStr: arrivalDateStr,
              daysLeft: daysLeft,
              items: []
            };
          }

          shipMap[shipKey].items.push({
            code: code,
            name: seriesName,
            qtyPing: shipment.qtyPing
          });
        });
      });

      var shipList = Object.keys(shipMap).map(function(k) { return shipMap[k]; });
      if (shipList.length === 0) return;

      shipList.sort(function(a, b) { return a.arrivalDate - b.arrivalDate; });

      var msg = '🚢 【週二貨櫃在途船期公告】\n\n';
      shipList.forEach(function(ship) {
        msg += '🚢 ' + ship.shipName + '\n';
        msg += '📅 ' + ship.arrivalDateStr + ' 到港 (剩 ' + ship.daysLeft + ' 天)\n';
        ship.items.forEach(function(item) {
          var title = item.name ? item.name + ' ' + item.code : item.code;
          msg += '・' + title + ' ' + item.qtyPing + ' 坪\n';
        });
        msg += '\n';
      });

      pushTelegram(msg.trim(), br);
      console.log('✅ 週二在途週報發送成功（' + br.label + '）：' + shipList.length + ' 艘船/櫃。');
    } catch(e) {
      console.error('發送週二週報出錯（' + br.label + '）：' + e.message);
    }
  });
}

// 註冊與重置所有 Telegram 通知相關排程觸發器
function setupAllTelegramTriggers() {
  // 1. 清除舊有的 Telegram 觸發器
  var tgHandlers = ['sendFollowUpReminders', 'sendMondayShortageReport', 'sendTuesdayOnSeaReport', 'sendNewShortageEntries'];
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return tgHandlers.indexOf(t.getHandlerFunction()) !== -1; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // 2. 每日跟進提醒：每天上午 09:30
  ScriptApp.newTrigger('sendFollowUpReminders')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(30)
    .create();

  // 3. 週一缺貨與訂貨週報：每週一上午 09:00
  ScriptApp.newTrigger('sendMondayShortageReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .nearMinute(0)
    .create();

  // 4. 週二海上飄週報：每週二上午 09:00
  ScriptApp.newTrigger('sendTuesdayOnSeaReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY)
    .atHour(9)
    .nearMinute(0)
    .create();

  // 5. 近 3 天新進榜通報：每天下午 18:00
  ScriptApp.newTrigger('sendNewShortageEntries')
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .create();

  console.log('✅ 所有 Telegram 自動排程觸發器已重新註冊：\n- 每日 09:30 跟進提醒\n- 每週一 09:00 缺貨與訂貨週報\n- 每週二 09:00 海上飄週報\n- 每日 18:00 近3天新進榜通報');
}

// 強制觸發 Google 授權視窗的輔助功能 (無 try-catch 阻擋)
function forceAuth() {
  UrlFetchApp.fetch('https://api.telegram.org/');
}
