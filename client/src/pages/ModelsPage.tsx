import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Model } from '../api/types';
import { Icon } from '../components/Icon';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';

const empty = { brand: '', model: '', platform: '', note: '' };
type Form = typeof empty;

export function ModelsPage({ version }: { version: number }) {
  const { isAdmin } = useRole();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Model | 'new' | null>(null);
  const [form, setForm] = useState<Form>(empty);

  const load = () => {
    setLoading(true);
    api
      .listModels(q)
      .then(setList)
      .catch((e: any) => toast(e.message || '加载机型失败', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [q, version, toast]);

  const openForm = (item?: Model) => {
    setForm(item ? { brand: item.brand, model: item.model, platform: item.platform, note: item.note } : empty);
    setEditing(item || 'new');
  };

  const save = async () => {
    if (!form.model.trim()) {
      toast('型号不能为空', 'error');
      return;
    }
    try {
      if (editing !== 'new' && editing) {
        await api.updateModel(editing.id, form);
        toast('机型已更新');
      } else {
        await api.createModel(form);
        toast('机型已新增');
      }
      setEditing(null);
      load();
    } catch (e: any) {
      toast(e.message || '保存失败', 'error');
    }
  };

  const remove = async (item: Model) => {
    if (!window.confirm(`确认删除机型「${item.model}」？`)) return;
    try {
      await api.deleteModel(item.id);
      toast('机型已删除');
      load();
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="engineering-grid flex shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-7 py-4">
        <div className="text-[12.5px] text-muted">
          共 <b className="mx-1 font-mono text-[15px] text-ink">{list.length}</b> 个机型
        </div>
        <div className="flex-1" />
        {!isAdmin && (
          <span className="rounded bg-[#EFECE5] px-2.5 py-1 text-[11px] text-[#6E7680]">
            当前账号为只读权限
          </span>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索品牌 / 型号 / 平台…"
          className="w-[240px] rounded-lg border border-line bg-surface px-3 py-[9px] text-[12px] text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
        />
        {isAdmin && (
          <button
            type="button"
            onClick={() => openForm()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-[9px] text-[12px] font-medium text-white transition-colors hover:bg-accent-dark"
          >
            <Icon name="plus" className="h-[14px] w-[14px]" />
            新增机型
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-7">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11px] tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">品牌</th>
                <th className="px-4 py-3 font-medium">型号</th>
                <th className="px-4 py-3 font-medium">平台 / 代次</th>
                <th className="px-4 py-3 font-medium">备注</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="w-[110px] px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[12.5px] text-muted">加载中…</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[12.5px] text-muted">暂无机型数据</td></tr>
              ) : (
                list.map((item) => (
                  <tr key={item.id} className="border-b border-line/70 text-[12.5px] last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3 font-mono text-[11px] text-[#A1A7AF]">#{item.id}</td>
                    <td className="px-4 py-3 text-ink">{item.brand || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-graphite px-2 py-1 font-mono text-[10.5px] text-[#F3F5F7]">{item.model}</span>
                    </td>
                    <td className="px-4 py-3 text-[#4B535E]">{item.platform || '—'}</td>
                    <td className="px-4 py-3 text-muted">{item.note || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[10.5px] text-[#A1A7AF]">{item.created_at}</td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openForm(item)}
                            className="text-[11.5px] text-accent hover:underline"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(item)}
                            className="text-[11.5px] text-bad hover:underline"
                          >
                            删除
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#A6ACB4]">只读</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[11px] text-muted">
          提示：机型名称用于对话检索中的型号识别，新增后即可在自然语言描述中被识别。
        </p>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-[#14181D]/50 backdrop-blur-[3px]" onClick={() => setEditing(null)} />
          <div className="animate-pop relative w-full max-w-[520px] rounded-[14px] bg-surface shadow-pop">
            <div className="flex items-center gap-2 border-b border-line px-6 py-[18px]">
              <h3 className="m-0 font-display text-[16px] font-bold">{editing === 'new' ? '新增机型' : '编辑机型'}</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="ml-auto grid h-[30px] w-[30px] place-items-center rounded-lg bg-surface-2 text-muted hover:text-bad"
              >
                <Icon name="close" className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 px-6 py-6">
              <Field label="品牌">
                <input className={inputCls} value={form.brand} placeholder="如 联想" onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              </Field>
              <Field label="型号 *">
                <input className={inputCls} value={form.model} placeholder="如 SR650" onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </Field>
              <Field label="平台 / 代次" full>
                <input className={inputCls} value={form.platform} placeholder="如 Intel Purley 二代" onChange={(e) => setForm({ ...form, platform: e.target.value })} />
              </Field>
              <Field label="备注" full>
                <textarea className={inputCls} rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-3 border-t border-line bg-surface-2 px-6 py-4">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line bg-surface px-4 py-[10px] text-[12px] text-muted hover:border-accent hover:text-accent">取消</button>
              <button type="button" onClick={() => void save()} className="rounded-lg bg-accent px-5 py-[10px] text-[12px] font-medium text-white hover:bg-accent-dark">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-[10px] text-[13px] text-ink outline-none focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10';

function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-[7px] ${full ? 'col-span-2' : ''}`}>
      <span className="text-[12px] font-semibold text-[#454D57]">{label}</span>
      {children}
    </label>
  );
}
