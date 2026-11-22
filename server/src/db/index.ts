import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { runMigrations, type MigrationReport } from './../services/migration';
import { runSeedAll, type SeedReport } from './../services/seedData';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * 临时验证脚本隔离（第 16 轮）：凡 server/verify/verify-* 脚本，或显式置了
 * REPAIR_VERIFY=1 的进程，必须由 verify-guard.mjs 传入独立测试库副本路径。
 * 缺参数或路径不在副本目录下直接抛错，绝不回落到开发库 data/repair.db。
 * 正常服务启动（src/index.ts）不受影响。
 */
const entryScript = String(process.argv[1] || '').replace(/\\/g, '/');
const isVerifyScript = /\/verify\/verify-[^/]+$/.test(entryScript);
const verifyMode = process.env.REPAIR_VERIFY === '1' || isVerifyScript;
const explicitDbPath = String(process.env.REPAIR_DB_PATH || '').trim();
if (verifyMode && !explicitDbPath) {
  throw new Error('验证脚本必须显式提供测试库副本路径（--db / REPAIR_DB_PATH）；禁止连接开发库 data/repair.db');
}
const dbPath = explicitDbPath ? path.resolve(explicitDbPath) : path.join(dataDir, 'repair.db');
if (verifyMode && !dbPath.replace(/\\/g, '/').includes('/verify/.db/')) {
  throw new Error('测试库必须位于 server/verify/.db/ 独立副本目录下，禁止指向开发库');
}

/**
 * 第 17 轮：播种只在「首次建库」时执行一次，并往 app_meta 落一个标记。
 * 判断依据是打开数据库之前文件是否存在 + 标记是否存在；之后任何进程重启
 * 都不会再执行 seed()/runSeedAll()，用户删掉的示例数据或录错的案例不会复活。
 */
