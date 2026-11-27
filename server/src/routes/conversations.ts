import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { ok, fail } from '../response';
import { chatSearchSmart } from '../services/chat';
import { chitchatReply, aggregateIntent, followupIntent } from '../services/intents';

const router = Router();

interface SessionRow {
  id: number;
  user_id: number;
  emp_no: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function ownSession(id: number, empNo: string): SessionRow | undefined {
  return db
    .prepare('SELECT * FROM chat_sessions WHERE id = ? AND emp_no = ?')
    .get(id, empNo) as SessionRow | undefined;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 会话列表：按登录人隔离，最后更新时间倒序 */
router.get('/chat/sessions', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, title, created_at, updated_at FROM chat_sessions WHERE emp_no = ? ORDER BY updated_at DESC, id DESC'
    )
    .all(req.user!.emp_no);
  return ok(res, rows);
});

/** 新建会话：保持引导空状态，标题在第一条提问时自动生成 */
router.post('/chat/sessions', requireAuth, (req, res) => {
  const info = db
    .prepare("INSERT INTO chat_sessions (user_id, emp_no, title) VALUES (?, ?, '新会话')")
    .run(req.user!.id, req.user!.emp_no);
  const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(info.lastInsertRowid);
  return ok(res, row);
});

router.patch('/chat/sessions/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!ownSession(id, req.user!.emp_no)) return fail(res, '会话不存在或无权修改', 403, 403);
  const title = String(req.body?.title || '').trim().slice(0, 60);
  if (!title) return fail(res, '标题不能为空');
  db.prepare("UPDATE chat_sessions SET title = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(
    title,
    id
  );
  return ok(res, { id, title });
});

router.delete('/chat/sessions/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!ownSession(id, req.user!.emp_no)) return fail(res, '会话不存在或无权删除', 403, 403);
  db.transaction(() => {
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  })();
  return ok(res, { id });
});

/** 历史消息：meta_json 解析后原样返回，供前端还原整条气泡 */
router.get('/chat/sessions/:id/messages', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!ownSession(id, req.user!.emp_no)) return fail(res, '会话不存在或无权查看', 403, 403);
  const rows = db
    .prepare('SELECT id, session_id, role, content, meta_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY id')
    .all(id) as Array<{
    id: number;
    session_id: number;
    role: string;
    content: string;
    meta_json: string;
    created_at: string;
  }>;
  return ok(
    res,
    rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      role: r.role,
      content: r.content,
      meta: parseMeta(r.meta_json),
      created_at: r.created_at,
    }))
  );
});

/**
 * 在指定会话里提问：仍然走 chatSearchSmart（本地查询缓存 / 前置拦截 / 0 token 逻辑不变），
 * 把 user 与 assistant 两条消息连同完整检索元数据一起落库。
 */
router.post('/chat/sessions/:id/ask', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const session = ownSession(id, req.user!.emp_no);
  if (!session) return fail(res, '会话不存在或无权提问', 403, 403);
  const text = String(req.body?.message || '').trim();
  if (!text) return fail(res, '请输入故障描述');

  try {
    // ── 技术向对话意图路由（在检索前拦截；不污染 search_cache，不破坏 RAG 红线） ──
    let result: Awaited<ReturnType<typeof chatSearchSmart>> | null = chitchatReply(text);
    if (!result) {
      // 多轮追问：读本会话上一条 assistant 消息的 meta 作为上下文
      const prev = db
        .prepare("SELECT meta_json FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1")
        .get(id) as { meta_json: string } | undefined;
      const prevMeta = prev ? parseMeta(prev.meta_json) : null;
      result = await followupIntent(text, prevMeta, req.user!.emp_no);
    }
    if (!result) result = await aggregateIntent(text, req.user!.emp_no);
    if (!result) result = await chatSearchSmart(text, req.user!.emp_no);

    const existing = db
      .prepare('SELECT count(*) AS c FROM chat_messages WHERE session_id = ?')
      .get(id) as { c: number };
    const title = existing.c === 0 ? text.replace(/\s+/g, ' ').slice(0, 20) : session.title;

    const ids = db.transaction(() => {
      const user = db
        .prepare("INSERT INTO chat_messages (session_id, role, content, meta_json) VALUES (?, 'user', ?, '{}')")
        .run(id, text);
      const assistant = db
        .prepare("INSERT INTO chat_messages (session_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)")
        .run(id, result.summary, JSON.stringify(result));
      db.prepare("UPDATE chat_sessions SET title = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(
        title,
        id
      );
      return {
        user_message_id: Number(user.lastInsertRowid),
        assistant_message_id: Number(assistant.lastInsertRowid),
      };
    })();

    return ok(res, {
      ...result,
      session_id: id,
      session_title: title,
      ...ids,
    });
  } catch (e: any) {
    return fail(res, e.message || '检索失败');
  }
});

export default router;
