/**
 * 🤖 AI 智慧查詢助理 (AI Query Assistant)
 * ------------------------------------------------
 * 讓使用者用口語化中文提問，例如：
 *   「百磚保留超過2個月的」
 *   「60X120這個尺寸，保留超過30坪的」
 *   「馬約利卡系列，保留超過3坪的」
 *   「百磚這三個月的業績與銷售哪些產品」
 *
 * 架構：
 *   1. _aiParseQuery_()   → 呼叫 AI（Gemini 或 Claude 皆可，自動偵測），把口語問題解析成結構化查詢條件 (強制結構化輸出，不會有自由文字幻覺)
 *   2. _aiQueryReserve_() / _aiQuerySales_() / _aiQueryInventory_() → 依解析出的條件，直接查真實試算表資料 (完全不靠 AI 生成數字，避免幻覺)
 *   3. aiAssistantAsk()   → 對外唯一入口，前端用 google.script.run.aiAssistantAsk(question) 呼叫
 *
 * 金鑰設定：Apps Script 專案 → 專案設定 → 指令碼屬性 (Script Properties) → 新增以下其中一組即可：
 *   - GEMINI_API_KEY     （Google AI Studio 申請，https://aistudio.google.com/apikey，有免費額度）
 *   - ANTHROPIC_API_KEY  （Anthropic Console 申請）
 * 兩組都有的話，可額外設定 AI_PROVIDER = "gemini" 或 "anthropic" 指定優先順序；不設定則優先用 Gemini。
 * （基於安全考量，金鑰一律由管理者自行在 Apps Script 後台輸入，程式不會經手/傳輸金鑰本身以外的用途）
 */

const AI_GEMINI_MODEL = 'gemini-2.5-flash';        // 僅做意圖解析，用輕量模型即可，省成本、速度快

// 🚦 費用防濫用：每個裝置每分鐘最多 5 次查詢；全站每分鐘最多 30 次當保底（避免有人乾脆不帶裝置ID繞過單機限制）。
// 超過的話要求輸入密碼才能繼續（密碼正確就這次直接放行，不佔用額度）。
const AI_RATE_LIMIT_PER_DEVICE_PER_MIN = 5;
const AI_RATE_LIMIT_GLOBAL_PER_MIN = 30;
const AI_RATE_LIMIT_BYPASS_PASSWORD = '0319';

// 📏 單一查詢最多回傳幾筆（保留單原本沒有上限，寬鬆條件可能一次撈出幾千筆拖慢前端，這裡補上跟 sales/inventory 同等級的上限）
const AI_RESULT_LIMIT = 80;

/**
 * 🚦 檢查/累計呼叫次數（同一分鐘內的簡易計數，非嚴格滑動窗口，但足夠防濫用）
 * @returns {boolean} true = 還在額度內（已計入這次呼叫），false = 已超過
 */
function _aiRateLimitTryConsume_(deviceId) {
  const cache = CacheService.getScriptCache();
  const minuteBucket = Math.floor(Date.now() / 60000);

  const globalKey = 'AI_RATE_GLOBAL_' + minuteBucket;
  const globalCount = parseInt(cache.get(globalKey) || '0', 10);
  if (globalCount >= AI_RATE_LIMIT_GLOBAL_PER_MIN) return false;

  const devKey = 'AI_RATE_DEV_' + (String(deviceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)) + '_' + minuteBucket;
  const devCount = parseInt(cache.get(devKey) || '0', 10);
  if (devCount >= AI_RATE_LIMIT_PER_DEVICE_PER_MIN) return false;

  cache.put(globalKey, String(globalCount + 1), 70);
  cache.put(devKey, String(devCount + 1), 70);
  return true;
}

