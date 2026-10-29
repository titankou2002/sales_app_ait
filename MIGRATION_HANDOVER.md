# 內部版（GAS）全功能代碼級遷移規格手冊（非 GAS / Cloudflare / Supabase 實作指南）

> **文件定位**：本手冊為本專案（Google Apps Script 內部版）所有現有程式碼功能轉移至**非 GAS 環境（Cloudflare Workers / Pages、Supabase Edge Functions、Node.js / TypeScript）**的完整程式碼層級交接規格書。
> **核心原則**：**完全以現有程式碼（Code-Level）為準**，不含任何未發生的臆測。逐一詳列：檔案來源、函式名稱、輸入參數、讀寫試算表與分頁、欄位對位別名、核心計算邏輯、回傳資料結構與寫回規則。

---

## 壹、全系統試算表架構與自體建表規格

### 1. 核心試算表配置表

| 常數代號 | 試算表 ID | 內部工作表（Tabs） | 用途說明 |
|---|---|---|---|
| `CONFIG.SS_ID_MAIN` | `1VzCscugffW4QvOxk45qPRs4hFpHQ3_qP41tB35g1qD8` | `經銷銷售報表`<br>`編號價目表`<br>`庫存表`<br>`缺貨進榜追蹤`<br>`白名單` | 核心庫存、主產品檔、銷售歷史與缺貨記錄 |
| `CONFIG.SS_ID_BUSINESS` | `1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0` | `版面上架清單`<br>`業務分區`<br>`版面詢問紀錄`<br>`LOG` | 門市陳列記錄、客戶負責業務、店面座標、業務筆記、客戶查詢日誌 |
| `LOGISTICS_SS_ID` | `1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA` | `業務配送清單`<br>`撿貨明細`<br>`系統白名單` | 智慧物流系統派單、撿貨子表、全公司人員白名單 |
| `RESERVE_SS_ID` | `CONFIG.RESERVE_SS_ID` 或 `SS_ID_MAIN` | `保留單`<br>`庫存每日快照`<br>`庫存快照_最新`<br>`TG_DEBUG` | 業務保留單主表、每日快照、除錯日誌 |
| `INCOMING_CARGO_SS_ID` | `13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY` | `到貨明細(唯讀)` | 國貿在途貨櫃與入庫預告 |
| `FW_CONFIG.SS_ID` | `CONFIG.SS_ID` | `智能_工作日誌`<br>`智能_行駛日誌`<br>`智能_保養紀錄`<br>`智能_打卡紀錄`<br>`外勤_請假報備` | 外勤日誌、里程、車輛保養、考勤與請假 |
| `ATT_SHEET_ID` | `1Hcj7dSOc0KoRhEeGGKsxPazTKb4CUWEN7h2tqFkUfw0` | `員工資料`<br>`打卡紀錄`<br>`請假紀錄`<br>`系統設定`<br>`年度特休額度` | 出缺勤、LINE 打卡、薪資計算、請假審核 |
| `AIT_AUDIT_SS_ID` | `1N-tOQEP26akmcGRV34OwDusg0yFrtKfnJ79W3O-uNLM` | `鈦傳速_操作記錄` | 與物流系統共用之審計操作記錄 |

---

### 2. 分頁不存在時的自體建表規格（Self-Healing Schema）

在非 GAS 環境中，若背景排程或 API 寫入 Google Sheets 時發現目標工作表不存在，必須自動建立該分頁並注入預設表頭：

1. **`智能_工作日誌`**：
   - 表頭：`["日期", "業務姓名", "客戶名稱", "任務摘要", "詳細內容", "GPS資訊", "建立時間", "記錄ID", "線上圖片"]`
2. **`智能_行駛日誌`**：
   - 表頭：`["日期", "業務姓名", "車牌號碼", "開始里程", "結束里程", "行駛距離", "今日行程", "加油公升", "加油金額", "備註", "記錄ID"]`
3. **`智能_保養紀錄`**：
   - 表頭：`["保養日期", "業務姓名", "車牌號碼", "本次里程", "下次保養里程", "保養項目", "保養金額", "照片", "備註", "記錄ID"]`
4. **`智能_打卡紀錄`**：
   - 表頭：`["打卡時間", "員工姓名", "打卡類型", "GPS資訊", "打卡地址", "打卡狀態", "記錄ID"]`
5. **`外勤_請假報備`**：
   - 表頭：`["申請時間", "員工姓名", "假別", "開始日期", "結束日期", "請假天數", "事由說明", "記錄ID"]`
