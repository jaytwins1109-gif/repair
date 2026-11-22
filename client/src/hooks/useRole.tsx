import type { Case, Role } from '../api/types';
import { useAuth } from './useAuth';

export function useRole() {
  const { user } = useAuth();
  const role: Role = user?.role ?? 'technician';

  // 保留 isAdmin 命名以兼容已有页面，实际对应 engineer 角色
  const isAdmin = role === 'engineer';

  const canEditCase = (item: Pick<Case, 'author' | 'status'>) =>
    isAdmin ||
    (item.author === user?.name &&
      (item.status === 'pending' || item.status === 'rejected'));

  return {
    role,
    user,
    isAdmin,
    isEngineer: isAdmin,
    isTechnician: !isAdmin,
    canEditCase,
    canReview: isAdmin,
    canManageCatalog: isAdmin,
  };
}
