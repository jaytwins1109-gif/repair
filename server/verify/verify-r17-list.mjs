/**
 * 第 17 轮：原样输出待确认删除清单（只读，不删除任何行）。
 * 用法：node server/verify/verify-r17-list.mjs --db=<VACUUM INTO 副本绝对路径>
 */
import { openTestDb } from './verify-guard.mjs';

const db = openTestDb();
const rows = db
  .prepare('SELECT id, model, customer, symptom, source, import_batch_no FROM cases ORDER BY id')
  .all();
console.log(`CASES_TOTAL=${rows.length}`);
console.log('id | model | customer | symptom | source | import_batch_no');
for (const r of rows) {
  console.log(
    `${r.id} | ${r.model} | ${r.customer} | ${r.symptom} | ${r.source} | ${r.import_batch_no || '(空)'}`
  );
}
db.close();
