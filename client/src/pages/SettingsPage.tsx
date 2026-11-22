import { api } from '../api';
import type { AppSettings } from '../api/types';
import { DictionaryPanel } from '../components/DictionaryPanel';
import { Icon } from '../components/Icon';
import { useToast } from '../hooks/useToast';
import { useRole } from '../hooks/useRole';
import { useEffect, useState, type ReactNode } from 'react';

const ENDPOINTS = [
  ['POST', '/api/auth/login', '工号密码登录'],
  ['POST', '/api/auth/logout', '退出登录'],
  ['GET', '/api/auth/me', '恢复当前登录态'],
  ['GET', '/api/models?q=', '机型列表'],
  ['POST', '/api/models', '新增机型'],
  ['GET', '/api/customers?q=', '客户列表'],
  ['POST', '/api/customers', '新增客户'],
  ['GET', '/api/cases?model=&customer=&status=&source=&q=&page=', '案例列表（含来源筛选/复发角标）'],
  ['GET', '/api/cases/:id/recurrences', '同型号+客户+现象复发历史'],
  ['POST', '/api/cases/purge-samples', '清除全部示例数据（先备份、连带删附件）'],
  ['DELETE', '/api/settings/cache', '清空查询缓存'],
  ['GET', '/api/cases/:id', '案例详情'],
  ['POST', '/api/cases', '提交案例（状态 pending）'],
  ['PUT', '/api/cases/:id', '编辑案例'],
  ['DELETE', '/api/cases/:id', '删除案例'],
  ['POST', '/api/cases/:id/approve', '通过并归档'],
  ['POST', '/api/cases/:id/reject', '驳回'],
  ['POST', '/api/chat', '对话检索（LLM 条件抽取 + 规则兜底）'],
  ['GET', '/api/llm/configs', '模型配置列表（密钥脱敏）'],
  ['POST', '/api/llm/configs', '新增模型配置'],
  ['POST', '/api/llm/configs/:id/test', '测试模型连接'],
  ['POST', '/api/llm/configs/:id/activate', '切换当前生效配置'],
  ['GET', '/api/llm/runtime', '模型开关与今日用量'],
  ['GET', '/api/llm/calls', '模型调用日志'],
];

