/** 第 18 轮只读核对：移除迁移回填后，是否还有未回填的关联 ID 或残留「附件：」备注 */
import { openTestDb, VERIFY_DIR } from './verify-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';

const db = openTestDb();
const out = [];
const put = (s) => out.push(s);
put('NULL_MODEL_ID=' + db.prepare('SELECT COUNT(*) c FROM cases WHERE model_id IS NULL').get().c);
put('NULL_CUSTOMER_ID=' + db.prepare('SELECT COUNT(*) c FROM cases WHERE customer_id IS NULL').get().c);
put('NOTE_WITH_ATTACH_LINE=' + db.prepare("SELECT COUNT(*) c FROM cases WHERE note LIKE '%附件：%'").get().c);
put('SOURCE_MANUAL_AUTHOR_SYSTEM=' + db.prepare("SELECT COUNT(*) c FROM cases WHERE source = 'manual' AND author = '系统'").get().c);
put('SOURCE_MANUAL_WITH_BATCH=' + db.prepare("SELECT COUNT(*) c FROM cases WHERE source = 'manual' AND import_batch_no <> ''").get().c);
put('TESTCASE_DELETE_MATCHES=' + db.prepare("SELECT COUNT(*) c FROM cases WHERE symptom = '测试' AND author = '陈立群' AND note = '测试'").get().c);
put('MAX_TOKENS=' + JSON.stringify(db.prepare('SELECT name, max_tokens FROM llm_configs').all()));
db.close();
fs.writeFileSync(path.join(VERIFY_DIR, 'verify-r18-nullcheck-out.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));