6. **`版面詢問紀錄`**：
   - 表頭：`["建立時間", "客戶名稱", "版面連結", "系列", "業務姓名", "詢問內容"]`
7. **`LOG`（客戶查詢行為）**：
   - 表頭：`["操作時間", "功能代碼", "類別", "操作人", "身分等級", "詳細內容", "執行備註"]`
8. **`庫存每日快照`**：
   - 表頭：`["日期", "編號", "現貨(坪)", "保留(坪)", "可用(坪)", "在途(坪)", "保留筆數"]`
9. **`員工資料`**：
   - 表頭：`["員工ID", "姓名", "職稱", "LINE userId", "LINE綁定時間", "底薪", "投保底薪", "餐費", "電話費", "全勤獎金", "主管ID", "到職日", "狀態"]`
10. **`打卡紀錄`（Attendance）**：
    - 表頭：`["日期", "員工ID", "員工姓名", "上班時間", "下班時間", "是否遲到", "遲到分鐘", "工時", "加班工時", "打卡方式", "備註"]`
11. **`請假紀錄`（Attendance）**：
    - 表頭：`["假單ID", "申請時間", "員工ID", "員工姓名", "假別", "開始日期", "結束日期", "請假天數", "請假事由", "審核狀態", "審核人", "審核時間", "審核備註"]`

---

## 貳、全系統後端函式實作規格（逐檔詳列）

---

### 1. 版面記錄模組（`Code.js`）

#### 1.1 `getCustomerDisplays(customerName)`
* **檔案來源**：`Code.js:247`
* **輸入參數**：`customerName`（字串，例如 `"東春"`）
* **讀取目標**：`CONFIG.SS_ID_BUSINESS` $\to$ 分頁 `版面上架清單`
* **表頭別名**：
  - `cust`: `["客戶名稱", "客戶"]`
  - `series`: `["中文系列", "系列"]`
  - `sku`: `["編號", "產品編號"]`
  - `mode`: `["展示方式"]`
  - `img`: `["版面連結", "連結", "圖片", "照片"]`
  - `onDate`: `["上架日期", "日期"]`
  - `offDate`: `["下架日期"]`
  - `sales`: `["業務姓名", "業務"]`
  - `batch`: `["批號"]`
  - `note`: `["備註"]`
* **核心邏輯**：
  1. 客戶名稱透過 `mergeCustomer(raw)` 正規化比對。
  2. 若 `下架日期` 為空，放入 `active` 陣列（在架）。
  3. 若 `下架日期` 有值，放入 `history` 陣列（歷史下架）。
  4. 圖片網址轉換：Google Drive 連結透過 `extractIdFromUrl` 轉成 `https://lh3.googleusercontent.com/d/{id}=w600`。
* **回傳結構**：
  ```json
  {
    "success": true,
    "active": [{ "series": "...", "sku": "...", "img": "...", "onDate": "...", "mode": "...", "sales": "..." }],
    "history": [{ "series": "...", "sku": "...", "img": "...", "onDate": "...", "offDate": "..." }]
  }
  ```

#### 1.2 `saveNewLayout_impl_(payload)` / `addCustomerDisplays`
* **檔案來源**：`Code.js:820` / `Code.js:1560`
* **輸入參數**：
  ```json
  {
    "customerName": "東春",
    "series": "浮光",
    "photoUrl": "https://...",
    "photoUrl2": "https://...",
    "items": [{ "sku": "ED61201", "qty": 1, "size": "60x120" }],
    "salesName": "謝博皓",
    "mode": "展示架",
    "lat": 25.04,
    "lng": 121.55
  }
  ```
* **寫入目標**：`CONFIG.SS_ID_BUSINESS` $\to$ 分頁 `版面上架清單`
* **核心邏輯**：
  1. 加鎖 `LockService.getScriptLock().waitLock(20000)`。
  2. **雙照片拆存**：若有 `photoUrl2`，後端將品項拆為 2 筆獨立列寫入（第一筆帶 `photoUrl`，第二筆帶 `photoUrl2`）。
  3. **GPS 寫入**：若帶座標且該客戶在 `業務分區` 尚無座標，自動回寫 `業務分區` 之 `經度`、`緯度` 欄。

#### 1.3 `offShelfDisplayBatch_impl_(customerName, skus, salesperson, photoUrl)`
* **檔案來源**：`Code.js:1034`
* **核心邏輯**：
  遍歷 `版面上架清單`，比對 `客戶名稱`、`品號`、`版面連結`。比對成功時，將該列 `下架日期` 設為當天日期 `yyyy-MM-dd`（軟刪除），不刪除整列。