export function SettingsPage() {
  const { role, isAdmin, user } = useRole();
  const toast = useToast();
  const [health, setHealth] = useState<string>('检测中…');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setHealth(j.code === 0 ? '运行正常' : '异常'))
      .catch(() => setHealth('无法连接'));
    api.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  const toggleAutoApprove = async (enabled: boolean) => {
    setSaving(true);
    try {
      await api.setAutoApprove(enabled);
      setSettings((prev) => (prev ? { ...prev, engineer_auto_approve: enabled } : prev));
      toast('审核设置已保存');
    } catch (e: any) {
      toast(e.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveThreshold = async (value: number) => {
    if (!Number.isFinite(value) || value < 20 || value > 100) return toast('阈值必须是 20-100 的整数', 'error');
    try {
      await api.setMatchThreshold(value);
      setSettings((prev) => (prev ? { ...prev, match_threshold: value } : prev));
      toast('匹配阈值已保存');
    } catch (e: any) {
      toast(e.message || '保存失败', 'error');
    }
  };

  const doClearCache = async () => {
    try {
      const r = await api.clearCache();
      toast(`已清空 ${r.cleared} 条查询缓存`);
      api.getSettings().then(setSettings).catch(() => undefined);
    } catch (e: any) {
      toast(e.message || '清空失败', 'error');
    }
  };

  const doPurgeSamples = async () => {
    if (!window.confirm('二次确认：将删除全部示例数据及其附件，并在删除前自动备份。此操作不可撤销，确定继续？')) return;
    try {
      const r = await api.purgeSamples();
      toast(`已清除 ${r.deleted} 条示例数据${r.backup ? '，备份已生成' : ''}`);
      api.getSettings().then(setSettings).catch(() => undefined);
    } catch (e: any) {
      toast(e.message || '清除失败', 'error');
    }
  };

  return (
    <div className="engineering-grid h-full overflow-y-auto px-9 py-8">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-8">
          <div className="mb-3 font-mono text-[10.5px] tracking-[.2em] text-accent">SYSTEM / 系统设置</div>
          <h1 className="m-0 font-display text-[28px] font-bold">演示说明与系统信息</h1>
          <p className="mt-2 text-[13px] leading-[1.8] text-muted">
            已启用工号登录与服务端角色权限校验，原右上角角色切换开关已移除。
          </p>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-4">
          <Card title="服务状态" icon="refresh">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <span className={`h-2 w-2 rounded-full ${health === '运行正常' ? 'bg-ok' : 'bg-bad'}`} />
              {health}
            </div>
            <div className="mt-2 font-mono text-[10.5px] text-muted">Express :3001 / Vite :5173</div>
          </Card>
          <Card title="当前账号" icon="shield">
            <div className="text-[15px] font-semibold text-ink">
              {user?.name} · {role === 'engineer' ? '工程师' : '技术员'}
            </div>
            <div className="mt-2 font-mono text-[10.5px] text-muted">
              {user?.emp_no} · {user?.position}
            </div>
            <div className="mt-1 text-[10.5px] text-muted">
              {isAdmin
                ? '全量权限：编辑/删除/审核/基础数据管理'
                : '可检索、上传、维护本人记录；基础数据只读'}
            </div>
          </Card>
          <Card title="存储" icon="cases">
            <div className="text-[15px] font-semibold text-ink">SQLite</div>
            <div className="mt-2 font-mono text-[10.5px] text-muted">server/data/repair.db</div>
          </Card>
        </div>

        <Section title="审核与数据" hint="开关存数据库，工程师专属；导出用于留档">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={settings?.engineer_auto_approve ?? false}
                  disabled={!isAdmin || saving}
                  onChange={(e) => void toggleAutoApprove(e.target.checked)}
                />
                <span>
                  <b className="block text-[13px] text-ink">工程师提交的案例免审核，直接归档</b>
                  <small className="mt-1 block text-[11.5px] leading-[1.7] text-muted">
                    默认关闭；关闭时任何人提交都进待审核。技术员提交始终需要审核，不受此开关影响。
                  </small>
                </span>
              </label>
              {!isAdmin && <p className="mb-0 mt-3 text-[11px] text-muted">仅工程师可修改</p>}
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              <b className="block text-[13px] text-ink">数据导出与备份</b>
              <button
                type="button"
                onClick={() => void api.exportJson().catch((e: any) => toast(e.message || '导出失败', 'error'))}
                className="mt-3 rounded-lg bg-accent px-4 py-2 text-[12px] text-white"
              >
                导出全部数据 JSON
              </button>
              <p className="mb-0 mt-3 text-[11px] leading-[1.7] text-muted">
                后端启动时与每次批量导入前自动备份，保留最近 20 份。
                {settings?.backups.length ? ` 当前 ${settings.backups.length} 份，最新：${settings.backups[0].name}` : ''}
              </p>
            </div>
          </div>
        </Section>

        <Section title="检索排序截断阈值" hint="只用于排序截断，不是匹配门槛，仅工程师可改">
          <div className="rounded-xl border border-line bg-surface p-5">
            <label className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] text-ink">排序截断分数：</span>
              <input
                type="number"
                min={20}
                max={100}
                disabled={!isAdmin}
                value={settings?.match_threshold ?? 60}
                onChange={(e) => void saveThreshold(Number(e.target.value))}
                className="w-24 rounded-lg border border-line bg-white px-3 py-2 font-mono text-[13px] text-ink"
              />
              <span className="text-[11.5px] text-muted">建议默认 60</span>
            </label>
            <p className="mb-0 mt-3 text-[11px] leading-[1.7] text-muted">
              分数 = 命中词元权重 ÷ 本次查询总词元权重 × 100（机型40/客户30/现象20/补充6，分母按实际词元动态计算，满分100），<b className="text-ink">只用来排序</b>。
              <b className="text-ink">准入不靠分数</b>：只要命中机型或客户之一、且至少命中一个「词典标准词族」或「用户原话词元」，案例就允许进入结果；AI 扩展出来的词只参与打分排序、不参与准入判定。多打一个不匹配的词只会让分母变大、分数下降，不会把原本合格的案例整体刷成「未找到」。
              <b className="text-ink">本阈值是排序截断，不是匹配门槛</b>：达到阈值的进正常结果列表；没达到的<b className="text-ink">单独折叠成「弱相关，仅供参考」</b>，最多 3 条，需要展开才看，绝不用来凑满结果条数。
              <b className="text-ink">没有任何案例通过硬性准入时，如实提示「知识库中未找到相似案例，建议上传现场记录」</b>，不会为了避免空结果硬塞案例——维修场景里给一堆凑数案例比说没有更危险。
              调到 <b className="text-ink">80 以上</b>会让更多案例落到弱相关组，<b className="text-ink">60</b> 为建议默认，<b className="text-ink">40 及以下</b>几乎不截断。旧默认 12 已废弃。
            </p>
          </div>
        </Section>

        <Section title="查询缓存与调用成本" hint="本地缓存命中与前置拦截都不调用模型、不花钱">
          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="grid grid-cols-2 gap-4 text-[12.5px] md:grid-cols-4">
              <div>
                <div className="font-mono text-[10.5px] text-accent">缓存条数</div>
                <div className="mt-1 font-mono text-[18px] font-bold text-ink">{settings?.cache.entries ?? 0}</div>
              </div>
              <div>
                <div className="font-mono text-[10.5px] text-accent">缓存命中累计</div>
                <div className="mt-1 font-mono text-[18px] font-bold text-ink">{settings?.cache.hits ?? 0}</div>
              </div>
              <div>
                <div className="font-mono text-[10.5px] text-accent">未花钱请求占比</div>
                <div className="mt-1 font-mono text-[18px] font-bold text-ok">{settings?.routes.savedRate ?? 0}%</div>
              </div>
              <div>
                <div className="font-mono text-[10.5px] text-accent">路由明细</div>
                <div className="mt-1 font-mono text-[11px] text-ink">
                  总{settings?.routes.total ?? 0} / 拦截{settings?.routes.skip ?? 0} / 缓存{settings?.routes.cache ?? 0} / 模型{settings?.routes.llm ?? 0}
                </div>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => void doClearCache()}
                className="mt-4 rounded-lg border border-line px-4 py-2 text-[12px] text-ink hover:border-accent"
              >
                清空查询缓存
              </button>
            )}
            <p className="mb-0 mt-3 text-[11px] leading-[1.7] text-muted">
              案例增删改/审核、词典改动、匹配阈值改动都会自动清空缓存。同义词典覆盖的现象词会走前置拦截直接返回，不调用模型。
            </p>
          </div>
        </Section>

        <Section title="故障现象词典" hint="同义词与机型别名维护，改完立即生效">
          <DictionaryPanel />
        </Section>

        <Section title="核心链路" hint="对话检索 → 打开案例 → 上传 → 审核 → 再次检索到">
          <ol className="m-0 grid list-none gap-3 p-0">
            {[
              '在「对话检索」输入“联想 SR650 客户华为 开机无显示，风扇满转”，查看 Top 5 案例与汇总文案',
              '点击案例卡片打开右侧抽屉，查看型号、客户、现象、诊断、解决方案、状态与相似度',
              '点击右上角「上传案例」，填写必填项并提交，状态为 pending',
              '使用工程师账号，在「待审核」中通过并归档',
              '返回「对话检索」再次输入相同描述，新案例已参与检索',
            ].map((step, i) => (
              <li key={step} className="flex gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3 text-[12.5px] leading-[1.7] text-[#4B535E]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-[11px] text-white">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="示例数据" hint="构造数据，来源标记为「示例」，可与真实工单区分">
          <div className="rounded-lg border border-line bg-surface p-4">
            <p className="mb-3 mt-0 text-[12px] leading-[1.8] text-muted">
              首次建库时写入的示例案例（客户与日期为构造值）来源标记为「示例」，案例列表中带「示例」标记，可按来源筛选。
              播种只在首次建库时执行一次并写入 app_meta 标记，之后任何重启都不会自动补插，清除后不会复活；
              清除会连带删除其附件，并在删除前自动备份；仅工程师可操作，需二次确认，案例库筛选栏也提供同一入口。
            </p>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => void doPurgeSamples()}
                className="rounded-lg border border-bad/40 bg-bad/5 px-4 py-2 text-[12px] text-bad hover:bg-bad/10"
              >
                清除全部示例数据
              </button>
            ) : (
              <p className="mb-0 text-[11px] text-muted">仅工程师可清除示例数据</p>
            )}
          </div>
        </Section>

        <Section title="接口清单" hint="统一返回 { code, data, message }">
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] text-muted">
                  <th className="px-4 py-2.5 font-medium">方法</th>
                  <th className="px-4 py-2.5 font-medium">路径</th>
                  <th className="px-4 py-2.5 font-medium">说明</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([method, path, desc]) => (
                  <tr key={`${method}-${path}`} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2 font-mono text-[10.5px] text-accent">{method}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-ink">{path}</td>
                    <td className="px-4 py-2 text-muted">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: 'refresh' | 'shield' | 'cases';
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2 font-mono text-[10.5px] tracking-[.14em] text-accent">
        <Icon name={icon} className="h-[14px] w-[14px]" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
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
