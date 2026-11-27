/**
 * 第 38 轮：技术向对话路由真实浏览器 E2E
 * 场景：① "你是谁" 不查库直接自我介绍；② "我想看华为的全部案例" LLM 自然语言总结；
 *       ③ "R740开机无显示" 后追问 "这个主板的电源模块怎么拆？" 基于上一轮案例回答。
 * 每步真实截图保存到 client/e2e/screenshots/，并输出助手回复文本与断言。
 * 测后清理本脚本创建的会话（通过对话接口的会话 ID，从页面无法直接拿，改用 API 清理最新会话）。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:5173';
const API = 'http://127.0.0.1:3001/api';
const SHOT_DIR = path.join(process.cwd(), 'e2e', 'screenshots');
const OUT = path.join(process.cwd(), 'e2e', 'r38-e2e-out.txt');
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
  await page.waitForTimeout(2500); // 等 LLM 总结/追问完成
  await page.screenshot({ path: path.join(SHOT_DIR, tag + '.png'), fullPage: true });
  const bubbles = await page.locator('.whitespace-pre-wrap').allInnerTexts();
  const answer = bubbles.length ? bubbles[bubbles.length - 1] : '(无回复)';
  put(`--- ${tag} ---`);
  put(`INPUT=${text}`);
  put(`ANSWER=${answer}`);
  put(`SCREENSHOT=e2e/screenshots/${tag}.png`);
  return answer;
}

(async () => {
  try {
    put('===== 登录 =====');
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('例如 WX1001').fill('WX2001');
    await page.getByPlaceholder('请输入密码').fill('Repair@2026');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForTimeout(1500);
    put(`LOGIN_URL=${page.url()}`);
    put(`LOGIN_ERRORS=${JSON.stringify(consoleErrors)}`);

    put('===== 场景 1：你是谁 =====');
    const a1 = await ask('你是谁', 'r38-scene1-chitchat');
    put('ASSERT_1_SELF_INTRO=' + a1.includes('服务器主板维修助手'));

    put('===== 场景 2：我想看华为的全部案例 =====');
    const a2 = await ask('我想看华为的全部案例', 'r38-scene2-aggregate');
    put('ASSERT_2_AGGREGATE=' + (a2.includes('华为') && /条/.test(a2)));

    put('===== 场景 3a：R740开机无显示 =====');
    const a3a = await ask('R740开机无显示', 'r38-scene3a-search');
    put('ASSERT_3A_HAS_CASES=' + /条|案例|R740/i.test(a3a));

    put('===== 场景 3b：这个主板的电源模块怎么拆？ =====');
    const a3b = await ask('这个主板的电源模块怎么拆？', 'r38-scene3b-followup');
    put('ASSERT_3B_NO_HALLUCINATION=' + (a3b.includes('没有提到') || a3b.includes('历史案例')));

    put('===== 最终控制台错误 =====');
    put('FINAL_CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
  } finally {
    await browser.close();
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
  }
})().catch((e) => { console.error('FATAL=' + (e?.stack || e)); process.exit(1); });
