import { db, type LlmCallRow, type LlmConfigRow, type LlmPlatform } from '../db';

const PLATFORM_DEFAULTS: Record<LlmPlatform, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { baseUrl: '', model: '' },
};

export function isLlmPlatform(v: any): v is LlmPlatform {
  return v === 'deepseek' || v === 'openai' || v === 'custom';
}

export function maskApiKey(key: string): string {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 8) return `${k.slice(0, 2)}****`;
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}

function rowToPublic(row: LlmConfigRow) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    base_url: row.base_url,
    api_key_masked: maskApiKey(row.api_key),
    has_api_key: !!row.api_key,
    model: row.model,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    timeout_seconds: row.timeout_seconds ?? 20,
    thinking_enabled: !!(row.thinking_enabled ?? 0),
    enabled: !!row.enabled,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listConfigs() {
  const rows = db.prepare('SELECT * FROM llm_configs ORDER BY is_active DESC, id ASC').all() as LlmConfigRow[];
  return rows.map(rowToPublic);
}

export function getActiveConfig(): LlmConfigRow | null {
  return (
    (db
      .prepare("SELECT * FROM llm_configs WHERE is_active = 1 AND enabled = 1 ORDER BY id ASC LIMIT 1")
      .get() as LlmConfigRow | undefined) || null
  );
}

function getConfigRow(id: number): LlmConfigRow | null {
  return (db.prepare('SELECT * FROM llm_configs WHERE id = ?').get(id) as LlmConfigRow | undefined) || null;
}

export interface LlmConfigInput {
  name?: string;
  platform?: LlmPlatform;
  base_url?: string;
  api_key?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  timeout_seconds?: number;
  thinking_enabled?: boolean;
  enabled?: boolean;
}

export function createConfig(input: LlmConfigInput) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('配置名称不能为空');
  const platform = isLlmPlatform(input.platform) ? input.platform : 'deepseek';
  const defaults = PLATFORM_DEFAULTS[platform];
  const baseUrl = String(input.base_url ?? '').trim() || defaults.baseUrl;
  const model = String(input.model ?? '').trim() || defaults.model;
  const apiKey = String(input.api_key ?? '').trim();
  const temperature = clampNumber(input.temperature, 0, 1, 0.2);
  const maxTokens = Math.round(clampNumber(input.max_tokens, 64, 4096, 300));
  const timeoutSeconds = Math.round(clampNumber(input.timeout_seconds, 1, 300, 20));
  const thinking = input.thinking_enabled === true ? 1 : 0;
  const enabled = input.enabled === false ? 0 : 1;
  const existing = db.prepare('SELECT 1 FROM llm_configs WHERE name = ?').get(name);
  if (existing) throw new Error('配置名称已存在');
  const result = db
    .prepare(
      `INSERT INTO llm_configs (name, platform, base_url, api_key, model, temperature, max_tokens, timeout_seconds, thinking_enabled, enabled, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(name, platform, baseUrl, apiKey, model, temperature, maxTokens, timeoutSeconds, thinking, enabled);
  return rowToPublic(getConfigRow(Number(result.lastInsertRowid))!);
}

export function updateConfig(id: number, input: LlmConfigInput) {
  const row = getConfigRow(id);
  if (!row) throw new Error('配置不存在');
  const name = input.name !== undefined ? String(input.name).trim() : row.name;
  if (!name) throw new Error('配置名称不能为空');
  const dup = db.prepare('SELECT 1 FROM llm_configs WHERE name = ? AND id <> ?').get(name, id);
  if (dup) throw new Error('配置名称已存在');
  const platform = input.platform !== undefined && isLlmPlatform(input.platform) ? input.platform : row.platform;
  const baseUrl = input.base_url !== undefined ? String(input.base_url).trim() : row.base_url;
  const model = input.model !== undefined ? String(input.model).trim() : row.model;
  const apiKey =
    input.api_key !== undefined && String(input.api_key).trim() !== '' ? String(input.api_key).trim() : row.api_key;
  const temperature = input.temperature !== undefined ? clampNumber(input.temperature, 0, 1, row.temperature) : row.temperature;
  const maxTokens =
    input.max_tokens !== undefined ? Math.round(clampNumber(input.max_tokens, 64, 4096, row.max_tokens)) : row.max_tokens;
  const timeoutSeconds =
    input.timeout_seconds !== undefined
      ? Math.round(clampNumber(input.timeout_seconds, 1, 300, row.timeout_seconds ?? 20))
      : row.timeout_seconds ?? 20;
  const thinking = input.thinking_enabled !== undefined ? (input.thinking_enabled ? 1 : 0) : row.thinking_enabled ?? 0;
  const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : row.enabled;
  db.prepare(
    `UPDATE llm_configs
       SET name = ?, platform = ?, base_url = ?, api_key = ?, model = ?, temperature = ?, max_tokens = ?,
           timeout_seconds = ?, thinking_enabled = ?, enabled = ?, updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(name, platform, baseUrl, apiKey, model, temperature, maxTokens, timeoutSeconds, thinking, enabled, id);
  return rowToPublic(getConfigRow(id)!);
}

