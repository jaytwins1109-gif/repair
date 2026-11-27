/**
 * 第 49 轮：三层意图架构 E2E。
 * Level 1 本地清洗白名单 / Level 2 LLM intent 合流 / Level 3 LLM 失败默认 search。
 * 全程使用 VACUUM INTO 独立库副本 + TMP 临时工程师账号，不碰开发库、不使用用户账号、不登出。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const clientDir = process.cwd();
const root = path.resolve(clientDir, '..');
const dbDir = path.join(root, 'server', 'verify', '.db', 'r49-intent');
const dbPath = path.join(dbDir, 'data', 'repair.db');
const accountScript = path.join(root, 'server', 'verify', 'verify-r49-account.mjs');
const serverEntry = path.join(root, 'server', 'dist', 'index.js');
const API_PORT = '30149';
const BASE = `http://127.0.0.1:${API_PORT}`;
const SHOT_DIR = path.join(clientDir, 'e2e', 'screenshots');
const OUT = path.join(clientDir, 'e2e', 'r49-e2e-out.txt');
const EMP = 'TMPR49ENG';
const PASSWORD = 'TmpR49@Test';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ACCOUNT_SCRIPT_SOURCE = `import { createRequire } from 'node:module';
import { openTestDb } from './verify-guard.mjs';
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const db = openTestDb();
const empNo = 'TMPR49ENG';
db.prepare('DELETE FROM sessions WHERE emp_no = ?').run(empNo);
db.prepare('DELETE FROM users WHERE emp_no = ?').run(empNo);
db.prepare('DELETE FROM search_cache').run();
db.prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
  .run(empNo, '第49轮临时工程师', 'engineer', '硬件维修工程师', bcrypt.hashSync('TmpR49@Test', 10));
db.prepare('DELETE FROM cases WHERE import_batch_no = ?').run('R49-E2E');
db.prepare('INSERT INTO cases (model, customer, symptom, diagnosis, solution, parts, note, source, status, author, category, reviewer, reviewed_at, reject_reason, import_batch_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\\'now\\',\\'localtime\\'), ?, ?, datetime(\\'now\\',\\'localtime\\'), datetime(\\'now\\',\\'localtime\\'))')
  .run('R740', '测试客户', '无法开机，开机报错，启动失败', 'POST 自检报错，内存训练失败', '更换内存条后恢复正常', '内存', '第49轮E2E受控测试案例', 'manual', 'approved', empNo, '其他', '系统', '', 'R49-E2E');
console.log('TMP_ACCOUNT=' + empNo);
db.close();
`;

const require = createRequire(path.join(root, 'server', 'package.json'));
const Database = require('better-sqlite3');

const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runSync(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${path.basename(script)} 失败: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function snapshot() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM llm_calls) AS calls,
                (SELECT COUNT(*) FROM search_cache) AS cache,
                (SELECT COUNT(*) FROM cases) AS cases`
      )
      .get();
  } finally {
    db.close();
  }
}

let server = null;
let browser = null;
let page = null;
let serverLog = '';
let consoleErrors = [];

try {
  fs.writeFileSync(accountScript, ACCOUNT_SCRIPT_SOURCE);
  put('STEP_COPY_DB=' + runSync(path.join(root, 'server', 'verify', 'verify-copy.mjs'), [`--db=${dbPath}`]));
  put('STEP_TMP_ACCOUNT=' + runSync(accountScript, [`--db=${dbPath}`]));

  server = spawn(process.execPath, [serverEntry], {
    cwd: dbDir,
    env: { ...process.env, PORT: API_PORT, REPAIR_DB_PATH: dbPath, REPAIR_VERIFY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (b) => { serverLog += b.toString(); });
  server.stderr.on('data', (b) => { serverLog += b.toString(); });

  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) { healthy = true; break; }
    } catch { /* 启动中 */ }
    await sleep(500);
  }
  put('SERVER_HEALTH=' + healthy);
  if (!healthy) throw new Error('独立测试服务启动失败\n' + serverLog);

  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('例如 WX1001').fill(EMP);
  await page.getByPlaceholder('请输入密码').fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForSelector('header', { timeout: 15000 });
  put('LOGIN_AS=' + EMP);

  const chatInput = page.getByPlaceholder(/描述故障现象/);
  async function send(text) {
    const wait = page.waitForResponse(
      (r) => r.url().includes('/api/chat/sessions/') && r.url().endsWith('/ask') && r.request().method() === 'POST',
      { timeout: 60000 }
    );
    await chatInput.fill(text);
    await chatInput.press('Enter');
    const res = await wait;
    const json = await res.json();
    if (json.code !== 0) throw new Error(`提问失败：${text} -> ${JSON.stringify(json)}`);
    await sleep(300);
    return json.data;
  }

  const before = snapshot();
  put('BASELINE=' + JSON.stringify(before));

  // 用例 1：全角问号，必须 Level 1 本地命中，不调用 LLM、不查库、不写缓存
  const r1 = await send('你是？？？');
  const after1 = snapshot();
  put('CASE1=' + JSON.stringify({
    intent: r1.intent, source: r1.source, route: r1.route,
    cases: r1.cases?.length, summary: String(r1.summary || '').slice(0, 60),
    llmDelta: after1.calls - before.calls, cacheDelta: after1.cache - before.cache,
  }));
  put('ASSERT_1_LOCAL_CHITCHAT=' + (r1.intent === 'chitchat' && r1.source === 'rule' && r1.cases?.length === 0 &&
    after1.calls === before.calls && after1.cache === before.cache));

  // 用例 2：口语化能力询问，白名单扩充后仍应 Level 1 命中
  const r2 = await send('请问你能干点啥');
  const after2 = snapshot();
  put('CASE2=' + JSON.stringify({
    intent: r2.intent, source: r2.source, route: r2.route,
    cases: r2.cases?.length, summary: String(r2.summary || '').slice(0, 60),
    llmDelta: after2.calls - after1.calls, cacheDelta: after2.cache - after1.cache,
  }));
  put('ASSERT_2_LOCAL_CHITCHAT=' + (r2.intent === 'chitchat' && r2.source === 'rule' && r2.cases?.length === 0 &&
    after2.calls === after1.calls && after2.cache === after1.cache));

  // 用例 3：真实故障检索，必须走 LLM intent=search 后查库返回案例
  const r3 = await send('R740 开机报错');
  const after3 = snapshot();
  put('CASE3=' + JSON.stringify({
    intent: r3.intent, source: r3.source, route: r3.route,
    keywords: r3.keywords, normalizedSymptoms: r3.normalizedSymptoms,
    cases: r3.cases?.length, firstCase: r3.cases?.[0]?.id, admittedCount: r3.admittedCount,
    summary: String(r3.summary || '').slice(0, 80), llmDelta: after3.calls - after2.calls,
  }));
  put('ASSERT_3_LLM_SEARCH=' + (r3.intent === 'search' && r3.route === 'llm' &&
    Array.isArray(r3.cases) && r3.cases.length > 0));

  // 用例 4：与维修无关的问题，LLM 在线时应返回 intent=chitchat 且不报错
  const r4 = await send('今天天气怎么样');
  const after4 = snapshot();
  put('CASE4=' + JSON.stringify({
    intent: r4.intent, source: r4.source, route: r4.route,
    cases: r4.cases?.length, summary: String(r4.summary || '').slice(0, 80),
    llmDelta: after4.calls - after3.calls, cacheDelta: after4.cache - after3.cache,
  }));
  put('ASSERT_4_LLM_CHITCHAT=' + (r4.intent === 'chitchat' && r4.cases?.length === 0 &&
    after4.calls > after3.calls && after4.cache === after3.cache));

  await page.screenshot({ path: path.join(SHOT_DIR, 'r49-intent-ui.png'), fullPage: true });
  put('SCREENSHOT=e2e/screenshots/r49-intent-ui.png');
  put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  const allAssertions = [
    r1.intent === 'chitchat' && r1.source === 'rule' && r1.cases?.length === 0 &&
      after1.calls === before.calls && after1.cache === before.cache,
    r2.intent === 'chitchat' && r2.source === 'rule' && r2.cases?.length === 0 &&
      after2.calls === after1.calls && after2.cache === after1.cache,
    r3.intent === 'search' && r3.route === 'llm' && Array.isArray(r3.cases) && r3.cases.length > 0,
    r4.intent === 'chitchat' && r4.cases?.length === 0 && after4.calls > after3.calls && after4.cache === after3.cache,
  ];
  put('ALL_ASSERTIONS=' + JSON.stringify(allAssertions));
  put('E2E_PASS=' + allAssertions.every(Boolean));
  if (!allAssertions.every(Boolean)) process.exitCode = 1;
} catch (e) {
  put('FATAL=' + (e?.stack || e));
  put('DEBUG_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  put('DEBUG_SERVER_LOG=' + serverLog.slice(-1200));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) {
    server.kill('SIGTERM');
    await sleep(600);
    if (!server.killed) server.kill('SIGKILL');
  }
  fs.rmSync(dbDir, { recursive: true, force: true });
  fs.rmSync(accountScript, { force: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  put('COPY_DIR_DELETED=' + !fs.existsSync(dbDir));
  put('TMP_ACCOUNT_SCRIPT_DELETED=' + !fs.existsSync(accountScript));
}
