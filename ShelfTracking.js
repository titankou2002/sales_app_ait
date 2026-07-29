/**
 * 📐 新品上架追蹤 (Shelf Tracking)
 * 資料來源：
 *  - 版面上架清單 (SS_ID_BUSINESS)：客戶 × 系列的上架紀錄（展示方式、上架/下架日期）
 *  - 經銷銷售報表 (SS_ID_MAIN)：客戶 × 系列的出貨紀錄、系列首次進貨日、負責業務
 *  - 編號價目表 (SS_ID_MAIN)：產品編號 → 中文系列
 *  - 客戶區域對照 (SS_ID_BUSINESS，自動建立)：客戶 → 區域（臺北/新北/桃園…）
 *
 * 系列分齡（以首次進貨日計）：
 *  - fresh  全新上架：30 天內
 *  - new    新品：30 天 ~ 1 年
 *  - normal 正常品：超過 1 年
 */

const SHELF_REGION_SHEET = "業務分區";
const SHELF_CACHE_KEY = "shelf_tracking_v11"; // 停用缺貨顯示，快取升代強制失效

// ⛔ 2026-07-27：上架追蹤的缺貨判別先暫時關閉不顯示（來源「缺貨進榜追蹤」資料有誤，保留系統端查修中）。
//    確認源頭修好後，把這裡改回 true 即可整批復原。
const SHELF_SHORTAGE_ENABLED = false;

