/**
 * LineBot.js — 高雅瓷出缺勤 LINE Bot
 * 打卡、請假、出勤查詢
 */

var LINE_CHANNEL_ACCESS_TOKEN = '5aaalt0K05c/k3dH1DSnVX6cyc6FGcEUpawASN4PaklWyNgdKcaTSgYrm+6wBCH6pDcivyFnCCfasikUoFlEWV3+FoCduSoFOgWi10o/IN0FyuOOB5u1/wphbHNsK/7WI/CckF0N9BG2gTcGsCCX7QdB04t89/1O/w1cDnyilFU=';
var LINE_CHANNEL_SECRET = 'f5dd2736fe84058330197e204044d043';

// ─── Webhook 入口（立即回 200，存 queue 後由 trigger 處理）─────────

function doPost(e) {
  try {
    var body = e.postData.contents;
    var sig = (e.postData.headers && e.postData.headers['X-Line-Signature']) || '';

    // 若是 LINE Verify（events 為空），直接回 200
    var json = JSON.parse(body);
    if (!json.events || json.events.length === 0) {
      return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
    }

    // 用 PropertiesService 存 queue（比 Sheets 快 10 倍，毫秒級）
    var props = PropertiesService.getScriptProperties();
    var queueRaw = props.getProperty('LINE_QUEUE') || '[]';
    var queue = JSON.parse(queueRaw);
    queue.push({ ts: Date.now(), body: body, sig: sig });
    // 只保留最近 50 筆避免超過 9KB 限制
    if (queue.length > 50) queue = queue.slice(-50);
    props.setProperty('LINE_QUEUE', JSON.stringify(queue));

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
  }

  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

// ─── Queue 處理 trigger ───────────────────────────────────────────

function processLineBotQueue() {
  var props = PropertiesService.getScriptProperties();
  var queueRaw = props.getProperty('LINE_QUEUE') || '[]';
  var queue = JSON.parse(queueRaw);
  if (queue.length === 0) return;

  // 清空 queue 再處理（避免重複執行）
  props.setProperty('LINE_QUEUE', '[]');

  queue.forEach(function(item) {
    try {
      if (!_verifySignature(item.body, item.sig)) {
        Logger.log('invalid sig, skip');
        return;
      }
      var json = JSON.parse(item.body);
      var events = json.events || [];
      events.forEach(function(event) {
        if (event.type === 'message' && event.message.type === 'text') {
          _handleTextMessage(event);
        } else if (event.type === 'follow') {
          _handleFollow(event);
        }
      });
    } catch (err) {
      Logger.log('processLineBotQueue error: ' + err.toString());
    }
  });
}

function _ensureQueueTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processLineBotQueue') return;
  }
  ScriptApp.newTrigger('processLineBotQueue')
    .timeBased().everyMinutes(1).create();
}

// 手動清掉 trigger（需要時用）
function removeQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'processLineBotQueue') ScriptApp.deleteTrigger(t);
  });
}

// ─── 簽名驗證 ─────────────────────────────────────────────────────

function _verifySignature(body, signature) {
  if (!signature) return false;
  var hash = Utilities.computeHmacSha256Signature(body, LINE_CHANNEL_SECRET);
  var encoded = Utilities.base64Encode(hash);
  return encoded === signature;
}

// ─── 處理文字訊息 ─────────────────────────────────────────────────

