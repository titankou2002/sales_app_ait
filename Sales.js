/**
 * 📊 業績概況核心邏輯 (Sales Module)
 */

const SALES_CONFIG = {
  SHEET_SALES: "經銷銷售報表",
  SHEET_ZONING: "業務分區",
  FIXED_TARGET_PER_PERSON: 2000, // 每人 2000 萬
  SALES_PEOPLE: [
    { name: '謝博皓', alias: '小謝', color: '#378ADD' },
    { name: '潘右森', alias: '小潘', color: '#34C759' },
    { name: '陳勁多', alias: '多多', color: '#F59E0B' },
    { name: '高弘治', alias: '小高', color: '#8B5CF6' }
  ]
};

/**
 * 💰 預設獎金規則配置 (當 PropertiesService 尚未儲存設定時的預設值)
 */
const DEFAULT_BONUS_CONFIG = {
  version: 2,
  STAFF_SHARE_RATE: 0.10, // 10% 分給內勤同事
  PEER_PRICE_DISCOUNT_THRESHOLD: 0.60, // 低於同行價六折 (60%)
  PEER_PRICE_ADJUSTMENT_FACTOR: 0.50,  // 該筆業績以5折計算 (50%)
  
  RULES: {
    '陳勁多': {
      enabled: true,
      minThreshold: 500000, // 最低額度 50 萬
      stepBase: 500000,     // 超過 50 萬起算每 10 萬
      stepValue: 100000,    // 每 10 萬
      stepBonus: 1000,      // 達成獎金 1000
      breakthroughs: [
        { limit: 1900000, bonus: 5000 },
        { limit: 2400000, bonus: 10000 }
      ]
    },
    '謝博皓': {
      enabled: true,
      minThreshold: 800000, // 最低額度 80 萬
      stepBase: 700000,     // 超過 70 萬起算每 10 萬
      stepValue: 100000,    // 每 10 萬
      stepBonus: 1000,      // 達成獎金 1000
      breakthroughs: [
        { limit: 2100000, bonus: 5000 },
        { limit: 2600000, bonus: 10000 }
      ]
    },
    '潘右森': {
      enabled: true,
      minThreshold: 800000,
      stepBase: 700000,
      stepValue: 100000,
      stepBonus: 1000,
      breakthroughs: [
        { limit: 2100000, bonus: 5000 },
        { limit: 2600000, bonus: 10000 }
      ]
    },
    '高弘治': {
      enabled: false, // 暫不列入計算
      minThreshold: 800000,
      stepBase: 700000,
      stepValue: 100000,
      stepBonus: 1000,
      breakthroughs: [
        { limit: 2100000, bonus: 5000 },
        { limit: 2600000, bonus: 10000 }
      ]
    },
    '洪華連': {
      enabled: false, // 暫不列入計算
      minThreshold: 800000,
      stepBase: 700000,
      stepValue: 100000,
      stepBonus: 1000,
      breakthroughs: [
        { limit: 2100000, bonus: 5000 },
        { limit: 2600000, bonus: 10000 }
      ]
    }
  }
};

// 🚀 getCustomerShortName 統一定義在 Code.js（與 mergeCustomer 同源、含完整合併清單），
//    這裡原本的重複定義是過時版本（漏掉大永/新大永、琮達/琮威等 10 組合併規則），已刪除避免蓋掉正確版本。
//    詳見 MD讀取/客戶合併原則.md。

function getSharedSalesWeight(name) {
  const s = String(name || '').trim();
  return (s.includes('漢樺') || s.includes('波爾泰')) ? 1 / 3 : 1;
}

/**
 * 💡 取得當前獎金配置 (優先從 Script Properties 讀取)
 */
function getActiveBonusConfig() {
  try {
    const prop = PropertiesService.getScriptProperties().getProperty("BONUS_CONFIG");
    let parsed = null;
    if (prop) {
      parsed = JSON.parse(prop);
    }
    
    // 自動移轉至 v2 (210/260萬 與 190/240萬 突破門檻)
    if (!parsed || !parsed.version || parsed.version < 2) {
      const config = parsed || DEFAULT_BONUS_CONFIG;
      config.version = 2;
      if (config.RULES) {
        Object.keys(config.RULES).forEach(name => {
          if (name === '陳勁多') {
            config.RULES[name].breakthroughs = [
              { limit: 1900000, bonus: 5000 },
              { limit: 2400000, bonus: 10000 }
            ];
          } else {
            config.RULES[name].breakthroughs = [
              { limit: 2100000, bonus: 5000 },
              { limit: 2600000, bonus: 10000 }
            ];
          }
        });
      }
      PropertiesService.getScriptProperties().setProperty("BONUS_CONFIG", JSON.stringify(config));
      return config;
    }
    
    return parsed;
  } catch(e) {
    console.error("讀取獎金配置 Properties 失敗，將使用預設設定:", e);
  }
  return DEFAULT_BONUS_CONFIG;
}

/**
 * 💡 儲存獎金配置至 Script Properties (供管理後台小姐使用)
 */
function saveActiveBonusConfig(config) {
  try {
    PropertiesService.getScriptProperties().setProperty("BONUS_CONFIG", JSON.stringify(config));
    // 清除概況的快取，讓調整後即時重新計算
    CacheManager.removeLarge("sales_overview_v3.3_monthly");
    return { success: true, msg: "獎金參數設定儲存成功並已即時生效！" };
  } catch(e) {
    return { success: false, msg: "儲存設定失敗: " + e.toString() };
  }
}

/**
 * 📊 產生後台業績獎金精算與低於六折折半明細報表 (供小姐查看)
 */
function getAdminBonusReport(year, monthIdx) {
  const cacheKey = "admin_bonus_report_v4_" + year + "_" + monthIdx;
  const cached = CacheManager.getLarge(cacheKey);
  if (cached) return cached;

  const result = _computeAdminBonusReport(year, monthIdx);
  if (result.success) {
    CacheManager.putLarge(cacheKey, result, 3600); // 快取 1 小時
  }
  return result;
}

/**
 * 🔄 強制清除指定月份的後台精算快取（編輯/儲存時呼叫）
 */
function clearAdminBonusReportCache(year, monthIdx) {
  CacheManager.removeLarge("admin_bonus_report_v4_" + year + "_" + monthIdx);
}

