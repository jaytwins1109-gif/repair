import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { fail, ok } from '../response';

const router = Router();

router.get('/export/json', requireAuth, (_req, res) => {
  try {
    const data = {
      exported_at: new Date().toISOString(),
      models: db.prepare('SELECT * FROM models ORDER BY id').all(),
      customers: db.prepare('SELECT * FROM customers ORDER BY id').all(),
      cases: db.prepare('SELECT * FROM cases ORDER BY id').all(),
      attachments: db.prepare('SELECT * FROM case_attachments ORDER BY id').all(),
      import_batches: db.prepare('SELECT * FROM import_batches ORDER BY id').all(),
      settings: db.prepare('SELECT * FROM settings').all(),
    };
    return ok(res, data);
  } catch (e: any) {
    return fail(res, e.message || '导出失败');
  }
});

export default router;
