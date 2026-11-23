/**
 * 第 25 轮：第一步真实附件鉴权补测（只读 GET）；第二步 A1 删除 33 条 sample（真实业务接口写开发库，用户授权）。
 * 不改代码；第一步 200/403 只记录；删除仅 source='sample'（保留 id=39 manual）。
 */
const fs = require('node:fs');
const path = require('node:path');
const D = require('better-sqlite3');

const BASE = 'http://127.0.0.1:3001/api';
const OUT = path.join(__dirname, 'verify-r25-attachment-and-purge-out.txt');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const J = (v) => JSON.stringify(v);

async function login(emp_no) {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_no, password: 'Test@1234' }),
  });
  const b = await r.json();
  put(`LOGIN_REQUEST=POST ${BASE}/auth/login ${J({ emp_no, password: 'Test@1234' })}`);
  put(`LOGIN_RESPONSE_STATUS=${r.status}`);
  put(`LOGIN_RESPONSE_BODY=${J(b)}`);
  if (!b || b.code !== 0 || !b.data || !b.data.token) throw new Error(`${emp_no} 登录失败，停止`);
  return b.data.token;
}

async function rawGet(url, token, label) {
  const r = await fetch(BASE + url, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  put(`REQUEST=GET ${BASE}${url}  [${label}]`);
  put(`RESPONSE_STATUS=${r.status}`);
  put(`RESPONSE_HEADERS=${J(Object.fromEntries(r.headers.entries()))}`);
  put(`RESPONSE_BINARY_BYTES=${buf.length}`);
  put(`RESPONSE_FIRST4_HEX=${buf.subarray(0, 4).toString('hex')}`);
  let body = buf.toString('utf8');
  try { body = J(JSON.parse(body)); } catch { body = J(body.slice(0, 200)); }
  put(`RESPONSE_BODY_OR_TEXT=${body}`);
  return { status: r.status, bytes: buf.length };
}

async function jsonCall(url, token, method, obj) {
  const init = { method: method || 'GET', headers: { Authorization: `Bearer ${token}` } };
  if (obj !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(obj); }
  const r = await fetch(BASE + url, init);
  const text = await r.text();
  let b; try { b = JSON.parse(text); } catch { b = text; }
  put(`REQUEST=${init.method} ${BASE}${url}`);
  if (obj !== undefined) put(`REQUEST_FIELDS=${J(obj)}`);
  put(`RESPONSE_STATUS=${r.status}`);
  put(`RESPONSE_BODY=${J(b)}`);
  return { status: r.status, body: b };
}

function baseline(db, tag) {
  const o = {
    cases: db.prepare('select count(*) c from cases').get().c,
    sample: db.prepare("select count(*) c from cases where source='sample'").get().c,
    manual: db.prepare("select count(*) c from cases where source='manual'").get().c,
    attachments: db.prepare('select count(*) c from case_attachments').get().c,
    cache: db.prepare('select count(*) c from search_cache').get().c,
  };
  put(`${tag}=${J(o)}`);
  return o;
}

async function main() {
  const db = new D('server/data/repair.db', { readonly: true });
  put('===== 前置：只读确认案例与附件现状 =====');
  put(`CASE39=${J(db.prepare('select id,status,source,author from cases where id=39').get())}`);
  put(`ATT4=${J(db.prepare('select id,case_id,original_name,relative_path,size from case_attachments where id=4').get())}`);
  baseline(db, 'BASELINE_BEFORE');

  put('===== 第一步 1) WX2001 作者取图 =====');
  const tA = await login('WX2001');
  const a = await rawGet('/attachments/4/raw', tA, 'WX2001 作者');
  put(`STEP1_OWNER_STATUS=${a.status} BYTES=${a.bytes}`);

  put('===== 第一步 2) WX2002 跨技术员取图 + 取案例 =====');
  const tB = await login('WX2002');
  const b = await rawGet('/attachments/4/raw', tB, 'WX2002 跨技术员');
  const c = await jsonCall('/cases/39', tB, 'GET');
  put(`STEP2_OTHER_TECH_RAW_STATUS=${b.status}`);
  put(`STEP2_OTHER_TECH_CASE_STATUS=${c.status}`);

  put('===== 第二步 1) 执行 A1 purge-samples（工程师 WX1001） =====');
  const tE = await login('WX1001');
  const purge = await jsonCall('/cases/purge-samples', tE, 'POST');
  const backupInfo = (purge.body && purge.body.data && purge.body.data.backup) || null;
  put(`PURGE_BACKUP_RETURNED=${J(backupInfo)}`);
  if (backupInfo) {
    const bp = path.resolve('server', String(backupInfo).replace(/^server[\\/]/, ''));
    put(`PURGE_BACKUP_PATH_RESOLVED=${bp}`);
    put(`PURGE_BACKUP_EXISTS=${fs.existsSync(bp)}`);
    put(`PURGE_BACKUP_SIZE=${fs.existsSync(bp) ? fs.statSync(bp).size : 0}`);
  }
  db.close();

  put('===== 第二步 2/3) 级联确认 + 删后基线（只读） =====');
  const db2 = new D('server/data/repair.db', { readonly: true });
  const att4 = db2.prepare('select id,case_id from case_attachments where id=4').get();
  put(`ATT4_STILL_EXISTS=${J(att4)}`);
  put(`ATTACHMENTS_OF_SAMPLE_IDS=${J(db2.prepare("select ca.id from case_attachments ca join cases c on c.id=ca.case_id where c.source='sample'").all())}`);
  const after = baseline(db2, 'BASELINE_AFTER_PURGE');

  put('===== 第二步 4) chat「R740 无显示」命中真数据 =====');
  const hit = await jsonCall('/chat', tA, 'POST', { message: 'R740 无显示' });
  const hd = hit.body && hit.body.data;
  put(`HIT_CASES=${J(hd && Array.isArray(hd.cases) ? hd.cases.map(x => ({ id: x.id, source: x.source, score: x.score, similarity: x.similarity })) : null)}`);
  put(`HIT_ADMITTED_COUNT=${hd && hd.admittedCount}`);
  put(`HIT_SUMMARY=${J(hd && hd.summary)}`);
  put(`HIT_SCORE_TRACE=${J(hd && hd.scoreTrace)}`);

  put('===== 第二步 5) chat「不存在的机型XYZ」兜底 =====');
  const miss = await jsonCall('/chat', tA, 'POST', { message: '不存在的机型XYZ' });
  const md = miss.body && miss.body.data;
  put(`MISS_CASES=${J(md && Array.isArray(md.cases) ? md.cases : null)}`);
  put(`MISS_WEAK_CASES=${J(md && md.weakCases)}`);
  put(`MISS_ADMITTED_COUNT=${md && md.admittedCount}`);
  put(`MISS_SUMMARY=${J(md && md.summary)}`);
  put(`MISS_KEYWORDS=${J(md && md.keywords)}`);

  baseline(db2, 'BASELINE_FINAL_AFTER_CHAT');
  db2.close();
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
}
main().catch((e) => { console.error('FATAL=' + e.message); process.exitCode = 1; });
