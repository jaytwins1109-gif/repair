/** 第 18 轮只读探查：机型别名词典、机型表、案例型号写法分布、配置基线 */
import { openTestDb, VERIFY_DIR } from './verify-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';

const db = openTestDb();
const out = [];
const put = (s) => out.push(s);

put('MODEL_ALIAS_ROWS=' + JSON.stringify(db.prepare('SELECT canonical, alias FROM model_alias ORDER BY id').all()));
put('MODELS_ROWS=' + JSON.stringify(db.prepare('SELECT id, brand, model FROM models ORDER BY id').all()));
put('CASE_MODELS=' + JSON.stringify(db.prepare('SELECT model, COUNT(*) c FROM cases GROUP BY model ORDER BY c DESC').all()));
put('HUAWEI_MODELS=' + JSON.stringify(db.prepare("SELECT model, COUNT(*) c FROM cases WHERE customer = '华为' GROUP BY model ORDER BY c DESC").all()));
put('LLM_CONFIGS=' + JSON.stringify(db.prepare('SELECT id, name, model, api_key, max_tokens, is_active FROM llm_configs').all().map((r) => ({ ...r, api_key: `***len=${String(r.api_key).length}` }))));
put('SETTINGS=' + JSON.stringify(db.prepare("SELECT key, value FROM settings WHERE key IN ('engineer_auto_approve','llm_enabled','llm_daily_limit','match_threshold') ORDER BY key").all()));
put('CASES_TOTAL=' + db.prepare('SELECT COUNT(*) c FROM cases').get().c);
put('SYMPTOM_DICT=' + db.prepare('SELECT COUNT(*) c FROM symptom_dict').get().c);
put('MODEL_ALIAS_COUNT=' + db.prepare('SELECT COUNT(*) c FROM model_alias').get().c);
put('TESTCASE_ROWS=' + JSON.stringify(db.prepare("SELECT id, symptom, author, note FROM cases WHERE symptom = '测试'").all()));

db.close();
fs.writeFileSync(path.join(VERIFY_DIR, 'verify-r18-probe-out.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));