export function deleteConfig(id: number) {
  const row = getConfigRow(id);
  if (!row) throw new Error('配置不存在');
  db.transaction(() => {
    db.prepare('DELETE FROM llm_configs WHERE id = ?').run(id);
    if (row.is_active) {
      const next = db.prepare('SELECT id FROM llm_configs WHERE enabled = 1 ORDER BY id ASC LIMIT 1').get() as
        | { id: number }
        | undefined;
      if (next) db.prepare('UPDATE llm_configs SET is_active = 1 WHERE id = ?').run(next.id);
    }
  })();
  return { id };
}

export function activateConfig(id: number) {
  const row = getConfigRow(id);
  if (!row) throw new Error('配置不存在');
  if (!row.enabled) throw new Error('请先启用该配置');
  db.transaction(() => {
    db.prepare('UPDATE llm_configs SET is_active = 0').run();
    db.prepare("UPDATE llm_configs SET is_active = 1, updated_at = datetime('now','localtime') WHERE id = ?").run(id);
  })();
  return rowToPublic(getConfigRow(id)!);
}

function clampNumber(v: any, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function getCacheStats() {
  // -1 表示接口未返回该字段（未采集）；统计时排除，避免把“没数据”当成“命中 0”
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN prompt_cache_hit_tokens >= 0 THEN prompt_cache_hit_tokens ELSE 0 END),0) AS hit,
              COALESCE(SUM(CASE WHEN prompt_cache_miss_tokens >= 0 THEN prompt_cache_miss_tokens ELSE 0 END),0) AS miss,
              SUM(CASE WHEN prompt_cache_hit_tokens >= 0 OR prompt_cache_miss_tokens >= 0 THEN 1 ELSE 0 END) AS collected
       FROM llm_calls WHERE kind = 'extract'`
    )
    .get() as { hit: number; miss: number; collected: number };
  const total = row.hit + row.miss;
  return {
    prompt_cache_hit_tokens: row.hit,
    prompt_cache_miss_tokens: row.miss,
    collected: row.collected || 0,
    // 没有任何采集到的数据时 hit_rate = null，界面显示“未采集”而非 0%
    hit_rate: total > 0 ? Math.round((row.hit / total) * 1000) / 10 : null,
  };
}

export function getLlmRuntime() {
  const active = getActiveConfig();
  return {
    llm_enabled: getSetting('llm_enabled', '0') === '1',
    daily_limit: Number(getSetting('llm_daily_limit', '500')) || 500,
    today_calls: todayCallCount(),
    active_config: active ? rowToPublic(active) : null,
    cache_stats: getCacheStats(),
  };
}

export function setLlmEnabled(enabled: boolean) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('llm_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(enabled ? '1' : '0');
  return { llm_enabled: enabled };
}

export function setDailyLimit(limit: number) {
  const n = Math.round(clampNumber(limit, 1, 100000, 500));
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('llm_daily_limit', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(n));
  return { daily_limit: n };
}

function todayCallCount(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM llm_calls WHERE kind = 'extract' AND date(created_at) = date('now','localtime')")
    .get() as { c: number };
  return row.c;
}

export function listCalls(limit = 50) {
  return db
    .prepare('SELECT * FROM llm_calls ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(1, limit), 200)) as LlmCallRow[];
}

function logCall(data: {
  config_id: number | null;
  platform: string;
  model: string;
  kind: string;
  success: boolean;
  error?: string;
  latency_ms: number;
  prompt_chars: number;
  completion_chars?: number;
  cacheHit?: number;
  cacheMiss?: number;
  user_emp_no?: string;
}) {
  db.prepare(
    `INSERT INTO llm_calls
       (config_id, platform, model, kind, success, error, latency_ms, prompt_chars, completion_chars,
        prompt_cache_hit_tokens, prompt_cache_miss_tokens, user_emp_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.config_id,
    data.platform,
    data.model,
    data.kind,
    data.success ? 1 : 0,
    String(data.error || '').slice(0, 500),
    data.latency_ms,
    data.prompt_chars,
    data.completion_chars || 0,
    data.cacheHit ?? -1,
    data.cacheMiss ?? -1,
    data.user_emp_no || ''
  );
}

