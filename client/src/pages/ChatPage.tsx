import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type {
  ChatAskResult,
  ChatKeywords,
  ChatResult,
  ScoreTrace,
  ScoredCase,
  StoredChatMessage,
} from '../api/types';
import { useSessions } from '../hooks/useSessions';
import { CaseCard } from '../components/CaseCard';
import { Icon } from '../components/Icon';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  time: string;
  cases?: ScoredCase[];
  /** 弱相关单独一组，默认折叠，不混入主列表 */
  weakCases?: ScoredCase[];
  keywords?: ChatKeywords;
  error?: boolean;
  source?: 'ai' | 'rule' | 'cache';
  fallbackReason?: string;
  matchDetail?: string[];
  normalizedSymptoms?: string[];
  cacheHits?: number;
  route?: 'dict' | 'llm' | 'cache';
  scoreTrace?: ScoreTrace;
}

const SUGGESTIONS = [
  '联想 SR650 客户华为 开机无显示，风扇满转',
  '戴尔 R740 开机无显示',
  '华为 服务器开机无显示',
  '内存报错 风扇满转',
];

const FIELD_LABEL: Record<string, string> = {
  model: '机型40',
  customer: '客户30',
  symptom: '现象20',
  extra: '补充6',
};

const now = () =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const stamp = (iso: string) => (iso && iso.length >= 16 ? iso.slice(11, 16) : now());

/** 历史消息：用落库的 meta_json 把整条气泡原样还原，而不是只留一段文字 */
function fromStored(m: StoredChatMessage): Message {
  if (m.role === 'user') {
    return { id: m.id, role: 'user', text: m.content, time: stamp(m.created_at) };
  }
  const meta = (m.meta || {}) as Partial<ChatResult>;
  return {
    id: m.id,
    role: 'assistant',
    text: m.content,
    time: stamp(m.created_at),
    cases: meta.cases,
    weakCases: meta.weakCases,
    keywords: meta.keywords,
    source: meta.source,
    fallbackReason: meta.fallbackReason,
    matchDetail: meta.matchDetail,
    normalizedSymptoms: meta.normalizedSymptoms,
    cacheHits: meta.cacheHits,
    route: meta.route,
    scoreTrace: meta.scoreTrace,
  };
}

function fromResult(r: ChatAskResult, text: string): Message[] {
  return [
    { id: r.user_message_id, role: 'user', text, time: now() },
    {
      id: r.assistant_message_id,
      role: 'assistant',
      text: r.summary,
      time: now(),
      cases: r.cases,
      weakCases: r.weakCases,
      keywords: r.keywords,
      source: r.source,
      fallbackReason: r.fallbackReason,
      matchDetail: r.matchDetail,
      normalizedSymptoms: r.normalizedSymptoms,
      cacheHits: r.cacheHits,
      route: r.route,
      scoreTrace: r.scoreTrace,
    },
  ];
}

