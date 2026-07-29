/**
 * 📦 庫存查詢模組 (與戰情室連動版)
 */

function getScriptProp_(key) {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
  } catch (e) {
    return '';
  }
}

function getScriptPropOrDefault_(key, fallback) {
  const val = getScriptProp_(key);
  return val || fallback;
}

function getAggregatedInventory() {
  try {
    const cacheKey = "inv_full_v7"; // v7: 到貨日期/數量修正為讀「保留單」分頁每列欄位(入倉日期1/2,數量1/2)，非編號價目表
    const cached = CacheManager.getLarge(cacheKey);
    if (cached) return { success: true, data: cached };

    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    let data = _buildInventoryData(ss);

    // 🚀 新增：今友利庫存整合 (採用獨立的長效快取 inv_jinyouli_v2，避免頻繁的外部 openById 延遲)
    let extData = [];
    const jylCacheKey = "inv_jinyouli_v2";
    const jylCached = CacheManager.getLarge(jylCacheKey);
    if (jylCached) {
      extData = jylCached;
    } else {
      try {
        const extId = getScriptPropOrDefault_('JINYOULI_SS_ID', '1u_7xHHhMRh15cwSgf1MjjL6jFKasSkNFoEHrPUuj7Cc');
        const extSs = SpreadsheetApp.openById(extId);
        extData = _buildJinYouLiData(extSs);
        CacheManager.putLarge(jylCacheKey, extData, 21600); // 獨立快取 6 小時 (21600秒)
      } catch(err) {
        console.warn("今友利庫存讀取失敗", err);
      }
    }
    
    if (extData && extData.length > 0) {
      data = data.concat(extData);
    }

    CacheManager.putLarge(cacheKey, data, 600); // 主快取 10 分鐘

    return { success: true, data: data };
  } catch(e) {
    return { success: false, msg: e.toString() };
  }
}