function completionUrl(config: LlmConfigRow): string {
  const base = String(config.base_url || PLATFORM_DEFAULTS[config.platform].baseUrl).replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

function timeoutMs(config: LlmConfigRow): number {
  return Math.round(clampNumber(config.timeout_seconds, 1, 300, 20)) * 1000;
}

/** 构造请求体：DeepSeek 平台显式处理思考模式，其它平台不带私有参数 */
function buildBody(
  config: LlmConfigRow,
  messages: { role: string; content: string }[],
  options: { jsonMode?: boolean; maxTokens?: number }
): Record<string, any> {
  const body: Record<string, any> = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: options.maxTokens ?? config.max_tokens,
    stream: false,
  };
  if (options.jsonMode) body.response_format = { type: 'json_object' };
  if (config.platform === 'deepseek') {
    if (config.thinking_enabled) {
      body.thinking = { type: 'enabled' };
    } else {
      body.thinking = { type: 'disabled' };
      body.reasoning_effort = 'none';
    }
  }
  return body;
}

interface CallResult {
  ok: boolean;
  message: string;
  content?: string;
  status?: number;
}

/** 单次 LLM HTTP 调用，含超时、finish_reason 与空内容校验；调用方负责重试 */
interface CallOutcome {
  ok: boolean;
  content: string;
  error: string;
  status: number;
  finishReason: string;
  cacheHit: number;
  cacheMiss: number;
}

