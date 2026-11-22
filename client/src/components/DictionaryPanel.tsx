import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { DictionaryData } from '../api/types';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';

export function DictionaryPanel() {
  const { isAdmin } = useRole();
  const toast = useToast();
  const [data, setData] = useState<DictionaryData | null>(null);
  const [symptomForm, setSymptomForm] = useState({ standard: '', aliases: '', category: '' });
  const [aliasForm, setAliasForm] = useState({ canonical: '', alias: '' });
  const [editingId, setEditingId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    return api
      .getDictionary()
      .then(setData)
      .catch((e: any) => toast(e.message || '加载词典失败', 'error'));
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSymptom = async () => {
    if (!symptomForm.standard.trim()) return toast('请填写标准词', 'error');
    try {
      if (editingId === null) await api.addSymptom(symptomForm);
      else await api.updateSymptom(editingId, symptomForm);
      toast(editingId === null ? '已新增标准词' : '已保存');
      setSymptomForm({ standard: '', aliases: '', category: '' });
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      toast(e.message || '保存失败', 'error');
    }
  };

  const removeSymptom = async (id: number, standard: string) => {
    if (!window.confirm(`确认删除标准词「${standard}」？`)) return;
    try {
      await api.deleteSymptom(id);
      toast('已删除');
      await refresh();
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  const addAlias = async () => {
    if (!aliasForm.canonical.trim() || !aliasForm.alias.trim()) return toast('请填写规范型号和别名', 'error');
    try {
      await api.addModelAlias(aliasForm);
      toast('已新增机型别名');
      setAliasForm({ canonical: '', alias: '' });
      await refresh();
    } catch (e: any) {
      toast(e.message || '新增失败', 'error');
    }
  };

  const removeAlias = async (id: number, alias: string) => {
    if (!window.confirm(`确认删除机型别名「${alias}」？`)) return;
    try {
      await api.deleteModelAlias(id);
      toast('已删除');
      await refresh();
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  if (!data) return <div className="py-6 text-center text-[12px] text-muted">加载词典…</div>;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 font-mono text-[10.5px] tracking-[.1em] text-accent">故障现象标准词（{data.symptoms.length}）</div>
        <p className="mb-3 text-[11px] leading-[1.7] text-muted">
          检索时把用户说法归一化为标准词，并把同一行的别名扩展为一族等价词一起匹配。标准词唯一，重复添加会报错。改完立即生效，无需重启。
        </p>
        {isAdmin && (
          <div className="mb-4 grid gap-2 rounded-lg border border-line bg-surface-2 p-3">
            <input
              value={symptomForm.standard}
              onChange={(e) => setSymptomForm({ ...symptomForm, standard: e.target.value })}
              placeholder="标准词，如：无显示"
              className={inputCls}
            />
            <input
              value={symptomForm.aliases}
              onChange={(e) => setSymptomForm({ ...symptomForm, aliases: e.target.value })}
              placeholder="别名，英文逗号分隔，如：不显示,黑屏,没有画面"
              className={inputCls}
            />
            <input
              value={symptomForm.category}
              onChange={(e) => setSymptomForm({ ...symptomForm, category: e.target.value })}
              placeholder="可选：对应故障分类，如：供电类"
              className={inputCls}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => void saveSymptom()} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white">
                {editingId === null ? '新增' : '保存'}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setSymptomForm({ standard: '', aliases: '', category: '' });
                  }}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        )}
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] text-muted">
                <th className="px-2 py-2 font-medium">标准词</th>
                <th className="px-2 py-2 font-medium">别名</th>
                {isAdmin && <th className="px-2 py-2 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody>
              {data.symptoms.map((s) => (
                <tr key={s.id} className="border-b border-line/60 align-top">
                  <td className="px-2 py-2 font-medium text-ink">{s.standard}</td>
                  <td className="px-2 py-2 text-muted">{s.aliases || '—'}</td>
                  {isAdmin && (
                    <td className="whitespace-nowrap px-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(s.id);
                          setSymptomForm({ standard: s.standard, aliases: s.aliases, category: s.category });
                        }}
                        className="mr-2 text-accent"
                      >
                        编辑
                      </button>
                      <button type="button" onClick={() => void removeSymptom(s.id, s.standard)} className="text-bad">
                        删除
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 font-mono text-[10.5px] tracking-[.1em] text-accent">机型别名（{data.modelAliases.length}）</div>
        <p className="mb-3 text-[11px] leading-[1.7] text-muted">
          检索时先把用户写的别名换成规范型号再匹配。别名唯一，重复添加会报错。改完立即生效。
        </p>
        {isAdmin && (
          <div className="mb-4 grid gap-2 rounded-lg border border-line bg-surface-2 p-3">
            <input
              value={aliasForm.canonical}
              onChange={(e) => setAliasForm({ ...aliasForm, canonical: e.target.value })}
              placeholder="规范型号，如：联想 SR650"
              className={inputCls}
            />
            <input
              value={aliasForm.alias}
              onChange={(e) => setAliasForm({ ...aliasForm, alias: e.target.value })}
              placeholder="别名，如：SR650"
              className={inputCls}
            />
            <button type="button" onClick={() => void addAlias()} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white">
              新增别名
            </button>
          </div>
        )}
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] text-muted">
                <th className="px-2 py-2 font-medium">别名</th>
                <th className="px-2 py-2 font-medium">规范型号</th>
                {isAdmin && <th className="px-2 py-2 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody>
              {data.modelAliases.map((a) => (
                <tr key={a.id} className="border-b border-line/60">
                  <td className="px-2 py-2 text-ink">{a.alias}</td>
                  <td className="px-2 py-2 text-muted">{a.canonical}</td>
                  {isAdmin && (
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => void removeAlias(a.id, a.alias)} className="text-bad">
                        删除
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-ink outline-none focus:border-accent';
