/**
 * 第 24 轮真实数据闭环：WX2001 上传 -> WX1001 approve -> chat 检索命中 -> 只读基线。
 * 真实业务接口调用、写开发库，不受 --db 副本约束（用户明确授权）。
 * 案例内容严格照抄用户提供，不自造、不改字段。
 */
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const D = require('better-sqlite3');

const BASE = 'http://127.0.0.1:3001/api';
const OUT = path.join(__dirname, 'verify-r24-real-closure-out.txt');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const J = (v) => JSON.stringify(v);

function makePng() {
  const w = 8, h = 8;
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc, 0);
    return Buffer.concat([len, body, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4); raw[off] = 0;
    for (let x = 0; x < w; x++) { const p = off + 1 + x * 4; raw[p] = 0x2f; raw[p + 1] = 0x6f; raw[p + 2] = 0xed; raw[p + 3] = 0xff; }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function jsonCall(url, token, method, obj) {
  const init = { method: method || 'GET', headers: {} };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (obj !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(obj); }
  const r = await fetch(BASE + url, init);
  const text = await r.text();
  let body = text; try { body = JSON.parse(text); } catch {}
  put(`REQUEST=${init.method} ${BASE}${url}`);
  if (obj !== undefined) put(`REQUEST_FIELDS=${J(obj)}`);
  put(`RESPONSE_STATUS=${r.status}`);
  put(`RESPONSE_BODY=${J(body)}`);
  return { status: r.status, body };
}

async function main() {
  const db = new D('server/data/repair.db', { readonly: true });
  const before = {
    cases: db.prepare('select count(*) c from cases').get().c,
    sample: db.prepare("select count(*) c from cases where source='sample'").get().c,
    nonSample: db.prepare("select count(*) c from cases where source<>'sample'").get().c,
    attachments: db.prepare('select count(*) c from case_attachments').get().c,
    cache: db.prepare('select count(*) c from search_cache').get().c,
  };
  put('===== 0. 基线（只读） =====');
  put(`BASELINE_BEFORE=${J(before)}`);
  put(`AUTO_APPROVE=${J(db.prepare("select value from settings where key='engineer_auto_approve'").get())}`);

  const png = makePng();
  put(`PNG_HEAD_HEX=${png.subarray(0, 4).toString('hex')}`);
  put(`PNG_BYTES=${png.length}`);

  put('===== 1. WX2001 登录 =====');
  const loginA = await jsonCall('/auth/login', null, 'POST', { emp_no: 'WX2001', password: 'Test@1234' });
  const tokenA = loginA.body && loginA.body.data && loginA.body.data.token;
  if (!tokenA) throw new Error('WX2001 登录未拿到 token，停止');
  put(`TOKEN_A_PREFIX=${tokenA.slice(0, 12)}...`);

  put('===== 2. WX2001 上传真实案例 =====');
  const fields = {
    model: 'Dell PowerEdge R740',
    customer: '某银行数据中心',
    symptom: '开机无显示，风扇满转，前面板琥珀色故障灯常亮，iDRAC 可登录但无视频输出',
    diagnosis: 'iDRAC 日志报 VRM 供电异常；万用表测主板 12V 待机正常、CPU VRM 输出 0V；目检发现 VRM 模块一处引脚虚焊',
    solution: '补焊 VRM 模块引脚，更换一颗滤波电容，重刷 BIOS 至最新版；上电自检通过，视频输出恢复',
    parts: 'VRM 模块、10V 470μF 电容',
    repaired_at: '2026-11-20',
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('attachments', new Blob([png], { type: 'image/png' }), 'r740-vrm.png');
  const r = await fetch(BASE + '/cases/upload', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: fd });
  const upText = await r.text();
  let upBody; try { upBody = JSON.parse(upText); } catch { upBody = upText; }
  put(`REQUEST=POST ${BASE}/cases/upload`);
  put(`REQUEST_FIELDS=${J(fields)}`);
  put(`REQUEST_ATTACHMENT=r740-vrm.png (8x8 PNG, ${png.length} bytes, head=${png.subarray(0, 4).toString('hex')})`);
  put(`RESPONSE_STATUS=${r.status}`);
  put(`RESPONSE_BODY=${J(upBody)}`);
  const caseId = upBody && upBody.data && upBody.data.id;
  if (!caseId) throw new Error('上传未拿到案例 id，停止');

  const row = db.prepare('select id,status,source,author,model,customer,symptom,reviewer from cases where id=?').get(caseId);
  const att = db.prepare('select id,case_id,original_name,relative_path,mime_type,size from case_attachments where case_id=?').all(caseId);
  const abs = att[0] ? path.resolve('server/uploads', att[0].relative_path) : '';
  put(`NEW_CASE_ID=${caseId}`);
  put(`NEW_CASE_ROW=${J(row)}`);
  put(`NEW_CASE_STATUS=${row.status}`);
  put(`NEW_CASE_SOURCE=${JSON.stringify(row.source)}`);
  put(`NEW_ATTACHMENTS=${J(att)}`);
  put(`LANDED_FILE_PATH=${abs}`);
  put(`LANDED_FILE_EXISTS=${abs ? fs.existsSync(abs) : false}`);
  if (row.source === 'sample') throw new Error('source=sample，立即停止');
  db.close();

  put('===== 3. WX1001 工程师登录 + approve =====');
  const loginE = await jsonCall('/auth/login', null, 'POST', { emp_no: 'WX1001', password: 'Test@1234' });
  const tokenE = loginE.body && loginE.body.data && loginE.body.data.token;
  if (!tokenE) throw new Error('WX1001 登录未拿到 token，停止');
  await jsonCall(`/cases/${caseId}/approve`, tokenE, 'POST');

  const db2 = new D('server/data/repair.db', { readonly: true });
  const row2 = db2.prepare('select id,status,reviewer,reviewed_at,source from cases where id=?').get(caseId);
  put(`AFTER_APPROVE_ROW=${J(row2)}`);
  put(`AFTER_APPROVE_STATUS=${row2.status}`);
  put(`AFTER_APPROVE_REVIEWER=${JSON.stringify(row2.reviewer)}`);

  put('===== 4. POST /api/chat 检索 =====');
  const chat = await jsonCall('/chat', tokenA, 'POST', { message: 'R740 开机无显示 风扇满转' });
  const data = chat.body && chat.body.data;
  let found = null;
  if (data && Array.isArray(data.list)) found = data.list.find((x) => x.id === caseId || (x.case && x.case.id === caseId) || String(x.id) === String(caseId));
  put(`CHAT_LIST_IDS=${J(data && Array.isArray(data.list) ? data.list.map((x) => ({ id: x.id, caseId: x.case && x.case.id, score: x.score, similarity: x.similarity, rec: x.recurrence_count })) : null)}`);
  put(`NEW_CASE_IN_LIST=${!!found}`);
  put(`FOUND_ITEM=${J(found)}`);
  put(`CHAT_SCORE_TRACE=${J(data && data.scoreTrace)}`);
  put(`CHAT_MATCH_TYPE=${J(data && (data.matchType || data.path || data.reason))}`);
  put(`CHAT_FULL_DATA_KEYS=${J(data ? Object.keys(data) : null)}`);

  put('===== 5. 只读基线变化 =====');
  const after = {
    cases: db2.prepare('select count(*) c from cases').get().c,
    sample: db2.prepare("select count(*) c from cases where source='sample'").get().c,
    nonSample: db2.prepare("select count(*) c from cases where source<>'sample'").get().c,
    attachments: db2.prepare('select count(*) c from case_attachments').get().c,
    cache: db2.prepare('select count(*) c from search_cache').get().c,
  };
  put(`BASELINE_AFTER=${J(after)}`);
  put(`DELTA=${J({ cases: after.cases - before.cases, sample: after.sample - before.sample, nonSample: after.nonSample - before.nonSample, attachments: after.attachments - before.attachments, cache: after.cache - before.cache })}`);
  db2.close();

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
}
main().catch((e) => { console.error('FATAL=' + e.message); process.exitCode = 1; });