async function callOnce(config: LlmConfigRow, body: Record<string, any>): Promise<CallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(config));
  let cacheHit = 0;
  let cacheMiss = 0;
  try {
    const response = await fetch(completionUrl(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api_key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const status = response.status;
    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text);
        detail = String(parsed?.error?.message || parsed?.message || detail).slice(0, 200);
      } catch {
        // keep raw
      }
      let message = `模型接口返回 ${status}`;
      if (status === 401 || status === 403) message = 'API Key 无效或已过期（401/403）';
      else if (status === 402) message = '账户余额不足（402），请充值后再试';
      else if (status === 400) message = '请求体格式错误（400），请检查模型名与请求参数配置';
      else if (status === 422) message = '请求参数错误（422），模型不支持当前参数组合';
      else if (status === 404 || (/model|模型/i.test(detail) && /not\s*found|不存在|invalid/i.test(detail))) {
        message = `模型不存在或名称错误（${status}）`;
      } else if (status === 429) message = '请求过于频繁或额度不足（429）';
      else if (status >= 500) message = '模型服务暂时不可用（5xx）';
      return { ok: false, content: '', error: `${message}：${detail}`, status, finishReason: '', cacheHit, cacheMiss };
    }
    const parsed = JSON.parse(text);
    const content = String(parsed?.choices?.[0]?.message?.content || '');
    const finishReason = String(parsed?.choices?.[0]?.finish_reason || '');
    const usage = parsed?.usage || {};
    // 只有接口确实返回该字段（number）才记实际值；字段缺失记 -1 = 未采集，避免与真实 0 混淆
    cacheHit = typeof usage.prompt_cache_hit_tokens === 'number' ? usage.prompt_cache_hit_tokens : -1;
    cacheMiss = typeof usage.prompt_cache_miss_tokens === 'number' ? usage.prompt_cache_miss_tokens : -1;
    if (finishReason === 'length') {
      return { ok: false, content: '', error: '输出被 max_tokens 截断（finish_reason=length）', status, finishReason, cacheHit, cacheMiss };
    }
    if (!content.trim()) {
      return { ok: false, content: '', error: '模型返回内容为空或仅空白', status, finishReason, cacheHit, cacheMiss };
    }
    return { ok: true, content, error: '', status, finishReason, cacheHit, cacheMiss };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    const error = aborted
      ? `请求超时（超过 ${timeoutMs(config) / 1000} 秒）`
      : `网络连接失败：${e?.message || '无法连接模型服务'}`;
    return { ok: false, content: '', error, status: 0, finishReason: '', cacheHit, cacheMiss };
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(config: LlmConfigRow) {
  const started = Date.now();
  const body = buildBody(config, [{ role: 'user', content: 'Only reply the word ok as a JSON object.' }], {
    jsonMode: true,
    maxTokens: 32,
  });
  let last = await callOnce(config, body);
  let cacheHit = last.cacheHit;
  let cacheMiss = last.cacheMiss;
  // 测试连接也遵循“空内容/格式问题重试一次”
  if (!last.ok && /空白|空|截断/.test(last.error)) {
    last = await callOnce(config, body);
    const merge = (cur: number, next: number) => (next < 0 ? cur : cur < 0 ? next : cur + next);
    cacheHit = merge(cacheHit, last.cacheHit);
    cacheMiss = merge(cacheMiss, last.cacheMiss);
  }
  logCall({
    config_id: config.id,
    platform: config.platform,
    model: config.model,
    kind: 'connect',
    success: last.ok,
    error: last.error,
    latency_ms: Date.now() - started,
    prompt_chars: JSON.stringify(body).length,
    completion_chars: last.content.length,
    cacheHit,
    cacheMiss,
  });
  return { ok: last.ok, message: last.ok ? 'ok' : last.error, content: last.content };
}

export async function testConfigById(id: number) {
  const row = getConfigRow(id);
  if (!row) throw new Error('配置不存在');
  if (!row.api_key) return { ok: false, message: '该配置尚未填写 API Key' };
  return testConnection(row);
}

export interface ExtractedKeywords {
  model: string;
  customer: string;
  symptoms: string[];
  expanded: string[];
  expandedByTerm: Record<string, string[]>;
}

export interface ExtractOutcome {
  ok: boolean;
  keywords?: ExtractedKeywords;
  reason?: string;
}

const JSON_FORMAT_EXAMPLE = JSON.stringify({
  model: '联想 SR650',
  customer: '华为',
  symptoms: ['开机无显示', '风扇满转'],
  expanded: ['无显示', '供电', '电源模块', '供电类'],
  expandedByTerm: { '开机不显示': ['无画面', '黑屏'], '供电异常': ['电源模块', '12V'] },
});

/**
 * 固定 system 提示词：一个字都不随请求变化，保证 DeepSeek 硬盘缓存前缀完全一致。
 * 严禁在此加入时间、工号、机型列表、标准词表等任何动态内容——那些一律放到 user 消息。
 */
