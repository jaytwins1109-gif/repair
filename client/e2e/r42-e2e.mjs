/**
 * 第 42 轮：机型资料图纸 E2E。
 * 独立库副本 + TMP 临时账号；通过 API 上传 ~10MB PDF 绑定 R740；
 * Playwright 验证机型管理页图纸列表、对话命中 R740 后点击「查看图纸」并渲染 PDF iframe。
 * 全程不碰开发库、不使用用户账号、不登出；截图 e2e/screenshots/r42-assets-ui.png。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const clientDir = process.cwd();
const root = path.resolve(clientDir, '..');
const dbDir = path.join(root, 'server', 'verify', '.db', 'r42-assets');
const dbPath = path.join(dbDir, 'data', 'repair.db');
const accountScript = path.join(root, 'server', 'verify', 'verify-r42-account.mjs');
const tsxCli = path.join(root, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = path.join(root, 'server', 'src', 'index.ts');
const tmpDir = path.join(clientDir, 'e2e', '.tmp');
const pdfPath = path.join(tmpDir, 'r42-r740-schematic.pdf');
const SHOT_DIR = path.join(clientDir, 'e2e', 'screenshots');
const OUT = path.join(clientDir, 'e2e', 'r42-e2e-out.txt');
const BASE = 'http://127.0.0.1:5173';
const TEST_API = 'http://127.0.0.1:3005';
const EMP = 'TMPR42ENG';
const PASSWORD = 'TmpR42@Test';
fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runSync(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${path.basename(script)} 失败: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** 生成约 10MB、可被浏览器渲染的合法单页 PDF */
function buildTenMegaPdf() {
  const pad = Buffer.alloc(10 * 1024 * 1024, 0x20);
  const chunks = [];
  const offsets = new Array(7).fill(0);
  let length = 0;
  const push = (buf) => { chunks.push(buf); length += buf.length; };
  push(Buffer.from('%PDF-1.4\n'));
  const add = (num, body) => {
    offsets[num] = length;
    push(Buffer.from(`${num} 0 obj\n${body}\nendobj\n`));
  };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  add(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const content = Buffer.from('BT /F1 18 Tf 72 720 Td (R740 Schematic) Tj ET\n');
  offsets[5] = length;
  push(Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`));
  push(content);
  push(Buffer.from('\nendstream\nendobj\n'));
  // 第 6 号对象仅用于把文件撑到 10MB，不被页面引用，正文仍是一页短文本
  offsets[6] = length;
  push(Buffer.from(`6 0 obj\n<< /Length ${pad.length} >>\nstream\n`));
  push(pad);
  push(Buffer.from('\nendstream\nendobj\n'));
  const xrefOffset = length;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(Buffer.from(xref));
  push(Buffer.from(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

let server = null;
let browser = null;
let page = null;
let serverLog = '';
let consoleErrors = [];

try {
  put('COPY_DB=' + runSync(path.join(root, 'server', 'verify', 'verify-copy.mjs'), [`--db=${dbPath}`]));
  put('TMP_ACCOUNT=' + runSync(accountScript, [`--db=${dbPath}`]));
  const pdf = buildTenMegaPdf();
  fs.writeFileSync(pdfPath, pdf);
  put('PDF_BYTES=' + pdf.length);

  server = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: dbDir,
    env: { ...process.env, PORT: '3005', REPAIR_VERIFY: '1', REPAIR_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (b) => { serverLog += b.toString(); });
  server.stderr.on('data', (b) => { serverLog += b.toString(); });
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${TEST_API}/api/health`)).ok) { healthy = true; break; } } catch { /* starting */ }
    await sleep(500);
  }
  put('TEST_SERVER_HEALTH=' + healthy);
  if (!healthy) throw new Error('测试服务启动失败\n' + serverLog);

  const login = await fetch(`${TEST_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_no: EMP, password: PASSWORD }),
  }).then((r) => r.json());
  const token = login.data?.token || '';
  put('API_LOGIN_CODE=' + login.code + ' TOKEN=' + token.slice(0, 8));
  if (login.code !== 0 || !token) throw new Error('临时账号登录失败');

  const form = new FormData();
  form.append('model_name', 'R740');
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'r42-r740-schematic.pdf');
  const upload = await fetch(`${TEST_API}/api/model-assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  }).then((r) => r.json());
  const asset = upload.data || null;
  put('UPLOAD_CODE=' + upload.code + ' ASSET=' + JSON.stringify(asset));
  put('ASSERT_UPLOAD_API=' + (upload.code === 0 && !!asset && asset.file_type === 'pdf' && asset.size > 10 * 1024 * 1024 - 1000));
  if (!asset) throw new Error('PDF 上传失败：' + upload.message);

  const raw = await fetch(`${TEST_API}/api/model-assets/${asset.id}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rawBytes = (await raw.arrayBuffer()).byteLength;
  put('ASSERT_RAW_AUTH=' + (raw.status === 200 && (raw.headers.get('content-type') || '').includes('application/pdf') && rawBytes > 10 * 1024 * 1024 - 1000));
  const anon = await fetch(`${TEST_API}/api/model-assets/${asset.id}/raw`).then((r) => r.json());
  put('ASSERT_RAW_REJECTS_ANON=' + (anon.code === 401));

  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.route('http://127.0.0.1:5173/api/**', async (route) => {
    const url = new URL(route.request().url());
    const headers = {};
    for (const [k, v] of Object.entries(route.request().headers())) {
      const lk = k.toLowerCase();
      if (lk !== 'host' && lk !== 'content-length') headers[k] = v;
    }
    const method = route.request().method();
    const res = await fetch(`${TEST_API}${url.pathname}${url.search}`, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : route.request().postData() || undefined,
    });
    await route.fulfill({
      status: res.status,
      contentType: res.headers.get('content-type') || 'application/json',
      body: Buffer.from(await res.arrayBuffer()),
    });
  });

  page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  await page.addInitScript((t) => localStorage.setItem('repair-agent-token', t), token);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 15000 });
  put('LOGIN_AS=' + EMP);

  // 机型管理：打开 R740 的资料图纸抽屉，断言 API 上传的 PDF 出现在列表
  await page.getByRole('button', { name: '机型管理' }).click();
  await page.waitForTimeout(800);
  const rows = page.locator('tbody tr');
  let rowIndex = -1;
  for (let i = 0; i < await rows.count(); i++) {
    if ((await rows.nth(i).locator('td').nth(2).innerText()).trim() === 'R740') { rowIndex = i; break; }
  }
  put('R740_ROW_INDEX=' + rowIndex);
  if (rowIndex < 0) throw new Error('机型列表未找到精确型号 R740');
  await rows.nth(rowIndex).getByRole('button', { name: '资料图纸' }).click();
  await page.waitForTimeout(900);
  const drawerText = await page.locator('aside').last().innerText();
  put('ASSERT_UI_ASSET_LIST=' + drawerText.includes('r42-r740-schematic.pdf'));
  await page.getByTitle('关闭').first().click();
  await page.waitForTimeout(400);

  // 对话检索：命中 R740 案例 → 查看图纸 → PDF iframe 预览
  await page.getByRole('button', { name: '对话检索' }).click();
  const chatInput = page.getByPlaceholder(/描述故障现象/);
  await chatInput.fill('R740开机无显示');
  await chatInput.press('Enter');
  await page.waitForTimeout(4000);
  const r740Card = page.locator('article').filter({ has: page.getByText('R740', { exact: true }) }).first();
  put('ASSERT_R740_CARD=' + (await r740Card.count() > 0 && await r740Card.getByRole('button', { name: '查看图纸' }).count() > 0));
  await r740Card.getByRole('button', { name: '查看图纸' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '预览' }).first().click();
  await page.waitForTimeout(1500);
  const iframe = page.locator('iframe').first();
  const iframeSrc = await iframe.getAttribute('src');
  put('IFRAME_SRC=' + String(iframeSrc || '').slice(0, 60));
  const blobType = await page.evaluate(async (src) => (await fetch(src)).headers.get('content-type'), iframeSrc);
  put('BLOB_TYPE=' + blobType);
  put('ASSERT_PDF_PREVIEW=' + (await iframe.count() > 0 && String(iframeSrc || '').startsWith('blob:') && String(blobType).includes('application/pdf')));
  await page.screenshot({ path: path.join(SHOT_DIR, 'r42-assets-ui.png'), fullPage: false });
  put('SCREENSHOT=e2e/screenshots/r42-assets-ui.png');
  put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
} catch (e) {
  put('FATAL=' + (e?.stack || e));
  if (page) put('DEBUG_BODY=' + (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500));
  put('DEBUG_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  put('DEBUG_SERVER_LOG=' + serverLog.slice(-800));
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
  fs.rmSync(pdfPath, { force: true });
  put('COPY_DIR_DELETED=' + !fs.existsSync(dbDir));
  put('TMP_SCRIPT_DELETED=' + !fs.existsSync(accountScript));
  put('TMP_PDF_DELETED=' + !fs.existsSync(pdfPath));
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
}
