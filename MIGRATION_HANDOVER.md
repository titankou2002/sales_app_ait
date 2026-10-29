# 內部版（高雅瓷）↔ 外部版（安喜）全面整併交接明細與避坑指南

> **檔案用途**：作為未來將內部版（GAS 版面記錄神器）完整遷入外部版（React + Supabase + Cloudflare，`ait-layout`），或在外部版進行功能對齊與重構時的**核心交接手冊與業務邏輯規則寶典**。

---

## 壹、核心專案環境與資料來源對照表

| 項目 | 內部版（高雅瓷） | 外部版（安喜共用） | 磁磚百科（圖庫中心） |
|---|---|---|---|
| **專案路徑** | `/Users/titankou2002/.../版面記錄神器` | `/Users/titankou2002/Projects/ait-layout` | `/Users/titankou2002/.../磁磚百科` |
| **運行架構** | Google Apps Script (GAS) + Sheets | React 18 + TS + Vite + Supabase | Cloudflare Pages + R2 + Supabase |
| **生產網址** | GAS Web App（版本 @659） | `https://bigt.cc/layout/` | `https://bigt.cc/web/search/` |
| **多租戶 ID** | 單一（高雅瓷專用） | `tenant_id`: `antiga`（安帝嘉）、`siena`（喜悅納），**預留 `gaoya`（高雅瓷）** | 共用全球圖庫與向量庫 |
| **圖庫儲存** | Google Drive（舊）+ R2（新） | **Cloudflare R2** (`pub-98cd476501d5474480c785e41e1eec1d.r2.dev`) | Cloudflare R2 |

### 關鍵試算表 ID 清單
1. **高雅瓷主表**（白名單／系統核心）：`1VzCscugffW4QvOxk45qPRs4hFpHQ3_qP41tB35g1qD8`
2. **高雅瓷編號價目表**（主檔／尺寸／片坪／圖片）：`1G5q-GixMWSdJJeF8ZiXWMOfrx4FMobER25jNc8m4Zds`
3. **安帝嘉編號價目表**：`16QNID9hLs2K1iy_ePo7MxYxhW4kpDrDlfEIZ2p83ixo`
4. **喜悅納編號價目表**：`1uFKKWBfulg-GmCbJsSomimT5LW5r0N2w28rubrPveTA`
5. **在途貨櫃表**（國貿小姐「到貨明細(唯讀)」）：`13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY`
6. **智慧物流系統表**（業務配送清單）：`1l-d2Nqm4QGgLqC1Vj0Fj_61pI4oF0i90gA4t6k1M7Zg`（以物流配置為準）
7. **業務庫**（工作日誌／客戶備註／版面詢問）：`CONFIG.SS_ID_BUSINESS`（分頁：`版面詢問紀錄`、`工作日誌`）

---

## 貳、各模組核心業務邏輯交接

---

### 1. 📊 客戶分析（Customer Analysis & Sleeper War Room Integration）

客戶分析是全系統最深、規則最複雜、資料整合跨度最大的核心模組。

#### 1.1 資料架構與權威單一來源（Single Source of Truth）
* **設計原則**：**前端與手機端不做任何銷售數字與毛利重複計算**。
* **權威來源**：睡美人戰情室 API（`https://bigt.cc/sleeping-beauty/api.php`），公司參數為 `company=elitile`（安喜則為 `antiga` / `siena`）。
* **身分驗證**：透過 HTTP Header `X-App-Token` 帶入 Script Property `WARROOM_APP_READ_TOKEN`，不經 URL 參數，避免 Access Log 洩漏。
* **唯讀 Actions 清單**：
  1. `customer-analysis`：全客戶總表（含業績、去年同期、YoY、健康度、最後下單），快取 30 分鐘（TTL 1800s）。
  2. `customer-timeline`：時間軸明細（銷售／拜訪／備註歷史）。
  3. `customer-warroom`：版面戰情室（各版面有銷售 vs 掛零統計）。
  4. `customer-sales-breakdown`：品項銷售分析（含 `skus`、`totals`、`years`、`monthly`）。
  5. `customer-detail`：逐筆交易明細（供常銷商品下探案件出貨明細）。

