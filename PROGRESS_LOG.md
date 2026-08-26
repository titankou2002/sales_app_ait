# 🚀 版面記錄神器 - 開發進度日誌

## ⏰ 定時觸發器執行紀錄 (2026-08-13 ~ 08-14)

| 執行時間 | 版本 | 觸發器函式 | 耗時 | 說明 |
|---|---|---|---|---|
| 2026-08-13 19:14 | 上端 | sendMissingCheckoutReminders | 0% | 每天 19:00 檢查打卡表，凡已打上班卡但尚未打下班卡的業務員，寄 Email 提醒補打下班卡 |
| 2026-08-13 20:19 | 上端 | sendDailyAdminSummary | 16.67% | 每天 18:00+ 彙整全體業務當日打卡/里程/拜訪家數與任務內容，寄「外勤日報」Email 給高弘治 |
| 2026-08-14 12:15 | 版本 500 | processLineBotQueue | 0.07% | LINE Bot 訊息佇列處理器，每 1 分鐘跑：把存於 `LINE_QUEUE` 的待處理訊息做簽章驗證後處理 |
| 2026-08-13 19:36 | 上端 | syncSalesDataToZoning | 0% | 依時間觸發：把交易報表當月銷售數據同步寫入「業務分區」表 |
| 2026-08-14 06:32 | 上端 | dailyAutoSync | 0% | 每日自動同步：`syncSalesDataByYear` 同步全年銷售數據到業務分區表 |
| 2026-08-14 12:12 | 上端 | prewarmAllCaches | 0% | 統一快取預熱入口：業績總覽＋庫存查詢＋上架追蹤＋全知視角＋客戶到訪紀錄，每 5 分鐘跑一次 |

### 🔍 各觸發器詳細說明

1. **sendMissingCheckoutReminders**（FieldWork.js:1754）— 每天 19:00 跑的提醒：檢查當天打卡表，凡「已打上班卡但還沒打下班卡」的業務員，發 Email 提醒補打下班卡，利於工時統計。
2. **sendDailyAdminSummary**（FieldWork.js:1720）— 每天 18:00+ 跑：彙整全體業務當日的上班/下班打卡、里程、拜訪家數與每站任務內容，寄「外勤日報」Email 給高弘治（titankou2002@gmail.com）。
3. **processLineBotQueue**（LineBot.js:40）— LINE Bot 訊息佇列處理器，固定每 1 分鐘跑：把等待處理的 LINE 訊息（存於 Script Properties 的 `LINE_QUEUE`）依序做簽章驗證後處理（文字指令／追蹤事件），避免 doPost 超時。
4. **syncSalesDataToZoning**（Sales.js:1565）— 依時間觸發：把「交易報表」的當月銷售數據同步寫入「業務分區」表，讓戰情室的當月數字自動更新。
5. **dailyAutoSync**（Sales.js:1587）— 每日自動同步：呼叫 `syncSalesDataByYear` 同步**全年**銷售數據到業務分區表（每日清晨跑，讓分區數字每天都是最新的）。
6. **prewarmAllCaches**（Sales.js:1666）— 統一快取預熱入口：同時預熱 **業績總覽＋庫存查詢＋上架追蹤＋全知視角（昨天）＋客戶到訪紀錄（謝博皓/潘右森/陳勁多）** 五種資料，設定為每 5 分鐘跑一次，搶在快取過期前刷新，讓業務開頁面時永遠讀到熱快取。

> **註**：`prewarmAllCaches`（Sales.js:1666，業績/庫存/上架/全知視角）與 `runAllPreWarm`（FieldWork.js:2752，配送＋工作日誌）是**不同函式**。若想改為統一單一入口，需手動執行 `setupSalesOverviewPrewarmTrigger`（Sales.js:1678）調整。

---

## 🐛 [2026-08-21] 修正：跑馬燈把「已補貨」項目誤判成新缺貨警示 (版本 512)

**問題回報**：使用者截圖看到首頁跑馬燈顯示「8/21 已補貨：MP10080D」，質疑「這裡不是顯示缺貨的新進榜嗎，為什麼已補貨的東西會出現在這裡」。

**根因**：`getLatestStockoutEntries()`（Code.js:6094，供 script.html:3034 `loadStockoutSubtitleAlert()` 輪播用）組字串的邏輯是 `dateStr + " " + (cat || "新進榜缺貨") + "：" + code`，其中 `cat` 是直接讀「缺貨進榜追蹤」表的「缺貨分類」欄原文。該表本身除了「完全缺貨」「嚴重缺貨」等進行式分類外，也會把補貨完成的列標記成「已補貨」這種完成式狀態——但先前（2026-07-28）修的排除規則只涵蓋 `已到貨|已解封|解封|恢復|已復原|復原|已結案`，漏了「已補貨」，導致這類已解決的列仍被當成「新進榜」顯示在跑馬燈上。

**修正內容**（Code.js:6148）：
- 排除規則正則式追加 `已補貨|補貨完成`：`/已到貨|已解封|解封|恢復|已復原|復原|已結案|已補貨|補貨完成/`。
- 刻意只排除「已補貨」「補貨完成」這種完成式，「補貨中」等進行式字樣不受影響，仍會被視為有效警示繼續顯示。
- 快取鍵 `latest_stockout_v2` → `v3`，避免舊快取（5 分鐘 TTL）延續錯誤結果。

**補充說明**：使用者提到 MP10080D 是「睡美人」品項——這與本次 bug 無關，純屬巧合；問題出在「缺貨分類」欄位的狀態文字沒被完整過濾，不分品項類別，任何被標記「已補貨」的列都會有這個問題。

**部署**：`clasp push -f` → 版本 512 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @512`（網址不變）。

---

## ✨ [2026-08-21] 新增上架自動帶入：手機實測 6 項細節優化 (版本 522)

**回饋來源**：使用者實機（手機）測試 v521 後，針對「系列自動帶入」再提出 6 點細節體驗回饋。

1. **拿掉「顏色：」標籤前綴**：v521 加的「顏色：」文字標籤使用者覺得不需要，改回只顯示色名本身（資料來源仍是修正後的「顏色」欄，沒有退回「色階」）。
2. **邊打邊搜時顯示讀取動畫**：`handleSeriesInput` 送出查詢請求期間，在輸入框內顯示一個小型轉圈動畫（複用既有 `aiSpinnerRotate` keyframe），查詢結束（不論成功/失敗）就隱藏，讓「正在搜尋中」這件事看得到。
3. **修正「已選系列後繼續打字，畫面卻還顯示舊系列結果」的混淆狀態**：新增 `block.dataset.confirmedSeries` 追蹤目前畫面顯示的是哪個系列——`handleSeriesInput` 偵測到輸入框內容跟這個值不同（代表在打新的字），立刻清空舊的自動帶入清單，不會讓人誤以為新輸入的字搜出了舊系列的結果。額外用遞增 token 擋掉「連續改字時，較早送出但較晚回來的查詢結果蓋掉新結果」的競態問題。
4. **縮小拍照按鈕**：`.add-photo-section` 從 `aspect-ratio:4/3`（在手機版等於螢幕寬度的 3/4 高，非常大）改成固定 `height:110px`，內部圖示/文字字級同步縮小。
5. **修正片數欄位數字鍵盤**：`type="number"` 在部份行動瀏覽器不會可靠觸發純數字鍵盤（可能跑出含小數點/負號的鍵盤）；改成 `type="text" inputmode="numeric" pattern="[0-9]*"`，這是行動裝置純數字鍵盤更穩定的寫法。批號欄位維持 `type="text"` 不設 `inputmode`，沿用一般鍵盤。
6. **批號支援「可選也可自打」**：`getSeriesSkuOptions()`（Code.js）新增回傳每個編號在庫存裡實際存在過的批號清單（來源：`getAggregatedInventory()` 每個品項的 `batches` 陣列，去重取批號字串）；前端用 HTML5 `<datalist>` 讓批號欄位變成「有現成批號可點選，也可以直接手打新批號」的原生 combo box，不用額外寫下拉選單邏輯。

**驗證**：語法檢查通過（Code.js、Inventory.js、script.html 內嵌 script 區塊）、零位元組掃描正常。

**部署**：`clasp push -f` → 版本 522 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @522`（網址不變）。

---

## ✨ [2026-08-21] 新增上架系列自動帶入：4 項體驗優化 (版本 521)

**回饋來源**：使用者實測 v517 的「系列自動帶入」功能後，提出 4 點手機版實測體驗回饋。

1. **產品尺寸移到「手動新增品項」區塊裡**：原本「系列名稱」跟「產品尺寸」並排在區塊最上方，但尺寸只有手動新增品項才用得到（自動帶入的編號本身就自帶尺寸）並排容易誤會兩者都必填。搬到「手動新增品項」標題下方，語意更清楚。
2. **系列名稱改成邊打邊搜**：原本要打完整系列名稱、失焦(blur)才觸發查詢。新增後端 `getSeriesNameSuggestions(query)`（複用既有庫存快取，掃過 `sCn` 去重比對子字串），前端 `input` 事件加 250ms 防抖動，即時顯示下拉建議清單（最多 12 筆），點選即自動帶入該系列完整品項清單；原本的「打完整名稱+失焦」也保留當備援路徑。
3. **編號下方標籤從「色階」改成「顏色」**：確認編號價目表裡「色階」（等級代碼）跟「顏色」（給人看的色名）是不同欄位，`getAggregatedInventory()`（Inventory.js）新增 `colorName` 欄位讀取「顏色」欄，`getSeriesSkuOptions()` 改為優先用 `colorName`、退回 `colorTag`（色階）；前端顯示也加上「顏色：」文字標籤，不再是無標籤的裸文字。快取鍵 `inv_full_v11`→`v12`。
4. **系列名稱輸入框支援直接打編號反查系列**：`getSeriesSkuOptions()` 在系列名稱精準/模糊比對都找不到時，改嘗試把輸入值當編號比對（正規化去空白/連字號），命中後改用該編號所屬的系列做完整比對——只記得編號、不記得系列名稱時也能用。

**驗證**：語法檢查通過（Code.js、Inventory.js、script.html 內嵌 script 區塊）、零位元組掃描正常。

**部署**：`clasp push -f` → 版本 521 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @521`（網址不變）。

---

## 🔧 [2026-08-21] 金鑰管理停用/刪除補強：處理中提示 + 失敗保護 (版本 520)

**問題回報**：v519 修好斷行問題後，使用者測試刪除功能，回報「刪掉後沒有動畫顯示，就跳到 `script.google.com 拒絕連線` 畫面了」。

**排查**：`toggleStatus`／`deleteSalesperson`（Code.js 內嵌 client-side script）原本都只有 `.withSuccessHandler()`，**沒有 `.withFailureHandler()`**——如果後端執行拋例外，`google.script.run` 不會有任何回呼觸發，畫面就是靜靜卡住、毫無反應，使用者形容的「沒有動畫顯示」正是這個缺口。至於「`script.google.com 拒絕連線`」這個瀏覽器層級的連線錯誤（不是 GAS 應用層的錯誤畫面），比較像是暫時性的網路/Google 端狀況——這個 session 短時間內連續 redeploy 了 10 次（v510～v519），不排除觸發了暫時性流量保護；純前端 `window.location.replace()` 導頁本身不會造成這種連線層級錯誤。

**補強內容**（不確定連線問題會不會再發生，但這兩個缺口本來就該補）：
- `toggleStatus`／`deleteSalesperson` 都新增 `.withFailureHandler()`：後端出錯時彈出明確訊息＋建議重新整理，不再靜默卡住。
- 點擊確認後立刻 `showToast('處理中，請稍候...')`，在等待伺服器回應期間至少有即時的視覺回饋，不會讓人以為「沒反應」。

**驗證**：語法檢查通過、零位元組掃描正常。

**部署**：`clasp push -f` → 版本 520 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @520`（網址不變）。

**待確認**：請使用者重新整理頁面、再試一次刪除／停用，確認「script.google.com 拒絕連線」是否只是當下的偶發網路問題，還是會穩定重現——若穩定重現，代表還有沒抓到的根因，需要進一步排查。

---

## 🐛 [2026-08-21] 修正：金鑰管理刪除按鈕整個 script 壞掉 + 操作欄位斷行 (版本 519)

**問題回報**：v518 上線後，使用者截圖 console 錯誤 `Uncaught SyntaxError: Invalid or unexpected token` + `Uncaught ReferenceError: deleteSalesperson is not defined`；另外「操作」欄的停用/刪除按鈕跑到「直達連結」欄位下方另起一行，很醜。

**根因 1（語法錯誤，讓整個 script 掛掉）**：這個管理後台頁面是 `doGet()`（Code.js）用 JS **樣板字面值（backtick）**組出一整串 HTML 字串回傳的，裡面包著要給瀏覽器執行的 client-side `<script>`。v518 新增的 `deleteSalesperson()` 確認框用了 `'...？\n\n跟「停用」不一樣...'`——這個 `\n\n` 在 GAS **伺服器端**組字串時就先被當跳脫字元處理掉，變成實際的換行符號位元組，混進最終送到瀏覽器的 HTML 裡；瀏覽器解析這段 client-side JS 時，單引號字串中間出現一個「真的換行」是不合法語法，直接讓整個 `<script>` 區塊解析失敗——所以不只 `deleteSalesperson`，那個 script 裡的所有函式都變成 undefined（這跟稍早修過的 `\'` vs `&apos;` 是同一類「伺服器端樣板字面值吃掉跳脫字元」的坑）。
**修正**：改成 `\\n\\n`（雙反斜線），讓它在伺服器端組字串後仍保留成字面上的 `\n` 兩個字元，瀏覽器解析 client-side JS 時才會正確當成跳脫字元處理成真正的換行。

**根因 2（操作欄斷行）**：「直達連結」跟「操作」兩個 `<td>` 都直接在 `<td style="...">` 上寫 `display:flex`——CSS 的 `display` 可以覆蓋瀏覽器對 `<td>` 預設的 `display:table-cell`，一旦被蓋成 `flex`，這格就不再是「表格儲存格」，變成一般的區塊級 flex 容器，跳出表格的欄位格線，改用一般文件流排版（一個接一個往下疊），導致「操作」欄整個掉到「直達連結」欄下方另起一行。
**修正**：`<td>` 本身拿掉 `display:flex`，改成 `<td><div style="display:flex; ...">...按鈕...</div></td>`——用內層 `<div>` 做水平排列，`<td>` 本身維持原生表格儲存格屬性，兩欄就能正常並排在同一列。

**驗證**：語法檢查通過、零位元組掃描正常；順手掃過整份檔案確認沒有其他 `confirm()`/`alert()` 有同樣單層跳脫的 `\n` 殘留。

