import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, SEED_EMP_NOS, type UserRow } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
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

/**
 * 批量修改 10 个种子账号的初始密码（仅工程师）。
 * - 只更新 SEED_EMP_NOS 列出的种子工号，不碰后续新增的非种子账号；
 * - 改的是 password_hash（bcrypt），不删除 sessions，已登录 token 不会失效；
 * - 新库首次建库的初始值由 db/index.ts 的 SEED_INITIAL_PASSWORD 决定，与本接口保持一致。
 */
router.post('/auth/change-initial-password', requireRole('engineer'), (req, res) => {
  try {
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 64) {
      return fail(res, '新密码长度须为 8-64 位');
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    const placeholders = SEED_EMP_NOS.map(() => '?').join(',');
    const result = db
      .prepare(`UPDATE users SET password_hash = ? WHERE emp_no IN (${placeholders})`)
      .run(hash, ...SEED_EMP_NOS);
    return ok(
      res,
      { updated: result.changes, empNos: SEED_EMP_NOS },
      `已将 ${result.changes} 个种子账号的密码改为新密码`
    );
  } catch (e: any) {
    return fail(res, e.message || '修改密码失败');
  }
});

export default router;
