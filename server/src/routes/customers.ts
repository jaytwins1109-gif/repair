import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { escapeLike, LIKE_ESCAPE_SQL } from '../services/access';
import { ok, fail } from '../response';

const router = Router();

router.get('/customers', requireAuth, (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = q
      ? db
          .prepare(
            `SELECT * FROM customers WHERE name LIKE ? ${LIKE_ESCAPE_SQL} OR contact LIKE ? ${LIKE_ESCAPE_SQL}` +
              ` OR note LIKE ? ${LIKE_ESCAPE_SQL} ORDER BY id DESC`
          )
          .all(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`, `%${escapeLike(q)}%`)
      : db.prepare('SELECT * FROM customers ORDER BY id DESC').all();
    return ok(res, rows);
  } catch (e: any) {
    return fail(res, e.message || '查询客户失败');
  }
});

router.post('/customers', requireRole('engineer'), (req, res) => {
  try {
    const { name, contact = '', note = '' } = req.body || {};
    if (!name || !String(name).trim()) return fail(res, '客户名称不能为空');
    const info = db
      .prepare('INSERT INTO customers (name, contact, note) VALUES (?, ?, ?)')
      .run(String(name).trim(), String(contact).trim(), String(note).trim());
    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
    return ok(res, row, '新增客户成功');
  } catch (e: any) {
    return fail(res, e.message || '新增客户失败');
  }
});

router.put('/customers/:id', requireRole('engineer'), (req, res) => {
  try {
    const { name, contact = '', note = '' } = req.body || {};
    if (!name || !String(name).trim()) return fail(res, '客户名称不能为空');
    const info = db
      .prepare('UPDATE customers SET name = ?, contact = ?, note = ? WHERE id = ?')
      .run(String(name).trim(), String(contact).trim(), String(note).trim(), req.params.id);
    if (!info.changes) return fail(res, '客户不存在');
    return ok(res, db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id), '更新成功');
  } catch (e: any) {
    return fail(res, e.message || '更新客户失败');
  }
});

router.delete('/customers/:id', requireRole('engineer'), (req, res) => {
  try {
    const info = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
    if (!info.changes) return fail(res, '客户不存在');
    return ok(res, { id: Number(req.params.id) }, '删除成功');
  } catch (e: any) {
    return fail(res, e.message || '删除客户失败');
  }
});

export default router;
