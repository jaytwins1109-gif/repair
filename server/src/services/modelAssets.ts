import fs from 'fs';
import path from 'path';
import { db, type ModelAssetRow } from '../db';
import { safeAttachmentPath } from './attachments';

export function listModelAssets(modelName: string): ModelAssetRow[] {
  return db
    .prepare('SELECT * FROM model_assets WHERE model_name = ? ORDER BY id DESC')
    .all(modelName) as ModelAssetRow[];
}

export function getModelAsset(id: number | string): ModelAssetRow | undefined {
  return db.prepare('SELECT * FROM model_assets WHERE id = ?').get(id) as ModelAssetRow | undefined;
}

export function saveModelAsset(
  file: Express.Multer.File,
  modelName: string,
  uploader: string
): ModelAssetRow {
  const relativePath = path
    .join(path.basename(path.dirname(file.path)), path.basename(file.filename))
    .replace(/\\/g, '/');
  const fileType = file.mimetype === 'application/pdf' ? 'pdf' : 'image';
  const info = db
    .prepare(
      `INSERT INTO model_assets (model_name, file_type, original_name, relative_path, size, uploader)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(modelName, fileType, file.originalname, relativePath, file.size, uploader);
  return getModelAsset(Number(info.lastInsertRowid))!;
}

export function deleteModelAsset(row: ModelAssetRow): ModelAssetRow {
  const absolute = safeAttachmentPath(row.relative_path);
  if (absolute && fs.existsSync(absolute)) {
    try {
      fs.unlinkSync(absolute);
    } catch {
      // 文件删除失败不影响数据库记录清理
    }
  }
  db.prepare('DELETE FROM model_assets WHERE id = ?').run(row.id);
  return row;
}
