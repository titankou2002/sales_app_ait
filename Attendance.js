/**
 * 出缺勤管理後端 - 高雅瓷
 */

var ATT_SHEET_ID = '1Hcj7dSOc0KoRhEeGGKsxPazTKb4CUWEN7h2tqFkUfw0';

function _getAttSS() {
  return SpreadsheetApp.openById(ATT_SHEET_ID);
}

function _getAttSheet(name) {
  return _getAttSS().getSheetByName(name);
}

// 系統設定快取
function _getAttConfig() {
  var sheet = _getAttSheet('系統設定');
  var rows = sheet.getDataRange().getValues();
  var config = {};
  rows.forEach(function(r) {
    if (r[0] && r[1] !== '') config[r[0]] = r[1];
  });
  return config;
}

// 員工ID產生
function _nextEmpId() {
  var sheet = _getAttSheet('員工資料');
  var data = sheet.getDataRange().getValues();
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '');
    var num = parseInt(id.replace('EMP', '')) || 0;
    if (num > max) max = num;
  }
  return 'EMP' + String(max + 1).padStart(3, '0');
}

// 假單ID產生
function _nextLeaveId() {
  var sheet = _getAttSheet('請假紀錄');
  var count = Math.max(sheet.getLastRow() - 1, 0);
  var now = new Date();
  return 'L' + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(count+1).padStart(3,'0');
}

// 員工欄位對應
var STAFF_COLS = ['員工ID','姓名','職稱','LINE userId','LINE綁定時間','底薪','投保底薪','餐費','電話費','全勤獎金','主管ID','到職日','狀態'];

function _rowToStaff(row) {
  return {
    empId: row[0], name: row[1], title: row[2], lineUserId: row[3],
    lineBindTime: row[4], salary: row[5], insuredSalary: row[6],
    meal: row[7], phone: row[8], attendanceBonus: row[9],
    supervisorId: row[10], joinDate: row[11] ? Utilities.formatDate(new Date(row[11]), 'Asia/Taipei', 'yyyy-MM-dd') : '',
    status: row[12]
  };
}

// ─── 員工管理 ───────────────────────────────────────────