function _computeAdminBonusReport(year, monthIdx) {
  try {
    const activeConfig = getActiveBonusConfig();
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const salesSheet = ss.getSheetByName(SALES_CONFIG.SHEET_SALES);
    const salesData = salesSheet.getDataRange().getValues();
    const sh = salesData[0];
    const sIdx = {
      date: findHeaderIndex(sh, ["單據日期", "銷貨日期", "日期"]),
      sales: findHeaderIndex(sh, ["負責業務", "業務", "負責人", "業務員"]),
      amt: findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
      cust: findHeaderIndex(sh, ["客戶名稱", "客戶"]),
      custCode: findHeaderIndex(sh, ["客戶編號", "客戶代碼"]),
      note: findHeaderIndex(sh, ["備註", "說明"]),
      code: findHeaderIndex(sh, ["產品編號", "編號", "品碼", "序號"]),
      qty: findHeaderIndex(sh, ["數量", "片數"]),
      price: findHeaderIndex(sh, ["單價", "成交單價"])
    };

    const peerPriceMap = getPeerPriceMap(ss);
    const deliveryRes = getDeliveryBonusData(year);
    const deliveryMap = deliveryRes.success ? deliveryRes.data : {};
    const targetYear = parseInt(year) > 1900 ? parseInt(year) - 1911 : parseInt(year);
    const targetMonth = parseInt(monthIdx); // 0-indexed
    const monthStr = String(targetMonth + 1).padStart(2, '0');
    const mKey = year + "/" + monthStr; // e.g. "2026/05"

    // 取得所有在規則中啟用的業務同仁
    // 取得所有在規則中啟用的業務同仁
    const salespeopleNames = Object.keys(activeConfig.RULES).filter(name => activeConfig.RULES[name].enabled !== false);

    // 載入睡美人與系列設定
    const sleeperMap = getSleeperConfigMap(ss);
    const seriesMap = getSeriesMap(ss);

    const report = {
      year: targetYear,
      month: targetMonth + 1,
      globalConfig: {
        STAFF_SHARE_RATE: activeConfig.STAFF_SHARE_RATE,
        PEER_PRICE_DISCOUNT_THRESHOLD: activeConfig.PEER_PRICE_DISCOUNT_THRESHOLD,
        PEER_PRICE_ADJUSTMENT_FACTOR: activeConfig.PEER_PRICE_ADJUSTMENT_FACTOR
      },
      salespeople: []
    };

    salespeopleNames.forEach(name => {
      const rule = activeConfig.RULES[name];
      const discountedTransactions = [];
      const jinyouliTransactions = [];
      const sleeperTransactions = [];
      const freightTransactions = [];
      const allTransactions = [];
      
      let totalSalesAmount = 0;
      let generalSalesAmount = 0;
      let sleeperSalesAmount = 0;
      let jinyouliSalesAmount = 0;
      let discountReductionAmount = 0;
      let freightDeductionAmount = 0;

      let jylCount = 0;
      let jylAddedAmt = 0;
      let sleeperCount = 0;
      let sleeperAddedAmt = 0;

      salesData.slice(1).forEach((r, i) => {
        const d = parseDate(r[sIdx.date]);
        if (!d) return;
        
        const yr = d.getFullYear();
        const targetGregorianYear = parseInt(year);
        if (yr !== targetGregorianYear && yr !== (targetGregorianYear - 1911)) return;
        if (d.getMonth() !== targetMonth) return;
        
        const custName = String(r[sIdx.cust] || "").trim();
        const isSharedCust3 = (custName.includes('漢樺') || custName.includes('波爾泰'));
        const sharedMembers3 = ['謝博皓', '潘右森', '陳勁多'];
        const shouldCount3 = isSharedCust3 ? sharedMembers3.includes(name) : String(r[sIdx.sales] || "").includes(name);
        if (!shouldCount3) return;

        const note = String(r[sIdx.note] || "");

        if (custName.includes('樣品') || note.includes('樣品') || note.includes('扣帶') || note.includes('代領') || custName.includes('代領')) return;

        const rawAmt = parseFloat(r[sIdx.amt]) || 0;
        const code = sIdx.code !== -1 ? String(r[sIdx.code] || "").toUpperCase().replace(/[\s\-]/g, '') : "";
        const qtyVal = sIdx.qty !== -1 ? parseFloat(r[sIdx.qty]) || 0 : 0;
        const priceVal = sIdx.price !== -1 ? parseFloat(r[sIdx.price]) || 0 : 0;
        const isFreight = code.includes("運費");

        // 運費列：獨立列示，但完全不納入總業績與獎金計算
        if (isFreight) {
          const weight = getSharedSalesWeight(custName);
          const freightAmt = Math.abs(rawAmt) * weight;
          freightDeductionAmount += freightAmt;
          freightTransactions.push({
            rowIdx: i + 2,
            customerCode: sIdx.custCode !== -1 ? String(r[sIdx.custCode] || "").trim() : "",
            customer: custName,
            projectName: note,
            productCode: code,
            qty: qtyVal,
            unitPrice: priceVal > 0 ? Math.abs(priceVal) : 0,
            originalAmt: rawAmt,
            deductedAmt: freightAmt,
            weight: weight
          });
          allTransactions.push({
            rowIdx: i + 2,
            type: 'freight',
            code: code,
            qty: qtyVal,
            unitPrice: priceVal > 0 ? Math.abs(priceVal) : 0,
            cost: 0,
            peerPrice: 0,
            isDiscounted: false,
            weight: weight,
            multiplier: 1,
            weightedAmt: -freightAmt,
            originalAmt: rawAmt,
            grade: ''
          });
          return;
        }

        // 判斷商品類型與對應的倍數
        const jylSet = getJinyouliCodesSetCached();
        const isJinyouli = jylSet && jylSet.has(code);
        const sleeperInfo = sleeperMap[code];
        
        let type = 'general';
        let multiplier = 1;
        let sleeperCost = 0;
        let sleeperMargin = 0;
        let priceCostRatio = 1;
        let sleeperGrade = '';
        
        if (isJinyouli) {
          type = 'jinyouli';
          multiplier = 2;
        } else if (sleeperInfo) {
          type = 'sleeper';
          sleeperGrade = sleeperInfo.grade || '';
          sleeperCost = sleeperInfo.cost || 0;
          const qty = Math.abs(qtyVal);
          const absAmt = Math.abs(rawAmt);
          const uPrice = qty > 0 ? absAmt / qty : 0;
          const totalCost = sleeperCost * qty;
          // 退貨(負數)也用絕對值計算毛利率，確保倍數與出貨時一致
          sleeperMargin = absAmt > 0 ? (absAmt - totalCost) / absAmt : 0;
          priceCostRatio = sleeperCost > 0 ? uPrice / sleeperCost : 1;
          multiplier = calcSleeperMultiplier(sleeperGrade, sleeperMargin, priceCostRatio, false);
        }

        // baseAmt 是套用倍數後的原始金額 (折前)
        let baseAmt = rawAmt * multiplier;

        // 計算成交單價與是否低於六折
        const peerPrice = peerPriceMap[code] || 0;
        let isDiscounted = false;
        let unitPrice = 0;
        if (peerPrice > 0) {
          if (priceVal > 0) {
            unitPrice = Math.abs(priceVal);
          } else if (qtyVal !== 0) {
            unitPrice = Math.abs(rawAmt) / Math.abs(qtyVal);
          }
          if (unitPrice > 0 && unitPrice < peerPrice * activeConfig.PEER_PRICE_DISCOUNT_THRESHOLD) {
            isDiscounted = true;
          }
        } else {
          // If no peer price, compute unit price anyway for display/edit
          if (priceVal > 0) {
            unitPrice = Math.abs(priceVal);
          } else if (qtyVal !== 0) {
            unitPrice = Math.abs(rawAmt) / Math.abs(qtyVal);
          }
        }

        // 折減後金額
        let amtAfterDiscount = isDiscounted ? baseAmt * activeConfig.PEER_PRICE_ADJUSTMENT_FACTOR : baseAmt;

        // 合夥拆分 (漢樺、波爾泰 拆為 1/3 業績)
        const weight = getSharedSalesWeight(custName);
        const weightedAmt = amtAfterDiscount * weight;

        totalSalesAmount += weightedAmt;

        // 紀錄所有明細
        allTransactions.push({
          rowIdx: i + 2,
          type: type,
          customerCode: sIdx.custCode !== -1 ? String(r[sIdx.custCode] || "").trim() : "",
          customer: custName,
          projectName: note,
          code: code,
          qty: qtyVal,
          unitPrice: unitPrice,
          cost: type === 'sleeper' ? sleeperCost : 0,
          peerPrice: peerPrice,
          isDiscounted: isDiscounted,
          weight: weight,
          multiplier: multiplier,
          weightedAmt: weightedAmt,
          originalAmt: rawAmt,
          grade: type === 'sleeper' ? sleeperGrade : ''
        });

        // 累加分類業績 (折前、加成後)
        if (type === 'general') {
          generalSalesAmount += rawAmt * weight;
        } else if (type === 'sleeper') {
          sleeperSalesAmount += baseAmt * weight;
          sleeperCount++;
          sleeperAddedAmt += (baseAmt - rawAmt) * weight;
          sleeperTransactions.push({
            rowIdx: i + 2,
            customerCode: sIdx.custCode !== -1 ? String(r[sIdx.custCode] || "").trim() : "",
            customer: custName,
            projectName: note,
            productCode: code,
            qty: qtyVal,
            unitPrice: unitPrice,
            peerPrice: peerPrice,
            grade: sleeperGrade,
            cost: sleeperCost,
            margin: sleeperMargin,
            priceCostRatio: priceCostRatio,
            multiplier: multiplier,
            originalAmt: rawAmt,
            isDiscounted: isDiscounted,
            weight: weight,
            weightedAmt: weightedAmt
          });
        } else if (type === 'jinyouli') {
          jinyouliSalesAmount += baseAmt * weight;
          jylCount++;
          jylAddedAmt += (baseAmt - rawAmt) * weight; // 額外加成業績
          jinyouliTransactions.push({
            rowIdx: i + 2,
            customerCode: sIdx.custCode !== -1 ? String(r[sIdx.custCode] || "").trim() : "",
            customer: custName,
            projectName: note,
            productCode: code,
            qty: qtyVal,
            unitPrice: unitPrice,
            peerPrice: peerPrice,
            originalAmt: rawAmt,
            isDiscounted: isDiscounted,
            weight: weight,
            weightedAmt: weightedAmt
          });
        }

        if (isDiscounted) {
          discountReductionAmount += (baseAmt - amtAfterDiscount) * weight;
          
          const discountPercent = Math.round((unitPrice / peerPrice) * 100);
          const suffix = isJinyouli ? " (今友利x2)" : (type === 'sleeper' ? ` (睡美人x${multiplier})` : "");
          discountedTransactions.push({
            rowIdx: i + 2,
            customerCode: sIdx.custCode !== -1 ? String(r[sIdx.custCode] || "").trim() : "",
            customer: custName,
            projectName: note,
            productCode: code + suffix,
            originalSku: code,
            qty: qtyVal,
            unitPrice: unitPrice,
            peerPrice: peerPrice,
            discountRate: (discountPercent / 10) + "折",
            originalAmt: rawAmt,
            weight: weight,
            weightedAmt: weightedAmt
          });
        }
      });

      // 計算該業務的獎金詳情
      const bonusResult = calculateSalesBonus(name, totalSalesAmount);

      // 產生舊的步驟公式說明文字 (保留相容性，供其他程式參考，但前端 UI 主要使用新欄位)
      let formulaText = "";
      if (jylCount > 0) {
        formulaText += `• 今友利雙倍加成：當月售出 ${jylCount} 筆今友利商品，加計雙倍業績額外增加 $${Math.round(jylAddedAmt).toLocaleString()} 元 (已併入總業績)。\n`;
      }
      if (sleeperCount > 0) {
        formulaText += `• 睡美人業績加成：當月售出 ${sleeperCount} 筆睡美人商品，加計等級倍數額外增加 $${Math.round(sleeperAddedAmt).toLocaleString()} 元 (已併入總業績)。\n`;
      }
      if (freightDeductionAmount > 0) {
        formulaText += `• 運費扣除：當月共有 ${freightTransactions.length} 筆運費項目，扣除 $${Math.round(freightDeductionAmount).toLocaleString()} 元，已排除於總業績與獎金計算之外。\n`;
      }

      if (totalSalesAmount < rule.minThreshold) {
        formulaText += `• 當月實銷金額：$${Math.round(totalSalesAmount).toLocaleString()} 元，未達最低起算門檻 $${rule.minThreshold.toLocaleString()} 元，達成獎金為 $0 元。\n`;
      } else {
        const exceed = totalSalesAmount - rule.stepBase;
        const steps = exceed > 0 ? Math.floor(exceed / rule.stepValue) : 0;
        formulaText += `• 當月實銷金額：$${Math.round(totalSalesAmount).toLocaleString()} 元 (已達最低門檻 $${rule.minThreshold.toLocaleString()} 元)。\n`;
        formulaText += `• 超過起算基底部分：$${Math.round(totalSalesAmount).toLocaleString()} - $${rule.stepBase.toLocaleString()} = $${Math.round(exceed).toLocaleString()} 元。\n`;
        formulaText += `• 加發級數：$${Math.round(exceed).toLocaleString()} / $${rule.stepValue.toLocaleString()} = ${steps} 級 (無條件捨去)。\n`;
        formulaText += `• 達成獎金：${steps} 級 * $${rule.stepBonus.toLocaleString()} = $${bonusResult.baseBonus.toLocaleString()} 元。\n`;
      }

      let reachedLimit = 0;
      if (bonusResult.breakthroughBonus > 0) {
        rule.breakthroughs.forEach(b => {
          if (totalSalesAmount >= b.limit && b.limit > reachedLimit) {
            reachedLimit = b.limit;
          }
        });
        formulaText += `• 突破獎金：業績達突破門檻 $${(reachedLimit/10000)}萬 元，加發突破獎金 $${bonusResult.breakthroughBonus.toLocaleString()} 元。\n`;
      } else {
        formulaText += `• 突破獎金：業績未達任何額外突破門檻，突破獎金為 $0 元。\n`;
      }

      formulaText += `• 獎金小計：達成獎金 $${bonusResult.baseBonus.toLocaleString()} + 突破獎金 $${bonusResult.breakthroughBonus.toLocaleString()} = 總獎金 $${bonusResult.totalBonus.toLocaleString()} 元。\n`;
      formulaText += `• 內勤同仁分拆提撥 (${Math.round(activeConfig.STAFF_SHARE_RATE*100)}%)：$${bonusResult.staffShare.toLocaleString()} 元。\n`;
      formulaText += `• 業務實領 (90%)：$${bonusResult.netPayout.toLocaleString()} 元。`;

      const pDelivery = deliveryMap[name] || {};
      const monthDelivery = pDelivery.months ? (pDelivery.months[mKey] || { totalBonus: 0, totalPoints: 0, days: [] }) : { totalBonus: 0, totalPoints: 0, days: [] };

      const exceed = totalSalesAmount - rule.stepBase;
      const steps = exceed > 0 ? Math.floor(exceed / rule.stepValue) : 0;

      report.salespeople.push({
        name: name,
        monthlySales: Math.round(totalSalesAmount),
        generalSalesAmount: Math.round(generalSalesAmount),
        sleeperSalesAmount: Math.round(sleeperSalesAmount),
        jinyouliSalesAmount: Math.round(jinyouliSalesAmount),
        discountReductionAmount: Math.round(discountReductionAmount),
        freightDeductionAmount: Math.round(freightDeductionAmount),
        exceed: Math.max(0, exceed),
        steps: steps,
        reachedBreakthroughLimit: reachedLimit,
        baseBonus: bonusResult.baseBonus,
        breakthroughBonus: bonusResult.breakthroughBonus,
        totalBonus: bonusResult.totalBonus,
        staffShare: bonusResult.staffShare,
        netPayout: bonusResult.netPayout,
        formula: formulaText,
        rule: rule,
        discountedTransactions: discountedTransactions,
        jinyouliTransactions: jinyouliTransactions,
        sleeperTransactions: sleeperTransactions,
        freightTransactions: freightTransactions,
        allTransactions: allTransactions,
        deliveryBonus: monthDelivery.totalBonus,
        deliveryPoints: monthDelivery.totalPoints,
        deliveryDays: monthDelivery.days.length,
        deliveryDetail: monthDelivery.days
      });
    });

    return { success: true, data: report };
  } catch(e) {
    return { success: false, msg: "產生獎金明細報表失敗: " + e.toString() };
  }
}

