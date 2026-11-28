/**
 * 第 54 轮 E2E：安全加固回归。
 * 阶段 A：登录接口 5 次/分钟限流、CORS 白名单、Query Token 被拒。
 * 阶段 B：重启服务清空限流计数后，验证登录/对话/图片上传/PDF 预览仍正常。
 * 独立 VACUUM INTO 副本 + TMP 临时账号，测后清理。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const clientDir = process.cwd();
const root = path.resolve(clientDir, '..');
const dbDir = path.join(root, 'server', 'verify', '.db', 'r54-security');
const dbPath = path.join(dbDir, 'data', 'repair.db');
const accountScript = path.join(root, 'server', 'verify', 'verify-r54-account.mjs');
const serverEntry = path.join(root, 'server', 'dist', 'index.js');
const API_PORT = '30154';
const BASE = `http://127.0.0.1:${API_PORT}`;
const SHOT_DIR = path.join(clientDir, 'e2e', 'screenshots');
const OUT = path.join(clientDir, 'e2e', 'r54-e2e-out.txt');
const TITLE = 'R54 上传时序图';
const PDF_TITLE = 'R54 PDF 预览夹具';
const PNG_NAME = 'r54-power.png';
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSIIAAAAeUlEQVR4nGP4//8/A7GAgAAAAABJRU5ErkJggg==',
  'base64'
);
fs.mkdirSync(SHOT_DIR, { recursive: true });

const PDF_CONTENT = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`;

const ACCOUNT_SCRIPT_SOURCE = `import fs from 'node:fs';
import path from 'node:path';
import { openTestDb } from './verify-guard.mjs';
const db = openTestDb();
const empNo = 'TMPR54ENG';
const require = (await import('node:module')).createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
db.prepare('DELETE FROM sessions WHERE emp_no = ?').run(empNo);
db.prepare('DELETE FROM users WHERE emp_no = ?').run(empNo);
db.prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
  .run(empNo, '第54轮临时工程师', 'engineer', '自动化测试', bcrypt.hashSync('TmpR54@Test', 10));

const pdfRelative = '2026-11/r54-fixture.pdf';
const dbRoot = path.dirname(path.dirname(process.env.REPAIR_DB_PATH));
const pdfDir = path.join(dbRoot, 'uploads', '2026-11');
fs.mkdirSync(pdfDir, { recursive: true });
const pdfPath = path.join(pdfDir, 'r54-fixture.pdf');
const pdf = ${JSON.stringify(PDF_CONTENT)};
fs.writeFileSync(pdfPath, pdf, 'utf8');
db.prepare('DELETE FROM knowledge_docs WHERE title = ?').run('R54 PDF 预览夹具');
db.prepare('INSERT INTO knowledge_docs (category, title, file_name, relative_path, file_type, size, uploader, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\\'now\\',\\'localtime\\'))')
  .run('BMC原理', 'R54 PDF 预览夹具', 'r54-fixture.pdf', pdfRelative, 'pdf', Buffer.byteLength(pdf), 'TMPR54ENG');
console.log('TMP_ACCOUNT=' + empNo + ' PDF_FIXTURE=' + pdfRelative);
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
let serverLog = '';
let browser = null;
let consoleErrors = [];

async function startServer() {
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
  if (!healthy) throw new Error('服务启动失败\n' + serverLog);
  put('SERVER_HEALTH=true');
}

async function stopServer() {
  if (!server) return;
  server.kill('SIGTERM');
  await sleep(700);
  if (!server.killed) server.kill('SIGKILL');
  await sleep(300);
  server = null;
}

async function apiLogin(password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_no: 'TMPR54ENG', password }),
  });
  let json = {};
  try { json = await res.json(); } catch { /* 空响应 */ }
  return { status: res.status, code: json.code, message: json.message };
}

