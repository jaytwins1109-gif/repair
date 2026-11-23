/**
 * 第 23 轮补证（第 22 轮安全加固的逐条证据），不在 finally 自动清理任何测试产物。
 * 用途：打印完整 URL / 完整响应体 / TMP 账号 / 案例 id / 落盘路径，供四段式报告直接使用。
 * 用法：npx tsx server/verify/verify-r23-evidence.ts --db=<副本绝对路径>
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseTestDbArg, VERIFY_DIR } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
const COPY_CWD = path.dirname(path.dirname(dbPath));
process.chdir(COPY_CWD);
const OUT = path.join(VERIFY_DIR, 'verify-r23-evidence-out.txt');
const lines: string[] = [];
const put = (s: string) => { lines.push(s); console.log(s); };
const J = (v: unknown) => JSON.stringify(v);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const { db } = await import('../src/db/index.ts');
  const { default: casesRouter } = await import('../src/routes/cases.ts');
  const { default: attachmentsRouter } = await import('../src/routes/attachments.ts');
  const { createSession } = await import('../src/services/auth.ts');

  const stamp = String(Date.now()).slice(-6);
  const empA = `TMPR23A${stamp}`;
  const empB = `TMPR23B${stamp}`;
  const mkUser = (emp: string, name: string, role: string) => {
    const info = db.prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(emp, name, role, '临时', bcrypt.hashSync('TmpR23@Test', 10));
    return { id: Number(info.lastInsertRowid), emp, token: createSession(Number(info.lastInsertRowid), emp) };
  };
  const A = mkUser(empA, '第23轮临时技术员A', 'technician');
  const B = mkUser(empB, '第23轮临时技术员B', 'technician');

  const app = express();
  app.use(express.json());
  app.use('/api', casesRouter);
  app.use('/api', attachmentsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api`;
  put(`BASE_URL=${base}`);
  put(`TEST_DB=${dbPath}`);
  put(`COPY_CWD=${COPY_CWD}`);
  put(`TMP_ACCOUNTS=${J([{ emp: A.emp, user_id: A.id }, { emp: B.emp, user_id: B.id }])}`);

  const req = async (url: string, token: string, init?: RequestInit) => {
    const full = base + url;
    const r = await fetch(full, { ...(init || {}), headers: { Authorization: `Bearer ${token}`, ...((init as any)?.headers || {}) } });
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* 二进制或非 JSON 保留原文 */ }
    put(`REQUEST_URL=${full}`);
    put(`RESPONSE_STATUS=${r.status}`);
    put(`RESPONSE_HEADERS=${J(Object.fromEntries(r.headers.entries()))}`);
    put(`RESPONSE_BODY=${J(body)}`);
    return { status: r.status, body: body as any, headers: r.headers };
  };

  try {
    put('===== A. LIKE 转义两条完整请求 =====');
    await req('/cases?q=%25&pageSize=100', A.token);
    await req('/cases?q=' + encodeURIComponent('_不显示_') + '&pageSize=100', A.token);
    await req('/cases?q=' + encodeURIComponent('不显示') + '&pageSize=100', A.token);

    put('===== B. 排序白名单非法值回落 =====');
    const evilSort = 'created_at); DROP TABLE cases; --';
    const evilOrder = 'asc; DROP TABLE cases; --';
    await req('/cases?sort=' + encodeURIComponent(evilSort) + '&order=' + encodeURIComponent(evilOrder) + '&pageSize=3', A.token);
    put(`CASES_AFTER_EVIL_SORT=${(db.prepare('SELECT count(*) c FROM cases').get() as any).c}`);

    put('===== C. 附件越权：A 上传 -> A 取图 / B 取图 =====');
    const fd = new FormData();
    fd.append('model', '验证机型R23');
    fd.append('symptom', '开机不显示');
    fd.append('solution', '更换电源模块');
    fd.append('attachments', new Blob([PNG], { type: 'image/png' }), 'proof.png');
    const up = await req('/cases/upload', A.token, { method: 'POST', body: fd });
    const caseId = up.body?.data?.id;
    put(`CREATED_CASE_ID=${caseId}`);
    const atts = db.prepare('SELECT id, relative_path, mime_type FROM case_attachments WHERE case_id = ?').all(caseId) as any[];
    put(`ATTACHMENT_ROWS=${J(atts)}`);
    const attId = atts[0]?.id;
    const absolute = path.join(COPY_CWD, 'uploads', atts[0]?.relative_path || '');
    put(`LANDED_FILE_PATH=${absolute}`);
    put(`LANDED_FILE_EXISTS=${fs.existsSync(absolute)}`);
    await req(`/attachments/${attId}/raw`, A.token);
    await req(`/attachments/${attId}/raw`, B.token);
    await req(`/cases/${caseId}`, B.token);

    put('===== D. 伪装 HTML 的 .jpg 上传 =====');
    const fdBad = new FormData();
    fdBad.append('model', '验证机型R23');
    fdBad.append('symptom', '伪装文件测试');
    fdBad.append('solution', '不应落库');
    fdBad.append('attachments', new Blob([Buffer.from('<html><script>alert(1)</script></html>')], { type: 'image/jpeg' }), 'fake.jpg');
    await req('/cases/upload', A.token, { method: 'POST', body: fdBad });
    put(`FAKE_CASES_IN_DB=${(db.prepare("SELECT count(*) c FROM cases WHERE symptom='伪装文件测试'").get() as any).c}`);
    put(`FAKE_FILES_ON_DISK=${J(fs.existsSync(absolute) ? [absolute] : [])}`);

    put('===== E. 上传->审核->鉴权取图 链路核查 =====');
    const caseRow = db.prepare('SELECT status, author, reviewer, reviewed_at FROM cases WHERE id = ?').get(caseId) as any;
    put(`CASE_AFTER_UPLOAD=${J(caseRow)}`);
    put(`NOTE=本轮只做到上传(pending) + 鉴权取图，未调用 approve 审核接口，链路断在“审核”环节`);

    put('===== F. 清理清单（等用户确认后再删） =====');
    put(`CLEANUP_TMP_ACCOUNTS=${J([A.emp, B.emp])}`);
    put(`CLEANUP_SESSION_TOKENS_COUNT=4（每账号创建会话时 1 条；A/B 各 1 条，具体 token 见 sessions 表按 emp_no 过滤）`);
    put(`CLEANUP_CASE_IDS=${J([caseId])}`);
    put(`CLEANUP_ATTACHMENT_IDS=${J([attId])}`);
    put(`CLEANUP_FILE_PATHS=${J([absolute])}`);
    put(`CLEANUP_COPY_DIR=${COPY_CWD}`);
    put(`CLEANUP_OUT_FILE=${OUT}`);
  } finally {
    server.close();
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
