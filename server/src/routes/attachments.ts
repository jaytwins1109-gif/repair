import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db, type AttachmentRow, type CaseRow } from '../db';
import { requireAuth } from '../middleware/auth';
import { uploadErrorToMessage, uploadImages } from '../middleware/upload';
import { fail, ok } from '../response';
import {
  canViewAttachments,
  deleteAttachment,
  listAttachments,
  safeAttachmentPath,
  saveAttachments,
} from '../services/attachments';

const router = Router();

function getCase(id: string) {
  return db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow | undefined;
}

router.get('/cases/:id/attachments', requireAuth, (req, res) => {
  try {
    const row = getCase(req.params.id);
    if (!row) return fail(res, '案例不存在');
    if (!canViewAttachments(req.user!, row)) return fail(res, '无权查看该案例附件', 403, 403);
    return ok(res, listAttachments(Number(req.params.id)));
  } catch (e: any) {
    return fail(res, e.message || '获取附件失败');
  }
});

router.get('/attachments/:id/raw', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(req.params.id) as
      | AttachmentRow
      | undefined;
    if (!row) return fail(res, '附件不存在');
    const caseRow = getCase(String(row.case_id));
    if (!caseRow) return fail(res, '附件所属案例不存在');
    if (!canViewAttachments(req.user!, caseRow)) return fail(res, '无权查看该附件', 403, 403);

    const absolute = safeAttachmentPath(row.relative_path);
    if (!absolute || !fs.existsSync(absolute)) return fail(res, '附件文件不存在');

    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(path.resolve(absolute));
  } catch (e: any) {
    return fail(res, e.message || '读取附件失败');
  }
});

router.post(
  '/cases/:id/attachments',
  requireAuth,
  (req, res, next) => {
    uploadImages.array('attachments', 9)(req, res, (error: any) => {
      if (error) return fail(res, uploadErrorToMessage(error));
      return next();
    });
  },
  (req, res) => {
    try {
      const row = getCase(req.params.id);
      if (!row) return fail(res, '案例不存在');

      const canEdit =
        req.user!.role === 'engineer' ||
        (row.author === req.user!.name && ['pending', 'rejected'].includes(row.status));
      if (!canEdit) return fail(res, '只能给本人待审核或已驳回的案例追加图片', 403, 403);

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) return fail(res, '请选择要上传的图片');

      const existing = listAttachments(Number(req.params.id)).length;
      if (existing + files.length > 9) return fail(res, '一条案例最多上传 9 张图片');

      const rows = saveAttachments(Number(req.params.id), files, req.user!.name);
      return ok(res, rows, `已上传 ${rows.length} 张图片`);
    } catch (e: any) {
      return fail(res, e.message || '上传附件失败');
    }
  }
);

router.delete('/attachments/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(req.params.id) as
      | AttachmentRow
      | undefined;
    if (!row) return fail(res, '附件不存在');
    const caseRow = getCase(String(row.case_id));
    if (!caseRow) return fail(res, '附件所属案例不存在');

    const canEdit =
      req.user!.role === 'engineer' ||
      (caseRow.author === req.user!.name && ['pending', 'rejected'].includes(caseRow.status));
    if (!canEdit) return fail(res, '无权删除该附件', 403, 403);

    deleteAttachment(row.id);
    return ok(res, { id: row.id }, '附件已删除');
  } catch (e: any) {
    return fail(res, e.message || '删除附件失败');
  }
});

export default router;