try {
  fs.writeFileSync(accountScript, ACCOUNT_SCRIPT_SOURCE);
  put('STEP_COPY_DB=' + runSync(path.join(root, 'server', 'verify', 'verify-copy.mjs'), [`--db=${dbPath}`]));
  put('STEP_TMP_ACCOUNT=' + runSync(accountScript, [`--db=${dbPath}`]));

  // ── 阶段 A：限流 / CORS / Query Token ────────────────────────────
  await startServer();
  const loginResults = [];
  for (let i = 1; i <= 6; i++) loginResults.push(await apiLogin('WrongPassword@54'));
  loginResults.forEach((r, i) => put(`WRONG_LOGIN_${i + 1}=${JSON.stringify(r)}`));
  const assertionLoginLimit = loginResults.slice(0, 5).every((r) => r.code === 1) &&
    loginResults[5].status === 429 && loginResults[5].code === 429;
  put('ASSERT_1_LOGIN_429_ON_6TH=' + assertionLoginLimit);

  const corsLocal = await fetch(`${BASE}/api/health`, { headers: { Origin: `http://localhost:${API_PORT}` } });
  const corsEvil = await fetch(`${BASE}/api/health`, { headers: { Origin: 'https://evil.example' } });
  const evilJson = await corsEvil.json().catch(() => ({}));
  put('CORS_LOCAL=' + JSON.stringify({ status: corsLocal.status, allow: corsLocal.headers.get('access-control-allow-origin') }));
  put('CORS_EVIL=' + JSON.stringify({ status: corsEvil.status, message: evilJson.message }));
  const assertionCors = corsLocal.status === 200 &&
    corsLocal.headers.get('access-control-allow-origin') === `http://localhost:${API_PORT}` &&
    corsEvil.status !== 200 && String(evilJson.message || '').includes('CORS');
  put('ASSERT_2_CORS_RESTRICTED=' + assertionCors);

  await stopServer();

  // ── 阶段 B：重启清空限流计数，回归现有功能 ────────────────────────
  await startServer();
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('例如 WX1001').fill('TMPR54ENG');
  await page.getByPlaceholder('请输入密码').fill('TmpR54@Test');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForSelector('header', { timeout: 15000 });
  const token = await page.evaluate(() => localStorage.getItem('repair-agent-token'));
  put('UI_LOGIN_TOKEN_PREFIX=' + String(token || '').slice(0, 8));

  const queryTokenRes = await fetch(`${BASE}/api/auth/me?token=${encodeURIComponent(token)}`);
  const bearerRes = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  put('QUERY_TOKEN_AUTH=' + JSON.stringify({ status: queryTokenRes.status }));
  put('BEARER_AUTH=' + JSON.stringify({ status: bearerRes.status, code: (await bearerRes.clone().json()).code }));
  const assertionToken = queryTokenRes.status === 401 && bearerRes.status === 200;
  put('ASSERT_3_QUERY_TOKEN_REJECTED=' + assertionToken);

  const chatInput = page.getByPlaceholder(/描述故障现象/);
  const chatWait = page.waitForResponse(
    (r) => r.url().includes('/api/chat/sessions/') && r.url().endsWith('/ask') && r.request().method() === 'POST',
    { timeout: 30000 }
  );
  await chatInput.fill('你是谁');
  await chatInput.press('Enter');
  const chatJson = await (await chatWait).json();
  put('CHAT=' + JSON.stringify({ code: chatJson.code, intent: chatJson.data?.intent, cases: chatJson.data?.cases?.length }));
  const assertionChat = chatJson.code === 0 && chatJson.data?.intent === 'chitchat';
  put('ASSERT_4_CHAT_OK=' + assertionChat);

  await page.getByRole('button', { name: '技术知识库' }).click();
  const docsBefore = dbCount('SELECT COUNT(*) AS c FROM knowledge_docs');
  await page.getByRole('button', { name: '上传文档' }).click();
  await page.locator('label').filter({ hasText: '分类 *' }).locator('select').selectOption('上电时序');
  await page.getByPlaceholder('如 Intel 平台上电时序').fill(TITLE);
  const uploadWait = page.waitForResponse(
    (r) => r.url().includes('/api/knowledge-docs') && r.request().method() === 'POST',
    { timeout: 30000 }
  );
  await page.locator('input[type=file]').setInputFiles({ name: PNG_NAME, mimeType: 'image/png', buffer: PNG_BUFFER });
  await page.getByRole('button', { name: '上传', exact: true }).click();
  const uploadJson = await (await uploadWait).json();
  const docsAfter = dbCount('SELECT COUNT(*) AS c FROM knowledge_docs');
  put('IMAGE_UPLOAD=' + JSON.stringify({ code: uploadJson.code, file_type: uploadJson.data?.file_type, docsBefore, docsAfter }));
  const assertionUpload = uploadJson.code === 0 && uploadJson.data?.file_type === 'image' && docsAfter === docsBefore + 1;
  put('ASSERT_5_IMAGE_UPLOAD_OK=' + assertionUpload);

  const pdfIdRow = await (async () => {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT id FROM knowledge_docs WHERE title = ?').get(PDF_TITLE); } finally { db.close(); }
  })();
  const pdfRaw = await fetch(`${BASE}/api/knowledge-docs/${pdfIdRow.id}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  put('PDF_RAW_PRE=' + JSON.stringify({ id: pdfIdRow.id, status: pdfRaw.status, contentType: pdfRaw.headers.get('content-type') }));

  const pdfRow = page.locator('tr').filter({ hasText: PDF_TITLE });
  put('PDF_ROW_PREVIEW_COUNT=' + await pdfRow.getByRole('button', { name: '预览' }).count());
  await pdfRow.getByRole('button', { name: '预览' }).click();
  await page.waitForTimeout(800);
  put('PDF_PAGE_HAS_PREVIEW_MODAL=' + (await page.locator('iframe').count()));
  put('PDF_PAGE_TEXT_TAIL=' + (await page.locator('body').innerText()).slice(-300));
  await page.locator('iframe[title="r54-fixture.pdf"]').waitFor({ state: 'visible', timeout: 15000 });
  put('PDF_PREVIEW=' + JSON.stringify({
    iframe: await page.locator('iframe[title="r54-fixture.pdf"]').count(),
    blobSrc: await page.locator('iframe[title="r54-fixture.pdf"]').getAttribute('src'),
    rawStatus: pdfRaw.status,
    contentType: pdfRaw.headers.get('content-type'),
  }));
  const assertionPdf = pdfRaw.status === 200 && String(pdfRaw.headers.get('content-type')).includes('application/pdf') &&
    String(await page.locator('iframe[title="r54-fixture.pdf"]').getAttribute('src')).startsWith('blob:');
  put('ASSERT_6_PDF_PREVIEW_OK=' + assertionPdf);

  await page.screenshot({ path: path.join(SHOT_DIR, 'r54-security-smoke.png'), fullPage: true });
  put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  const all = [assertionLoginLimit, assertionCors, assertionToken, assertionChat, assertionUpload, assertionPdf];
  put('ALL_ASSERTIONS=' + JSON.stringify(all));
  put('E2E_PASS=' + all.every(Boolean));
  if (!all.every(Boolean)) process.exitCode = 1;
} catch (e) {
  put('FATAL=' + (e?.stack || e));
  put('DEBUG_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  put('DEBUG_SERVER_LOG=' + serverLog.slice(-1500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer();
  fs.rmSync(dbDir, { recursive: true, force: true });
  fs.rmSync(accountScript, { force: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  put('COPY_DIR_DELETED=' + !fs.existsSync(dbDir));
  put('TMP_ACCOUNT_SCRIPT_DELETED=' + !fs.existsSync(accountScript));
}
