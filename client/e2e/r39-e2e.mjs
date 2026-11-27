/**
 * 第 39 轮：System Prompt 自定义功能 E2E
 * ① WX2001 登录；② "你是谁" / "你能干什么" 体现专业人设（预设逻辑，不查库）；
 * ③ 检索 R740 案例后追问 "这个主板的 VRM 模块需要换什么配件？" —— LLM 带专业人设 system prompt，
 *    严格基于上一轮案例回答，不编造额外配件。
 * 每步截图保存 client/e2e/screenshots/，输出助手回复与断言。测后清理临时会话。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:5173';
const API = 'http://127.0.0.1:3001/api';
const SHOT_DIR = path.join(process.cwd(), 'e2e', 'screenshots');
const OUT = path.join(process.cwd(), 'e2e', 'r39-e2e-out.txt');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
const input = page.getByPlaceholder(/描述故障现象/);

async function ask(text, tag) {
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(2800);
  await page.screenshot({ path: path.join(SHOT_DIR, tag + '.png'), fullPage: true });
  const bubbles = await page.locator('.whitespace-pre-wrap').allInnerTexts();
  const answer = bubbles.length ? bubbles[bubbles.length - 1] : '(无回复)';
  put(`--- ${tag} ---\nINPUT=${text}\nANSWER=${answer}\nSCREENSHOT=e2e/screenshots/${tag}.png`);
  return answer;
}

async function cleanupSessions(token) {
  const r = await fetch(API + '/chat/sessions', { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json());
  const mine = (r.data || []).filter((s) => /你是谁|你能干什么|R740开机无显示/.test(s.title));
  for (const s of mine) {
    await fetch(`${API}/chat/sessions/${s.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  }
  put('CLEANED_SESSIONS=' + mine.length);
}

(async () => {
  let token = '';
  try {
    const loginResp = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emp_no: 'WX2001', password: 'Repair@2026' }),
    }).then((x) => x.json());
    token = loginResp.data?.token || '';

    put('===== 登录页面 =====');
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('例如 WX1001').fill('WX2001');
    await page.getByPlaceholder('请输入密码').fill('Repair@2026');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForTimeout(1500);
    put('LOGIN_URL=' + page.url());

    put('===== 场景 1：你是谁 =====');
    const a1 = await ask('你是谁', 'r39-scene1-who');
    put('ASSERT_1_EXPERT_PERSONA=' + (a1.includes('服务器主板维修专家助手') && a1.includes('真实案例')));

    put('===== 场景 2：你能干什么 =====');
    const a2 = await ask('你能干什么', 'r39-scene2-capability');
    put('ASSERT_2_CAPABILITY=' + (a2.includes('服务器主板维修专家助手') && a2.includes('检索')));

    put('===== 场景 3a：R740开机无显示（检索真实案例，带专业人设） =====');
    const a3a = await ask('R740开机无显示', 'r39-scene3a-search');
    put('ASSERT_3A_HAS_CASE=' + (/R740|案例|条/.test(a3a)));

    put('===== 场景 3b：这个主板的 VRM 模块需要换什么配件？（system prompt 生效，基于案例不编造） =====');
    const a3b = await ask('这个主板的 VRM 模块需要换什么配件？', 'r39-scene3b-followup');
    put('ASSERT_3B_GROUNDED=' + (a3b.includes('VRM') || a3b.includes('案例') || a3b.includes('未提及')));
    put('ASSERT_3B_NO_FABRICATION=' + !/(额外|推荐购买|具体型号为|建议更换为)/.test(a3b));

    put('===== 控制台错误 =====');
    put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  } finally {
    if (token) await cleanupSessions(token).catch(() => {});
    await browser.close();
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
  }
})().catch((e) => { console.error('FATAL=' + (e?.stack || e)); process.exit(1); });
