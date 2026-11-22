import { db } from '../db';

export interface CacheEntry {
  query_norm: string;
  case_ids: number[];
  path: 'dict' | 'ai';
  hit_count: number;
  created_at: string;
  last_hit_at: string;
}

/**
 * 查询串归一化规则（稳定且可核对）：
 * 1) 全角转半角（NFKC）  2) 英文大小写统一（小写）  3) 忽略所有空白  4) 忽略标点符号
 */
export function normalizeQuery(raw: string): string {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!-/:-@[-`{-~，。！？、；：（）【】《》“”‘’·—…]/g, '');
}

export function getCached(queryNorm: string): CacheEntry | null {
  const row = db.prepare('SELECT * FROM search_cache WHERE query_norm = ?').get(queryNorm) as
    | {
        query_norm: string;
        case_ids: string;
        path: string;
        hit_count: number;
        created_at: string;
        last_hit_at: string;
      }
    | undefined;
  if (!row) return null;
  let caseIds: number[] = [];
  try {
    const parsed = JSON.parse(row.case_ids);
    if (Array.isArray(parsed)) caseIds = parsed.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  } catch {
    return null;
  }
  db.prepare(
    "UPDATE search_cache SET hit_count = hit_count + 1, last_hit_at = datetime('now','localtime') WHERE query_norm = ?"
  ).run(queryNorm);
  return {
    query_norm: row.query_norm,
    case_ids: caseIds,
    path: row.path === 'ai' ? 'ai' : 'dict',
    hit_count: row.hit_count + 1,
    created_at: row.created_at,
    last_hit_at: new Date().toISOString(),
  };
}

export function setCached(queryNorm: string, caseIds: number[], path: 'dict' | 'ai') {
  db.prepare(
    `INSERT INTO search_cache (query_norm, case_ids, path, hit_count, created_at, last_hit_at)
     VALUES (?, ?, ?, 0, datetime('now','localtime'), datetime('now','localtime'))
     ON CONFLICT(query_norm) DO UPDATE SET case_ids = excluded.case_ids, path = excluded.path`
  ).run(queryNorm, JSON.stringify(caseIds), path);
}

/** 数据或规则变化时全表失效：宁可简单粗暴清空，也不留过期结果 */
export function clearCache() {
  return db.prepare('DELETE FROM search_cache').run().changes;
}

export function getCacheStats() {
  const row = db
    .prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(hit_count),0) AS hits FROM search_cache')
    .get() as { entries: number; hits: number };
  return { entries: row.entries, hits: row.hits };
}

/** 前置拦截判断：true=所有现象词都被词典覆盖，或只有机型/客户没有现象词 → 不必调用模型 */
export function shouldSkipLlm(input: {
  uncoveredSymptoms: string[];
  hasSymptomWords: boolean;
}): boolean {
  if (!input.hasSymptomWords) return true;
  return input.uncoveredSymptoms.length === 0;
}

const STAT_KEYS = {
  total: 'route_total',
  skip: 'route_skip',
  cache: 'route_cache',
  llm: 'route_llm',
} as const;

function bump(key: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"
  ).run(key);
}

export function recordRoute(route: 'total' | 'skip' | 'cache' | 'llm') {
  bump(STAT_KEYS[route]);
}

export function getRouteStats() {
  const read = (key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return Number(row?.value) || 0;
  };
  const total = read(STAT_KEYS.total);
  const skip = read(STAT_KEYS.skip);
  const cache = read(STAT_KEYS.cache);
  const llm = read(STAT_KEYS.llm);
  return { total, skip, cache, llm, saved: skip + cache, savedRate: total > 0 ? Math.round(((skip + cache) / total) * 1000) / 10 : 0 };
}
