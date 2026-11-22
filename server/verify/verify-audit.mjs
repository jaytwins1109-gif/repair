import fs from 'node:fs';
import path from 'node:path';
import { openTestDb, VERIFY_DIR } from './verify-guard.mjs';

// 用法：node server/verify/verify-audit.mjs --db=<副本绝对路径>
// 纯只读审计：只连 VACUUM INTO 出来的副本，不碰开发库。
const db = openTestDb();

const cols = [
  'id', 'model', 'customer', 'symptom', 'author', 'status',
  'created_at', 'updated_at', 'import_batch_no', 'source', 'repaired_at', 'category',
];
const cases = db.prepare(`SELECT ${cols.join(', ')} FROM cases ORDER BY id`).all();
const attachments = db
  .prepare('SELECT id, case_id, original_name, relative_path FROM case_attachments ORDER BY case_id, id')
  .all();
const cacheRows = db
  .prepare('SELECT query_norm, case_ids, path, hit_count FROM search_cache ORDER BY query_norm')
  .all();

const group = (key) => {
  const out = {};
  for (const r of cases) out[String(r[key] ?? '')] = (out[String(r[key] ?? '')] || 0) + 1;
  return out;
};

const report = {
  db_path: process.env.REPAIR_DB_PATH,
  total_cases: cases.length,
  group_by_source: group('source'),
  group_by_author: group('author'),
  group_by_status: group('status'),
  group_by_import_batch_no: group('import_batch_no'),
  cases,
  attachments,
  attachment_count: attachments.length,
  cache_rows: cacheRows,
  cache_count: cacheRows.length,
};

fs.writeFileSync(path.join(VERIFY_DIR, 'audit-out.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`AUDIT_OK cases=${cases.length} attachments=${attachments.length} cache=${cacheRows.length}`);
db.close();