/**
 * 🔧 授權測試專用：在 Apps Script 編輯器手動執行這個函式一次，逼出「這項應用程式未經驗證」的授權同意畫面，
 * 完整走過 進階 → 前往專案(不安全) → 允許 的流程，才能讓 UrlFetchApp 的外部連線權限生效在整個部署上。
 * （直接執行 aiAssistantAsk 若沒帶參數，可能一開始就提前 return，不會真的觸發 UrlFetchApp，就不會跳出授權視窗）
 * ⚠️ 注意：函式名稱不能加底線開頭，底線開頭的函式會被 Apps Script 編輯器的「執行」下拉選單自動隱藏，選不到。
 */
function aiTestAuthorization() {
  const res = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('授權測試成功，HTTP ' + res.getResponseCode());
  return 'OK';
}
const AI_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

/**
 * 🔑 偵測目前設定了哪一組 AI 金鑰，回傳 { provider, key }；都沒設定回傳 null
 */
function _aiGetProviderConfig_() {
  const props = PropertiesService.getScriptProperties();
  const geminiKey = props.getProperty('GEMINI_API_KEY');
  const claudeKey = props.getProperty('ANTHROPIC_API_KEY');
  const preferred = String(props.getProperty('AI_PROVIDER') || '').toLowerCase().trim();

  if (preferred === 'anthropic' && claudeKey) return { provider: 'anthropic', key: claudeKey };
  if (preferred === 'gemini' && geminiKey) return { provider: 'gemini', key: geminiKey };
  if (geminiKey) return { provider: 'gemini', key: geminiKey };
  if (claudeKey) return { provider: 'anthropic', key: claudeKey };
  return null;
}

/**
 * 🎯 對外主入口：接收使用者的自然語言問題，回傳查詢結果
 * @param {string} question
 * @param {string} [deviceId] 前端 localStorage 存的裝置代號，用來做每分鐘次數限制（防止 API 費用被濫用）
 * @param {string} [bypassPassword] 超過每分鐘限額時，輸入這組密碼可直接放行本次查詢
 */