/**
 * 🔍 取得商品同行價對照 Map (sku -> 同行價)
 */
function getPeerPriceMap(ss) {
  const priceSheet = ss.getSheetByName("編號價目表");
  const map = {};
  if (priceSheet) {
    const ph = priceSheet.getRange(1, 1, 1, priceSheet.getLastColumn()).getValues()[0];
    const skuIdx = findHeaderIndex(ph, ["編號", "產品編號"]);
    const peerIdx = findHeaderIndex(ph, ["同行價", "同行"]);
    if (skuIdx !== -1 && peerIdx !== -1) {
      const pRows = priceSheet.getDataRange().getValues();
      pRows.slice(1).forEach(r => {
        const sku = String(r[skuIdx] || "").toUpperCase().replace(/[\s\-]/g, '');
        const price = parseFloat(r[peerIdx]) || 0;
        if (sku && price > 0) {
          map[sku] = price;
        }
      });
    }
  }
  return map;
}

/**
 * 🚀 同行價 + 系列名稱：合併單次讀取「編號價目表」（避免重複全表掃描）
 * 同一次 Apps Script 執行內只掃描一次（模組層快取）
 */
let _peerPriceSeriesCache = null;
function getPeerPriceAndSeriesMap(ss) {
  if (_peerPriceSeriesCache) return _peerPriceSeriesCache;
  const peerPriceMap = {};
  const codeSeriesMap = {};
  const priceSheet = ss.getSheetByName("編號價目表");
  if (priceSheet) {
    const pData = priceSheet.getDataRange().getValues();
    const ph = pData[0];
    const skuIdx = findHeaderIndex(ph, ["編號", "產品編號"]);
    const peerIdx = findHeaderIndex(ph, ["同行價", "同行"]);
    const seriesIdx = findHeaderIndex(ph, ["中文系列", "系列"]);
    pData.slice(1).forEach(r => {
      const sku = skuIdx !== -1 ? String(r[skuIdx] || "").toUpperCase().replace(/[\s\-]/g, '') : '';
      if (!sku) return;
      if (peerIdx !== -1) {
        const price = parseFloat(r[peerIdx]) || 0;
        if (price > 0) peerPriceMap[sku] = price;
      }
      if (seriesIdx !== -1) codeSeriesMap[sku] = String(r[seriesIdx] || "").trim();
    });
  }
  _peerPriceSeriesCache = { peerPriceMap, codeSeriesMap };
  return _peerPriceSeriesCache;
}

let _jinyouliCodesSetCache = null;

/**
 * 🔍 取得今友利商品編號集合 (快取)
 */
function getJinyouliCodesSetCached() {
  if (_jinyouliCodesSetCache) return _jinyouliCodesSetCache;
  const set = new Set();
  try {
    const extId = getScriptPropOrDefault_('JINYOULI_SS_ID', '1u_7xHHhMRh15cwSgf1MjjL6jFKasSkNFoEHrPUuj7Cc');
    const ss = SpreadsheetApp.openById(extId);
    const sheet = ss.getSheetByName("今友利庫存");
    if (sheet) {
      const rows = sheet.getDataRange().getValues();
      if (rows.length > 1) {
        const header = rows[0];
        const skuIdx = findHeaderIndex(header, ["編號"]);
        if (skuIdx !== -1) {
          rows.slice(1).forEach(r => {
            const sku = String(r[skuIdx] || "").toUpperCase().replace(/[\s\-]/g, '');
            if (sku) {
              set.add(sku);
            }
          });
        }
      }
    }
  } catch (e) {
    console.warn("無法取得今友利商品編號:", e);
  }
  _jinyouliCodesSetCache = set;
  return _jinyouliCodesSetCache;
}

let _sleeperConfigMapCache = null;

/**
 * 🔍 取得睡美人商品設定 Map (sku -> { grade, cost })
 */
