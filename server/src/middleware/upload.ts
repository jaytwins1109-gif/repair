import multer, { type FileFilterCallback } from 'multer';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

// 第 45 轮：技术知识库文档白名单。浏览器常把 Office 文件报成 application/octet-stream，
// 先按扩展名放行，落盘后再用 magic bytes 判定真实类型（见 detectKnowledgeType）。
const KNOWLEDGE_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf']);
const KNOWLEDGE_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/pdf',
  'application/octet-stream',
]);
const KNOWLEDGE_MIME_BY_EXT: Record<string, string> = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
};

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
    return cb(new Error('仅支持 jpg / jpeg / png / webp / pdf 格式'));
  }
  return cb(null, true);
}

export const uploadImages = multer({
  storage,
  fileFilter,
  limits: { fileSize: 30 * 1024 * 1024, files: 9 },
});

export const uploadAsset = multer({
  storage,
  fileFilter,
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

function knowledgeFileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
  const ext = path.extname(String(file.originalname || '').toLowerCase());
  if (!KNOWLEDGE_EXT.has(ext)) {
    return cb(new Error('文档仅支持 doc / docx / xls / xlsx / ppt / pptx / pdf 格式'));
  }
  if (!KNOWLEDGE_MIME.has(file.mimetype)) {
    return cb(new Error('文档 MIME 类型不受支持'));
  }
  return cb(null, true);
}

export const uploadKnowledge = multer({
  storage,
  fileFilter: knowledgeFileFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
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

/** 资料图纸可接受的真实类型：图片三种 + PDF（按文件头判定） */
export function detectAssetMime(filePath: string): string | null {
  const image = detectImageMime(filePath);
  if (image) return image;
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(5);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    if (read === 5 && head.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** 第 45 轮：按 magic bytes 识别文档真实类型；返回规范化扩展名（不含点）与 MIME */
export interface KnowledgeType {
  ext: string;
  mime: string;
}

function bufferIncludesToken(buf: Buffer, token: string) {
  return buf.includes(Buffer.from(token, 'ascii')) || buf.includes(Buffer.from(token, 'utf16le'));
}

export function detectKnowledgeType(filePath: string, originalName = ''): KnowledgeType | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(8);
    const read = fs.readSync(fd, head, 0, head.length, 0);

    if (read >= 5 && head.toString('ascii', 0, 5) === '%PDF-') {
      return { ext: 'pdf', mime: 'application/pdf' };
    }

    // OOXML（docx/xlsx/pptx）本质是 ZIP：PK\x03\x04 + 包内 word/、xl/、ppt/ 路径
    if (read >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
      const size = Math.min(fs.fstatSync(fd).size, 2 * 1024 * 1024);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      if (bufferIncludesToken(buf, 'word/')) {
        return { ext: 'docx', mime: KNOWLEDGE_MIME_BY_EXT['.docx'] };
      }
      if (bufferIncludesToken(buf, 'xl/')) {
        return { ext: 'xlsx', mime: KNOWLEDGE_MIME_BY_EXT['.xlsx'] };
      }
      if (bufferIncludesToken(buf, 'ppt/')) {
        return { ext: 'pptx', mime: KNOWLEDGE_MIME_BY_EXT['.pptx'] };
      }
      return null;
    }

    // 老版 Office（doc/xls/ppt）是 OLE2 复合文档：先认固定头，再按内部目录名细分
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (read === head.length && head.equals(ole)) {
      const size = Math.min(fs.fstatSync(fd).size, 2 * 1024 * 1024);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      if (bufferIncludesToken(buf, 'WordDocument')) return { ext: 'doc', mime: KNOWLEDGE_MIME_BY_EXT['.doc'] };
      if (bufferIncludesToken(buf, 'Workbook') || bufferIncludesToken(buf, 'Book')) {
        return { ext: 'xls', mime: KNOWLEDGE_MIME_BY_EXT['.xls'] };
      }
      if (bufferIncludesToken(buf, 'PowerPoint Document')) return { ext: 'ppt', mime: KNOWLEDGE_MIME_BY_EXT['.ppt'] };
      // OLE2 头正确但目录名识别不出时，仅用扩展名标注老格式子类型，仍以 magic bytes 为准
      const ext = path.extname(String(originalName || '').toLowerCase()).slice(1);
      if (['doc', 'xls', 'ppt'].includes(ext)) return { ext, mime: KNOWLEDGE_MIME_BY_EXT[`.${ext}`] };
      return null;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** busboy/multer 把 multipart 文件名按 latin1 解读，中文名需按 UTF-8 还原 */
function decodeOriginalName(name: string): string {
  return Buffer.from(String(name || ''), 'latin1').toString('utf8');
}

/** 技术知识库上传落盘后校验：伪装文件删除，真实类型覆盖 mimetype 与后缀 */
export function verifyUploadedKnowledgeDocs(files: Express.Multer.File[]): Express.Multer.File[] {
  for (const file of files) {
    file.originalname = decodeOriginalName(file.originalname);
    const detected = detectKnowledgeType(file.path, file.originalname);
    if (!detected) {
      try { fs.unlinkSync(file.path); } catch { /* 删除失败不影响拒绝上传 */ }
      throw new Error('仅支持 doc / docx / xls / xlsx / ppt / pptx / pdf 格式（已按文件内容校验）');
    }
    const expectedExt = `.${detected.ext}`;
    if (path.extname(file.filename).toLowerCase() !== expectedExt) {
      const renamed = `${path.basename(file.filename, path.extname(file.filename))}${expectedExt}`;
      const target = path.join(path.dirname(file.path), renamed);
      fs.renameSync(file.path, target);
      file.filename = renamed;
      file.path = target;
    }
    file.mimetype = detected.mime;
  }
  return files;
}

/** 资料上传的落盘后校验：按 magic bytes 改写后缀与 mimetype，伪装文件直接删除 */
export function verifyUploadedAssets(files: Express.Multer.File[]): Express.Multer.File[] {
  const extOf: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  for (const file of files) {
    const mime = detectAssetMime(file.path);
    if (!mime) {
      try { fs.unlinkSync(file.path); } catch { /* 删除失败不影响拒绝上传 */ }
      throw new Error('仅支持 jpg / png / webp / pdf 格式（已按文件内容校验）');
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
  if (error?.code === 'LIMIT_FILE_SIZE') return '单个文件不能超过 30MB';
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') {
    return '一次最多上传 9 个文件';
  }
  return error?.message || '文件上传失败';
}

export function knowledgeUploadErrorToMessage(error: any) {
  if (error?.code === 'LIMIT_FILE_SIZE') return '单个文档不能超过 50MB';
  return error?.message || '文档上传失败';
}