export function ChatPage({
  onOpenCase,
}: {
  onOpenCase: (item: ScoredCase) => void;
}) {
  const { activeId, create, refresh } = useSessions();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const loading = sending;
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // 会话状态在 AppShell 常驻层；切导航页卸载本组件后，回来按 session_id 重新拉回全部气泡
  useEffect(() => {
    let cancelled = false;
    if (!activeId) {
      setMessages([]);
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    api
      .getSessionMessages(activeId)
      .then((rows) => {
        if (!cancelled) setMessages(rows.map(fromStored));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;

    const tempId = -Date.now();
    setMessages((prev) => [...prev, { id: tempId, role: 'user', text, time: now() }]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setSending(true);

    try {
      let sid = activeId;
      if (!sid) sid = await create();
      if (!sid) throw new Error('无法创建会话');
      const result = await api.ask(sid, text);
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId), ...fromResult(result, text)]);
      void refresh();
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now(),
          role: 'assistant',
          text: `检索失败：${e.message || '未知错误'}`,
          time: now(),
          cases: [],
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={threadRef}
        className="engineering-grid flex-1 overflow-y-auto px-[34px] pb-4 pt-[30px]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 92% 4%,rgba(216,91,42,.055),transparent 30%),linear-gradient(rgba(27,32,39,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(27,32,39,.032) 1px,transparent 1px)',
          backgroundSize: 'auto,30px 30px,30px 30px',
        }}
      >
        {loadingHistory ? (
          <div className="mx-auto mt-[8vh] max-w-[900px] font-mono text-[11px] tracking-[.12em] text-muted">
            正在恢复会话记录…
          </div>
        ) : messages.length === 0 ? (
          <Welcome onPick={send} />
        ) : (
          <div className="mx-auto max-w-[900px]">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="animate-rise mb-[26px] flex flex-row-reverse gap-[13px]">
                  <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-graphite font-mono text-[12px] font-bold text-white">
                    我
                  </div>
                  <div className="max-w-[84%] min-w-0">
                    <div className="rounded-xl rounded-br-[3px] bg-graphite px-[17px] py-[13px] text-[13.5px] leading-[1.8] text-[#F2F4F6]">
                      {m.text}
                    </div>
                    <div className="mt-[7px] px-[3px] text-right font-mono text-[10px] text-[#A6ACB4]">
                      {m.time}
                    </div>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="animate-rise mb-[26px] flex gap-[13px]">
                  <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] border border-accent/25 bg-accent-soft text-accent">
                    <Icon name="board" className="h-[18px] w-[18px]" />
                  </div>
                  <div className="max-w-[min(760px,88%)] min-w-0">
                    <div className="rounded-xl rounded-bl-[3px] border border-line bg-surface px-[17px] py-[13px] shadow-card">
                      <div className="mb-[6px] flex items-center gap-2 font-mono text-[10px] tracking-[.12em] text-accent">
                        <span>{m.error ? 'RETRIEVAL ERROR' : 'MBR KNOWLEDGE BASE'}</span>
                        {!m.error && m.source && (
                          <span
                            className={`rounded px-1.5 py-0.5 tracking-normal ${
                              m.source === 'ai'
                                ? 'bg-accent-soft text-accent'
                                : m.source === 'cache'
                                  ? 'bg-[#E8F0E4] text-[#3C7A2E]'
                                  : 'bg-[#EFECE5] text-[#5E6670]'
                            }`}
                            title={
                              m.source === 'cache'
                                ? `本地查询缓存，已复用 ${m.cacheHits ?? 1} 次，未调用大模型`
                                : m.fallbackReason ||
                                  (m.source === 'ai' ? '由大模型抽取检索条件' : '由词典/关键词表匹配，未花钱')
                            }
                          >
                            {m.source === 'ai' ? 'AI 解析' : m.source === 'cache' ? `缓存结果 · 复用${m.cacheHits ?? 1}次` : '关键词匹配'}
                          </span>
                        )}
                        {!m.error && m.route === 'dict' && m.source !== 'cache' && (
                          <span className="rounded bg-[#E8F0E4] px-1.5 py-0.5 tracking-normal text-[#3C7A2E]" title="前置拦截：现象词已被词典覆盖，未调用模型">
                            本地拦截 · 0 成本
                          </span>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap text-[13.5px] leading-[1.8] text-ink">
                        {m.text}
                      </div>
                      {m.fallbackReason && (
                        <div className="mt-1.5 font-mono text-[10px] leading-[1.6] text-muted">
                          已自动回退：{m.fallbackReason}
                        </div>
                      )}
                    </div>

                    {m.keywords && (m.keywords.model || m.keywords.customer || m.keywords.symptoms.length > 0) && (
                      <div className="mt-[9px] flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        <span>识别到</span>
                        {m.keywords.model && <Pill>型号：{m.keywords.model}</Pill>}
                        {m.keywords.customer && <Pill>客户：{m.keywords.customer}</Pill>}
                        {m.normalizedSymptoms && m.normalizedSymptoms.length > 0
                          ? m.normalizedSymptoms.map((s) => (
                              <Pill key={s} tone="accent">归一化现象：{s}</Pill>
                            ))
                          : m.keywords.symptoms.map((s) => (
                              <Pill key={s}>现象：{s}</Pill>
                            ))}
                      </div>
                    )}

                    {m.matchDetail && m.matchDetail.length > 0 && (
                      <div className="mt-[8px] rounded-[10px] border border-accent/20 bg-accent-soft/50 px-3 py-2 text-[11px] leading-[1.7] text-[#5E6670]">
                        <span className="font-mono text-[10px] tracking-[.08em] text-accent">命中说明：</span>
                        {m.matchDetail.join('、')}
                      </div>
                    )}

                    {m.scoreTrace && m.scoreTrace.tokens.length > 0 && (
                      <details className="mt-[8px] rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[11px]">
                        <summary className="cursor-pointer font-mono text-[10px] tracking-[.06em] text-accent">
                          算分明细（案例 #{m.scoreTrace.caseId}）：{m.scoreTrace.formula} · 可手动复算
                        </summary>
                        <div className="mt-2 grid gap-1">
                          {m.scoreTrace.tokens.map((t, i) => (
                            <div key={i} className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-1 font-mono text-[10.5px]">
                              <span className={t.hit ? 'text-ok' : 'text-muted'}>
                                {t.hit ? '✓' : '✗'} {t.label}
                                {t.hitVariant && <span className="text-muted"> [{t.hitVariant}]</span>}
                              </span>
                              <span className="text-muted">
                                {t.hit ? t.weight : 0} / {t.weight}（{FIELD_LABEL[t.field]}）
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-line pt-1 text-right font-mono text-[10.5px] text-ink">
                            命中 {m.scoreTrace.hitWeight} ÷ 总 {m.scoreTrace.totalWeight} × 100 = {m.scoreTrace.formula.split('= ')[1]}
                          </div>
                        </div>
                      </details>
                    )}

                    {m.cases && m.cases.length > 0 ? (
                      m.cases.map((item) => (
                        <CaseCard key={item.id} item={item} onOpen={onOpenCase} />
                      ))
                    ) : (
                      !m.error && (!m.weakCases || m.weakCases.length === 0) && (
                        <div className="mt-[11px] rounded-[10px] border border-dashed border-line bg-surface-2 px-4 py-4 text-[12.5px] leading-[1.8] text-muted">
                          知识库中未找到相似案例，建议上传现场记录。
                        </div>
                      )
                    )}

                    {m.weakCases && m.weakCases.length > 0 && (
                      <details className="mt-[11px] rounded-[10px] border border-dashed border-line bg-surface-2 px-3 py-2">
                        <summary className="cursor-pointer font-mono text-[10px] tracking-[.06em] text-muted">
                          弱相关，仅供参考（{m.weakCases.length} 条，展开查看）
                        </summary>
                        <div className="mt-2 grid gap-2">
                          {m.weakCases.map((item) => (
                            <CaseCard key={`weak-${item.id}`} item={item} onOpen={onOpenCase} />
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="mt-[7px] px-[3px] font-mono text-[10px] text-[#A6ACB4]">
                      {m.time}
                    </div>
                  </div>
                </div>
              )
            )}

            {loading && (
              <div className="mb-[26px] flex gap-[13px]">
                <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] border border-accent/25 bg-accent-soft text-accent">
                  <Icon name="search" className="h-[18px] w-[18px]" />
                </div>
                <div className="rounded-xl rounded-bl-[3px] border border-line bg-surface px-[17px] py-[13px] shadow-card">
                  <div className="typing flex gap-[5px] py-[6px]">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-white/92 px-[34px] pb-5 pt-[15px] backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-end gap-3 rounded-xl border border-line bg-surface p-[9px] pl-[15px] shadow-card transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder="描述故障现象，例如：联想 SR650 客户华为 开机无显示，风扇满转…"
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            className="max-h-[120px] min-h-[26px] flex-1 resize-none border-0 bg-transparent py-[5px] text-[13.5px] leading-[1.7] text-ink outline-none placeholder:text-[#AEB4BC]"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            title="发送"
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[9px] bg-accent text-white transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="send" className="h-[17px] w-[17px]" />
          </button>
        </div>
        <div className="mx-auto mt-2 max-w-[900px] text-center font-mono text-[10px] tracking-[.03em] text-[#A8AEB6]">
          ENTER 发送 · SHIFT + ENTER 换行 · 检索范围仅限已存档案例
        </div>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="relative mx-auto mt-[4vh] max-w-[820px] px-2 pb-[30px] pt-[22px]">
      <div className="pointer-events-none absolute -top-[46px] right-[-6px] select-none font-display text-[180px] font-bold leading-none tracking-[-.06em] text-[#1B2027]/[.035]">
        01
      </div>
      <div className="mb-6 grid h-[54px] w-[54px] place-items-center rounded-[13px] border border-accent/40 bg-accent-soft text-accent">
        <Icon name="board" className="h-7 w-7" />
      </div>
      <div className="mb-[14px] font-mono text-[11px] tracking-[.24em] text-accent">
        SERVER BOARD · REPAIR KNOWLEDGE
      </div>
      <h1 className="mb-[18px] font-display text-[clamp(32px,4vw,52px)] font-bold leading-[1.18] tracking-[-.02em]">
        描述现象，
        <br />
        <span className="text-accent">调出历史维修记录</span>
      </h1>
      <p className="mb-[30px] max-w-[560px] text-[14px] leading-[1.9] text-muted">
        输入主板型号、客户或故障现象，系统将从已存档案例中检索相似记录，帮助你快速定位问题、回顾处理思路。
      </p>
      <div className="mb-[11px] font-mono text-[10px] tracking-[.14em] text-[#9AA1AA]">
        TRY ASKING / 快捷提问
      </div>
      <div className="flex flex-wrap gap-[9px]">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border border-line bg-surface px-[15px] py-2 text-[12.5px] text-[#4B535E] shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:text-accent"
          >
            <span className="mr-[6px] font-mono text-[10px] text-[#B4BAC2]">
              0{i + 1}
            </span>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone?: 'accent' }) {
  return (
    <span
      className={`rounded px-[7px] py-[3px] font-mono text-[10px] ${
        tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-[#EFECE5] text-[#5E6670]'
      }`}
    >
      {children}
    </span>
  );
}