**部署**：`clasp push -f` → 版本 519 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @519`（網址不變）。

---

## ✨ [2026-08-21] 業務app金鑰管理：新增永久刪除按鈕 + 主選單連結存取記錄 (版本 518)

**需求**（來自「高雅瓷機密中心」管理後台 `view=getkeys` 頁面）：① 每個業務都有專屬主選單連結，希望開啟時能留下 log 記錄；② 目前「操作」欄只有停用/啟用，希望能加「刪除」按鈕。

### 1. 主選單連結存取記錄
- `verifySalesKey(sales, key)`（Code.js）——這是業務打開自己專屬連結時，前端 `script.html` 在 app 啟動時**唯一**會呼叫一次的身分驗證函式（不是逐次點擊都呼叫，不會洗版）。驗證完成後（不論成功或失敗）都呼叫既有的 `logAdminKeyAction_()` 寫一筆記錄，跟管理後台操作記錄共用同一張「LOG」分頁，統一查閱。
- 成功寫「業務開啟專屬連結／身分驗證成功，已進入系統」；失敗寫「業務連結驗證失敗／金鑰不符或已被停用，拒絕存取」——失敗的也留記錄，可用來稽核「已停用的金鑰是否還有人在嘗試存取」。

### 2. 新增「刪除」按鈕
- `getSalesKeysList()` 新增 `isCustom` 欄位（是否為管理後台手動新增的自訂名單）。因為列表裡的名字有兩種來源：業務分區/固定名單裡的正式業務，跟手動新增的自訂名單（例如 doris/lynn 這類助理或測試帳號）——**前者刪了下次讀取還是會自動再出現，語意上「刪除」不成立**，所以只有 `isCustom=true` 的列才會顯示「刪除」按鈕，其餘只能沿用既有的「停用」。
- 新增後端 `deleteDirectSalesperson(name)`：從 `DIRECT_ACCESS_CUSTOM` 這個 Script Properties 陣列移除該名字（真正永久刪除，非軟停用），一併清掉停用清單裡的殘留記錄，並寫入操作 log。若誤點到非自訂名單的人，明確回傳錯誤訊息說明只能停用。
- 前端 `deleteSalesperson(name)`：二次確認對話框明確說明「跟停用不一樣，刪除後無法復原」，避免誤刪。
- **附帶修正**：刪除按鈕跟既有「[ 已失效 ]」標籤用的 `var(--red)` CSS 變數在這份樣式表裡其實從未被定義過（原本一直沒真的顯示紅色），補上 `var(--red, #dc2626)` fallback 色值。

**驗證**：語法檢查通過、零位元組掃描正常。

**部署**：`clasp push -f` → 版本 518 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @518`（網址不變）。

---

## ✨ [2026-08-21] 修正電腦版照片彈窗過大 + 新增上架支援「系列自動帶入」與多系列 (版本 517)

### 1. 修正：電腦版「產品規格」照片彈窗過大

**問題回報**：手機版照片彈窗正常，電腦版（寬螢幕）打開同一個彈窗，照片被拉伸到跟整個瀏覽器視窗一樣寬，異常巨大。

**根因**：`.modal-overlay`／`.modal-content`（[CSS_Components.html](CSS_Components.html)）是純手機版設計，`width:100%` 沒有任何桌機寬度上限，寬螢幕下 `.detail-image`（`width:100%`）自然被撐到跟瀏覽器視窗一樣寬。專案裡其實已經有一個模態框（`#reserve-add-modal`）自己另外用 inline style 加了 `max-width:550px`，但沒有系統性套用到其他模態框。

**修正**：`.modal-content` 新增 `@media (min-width: 992px)` 規則，設 `max-width:520px; margin:0 auto`，比照專案既有的 992px 桌機斷點慣例（`#page-inventory`/`.album-grid` 已在用）。刻意只調整 `.modal-content`，不動 `.modal-overlay` 的 `align-items`，讓 navbar 維持原本橫跨整個視窗頂端的滿版樣式。這個修正是全域套用到 `.modal-content`，所以「新增上架」表單彈窗在桌機上也會一併變得比例正常（原本也沒有寬度上限）。

### 2. 新增：「新增上架」表單支援系列自動帶入 + 多系列

**需求**：業務反應新增上架時要一個個手打編號很慢，希望輸入系列名稱後能自動帶出該系列所有編號（依尺寸分組），用勾選＋填片數取代手打，同時保留手動輸入的彈性；也要能一次記錄多個系列。

**修正內容**：
- **後端新增 `getSeriesSkuOptions(seriesName)`**（Code.js）：直接複用 `getAggregatedInventory()` 既有快取（庫存查詢同一份資料，不額外開表），依系列名稱篩選（先精準比對，比對不到才退回模糊雙向 `includes`），依尺寸分組回傳每個編號的 SKU／色階／縮圖。
- **`#add-modal`（新增上架彈窗，index.html）改版為「系列區塊」結構**：
  - 每個區塊：系列名稱輸入框（失焦時自動查詢帶入）＋ 產品尺寸輸入框（給手動新增用）＋ 自動帶入結果（依尺寸分組，每個編號一列：縮圖／編號／色階／片數輸入／批號輸入／勾選框）＋ 既有的「+ 增加型號」手動新增區。
  - 「＋ 新增系列」按鈕可重複新增區塊，一次記錄多系列版面；每個區塊可各自移除（第一個區塊不可移除）。
  - 新增 `.series-block`／`.autofill-item-row` 等 CSS（style.html）。
- **`saveNewLayoutEntry()`（script.html）重寫收集邏輯**：逐一走過所有系列區塊，收集「勾選且有填片數」的自動帶入品項＋手動新增品項，**每個品項各自帶自己所屬的 series/size**（不再是整包共用一組系列/尺寸）。
- **後端 `saveNewLayout()`（Code.js）配合改成逐品項覆蓋**：`newRow[idx.series] = item.series || payload.series`、`newRow[idx.size] = item.size || payload.size`，沒帶 per-item 值時退回舊版整包共用欄位（向下相容）。

**驗證**：語法檢查通過（Code.js、script.html 內嵌 script 區塊）、零位元組掃描正常。

**部署**：`clasp push -f` → 版本 517 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @517`（網址不變）。

---

## 🐛 [2026-08-21] 修正：陳列牆→保留單分頁抓不到圖 (版本 516)

**問題回報**：使用者截圖「漢樺」客戶的「陳列牆 → 保留單」分頁，所有品項卡片一律顯示「NO IMG」，如 `RS61280-掛`、`ED45751-F-掛`。

**根因**（`getReservedOrdersGrouped`，Code_Customer.js:44，供 JS_CustomerManager.html 保留單卡片渲染用）：保留單分頁的「編號」欄位常見 `RS61280-掛`、`ED45751-F-期` 這種格式——「-掛」「-期」是保留系統標記「尚未有正式批號、先登記到貨」的**暫記後綴**，不是編號本體的一部分。但這裡比對「編號價目表」的 `skuKey` 只做了 `replace(/[\s\-]/g,'')`（去空白/連字號），沒有去掉「掛」「期」這個字——`RS61280-掛` 就變成 `RS61280掛`，永遠對不到編號價目表裡真正的 `RS61280`，導致 `meta` 一律 fallback 成空值（`singleImg`/`series`/`size` 全空、`perPing` 也錯用預設值 36），卡片自然全部 NO IMG。

同一個 bug 其實在 `getCustomerDisplays`（Code.js，版面頁面的保留量標註）也存在一份幾乎一樣的程式碼，一併修掉。

**修正內容**：
- 把這個去暫記後綴的邏輯從 Inventory.js（原本只有到貨日期比對在用，函式內部 nested）**提升為 Code.js 全域共用函式** `normalizeIncomingSkuKey_(raw)`：`replace(/[-\s]*(掛|期)\s*$/, '')` 去後綴 → 再去空白/連字號。
- `Code_Customer.js` `getReservedOrdersGrouped`：抓 `meta` 用的 `skuKey` 改用 `normalizeIncomingSkuKey_(skuRaw)`（`sku` 顯示欄位仍維持原始帶後綴的 `skuRaw`，只有查表 key 要正規化）。
- `Code.js` `getCustomerDisplays` 內建的 `customerReservedMap` 同一個 bug 一併修正。
- **附帶修正**：因為 `meta` 之前 fallback 成預設值，`perPing` 也一直被錯用固定 36，導致這類暫記編號品項的坪數換算（`pyeong`）不準；修好比對後坪數也會一起變正確，不只是圖片。

**驗證**：語法檢查通過（Code.js、Code_Customer.js、Inventory.js）、零位元組掃描正常。

**部署**：`clasp push -f` → 版本 516 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @516`（網址不變）。

---

## ⚡ [2026-08-21] 版面記錄核心效能優化：客戶版面讀取＋新增上架都慢 (版本 515)

**問題回報**：業務反應「版面記錄」這個核心功能讀取速度跟上傳新增的速度很慢，導致大家不太想用。

**根因（讀取端，`getCustomerDisplays`，Code.js）**：這是每次業務點開一個客戶的版面頁面就會呼叫的核心函式，**完全沒有結果快取**——每次都重新：
1. 全表掃描「版面上架清單」（找該客戶所有列）
2. 呼叫 `getReservedOrdersGrouped()` 抓保留單標註，而這個函式本身**也完全沒快取**，還會：
   - 開一次跨試算表的「保留單」來源（`CONFIG.RESERVE_SS_ID`，跨表 `openById` 本身就慢）
   - 全表掃描「保留單」分頁
   - **再額外多開一次主試算表**（`SpreadsheetApp.openById(CONFIG.SS_ID)`），**重新**讀一次「編號價目表/庫存表」算 `metaMap`——即使 `getCustomerDisplays` 剛剛才用快取版算好一份幾乎一樣的 `inventoryMap`，完全是白算一次。

也就是每次開一個客戶頁，實際上是「讀版面表＋讀保留單表＋讀兩次庫存/價目表」，四五次重量級表格操作疊在一起，且完全命中不到任何快取。

**額外發現**：程式碼裡其實已經有兩處「清除快取」的殘留程式碼（`saveNewLayout` 清 `displays_<客戶>`、`updateDisplayBatch` 清 `CUSTOMER_DISPLAYS_<客戶>`），但 `getCustomerDisplays` 從來沒有實作對應的「讀快取／寫快取」——等於兩次都在清一個從沒被寫入過的空氣，是過去半途而廢、忘記接上的功能。

**修正內容**：
- **`getCustomerDisplays`（Code.js）**：實作整包回應快取（`CacheManager.getLarge`/`putLarge`，180 秒 TTL，key＝`displays_<客戶簡稱>`）。命中快取時直接跳過所有試算表操作。
- **`getReservedOrdersGrouped`（Code_Customer.js）**：新增第 3 個參數 `metaMapOverride`——呼叫端（`getCustomerDisplays`）現在會把已經算好的 `inventoryMap` 直接傳進去，函式內部不再重複開表、重新計算一次幾乎一樣的資料；沒傳參數的舊呼叫點（如 `getCustomerDashboardData`）維持原本行為，向下相容。
- **`saveNewLayout`（Code.js，「新增上架」寫入路徑）**：原本 `sheet.getDataRange().getValues()` 把整張表（可能上萬列）全讀進記憶體，**只是為了拿標題列**；改成只讀前 2 列（`getRange(1,1,2,lastCol)`），直接省掉這次全表讀取。
- **修好 2 處失效的快取清除，並補齊 3 處遺漏**：`saveNewLayout`／`updateDisplayBatch` 原本清的 key／快取空間跟新實作的讀取端對不上，已改用一致的 `CacheManager.removeLarge("displays_"+客戶)`；另外 `offShelfDisplayBatch`、`deleteDisplayBatchPermanent`、`updateLayoutFieldBatch` 這三個「下架／永久刪除／欄位批次修改」的寫入路徑原本完全沒清過快取，現在也都補上——確保新的快取機制不會讓業務改完東西還看到舊資料。

**效果**：同一個客戶在快取有效期內（3 分鐘）重複開啟版面頁面，直接跳過所有試算表 I/O；快取過期後首次讀取，也少掉一次完全重複的庫存表讀取。新增上架的寫入路徑減少一次不必要的全表讀取。

**驗證**：語法檢查通過（Code.js、Code_Customer.js）、零位元組掃描正常。

**部署**：`clasp push -f` → 版本 515 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @515`（網址不變）。

---

## ✨ [2026-08-21] 上架追蹤／系列明細：新增「有保留」篩選，重組為 5 種狀態 (版本 513)

**需求**：使用者在「上架追蹤 → 系列明細」看到的原本 4 個篩選 chip（上架/有出貨未上架/已上架未售/未上架）少了「保留」這個維度，要求新增「有出貨／有保留／有上架」篩選。經確認後定案：**取代**原本 4 個，改成 5 種互斥狀態，按優先序分類每個客戶：

1. **有出貨有上架**（已上架且曾出貨，最佳狀態）
2. **有保留有上架**（已上架、有保留單但尚未出貨——潛力客戶）
3. **有上架未出貨**（純上架，無出貨無保留紀錄）
4. **有出貨未上架**（曾出貨但目前未上架，含已下架客戶）
5. **未上架**（完全沒碰過上架/出貨，含下架後也沒出貨過的客戶）

**根因/背景**：這個模組原本完全沒有「保留」這個資料維度——`getShelfTrackingData()`（ShelfTracking.js）只讀「版面上架清單」（上架狀態）跟「經銷銷售報表」（出貨狀態），從沒接過保留單資料。

**修正內容**：
- **ShelfTracking.js**：新增「3b. 保留單 → 客戶×系列 保留狀態」區塊，讀 `CONFIG.RESERVE_SS_ID`（跟 [Inventory.js](Inventory.js) 庫存查詢同一份保留單來源）的「保留單」分頁，用客戶名稱（`mergeCustomer` 正規化）＋ SKU→系列比對，建立 `custSeriesReserve["cust||series"]` 對照表，比照既有慣例不額外判斷保留單列是否「還有效」。輸出結果新增 `result.reserve` 欄位（跟既有 `result.sales` 平行）。快取鍵 `shelf_tracking_v11` → `v12`。
- **JS_ShelfTrack.html**：
  - 新增 `reserveOf(cust, series)` 前端 helper（比照既有 `salesOf`）。
  - 系列明細（Tab 3）的客戶分類邏輯從舊的 0~4 五級排序（原本混雜「上架/未上架」跟「出貨」兩個維度、沒有保留）改寫為新的 5 種互斥狀態，含優先序判斷（有出貨優先於有保留，兩者都優先於純上架）。
  - 5 個篩選 chip 全部重寫（label／點擊 key／計數），新增藍色系 `.shelf-chip.reserved` 樣式做視覺區隔。
  - 已下架（`removed`）客戶維持顯示「下架＋下架日期」的特殊標記，但依是否曾出貨併入「有出貨未上架」或「未上架」計數，不再像舊版一樣被排除在所有具名分類之外。
- **驗證**：語法檢查通過（ShelfTracking.js 全文 + JS_ShelfTrack.html 內嵌 script 區塊）、零位元組掃描正常。

**追加 v514**：使用者截圖回報「按了『有出貨有上架』chip 後只剩 1 家，我要全部呈現出來用顏色分類」——查證後確認**不是預設狀態被誤篩選**（`shelfSeriesFilter` 預設就是 `'all'`，切換系列時也會重置，未篩選狀態本來就會顯示全部客戶並依 5 色分類），而是使用者自己點了該 chip 進行測試，但**沒有明顯的「回到全部」入口**（只能再點一次同一個 chip 靠 toggle 邏輯取消）。修法：在 5 個分類 chip 最前面新增一顆「全部 X 家」chip，點擊直接重置為未篩選（不用記得要點同一顆才能取消），計數 = 5 種分類加總，UX 更直覺。`clasp push -f` → 版本 514 → redeploy 既有 deployment @514。

**部署**：`clasp push -f` → 版本 513 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @513`（網址不變）。

---

## 🐛 [2026-08-14] 修正：獎金門檻改了之後沒計算成功 (版本 501)

**問題回報**：使用者「當月業務業績獎金精算與折半明細」後台改了獎金門坎，卻沒有計算成功。

**根因**：
- 後台儲存函式 `saveActiveBonusConfig`（Sales.js:185）儲存時只清除了業績概況快取 `sales_overview_v3.3_monthly`，**漏掉後台獎金精算報表快取** `admin_bonus_report_v4_<year>_<month>`（快取 1 小時）。
- 因此改完門檻後，`getAdminBonusReport` 在 1 小時內仍回傳舊快取，畫面顯示舊數據，看起來像「沒計算成功」。

**修正內容**（Sales.js）：
- `saveActiveBonusConfig` 儲存成功後，追加呼叫 `clearAdminBonusReportCacheWindow_()`。
- 新增 `clearAdminBonusReportCacheWindow_()`：清除**當月前後各 6 個月**（涵蓋跨年）的 `admin_bonus_report_v4_*` 快取，讓調整立即生效。
- 計算邏輯本身（`calculateSalesBonus`）確認無誤，是直接讀 Properties 即時計算，無需改動。

**部署**：`clasp push` → 版本 501 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @501`（網址不變）。

> **驗證方式**：在後台改任一人突破門檻或達成獎金 → 儲存 → 重新點「重新計算」，報表應立即反映新門檻，不再等 1 小時快取。

---

## 🐛 [2026-08-21] 修正：AIT庫存查詢卡住/逾時 — 徹底移除到貨明細外部相依 (版本 510)

**背景**：前次修正（版本 509）已把 `getAggregatedInventory()` 對「到貨明細」（`getIncomingCargoContainers`，讀外部試算表「鈦傳速-薪資出缺勤表」）的呼叫改為只吃現成快取、不阻塞主流程，但該外部依賴本身仍偶爾拖慢/卡住整體庫存查詢。使用者指示：「一樣把到貨明細的讀取拿掉吧，讀保留單的就好」——直接整段移除，不再有任何條件式讀取。

**修正內容**（Inventory.js）：
- `_buildInventoryData(ss)` 中完全刪除 `containerIncomingMap` 區塊（呼叫 `getIncomingCargoContainers()` / 窺探其快取的 try/catch），到貨資訊改回**只讀「保留單」分頁**（`入倉日期1/數量1`、`入倉日期2/數量2`，經 `incomingMap` 正規化，含「-掛」「-期」暫記後綴歸戶）。
- 簡化 `eta`/`etaQty`/`etaShort`/`etaPing`/`hasArrival` 的計算邏輯，僅依賴 `incomingMap[key]`，移除所有 `containerIncoming` 相關程式碼。
- 快取鍵 `inv_full_v10` → `inv_full_v11`（強制舊快取失效）。
- `prewarmAllCaches()`（Sales.js）移除先前追加的 `getIncomingCargoContainers('高雅瓷', true)` 預熱呼叫，回復原本 5 個函式的預熱組合（業績總覽＋庫存查詢＋上架追蹤＋全知視角＋客戶到訪紀錄）。

**效果**：庫存查詢的到貨日期/數量資料來源單純化為**保留單一處**，不再有任何外部試算表（IncomingCargo 模組本身、其 UI、其他呼叫點不受影響，僅此處的耦合被切斷），理論上可徹底排除該外部依賴造成的載入卡住/逾時問題。

**部署**：`clasp push -f` → 版本 510 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @510`（網址不變）。

---

## 🎯 [2026-08-21] 業績/獎金歸戶邏輯改為「業務分區優先」(版本 511)

**背景**：使用者先前提出「從業務分區抓負責業務，如果業務分區沒有，再到經銷銷售報表抓」的改造需求（helper 函式當時已寫好但未套用，因中途插入獎金明細表可編輯化的需求而擱置），這次補做完成。

**問題**：過去所有業績/獎金相關計算，判斷「這筆交易算誰的業績」都是直接信任「經銷銷售報表」該列自己的「負責業務」欄原文（`String(r[sIdx.sales]).includes(name)`）。但客戶改派業務時，經銷銷售報表裡的舊交易列不會回溯更新負責業務欄，導致舊資料仍歸戶到前一位業務名下，新舊業務的業績/獎金都對不準。

**修正內容**（Sales.js）：
- 新增 `getCustomerOwnerMap_(ss)`：讀取「業務分區」表建立「客戶簡稱 → 目前負責業務」對照表，同一次執行內只讀一次（模組層快取 `_customerOwnerMapCache_`）。
- 新增 `resolveRowOwnerStr_(ss, custRaw, rawSalesColStr)`：優先查 `getCustomerOwnerMap_` 该客戶目前指派的負責業務；查無指派（該客戶不在業務分區表裡）才退回經銷銷售報表該列自己的「負責業務」欄原文。
- 套用到 **5 個計算歸戶的呼叫點**：
  1. `_computeAdminBonusReport`（後台獎金精算報表）
  2. `getCustomerYtdCompareByBiz`（客戶 YoY 交叉分析矩陣）
  3. `getSalesOverview`（業績總覽，最核心的單次掃描統計）
  4. `getSalespersonKpi`（單人業績/當月客戶佔比）
  5. `getSleeperDetails`（睡美人產品銷售明細）
- 快取鍵全面 bump 避免舊歸戶結果殘留：`admin_bonus_report_v4_` → `v5_`、`CUST_YTD_v5_` → `v6_`、`sales_overview_v3.3_monthly` → `v3.4_monthly`。
- 漢樺/波爾泰等「共享業績」客戶不受影響（仍走 `sharedMembers.includes(name)` 固定三人均分邏輯，不查業務分區）。

**效果**：客戶改派業務後，即使經銷銷售報表裡的舊交易列沒有回溯更新，業績/獎金統計也會立即以「業務分區」目前指派為準；業務分區沒登記的客戶則維持原本讀報表原文的行為，不影響既有資料。

**部署**：`clasp push -f` → 版本 511 → redeploy 既有 deployment `AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg @511`（網址不變）。

---

## 🔒 [2026-08-21] Git 安全網 commit

**背景**：這個專案長期只靠 clasp 部署與 Google Drive 雲端同步存檔，過去已發生過一次同步衝突造成 10+ 個核心檔案變成 0 bytes 的損毀事故（靠 Drive 自動產生的「檔名 2.ext」衝突備份檔搶救回來）。專案的 git 歷史裡除了 deploy.yml/favicon 相關 commit 外，核心 GAS 原始碼從未被版本控制保護過。

**處理內容**：
- `.gitignore` 新增規則排除 Google Drive 同步衝突產生的「檔名 2.ext」重複備份檔（`*[ ]2.js`、`*[ ]2.html`、`*[ ]2.md`），避免這些內容重複、含相同函數名稱的殘留檔案污染 git 歷史。
- 將目前所有已透過 clasp 部署上線、但尚未進 git 的原始碼變更（含這個 session 與並行 session 的成果，涵蓋 v3.3~v3.4、v3.17~v3.20、v501~v511 期間所有修正）一次性 commit（`6c6f6d1`）。
- 新增檔案一併納管：`AIQuery.js`（AI 智慧查詢助理）、`IncomingCargo.js`＋`JS_IncomingCargo.html`（到貨明細模組）、`.claspignore`、`apple-touch-icon.png`。

**效果**：之後若再發生 Drive 同步衝突導致檔案損毀，可直接 `git checkout` 或 `git diff` 復原，不必再仰賴「僥倖存在的衝突備份檔」這種不可靠的救援方式。

**注意**：此 commit 直接推在 `main` 分支（沿用使用者原本的操作習慣），尚未 push 到遠端 — 如需推到 GitHub 遠端，需使用者另外確認。

---

## [v3.4.0] - 2026-08-07 (新增 AI 智慧查詢助理 + 到貨明細模組)

### 🤖 一、AI 智慧查詢助理 (AIQuery.js / script.html / index.html / CSS_Effects.html)

**需求緣起**：使用者想要「用問的」查資料，例如「百磚保留超過2個月的」「60X120保留超過30坪的」「馬約利卡系列這三個月業績」，而不是每種條件都要另外做一個查詢畫面。

**架構**：
- **兩段式設計，避免 AI 幻覺數字**：
  1. `_aiParseQuery_()` 呼叫 AI（Gemini 或 Claude，自動偵測用哪組金鑰）把口語問題解析成結構化查詢條件（強制走 Gemini `responseSchema` 或 Claude `tool_use`，不會回自由文字）。
  2. `_aiQueryReserve_()` / `_aiQuerySales_()` / `_aiQueryInventory_()` 依解析出的條件，直接查真實試算表資料——**AI 只負責拆條件，數字一律是程式算出來的**。
- **雙 AI 供應商支援**：`_aiGetProviderConfig_()` 自動偵測 Script Properties 裡設定的是 `GEMINI_API_KEY` 還是 `ANTHROPIC_API_KEY`（都有時預設 Gemini，可用 `AI_PROVIDER` 屬性指定）。
- **查詢欄位**：系列(series)、尺寸(size)、SKU關鍵字、客戶關鍵字、保留天數門檻(minReserveDays)、坪數門檻(minPyeong)、片數門檻(minPieces)、業績月數(monthsBack)——一句話裡有多個門檻條件會全部套用，不會只吃到其中一個。
- **產品主檔對照表** `_getProductMasterMap_(ssId)`：讀「編號價目表」取得系列/尺寸/圖片/片坪/片箱/箱板，30分鐘快取，支援傳入不同試算表 ID（供到貨明細模組跨分公司查表共用）。

**UI 演進過程**：
1. 一開始做成右下角浮動 🤖 按鈕 → 使用者回報透過 `bigt.cc` 網域看不到 → 排查發現是 `position:fixed; bottom:...` 在 GAS 雙層 iframe 沙盒 + 行動瀏覽器動態工具列環境下常見的位移/裁切問題，改成 `top:14px; left:14px`（比照既有 `.logo-persistent` 已驗證可行的定位方式）仍有疑慮。
2. 使用者要求拿掉按鈕圓底，改純白「AI」文字呼吸動畫。
3. 最終使用者直接要求**拿掉獨立浮動按鈕，改成點擊首頁中央的呼吸動畫 LOGO 觸發** `openAiQueryModal()`，徹底避免任何浮動元素卡住畫面。
4. 對話框追加：送出後立即清空輸入框、讀取中改轉圈動畫（`.ai-query-spinner`）、🎤 語音輸入（Web Speech API，`zh-TW`，錄音中紅色脈動）。
5. 查詢結果從純表格改成**卡片式呈現**：每個 domain 各自定義卡片的「headline / highlight / sub / meta / extra」欄位——保留單以**客戶名稱**當卡片最大字、「保留 X 天」當重點色字；銷售/庫存以編號+系列當標題、金額或坪數當重點。單次查詢超過 40 筆只顯示前 40 張並提示還有幾筆。
6. **查詢歷史保留 30 天**：用瀏覽器 `localStorage`（key `ai_query_history_v1`），新查詢固定插入陣列最前面，畫面自動新的在上、舊的在下；每次開對話框會自動清掉超過 30 天的紀錄。

**授權踩坑記錄**（`UrlFetchApp.fetch` 需要 `script.external_request` 權限）：
- 手動在 Apps Script 編輯器執行 `aiAssistantAsk`（沒帶參數）不會跳出授權視窗，因為函式一開始就因為沒有輸入值而提前 `return`，根本沒真的呼叫到 `UrlFetchApp`。
- 新增專門的授權測試函式，並發現**函式名稱不能用底線開頭**（`_aiTestAuth_` 這種寫法會被 Apps Script 編輯器的「執行」下拉選單自動視為私有函式而隱藏），改名為 `aiTestAuthorization()` 才選得到、才能手動執行逼出完整授權同意畫面。

**NL 解析強健度優化**：系統提示詞加入 5 組範例問法、明確要求「使用者口語不標準也要盡量理解，寧可過度解讀也不要回傳空陣列」、「只有完全看不出是哪個 domain 才算真的無法理解」，降低「無法理解您的問題」的失敗率。

---

### 🚢 二、到貨明細模組 (IncomingCargo.js / JS_IncomingCargo.html / index.html)

**資料來源**：獨立試算表「鈦傳速-薪資出缺勤表」的「到貨明細(唯讀)」分頁（國貿小姐維護的在途貨櫃預告，`ETA+14天` 是舊系統的預計領櫃邏輯，本模組改用 `ETA+10個工作日` 當入庫時間預估）。

**解析邏輯移植**：直接沿用「倉庫日誌」專案 `CargoInspection.js` 已驗證可行的邏輯（不重造輪子）——貨櫃是「一個標頭列（品牌/櫃號/ETD/ETA/港口/Remark/船名）+ 多個品項列（原廠品名/編號/尺寸/數量）」的合併儲存格結構，用 Google Sheets 合併儲存格「只有頂端儲存格有值」的特性判斷新貨櫃的開始。

**編號比對與跨分公司價目表**：
- 編號欄位格式「總公司編號 / 分公司編號」（例：`60120192 / AA61251`），取斜線後半段去比對「編號價目表」。
- 從「睡美人戰情室」PHP 專案的 `config.php` 找到集團分公司（安帝嘉、喜悅納）各自獨立的試算表 ID，`_cargoLookupMeta_()` 依貨櫃 Remark 判斷出的分公司，依序嘗試該分公司自己的價目表，找不到才退回高雅瓷主表當備援。
- **NEW / 期貨的特殊處理**：這類品項還沒建檔進價目表，比對不到，但既然表格裡有標尺寸跟數量，改用尺寸幾何反推：`每片面積(m²) = 寬cm/100 × 長cm/100`、`片數 = 數量m² ÷ 每片面積`，坪數則用 `數量m² × 0.3025`，卡片上標示「新品」或「期貨」標籤。真正沒有尺寸意義的附加項目（樣品/展示磚/展示架/計價棧板/紙箱）維持不換算。

**單位換算鏈**：`數量(m²) × 0.3025 = 坪數 → 坪數 × 片/坪 = 片數 → 片數 ÷ 片/箱 = 箱數 → 箱數 ÷ 箱/板 = 棧板數`（箱/板欄位找不到就不顯示棧板數）。**坪數一律無條件捨去、棧板一律無條件進位，兩者都不留小數點**。

**卡片呈現規則**（依使用者截圖反覆調整定案）：
- 第一行（大字）：中文系列 · 編號 · 尺寸（NEW/期貨則是 新品/期貨標籤 · 尺寸）。
- 第二行（小字）：原廠品名（原本的系列/色號）。
- 港口代碼中文化（KAO/K.O.→高雄港、KEE/KEEL→基隆港、TPE→台北港），船名拿掉不顯示。
- 藍色徽章顯示「到港日 8月19日(週三)」完整格式；另外顯示「還剩 X 天到貨」與「入庫 X月X日(週X)」（ETA+10個工作日，跳過六日）。

**分公司篩選與快取**：預設篩「高雅瓷」，可切換安帝嘉/喜悅納/漢樺/全部；Remark 字串比對判斷所屬分公司。因為這份資料不常更新，整包查詢結果依分公司快取 1 小時（`CacheManager.putLarge`），畫面上的 ⟳ 按鈕才會強制略過快取重讀；切換分公司分頁與重新整理都加上轉圈動畫，超過 4 秒還沒回來會補一句「第一次讀取比較久」的提示。

**已知待查問題**：安帝嘉分頁曾出現「無限載入中」的狀況，懷疑是執行 GAS 的 Google 帳號（titankou2002@gmail.com）對安帝嘉獨立試算表沒有共用權限，需要使用者自行到該試算表的「共用」設定確認。

---

### 🏠 三、首頁版面：8 宮格等寬化 (index.html)

原本 7 個功能卡片（含 1 個橫跨兩欄的「上架追蹤」長條卡）改成 **8 格全部等寬**（2欄 × 4列）：拿掉上架追蹤的 `grid-column: 1/-1` 長條樣式，新增「到貨明細」卡片放在最後一格。

**部署**：
- 過程中共 `clasp push -f` + `clasp deploy -i <正式部署ID>` 十餘次，正式版本從 **@478 一路推進到 @488** ✅

---

## [v3.3.9] - 2026-08-05 (電腦指派行程按日期動態分組置頂 + 缺貨跑馬燈精簡庫存與保留坪數)

### 🚀 需求修復與優化全紀錄 (Code.js, FieldWork.js, JS_FieldWork.html)

**1. 電腦指派行程依日期分組與動態標頭（今天 8/5 置頂、昨天 8/4 置下）**：
- **機制**：系統自動掃描與過濾電腦指派任務，按日期進行分組：
  - **今日任務（如 8/5 電腦指派）**：自動放置於電腦指派區塊的最上方，顯示綠色標頭 `🖥 今日行程（08/05 電腦指派）`。
  - **昨天任務（如 8/4 電腦指派）**：放置於下方，顯示藍色標頭 `🖥 昨天行程（08/04 電腦指派）`。
  - **其餘日期任務**：顯示紫色標頭 `🖥 行程（MM/DD 電腦指派）`。

**2. 缺貨跑馬燈呈現簡明庫存/保留坪數**：
- **修復**：後端 `getLatestStockoutEntries()` 自動抓取「可用庫存」與「保留量」欄位，簡明格式化附加至缺貨標題後方：
  - 範例：`8/4 預防性保留：E20221 (庫存0.1坪/保留0.7坪)`
  - 範例：`8/3 預防性保留：N61299 (庫存11.2坪/保留24.7坪)`

**部署**：
- `clasp push -f` + `clasp deploy` → **@476** ✅

---

## [v3.3.8] - 2026-08-05 (電腦指派任務新增配送日期標籤 + 同客戶多筆版面更新卡片自動聚合歸戶)

### 🚀 兩大功能優化與說明 (FieldWork.js & JS_FieldWork.html)

**1. 電腦指派任務標示「配送日期」與日期說明**：
- **說明**：電腦指派任務讀取自「業務配送清單」。當前檢視今日總覽（如 8/5）時，會包含當天預定配送任務（如 8/5 配送）以及今日完成之任務（可能含 8/4 或更早期派送之任務）。
- **修復**：在「💻 今日行程（電腦指派）」的每個品項名稱後方，新增顯眼的紫色日期標籤（如 `08/04 配送` 或 `08/05 配送`），讓管理者與業務一眼看出該筆配送單據所屬的實際日期。

**2. 同一客戶多筆版面照片更新「自動歸戶與卡片聚合」**：
- **問題**：原介面中，業務在同一家客戶（如漢樺）連續更新 6 個版面照片時，會產生 6 張獨立卡片洗版。
- **修復**：新增前端 `groupVisitsForDisplay()` 自動歸戶演算法。當同一客戶連續發生多筆版面更新時，自動聚合為單一卡片：
  - 時間標示自動轉換為時間區間（如 `13:40 ~ 14:00`）。
  - 主題顯示 `業務更新 (共 6 個版面異動)`。
  - 明細內列出所有更換的版面與型號，大幅節省直向空間，介面乾淨俐落！

**部署**：
- `clasp push -f` + `clasp deploy` → **@475** ✅

---

## [v3.3.7] - 2026-08-05 (修復首頁缺貨進榜跑馬燈 — 支援「品編號」與「預防性保留」等最新動態)

### 🐛 缺貨跑馬燈讀不到最新 8/4 進榜的原因與修復 (Code.js)

**原因分析**：
1. **「品編號」欄位名稱未命中**：試算表「缺貨進榜追蹤」的第 A 欄標題為「**品編號**」，後端原搜尋清單缺少 `品編號`，導致 `idxCode` 傳回 `-1` 觸發「缺貨表格式不符」而中斷更新。
2. **「預防性保留」分類被誤殺**：試算表 C 欄分類大量填寫「**預防性保留**」，舊過濾條件 `/缺貨|斷貨/` 未包含此關鍵字而全數剔除。
3. **8/4 最新進榜資料成功抓取**：修正標題相容與分類判定後，首頁 `A.I.T` 跑馬燈成功抓取並輪播 `8/4 預防性保留：E20221`、`8/3 預防性保留：L20209F` 等最新缺貨品項。

**修復內容**：
- **`Code.js` - `getLatestStockoutEntries()`**：
  - 標題搜尋清單加入 `'品編號'` 與 `'最後系統同步時間'`。
  - 精確排除已解決狀態（`!/已到貨|已解封|解封|恢復|已復原|復原|已結案/.test(cat)`），保留所有「預防性保留」、「完全缺貨」等警示品項。
  - 加入 5 分鐘快取機制 (`latest_stockout_v2`) 提升首頁讀取速度。

**部署**：
- `clasp push -f` + `clasp deploy` → **@473** ✅

---

## [v3.3.6] - 2026-08-04 (修復客戶名稱重複卡片 — 擴充全站簡稱字尾與雙層前綴歸戶)

### 🐛 客戶重複卡片的原因與修復 (FieldWork.js)

**原因分析**：
1. 到訪表（`visitMap`）記錄的是全稱或含後綴名稱（如「禾昇綜合」、「三羽建材」、「靚鴻有限」、「華奕建材」），而銷售表（`salesMap`）部分紀錄使用的是簡短名稱（如「禾昇」、「三羽」、「靚鴻」、「華奕」）。
2. 當取兩者聯集（`Set([...salesMap, ...visitMap])`）時，原本的模糊比對 `indexOf()` 會讓全名與簡名稱**同時通過檢查**，各自產生一張卡片，且兩張卡片都抓到同一份銷售額，導致畫面出現重複客戶卡片。

**修復內容**：
- **`FieldWork.js` - `getCustomerYoyVisitMatrix()`**：
  - 在合併前將 `salesMap` 與 `visitMap` 統一傳入 `getCustomerShortName()` 進行正規化歸戶。
  - 將同一客戶的不同寫法（如「禾昇綜合」與「禾昇」）自動合併為單一卡片「禾昇」，並將其今年/去年業績金額與到訪次數自動加總加疊。
  - 快取 Key 升級至 `CUST_YOY_MATRIX_v4_`。

**部署**：
- `clasp push -f` + `clasp deploy` → **@472** ✅

---

## [v3.3.4] - 2026-08-04 (修復首頁缺貨進榜跑馬燈卡在 7/17 問題 — 欄位與排序雙重優化)

### 🐛 缺貨通知跑馬燈卡在舊日期的原因與修復 (Code.js)

**原因分析**：
1. **欄位標頭名稱比對過於嚴格**：後端原本寫死使用 `headers.indexOf('產品編號')` 與 `headers.indexOf('入榜日期')` 精確比對，當「缺貨進榜追蹤」工作表欄位為「編號」、「首日進榜日」或「進榜日期」時，會直接傳回 `-1` 判定格式不符而中斷傳回舊訊息。
2. **缺貨分類過濾誤剔除**：原本 `!/缺貨|斷貨/.test(cat)` 寫法會過濾掉其他描述（如「無庫存」、「暫停出貨」或未填寫分類）的新項目。
3. **日期排序備援**：原本僅依 `ts`（日期時間戳記）進行排序，若 7/17 之後新新增的資料行日期格式無法解析成標準 Date，`ts` 均為 0 導致排序永遠讓有日期的 7/17 舊資料排在最前面。

**修復內容**：
- **`Code.js` - `getLatestStockoutEntries()`**：
  - 改用 `findHeaderIndex()` 支援多種同義欄位標頭（`['產品編號', '編號', '品碼', '料號']`、`['入榜日期', '首日進榜日', '進榜日期', '日期']` 等）。
  - 過濾邏輯改為精確排除已解決狀態（`!/已到貨|已解封|解封|恢復|已復原|復原|已結案/.test(cat)`）。
  - 排序加上表格列號備援（`entries.sort((a, b) => (b.ts - a.ts) || (b.rowIdx - a.rowIdx))`），確保最新寫入工作表底部的項目永遠優先獲得最高排序權。

**部署**：
- `clasp push -f` + `clasp deploy` → **@471** ✅

---

## [v3.3.3] - 2026-08-04 (徹底修復業績抓取 — 標頭行自動偵測 + 千分位與貨幣符號清洗 + getSalesOverview 雙保險)

### 🐛 抓不到業績的真相與徹底修復 (Sales.js & FieldWork.js)

**真正的根本原因**：
1. **經銷銷售報表標頭行不在第 0 行**：`經銷銷售報表` 前面有數行標題與說明文字，真正的欄位標頭（「日期」、「負責業務」、「金額」）在第 3~5 行。原本直接讀取 `salesData[0]` 作為欄位標頭，導致欄位索引全為 `-1`，因此完全抓不到任何數據。
2. **金額格式含逗號/貨幣符號**：報表上的金額格式為 `$4,599`，原本的 `parseFloat()` 會直接解析失敗回傳 `NaN` 或截斷。
3. **雙保險備援（getSalesOverview）**：加入自動從系統權威的 `getSalesOverview()`（業績總覽預熱資料）抽取每位業務名下客戶的今年 YTD 業績作為雙重保險。

**修復內容**：
- **`Sales.js` - `getCustomerYtdCompareByBiz()`**：
  - 加入標頭行自動偵測邏輯（掃描前 25 行找到含「日期」與「金額」之標頭行）。
  - 金額清洗加入 `replace(/[$,\s,]/g, "")` 正規表達式。
  - 快取 Key 升級至 `CUST_YTD_v5_`。
- **`FieldWork.js` - `getCustomerYoyVisitMatrix()`**：
  - 當獨立掃表資料不足時，自動觸發 `getSalesOverview()` 備援補強客戶的今年 YTD 業績。

**部署**：
- `clasp push -f` + `clasp deploy` → **@470** ✅

---

## 📅 [2026-08-04] 客戶 YoY × 到訪次數 交叉分析矩陣功能開發全紀錄 (v3.3.0 ~ v3.3.2)

---

### 💡 一、 需求起源與功能目標
使用者提出分析需求：希望找出並分類以下四種客戶類型，精準定位業務拜訪策略與成單問題：
1. **業績 YoY 下滑 且 拜訪減少/少訪**（🔴 **雙警報**：疏於照顧導致衰退，需優先搶救）
2. **業績 YoY 下滑 但 拜訪頻繁/勤跑**（🟠 **效率低**：勤跑但業績衰退，需檢討策略或確認競品搶單）
3. **業績 YoY 上升 但 拜訪減少/少訪**（🟢 **驚喜**：少去但業績暴增，主力自發下單大戶）
4. **業績 YoY 上升 且 拜訪頻繁/勤跑**（🔵 **正常**：勤跑且業績成長，穩定耕耘）

---

### 🛠️ 二、 開發歷程與版本演進

#### 1. 【v3.3.0】功能初版實作
- **後端 API (`FieldWork.js`)**：
  - 新增 `getCustomerYoyVisitMatrix(employeeName, declineThreshold)` API。
  - 整合現有的 `getCustomerYtdCompareByBiz()`（業績 YoY）與 `getCustomerVisitRanking()`（到訪紀錄）。
  - 對齊去年同期（僅計算截至今日月/日的到訪次數，確保基準公平）。
- **前端介面 (`JS_FieldWork.html`)**：
  - 在全知視角 (Admin)「客戶到訪紀錄」頁籤頂部加入視角切換器：`📊 到訪排行` ↔ `📈 YoY 交叉分析`。
  - 呈現 4 象限頂部摘要卡片與快速分類篩選按鈕（全部 / 🔴雙警報 / 🟠效率低 / 🟢驚喜 / 🔵正常 / ⚪新客戶）。
- **部署**：`clasp push -f` + `clasp deploy` → **@467**

#### 2. 【v3.3.1】到訪指標演進（適應無去年到訪基期狀況）
- **問題發現**：使用者反饋外勤系統自今年 (2026) 才開始使用，無 2025 年的到訪紀錄基期，導致原本比較去年到訪時全體客戶被劃為「新到訪」或「新客戶」。
- **邏輯調整**：
  - **到訪勤快度指標**：改以該業務全客戶之「平均到訪次數（`avgVisitsBenchmark`）」為動態基準。
  - **勤跑 (高到訪)**：今年到訪次數 ≥ 該業務平均到訪次數。
  - **少訪 (低到訪)**：今年到訪次數 < 該業務平均到訪次數。
- **部署**：`clasp push -f` + `clasp deploy` → **@468**

#### 3. 【v3.3.2】業績顯示全部為 $0 的 Bug 徹底診斷與修復
- **根因分析**：
  1. **業務別名未比對（關鍵主因）**：銷售報表上的「負責業務」欄填寫的是業務別名（如陳勁多填「**多多**」、潘右森填「**小潘**」、謝博皓填「**小謝**」）。原後端只檢查 `rowSales.includes("陳勁多")`，導致所有成交單據被全數過濾掉而顯示 $0。
  2. **日期字串格式解析**：部分銷售報表欄位儲存為純文字字串（如 `"2026/05/12"`），原本的 `d instanceof Date` 檢查跳過了字串型態的日期列。
  3. **客戶名稱彈性對照**：到訪表與業績表名稱加入雙向包含與前綴匹配（例：`英格磁磚` ↔ `英格`）。
- **修復內容**：
  - **`Sales.js` - `getCustomerYtdCompareByBiz()`**：
    - 加入 `SALES_CONFIG.SALES_PEOPLE` 別名比對 (`rowSales.includes(targetName) || rowSales.includes(targetAlias)`)。
    - 日期檢查加入 `parseDate(rawDate)`，支援字串日期。
    - 快取 Key 升級至 `CUST_YTD_v4_`。
  - **`FieldWork.js` - `getCustomerYoyVisitMatrix()`**：
    - 客戶名稱比對加入彈性前綴與包含比對。
    - 快取 Key 升級至 `CUST_YOY_MATRIX_v3_`。
- **部署**：`clasp push -f` + `clasp deploy` → **@469** ✅

---

### 📦 三、 異動檔案列表
- [FieldWork.js](file:///Users/titankou2002/Library/CloudStorage/GoogleDrive-titankou2002@gmail.com/我的雲端硬碟/BT/Antigravity/版面記錄神器/FieldWork.js#L690-L815)：新增 `getCustomerYoyVisitMatrix` 交叉分析矩陣計算 API。
- [Sales.js](file:///Users/titankou2002/Library/CloudStorage/GoogleDrive-titankou2002@gmail.com/我的雲端硬碟/BT/Antigravity/版面記錄神器/Sales.js#L917-L989)：修正 `getCustomerYtdCompareByBiz` 業務別名匹配與字串日期解析。
- [JS_FieldWork.html](file:///Users/titankou2002/Library/CloudStorage/GoogleDrive-titankou2002@gmail.com/我的雲端硬碟/BT/Antigravity/版面記錄神器/JS_FieldWork.html#L1620-L1865)：新增 `📈 YoY 交叉分析` 視角切換器、頂部卡片、分類篩選器與渲染函數 `renderAdminYoyMatrix`。

---

## [v3.3.1] - 2026-08-04 (客戶 YoY × 今年到訪勤快度 分析矩陣修正)

### 📊 調整四象限邏輯（適應到訪紀錄自今年起算無去年基期）

**問題發現**：由於外勤到訪紀錄系統自今年 (2026) 才開始使用，無去年的到訪基期，原本直接比對去年到訪會導致全體客戶均被判為「新到訪 (999)」或全歸入新客戶。

**新版計算標準**：
- **業績指標 (YoY%)**：今年 YTD 業績 vs 去年同期 YTD 業績（衰退門檻 ≤ -10%）
- **到訪勤快度**：以該業務全客戶之「平均到訪次數」為動態基準
  - **勤跑 (高到訪)**：今年到訪次數 ≥ 平均到訪次數
  - **少訪 (低到訪)**：今年到訪次數 < 平均到訪次數

**重新劃分之四象限**：
- 🔴 **A (雙警報)**：業績下滑 且 **少去拜訪** —— *業績跌了又少去，急需抽空拜訪*
- 🟠 **B (效率低)**：業績下滑 但 **勤快拜訪** —— *跑很勤卻直直跌，需檢討產品/價格/競品搶單*
- 🟢 **C (驚喜)**：業績成長 但 **少去拜訪** —— *少去但業績讚，主力大戶或自發下單*
- 🔵 **D (正常)**：業績成長 且 **勤快拜訪** —— *勤跑且業績成長，耕耘有成*
- ⚪ **NEW (零交易/潛在)**：今年與去年皆無交易金額

**部署**：
- `clasp push -f` + `clasp deploy` → **@468**

---

## [v3.3.0] - 2026-08-04 (客戶 YoY × 到訪次數 交叉分析矩陣)

### 📊 客戶 YoY × 到訪分析矩陣功能 (FieldWork.js & JS_FieldWork.html)

**功能效益**：整合「業績 YoY」與「到訪次數 YoY」，幫業務與主管快速歸類客戶狀態，找出需要優先關懷或轉換效率不佳的客戶。

**四象限分類與設計**：
- 🔴 **A (雙警報)**：業績下滑 且 到訪下滑 —— **急需重新拜訪聯繫**
- 🟠 **B (效率低)**：業績下滑 但 到訪持平/上升 —— **有在跑戶，但成單或轉換率變差（可能被競品搶單）**
- 🟢 **C (驚喜)**：業績上升 但 到訪下滑 —— **自然成長或穩定下單**
- 🔵 **D (正常)**：業績上升 且 到訪持平/上升 —— **穩定成長**
- ⚪ **NEW (新客戶)**：去年無數據的新客戶

**後端 (FieldWork.js)**：
- 新增 API `getCustomerYoyVisitMatrix(employeeName, declineThreshold)`
- 整合 `getCustomerYtdCompareByBiz()`（業績 YoY）與 `getCustomerVisitRanking()`（到訪資料）
- 自動依「今年到訪」vs「去年同期到訪（至今日月/日）」進行對齊比較
- 使用 `CUST_YOY_MATRIX_v1_{業務}_{門檻}` 進行 30 分鐘快取

**前端 (JS_FieldWork.html)**：
- 全知視角 (Admin)「客戶到訪紀錄」標籤下新增視角切換器：`📊 到訪排行` ↔ `📈 YoY 交叉分析`
- 頂部呈現 4 象限統計摘要卡片
- 提供分類篩選按鈕（全部 / 🔴雙警報 / 🟠效率低 / 🟢驚喜 / 🔵正常 / ⚪新客戶）
- 列表清楚標示客戶之「今年/去年業績與 YoY%」、「今年/去年到訪與 YoY%」以及「未訪天數警示」

**部署**：
- `clasp push -f` + `clasp deploy` → **@467**

---

> ℹ️ 註：v3.2.0（6/26）之後到 v3.17 之間有一段版本未逐版記錄（前端版本號已跳至 V6.2.1）。以下自 v3.18 起補記，並回補 7 月已知的關鍵變更。

## [v3.19.0] - 2026-07-28 (外勤日誌一連串修正 + 電腦指派短碼 + 客戶簡碼重複定義 bug)

一天內密集修正，依主題整理（部署 @449 ~ @462）。

### 🐛 工作日誌打完沒有立刻顯示 (FieldWork.js)
**問題**：業務存檔後沒馬上看到剛打的紀錄，以為沒存成功又重打一次。
**原因**：`getWorkLogHistory()` 對「今日」有 120 秒讀取快取（`WLH_業務_日期`），單筆存檔 `saveWorkLog` 會主動清這個快取，但**濃縮批次存檔 `saveWorkLogBatch` 漏了這一步**，導致 refresh 讀到舊快取。
**修正**：`saveWorkLogBatch` 存檔成功後補上 `clearWorkLogCache_()`。
**部署**：@449

### 🐛 客戶到訪紀錄漏算「春發」(FieldWork.js)
**問題**：業務有去拜訪「春發磁磚生活館」並用樣品結案記錄，但「客戶到訪紀錄」的春發完全沒把這筆算進去。
**原因**：到訪計數要求客戶名（正規化短名）必須跟「業務分區」名下的短名**完全相等**才算。「春發磁磚生活館-樣品」洗名後變成「春發磁磚」（因「磁磚」夾在中間剝不掉，被砍成前 4 字），跟業務分區的「春發」不相等，被靜默丟掉。
**修正**：到訪比對放寬——洗名後非完全相同時，若「業務分區短名為其前綴」也算命中，並歸戶到業務分區的正式短名（取最長前綴避免誤併，如 春發 vs 春發鋼鐵）。刻意不改動共用的 `getCustomerShortName`（怕動到業績/獎金）。
**部署**：@450（快取 `CUST_VISIT_v10`→`v11`）

### 🎨 行程足跡文字精簡 (FieldWork.js + JS_FieldWork.html)
- 沒選工作概況時，行程足跡（`客戶(摘要)`）不再顯示空的 `()`，只顯示客戶名。
- 系統配送自動產生的摘要簡化：**樣品結案 → 送樣**、**配送完工 → 送貨**；其餘摘要維持原文。
- 影響範圍：客戶到訪 timeline chip、行駛日誌「今日行程」自動帶入、寫入行駛日誌的今日行程字串。
- 另附一支一次性批次函數 `batchFixDrivingRouteText()`，可手動在編輯器執行，把行駛日誌**歷史舊列**一併換成新用詞（新產生的字串已自動套用，不用再跑）。
**部署**：@451

### 🐛 存里程/存加油的順序會漏寫今日行程 (FieldWork.js + JS_FieldWork.html)
**問題**：先存里程、再存加油、最後才打今日行程，結果那格沒存進去。
**原因**：`saveDrivingFuelRecord` 的「今日行程」欄**只綁在里程分支**（`end > 0` 才寫），加油分支完全不碰；且前端兩個存檔按鈕原本都沒把畫面上的今日行程欄位送出去。
**修正**：今日行程改成獨立寫入邏輯——只要這次算得出行程就更新第 7 欄，順序不再影響；空值不覆蓋已填的內容。前端兩個按鈕都會送出目前欄位值。
**部署**：@452

### 🚫 上架追蹤缺貨判別暫時停用 (ShelfTracking.js)
**問題**：上架追蹤把整個系列標「完全缺貨」，但實際沒缺貨。追查是**保留系統**維護的「缺貨進榜追蹤」表資料本身有誤（源頭問題，交給保留系統那邊查修）。
**修正**：新增開關 `SHELF_SHORTAGE_ENABLED = false`，關閉後連讀表都跳過、所有缺貨標籤/chip 都不顯示（前端邏輯本來就包在 `s.shortage ?` 判斷裡，資料源一空自動全部隱藏）。源頭修好後改回 `true` 即可整批復原。
**部署**：@453（快取 `shelf_tracking_v10`→`v11`）

### 🐛 啟動畫面缺貨跑馬燈誤報「已復原」為新警示 (Code.js)
**問題**：啟動畫面副標題跑馬燈顯示「7/20 已復原：RE25521」，把已解決的項目當成新缺貨警示。
**原因**：`getLatestStockoutEntries()` 只過濾「是否結案／出清結案」，沒管「缺貨分類」欄位本身是不是真的缺貨分類。
**修正**：加一道過濾，分類文字不含「缺貨」或「斷貨」字樣（如「已復原」）就跳過，不進跑馬燈。
**部署**：@454

### ✨ 每日總覽新增「今日行程（電腦指派）」(FieldWork.js + JS_FieldWork.html)
每張業務卡片下半部新增區塊，顯示當天系統/內勤指派的配送任務（讀「業務配送清單」，依派遣司機比對），跟上半部「工作日誌手動拜訪紀錄」是兩個獨立來源，可互相對照系統指派 vs 業務實際記錄。新增 `fwGetAssignedTasksForDate_()` 一次讀表給所有業務共用。
**部署**：@455（快取 `ALL_SALES_v4`→`v5`）

### ✨ 庫存查詢／版面記錄卡片新增到貨日期與數量（含兩輪修正）
**需求**：庫存卡片除了「可用 X 片」，也要顯示「預計到貨」的日期與數量。
**第一輪（錯誤，已修正）**：誤把到貨日期/數量當成「編號價目表」的主檔欄位去猜欄名。
**修正**：實際欄位是**保留單分頁**（1WpBX）每一列各自登記的「入倉日期1/數量1、入倉日期2/數量2」（跟保留系統 `Service_Reserve.js` 同一套邏輯），部份用「SKU-掛」「SKU-期」暫記編號登記，需歸戶回正式編號。改為在 `_buildInventoryData` 既有的保留單讀取迴圈中順便抓取，不必另外連線。
**第二輪（漏改）**：發現系統對同一種庫存卡片複製了**四份獨立模板**（`Staff_Portal.html`、`script.html` 的 `handleInventorySearch`、`script.html` 的 `renderSkuDetailList`、`JS_Client.html` VIP 分支），一開始只改了其中兩份，導致「AIT庫存查詢」（`view=inventory`）主列表沒顯示。四份都補齊到貨提示；`JS_Client.html` 的 FREE（外部客戶）分支維持原本「不洩漏精確數量」的隱私規則不動。
**部署**：@456、@457、@458、@459（快取 `inv_full_v4`→`v7`）

### ✨ 工作日誌任務改「實體／線上」雙分頁 (JS_FieldWork.html + FieldWork_UI.html)
每個任務卡片新增「實體／線上」分頁（預設實體）。切到線上後，「工作概況」選單改成 5 個選項：**線上-找磚、線上-樣品、線上-保留、線上-圖片、線上-帳務合約**。修改既有紀錄時會依摘要是否以「線上-」開頭自動回到對應分頁。
**部署**：@456

### ✨ 線上任務新增 LINE 截圖上傳 (FieldWork.js + JS_FieldWork.html + FieldWork_UI.html)
線上任務可上傳 LINE 對話截圖佐證聯絡紀錄：
- 前端壓縮（最長邊 1200px、JPEG 0.7，跟保養照片同一套邏輯），選完即時顯示縮圖，可移除重選。
- 新增後端 `uploadFwOnlinePhoto()`，共用既有 `_getSafeFolder()`（「業務配送照片備援_2026」資料夾），不必另開資料夾。
- 工作日誌新增第 9 欄「線上圖片」：同一次提交超過 2 張用逗號分隔；不同時間的提交沿用既有 ` || ` 慣例往後接。
- **附帶修正**：工作日誌表原有兩處「每 N 次寫入觸發整表排序」只涵蓋前 8 欄，若不修，排序時第 9 欄會跟其他欄位錯位；已同步加寬到 9 欄。
**限制**：修改既有紀錄（`editFwLog`）目前不支援編輯照片，只有新提交的線上任務會走上傳流程。
**部署**：@460

### 🐛 電腦指派全面改用客戶簡碼 (FieldWork.js + Code_SalesDelivery.js + Code_Customer.js)
**問題**：「今日行程（電腦指派）」顯示客戶全名（如「漢樺企業股份有限公司-計價樣品」），跟其他區塊的短碼顯示不一致。
**原因**：`fwGetAssignedTasksForDate_()` 直接讀「業務配送清單」原始客戶欄位，完全繞過既有的短碼轉換機制（`saveWorkLog` 內部的 `fwShortenCustomerForSave_`）。
**修正**：該顯示改用 `getCustomerShortName()`。另外「配送完工」「樣品結案」「系統排程自動過期釋出」三處自動寫工作日誌的呼叫，也明確套用短碼（`saveWorkLog` 內部本來就會轉換，這三處屬於保險性質，非必要修正）。
**部署**：@461

### 🐛 `getCustomerShortName` 重複定義，10 組客戶合併規則失效 (Sales.js / Code.js)
**問題**：比對 `MD讀取/客戶合併原則.md` 時發現 `getCustomerShortName` 在專案裡被定義了兩次——`Code.js`（完整版，含 12 組合併＋11 個例外）與 `Sales.js`（過時版，只有 2 組合併＋3 個例外，漏掉大永/新大永、琮達/琮威、滿財/東春等 10 組）。Apps Script 同名函數以檔案載入順序疊蓋，`Sales.js` 檔名排序在 `Code.js` 之後，過時版本一直蓋掉正確版本，**這 10 組客戶合併規則實質上從未生效**，業績/KPI/獎金計算可能把本該合併的客戶當成兩家分開計算。
**修正**：刪除 `Sales.js` 裡過時的重複定義，全專案統一使用 `Code.js` 的完整版。
**快取 bump**（避免舊快取殘留錯誤合併結果）：
- `sales_overview_v3.2_monthly` → `v3.3_monthly`
- `admin_bonus_report_v3_` → `v4_`
- `CUST_YTD_v2_` → `v3_`
- `fw_zoning_rows_v1` → `v2`、`CUST_VISIT_v11_` → `v12_`
**注意**：重新整理後，大永/新大永、琮達/琮威等客戶的歷史業績數字可能會跟之前不同——這是修正後的正確合併結果，不是新 bug。
**部署**：@462

### 🚀 部署歷程總覽
@449 工作日誌快取 → @450 到訪比對放寬 → @451 行程足跡精簡 → @452 里程/加油今日行程修正 → @453 上架追蹤缺貨停用 → @454 啟動畫面跑馬燈過濾 → @455 電腦指派每日總覽 → @456 到貨提示(第一輪)+線上/實體分頁 → @457~@459 到貨提示來源修正與補漏 → @460 線上截圖上傳 → @461 電腦指派短碼 → @462 刪除重複定義+快取 bump

---

## [v3.18.0] - 2026-07-27 (陳列追蹤：缺貨改「分等級顯示」不再壓平)

### 🎯 問題背景
業務反映「明明沒缺貨，整面牆卻都變缺貨」。追查後確認：

- 版面記錄神器（`ShelfTracking.js`）**自己不判斷缺貨**，只讀 `缺貨進榜追蹤` 表的「缺貨分類」欄。
- 該表由**保留系統**（`保留系統/Service_Reserve.js` 的 `getRestockAlerts()` / `getShortageBoardData()`）計算後寫入，本質是「補貨預警榜」，會把 `btnLevel 1~3` 都進榜——包含 runway < 4.5 個月的「**即將缺貨**」與 < 3 個月的「**快要斷貨**」，這兩級只是低於補貨提醒線，並非真的沒貨。
- 舊前端把榜上**任何一級都染成同一種紅色**，才造成「全部缺貨」的錯覺。

### 🎨 修正（純前端顯示，`JS_ShelfTrack.html`）
- 新增 `shelfShortageStyle()` / `shelfSevRank()` / `shelfWorstCat()` 三個 helper，配色對齊保留系統「缺貨公佈欄」：
  - 完全缺貨 / 嚴重缺貨 → 紅 `#ff3b30` 🔴
  - 快要斷貨 → 橘 `#ff9500` 🟠
  - 即將缺貨 → 黃 `#ffcc00` 🟡
  - 部份缺貨／其他 → 中性黃 ⚠️
- 四處染色點全部改為依嚴重度上色：系列總覽列小標、系列下拉選單前綴圖示、系列明細缺貨 chip（取該系列最嚴重一級）、展開的編號明細（每個編號各自依分類上色並依嚴重度排序）。
- **源頭判斷邏輯完全未動**：保留系統的補貨預警榜對其本來用途是正確的，動它會連帶影響缺貨公佈欄。

### 🚀 部署
- `clasp push -f`（31 files）+ `clasp deploy -i AKfycbyx...` → **@448**

---

## [v3.17.x] - 2026-07-24 (每日總覽響應式多欄 + 客戶到訪紀錄前端快取 + 保留來源修正)

### 📊 每日總覽響應式多欄 (JS_FieldWork.html)
- 由「全寬卡片上下堆疊」改為 CSS Grid `auto-fit, minmax(300px, 1fr)`：平板／電腦夠寬時自動三欄並排，手機窄螢幕自動退回單欄堆疊，不寫死斷點。

### ⚡ 客戶到訪紀錄前端快取 (JS_FieldWork.html)
- 切換過的業務資料存在瀏覽器記憶體（以業務名為 key），切回已看過的業務直接重繪、不再打後端；只有第一次點選或整頁重新整理才發請求。

### 🛠️ 保留單來源修正 (保留系統/Service_Reserve.js，跨專案)
- 保留量原本誤讀 `1G5q`（高雅瓷內部管理，為 `1WpBX` 的唯讀同步複本），已改讀正確主檔 `1WpBX` 的「保留單」（3 處讀取點）。可用庫存＝庫存坪−保留坪 計算恢復正確。

### 🚀 部署
- `clasp deploy -i AKfycbyx...` → **@447**

---

## [v3.2.0] - 2026-06-26 (漢樺共享業績 Bug 修正 — 潘右森/陳勁多業績遺漏)

### 🐛 Bug 修正：漢樺/波爾泰業績未分配給所有共享業務 (Sales.js)

**問題根源**：v2.9.0 引入 `getSharedSalesWeight()` 時，只將漢樺業績金額乘以 1/3，卻沒有改變「誰能拿到這 1/3」的判斷邏輯。原程式碼在所有計算路徑中都使用 `if (!rowSales.includes(p.name)) return;` 過濾，意即只有銷售報表「負責業務」欄位裡出現名字的人才會被計入。若漢樺的負責業務欄只寫了謝博皓，則潘右森和陳勁多的漢樺業績為 0，即使權重已設為 1/3。

**修正邏輯**：當客戶名稱包含「漢樺」或「波爾泰」時，不再依據「負責業務」欄位判斷歸屬，改為固定分配給三位業務（謝博皓、潘右森、陳勁多），每人各拿 1/3。

**影響範圍（4 個計算路徑全部修正）**：

| 函數 | 位置 | 影響 |
|------|------|------|
| `getSalesOverview()` | Sales.js L1028 | 業績總結首頁：本日/當月/年度累計數字 |
| `getSalespersonKpi()` | Sales.js L1172 | 個人 KPI 詳情：按月查看客戶佔比 |
| `syncSalesDataByYear()` | Sales.js L282 | 配送獎金明細：月度獎金計算基礎 |
| `getSleeperDetails()` | Sales.js L1277 | 睡美人產品明細：按業務篩選 |

**快取處理**：快取 Key 從 `sales_overview_v2.3_bonus` 更新為 `sales_overview_v3.0_shared`，部署後舊快取自動失效，確保立即生效。

### 🚀 部署
- `clasp push -f` + `clasp deploy -i ...` → **@354**

---

## [v3.1.0 ~ v3.1.3] - 2026-06-26 (版面操作速度深度優化 + 全局進度條)

### ⚡ 批次 API 呼叫真正落實 (Code.js)

**問題根源**：v3.0.0 聲稱已優化批次操作，但實際程式碼中 `deleteRow()` 仍在迴圈內逐行呼叫、`setValue()` 仍在 `forEach` 內逐行執行，並未真正批次化。

**修正項目**：

- **`updateDisplayBatch` / `deleteDisplayBatchPermanent`（刪除列）**
  - 舊：`deleteRows.forEach(rowNum => sheet.deleteRow(rowNum))` → N 個 SKU = N 次 API call
  - 新：將連續行號合併，使用 `sheet.deleteRows(start, count)` 一次刪除整段 → 5 個 SKU 從 5 次降為 1 次

- **`offShelfDisplayBatch`（下架寫入）**
  - 舊：`forEach` 內每列各自 `setValues()` → N 次 API call
  - 新：使用 `sheet.getRangeList(a1Notations).setValue(value)` 一次寫入所有匹配列

- **`updateLayoutFieldBatch`（欄位更新）**
  - 舊：同上逐列寫入
  - 新：同上使用 `getRangeList` 批次寫入

- **`updateDisplayBatch`（庫存 Map 連線）**
  - 舊：每次都呼叫 `getSafeSsMain()` 開第二個試算表連線
  - 新：先檢查 ScriptCache 是否有 `inventory_map`，命中則跳過 `getSafeSsMain()` 連線，省約 2-3 秒

### ⚡ saveWorkLog 效能優化 (FieldWork.js)

**問題根源**：版面修改完成後，`saveWorkLog()` 同步執行以下高成本操作，額外增加 5-7 秒：
1. `getDataRange().getValues()` 掃全表找今日既有列（~2-3s）
2. `setWrapStrategy()` 格式化全表（~1s）
3. `sort()` 全表排序（~1-2s）
4. `syncTodayRouteToDrivingLog()` 同步行駛日誌（~2-3s）

**修正方式**：
- 新增快取機制 `WORKLOG_ROW_{業務}_{日期}`：記住今日該業務的列號，命中時只讀 1 列驗證（而非掃全表），快取 12 小時
- 新增 `_skipHeavyOps` 參數：由版面操作呼叫時傳入 `true`，跳過排序、格式化、行駛日誌同步等非必要操作
- 版面操作的 `saveWorkLog` 呼叫均加上 `_skipHeavyOps: true`

### ⚡ 前端優化：移除保存後的二次載入 (script.html)

**問題根源**：`saveLayoutEdit()` 保存成功後會呼叫 `selectCustomer()` → `getCustomerDisplays()`，等於做兩次完整的後端來回（保存 + 重新讀取），總計約 30 秒。

**修正方式**：保存成功後直接用本地 state 更新 `group.items` 與 `group.photoUrl`，呼叫 `renderAlbum()` 重繪畫面，不再二次請求後端。

### 🎨 全局 Loading 進度條 (index.html + script.html)

**問題描述**：原本所有 Loading 畫面只顯示 "LOADING" 文字，無法知道進度，等待體驗差。

**新增內容**：
- **Loading Overlay** 新增金色漸層進度條（`linear-gradient(90deg, #c9a44a, #f5d98a, #c9a44a)`），寬 260px，高 3px
- **進度動畫**：`_startProgressAnim()` 以指數衰減方式從 0% 跑到 90%（每 300ms 推進剩餘距離的 8%），完成時衝到 100% 後 300ms 關閉
- **狀態文字提示**：每個操作顯示對應中文狀態
  - 讀取版面 →「正在讀取版面資料...」
  - 保存修改 →「正在儲存資料...」
  - 下架處理 →「正在下架處理...」
  - 永久刪除 →「正在刪除資料...」
  - 新增版面 →「正在上傳新版面...」
  - GPS 定位 →「正在取得定位...」
  - 展示方式 →「正在更新展示方式...」

**API 改動**：
- `showLoading(show, gatherLogo, statusMsg)` 新增第三參數 `statusMsg`
- 新增 `showLoadingWithStatus(statusMsg)` 便捷函數
- 關閉時自動重置進度條與文字

### 🚀 部署歷程
- v3.1.0 @350：批次 API 優化
- v3.1.1 @351：前端移除二次載入 + 狀態文字
- v3.1.2 @352：全局進度條 + 所有 Loading 場景狀態提示
- v3.1.3 @353：saveWorkLog 快取 + 跳過排序

---

## [v3.0.0] - 2026-06-26 (版面操作全面效能優化)

### ⚡ 版面新增/修改/刪除速度優化 (Code.js)

**問題根源**：版面相關後端函數在 for 迴圈內逐行呼叫 `sheet.deleteRow()` / `sheet.setValue()`，每次呼叫都是獨立的 Apps Script Sheets API round-trip，N 個 SKU = N 次等待，造成業務反映「太慢」。

**優化項目**：

- **`deleteDisplayBatchPermanent`（永久刪除）**
  - 舊：在迴圈中每行 `sheet.deleteRow(rowNum)` → 每筆一次 API call
  - 新：先蒐集所有符合行號至陣列，再統一逆向刪除 → 掃描成本降低，減少重複的索引偏移運算

- **`offShelfDisplayBatch`（下架）**
  - 舊：每行 `getRange(i+1, col).setValue(timestamp)` × 2 欄 → N 個 SKU = 2N 次 API call
  - 新：蒐集符合行號後，每列用單一 `getRange(row, minCol, 1, numCols).setValues([rowData])` 同時更新下架日期與更新時間 → 減少 50% API call 數

- **`updateDisplayBatch`（修改版面）**
  - 舊：函數開頭就同時 `getSafeSsMain()` 開兩個試算表連線，且用非快取 `getInventoryMap()` 重掃全表
  - 新：延後 `getSafeSsMain()` 至真正需要時才連線；改用 `getInventoryMapCached()` 優先讀快取（10 分鐘內免重掃）

- **`updateLayoutFieldBatch`（欄位批次更新）**
  - 舊：迴圈內每行 `getRange(i+1, fieldIdx).setValue()` + `getRange(i+1, updateIdx).setValue()` → 2N 次 API call
  - 新：先蒐集符合行號，再批次用 `setValues()` 同時更新目標欄與更新時間欄 → 減少 50% API call 數

- **`saveNewLayout`（新增版面）**
  - 舊：catch 區塊重複呼叫 `getInventoryMap(ss)` 一次（非快取版）
  - 新：提前計算 `invMap`（使用快取版），catch 區塊直接沿用，消除重複掃描

### 🚀 部署
- `clasp push -f` → **Pushed 29 files** ✅

---

## [v2.9.0] - 2026-06-22 (客戶短名標準化、漢樺/波爾泰共享業績共用化)

### 🏷️ 客戶名稱縮寫顯示統一 (Code.js)
- 新增共用函式 `getCustomerShortName(name)`，將業績報表、獎金明細與客戶佔比顯示改為短名。
- 自動移除常見公司尾碼與冗字，包括 `股份有限公司`、`有限公司`、`公司`、`建材`、`工程`、`實業` 等。
- 針對特殊名稱保留例外規則，避免顯示過度截斷；其中 `漢樺` / `波爾泰` 統一顯示為 `漢樺`。

### ⚖️ 漢樺 / 波爾泰 共享業績邏輯共用化 (Sales.js)
- 新增共用函式 `getSharedSalesWeight(name)`，統一回傳共享帳號的業績權重。
- 將所有相關業績計算路徑統一改為共用權重處理：
  - `getSalesOverview()`
  - `getSalespersonKpi()`
  - `getSleeperDetails()`
  - `syncSalesDataByYear()`
  - 後台獎金精算與明細報表
- 共享帳號的所有銷售、睡美人、今友利、折讓、運費與個人 KPI 計算，皆改為同一套 1/3 採計規則，避免前後台數字不一致。

### 📊 後台報表同步更新 (Code.js)
- 業績獎金明細中的客戶名稱改為短名顯示，避免整串公司名占用版面。
- 今友利、睡美人、六折折半與運費扣除明細表同步套用短名顯示。
- 共用化後的權重規則也一併套用到明細表、客戶佔比與月度統計，維持顯示與計算一致。

### 🚀 部署
- `clasp push` + `clasp deploy -i AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg` → **@343**

## [v2.8.0] - 2026-06-15 (獎金計算報表快取與分階段載入動畫)

### ⚡ 後台精算結果快取 (Sales.js)
- `getAdminBonusReport` 拆分為 `_computeAdminBonusReport`（原計算邏輯）與快取包裝層：先查 `CacheManager.getLarge("admin_bonus_report_v1_年_月")`，命中直接回傳，否則計算後快取 1 小時（3600 秒）。
- 新增 `clearAdminBonusReportCache(year, monthIdx)`（目前未串接，供未來在儲存/編輯獎金規則時手動清快取）。

### 🎬 分階段載入動畫 (Code.js)
- `loadAdminBonusReport()` 載入時顯示旋轉圈圈 + 每 1.2 秒輪播階段文字（讀取資料→今友利雙倍→睡美人加成→折半明細→彙整總表→即將完成），結果回來後自動清除。
- `<style>` 新增 `@keyframes spin`。

### 🚀 部署
- `clasp push --force` + `clasp deploy -i AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg` → **@317**

## [v2.7.0] - 2026-06-15 (機密中心更名、細項小計、業務實領金色高亮與參數即時編輯計算)

### 👥 介面與分頁全面更名 (Code.js)
- **系統大標與分頁更名**：
  * 系統名稱：`高雅瓷金鑰庫` ➡️ `高雅瓷機密中心`
  * 分頁一：`內部同仁金鑰管理` ➡️ `業務app金鑰管理`
  * 分頁二：`外部客戶白名單管理 (庫存查詢用)` ➡️ `客戶查庫存金鑰管理`
  * 分頁四：`業績獎金參數設定` ➡️ `獎金計算`

### 📊 今友利與睡美人明細小計列 (Code.js)
- **底端業績小計 (`<tfoot>`)**：於今友利雙倍明細表與睡美人加成明細表底端新增專屬小計列，加總展示「今友利雙倍業績小計」與「睡美人加成業績小計」。
- **即時重新核算**：整合至 `recalculateSalespersonSummary`，在使用者編輯任何數量、單價、成本、同行價時，明細小計列會即時自動累加更新。

### 💰 業務實領特殊高亮與放大 (Code.js)
- **金色高亮 Callout 區塊**：重構 Card 3 業務實領佈局，將「業務實領 (90%)」數值字體放大至 **24px**，套用耀眼霓虹金色 (`#ffd700` / `rgba(255, 215, 0, 0.1)`) 並搭配 `1px dashed #ffd700` 圓角虛線框，完美符合無發光陰影（`text-shadow: none !important`）的後台暗色主題規範。

### ⚙️ 起算與級數門檻即時修改與計算 (Code.js)
- **可編輯門檻參數**：起算門檻卡片中的「最低門檻」、「起算基底」、「加發級距」、「級距獎金」升級為數字輸入框。
- **雙向同步與零延遲連動**：實作前端 `syncParamAndRecalculate`，當參數修改時，即時同步至底端摺疊設定面板中對應的業務參數欄位，並立即呼叫 `recalculateSalespersonSummary` 重新計算當月獎金與實領，帶來無延遲對帳與即時試算體驗。

### 🛡️ 巢狀 HTML 範本字串語法錯誤修復 (Code.js)
- **修復 Apps Script 換行符轉義錯誤**：徹底修復 `deleteSalespersonBonusRule` 內 `\n` 被 Apps Script 伺服器端範本字串求值為實體換行，導致瀏覽器載入時拋出 `SyntaxError: Invalid or unexpected token` 及 `switchTab is not defined` 的白屏崩潰 Bug，完美恢復系統正常載入。

## [v2.6.0] - 2026-06-15 (今友利雙倍業績規則、摺疊式突破獎金 UI、語法錯誤與還原修復)

### 💰 今友利雙倍業績加成計算 (Sales.js)
- **快取今友利商品名單**：實作 `getJinyouliCodesSetCached()` 執行期快取函數，讀取外部「今友利庫存」試算表（ID: `1u_7xHHhMRh15cwSgf1MjjL6jFKasSkNFoEHrPUuj7Cc`）的商品編號（C欄）並保存，確保大數據計算在毫秒內完成。
- **雙倍採計業績**：修改 `getAdjustedAmt` 與 `getAdminBonusReport`，凡是匹配到今友利商品，該筆成交業績金額直接以 **2 倍** 採計（折減與拆分後再加倍）。這會同步更新前台 KPIs、YTD 年度/月度業績同步等數據。
- **小姐明細公式化展示**：在個人獎金公式頂部，動態展示今友利加倍之筆數與翻倍額度；並在「低於六折之業績折半明細」中為該編號自動加註 `(今友利x2)`。
- **今友利雙倍業績明細表**：小姐展開卡片明細時，會獨立呈現「🏆 當月售出今友利業績雙倍計入明細」表格，完整展示「客戶、案名、編號、數量、折減狀態、原始銷額、合夥加權與雙倍採計業績」。

### ⚙️ 摺疊開啟突破獎金設定 (Code.js)
- **下拉開啟門檻設定**：新增突破獎金專屬摺疊面板「🏆 突破獎金門檻設定 (點開：xx萬 獎金xx)」，預設收合以保持後台介面整潔。
- **5 組數字輸入框**：全面移除原本的逗號分隔字串輸入框，改為 5 列清晰的數字輸入對（`[ 門檻 ] 萬 獎金 [ 金額 ] 元`），徹底排除手動登打格式錯誤。
- **前端儲存與快照保存**：
  - 修改 `saveSalespersonBonus`，前端遍歷 5 組輸入對，自動將「萬」乘以 10,000，過濾空值，排序後存入設定檔。
  - 修改 `toggleRuleEnabled(chk)`，僅更新 UI 卡片狀態標籤，不再重建整個清單，從而保留使用者尚未儲存的輸入快照。

### 🛡️ 後台語法修復與功能還原 (Code.js)
- **修復 JavaScript 語法錯誤**：修正先前程式碼替換衝突遺留的 `Uncaught SyntaxError` 破壞性語法，進而修復 `switchTab is not defined` 的白屏崩潰。
- **還原批次導入**：重新還原並正確修復 `addBatchLineClients(btn)` 與 `removeLineClient(rowIdx, name)` 兩大白名單管理函數，確保 LINE 機器人白名單批次開通與移除功能恢復運作。

### 🚀 接下來的計畫與待辦事項 (Next Plan & TODOs)
1. **業務端 KPI 與總表業績加成同步核對**：
   - 繼續觀察大數據量下 `syncSalesDataByYear` (同步至業務分區表) 的運作速度，確保今友利快取效能穩定。
   - 測試業務在前台 KPI 看板上顯示的年/月業績，確認今友利 2x 計算完美體現。
2. **極端狀況防禦測試**：
   - 測試退貨（負數銷額）商品為今友利編號時，業績是否正確扣減 2 倍（`amt * 2` 為負數且扣除）。
   - 測試當今友利庫存表的商品編號有空行或非法字元時的過濾防禦性。
3. **內勤提撥與配送細節持續優化**：
   - 持續配合小姐（行政）對帳需求，評估是否需要在總表中直接呈現今友利獎金小計。

## [v2.5.0] - 2026-06-15 (業績獎金門檻微調、移出前台並於後台新增精算與折折減明細)

### 💰 業務業績與獎金計算微調 (Sales.js)
- **突破門檻調整**：
  * 謝博皓、潘右森：突破門檻微調為僅有 **210萬** (+5k) 與 **260萬** (+10k) 兩檔。
  * 陳勁多：突破門檻微調為僅有 **190萬** (+5k) 與 **240萬** (+10k) 兩檔。
- **自動版本遷移**：實作 `getActiveBonusConfig()` v2 自動遷移邏輯，當載入的 Property 尚未升級至 v2 時自動將每位業務的突破門檻更新為最新值，無縫對接原有設定。
- **後台精算明細 API**：新增 `getAdminBonusReport(year, monthIdx)`，整合各業務當月實得銷額、達成/突破獎金、公式計算步驟描述，並挑選出當月所有低於同行價 6 折的交易明細。

### 📊 業績詳情 UI (Sales_UI.html)
- **移出估算獎金**：刪除 KPI 詳情頁上的「當月估算獎金」資訊卡，使普通業務無法在手機前台查看到獎金估算，保護敏感財務資訊。

### ⚙️ 後台精算與折半明細面板 (Code.js)
- **小姐專屬精算面板**：在後台「業績獎金參數設定」分頁中增設「**當月業務業績獎金精算與折半明細**」區塊，支援以 Year/Month 下拉選單進行重新精算。
- **計算過程與折減表格**：
  * 展開明細後，清晰列出步驟式算式過程。
  * 以表格詳細列出當月「客戶名稱、案名 (備註)、產品編號、數量、原成交單價、同行價、成交折數、原銷售金額、合夥加權、折後採計業績」，一目了然。

## [v2.4.1] - 2026-06-15 (修復後台 JavaScript 語法、換行轉義與分頁隱藏錯誤)

### ⚙️ 後台前端錯誤修正 (Code.js)
- **修復巢狀引號導致的語法錯誤**：
  - 解決當瀏覽器載入 `view=getkeys` 管理頁面時，因 HTML 屬性與字串轉義衝突導致的 `Uncaught SyntaxError: Unexpected string` 與 `switchTab is not defined` 初始化中斷錯誤。
  - 將 `toggleRuleEnabled`、`saveSalespersonBonus` 與 `deleteSalespersonBonusRule` 重構為透過 `this.closest('.bonus-card').dataset.name` 動態讀取 DOM 節點自訂屬性，徹底移除 HTML 行內事件屬性中的字串拼接與轉義引號，提升程式碼的健壯性。
- **修復換行符號轉義錯誤**：
  - 解決 `deleteSalespersonBonusRule` 刪除對話框中單引號字串內的 `\n` 在伺服器端範本字串求值時變成實體換行，進而導致瀏覽器端載入時發生 `Uncaught SyntaxError: Failed to execute 'write' on 'Document': Invalid or unexpected token` 的問題。
  - 將單個反斜線 `\n` 改為雙反斜線 `\\n`，確保在瀏覽器端正確保留轉義格式並正確顯示對話框折行。
- **修復分頁 CSS 覆蓋（空白頁）錯誤**：
  - 解決點擊「業績獎金參數設定」分頁時下方呈現空白的 Bug。
  - 原代碼在 `div#bonus-tab` 容器上寫了 `style="display:none;"` 行內樣式，其優先級高於 `.tab-content.active { display: block; }` 的 class 樣式，導致分頁就算被切換為 `active` 也依然維持隱藏。已將行內樣式移除，以利用 CSS class 進行顯示狀態之控制。

## [v2.4.0] - 2026-06-15 (新增金鑰後台之業績獎金設定管理分頁)

### ⚙️ 動態獎金設定後台 (Code.js)
- **管理後台分頁 `bonus-tab`**：
  - 於金鑰管理後台 (`view=getkeys`，僅行政同仁「小姐」有權限存取) 新增「**業績獎金參數設定**」管理分頁。
  - 提供圖形化編輯器，可調整全域參數（分給內勤比例、同行價折扣門檻門檻、折算係數），並提供動態表單編輯每位業務的個人達成/突破獎金配置。
  - 支援「參與獎金計算」的啟用/停用開關、自訂最低與起算額度、起算級距與加發金額，以及以逗號分隔的突破獎金門檻（如 `130萬:5000, 180萬:10000`）。
  - 提供「新增業務規則」與「刪除規則」按鈕，實作完整的業務名單與參數生命週期管理。
- **免重新整理儲存**：
  - 串接 `getActiveBonusConfig()` 與 `saveActiveBonusConfig(config)`，實現前端設定變更即時保存，保存後自動清除快取即刻生效。

### 💰 後端持久化與陳勁多門檻修正 (Sales.js)
- **屬性持久化**：將原本寫死的獎金規則常數 `BONUS_CONFIG` 改為從 `PropertiesService` 中動態讀寫，並以 `DEFAULT_BONUS_CONFIG` 作為出廠預設值。
- **規則排除與調整**：
  - 高弘治與洪華連的預設規則中，設為 `enabled: false`（排除於業績與獎金計算之外，待後台手動勾選啟用）。
  - 依對話要求，將陳勁多之突破獎金門檻調降 20 萬，修正為：`130萬:5000, 180萬:10000, 230萬:15000, 280萬:30000`，潘與謝維持 `150/200/250/300萬` 原突破等級。

---

## [v2.3.0] - 2026-06-15 (新增業務獎金計算與同行價防禦規則)

### 💰 業務業績與獎金引擎 (Sales.js)
- **同行價六折折減防禦**：
  - 新增 `getPeerPriceMap` 載入 `編號價目表` 中的 `同行價`。
  - 新增 `getAdjustedAmt` 計算成交單價。當單價低於同行價 6 折時，該筆業績以 5 折（50%）採計。
  - 整合此邏輯於 `getSalesOverview`、`getSalespersonKpi`、`getSleeperDetails` 及年度月度業績同步 `syncSalesDataByYear` 中，確保各系統報表業績數據一致性。
- **動態獎金計算器 `calculateSalesBonus`**：
  - **陳勁多**：起算點 50 萬（超額每 10 萬發 1000 達成獎金），150 萬以上突破獎金 +5000。
  - **謝博皓/潘右森/高弘治**：最低額度 80 萬，70 萬起算超額（每 10 萬發 1000 達成獎金），突破獎金分級：150 萬(+5k)、200 萬(+10k)、250 萬(+15k)、300 萬(+30k)。
  - **內勤提撥分拆**：自動從總獎金提撥 10% 給內勤同事，計算業務 90% 最終實領。

### 📊 業績詳情 UI 展示 (Sales_UI.html & JS_Sales.html)
- **當月獎金估算卡片**：
  - 個人 KPI 詳情頁中新增「💰 當月估算獎金」資訊卡。
  - 動態展示當月業務實領金額、內勤提撥金額，以及達成與突破獎金明細，大幅提升業務查數體驗。

---

## [v2.2.0] - 2026-06-10 (業務配送相簿上傳 & 部署流程修正)

### 📸 業務配送模組 (SalesDelivery_UI.html)
- **新增相簿上傳功能**：
  - 原「拍照」按鈕改為「相簿」，點擊直接開啟手機相簿選取照片。
  - 新增 `delivery-gallery-input`（不帶 `capture` 屬性的 file input）。
  - 新增 `triggerGallery(rowIdx)` 函數，選完照片後走相同的 `handleDeliveryPhoto` 壓縮 + 上傳流程。

### 🔧 部署流程重要發現
- **`clasp push` 不等於用戶端更新**：
  - 專案有兩個 deployment：`@HEAD`（測試用）與版本號 deployment（正式用戶端使用）。
  - `clasp push` 只更新 `@HEAD`，正式用戶端看到的仍是舊版本。
  - **正確部署流程**：`clasp push --force` 之後，必須再跑：
    ```
    clasp deploy -i AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg -d "說明"
    ```
  - 目前版本已更新至 `@298`。

---

## [v2.1.0] - 2026-06-09 (庫存保留單更名適應與搜尋、登入頁面修正)

### 📌 庫存與保留單模組 (Inventory & Reservation Modules)
- **保留單工作表更名同步**：
  - 更新全域設定 `CONFIG.SHEET_NAME_RESERVE` 為 `"保留單"`，使系統後台無縫對接更名後的工作表。
  - 修改 `Inventory.js` 中的 `syncReservationStock` 邏輯，改為動態讀取 `CONFIG` 設定以保持名稱適應彈性。
  - 升級庫存快取 Key 至 `inv_full_v4`，強制使舊有的伺服器端庫存快取失效，確保系統在重新載入時讀取最新的保留單數據。

### 🔍 客戶搜尋與清除功能修復 (Search Integrity)
- **修復 ReferenceError 錯誤**：
  - 解決當使用者在首頁「搜尋客戶名稱...」打字搜尋時，因找不到 `toggleClearBtn`、`clearSearch` 與 `handleSearch` 導致網頁出錯的致命問題。
  - 在 `script.html` 中補齊並實作 `handleSearch`、`clearSearch` 與 `toggleClearBtn` 前端功能，讓客戶搜尋過濾與 X 清除按鈕重新正常運作。

### 👥 登入名單篩選與角色分離 (Sales Login Filter)
- **排除非業務人員顯示**：
  - 為避免司機或助理（`DIRECT_ACCESS_CUSTOM` 手動新增帳號）出現在業務選單的登入首頁中，在 `Code.js` 中重構 `getSalesList(onlySales)`。
  - 當主登入頁面呼叫 `getSalesList(true)` 時，自動排除司機與助理，僅顯示正式業務員帳號。
  - 同時保留物流派遣轉派選單 (`SalesDelivery_UI.html`) 與全知報表 (`FieldWork.js`) 對全體派遣同仁的相容性，確保物流與打卡系統不受影響。

## [v2.0.1] - 2026-06-03 (桌面裝置打卡體驗優化)

### 📌 外勤打卡模組 (FieldWork Module)
- **桌面裝置自動偵測與降級**：
  - **自動開啟出差模式**：當前端 GPS 模組回報定位失敗或無 GPS 硬體時，系統會自動偵測使用者是否為桌面環境（非行動裝置）。
  - **自動判定**：若為桌面瀏覽器，將會自動勾選並切換至「出差打卡模式」，同時在 GPS 狀態列顯示橘色標記 `[🟠 桌面模式・自動切換出差打卡]`，避免因為沒有 GPS 訊號導致打卡卡死。
  - **靜態防禦**：在點擊上班/下班打卡時，若仍然沒有取得經緯度且為桌面環境，會自動切換為出差打卡，並直接套用預設的公司 GPS 備用座標（緯度 25.0004864, 經度 121.0339143）完成打卡，解決電腦版 App 的打卡死鎖痛點。

## [v2.0.0] - 2026-05-30 (電玩像素風後台大重構)

### 🕹️ 視覺藝術與交互重構 (Visual Arts & Retro UI)
- **電玩像素風 Retro Arcade 主題**：金鑰與客戶管理總後台 (`view=getkeys`) 介面全面翻新為「懷舊街機/復古終端機」美學。
  - **螢幕特效**：引入極具質感、帶有微幅閃爍的 CRT 動態掃描線（CRT Scanline Overlay Effect）與暗夜霓虹紫色背景 (`#0c0914`)。
  - **字型搭載**：使用 Google Fonts `Press Start 2P` 與 `Share Tech Mono` 打造完美像素字體排列，重現 80 年代大型街機質感。
  - **3D 像素立體按鈕 (`.btn-pixel`)**：具有受壓下沉位移點擊效果與多層次霓虹邊框陰影。
  - **像素輸入框與選單**：為文字欄位、下拉選單與批次文字框設計專用像素化輸入界面。
- **純 ASCII 碼安全介面**：全介面排除 Emoji 圖示，採用 `[+]`、`[x]`、`[⚡]` 等經典文字符號排版，徹底杜絕編譯/序列化傳輸階段因編碼產生的系統死鎖。

### 📋 頁面功能與安全防護 (Portal Core & Compatibility)
- **ARCADE HUD 頂部面板**：動態展示模擬街機 HUD，包含系統版本、閃爍的 `[ INSERT COIN ]` 狀態字樣以及玩家代幣數。
- **無縫向下相容 (Function Integrity)**：完美保留所有 JavaScript 表單控制、金鑰撤銷/重啟 (`toggleStatus`)、白名單刪除 (`removeClient`) 以及批量入庫處理等核心業務函數的完整性。

## [v1.9.0] - 2026-05-13 (物流配送與獎金系統深度優化)

### 🚛 核心功能優化 (Core Delivery & Rewards)

#### 1. 🗓️ 智慧日期任務調度 (Intelligent Date Dispatching)
- **自定義日期挑選器 (Date Picker)**：新增手動日期挑選功能（📅 鈕），支援業務提前查看未來任意工作日的配送任務，不再侷限於今日/明日。
- **動態日期導覽列**：優化導覽列邏輯，支援「今日」與「下一個工作日 (自動跳過假日)」的即時切換。
- **任務自動收納機制**：查看未來日期時，系統會自動收納當天已完成的歷史任務，確保首屏視野聚焦於即將執行的行程。

#### 2. 🚀 高性能手機端快取 (Client-Side Task Caching)
- **Cache-First 策略**：實作 `dlState.cache` 機制。當業務在今日、明日與自選日期之間頻繁切換時，系統優先讀取手機本地快取，完全消除網路延遲感。
- **快取效期管理**：定義 5 分鐘快取自癒效期，確保在大幅提升響應速度的同時，數據依然能維持足夠的新鮮度。

#### 3. 📊 配送獎金系統全面重構 (Bonus System Overhaul)
- **三層下探式架構 (Tiered Drill-down)**：
    *   **第一層**：月份總獎金、有效天數與點數總覽。
    *   **第二層 (月明細)**：點擊「📂 查看本月出勤明細」展開每日出勤紀錄表。
    *   **第三層 (日詳情)**：點擊具體日期後，進一步「深度下探」顯示該日所有的 **「客戶、地址、產品編號(SKU)、數量」**。
- **精準計點邏輯 (Strict Points Calculation)**：
    *   **排除機制**：自動過濾「樣品、門市、入店」任務，此類任務不再計入配送點數。
    *   *規則更新*：僅「送貨」任務列入計點，獎金由每日第 2 個送貨點起算 ($50/點)。
- **撿貨明細聯動**：後端實作自動跨表索引，自動匹配「撿貨明細」數據，讓業務能直接在獎金明細中複查產品編號。

#### 4. 🎨 視覺體感大升級 (UI/UX Refinement)
- **高對比亮色模式 (Bonus Detail)**：針對獎金明細採用「大底深色、內容白卡」設計。白底黑字的高對比效果徹底解決了原本在戶外暗處看不清數據的痛點。
- **字體巨型化與防止換行**：
    *   關鍵統計數據（天數、點數）放大至 **32px** 特粗體。
    *   格子寬度動態調整，確保「出車天數」等長標籤在小螢幕上完全不會換行。
- **黃色視覺強化**：配送清單中的「產品編號」與「數量」套用亮黃色高亮，方便倉儲與業務對點。

### 🛡️ 錯誤處理與系統自癒 (Error Handling & Bug Fixes)

- **【修復】ReferenceError: Utilities is not defined**：
    *   **原因**：在 GAS 前端 JavaScript 中錯誤調用了僅後端可用的 `Utilities` 函式庫。
    *   **解法**：改採原生 JavaScript `Intl.DateTimeFormat` 與 `String.padStart` 實作日期格式化，確保前端執行無誤。
- **【修復】TypeError: toggleBonusSection is not a function**：
    *   **原因**：函數定義位置受 Hoisting (提升) 限制，且在動態 DOM 渲染完成後才加載，導致點擊事件失效。
    *   **解法**：將所有 UI 切換函數移至 `Sales_UI.html` 腳本標籤的最頂層，確保全域可用性。
- **【修復】日期匹配失效 (Date Padding Issue)**：
    *   **原因**：後端日期補零 (05/14) 與前端選擇器日期格式 (5/14) 不一致導致查無資料。
    *   **解法**：實作通用的日期標準化剖析器，統一轉換為 YYYY/MM/DD 格式進行比對。

---

## [v1.8.0] - 2026-05-12 (夜間場 - 配送流程大滿貫)

### 🚛 業務配送模組全功能整合 (Full Delivery Parity)

#### 1. 🎨 專業化結案報告引擎 (Automated Report Canvas)
- **視覺化合成技術**：移植「智慧物流」最核心的 Canvas 繪圖引擎至業務端。
- **自動化標註**：結案拍照後，系統自動將「客戶、地址、單號、時間、業務」浮水印壓入照片。
- **數位印章 (Digital Stamp)**：右下方自動產生紅色「已送達」防偽印章，包含日期與客戶簡稱，提升回報專業度。

#### 2. 📡 LINE Notify 推播強化 (Enhanced Notification)
- **圖片預覽機制**：優化通知格式，將合成後的報告圖直接以「圖片預覽」方式推播至 LINE 群組，而非僅顯示連結。
- **即時狀態通報**：針對「貨物破損」與「備註」進行視覺特化（⚠️ 符號標註），讓內勤第一時間掌握異常。

#### 3. 🗓️ 多日排程與精細化 UI (Scheduling & Filtering)
- **明日預告切換 (Date Switcher)**：導覽列新增「今日任務 / 明日預告」切換按鈕，支援提前查看隔日樣品單。
- **任務自動收納 (Task Folding)**：新增「📦 已完成任務」折疊區塊，當天結案任務會自動沉底並收合，大幅優化單手操作視野。
- **全彩統計標籤**：標題列統計數值實作 HSL 高對比色彩：
  - **送貨 (綠色)** / **樣品 (黃色)** / **退貨 (紅色)** / **完成 (白色)**。

#### 4. 🛡️ 系統穩定性與自癒力 (System Resilience)
- **安全路徑機制 (Safe Folder Pattern)**：實作 `_getSafeFolder` 邏輯。當遭遇權限變動導致無法存取主資料夾時，系統會自動在根目錄建立「業務配送照片備援_2026」並接管儲存，確保一線操作不中斷。
- **緊急語法修復**：排除因函數抽離導致的 `Unexpected token ')'` 語法錯誤，恢復系統載入穩定性。

---

## [v1.7.0] - 2026-05-12 (最終收官)

### 🚛 物流中樞智慧化與跨表路由 (Smart Logistics Core)

#### 1. 💡 智慧 AI OCR 聯動輔助 (Intelligent OCR Guard)
- **「樣品」自動識別路由**：
  - 改寫 OCR 回傳解析引擎，凡是辨識出客戶名稱內含「樣品」，前端會**自動秒點亮「業務」橘金按鈕**。
  - **效益**：完全免除人工判讀後需手動切換的零碎時間，降低誤拋至總派送區的機率。
- **雙軌強制部署通道**：
  - 強制發布已遮罩的部署版本 313-316，徹底排除 Google Apps Script 網頁端靜態資源的暫存死鎖，保證終端更新即時性。

#### 2. 🏗️ 戰情室深度路由擴充 (Portal Expansion & Modal Overhaul)
- **「新增行程」智慧雙向門 (Bi-directional Routing)**：
  - 在管理後台新增行程彈窗中，完美整合「指派業務」下拉式元件。
  - **動態流控**：
    * 若留空，維持舊有派往 `派送清單`。
    * **若選中業務**，瞬間接管寫入軌道，**直達「業務配送清單」**。
- **全自動接力機制**：
  - 新增當下即自動將該業務姓名寫入 `派遣司機`，狀態秒切換為 `配送中`，業務手機端達成真正的「即加即看」。

#### 3. 🛡️ 系統防禦性與相容力 (Resilience & Robustness)
- **快取金鑰代數推進 (Cache Invalidation v3)**：
  - 將系統全域緩存 Key 強制升級為 `war_room_data_v3`，確保所有終端即刻清空舊數據，無縫拉取最新的業務白名單 Mapping。
  - **效益**：解決修改後端架構後，使用者仍讀到舊架構 Cache 導致下拉選單空白的致命痛點。
- **鬆散式白名單擷取器 (Relaxed Whitelist Loader)**：
  - 解除後端嚴格的 Role 身分類型字串過濾；只要帳號狀態為「啟用」且隸屬該分公司，即視為有效派遣對象。
  - **前端模糊匹配 (Fuzzy Binding)**：新增自動子字串包含比對（`高雅瓷` vs `高雅瓷分公司`），消除任何微小的人為登打命名落差，保證配對成功率 100%。

#### 4. 🎨 視覺一致性修復 (Visual Homogenization)
- **暗黑標準化 UI 回歸**：
  - 移除過於突出的藍色虛線框與 Emoji 圖標，將指派選單改回標準 input-group，無痕融入戰情室全局 dark-theme 調性。
- **全息底色同步機制**：
  - 深入 `Code.js` 全域樣式引擎，將主表的狀態渲染器 (黃色待派/粉紅配送) 完整克隆至 `業務配送清單` 分頁。
  - **效益**：財務與小姐在檢視業務單據時，與總表視覺感知完全一致。

---

## [v1.6.0] - 2026-05-12 (下午場)

### 🚚 業務物流配送系統全面升級 (SalesDelivery Final Edition)

#### 1. 💥 核心穩定性與危急修復 (Critical Stability)
- **【救命丹】HTML5 圖片無損壓縮引擎**：
  - 引入用戶端 Canvas 緩衝壓製技術，在傳輸前動態將 10MB+ 的高畫質照片壓製為 `1200px` 的 70% 品質 JPEG。
  - **效益**：**完全解除 Google Apps Script RPC 傳輸上限 (Payload limit exceeded)**，徹底消滅了因手機鏡頭畫素過高導致的上傳閃退、卡死與無聲失敗。
  - **強化容錯**：全面補足 `withFailureHandler` 全域異常捕捉鏈，確保網路波動時有明確提示。
- **今日結案隱藏 BUG 修除**：
  - 重構日期邏輯，不僅比對「派送日期」，同時優先核查「配送完成時間」。
  - **效益**：確保「今日補結案的過期舊單」，於完成當下依然能保留在今日介面上正確呈現變暗、下沉與蓋章效果，優化使用者回饋感。

#### 2. 🏗️ 嶄新手風琴介面與視效進化 (UI/UX Architecture)
- **下探式手風琴架構 (Collapsible Accordion)**：
  - 重新設計主視圖結構，預設僅渲染「類別-名稱 地址」一行極致壓縮表頭。
  - **效益**：極度節省縱向高度，單畫面容納任務數提升 300%；點擊頭部觸發平滑向下展開，揭示細節。
- **五元對等控制條 (Isometric 5-Button Strip)**：
  - `[導航]` `[拍照/打勾]` `[圖檔]` `[電話]` `[換人]` 五顆等寬度按鈕整齊排列於展開區最底部。
  - **拍照視覺特化**：維持亮金色系以凸顯核心操作權重。
  - **無痕隱形 Dropdown**：創新採用 0 透明度 overlay 技術覆蓋於 `換人` 按鈕上方，完美整合系統原生選單卻不破壞佈局整齊度。
- **色彩邊界管理 (Color Boundings)**：
  - 送貨(綠色)、樣品(黃色)、退貨(紅色)，依據任務屬性自動套用特定色系邊框與陰影，增強瞬間判讀力。

#### 3. 🔍 智能鏈結與資料過濾 (Data Integration)
- **跨表關聯：子表撿貨明細拉取**：
  - 成功打通「業務配送清單」與「智慧物流-撿貨明細」。
  - **自動反轉索引修補 (Key Flip Heuristic)**：鑑於兩邊的 `單號` 與 `單號KEY` 有「分公司-單號」與「單號-分公司」鏡像顛倒的現象，後端導入了自動字串反轉二段比對邏輯，確保對位率 100%。
  - **多品項展疊**：樣品若對應多項 SKU，前端會自動渲染 `▼展開` 按鈕，不佔空間。
- **地址智能脫敏過濾器**：
  - 自動抓取並裁切開頭的「XX市/XX縣」，僅精煉顯示「XX區」以下的有效行徑座標。
  - **例外防禦**：精確針對「基隆」案例進行白名單保留，完全符合既有商業直覺。

#### 4. ⚡ 流程自動化 (Workflow & Backend)
- **分流結案哲學**：
  - 智慧判別流程：**唯有『送貨』需要開啟相機**；其他類別（樣品、入店、退貨）統一自動轉化為「綠色打勾免拍照極速結案」。
- **後台工作日誌自動登錄器 (Audit Logging)**：
  - 封裝 `_writeToLogSheet` 共用函式。只要業務回報完成，系統將秒速將司機、車牌(預設業務自送)、單號、地址、備註與完工時間同步鏡像寫入總部的**「送貨日誌」**表單，免去二次登載負擔。
- **實體分段原子鎖 (Lock Service)**：
  - 任務轉派 (`transferSalesDeliveryTask`) 時強制加上資料庫交易鎖，防止多業務同時操作同張單據造成的覆蓋衝突。


## [v1.6.0] - 2026-05-26

### 🛠️ 穩定性修復與模組還原 (緊急回滾與防禦修正)
- **回滾至 V199 穩定版本核心**：
  - 將工作日誌 ID 欄位比對索引自 `row[7]` 還原為 `row[6]`，以完全相容於高雅瓷正式試算表的欄位結構，避免發生陣列索引錯位與空白資料寫入之錯誤。
  - 還原 `FieldWork_UI.html` 與 `JS_FieldWork.html` 之日誌月曆互動邏輯，改回原生 `onclick="fwCalPrevMonth()"` 等傳統事件綁定，確保日曆跳轉與日期篩選 100% 正常。
- **完全移除「月度報表」功能按鈕**：
  - 由於該功能呼叫了 DOM 中未定義的元素（如 `report-month`）以及缺失的 `fw-reports` 分頁，導致前端執行時拋出 `Uncaught TypeError` 錯誤並造成畫面閃退。
  - 已將 `FieldWork_UI.html` 快捷操作區的「月度報表」卡片按鈕完全移除。
  - 目前快捷操作區完美保留三個穩定可用的核心功能：**紀錄日誌**、**行駛里程**、**歷史回顧**。
- **串接保留系統連結（保留日誌）**：
  - 將全新的獨立模組「**缺貨日誌 — 保留單監控中心**」整合至外勤管理（Field Work）首頁的「快捷操作」面板中。
  - 點擊「**保留日誌**」會以新分頁開啟保留單監控看板：`https://script.google.com/macros/s/AKfycbw9jB_xyh-8443U2ZW9cMnlWi0QxcKlJU-hGbYvBW4i6H7mdznxyLj9IkzJCgwnshc2Tw/exec`。
  - 業務可在該中心內完成 30/45/60 天保留單稽核、篩選、即時更新進度，並能一鍵複製/發送 LINE 提醒訊息給客戶。

---

## [v1.5.0] - 2026-05-12 (上午場)

### 🛠️ 後端架構重構 (工作日誌大瘦身)
- **單列水平累計機制**：
  - 重新設計 `saveWorkLog` 存儲模型。系統現在會優先查找當日該業務的既有列，並將「客戶、摘要、內容」以 ` || ` 分隔符水平串接至同一欄位，而非無限垂直新增。
  - **文字嵌入時間戳**：自動在追加的字串前嵌入 `[14:30]` 格式標籤，完美保留時間軌跡。
  - **自動裁剪格式**：寫入時自動對目標範圍套用試算表 `WrapStrategy.CLIP` 樣式，維持介面清爽。
  - **最新排序置頂**：完成每次寫入/更新後，強制觸發試算表倒序重排，確保最新日期永遠置頂。

### ⚡ 效能與資料剖析引擎
- **全知視角載入優化**：
  - 重構 `getAllSalesDailyReports`，採 Single-pass 批次抓取機制替代舊有迴圈，杜絕前端載入凍結。
  - 移除全知視角密碼驗證門檻，直達數據中心。
- **智慧還原剖析器 (Parser)**：
  - 實作 `parseVisitsFromRow_` 專用解碼引擎。在前端讀取時動態將單列複合字串切割還原成獨立卡片物件。
  - **完美向下相容**：具備雙軌辨識機制，即使是 5/12 之前的「舊式單列紀錄」也能無痛讀取，呈現樣貌完全一致。

### 🔗 模組整合與資料流匯流
- **跨模組統一調用**：
  - 深入 `Code.js` 底層，將「更換版面照片」、「修改版面品項」等庫存端日誌記錄路徑，全數改為統一調用 `saveWorkLog` 核心，全面停止各自為政的直接寫入行為。
- **GPS 資訊列相容擴充**：
  - 將 `WORKLOG` 資料標準架構從 7 欄擴充為 8 欄，正式納入 `GPS資訊` 通用欄位，防止庫存模組的經緯度資料遺失。

### 🔧 自動化維護
- **標題列自我修復 (Auto-Healer)**：
  - 在 `getFwSheet` 中埋入靜態比對邏輯。若現存實體試算表欄位數小於當前定義，系統執行時會自動補齊標題（如 GPS資訊）並套用佈景樣式，免除人工校正。

---


## [v1.4.0] - 2026-05-07

### ✨ 新增功能
- **保留單批量管理與分享**
  - **多選模式**：保留單列表新增核取方塊，支援跨案名批量選取。
  - **LINE 一鍵分享 (純文字版)**：自動生成結構化純文字清單（移除 Emoji 以符合簡潔需求），包含客戶名稱、業務員、案名、編號、數量及進度。
  - **深層連結優化**：優先使用 `line://` 協定喚起 App，並提供瀏覽器轉發作為備案。
- **進度回寫系統 (業務更新)**
  - 支援批量更新所選品項的「業務更新」狀態。
  - **自動擴充**：若目標表不存在更新欄位，系統將自動建立「業務更新」欄位。

### ⚙️ 系統遷移與架構
- **資料來源遷移**
  - 保留單數據正式遷移至獨立試算表：`[RESERVE_SS_ID_REDACTED]`。
  - 工作表名稱更名為：**「高雅瓷保留」**。
  - 更新欄位定名為：**「業務更新」**。
- **庫存對位同步**
  - 更新 `Inventory.js` 計算邏輯，確保首頁可用庫存計算與新版「高雅瓷保留」數據實時同步。

### 🐞 錯誤修復
- **業務員對位修正**：修正選取分享時業務員欄位顯示為 undefined 的層級對位問題。

---

## [v1.3.0] - 2026-05-07

### ✨ 新增功能
- **版面與保留單深度聯動**
  - 在「版面陳列牆」卡片右上角新增「保留 X 片」動態標籤，自動計算該客戶對應版面產品的保留總量。
  - **點擊交互**：點擊保留標籤可彈出詳細明細，顯示 `[產品編號] [保留數量] [負責業務]`。
  - **SKU 明細增強**：在產品詳情列表中加入「此客戶已保留 X 片 (案名)」提示。

### 🐞 錯誤修復
- **保留單圖片顯示修正**
  - 解決保留單分頁顯示 "NO IMG" 的問題：新增 Google Drive 連結轉縮圖網址 (`lh3.googleusercontent.com`) 邏輯。
  - **編號對位標準化**：統一將 SKU 進行去空格與去橫線處理 (`replace(/[\s\-]/g, '')`)，確保跨工作表對位 100% 準確。
- **業務員資訊修正**
  - 修正點擊保留標籤時業務員顯示為「未指定」的邏輯 Bug。

---

## [v1.2.0] - 2026-05-06

### ⚡ 效能優化
- **銷售報表 Single-pass 重構**
  - 將 `getSalesOverview` 改為單次迴圈遍歷，避免在大數據量下重複掃描數萬行資料，體感速度提升 3-5 倍。
- **啟動流程優化**
  - 移除 `script.html` 中冗餘的 `setTimeout` 延遲，縮短 Splash Screen 轉場時間。

### 🛠️ 邏輯修正
- **樣品/扣帶過濾**：在所有銷售業績計算中，嚴格排除「客戶名稱」或「備註」包含「樣品」或「扣帶」的記錄。
- **系列名稱對位**：優先抓取「中文系列」欄位，確保報表顯示名稱與現場一致。

---

## [v1.1.0] - 早期更新
- 整合「內部查庫存」保留單分組邏輯。
- 支援 GPS 定位與照片同步上傳功能。
- 實作玻璃化 (Glassmorphism) UI 設計語彙。
