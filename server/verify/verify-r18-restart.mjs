/**
 * 第 18 轮：migration 收敛为纯结构变更后，实际重启一次真实后端并只读核对配置数据。
 * 用法：node server/verify/verify-r18-restart.mjs --db=<VACUUM INTO 副本绝对路径>
 * 开发库零写入；副本测完整个目录删除。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { parseTestDbArg, VERIFY_DIR } from './verify-guard.mjs';

const dbPath = parseTestDbArg();
const OUT = path.join(VERIFY_DIR, 'verify-r18-restart-out.txt');
const lines = [];
const put = (s) => {
  lines.push(s);
  console.log(s);
};

const SERVER_DIR = path.resolve(VERIFY_DIR, '..');
const CLI = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const ENTRY = path.join(SERVER_DIR, 'src', 'index.ts');
const BATCH = path.dirname(path.dirname(dbPath));
const ISOLATED = path.join(BATCH, 'isolated-cwd');
fs.mkdirSync(ISOLATED, { recursive: true });

/** 只读快照：配置表 + 业务总数；api_key 只输出掩码、长度与哈希指纹，绝不输出明文 */
function snapshot(p) {
  const d = new Database(p, { readonly: true, fileMustExist: true });
  const configs = d
    .prepare('SELECT id, name, model, api_key, max_tokens, is_active FROM llm_configs ORDER BY id')
    .all();
  const key = String(configs[0]?.api_key ?? '');
  const snapshot = {
    llm_config_rows: configs.length,
    model: configs[0]?.model ?? null,
    max_tokens: configs[0]?.max_tokens ?? null,
    is_active: configs[0]?.is_active ?? null,
    api_key_mask: key ? `${key.slice(0, 2)}****${key.slice(-2)}` : '(空)',
    api_key_length: key.length,
    api_key_sha256_8: key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) : '-',
    settings: d
      .prepare("SELECT key, value FROM settings WHERE key IN ('engineer_auto_approve','llm_enabled','llm_daily_limit','match_threshold') ORDER BY key")
      .all(),
    cases_total: d.prepare('SELECT COUNT(*) AS c FROM cases').get().c,
    symptom_dict_rows: d.prepare('SELECT COUNT(*) AS c FROM symptom_dict').get().c,
    model_alias_rows: d.prepare('SELECT COUNT(*) AS c FROM model_alias').get().c,
  };
  d.close();
  return snapshot;
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

function boot(target, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ENTRY], {
      cwd: ISOLATED,
      env: { ...process.env, REPAIR_VERIFY: '1', REPAIR_DB_PATH: target, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      stop(child);
      reject(new Error(`启动超时\n${out}\n${err}`));
    }, 25000);
    child.stdout.on('data', (b) => {
      out += b.toString();
      if (!done && out.includes('[repair-agent-server]')) {
        done = true;
        clearTimeout(timer);
        setTimeout(() => {
          stop(child);
          resolve(out);
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
        reject(new Error(`提前退出 code=${code}\n${out}\n${err}`));
      }
    });
  });
}

/** 静态检查：migration.ts 里不得再有任何 db.prepare 的写语句 */
function migrationWrites() {
  const src = fs.readFileSync(path.join(SERVER_DIR, 'src', 'services', 'migration.ts'), 'utf8');
  return (src.match(/\.prepare\(\s*['"`]\s*(INSERT|UPDATE|DELETE|REPLACE)\b/gi) || []).length;
}

void (async () => {
  put(`TEST_DB=${dbPath}`);
  put(`MIGRATION_DATA_WRITE_STATEMENTS=${migrationWrites()}`);

  const before = snapshot(dbPath);
  put('SNAPSHOT_BEFORE=' + JSON.stringify(before));

  const out = await boot(dbPath, 30121);
  for (const tag of ['[migration]', '[seed]', '[backup]', '[repair-agent-server]']) {
    const line = out.split(/\r?\n/).find((l) => l.startsWith(tag));
    put(`BOOT_LOG_${tag}=${line || '<缺失>'}`);
  }

  const after = snapshot(dbPath);
  put('SNAPSHOT_AFTER=' + JSON.stringify(after));
  put('CONFIG_UNCHANGED=' + (JSON.stringify(before) === JSON.stringify(after)));
  put('RESTART_COUNT=1 (真实 server/src/index.ts 进程，独立副本，未触碰用户 3001 服务)');
})()
  .catch((e) => put(`ERROR=${e?.stack || e}`))
  .finally(() => fs.writeFileSync(OUT, lines.join('\n'), 'utf8'));