function getSleeperConfigMap(ss) {
  if (_sleeperConfigMapCache) return _sleeperConfigMapCache;
  const map = {};
  try {
    if (!ss) {
      ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    }
    
    // 1. 讀取 睡美人 工作表
    const sleeperSheet = ss.getSheetByName("睡美人");
    if (sleeperSheet) {
      const data = sleeperSheet.getDataRange().getValues();
      if (data.length > 1) {
        const h = data[0];
        const idxGrade = findHeaderIndex(h, ["等級", "級別"]);
        const idxSku = findHeaderIndex(h, ["編號", "產品編號", "品號"]);
        const idxCost = findHeaderIndex(h, ["成本", "單片成本", "成本價"]);
        
        if (idxGrade !== -1 && idxSku !== -1) {
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const sku = String(row[idxSku] || "").toUpperCase().replace(/[\s\-]/g, '');
            if (!sku) continue;
            map[sku] = {
              grade: String(row[idxGrade] || "").toUpperCase().trim(),
              cost: idxCost !== -1 ? parseFloat(row[idxCost]) || 0 : 0
            };
          }
        }
      }
    }
    
    // 2. 讀取 編號價目表 (Overlay 成本, 並加入 marked 睡美人)
    const priceSheet = ss.getSheetByName("編號價目表");
    if (priceSheet) {
      const priceData = priceSheet.getDataRange().getValues();
      if (priceData.length > 1) {
        const pH = priceData[0];
        const pCode = findHeaderIndex(pH, ["編號", "產品編號"]);
        const pSleeper = findHeaderIndex(pH, ["睡美人"]);
        const pCost = findHeaderIndex(pH, ["成本", "單片成本", "成本價"]);
        const pNoRenew = findHeaderIndex(pH, ["不續辦"]);
        
        if (pCode !== -1) {
          const priceCosts = {};
          for (let pi = 1; pi < priceData.length; pi++) {
            const rsku = String(priceData[pi][pCode] || "").toUpperCase().replace(/[\s\-]/g, '');
            if (!rsku) continue;
            priceCosts[rsku] = pCost !== -1 ? parseFloat(priceData[pi][pCost]) || 0 : 0;
          }
          
          // 覆蓋睡美人工作表成本
          Object.keys(map).forEach(sku => {
            if (priceCosts[sku] && priceCosts[sku] > 0) {
              map[sku].cost = priceCosts[sku];
            }
          });
          
          // 新增僅在價目表標記為睡美人的商品 (預設等級 S)
          if (pSleeper !== -1) {
            for (let i = 1; i < priceData.length; i++) {
              const row = priceData[i];
              const sku = String(row[pCode] || "").toUpperCase().replace(/[\s\-]/g, '');
              if (!sku) continue;
              
              // 排除「不續辦」商品
              if (pNoRenew !== -1 && String(row[pNoRenew] || "").trim() !== '') {
                continue;
              }
              
              const mark = String(row[pSleeper] || "").trim();
              if (mark !== '' && !map[sku]) {
                map[sku] = {
                  grade: 'S',
                  cost: pCost !== -1 ? parseFloat(row[pCost]) || 0 : 0
                };
              }
            }
          }
          
          // 移除被標記為「不續辦」的商品 (可能從前面的「睡美人」工作表中被載入過)
          if (pNoRenew !== -1) {
            for (let i = 1; i < priceData.length; i++) {
              const row = priceData[i];
              const sku = String(row[pCode] || "").toUpperCase().replace(/[\s\-]/g, '');
              if (!sku) continue;
              const markNoRenew = String(row[pNoRenew] || "").trim();
              if (markNoRenew !== '') {
                delete map[sku];
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("無法取得睡美人設定 Map:", e);
  }
  _sleeperConfigMapCache = map;
  return _sleeperConfigMapCache;
}

let _seriesMapCache = null;

/**
 * 🔍 取得系列對照 Map (sku -> 系列名稱)
 */
function getSeriesMap(ss) {
  if (_seriesMapCache) return _seriesMapCache;
  const map = {};
  try {
    if (!ss) {
      ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    }
    const priceSheet = ss.getSheetByName("編號價目表");
    if (priceSheet) {
      const data = priceSheet.getDataRange().getValues();
      if (data.length > 1) {
        const h = data[0];
        const idxSku = findHeaderIndex(h, ["編號", "產品編號"]);
        const idxSeriesCn = findHeaderIndex(h, ["中文系列", "系列中文", "中文名稱"]);
        const idxSeriesEn = findHeaderIndex(h, ["系列", "英文系列"]);
        if (idxSku !== -1) {
          for (let i = 1; i < data.length; i++) {
            const sku = String(data[i][idxSku] || "").toUpperCase().replace(/[\s\-]/g, '');
            if (!sku) continue;
            const seriesVal = idxSeriesCn !== -1 ? data[i][idxSeriesCn] : (idxSeriesEn !== -1 ? data[i][idxSeriesEn] : "");
            map[sku] = String(seriesVal || "").trim() || "一般";
          }
        }
      }
    }
  } catch (e) {
    console.warn("無法取得系列 Map:", e);
  }
  _seriesMapCache = map;
  return _seriesMapCache;
}

/**
 * 🧮 計算睡美人業績加成倍數
 */
function calcSleeperMultiplier(grade, margin, priceCostRatio, isFullClearance) {
  const g = String(grade || "").toUpperCase().trim();
  if (g === 'XXX') {
    if (priceCostRatio >= 0.7) return 3;
    if (priceCostRatio >= 0.5) return 2;
    return 1;
  }
  if (g === 'S') {
    if (margin > 0.15) return 3;
    if (priceCostRatio >= 0.85) return 2;
    if (isFullClearance) return 2;
    return 1;
  }
  if (g === 'A') {
    if (margin > 0.15) return 2;
    if (isFullClearance) return 2.5;
    if (margin >= -0.05) return 1.5;
    return 1;
  }
  if (g === 'B') {
    if (margin > 0.30) return 2;
    return 1;
  }
  return 1;
}

/**
 * ⚖️ 根據同行價折減、今友利加成與睡美人等級加成計算成交金額
 */
function getAdjustedAmt(amt, code, qtyVal, priceVal, peerPriceMap) {
  if (amt === 0) return 0;
  let adjustedAmt = amt;
  
  // 1. 計算商品加成倍數
  const jylSet = getJinyouliCodesSetCached();
  const isJinyouli = jylSet && jylSet.has(code);
  
  const sleeperMap = getSleeperConfigMap();
  const sleeperInfo = sleeperMap[code];
  
  let multiplier = 1;
  if (isJinyouli) {
    multiplier = 2;
  } else if (sleeperInfo) {
    const qty = Math.abs(qtyVal);
    const uPrice = qty > 0 ? Math.abs(amt) / qty : 0;
    const cost = sleeperInfo.cost || 0;
    const totalCost = cost * qty;
    const margin = amt > 0 ? (amt - totalCost) / amt : 0;
    const priceCostRatio = cost > 0 ? uPrice / cost : 1;
    multiplier = calcSleeperMultiplier(sleeperInfo.grade, margin, priceCostRatio, false);
  }
  
  const baseAmt = amt * multiplier;
  adjustedAmt = baseAmt;
  
  // 2. 同行價六折折半
  const peerPrice = peerPriceMap[code] || 0;
  if (peerPrice > 0) {
    let unitPrice = 0;
    const p = parseFloat(priceVal) || 0;
    const q = parseFloat(qtyVal) || 0;
    if (p > 0) {
      unitPrice = Math.abs(p);
    } else if (q !== 0) {
      unitPrice = Math.abs(amt) / Math.abs(q);
    }
    
    const activeConfig = getActiveBonusConfig();
    if (unitPrice > 0 && unitPrice < peerPrice * activeConfig.PEER_PRICE_DISCOUNT_THRESHOLD) {
      adjustedAmt = baseAmt * activeConfig.PEER_PRICE_ADJUSTMENT_FACTOR; // 低於門檻，業績折半
    }
  }
  
  return adjustedAmt;
}

/**
 * 💰 計算個人當月獎金結構
 */
function calculateSalesBonus(salesName, monthlySales) {
  const activeConfig = getActiveBonusConfig();
  const name = String(salesName || "").trim();
  const rule = activeConfig.RULES[name];
  
  const result = {
    salesName: name,
    monthlySales: monthlySales, // 實得業績元
    baseBonus: 0,               // 達成獎金
    breakthroughBonus: 0,       // 突破獎金
    totalBonus: 0,              // 總獎金
    staffShare: 0,              // 內勤提撥
    netPayout: 0                // 業務實領
  };

  // 若未設定規則或該同仁未啟用 (enabled === false)
  if (!rule || rule.enabled === false) return result;

  // 1. 計算達成獎金
  if (monthlySales >= rule.minThreshold) {
    const exceed = monthlySales - rule.stepBase;
    if (exceed > 0) {
      result.baseBonus = Math.floor(exceed / rule.stepValue) * rule.stepBonus;
    }
  }

  // 2. 計算突破獎金 (取最高檔位，非累加)
  let maxBreakthrough = 0;
  if (rule.breakthroughs && rule.breakthroughs.length > 0) {
    rule.breakthroughs.forEach(b => {
      if (monthlySales >= b.limit) {
        if (b.bonus > maxBreakthrough) {
          maxBreakthrough = b.bonus;
        }
      }
    });
  }
  result.breakthroughBonus = maxBreakthrough;

  // 3. 分拆內勤與實領
  result.totalBonus = result.baseBonus + result.breakthroughBonus;
  result.staffShare = Math.round(result.totalBonus * activeConfig.STAFF_SHARE_RATE);
  result.netPayout = result.totalBonus - result.staffShare;

  return result;
}

/**
 * 取得全員業績速覽 (今日/當月/年度)
 */
/**
 * 🎯 設定睡美人年度目標（單位：萬），供前端可調整
 */
function setSleeperAnnualTarget(value) {
  try {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) return { success: false, msg: "目標金額不正確" };
    PropertiesService.getScriptProperties().setProperty("SLEEPER_ANNUAL_TARGET", String(v));
    CacheManager.removeLarge('sales_overview_v3.3_monthly');
    return { success: true };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📈 依業務彙整「客戶 → 今年累計(1月至今) vs 去年同期」業績比較
 * 供全知視角「客戶到訪紀錄」排行榜顯示每個客戶的年度成長率
 */
function getCustomerYtdCompareByBiz(employeeName) {
  const name = String(employeeName || '').trim();
  if (!name) return { success: false, msg: "缺少業務姓名" };

  const cacheKey = 'CUST_YTD_v3_' + name;
  const cached = CacheManager.getLarge(cacheKey);
  if (cached) return { success: true, data: cached };

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const salesSheet = ss.getSheetByName(SALES_CONFIG.SHEET_SALES);
    if (!salesSheet) return { success: false, msg: "找不到經銷銷售報表" };

    const salesData = salesSheet.getDataRange().getValues();
    const sh = salesData[0] || [];
    const sIdx = {
      date: findHeaderIndex(sh, ["單據日期", "銷貨日期", "日期"]),
      sales: findHeaderIndex(sh, ["負責業務", "業務", "負責人", "業務員"]),
      amt: findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
      code: findHeaderIndex(sh, ["產品編號", "編號", "品碼", "序號"]),
      cust: findHeaderIndex(sh, ["客戶名稱", "客戶"]),
      note: findHeaderIndex(sh, ["備註", "說明"]),
      qty: findHeaderIndex(sh, ["數量", "片數"]),
      price: findHeaderIndex(sh, ["單價", "成交單價"])
    };

    const { peerPriceMap } = getPeerPriceAndSeriesMap(ss);
    const now = new Date();
    const thisYear = now.getFullYear();
    const lastYear = thisYear - 1;
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();

    const map = {}; // custName → { thisYear, lastYear }
    const sharedMembers = ['謝博皓', '潘右森', '陳勁多'];

    salesData.slice(1).forEach(r => {
      const d = r[sIdx.date];
      if (!(d instanceof Date)) return;
      const y = d.getFullYear();
      if (y !== thisYear && y !== lastYear) return;
      if (y === lastYear) {
        // 只計去年「同一段時間範圍」內（月/日皆不超過今天），才是公平的同期比較
        const m = d.getMonth(), dd = d.getDate();
        if (m > todayMonth || (m === todayMonth && dd > todayDate)) return;
      }

      const custRaw = String(r[sIdx.cust] || "").trim();
      const note = String(r[sIdx.note] || "");
      if (custRaw.includes('樣品') || note.includes('樣品') || note.includes('扣帶') || note.includes('代領') || custRaw.includes('代領')) return;

      const rowSales = String(r[sIdx.sales] || "");
      const isSharedCust = (custRaw.includes('漢樺') || custRaw.includes('波爾泰'));
      const shouldCount = isSharedCust ? sharedMembers.includes(name) : rowSales.includes(name);
      if (!shouldCount) return;
      const weight = isSharedCust ? 1 / 3 : 1;

      const rawAmt = parseFloat(r[sIdx.amt]) || 0;
      if (rawAmt === 0) return;
      const code = String(r[sIdx.code] || "").toUpperCase().replace(/[\s\-]/g, '');
      const amt = getAdjustedAmt(rawAmt, code, sIdx.qty !== -1 ? r[sIdx.qty] : 0, sIdx.price !== -1 ? r[sIdx.price] : 0, peerPriceMap) * weight;

      const custName = getCustomerShortName(custRaw);
      if (!custName) return;
      if (!map[custName]) map[custName] = { thisYear: 0, lastYear: 0 };
      map[custName][y === thisYear ? 'thisYear' : 'lastYear'] += amt;
    });

    CacheManager.putLarge(cacheKey, map, 1800); // 30 分鐘快取
    return { success: true, data: map };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

function getSalesOverview() {
  const cacheKey = 'sales_overview_v3.3_monthly'; // 升級快取 Key（新增睡美人明細/目標）
  const cached = CacheManager.getLarge(cacheKey);
  if (cached) return { success: true, data: cached };

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const zoningSheet = ss.getSheetByName("業務分區");
    const salesSheet = ss.getSheetByName("經銷銷售報表");
    
    if (!zoningSheet) return { success: false, msg: "找不到業務分區表" };

    const zoningData = zoningSheet.getDataRange().getValues();
    const zh = zoningData[0];
    const zRows = zoningData.slice(1);

    const idx = {
      cust:    findHeaderIndex(zh, ["客戶名稱", "客戶"]),
      sales:   findHeaderIndex(zh, ["負責業務", "業務", "負責人", "業務員"]),
      target:  findHeaderIndex(zh, ["目標", "業績目標"]),
      ytd:     findHeaderIndex(zh, ["2026", "今年業績"]),
      m12:     [1,2,3,4,5,6,7,8,9,10,11,12].map(m => findHeaderIndex(zh, [m + "月"]))
    };

    // 🚀 核心變動 1：抓取有數據的最後一天
    const salesData = salesSheet ? salesSheet.getDataRange().getValues() : [];
    const sh = salesData[0] || [];
    const sIdx = {
      date: findHeaderIndex(sh, ["單據日期", "銷貨日期", "日期"]),
      sales: findHeaderIndex(sh, ["負責業務", "業務", "負責人", "業務員"]),
      amt: findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
      code: findHeaderIndex(sh, ["產品編號", "編號", "品碼", "序號"]),
      cust: findHeaderIndex(sh, ["客戶名稱", "客戶"]),
      note: findHeaderIndex(sh, ["備註", "說明"]),
      qty: findHeaderIndex(sh, ["數量", "片數"]),
      price: findHeaderIndex(sh, ["單價", "成交單價"])
    };

    let lastDataDate = new Date();
    if (salesData.length > 1) {
      const dates = salesData.slice(1).map(r => r[sIdx.date]).filter(d => d instanceof Date);
      if (dates.length > 0) {
        lastDataDate = new Date(Math.max.apply(null, dates));
      }
    }
    const now = new Date();
    const curMonthIdx = now.getMonth(); // 0-11
    
    const todayStr = Utilities.formatDate(lastDataDate, "GMT+8", "yyyy/MM/dd");
    const displayDate = lastDataDate.getFullYear() === now.getFullYear() ? 
                      Utilities.formatDate(lastDataDate, "GMT+8", "MM/dd") : 
                      Utilities.formatDate(lastDataDate, "GMT+8", "yyyy/MM/dd");
    // 🚀 核心變動 2：取得睡美人產品清單、同行價與系列名稱（同行價+系列合併單次讀取，避免重複掃表）
    const sleeperMap = getSleeperConfigMap(ss);
    const sleeperCodes = new Set(Object.keys(sleeperMap));
    const { peerPriceMap, codeSeriesMap } = getPeerPriceAndSeriesMap(ss);

    // 🎯 睡美人年度目標（可由前端調整，存於 Script Properties，預設 300 萬）
    let sleeperTarget = parseFloat(PropertiesService.getScriptProperties().getProperty("SLEEPER_ANNUAL_TARGET"));
    if (!sleeperTarget || sleeperTarget <= 0) sleeperTarget = 300;

    const todaySales = salesData.slice(1).filter(r => {
      const d = r[sIdx.date];
      if (!(d instanceof Date)) return false;
      return Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd") === todayStr;
    });

    const result = {
      today:  { total: 0, date: displayDate },
      month:  { total: 0 },
      year:   { total: 0 },
      target: { total: 0 },
      sleeper: { today: 0, month: 0, year: 0 },
      people: []
    };

    // 🚀 核心優化：單次掃描完成所有統計 (Single-pass processing)
    const personMap = {};
    SALES_CONFIG.SALES_PEOPLE.forEach(p => {
      personMap[p.name] = {
        name: p.name,
        alias: p.alias,
        color: p.color,
        pToday: 0, pMonth: 0, pYear: 0,
        pSleeperM: 0, pSleeperY: 0,
        months: new Array(12).fill(0),
        pCustMap: {},
        pSleeperItemMap: {}, // key: 客戶||編號 → { customer, code, series, amt }（全年彙總，供舊版相容）
        pSleeperMonthMap: {} // key: 0-11 月份 → { total, itemMap: { 客戶||編號 → {customer, code, series, amt} } }
      };
    });

    salesData.slice(1).forEach(r => {
      const d = r[sIdx.date];
      if (!(d instanceof Date)) return;
      
      const custName = String(r[sIdx.cust] || "").trim();
      const note = String(r[sIdx.note] || "");
      // 🚀 強化過濾：樣品、計價樣品、代領、扣帶
      if (custName.includes('樣品') || note.includes('樣品') || note.includes('扣帶') || note.includes('代領') || custName.includes('代領')) return;

      const rawAmt = parseFloat(r[sIdx.amt]) || 0;
      if (rawAmt === 0) return;

      const code = String(r[sIdx.code] || "").toUpperCase().replace(/[\s\-]/g, '');
      
      // ⚖️ 套用同行價 6 折折減計算
      const amt = getAdjustedAmt(
        rawAmt,
        code,
        sIdx.qty !== -1 ? r[sIdx.qty] : 0,
        sIdx.price !== -1 ? r[sIdx.price] : 0,
        peerPriceMap
      );

      const isSleeper = sleeperCodes.has(code);
      const isCurrentYear = d.getFullYear() === lastDataDate.getFullYear();
      const isCurrentMonth = isCurrentYear && d.getMonth() === lastDataDate.getMonth();
      const isToday = isCurrentMonth && Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd") === todayStr;

      // 1. 全域睡美人總計
      if (isSleeper && isCurrentYear) {
        result.sleeper.year += amt;
        if (isCurrentMonth) {
          result.sleeper.month += amt;
          if (isToday) result.sleeper.today += amt;
        }
      }

      // 2. 業務員統計
      const rowSales = String(r[sIdx.sales] || "");
      const isSharedCust = (custName.includes('漢樺') || custName.includes('波爾泰'));
      const weight = isSharedCust ? 1 / 3 : 1;
      const weightedAmt = amt * weight;
      // 漢樺/波爾泰：三個業務（謝博皓、潘右森、陳勁多）各拿 1/3，不看負責業務欄
      const sharedMembers = ['謝博皓', '潘右森', '陳勁多'];

      SALES_CONFIG.SALES_PEOPLE.forEach(p => {
        const shouldCount = isSharedCust ? sharedMembers.includes(p.name) : rowSales.includes(p.name);
        if (!shouldCount) return;
        const pm = personMap[p.name];

        if (isCurrentYear) {
          pm.pYear += weightedAmt;
          pm.months[d.getMonth()] += weightedAmt;

          if (isSleeper) pm.pSleeperY += amt;

          const mergedName = mergeCustomer(custName);
          if (!pm.pCustMap[mergedName]) {
            pm.pCustMap[mergedName] = { name: mergedName, displayName: getCustomerShortName(custName), ytd: 0, month: 0, today: 0, isShared: weight < 1 };
          }
          pm.pCustMap[mergedName].ytd += weightedAmt;

          if (isCurrentMonth) {
            pm.pMonth += weightedAmt;
            pm.pCustMap[mergedName].month += weightedAmt;
            if (isSleeper) pm.pSleeperM += amt;
            if (isToday) {
              pm.pToday += weightedAmt;
              pm.pCustMap[mergedName].today += weightedAmt;
            }
          }

          // 🟣 睡美人下探明細：客戶 + 編號/系列 + 金額（本年度累計，不分攤，比照 pSleeperY 口徑）
          if (isSleeper) {
            const itemKey = mergedName + "||" + code;
            if (!pm.pSleeperItemMap[itemKey]) {
              pm.pSleeperItemMap[itemKey] = {
                customer: getCustomerShortName(custName),
                code: r[sIdx.code] || code,
                series: codeSeriesMap[code] || '',
                amt: 0
              };
            }
            pm.pSleeperItemMap[itemKey].amt += amt;

            // 依月份彙總（供「先看每月業績→下探明細」使用）
            const mIdx = d.getMonth();
            if (!pm.pSleeperMonthMap[mIdx]) pm.pSleeperMonthMap[mIdx] = { total: 0, itemMap: {} };
            pm.pSleeperMonthMap[mIdx].total += amt;
            if (!pm.pSleeperMonthMap[mIdx].itemMap[itemKey]) {
              pm.pSleeperMonthMap[mIdx].itemMap[itemKey] = {
                customer: getCustomerShortName(custName),
                code: r[sIdx.code] || code,
                series: codeSeriesMap[code] || '',
                amt: 0
              };
            }
            pm.pSleeperMonthMap[mIdx].itemMap[itemKey].amt += amt;
          }
        }
      });
    });

    // 🚀 後處理與封裝
    result.year.total = 0;
    result.target.total = 0;
    result.month.total = 0;
    result.today.total = 0;

    SALES_CONFIG.SALES_PEOPLE.forEach(p => {
      const pm = personMap[p.name];
      const pTarget = SALES_CONFIG.FIXED_TARGET_PER_PERSON;

      const sortedCustomers = Object.values(pm.pCustMap)
        .map(c => ({
          name: c.displayName || c.name,
          ytd: Math.round(c.ytd / 10000 * 10) / 10,
          month: Math.round(c.month / 10000 * 10) / 10,
          today: Math.round(c.today / 10000 * 10) / 10,
          isShared: c.isShared
        }))
        .filter(c => c.ytd > 0)
        .sort((a,b) => b.ytd - a.ytd);

      const pToday = Math.round(pm.pToday / 1000) / 10;
      const pMonth = Math.round(pm.pMonth / 1000) / 10;
      const pYear = Math.round(pm.pYear / 1000) / 10;

      // 💰 計算當月獎金估算
      const bonusInfo = calculateSalesBonus(p.name, pm.pMonth);

      // 🟣 睡美人下探明細：客戶＋編號/系列＋金額（換算成萬，由大到小；全年彙總，供舊版相容）
      const sleeperItems = Object.values(pm.pSleeperItemMap)
        .map(it => ({
          customer: it.customer,
          code: it.code,
          series: it.series,
          amt: Math.round(it.amt / 10000 * 10) / 10
        }))
        .filter(it => it.amt > 0)
        .sort((a, b) => b.amt - a.amt);

      // 🟣 睡美人下探明細：先看每月業績，再展開該月客戶/系列明細（最新月份在前）
      const sleeperMonths = [];
      for (let mIdx = 11; mIdx >= 0; mIdx--) {
        const md = pm.pSleeperMonthMap[mIdx];
        if (!md || md.total <= 0) continue;
        sleeperMonths.push({
          month: mIdx + 1,
          amt: Math.round(md.total / 10000 * 10) / 10,
          items: Object.values(md.itemMap)
            .map(it => ({
              customer: it.customer,
              code: it.code,
              series: it.series,
              amt: Math.round(it.amt / 10000 * 10) / 10
            }))
            .filter(it => it.amt > 0)
            .sort((a, b) => b.amt - a.amt)
        });
      }

      result.people.push({
        name: p.name,
        alias: p.alias,
        color: p.color,
        day: pToday,
        month: pMonth,
        year: pYear,
        target: pTarget,
        contrib: pTarget > 0 ? Math.round(pYear / pTarget * 1000) / 10 : 0,
        months: pm.months.map(v => Math.round(v / 10000 * 10) / 10),
        customers: sortedCustomers,
        sleeper: {
          month: Math.round(pm.pSleeperM / 10000 * 10) / 10,
          year: Math.round(pm.pSleeperY / 10000 * 10) / 10,
          items: sleeperItems,
          months: sleeperMonths
        },
        bonus: bonusInfo // 擴充獎金結構
      });

      result.today.total += pToday;
      result.month.total += pMonth;
      result.year.total += pYear;
      result.target.total += pTarget;
    });

    result.sleeper.year = Math.round(result.sleeper.year / 10000 * 10) / 10;
    result.sleeper.month = Math.round(result.sleeper.month / 10000 * 10) / 10;
    result.sleeper.today = Math.round(result.sleeper.today / 10000 * 10) / 10;

    // 🎯 睡美人年度目標達成率 + 各業務貢獻比（分母＝全員睡美人年度總額）
    result.sleeper.target = sleeperTarget;
    result.sleeper.achieveRate = sleeperTarget > 0 ? Math.round(result.sleeper.year / sleeperTarget * 1000) / 10 : 0;
    result.people.forEach(p => {
      p.sleeper.contribRate = result.sleeper.year > 0 ? Math.round(p.sleeper.year / result.sleeper.year * 1000) / 10 : 0;
    });

    // 格式化總計
    result.today.total = Math.round(result.today.total * 10) / 10;
    result.month.total = Math.round(result.month.total * 10) / 10;
    result.year.total = Math.round(result.year.total * 10) / 10;
    result.target.total = Math.round(result.target.total * 10) / 10;
    result.achieveRate = result.target.total > 0 ? Math.round(result.year.total / result.target.total * 1000) / 10 : 0;

    CacheManager.putLarge(cacheKey, result, 600); // 快取 10 分鐘

    return { success: true, data: result };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 取得單人業績 (相容舊版或供詳情按鈕呼叫)
 */
function getSalespersonKpi(salesName, monthIdx) {
  const overview = getSalesOverview();
  if (!overview.success) return overview;
  
  const person = overview.data.people.find(p => p.name === salesName || p.alias === salesName);
  if (!person) return { success: false, msg: "找不到該業務分析資料" };

  // 🚀 關鍵加強：若有傳入月份，則重新計算該月份的客戶佔比與當月獎金
  let customers = person.customers;
  let targetYtd = person.year;
  let bonusInfo = person.bonus;

  if (monthIdx !== undefined && monthIdx !== null && monthIdx !== -1) {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const salesSheet = ss.getSheetByName("經銷銷售報表");
    const salesData = salesSheet.getDataRange().getValues();
    const sh = salesData[0];
    const sIdx = {
      date: findHeaderIndex(sh, ["單據日期", "銷貨日期", "日期"]),
      sales: findHeaderIndex(sh, ["負責業務", "業務", "負責人", "業務員"]),
      amt: findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
      cust: findHeaderIndex(sh, ["客戶名稱", "客戶"]),
      note: findHeaderIndex(sh, ["備註", "說明"]),
      code: findHeaderIndex(sh, ["產品編號", "編號", "品碼", "序號"]),
      qty: findHeaderIndex(sh, ["數量", "片數"]),
      price: findHeaderIndex(sh, ["單價", "成交單價"])
    };

    const peerPriceMap = getPeerPriceMap(ss);
    const pCustMap = {};
    let mTotal = 0;
    const now = new Date();
    
    // 🚀 定態取得資料年份
    let targetYear = now.getFullYear();
    if (salesData.length > 1) {
      const dates = salesData.slice(1).map(r => r[sIdx.date]).filter(d => d instanceof Date);
      if (dates.length > 0) targetYear = new Date(Math.max.apply(null, dates)).getFullYear();
    }

    const sharedMembers2 = ['謝博皓', '潘右森', '陳勁多'];
    salesData.slice(1).forEach(r => {
      const d = r[sIdx.date];
      if (!(d instanceof Date) || d.getFullYear() !== targetYear || d.getMonth() !== parseInt(monthIdx)) return;

      const custName = String(r[sIdx.cust] || "").trim();
      const isSharedCust2 = (custName.includes('漢樺') || custName.includes('波爾泰'));
      const rowSalesStr = String(r[sIdx.sales] || "");
      const shouldCount2 = isSharedCust2 ? sharedMembers2.includes(person.name) : rowSalesStr.includes(person.name);
      if (!shouldCount2) return;

      const note = String(r[sIdx.note] || "");
      if (custName.includes('樣品') || note.includes('樣品') || note.includes('扣帶') || note.includes('代領') || custName.includes('代領')) return;

      const rawAmt = parseFloat(r[sIdx.amt]) || 0;
      const code = sIdx.code !== -1 ? String(r[sIdx.code] || "").toUpperCase().replace(/[\s\-]/g, '') : "";

      const amt = getAdjustedAmt(
        rawAmt,
        code,
        sIdx.qty !== -1 ? r[sIdx.qty] : 0,
        sIdx.price !== -1 ? r[sIdx.price] : 0,
        peerPriceMap
      );

      const weight = isSharedCust2 ? 1 / 3 : 1;
      const weightedAmt = amt * weight;

      const mergedName = mergeCustomer(custName);
      if (!pCustMap[mergedName]) {
        pCustMap[mergedName] = { name: mergedName, displayName: getCustomerShortName(custName), ytd: 0, isShared: weight < 1 };
      }
      pCustMap[mergedName].ytd += weightedAmt;
      mTotal += weightedAmt;
    });

    customers = Object.values(pCustMap)
      .map(c => ({
        name: c.displayName || c.name,
        ytd: Math.round(c.ytd / 10000 * 10) / 10,
        isShared: c.isShared
      }))
      .filter(c => c.ytd > 0)
      .sort((a,b) => b.ytd - a.ytd);
    
    targetYtd = Math.round(mTotal / 10000 * 10) / 10;
    bonusInfo = calculateSalesBonus(person.name, mTotal);
  }
  
  return {
    success: true,
    data: {
      salesName: person.name,
      ytd: targetYtd,
      target: person.target,
      achieveRate: person.contrib,
      months: person.months,
      customers: customers,
      sleeper: person.sleeper,
      bonus: bonusInfo // 攜帶當月獎金結構
    }
  };
}

/**
 * 🚀 取得睡美人產品銷售明細
 */
function getSleeperDetails(salesName, monthIdx) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const salesSheet = ss.getSheetByName("經銷銷售報表");
    const priceSheet = ss.getSheetByName("編號價目表");
    
    const peerPriceMap = getPeerPriceMap(ss);
    
    // 1. 抓取睡美人產品清單與系列
    const sleeperConfig = getSleeperConfigMap(ss);
    const seriesMap = getSeriesMap(ss);

    // 2. 掃描當月銷售
    const salesData = salesSheet.getDataRange().getValues();
    const sh = salesData[0];
    const sIdx = {
      date: findHeaderIndex(sh, ["單據日期", "銷貨日期", "日期"]),
      sales: findHeaderIndex(sh, ["負責業務", "業務", "負責人", "業務員"]),
      amt: findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
      cust: findHeaderIndex(sh, ["客戶名稱", "客戶"]),
      code: findHeaderIndex(sh, ["產品編號", "編號", "品碼", "序號"]),
      note: findHeaderIndex(sh, ["備註", "說明"]),
      qty: findHeaderIndex(sh, ["數量", "片數"]),
      price: findHeaderIndex(sh, ["單價", "成交單價"])
    };

    const now = new Date();
    const targetMonth = (monthIdx !== undefined && monthIdx !== null) ? parseInt(monthIdx) : now.getMonth();
    
    // 🚀 定態取得資料年份
    let targetYear = now.getFullYear();
    if (salesData.length > 1) {
      const dates = salesData.slice(1).map(r => r[sIdx.date]).filter(d => d instanceof Date);
      if (dates.length > 0) targetYear = new Date(Math.max.apply(null, dates)).getFullYear();
    }

    const details = [];
    salesData.slice(1).forEach(r => {
      const d = r[sIdx.date];
      if (!(d instanceof Date) || d.getFullYear() !== targetYear || d.getMonth() !== targetMonth) return;

      const custName = String(r[sIdx.cust] || "").trim();
      const isSharedCust4 = (custName.includes('漢樺') || custName.includes('波爾泰'));
      const sharedMembers4 = ['謝博皓', '潘右森', '陳勁多'];
      if (salesName) {
        const shouldCount4 = isSharedCust4 ? sharedMembers4.includes(salesName) : String(r[sIdx.sales] || "").includes(salesName);
        if (!shouldCount4) return;
      }

      const note = String(r[sIdx.note] || "");
      if (custName.includes('樣品') || note.includes('樣品') || note.includes('扣帶') || note.includes('代領') || custName.includes('代領')) return;

      const code = String(r[sIdx.code] || "").toUpperCase().replace(/[\s\-]/g, '');
      if (sleeperConfig[code]) {
        const rawAmt = parseFloat(r[sIdx.amt]) || 0;
        
        // ⚖️ 套用同行價六折折減
        const amt = getAdjustedAmt(
          rawAmt,
          code,
          sIdx.qty !== -1 ? r[sIdx.qty] : 0,
          sIdx.price !== -1 ? r[sIdx.price] : 0,
          peerPriceMap
        );

        details.push({
          date: Utilities.formatDate(d, "GMT+8", "MM/dd"),
          cust: String(r[sIdx.cust] || "").trim(),
          sku: code,
          series: seriesMap[code] || "一般",
          amt: Math.round(amt)
        });
      }
    });

    // 按金額排序
    details.sort((a,b) => b.amt - a.amt);

    return { success: true, data: details, month: targetMonth + 1 };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * ⏰ 定時同步：從交易報表更新「業務分區」的當月數字
 */
function syncSalesDataToZoning() {
  const result = syncSalesDataByYear(new Date().getFullYear(), new Date().getMonth());
  console.log(result.msg);
  return result;
}

/**
 * 🚀 手動同步：一次更新 2026 全整年度數據
 */
function syncAllMonths2026() {
  const result = syncSalesDataByYear(2026); // 不傳月份即同步全年
  console.log(result.msg);
  try {
    if (result.msg) SpreadsheetApp.getUi().alert(result.msg);
  } catch (e) {}
  return result;
}

/**
 * 每日自動同步（由 Time-driven trigger 呼叫）
 * 同步當年全年資料至業務分區表
 */
function dailyAutoSync() {
  const year = new Date().getFullYear();
  const result = syncSalesDataByYear(year);
  console.log("【每日自動同步】" + result.msg);
}

/**
 * 🔥 業績總覽快取預熱：每 5 分鐘跑一次，搶在 10 分鐘快取過期前重新計算，
 * 讓業務打開「業績總結」時永遠讀到熱快取，不用現場等全表掃描。
 */
function prewarmSalesOverview() {
  try {
    const res = getSalesOverview();
    console.log("【業績快取預熱】" + (res.success ? "成功" : "失敗：" + res.msg));
  } catch (e) {
    console.error("【業績快取預熱】錯誤：" + e);
  }
}

/**
 * 🔥 庫存查詢快取預熱（getInventoryMapCached，10 分鐘快取，全域單一 key）
 */
function prewarmInventoryMap() {
  try {
    const ss = getSafeSsMain();
    getInventoryMapCached(ss);
    console.log("【庫存快取預熱】成功");
  } catch (e) {
    console.error("【庫存快取預熱】錯誤：" + e);
  }
}

/**
 * 🔥 上架追蹤快取預熱（getShelfTrackingData，10 分鐘快取，全域單一 key）
 */
function prewarmShelfTracking() {
  try {
    const res = getShelfTrackingData(true);
    console.log("【上架追蹤快取預熱】" + (res.success ? "成功" : "失敗：" + res.msg));
  } catch (e) {
    console.error("【上架追蹤快取預熱】錯誤：" + e);
  }
}

/**
 * 🔥 全知視角快取預熱
 * - getAllSalesDailyReports：真正的「全知視角」頁面資料源（每人一張卡＋X家＋拜訪明細）
 * - getOmniscientLogs：智能報表模組內另一個統計檢視，一併預熱
 * 兩者皆預設檢視「昨天」
 */
function prewarmOmniscientLogs() {
  try {
    const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), "GMT+8", "yyyy-MM-dd");
    const r1 = getAllSalesDailyReports(yesterday);
    const r2 = getOmniscientLogs(yesterday);
    console.log("【全知視角快取預熱】報表：" + (r1.success ? "成功" : "失敗：" + r1.msg) +
      "／統計：" + (r2.success ? "成功" : "失敗：" + r2.msg));
  } catch (e) {
    console.error("【全知視角快取預熱】錯誤：" + e);
  }
}

/**
 * 🔥 客戶到訪紀錄快取預熱（謝博皓/潘右森/陳勁多三人份，供全知視角「客戶到訪紀錄」分頁使用）
 */
function prewarmCustomerVisitRanking() {
  ['謝博皓', '潘右森', '陳勁多'].forEach(name => {
    try {
      const res = getCustomerVisitRanking(name);
      console.log("【客戶到訪紀錄預熱】" + name + "：" + (res.success ? "成功" : "失敗：" + res.msg));
    } catch (e) {
      console.error("【客戶到訪紀錄預熱】" + name + " 錯誤：" + e);
    }
  });
}

/**
 * 🔥 統一預熱入口：業績總覽 + 庫存查詢 + 上架追蹤 + 全知視角（預設日）+ 客戶到訪紀錄
 */
function prewarmAllCaches() {
  prewarmSalesOverview();
  prewarmInventoryMap();
  prewarmShelfTracking();
  prewarmOmniscientLogs();
  prewarmCustomerVisitRanking();
}

/**
 * 執行一次即可設定每 5 分鐘自動預熱業績/庫存/上架追蹤快取
 * 在 Apps Script 編輯器手動執行此函數一次即可（Sales.gs 下拉選單）
 */
function setupSalesOverviewPrewarmTrigger() {
  ['prewarmSalesOverview', 'prewarmInventoryMap', 'prewarmShelfTracking', 'prewarmAllCaches'].forEach(fn => {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
    });
  });
  ScriptApp.newTrigger('prewarmAllCaches')
    .timeBased()
    .everyMinutes(5)
    .create();
  return { success: true, msg: "已設定每 5 分鐘自動預熱業績/庫存/上架追蹤快取" };
}

/**
 * 執行一次即可設定每天早上 6-7 點自動同步
 * 在 Apps Script 編輯器手動執行此函數一次即可
 */
function setupDailyAutoSync() {
  // 避免重複設定：先刪除同名 trigger
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyAutoSync') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // 設定每天早上 6~7 點執行
  ScriptApp.newTrigger('dailyAutoSync')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  console.log("✅ 每日自動同步已設定完成，每天早上 6~7 點執行。");
}

/**
 * 核心同步邏輯 (戰情室旗艦引擎移植版)
 */
function syncSalesDataByYear(year, targetMonth) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    const zoningSheet = ss.getSheetByName("業務分區");
    const salesSheet = ss.getSheetByName("經銷銷售報表");
    if (!zoningSheet || !salesSheet) throw "找不到分頁 (業務分區 或 經銷銷售報表)";

    const peerPriceMap = getPeerPriceMap(ss);

    // 🚀 1. 偵測報表標題行 (戰情室自動掃描邏輯)
    const salesRaw = salesSheet.getDataRange().getValues();
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(25, salesRaw.length); i++) {
       const rowStr = salesRaw[i].join("");
       if (rowStr.includes("日期") && (rowStr.includes("金額") || rowStr.includes("銷額"))) {
         headerRowIdx = i;
         break;
       }
    }
    if (headerRowIdx === -1) headerRowIdx = 0;

    const sh = salesRaw[headerRowIdx];
    const sIdx = {
      date: findHeaderIndex(sh, ["單據日期", "銷貨日期", "日期"]),
      sales: findHeaderIndex(sh, ["負責業務", "業務", "負責人", "業務員"]),
      cust: findHeaderIndex(sh, ["客戶名稱", "客戶"]),
      custCode: findHeaderIndex(sh, ["客戶編號", "客戶代碼"]),
      amt: findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]),
      type: findHeaderIndex(sh, ["類別", "單據類別", "性質"]),
      note: findHeaderIndex(sh, ["備註", "說明"]),
      code: findHeaderIndex(sh, ["產品編號", "編號", "品碼", "序號"]),
      qty: findHeaderIndex(sh, ["數量", "片數"]),
      price: findHeaderIndex(sh, ["單價", "成交單價"])
    };

    console.log("【欄位偵測結果】", JSON.stringify(sIdx));
    console.log("【報表標頭原始內容】", JSON.stringify(sh.slice(0, 20)));

    // 診斷變數
    let totalScan = 0;
    let yearCounts = {};
    let validMatchCount = 0;
    const stats = {};
    const sharedStats = {};

    // 🚀 2. 數據清洗與沈降 (戰情室過濾邏輯)
    salesRaw.slice(headerRowIdx + 1).forEach(r => {
      totalScan++;
      const d = parseDate(r[sIdx.date]);
      const y = d ? d.getFullYear() : "失效日期";
      yearCounts[y] = (yearCounts[y] || 0) + 1;

      if (!d || (d.getFullYear() !== year && d.getFullYear() !== (year - 1911))) return;
      const m = d.getMonth();
      if (targetMonth !== undefined && m !== targetMonth) return;

      const custName = String(r[sIdx.cust] || "").trim();
      const note = String(r[sIdx.note] || "");

      // 修正：正規表達式加入逗號 [$,\s,] 確保解析 4,599 正確
      const rawAmt = parseFloat(String(r[sIdx.amt] || "0").replace(/[$,\s,]/g, "")) || 0;
      if (rawAmt === 0) return; 

      // 核心過濾：只過濾樣品與扣帶，退貨保留（金額為負時自然抵減）
      if (custName.includes('樣品') || note.includes('樣品') || note.includes('扣帶')) {
        return; 
      }

      const code = sIdx.code !== -1 ? String(r[sIdx.code] || "").toUpperCase().replace(/[\s\-]/g, '') : "";
      
      // ⚖️ 同行價六折防禦性計算
      const amt = getAdjustedAmt(
        rawAmt,
        code,
        sIdx.qty !== -1 ? r[sIdx.qty] : 0,
        sIdx.price !== -1 ? r[sIdx.price] : 0,
        peerPriceMap
      );

      validMatchCount++;
      const merged = mergeCustomer(custName);
      
      if (!stats[m]) stats[m] = {};
      stats[m][merged] = (stats[m][merged] || 0) + amt;
    });

    // 🚀 3. 獲取業務分區索引
    const zoningData = zoningSheet.getDataRange().getValues();
    const zh = zoningData[0];
    const zIdx = {
      cust:    findHeaderIndex(zh, ["客戶"]),
      sales:   findHeaderIndex(zh, ["負責業務", "業務", "負責人"]),
      target:  findHeaderIndex(zh, ["目標"]),
      ytd:     findHeaderIndex(zh, [String(year), "今年業績"]),
      achieve: findHeaderIndex(zh, ["達成率"]),
      contrib: findHeaderIndex(zh, ["貢獻度"]),
      months:  [1,2,3,4,5,6,7,8,9,10,11,12].map(m => findHeaderIndex(zh, [m + "月"])),
      quarters: [1,2,3,4].map(q => findHeaderIndex(zh, ["Q" + q]))
    };

    // A. 更新月份業績 (萬)
    const monthsToSync = targetMonth !== undefined ? [targetMonth] : [0,1,2,3,4,5,6,7,8,9,10,11];
    monthsToSync.forEach(m => {
      const colIdx = zIdx.months[m];
      if (colIdx === -1) return;
      const vls = zoningData.slice(1).map(row => {
        const rowCust = String(row[zIdx.cust] || "").trim();
        const merged = mergeCustomer(rowCust);
        let val = stats[m] ? (stats[m][merged] || 0) : 0;
        
        // 🚀 關鍵權重：若是漢樺或波爾泰，業績採計 1/3 (按需求套用)
        val = val * getSharedSalesWeight(rowCust);

        const fv = Math.round(val / 10000 * 10) / 10;
        return [fv === 0 ? "" : fv];
      });
      zoningSheet.getRange(2, colIdx + 1, vls.length, 1).setValues(vls).setHorizontalAlignment("center");
    });    // B. 執行連鎖數據沈降 (Q -> Year -> KPI)
    const freshRows = zoningSheet.getDataRange().getValues().slice(1);
    let totalYtd = 0;
    const qv = [[],[],[],[]], yv = [], av = [], cv = [];

    // 1. 計算加總數據
    freshRows.forEach(r => {
      const qs = [0,0,0,0];
      for (let i = 0; i < 4; i++) {
        // 每季加總 (3個月一組)
        qs[i] = [0,1,2].reduce((sum, offset) => {
          const c = zIdx.months[i*3 + offset];
          return sum + (c !== -1 ? (parseFloat(r[c]) || 0) : 0);
        }, 0);
        qv[i].push([qs[i] === 0 ? "" : Math.round(qs[i] * 10) / 10]);
      }
      const ytd = qs.reduce((a,b) => a+b, 0);
      totalYtd += ytd;
      yv.push([ytd === 0 ? "" : Math.round(ytd * 10) / 10]);
    });

    // 2. 寫入季度與年度加總
    zIdx.quarters.forEach((col, i) => {
      if (col !== -1) zoningSheet.getRange(2, col + 1, qv[i].length, 1).setValues(qv[i]).setHorizontalAlignment("center");
    });
    if (zIdx.ytd !== -1) {
      zoningSheet.getRange(2, zIdx.ytd + 1, yv.length, 1).setValues(yv)
        .setHorizontalAlignment("center").setFontWeight("bold");
    }

    // 3. 計算 KPI (達成率、貢獻度)
    freshRows.forEach((r, idx) => {
      const val = parseFloat(yv[idx][0]) || 0;
      const target = zIdx.target !== -1 ? (parseFloat(r[zIdx.target]) || 0) : 0;
      av.push([target > 0 ? (val / target) : ""]);
      cv.push([totalYtd > 0 ? (val / totalYtd) : ""]);
    });

    if (zIdx.achieve !== -1) {
      zoningSheet.getRange(2, zIdx.achieve + 1, av.length, 1).setValues(av)
        .setNumberFormat("0.0%").setHorizontalAlignment("center");
    }
    if (zIdx.contrib !== -1) {
      zoningSheet.getRange(2, zIdx.contrib + 1, cv.length, 1).setValues(cv)
        .setNumberFormat("0.0%").setHorizontalAlignment("center");
    }

    let diag = `【🏢 戰情室旗艦引擎-同步報告】\n`;
    diag += `1. 報表標題行：第 ${headerRowIdx + 1} 行\n`;
    diag += `2. 總掃描項目：${totalScan} 筆\n`;
    diag += `3. 排除樣品與無效後：${validMatchCount} 筆\n`;
    diag += `4. 年份分布情況：${JSON.stringify(yearCounts)}\n\n`;
    diag += (validMatchCount > 0) ? `✨ 業績、達成率與貢獻度同步完成！` : `⚠️ 警告：未找到任何有效業績。`;

    return { success: true, msg: diag };
  } catch(e) {
    console.error(e);
    return { success: false, msg: "❌ 戰情室引擎執行失敗: " + e.toString() };
  }
}

