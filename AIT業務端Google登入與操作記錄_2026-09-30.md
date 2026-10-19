> **後續（2026-10-01，@594～@601）見 `保留日誌改版與修正記錄_2026-10-01.md`**

# 2026-09-30 晚上：@580 ~ @593 進度（最新，先看這段）

## 版本紀錄

| 版本 | 內容 |
|---|---|
| @580 | 操作記錄時間欄寫成日期值 |
| @581 | 實際使用時間記錄（`版面神器_使用時間`）；機密中心拿掉業務 app 金鑰管理 |
| @582 | 登入直接驗證（不繞物流）、連線中斷自動重試、剛綁定帳號不再誤判停用 |
| @583 | 登入資料由 bigt.cc 外殼頁保管，iPhone 主畫面 App 不用每次重登 |
| @584~585 | 畫面正下方淡灰色顯示姓名；保留日誌帶登入憑證 |
| @586 | **開啟加速**：白名單只讀「系統白名單」一頁（Sheets API），快取過 60 秒只由一個請求重讀，其他先用前一份（最舊 10 分鐘） |
| @587 | 保留日誌 iframe 不再一開 App 就在背景預載（以前沒帶憑證，白跑一趟又被擋） |
| @588~592 | **保留系統整個併入版面神器**（見下） |
| @593 | 登入只用 Google（見下） |

## 保留系統併入版面神器

原本的保留系統是獨立 GAS（`AKfycbxTYjCWP…`），現在是版面神器的一頁：`?view=reserve`。

- 檔案：`Reserve_Main.js`（`reserveDoGet_` / `webGetData`）、`Reserve_Auth.js`、`Reserve_Service.js`、`Reserve_Notify.js`、`Reserve_Email.js`、`Reserve_Telegram.js`、`Reserve_UI.html`
- `Code.js` doGet 第一行分流：`params.view === 'reserve'` → `reserveDoGet_(e)`
- 撞名處理：保留系統的 `findHeaderIndex`（完全比對，跟版面神器的正規化版行為不同）改名 `rsvFindHeaderIndex_`；`_audit*` 寫記錄函式兩邊相同，用版面神器那份；`doGet` 改名 `reserveDoGet_`；`onEdit` 改名 `rsvOnEditTrigger`（避免被當簡單觸發器）；Telegram webhook 小工具（`doPost` / `setTelegramWebhook`）沒搬
- 登入：直接用 `Auth.js` 的 `_aitRequire_` 驗證（不再繞網路 `aitverify`，已移除）
- **修掉業務戰情室 AUTH_REQUIRED**：前端大多數 `google.script.run…webGetData(...)` 沒帶 `__t`，只有擁有者能靠 Google 帳號過關。`Reserve_UI.html` 現在把 `google.script.run` 包一層，自動補登入憑證
- 會改資料的 10 個功能改成私有（結尾 `_`），不能從前端直接呼叫，只能經過 `webGetData` 驗證
- 拿掉「操作記錄」分頁（資料本來就在「鈦傳速_操作記錄」試算表）
- Email 按鈕、「複製篩選連結」改成 `bigt.cc/ait/inventory.html?rsv=篩選`：先用版面神器登入，再自動開保留日誌並套用篩選；客戶管理「前往保留系統」改成在 App 裡開保留日誌（不另開分頁）
- 續保／取消快速連結：`版面神器 ?view=reserve&ac=…&tk=…`

### 搬移過程（已完成）

1. 舊專案排程全部停掉：`prewarmShortageBoard`、`prewarmWarRoom`、`sendDailyNewReserves_`、`sendMondayShortageReport`、`sendShortageDailyDigest`、`sendNewShortageEntries`（舊專案實際只裝了這 6 個）
2. Script Properties 4158 筆（Telegram token、通知去重記錄 `RESV_*`、續保連結代碼 `RSVTOK_*` 等）比對：版面神器裡已有完全相同的值
3. 版面神器建立同樣的 6 個排程（同樣時間）→ 版面神器共 11 個排程（上限 20）
4. 舊專案設 `RSV_MOVED_TO_AIT`：**所有舊網址自動轉到版面神器**（續保／取消／產品圖片直接轉；開頁與篩選連結轉到 bigt.cc 先登入）
5. 一次性搬家工具已從版面神器移除；舊專案 `Migrate.js` 只剩 `op=status` 可用