#### 1.2 客戶名稱 5 層正規化演算法（極度重要）
手機端業務分區名稱五花八門（如「東春建材行」「專岩磁磚有限公司」），戰情室則是以「經銷銷售報表」為底並進行 4 字權威正規化（如「滿財」「專岩」）。兩端比對必須執行以下演算法（逐行移植自 `CustomerAnalysis.js:81-158`）：

```javascript
// Step 1: PHP 語意 ASCII Trim（絕不可用 JS \s，會誤殺中文全形空格 U+3000）
function caPhpTrim_(s) {
  return s.replace(/^[ \t\n\r\0\x0B]+/, '').replace(/[ \t\n\r\0\x0B]+$/, '');
}

// Step 2: 剝除符號
function caNormalizeCustomerName_(name) {
  return caPhpTrim_(String(name == null ? '' : name))
    .replace(/[()（）【】\[\]「」『』,，.。\/／:： \t\n\r\f\v]+/g, '');
}

// Step 3: 權威對位與前 4 字提取
function caDisplayCustomerName_(name) {
  let s = caNormalizeCustomerName_(name);
  if (s === '') return '未知客戶';

  // 1. 固定合併字典（長名優先匹配）
  if (s.indexOf('德思特尼') !== -1 || s.indexOf('德思') !== -1) return '德思特尼';
  if (s.indexOf('漢樺') !== -1 || s.indexOf('波爾泰') !== -1) return '漢樺';
  if (s.indexOf('大永') !== -1 || s.indexOf('新大永') !== -1) return '大永';
  if (s.indexOf('伊特') !== -1 || s.indexOf('喬弈') !== -1 || s.indexOf('喬翌') !== -1) return '伊特';
  if (s.indexOf('鏷城') !== -1 || s.indexOf('璞城') !== -1) return '鏷城';
  if (s.indexOf('鼎康') !== -1 || s.indexOf('鼎晨') !== -1) return '鼎晨';
  if (s.indexOf('今冠') !== -1 || s.indexOf('金冠') !== -1) return '金冠';
  if (s.indexOf('東春') !== -1 || s.indexOf('滿財') !== -1) return '滿財';
  if (s.indexOf('傅邦') !== -1 || s.indexOf('盛邦') !== -1) return '傅邦';
  if (s.indexOf('錦義') !== -1 || s.indexOf('睿敏') !== -1) return '錦義';
  if (s.indexOf('高頓') !== -1 || s.indexOf('馬來高') !== -1) return '馬來高';
  if (s.indexOf('太爾') !== -1) return '信義星';
  if (s.indexOf('琮達') !== -1) return '琮威';

  // 2. 前綴例外字
  const prefix2 = s.substring(0, 2);
  if (prefix2 === '專岩') return '專岩';
  if (prefix2 === '禾昇') return '禾昇';

  // 3. 連字號截斷
  s = s.split(/[-－—]/)[0] || s;

  // 4. 例外保護詞清單
  const CA_CUST_EXCEPTIONS = [
    '夏綠蒂', '德思特尼', '百事得', '百達富麗', '鑫東聖', '海格斯',
    '信義星', '好仕齊', '新睦豐', '富利鴻', '金豪益'
  ];
  for (let i = 0; i < CA_CUST_EXCEPTIONS.length; i++) {
    if (s.indexOf(CA_CUST_EXCEPTIONS[i]) !== -1) return CA_CUST_EXCEPTIONS[i];
  }

  // 5. 迴圈剝除公司後綴至穩定
  const CA_CUST_SUFFIXES = [
    '企業股份有限公司', '開發有限公司', '股份有限公司', '有限公司',
    '企業', '建材', '國際', '磁磚', '磁藝', '工程', '設計部', '出貨',
    '保留收訂', '公司', '實業', '精品', '工作室', '開發', '室內裝修',
    '室內設計', '設計', '行銷', '商行', '建業', '綜合'
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < CA_CUST_SUFFIXES.length; i++) {
      const pos = s.indexOf(CA_CUST_SUFFIXES[i]);
      if (pos > 0) {
        s = s.substring(0, pos);
        changed = true;
        break;
      }
    }
  }

  // 6. 最終取前 4 字
  return s.substring(0, 4);
}
```

