import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { requireAuth } from '../middleware/auth';
import { fail, ok } from '../response';
import {
  executeImport,
  getSession,
  IMPORT_FIELDS,
  listBatches,
  parseImportFile,
  rollbackBatch,
  templateRows,
} from '../services/import';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

router.get('/imports/template', requireAuth, (_req, res) => {
  try {
    const sheet = XLSX.utils.aoa_to_sheet(templateRows());
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '维修案例导入');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="repair-case-template.xlsx"');
    return res.send(buffer);
  } catch (e: any) {
    return fail(res, e.message || '模板生成失败');
  }
});

router.post('/imports/parse', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (error: any) => {
    if (error) return fail(res, error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 15MB' : '文件读取失败');
    return next();
  });
}, (req, res) => {
  try {
    if (!req.file) return fail(res, '请选择要导入的文件');
    const result = parseImportFile(req.file.buffer, req.file.originalname);
    return ok(res, { ...result, fields: IMPORT_FIELDS });
  } catch (e: any) {
    return fail(res, e.message || '文件解析失败');
  }
});

router.post('/imports/execute', requireAuth, (req, res) => {
  try {
    const {
      token,
      mapping,
      decisions,
      directApprove,
      batchNo,
      offset,
      limit,
    } = req.body || {};

    if (directApprove && req.user!.role !== 'engineer') {
      return fail(res, '仅工程师可以选择直接归档', 403, 403);
    }
    const session = getSession(String(token || ''));
    if (!session) return fail(res, '导入会话已失效，请重新上传文件');

    const result = executeImport(String(token), {
      mapping: mapping || {},
      decisions: decisions || {},
      directApprove: !!directApprove,
      author: req.user!.name,
      empNo: req.user!.emp_no,
      batchNo: batchNo ? String(batchNo) : undefined,
      offset: Math.max(0, Number(offset) || 0),
      limit: Math.min(100, Math.max(1, Number(limit) || 50)),
    });
    return ok(res, result);
  } catch (e: any) {
    return fail(res, e.message || '导入失败');
  }
});

router.get('/imports/batches', requireAuth, (_req, res) => {
  try {
    return ok(res, listBatches());
  } catch (e: any) {
    return fail(res, e.message || '获取批次失败');
  }
});

router.post('/imports/:batchNo/rollback', requireAuth, (req, res) => {
  try {
    const batch = listBatches().find((b: any) => b.batch_no === req.params.batchNo);
    if (!batch) return fail(res, '导入批次不存在');
    if (req.user!.role !== 'engineer' && batch.operator_emp_no !== req.user!.emp_no) {
      return fail(res, '只能撤销自己导入的批次', 403, 403);
    }
    const result = rollbackBatch(req.params.batchNo);
    return ok(res, result, '批次已撤销');
  } catch (e: any) {
    return fail(res, e.message || '撤销失败');
  }
});

export default router;
