/**
 * 第 50 轮 E2E：
 * 1) 技术知识库上传 PNG（分类=上电时序），断言 file_type=image 且弹出缩放平移大图预览；
 * 2) 顺带回归截图里的案例上传问题：datalist 的「品牌 + 型号」应能通过校验并提交成功。
 * 全程独立 VACUUM INTO 副本 + TMP 临时账号，测后删除副本账号与目录。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const clientDir = process.cwd();
const root = path.resolve(clientDir, '..');
const dbDir = path.join(root, 'server', 'verify', '.db', 'r50-knowledge-image');
const dbPath = path.join(dbDir, 'data', 'repair.db');
const accountScript = path.join(root, 'server', 'verify', 'verify-r50-account.mjs');
const serverEntry = path.join(root, 'server', 'dist', 'index.js');
const API_PORT = '30150';
const BASE = `http://127.0.0.1:${API_PORT}`;
const SHOT_DIR = path.join(clientDir, 'e2e', 'screenshots');
const OUT = path.join(clientDir, 'e2e', 'r50-e2e-out.txt');
const PNG_NAME = '上电时序样图.png';
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
const empNo = 'TMPR50ENG';
db.prepare('DELETE FROM sessions WHERE emp_no = ?').run(empNo);
db.prepare('DELETE FROM users WHERE emp_no = ?').run(empNo);
db.prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
  .run(empNo, '第50轮临时工程师', 'engineer', '硬件维修工程师', bcrypt.hashSync('TmpR50@Test', 10));
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

function dbRow(sql, ...args) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { return db.prepare(sql).get(...args); } finally { db.close(); }
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
  await page.getByPlaceholder('例如 WX1001').fill('TMPR50ENG');
  await page.getByPlaceholder('请输入密码').fill('TmpR50@Test');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForSelector('header', { timeout: 15000 });
  put('LOGIN_AS=TMPR50ENG');

  // ── 场景 1：上传 PNG 到「上电时序」 ──────────────────────────────
  await page.getByRole('button', { name: '技术知识库' }).click();
  await page.getByRole('button', { name: '上传文档' }).click();
  await page.locator('label').filter({ hasText: '分类 *' }).locator('select').selectOption('上电时序');
  await page.getByPlaceholder('如 Intel 平台上电时序').fill('R50 上电时序截图');
  const uploadRespWait = page.waitForResponse(
    (r) => r.url().includes('/api/knowledge-docs') && r.request().method() === 'POST',
    { timeout: 30000 }
  );
  await page.locator('input[type=file]').setInputFiles({ name: PNG_NAME, mimeType: 'image/png', buffer: PNG_BUFFER });
  await page.getByRole('button', { name: '上传', exact: true }).click();
  const uploadResp = await uploadRespWait;
  const uploadJson = await uploadResp.json();
  put('UPLOAD_RESPONSE=' + JSON.stringify({
    code: uploadJson.code,
    file_type: uploadJson.data?.file_type,
    file_name: uploadJson.data?.file_name,
    id: uploadJson.data?.id,
  }));
  const savedDoc = dbRow('SELECT id, category, title, file_name, file_type, size FROM knowledge_docs WHERE id = ?', uploadJson.data?.id);
  put('DB_DOC=' + JSON.stringify(savedDoc));
  const assertionUpload = uploadJson.code === 0 && savedDoc?.category === '上电时序' &&
    savedDoc?.file_type === 'image' && savedDoc?.file_name === PNG_NAME;
  put('ASSERT_1_UPLOAD_PNG_IMAGE=' + assertionUpload);

  const row = page.locator('tr').filter({ hasText: 'R50 上电时序截图' });
  put('ROW_ACTIONS=' + JSON.stringify({
    preview: await row.getByRole('button', { name: '预览' }).count(),
    download: await row.getByRole('button', { name: '下载' }).count(),
  }));
  const assertionActions = (await row.getByRole('button', { name: '预览' }).count()) === 1 &&
    (await row.getByRole('button', { name: '下载' }).count()) === 1;
  put('ASSERT_2_IMAGE_ACTIONS=' + assertionActions);

  // ── 场景 2：点击预览，断言缩放平移组件真实生效 ────────────────────
  await row.getByRole('button', { name: '预览' }).click();
  await page.getByText('滚轮缩放 · 拖拽平移').waitFor({ timeout: 15000 });
  const img = page.locator(`img[alt="${PNG_NAME}"]`);
  await img.waitFor({ state: 'visible', timeout: 15000 });
  const toolbar = JSON.stringify({
    zoomIn: await page.getByRole('button', { name: '放大' }).count(),
    zoomOut: await page.getByRole('button', { name: '缩小' }).count(),
    reset: await page.getByRole('button', { name: '重置' }).count(),
  });
  const transformOf = () => img.evaluate((el) => el.parentElement?.style.transform || '');
  const t0 = await transformOf();
  const box = await img.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -360);
  await sleep(400);
  const t1 = await transformOf();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 50, { steps: 6 });
  await page.mouse.up();
  await sleep(400);
  const t2 = await transformOf();
  put('ZOOM_TOOLBAR=' + toolbar);
  put('TRANSFORMS=' + JSON.stringify({ t0, t1, t2 }));
  const assertionPreview = JSON.parse(toolbar).zoomIn === 1 && JSON.parse(toolbar).zoomOut === 1 &&
    JSON.parse(toolbar).reset === 1 && t1 !== t0 && t2 !== t1;
  put('ASSERT_3_ZOOM_PAN_PREVIEW=' + assertionPreview);
  await page.screenshot({ path: path.join(SHOT_DIR, 'r50-knowledge-image-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭预览' }).click();

  // ── 场景 3：截图中的案例上传问题（品牌 + 型号校验） ────────────────
  const token = await page.evaluate(() => localStorage.getItem('repair-agent-token'));
  const modelsJson = await fetch(`${BASE}/api/models`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const firstModel = modelsJson.data?.[0];
  const fullModelName = `${firstModel?.brand || ''} ${firstModel?.model || ''}`.trim();
  await page.getByRole('button', { name: '上传案例' }).click();
  await page.getByPlaceholder('输入或选择已有机型').fill(fullModelName);
  await page.getByPlaceholder('输入或选择客户').fill('某集成商');
  await page.locator('label').filter({ hasText: '现象描述' }).locator('textarea').fill('第50轮回归用例：品牌+型号校验');
  await page.locator('label').filter({ hasText: '解决方案' }).locator('textarea').fill('提交成功即视为校验修复');
  const caseRespWait = page.waitForResponse(
    (r) => r.url().includes('/api/cases/upload') && r.request().method() === 'POST',
    { timeout: 30000 }
  );
  await page.getByRole('button', { name: '提交案例' }).click();
  const caseResp = await caseRespWait;
  const caseJson = await caseResp.json();
  put('CASE_UPLOAD=' + JSON.stringify({ model: fullModelName, code: caseJson.code, message: caseJson.message, id: caseJson.data?.id }));
  const assertionCase = caseJson.code === 0 && !!caseJson.data?.id;
  put('ASSERT_4_MODEL_WITH_BRAND=' + assertionCase);

  put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  const all = [assertionUpload, assertionActions, assertionPreview, assertionCase];
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