function _buildInventoryData(ss) {
  // 1. 讀庫存表：SKU -> 各批號片數
  const stockSheet = ss.getSheetByName("庫存表");
  const stockMap = {};   // key=SKU, value=[{batch, qty, pyeong}]

  if (stockSheet) {
    const sd = stockSheet.getDataRange().getValues();
    const sh = sd[0];
    const si = {
      sku:    findHeaderIndex(sh, ["編號"]),
      name:   findHeaderIndex(sh, ["品名"]),
      batch:  findHeaderIndex(sh, ["批號"]),
      qty:    findHeaderIndex(sh, ["片數"]),
      pyeong: findHeaderIndex(sh, ["坪數"])
    };
    for (let i = 1; i < sd.length; i++) {
      const sku = String(sd[i][si.sku] || '').trim();
      if (!sku) continue;
      if (si.name !== -1 && String(sd[i][si.name]).includes('小計')) continue;

      const key = sku.replace(/[\s\-]/g, '');
      if (!stockMap[key]) stockMap[key] = [];
      stockMap[key].push({
        batch:  si.batch  !== -1 ? String(sd[i][si.batch]  || '').trim() : '',
        qty:    parseFloat(sd[i][si.qty])    || 0,
        pyeong: si.pyeong !== -1 ? (parseFloat(sd[i][si.pyeong]) || 0) : 0
      });
    }
  }

  // 2. 讀保留單：計算已保留片數
  let reserveSs = ss;
  if (CONFIG.RESERVE_SS_ID) {
    try { 
      const remoteSs = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID);
      if (remoteSs) reserveSs = remoteSs; // 🚀 只有成功開啟才替換
    } catch(e) {
      console.warn("預約單試算表開啟失敗，使用主表:", e);
    }
  }
  const reserveSheet = reserveSs.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
  const reserveMap = {};  // key=SKU, value=已保留片數
  // 🚀 到貨資訊：與保留系統同源，「入倉日期1/數量1、入倉日期2/數量2」實際是保留單分頁裡每一列的欄位
  // （非編號價目表），部份列會以「SKU-掛」「SKU-期」等暫記編號單獨登記到貨，需歸戶回正式編號。
  const incomingMap = {}; // key=SKU(去除暫記後綴) → {date, qty}
  function normalizeIncomingSkuKey_(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/[-\s]*(掛|期)\s*$/, ''); // 去除保留單登記到貨用的暫記後綴
    return s.replace(/[\s\-]/g, '');
  }

  if (reserveSheet) {
    const rd = reserveSheet.getDataRange().getValues();
    const rh = rd[0];
    const ri = {
      sku: findHeaderIndex(rh, ["編號", "產品編號"]),
      qty: findHeaderIndex(rh, ["數量", "片數"]),
      inDate1: findHeaderIndex(rh, ["入倉日期1"]),
      inQty1:  findHeaderIndex(rh, ["數量1"]),
      inDate2: findHeaderIndex(rh, ["入倉日期2"]),
      inQty2:  findHeaderIndex(rh, ["數量2"])
    };
    if (ri.sku !== -1 && ri.qty !== -1) {
      for (let i = 1; i < rd.length; i++) {
        const sku = String(rd[i][ri.sku] || '').trim();
        if (!sku) continue;
        const key = sku.replace(/[\s\-]/g, '');
        if (!reserveMap[key]) reserveMap[key] = { qty: 0, count: 0 };
        reserveMap[key].qty += (parseFloat(rd[i][ri.qty]) || 0);
        reserveMap[key].count += 1;

        const rawD1 = ri.inDate1 !== -1 ? rd[i][ri.inDate1] : '';
        const rawQ1 = ri.inQty1  !== -1 ? rd[i][ri.inQty1]  : '';
        const rawD2 = ri.inDate2 !== -1 ? rd[i][ri.inDate2] : '';
        const rawQ2 = ri.inQty2  !== -1 ? rd[i][ri.inQty2]  : '';
        const hasD1 = rawD1 && String(rawD1).trim();
        const hasD2 = rawD2 && String(rawD2).trim();
        if (hasD1 || hasD2) {
          const baseKey = normalizeIncomingSkuKey_(sku);
          if (!incomingMap[baseKey]) {
            incomingMap[baseKey] = hasD1 ? { date: rawD1, qty: rawQ1 } : { date: rawD2, qty: rawQ2 };
          }
        }
      }
    }
  }

  // 3. 讀編號價目表
  const priceSheet = ss.getSheetByName("編號價目表");
  const results = [];

  if (priceSheet) {
    const pd = priceSheet.getDataRange().getValues();
    const ph = pd[0];
    const pi = {
      sku:      findHeaderIndex(ph, ["編號"]),
      hanhua:   findHeaderIndex(ph, ["漢樺編號"]),
      seriesEn: findHeaderIndex(ph, ["系列"]),
      seriesCn: findHeaderIndex(ph, ["中文系列"]),
      size:     findHeaderIndex(ph, ["尺寸"]),
      ratio:    findHeaderIndex(ph, ["片/坪"]),
      safe:     findHeaderIndex(ph, ["人工指定安全坪數", "安全庫存"]),
      img:      findHeaderIndex(ph, ["單片連結網址"]),
      folder:   findHeaderIndex(ph, ["雲端圖片"]),
      origin:   findHeaderIndex(ph, ["產地"]),
      color:    findHeaderIndex(ph, ["色階"]),
      scene1:   findHeaderIndex(ph, ["實景1", "實景圖1"]),
      scene2:   findHeaderIndex(ph, ["實景2", "實景圖2"]),
      scene3:   findHeaderIndex(ph, ["實景3", "實景圖3"]),
      scene4:   findHeaderIndex(ph, ["實景4", "實景圖4"]),
      scene5:   findHeaderIndex(ph, ["實景5", "實景圖5"]),
      scene6:   findHeaderIndex(ph, ["實景6", "實景圖6"]),
      scene7:   findHeaderIndex(ph, ["實景7", "實景圖7"]),
      pack:     findHeaderIndex(ph, ["片/箱", "每箱片數", "包裝"]),
      weight:   findHeaderIndex(ph, ["KG/箱", "每箱重量", "重量"])
    };

    const seenSkus = new Set();
    for (let i = 1; i < pd.length; i++) {
      const skuRaw = String(pd[i][pi.sku] || '').trim();
      if (!skuRaw) continue;

      const key = skuRaw.replace(/[\s\-]/g, '');
      if (seenSkus.has(key)) continue; // 🚀 關鍵：偵測到重複編號即跳過，避免重複卡片
      seenSkus.add(key);

      const ratio = parseFloat(pd[i][pi.ratio]) || 36;
      const safe  = parseFloat(pd[i][pi.safe])  || 0;

      const batches = stockMap[key] || [];
      const totalQty    = batches.reduce((s, b) => s + b.qty, 0);
      const totalPyeong = Math.round(batches.reduce((s, b) => s + b.pyeong, 0)
                          || (totalQty / ratio));
      const reservedObj = reserveMap[key] || { qty: 0, count: 0 };
      const reservedQty = reservedObj.qty;
      const reserveCount = reservedObj.count;
      const availQty    = Math.max(0, totalQty - reservedQty);
      const availPyeong = Math.round(batches.length > 0
        ? Math.max(0, totalPyeong - (reservedQty / ratio))
        : (availQty / ratio));

      // 🏮 燈號判定邏輯 (2025 新標準)
      const sizeStr = String(pd[i][pi.size] || '');
      let level = 3; 

      // 1. 解析尺寸判定類別 (30x60=1800)
      let isLarge = false;
      const dims = sizeStr.match(/(\d+)/g);
      if (dims && dims.length >= 2) {
        if (parseFloat(dims[0]) * parseFloat(dims[1]) >= 1800) isLarge = true;
      } else if (/6[0-9]|8[0-9]|120/.test(sizeStr)) {
        isLarge = true; // 包含 60, 80, 120 的通常是大尺寸
      }

      // 2. 坪數標準判定 (2025 新標：1紅, 2橘, 3黃, 4綠)
      if (availPyeong < 1) {
        level = 1; // 紅燈 (絕後)
      } else if (isLarge) {
        // 大尺寸: <10橘, 10-30黃, >30綠
        if (availPyeong < 10)      level = 2; // 橘燈 (補貨)
        else if (availPyeong < 30) level = 3; // 黃燈 (警告)
        else                       level = 4; // 綠燈 (充足)
      } else {
        // 小尺寸: <5橘, 5-10黃, >10綠
        if (availPyeong < 5)       level = 2; // 橘燈
        else if (availPyeong < 10) level = 3; // 黃燈
        else                       level = 4; // 綠燈
      }

      // 🚀 到貨資訊：實際來源是「保留單」分頁每列的入倉日期1/數量1（或2），已在上方 incomingMap 彙整
      const incoming = incomingMap[key] || null;
      const etaRaw = incoming
        ? (incoming.date instanceof Date ? Utilities.formatDate(incoming.date, "GMT+8", "yyyy/MM/dd") : String(incoming.date || '').trim())
        : '';
      const etaQty = incoming ? (parseFloat(incoming.qty) || 0) : 0;
      const hasArrival = !!etaRaw;

      const rawImg = String(pd[i][pi.img] || '').trim();
      let imgUrl = '';
      if (rawImg) {
        const id = _extractDriveId(rawImg);
        imgUrl = id ? "https://lh3.googleusercontent.com/d/" + id + "=w400" : rawImg;
      }

      const rawFolder = String(pd[i][pi.folder] || '').trim();
      let folderId = '';
      if (rawFolder) {
        const fm = rawFolder.match(/\/folders\/([a-zA-Z0-9_-]{25,})/);
        folderId = fm ? fm[1] : '';
      }

      const scenes = [];
      for (let s = 1; s <= 7; s++) {
        const sIdx = pi['scene' + s];
        if (sIdx !== -1 && sIdx !== undefined) {
          const u = String(pd[i][sIdx] || '').trim();
          if (u && !u.includes('/folders/')) {
            const sid = _extractDriveId(u);
            if (sid) scenes.push("https://lh3.googleusercontent.com/d/" + sid + "=w1200");
          }
        }
      }

      results.push({
        sku:      skuRaw,
        hSku:     pi.hanhua !== -1 ? String(pd[i][pi.hanhua] || '') : '',
        sCn:      String(pd[i][pi.seriesCn] || ''),
        sEn:      String(pd[i][pi.seriesEn] || ''),
        size:     String(pd[i][pi.size]     || ''),
        origin:   pi.origin !== -1 ? String(pd[i][pi.origin] || '') : '',
        colorTag: String(pd[i][pi.color]    || ''),
        ratio:    ratio,
        qty:      Math.floor(availQty),
        pyeong:   availPyeong,
        physical: Math.floor(totalQty),
        reserved: Math.floor(reservedQty),
        reserveCount: reserveCount,
        safe:     safe,
        level:    level,
        hasArrival: hasArrival,
        eta:      etaRaw,
        etaQty:   etaQty,
        img:      imgUrl,
        folderId: folderId,
        scenes:   scenes,
        batches:  batches,
        pack:     pi.pack !== -1 ? String(pd[i][pi.pack] || '') : '',
        weight:   pi.weight !== -1 ? String(pd[i][pi.weight] || '') : ''
      });
    }
  }

  return results;
}