**舊保留系統 GAS 不要刪**（舊 Telegram 訊息、Email 裡的按鈕還指向它），也不用再維護。以後保留系統只改版面神器的 `Reserve_*`。

## 登入只用 Google

iPhone 主畫面 App 按 LINE 登入會跳到 LINE App，登入完回到 Safari 而不是 App，業務永遠登不進去。

- 外殼頁 `bigt.cc/ait/inventory.html`（GitHub `sales_app_ait` main → FTP 自動上傳，commit `1a38b91`）：一般瀏覽器、主畫面 App 只顯示 Google；只有 LINE／FB 等內建瀏覽器（Google 禁止在裡面登入）才顯示 LINE
- `JS_AitAuth.html` 登入畫面文字同步改成 Google
- ⚠️ 白名單只登記 LINE、沒填 Email 的人：用 Google 登入會進到申請畫面，送出後主管核准，系統會把 Email 補進白名單同一列
- ⚠️ 物流司機的主畫面 App（bigt.cc/tts/）有同樣的 LINE 問題，**還沒改**

## 待辦

- git：版面記錄神器本機 `main` 還停在 v556，今天的程式都沒 commit（外殼頁是另外從 GitHub 改的）
- 司機端 LINE 登入問題
- `Client_Inventory.js` `checkClientStock` 沒驗金鑰（舊問題）

---

# ⚠️ 已由 v2 取代（2026-09-30 @579）

@578 這版的前提不成立：業務庫「白名單」只有 3 列客戶，沒有任何 SALES/KING 帳號，也沒有 Email 欄，上線後所有業務都被擋在登入頁。

v2 做法：
- 帳號共用「鈦傳速物流」的「系統白名單」，LINE 或 Google 登入；新人申請走物流同一套 Telegram 審核。
- 所有前端會呼叫的後端功能（115 個）都在 `AitGuard.js` 加外殼，依 `AIT_SPECS` 分級驗證。
  - 客戶端維持金鑰制。
  - 機密中心只有主管能用。
  - 全知視角限主管、行政。
- 操作記錄寫到「鈦傳速_操作記錄」，系統欄 =「版面神器」。
- 細節見 `Auth.js` 檔頭。

下面是 @578 的原始說明，留作紀錄。

---

# AIT 業務端 Google 登入 ＋ 操作記錄

> 交付日期：2026-09-30
> GAS 專案：`版面記錄神器`（Script ID `1IekH-mC2nJPozGXnpdEhHCg-dEORms6B5k83omWc7gzUDEQEBFmRX-r8`）
> 正式部署 ID：`AKfycbyx1oJ4qeZzRTrjJ2wh2TvlixoN7OWJrqynMCPW90nfL_D5pKn_-SzNUNsYiMzTwbd0vg`（**未更動**）
> 本次部署版本：**@578**
> 對外網址：`https://bigt.cc/ait/inventory.html`（iframe 外殼，參數原封不動透傳）

---

## 一、這次要做什麼

1. 業務端主 App 改成「只認 Google 帳號 Email」，Email 必須在白名單才准進
2. 白名單**沿用本專案自己的原表**（業務庫 → 白名單），只加一個 `Email` 欄，不另建帳號表
3. 新增一個「操作記錄」分頁，記錄**每個業務做了什麼**
4. **客戶端完全不動**

---

## 二、為什麼用 Google Identity Services，不是 `Session.getActiveUser()`

