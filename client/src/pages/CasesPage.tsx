import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type CaseQuery } from '../api';
import type { Case, CaseFacets, FacetOption } from '../api/types';
import { UNCATEGORIZED } from '../api/types';
import { Icon } from '../components/Icon';
import { ImportModal } from '../components/ImportModal';
import { StatusBadge } from '../components/StatusBadge';
import { useCaseFilters } from '../hooks/useCaseFilters';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';

const PAGE_SIZE = 8;

const EMPTY_FACETS: CaseFacets = {
  customer: [],
  model: [],
  category: [],
  status: [],
  total: 0,
};

/** 「未分类」是虚拟选项，值用 __uncategorized__，展示名固定为「未分类」 */
const FACET_LABEL: Record<string, string> = {
  customer: '客户',
  model: '型号',
  category: '故障分类',
  status: '状态',
};

export function CasesPage({
  onOpenCase,
  onEditCase,
  onChanged,
  onUpload,
}: {
  onOpenCase: (item: Case) => void;
  onEditCase: (item: Case) => void;
  onChanged: () => void;
  onUpload: () => void;
}) {
  const toast = useToast();
  const { canEditCase, isEngineer } = useRole();
  // 筛选条件放在 AppShell 常驻层，切导航页回来不丢
  const { filters, setFilter, clearOne, reset } = useCaseFilters();
  const { customer, model, category, status, source, q, sort, order, page } = filters;
  const [list, setList] = useState<Case[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<CaseFacets>(EMPTY_FACETS);
  const [importOpen, setImportOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const lastTotal = useRef(0);

  const purgeSamples = async () => {
    if (!window.confirm('二次确认：将删除全部「示例」来源案例及其附件，删除前自动备份。播种已锁定为首次建库一次，清除后重启不会复活。确定继续？')) return;
    setPurging(true);
    try {
      const r = await api.purgeSamples();
      toast(`已清除 ${r.deleted} 条示例数据${r.backup ? '，备份已生成' : ''}`);
      onChanged();
    } catch (e: any) {
      toast(e.message || '清除失败', 'error');
    } finally {
      setPurging(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params: CaseQuery = {
      model,
      customer,
      category,
      status,
      source: source as CaseQuery['source'],
      q,
      sort,
      order,
      page,
      pageSize: PAGE_SIZE,
    };
    api
      .listCases(params)
      .then((res) => {
        if (!active) return;
        setList(res.list);
        setTotal(res.total);
      })
      .catch((e: any) => toast(e.message || '加载案例失败', 'error'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [model, customer, category, status, source, q, sort, order, page, onChanged, toast]);

  // 分面统计关键字不参与级联；条件一变就重算各下拉的可选项与条数
  useEffect(() => {
    let active = true;
    const params: CaseQuery = {
      model,
      customer,
      category,
      status,
      source: source as CaseQuery['source'],
    };
    api
      .getCaseFacets(params)
      .then((res) => {
        if (active) setFacets(res);
      })
      .catch(() => {
        if (active) setFacets(EMPTY_FACETS);
      });
    return () => {
      active = false;
    };
  }, [model, customer, category, status, source, onChanged]);

  // 结果条数一变，分页回第一页（避免停在第 3 页显示空列表）
  useEffect(() => {
    if (lastTotal.current !== 0 && lastTotal.current !== total && page > 1) {
      setFilter('page', 1);
    }
    lastTotal.current = total;
  }, [total, page, setFilter]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const remove = async (item: Case) => {
    if (!window.confirm(`确认删除案例 #${item.id}？此操作不可恢复。`)) return;
    try {
      await api.deleteCase(item.id);
      toast('案例已删除');
      onChanged();
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line bg-surface-2 px-7 py-4">
        <div className="engineering-grid flex flex-wrap items-center gap-3">
          <div className="text-[12.5px] text-muted">
            共 <b className="mr-0 font-mono text-[15px] text-ink">{total}</b> 条案例
          </div>
          <div className="flex-1" />

          <FacetSelect
            facet="customer"
            value={customer}
            options={facets.customer}
            onChange={(v) => setFilter('customer', v)}
          />
          <FacetSelect
            facet="model"
            value={model}
            options={facets.model}
            context={customer}
            onChange={(v) => setFilter('model', v)}
          />
          <FacetSelect
            facet="category"
            value={category}
            options={facets.category}
            onChange={(v) => setFilter('category', v)}
          />
          <FacetSelect
            facet="status"
            value={status}
            options={facets.status}
            onChange={(v) => setFilter('status', v)}
          />

          <select className={selectCls} value={source} onChange={(e) => setFilter('source', e.target.value)}>
            <option value="">全部来源</option>
            <option value="sample">示例数据</option>
            <option value="manual">真实录入</option>
            <option value="import">批量导入</option>
          </select>
          <select className={selectCls} value={sort} onChange={(e) => setFilter('sort', e.target.value)}>
            <option value="repaired_at">按维修日期</option>
            <option value="created_at">按创建时间</option>
            <option value="updated_at">按更新时间</option>
            <option value="similarity">按相似度</option>
          </select>
          <button
            type="button"
            onClick={() => setFilter('order', order === 'desc' ? 'asc' : 'desc')}
            title={order === 'desc' ? '当前降序' : '当前升序'}
            className="rounded-lg border border-line bg-surface px-3 py-[9px] text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {order === 'desc' ? '降序 ↓' : '升序 ↑'}
          </button>
          <input
            value={q}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder="关键字搜索…"
            className="w-[200px] rounded-lg border border-line bg-surface px-3 py-[9px] text-[12px] text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/10"
          />
          <button
            type="button"
            onClick={reset}
            className="whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-[9px] text-[11.5px] text-muted transition-colors hover:border-accent hover:text-accent"
          >
            全部重置
          </button>
          {isEngineer && (
            <button
              type="button"
              onClick={() => void purgeSamples()}
              disabled={purging}
              title="仅清除「示例」来源案例；播种已锁定为首次建库一次，清除后重启不会复活"
              className="whitespace-nowrap rounded-lg border border-bad/40 bg-bad/5 px-3 py-[9px] text-[11.5px] text-bad transition-colors hover:bg-bad/10 disabled:opacity-50"
            >
              {purging ? '清除中…' : '一键清除示例数据'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-3.5 py-[9px] text-[12px] text-[#4B535E] transition-colors hover:border-accent hover:text-accent"
          >
            <Icon name="upload" className="h-[14px] w-[14px]" />
            批量导入
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3.5 py-[9px] text-[12px] font-medium text-white transition-colors hover:bg-accent-dark"
          >
            <Icon name="plus" className="h-[14px] w-[14px]" />
            上传案例
          </button>
        </div>

        {/* 已选条件标签：每个都能单独点掉 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] tracking-[.1em] text-muted">已选条件</span>
          <FilterTag label={FACET_LABEL.customer} value={customer} display={facetDisplay(facets.customer, customer)} onRemove={() => clearOne('customer')} />
          <FilterTag label={FACET_LABEL.model} value={model} display={facetDisplay(facets.model, model)} onRemove={() => clearOne('model')} />
          <FilterTag label={FACET_LABEL.category} value={category} display={facetDisplay(facets.category, category)} onRemove={() => clearOne('category')} />
          <FilterTag label={FACET_LABEL.status} value={status} display={facetDisplay(facets.status, status)} onRemove={() => clearOne('status')} />
          <FilterTag label="来源" value={source} display={SOURCE_LABEL[source] || source} onRemove={() => clearOne('source')} />
          <FilterTag label="关键字" value={q} display={q} onRemove={() => clearOne('q')} />
          {!customer && !model && !category && !status && !source && !q && (
            <span className="text-[11px] text-muted">（无，下拉里的条数即为当前可见案例分布）</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-7">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11px] tracking-wide text-muted">
                <Th className="w-[60px]">ID</Th>
                <Th className="w-[150px]">型号</Th>
                <Th className="w-[100px]">客户</Th>
                <Th>故障现象</Th>
                <Th>诊断 / 方案</Th>
                <Th className="w-[90px]">状态</Th>
                <Th className="w-[110px]">维修日期</Th>
                <Th className="w-[140px]">创建时间</Th>
                <Th className="w-[130px]">操作</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[12.5px] text-muted">加载中…</td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <Icon name="cases" className="mx-auto mb-4 h-10 w-10 text-[#C8C2B7]" />
                    <p className="m-0 text-[13px] text-muted">没有符合条件的案例</p>
                    <small className="font-mono text-[10.5px] text-[#B0B5BC]">调整筛选条件后重试</small>
                  </td>
                </tr>
              ) : (
                list.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => onOpenCase(item)}
                    className="cursor-pointer border-b border-line/70 text-[12.5px] transition-colors last:border-0 hover:bg-accent-soft/40"
                  >
                    <td className="px-4 py-3 font-mono text-[11px] text-[#A1A7AF]">
                      <div className="flex flex-col gap-1">
                        <span>#{item.id}</span>
                        <div className="flex flex-wrap gap-1">
                          <SourceTag source={item.source} />
                          {typeof item.recurrence_count === 'number' && item.recurrence_count > 1 && (
                            <span
                              className="rounded bg-warn/15 px-1.5 py-0.5 text-[9.5px] text-warn"
                              title={`同型号+同客户+同故障现象历史共 ${item.recurrence_count} 次`}
                            >
                              复发×{item.recurrence_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-graphite px-2 py-1 font-mono text-[10.5px] text-[#F3F5F7]">
                        {item.model}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#4B535E]">{item.customer || '—'}</td>
                    <td className="max-w-[260px] px-4 py-3">
                      <div className="truncate font-medium text-ink" title={item.symptom}>{item.symptom}</div>
                    </td>
                    <td className="max-w-[280px] px-4 py-3">
                      <div className="truncate text-[11.5px] text-muted" title={item.diagnosis}>{item.diagnosis || '—'}</div>
                      <div className="mt-0.5 truncate text-[11px] text-[#9BA1A9]" title={item.solution}>{item.solution}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3 font-mono text-[10.5px] text-accent">{item.repaired_at || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[10.5px] text-[#A1A7AF]">{item.created_at}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2.5 whitespace-nowrap text-[11.5px]">
                        <button
                          type="button"
                          onClick={() => onOpenCase(item)}
                          className="flex items-center gap-0.5 text-accent hover:underline"
                        >
                          详情 <Icon name="chevronRight" className="h-3.5 w-3.5" />
                        </button>
                        {canEditCase(item) && (
                          <>
                            <button
                              type="button"
                              onClick={() => onEditCase(item)}
                              className="text-[#5E6670] hover:text-accent hover:underline"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => void remove(item)}
                              className="text-bad hover:underline"
                            >
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-[11.5px] text-muted">
          <span>
            第 {page} / {pages} 页 · 每页 {PAGE_SIZE} 条
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setFilter('page', page - 1)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <Icon name="chevronLeft" className="h-4 w-4" />
            </button>
            <span className="font-mono text-ink">{page}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setFilter('page', page + 1)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <Icon name="chevronRight" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onFinished={onChanged}
      />
    </div>
  );
}

const selectCls =
  'max-w-[190px] rounded-lg border border-line bg-surface-2 px-3 py-[9px] text-[12px] text-ink outline-none transition-colors focus:border-accent';

const SOURCE_LABEL: Record<string, string> = {
  sample: '示例数据',
  manual: '真实录入',
  import: '批量导入',
};

/** 已选值在下拉里被自排除后可能不在可选项中，仍要用原展示名显示标签 */
function facetDisplay(options: FacetOption[], value: string) {
  if (!value) return '';
  if (value === UNCATEGORIZED) return '未分类';
  return options.find((o) => o.value === value)?.label || value;
}

/** 一个级联下拉：只列出「其他条件下仍有案例」的选项，并直接显示条数 */
function FacetSelect({
  facet,
  value,
  options,
  context,
  onChange,
}: {
  facet: keyof typeof FACET_LABEL;
  value: string;
  options: FacetOption[];
  context?: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className={selectCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={`${FACET_LABEL[facet]}（算此下拉时忽略自身已选值，只套用其他条件）`}
    >
      <option value="">全部{FACET_LABEL[facet]}</option>
      {options.map((o) => (
        <option key={o.value || '__empty__'} value={o.value}>
          {context && facet === 'model' ? `${context} · ` : ''}
          {o.label}（{o.count}）
        </option>
      ))}
      {/* 自排除后当前选中值若已被其他条件筛空，保留该项以免标签与下拉不一致 */}
      {value && !options.some((o) => o.value === value) && (
        <option value={value}>
          {value === UNCATEGORIZED ? '未分类' : value}（0）
        </option>
      )}
    </select>
  );
}

function FilterTag({
  label,
  value,
  display,
  onRemove,
}: {
  label: string;
  value: string;
  display: string;
  onRemove: () => void;
}) {
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={onRemove}
      title={`移除「${label}：${display}」`}
      className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-[#4B535E] transition-colors hover:border-accent hover:text-accent"
    >
      <span className="text-muted">{label}</span>
      <span className="font-medium">{display}</span>
      <span className="text-[13px] leading-none text-muted">×</span>
    </button>
  );
}

export function SourceTag({ source }: { source?: 'sample' | 'manual' | 'import' }) {
  const map: Record<string, { label: string; cls: string }> = {
    sample: { label: '示例', cls: 'bg-[#F0EDE6] text-[#7A828C]' },
    manual: { label: '录入', cls: 'bg-accent-soft text-accent' },
    import: { label: '导入', cls: 'bg-[#E8EEF6] text-[#4A6FA5]' },
  };
  const item = map[source || 'manual'] || map.manual;
  return <span className={`rounded px-1.5 py-0.5 text-[9.5px] ${item.cls}`}>{item.label}</span>;
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}