/**
 * 🚀 解析今友利外部庫存
 */
function _buildJinYouLiData(ss) {
  const sheet = ss.getSheetByName("今友利庫存");
  const results = [];
  if (!sheet) return results;

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return results;

  const header = data[0];
  const idx = {
    brand:    findHeaderIndex(header, ["品牌"]),
    series:   findHeaderIndex(header, ["中文名稱系列", "中文品名系列"]),
    sku:      findHeaderIndex(header, ["編號"]),
    size:     findHeaderIndex(header, ["尺寸"]),
    account:  findHeaderIndex(header, ["帳上庫存"]),
    reserve:  findHeaderIndex(header, ["保留"]),
    stock:    findHeaderIndex(header, ["可用數量"]),
    img:      findHeaderIndex(header, ["單片網址連結"])
  };

  for (let i = 1; i < data.length; i++) {
    const skuRaw = String(data[i][idx.sku] || '').trim();
    if (!skuRaw) continue;

    const physical = parseFloat(data[i][idx.account]) || 0;
    const reserved = parseFloat(data[i][idx.reserve]) || 0;
    const availQty = parseFloat(data[i][idx.stock])   || 0;
    
    // 🚀 自動計算坪數：根據尺寸 (1坪 = 32400 cm2)
    const sizeStr = idx.size !== -1 ? String(data[i][idx.size] || '') : '';
    let ratio = 36; // 預設
    const dims = sizeStr.match(/(\d+)/g);
    if (dims && dims.length >= 2) {
      const area = parseFloat(dims[0]) * parseFloat(dims[1]);
      if (area > 0) ratio = 32400 / area;
    }
    const availPyeong = Math.round(availQty / ratio);

    const rawImg = idx.img !== -1 ? String(data[i][idx.img] || '').trim() : '';
    let imgUrl = '';
    if (rawImg) {
      const gId = _extractDriveId(rawImg);
      imgUrl = gId ? "https://lh3.googleusercontent.com/d/" + gId + "=w400" : rawImg;
    }

    // 🏮 燈號判定 (可用 < 1 絕後, 其餘根據數值判定)
    let level = availQty < 1 ? 1 : (availQty < 50 ? 2 : 4);

    results.push({
      sku:      skuRaw,
      sCn:      idx.series !== -1 ? String(data[i][idx.series] || '') : '',
      sEn:      idx.brand  !== -1 ? String(data[i][idx.brand] || '') : '今友利',
      size:     idx.size   !== -1 ? String(data[i][idx.size] || '') : '',
      qty:      Math.floor(availQty),
      pyeong:   availPyeong,
      physical: Math.floor(physical),
      reserved: Math.floor(reserved),
      level:    level,
      img:      imgUrl,
      source:  "今友利"
    });
  }
  return results;
}