function aiAssistantAsk(question, deviceId, bypassPassword) {
  try {
    const q = String(question || '').trim();
    if (!q) return { success: false, msg: '請輸入您想查詢的內容' };

    // 🚦 頻率限制：密碼正確就直接放行（不佔額度），否則要吃掉一次額度
    const passwordOk = String(bypassPassword || '').trim() === AI_RATE_LIMIT_BYPASS_PASSWORD;
    if (!passwordOk) {
      const allowed = _aiRateLimitTryConsume_(deviceId);
      if (!allowed) {
        return {
          success: false,
          needsPassword: true,
          msg: '查詢太頻繁了（每分鐘最多 ' + AI_RATE_LIMIT_PER_DEVICE_PER_MIN + ' 次），請稍候一分鐘，或輸入密碼繼續查詢。'
        };
      }
    }

    const providerCfg = _aiGetProviderConfig_();
    if (!providerCfg) {
      return {
        success: false,
        needsApiKey: true,
        msg: '尚未設定 AI 查詢金鑰。請管理者至 Apps Script 專案「專案設定 → 指令碼屬性」新增 GEMINI_API_KEY 或 ANTHROPIC_API_KEY 其中一筆。'
      };
    }

    const parsed = _aiParseQuery_(q, providerCfg);
    if (!parsed.success) return parsed;

    const queries = parsed.queries || [];
    if (!queries.length) {
      return { success: false, msg: '無法理解您的問題，換個說法試試，例如：「百磚保留超過2個月的」' };
    }

    const sections = queries.map(item => {
      try {
        if (item.domain === 'reserve') return _aiQueryReserve_(item);
        if (item.domain === 'sales') return _aiQuerySales_(item);
        if (item.domain === 'inventory') return _aiQueryInventory_(item);
        return { title: item.description || '', error: '不支援的查詢類型：' + item.domain };
      } catch (e) {
        return { title: item.description || '', error: e.toString() };
      }
    });

    return { success: true, question: q, sections: sections };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

/**
 * 📝 意圖解析用的共用系統提示詞
 */
function _aiSystemPrompt_() {
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return [
    '你是高雅瓷磁磚公司內部系統的資料查詢「意圖解析器」。今天日期是 ' + today + '。',
    '使用者會用口語化中文詢問「保留單」「業績/銷售」或「庫存」相關問題，你要把它拆解成一到多筆結構化查詢條件並回傳。',
    '絕對不要自己回答數字或編造資料，你只負責拆解條件。',
    '',
    '三種 domain：',
    '- reserve：查保留單（哪些品項被保留、保留多久、保留多少坪）。',
    '- sales：查業績/銷售（某期間賣了哪些產品、賣多少金額/數量）。',
    '- inventory：查目前庫存/可用庫存。',
    '',
    '規則：',
    '- 「幾個月」換算保留天數請用 每月=30 天（例如「超過2個月」→ minReserveDays=60）。',
    '- 「超過N坪」請填入 minPyeong。',
    '- 「超過N片」請填入 minPieces。同一句話可能同時有坪數與片數兩個門檻，兩個都要填，不要只填其中一個。',
    '- 「近N個月的業績」請填入 monthsBack（沒提到期間預設 1）。',
    '- series（系列）、size（尺寸）只填使用者確實提到的關鍵字，沒提到就留空字串，不要自己亂猜或轉換寫法。',
    '- 尺寸請保留使用者原始寫法（例如 60X120），不用轉換大小寫或格式。',
    '- 每筆查詢都要有 description，用一句簡短中文描述這筆查詢在找什麼，會直接顯示給使用者看。',
    '- 如果一句話同時問了「業績」與「賣了哪些產品」，這是同一筆 sales 查詢，不要拆成兩筆。',
    '- 使用者的問題裡如果有多個併存的門檻條件（例如同時講了天數/月數、坪數、片數），每一個都要盡量對應填進正確欄位，不要漏掉任何一個。',
    '- 使用者的口語不一定標準，數字/單位可能黏在一起、順序顛倒、少打字、用「x」「X」「＊」「*」混用當尺寸乘號、用「筆」代替「片」、',
    '  用「幾張」「幾單」代替「幾筆」，這些都要盡量理解成最接近的意思，不要因為寫法不標準就放棄解析，寧可過度理解也不要回傳空陣列。',
    '- 如果完全看不出使用者想查 reserve/sales/inventory 三者中的哪一種，才視為真的無法理解；否則一律盡力猜一個最合理的 domain 並回傳。',
    '',
    '以下是幾個範例（僅供理解句型模式，不要照抄裡面的具體數字）：',
    '- 問「馬約利卡超過60天保留的」→ [{domain:"reserve", series:"馬約利卡", minReserveDays:60, description:"查詢馬約利卡系列保留超過60天的保留單"}]',
    '- 問「60*120幫我查一下庫存」→ [{domain:"inventory", size:"60*120", description:"查詢60*120尺寸的庫存"}]',
    '- 問「上個月百碳賣多少」→ [{domain:"sales", series:"百碳", monthsBack:1, description:"查詢百碳系列上個月的銷售"}]',
    '- 問「AA61251這支保留多久了」→ [{domain:"reserve", skuKeyword:"AA61251", description:"查詢編號AA61251的保留天數"}]',
    '- 問「哪個客戶保留最多」→ [{domain:"reserve", description:"查詢保留單，依保留量排序找出保留最多的客戶"}]'
  ].join('\n');
}

/**
 * 🧠 把口語問題解析為結構化查詢條件；依 providerCfg.provider 分派給 Gemini 或 Claude
 * （兩邊都強制走結構化輸出模式，不會有自由文字幻覺數字）
 */
function _aiParseQuery_(question, providerCfg) {
  if (providerCfg.provider === 'gemini') return _aiParseQueryGemini_(question, providerCfg.key);
  return _aiParseQueryClaude_(question, providerCfg.key);
}

/**
 * 🔷 Gemini 版：用 responseSchema 強制回傳 JSON（Google AI Studio 申請金鑰：https://aistudio.google.com/apikey）
 */
function _aiParseQueryGemini_(question, apiKey) {
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      queries: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            domain: { type: 'STRING', enum: ['reserve', 'sales', 'inventory'] },
            series: { type: 'STRING' },
            size: { type: 'STRING' },
            skuKeyword: { type: 'STRING' },
            customerKeyword: { type: 'STRING' },
            minReserveDays: { type: 'NUMBER' },
            minPyeong: { type: 'NUMBER' },
            minPieces: { type: 'NUMBER' },
            monthsBack: { type: 'NUMBER' },
            description: { type: 'STRING' }
          },
          required: ['domain', 'description']
        }
      }
    },
    required: ['queries']
  };

  const payload = {
    systemInstruction: { parts: [{ text: _aiSystemPrompt_() }] },
    contents: [{ role: 'user', parts: [{ text: String(question) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
      temperature: 0
    }
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + AI_GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    return { success: false, msg: 'AI 服務呼叫失敗 (HTTP ' + code + ')：' + body.slice(0, 300) };
  }

  let json;
  try { json = JSON.parse(body); } catch (e) { return { success: false, msg: 'AI 回應格式錯誤' }; }

  const textPart = json.candidates && json.candidates[0] && json.candidates[0].content &&
    json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
  if (!textPart) return { success: false, msg: 'AI 未回傳可解析的查詢條件，請換個說法再試一次' };

  let parsed;
  try { parsed = JSON.parse(textPart); } catch (e) { return { success: false, msg: 'AI 回應的 JSON 無法解析' }; }

  return { success: true, queries: parsed.queries || [] };
}

/**
 * 🔶 Claude 版：強制 tool_use（Anthropic Console 申請金鑰）
 */
function _aiParseQueryClaude_(question, apiKey) {
  const toolSchema = {
    name: 'submit_query',
    description: '提交解析後的結構化查詢條件',
    input_schema: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              domain: { type: 'string', enum: ['reserve', 'sales', 'inventory'] },
              series: { type: 'string' },
              size: { type: 'string' },
              skuKeyword: { type: 'string' },
              customerKeyword: { type: 'string' },
              minReserveDays: { type: 'number' },
              minPyeong: { type: 'number' },
              minPieces: { type: 'number' },
              monthsBack: { type: 'number' },
              description: { type: 'string' }
            },
            required: ['domain', 'description']
          }
        }
      },
      required: ['queries']
    }
  };

  const payload = {
    model: AI_CLAUDE_MODEL,
    max_tokens: 1024,
    system: _aiSystemPrompt_(),
    messages: [{ role: 'user', content: String(question) }],
    tools: [toolSchema],
    tool_choice: { type: 'tool', name: 'submit_query' }
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    return { success: false, msg: 'AI 服務呼叫失敗 (HTTP ' + code + ')：' + body.slice(0, 300) };
  }

  let json;
  try { json = JSON.parse(body); } catch (e) { return { success: false, msg: 'AI 回應格式錯誤' }; }

  const toolUse = (json.content || []).find(c => c.type === 'tool_use');
  if (!toolUse || !toolUse.input) return { success: false, msg: 'AI 未回傳可解析的查詢條件，請換個說法再試一次' };

  return { success: true, queries: toolUse.input.queries || [] };
}