function _handleTextMessage(event) {
  var userId = event.source.userId;
  var replyToken = event.replyToken;
  var text = event.message.text.trim();

  // 查詢員工（用 LINE userId 綁定）
  var emp = _findEmpByLineId(userId);

  // 未綁定 → 嘗試用姓名綁定
  if (!emp) {
    if (text.startsWith('#綁定 ')) {
      var name = text.replace('#綁定 ', '').trim();
      var result = _bindEmployee(userId, name);
      _reply(replyToken, result ? '✅ ' + name + '，綁定成功！\n\n輸入「上班」或「下班」即可打卡。' : '❌ 找不到「' + name + '」，請確認姓名是否正確。');
    } else {
      _reply(replyToken, '👋 你好！請先綁定員工帳號：\n\n輸入「#綁定 你的姓名」\n例如：#綁定 王大明');
    }
    return;
  }

  var name = emp.name;

  // 打卡指令
  if (text === '上班' || text === '上班打卡' || text === '✅上班') {
    _handlePunchIn(replyToken, emp);
  } else if (text === '下班' || text === '下班打卡' || text === '✅下班') {
    _handlePunchOut(replyToken, emp);
  } else if (text === '請假' || text === '申請假單') {
    _reply(replyToken, _buildLeaveMenu(name));
  } else if (text.startsWith('#請假')) {
    _handleLeaveRequest(replyToken, emp, text);
  } else if (text === '出勤查詢' || text === '我的出勤' || text === '出勤') {
    _handleAttendanceQuery(replyToken, emp);
  } else if (text === '特休查詢' || text === '特休') {
    _handleLeaveBalance(replyToken, emp);
  } else if (text === '選單' || text === 'menu' || text === '?') {
    _reply(replyToken, _buildMainMenu(name));
  } else {
    _reply(replyToken, _buildMainMenu(name));
  }
}

// ─── 追蹤（加好友）事件 ───────────────────────────────────────────

function _handleFollow(event) {
  var userId = event.source.userId;
  var replyToken = event.replyToken;
  _reply(replyToken, '👋 歡迎使用高雅瓷出缺勤系統！\n\n請輸入「#綁定 你的姓名」來綁定帳號。\n例如：#綁定 王大明');
}

// ─── 上班打卡 ─────────────────────────────────────────────────────

function _handlePunchIn(replyToken, emp) {
  var now = new Date();
  var today = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  var timeStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm');

  // 檢查今天是否已打上班卡
  var existing = _getTodayPunch(emp.empId, today);
  if (existing && existing.inTime) {
    _reply(replyToken, '⚠️ ' + emp.name + '，今天已打過上班卡（' + existing.inTime + '）\n\n如需修正請聯絡主管。');
    return;
  }

  // 判斷遲到
  var lateThreshold = '09:00';
  var isLate = timeStr > lateThreshold;
  var lateMin = 0;
  if (isLate) {
    var th = lateThreshold.split(':');
    var tw = timeStr.split(':');
    lateMin = (parseInt(tw[0]) - parseInt(th[0])) * 60 + (parseInt(tw[1]) - parseInt(th[1]));
  }

  // 寫入打卡紀錄
  var sheet = _getAttSheet('打卡紀錄');
  sheet.appendRow([
    today, emp.empId, emp.name, timeStr, '', isLate ? 'Y' : 'N', lateMin, '', 0, 'LINE', ''
  ]);

  var msg = '✅ ' + emp.name + ' 上班打卡成功！\n🕐 時間：' + timeStr;
  if (isLate) msg += '\n⚠️ 遲到 ' + lateMin + ' 分鐘';
  msg += '\n\n輸入「下班」完成下班打卡。';
  _reply(replyToken, msg);
}

// ─── 下班打卡 ─────────────────────────────────────────────────────

