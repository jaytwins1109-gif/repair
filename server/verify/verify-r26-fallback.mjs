/**
 * 第 26 轮任务一收尾：证明 LLM 失败时 chatSearchSmart 返回 source:'rule' + route:'dict' + fallbackReason。
 * 红线：只在 VACUUM INTO 独立副本里改 api_key/base_url（测试库允许造数据），
 *       开发库 data/repair.db 全程只读；测完恢复副本原值，整个副本目录由外部删除。
 */
import { parseTestDbArg, DEV_DB } from './verify-guard.mjs';
import Database from 'better-sqlite3';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = parseTestDbArg();
const BATCH_DIR = path.resolve(dbPath, '../..');
const OUT = path.join(BATCH_DIR, 'verify-r26-fallback-out.txt');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const J = (v) => JSON.stringify(v);
const mask = (k) => `${String(k).slice(0, 4)}****${String(k).slice(-4)}`;

const readDevKey = () => {
  const d = new Database(DEV_DB, { readonly: true, fileMustExist: true });
  try {
    return (d.prepare("SELECT api_key FROM llm_configs WHERE is_active=1 LIMIT 1").get() || {}).api_key;
  } finally { d.close(); }
};
const devKeyBefore = readDevKey();
put(`TEST_DB=${dbPath}`);
put(`DEV_KEY_BEFORE=${mask(devKeyBefore)} (开发库只读快照)`);

const rw = new Database(dbPath);
const cfg = rw.prepare('SELECT * FROM llm_configs WHERE is_active = 1 AND enabled = 1 LIMIT 1').get();
if (!cfg || !cfg.api_key) throw new Error('副本无生效配置或密钥，停止');
const ORIG_KEY = cfg.api_key;
const ORIG_BASE = cfg.base_url;
put(`ACTIVE_CFG_ID=${cfg.id} MODEL=${cfg.model} BASE_URL=${ORIG_BASE}`);

const brief = (r) => ({
  source: r.source,
  route: r.route,
  fallbackReason: r.fallbackReason,
  cases: r.cases.map((c) => ({ id: c.id, score: c.score })),
  admittedCount: r.admittedCount,
  summary: r.summary,
});

// ---------- 场景 1：副本里把 api_key 末位改错，真实请求 DeepSeek -> 401 ----------
const wrongKey = ORIG_KEY.slice(0, -1) + (ORIG_KEY.endsWith('X') ? 'Y' : 'X');
rw.prepare('UPDATE llm_configs SET api_key = ? WHERE id = ?').run(wrongKey, cfg.id);
rw.prepare('DELETE FROM search_cache').run();
put('===== 场景 1：上游 401（副本 api_key 末位改错，真实请求 DeepSeek）=====');
put(`DB_KEY_NOW=${mask(wrongKey)} (仅副本，开发库未动)`);
const { chatSearchSmart } = await import('../src/services/chat.ts');
const text1 = '服务器主板电容鼓包漏液焦糊味供电异常XYZ987';
const r1 = await chatSearchSmart(text1, 'TMPR26FB');
put(`INPUT=${text1}`);
put(`RAW_RESULT_1=${J(brief(r1))}`);
put(`ASSERT_1_RULE=${r1.source === 'rule' && r1.route === 'dict' && !!r1.fallbackReason}`);
put(`ASSERT_1_FALLBACK_HAS_401=${String(r1.fallbackReason || '').includes('401')}`);

// ---------- 场景 2：本地 mock 返回合法 JSON 但字段全空（空抽取）----------
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(J({
      choices: [{ message: { content: J({ model: '', customer: '', symptoms: [], expanded: [], expandedByTerm: {} }) }, finish_reason: 'stop' }],
      usage: {},
    }));
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const mockPort = mock.address().port;
rw.prepare('UPDATE llm_configs SET base_url = ?, api_key = ? WHERE id = ?').run(`http://127.0.0.1:${mockPort}/v1`, ORIG_KEY, cfg.id);
rw.prepare('DELETE FROM search_cache').run();
put('===== 场景 2：模型返回空抽取（本地 mock 合法 JSON，字段全空）=====');
put(`MOCK_BASE_URL=http://127.0.0.1:${mockPort}/v1 DB_KEY_RESTORED=${mask(ORIG_KEY)}`);
const text2 = '主板电容漏液有焦味型号不明ABC123';
const r2 = await chatSearchSmart(text2, 'TMPR26FB');
put(`INPUT=${text2}`);
put(`RAW_RESULT_2=${J(brief(r2))}`);
put(`ASSERT_2_RULE=${r2.source === 'rule' && r2.route === 'dict' && !!r2.fallbackReason}`);
put(`ASSERT_2_FALLBACK_EMPTY=${String(r2.fallbackReason || '').includes('未抽取到有效检索条件')}`);
await new Promise((resolve) => mock.close(resolve));

// ---------- 恢复副本原值 + 开发库只读复核 ----------
rw.prepare('UPDATE llm_configs SET api_key = ?, base_url = ? WHERE id = ?').run(ORIG_KEY, ORIG_BASE, cfg.id);
rw.close();
const devKeyAfter = readDevKey();
put(`RESTORED_COPY_KEY=${mask(ORIG_KEY)}`);
put(`DEV_KEY_AFTER=${mask(devKeyAfter)} DEV_KEY_UNCHANGED=${devKeyAfter === devKeyBefore}`);

fs.writeFileSync(OUT, lines.join('\n') + '\n');
