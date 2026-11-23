/**
 * 第 26 轮任务二/三实测（真实业务接口写开发库，用户授权）：
 * - audit_logs：WX2001 造假案例 -> WX1001 驳回 -> WX2001 重新提交 -> WX1001 通过 -> 查审计 -> 删假案例
 * - 会话过期：手动插昨天过期的假 session -> 调 cleanupExpiredSessions 语义清理 -> 验证假行删除、真 token 不受影响
 * 收尾保持库里只剩 1 条真数据（id=39）。
 */
const path = require('node:path');
const D = require('better-sqlite3');
const BASE = 'http://127.0.0.1:3001/api';
const OUT = path.join(__dirname, 'verify-r26-audit-sessions-out.txt');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const J = (v) => JSON.stringify(v);

async function login(emp_no) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J({ emp_no, password: 'Repair@2026' }) });
  const b = await r.json();
  put(`LOGIN ${emp_no} status=${r.status} body=${J(b)}`);
  if (b.code !== 0) throw new Error(emp_no + ' 登录失败');
  return b.data.token;
}
async function api(url, token, method, obj) {
  const init = { method: method || 'GET', headers: { Authorization: `Bearer ${token}` } };
  if (obj !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = J(obj); }
  const r = await fetch(BASE + url, init);
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  put(`REQUEST=${init.method} ${BASE}${url} ${obj !== undefined ? J(obj) : ''}`);
  put(`RESPONSE_STATUS=${r.status}`);
  put(`RESPONSE_BODY=${J(b)}`);
  return b;
}

async function main() {
  const db = new D('server/data/repair.db', { readonly: false });
  put('===== 任务二：audit_logs 实测 =====');
  put(`AUDIT_BEFORE_ROWS=${db.prepare('select count(*) c from audit_logs').get().c}`);
  const tA = await login('WX2001');
  const tE = await login('WX1001');

  // 1) WX2001 造假案例（无附件，走 /cases JSON 接口）
  const fakeFields = { model: 'TMP-AUDIT-R740', customer: '审计测试客户', symptom: '审计测试现象', solution: '审计测试方案', repaired_at: '2026-11-23' };
  const created = await api('/cases', tA, 'POST', fakeFields);
  const fakeId = created && created.data && created.data.id;
  if (!fakeId) throw new Error('假案例创建失败');
  put(`FAKE_CASE_ID=${fakeId}`);
  put(`FAKE_CASE_STATUS=${JSON.stringify(db.prepare('select id,status,author from cases where id=?').get(fakeId))}`);

  // 2) WX1001 驳回
  await api(`/cases/${fakeId}/reject`, tE, 'POST', { reason: '审计测试驳回原因' });
  put(`AFTER_REJECT=${JSON.stringify(db.prepare('select id,status,reject_reason,reviewer from cases where id=?').get(fakeId))}`);

  // 3) WX2001 重新提交（PUT 已驳回案例）
  await api(`/cases/${fakeId}`, tA, 'PUT', { ...fakeFields, note: '重新提交说明' });
  put(`AFTER_RESUBMIT=${JSON.stringify(db.prepare('select id,status from cases where id=?').get(fakeId))}`);

  // 4) WX1001 通过
  await api(`/cases/${fakeId}/approve`, tE, 'POST');
  put(`AFTER_APPROVE=${JSON.stringify(db.prepare('select id,status,reviewer from cases where id=?').get(fakeId))}`);

  // 5) 只读查审计日志
  const logs = db.prepare('select * from audit_logs where case_id=? order by id').all(fakeId);
  put(`AUDIT_LOGS_FOR_FAKE=${J(logs)}`);
  const actions = logs.map((l) => l.action).join(',');
  put(`AUDIT_ACTIONS=${actions}`);
  put(`AUDIT_HAS_REJECT_REASON=${logs.some((l) => l.action === 'reject' && l.reason === '审计测试驳回原因')}`);

  // 6) 删假案例 + 其审计日志（保持库只剩真数据）
  db.prepare('delete from cases where id=?').run(fakeId);
  db.prepare('delete from audit_logs where case_id=?').run(fakeId);
  put(`FAKE_DELETED=${JSON.stringify(db.prepare('select count(*) c from cases where id=?').get(fakeId))}`);
  put(`CASES_AFTER_CLEANUP=${db.prepare('select count(*) c from cases').get().c}`);
  put(`AUDIT_AFTER_CLEANUP=${db.prepare('select count(*) c from audit_logs').get().c}`);

  put('===== 任务三：会话过期清理实测 =====');
  // 真 token A 对应的 session 行
  const realRow = db.prepare('select token,expires_at from sessions where token=?').get(tA);
  put(`REAL_SESSION_BEFORE=${J(realRow && { token: realRow.token.slice(0, 12), expires_at: realRow.expires_at })}`);
  // 插一条昨天过期的假 session（毫秒时间戳 = 昨天）
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  const fakeToken = 'r26fakesession' + Date.now();
  db.prepare('insert into sessions (token,user_id,emp_no,expires_at) values (?,?,?,?)').run(fakeToken, 3, 'WX2001', yesterday);
  put(`FAKE_SESSION_INSERTED=${J({ token: fakeToken.slice(0, 12), expires_at: yesterday })}`);
  put(`SESSIONS_BEFORE_CLEAN=${db.prepare('select count(*) c from sessions').get().c}`);
  // 调用与定时器同一函数的语义：DELETE WHERE expires_at <= Date.now()
  const deleted = db.prepare('delete from sessions where expires_at <= ?').run(Date.now()).changes;
  put(`CLEAN_DELETED_ROWS=${deleted}`);
  put(`FAKE_SESSION_AFTER=${J(db.prepare('select token from sessions where token=?').get(fakeToken))}`);
  put(`REAL_SESSION_AFTER=${J(db.prepare('select token,expires_at from sessions where token=?').get(tA) && { token: tA.slice(0, 12) })}`);
  // 真 token 仍能鉴权
  const me = await api('/auth/me', tA, 'GET');
  put(`REAL_TOKEN_AUTH=${J(me)}`);
  put(`SESSIONS_AFTER_CLEAN=${db.prepare('select count(*) c from sessions').get().c}`);

  db.close();
  require('node:fs').writeFileSync(OUT, lines.join('\n') + '\n');
}
main().catch((e) => { console.error('FATAL=' + e.message); process.exitCode = 1; });
