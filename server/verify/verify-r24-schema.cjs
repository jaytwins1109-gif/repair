const D = require('better-sqlite3');
const db = new D('server/data/repair.db', { readonly: true });
const sql = db.prepare("select sql from sqlite_master where type='table' and name='cases'").get().sql;
const sourceLine = sql.split('\n').find((l) => l.includes('source'));
console.log('CASES_SOURCE_LINE=' + sourceLine.trim());
console.log('ATT_COLS=' + JSON.stringify(db.prepare('pragma table_info(case_attachments)').all().map((c) => c.name)));
console.log('USERS_WX2001=' + JSON.stringify(db.prepare("select id,emp_no,name,role from users where emp_no='WX2001'").get()));
console.log('USERS_WX1001=' + JSON.stringify(db.prepare("select id,emp_no,name,role from users where emp_no='WX1001'").get()));
db.close();
