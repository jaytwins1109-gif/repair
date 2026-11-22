import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, type UserRow } from '../db';
import { requireAuth } from '../middleware/auth';
import { fail, ok } from '../response';
import { createSession, revokeSession, tokenFromHeader } from '../services/auth';

const router = Router();

function publicUser(user: UserRow) {
  return {
    id: user.id,
    emp_no: user.emp_no,
    name: user.name,
    role: user.role,
    position: user.position,
  };
}

router.post('/auth/login', (req, res) => {
  try {
    const empNo = String(req.body?.emp_no || '').trim();
    const password = String(req.body?.password || '');

    if (!empNo || !password) {
      return fail(res, '工号或密码不正确');
    }

    const user = db.prepare('SELECT * FROM users WHERE emp_no = ?').get(empNo) as
      | UserRow
      | undefined;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return fail(res, '工号或密码不正确');
    }

    const token = createSession(user.id, user.emp_no);
    return ok(res, { token, user: publicUser(user) }, '登录成功');
  } catch (e: any) {
    return fail(res, e.message || '登录失败');
  }
});

router.post('/auth/logout', requireAuth, (req, res) => {
  try {
    revokeSession(tokenFromHeader(req.headers.authorization));
    return ok(res, null, '已退出登录');
  } catch (e: any) {
    return fail(res, e.message || '退出失败');
  }
});

router.get('/auth/me', requireAuth, (req, res) => {
  return ok(res, req.user);
});

export default router;