function getShelfTrackingData(forceRefresh) {
  try {
    if (!forceRefresh) {
      const cached = CacheManager.getLarge(SHELF_CACHE_KEY);
      if (cached) return cached;
    }

    const ssB = SpreadsheetApp.openById(CONFIG.SS_ID_BUSINESS);
    const ssM = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);

    // ── 1. 產品編號 → 系列 / 系列首次進貨日 / 睡美人 / 不續辦（編號價目表） ──
    const skuToSeries = {};
    const allSeriesSet = {};
    const seriesFirst = {};  // series → 最早的首次進貨日 (yyyy-MM-dd)
    const seriesStatus = {}; // series → { total, sleeper, stop }
    {
      const sh = ssM.getSheetByName(CONFIG.SHEET_NAME_PRODUCTS);
      const data = sh.getDataRange().getValues();
      const h = data[0];
      const iSku = findHeaderIndex(h, ["編號", "產品編號", "品碼"]);
      const iSeries = findHeaderIndex(h, ["中文系列", "系列"]);
      const iFirst = findHeaderIndex(h, ["首次進貨日", "首次進貨", "首進日"]);
      const iSleep = findHeaderIndex(h, ["睡美人"]);
      const iStop = findHeaderIndex(h, ["不續辦"]);
      data.slice(1).forEach(r => {
        const sku = String(r[iSku] || "").trim().replace(/[\s\-]/g, "");
        const series = String(r[iSeries] || "").trim();
        if (sku && series) {
          skuToSeries[sku] = series;
          allSeriesSet[series] = true;
          if (iFirst !== -1) {
            const d = parseDate(r[iFirst]);
            if (d) {
              const dStr = Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd");
              if (!seriesFirst[series] || dStr < seriesFirst[series]) seriesFirst[series] = dStr;
            }
          }
          if (!seriesStatus[series]) seriesStatus[series] = { total: 0, sleeper: 0, stop: 0 };
          seriesStatus[series].total++;
          if (iSleep !== -1 && String(r[iSleep] || "").trim()) seriesStatus[series].sleeper++;
          if (iStop !== -1 && String(r[iStop] || "").trim()) seriesStatus[series].stop++;
        }
      });
    }

    // ── 1b. 缺貨進榜追蹤 → 系列缺貨標記（保留系統維護的資料） ──
    // seriesShortage[series] = { worst: 最嚴重分類, codes: [{code, cat}] }
    // ⛔ 缺貨顯示暫停用（SHELF_SHORTAGE_ENABLED=false）：連讀表都跳過，省一次 API call。
    const seriesShortage = {};
    if (SHELF_SHORTAGE_ENABLED) try {
      const shS = ssM.getSheetByName('缺貨進榜追蹤');
      if (shS && shS.getLastRow() > 1) {
        const sHead = shS.getRange(1, 1, 1, shS.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
        const iC = sHead.indexOf('產品編號');
        const iCat = sHead.indexOf('缺貨分類');
        const iClosed = sHead.indexOf('是否結案');
        const iClear = sHead.indexOf('出清結案');
        if (iC !== -1) {
          const sevRank = c => /完全/.test(c) ? 0 : /嚴重/.test(c) ? 1 : /快要/.test(c) ? 2 : 3;
          shS.getRange(2, 1, shS.getLastRow() - 1, shS.getLastColumn()).getValues().forEach(r => {
            const rawCode = String(r[iC] || '').trim();
            const code = rawCode.replace(/[\s\-]/g, '');
            if (!code) return;
            if (iClosed !== -1 && String(r[iClosed] || '').trim() === '是') return;
            if (iClear !== -1 && String(r[iClear] || '').trim()) return;
            const series = skuToSeries[code];
            if (!series) return;
            const cat = iCat !== -1 ? (String(r[iCat] || '').trim() || '缺貨') : '缺貨';
            if (!seriesShortage[series]) seriesShortage[series] = { worst: cat, codes: [] };
            seriesShortage[series].codes.push({ code: rawCode, cat: cat });
            if (sevRank(cat) < sevRank(seriesShortage[series].worst)) seriesShortage[series].worst = cat;
          });
        }
      }
    } catch (e) { console.warn('缺貨榜讀取失敗：' + e); }

    // ── 2. 版面上架清單 → 每系列的上架店家 ──
    // seriesShelf[series] = { active: {cust: {mode, onDate}}, removed: {cust: {mode, onDate, offDate}} }
    const seriesShelf = {};
    const layoutCustSet = {};
    {
      const sh = ssB.getSheetByName(CONFIG.SHEET_NAME_LAYOUT);
      const data = sh.getDataRange().getValues();
      const h = data[1] || data[0];
      const idx = {
        cust: findHeaderIndex(h, ["客戶名稱", "客戶"]),
        series: findHeaderIndex(h, ["中文系列", "系列"]),
        sku: findHeaderIndex(h, ["編號", "產品編號"]),
        mode: findHeaderIndex(h, ["展示方式"]),
        img: findHeaderIndex(h, ["版面連結", "連結", "圖片", "照片"]),
        onDate: findHeaderIndex(h, ["上架日期", "日期"]),
        offDate: findHeaderIndex(h, ["下架日期"])
      };
      const fmtD = d => {
        const p = parseDate(d);
        return p ? Utilities.formatDate(p, "GMT+8", "yyyy-MM-dd") : "";
      };
      const thumbOf = raw => {
        const s = String(raw || "").trim();
        if (!s) return "";
        const id = extractIdFromUrl(s);
        return id ? "https://lh3.googleusercontent.com/d/" + id + "=w600" : s;
      };
      data.slice(2).forEach(r => {
        const cust = mergeCustomer(String(r[idx.cust] || "").trim());
        if (!cust) return;
        let series = idx.series !== -1 ? String(r[idx.series] || "").trim() : "";
        if (!series && idx.sku !== -1) {
          const sku = String(r[idx.sku] || "").trim().replace(/[\s\-]/g, "");
          series = skuToSeries[sku] || "";
        }
        if (!series) return;
        allSeriesSet[series] = true;
        layoutCustSet[cust] = true;

        if (!seriesShelf[series]) seriesShelf[series] = { active: {}, removed: {} };
        const mode = idx.mode !== -1 ? String(r[idx.mode] || "").trim() : "";
        const img = idx.img !== -1 ? thumbOf(r[idx.img]) : "";
        const onDate = fmtD(r[idx.onDate]);
        const offDate = idx.offDate !== -1 ? fmtD(r[idx.offDate]) : "";

        if (offDate) {
          // 只有當該客戶在此系列沒有其他仍在架商品時才算已下架
          if (!seriesShelf[series].active[cust]) {
            const prev = seriesShelf[series].removed[cust];
            if (!prev || offDate > prev.offDate) {
              seriesShelf[series].removed[cust] = { mode: mode, onDate: onDate, offDate: offDate };
            }
          }
        } else {
          const cur = seriesShelf[series].active[cust];
          if (!cur) {
            seriesShelf[series].active[cust] = { mode: mode, onDate: onDate, imgs: img ? [img] : [] };
          } else {
            if (img && cur.imgs.length < 4 && cur.imgs.indexOf(img) === -1) cur.imgs.push(img);
            if (!cur.mode && mode) cur.mode = mode;
          }
          delete seriesShelf[series].removed[cust];
        }
      });
    }

    // ── 3. 銷售報表 → 出貨統計 / 客戶負責業務 ──
    // custSeriesSales["cust||series"] = { c: 次數, amt: 金額, last: 最後出貨日 }
    const custSeriesSales = {};
    const custBiz = {};       // cust → { name, date }
    const salesCustSet = {};
    {
      const sh = ssM.getSheetByName(CONFIG.SHEET_NAME_SALES);
      const data = sh.getDataRange().getValues();
      const h = data[0];
      const idx = {
        date: findHeaderIndex(h, ["單據日期", "銷貨日期", "日期"]),
        sales: findHeaderIndex(h, ["負責業務", "業務", "負責人", "業務員"]),
        cust: findHeaderIndex(h, ["客戶名稱", "客戶"]),
        code: findHeaderIndex(h, ["產品編號", "編號", "品碼", "序號"]),
        amt: findHeaderIndex(h, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"])
      };
      const iNote = findHeaderIndex(h, ["備註", "說明"]);
      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const cust = mergeCustomer(String(r[idx.cust] || "").trim());
        if (!cust) continue;
        const rawCode = String(r[idx.code] || "").trim();
        const sku = rawCode.replace(/[\s\-]/g, "");
        const series = skuToSeries[sku];
        const d = parseDate(r[idx.date]);
        const dStr = d ? Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd") : "";
        salesCustSet[cust] = true;

        // 負責業務（取最後一筆出貨的業務）
        const biz = String(r[idx.sales] || "").trim();
        if (biz && dStr) {
          if (!custBiz[cust] || dStr >= custBiz[cust].date) custBiz[cust] = { name: biz, date: dStr };
        }

        if (!series) continue;

        // 🚫 排除樣品/陳列/贈送/0元列，避免誤判「有出貨」
        const amt = parseFloat(r[idx.amt]) || 0;
        const note = iNote !== -1 ? String(r[iNote] || "") : "";
        if (amt <= 0) continue;
        if (/-S\d*$/i.test(rawCode)) continue;
        if (/樣品|陳列|贈|扣帶|SAMPLE/i.test(note)) continue;

        const key = cust + "||" + series;
        if (!custSeriesSales[key]) custSeriesSales[key] = { c: 0, amt: 0, last: "" };
        custSeriesSales[key].c++;
        custSeriesSales[key].amt += amt;
        if (dStr > custSeriesSales[key].last) custSeriesSales[key].last = dStr;
      }
    }

    // ── 4. 業務分區表 → 客戶的區域與負責業務 ──
    const custRegion = {};
    const custBizFromZone = {};
    {
      const sh = ssB.getSheetByName(SHELF_REGION_SHEET);
      if (sh) {
        const data = sh.getDataRange().getValues();
        const h = data[0];
        const iCust = findHeaderIndex(h, ["客戶", "客戶名稱"]);
        const iRegion = findHeaderIndex(h, ["區域"]);
        const iBiz = findHeaderIndex(h, ["負責業務", "業務"]);
        data.slice(1).forEach(r => {
          const c = mergeCustomer(String(r[iCust] || "").trim());
          if (!c) return;
          if (iRegion !== -1) {
            const reg = String(r[iRegion] || "").trim();
            if (reg && !custRegion[c]) custRegion[c] = reg;
          }
          if (iBiz !== -1) {
            const biz = String(r[iBiz] || "").trim();
            if (biz && !custBizFromZone[c]) custBizFromZone[c] = biz;
          }
        });
      }
    }

    // ── 5. 組裝輸出 ──
    const today = Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
    const msDay = 24 * 60 * 60 * 1000;
    const todayMs = new Date(today).getTime();

    const allCustList = Object.keys(Object.assign({}, layoutCustSet, salesCustSet)).sort();
    const bizOf = c => custBizFromZone[c] || (custBiz[c] ? custBiz[c].name : "");
    const customers = allCustList.map(c => ({
      name: c,
      region: custRegion[c] || "",
      biz: bizOf(c)
    }));

    const seriesList = Object.keys(allSeriesSet).map(series => {
      const shelf = seriesShelf[series] || { active: {}, removed: {} };
      const first = seriesFirst[series] || "";
      let ageDays = -1;
      if (first) ageDays = Math.floor((todayMs - new Date(first).getTime()) / msDay);
      // 分類：首進 3 個月內＝全新上架、1 年內＝新品；
      // 其餘依編號價目表標記：睡美人 / 不續辦 / 都沒標＝正常品（系列內過半品項標記才算）
      const st = seriesStatus[series] || { total: 0, sleeper: 0, stop: 0 };
      let ageClass = "normal";
      if (ageDays >= 0 && ageDays <= 90) ageClass = "fresh";
      else if (ageDays > 90 && ageDays <= 365) ageClass = "new";
      else if (st.total > 0 && st.stop * 2 >= st.total) ageClass = "stop";
      else if (st.total > 0 && st.sleeper * 2 >= st.total) ageClass = "sleeper";

      const active = Object.keys(shelf.active).map(c => ({
        cust: c, mode: shelf.active[c].mode, onDate: shelf.active[c].onDate,
        imgs: shelf.active[c].imgs || []
      }));
      const removed = Object.keys(shelf.removed).map(c => ({
        cust: c, mode: shelf.removed[c].mode, onDate: shelf.removed[c].onDate, offDate: shelf.removed[c].offDate
      }));

      // 各業務上架數（依客戶的負責業務歸屬）
      const perBiz = {};
      active.forEach(a => {
        const b = bizOf(a.cust) || "未歸屬";
        perBiz[b] = (perBiz[b] || 0) + 1;
      });

      // 缺貨標記：系列內全部品項都在榜 → 用最嚴重分類；只有部份在榜 → 「部份缺貨」
      // ⛔ 2026-07-27 暫時停用：來源「缺貨進榜追蹤」資料有誤（保留系統端在查），
      //    先不顯示缺貨判別，避免誤導。要復原只需把 SHELF_SHORTAGE_ENABLED 改回 true。
      let shortage = '';
      let shortageCodes = [];
      if (SHELF_SHORTAGE_ENABLED) {
        const sInfo = seriesShortage[series];
        if (sInfo) {
          shortageCodes = sInfo.codes;
          const totalSkus = (seriesStatus[series] || {}).total || 0;
          shortage = (totalSkus > 0 && sInfo.codes.length < totalSkus) ? '部份缺貨' : sInfo.worst;
        }
      }

      return {
        name: series,
        firstDate: first,
        ageDays: ageDays,
        ageClass: ageClass,
        shortage: shortage,
        shortageCodes: shortageCodes,
        active: active,
        removed: removed,
        perBiz: perBiz
      };
    });

    // 排序：越新的排越前，無首進日的排最後
    seriesList.sort((a, b) => {
      const av = a.ageDays === -1 ? 999999 : a.ageDays;
      const bv = b.ageDays === -1 ? 999999 : b.ageDays;
      return av - bv;
    });

    const result = {
      success: true,
      generatedAt: Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm"),
      series: seriesList,
      customers: customers,
      sales: custSeriesSales
    };

    CacheManager.putLarge(SHELF_CACHE_KEY, result, 600);
    return result;
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 🔍 查證用：列出某客戶 × 某系列實際匹配到的出貨明細
 */
function getShelfSalesRows(custName, seriesName) {
  try {
    const ssM = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);

    // 建立該系列的 SKU 集合
    const skuSet = {};
    {
      const sh = ssM.getSheetByName(CONFIG.SHEET_NAME_PRODUCTS);
      const data = sh.getDataRange().getValues();
      const h = data[0];
      const iSku = findHeaderIndex(h, ["編號", "產品編號", "品碼"]);
      const iSeries = findHeaderIndex(h, ["中文系列", "系列"]);
      data.slice(1).forEach(r => {
        if (String(r[iSeries] || "").trim() === seriesName) {
          const sku = String(r[iSku] || "").trim().replace(/[\s\-]/g, "");
          if (sku) skuSet[sku] = true;
        }
      });
    }

    const target = mergeCustomer(custName);
    const rows = [];
    {
      const sh = ssM.getSheetByName(CONFIG.SHEET_NAME_SALES);
      const data = sh.getDataRange().getValues();
      const h = data[0];
      const idx = {
        date: findHeaderIndex(h, ["單據日期", "銷貨日期", "日期"]),
        cust: findHeaderIndex(h, ["客戶名稱", "客戶"]),
        code: findHeaderIndex(h, ["產品編號", "編號", "品碼", "序號"]),
        amt: findHeaderIndex(h, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
        note: findHeaderIndex(h, ["備註", "說明"])
      };
      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        if (mergeCustomer(String(r[idx.cust] || "").trim()) !== target) continue;
        const rawCode = String(r[idx.code] || "").trim();
        if (!skuSet[rawCode.replace(/[\s\-]/g, "")]) continue;

        // 🚫 排除樣品/陳列/贈送/扣帶/0元列
        const amt = parseFloat(r[idx.amt]) || 0;
        const note = idx.note !== -1 ? String(r[idx.note] || "") : "";
        if (amt <= 0) continue;
        if (/-S\d*$/i.test(rawCode)) continue;
        if (/樣品|陳列|贈|扣帶|SAMPLE/i.test(note)) continue;

        const d = parseDate(r[idx.date]);
        rows.push({
          date: d ? Utilities.formatDate(d, "GMT+8", "yyyy-MM-dd") : String(r[idx.date] || ""),
          code: rawCode,
          amt: amt,
          note: note
        });
      }
    }
    return { success: true, rows: rows };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}
