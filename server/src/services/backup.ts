import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const MAX_BACKUPS = 20;

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function backupDatabase(db?: Database.Database) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // 非 WAL 模式下忽略
    }
  }

  const source = path.join(process.cwd(), 'data', 'repair.db');
  const target = path.join(BACKUP_DIR, `repair-${timestamp()}.db`);
  if (!fs.existsSync(source)) return target;

  fs.copyFileSync(source, target);

  // 备份用于恢复业务数据，不承载密钥：在备份副本上清空 llm_configs.api_key
  try {
    const backupDb = new Database(target);
    const tableExists = backupDb
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'llm_configs'")
      .get();
    if (tableExists) backupDb.prepare("UPDATE llm_configs SET api_key = ''").run();
    backupDb.close();
  } catch (e) {
    // 如果清洗失败，删除可能带密钥的备份，避免外泄
    try {
      fs.unlinkSync(target);
    } catch {
      // ignore
    }
    throw e;
  }

  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^repair-\d{8}-\d{6}\.db$/.test(name))
    .sort();

  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift()!;
    fs.unlinkSync(path.join(BACKUP_DIR, oldest));
  }

  return target;
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^repair-\d{8}-\d{6}\.db$/.test(name))
    .sort()
    .reverse()
    .map((name) => ({
      name,
      size: fs.statSync(path.join(BACKUP_DIR, name)).size,
    }));
}
