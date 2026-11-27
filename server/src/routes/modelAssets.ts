import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/auth';
import {
  detectAssetMime,
  uploadAsset,
  uploadErrorToMessage,
  verifyUploadedAssets,
} from '../middleware/upload';
import { fail, ok } from '../response';
import { safeAttachmentPath } from '../services/attachments';
import {
  deleteModelAsset,
  getModelAsset,
  listModelAssets,
  saveModelAsset,
} from '../services/modelAssets';

const RESPONSE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const router = Router();

router.use(requireAuth);

router.post('/model-assets', (req, res, next) => {
  uploadAsset.single('file')(req, res, (error: any) => {
    if (error) return fail(res, uploadErrorToMessage(error));
    return next();
  });
}, (req, res) => {
  const modelName = String(req.body?.model_name || '').trim();
  if (!modelName) return fail(res, '必须指定机型 model_name');
  if (!req.file) return fail(res, '请选择要上传的资料文件');
  try {
    const [verified] = verifyUploadedAssets([req.file]);
    const row = saveModelAsset(verified, modelName, req.user!.name);
    return ok(res, row, '机型资料已上传');
  } catch (e: any) {
    return fail(res, e.message || '机型资料上传失败');
  }
});

router.get('/model-assets', (req, res) => {
  const model = String(req.query.model || '').trim();
  if (!model) return fail(res, '请提供要查询的机型 model');
  try {
    return ok(res, listModelAssets(model));
  } catch (e: any) {
    return fail(res, e.message || '获取机型资料失败');
  }
});

router.delete('/model-assets/:id', (req, res) => {
  try {
    const row = getModelAsset(req.params.id);
    if (!row) return fail(res, '图纸资料不存在');
    if (req.user!.role !== 'engineer' && row.uploader !== req.user!.name) {
      return fail(res, '只能删除自己上传的图纸资料', 403, 403);
    }
    deleteModelAsset(row);
    return ok(res, { id: row.id }, '图纸资料已删除');
  } catch (e: any) {
    return fail(res, e.message || '删除图纸资料失败');
  }
});

router.get('/model-assets/:id/raw', (req, res) => {
  try {
    const row = getModelAsset(req.params.id);
    if (!row) return fail(res, '图纸资料不存在');
    const absolute = safeAttachmentPath(row.relative_path);
    if (!absolute || !fs.existsSync(absolute)) return fail(res, '图纸文件不存在');

    // 不信任数据库里的 file_type / 扩展名：以 magic bytes 为准
    const detected = detectAssetMime(absolute);
    if (!detected || !RESPONSE_MIME.has(detected)) return fail(res, '图纸文件类型不支持');
    res.setHeader('Content-Type', detected);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(path.resolve(absolute), { headers: { 'Content-Type': detected } });
  } catch (e: any) {
    return fail(res, e.message || '读取图纸资料失败');
  }
});

export default router;