const FIXED_SYSTEM_PROMPT =
  '你是服务器主板维修知识库的检索条件抽取器（JSON extractor）。' +
  '你必须只输出一个合法的 json 对象，不要输出 Markdown、解释文字或案例编号。' +
  '输出 json 必须严格包含以下四个字段：' +
  'model（机型名称字符串）、customer（客户名称字符串）、symptoms（故障现象词元数组，需把原话拆成多个独立词，不要原样照抄整句）、' +
  'expanded（关键词扩展数组，包含该现象的同义说法、相关部件词、可能的故障分类词）、' +
  'expandedByTerm（json 对象，键为 symptoms 里的每个现象词，值为该词专属的扩展候选数组；每个未覆盖的现象词都要有对应条目）。' +
  `输出 json 示例：${JSON_FORMAT_EXAMPLE}。` +
  '无法判断的字段用空字符串或空数组。不要编造案例编号或处理结论。';

function buildExtractUserMessage(
  text: string,
  models: string[],
  customers: string[],
  standardHints: string[]
): string {
  return (
    `用户描述：${text}\n\n` +
    `可选机型：${models.join('、') || '无'}\n` +
    `可选客户：${customers.join('、') || '无'}\n` +
    `可选现象标准词：${standardHints.join('、') || '无'}\n` +
    '请拆词归一化后输出上述 json。'
  );
}

export async function extractKeywordsWithLlm(text: string, userEmpNo: string): Promise<ExtractOutcome> {
  const config = getActiveConfig();
  if (!config) return { ok: false, reason: '未启用任何模型配置' };
  if (!config.api_key) return { ok: false, reason: '当前模型配置未填写 API Key' };

  const limit = Number(getSetting('llm_daily_limit', '500')) || 500;
  if (todayCallCount() >= limit) return { ok: false, reason: `今日调用已达上限 ${limit} 次` };

  const models = (db.prepare('SELECT model FROM models').all() as { model: string }[]).map((m) => m.model);
  const customers = (db.prepare('SELECT name FROM customers').all() as { name: string }[]).map((c) => c.name);
  const standardHints = (db.prepare('SELECT standard FROM symptom_dict').all() as { standard: string }[]).map(
    (s) => s.standard
  );
  const userPrompt = buildExtractUserMessage(text, models, customers, standardHints);
  // system 完全固定（一个字都不随请求变化），所有动态内容都在最后一条 user 消息里
  const body = buildBody(
    config,
    [
      { role: 'system', content: FIXED_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { jsonMode: true }
  );

  const started = Date.now();
  let content = '';
  let errorMessage = '';
  let success = false;
  let cacheHit = -1;
  let cacheMiss = -1;
  // -1=未采集；累加时忽略 -1，只要有任意一次返回了真实值就以真实值累加
  const merge = (cur: number, next: number) => (next < 0 ? cur : cur < 0 ? next : cur + next);

  let last = await callOnce(config, body);
  cacheHit = merge(cacheHit, last.cacheHit);
  cacheMiss = merge(cacheMiss, last.cacheMiss);
  // 空内容/空白/截断/解析失败：重试一次，仍失败则降级
  if (!last.ok && /空白|空|截断/.test(last.error)) {
    last = await callOnce(config, body);
    cacheHit = merge(cacheHit, last.cacheHit);
    cacheMiss = merge(cacheMiss, last.cacheMiss);
  }

  let data: any = null;
  if (last.ok) {
    content = last.content;
    try {
      data = JSON.parse(content.trim());
    } catch {
      // JSON.parse 失败：重试一次
      const retry = await callOnce(config, body);
      cacheHit = merge(cacheHit, retry.cacheHit);
      cacheMiss = merge(cacheMiss, retry.cacheMiss);
      if (retry.ok) {
        content = retry.content;
        try {
          data = JSON.parse(content.trim());
        } catch {
          errorMessage = '模型输出无法解析为 JSON';
        }
      } else {
        errorMessage = retry.error;
      }
    }
  } else {
    errorMessage = last.error;
  }

  if (data && typeof data === 'object') {
    const keywords: ExtractedKeywords = {
      model: typeof data.model === 'string' ? data.model.trim().slice(0, 80) : '',
      customer: typeof data.customer === 'string' ? data.customer.trim().slice(0, 80) : '',
      symptoms: Array.isArray(data.symptoms)
        ? data.symptoms.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim().slice(0, 40)).slice(0, 8)
        : [],
      expanded: Array.isArray(data.expanded)
        ? data.expanded.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim().slice(0, 40)).slice(0, 20)
        : [],
      expandedByTerm:
        data.expandedByTerm && typeof data.expandedByTerm === 'object' && !Array.isArray(data.expandedByTerm)
          ? Object.fromEntries(
              Object.entries(data.expandedByTerm)
                .slice(0, 12)
                .map(([k, v]) => [
                  String(k).trim().slice(0, 40),
                  Array.isArray(v)
                    ? (v as any[]).filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, 40)).slice(0, 8)
                    : [],
                ])
            )
          : {},
    };
    success = true;
    logCall({
      config_id: config.id,
      platform: config.platform,
      model: config.model,
      kind: 'extract',
      success: true,
      latency_ms: Date.now() - started,
      prompt_chars: FIXED_SYSTEM_PROMPT.length + userPrompt.length,
      completion_chars: content.length,
      cacheHit,
      cacheMiss,
      user_emp_no: userEmpNo,
    });
    return { ok: true, keywords };
  }

  if (!errorMessage) errorMessage = '模型输出无法解析为 JSON';
  logCall({
    config_id: config.id,
    platform: config.platform,
    model: config.model,
    kind: 'extract',
    success: false,
    error: errorMessage,
    latency_ms: Date.now() - started,
    prompt_chars: FIXED_SYSTEM_PROMPT.length + userPrompt.length,
    completion_chars: content.length,
    cacheHit,
    cacheMiss,
    user_emp_no: userEmpNo,
  });
  return { ok: false, reason: errorMessage };
}

