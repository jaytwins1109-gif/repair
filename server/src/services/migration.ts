import type Database from 'better-sqlite3';

const CASE_COLUMNS = [
  'model_id INTEGER',
  'customer_id INTEGER',
  "category TEXT NOT NULL DEFAULT ''",
  "reviewer TEXT NOT NULL DEFAULT ''",
  'reviewed_at TEXT',
  "reject_reason TEXT NOT NULL DEFAULT ''",
  "import_batch_no TEXT NOT NULL DEFAULT ''",
  'repaired_at TEXT',
  "source TEXT NOT NULL DEFAULT 'manual'",
];

const LLM_CONFIG_COLUMNS = [
  'timeout_seconds INTEGER NOT NULL DEFAULT 20',
  'thinking_enabled INTEGER NOT NULL DEFAULT 0',
];

const LLM_CALL_COLUMNS = [
  'prompt_cache_hit_tokens INTEGER NOT NULL DEFAULT 0',
  'prompt_cache_miss_tokens INTEGER NOT NULL DEFAULT 0',
];

/**
 * 第 18 轮：迁移只允许结构变更（CREATE TABLE / ADD COLUMN / CREATE INDEX），
 * 严禁对任何表做 INSERT / UPDATE / DELETE；默认值统一由 db/index.ts 的
 * INSERT OR IGNORE 补一行，绝不覆盖用户已有行。
 */
export interface MigrationReport {
  addedColumns: string[];
}

function ensureCaseColumns(db: Database.Database) {
  const existing = db.prepare('PRAGMA table_info(cases)').all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));
  const added: string[] = [];
  for (const definition of CASE_COLUMNS) {
    const name = definition.split(' ')[0];
    if (!names.has(name)) {
      db.exec(`ALTER TABLE cases ADD COLUMN ${definition}`);
      added.push(name);
    }
  }
  return added;
}

function ensureLlmConfigColumns(db: Database.Database): string[] {
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'llm_configs'")
    .get();
  if (!tableExists) return [];
  const existing = db.prepare('PRAGMA table_info(llm_configs)').all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));
  const added: string[] = [];
  for (const definition of LLM_CONFIG_COLUMNS) {
    const name = definition.split(' ')[0];
    if (!names.has(name)) {
      db.exec(`ALTER TABLE llm_configs ADD COLUMN ${definition}`);
      added.push(name);
    }
  }
  return added;
}

function ensureLlmCallColumns(db: Database.Database): string[] {
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'llm_calls'")
    .get();
  if (!tableExists) return [];
  const existing = db.prepare('PRAGMA table_info(llm_calls)').all() as { name: string }[];
  const names = new Set(existing.map((c) => c.name));
  const added: string[] = [];
  for (const definition of LLM_CALL_COLUMNS) {
    const name = definition.split(' ')[0];
    if (!names.has(name)) {
      db.exec(`ALTER TABLE llm_calls ADD COLUMN ${definition}`);
      added.push(name);
    }
  }
  return added;
}

/**
 * 第 18 轮：这里只做结构变更。
 *
 * 原先的 migrateDefaults() 含 5 条数据写操作，全部移除：
 *   - UPDATE settings      SET value='60'          WHERE key='match_threshold' AND value='12'
 *   - UPDATE llm_configs   SET max_tokens=300      WHERE name='DeepSeek 默认' AND max_tokens=1024
 *   - UPDATE cases         SET source='sample'     WHERE source='manual' AND author='系统'
 *   - UPDATE cases         SET source='import'     WHERE source='manual' AND import_batch_no<>''
 *   - DELETE FROM cases    WHERE symptom='测试' AND author='陈立群' AND note='测试'
 * 原来尾部还有三条 UPDATE cases（回填 model_id / customer_id、清理 note 中「附件：」行），
 * 同样属于数据写入，也一并移除。
 *
 * 配置默认值改由 db/index.ts 的 INSERT OR IGNORE 补一行（settings 四项 + llm_configs 默认行），
 * 绝不 UPDATE 用户已有行；词典默认值由 seedData.seedDictionary() 的 INSERT OR IGNORE 在首次建库补齐。
 * 需要修改配置数据时，只能由用户通过界面提交带鉴权请求。
 */
export function runMigrations(db: Database.Database): MigrationReport {
  const addedColumns = ensureCaseColumns(db);
  ensureLlmConfigColumns(db);
  ensureLlmCallColumns(db);
  return { addedColumns };
}
