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

/** 按文件头 magic bytes 判定真实图片类型，不看扩展名也不看客户端声明的 mimetype */
export function detectImageMime(filePath: string): string | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    if (read < 12) return null;
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
        head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'image/png';
    if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 落盘后、入库前再校验一次：扩展名伪装的文件在这里被拦下并删除。
 * 真实类型覆盖 file.mimetype，文件名后缀也改成与真实类型一致。
 */
export function verifyUploadedImages(files: Express.Multer.File[]): Express.Multer.File[] {
  const extOf: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  for (const file of files) {
    const mime = detectImageMime(file.path);
    if (!mime) {
      try { fs.unlinkSync(file.path); } catch { /* 删除失败不影响拒绝上传 */ }
      throw new Error('仅支持 jpg / png / webp 格式的图片（已按文件内容校验）');
    }
    const ext = extOf[mime];
    if (path.extname(file.filename).toLowerCase() !== ext) {
      const renamed = `${path.basename(file.filename, path.extname(file.filename))}${ext}`;
      const target = path.join(path.dirname(file.path), renamed);
      fs.renameSync(file.path, target);
      file.filename = renamed;
      file.path = target;
    }
    file.mimetype = mime;
  }
  return files;
}

export function uploadErrorToMessage(error: any) {
  if (error?.code === 'LIMIT_FILE_SIZE') return '单张图片不能超过 10MB';
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') {
    return '一条案例最多上传 9 张图片';
  }
  return error?.message || '图片上传失败';
}
