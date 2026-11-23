import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { escapeLike, LIKE_ESCAPE_SQL } from '../services/access';
import { ok, fail } from '../response';

const router = Router();

router.get('/models', requireAuth, (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = q
      ? db
          .prepare(
            `SELECT * FROM models WHERE brand LIKE ? ${LIKE_ESCAPE_SQL} OR model LIKE ? ${LIKE_ESCAPE_SQL}` +
              ` OR platform LIKE ? ${LIKE_ESCAPE_SQL} OR note LIKE ? ${LIKE_ESCAPE_SQL} ORDER BY id DESC`
          )
          .all(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`)
      : db.prepare('SELECT * FROM models ORDER BY id DESC').all();
    return ok(res, rows);
  } catch (e: any) {
    return fail(res, e.message || '查询型号失败');
  }
});

router.post('/models', requireRole('engineer'), (req, res) => {
  try {
    const { brand = '', model, platform = '', note = '' } = req.body || {};
    if (!model || !String(model).trim()) return fail(res, '型号不能为空');
    const info = db
      .prepare('INSERT INTO models (brand, model, platform, note) VALUES (?, ?, ?, ?)')
      .run(String(brand).trim(), String(model).trim(), String(platform).trim(), String(note).trim());
    const row = db.prepare('SELECT * FROM models WHERE id = ?').get(info.lastInsertRowid);
    return ok(res, row, '新增型号成功');
  } catch (e: any) {
    return fail(res, e.message || '新增型号失败');
  }
});

router.put('/models/:id', requireRole('engineer'), (req, res) => {
  try {
    const { brand = '', model, platform = '', note = '' } = req.body || {};
    if (!model || !String(model).trim()) return fail(res, '型号不能为空');
    const info = db
      .prepare('UPDATE models SET brand = ?, model = ?, platform = ?, note = ? WHERE id = ?')
      .run(
        String(brand).trim(),
        String(model).trim(),
        String(platform).trim(),
        String(note).trim(),
        req.params.id
      );
    if (!info.changes) return fail(res, '型号不存在');
    return ok(res, db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id), '更新成功');
  } catch (e: any) {
    return fail(res, e.message || '更新型号失败');
  }
});

router.delete('/models/:id', requireRole('engineer'), (req, res) => {
  try {
    const info = db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id);
    if (!info.changes) return fail(res, '型号不存在');
    return ok(res, { id: Number(req.params.id) }, '删除成功');
  } catch (e: any) {
    return fail(res, e.message || '删除型号失败');
  }
});

export default router;