/**
 * 🎞️ 從雲端資料夾抓取所有圖片 (供實景畫廊使用)
 */
/**
 * 🎞️ 從雲端資料夾抓取並分類圖片 (實景 vs 單片 vs 模面)
 */
function getFolderImages(folderId) {
  if (!folderId) return { scenes: [], singles: [], molds: [], intros: [], catalogs: [] };
  try {
    const rootFolder = DriveApp.getFolderById(folderId);
    const result = { scenes: [], singles: [], molds: [], intros: [], catalogs: [] };
    
    function processFile(file) {
      const name = file.getName();
      const nameLower = name.toLowerCase();
      const mime = file.getMimeType();
      const id = file.getId();
      
      let url = "";
      let isVideo = mime.indexOf('video/') !== -1;
      
      if (mime.indexOf('image/') !== -1) {
        url = "https://lh3.googleusercontent.com/d/" + id + "=w1200";
      } else if (isVideo) {
        // 影片使用預覽圖網址，並標註類型
        url = "https://lh3.googleusercontent.com/d/" + id + "=w400-h400-p";
      } else if (mime === 'application/pdf') {
        url = "https://drive.google.com/file/d/" + id + "/view";
      } else {
        return; 
      }

      const fileObj = { 
        url: url, 
        name: name, 
        type: mime, 
        isVideo: isVideo,
        fileId: id,
        previewUrl: isVideo ? "https://drive.google.com/file/d/" + id + "/preview" : ""
      };

      // 🚀 分類邏輯
      if (nameLower.indexOf('電子目錄') !== -1) {
        result.catalogs.push(fileObj);
      } else if (nameLower.indexOf('系列介紹') !== -1) {
        result.intros.push(fileObj);
      } else if (nameLower.indexOf('模面') !== -1) {
        result.molds.push(fileObj);
      } else if (nameLower.indexOf('實景') !== -1) {
        result.scenes.push(fileObj);
      } else {
        result.singles.push(fileObj);
      }
    }

    // 1. 處理根目錄
    const files = rootFolder.getFiles();
    while (files.hasNext()) processFile(files.next());

    // 2. 處理子資料夾
    const subFolders = rootFolder.getFolders();
    while (subFolders.hasNext()) {
      const sub = subFolders.next();
      if (sub.getName().indexOf('模面') !== -1) {
        const subFiles = sub.getFiles();
        while (subFiles.hasNext()) processFile(subFiles.next());
      }
    }

    return result;
  } catch (e) {
    console.error("抓取資料夾圖片失敗:", e.toString());
    return { scenes: [], singles: [], molds: [], intros: [], catalogs: [] };
  }
}