* **⚠️ 比對避坑警告**：戰情室回傳的客戶清單中，有部分 `name` 是數字型別（因試算表週期日期如 `1226`、`1219` 被誤當客戶讀入）。比對時**必須強制轉型為字串**：`String(list[i].name) === key`，否則嚴格比對 `===` 會因型別不同而全部判定為未成交！

#### 1.3 客戶健康度 8 級分級與呼吸閃爍規則
系統依戰情室基本健康度與 YoY 表現，將客戶細分為 8 個狀態等級（`caTierOf`）：

| 狀態 Key | 標籤名稱 | 判定條件 | 代表色 | 動畫特效 |
|---|---|---|---|---|
| `critical` | **嚴重衰退** | $\text{YoY} \le -50\%$ | `#a855f7`（紫色） | **呼吸閃爍 (`blink: true`)** |
| `mid` | **中等退步** | $-50\% < \text{YoY} \le -30\%$ | `#f87171`（淡紅） | 無 |
| `slip` | **退步** | $-30\% < \text{YoY} < -10\%$ | `#f5a623`（橘黃） | 無 |
| `normal` | **正常** | $-10\% \le \text{YoY} < +10\%$ 或 YoY 為空 | `rgba(255,255,255,0.45)` | 無 |
| `growth` | **成長** | $+10\% \le \text{YoY} < +50\%$ | `#22c55e`（綠色） | 無 |
| `surge` | **大幅成長** | $\text{YoY} \ge +50\%$ | `#facc15`（金黃） | 無 |
| `dormant` | **沉睡** | `health === 'dormant' || 'no_sales'` | `#94a3b8`（灰色） | 無 |
| `unknown` | **無資料** | 查無戰情室紀錄 | `rgba(255,255,255,0.25)` | 無 |

* **⚠️ YoY 配色慣例**：**嚴格遵守台股慣例：成長為紅（`▲+X%`，`#ef4444`）、衰退為綠（`▼-X%`，`#22c55e`）**。嚴禁改為西方慣例！
* **篩選標籤防消失設計**：
  - 分級標籤（特、A、B、C）筆數計算**必須採用全量清單**。若用已過濾清單計算，關掉 C 級後 C 級標籤筆數變 0 導致標籤自 DOM 消失，業務無法再點開。
  - 狀態標籤筆數計算必須採用「已套分級、未套狀態」的清單。

#### 1.4 經銷銷售報表「真樣品 vs 店內陳列」智能分流算法
戰情室分析預設將樣品列（`isSampleRow`）剔除於業績之外。但業務必須掌握客戶是否拿過樣品評估。此模組直接掃描「經銷銷售報表」：
1. **樣品列判定**：
   - 客戶代碼以 `-S` 或 `-S\d*` 結尾（如 `A135-S`、`A147-S1`、`C012-S1`）。
   - 客戶名稱以 `-\s*(計價)?樣品\s*$` 結尾（如 `顧信企業有限公司-樣品`）。
   - *（注意：代碼或名稱標記在「客戶」欄位上，不是產品編號 SKU）*。
2. **真樣品（Sample）vs 店內陳列（Display）分類規則**（`caClassifySample_`）：
   - 備註出現「扣」（扣帶）$\implies$ **店內陳列（display）**。
   - 尺寸換算面積（`caSizeArea_`）：大尺寸門檻設為 $6000\text{ cm}^2$（$60\times 120=7164$、$80\times 80=6400$ 屬於大尺寸；$60\times 60=3600$ 屬於小尺寸）。
   - 大尺寸且片數 $> 1$ 片 $\implies$ **店內陳列（display）**。
   - 中小尺寸且片數 $> 6$ 片 $\implies$ **店內陳列（display）**。
   - 其餘（大尺寸 1 片、小磚 1~6 片且無扣帶備註）$\implies$ **真樣品（sample）**。
   *目的：避免門市上架展示磚被誤判為「客戶拿了樣品卻不下單」*。

