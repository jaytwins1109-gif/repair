/**
 * 第 17 轮：播种只在首次建库执行一次 + 老库/手删案例不复活验证。
 * 实际以后端真实入口 server/src/index.ts 启动 4 次（老库 2 次、全新空库 2 次），
 * 全部指向 VACUUM INTO 独立副本，cwd/备份隔离，不触碰开发库与用户已登录会话。
 * 用法：node server/verify/verify-r17-seed.mjs --db=<副本绝对路径>
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parseTestDbArg, VERIFY_DIR } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
const OUT = path.join(VERIFY_DIR, 'verify-r17-seed-out.txt');
const lines = [];
const put = (s) => {
  lines.push(s);
  console.log(s);
};

const SERVER_DIR = path.resolve(VERIFY_DIR, '..');
const CLI = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const ENTRY = path.join(SERVER_DIR, 'src', 'index.ts');
const BATCH = path.dirname(path.dirname(dbPath)); // .db/r17seed
const ISOLATED = path.join(BATCH, 'isolated-cwd');
const FRESH = path.join(BATCH, 'fresh', 'data', 'repair.db');
fs.mkdirSync(ISOLATED, { recursive: true });
fs.mkdirSync(path.dirname(FRESH), { recursive: true });

function readState(p) {
  const d = new Database(p, { readonly: true, fileMustExist: true });
  const cases = d.prepare('SELECT count(*) AS c FROM cases').get().c;
  const hasMeta = !!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_meta'").get();
  const marker = hasMeta
    ? d.prepare("SELECT value FROM app_meta WHERE key='initial_seed_v1'").get()?.value ?? null
    : null;
  d.close();
  return { cases, marker };
}

function stop(child) {
  try {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
}

function boot(target, port, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ENTRY], {
      cwd: ISOLATED,
      env: {
        ...process.env,
        REPAIR_VERIFY: '1',
        REPAIR_DB_PATH: target,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      stop(child);
      reject(new Error(`${label} 启动超时\n${out}\n${err}`));
    }, 25000);
    child.stdout.on('data', (b) => {
      out += b.toString();
      if (!done && out.includes('[repair-agent-server]')) {
        done = true;
        clearTimeout(timer);
        setTimeout(() => {
          stop(child);
          const seedLine = out.split(/\r?\n/).find((l) => l.startsWith('[seed]')) || '[seed] <缺失>';
          resolve({ seedLine, out, err });
        }, 250);
      }
    });
    child.stderr.on('data', (b) => {
      err += b.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      if (!done) {
        clearTimeout(timer);
        reject(new Error(`${label} 提前退出 code=${code}\n${out}\n${err}`));
      }
    });
  });
}

async function main() {
  put(`TEST_DB=${dbPath}`);
  put(`FRESH_DB=${FRESH}`);
  const s0 = readState(dbPath);
  put(`OLD_DB_AT_START cases=${s0.cases} marker=${s0.marker}`);

  // ===== 老库第 1 次启动：已有 33 条、无标记，应识别为 legacy-skip 且不补插 =====
  const b1 = await boot(dbPath, 30117, 'OLD#1');
  const s1 = readState(dbPath);
  put(`RESTART_OLD_1 ${b1.seedLine}`);
  put(`CASES_AFTER_OLD_RESTART_1=${s1.cases} MARKER=${s1.marker}`);

  // ===== 模拟用户手删一条案例（只在副本上），再启动第 2 次，验证不复活 =====
  const deleter = new Database(dbPath);
  const victim = deleter.prepare('SELECT id, model, customer FROM cases ORDER BY id DESC LIMIT 1').get();
  deleter.prepare('DELETE FROM cases WHERE id = ?').run(victim.id);
  const afterDelete = deleter.prepare('SELECT count(*) AS c FROM cases').get().c;
  deleter.close();
  put(`MANUAL_DELETE id=${victim.id} model=${victim.model} customer=${victim.customer} cases=${afterDelete}`);

  const b2 = await boot(dbPath, 30118, 'OLD#2');
  const s2 = readState(dbPath);
  put(`RESTART_OLD_2 ${b2.seedLine}`);
  put(`CASES_AFTER_OLD_RESTART_2=${s2.cases} MARKER=${s2.marker}`);
  put(`OLD_NO_RESURRECT=${s2.cases === afterDelete} (${afterDelete} -> ${s2.cases})`);

  // ===== 全新空库：首次启动应播种一次并落标记；第二次启动应跳过 =====
  if (fs.existsSync(FRESH)) fs.unlinkSync(FRESH);
  put(`FRESH_DB_EXISTS_BEFORE_BOOT=${fs.existsSync(FRESH)}`);
  const b3 = await boot(FRESH, 30119, 'FRESH#1');
  const s3 = readState(FRESH);
  put(`RESTART_FRESH_1 ${b3.seedLine}`);
  put(`CASES_AFTER_FRESH_RESTART_1=${s3.cases} MARKER=${s3.marker}`);

  const b4 = await boot(FRESH, 30120, 'FRESH#2');
  const s4 = readState(FRESH);
  put(`RESTART_FRESH_2 ${b4.seedLine}`);
  put(`CASES_AFTER_FRESH_RESTART_2=${s4.cases} MARKER=${s4.marker}`);
  put(`FRESH_NO_DUPLICATE_SEED=${s4.cases === s3.cases} (${s3.cases} -> ${s4.cases})`);
  put('RESTART_COUNT=4 (老库 2 次 + 全新空库 2 次，均为真实 server/src/index.ts 进程)');
}

void main()
  .catch((e) => {
    put(`ERROR=${e?.stack || e}`);
  })
  .finally(() => {
    fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  });
