/**
 * 第 40 轮：移除顶栏全局搜索后的就近搜索验收。
 * 全程使用 VACUUM INTO 独立测试库副本 + TMP 临时工程师账号，不碰开发库、不使用用户账号、不登出。
 * 截图：r40-chat-ui.png / r40-cases-ui.png（client/e2e/screenshots/，被 gitignore 忽略）。
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const clientDir = process.cwd();
const root = path.resolve(clientDir, '..');
const dbDir = path.join(root, 'server', 'verify', '.db', 'r40-ui');
const dbPath = path.join(dbDir, 'data', 'repair.db');
const accountScript = path.join(root, 'server', 'verify', 'verify-r40-account.mjs');
const tsxCli = path.join(root, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = path.join(root, 'server', 'src', 'index.ts');
const API_PORT = '3002';
const BASE = 'http://127.0.0.1:5173';
const TEST_API = `http://127.0.0.1:${API_PORT}`;
const SHOT_DIR = path.join(clientDir, 'e2e', 'screenshots');
const OUT = path.join(clientDir, 'e2e', 'r40-e2e-out.txt');
const EMP = 'TMPR40ENG';
const PASSWORD = 'TmpR40@Test';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runSync(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${path.basename(script)} 失败: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

let server = null;
let browser = null;
let page = null;
let consoleErrors = [];
let failedRequests = [];
let apiResponses = [];
let serverLog = '';

try {
  put('STEP_1_COPY_DB=' + runSync(path.join(root, 'server', 'verify', 'verify-copy.mjs'), [`--db=${dbPath}`]));
  put('STEP_2_TMP_ACCOUNT=' + runSync(accountScript, [`--db=${dbPath}`]));

  server = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: dbDir,
    env: { ...process.env, PORT: API_PORT, REPAIR_VERIFY: '1', REPAIR_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (b) => { serverLog += b.toString(); });
  server.stderr.on('data', (b) => { serverLog += b.toString(); });

  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${TEST_API}/api/health`);
      if (r.ok) { healthy = true; break; }
    } catch { /* 启动中 */ }
    await sleep(500);
  }
  put('TEST_SERVER_HEALTH=' + healthy);
  if (!healthy) throw new Error('独立测试服务启动失败\n' + serverLog);

  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await ctx.route('http://127.0.0.1:5173/api/**', async (route) => {
    const url = new URL(route.request().url());
    const headers = {};
    for (const [k, v] of Object.entries(route.request().headers())) {
      const lk = k.toLowerCase();
      if (lk !== 'host' && lk !== 'content-length') headers[k] = v;
    }
    const init = {
      method: route.request().method(),
      headers,
      body: ['GET', 'HEAD'].includes(route.request().method()) ? undefined : route.request().postData() || undefined,
    };
    const res = await fetch(`${TEST_API}${url.pathname}${url.search}`, init);
    await route.fulfill({
      status: res.status,
      contentType: res.headers.get('content-type') || 'application/json',
      body: Buffer.from(await res.arrayBuffer()),
    });
  });

  page = await ctx.newPage();
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
  page.on('requestfailed', (r) => failedRequests.push(r.url() + ' ' + (r.failure()?.errorText || '')));
  page.on('response', (r) => { if (r.url().includes('/api/')) apiResponses.push(r.status() + ' ' + r.url()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('例如 WX1001').fill(EMP);
  await page.getByPlaceholder('请输入密码').fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForSelector('header', { timeout: 15000 });
  const firstHeader = await page.locator('header').innerText();
  put('LOGIN_AS=' + EMP);
  put('HEADER_TITLE=' + firstHeader.split('\n')[0]);
  put('ASSERT_HEADER_HAS_USER=' + firstHeader.includes('第40轮临时工程师'));
  put('ASSERT_HEADER_HAS_UPLOAD=' + ((await page.locator('header').getByRole('button', { name: '上传案例' }).count()) === 1));

  const globalSelector = page.getByPlaceholder('全局搜索案例 / 型号 / 客户');
  put('ASSERT_CHAT_NO_GLOBAL_SEARCH=' + ((await globalSelector.count()) === 0));

  // 对话检索：底部输入框发消息
  const chatInput = page.getByPlaceholder(/描述故障现象/);
  await chatInput.fill('R740开机无显示');
  await chatInput.press('Enter');
  await sleep(4000);
  const bubbles = await page.locator('.whitespace-pre-wrap').allInnerTexts();
  const answer = bubbles.find((b) => /案例|R740|未找到/.test(b)) || bubbles[bubbles.length - 1] || '(无回复)';
  put('CHAT_SENT=' + (await page.getByText('R740开机无显示').count()));
  put('CHAT_ALL_BUBBLES=' + JSON.stringify(bubbles.map((b) => b.replace(/\s+/g, ' ').slice(0, 120))));
  put('CHAT_ANSWER=' + answer.replace(/\s+/g, ' ').slice(0, 160));
  const caseBadges = await page.getByText('R740', { exact: true }).count();
  put('CHAT_CASE_BADGES=' + caseBadges);
  put('ASSERT_CHAT_REPLY=' + (bubbles.length > 0 && caseBadges > 0 && (await page.getByText('R740开机无显示').count()) > 0));
  await page.locator('div.engineering-grid.overflow-y-auto').first().evaluate((el) => { el.scrollTop = 0; });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOT_DIR, 'r40-chat-ui.png'), fullPage: true });
  put('SCREENSHOT_CHAT=e2e/screenshots/r40-chat-ui.png');

  // 案例库：关键字 / 客户 / 型号三种页内筛选
  await page.getByRole('button', { name: '案例库' }).click();
  await page.waitForTimeout(800);
  put('ASSERT_CASES_NO_GLOBAL_SEARCH=' + ((await globalSelector.count()) === 0));
  const caseCount = async () => {
    const t = await page.getByText(/共\s*\d+\s*条案例/).first().innerText();
    return Number((t.match(/\d+/) || [0])[0]);
  };
  const baseCases = await caseCount();
  put('CASES_BASE=' + baseCases);

  await page.getByPlaceholder('关键字搜索…').fill('R740');
  await sleep(700);
  const qCases = await caseCount();
  const qRows = await page.locator('tbody tr').filter({ hasText: '#' }).count();
  const qHasR740 = (await page.locator('tbody').innerText()).includes('R740');
  put('CASES_AFTER_Q=' + qCases + ' ROWS=' + qRows + ' HAS_R740=' + qHasR740);
  put('ASSERT_CASES_Q_FILTER=' + (qCases > 0 && qCases < baseCases && qRows > 0 && qHasR740));
  await page.screenshot({ path: path.join(SHOT_DIR, 'r40-cases-ui.png'), fullPage: true });
  put('SCREENSHOT_CASES=e2e/screenshots/r40-cases-ui.png');

  await page.getByRole('button', { name: '全部重置' }).click();
  await sleep(500);
  const customerSelect = page.locator('select[title^="客户（"]');
  const customerValues = await customerSelect.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
  await customerSelect.selectOption(customerValues[0]);
  await sleep(700);
  const customerCases = await caseCount();
  put('CASES_AFTER_CUSTOMER=' + customerCases + ' VALUE=' + customerValues[0]);
  put('ASSERT_CASES_CUSTOMER_FILTER=' + (customerCases > 0 && customerCases < baseCases));

  await page.getByRole('button', { name: '全部重置' }).click();
  await sleep(500);
  const modelSelect = page.locator('select[title^="型号（"]');
  const modelValues = await modelSelect.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
  await modelSelect.selectOption(modelValues[0]);
  await sleep(700);
  const modelCases = await caseCount();
  put('CASES_AFTER_MODEL=' + modelCases + ' VALUE=' + modelValues[0]);
  put('ASSERT_CASES_MODEL_FILTER=' + (modelCases > 0 && modelCases < baseCases));

  // 机型管理：页内搜索
  await page.getByRole('button', { name: '机型管理' }).click();
  await sleep(700);
  const modelTotal = async () => {
    const t = await page.getByText(/共\s*\d+\s*个机型/).first().innerText();
    return Number((t.match(/\d+/) || [0])[0]);
  };
  const baseModels = await modelTotal();
  const firstModel = (await page.locator('tbody tr').first().locator('td').nth(2).innerText()).trim();
  await page.getByPlaceholder(/搜索品牌/).fill(firstModel.slice(0, 4));
  await sleep(600);
  const filteredModels = await modelTotal();
  put('MODELS_BASE=' + baseModels + ' QUERY=' + firstModel.slice(0, 4) + ' AFTER=' + filteredModels);
  put('ASSERT_MODELS_SEARCH=' + (filteredModels > 0 && filteredModels < baseModels));

  // 客户管理：页内搜索
  await page.getByRole('button', { name: '客户管理' }).click();
  await sleep(700);
  const customerTotal = async () => {
    const t = await page.getByText(/共\s*\d+\s*个客户/).first().innerText();
    return Number((t.match(/\d+/) || [0])[0]);
  };
  const baseCustomers = await customerTotal();
  const firstCustomer = (await page.locator('tbody tr').first().locator('td').nth(1).innerText()).trim();
  await page.getByPlaceholder(/搜索名称/).fill(firstCustomer.slice(0, 2));
  await sleep(600);
  const filteredCustomers = await customerTotal();
  put('CUSTOMERS_BASE=' + baseCustomers + ' QUERY=' + firstCustomer.slice(0, 2) + ' AFTER=' + filteredCustomers);
  put('ASSERT_CUSTOMERS_SEARCH=' + (filteredCustomers > 0 && filteredCustomers < baseCustomers));

  put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
} catch (e) {
  put('FATAL=' + (e?.stack || e));
  if (page) {
    put('DEBUG_URL=' + page.url());
    put('DEBUG_BODY=' + (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500));
  }
  put('DEBUG_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  put('DEBUG_FAILED_REQUESTS=' + JSON.stringify(failedRequests));
  put('DEBUG_API_RESPONSES=' + JSON.stringify(apiResponses));
  if (page) put('DEBUG_HTML=' + (await page.content().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400));
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
  put('COPY_DIR_DELETED=' + !fs.existsSync(dbDir));
  put('TMP_ACCOUNT_SCRIPT_DELETED=' + !fs.existsSync(accountScript));
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
}
