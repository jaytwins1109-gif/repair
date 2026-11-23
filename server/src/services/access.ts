import type { AuthUser } from '../middleware/auth';
import type { CaseRow } from '../db';

/**
 * 案例可见范围（第 22 轮统一）。
 * 案例列表 / 分面 / 单条详情 / 附件一律走这里，避免多处拷贝出口径漂移。
 * 技术员只看已归档案例 + 自己提交的案例；工程师看全部。
 */
export function caseScope(user: AuthUser, scope: string): { sql: string; params: any[] } | { error: string } {
  if (scope === 'review' && user.role !== 'engineer') return { error: '仅工程师可查看审核队列' };
  if (scope === 'review') return { sql: "status IN ('pending','rejected')", params: [] };
  if (scope === 'mine') return { sql: 'author = ?', params: [user.name] };
  if (user.role === 'technician') {
    return { sql: '(status = ? OR author = ?)', params: ['approved', user.name] };
  }
  return { sql: '1 = 1', params: [] };
}

/** 单条案例可见性：等价于 caseScope(user, '') 的行内判断，供详情 / 附件等接口复用 */
export function canViewCase(user: AuthUser, row: Pick<CaseRow, 'author' | 'status'>) {
  if (user.role === 'engineer') return true;
  return row.status === 'approved' || row.author === user.name;
}

/**
 * 把用户输入转成 LIKE 字面量：转义反斜杠本身、% 与 _，并统一配 ESCAPE '\' 使用。
 * 不转义时用户输入单个 % 会匹配全库，等于绕过权限过滤之外的业务过滤。
 */
export function escapeLike(input: string): string {
  return String(input ?? '').replace(/[\\%_]/g, '\\$&');
}

export const LIKE_ESCAPE_SQL = `ESCAPE '\\'`;
