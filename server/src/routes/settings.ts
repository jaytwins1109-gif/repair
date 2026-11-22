import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { fail, ok } from '../response';
import { listBackups } from '../services/backup';
import { clearCache, getCacheStats, getRouteStats } from '../services/cache';

const router = Router();

router.get('/settings', requireAuth, (_req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const values: Record<string, string> = {};
    rows.forEach((r) => {
      values[r.key] = r.value;
    });
    return ok(res, {
      engineer_auto_approve: values.engineer_auto_approve === '1',
      match_threshold: Number(values.match_threshold) || 60,
      cache: getCacheStats(),
      routes: getRouteStats(),
      backups: listBackups(),
    });
  } catch (e: any) {
    return fail(res, e.message || '读取设置失败');
  }
});

router.put('/settings/engineer-auto-approve', requireRole('engineer'), (req, res) => {
  try {
    const enabled = req.body?.enabled === true || req.body?.enabled === '1' || req.body?.enabled === 'true';
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('engineer_auto_approve', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(enabled ? '1' : '0');
    return ok(res, { engineer_auto_approve: enabled }, '设置已保存');
  } catch (e: any) {
    return fail(res, e.message || '保存设置失败');
  }
});

router.put('/settings/match-threshold', requireRole('engineer'), (req, res) => {
  try {
    const n = Math.round(Number(req.body?.value));
    if (!Number.isFinite(n) || n < 0 || n > 100) return fail(res, '阈值必须是 0-100 的整数');
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('match_threshold', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(String(n));
    clearCache();
    return ok(res, { match_threshold: n }, '设置已保存');
  } catch (e: any) {
    return fail(res, e.message || '保存设置失败');
  }
});

router.delete('/settings/cache', requireRole('engineer'), (_req, res) => {
  try {
    const cleared = clearCache();
    return ok(res, { cleared }, `已清空 ${cleared} 条缓存`);
  } catch (e: any) {
    return fail(res, e.message || '清空缓存失败');
  }
});

export default router;
