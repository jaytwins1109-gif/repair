import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../db';
import { fail } from '../response';
import { getUserByToken, tokenFromHeader } from '../services/auth';

export interface AuthUser {
  id: number;
  emp_no: string;
  name: string;
  role: UserRole;
  position: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const user = getUserByToken(tokenFromHeader(req.headers.authorization) || queryToken);
  if (!user) {
    return fail(res, '登录状态已失效，请重新登录', 401, 401);
  }
  req.user = {
    id: user.id,
    emp_no: user.emp_no,
    name: user.name,
    role: user.role,
    position: user.position,
  };
  return next();
}

export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    return requireAuth(req, res, () => {
      if (req.user!.role !== role) {
        return fail(res, '当前账号无权限执行此操作', 403, 403);
      }
      return next();
    });
  };
}
