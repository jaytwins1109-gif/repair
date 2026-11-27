import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { LlmCall, LlmConfig, LlmConfigInput, LlmPlatform, LlmRuntime } from '../api/types';
import { Icon } from '../components/Icon';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';

const PLATFORM_LABELS: Record<LlmPlatform, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI 兼容',
  custom: '自定义',
};

const PLATFORM_DEFAULTS: Record<LlmPlatform, { base_url: string; model: string }> = {
  deepseek: { base_url: 'https://api.deepseek.com', model: 'deepseek-flash' },
  openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { base_url: '', model: '' },
};

/** 内置默认系统提示词（与后端 llm.ts 的 DEFAULT_SYSTEM_PROMPT 保持一致；留空保存即回退到此值） */
const DEFAULT_SYSTEM_PROMPT = [
  '你是“服务器主板维修专家助手”。你的任务是基于系统知识库提供的真实维修案例，回答技术员的问题。',
  '你的回复必须遵循以下原则：',
  '1. 【专业且精炼】你的语气必须像一个资深硬件工程师，客观、严谨、直击要害。不使用废话、客套话或过于活泼的语气。',
  '2. 【严禁幻觉】你只能基于【系统提供的案例】进行总结和回答。如果案例中没提到某配件，你就明确说“案例中未提及该配件”，绝不能依靠通用知识去编造。',
  '3. 【结构化输出】总结方案时，尽量使用列表，按“故障现象 -> 诊断过程 -> 解决方案 -> 涉及配件”的结构输出。',
  '4. 【对话引导】如果用户的问题过于模糊（如只说了型号没说现象），请主动追问：“请描述具体的故障现象（如无法开机、风扇异常、报错代码等）。”',
].join('\n');

function emptyForm(): LlmConfigInput {
  return {
    name: '',
    platform: 'deepseek',
    base_url: PLATFORM_DEFAULTS.deepseek.base_url,
    api_key: '',
    model: PLATFORM_DEFAULTS.deepseek.model,
    temperature: 0.2,
    max_tokens: 1024,
    timeout_seconds: 20,
    thinking_enabled: false,
    system_prompt: '',
    enabled: true,
  };
}