/**
 * 🧪 單元測試：驗證睡美人等級加成與折減計算
 */
function testSleeperCalculation() {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
  const sleeperMap = getSleeperConfigMap(ss);
  console.log("Loaded sleeper keys count:", Object.keys(sleeperMap).length);
  
  // Test calcSleeperMultiplier
  // Grade S: margin > 0.15 => 3, ratio >= 0.85 => 2, else 1
  console.log("Grade S, margin 0.2, ratio 0.9 =>", calcSleeperMultiplier('S', 0.2, 0.9, false)); // Expected: 3
  console.log("Grade S, margin 0.1, ratio 0.9 =>", calcSleeperMultiplier('S', 0.1, 0.9, false)); // Expected: 2
  console.log("Grade S, margin 0.1, ratio 0.8 =>", calcSleeperMultiplier('S', 0.1, 0.8, false)); // Expected: 1
  
  // Grade A: margin > 0.15 => 2, ratio is ignored, clearance => 2.5, margin >= -0.05 => 1.5, else 1
  console.log("Grade A, margin 0.2 =>", calcSleeperMultiplier('A', 0.2, 1, false)); // Expected: 2
  console.log("Grade A, margin 0.0 =>", calcSleeperMultiplier('A', 0.0, 1, false)); // Expected: 1.5
  console.log("Grade A, margin -0.1 =>", calcSleeperMultiplier('A', -0.1, 1, false)); // Expected: 1
  
  // Grade XXX: ratio >= 0.7 => 3, >= 0.5 => 2, else 1
  console.log("Grade XXX, ratio 0.75 =>", calcSleeperMultiplier('XXX', 0, 0.75, false)); // Expected: 3
  console.log("Grade XXX, ratio 0.55 =>", calcSleeperMultiplier('XXX', 0, 0.55, false)); // Expected: 2
  console.log("Grade XXX, ratio 0.4 =>", calcSleeperMultiplier('XXX', 0, 0.4, false)); // Expected: 1
}