`appsscript.json` 原本就是：

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
```

`ANYONE_ANONYMOUS` 代表部署層級**拿不到**使用者的 Email，`Session.getActiveUser()` 一定回空值。
而且這個正式部署**同時服務業務端與客戶端**，不能把權限改成「任何有 Google 帳號的使用者」——那會讓客戶全部打不開。

所以只能走前端 GIS 拿 `id_token` → 後端向 Google `tokeninfo` 驗簽。
作法比照 `智慧物流系統/Accounts.js`，**沿用同一個 OAuth client**：

```
488092523611-2012hnf14cch4s7p6sl3dp37dvihjsdm.apps.googleusercontent.com
```

`UrlFetchApp` 這個專案本來就在用（`AIQuery.js` / `LineBot.js` 等 5 個檔案），**不需要重新授權 scope**。

---

## 三、範圍界定（重要）

| 進入方式 | 這次有沒有鎖 | 說明 |
|---|---|---|
| 業務端主 App（`?sales=姓名&key=金鑰`） | ✅ 有鎖 | 必須 Google 登入 |
| 客戶端（`?view=client&clientName=X&key=Y`） | ❌ 沒動 | 維持原金鑰制，客戶沒有 Google 帳號 |
| `?view=inventory` 獨立查庫存 | ❌ 沒動 | 避免影響既有流程 |
| `?view=getkeys` 機密中心 | ❌ 沒動 | 避免影響既有流程 |
| `?view=staff` Staff_Portal | ❌ 沒動 | 同上 |

守門程式在 `Code.js` doGet 開頭，條件只有一句：

```js
if (params.view !== 'client') {
  const gate = _aitGate_(params);
  if (gate) return gate;   // 沒有有效 session 就回登入頁
}
```

---

## 四、動到哪些檔案

| 檔案 | 動作 | 內容 |
|---|---|---|
| `Auth.js` | **新增** 534 行 | GIS 驗簽、白名單比對、session、操作記錄、寫入動作包裝 |
| `JS_AitAuth.html` | **新增** 41 行 | 前端 `AIT_TOKEN` helper、heartbeat、`aitTrack()` |
| `Code.js` | 改 1 處 | doGet 加 5 行登入守門（`Code.js:936-941`） |
| `index.html` | 改 1 行 | 加 `<?!= include('JS_AitAuth'); ?>` |
| `script.html` | 改 8 處 | 寫入呼叫改呼叫包裝版 |

### 設計重點：原函式一行都沒改

7 個寫入動作是**在外面包一層**，不是改原函式簽名：

```
saveNewLayout(payload)
  ↓ 前端改成呼叫
aitSaveNewLayout(payload, AIT_TOKEN)
  ↓ 內部