function _handlePunchOut(replyToken, emp) {
  var now = new Date();
  var today = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  var timeStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm');

  var sheet = _getAttSheet('打卡紀錄');
  var data = sheet.getDataRange().getValues();

  // 找今天這員工的打卡列（從最後一列往前找）
  var targetRow = -1;
  for (var i = data.length - 1; i >= 1; i--) {
    var rowDate = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], 'Asia/Taipei', 'yyyy-MM-dd')
      : String(data[i][0]).slice(0, 10);
    if (rowDate === today && String(data[i][1]) === emp.empId) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    _reply(replyToken, '⚠️ ' + emp.name + '，今天尚未打上班卡，無法打下班卡。\n\n請先輸入「上班」。');
    return;
  }

  if (data[targetRow - 1][4]) {
    _reply(replyToken, '⚠️ ' + emp.name + '，今天已打過下班卡（' + data[targetRow - 1][4] + '）。');
    return;
  }

  // 計算工時
  var inTime = String(data[targetRow - 1][3]);
  var workHours = _calcWorkHours(inTime, timeStr);
  var standardHours = 8;
  var overtime = Math.max(0, workHours - standardHours);

  // 更新下班時間、工時、加班
  sheet.getRange(targetRow, 5).setValue(timeStr);
  sheet.getRange(targetRow, 8).setValue(workHours.toFixed(1));
  sheet.getRange(targetRow, 9).setValue(overtime > 0 ? overtime.toFixed(1) : 0);

  var msg = '✅ ' + emp.name + ' 下班打卡成功！\n🕐 時間：' + timeStr;
  msg += '\n⏱ 工時：' + workHours.toFixed(1) + ' 小時';
  if (overtime > 0.1) msg += '\n⏫ 加班：' + overtime.toFixed(1) + ' 小時';
  _reply(replyToken, msg);
}

// ─── 請假申請 ─────────────────────────────────────────────────────

function _handleLeaveRequest(replyToken, emp, text) {
  // 格式：#請假 特休 2025-06-18 2025-06-18
  var parts = text.replace('#請假 ', '').split(' ');
  if (parts.length < 3) {
    _reply(replyToken, '格式錯誤，請依照以下格式：\n\n#請假 假別 開始日期 結束日期\n例：#請假 特休 2025-06-18 2025-06-18\n\n假別：特休、事假、病假、婚假、喪假');
    return;
  }
  var leaveType = parts[0];
  var startDate = parts[1];
  var endDate = parts[2];
  var validTypes = ['特休', '事假', '病假', '婚假', '喪假', '颱風假', '公假'];
  if (validTypes.indexOf(leaveType) === -1) {
    _reply(replyToken, '不支援的假別：' + leaveType + '\n\n可用假別：' + validTypes.join('、'));
    return;
  }

  var days = _calcLeaveDays(startDate, endDate);
  var leaveId = 'LV' + new Date().getTime().toString().slice(-8);
  var now = new Date();

  var sheet = _getAttSheet('請假紀錄');
  sheet.appendRow([
    leaveId,
    Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
    emp.empId, emp.name, leaveType, startDate, endDate, days * 8, days,
    '待審核', '', '', ''
  ]);

  _reply(replyToken,
    '📋 請假申請已送出！\n\n' +
    '員工：' + emp.name + '\n' +
    '假別：' + leaveType + '\n' +
    '期間：' + startDate + ' ～ ' + endDate + '\n' +
    '天數：' + days + ' 天\n' +
    '假單號：' + leaveId + '\n\n' +
    '⏳ 等待主管審核'
  );
}

// ─── 出勤查詢 ─────────────────────────────────────────────────────

function _handleAttendanceQuery(replyToken, emp) {
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth() + 1;
  var ym = year + '-' + (month < 10 ? '0' + month : month);

  var sheet = _getAttSheet('打卡紀錄');
  var data = sheet.getDataRange().getValues();

  var days = 0, lateCount = 0, overtimeTotal = 0;
  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], 'Asia/Taipei', 'yyyy-MM')
      : String(data[i][0]).slice(0, 7);
    if (rowDate === ym && String(data[i][1]) === emp.empId && data[i][4]) {
      days++;
      if (data[i][5] === 'Y') lateCount++;
      overtimeTotal += Number(data[i][8]) || 0;
    }
  }

  _reply(replyToken,
    '📊 ' + emp.name + ' ' + year + '年' + month + '月出勤\n\n' +
    '✅ 出勤天數：' + days + ' 天\n' +
    (lateCount > 0 ? '⚠️ 遲到次數：' + lateCount + ' 次\n' : '') +
    (overtimeTotal > 0 ? '⏫ 加班總時數：' + overtimeTotal.toFixed(1) + ' 小時\n' : '') +
    '\n輸入「特休」查詢特休餘額'
  );
}