#### 1.5 拿樣成交中位數與逾期成交追蹤演算法
* **拿樣轉換天數（Gap）**：
  $$\text{Gap} = \text{首次成交日期}(\text{firstSale}) - \text{首次拿樣日期}(\text{firstSampleDate})$$
* **有效樣本過濾**：排除 $\text{Gap} < 0$ 或 $\text{Gap} \ge 1095$ 天（超過 3 年無關聯）。
* **中位數指標**：若有效成交樣本 $\ge 3$ 筆，計算成交天數中位數（`median`，例如 45 天）。
* **逾期未成交預警**：若某品項「已拿樣、歷年銷額為 0、且自拿樣日至今超過中位數天數」，列入「拿樣逾期未成交（Overdue）」優先追蹤清單，精確提示業務該追哪幾款磚。

#### 1.6 常銷商品前 10 名與逐筆交易案件下探
* **常銷商品**：支援 4 個統計區間（當月 `month` / 當季 `quarter` / 近半年 `half` / 前年全年 `prevYear`），列出前 10 大 SKU、縮圖、系列、銷售額與佔比。
* **案件出貨歸納算法（`caCaseKey`）**：
  出貨備註常有「`寧波東街22之1號`」、「`寧波東街22之1號-補`」、「`寧波東街22之1號-工`」、「`寧波東街22-1號工破損`」。
  - 全形數字轉半形、全形空格去除、`之` 轉 `-`。
  - 剝除前綴：`^(工地|案名|案件|地址|工程)[:：]?`。
  - 反覆剝除結尾標籤：`[-－]?(工補|補工|工破損|破損|補貨|補|工)$`。
  - 將補貨、破損、加工廠出貨自動聚合至同一個工程案件下，呈現總筆數、時間跨度與總金額。
* **案件出貨標記（`caCaseTag`）**：自動標記紅色「破損」、紫色「工補」、橘色「補貨」、藍色「加工」。

#### 1.7 💤 遺忘產品分析矩陣（Forgotten SKUs）
* **判定標準**：
  1. 近兩年（今年或去年）曾有成交紀錄：$(\text{amount}_{\text{今年}} + \text{amount}_{\text{去年}}) > 0$。
  2. 近半年完全掛零：$\text{amount}_{\text{近半年}} == 0$。
  3. 排除睡美人（`isSleeper`）與不續辦/停產品項（`isDiscontinued`）。
* **停售天數色帶（Days Band）**：
  - $120 \sim 200$ 天：橘黃色 `#f5a623`（警惕）
  - $200 \sim 300$ 天：紅色 `#ef4444`（危險）
  - $300$ 天以上：紫色 `#a855f7`（嚴重遺忘）

#### 1.8 📌 該上版產品推薦矩陣（Should Display SKUs）
* **判定標準**：
  1. 近半年還在熱賣：$\text{amount}_{\text{近半年}} > 0$。
  2. **目前沒有掛在該客戶任何一面實體陳列牆上**。
  3. 排除睡美人與停產品項。
* **業務價值**：這是立竿見影的店面擴大陳列上架機會。比起推銷全新未知的磁磚，建議客戶陳列「他自己最近一直在賣但沒擺樣」的品項，成功率高達 80% 以上。

#### 1.9 版面陳列牆效益與版面詢問日誌
* **資料同源**：直接調用 `getCustomerDisplays`，確保分析頁的版面照片與「版面記錄→陳列牆」100% 相同。
* **銷售貫穿分析**：統計該客戶名下總版面數，細分「近一年有銷售版面（依金額排序）」與「近一年完全掛零版面（標示掛零天數）」。
* **版面詢問紀錄（`addDisplayNote`）**：
  儲存於業務庫試算表（`CONFIG.SS_ID_BUSINESS`）的「版面詢問紀錄」分頁（欄位：`建立時間`、`客戶名稱`、`版面連結`、`系列`、`業務姓名`、`詢問內容`）。業務在任一版面卡片點擊即可填寫最新洽談紀錄，雙向同步至詳情彈窗。

