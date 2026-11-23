/**
 * 第 28 轮改密接口实测（全部走真实 HTTP 鉴权接口，与界面操作等价；不直连数据库写）。
 * 流程：工程师登录 -> 批量改 10 个种子账号密码 -> 旧密码失败/新密码成功 -> 非种子账号不受影响
 *       -> 技术员 403 -> 已登录 token 仍有效。
 * 注意：本脚本会真实修改开发库 users 表（用户明确要求），执行后密码为 Repair@2026。
 */
const BASE = 'http://127.0.0.1:3001/api';

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function login(emp_no, password) {
  return call('/auth/login', { method: 'POST', body: { emp_no, password } });
}

(async () => {
  const NEW = 'Repair@2026';
  const OLD = 'Test@1234';

  console.log('===== 0) 前置：工程师 WX1001 用旧密码登录 =====');
  const eng = await login('WX1001', OLD);
  console.log('ENGINEER_LOGIN_BEFORE=' + JSON.stringify(eng));
  if (eng.json?.code !== 0) throw new Error('工程师旧密码登录失败，停止');
  const token = eng.json.data.token;

  console.log('===== 1) 调用批量改密接口 =====');
  const changed = await call('/auth/change-initial-password', { method: 'POST', token, body: { newPassword: NEW } });
  console.log('CHANGE_RESULT=' + JSON.stringify(changed));

  console.log('===== 2) 旧密码登录（应失败） =====');
  for (const emp of ['WX1001', 'WX2001', 'WX2008']) {
    const r = await login(emp, OLD);
    console.log(`OLD_LOGIN ${emp}=` + JSON.stringify(r));
  }

  console.log('===== 3) 新密码登录（应成功） =====');
  for (const emp of ['WX1001', 'WX1002', 'WX2001', 'WX2002', 'WX2003', 'WX2004', 'WX2005', 'WX2006', 'WX2007', 'WX2008']) {
    const r = await login(emp, NEW);
    console.log(`NEW_LOGIN ${emp}=` + JSON.stringify({
      status: r.status, code: r.json?.code, message: r.json?.message,
      user: r.json?.data?.user ? { emp_no: r.json.data.user.emp_no, name: r.json.data.user.name, role: r.json.data.user.role } : null,
      hasToken: !!r.json?.data?.token,
    }));
  }

  console.log('===== 4) 已登录 token 是否仍有效（不应失效） =====');
  const me = await call('/auth/me', { token });
  console.log('ME_WITH_OLD_TOKEN=' + JSON.stringify(me));

  console.log('===== 5) 技术员调用改密接口（应 403） =====');
  const techLogin = await login('WX2001', NEW);
  const techToken = techLogin.json?.data?.token;
  const forbidden = await call('/auth/change-initial-password', { method: 'POST', token: techToken, body: { newPassword: 'Another@2026' } });
  console.log('TECHNICIAN_CHANGE=' + JSON.stringify(forbidden));

  console.log('===== 6) 短密码校验（应失败） =====');
  const short = await call('/auth/change-initial-password', { method: 'POST', token, body: { newPassword: '123' } });
  console.log('SHORT_PASSWORD=' + JSON.stringify(short));
})().catch((e) => { console.error('FATAL=' + (e?.stack || e)); process.exit(1); });