/**
 * 技术向对话：给一段自定义 system + user prompt，拿自然语言文本回复。
 * 复用 getActiveConfig / buildBody / callOnce，但：
 * - 不强制 JSON 输出（jsonMode=false），max_tokens 可覆盖；
 * - kind='conversation' 单独记日志，不计入 todayCallCount（只统计 extract），不改变既有每日上限口径；
 * - 失败不抛异常，返回 {ok:false,error}，调用方据此决定降级文案。
 * 修故障结论仍由数据库检索决定；本函数只做「把已有案例整理成自然语言」或「基于给定上下文回答」。
 */
export async function chatWithPrompt(
  systemPrompt: string,
  userPrompt: string,
  userEmpNo: string,
  options: { maxTokens?: number } = {}
): Promise<{ ok: boolean; content: string; error?: string }> {
  const config = getActiveConfig();
  if (!config || !config.api_key) return { ok: false, content: '', error: '未配置可用的大模型密钥' };
  const started = Date.now();
  const body = buildBody(
    config,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { jsonMode: false, maxTokens: options.maxTokens ?? 300 }
  );
  let last = await callOnce(config, body);
  if (!last.ok && /空白|空|截断/.test(last.error)) last = await callOnce(config, body);
  const promptChars = systemPrompt.length + userPrompt.length;
  logCall({
    config_id: config.id,
    platform: config.platform,
    model: config.model,
    kind: 'conversation',
    success: last.ok,
    error: last.error || undefined,
    latency_ms: Date.now() - started,
    prompt_chars: promptChars,
    completion_chars: last.content.length,
    cacheHit: last.cacheHit,
    cacheMiss: last.cacheMiss,
    user_emp_no: userEmpNo,
  });
  return last.ok ? { ok: true, content: last.content.trim() } : { ok: false, content: '', error: last.error };
}
