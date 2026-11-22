/**
 * 第 18 轮：机型同族写法归并验证（全部在 VACUUM INTO 独立副本上）。
 * 用法：npx tsx server/verify/verify-r18-facets.ts --db=<副本绝对路径>
 * 只读开发库；TMP 账号与非归档案例只写入副本，测完整个副本目录删除。
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseTestDbArg, VERIFY_DIR, openTestDb } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
const OUT = path.join(VERIFY_DIR, 'verify-r18-facets-out.txt');
const lines: string[] = [];
const put = (s: string) => lines.push(s);
const J = (v: unknown) => JSON.stringify(v);

async function main() {
  const boot = await openTestDb();
  boot.close();
  const { db } = await import('../src/db/index.ts');
  const { default: casesRouter } = await import('../src/routes/cases.ts');
  const { createSession } = await import('../src/services/auth.ts');

  put(`TEST_DB=${dbPath}`);
  put(`CASES_AT_START=${(db.prepare('SELECT COUNT(*) AS c FROM cases').get() as any).c}`);

  const stamp = String(Date.now()).slice(-6);
  const engineerEmp = `TMPR18E${stamp}`;
  const technicianEmp = `TMPR18T${stamp}`;
  const mkUser = (emp: string, name: string, role: string) => {
    const info = db
      .prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(emp, name, role, '临时', bcrypt.hashSync('TmpR18@Test', 10));
    return { id: Number(info.lastInsertRowid), token: createSession(Number(info.lastInsertRowid), emp) };
  };
  const engineer = mkUser(engineerEmp, '第18轮临时工程师', 'engineer');
  const technician = mkUser(technicianEmp, '第18轮临时技术员', 'technician');
  put(`TMP_ACCOUNTS=${engineerEmp},${technicianEmp}`);

  const app = express();
  app.use(express.json());
  app.use('/api', casesRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as any).port;

  const call = async (url: string, token: string) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${url}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await r.json();
  };
  const qs = (o: Record<string, string>) =>
    new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '')).toString();
  const facets = (p: Record<string, string>, token = engineer.token) => call(`/cases/facets?${qs(p)}`, token);
  const list = (p: Record<string, string>, token = engineer.token) => call(`/cases?${qs(p)}`, token);
  const sum = (opts: { count: number }[]) => opts.reduce((s, o) => s + Number(o.count), 0);

  try {
    // ===== A. 纯开发库口径（33 条），华为下型号分面：同族写法应只剩一个选项 =====
    const fa: any = await facets({ customer: '华为' });
    const ma = fa.data.facets.model as any[];
    put('===== A. 纯开发库副本（33 条）· customer=华为 的型号分面 =====');
    put(`MODEL_FACETS_HUAWEI_BEFORE=${J(ma)}`);
    put(`SR650_FAMILY_OPTIONS=${J(ma.filter((o) => /SR650/i.test(o.value)))}`);
    put(`SR650_OPTION_COUNT=${ma.filter((o) => /SR650/i.test(o.value)).length}`);
    put(`SR650_FAMILY_COUNT=${ma.find((o) => /SR650/i.test(o.value))?.count ?? 0}`);
    put(`MODEL_SUM=${sum(ma)} HUAWEI_LIST_TOTAL=${(await list({ customer: '华为', pageSize: '1' })).data.total}`);

    // ===== B. 复现第 17 轮验证口径：造 3 条隐藏案例，其中 2 条是 华为 / SR650 =====
    const hidden = [
      { model: 'SR650', customer: '华为', symptom: '验证用：待审核供电异常', category: '供电类' },
      { model: 'SR650', customer: '华为', symptom: '验证用：已驳回接口异常', category: '' },
      { model: 'R740', customer: '中兴', symptom: '验证用：待审核散热异常', category: '散热类' },
    ];
    const statuses = ['pending', 'rejected', 'pending'];
    const ins = db.prepare(
      `INSERT INTO cases (model, customer, symptom, diagnosis, solution, parts, note, repaired_at,
        source, category, status, author) VALUES (?, ?, ?, '验证数据', '验证数据', '', '',
        '2026-11-22', 'manual', ?, ?, '验证用工程师')`
    );
    const ids: number[] = [];
    db.transaction(() => {
      hidden.forEach((h, i) => {
        const r = ins.run(h.model, h.customer, h.symptom, h.category, statuses[i]);
        ids.push(Number(r.lastInsertRowid));
      });
    })();
    put(`HIDDEN_CASE_IDS=${J(ids)} CASES_AFTER_TESTDATA=${(db.prepare('SELECT COUNT(*) AS c FROM cases').get() as any).c}`);

    const fb: any = await facets({ customer: '华为' });
    const mb = fb.data.facets.model as any[];
    const sr = mb.find((o) => /SR650/i.test(o.value));
    put('===== B. 与第 17 轮同口径副本（36 条）· customer=华为 的型号分面 =====');
    put(`MODEL_FACETS_HUAWEI_AFTER=${J(mb)}`);
    put(`SR650_FAMILY_OPTIONS=${J(mb.filter((o) => /SR650/i.test(o.value)))}`);
    put(`SR650_OPTION_COUNT=${mb.filter((o) => /SR650/i.test(o.value)).length}`);
    put(`SR650_FAMILY_COUNT=${sr?.count ?? 0} EXPECTED=9 NOT_SPLIT=${sr?.count === 9 && mb.filter((o) => /SR650/i.test(o.value)).length === 1}`);
    put(`MODEL_SUM=${sum(mb)} HUAWEI_LIST_TOTAL=${(await list({ customer: '华为', pageSize: '1' })).data.total}`);

    // ===== C. 查询不再漏数据：选任一同族写法都能查到全部 9 条 =====
    put('===== C. 同族写法任选其一，列表都不漏数据 =====');
    for (const model of ['SR650', '联想 SR650']) {
      const lr: any = await list({ customer: '华为', model, pageSize: '100' });
      const writings = Array.from(new Set((lr.data.list as any[]).map((c) => c.model))).sort();
      put(`MODEL_FILTER=${model} LIST_TOTAL=${lr.data.total} WRITINGS=${J(writings)}`);
      put(`  HAS_联想SR650_CASE=${(lr.data.list as any[]).some((c) => c.model === '联想 SR650')} HAS_SR650_CASE=${(lr.data.list as any[]).some((c) => c.model === 'SR650')}`);
    }
    const facetsAfterSelect: any = await facets({ customer: '华为', model: 'SR650' });
    put(`FACETS_WHEN_MODEL_SELECTED_SR650=${J(facetsAfterSelect.data.facets.model)}`);
    put(`SELF_EXCLUSION_KEEPS_OTHER_MODELS=${(facetsAfterSelect.data.facets.model as any[]).length > 1}`);

    // ===== D. 第 17 轮四项对数回归，确认归并没破坏原成果 =====
    const f0: any = await facets({});
    const l0: any = await list({ pageSize: '1' });
    put('===== D. 第 17 轮对数回归 =====');
    put(`CUSTOMER_SUM=${sum(f0.data.facets.customer)} LIST_TOTAL=${l0.data.total} EQUAL=${sum(f0.data.facets.customer) === l0.data.total}`);
    const f1: any = await facets({ customer: '华为' });
    const others = (f1.data.facets.customer as any[]).filter((o) => o.value !== '华为');
    put(`SELF_EXCLUSION_OTHER_CUSTOMERS=${others.length} NON_ZERO=${others.filter((o) => o.count > 0).length}`);
    const fe: any = await facets({}, engineer.token);
    const ft: any = await facets({}, technician.token);
    const le: any = await list({ pageSize: '1' }, engineer.token);
    const lt: any = await list({ pageSize: '1' }, technician.token);
    put(`ENGINEER_SUM=${sum(fe.data.facets.customer)} TECHNICIAN_SUM=${sum(ft.data.facets.customer)} DIFF=${sum(fe.data.facets.customer) - sum(ft.data.facets.customer)} HIDDEN=${ids.length}`);
    put(`ENGINEER_LIST=${le.data.total} TECHNICIAN_LIST=${lt.data.total}`);
    const fc: any = await facets({ customer: '华为', model: 'SR650' });
    const cats = fc.data.facets.category as any[];
    const cross: string[] = [];
    for (const c of cats) {
      const lr: any = await list({ customer: '华为', model: 'SR650', category: c.value, pageSize: '1' });
      cross.push(`${c.label}=facet:${c.count}/list:${lr.data.total}/${c.count === lr.data.total ? 'MATCH' : 'MISMATCH'}`);
    }
    const allHuaweiSr650: any = await list({ customer: '华为', model: 'SR650', pageSize: '1' });
    put(`CATEGORY_CROSSCHECK=${J(cross)}`);
    put(`CATEGORY_SUM=${sum(cats)} ALL_LIST_TOTAL=${allHuaweiSr650.data.total} MATCH=${sum(cats) === allHuaweiSr650.data.total}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const id of [engineer.id, technician.id]) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }
    put(`TMP_ACCOUNTS_CLEANED=${(db.prepare('SELECT COUNT(*) AS c FROM users WHERE emp_no LIKE ?').get('TMPR18%') as any).c}`);
    db.close();
    fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  }
  console.log(lines.join('\n'));
}

void main().catch((e) => {
  put(`ERROR=${e?.stack || e}`);
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.error(e);
  process.exit(1);
});