function getAttendanceStaffList() {
  try {
    var sheet = _getAttSheet('員工資料');
    var data = sheet.getDataRange().getValues();
    var result = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var s = _rowToStaff(data[i]);
      if (s.status !== '離職') result.push(s);
    }
    return { success: true, data: result };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function saveAttendanceStaff(data) {
  try {
    var sheet = _getAttSheet('員工資料');
    var rows = sheet.getDataRange().getValues();
    var joinDate = data.joinDate ? new Date(data.joinDate) : '';

    if (!data.empId) {
      // 新增
      var empId = _nextEmpId();
      sheet.appendRow([
        empId, data.name, data.title, '', '',
        Number(data.salary)||0, Number(data.insuredSalary)||0,
        Number(data.meal)||0, Number(data.phone)||0,
        Number(data.attendanceBonus)||0, data.supervisorId||'',
        joinDate, data.status||'在職'
      ]);
    } else {
      // 更新
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.empId) {
          var row = i + 1;
          sheet.getRange(row, 2).setValue(data.name);
          sheet.getRange(row, 3).setValue(data.title);
          sheet.getRange(row, 6).setValue(Number(data.salary)||0);
          sheet.getRange(row, 7).setValue(Number(data.insuredSalary)||0);
          sheet.getRange(row, 8).setValue(Number(data.meal)||0);
          sheet.getRange(row, 9).setValue(Number(data.phone)||0);
          sheet.getRange(row, 10).setValue(Number(data.attendanceBonus)||0);
          sheet.getRange(row, 11).setValue(data.supervisorId||'');
          sheet.getRange(row, 12).setValue(joinDate);
          sheet.getRange(row, 13).setValue(data.status||'在職');
          break;
        }
      }
    }
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

// ─── 打卡紀錄 ───────────────────────────────────────────

function getTodayAttendance() {
  try {
    var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
    var staffSheet = _getAttSheet('員工資料');
    var punchSheet = _getAttSheet('打卡紀錄');
    var leaveSheet = _getAttSheet('請假紀錄');
    var config = _getAttConfig();
    var lateThreshold = config['平日遲到門檻'] || '09:00';

    var staffData = staffSheet.getDataRange().getValues();
    var punchData = punchSheet.getDataRange().getValues();
    var leaveData = leaveSheet.getDataRange().getValues();

    // 今日打卡 map
    var punchMap = {};
    for (var i = 1; i < punchData.length; i++) {
      var pDate = punchData[i][0] ? Utilities.formatDate(new Date(punchData[i][0]), 'Asia/Taipei', 'yyyy-MM-dd') : '';
      if (pDate === today) punchMap[punchData[i][1]] = punchData[i];
    }

    // 今日請假 set
    var leaveSet = {};
    for (var j = 1; j < leaveData.length; j++) {
      var ls = leaveData[j][5] ? Utilities.formatDate(new Date(leaveData[j][5]), 'Asia/Taipei', 'yyyy-MM-dd') : '';
      var le = leaveData[j][6] ? Utilities.formatDate(new Date(leaveData[j][6]), 'Asia/Taipei', 'yyyy-MM-dd') : '';
      if (leaveData[j][9] === '核准' && ls <= today && le >= today) {
        leaveSet[leaveData[j][2]] = leaveData[j][4]; // empId -> leaveType
      }
    }

    var result = [];
    for (var k = 1; k < staffData.length; k++) {
      if (!staffData[k][0] || staffData[k][12] === '離職') continue;
      var empId = staffData[k][0];
      var punch = punchMap[empId];
      var inLeave = leaveSet[empId];
      var clockIn = punch ? (punch[3] ? Utilities.formatDate(new Date(punch[3]), 'Asia/Taipei', 'HH:mm') : '') : '';
      var clockOut = punch ? (punch[4] ? Utilities.formatDate(new Date(punch[4]), 'Asia/Taipei', 'HH:mm') : '') : '';

      var lateMinutes = 0;
      if (clockIn) {
        var parts = clockIn.split(':');
        var lateParts = lateThreshold.split(':');
        var inMins = parseInt(parts[0])*60 + parseInt(parts[1]);
        var lateMins = parseInt(lateParts[0])*60 + parseInt(lateParts[1]);
        lateMinutes = Math.max(0, inMins - lateMins);
      }

      var status = inLeave ? '請假'
        : clockIn ? (lateMinutes > 0 ? '遲到' : '出勤')
        : '缺勤';

      result.push({
        empId: empId,
        name: staffData[k][1],
        title: staffData[k][2],
        date: today,
        clockIn: clockIn,
        clockOut: clockOut,
        lateMinutes: lateMinutes,
        status: status,
        note: punch ? punch[10] : (inLeave ? inLeave : '')
      });
    }
    return { success: true, data: result };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function savePunchRecord(data) {
  try {
    var sheet = _getAttSheet('打卡紀錄');
    var allRows = sheet.getDataRange().getValues();
    var config = _getAttConfig();
    var lateThreshold = config['平日遲到門檻'] || '09:00';

    var dateVal = new Date(data.date);
    var clockInVal = data.clockIn ? new Date(data.date + 'T' + data.clockIn + ':00') : '';
    var clockOutVal = data.clockOut ? new Date(data.date + 'T' + data.clockOut + ':00') : '';

    // 計算遲到/工時
    var lateMinutes = 0;
    var workHours = '';
    var overtime = '';
    if (data.clockIn) {
      var inParts = data.clockIn.split(':');
      var lateParts = lateThreshold.split(':');
      var inMins = parseInt(inParts[0])*60+parseInt(inParts[1]);
      var lateMins = parseInt(lateParts[0])*60+parseInt(lateParts[1]);
      lateMinutes = Math.max(0, inMins - lateMins);
    }
    if (data.clockIn && data.clockOut) {
      var inParts2 = data.clockIn.split(':');
      var outParts = data.clockOut.split(':');
      var totalMins = (parseInt(outParts[0])*60+parseInt(outParts[1])) - (parseInt(inParts2[0])*60+parseInt(inParts2[1]));
      workHours = (totalMins/60).toFixed(1);
      overtime = Math.max(0, totalMins/60 - 8).toFixed(1);
    }

    // 找是否已有這天這個員工的紀錄（更新）
    var found = false;
    for (var i = 1; i < allRows.length; i++) {
      var rowDate = allRows[i][0] ? Utilities.formatDate(new Date(allRows[i][0]), 'Asia/Taipei', 'yyyy-MM-dd') : '';
      if (rowDate === data.date && allRows[i][1] === data.empId) {
        var r = i + 1;
        if (data.clockIn) sheet.getRange(r, 4).setValue(clockInVal);
        if (data.clockOut) sheet.getRange(r, 5).setValue(clockOutVal);
        sheet.getRange(r, 6).setValue(lateMinutes > 0 ? 'Y' : 'N');
        sheet.getRange(r, 7).setValue(lateMinutes);
        if (workHours) sheet.getRange(r, 8).setValue(workHours);
        if (overtime) sheet.getRange(r, 9).setValue(overtime);
        sheet.getRange(r, 10).setValue(data.method || '手動補登');
        sheet.getRange(r, 11).setValue(data.note || '');
        found = true;
        break;
      }
    }
    if (!found) {
      // 查員工姓名
      var staffSheet = _getAttSheet('員工資料');
      var staffRows = staffSheet.getDataRange().getValues();
      var empName = '';
      for (var s = 1; s < staffRows.length; s++) {
        if (staffRows[s][0] === data.empId) { empName = staffRows[s][1]; break; }
      }
      sheet.appendRow([
        dateVal, data.empId, empName,
        clockInVal || '', clockOutVal || '',
        lateMinutes > 0 ? 'Y' : 'N', lateMinutes,
        workHours, overtime,
        data.method || '手動補登', data.note || ''
      ]);
    }
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function getMonthlyAttendance(year, month, empId) {
  try {
    var sheet = _getAttSheet('打卡紀錄');
    var data = sheet.getDataRange().getValues();
    var result = [];
    var staffSheet = _getAttSheet('員工資料');
    var staffRows = staffSheet.getDataRange().getValues();
    var staffMap = {};
    for (var s = 1; s < staffRows.length; s++) staffMap[staffRows[s][0]] = { name: staffRows[s][1], title: staffRows[s][2] };

    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var d = new Date(data[i][0]);
      if (d.getFullYear() != year || (d.getMonth()+1) != month) continue;
      if (empId && data[i][1] !== empId) continue;
      var staff = staffMap[data[i][1]] || {};
      result.push({
        date: Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd'),
        empId: data[i][1],
        name: staff.name || data[i][2],
        clockIn: data[i][3] ? Utilities.formatDate(new Date(data[i][3]), 'Asia/Taipei', 'HH:mm') : '',
        clockOut: data[i][4] ? Utilities.formatDate(new Date(data[i][4]), 'Asia/Taipei', 'HH:mm') : '',
        isLate: data[i][5],
        lateMinutes: data[i][6] || 0,
        workHours: data[i][7] || '',
        overtime: data[i][8] || '',
        method: data[i][9] || '',
        note: data[i][10] || ''
      });
    }
    result.sort(function(a,b){ return a.date > b.date ? 1 : -1; });
    return { success: true, data: result };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

// ─── 請假管理 ───────────────────────────────────────────

function getLeaveList(status) {
  try {
    var sheet = _getAttSheet('請假紀錄');
    var data = sheet.getDataRange().getValues();
    var result = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      if (status !== '全部' && data[i][9] !== status) continue;
      result.push({
        leaveId: data[i][0],
        applyTime: data[i][1],
        empId: data[i][2],
        name: data[i][3],
        leaveType: data[i][4],
        startDate: data[i][5] ? Utilities.formatDate(new Date(data[i][5]), 'Asia/Taipei', 'yyyy-MM-dd') : '',
        endDate: data[i][6] ? Utilities.formatDate(new Date(data[i][6]), 'Asia/Taipei', 'yyyy-MM-dd') : '',
        hours: data[i][7] || 8,
        days: data[i][8] || 1,
        status: data[i][9],
        supervisorId: data[i][10],
        approveTime: data[i][11],
        note: data[i][12]
      });
    }
    result.sort(function(a,b){ return a.applyTime < b.applyTime ? 1 : -1; });
    return { success: true, data: result };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function addLeaveRecord(data) {
  try {
    var sheet = _getAttSheet('請假紀錄');
    var staffSheet = _getAttSheet('員工資料');
    var staffRows = staffSheet.getDataRange().getValues();
    var empName = '';
    for (var s = 1; s < staffRows.length; s++) {
      if (staffRows[s][0] === data.empId) { empName = staffRows[s][1]; break; }
    }
    var leaveId = _nextLeaveId();
    var startDate = new Date(data.startDate);
    var endDate = new Date(data.endDate);
    var days = Math.ceil((endDate - startDate) / (1000*60*60*24)) + 1;
    sheet.appendRow([
      leaveId, new Date(), data.empId, empName, data.leaveType,
      startDate, endDate, Number(data.hours)||8, days,
      data.status||'待審', '', '', data.note||''
    ]);
    // 若直接核准，更新特休餘額
    if (data.status === '核准' && data.leaveType === '特休') {
      _deductLeaveBalance(data.empId, days);
    }
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function updateLeaveStatus(leaveId, status) {
  try {
    var sheet = _getAttSheet('請假紀錄');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === leaveId) {
        sheet.getRange(i+1, 10).setValue(status);
        sheet.getRange(i+1, 12).setValue(new Date());
        // 若核准特休，扣抵餘額
        if (status === '核准' && data[i][4] === '特休') {
          _deductLeaveBalance(data[i][2], data[i][8]);
        }
        break;
      }
    }
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function _deductLeaveBalance(empId, days) {
  var sheet = _getAttSheet('特休餘額');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === empId) {
      var used = (data[i][5] || 0) + Number(days);
      var remain = (data[i][4] || 0) - used;
      sheet.getRange(i+1, 6).setValue(used);
      sheet.getRange(i+1, 7).setValue(Math.max(0, remain));
      sheet.getRange(i+1, 13).setValue(new Date());
      break;
    }
  }
}

// ─── 特休餘額 ───────────────────────────────────────────

function _calcAnnualLeave(tenure) {
  if (tenure < 0.5) return 0;
  if (tenure < 1) return 3;
  if (tenure < 2) return 7;
  if (tenure < 3) return 10;
  if (tenure < 5) return 14;
  if (tenure < 10) return 15;
  return Math.min(15 + Math.floor(tenure - 10) + 1, 30);
}

function getLeaveBalance() {
  try {
    var sheet = _getAttSheet('特休餘額');
    var data = sheet.getDataRange().getValues();
    var result = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      result.push({
        empId: data[i][0], name: data[i][1],
        joinDate: data[i][2] ? Utilities.formatDate(new Date(data[i][2]), 'Asia/Taipei', 'yyyy-MM-dd') : '',
        tenure: Math.round(data[i][3] * 10) / 10,
        annualLeave: data[i][4] || 0,
        usedAnnual: data[i][5] || 0,
        remainAnnual: data[i][6] || 0,
        expireDate: data[i][7] ? Utilities.formatDate(new Date(data[i][7]), 'Asia/Taipei', 'yyyy-MM-dd') : '',
        unusedPayout: data[i][8] || 0,
        personalLeave: data[i][9] || 0,
        sickLeave: data[i][10] || 0,
        compLeave: data[i][11] || 0
      });
    }
    return { success: true, data: result };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function recalcLeaveBalance() {
  try {
    var staffSheet = _getAttSheet('員工資料');
    var leaveSheet = _getAttSheet('請假紀錄');
    var balSheet = _getAttSheet('特休餘額');
    var staffRows = staffSheet.getDataRange().getValues();
    var leaveRows = leaveSheet.getDataRange().getValues();
    var now = new Date();

    // 計算各人請假天數
    var usedMap = {};
    for (var j = 1; j < leaveRows.length; j++) {
      if (leaveRows[j][9] !== '核准') continue;
      var empId = leaveRows[j][2];
      var type = leaveRows[j][4];
      var days = Number(leaveRows[j][8]) || 0;
      if (!usedMap[empId]) usedMap[empId] = { 特休:0, 事假:0, 病假:0, 補休:0 };
      usedMap[empId][type] = (usedMap[empId][type] || 0) + days;
    }

    // 清掉舊資料
    var lastRow = balSheet.getLastRow();
    if (lastRow > 1) balSheet.getRange(2, 1, lastRow - 1, 13).clearContent();

    var newRows = [];
    for (var i = 1; i < staffRows.length; i++) {
      if (!staffRows[i][0] || staffRows[i][12] === '離職') continue;
      var empId = staffRows[i][0];
      var joinDate = staffRows[i][11] ? new Date(staffRows[i][11]) : null;
      if (!joinDate) continue;
      var tenure = (now - joinDate) / (1000*60*60*24*365.25);
      var annualLeave = _calcAnnualLeave(tenure);
      var used = (usedMap[empId] && usedMap[empId]['特休']) || 0;
      var remain = Math.max(0, annualLeave - used);
      var expireDate = new Date(joinDate);
      expireDate.setFullYear(expireDate.getFullYear() + Math.ceil(tenure) + 1);
      newRows.push([
        empId, staffRows[i][1], joinDate,
        Math.round(tenure * 10) / 10,
        annualLeave, used, remain,
        expireDate, 0,
        14 - ((usedMap[empId] && usedMap[empId]['事假']) || 0),
        30 - ((usedMap[empId] && usedMap[empId]['病假']) || 0),
        (usedMap[empId] && usedMap[empId]['補休']) || 0,
        now
      ]);
    }
    if (newRows.length > 0) {
      balSheet.getRange(2, 1, newRows.length, 13).setValues(newRows);
    }
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function updateLeaveBalance(empId, remainDays) {
  try {
    var sheet = _getAttSheet('特休餘額');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === empId) {
        sheet.getRange(i+1, 7).setValue(remainDays);
        sheet.getRange(i+1, 13).setValue(new Date());
        return { success: true };
      }
    }
    return { success: false, msg: '找不到員工' };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function updateLeaveBalanceFull(empId, annual, used) {
  try {
    var sheet = _getAttSheet('特休餘額');
    var data = sheet.getDataRange().getValues();
    var remain = Math.max(0, annual - used);
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === empId) {
        sheet.getRange(i+1, 5).setValue(annual);
        sheet.getRange(i+1, 6).setValue(used);
        sheet.getRange(i+1, 7).setValue(remain);
        sheet.getRange(i+1, 13).setValue(new Date());
        return { success: true };
      }
    }
    // 找不到就新增一筆
    var staffSheet = _getAttSheet('員工資料');
    var staffRows = staffSheet.getDataRange().getValues();
    var emp = null;
    for (var s = 1; s < staffRows.length; s++) {
      if (staffRows[s][0] === empId) { emp = staffRows[s]; break; }
    }
    if (!emp) return { success: false, msg: '找不到員工' };
    var joinDate = emp[11] ? new Date(emp[11]) : new Date();
    var tenure = Math.round((new Date() - joinDate) / (1000*60*60*24*365.25) * 10) / 10;
    sheet.appendRow([empId, emp[1], joinDate, tenure, annual, used, remain, '', 0, 14, 30, 0, new Date()]);
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function deleteAttendanceStaff(empId) {
  try {
    var sheet = _getAttSheet('員工資料');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === empId) {
        sheet.getRange(i+1, 13).setValue('離職');
        return { success: true };
      }
    }
    return { success: false, msg: '找不到員工' };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

// ─── 薪資計算 ───────────────────────────────────────────

function calcMonthlySalary(year, month) {
  try {
    var staffSheet = _getAttSheet('員工資料');
    var punchSheet = _getAttSheet('打卡紀錄');
    var leaveSheet = _getAttSheet('請假紀錄');
    var config = _getAttConfig();
    var staffRows = staffSheet.getDataRange().getValues();
    var punchRows = punchSheet.getDataRange().getValues();
    var leaveRows = leaveSheet.getDataRange().getValues();

    // 本月打卡資料
    var punchMap = {}; // empId -> [rows]
    for (var i = 1; i < punchRows.length; i++) {
      if (!punchRows[i][0]) continue;
      var d = new Date(punchRows[i][0]);
      if (d.getFullYear() != year || (d.getMonth()+1) != month) continue;
      var eid = punchRows[i][1];
      if (!punchMap[eid]) punchMap[eid] = [];
      punchMap[eid].push(punchRows[i]);
    }

    // 本月請假資料
    var leaveMap = {}; // empId -> { 事假天數, 特休天數 }
    for (var j = 1; j < leaveRows.length; j++) {
      if (leaveRows[j][9] !== '核准') continue;
      var ls = leaveRows[j][5] ? new Date(leaveRows[j][5]) : null;
      if (!ls || ls.getFullYear() != year || (ls.getMonth()+1) != month) continue;
      var eid2 = leaveRows[j][2];
      if (!leaveMap[eid2]) leaveMap[eid2] = {};
      var lt = leaveRows[j][4];
      leaveMap[eid2][lt] = (leaveMap[eid2][lt] || 0) + Number(leaveRows[j][8]);
    }

    var result = [];
    for (var k = 1; k < staffRows.length; k++) {
      if (!staffRows[k][0] || staffRows[k][12] === '離職') continue;
      var emp = staffRows[k];
      var empId = emp[0];
      var salary = Number(emp[5]) || 0;
      var insuredSalary = Number(emp[6]) || salary;
      var meal = Number(emp[7]) || 0;
      var phone = Number(emp[8]) || 0;
      var attBonus = Number(emp[9]) || 0;
      var punches = punchMap[empId] || [];
      var leaves = leaveMap[empId] || {};

      // 遲到扣款（遲到每分鐘扣工資/天/8小時）
      var totalLateMin = 0;
      var totalOvertime = 0;
      punches.forEach(function(p) { totalLateMin += Number(p[6])||0; totalOvertime += Number(p[8])||0; });
      var dailySalary = salary / 30;
      var lateDeduction = Math.round(totalLateMin * (dailySalary / 8 / 60));

      // 事假扣款
      var personalLeaveDays = leaves['事假'] || 0;
      var personalDeduction = Math.round(personalLeaveDays * dailySalary);

      // 全勤判斷（本月無遲到、無事假）
      var hasFullAtt = totalLateMin === 0 && personalLeaveDays === 0;
      var attBonusFinal = hasFullAtt ? attBonus : 0;

      // 加班費（平日1.34倍，假設都是平日先）
      var overtimePay = Math.round(totalOvertime * (salary / 30 / 8) * 1.34);

      // 勞保（依投保薪資查級距，簡化：約9%，員工負擔20%）
      var laborInsurance = Math.round(insuredSalary * 0.09 * 0.2);
      // 健保（約5.17%，員工負擔30%）
      var healthInsurance = Math.round(insuredSalary * 0.0517 * 0.3);
      // 福利金（固定100，可由系統設定調整）
      var welfare = Number(config['福利金'] || 100);

      var grossPay = salary + attBonusFinal + meal + phone + overtimePay;
      var totalDeductions = laborInsurance + healthInsurance + welfare + lateDeduction + personalDeduction;
      var netPay = grossPay - totalDeductions;

      result.push({
        empId: empId, name: emp[1],
        baseSalary: salary, allowance: 0,
        attendanceBonus: attBonusFinal,
        perfBonus: 0, overtime: overtimePay,
        meal: meal, phone: phone,
        others: 0, grossPay: grossPay,
        laborInsurance: laborInsurance,
        healthInsurance: healthInsurance,
        welfare: welfare,
        lateDeduction: lateDeduction,
        personalDeduction: personalDeduction,
        otherDeductions: 0,
        totalDeductions: totalDeductions,
        netPay: netPay
      });
    }
    return { success: true, data: result };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function saveSalarySlips(year, month) {
  try {
    var res = calcMonthlySalary(year, month);
    if (!res.success) return res;
    var sheet = _getAttSheet('薪資計算紀錄');
    var monthStr = year + '-' + String(month).padStart(2,'0');
    // 移除本月舊資料
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === monthStr) sheet.deleteRow(i+1);
    }
    res.data.forEach(function(r) {
      sheet.appendRow([
        monthStr, r.empId, r.name, r.baseSalary, r.allowance,
        r.attendanceBonus, r.perfBonus, 0, r.meal, r.phone,
        r.overtime, 0, 0, r.grossPay,
        r.laborInsurance, r.healthInsurance, r.welfare,
        r.lateDeduction + r.personalDeduction, r.otherDeductions,
        r.totalDeductions, r.netPay, new Date(), ''
      ]);
    });
    return { success: true };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function updateSalaryRow(data) {
  try {
    var sheet = _getAttSheet('薪資計算紀錄');
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.month && rows[i][1] === data.empId) {
        sheet.getRange(i+1, 21).setValue(data.netPay);
        return { success: true };
      }
    }
    return { success: false, msg: '找不到紀錄' };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

// ─── 加薪記錄 ───────────────────────────────────────────

// 加薪記錄從原始薪資試算表讀取
var RAISE_SOURCE_ID = '1xMOOzl_Ad7OkUrvli5ZMnONymWLhUL2s49Ral-HIC6M';

function getRaiseRecords() {
  try {
    var ss = SpreadsheetApp.openById(RAISE_SOURCE_ID);
    var sheet = ss.getSheetByName('加薪記錄');
    if (!sheet) return { success: false, msg: '找不到「加薪記錄」分頁' };
    var data = sheet.getDataRange().getValues();
    var result = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      result.push({
        name: data[i][0],
        joinDate: data[i][1] ? Utilities.formatDate(new Date(data[i][1]), 'Asia/Taipei', 'yyyy-MM-dd') : '',
        tenure: data[i][2],
        origSalary: data[i][3],
        currSalary: data[i][22],
        allowance: data[i][23],
        attendanceBonus: data[i][24],
        meal: data[i][25] === 'X' ? '含' : (data[i][25] || '-'),
        phone: data[i][24] || '-',
        total: data[i][27],
        raiseRate: data[i][28],
        annualRate: data[i][29]
      });
    }
    return { success: true, data: result };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}
