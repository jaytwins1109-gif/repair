import { Router } from 'express';
import { db, type ModelAliasRow, type SymptomDictRow } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { fail, ok } from '../response';
import { clearCache } from '../services/cache';

const router = Router();

function listSymptoms() {
  return db.prepare('SELECT * FROM symptom_dict ORDER BY id ASC').all() as SymptomDictRow[];
}
function listModelAliases() {
  return db.prepare('SELECT * FROM model_alias ORDER BY id ASC').all() as ModelAliasRow[];
}

router.get('/dictionary', requireAuth, (_req, res) => {
  try {
    return ok(res, { symptoms: listSymptoms(), modelAliases: listModelAliases() });
  } catch (e: any) {
    return fail(res, e.message || '读取词典失败');
  }
});

router.post('/dictionary/symptoms', requireRole('engineer'), (req, res) => {
  try {
    const standard = String(req.body?.standard || '').trim();
    const aliases = String(req.body?.aliases || '').trim();
    const category = String(req.body?.category || '').trim();
    if (!standard) return fail(res, '标准词不能为空');
    if (db.prepare('SELECT 1 FROM symptom_dict WHERE standard = ?').get(standard)) {
      return fail(res, '标准词已存在，不能重复添加');
    }
    db.prepare('INSERT INTO symptom_dict (standard, aliases, category) VALUES (?, ?, ?)').run(standard, aliases, category);
    clearCache();
    return ok(res, listSymptoms(), '已新增');
  } catch (e: any) {
    return fail(res, e.message || '新增失败');
  }
});

router.put('/dictionary/symptoms/:id', requireRole('engineer'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const standard = String(req.body?.standard || '').trim();
    const aliases = String(req.body?.aliases || '').trim();
    const category = String(req.body?.category || '').trim();
    if (!standard) return fail(res, '标准词不能为空');
    if (db.prepare('SELECT 1 FROM symptom_dict WHERE standard = ? AND id <> ?').get(standard, id)) {
      return fail(res, '标准词已存在');
    }
    db.prepare(
      "UPDATE symptom_dict SET standard = ?, aliases = ?, category = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(standard, aliases, category, id);
    clearCache();
    return ok(res, listSymptoms(), '已保存');
  } catch (e: any) {
    return fail(res, e.message || '保存失败');
  }
});

router.delete('/dictionary/symptoms/:id', requireRole('engineer'), (req, res) => {
  try {
    db.prepare('DELETE FROM symptom_dict WHERE id = ?').run(Number(req.params.id));
    clearCache();
    return ok(res, { id: Number(req.params.id) }, '已删除');
  } catch (e: any) {
    return fail(res, e.message || '删除失败');
  }
});

router.post('/dictionary/model-aliases', requireRole('engineer'), (req, res) => {
  try {
    const canonical = String(req.body?.canonical || '').trim();
    const alias = String(req.body?.alias || '').trim();
    if (!canonical || !alias) return fail(res, '规范型号和别名都不能为空');
    if (db.prepare('SELECT 1 FROM model_alias WHERE alias = ?').get(alias)) {
      return fail(res, '该别名已存在，不能重复添加');
    }
    db.prepare('INSERT INTO model_alias (canonical, alias) VALUES (?, ?)').run(canonical, alias);
    clearCache();
    return ok(res, listModelAliases(), '已新增');
  } catch (e: any) {
    return fail(res, e.message || '新增失败');
  }
});

router.delete('/dictionary/model-aliases/:id', requireRole('engineer'), (req, res) => {
  try {
    db.prepare('DELETE FROM model_alias WHERE id = ?').run(Number(req.params.id));
    clearCache();
    return ok(res, { id: Number(req.params.id) }, '已删除');
  } catch (e: any) {
    return fail(res, e.message || '删除失败');
  }
});

export default router;