/**
 * 🎞️ 供前端呼叫的實景圖介面 (格式化輸出)
 */
function getFolderPhotos(folderId) {
  try {
    const raw = getFolderImages(folderId);
    const data = [];
    
    // 轉換為前端所需的扁平陣列格式
    if (raw.scenes && raw.scenes.length > 0) {
      raw.scenes.forEach(f => {
        data.push({ type: 'scene', url: f.url, thumb: f.url.replace('=w1200', '=w400') });
      });
    }
    
    if (raw.singles && raw.singles.length > 0) {
      raw.singles.forEach(f => {
        data.push({ type: 'single', url: f.url, thumb: f.url.replace('=w1200', '=w400') });
      });
    }

    if (raw.molds && raw.molds.length > 0) {
      raw.molds.forEach(f => {
        data.push({ type: 'mold', url: f.url, thumb: f.url.replace('=w1200', '=w400') });
      });
    }
    
    return { success: true, data: data };
  } catch (e) {
    console.error("getFolderPhotos Error:", e);
    return { success: false, msg: e.toString(), data: [] };
  }
}

function _extractDriveId(url) {
  if (!url) return null;
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{25,})/,
    /\/file\/d\/([a-zA-Z0-9_-]{25,})/,
    /[?&]id=([a-zA-Z0-9_-]{25,})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * 🚀 取得特定商品 (SKU) 的所有保留單明細
 */