_aitWrap_(token, ...) → 驗 session → 呼叫原 saveNewLayout(payload) → 依回傳結果寫記錄
```

好處：既有邏輯零風險，回傳格式完全不變。

已包裝的 7 個：

| 包裝函式 | 對應原函式 | 記錄的動作 |
|---|---|---|
| `aitSaveNewLayout` | `saveNewLayout` | 建立上架版面 |
| `aitUpdateLayoutFieldBatch` | `updateLayoutFieldBatch` | 更新欄位 |
| `aitOffShelfDisplayBatch` | `offShelfDisplayBatch` | 下架 |
| `aitUpdateDisplayBatch` | `updateDisplayBatch` | 更新陳列 |
| `aitAddCustomerToZoning` | `addCustomerToZoning` | 加入業務分區 |
| `aitSetCustomerVisibility` | `setCustomerVisibility` | 顯示／隱藏客戶 |

---

## 五、白名單 Email 欄

在 **業務庫（`1zTTl3IjrwZvYdxvX3UZk6YLVaGF7m_DBhb_tWM2LjW0`）→ 白名單** 分頁。
沒有 `Email` 欄時**自動補建**（沿用 `Code.js` 既有加「安全金鑰」欄的寫法，見 `Code.js:515-525`）。

沿用原欄位：`名字 / 等級 / 公司 / 金鑰 / 狀態`，新增：`Email`

**登入條件**：等級 = `SALES` 或 `KING`，且狀態 = `approved`（沒狀態欄則不看狀態）。

**fail-closed**：Email 留空 = 不能登入，沒有「白名單沒填就放行」這種情況。

### 要填的 Email（**務必自行確認是否同一批人**）

| 姓名 | Email |
|---|---|
| 高弘治 | titankou2002@gmail.com |
| LYNN | lynnloveshumi@gmail.com |
| 謝博皓 | sb780910@gmail.com |
| 潘右森 | panus081231@gmail.com |
| 陳勁多 | ghosts0125@gmail.com |
| DORIS | doris6715@gmail.com |

> 這份名單是從「保留系統」那邊的白名單推測的，**沒有實際讀取本專案白名單確認**。
> 吳炳榮沒有 Email，登不進來。

---

## 六、操作記錄分頁

位於同一個業務庫試算表，11 欄：

```
時間 | 登入時間 | Session | Email | 姓名 | 等級 | 公司 | 事件 | 動作/對象 | 內容 | 結果
```

寫入的三種事件：

- **登入** — 每次進業務端主 App
- **登出** — 主動登出
- **變動** — 上表 7 個寫入動作，含成功／失敗與失敗原因

另外兩個內部 API：`aitGetLog(limit)` 查詢（最新在上，預設 200、上限 1000）、`aitTrack(event,target,detail,result)` 前端主動記一筆。

寫入特性：
- 照表頭長度**多退少補**，不會再出現「欄數與範圍不符」
- 開頭是 `= + - @` 的字串會加前導單引號，避免被試算表當公式
- 用 `LockService.getScriptLock().tryLock(1500)`，**拿不到鎖也照寫**，且所有例外吞掉 —— 記錄失敗絕不能影響主流程

---

## 七、session 機制

- token = 32 位 hex，存在 `CacheService`，TTL 6 小時（21600 秒，Cache 上限）
- token 由網址參數 `?_t=` 帶進來，登入成功後前端 `location.replace()` 帶回去
- 登入時用 `auto_select: true`，已簽入的 Google 帳號**不會跳提示**，靜默拿到 token
- 前端每 3 分鐘 `aitHeartbeat(token)` 回報一次，讓記錄看得出「這個人在線上」
- 6 小時後需重新登入（因為已簽入，實際上是無感的）

---

## 八、上線步驟（**必做，目前還沒做**）

1. **業務庫 → 白名單** 分頁，填入上表 Email
2. Apps Script 編輯器 → 選 `setupAitAuth` → 執行
   - 建立／確認「操作記錄」分頁
   - 回報**哪幾個業務還沒填 Email**
3. 開一次 `https://bigt.cc/ait/inventory.html?sales=高弘治&key=fcb8e8b6` 驗證
4. 確認客戶端 `?view=client&clientName=...&key=...` 仍可正常開啟

> ⚠️ 第 2 步也可以省略 —— 第一個登入的人進場時會自動建立分頁與 Email 欄。
> 但在有人填 Email 之前，**所有人都會被擋下來**（fail-closed），所以建議先跑一次 `setupAitAuth` 看名單。

---

## 九、驗證狀態

### 已做

- 16 個 `*.js` 全部通過 `node --check`
- 24 項離機測試全過（`/tmp/ait_test.js`）：
  - index.html 19 個 include 全部展開、無殘留 template 標籤
  - `APP_CONFIG.params` 正確帶入 `sales` / `_t`
  - 8 處寫入呼叫已改用包裝版、舊呼叫已清乾淨
  - 客戶端頁面不會被強制登入攔截
  - 重新載入時不會把舊 token 帶回去
  - 操作記錄欄數對齊（滿 11／缺欄／多欄／公式注入）
  - 包裝層 detail 字串格式正確

### 沒做（**尚未在真實 GAS 上執行過**）