/**
 * 🔎 模糊比對：關鍵字為空一律視為符合；有值時雙向 includes（不分大小寫、忽略空白/橫線）
 */
function _aiMatchKeyword_(target, keyword) {
  const k = String(keyword || '').replace(/[\s\-]/g, '').toUpperCase();
  if (!k) return true;
  const t = String(target || '').replace(/[\s\-]/g, '').toUpperCase();
  if (!t) return false;
  return t.indexOf(k) !== -1 || k.indexOf(t) !== -1;
}

/**
 * 📦 產品主檔對照表：SKU → { series, size, spec, perPing, perBox, boxPerPallet, image, stockPyeong, stockQty }
 * 讀「編號價目表」，30 分鐘快取
 * （AIQuery 與 IncomingCargo 共用同一份對照表，避免重複掃表）
 * @param {string} [ssId] 指定試算表 ID（例如安帝嘉/喜悅納各自獨立的試算表）；不傳則預設讀高雅瓷主表 CONFIG.SS_ID_MAIN
 */
function _getProductMasterMap_(ssId) {
  const targetSsId = ssId || CONFIG.SS_ID_MAIN;
  const cacheKey = 'AI_PRODUCT_MASTER_v2_' + targetSsId; // v2: 新增圖片/片箱/箱板欄位（供到貨明細使用）
  try {
    const cached = CacheManager.getLarge(cacheKey);
    if (cached) return cached;
  } catch (e) {}

  const map = {};
  try {
    const ss = SpreadsheetApp.openById(targetSsId);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_PRODUCTS);
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const idx = {
        sku: findHeaderIndex(headers, ['編號', '產品編號', '品碼']),
        series: findHeaderIndex(headers, ['中文系列', '系列']),
        size: findHeaderIndex(headers, ['尺寸', 'SIZE']),
        spec: findHeaderIndex(headers, ['規格']),
        perPing: findHeaderIndex(headers, ['片/坪', '片坪']),
        perBox: findHeaderIndex(headers, ['片/箱', '每箱片數', '包裝']),
        boxPerPallet: findHeaderIndex(headers, ['箱/板', '箱/棧板', '每板箱數', '每棧板箱數']),
        image: findHeaderIndex(headers, ['單片連結網址', '單片連結', '產品縮圖', '圖片']),
        sceneFolder: findHeaderIndex(headers, ['雲端圖片', '雲端圖片(實景圖)', '實景照片']),
        stockPyeong: findHeaderIndex(headers, ['庫存坪數', '現有坪數', '總坪數']),
        stockQty: findHeaderIndex(headers, ['庫存片數', '現有片數', '總片數'])
      };
      if (idx.sku !== -1) {
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const rawSku = String(row[idx.sku] || '').trim();
          if (!rawSku) continue;
          const key = rawSku.replace(/[\s\-]/g, '').toUpperCase();
          map[key] = {
            sku: rawSku,
            series: idx.series !== -1 ? String(row[idx.series] || '').trim() : '',
            size: idx.size !== -1 ? String(row[idx.size] || '').trim() : '',
            spec: idx.spec !== -1 ? String(row[idx.spec] || '').trim() : '',
            perPing: idx.perPing !== -1 ? (parseFloat(row[idx.perPing]) || 36) : 36,
            perBox: idx.perBox !== -1 ? (parseFloat(row[idx.perBox]) || 0) : 0,
            boxPerPallet: idx.boxPerPallet !== -1 ? (parseFloat(row[idx.boxPerPallet]) || 0) : 0,
            image: idx.image !== -1 ? String(row[idx.image] || '').trim() : '',
            sceneFolder: idx.sceneFolder !== -1 ? String(row[idx.sceneFolder] || '').trim() : '',
            stockPyeong: idx.stockPyeong !== -1 ? (parseFloat(row[idx.stockPyeong]) || 0) : 0,
            stockQty: idx.stockQty !== -1 ? (parseFloat(row[idx.stockQty]) || 0) : 0
          };
        }
      }
    }
  } catch (e) {
    console.warn('_getProductMasterMap_ 讀取失敗: ' + e);
  }

  try { CacheManager.putLarge(cacheKey, map, 1800); } catch (e) {}
  return map;
}

