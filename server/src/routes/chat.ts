import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { ok, fail } from '../response';
import { chatSearchSmart } from '../services/chat';

const router = Router();

router.post('/chat', requireAuth, async (req, res) => {
  try {
    const raw = req.body?.message;
    if (!raw || !String(raw).trim()) return fail(res, '请输入故障描述');
    const result = await chatSearchSmart(String(raw), req.user!.emp_no);
    return ok(res, result);
  } catch (e: any) {
    return fail(res, e.message || '检索失败');
  }
});

export default router;