function getSkuReservations(sku) {
  try {
    let ss = null;
    if (CONFIG.RESERVE_SS_ID) {
      try { ss = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID); } catch(e) {}
    }
    if (!ss) ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
    if (!sheet) return { success: false, msg: "找不到保留單分頁" };

    const data = sheet.getDataRange().getValues();
    const header = data[0];
    const c = (targets) => {
      for (let t of targets) { const idx = header.indexOf(t); if (idx !== -1) return idx; }
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || "").trim();
        if (!h) continue;
        for (let t of targets) if (h.includes(t)) return i;
      }
      return -1;
    };

    const idx = {
      sku: c(['編號', '產品編號']),
      qty: c(['保留數量', '數量', '片數']),
      date: c(['保留日期', '日期']),
      cust: c(['客戶', '公司']),
      biz: c(['客戶業務', '負責業務', '業務']),
      case: c(['案名', '工程名稱']),
      deposit: c(['訂金確認', '是否付訂', '付訂']),
      note: header.indexOf('備註')
    };

    const targetSku = String(sku).toUpperCase().trim();
    if (!targetSku) return { success: false, msg: "未提供 SKU" };

    // 預先載入業務分區對應表，用以在業務欄位為空/未填/未指定時自動匹配業務
    const salesMap = {};
    try {
      const ssMain = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN || CONFIG.SS_ID);
      const zoningSheet = ssMain.getSheetByName("業務分區");
      if (zoningSheet) {
        const zData = zoningSheet.getDataRange().getValues();
        const zHeaders = zData[0];
        const salesColIdx = findHeaderIndex(zHeaders, ["負責業務", "業務", "負責人"]);
        const custColIdx = findHeaderIndex(zHeaders, ["客戶名稱", "客戶"]);
        if (salesColIdx !== -1 && custColIdx !== -1) {
          for (let i = 1; i < zData.length; i++) {
            const zSales = String(zData[i][salesColIdx] || '').trim();
            const zCust = String(zData[i][custColIdx] || '').trim();
            if (zSales && zCust) {
              const zMerged = mergeCustomer(zCust);
              if (!salesMap[zMerged]) salesMap[zMerged] = zSales;
            }
          }
        } else {
          // 橫向佈局的業務分區
          const repCols = [];
          zHeaders.forEach((h, idxIdx) => {
            if (h && !h.includes("序號") && !h.includes("客戶") && !/^\d+$/.test(h)) {
              repCols.push({ name: h, col: idxIdx });
            }
          });
          for (let i = 1; i < zData.length; i++) {
            repCols.forEach(rep => {
              let nameRaw = String(zData[i][rep.col + 1] || '').trim();
              if (!nameRaw || /^\d+$/.test(nameRaw)) {
                const fallback = String(zData[i][rep.col] || '').trim();
                if (fallback && !/^\d+$/.test(fallback)) nameRaw = fallback;
              }
              if (nameRaw && nameRaw !== "客戶名稱" && nameRaw !== "序號" && nameRaw !== "客戶" && !/^\d+$/.test(nameRaw)) {
                const zMerged = mergeCustomer(nameRaw);
                if (!salesMap[zMerged]) salesMap[zMerged] = rep.name;
              }
            });
          }
        }
      }
    } catch(e) {}

    const now = new Date();

    let rawList = data.slice(1).map(r => {
      if (!r || r.every(v => !v)) return null;

      const customer = idx.cust >= 0 ? String(r[idx.cust] || "").trim() : "";
      if (customer.includes("樣品") || customer.includes("扣帶")) return null;

      const rowSku = String(r[idx.sku] || "").toUpperCase().trim();

      if (rowSku !== targetSku && !rowSku.startsWith(targetSku + '-')) return null;

      let days = 0;
      const dRaw = idx.date >= 0 ? r[idx.date] : null;
      if (dRaw instanceof Date) days = Math.floor((now - dRaw) / (1000 * 60 * 60 * 24));

      const qty = parseFloat(r[idx.qty]) || 0;

      // 智慧比對解析業務名稱
      const customerMerged = mergeCustomer(customer);
      let rawBiz = idx.biz >= 0 ? String(r[idx.biz] || "").trim() : "";
      if (!rawBiz || rawBiz === "未指定" || rawBiz === customer) {
        rawBiz = salesMap[customerMerged] || "未指定";
      }

      return {
        code: rowSku,
        qty: qty,
        days: days,
        biz: rawBiz,
        caseName: idx.case >= 0 ? String(r[idx.case] || "").trim() : "",
        customer: customer,
        date: dRaw instanceof Date ? Utilities.formatDate(dRaw, "GMT+8", "yyyy/MM/dd") : "未知",
        deposit: (idx.deposit >= 0 && String(r[idx.deposit]).trim() !== "") ? "已付訂" : "未付訂",
        note: idx.note >= 0 ? String(r[idx.note] || "") : ""
      };
    }).filter(it => it !== null);

    rawList.sort((a, b) => b.days - a.days);

    return { success: true, items: rawList };
  } catch (err) {
    return { success: false, msg: "後端查詢錯誤: " + err.toString() };
  }
}

/**
 * 🚀 取得指定業務人員或全公司的保留單清單
 */
