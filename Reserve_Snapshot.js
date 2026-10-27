/**
 * 庫存每日快照（保留系統）
 *
 * 目的：留下「某一天」每個品項的現貨、保留、可用、在途，之後才能分析
 *   - 從破 50% 保留到缺貨隔幾天（預警時間夠不夠）
 *   - 缺貨幾天、保留消耗速度、補貨週期
 * 睡美人戰情室的快照只留「每月最後一筆」，看不出月中變化；這份是逐日。
 *
 * 做法（省空間）：
 *   - 「庫存快照_最新」：每個品項最近一次的狀態（每次整張覆寫）。
 *   - 「庫存每日快照」：只在品項的數字「有變」時才加一列（含第一次的基準線）。
 *     某一天沒有該品項的列，代表當天跟前一筆一樣，往前找最近一筆即可。
 *   - 保留量的算法跟缺貨公佈欄、戰情室一致（排除已結案／過期釋出／刪除的保留單）。
 * 排程：每天 03:30 (台北)，三家分公司各自記在自己的主庫試算表。
 */

const SNAPSHOT_SHEET = '庫存每日快照';
const SNAPSHOT_LATEST_SHEET = '庫存快照_最新';
const SNAPSHOT_HEADERS = ['日期', '編號', '現貨(坪)', '保留(坪)', '可用(坪)', '在途(坪)', '保留筆數'];

function recordDailyInventorySnapshot() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('庫存快照：另一個執行中，略過'); return; }
  try {
    forEachBranch_(function (br, name) {
      try {
        const res = recordInventorySnapshotForBranch_();
        console.log('庫存快照 ' + name + '：品項 ' + res.items + '，新增 ' + res.appended + ' 列');
      } catch (e) {
        console.error('庫存快照 ' + name + ' 失敗：' + e.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function recordInventorySnapshotForBranch_() {
  const b = getBranch_();
  const dbSs = SpreadsheetApp.openById(b.dbSS);
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');

  // 片/坪（價目表），沒填用 36
  const metaMap = getPriceMetaMap_();
  const perPingOf = code => (metaMap[code] && metaMap[code].perPing) || 36;

  // 現貨、保留：標準算法（Stock_Core.js）——片數為準，高雅瓷讀 1WpBX、保留排除結案／取消／刪除／過期釋出
  const stockMapPcs = stockRuleReadStock_(null, perPingOf).map;
  const reserveStd = stockRuleReadReserve_(null);
  const stockMap = {}, reservePcs = {}, reserveCount = {};
  Object.keys(stockMapPcs).forEach(c => { stockMap[c] = stockMapPcs[c] / perPingOf(c); });
  Object.keys(reserveStd).forEach(c => { reservePcs[c] = reserveStd[c].pieces; reserveCount[c] = reserveStd[c].count; });

  // 在途（坪）：貨櫃到貨明細裡今天（含）以後到的
  const perPingMap = {};
  Object.keys(metaMap).forEach(c => { perPingMap[c] = metaMap[c].perPing; });
  const incomingMap = getIncomingContainerMap_(perPingMap);
  const todayMs = new Date(today.replace(/\//g, '-') + 'T00:00:00+08:00').getTime();
  const incomingPing = {};
  Object.keys(incomingMap).forEach(code => {
    let sum = 0;
    (incomingMap[code] || []).forEach(s => {
      if (s.date && s.date.getTime() >= todayMs) sum += (s.qtyPieces || 0) / perPingOf(code);
    });
    if (sum > 0) incomingPing[code] = sum;
  });

  // 目前狀態
  const r1 = v => Math.round(v * 10) / 10;
  const current = {};
  const codes = {};
  Object.keys(stockMap).forEach(c => { codes[c] = true; });
  Object.keys(reservePcs).forEach(c => { codes[c] = true; });
  Object.keys(incomingPing).forEach(c => { codes[c] = true; });
  Object.keys(codes).forEach(code => {
    const stock = stockMap[code] || 0;
    const reserved = (reservePcs[code] || 0) / perPingOf(code);
    const incoming = incomingPing[code] || 0;
    if (stock <= 0 && reserved <= 0 && incoming <= 0) return;
    current[code] = [r1(stock), r1(reserved), r1(stock - reserved), r1(incoming), reserveCount[code] || 0];
  });

  // 上次狀態
  const latestSh = ensureSheetHeaders_(dbSs, SNAPSHOT_LATEST_SHEET, SNAPSHOT_HEADERS);
  const prev = {};
  if (latestSh.getLastRow() >= 2) {
    latestSh.getRange(2, 1, latestSh.getLastRow() - 1, SNAPSHOT_HEADERS.length).getValues().forEach(r => {
      const c = normalizeSku_(r[1]);
      if (c) prev[c] = [r[2], r[3], r[4], r[5], r[6]].map(Number);
    });
  }

  // 有變才記：現貨、保留、在途、保留筆數任一不同（可用是算出來的）
  const changed = [];
  const same = (a, b2) => a[0] === b2[0] && a[1] === b2[1] && a[3] === b2[3] && a[4] === b2[4];
  Object.keys(current).forEach(code => {
    if (!prev[code] || !same(current[code], prev[code])) changed.push([today, code].concat(current[code]));
  });
  // 之前有、現在歸零或消失的，記一筆歸零
  Object.keys(prev).forEach(code => {
    if (!current[code] && (prev[code][0] || prev[code][1] || prev[code][3])) changed.push([today, code, 0, 0, 0, 0, 0]);
  });

  if (changed.length) {
    const histSh = ensureSheetHeaders_(dbSs, SNAPSHOT_SHEET, SNAPSHOT_HEADERS);
    histSh.getRange(histSh.getLastRow() + 1, 1, changed.length, SNAPSHOT_HEADERS.length).setValues(changed);
  }

  // 整張覆寫「最新」
  const latestRows = Object.keys(current).sort().map(code => [today, code].concat(current[code]));
  if (latestSh.getLastRow() >= 2) latestSh.getRange(2, 1, latestSh.getLastRow() - 1, SNAPSHOT_HEADERS.length).clearContent();
  if (latestRows.length) latestSh.getRange(2, 1, latestRows.length, SNAPSHOT_HEADERS.length).setValues(latestRows);

  return { items: latestRows.length, appended: changed.length };
}

/** 某個品項最近 N 天的每日快照（有變才有列），給之後分析或畫圖用 */
function getInventoryHistory_(codeRaw, days) {
  const clean = normalizeSku_(codeRaw);
  if (!clean) return { success: false, error: '缺編號' };
  const dbSs = SpreadsheetApp.openById(getBranch_().dbSS);
  const sh = dbSs.getSheetByName(SNAPSHOT_SHEET);
  if (!sh || sh.getLastRow() < 2) return { success: true, rows: [], note: '還沒有快照資料' };
  const cutoff = Date.now() - (parseInt(days, 10) || 365) * 86400000;
  const rows = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, SNAPSHOT_HEADERS.length).getValues().forEach(r => {
    if (normalizeSku_(r[1]) !== clean) return;
    const d = r[0] instanceof Date ? r[0] : new Date(String(r[0]).replace(/\//g, '-'));
    if (!isNaN(d.getTime()) && d.getTime() < cutoff) return;
    rows.push({ date: r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Taipei', 'yyyy/MM/dd') : String(r[0]), stock: r[2], reserved: r[3], avail: r[4], incoming: r[5], count: r[6] });
  });
  return { success: true, rows: rows };
}