#### 1.4 `deleteDisplayBatchPermanent_impl_(customerName, skus, photoUrl)`
* **檔案來源**：`Code.js:1150`
* **核心邏輯**：
  硬刪除符合 `客戶名稱`、`品號`、`版面連結` 的列（由底層倒序執行 `deleteRow`）。

#### 1.5 `updateLayoutFieldBatch_impl_(customerName, skus, fieldName, newVal)`
* **檔案來源**：`Code.js:1230`
* **核心邏輯**：
  批次修改指定客戶、品號之特定欄位（如 `備註`、`展示方式`、`業務姓名`）。

#### 1.6 `getSeriesSkuOptions_impl_(seriesName)` 與 `getSeriesNameSuggestions_impl_(query)`
* **檔案來源**：`Code.js:1420`
* **讀取目標**：`CONFIG.SS_ID_MAIN` $\to$ `編號價目表`
* **核心邏輯**：
  反查該系列名下所有 SKU 清單，或依關鍵字推薦系列名稱，用於前端上架表單自動完成。

#### 1.7 `getLatestLayoutActivities_impl_()`
* **檔案來源**：`Code.js:2830`
* **讀取目標**：`CONFIG.SS_ID_BUSINESS` $\to$ `版面上架清單`
* **核心邏輯**：
  讀取最後 50 筆記錄，過濾出最近 10 筆異動（上架、下架），回傳主頁動態跑馬燈。

---

### 2. 庫存查詢與客戶端圖庫（`Inventory.js`、`Stock_Core.js`、`Client_Inventory.js`）

#### 2.1 `getAggregatedInventory(forceRefresh)`
* **檔案來源**：`Inventory.js:42`、`Stock_Core.js:15`
* **讀取目標**：`CONFIG.SS_ID_MAIN` $\to$ `編號價目表`、`庫存表`
* **品號正規化函式**（`Stock_Core.js:105`）：
  ```javascript
  function normalizeIncomingSkuKey_(sku) {
    return String(sku || '').toUpperCase().replace(/[-\s]*(掛|期)\s*$/, '').replace(/[\s\-]/g, '');
  }
  ```
* **4 級單位換算公式**（`Inventory.js:312`）：
  - $\text{坪數} = \lfloor \text{數量}(m^2) \times 0.3025 \rfloor$
  - $\text{片數} = \text{坪數} \times \text{每坪片數}$（價目表 `每坪片數` 欄，預設 36）
  - $\text{箱數} = \lfloor \text{片數} \div \text{每箱片數} \rfloor$
  - $\text{棧板數} = \lceil \text{箱數} \div \text{每棧板箱數} \rceil$
* **可用庫存**：$$\text{可用庫存} = \text{現有庫存量} - \text{有效保留量}$$
* **圖庫載入優先級**：
  `R2_單片1` > `R2_主圖URL` > `Cloudflare R2 CDN`（`https://pub-98cd476501d5474480c785e41e1eec1d.r2.dev/{sku}.jpg`）> `單片連結網址`（Google Drive 縮圖）。

#### 2.2 `checkClientStock(sku, requiredPyeong, userId, userName)`
* **檔案來源**：`Client_Inventory.js:20`
* **讀取目標**：`CONFIG.SS_ID_MAIN` $\to$ `庫存表`
* **核心邏輯**：
  客戶端專用，**不回傳具體數字**，僅計算 $\text{可用庫存} \ge \text{需求坪數}$，回傳「🟢 庫存數量充足」或「🟡 庫存數量不足，請聯繫業務確認到貨時間」。同時在業務表單 `LOG` 留下查詢軌跡。

#### 2.3 `logExternalClientSearch_impl_(sku, pyeong, result, userId, level, clientNamePassed, clientCompanyPassed)`
* **檔案來源**：`Client_Inventory.js:148`
* **寫入目標**：`CONFIG.SS_ID_BUSINESS` $\to$ `LOG`
* **頻率防刷限制**：
  - `VIP`：不限次數。
  - `LEVEL 1`：每小時最多 20 次。
  - 其他等級：每小時最多 10 次。超過回傳 `exceeded: true`。

#### 2.4 `getDriveImageUrl(url, formula)`
* **檔案來源**：`Client_Inventory.js:116`
* **核心邏輯**：
  解析 `=IMAGE("https://...")` 公式，或自 Google Drive 網址提取 File ID，轉換為 `https://drive.google.com/thumbnail?id={id}&sz=w1000`。

