import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { ChatSession } from '../api/types';

const ACTIVE_KEY = 'repair-agent-active-session';

interface SessionsContextValue {
  sessions: ChatSession[];
  activeId: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
  create: () => Promise<number | null>;
  select: (id: number | null) => void;
  rename: (id: number, title: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

/**
 * 会话状态放在 AppShell 常驻层（而不是 ChatPage 组件内），
 * 因此切换左侧任何导航页再回来，当前会话都还在；
 * 同时把 id 落到 localStorage，刷新后也能恢复。
 */
export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessions(list);
      const saved = localStorage.getItem(ACTIVE_KEY);
      const savedId = saved ? Number(saved) : null;
      const valid = savedId && list.some((s) => s.id === savedId) ? savedId : null;
      setActiveId(valid);
      if (!valid) localStorage.removeItem(ACTIVE_KEY);
    } catch {
      setSessions([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback((id: number | null) => {
    setActiveId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, String(id));
    else localStorage.removeItem(ACTIVE_KEY);
  }, []);

  const create = useCallback(async () => {
    const session = await api.createSession();
    localStorage.setItem(ACTIVE_KEY, String(session.id));
    setActiveId(session.id);
    await refresh();
    return session.id;
  }, [refresh]);

  const rename = useCallback(
    async (id: number, title: string) => {
      await api.renameSession(id, title);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: number) => {
      await api.deleteSession(id);
      const saved = localStorage.getItem(ACTIVE_KEY);
      if (saved && Number(saved) === id) {
        localStorage.removeItem(ACTIVE_KEY);
        setActiveId(null);
      }
      await refresh();
    },
    [refresh]
  );

  return (
    <SessionsContext.Provider value={{ sessions, activeId, loading, refresh, create, select, rename, remove }}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error('useSessions 必须在 SessionsProvider 内使用');
  return ctx;
}
