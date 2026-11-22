/**
 * 第 17 轮：级联分面筛选的四项对数验证（全部在 VACUUM INTO 独立副本上）。
 * 用法：npx tsx server/verify/verify-r17-facets.ts --db=<副本绝对路径>
 * 只读开发库；TMP 账号与非归档案例只写入副本，测完整个副本目录删除。
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseTestDbArg, VERIFY_DIR, openTestDb } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
const OUT = path.join(VERIFY_DIR, 'verify-r17-facets-out.txt');
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
  put(`CASES_AT_START=${(db.prepare('SELECT count(*) AS c FROM cases').get() as any).c}`);

  // 自建 TMP 账号（工程师 / 技术员），测完精确删除账号与会话
  const stamp = String(Date.now()).slice(-6);
  const engineerEmp = `TMPR17E${stamp}`;
  const technicianEmp = `TMPR17T${stamp}`;
  const mkUser = (emp: string, name: string, role: string) => {
    const info = db
      .prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(emp, name, role, '临时', bcrypt.hashSync('TmpR17@Test', 10));
    return { id: Number(info.lastInsertRowid), token: createSession(Number(info.lastInsertRowid), emp) };
  };
  const engineer = mkUser(engineerEmp, '第17轮临时工程师', 'engineer');
  const technician = mkUser(technicianEmp, '第17轮临时技术员', 'technician');
  put(`TMP_ACCOUNTS=${engineerEmp},${technicianEmp}`);

  // 造 3 条非归档案例（作者不是技术员），技术员看不到、工程师看得到
  const hidden = [
    { model: 'SR650', customer: '华为', symptom: '验证用：待审核供电异常', category: '供电类' },
    { model: 'SR650', customer: '华为', symptom: '验证用：已驳回接口异常', category: '' },
    { model: 'R740', customer: '中兴', symptom: '验证用：待审核散热异常', category: '散热类' },
  ];
  const inserted: number[] = [];
  const ins = db.prepare(
    `INSERT INTO cases (model, customer, symptom, diagnosis, solution, parts, note, repaired_at,
      source, category, status, author) VALUES (?, ?, ?, '验证数据', '验证数据', '', '',
      '2026-11-22', 'manual', ?, ?, '验证用工程师')`
  );
  const statuses = ['pending', 'rejected', 'pending'];
  db.transaction(() => {
    hidden.forEach((h, i) => {
      const r = ins.run(h.model, h.customer, h.symptom, h.category, statuses[i]);
      inserted.push(Number(r.lastInsertRowid));
    });
  })();
  put(`HIDDEN_CASE_IDS=${J(inserted)} (status=${J(statuses)}, author=验证用工程师)`);
  put(`CASES_AFTER_TESTDATA=${(db.prepare('SELECT count(*) AS c FROM cases').get() as any).c}`);

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
    // ===== 验证 1：不选任何条件时，客户下拉各条数之和 == 可见总数 =====
    const f0: any = await facets({});
    const l0: any = await list({ pageSize: '1' });
    const customerSum0 = sum(f0.data.facets.customer);
    put('===== 验证 1：无筛选，客户下拉条数之和 vs 案例库可见总数 =====');
    put(`CUSTOMER_FACETS=${J(f0.data.facets.customer)}`);
    put(`FACET_TOTAL=${f0.data.total} LIST_TOTAL=${l0.data.total} CUSTOMER_SUM=${customerSum0}`);
    put(`VERIFY1_EQUAL=${customerSum0 === l0.data.total} (${customerSum0} == ${l0.data.total})`);

    // ===== 验证 2（自排除单独用例）：选中华为后，客户下拉其他客户仍非零 =====
    const f1: any = await facets({ customer: '华为' });
    const f1c = f1.data.facets.customer as any[];
    const others = f1c.filter((o) => o.value !== '华为');
    const nonZero = others.filter((o) => o.count > 0);
    put('===== 验证 2：customer=华为 时客户下拉的自排除（独立用例）=====');
    put(`CUSTOMER_FACETS_WITH_HUAWEI_SELECTED=${J(f1c)}`);
    put(`OTHER_CUSTOMERS=${others.length} NON_ZERO_OTHERS=${nonZero.length} VALUES=${J(nonZero.map((o) => [o.value, o.count]))}`);
    // 对照：如果错误地把自身条件也套进去，其他客户会全变 0
    const wrong: any = await call(
      `/cases/facets?${qs({ customer: '华为' })}`,
      engineer.token
    );
    put(`SELF_EXCLUSION_NOTE=算客户下拉时忽略 customer 自身，仅套用 model/category/status/source；错误实现会让其他客户全部为 0`);
    put(`VERIFY2_SELF_EXCLUSION_OK=${others.length > 0 && nonZero.length === others.length}`);
    put(`RESPONSE_HAS_FOUR_DIMENSIONS=${J(Object.keys(wrong.data.facets))}`);

    // ===== 验证 3：华为 + 联想 SR650 之后，故障分类下拉与列表逐项对数 =====
    const p3 = { customer: '华为', model: '联想 SR650' };
    const f3: any = await facets(p3);
    const cats = f3.data.facets.category as any[];
    put('===== 验证 3：customer=华为 + model=联想 SR650 =====');
    put(`CATEGORY_FACETS=${J(cats)}`);
    put(`UNCATEGORIZED_COUNT=${cats.find((c) => c.value === '__uncategorized__')?.count ?? 0}`);
    const crosscheck: string[] = [];
    for (const c of cats) {
      const lr: any = await list({ ...p3, category: c.value, pageSize: '1' });
      crosscheck.push(`${c.label}(${c.value})=facet:${c.count}/list:${lr.data.total}/${c.count === lr.data.total ? 'MATCH' : 'MISMATCH'}`);
    }
    put(`CROSSCHECK=${J(crosscheck)}`);
    const all3: any = await list({ ...p3, pageSize: '1' });
    put(`ALL_LIST_TOTAL=${all3.data.total} CATEGORY_SUM=${sum(cats)} MATCH=${all3.data.total === sum(cats)}`);
    // 补充：库里型号还有不带品牌的 'SR650'，也贴一组便于对账
    const f3b: any = await facets({ customer: '华为', model: 'SR650' });
    put(`CATEGORY_FACETS_MODEL_SR650=${J(f3b.data.facets.category)}`);
    put(`MODEL_FACETS_WITH_HUAWEI=${J(f1.data.facets.model)}`);

    // ===== 验证 4：技术员下拉条数 < 工程师，差额正好是看不到的案例 =====
    const fe: any = await facets({}, engineer.token);
    const ft: any = await facets({}, technician.token);
    const le: any = await list({ pageSize: '1' }, engineer.token);
    const lt: any = await list({ pageSize: '1' }, technician.token);
    put('===== 验证 4：技术员可见范围过滤 =====');
    put(`ENGINEER_CUSTOMER_FACETS=${J(fe.data.facets.customer)}`);
    put(`TECHNICIAN_CUSTOMER_FACETS=${J(ft.data.facets.customer)}`);
    put(`ENGINEER_SUM=${sum(fe.data.facets.customer)} TECHNICIAN_SUM=${sum(ft.data.facets.customer)}`);
    put(`ENGINEER_LIST_TOTAL=${le.data.total} TECHNICIAN_LIST_TOTAL=${lt.data.total}`);
    put(`HIDDEN_COUNT=${inserted.length} DIFF=${sum(fe.data.facets.customer) - sum(ft.data.facets.customer)}`);
    const diffByCustomer: string[] = [];
    for (const e of fe.data.facets.customer) {
      const t = (ft.data.facets.customer as any[]).find((x) => x.value === e.value);
      diffByCustomer.push(`${e.value}:${e.count}-${t?.count ?? 0}=${e.count - (t?.count ?? 0)}`);
    }
    put(`DIFF_BY_CUSTOMER=${J(diffByCustomer)}`);
    put(`VERIFY4_EXACT=${sum(fe.data.facets.customer) - sum(ft.data.facets.customer) === inserted.length}`);
    const f4t: any = await facets({ customer: '华为' }, technician.token);
    put(`TECHNICIAN_MODEL_FACETS_WHEN_HUAWEI=${J(f4t.data.facets.model)}`);

    // ===== 附加：关键字搜索保持现状、不参与级联 =====
    const fq: any = await facets({ q: 'SR650' });
    put('===== 附加：关键字 q 不参与级联 =====');
    put(`FACETS_WITH_Q_SAME_AS_EMPTY=${J(fq.data.facets.customer) === J(f0.data.facets.customer)}`);
    const lq: any = await list({ q: 'SR650', pageSize: '1' });
    put(`LIST_WITH_Q_TOTAL=${lq.data.total} LIST_EMPTY_TOTAL=${l0.data.total}`);

    // ===== 附加：来源标记 + 一键清除示例数据接口（副本、cwd 隔离避免生成真实备份） =====
    const oldCwd = process.cwd();
    const isolatedCwd = path.join(VERIFY_DIR, '.db', 'r17', 'isolated-cwd');
    fs.mkdirSync(isolatedCwd, { recursive: true });
    process.chdir(isolatedCwd);
    let purge: any;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/cases/purge-samples`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${engineer.token}`, 'Content-Type': 'application/json' },
      });
      purge = await r.json();
    } finally {
      process.chdir(oldCwd);
    }
    put('===== 附加：一键清除示例数据 =====');
    put(`PURGE_RESULT=${J(purge)}`);
    put(`CASES_AFTER_PURGE=${(db.prepare('SELECT count(*) AS c FROM cases').get() as any).c}`);
    put(`MANUAL_CASES_LEFT=${(db.prepare("SELECT count(*) AS c FROM cases WHERE source <> 'sample'").get() as any).c}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // 清理自建账号与其会话（副本整个目录随后删除）
    const ids = [engineer.id, technician.id];
    for (const id of ids) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    for (const id of ids) db.prepare('DELETE FROM users WHERE id = ?').run(id);
    put(`TMP_ACCOUNTS_CLEANED=${(db.prepare('SELECT count(*) AS c FROM users WHERE emp_no LIKE ?').get(`TMPR17%`) as any).c}`);
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