---

### 3. 業績概況與業務獎金精算（`Sales.js`、`Export_BonusExcel.js`）

#### 3.1 `getSalesOverview(forceRefresh)`
* **檔案來源**：`Sales.js:142`
* **讀取目標**：`CONFIG.SS_ID_MAIN` $\to$ `經銷銷售報表`，以及 `CONFIG.SS_ID_BUSINESS` $\to$ `業務分區`
* **業務歸屬判定邏輯**（`Sales.js:130`）：
  ```javascript
  function resolveRowOwnerStr_(ss, custRaw, rawSalesColStr) {
    const ownerMap = getCustomerOwnerMap_(ss);
    const owner = ownerMap[getCustomerShortName(custRaw)];
    return owner || rawSalesColStr;
  }
  ```
* **樣品列排除規則**（`Sales.js:329`）：
  客戶編號符合 `/-S\d*$/`，或客戶名稱含「樣品/代領」，或備註含「樣品/扣帶/代領」，整列排除不計入業績與獎金。
* **高雅瓷 5 大專屬計算規則**：
  1. **運費列**：品號含「運費」者，獨立為 `freightDeductionAmount`，不計入銷額。
  2. **漢樺/波爾泰 1/3 分攤**：客戶名稱含「漢樺」或「波爾泰」者，`weight = 1/3`，業績由謝博皓、潘右森、陳勁多 3 人均分。
  3. **金友利客戶加倍**：客戶名稱含「金友利」者，業績 $\times 2$。
  4. **低於同行價六折折半**：若 $\text{成交單價} < \text{同行價} \times 0.60$，金額以 $50\%$ 計算。
  5. **睡美人加成**：戰情室標記之睡美人品項，加計業績加成獎金。

#### 3.2 `getAdminBonusReport_impl_(year, monthIdx, forceRefresh)`
* **檔案來源**：`Sales.js:80`
* **核心邏輯**：
  後台業務獎金精算，計算每位業務的門檻獎金、級距獎金、突破獎金與睡美人獎金。

#### 3.3 `exportBonusRangeToExcel_impl_(year, startMonthIdx, endMonthIdx)`
* **檔案來源**：`Export_BonusExcel.js:83`
* **核心邏輯**：
  1. `_loadBonusContext_(year)`：銷貨表、同行價、睡美人、配送資料**只讀一次**供所有月份共用。
  2. 呼叫 `_computeAdminBonusReport` 逐月計算。
  3. 生成文字算式 `_bonusFormulaText_(p)`。
  4. 在暫存 Google 試算表中套版，透過 `export?format=xlsx` 轉為 Blob 存至 Drive `獎金報表匯出(暫存)` 資料夾，回傳下載網址，排程保留 7 天自動刪除。

---

### 4. 智能報表與外勤車輛管理（`FieldWork.js`）

#### 4.1 `saveWorkLog(entry)`
* **檔案來源**：`FieldWork.js:312`
* **寫入目標**：`FW_CONFIG.SS_ID` $\to$ `智能_工作日誌`
* **欄位結構**：
  `["日期", "業務姓名", "客戶名稱", "任務摘要", "詳細內容", "GPS資訊", "建立時間", "記錄ID", "線上圖片"]`
* **客戶名稱簡稱化**：調用 `fwShortenCustomerForSave_`，特殊值「回公司(永安)」保留原樣。

#### 4.2 `saveDrivingFuelRecord_impl_(payload)`
* **檔案來源**：`FieldWork.js:420`
* **寫入目標**：`FW_CONFIG.SS_ID` $\to$ `智能_行駛日誌`
* **欄位結構**：
  `["日期", "業務姓名", "車牌號碼", "開始里程", "結束里程", "行駛距離", "今日行程", "加油公升", "加油金額", "備註", "記錄ID"]`

#### 4.3 `saveMaintenanceRecord_impl_(payload)`
* **檔案來源**：`FieldWork.js:510`
* **寫入目標**：`FW_CONFIG.SS_ID` $\to$ `智能_保養紀錄`
* **欄位結構**：
  `["保養日期", "業務姓名", "車牌號碼", "本次里程", "下次保養里程", "保養項目", "保養金額", "照片", "備註", "記錄ID"]`