const dbFileExistedBeforeOpen = fs.existsSync(dbPath);
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_no        TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,
    position      TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    emp_no      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  /* 第 17 轮：记录「首次建库播种已完成」，防止每次重启重复播种 */
  CREATE TABLE IF NOT EXISTS app_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS case_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id       INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size          INTEGER NOT NULL,
    uploader      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_case ON case_attachments(case_id);

  CREATE TABLE IF NOT EXISTS import_batches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_no        TEXT NOT NULL UNIQUE,
    operator        TEXT NOT NULL,
    operator_emp_no TEXT NOT NULL,
    direct_approve  INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    success         INTEGER NOT NULL DEFAULT 0,
    skipped         INTEGER NOT NULL DEFAULT 0,
    failed          INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS llm_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    platform    TEXT NOT NULL DEFAULT 'deepseek',
    base_url    TEXT NOT NULL DEFAULT '',
    api_key     TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL DEFAULT '',
    temperature REAL NOT NULL DEFAULT 0.2,
    max_tokens  INTEGER NOT NULL DEFAULT 1024,
    timeout_seconds INTEGER NOT NULL DEFAULT 20,
    thinking_enabled INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS llm_calls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id       INTEGER,
    platform        TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL DEFAULT 'extract',
    success         INTEGER NOT NULL DEFAULT 0,
    error           TEXT NOT NULL DEFAULT '',
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    prompt_chars    INTEGER NOT NULL DEFAULT 0,
    completion_chars INTEGER NOT NULL DEFAULT 0,
    prompt_cache_hit_tokens  INTEGER NOT NULL DEFAULT 0,
    prompt_cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
    user_emp_no     TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at);

  CREATE TABLE IF NOT EXISTS search_cache (
    query_norm   TEXT PRIMARY KEY,
    case_ids     TEXT NOT NULL DEFAULT '[]',
    path         TEXT NOT NULL DEFAULT 'rule',
    hit_count    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    last_hit_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS symptom_dict (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    standard    TEXT NOT NULL UNIQUE,
    aliases     TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS model_alias (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical   TEXT NOT NULL,
    alias       TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS models (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    brand       TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL,
    platform    TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    contact     TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS cases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    model       TEXT NOT NULL,
    customer    TEXT NOT NULL DEFAULT '',
    symptom     TEXT NOT NULL,
    diagnosis   TEXT NOT NULL DEFAULT '',
    solution    TEXT NOT NULL,
    parts       TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    repaired_at TEXT,
    source      TEXT NOT NULL DEFAULT 'manual',
    status      TEXT NOT NULL DEFAULT 'pending',
    author      TEXT NOT NULL DEFAULT '系统',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    emp_no      TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '新会话',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(emp_no, updated_at DESC);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    meta_json   TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
`);

const SEED_USERS: [string, string, UserRole, string][] = [
  ['WX1001', '陈立群', 'engineer', '硬件维修工程师'],
  ['WX1002', '韩志远', 'engineer', '硬件维修工程师'],
  ['WX2001', '李文博', 'technician', '主板维修技术员'],
  ['WX2002', '赵鹏程', 'technician', '主板维修技术员'],
  ['WX2003', '周天成', 'technician', '主板维修技术员'],
  ['WX2004', '吴嘉豪', 'technician', '主板维修技术员'],
  ['WX2005', '郑晓帆', 'technician', '主板维修技术员'],
  ['WX2006', '孙铭泽', 'technician', '主板维修技术员'],
  ['WX2007', '马海涛', 'technician', '主板维修技术员'],
  ['WX2008', '徐若涵', 'technician', '主板维修技术员'],
];

function seedUsers() {
  const exists = db.prepare('SELECT 1 FROM users WHERE emp_no = ?');
  const insert = db.prepare(
    'INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)'
  );
  const passwordHash = bcrypt.hashSync('Test@1234', 10);
  db.transaction(() => {
    for (const [empNo, name, role, position] of SEED_USERS) {
      if (exists.get(empNo)) continue;
      insert.run(empNo, name, role, position, passwordHash);
    }
  })();
}

function seed() {
  seedUsers();

  const modelCount = (db.prepare('SELECT COUNT(*) AS c FROM models').get() as { c: number }).c;
  if (modelCount === 0) {
    const stmt = db.prepare(
      'INSERT INTO models (brand, model, platform, note) VALUES (?, ?, ?, ?)'
    );
    const rows: [string, string, string, string][] = [
      ['联想', 'SR650', 'Intel Purley 二代', '2U 双路主流机型'],
      ['联想', 'SR850', 'Intel Purley 二代', '4 路高端机型'],
      ['戴尔', 'R740', 'Intel Purley', '2U 双路'],
      ['惠普', 'DL380 Gen10', 'Intel Purley', '2U 双路'],
      ['浪潮', 'NF5280M5', 'Intel Purley', '2U 双路'],
    ];
    db.transaction(() => rows.forEach((r) => stmt.run(...r)))();
  }

  const customerCount = (db.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;
  if (customerCount === 0) {
    const stmt = db.prepare(
      'INSERT INTO customers (name, contact, note) VALUES (?, ?, ?)'
    );
    const rows: [string, string, string][] = [
      ['华为', '张工 138****0001', '企业客户，季度巡检'],
      ['中兴', '李工 139****0002', '企业客户'],
      ['中国移动', '王工 137****0003', '运营商客户'],
    ];
    db.transaction(() => rows.forEach((r) => stmt.run(...r)))();
  }

  const caseCount = (db.prepare('SELECT COUNT(*) AS c FROM cases').get() as { c: number }).c;
  if (caseCount === 0) {
    const stmt = db.prepare(`
      INSERT INTO cases (model, customer, symptom, diagnosis, solution, parts, note, status, author)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const rows: [string, string, string, string, string, string, string, string, string][] = [
      [
        '联想 SR650',
        '华为',
        '开机无显示，风扇满转',
        '电源模块 12V 输出异常，单路电源老化导致供电不足，主板自检无法通过',
        '更换故障电源模块，复测 12V / 5V 输出正常后开机验证，连续烤机 4 小时无异常',
        '电源模块',
        '风扇全速但无画面时优先排查供电，不要先换内存',
        'approved',
        '系统',
      ],
      [
        '联想 SR650',
        '华为',
        '开机无显示，前面板指示灯常亮',
        '内存条金手指氧化导致接触不良，内存训练失败',
        '重新插拔内存并用橡皮清洁金手指，更换插槽后恢复正常',
        '内存',
        '与电源故障现象接近，注意通过指示灯状态区分',
        'approved',
        '系统',
      ],
      [
        '戴尔 R740',
        '中兴',
        '开机无显示，风扇满转',
        '电源转换电路故障，CPU 供电 MOS 管击穿，导致主板供电异常',
        '更换主板后开机正常，旧板返修',
        '主板',
        '现象与电源模块故障相似，需测量供电电压区分',
        'approved',
        '系统',
      ],
    ];
    db.transaction(() => rows.forEach((r) => stmt.run(...r)))();
  }
}

/**
 * 第 17 轮：播种只在首次建库时执行一次。
 * - 新库（进程启动前 db 文件不存在）且无标记 → 执行 seed() + runSeedAll()，随后落标记。
 * - 老库（文件已存在、还没标记）→ 视为历史版本已播种过，只补写标记，绝不补插任何行。
 * - 已有标记 → 任何重启都跳过全部播种逻辑。
 * 这样用户删掉的示例数据 / 手删的案例，重启后不会被种子重新插回来。
 */
const SEED_MARKER_KEY = 'initial_seed_v1';
const markerRow = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(SEED_MARKER_KEY) as
  | { value: string }
  | undefined;
const hasSeedMarker = !!markerRow;
const shouldRunInitialSeed = !hasSeedMarker && !dbFileExistedBeforeOpen;

if (shouldRunInitialSeed) seed();

export const migrationReport: MigrationReport = runMigrations(db);
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('engineer_auto_approve', '0')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('llm_enabled', '1')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('llm_daily_limit', '500')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('match_threshold', '60')").run();
db.prepare(`
  INSERT OR IGNORE INTO llm_configs (name, platform, base_url, api_key, model, temperature, max_tokens, enabled, is_active)
  VALUES ('DeepSeek 默认', 'deepseek', 'https://api.deepseek.com', '', 'deepseek-flash', 0.2, 300, 1, 1)
`).run();

const seedMarkerValue =
  markerRow?.value ??
  `${shouldRunInitialSeed ? 'seeded' : 'legacy-skip'}-${new Date().toISOString()}`;
if (!hasSeedMarker) {
  db.prepare('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)').run(SEED_MARKER_KEY, seedMarkerValue);
}

export const seedReport: SeedReport = shouldRunInitialSeed
  ? runSeedAll()
  : { symptoms: 0, modelAliases: 0, models: 0, customers: 0, cases: 0, skipped: true, marker: seedMarkerValue };

export type UserRole = 'engineer' | 'technician';

export interface UserRow {
  id: number;
  emp_no: string;
  name: string;
  role: UserRole;
  position: string;
  password_hash: string;
  created_at: string;
}

export type CaseStatus = 'approved' | 'pending' | 'rejected';

export interface CaseRow {
  id: number;
  model: string;
  customer: string;
  symptom: string;
  diagnosis: string;
  solution: string;
  parts: string;
  note: string;
  repaired_at: string | null;
  source: 'sample' | 'manual' | 'import';
  status: CaseStatus;
  author: string;
  model_id: number | null;
  customer_id: number | null;
  category: string;
  reviewer: string;
  reviewed_at: string | null;
  reject_reason: string;
  import_batch_no: string;
  created_at: string;
  updated_at: string;
}

export interface AttachmentRow {
  id: number;
  case_id: number;
  original_name: string;
  stored_name: string;
  relative_path: string;
  mime_type: string;
  size: number;
  uploader: string;
  created_at: string;
}

export interface ModelRow {
  id: number;
  brand: string;
  model: string;
  platform: string;
  note: string;
  created_at: string;
}

export interface CustomerRow {
  id: number;
  name: string;
  contact: string;
  note: string;
  created_at: string;
}

export type LlmPlatform = 'deepseek' | 'openai' | 'custom';

export interface LlmConfigRow {
  id: number;
  name: string;
  platform: LlmPlatform;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  thinking_enabled: number;
  enabled: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface SymptomDictRow {
  id: number;
  standard: string;
  aliases: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface ModelAliasRow {
  id: number;
  canonical: string;
  alias: string;
  created_at: string;
}

export interface LlmCallRow {
  id: number;
  config_id: number | null;
  platform: string;
  model: string;
  kind: string;
  success: number;
  error: string;
  latency_ms: number;
  prompt_chars: number;
  completion_chars: number;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
  user_emp_no: string;
  created_at: string;
}