#### 1.10 資安隔離（Client-View Security）
* **內部敏感數據保護**：當 URL 帶有 `?view=client` 或 `state.isClientView === true` 時，**客戶分析分頁完全不載入（強制清空）**。
* **嚴禁外洩欄位**：平均毛利率（`avgMarginPct`）、低毛利案件明細（`lowMarginDeals`）、合約餘額與議價底牌。

---

### 2. 版面記錄（Layout & Display Wall）
* **雙照片雙版面規則**：當單一版面記錄包含第二張照片時，後台必須拆存為 **2 個獨立版面**（品項各複製一份），在陳列牆上呈現獨立卡片。
* **GPS 店面定位**：首次定位時寫入客戶座標；同客戶連續加入清單時**沿用首次定位**，不重複呼叫 GPS。
* **照片上傳前處理**：手機端必須先在前端 Canvas 等比縮圖至長邊 **1600px JPEG**，嚴禁原圖直傳導致記憶體爆滿或網路超時。
* **下架與歷史**：下架不是刪除，而是標記 `removed_at`。陳列牆預設只顯示未下架版面；歷史動態彈窗輪播近 7 天異動。

---

### 3. 庫存查詢（Inventory & Stock）
* **標準單位換算鏈**（全集團統一，不可更改）：
  $$\text{坪數} = \text{數量}(\text{m}^2) \times 0.3025 \quad (\text{無條件捨去整數})$$
  $$\text{片數} = \text{坪數} \times \text{每坪片數}(\text{編號價目表})$$
  $$\text{箱數} = \text{片數} \div \text{每箱片數}$$
  $$\text{棧板數} = \lceil \text{箱數} \div \text{每棧板箱數} \rceil \quad (\text{無條件進位整數})$$
* **暫記後綴正規化（必做）**：
  保留單與庫存表中常有 `RS61280-掛`、`RS61280-期` 等暫記品號，查編號價目表或主檔前**必須先正規化去掉後綴**：`sku.replace(/[-\s]*(掛|期)\s*$/, '').trim().toUpperCase()`，否則主檔完全對不到（導致 NO IMG、尺寸系列全空）。
* **千分位字串容錯**：所有數量、片數、坪數字串解析前，必須先 `.replace(/,/g, '')` 再 `parseFloat`，防範 `"1,500"` 被誤截為 `1`。
* **可用庫存**：$$\text{可用庫存} = \text{現有庫存} - \text{有效保留量}$$。點擊可用量可穿透檢視所有保留單細節（保留人、工地、到期日）。

---

### 4. 保留日誌 ＆ 戰情室（Reserve & War Room）
* **去峰值月均銷算法（Shaved Monthly Average）**：
  計算過去 12 個月銷售時，必須**剔除單月最大峰值（重大專案單月爆量）**，以避免安全水位與補貨建議被單一特例嚴重扭曲。
* **安全水位（Safe Stock）與補貨建議（Suggest Ping）**：
  $$\text{安全水位} = \text{去峰值月均銷} \times 1.5 \text{ 個月}$$
  $$\text{目標備貨} = \text{去峰值月均銷} \times 3.0 \text{ 個月}$$
  $$\text{補貨建議量} = \max(0, \text{目標備貨} - \text{可用庫存} - \text{在途貨櫃量})$$
* **缺貨分級算法（`classifyShortageLevel_`）**：
  - **一級缺貨（紅色）**：可用量 $\le 0$，且無在途貨櫃。
  - **二級缺貨（橘色）**：可用量 $\le 0$，但在途貨櫃已出港（有在途量）。
  - **三級缺貨（黃色）**：可用量 $> 0$，但低於安全水位（1.5 個月月均銷）。
* **入庫時間預估**：
  貨櫃到港日（ETA）加上 **10 個工作日**（跳過星期六、日）作為常規入庫日。
* **帳齡預警與 Telegram 單鍵續約**：
  超過 30 天未出貨之保留單，排程推播至業務 Telegram，通知訊息必須帶單次使用的 Token 快速連結（一鍵展期 14 天或取消保留），且 Telegram 發送端必須開啟 `disable_web_page_preview: true`，防止機器人抓取預覽提前失效 Token。

---

