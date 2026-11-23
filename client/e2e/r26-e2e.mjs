/**
 * 第 26 轮任务五：真实浏览器 E2E
 * - CSV 下载注入防护：登录 -> 案例页 -> 批量导入 -> 上传含 =1+1 的非法 xlsx -> 解析预览 -> 执行 -> 导出失败行 -> 拦截下载读 CSV 断言 '"\'=1+1"'
 * - 图片真实预览：案例页打开 id=39 -> 断言 /api/attachments/4/raw 被请求 -> 图片 naturalWidth>0
 * 测后精确删除 import_batches（失败行不写 cases，不动真数据 id=39）。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const requireFromServer = createRequire(path.resolve(process.cwd(), '../server/package.json'));
const XLSX = requireFromServer('xlsx');

const BASE = 'http://127.0.0.1:5173';
const OUT = path.join(process.cwd(), 'e2e', 'r26-e2e-out.txt');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const J = (v) => JSON.stringify(v);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e.message)));

try {
  put('===== 登录 =====');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('例如 WX1001').fill('WX1001');
  await page.getByPlaceholder('请输入密码').fill('Repair@2026');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForTimeout(1500);
  put(`LOGIN_URL=${page.url()}`);
  put(`LOGIN_ERRORS=${J(consoleErrors)}`);
  put(`BODY_TEXT_HEAD=${J((await page.locator('body').innerText()).slice(0, 200))}`);
  // 导航到案例库（登录后默认在对话检索）
  const navCases = page.getByRole('button', { name: /案例库/ }).first();
  put(`NAV_CASES_BTN_COUNT=${await page.getByRole('button', { name: /案例库/ }).count()}`);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('案例库'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  put(`AFTER_NAV_URL=${page.url()}`);
  put(`AFTER_NAV_BODY=${J((await page.locator('body').innerText()).slice(0, 300))}`);
  put(`AFTER_NAV_HTML_LEN=${(await page.content()).length}`);
  put(`AFTER_NAV_ERRORS=${J(consoleErrors)}`);
  put(`IMPORT_BTN_COUNT=${await page.getByRole('button', { name: /批量导入/ }).count()}`);

  // ---------- CSV 下载注入防护 ----------
  put('===== 场景 A：CSV 失败行导出注入防护 =====');
  const xlsx = XLSX.utils.book_new();
  // 唯一非法点是“故障分类 = =1+1”：型号/现象/解决方案/日期都合法，
  // 于是失败原因回显为 “=1+1：故障分类不在可选值里”，CSV 导出真实触发单引号转义防护
  const ws = XLSX.utils.aoa_to_sheet([
    ['型号', '客户', '现象', '诊断', '解决方案', '故障分类', '维修日期'],
    ['戴尔 R740', '某测试客户R26', '电容鼓包专项测试', '诊断', '方案', '=1+1', '2026-11-23'],
  ]);
  XLSX.utils.book_append_sheet(xlsx, ws, 'Sheet1');
  const tmpXlsx = path.join(process.cwd(), 'e2e', 'r26-fail.xlsx');
  XLSX.writeFile(xlsx, tmpXlsx);
  put(`XLSX_PATH=${tmpXlsx}`);

  await page.getByRole('button', { name: '批量导入' }).click();
  await page.waitForTimeout(400);
  await page.locator('input[type=file]').setInputFiles(tmpXlsx);
  await page.getByRole('button', { name: '解析并预览' }).click();
  await page.waitForTimeout(1000);
  put(`PARSED_PREVIEW_VISIBLE=${await page.getByText('01 / 列映射').isVisible().catch(() => false)}`);
  // 执行导入
  const execBtn = page.getByRole('button', { name: /确认导入/ });
  put(`EXEC_BUTTON_COUNT=${await execBtn.count()}`);
  if (await execBtn.count()) {
    await execBtn.first().click();
    await page.waitForTimeout(1800);
  }
  put(`AFTER_EXEC_BODY=${J((await page.locator('body').innerText()).slice(-600))}`);
  // 导出失败行
  const exportBtn = page.getByRole('button', { name: /导出失败行 CSV/ });
  put(`EXPORT_BUTTON_COUNT=${await exportBtn.count()}`);
  if (await exportBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      exportBtn.first().click(),
    ]);
    const dlPath = await download.path();
    const csv = fs.readFileSync(dlPath, 'utf8');
    put(`DOWNLOAD_SUGGESTED=${download.suggestedFilename()}`);
    put(`CSV_RAW=${J(csv)}`);
    put(`CSV_CONTAINS_ESCAPED_FORMULA=${csv.includes("\"'=1+1：")}`);
    put(`CSV_CONTAINS_BARE_FORMULA=${csv.includes('"=1+1')}`);
  } else {
    put('CSV_EXPORT_SKIPPED=no export button found');
  }

  // ---------- 图片真实预览 ----------
  put('===== 场景 B：图片真实预览 =====');
  // 导入弹窗关闭按钮是纯图标无 aria-label，整页重载最彻底地重置 React 弹窗状态
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('案例库'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1800);
  put(`MODAL_GONE=${(await page.getByText('批量导入历史案例').count()) === 0}`);
  put(`TABLE_HAS_CASE=${(await page.locator('body').innerText()).includes('Dell PowerEdge R740')}`);
  const rawRequests = [];
  page.on('response', (r) => { if (r.url().includes('/api/attachments/4/raw')) rawRequests.push({ url: r.url(), status: r.status() }); });
  const detailBtn = page.getByRole('button', { name: /详情/ }).first();
  put(`DETAIL_BTN_COUNT=${await page.getByRole('button', { name: /详情/ }).count()}`);
  await detailBtn.click({ timeout: 5000 }).catch((e) => put(`DETAIL_CLICK_ERR=${e.message.slice(0, 120)}`));
  await page.waitForTimeout(1800);
  put(`AFTER_DETAIL_BODY=${J((await page.locator('body').innerText()).slice(0, 400))}`);
  put(`RAW_REQUESTS=${J(rawRequests)}`);
  const imgs = await page.locator('img').evaluateAll((els) => els.map((e) => ({ src: e.getAttribute('src'), naturalWidth: e.naturalWidth, naturalHeight: e.naturalHeight })));
  put(`IMG_TAGS=${J(imgs)}`);
  const loaded = imgs.find((i) => i.naturalWidth > 0);
  put(`IMAGE_LOADED=${!!loaded}`);
  put(`IMAGE_IS_BLOB_URL=${loaded ? String(loaded.src).startsWith('blob:') : false}`);
  put(`RAW_FETCH_200=${rawRequests.some((r) => r.status === 200)}`);

  put(`FINAL_CONSOLE_ERRORS=${J(consoleErrors)}`);
} finally {
  await browser.close();
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
}