export function ModelsAdminPage() {
  const { isAdmin } = useRole();
  const toast = useToast();
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [runtime, setRuntime] = useState<LlmRuntime | null>(null);
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<LlmConfigInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    return Promise.all([
      api.listLlmConfigs(),
      api.getLlmRuntime(),
      isAdmin ? api.listLlmCalls(30) : Promise.resolve([] as LlmCall[]),
    ])
      .then(([list, rt, logs]) => {
        setConfigs(list);
        setRuntime(rt);
        setCalls(logs);
      })
      .catch((e: any) => toast(e.message || '加载模型配置失败', 'error'))
      .finally(() => setLoading(false));
  }, [isAdmin, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const openEdit = (c: LlmConfig) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      platform: c.platform,
      base_url: c.base_url,
      api_key: '',
      model: c.model,
      temperature: c.temperature,
      max_tokens: c.max_tokens,
      timeout_seconds: c.timeout_seconds ?? 20,
      thinking_enabled: c.thinking_enabled ?? false,
      system_prompt: c.system_prompt || '',
      enabled: c.enabled,
    });
  };

  const switchPlatform = (platform: LlmPlatform) => {
    setForm((prev) => {
      if (!prev) return prev;
      const defaults = PLATFORM_DEFAULTS[platform];
      return {
        ...prev,
        platform,
        base_url: defaults.base_url || prev.base_url,
        model: defaults.model || prev.model,
      };
    });
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return toast('请填写配置名称', 'error');
    if (!(form.api_key || '').trim() && editingId === null) return toast('请填写 API Key', 'error');
    setSaving(true);
    try {
      if (editingId === null) await api.createLlmConfig(form);
      else await api.updateLlmConfig(editingId, form);
      toast('配置已保存');
      setForm(null);
      await refresh();
    } catch (e: any) {
      toast(e.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const doActivate = async (id: number) => {
    try {
      await api.activateLlmConfig(id);
      toast('已切换当前生效配置');
      await refresh();
    } catch (e: any) {
      toast(e.message || '切换失败', 'error');
    }
  };

  const doDelete = async (id: number) => {
    if (!window.confirm('确认删除该模型配置？')) return;
    try {
      await api.deleteLlmConfig(id);
      toast('配置已删除');
      await refresh();
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  const doTest = async (id: number) => {
    setTestingId(id);
    try {
      const result = await api.testLlmConfig(id);
      if (result.ok) toast('连接成功，模型可用');
      else toast(result.message || '连接失败', 'error');
    } catch (e: any) {
      toast(e.message || '测试连接失败', 'error');
    } finally {
      setTestingId(null);
    }
  };

  const toggleEnabled = async (enabled: boolean) => {
    try {
      await api.setLlmEnabled(enabled);
      toast(enabled ? '已开启对话检索大模型' : '已关闭，对话检索使用规则匹配');
      await refresh();
    } catch (e: any) {
      toast(e.message || '保存失败', 'error');
    }
  };

  const saveLimit = async (limit: number) => {
    try {
      await api.setLlmDailyLimit(limit);
      toast('每日上限已保存');
      await refresh();
    } catch (e: any) {
      toast(e.message || '保存失败', 'error');
    }
  };

  if (loading) {
    return <div className="grid h-full place-items-center text-[13px] text-muted">加载模型配置…</div>;
  }

  return (
    <div className="engineering-grid h-full overflow-y-auto px-9 py-8">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 font-mono text-[10.5px] tracking-[.2em] text-accent">AI MODEL / 模型管理</div>
            <h1 className="m-0 font-display text-[28px] font-bold">大模型配置</h1>
            <p className="mt-2 max-w-[620px] text-[13px] leading-[1.8] text-muted">
              配置 OpenAI 兼容的大模型接口，用于对话检索的条件抽取。密钥仅存服务端并脱敏显示；检索始终只返回知识库中真实存在的案例。
            </p>
            <p className="mt-2 max-w-[620px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] leading-[1.7] text-muted">
              密钥不会随备份导出：备份会清空 llm_configs.api_key。换机器或用备份恢复之后，需要在这里重新填写 API Key。
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreate}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[12.5px] text-white hover:bg-accent-dark"
            >
              <Icon name="plus" className="h-4 w-4" /> 新增配置
            </button>
          )}
        </div>

        {!isAdmin && (
          <div className="mb-5 rounded-lg border border-line bg-surface-2 px-4 py-3 text-[12px] text-muted">
            当前账号为技术员，模型配置为只读；如需修改请联系工程师。
          </div>
        )}

        <Section title="对话检索总开关" hint="关闭后对话检索完全使用规则关键词匹配">
          <div className="rounded-xl border border-line bg-surface p-5">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={runtime?.llm_enabled ?? false}
                disabled={!isAdmin}
                onChange={(e) => void toggleEnabled(e.target.checked)}
              />
              <span>
                <b className="block text-[13px] text-ink">启用大模型条件抽取（默认开启）</b>
                <small className="mt-1 block text-[11.5px] leading-[1.7] text-muted">
                  开启后，对话检索先用大模型理解故障描述、抽取检索条件；未配置密钥、调用失败或超限时自动回退规则匹配。抽取只产出检索条件，不产生结论。
                </small>
              </span>
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4 text-[12px]">
              <span className="text-muted">
                当前生效：
                <b className="ml-1 text-ink">{runtime?.active_config?.name || '无'}</b>
              </span>
              <span className="text-muted">
                今日调用：
                <b className="ml-1 font-mono text-ink">{runtime?.today_calls ?? 0}</b>
              </span>
              <span className="text-muted">
                硬盘缓存命中率：
                {runtime?.cache_stats && runtime.cache_stats.hit_rate !== null ? (
                  <>
                    <b className="ml-1 font-mono text-accent">{runtime.cache_stats.hit_rate}%</b>
                    <small className="ml-1 font-mono text-[10px] text-muted">
                      (hit {runtime.cache_stats.prompt_cache_hit_tokens} / miss {runtime.cache_stats.prompt_cache_miss_tokens})
                    </small>
                  </>
                ) : (
                  <b className="ml-1 font-mono text-[11px] text-muted" title="DeepSeek 尚未在响应中返回缓存统计字段">未采集</b>
                )}
              </span>
              <label className="flex items-center gap-2 text-muted">
                每日上限：
                <input
                  type="number"
                  min={1}
                  max={100000}
                  defaultValue={runtime?.daily_limit ?? 500}
                  key={runtime?.daily_limit ?? 500}
                  disabled={!isAdmin}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== runtime?.daily_limit && v > 0) void saveLimit(v);
                  }}
                  className="w-24 rounded border border-line bg-white px-2 py-1 font-mono text-[12px] text-ink"
                />
              </label>
            </div>
          </div>
        </Section>

        <Section title="配置列表" hint="可配置多套，一键切换当前生效">
          {configs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[12px] text-muted">
              暂无配置，点击「新增配置」开始
            </div>
          ) : (
            <div className="grid gap-3">
              {configs.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-xl border bg-surface p-5 ${c.is_active ? 'border-accent' : 'border-line'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <b className="text-[14px] text-ink">{c.name}</b>
                        {c.is_active && <Tag tone="accent">当前生效</Tag>}
                        {!c.enabled && <Tag>已停用</Tag>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted">
                        <span>平台：{PLATFORM_LABELS[c.platform]}</span>
                        <span>模型：{c.model}</span>
                        <span>密钥：{c.has_api_key ? c.api_key_masked : '未配置'}</span>
                        <span>温度：{c.temperature}</span>
                        <span>Max Tokens：{c.max_tokens}</span>
                        <span>超时：{c.timeout_seconds ?? 20}s</span>
                        <span>思考：{c.thinking_enabled ? '开启' : '关闭'}</span>
                      </div>
                      <div className="mt-1 break-all font-mono text-[10.5px] text-muted">Base URL：{c.base_url}</div>
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={testingId === c.id}
                          onClick={() => void doTest(c.id)}
                          className="rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-ink hover:border-accent disabled:opacity-50"
                        >
                          {testingId === c.id ? '测试中…' : '测试连接'}
                        </button>
                        {!c.is_active && c.enabled && (
                          <button
                            type="button"
                            onClick={() => void doActivate(c.id)}
                            className="rounded-lg border border-accent px-3 py-1.5 text-[11.5px] text-accent"
                          >
                            设为生效
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-ink hover:border-accent"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => void doDelete(c.id)}
                          className="rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-bad hover:border-bad"
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {isAdmin && (
          <Section title="调用日志" hint="最近 30 条，含测试连接与条件抽取">
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <table className="w-full border-collapse text-left text-[11.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-[10.5px] text-muted">
                    <th className="px-3 py-2.5 font-medium">时间</th>
                    <th className="px-3 py-2.5 font-medium">类型</th>
                    <th className="px-3 py-2.5 font-medium">模型</th>
                    <th className="px-3 py-2.5 font-medium">工号</th>
                    <th className="px-3 py-2.5 font-medium">耗时</th>
                    <th className="px-3 py-2.5 font-medium">缓存 hit/miss</th>
                    <th className="px-3 py-2.5 font-medium">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted">暂无调用记录</td>
                    </tr>
                  ) : (
                    calls.map((c) => (
                      <tr key={c.id} className="border-b border-line/60 last:border-0" title={c.error || ''}>
                        <td className="px-3 py-2 font-mono text-[10.5px] text-muted">{c.created_at}</td>
                        <td className="px-3 py-2 text-ink">{c.kind === 'extract' ? '条件抽取' : '测试连接'}</td>
                        <td className="px-3 py-2 font-mono text-[10.5px] text-ink">{c.model}</td>
                        <td className="px-3 py-2 font-mono text-[10.5px] text-muted">{c.user_emp_no || '—'}</td>
                        <td className="px-3 py-2 font-mono text-[10.5px] text-muted">{c.latency_ms}ms</td>
                        <td className="px-3 py-2 font-mono text-[10.5px]">
                          {c.prompt_cache_hit_tokens >= 0 && c.prompt_cache_miss_tokens >= 0 ? (
                            <span className="text-ink">{c.prompt_cache_hit_tokens}/{c.prompt_cache_miss_tokens}</span>
                          ) : (
                            <span className="text-muted" title="接口未返回缓存统计字段">未采集</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.success ? <Tag tone="ok">成功</Tag> : <Tag tone="bad">失败</Tag>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4" onClick={() => setForm(null)}>
          <div
            className="w-full max-w-[560px] rounded-xl border border-line bg-surface p-6 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="m-0 font-display text-[18px] font-bold">{editingId === null ? '新增模型配置' : '编辑模型配置'}</h2>
              <button type="button" onClick={() => setForm(null)} className="text-muted hover:text-ink">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-4">
              <Field label="配置名称">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：DeepSeek 生产环境"
                  className={inputCls}
                />
              </Field>
              <Field label="平台">
                <select
                  value={form.platform}
                  onChange={(e) => switchPlatform(e.target.value as LlmPlatform)}
                  className={inputCls}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI 兼容</option>
                  <option value="custom">自定义</option>
                </select>
              </Field>
              <Field label="Base URL" hint="OpenAI 兼容接口根地址，不含 /chat/completions">
                <input
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  placeholder="https://api.deepseek.com"
                  className={inputCls}
                />
              </Field>
              <Field label="模型名称">
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="deepseek-flash"
                  className={inputCls}
                />
              </Field>
              <Field
                label="API Key"
                hint={editingId === null ? '仅存服务端并脱敏显示' : '留空表示不修改现有密钥'}
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  name="llm-api-key-new"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={editingId === null ? 'sk-...' : '留空不修改'}
                  className={inputCls}
                />
              </Field>
              <Field
                label="系统提示词（System Prompt）"
                hint="注入到每次大模型调用（条件抽取与对话总结都会带上）。留空即使用内置默认的专业维修工程师人设。"
              >
                <textarea
                  rows={7}
                  value={form.system_prompt || ''}
                  onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                  placeholder={DEFAULT_SYSTEM_PROMPT}
                  className={inputCls + ' resize-y leading-[1.6]'}
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, system_prompt: DEFAULT_SYSTEM_PROMPT })}
                  className="mt-2 rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-ink hover:border-accent"
                >
                  恢复默认值
                </button>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="温度 (0-1)">
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={1}
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Max Tokens">
                  <input
                    type="number"
                    min={64}
                    max={4096}
                    value={form.max_tokens}
                    onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
              </div>
              <p className="m-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[10.5px] leading-[1.7] text-muted">
                价格档位提示：DeepSeek flash（deepseek-flash）与 v4-pro 单价差异很大。本项目只做关键词抽取，建议保持 flash，不要切 pro；deepseek-chat 官方文档已标注停用，请勿使用；Max Tokens 默认 300 已够用，避免超长输出浪费。
              </p>
              <Field label="超时秒数" hint="默认 20 秒；所有模型调用与测试连接都读这个值">
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={form.timeout_seconds}
                  onChange={(e) => setForm({ ...form, timeout_seconds: Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
              <label className="flex items-start gap-2 text-[12.5px] text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={form.thinking_enabled}
                  onChange={(e) => setForm({ ...form, thinking_enabled: e.target.checked })}
                />
                <span>
                  开启思考模式
                  <small className="mt-1 block text-[10.5px] leading-[1.6] text-muted">
                    默认关闭（关键词抽取不需要推理，关闭可省延迟与 token）。仅 DeepSeek 平台生效；OpenAI 兼容/自定义不带此私有参数。
                  </small>
                </span>
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                启用该配置
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-lg border border-line px-4 py-2 text-[12.5px] text-ink"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-accent px-5 py-2 text-[12.5px] text-white disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-accent';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] leading-[1.6] text-muted">{hint}</span>}
    </label>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: 'accent' | 'ok' | 'bad' }) {
  const cls =
    tone === 'accent'
      ? 'border-accent/30 bg-accent-soft text-accent'
      : tone === 'ok'
        ? 'border-ok/30 bg-ok/10 text-ok'
        : tone === 'bad'
          ? 'border-bad/30 bg-bad/10 text-bad'
          : 'border-line bg-surface-2 text-muted';
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${cls}`}>{children}</span>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="m-0 font-display text-[15px] font-bold">{title}</h2>
        <span className="text-[11px] text-muted">{hint}</span>
      </div>
      {children}
    </section>
  );
}