#### 4.4 `saveAttendance_impl_(payload)`
* **檔案來源**：`FieldWork.js:180`
* **寫入目標**：`FW_CONFIG.SS_ID` $\to$ `智能_打卡紀錄`
* **打卡中心點**：`lat: 25.00048642501761, lng: 121.03391437844508`，半徑 **300 公尺**。超出半徑狀態標記為「外勤打卡/異常」。

#### 4.5 `getOmniscientLogs_impl_(dateStr)`（全知視角）
* **檔案來源**：`FieldWork.js:720`
* **讀取目標**：`智能_工作日誌`、`智能_打卡紀錄`、`智能_行駛日誌`
* **核心邏輯**：
  主管專用視角，依目標日期彙總所有業務當天的打卡、日誌、軌跡與車輛里程。

#### 4.6 `getCustomerVisitRanking_impl_(employeeName)` 與 `getCustomerYoyVisitMatrix_impl_`
* **檔案來源**：`FieldWork.js:380`
* **核心邏輯**：
  分析業務在 `智能_工作日誌` 中的到訪頻率排行，以及相較於去年同期（YoY）的到訪次數增減矩陣。

---

### 5. 業務配送模組（`Code_SalesDelivery.js`）

#### 5.1 `getSalesDeliveryTasks(salesName, targetDateStr)`
* **檔案來源**：`Code_SalesDelivery.js:22`
* **讀取目標**：`LOGISTICS_SS_ID` $\to$ `業務配送清單` 與 `撿貨明細`
* **篩選規則**：`派遣司機 === salesName`，且日期符合或當日已完工單據。
* **單據類型優先序**（`Code_SalesDelivery.js:128`）：
  $$\text{門市/入店} > \text{樣品} > \text{退貨} > \text{送貨}$$

#### 5.2 `completeSalesDeliveryTask(rowIdx, imageData, reportNote, isDamaged)`
* **檔案來源**：`Code_SalesDelivery.js:331`
* **寫入目標**：`LOGISTICS_SS_ID` $\to$ `業務配送清單`
* **執行動作**：
  1. 上傳照片取得 URL。
  2. 更新 `狀態` 為 `"已完成"`、`完成時間`、`貨單縮圖`。
  3. 自動跨模組調用 `saveWorkLog`，同步在 `智能_工作日誌` 寫入完工記錄。
  4. 發送 LINE 完工通知。

#### 5.3 `transferSalesDeliveryTask(rowIdx, newSalesName)`
* **檔案來源**：`Code_SalesDelivery.js:294`
* **寫入目標**：`LOGISTICS_SS_ID` $\to$ `業務配送清單`
* **執行動作**：更新 `派遣司機` 欄位為 `newSalesName`。

---

### 6. 保留系統、缺貨進榜與戰情室（`Reserve_Main.js`、`Reserve_Service.js`、`Code_Customer.js`）

#### 6.1 `webGetData(action, payload)` 路由器（`Reserve_Main.js:205`）
* **Actions 清單**：
  - `log_open`：記錄開啟系統。
  - `auth_heartbeat`：身分心跳檢測。
  - `get_audit_logs`：查詢審計日誌。
  - `get_inventory_history`：品項庫存歷程。
  - `run_inventory_snapshot`：觸發每日快照。
  - `get_reserve_data`：完整保留單資料。
  - `update_progress`：更新保留進度。
  - `delete_product`：刪除保留單品項。
  - `get_restock_alerts`：補貨預警列表。
  - `get_shortage_board`：缺貨公佈欄。
  - `update_shortage_tracking`：修改缺貨追蹤。
  - `add_shortage_tracking`：手動新增缺貨追蹤。
  - `confirm_discontinue`：品項確認不續辦。
  - `close_shortage_product`：產品完結結案。
  - `confirm_safe_stock`：確認安全水位。
  - `generate_restock_order_list`：生成補貨清單。
  - `run_product_analysis`：執行產品分析。
  - `get_war_room_data`：戰情室主數據。
  - `getProductInsight` / `getProductInsightBatch`：品項深入洞察。
  - `get_probation_entry_dates`：新品試辦入庫日。
  - `send_war_room_email`：手動寄送戰情室週報。

#### 6.2 戰情室演算法（`Reserve_Service.js`）
* **去峰值月均銷（Shaved Monthly Average）**：計算過去 12 個月出貨，**剔除單月最高峰**後取平均。
* **安全水位**：$1.5 \times \text{去峰月均銷}$。
* **目標備貨**：$3.0 \times \text{去峰月均銷}$。
* **缺貨分級算法（`classifyShortageLevel_`）**：
  - 一級缺貨（紅）：可用量 $\le 0$ 且無在途貨櫃。
  - 二級缺貨（橘）：可用量 $\le 0$ 但在途已出港。
  - 三級缺貨（黃）：可用量 $> 0$ 但低於安全水位。