function getUserReservations(company) {
  try {
    const ssMain = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);

    // 1. 建立產品資料索引 (抓封面圖、片坪比等)
    const priceSheet = ssMain.getSheetByName("編號價目表");
    const priceMap = {};
    if (priceSheet) {
      const pData = priceSheet.getDataRange().getValues();
      const pHead = pData[0];
      const pi = {
        sku: findHeaderIndex(pHead, ["編號"]),
        img: findHeaderIndex(pHead, ["單片連結網址", "封面", "縮圖"]),
        ratio: findHeaderIndex(pHead, ["片/坪"]),
        series: findHeaderIndex(pHead, ["中文系列"])
      };
      pData.slice(1).forEach(r => {
        const s = String(r[pi.sku] || "").trim().toUpperCase();
        if (s) {
          let rawImg = String(r[pi.img] || "").trim();
          if (rawImg) {
            const id = _extractDriveId(rawImg);
            rawImg = id ? "https://lh3.googleusercontent.com/d/" + id + "=w400" : rawImg;
          }
          priceMap[s] = { img: rawImg, ratio: parseFloat(r[pi.ratio]) || 36, series: String(r[pi.series] || "") };
        }
      });
    }

    // 2. 抓取保留單
    let ssReserve = null;
    if (CONFIG.RESERVE_SS_ID) {
      try { ssReserve = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID); } catch(e) {}
    }
    if (!ssReserve) ssReserve = SpreadsheetApp.openById(CONFIG.SS_ID);
    const sheet = ssReserve.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
    if (!sheet) return { success: false, msg: "找不到保留單分頁" };
    const data = sheet.getDataRange().getValues();
    const header = data[0];
    const c = (targets) => {
      for (let t of targets) { const idx = header.indexOf(t); if (idx !== -1) return idx; }
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || "").trim();
        if (!h) continue;
        for (let t of targets) if (h.includes(t)) return i;
      }
      return -1;
    };

    const idx = {
      sku: c(['編號', '產品編號']),
      qty: c(['保留數量', '數量', '片數']),
      date: c(['保留日期', '日期']),
      dueDate: c(['到期日']),
      cust: c(['客戶', '公司']),
      biz: c(['客戶業務', '負責業務', '業務']),
      case: c(['案名', '工程名稱']),
      addr: c(['工地', '地址']),
      deposit: c(['訂金確認', '是否付訂', '付訂']),
      note: header.indexOf('備註'),
      size: c(['尺寸'])
    };

    const now = new Date();
    const targetComp = company ? String(company).toLowerCase().trim() : "";

    let rawList = data.slice(1).map(r => {
      if (!r || r.every(v => !v)) return null;
      
      const rowCust = String(r[idx.cust] || "").toLowerCase();
      if (targetComp && !rowCust.includes(targetComp)) return null;

      let sku = String(r[idx.sku] || "").toUpperCase().trim();
      let pInfo = priceMap[sku];
      if (!pInfo && sku.includes('-')) {
        const baseSku = sku.split('-')[0].trim();
        pInfo = priceMap[baseSku];
      }
      if (!pInfo) pInfo = { img: "", ratio: 36, series: "" };

      let days = 0;
      const dRaw = idx.date >= 0 ? r[idx.date] : null;
      if (dRaw instanceof Date) days = Math.floor((now - dRaw) / (1000 * 60 * 60 * 24));

      const dueDate = idx.dueDate >= 0 ? r[idx.dueDate] : null;
      const noteRaw = idx.note >= 0 ? r[idx.note] : "";
      const qty = parseFloat(r[idx.qty]) || 0;
      const pyeong = pInfo.ratio > 0 ? (qty / pInfo.ratio).toFixed(1) : "0.0";

      return {
        code: sku,
        qty: qty,
        pyeong: pyeong,
        img: pInfo.img,
        series: pInfo.series,
        days: days,
        biz: idx.biz >= 0 ? String(r[idx.biz] || "未指定").trim() : "未指定",
        caseName: idx.case >= 0 ? String(r[idx.case] || "").trim() : "",
        customer: rowCust,
        date: dRaw instanceof Date ? Utilities.formatDate(dRaw, "GMT+8", "MM/dd") : "未知",
        dueDate: dueDate instanceof Date ? Utilities.formatDate(dueDate, "GMT+8", "MM/dd") : "未知",
        dueObj: dueDate instanceof Date ? dueDate : null,
        deposit: (idx.deposit >= 0 && String(r[idx.deposit]).trim() !== "") ? "已付訂" : "未付訂",
        note: noteRaw instanceof Date ? Utilities.formatDate(noteRaw, "GMT+8", "MM/dd") : String(noteRaw),
        size: idx.size >= 0 ? String(r[idx.size] || "").trim() : "",
        address: idx.addr >= 0 ? String(r[idx.addr] || "").trim() : ""
      };
    }).filter(it => it !== null);

    const groups = {};
    rawList.forEach(item => {
      const key = item.caseName || item.address || "其他項目";
      if (!groups[key]) groups[key] = { name: key, items: [], maxDays: 0, biz: item.biz, address: item.address, cust: item.customer };
      groups[key].items.push(item);
      if (item.days > groups[key].maxDays) groups[key].maxDays = item.days;
    });

    const sortedGroups = Object.values(groups).sort((a, b) => b.maxDays - a.maxDays);

    return { success: true, groups: sortedGroups };
  } catch (err) {
    return { success: false, msg: "後端查詢錯誤: " + err.toString() };
  }
}