/**
 * 💾 儲存並更新業績與成本/同行價數值回試算表
 */
function saveSalesBonusRow(rowIdx, productCode, qty, unitPrice, cost, peerPrice) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
    
    // 1. 更新經銷銷售報表 (行號與數量單價金額)
    if (rowIdx && rowIdx > 1) {
      const salesSheet = ss.getSheetByName(SALES_CONFIG.SHEET_SALES);
      if (salesSheet) {
        const sh = salesSheet.getRange(1, 1, 1, salesSheet.getLastColumn()).getValues()[0];
        const idxQty = findHeaderIndex(sh, ["數量", "片數"]);
        const idxAmt = findHeaderIndex(sh, ["金額", "銷額", "銷售金額", "成交金額", "小計", "總計", "未稅金額"]);
        const idxPrice = findHeaderIndex(sh, ["單價", "成交單價"]);
        
        if (idxQty !== -1) {
          salesSheet.getRange(rowIdx, idxQty + 1).setValue(qty);
        }
        if (idxPrice !== -1) {
          salesSheet.getRange(rowIdx, idxPrice + 1).setValue(unitPrice);
        }
        if (idxAmt !== -1) {
          const rawAmt = qty * unitPrice;
          salesSheet.getRange(rowIdx, idxAmt + 1).setValue(rawAmt);
        }
      }
    }
    
    const sku = String(productCode || "").toUpperCase().replace(/[\s\-]/g, '');
    
    // 2. 更新編號價目表與睡美人工作表成本
    if (sku && cost !== undefined && cost !== null) {
      const priceSheet = ss.getSheetByName("編號價目表");
      if (priceSheet) {
        const rows = priceSheet.getDataRange().getValues();
        if (rows.length > 1) {
          const h = rows[0];
          const idxSku = findHeaderIndex(h, ["編號", "產品編號"]);
          const idxCost = findHeaderIndex(h, ["成本", "單片成本", "成本價"]);
          if (idxSku !== -1 && idxCost !== -1) {
            for (let i = 1; i < rows.length; i++) {
              const rsku = String(rows[i][idxSku] || "").toUpperCase().replace(/[\s\-]/g, '');
              if (rsku === sku) {
                priceSheet.getRange(i + 1, idxCost + 1).setValue(cost);
                break;
              }
            }
          }
        }
      }
      
      const sleeperSheet = ss.getSheetByName("睡美人");
      if (sleeperSheet) {
        const rows = sleeperSheet.getDataRange().getValues();
        if (rows.length > 1) {
          const h = rows[0];
          const idxSku = findHeaderIndex(h, ["編號", "產品編號", "品號"]);
          const idxCost = findHeaderIndex(h, ["成本", "單片成本", "成本價"]);
          if (idxSku !== -1 && idxCost !== -1) {
            for (let i = 1; i < rows.length; i++) {
              const rsku = String(rows[i][idxSku] || "").toUpperCase().replace(/[\s\-]/g, '');
              if (rsku === sku) {
                sleeperSheet.getRange(i + 1, idxCost + 1).setValue(cost);
                break;
              }
            }
          }
        }
      }
    }
    
    // 3. 更新同行價 (編號價目表)
    if (sku && peerPrice !== undefined && peerPrice !== null) {
      const priceSheet = ss.getSheetByName("編號價目表");
      if (priceSheet) {
        const rows = priceSheet.getDataRange().getValues();
        if (rows.length > 1) {
          const h = rows[0];
          const idxSku = findHeaderIndex(h, ["編號", "產品編號"]);
          const idxPeer = findHeaderIndex(h, ["同行價", "同行"]);
          if (idxSku !== -1 && idxPeer !== -1) {
            for (let i = 1; i < rows.length; i++) {
              const rsku = String(rows[i][idxSku] || "").toUpperCase().replace(/[\s\-]/g, '');
              if (rsku === sku) {
                priceSheet.getRange(i + 1, idxPeer + 1).setValue(peerPrice);
                break;
              }
            }
          }
        }
      }
    }
    
    // 清除大緩存
    CacheManager.removeLarge("sales_overview_v3.3_monthly");
    _sleeperConfigMapCache = null;
    
    return { success: true };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