* **入庫預估日**：ETA 到港日 $+ 10$ 個工作日（跳過週末）。

#### 6.3 `createReservation(payload)`
* **檔案來源**：`Code_Customer.js:224`
* **寫入目標**：`RESERVE_SS_ID` $\to$ `保留單`
* **插入位置**：使用 `sheet.insertRowsBefore(2, newRows.length)`，新單**插在第 2 列**。

---

### 7. 上架追蹤模組（`ShelfTracking.js`）

#### 7.1 `getShelfTrackingData(forceRefresh)`
* **檔案來源**：`ShelfTracking.js:22`
* **讀取目標**：`CONFIG.SS_ID_MAIN` $\to$ `編號價目表`，以及 `CONFIG.SS_ID_BUSINESS` $\to$ `版面上架清單`
* **系列分齡規則**：
  - `fresh` 全新品：首次進貨日 30 天以內。
  - `new` 新品：首次進貨日 30 天至 1 年以內。
  - `normal` 常態品：首次進貨日超過 1 年。
* **系列名稱標準化**：透過品號反查「編號價目表」之標準系列名，修正人工輸入之非標準系列名稱。

---

### 8. 客戶分析模組（`CustomerAnalysis.js`）

#### 8.1 外部戰情室 API 串接
* **端點**：`https://bigt.cc/sleeping-beauty/api.php`（Header 帶 `X-App-Token`）
* **Actions**：`customer-analysis`（快取 30 分）、`customer-timeline`、`customer-warroom`、`customer-sales-breakdown`、`customer-detail`。

#### 8.2 客戶名稱 5 層正規化（`caDisplayCustomerName_`）
1. ASCII Trim（排除全形空白 `U+3000`）。
2. 符號剝除 `()（）【】[]「」『』,，.。/／:：`。
3. 13 家固定合併字典。
4. 前綴例外字截斷。
5. 11 個例外保護詞。
6. 25 個公司後綴迴圈剝除至穩定。
7. 截取前 4 字。

#### 8.3 真樣品 vs 門市陳列分流（`caClassifySample_`）
面積門檻 $6000\text{ cm}^2$。備註含「扣」、或大磚 $>1$ 片、或小磚 $>6$ 片 $\implies$ 門市陳列（`display`）；其餘 $\implies$ 真樣品（`sample`）。

#### 8.4 拿樣成交中位數追蹤（`caSampleConversion`）
計算 $\text{Gap} = \text{firstSale} - \text{firstSampleDate}$（排除負值與 $\ge 3$ 年樣本）。有效樣本 $\ge 3$ 筆計算中位數，拿樣未成交且超過中位數者列入優先追蹤清單。

#### 8.5 `addDisplayNote_impl_(customerName, note, series, photoUrl, salesName)`
* **檔案來源**：`CustomerAnalysis.js:520`
* **寫入目標**：`CONFIG.SS_ID_BUSINESS` $\to$ `版面詢問紀錄`
* **欄位結構**：`["建立時間", "客戶名稱", "版面連結", "系列", "業務姓名", "詢問內容"]`。

---

### 9. 國貿貨櫃與到貨明細（`IncomingCargo.js`）

#### 9.1 `getIncomingCargoData(forceRefresh, branchFilter)`
* **檔案來源**：`IncomingCargo.js:15`
* **讀取目標**：`13la6Rx4cuLFg0lcbtG-q0YZcq_vBA83l9TcA7T7MNiY` $\to$ `到貨明細(唯讀)`
* **快取架構**：
  1. `_masterMapMemoryCache_`：執行期記憶體快取產品主檔。
  2. `INCOMING_CARGO_MASTER_v3`：全集團貨櫃共用快取（TTL 1 小時）。
* **單位換算**：
  $$\text{總片數} = \text{箱數} \times \text{每箱片數}$$
  $$\text{總坪數} = \text{總片數} \div \text{每坪片數}$$

---

### 10. AI 智慧查詢助理（`AIQuery.js`）

#### 10.1 `aiAssistantAsk_impl_(question, deviceId, bypassPassword)`
* **檔案來源**：`AIQuery.js:89`
* **頻率防刷限制**：
  - 單一裝置每分鐘最多 5 次（`AI_RATE_LIMIT_PER_DEVICE_PER_MIN`）。
  - 全站每分鐘最多 30 次（`AI_RATE_LIMIT_GLOBAL_PER_MIN`）。
  - 繞過密碼：`0319`。
