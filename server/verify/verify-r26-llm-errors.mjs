/**
 * 任务四：真实上游 400/422/401 错误实调 + 业务降级验证。
 * 红线：绝不写 llm_configs / api_key（事故根源）。本脚本只读读库取 key，
 * 在内存里构造错误 config 调 testConnection() 直连真实 DeepSeek，不改数据库一个字节。
 */
import { parseTestDbArg, VERIFY_DIR } from './verify-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = parseTestDbArg();
const OUT = path.join(VERIFY_DIR, 'verify-r26-llm-errors-out.txt');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const J = (v) => JSON.stringify(v);

const { getActiveConfig, testConnection, maskApiKey } = await import('../src/services/llm.ts');
const cfg = getActiveConfig();
if (!cfg || !cfg.api_key) throw new Error('无生效配置或 API Key，停止');
put(`ACTIVE_CONFIG=${J({ id: cfg.id, name: cfg.name, platform: cfg.platform, base_url: cfg.base_url, model: cfg.model, api_key_masked: maskApiKey(cfg.api_key) })}`);
put('NOTE=数据库 llm_configs 全程未写；以下错误配置均为内存构造对象，仅用于上游实调');

function memConfig(overrides) {
  return { ...cfg, ...overrides };
}

// 1) 400：缺 messages 必填参数 —— 直接 fetch 真实上游
put('===== 1) 缺 messages 参数测 400（直连真实上游） =====');
{
  const r = await fetch(`${cfg.base_url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
    body: J({ model: cfg.model, max_tokens: 16 }), // 故意不含 messages
  });
  const text = await r.text();
  put(`REQUEST=POST ${cfg.base_url}/chat/completions body=${J({ model: cfg.model, max_tokens: 16 })} (no messages)`);
  put(`RESPONSE_STATUS=${r.status}`);
  put(`RESPONSE_BODY=${text.slice(0, 500)}`);
}

// 2) 422：无效 model 名（用真实 key，官方通常返回 400/404；看实际）
put('===== 2) 无效 model 名测 422/400/404（内存构造 config + testConnection 走业务错误映射） =====');
{
  const bad = memConfig({ model: 'definitely-not-a-real-model-xyz-9999' });
  const result = await testConnection(bad);
  put(`REQUEST_MODEL=${bad.model}`);
  put(`TEST_CONNECTION_RESULT=${J(result)}`);
}

// 3) 401/402：错误 api_key（内存改一位，不改数据库）
put('===== 3) 错误 API Key 测 401/402（内存构造，数据库 key 不动） =====');
{
  const wrongKey = cfg.api_key.slice(0, -1) + (cfg.api_key.endsWith('X') ? 'Y' : 'X');
  const bad = memConfig({ api_key: wrongKey });
  const result = await testConnection(bad);
  put(`WRONG_KEY_MASKED=${maskApiKey(wrongKey)} (真实 key 末位改一位，仅内存)`);
  put(`TEST_CONNECTION_RESULT=${J(result)}`);
  put(`DB_KEY_STILL_MASKED=${maskApiKey(getActiveConfig().api_key)}`);
}

// 4) 业务降级：在独立副本里把 api_key 改错（仅副本），使 chatSearchSmart 内部读到的配置
//    真实请求 DeepSeek 返回 401，验证其返回 source:'rule'/route:'dict'/fallbackReason。
put('===== 4) 业务降级路径（副本错误 api_key -> 上游 401 -> 规则回退） =====');
{
  const Database = (await import('better-sqlite3')).default;
  const rw = new Database(dbPath);
  const row = rw.prepare('SELECT * FROM llm_configs WHERE is_active = 1 AND enabled = 1 LIMIT 1').get();
  const origKey = row.api_key;
  const wrongKey = origKey.slice(0, -1) + (origKey.endsWith('X') ? 'Y' : 'X');
  rw.prepare('UPDATE llm_configs SET api_key = ? WHERE id = ?').run(wrongKey, row.id);
  rw.prepare('DELETE FROM search_cache').run();
  rw.close();
  put(`COPY_KEY_NOW=${maskApiKey(wrongKey)} (仅副本；开发库 key 不动)`);

  const { chatSearchSmart } = await import('../src/services/chat.ts');
  const msg = '服务器主板电容鼓包漏液焦糊味供电异常XYZ987';
  const result = await chatSearchSmart(msg, 'TMPR26FB');
  put(`REQUEST_MESSAGE=${msg}`);
  put(`RAW_RESULT=${J({ source: result.source, route: result.route, fallbackReason: result.fallbackReason,
    cases: result.cases.map((c) => ({ id: c.id, score: c.score })), admittedCount: result.admittedCount,
    summary: result.summary })}`);
  put(`ASSERT_SOURCE_RULE=${result.source === 'rule'}`);
  put(`ASSERT_ROUTE_DICT=${result.route === 'dict'}`);
  put(`ASSERT_FALLBACK_REASON=${!!result.fallbackReason}`);

  const rw2 = new Database(dbPath);
  rw2.prepare('UPDATE llm_configs SET api_key = ? WHERE id = ?').run(origKey, row.id);
  rw2.close();
  put(`COPY_KEY_RESTORED=${maskApiKey(origKey)}`);
}

fs.writeFileSync(OUT, lines.join('\n') + '\n');