/**
 * 📋 domain=reserve：查保留單
 */
function _aiQueryReserve_(q) {
  const productMap = _getProductMasterMap_();

  let ss = null;
  if (CONFIG.RESERVE_SS_ID) {
    try { ss = SpreadsheetApp.openById(CONFIG.RESERVE_SS_ID); } catch (e) {}
  }
  if (!ss) ss = SpreadsheetApp.openById(CONFIG.SS_ID);

  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME_RESERVE || '保留單');
  if (!sheet) {
    // 相容性容錯：找不到固定表名時，改抓第一個名稱含「保留」的分頁
    const found = ss.getSheets().find(s => s.getName().indexOf('保留') !== -1);
    if (found) sheet = found;
  }
  if (!sheet) return { title: q.description, error: '找不到保留單工作表' };

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { title: q.description, columns: [], rows: [], summary: '暫無保留單資料' };

  const headers = data[0];
  const idx = {
    sku: findHeaderIndex(headers, ['編號', '產品編號']),
    qty: findHeaderIndex(headers, ['保留數量', '數量', '片數']),
    pyeong: findHeaderIndex(headers, ['保留坪數', '坪數']),
    date: findHeaderIndex(headers, ['保留日期', '日期', '建檔日期']),
    cust: findHeaderIndex(headers, ['客戶', '公司', '客戶名稱']),
    biz: findHeaderIndex(headers, ['客戶業務', '負責業務', '業務']),
    caseName: findHeaderIndex(headers, ['案名', '工程名稱']),
    note: findHeaderIndex(headers, ['備註'])
  };
  if (idx.sku === -1) return { title: q.description, error: '保留單工作表格式不符（找不到編號欄位）' };

  const today = new Date();
  const results = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const sku = String(row[idx.sku] || '').trim();
    if (!sku) continue;

    const pKey = sku.replace(/[\s\-]/g, '').toUpperCase();
    const meta = productMap[pKey] || { series: '', size: '', spec: '', perPing: 36 };

    if (q.series && !_aiMatchKeyword_(meta.series, q.series)) continue;
    if (q.size && !_aiMatchKeyword_(meta.size + ' ' + meta.spec, q.size)) continue;
    if (q.skuKeyword && !_aiMatchKeyword_(sku, q.skuKeyword)) continue;

    const custRaw = idx.cust !== -1 ? String(row[idx.cust] || '').trim() : '';
    if (q.customerKeyword && custRaw.indexOf(q.customerKeyword) === -1) continue;

    const qty = idx.qty !== -1 ? (parseFloat(row[idx.qty]) || 0) : 0;
    let pyeong = idx.pyeong !== -1 ? (parseFloat(row[idx.pyeong]) || 0) : 0;
    if (!pyeong && qty) pyeong = Math.round((qty / (meta.perPing || 36)) * 100) / 100;

    const dRaw = idx.date !== -1 ? row[idx.date] : null;
    const d = parseDate(dRaw);
    const ageDays = (d && !isNaN(d.getTime())) ? Math.floor((today - d) / 86400000) : null;

    if (q.minReserveDays && (ageDays === null || ageDays < q.minReserveDays)) continue;
    if (q.minPyeong && pyeong < q.minPyeong) continue;
    if (q.minPieces && qty < q.minPieces) continue;

    results.push({
      sku: sku,
      series: meta.series,
      size: meta.size,
      qty: qty,
      pyeong: pyeong,
      ageDays: ageDays,
      dateStr: (d && !isNaN(d.getTime())) ? Utilities.formatDate(d, 'Asia/Taipei', 'yyyy/MM/dd') : (dRaw ? String(dRaw) : ''),
      customer: custRaw,
      biz: idx.biz !== -1 ? String(row[idx.biz] || '').trim() : '',
      caseName: idx.caseName !== -1 ? String(row[idx.caseName] || '').trim() : '',
      note: idx.note !== -1 ? String(row[idx.note] || '').trim() : ''
    });
  }

  results.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0) || (b.pyeong || 0) - (a.pyeong || 0));

  const totalPyeong = Math.round(results.reduce((s, r) => s + (r.pyeong || 0), 0) * 100) / 100;
  let summary = '共找到 ' + results.length + ' 筆保留單，合計 ' + totalPyeong + ' 坪。';
  if (results.length > AI_RESULT_LIMIT) summary += '（僅顯示前 ' + AI_RESULT_LIMIT + ' 筆，條件可以再縮小一點看更精確的結果）';
  const limited = results.slice(0, AI_RESULT_LIMIT);

  return {
    title: q.description,
    domain: 'reserve',
    columns: ['編號', '系列', '尺寸', '片數', '坪數', '保留天數', '保留日期', '客戶', '業務', '案名', '備註'],
    rows: limited.map(r => [r.sku, r.series, r.size, r.qty, r.pyeong, r.ageDays === null ? '-' : r.ageDays, r.dateStr, r.customer, r.biz, r.caseName, r.note]),
    cards: limited.map(r => ({
      headline: r.customer || '未指定客戶',                                     // 卡片最大字：客戶名稱最重要
      highlight: (r.ageDays === null ? '未知天數' : ('保留 ' + r.ageDays + ' 天')), // 次要重點：保留多久
      sub: r.sku + (r.series ? ' · ' + r.series : '') + (r.size ? ' · ' + r.size : ''),
      meta: [r.pyeong + ' 坪', r.qty + ' 片', r.dateStr].filter(Boolean).join(' ・ '),
      extra: [r.biz ? '業務：' + r.biz : '', r.caseName ? '案名：' + r.caseName : '', r.note ? '備註：' + r.note : ''].filter(Boolean).join(' ・ ')
    })),
    summary: summary
  };
}