function recalcAwardsBySettleAmount(salesName, monthIdx, settleAmount) {
  const rule = SALES_CONFIG.BONUS_RULES[salesName];
  const result = {
    baseBonus: 0,
    breakthroughBonus: 0,
    totalBonus: 0,
    staffShare: 0,
    netPayout: 0
  };

  if (!rule || rule.enabled === false) return result;

  const monthlySales = Math.round(settleAmount);

  // 計算達成獎金
  if (monthlySales >= rule.minThreshold) {
    const exceed = monthlySales - rule.stepBase;
    if (exceed > 0) {
      result.baseBonus = Math.floor(exceed / rule.stepValue) * rule.stepBonus;
    }
  }

  // 計算突破獎金
  let maxBreakthrough = 0;
  if (rule.breakthroughs && rule.breakthroughs.length > 0) {
    rule.breakthroughs.forEach(b => {
      if (monthlySales >= b.limit) {
        if (b.bonus > maxBreakthrough) {
          maxBreakthrough = b.bonus;
        }
      }
    });
  }
  result.breakthroughBonus = maxBreakthrough;

  // 分拆內勤與實領
  result.totalBonus = result.baseBonus + result.breakthroughBonus;
  result.staffShare = Math.round(result.totalBonus * SALES_CONFIG.STAFF_SHARE_RATE);
  result.netPayout = result.totalBonus - result.staffShare;

  return result;
}
