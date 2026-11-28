import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  detectKnowledgeType,
  knowledgeUploadErrorToMessage,
  uploadKnowledge,
  verifyUploadedKnowledgeDocs,
} from '../middleware/upload';
import { fail, ok } from '../response';
import { safeAttachmentPath } from '../services/attachments';
import {
  deleteKnowledgeDoc,
  getKnowledgeDoc,
  isKnowledgeCategory,
  listKnowledgeCategories,
  listKnowledgeDocs,
  saveKnowledgeDoc,
} from '../services/knowledgeDocs';

const router = Router();
router.use(requireAuth);

router.get('/knowledge-categories', (_req, res) => ok(res, listKnowledgeCategories()));

router.post('/knowledge-docs', requireRole('engineer'), (req, res, next) => {
  uploadKnowledge.single('file')(req, res, (error: any) => {
    if (error) return fail(res, knowledgeUploadErrorToMessage(error));
    return next();
  });
}, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const category = String(req.body?.category || '').trim();
  if (!title) return fail(res, '必须填写文档标题');
  if (!category) return fail(res, '必须选择分类');
  if (!isKnowledgeCategory(category)) return fail(res, '分类不在允许范围内');
  if (!req.file) return fail(res, '请选择要上传的文档');
  try {
    const [verified] = verifyUploadedKnowledgeDocs([req.file]);
    const row = saveKnowledgeDoc(verified, title, category, req.user!.name);
    return ok(res, row, '技术文档已上传');
  } catch (e: any) {
    return fail(res, e.message || '技术文档上传失败');
  }
});

router.get('/knowledge-docs', (req, res) => {
  const category = String(req.query.category || '').trim();
  const q = String(req.query.q || '').trim();
  try {
    return ok(res, listKnowledgeDocs(category, q));
  } catch (e: any) {
    return fail(res, e.message || '获取文档列表失败');
  }
});

router.get('/knowledge-docs/:id/raw', (req, res) => {
  try {
    const row = getKnowledgeDoc(req.params.id);
    if (!row) return fail(res, '文档不存在', 404, 404);
    const absolute = safeAttachmentPath(row.relative_path);
    if (!absolute || !fs.existsSync(absolute)) return fail(res, '文档文件不存在', 404, 404);

    // 不信任数据库里的 file_type：取流时再按 magic bytes 判定一次真实类型
    const detected = detectKnowledgeType(absolute, row.file_name);
    if (!detected) return fail(res, '文档文件类型不支持');
    res.setHeader('Content-Type', detected.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(path.resolve(absolute), { headers: { 'Content-Type': detected.mime } });
  } catch (e: any) {
    return fail(res, e.message || '读取文档失败');
  }
});

router.delete('/knowledge-docs/:id', requireRole('engineer'), (req, res) => {
  try {
    const row = getKnowledgeDoc(req.params.id);
    if (!row) return fail(res, '文档不存在', 404, 404);
    deleteKnowledgeDoc(row);
    return ok(res, { id: row.id }, '文档已删除');
  } catch (e: any) {
    return fail(res, e.message || '删除文档失败');
  }
});

export default router;
