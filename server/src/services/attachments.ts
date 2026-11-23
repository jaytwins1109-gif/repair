import fs from 'fs';
import path from 'path';
import { db, type AttachmentRow } from '../db';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

export function safeAttachmentPath(relativePath: string) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const absolute = path.join(UPLOAD_ROOT, normalized);
  if (!absolute.startsWith(UPLOAD_ROOT + path.sep)) return null;
  return absolute;
}

export function listAttachments(caseId: number) {
  return db
    .prepare('SELECT * FROM case_attachments WHERE case_id = ? ORDER BY id')
    .all(caseId) as AttachmentRow[];
}

export function saveAttachments(
  caseId: number,
  files: Express.Multer.File[] | undefined,
  uploader: string
) {
  if (!files || files.length === 0) return [];
  const insert = db.prepare(
    `INSERT INTO case_attachments (case_id, original_name, stored_name, relative_path, mime_type, size, uploader)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const rows: AttachmentRow[] = [];
  const transaction = db.transaction(() => {
    for (const file of files) {
      const relativePath = path
        .join(path.basename(path.dirname(file.path)), path.basename(file.filename))
        .replace(/\\/g, '/');
      const info = insert.run(
        caseId,
        file.originalname,
        file.filename,
        relativePath,
        file.mimetype,
        file.size,
        uploader
      );
      rows.push(
        db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(info.lastInsertRowid) as AttachmentRow
      );
    }
  });
  transaction();
  return rows;
}

export function removeAttachmentFile(row: AttachmentRow) {
  const absolute = safeAttachmentPath(row.relative_path);
  if (absolute && fs.existsSync(absolute)) {
    try {
      fs.unlinkSync(absolute);
    } catch {
      // 文件删除失败不影响数据库记录清理
    }
  }
}

export function deleteAttachmentsOfCase(caseId: number) {
  const rows = listAttachments(caseId);
  rows.forEach(removeAttachmentFile);
  db.prepare('DELETE FROM case_attachments WHERE case_id = ?').run(caseId);
  return rows.length;
}

export function deleteAttachment(id: number) {
  const row = db.prepare('SELECT * FROM case_attachments WHERE id = ?').get(id) as
    | AttachmentRow
    | undefined;
  if (!row) return null;
  removeAttachmentFile(row);
  db.prepare('DELETE FROM case_attachments WHERE id = ?').run(id);
  return row;
}