// ─── 特休查詢 ─────────────────────────────────────────────────────

function _handleLeaveBalance(replyToken, emp) {
  var sheet = _getAttSheet('特休餘額');
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === emp.empId) {
      var annual = Number(data[i][4]) || 0;
      var used = Number(data[i][5]) || 0;
      var remain = Math.max(0, annual - used);
      _reply(replyToken,
        '🌴 ' + emp.name + ' 特休餘額\n\n' +
        '應有特休：' + annual + ' 天\n' +
        '已使用：' + used + ' 天\n' +
        '剩餘：' + remain + ' 天\n' +
        '到期日：' + (data[i][7] || '-')
      );
      return;
    }
  }
  _reply(replyToken, '找不到特休資料，請聯絡管理員。');
}

// ─── 選單文字 ─────────────────────────────────────────────────────

function _buildMainMenu(name) {
  return '👋 ' + name + '，可使用以下指令：\n\n' +
    '✅ 上班 — 上班打卡\n' +
    '🏁 下班 — 下班打卡\n' +
    '📋 請假 — 申請假單\n' +
    '📊 出勤查詢 — 本月出勤\n' +
    '🌴 特休查詢 — 特休餘額';
}

function _buildLeaveMenu(name) {
  return '📋 ' + name + '，請依格式申請假單：\n\n' +
    '#請假 假別 開始日期 結束日期\n\n' +
    '例：#請假 特休 2025-06-20 2025-06-20\n\n' +
    '可用假別：\n特休、事假、病假、婚假、喪假、颱風假、公假';
}

// ─── 工具函式 ─────────────────────────────────────────────────────

function _getAttSheet(sheetName) {
  return SpreadsheetApp.openById(ATT_SHEET_ID).getSheetByName(sheetName);
}

function _findEmpByLineId(userId) {
  var sheet = _getAttSheet('員工資料');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][3]) === userId && data[i][12] === '在職') {
      return { empId: String(data[i][0]), name: String(data[i][1]), row: i + 1 };
    }
  }
  return null;
}

function _bindEmployee(userId, name) {
  var sheet = _getAttSheet('員工資料');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === name.trim() && data[i][12] === '在職') {
      sheet.getRange(i + 1, 4).setValue(userId);
      sheet.getRange(i + 1, 5).setValue(Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'));
      return true;
    }
  }
  return false;
}

function _getTodayPunch(empId, today) {
  var sheet = _getAttSheet('打卡紀錄');
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    var rowDate = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], 'Asia/Taipei', 'yyyy-MM-dd')
      : String(data[i][0]).slice(0, 10);
    if (rowDate === today && String(data[i][1]) === empId) {
      return { inTime: data[i][3], outTime: data[i][4] };
    }
  }
  return null;
}

function _calcWorkHours(inTime, outTime) {
  var i = inTime.split(':').map(Number);
  var o = outTime.split(':').map(Number);
  var mins = (o[0] * 60 + o[1]) - (i[0] * 60 + i[1]);
  // 扣午休1小時（若工時超過5小時）
  if (mins > 300) mins -= 60;
  return Math.max(0, mins / 60);
}

function _calcLeaveDays(startDate, endDate) {
  var s = new Date(startDate);
  var e = new Date(endDate);
  var days = 0;
  var cur = new Date(s);
  while (cur <= e) {
    var dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, days);
}

// ─── LINE Reply API ───────────────────────────────────────────────

function _reply(replyToken, text) {
  var payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: String(text) }]
  };
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// Push 訊息（主動推送，非 reply）
function _push(userId, text) {
  var payload = {
    to: userId,
    messages: [{ type: 'text', text: String(text) }]
  };
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// 測試用：確認 Bot Token 有效
function testLineBotInfo() {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}