/**
 * 📈 domain=sales：查業績/銷售（依產品彙總）
 */
function _aiQuerySales_(q) {
  const productMap = _getProductMasterMap_();
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID_MAIN);
  const sheet = ss.getSheetByName(SALES_CONFIG.SHEET_SALES);
  if (!sheet) return { title: q.description, error: '找不到經銷銷售報表' };

  const raw = sheet.getDataRange().getValues();
  if (!raw.length) return { title: q.description, columns: [], rows: [], summary: '暫無銷售資料' };

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(25, raw.length); i++) {
    const rowStr = raw[i].join('');
    if (rowStr.includes('日期') && (rowStr.includes('金額') || rowStr.includes('銷額'))) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) headerRowIdx = 0;

  const h = raw[headerRowIdx];
  const idx = {
    date: findHeaderIndex(h, ['單據日期', '銷貨日期', '日期']),
    amt: findHeaderIndex(h, ['金額', '銷額', '銷售金額', '成交金額', '小計', '總計', '未稅金額']),
    code: findHeaderIndex(h, ['產品編號', '編號', '品碼', '序號']),
    cust: findHeaderIndex(h, ['客戶名稱', '客戶']),
    note: findHeaderIndex(h, ['備註', '說明']),
    qty: findHeaderIndex(h, ['數量', '片數'])
  };
  if (idx.date === -1 || idx.amt === -1 || idx.code === -1) return { title: q.description, error: '銷售報表格式不符' };

  const monthsBack = (q.monthsBack && q.monthsBack > 0) ? q.monthsBack : 1;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - monthsBack * 30);

  const agg = {};
  let totalAmt = 0, totalQty = 0;

  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r];
    const d = parseDate(row[idx.date]);
    if (!d || isNaN(d.getTime()) || d < cutoff) continue;

    const custRaw = idx.cust !== -1 ? String(row[idx.cust] || '').trim() : '';
    const note = idx.note !== -1 ? String(row[idx.note] || '') : '';
    if (custRaw.includes('樣品') || note.includes('樣品') || note.includes('扣帶') || note.includes('代領') || custRaw.includes('代領')) continue;

    const code = String(row[idx.code] || '').trim();
    if (!code) continue;
    const pKey = code.replace(/[\s\-]/g, '').toUpperCase();
    const meta = productMap[pKey] || { series: '', size: '' };

    if (q.series && !_aiMatchKeyword_(meta.series, q.series)) continue;
    if (q.size && !_aiMatchKeyword_(meta.size, q.size)) continue;
    if (q.skuKeyword && !_aiMatchKeyword_(code, q.skuKeyword)) continue;
    if (q.customerKeyword && custRaw.indexOf(q.customerKeyword) === -1) continue;

    const amt = parseFloat(String(row[idx.amt] || '0').replace(/[$,\s,]/g, '')) || 0;
    const qty = idx.qty !== -1 ? (parseFloat(row[idx.qty]) || 0) : 0;
    if (!amt && !qty) continue;

    if (!agg[code]) agg[code] = { sku: code, series: meta.series, size: meta.size, perPing: meta.perPing || 36, qty: 0, amt: 0, orders: 0 };
    agg[code].qty += qty;
    agg[code].amt += amt;
    agg[code].orders += 1;
    totalAmt += amt;
    totalQty += qty;
  }

  let results = Object.keys(agg).map(k => agg[k]);
  if (q.minPieces) results = results.filter(r => r.qty >= q.minPieces);
  if (q.minPyeong) results = results.filter(r => (r.qty / (r.perPing || 36)) >= q.minPyeong); // 銷售明細以片數換算坪數過濾（用各自 SKU 的片/坪比例）
  results.sort((a, b) => b.amt - a.amt);

  const summary = '近 ' + monthsBack + ' 個月共 ' + results.length + ' 項產品，銷售金額合計 $' + Math.round(totalAmt).toLocaleString() + '，數量合計 ' + totalQty + '。';

  return {
    title: q.description,
    domain: 'sales',
    columns: ['編號', '系列', '尺寸', '數量', '銷售金額', '訂單筆數'],
    rows: results.slice(0, 50).map(r => [r.sku, r.series, r.size, r.qty, Math.round(r.amt), r.orders]),
    cards: results.slice(0, 50).map(r => ({
      headline: r.sku + (r.series ? ' · ' + r.series : ''),          // 卡片最大字：產品編號/系列最重要
      highlight: '$' + Math.round(r.amt).toLocaleString(),           // 次要重點：銷售金額
      sub: (r.size || '') + '　' + r.qty + ' 片',
      meta: r.orders + ' 筆訂單',
      extra: ''
    })),
    summary: summary
  };
}

