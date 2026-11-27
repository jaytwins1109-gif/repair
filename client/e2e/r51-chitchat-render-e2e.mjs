/**
 * 第 51 轮 E2E：chitchat 气泡不得渲染「未找到案例」兜底或弱相关列表。
 * 独立库副本 + TMP 临时账号 + Playwright Edge 通道，测后清理。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const clientDir = process.cwd();
const root = path.resolve(clientDir, '..');
const dbDir = path.join(root, 'server', 'verify', '.db', 'r51-chitchat-render');
const dbPath = path.join(dbDir, 'data', 'repair.db');
const accountScript = path.join(root, 'server', 'verify', 'verify-r51-account.mjs');
const serverEntry = path.join(root, 'server', 'dist', 'index.js');
const API_PORT = '30151';
const BASE = `http://127.0.0.1:${API_PORT}`;
const SHOT_DIR = path.join(clientDir, 'e2e', 'screenshots');
const OUT = path.join(clientDir, 'e2e', 'r51-e2e-out.txt');
const NO_MATCH_TEXT = '知识库中未找到相似案例';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ACCOUNT_SCRIPT_SOURCE = `import { createRequire } from 'node:module';
import { openTestDb } from './verify-guard.mjs';
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const db = openTestDb();
const empNo = 'TMPR51ENG';
db.prepare('DELETE FROM sessions WHERE emp_no = ?').run(empNo);
db.prepare('DELETE FROM users WHERE emp_no = ?').run(empNo);
db.prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
  .run(empNo, '第51轮临时工程师', 'engineer', '硬件维修工程师', bcrypt.hashSync('TmpR51@Test', 10));
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

function dbCount(sql) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { return db.prepare(sql).get().c; } finally { db.close(); }
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
    try { if ((await fetch(`${BASE}/api/health`)).ok) { healthy = true; break; } } catch { /* 启动中 */ }
    await sleep(500);
  }
  put('SERVER_HEALTH=' + healthy);
  if (!healthy) throw new Error('独立测试服务启动失败\n' + serverLog);

  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('例如 WX1001').fill('TMPR51ENG');
  await page.getByPlaceholder('请输入密码').fill('TmpR51@Test');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForSelector('header', { timeout: 15000 });
  put('LOGIN_AS=TMPR51ENG');

  const baselineCache = dbCount('SELECT COUNT(*) AS c FROM search_cache');
  put('BASELINE_SEARCH_CACHE=' + baselineCache);
  const chatInput = page.getByPlaceholder(/描述故障现象/);
  const questions = ['你是谁', '你是？', '可以聊聊？'];
  const results = [];

  for (const question of questions) {
    const wait = page.waitForResponse(
      (r) => r.url().includes('/api/chat/sessions/') && r.url().endsWith('/ask') && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    await chatInput.fill(question);
    await chatInput.press('Enter');
    const res = await wait;
    const json = await res.json();
    if (json.code !== 0) throw new Error(`提问失败：${question} -> ${JSON.stringify(json)}`);
    await page.waitForTimeout(200);
    const bodyText = await page.locator('body').innerText();
    const item = {
      question,
      intent: json.data?.intent,
      source: json.data?.source,
      cases: json.data?.cases?.length,
      pageHasNoMatchText: bodyText.includes(NO_MATCH_TEXT),
      pageHasWeakGroup: bodyText.includes('弱相关，仅供参考'),
      guideBadge: await page.getByText('对话指引').count(),
    };
    results.push(item);
    put('CHAT=' + JSON.stringify(item));
  }

  const afterCache = dbCount('SELECT COUNT(*) AS c FROM search_cache');
  put('AFTER_SEARCH_CACHE=' + afterCache);
  const allAssertions = results.map((r) =>
    r.intent === 'chitchat' && (r.source === 'rule' || r.source === 'ai') && r.cases === 0 &&
    !r.pageHasNoMatchText && !r.pageHasWeakGroup && r.guideBadge > 0
  );
  put('ALL_ASSERTIONS=' + JSON.stringify(allAssertions));
  put('ASSERT_NO_FALLBACK_FOR_你是谁=' + !results[0].pageHasNoMatchText);
  put('ASSERT_NO_WEAK_GROUP=' + results.every((r) => !r.pageHasWeakGroup));
  put('ASSERT_NO_DB_SEARCH=' + (afterCache === baselineCache));
  await page.screenshot({ path: path.join(SHOT_DIR, 'r51-chitchat-render.png'), fullPage: true });
  put('SCREENSHOT=e2e/screenshots/r51-chitchat-render.png');
  put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
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