### 5. 常用工具 ＆ 到貨明細（Tools & Incoming Cargo）
* **到貨明細主快取共用機制**：
  國貿「到貨明細(唯讀)」分頁包含全集團貨櫃。後端只掃描解析一次寫入共用主快取（1 小時），各分公司查詢僅在記憶體中過濾分公司標籤，嚴禁分公司各自冷啟動重複掃表。
* **前端 0 延遲切換**：
  客戶端快取各分公司結果（`cargoBranchCache`），分頁切換時 0ms 秒開，僅手動 `⟳` 才向伺服器拉取新資料。

---

### 6. 業務配送（Delivery）
* **單據類型判斷優先級**：
  備註或客戶名稱包含 `門市|入店` $\implies$ **入店**；包含 `樣品` $\implies$ **樣品**；包含 `退貨` $\implies$ **退貨**；其餘皆為 **送貨**。
* **回報聯動外勤日誌**：業務完成配送拍照回報時，後端自動在「工作日誌」寫入一筆完成紀錄，確保主管在全知視角直接看到。
* **雙向 Sheet 同步（`syncDeliveryToSheet`）**：App 上回報送達時，即時透過 Google Sheets API 回寫物流試算表狀態，避免小姐在物流辦公室產生資訊落差。

---

### 7. 上架追蹤（Shelf Tracking）
* **新品推廣漏斗**：總覽全部新品在各業務轄下客戶的陳列率。
* **缺貨品項即時警示**：上架追蹤表同步對齊庫存可用量，品項缺貨時以紅標警示業務暫緩推樣。

---

## 參、整併至外部版時最容易出錯的「10 大地雷」

### ⚠️ 地雷 1：Google Drive 縮圖 403 權限崩潰（最大外顯 Bug）
* **成因**：試算表中原填寫的 Google Drive 連結，若分享權限不是「公開」，外部瀏覽器存取縮圖時會回傳 403 Forbidden。舊程式碼若在 `onerror` 寫 `display: none`，會露出深黑底色，形成難看的「空黑洞」。
* **解法**：
  1. 外部版主檔匯入時，最優先匹配 `R2_` 開頭欄位（直接吃 Cloudflare R2 全球 CDN：`pub-98cd476501d5474480c785e41e1eec1d.r2.dev`）。
  2. 若無圖或破圖，觸發 `isR2Url` / `tileFallbackUrl` 智慧備援，並切換至全寬無圖自適應版面，杜絕黑塊。

### ⚠️ 地雷 2：試算表表頭別名五花八門（對齊失敗）
* **成因**：高雅瓷叫「單片連結網址」，安帝嘉叫「雲端圖片」，喜悅納叫「雲端圖片連結」，甚至還有「單片照片」、「圖片連結」。
* **解法**：`fields.ts` 中的別名清單必須保持寬容，並把精確的 `R2_單片1`、`R2_主圖URL` 排在最前。

### ⚠️ 地雷 3：千分位逗號導致數字被截斷（隱蔽數值災難）
* **成因**：試算表儲存格若被設為貨幣或千分位格式，讀出字串為 `"1,200"`。JavaScript `parseFloat("1,200")` 的結果是 **`1`**（逗號後全部被丟棄）！
* **解法**：全系統所有數字轉換必須強制：`parseFloat(String(val || 0).replace(/,/g, ''))`。

### ⚠️ 地雷 4：在途貨櫃與主檔查詢的 RPC 爆炸（速度慢的主因）
* **成因**：在遍歷 150 筆貨櫃品項的迴圈中，如果每筆都呼叫一次 Supabase 或 CacheManager 查產品主檔，會產生數百次網路連線，造成頁面轉圈 20 秒以上。
* **解法**：在函數開頭**一次性將主檔預載為記憶體字典（Map）**，迴圈內僅做 `map[sku]` 記憶體查詢（0.1ms）。

### ⚠️ 地雷 5：多租戶（Tenant）白名單業務混淆
* **成因**：高雅瓷、安帝嘉、喜悅納各有一份業務白名單，且包含已離職人員。若直接拿銷售報表的所有姓名當業務篩選，會出現離職同仁或打錯的錯字。
* **解法**：外部版必須讀取各租戶的 `whitelist_sales`，嚴格過濾只有在職同仁能成為篩選標籤。

