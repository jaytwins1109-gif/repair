import multer, { type FileFilterCallback } from 'multer';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function monthDir() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, monthDir());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomBytes(16).toString('hex')}${ext}`);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
  const original = String(file.originalname || '').toLowerCase();
  const ext = path.extname(original);

  if (original.endsWith('.heic') || original.endsWith('.heif') || /heic|heif/.test(file.mimetype)) {
    return cb(new Error('HEIC 格式浏览器无法预览，请先转换为 jpg 后再上传'));
  }
  if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
    return cb(new Error('仅支持 jpg / jpeg / png / webp 格式的图片'));
  }
  return cb(null, true);
}

export const uploadImages = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 9 },
});

export function relativeUploadPath(file: Express.Multer.File) {
  return path.join(monthDir(), path.basename(file.filename)).replace(/\\/g, '/');
}

export function uploadErrorToMessage(error: any) {
  if (error?.code === 'LIMIT_FILE_SIZE') return '单张图片不能超过 10MB';
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') {
    return '一条案例最多上传 9 张图片';
  }
  return error?.message || '图片上传失败';
}
