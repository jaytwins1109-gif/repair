/** 只读核对开发库基线：真数据、附件、api_key 掩码、导入批次 */
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'data', 'repair.db'), { readonly: true, fileMustExist: true });
const one = (sql) => db.prepare(sql).get();
console.log('DEV_CASES=' + one('SELECT COUNT(*) c FROM cases').c);
console.log('DEV_CASE39=' + JSON.stringify(one('SELECT id,status,source,author FROM cases WHERE id=39')));
console.log('DEV_ATTACHMENTS=' + JSON.stringify(db.prepare('SELECT id,case_id,size FROM case_attachments').all()));
const k = one('SELECT api_key FROM llm_configs WHERE is_active=1').api_key;
console.log('DEV_KEY_MASK=' + k.slice(0, 4) + '****' + k.slice(-4) + ' KEY_LEN=' + k.length);
console.log('DEV_BATCHES=' + one('SELECT COUNT(*) c FROM import_batches').c);
console.log('DEV_BATCH_LIST=' + JSON.stringify(db.prepare('SELECT batch_no FROM import_batches ORDER BY id').all().map((r) => r.batch_no)));
db.close();
