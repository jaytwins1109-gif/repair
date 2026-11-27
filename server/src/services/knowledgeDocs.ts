import fs from 'fs';
import path from 'path';
import {
  db,
  KNOWLEDGE_CATEGORIES,
  type KnowledgeCategoryRow,
  type KnowledgeDocRow,
} from '../db';
import { escapeLike, LIKE_ESCAPE_SQL } from './access';
import { safeAttachmentPath } from './attachments';

export function isKnowledgeCategory(value: string): boolean {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

export function listKnowledgeCategories(): KnowledgeCategoryRow[] {
  return db
    .prepare('SELECT * FROM knowledge_categories ORDER BY sort_order ASC, id ASC')
    .all() as KnowledgeCategoryRow[];
}

/** 只检索标题与文件名，不做全文检索；category / q 都走参数化 + LIKE 转义 */
export function listKnowledgeDocs(category = '', q = ''): KnowledgeDocRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (category && isKnowledgeCategory(category)) {
    where.push('category = ?');
    args.push(category);
  }
  if (q.trim()) {
    const kw = `%${escapeLike(q.trim())}%`;
    where.push(`(title LIKE ? ${LIKE_ESCAPE_SQL} OR file_name LIKE ? ${LIKE_ESCAPE_SQL})`);
    args.push(kw, kw);
  }
  const sql = `SELECT * FROM knowledge_docs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`;
  return db.prepare(sql).all(...args) as KnowledgeDocRow[];
}

export function getKnowledgeDoc(id: number | string): KnowledgeDocRow | undefined {
  return db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(id) as KnowledgeDocRow | undefined;
}

export function saveKnowledgeDoc(
  file: Express.Multer.File,
  title: string,
  category: string,
  uploader: string
): KnowledgeDocRow {
  const relativePath = path
    .join(path.basename(path.dirname(file.path)), path.basename(file.filename))
    .replace(/\\/g, '/');
  const fileType = path.extname(file.filename).toLowerCase().slice(1);
  const info = db
    .prepare(
      `INSERT INTO knowledge_docs (category, title, file_name, relative_path, file_type, size, uploader)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(category, title, file.originalname, relativePath, fileType, file.size, uploader);
  return getKnowledgeDoc(Number(info.lastInsertRowid))!;
}

export function deleteKnowledgeDoc(row: KnowledgeDocRow): KnowledgeDocRow {
  const absolute = safeAttachmentPath(row.relative_path);
  if (absolute && fs.existsSync(absolute)) {
    try {
      fs.unlinkSync(absolute);
    } catch {
      // 文件删除失败不影响数据库记录清理
    }
  }
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(row.id);
  return row;
}
