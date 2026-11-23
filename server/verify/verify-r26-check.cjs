const D = require('better-sqlite3');
const db = new D('server/data/repair.db', { readonly: true });
console.log('AUDIT_TABLE=' + JSON.stringify(db.prepare("select name from sqlite_master where type='table' and name='audit_logs'").get()));
const cols = db.prepare("pragma table_info(audit_logs)").all();
console.log('AUDIT_COLS=' + JSON.stringify(cols.map((c) => c.name + ':' + c.type)));
console.log('AUDIT_ROWS=' + db.prepare('select count(*) c from audit_logs').get().c);
console.log('CASES=' + db.prepare('select count(*) c from cases').get().c);
console.log('CASE39=' + JSON.stringify(db.prepare('select id,status,source from cases where id=39').get()));
db.close();
