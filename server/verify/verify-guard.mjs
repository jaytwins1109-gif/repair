import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 临时验证脚本的统一入口守卫（第 16 轮新增）。
 *
 * 硬约束（不靠文字规矩，代码里强制）：
 * 1. 脚本必须放在固定目录 server/verify/ 下；
 * 2. 文件名必须以 verify- 开头；
 * 3. 必须显式传入 --db=<独立测试库副本绝对路径>（或 --db <路径>）；
 * 4. 拿不到参数、参数指向开发库、参数不在副本目录下，一律打印错误并 process.exit(1)，
 *    绝不回落到默认数据库路径 data/repair.db；
 * 5. 副本必须由 VACUUM INTO 从开发库只读生成，测完整个副本目录删掉。
 */

export const VERIFY_DIR = path.dirname(fileURLToPath(import.meta.url));
export const VERIFY_PREFIX = 'verify-';
const SERVER_DIR = path.resolve(VERIFY_DIR, '..');
export const DEV_DB = path.join(SERVER_DIR, 'data', 'repair.db');
export const COPY_ROOT = path.join(VERIFY_DIR, '.db');

function die(message) {
  console.error(`[verify-guard] ${message}`);
  process.exit(1);
}

export function parseTestDbArg(argv = process.argv.slice(2), options = {}) {
  const mustExist = options.mustExist !== false;

  const scriptPath = path.resolve(process.argv[1] || '');
  if (path.dirname(scriptPath) !== path.resolve(VERIFY_DIR)) {
    die(`临时验证脚本必须放在固定目录 ${VERIFY_DIR}；当前 ${scriptPath}`);
  }
  if (!path.basename(scriptPath).startsWith(VERIFY_PREFIX)) {
    die(`临时验证脚本文件名必须以 "${VERIFY_PREFIX}" 开头；当前 ${path.basename(scriptPath)}`);
  }

  let raw = '';
  const eq = argv.find((a) => a.startsWith('--db='));
  if (eq) raw = eq.slice('--db='.length);
  else {
    const i = argv.indexOf('--db');
    if (i >= 0) raw = String(argv[i + 1] || '');
  }
  if (!raw.trim()) {
    die('必须显式传入 --db=<VACUUM INTO 独立测试库副本路径>；禁止回落到默认数据库路径 data/repair.db');
  }

  const dbPath = path.resolve(raw.trim());
  if (!path.isAbsolute(dbPath)) die(`--db 必须是绝对路径：${dbPath}`);
  // Windows 盘符大小写不统一（D: / d:），统一成小写正斜杠再比较
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  if (norm(dbPath) === norm(DEV_DB)) die('禁止把开发库 server/data/repair.db 当作测试库');
  if (!norm(dbPath).startsWith(norm(COPY_ROOT) + '/')) {
    die(`测试库必须位于副本目录 ${COPY_ROOT} 下（由 verify-copy.mjs 生成）`);
  }
  if (mustExist && !fs.existsSync(dbPath)) {
    die(`测试库副本不存在：${dbPath}；请先运行 verify-copy.mjs`);
  }

  process.env.REPAIR_VERIFY = '1';
  process.env.REPAIR_DB_PATH = dbPath;
  return dbPath;
}

/** 打开独立测试库副本（可写，但只可能是副本） */
export function openTestDb(argv = process.argv.slice(2)) {
  const dbPath = parseTestDbArg(argv);
  return new Database(dbPath);
}

/** 用 VACUUM INTO 从开发库生成一致性副本；源库只读，不写入任何行 */
export function createTestDbCopy(argv = process.argv.slice(2)) {
  const dest = parseTestDbArg(argv, { mustExist: false });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  const src = new Database(DEV_DB, { readonly: true, fileMustExist: true });
  try {
    src.exec(`VACUUM INTO '${dest.replace(/\\/g, '/')}'`);
  } finally {
    src.close();
  }
  return dest;
}
