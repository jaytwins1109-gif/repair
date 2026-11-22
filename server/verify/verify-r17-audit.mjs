/**
 * 第 17 轮只读审计：在 VACUUM INTO 独立副本上打印案例字段分布与待清理清单。
 * 只读，不写任何表。用法：node server/verify/verify-r17-audit.mjs --db=<副本绝对路径>
 */
import { openTestDb, parseTestDbArg } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
const db = openTestDb();
const lines = [];
const put = (s) => lines.push(s);

put(`TEST_DB=${dbPath}`);
const total = db.prepare('SELECT count(*) AS c FROM cases').get().c;
put(`CASES_TOTAL=${total}`);

const dims = ['model', 'customer', 'category', 'status', 'source', 'import_batch_no'];
for (const d of dims) {
  const rows = db.prepare(`SELECT ${d} AS v, count(*) AS c FROM cases GROUP BY ${d} ORDER BY c DESC, v`).all();
  put(`DIST_${d}=${JSON.stringify(rows)}`);
}

const clean = db
  .prepare('SELECT id, model, customer, symptom, source, import_batch_no FROM cases ORDER BY id')
  .all();
put('DELETE_CANDIDATES_BEGIN');
for (const r of clean) {
  put(`\t${r.id}\t${r.model}\t${r.customer}\t${r.symptom}\t${r.source}\t${r.import_batch_no}`);
}
put('DELETE_CANDIDATES_END');

console.log(lines.join('\n'));
db.close();