/**
 * 🏬 domain=inventory：查目前庫存
 */
function _aiQueryInventory_(q) {
  const productMap = _getProductMasterMap_();

  const results = Object.keys(productMap)
    .map(k => productMap[k])
    .filter(m => {
      if (q.series && !_aiMatchKeyword_(m.series, q.series)) return false;
      if (q.size && !_aiMatchKeyword_(m.size, q.size)) return false;
      if (q.skuKeyword && !_aiMatchKeyword_(m.sku, q.skuKeyword)) return false;
      if (q.minPyeong && (m.stockPyeong || 0) < q.minPyeong) return false;
      if (q.minPieces && (m.stockQty || 0) < q.minPieces) return false;
      return true;
    });

  results.sort((a, b) => (b.stockPyeong || 0) - (a.stockPyeong || 0));

  const totalPyeong = Math.round(results.reduce((s, r) => s + (r.stockPyeong || 0), 0) * 100) / 100;
  const summary = '共 ' + results.length + ' 項符合條件的產品，庫存合計 ' + totalPyeong + ' 坪。';

  return {
    title: q.description,
    domain: 'inventory',
    columns: ['編號', '系列', '尺寸', '庫存片數', '庫存坪數'],
    rows: results.slice(0, 80).map(r => [r.sku, r.series, r.size, r.stockQty, r.stockPyeong]),
    cards: results.slice(0, 80).map(r => ({
      headline: r.sku + (r.series ? ' · ' + r.series : ''),  // 卡片最大字：產品編號/系列最重要
      highlight: r.stockPyeong + ' 坪',                       // 次要重點：庫存坪數
      sub: r.size || '',
      meta: r.stockQty + ' 片',
      extra: ''
    })),
    summary: summary
  };
}