* **模型分派**：
  - 優先讀取 `GEMINI_API_KEY`（使用 `gemini-2.5-flash`，強制 `responseSchema` 結構化輸出）。
  - 次選讀取 `ANTHROPIC_API_KEY`（使用 `claude-haiku-4-5-20251001`，強制 `tool_use`）。
* **意圖解析 Domain**：
  - `reserve` $\to$ 呼叫 `_aiQueryReserve_(item)`：查保留天數、保留坪數、客戶保留。
  - `sales` $\to$ 呼叫 `_aiQuerySales_(item)`：查近 N 個月銷售金額、品項銷額。
  - `inventory` $\to$ 呼叫 `_aiQueryInventory_(item)`：查品項可用庫存。
* **單次結果筆數上限**：80 筆（`AI_RESULT_LIMIT`）。

---

### 11. 人事出缺勤、請假與薪資精算（`Attendance.js`）

#### 11.1 `getAttendanceStaffList_impl_()` / `saveAttendanceStaff_impl_(data)`
* **檔案來源**：`Attendance.js:62` / `Attendance.js:78`
* **目標分頁**：`ATT_SHEET_ID` $\to$ `員工資料`
* **員工 ID 規則**：`EMP` + 3 碼流水號（例如 `EMP001`）。

#### 11.2 `getTodayAttendance_impl_()`
* **檔案來源**：`Attendance.js:121`
* **目標分頁**：`打卡紀錄`、`請假紀錄`、`系統設定`
* **遲到判定**：
  讀取 `系統設定` 之 `平日遲到門檻`（預設 `09:00`）。打卡時間大於門檻即計算遲到分鐘數。

#### 11.3 `savePunchRecord_impl_(data)`
* **檔案來源**：`Attendance.js:201`
* **目標分頁**：`打卡紀錄`
* **工時與加班計算**：
  $$\text{工時} = \frac{\text{下班時間(分)} - \text{上班時間(分)}}{60}$$
  $$\text{加班工時} = \max(0, \text{工時} - 8)$$

#### 11.4 `submitStaffLeave_impl_(data)` / `reviewStaffLeave_impl_(leaveId, status, reviewer)`
* **檔案來源**：`Attendance.js:310`
* **目標分頁**：`請假紀錄`
* **假單 ID 規則**：`L` + `YYYYMM` + 3 碼流水號（例如 `L202610001`）。

#### 11.5 `calculateSalary_impl_(empId, yearMonth)`
* **檔案來源**：`Attendance.js:520`
* **計算邏輯**：
  - 應發金額：$\text{底薪} + \text{全勤獎金}(若無遲到缺勤) + \text{餐費} + \text{電話費} + \text{加班費}$。
  - 應扣金額：$\text{請假扣款}(\text{事假全扣/病假半扣}) + \text{勞保自付} + \text{健保自付}$。

---

### 12. LINE Bot 出缺勤 Webhook（`LineBot.js`）

#### 12.1 `doPost(e)`
* **檔案來源**：`LineBot.js:11`
* **核心邏輯**：
  1. 立即回傳 HTTP 200。
  2. 將請求暫存至 `PropertiesService` 之 `LINE_QUEUE`（上限 50 筆）。
  3. 背景由排程觸發 `processLineBotQueue_impl_` 處理。

#### 12.2 `processLineBotQueue_impl_()`
* **檔案來源**：`LineBot.js:41`
* **驗證機制**：使用 `LINE_CHANNEL_SECRET` 執行 HMAC-SHA256 驗證 `X-Line-Signature`。
* **文字指令對照**：
  - `#綁定 姓名` $\implies$ 綁定員工 LINE User ID。
  - `上班` / `上班打卡` $\implies$ 執行 `_handlePunchIn`，檢核 09:00 遲到。
  - `下班` / `下班打卡` $\implies$ 執行 `_handlePunchOut`，計算工時與加班。
  - `#請假 假別 開始日期 結束日期` $\implies$ 登記請假。
  - `出勤查詢` / `特休查詢` $\implies$ 回傳個人考勤與特休剩餘天數。

---

### 13. 保留系統定時排程、通知與快照（`Reserve_Notify.js`、`Reserve_Email.js`、`Reserve_Snapshot.js`、`Reserve_Telegram.js`）

