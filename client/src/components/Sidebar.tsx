import { NAV_ITEMS, type PageKey } from '../navigation';
import { useSessions } from '../hooks/useSessions';
import { Icon } from './Icon';

export function Sidebar({
  current,
  onNavigate,
  pendingCount,
}: {
  current: PageKey;
  onNavigate: (key: PageKey) => void;
  pendingCount: number;
}) {
  return (
    <aside className="sidebar-grid relative z-10 flex h-screen w-[220px] shrink-0 flex-col overflow-hidden bg-graphite text-[#C7CDD6]">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(216,91,42,.16),transparent_68%)]" />

      <div className="relative flex items-center gap-3 border-b border-white/[.085] px-5 py-[22px]">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] border border-accent/55 bg-accent/10 text-accent">
          <Icon name="board" className="h-[21px] w-[21px]" />
        </div>
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold leading-tight text-[#F5F6F7]">
            主板维修助手
          </div>
          <div className="mt-[3px] font-mono text-[9.5px] tracking-[.14em] text-[#7D8794]">
            REPAIR AGENT
          </div>
        </div>
      </div>

      <nav className="relative flex-1 space-y-1 overflow-y-auto px-3 py-[18px]">
        <div className="mb-[9px] px-[10px] font-mono text-[9.5px] tracking-[.18em] text-[#626C79]">
          WORKSPACE
        </div>
        {NAV_ITEMS.map((item) => {
          const active = current === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              className={`relative flex w-full items-center gap-3 rounded-lg border px-3 py-[10px] text-left text-[13px] font-medium transition-colors ${
                active
                  ? 'border-accent/30 bg-accent/[.14] text-[#F8EDE7]'
                  : 'border-transparent text-[#A7AFBA] hover:bg-white/[.06] hover:text-white'
              }`}
            >
              {active && (
                <span className="absolute -left-3 top-[9px] bottom-[9px] w-[3px] rounded-r bg-accent" />
              )}
              <Icon name={item.icon} className="h-[17px] w-[17px] shrink-0" />
              <span>{item.label}</span>
              {item.key === 'pending' && pendingCount > 0 && (
                <span className="ml-auto rounded-full bg-accent px-[7px] py-[2px] font-mono text-[10px] leading-normal text-white">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}

        <SessionList onNavigate={onNavigate} />
      </nav>

      <div className="relative border-t border-white/[.085] px-[18px] py-4">
        <div className="flex justify-between font-mono text-[9.5px] tracking-[.05em] text-[#59626E]">
          <span>LOCAL DEMO · v1.0</span>
          <span>AUTH ENABLED</span>
        </div>
        <div className="mt-2 font-mono text-[9.5px] text-[#59626E]">
          规则检索引擎 · SQLite
        </div>
      </div>
    </aside>
  );
}

/** 会话列表：按后端 updated_at 倒序；新建、切换、重命名、删除（二次确认） */
function SessionList({ onNavigate }: { onNavigate: (key: PageKey) => void }) {
  const { sessions, activeId, loading, select, create, rename, remove } = useSessions();

  return (
    <div className="mt-4 border-t border-white/[.085] pt-4">
      <div className="mb-2 flex items-center justify-between px-[10px]">
        <span className="font-mono text-[9.5px] tracking-[.18em] text-[#626C79]">会话记录</span>
        <button
          type="button"
          onClick={() => void create()}
          title="新建会话（保持引导空状态）"
          className="rounded border border-white/10 px-[7px] py-[2px] font-mono text-[10px] text-[#A7AFBA] transition-colors hover:border-accent/50 hover:text-accent"
        >
          ＋ 新建
        </button>
      </div>

      <div className="max-h-[34vh] space-y-[3px] overflow-y-auto pr-1">
        {loading && (
          <div className="px-[10px] py-2 font-mono text-[10px] text-[#626C79]">正在载入会话…</div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="px-[10px] py-2 text-[11px] leading-[1.6] text-[#626C79]">
            暂无历史会话，直接提问即可自动创建
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1 rounded-lg border px-2 py-[7px] transition-colors ${
              activeId === s.id
                ? 'border-accent/30 bg-accent/[.14]'
                : 'border-transparent hover:bg-white/[.06]'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                select(s.id);
                onNavigate('chat');
              }}
              title={s.title}
              className={`min-w-0 flex-1 truncate text-left text-[11.5px] ${
                activeId === s.id ? 'text-[#F8EDE7]' : 'text-[#A7AFBA]'
              }`}
            >
              {s.title}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = window.prompt('重命名会话', s.title);
                if (next && next.trim()) void rename(s.id, next.trim());
              }}
              title="重命名"
              className="shrink-0 px-[3px] text-[11px] text-[#7D8794] hover:text-accent"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `确定删除会话「${s.title}」？该会话下的全部消息也会一并删除，且不可撤销。`
                  )
                ) {
                  void remove(s.id);
                }
              }}
              title="删除会话"
              className="shrink-0 px-[3px] text-[12px] text-[#7D8794] hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