/**
 * 🔄 一鍵同步保留單庫存計算資料
 */
function syncReservationStock() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stockSheet = ss.getSheetByName("高雅瓷庫存表") || ss.getSheetByName("庫存表");
  const reserveSheet = ss.getSheetByName(CONFIG.SHEET_NAME_RESERVE || "保留單");
  
  if (!stockSheet || !reserveSheet) {
    SpreadsheetApp.getUi().alert("❌ 找不到 '高雅瓷庫存表'、'庫存表' 或 '" + (CONFIG.SHEET_NAME_RESERVE || "保留單") + "' 工作表！");
    return;
  }
  
  const stockData = stockSheet.getDataRange().getValues();
  const stockHeader = stockData[0];
  const idxStockSku = stockHeader.indexOf("編號");
  const idxStockQty = stockHeader.indexOf("片數");
  
  if (idxStockSku === -1 || idxStockQty === -1) {
    SpreadsheetApp.getUi().alert("❌ 庫存表格式錯誤：找不到「編號」或「片數」欄位！");
    return;
  }
  
  const stockMap = {};
  for (let i = 1; i < stockData.length; i++) {
    const sku = String(stockData[i][idxStockSku] || '').trim().toUpperCase();
    const qty = parseFloat(stockData[i][idxStockQty]) || 0;
    if (!sku || sku.includes("小計")) continue;
    
    if (!stockMap[sku]) stockMap[sku] = [];
    stockMap[sku].push(qty);
  }
  
  for (let sku in stockMap) {
    stockMap[sku].sort((a, b) => b - a);
  }
  
  const reserveData = reserveSheet.getDataRange().getValues();
  const reserveHeader = reserveData[0];
  const idxResSku = reserveHeader.indexOf("編號");
  const idxResQty = reserveHeader.indexOf("數量");
  const idxResSmall = reserveHeader.indexOf("小庫存");
  const idxRes1 = reserveHeader.indexOf("庫存1");
  const idxRes2 = reserveHeader.indexOf("庫存2");
  const idxResTotal = reserveHeader.indexOf("保留數量");
  const idxResNet = reserveHeader.indexOf("扣保留");
  
  if (idxResSku === -1 || idxResQty === -1 || idxResSmall === -1 || 
      idxRes1 === -1 || idxRes2 === -1 || idxResTotal === -1 || idxResNet === -1) {
    SpreadsheetApp.getUi().alert("❌ 保留單欄位不完整！");
    return;
  }
  
  const reserveQtyMap = {};
  for (let i = 1; i < reserveData.length; i++) {
    const sku = String(reserveData[i][idxResSku] || '').trim().toUpperCase();
    const qty = parseFloat(reserveData[i][idxResQty]) || 0;
    if (!sku) continue;
    reserveQtyMap[sku] = (reserveQtyMap[sku] || 0) + qty;
  }
  
  const startRow = 2;
  const rangeToUpdate = reserveSheet.getRange(startRow, 1, reserveData.length - 1, reserveHeader.length);
  const cellValues = rangeToUpdate.getValues();
  
  for (let i = 0; i < cellValues.length; i++) {
    const sku = String(cellValues[i][idxResSku] || '').trim().toUpperCase();
    if (!sku) continue;
    
    const qtys = stockMap[sku] || [];
    const q1 = qtys[0] || 0;
    const q2 = qtys[1] || 0;
    const qSmall = qtys[2] || 0;
    
    const totalReserved = reserveQtyMap[sku] || 0;
    const netQty = q1 + q2 - totalReserved;
    
    cellValues[i][idxResSmall] = qSmall;
    cellValues[i][idxRes1] = q1;
    cellValues[i][idxRes2] = q2;
    cellValues[i][idxResTotal] = totalReserved;
    cellValues[i][idxResNet] = netQty;
  }
  
  rangeToUpdate.setValues(cellValues);
  SpreadsheetApp.getUi().alert("🎉 一鍵同步完成！");
}