#### 13.1 帳齡通知（`Reserve_Notify.js`）
* **階段一（30 天）**：跟進提醒（Email + Telegram 私訊業務）。
* **階段二（45 天）**：未更新警告（Email 業務 + 主管，Telegram 群組 Tag）。
* **階段三（60 天）**：逾期待處理（Email 給主管，人工評估刪除）。
* **額滿告警**：保留量達庫存 80%（`RESERVE_FULL_RATIO = 0.8`）即發出緊急通知。

#### 13.2 保留週報（`Reserve_Email.js`）
* 每週一 09:00 自動觸發 `sendWeeklyReserveEmail`。業務只收個人名下保留清單，主管收全公司彙總清單。

#### 13.3 庫存每日快照（`Reserve_Snapshot.js`）
* 每天凌晨 03:30 觸發 `recordDailyInventorySnapshot`。
* `庫存快照_最新`：覆寫最新各品項庫存與保留。
* `庫存每日快照`：**僅在品項數值有變動（Delta）時新增一列**，極致節省試算表儲存空間。

#### 13.4 Telegram 推播（`Reserve_Telegram.js`）
* 發送時強制設定 `disable_web_page_preview: true`，防範 Telegram 爬蟲預覽網址時將單次續保/取消 Nonce Token 提前消耗。

---

### 14. 身分驗證、白名單與金鑰體系（`Auth.js`、`AitGuard.js`、`Code.js`）

#### 14.1 4 級 RBAC 權限體系
* `open`：免登入（客戶查詢庫存、產品圖庫）。
* `staff`：業務同仁（報表、配送、日誌、打卡、保留單）。
* `admin`：主管（全知視角、各業務日報彙整）。
* `king`：最高權限（機密中心、薪資計算、獎金設定、員工管理）。

#### 14.2 直達金鑰與白名單管理（`Code.js`）
* `getSalesDirectKey` / `verifySalesKey_impl_`：業務免密碼直達連結金鑰。
* `getClientDirectKey` / `verifyClientDirectAccess_impl_`：客戶白名單專屬金鑰。
* `syncToLogisticsWhitelist_`：白名單異動時同步回寫物流系統白名單。

---

## 參、Google Sheets ↔ Supabase 雙向同步核心規則

在非 GAS 環境中，Google Sheets 是後勤人員的手動維護介面，Supabase 是前端高速讀寫資料庫，兩者必須維持雙向即時一致：

### 1. 寫回 Google Sheets 規則
* **廢除實體列號（Row Index）相依**：所有寫回修改（如更新配送狀態、下架版面、更新保留進度）必須使用**業務單號（Order ID）或客戶名稱 + SKU** 動態比對尋列，嚴禁使用靜態行號。
* **字串標準化清洗**：寫入前強制進行全域 Unicode NFKC 正規化，剝除零寬空格（`\u200B`）與前後多餘空白。
* **未稅金額防線**：業績與獎金計算一律以試算表之「未稅金額」為基準。

### 2. 試算表異動同步回 Supabase
* 透過 Google Drive / Sheets Webhook 或定時輪詢（Polling Cron），讀取最後修改時間，增量將試算表變更同步回 Supabase。

---

## 肆、非 GAS 技術架構對照表（GAS API $\to$ Cloudflare / Supabase）

| GAS 原有元件 | 非 GAS 對照實作方案 |
|---|---|
| `SpreadsheetApp.openById().getSheetByName()` | Google Sheets API v4 (`spreadsheets.values.get` / `batchUpdate`) 或直接查 Supabase DB |
| `sheet.insertSheet(name)` (自體建表) | 呼叫 Sheets API `AddSheetRequest` 並注入壹.2 節之表頭欄位 |
| `CacheManager.getLarge()` / `putLarge()` | Cloudflare KV、Upstash Redis、或 Supabase 記憶體快取 |
| `LockService.getScriptLock()` | PostgreSQL Row-Level Lock (`SELECT ... FOR UPDATE`) 或 Redis Redlock |
| `Utilities.formatDate()` | `date-fns-tz` 或 `dayjs`，時區固定 `'Asia/Taipei'` |
| `UrlFetchApp.fetch()` | 標準 Node.js / Fetch API |
| `PropertiesService.getScriptProperties()` | Cloudflare Environment Variables / Supabase Secrets |
| `MailApp.sendEmail()` | Resend、SendGrid、或 Cloudflare Email Workers |
| `ScriptApp.newTrigger()` | Cloudflare Cron Triggers 或 Supabase `pg_cron` / GitHub Actions |
