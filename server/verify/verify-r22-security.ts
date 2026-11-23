/**
 * 第 22 轮安全加固验证（全部在 VACUUM INTO 独立副本上，开发库零写入）。
 * 用法：npx tsx server/verify/verify-r22-security.ts --db=<副本绝对路径>
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseTestDbArg, VERIFY_DIR } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
// 上传服务用 process.cwd()/uploads 落盘：切到副本目录，确保测试图片不落到仓库根目录
const COPY_CWD = path.dirname(path.dirname(dbPath));
process.chdir(COPY_CWD);
const OUT = path.join(VERIFY_DIR, 'verify-r22-security-out.txt');
const lines: string[] = [];
const put = (s: string) => { lines.push(s); console.log(s); };
const J = (v: unknown) => JSON.stringify(v);

// 1x1 透明 PNG（真实文件头 89 50 4E 47...）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const boot = await import('../src/db/index.ts');
  const db = boot.db;
  const { default: casesRouter } = await import('../src/routes/cases.ts');
  const { default: attachmentsRouter } = await import('../src/routes/attachments.ts');
  const { createSession } = await import('../src/services/auth.ts');

  put(`TEST_DB=${dbPath}`);
  const baseCount = (db.prepare('SELECT count(*) AS c FROM cases').get() as any).c;
  put(`CASES_AT_START=${baseCount}`);

  const stamp = String(Date.now()).slice(-6);
  const empA = `TMPR22A${stamp}`;
  const empB = `TMPR22B${stamp}`;
  const mkUser = (emp: string, name: string, role: string) => {
    const info = db
      .prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(emp, name, role, '临时', bcrypt.hashSync('TmpR22@Test', 10));
    return { id: Number(info.lastInsertRowid), emp, token: createSession(Number(info.lastInsertRowid), emp) };
  };
  const A = mkUser(empA, '第22轮临时技术员A', 'technician');
  const B = mkUser(empB, '第22轮临时技术员B', 'technician');
  put(`TMP_ACCOUNTS=${empA},${empB}`);

  const app = express();
  app.use(express.json());
  app.use('/api', casesRouter);
  app.use('/api', attachmentsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api`;

  const jsonCall = async (url: string, token: string, init?: RequestInit) => {
    const r = await fetch(base + url, {
      ...(init || {}),
      headers: { Authorization: `Bearer ${token}`, ...((init as any)?.headers || {}) },
    });
    return { status: r.status, body: await r.json() as any };
  };

  try {
    // ===== 1. LIKE 通配符转义 =====
    put('===== 1. LIKE 通配符转义（案例列表 q） =====');
    const rawLike = (db.prepare("SELECT count(*) AS c FROM cases WHERE symptom LIKE '%\\%%'").get() as any).c;
    const rawUnder = (db.prepare("SELECT count(*) AS c FROM cases WHERE symptom LIKE '%\\_不显示\\_%' ESCAPE '\\'").get() as any).c;
    put(`RAW_SQL_NO_ESCAPE_PERCENT_MATCHES=${(db.prepare("SELECT count(*) AS c FROM cases WHERE symptom LIKE '%%%'").get() as any).c}`);
    put(`RAW_SQL_NO_ESCAPE_UNDERSCORE_MATCHES=${(db.prepare("SELECT count(*) AS c FROM cases WHERE symptom LIKE '%_不显示_%'").get() as any).c}`);
    const qPercent: any = await jsonCall('/cases?q=%25&pageSize=100', A.token); // q=%
    const qUnder: any = await jsonCall('/cases?q=' + encodeURIComponent('_不显示_') + '&pageSize=100', A.token);
    const qPlain: any = await jsonCall('/cases?q=' + encodeURIComponent('不显示') + '&pageSize=100', A.token);
    put(`Q_PERCENT total=${qPercent.body.data?.total} ids=${J(qPercent.body.data?.list?.map((x: any) => x.id))}`);
    put(`Q_UNDERSCORE_WRAPPED total=${qUnder.body.data?.total} ids=${J(qUnder.body.data?.list?.map((x: any) => x.id))}`);
    put(`Q_PLAIN_BUSHIXIANSHI total=${qPlain.body.data?.total} ids=${J(qPlain.body.data?.list?.slice(0, 8).map((x: any) => x.id))}`);
    put(`LIKE_ESCAPE_OK=${qPercent.body.data?.total === 0 && qUnder.body.data?.total === 0 && (qPlain.body.data?.total ?? 0) > 0}`);

    // ===== 2. 排序白名单回落 =====
    put('===== 2. ORDER BY 白名单 =====');
    const evilSort = 'created_at); DROP TABLE cases; --';
    const evil: any = await jsonCall('/cases?sort=' + encodeURIComponent(evilSort) + '&order=' + encodeURIComponent('asc; DROP TABLE cases; --') + '&pageSize=3', A.token);
    const after = (db.prepare('SELECT count(*) AS c FROM cases').get() as any).c;
    put(`EVIL_SORT_RESULT_CODE=${evil.body.code} total=${evil.body.data?.total} CASES_AFTER=${after}`);
    put(`SORT_WHITELIST_OK=${evil.body.code === 0 && after === baseCount}`);

    // ===== 3. 附件越权：A 提交带附件 pending 案例，B 取附件 =====
    put('===== 3. 附件越权（A 提交，B 直接取 raw） =====');
    const fd = new FormData();
    fd.append('model', '验证机型R22');
    fd.append('symptom', '开机不显示');
    fd.append('solution', '更换电源模块');
    fd.append('attachments', new Blob([PNG], { type: 'image/png' }), 'proof.png');
    const upRes = await fetch(base + '/cases/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${A.token}` }, body: fd,
    });
    const upJson: any = await upRes.json();
    put(`A_UPLOAD_CODE=${upJson.code} CASE_ID=${upJson.data?.id}`);
    const caseId = upJson.data?.id;
    const atts = db.prepare('SELECT id, mime_type, relative_path FROM case_attachments WHERE case_id = ?').all(caseId) as any[];
    put(`ATTACHMENTS=${J(atts)}`);
    const attId = atts[0]?.id;
    const rawA = await fetch(base + `/attachments/${attId}/raw`, { headers: { Authorization: `Bearer ${A.token}` } });
    const rawB = await fetch(base + `/attachments/${attId}/raw`, { headers: { Authorization: `Bearer ${B.token}` } });
    put(`A_RAW status=${rawA.status} content-type=${rawA.headers.get('content-type')} nosniff=${rawA.headers.get('x-content-type-options')}`);
    put(`B_RAW status=${rawB.status} body=${J(await rawB.json())}`);
    const caseB: any = await jsonCall(`/cases/${caseId}`, B.token);
    put(`B_GET_CASE code=${caseB.body.code} message=${J(caseB.body.message)}`);
    put(`ATTACHMENT_SCOPE_OK=${rawA.status === 200 && (rawB.status === 403 || rawB.status === 404) && (caseB.body.code === 403 || caseB.body.code === 404)}`);

    // ===== 4. 伪装扩展名上传 + 响应 MIME 不信任数据库 =====
    put('===== 4. 伪装 .jpg 的 HTML 上传 =====');
    const fdBad = new FormData();
    fdBad.append('model', '验证机型R22');
    fdBad.append('symptom', '伪装文件测试');
    fdBad.append('solution', '不应落库');
    fdBad.append('attachments', new Blob([Buffer.from('<html><script>alert(1)</script></html>')], { type: 'image/jpeg' }), 'fake.jpg');
    const badRes = await fetch(base + '/cases/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${A.token}` }, body: fdBad,
    });
    const badJson: any = await badRes.json();
    put(`FAKE_JPG_UPLOAD status=${badRes.status} code=${badJson.code} message=${J(badJson.message)}`);
    const orphan = db.prepare("SELECT count(*) AS c FROM cases WHERE symptom='伪装文件测试'").get() as any;
    put(`FAKE_JPG_CASES_IN_DB=${orphan.c}`);
    put(`MAGIC_BYTES_UPLOAD_OK=${badJson.code !== 0 && orphan.c === 0}`);

    // 篡改数据库 mime_type 为 text/html，响应仍应返回白名单图片类型
    db.prepare('UPDATE case_attachments SET mime_type = ? WHERE id = ?').run('text/html', attId);
    const rawTampered = await fetch(base + `/attachments/${attId}/raw`, { headers: { Authorization: `Bearer ${A.token}` } });
    put(`TAMPERED_DB_MIME text/html -> RESPONSE content-type=${rawTampered.headers.get('content-type')}`);
    await rawTampered.arrayBuffer();
    put(`RESPONSE_MIME_WHITELIST_OK=${rawTampered.headers.get('content-type') === 'image/png'}`);

    // ===== 5. dangerouslySetInnerHTML 静态搜索 & CSV 样例 =====
    put('===== 5. 渲染与导出注入 =====');
    const srcRoot = path.resolve(VERIFY_DIR, '..', '..', 'client', 'src');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    const hits = walk(srcRoot).filter((f) => /\.(tsx|ts|js|jsx)$/.test(f)).filter((f) => fs.readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'));
    put(`DANGEROUS_HTML_HITS=${J(hits)}`);
    const csvCell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const sample = [['行号', '失败原因'], ['1', '=1+1'], ['2', '@SUM(A1:A9)'], ['3', '-cmd|calc'], ['4', '+HYPERLINK("x")'], ['5', '普通文本']].map((r) => r.map(csvCell).join(',')).join('\r\n');
    put(`CSV_SAMPLE=${J(sample)}`);
    put(`CSV_SAMPLE_OK=${sample.includes('"\'=1+1"') && sample.includes('"\'@SUM(A1:A9)"') && sample.includes('"普通文本"')}`);
  } finally {
    server.close();
    // 精确清理本轮 TMP 账号与会话，不碰用户已有账号
    for (const u of [A, B]) {
      db.prepare('DELETE FROM sessions WHERE emp_no = ?').run(u.emp);
      db.prepare('DELETE FROM users WHERE emp_no = ?').run(u.emp);
    }
    put(`TMP_REMAINING=${(db.prepare("SELECT count(*) AS c FROM users WHERE emp_no LIKE 'TMPR22%'").get() as any).c}`);
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
