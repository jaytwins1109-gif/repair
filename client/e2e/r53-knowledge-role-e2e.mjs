/**
 * 第 53 轮 E2E：技术知识库角色收紧。
 * 工程师：可见上传/删除按钮，能上传；技术员：隐藏上传/删除，仅保留预览/下载，直接 API 上传/删除均 403。
 * 独立 VACUUM INTO 副本 + 两个 TMP 账号，测后清理；不使用用户账号、不登出。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const clientDir = process.cwd();
const root = path.resolve(clientDir, '..');
const dbDir = path.join(root, 'server', 'verify', '.db', 'r53-knowledge-role');
const dbPath = path.join(dbDir, 'data', 'repair.db');
const accountScript = path.join(root, 'server', 'verify', 'verify-r53-account.mjs');
const serverEntry = path.join(root, 'server', 'dist', 'index.js');
const API_PORT = '30153';
const BASE = `http://127.0.0.1:${API_PORT}`;
const SHOT_DIR = path.join(clientDir, 'e2e', 'screenshots');
const OUT = path.join(clientDir, 'e2e', 'r53-e2e-out.txt');
const TITLE = 'R53 角色权限测试图';
const PNG_NAME = 'r53-power-sequence.png';
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSIIAAAAeUlEQVR4nGP4//8/A7GAgAAAAABJRU5ErkJggg==',
  'base64'
);
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ACCOUNT_SCRIPT_SOURCE = `import { createRequire } from 'node:module';
import { openTestDb } from './verify-guard.mjs';
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const db = openTestDb();
const hash = bcrypt.hashSync('TmpR53@Test', 10);
for (const [empNo, name, role] of [
  ['TMPR53ENG', '第53轮临时工程师', 'engineer'],
  ['TMPR53TECH', '第53轮临时技术员', 'technician'],
]) {
  db.prepare('DELETE FROM sessions WHERE emp_no = ?').run(empNo);
  db.prepare('DELETE FROM users WHERE emp_no = ?').run(empNo);
  db.prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(empNo, name, role, '自动化测试', hash);
}
console.log('TMP_ACCOUNTS=TMPR53ENG,TMPR53TECH');
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

function dbCount(sql, ...args) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { return db.prepare(sql).get(...args).c; } finally { db.close(); }
}

let server = null;
let browser = null;
let serverLog = '';
let consoleErrors = [];

async function login(empNo, contextLabel) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(`${contextLabel}: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('例如 WX1001').fill(empNo);
  await page.getByPlaceholder('请输入密码').fill('TmpR53@Test');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForSelector('header', { timeout: 15000 });
  await page.getByRole('button', { name: '技术知识库' }).click();
  await page.waitForTimeout(400);
  const token = await page.evaluate(() => localStorage.getItem('repair-agent-token'));
  return { ctx, page, token };
}

try {
  fs.writeFileSync(accountScript, ACCOUNT_SCRIPT_SOURCE);
  put('STEP_COPY_DB=' + runSync(path.join(root, 'server', 'verify', 'verify-copy.mjs'), [`--db=${dbPath}`]));
  put('STEP_TMP_ACCOUNTS=' + runSync(accountScript, [`--db=${dbPath}`]));

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
  const docsBefore = dbCount('SELECT COUNT(*) AS c FROM knowledge_docs');
  put('DOCS_BEFORE=' + docsBefore);

  // ── 工程师：按钮可见 + 真实上传成功 ──────────────────────────────
  const eng = await login('TMPR53ENG', 'engineer');
  const engUploadBtn = await eng.page.getByRole('button', { name: '上传文档' }).count();
  put('ENGINEER_UPLOAD_BUTTON=' + engUploadBtn);
  await eng.page.getByRole('button', { name: '上传文档' }).click();
  await eng.page.locator('label').filter({ hasText: '分类 *' }).locator('select').selectOption('上电时序');
  await eng.page.getByPlaceholder('如 Intel 平台上电时序').fill(TITLE);
  const uploadWait = eng.page.waitForResponse(
    (r) => r.url().includes('/api/knowledge-docs') && r.request().method() === 'POST',
    { timeout: 30000 }
  );
  await eng.page.locator('input[type=file]').setInputFiles({ name: PNG_NAME, mimeType: 'image/png', buffer: PNG_BUFFER });
  await eng.page.getByRole('button', { name: '上传', exact: true }).click();
  const uploadJson = await (await uploadWait).json();
  const docId = uploadJson.data?.id;
  const docsAfter = dbCount('SELECT COUNT(*) AS c FROM knowledge_docs');
  const engRow = eng.page.locator('tr').filter({ hasText: TITLE });
  const engDeleteBtn = await engRow.getByRole('button', { name: '删除' }).count();
  put('ENGINEER_UPLOAD=' + JSON.stringify({ code: uploadJson.code, id: docId, file_type: uploadJson.data?.file_type }));
  put('DOCS_AFTER=' + docsAfter);
  put('ENGINEER_DELETE_BUTTON=' + engDeleteBtn);
  const assertionEngineer = engUploadBtn === 1 && uploadJson.code === 0 &&
    uploadJson.data?.file_type === 'image' && docsAfter === docsBefore + 1 && engDeleteBtn === 1;
  put('ASSERT_1_ENGINEER_CAN_UPLOAD=' + assertionEngineer);
  await eng.page.screenshot({ path: path.join(SHOT_DIR, 'r53-engineer-knowledge.png'), fullPage: true });

  // ── 技术员：按钮隐藏、预览/下载保留、直接 API 上传/删除 403 ────────
  const tech = await login('TMPR53TECH', 'technician');
  const techUploadBtn = await tech.page.getByRole('button', { name: '上传文档' }).count();
  const techRow = tech.page.locator('tr').filter({ hasText: TITLE });
  const techActions = JSON.stringify({
    preview: await techRow.getByRole('button', { name: '预览' }).count(),
    download: await techRow.getByRole('button', { name: '下载' }).count(),
    delete: await techRow.getByRole('button', { name: '删除' }).count(),
  });
  const readOnlyHint = await tech.page.getByText('当前账号为只读权限').count();
  put('TECHNICIAN_UPLOAD_BUTTON=' + techUploadBtn);
  put('TECHNICIAN_ACTIONS=' + techActions);
  put('TECHNICIAN_READONLY_HINT=' + readOnlyHint);
  const assertionUi = techUploadBtn === 0 && JSON.parse(techActions).preview === 1 &&
    JSON.parse(techActions).download === 1 && JSON.parse(techActions).delete === 0 && readOnlyHint === 1;
  put('ASSERT_2_TECHNICIAN_UI_HIDDEN=' + assertionUi);
  await tech.page.screenshot({ path: path.join(SHOT_DIR, 'r53-technician-knowledge.png'), fullPage: true });

  const hackForm = new FormData();
  hackForm.append('category', '上电时序');
  hackForm.append('title', '技术员越权上传应被拒绝');
  hackForm.append('file', new Blob([PNG_BUFFER], { type: 'image/png' }), 'hack.png');
  const hackUploadRes = await fetch(`${BASE}/api/knowledge-docs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tech.token}` },
    body: hackForm,
  });
  const hackUploadJson = await hackUploadRes.json();
  put('TECHNICIAN_API_UPLOAD=' + JSON.stringify({ status: hackUploadRes.status, code: hackUploadJson.code, message: hackUploadJson.message }));

  const hackDeleteRes = await fetch(`${BASE}/api/knowledge-docs/${docId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tech.token}` },
  });
  const hackDeleteJson = await hackDeleteRes.json();
  const docsAfterHack = dbCount('SELECT COUNT(*) AS c FROM knowledge_docs');
  put('TECHNICIAN_API_DELETE=' + JSON.stringify({ status: hackDeleteRes.status, code: hackDeleteJson.code, message: hackDeleteJson.message }));
  put('DOCS_AFTER_HACK=' + docsAfterHack);
  const assertionApi = hackUploadRes.status === 403 && hackUploadJson.code === 403 &&
    hackDeleteRes.status === 403 && hackDeleteJson.code === 403 && docsAfterHack === docsAfter;
  put('ASSERT_3_TECHNICIAN_API_403=' + assertionApi);

  put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  const all = [assertionEngineer, assertionUi, assertionApi];
  put('ALL_ASSERTIONS=' + JSON.stringify(all));
  put('E2E_PASS=' + all.every(Boolean));
  if (!all.every(Boolean)) process.exitCode = 1;
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
