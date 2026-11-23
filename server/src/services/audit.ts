import { db } from '../db';

/** 审核动作类型：通过 / 驳回 */
export type AuditAction = 'approve' | 'reject';

/** 写一条独立审核日志；与 cases 行更新分离，便于审计追踪历史操作 */
export function writeAuditLog(caseId: number, operator: string, action: AuditAction, reason = '') {
  return db
    .prepare('INSERT INTO audit_logs (case_id, operator, action, reason) VALUES (?, ?, ?, ?)')
    .run(caseId, operator, action, reason);
}

export function listAuditLogs(caseId?: number) {
  if (caseId !== undefined) {
    return db.prepare('SELECT * FROM audit_logs WHERE case_id = ? ORDER BY id ASC').all(caseId);
  }
  return db.prepare('SELECT * FROM audit_logs ORDER BY id ASC').all();
}
