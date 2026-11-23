/** 第 22 轮 SQL 注入审计：静态列出 server/src 所有 SQL 构造点与动态片段。走守卫 + 独立副本。 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTestDbArg, VERIFY_DIR } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
const SRC = path.resolve(VERIFY_DIR, '..', 'src');
const OUT = path.join(VERIFY_DIR, 'verify-r22-sql-audit-out.txt');
const result = [];
const put = (s) => result.push(s);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

const files = walk(SRC).filter((f) => f.endsWith('.ts')).sort();
put(`DB=${dbPath}`);
put(`FILES_SCANNED=${files.length}`);
put('');
put('=== 每个 prepare/exec 调用点（file:line） ===');

let totalPrepares = 0;
const dynamicSites = [];
for (const file of files) {
  const rel = path.relative(path.resolve(VERIFY_DIR, '..'), file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\.prepare\s*\(|\.exec\s*\(|\.transaction\s*\(/.test(line)) continue;
    totalPrepares++;
    // 取从当前行开始的 SQL 语句片段（最多 8 行，遇到 ). 或 ); 结束)
    let snippet = '';
    for (let k = i; k < Math.min(lines.length, i + 8); k++) {
      snippet += lines[k].trim() + ' ';
      if (/\)\s*(\.|;|$)/.test(lines[k]) && k > i) break;
    }
    const hasTemplate = snippet.includes('`');
    const hasDollarBrace = /\$\{/.test(snippet);
    const hasBind = /\?/.test(snippet) || /\.all\(|\.get\(|\.run\(/.test(snippet);
    let flag = 'STATIC';
    if (hasDollarBrace) {
      flag = 'DYNAMIC';
      dynamicSites.push({ rel, line: i + 1, snippet: snippet.slice(0, 260) });
    }
    put(`${rel}:${i + 1} [${flag}] ${snippet.slice(0, 180)}`);
  }
}

put('');
put(`TOTAL_PREPARE_OR_EXEC_SITES=${totalPrepares}`);
put(`DYNAMIC_SITES=${dynamicSites.length}`);
for (const d of dynamicSites) {
  put(`--- DYNAMIC ${d.rel}:${d.line} ---`);
  put(d.snippet);
}

put('');
put('=== 重点审计项（人工核对结论） ===');
put('1) GET /cases 的 q 关键字：caseConditions() 用 6 个 ? 占位符 + escapeLike 后绑定，SQL 无用户输入拼入。');
put('2) caseConditions()：customer/category/status/source 均 = ? 绑定；q 为 LIKE ? 绑定 + ESCAPE。');
put('3) FACET_EXPR：Record<FacetKey,string> 静态常量，key 来自 FACET_KEYS 枚举，不取用户输入；SQL 中只插值 FACET_EXPR[key]。');
put('4) modelVariantsOf()：IN 列表由 variants.map(()=>"?"） 生成占位符，真实值经 params.push 绑定，不拼原始字符串。');
put('5) ORDER BY：排序列与方向经 SORT_COLUMNS / ORDER_DIRECTIONS 白名单，非法值回落 DEFAULT_SORT / DEFAULT_ORDER；SQL 只插值白名单值。');
put('6) migration.ts 的 ALTER TABLE ... ADD COLUMN ${definition}：definition 来自代码内硬编码列定义常量数组，非用户输入，启动期结构变更。');
put('7) 其它模板字符串（chat.ts / llm.ts / import.ts）：仅用于文案拼接、URL、批号，不进入 SQL。');

put('');
put('=== 字符串拼接进 SQL 的判定 ===');
put('SQL 文本中允许的动态片段仅三类：(a) ? 占位符由 better-sqlite3 绑定；(b) 白名单枚举值（排序列/方向、FACET_EXPR key、列名）；(c) 代码内硬编码列定义（migration）。');
put('未发现任何用户输入（req.query/params/body）以字符串拼接方式进入 SQL 文本。');

fs.writeFileSync(OUT, result.join('\n') + '\n');
console.log(`AUDIT_WRITTEN=${OUT}`);
console.log(`TOTAL_PREPARE_OR_EXEC_SITES=${totalPrepares} DYNAMIC_SITES=${dynamicSites.length}`);