- 沒有人實際跑過 `setupAitAuth`
- 沒有真實 Google 登入 → tokeninfo 驗簽的往返
- 沒有真實寫入操作記錄
- 需人工確認：客戶端連結沒被影響、既有業務流程沒壞

---

## 十、過程中抓到並修掉的兩個 bug

1. **`JS_AitAuth.html` 自己 include 自己**
   原本寫成 `<?!= include('JS_AitAuth'); ?>`，而 `include()` 定義在 `Code.js:5254`：
   ```js
   function include(filename) {
     return HtmlService.createHtmlOutputFromFile(filename).getContent();
   }
   ```
   這是**單次文字取代**，巢狀 include 不會被展開。頁面會出現字面標籤、`AIT_TOKEN` 變 undefined，導致所有寫入動作被擋。已改成內容直接寫在檔案裡。

2. **測試腳本自己的 bug**
   用 `String.replace(tag, content)` 帶字串取代時，檔案內容裡的 `$&` 會被當成反向引用，導致 include 標籤被錯誤還原，產生大量假警報。已改用函式取代 `replace(tag, () => content)`。

> 教訓：測試工具本身也會壞，看到「離線測試全過」不代表測試是對的。

---

## 十一、還沒處理的已知問題

### 1. 客戶端資料函式沒有驗金鑰（**洞**）

`Client_Inventory.js` 的 `checkClientStock(sku, requiredPyeong, userId, userName)`
**完全沒驗金鑰，也沒驗身分**。`doGet` 有擋頁面，但資料函式本身是裸的。
任何知道品碼的人都可以打這個函式。

屬於「客戶端以後再說」的範圍，本次沒動。

### 2. 還有 30 幾個寫入函式沒接記錄

盤點出約 40 個有寫入的 server 函式，本次只接了版面／客戶這 6 個核心的。
**未接的**包含：

| 檔案 | 未記錄的寫入函式 |
|---|---|
| `FieldWork.js` | `saveWorkLog`、`saveAttendance`、`saveDrivingFuelRecord`、`saveMaintenanceRecord`、`updateWorkLog`、`submitLeaveRequest`、`deleteWorkLogEntry` 等 |
| `Attendance.js` | `savePunchRecord`、`saveSalarySlips`、`addLeaveRecord`、`updateLeaveStatus` 等 |
| `Sales.js` | `saveSalesBonusRow`、`syncSalesDataByYear` |
| `Inventory.js` | `syncReservationStock` |
| `Code_SalesDelivery.js` | `completeSalesDeliveryTask`、`completeSampleTask`、`transferSalesDeliveryTask` |

要全部接上需要再改約 30 個前端呼叫點。

### 3. 其他未鎖的入口

`?view=inventory`、`?view=getkeys`、`?view=staff` 這三條**沒有登入保護**，
只靠原本的金鑰／內網慣例在擋。

### 4. 版面記錄神器 的 git 狀態是亂的

`git status` 顯示 **54 個 deleted + 55 個 untracked**，等於全專案檔案都被 `git rm --cached` 退出版控。
推測是刻意為了不讓 GAS 原始碼被 `.github/workflows/deploy.yml` FTP 部署到公開主機而這樣做
（那條 workflow 會把整個 repo 丟到 `public_html/ait/`，等於公開 `Code.js`）。

**這不影響 clasp 部署**（本次 @578 走的是 clasp，不是 GitHub Actions）。
但若日後要改用 GitHub 部署管線，必須先處理這個狀態。

---

## 十二、與「保留系統」無關的說明

本次工作**只有**上面這些。`保留系統/` 底下的 GAS 是另一個獨立專案（部署 ID 不同），
與 `bigt.cc/ait/` 沒有任何關係。

保留系統那邊先前也做過一套 Google 登入 + 操作記錄（部署 @293），
白名單放在統一認證表 `1N-tOQEP26akmcGRV34OwDusg0yFrtKfnJ79W3O-uNLM` 的 `保留系統_帳號` 分頁。
兩套機制目前是**各自獨立**的，尚未合併。