### ⚠️ 地雷 6：ETA 日期字串排序錯亂
* **成因**：日期若先被格式化成中文「8月19日(週三)」，拿中文進行文字排序會導致「10月」排在「8月」前面。
* **解法**：原始資料解析時立即保留 `etaTs`（毫秒時間戳），排序一律以數值 `etaTs` 比對，顯示時才轉中文。

### ⚠️ 地雷 7：多並行上傳造成資料庫列錯位（Race Condition）
* **成因**：業務一口氣上傳多張照片與版面，若未加鎖，多個請求同時寫入試算表最後一列時會互相覆蓋。
* **解法**：內部版已用 `LockService.getScriptLock()`；外部版遷入 Supabase 時必須利用 PostgreSQL 的交易（Transaction）或 Row Level Lock，確保品項與主表外鍵關聯完整。

### ⚠️ 地雷 8：睡美人與停產標籤判定不一致
* **成因**：停產與睡美人定義容易混淆。停產是指「工廠不再生產、清完為止」；睡美人是指「長期庫存高於安全水位且週轉極低」。
* **解法**：停產看主檔的停產標記；睡美人嚴格看戰情室月均銷與庫存天數比值。

### ⚠️ 地雷 9：業務配送與智慧物流表雙向同步中斷
* **成因**：外部版如果直接改了派單狀態，但沒有回寫物流 Google Sheet，小姐在物流辦公室看表會以為還沒送達。
* **解法**：必須保留 `syncDeliveryToSheet` 橋接器，業務端 App 回報時即時透過 Google API 更新物流表狀態。

### ⚠️ 地雷 10：高雅瓷專屬商業規則（不要錯套到安喜）
* **特別注意**：
  - 睡美人業績加成、金友利折算、漢樺/波爾泰 1/3 分攤是**高雅瓷特有規則**。
  - 安帝嘉與喜悅納不需要套用這些折半或提成計算，外部版實作時必須以 `tenant.slug === 'gaoya'` 作為開關保護。

---

## 肆、外部版（ait-layout）整合施工清單

當您在 `/Users/titankou2002/Projects/ait-layout` 開啟新對話時，直接執行以下任務清單：

- [ ] **Task 1: 主頁新增「常用工具」選單（ToolsMenu）**
  - 參照內部版 `script.html:4361`，在 `HomePage.tsx` 新增第 10 格常用工具。
  - 納入「到貨明細」頁面（移植 `IncomingCargo.js` 的換算與主快取邏輯）。
  - 納入磁磚百科與請款神器連結。
- [ ] **Task 2: 實作「客戶分析（CustomerAnalysis）」**
  - 在 `src/pages/` 新增 `CustomerAnalysisPage.tsx`，打通 `features.ts: customer_analysis`（改為 `ready: true`）。
  - 對接戰情室 API（`https://bigt.cc/sleeping-beauty/api.php`）或 Supabase 歷史銷貨視圖。
  - 實作客戶名稱 5 層正規化（`caDisplayCustomerName_`）。
  - 實作 8 級健康度分級與呼吸閃爍效果（`blink: true`）。
  - 實作真樣品 vs 陳列分流、拿樣成交中位數與逾期成交預警。
  - 實作常銷商品前 10 名（出貨案件歸納）與遺忘產品三色帶矩陣。
  - 實作「該上版」拓銷推薦矩陣。
- [ ] **Task 3: 升級庫存查詢穿透功能**
  - 在 `InventoryPage.tsx` 增加跨分公司庫存檢視按鈕（查看安帝嘉/喜悅納/高雅瓷）。
  - 點擊可用量彈出保留單明細（被誰保留、哪個工地、到期日）。
- [ ] **Task 4: 開通高雅瓷租戶（Tenant: `gaoya`）**
  - 在 Supabase `tenants` 資料表新增高雅瓷設定。
  - 將高雅瓷編號價目表（`1G5q-...`）匯入 Supabase 商品主檔，圖片全面導向 Cloudflare R2。
