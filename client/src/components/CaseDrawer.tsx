import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { CASE_CATEGORIES, type Attachment, type Case, type CaseInput, type Customer, type Model, type RecurrenceInfo, type SimilarCase } from '../api/types';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import { AttachmentGallery } from './AttachmentGallery';
import { Icon } from './Icon';
import { ImagePicker } from './ImagePicker';
import { StatusBadge } from './StatusBadge';

export function CaseDrawer({
  item,
  initialEditing = false,
  onClose,
  onChanged,
  onOpenCase,
}: {
  item: Case | null;
  initialEditing?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenCase?: (item: Case) => void;
}) {
  const { isAdmin, canEditCase, canReview } = useRole();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [similar, setSimilar] = useState<SimilarCase[]>([]);
  const [recurrence, setRecurrence] = useState<RecurrenceInfo | null>(null);
  const [form, setForm] = useState<CaseInput>({
    model: '',
    customer: '',
    symptom: '',
    diagnosis: '',
    solution: '',
    parts: '',
    note: '',
    author: '',
    category: '',
    repaired_at: null,
    });

  useEffect(() => {
    if (!item) return;
    setEditing(initialEditing && canEditCase(item));
    setReason('');
    setRejecting(false);
    setNewFiles([]);
    setRemovedIds([]);
    setForm({
      model: item.model,
      customer: item.customer,
      symptom: item.symptom,
      diagnosis: item.diagnosis,
      solution: item.solution,
      parts: item.parts,
      note: item.note,
      author: item.author,
      category: item.category,
      repaired_at: item.repaired_at,
      model_id: item.model_id ?? undefined,
      customer_id: item.customer_id ?? undefined,
    });
    setSimilar([]);
    setRecurrence(null);
    api.listAttachments(item.id).then(setAttachments).catch(() => setAttachments([]));
    api.listModels().then(setModels).catch(() => undefined);
    api.listCustomers().then(setCustomers).catch(() => undefined);
    api.getSimilarCases(item.id).then(setSimilar).catch(() => setSimilar([]));
    api.getRecurrences(item.id).then(setRecurrence).catch(() => setRecurrence(null));
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !rejecting) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [item, onClose, rejecting]);

  if (!item) return null;

  const canEdit = canEditCase(item);
  const resubmitting = item.status === 'rejected';
  const set = (key: keyof CaseInput, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const reloadAttachments = async () => {
    const rows = await api.listAttachments(item.id);
    setAttachments(rows);
  };

  const save = async () => {
    if (!form.model.trim() || !form.symptom.trim() || !form.solution.trim()) {
      toast('型号、现象描述、解决方案为必填项', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateCase(item.id, form);
      for (const id of removedIds) await api.deleteAttachment(id);
      if (newFiles.length > 0) {
        const data = new FormData();
        newFiles.forEach((file) => data.append('attachments', file));
        await api.addAttachments(updated.id, data);
      }
      toast(resubmitting ? '已修改并重新提交，等待审核' : '案例已更新');
      setEditing(false);
      setNewFiles([]);
      setRemovedIds([]);
      await reloadAttachments();
      onChanged();
    } catch (e: any) {
      toast(e.message || '更新失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`确认删除案例 #${item.id}？照片也会一并删除。`)) return;
    try {
      await api.deleteCase(item.id);
      toast('案例已删除');
      onChanged();
      onClose();
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  const review = async (action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') {
        await api.approveCase(item.id);
        toast('已通过并归档，现可参与对话检索');
      } else {
        if (!reason.trim()) {
          toast('驳回原因不能为空', 'error');
          return;
        }
        await api.rejectCase(item.id, reason.trim());
        toast('已驳回，原因已记录并回显给作者');
      }
      setRejecting(false);
      onChanged();
      onClose();
    } catch (e: any) {
      toast(e.message || '操作失败', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[#14181D]/50 backdrop-blur-[3px]" onClick={onClose} />
      <aside className="animate-pop absolute inset-y-0 right-0 flex w-full max-w-[580px] flex-col bg-surface shadow-pop">
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-6 py-[18px]">
          <span className="rounded bg-graphite px-2 py-1 font-mono text-[10.5px] text-[#F3F5F7]">{item.model}</span>
          <span className="font-mono text-[10px] text-[#A1A7AF]">#{item.id}</span>
          <StatusBadge status={item.status} />
          {item.category && <span className="rounded bg-accent-soft px-2 py-1 text-[10.5px] text-accent">{item.category}</span>}
          <CaseSourceTag source={item.source} />
          <button type="button" onClick={onClose} className="ml-auto grid h-[30px] w-[30px] place-items-center rounded-lg bg-surface-2 text-muted hover:text-bad">
            <Icon name="close" className="h-[15px] w-[15px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-[22px]">
          {editing ? (
            <>
              {resubmitting && (
                <div className="mb-5 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-[12px] text-warn">
                  该案例已被驳回，保存修改后将自动回到待审核状态。
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="型号" required>
                  <input className={inputCls} list="detail-models" value={form.model} onChange={(e) => set('model', e.target.value)} />
                  <datalist id="detail-models">
                    {models.map((m) => <option key={m.id} value={`${m.brand} ${m.model}`.trim()} />)}
                  </datalist>
                </Field>
                <Field label="客户">
                  <input className={inputCls} list="detail-customers" value={form.customer} onChange={(e) => set('customer', e.target.value)} />
                  <datalist id="detail-customers">
                    {customers.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                </Field>
                <Field label="故障分类">
                  <select className={inputCls} value={form.category || ''} onChange={(e) => set('category', e.target.value)}>
                    <option value="">未分类</option>
                    {CASE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="填报人">
                  <input className={inputCls} value={form.author} readOnly={!isAdmin} onChange={(e) => set('author', e.target.value)} />
                </Field>
                <Field label="维修日期">
                  <input
                    className={inputCls}
                    type="date"
                    value={form.repaired_at || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, repaired_at: e.target.value || null }))}
                  />
                </Field>
                <Field label="现象描述" required full>
                  <textarea className={inputCls} rows={3} value={form.symptom} onChange={(e) => set('symptom', e.target.value)} />
                </Field>
                <Field label="诊断过程" full>
                  <textarea className={inputCls} rows={4} value={form.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
                </Field>
                <Field label="解决方案" required full>
                  <textarea className={inputCls} rows={4} value={form.solution} onChange={(e) => set('solution', e.target.value)} />
                </Field>
                <Field label="更换配件">
                  <input className={inputCls} value={form.parts} onChange={(e) => set('parts', e.target.value)} />
                </Field>
                <Field label="备注" full>
                  <textarea className={inputCls} rows={3} value={form.note} onChange={(e) => set('note', e.target.value)} />
                </Field>
              </div>

              <div className="mt-6">
                <SubTitle>现场照片（追加）</SubTitle>
                <ImagePicker files={newFiles} onChange={setNewFiles} disabled={saving} />
                {attachments.length > 0 && (
                  <div className="mt-4">
                    <SubTitle>已有照片（点角标删除）</SubTitle>
                    <AttachmentGallery
                      attachments={attachments.filter((a) => !removedIds.includes(a.id))}
                      removable
                      onRemove={(id) => setRemovedIds((prev) => [...prev, id])}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {(!item.model_id || !item.customer_id) && (
                <div className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-[12px] leading-[1.7] text-warn">
                  这条案例还没关联到机型或客户，请点击编辑并补充选择。
                </div>
              )}
              {item.status === 'rejected' && item.reject_reason && (
                <div className="mb-4 rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 text-[12px] leading-[1.7] text-bad">
                  <b>驳回原因：</b>{item.reject_reason}
                  <div className="mt-1 font-mono text-[10px] opacity-80">
                    审核人：{item.reviewer || '—'} · {item.reviewed_at || '—'}
                  </div>
                </div>
              )}
              {item.status === 'approved' && item.reviewed_at && (
                <div className="mb-4 text-[10.5px] text-muted">
                  审核人：{item.reviewer || '—'} · 审核时间：{item.reviewed_at}
                </div>
              )}

              <div className="mb-[22px] grid grid-cols-2 gap-3">
                <Kv label="客户" value={item.customer || '—'} />
                <Kv label="填报人" value={item.author || '—'} />
                <Kv label="更换配件" value={item.parts || '无'} />
                <Kv label="维修日期" value={item.repaired_at || '未填写'} />
                <Kv label="创建时间" value={item.created_at} />
              </div>

              {recurrence && recurrence.total > 1 && (
                <div className="mb-[22px] rounded-lg border border-warn/30 bg-warn/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-warn">
                    <Icon name="alert" className="h-4 w-4" />
                    同型号 + 同客户 + 同故障现象历史共 {recurrence.total} 次
                  </div>
                  <div className="mt-1 text-[11px] leading-[1.7] text-[#7A828C]">
                    最近一次在 {recurrence.last_repaired ? formatMonth(recurrence.last_repaired) : '未填写维修日期'}。返修/复发通常是最有价值的信号，建议结合历次方案一起看。
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {recurrence.list.filter((r) => r.id !== item.id).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        disabled={!onOpenCase}
                        onClick={() => onOpenCase && api.getCase(r.id).then(onOpenCase).catch(() => undefined)}
                        className="rounded border border-warn/30 bg-white px-2 py-0.5 font-mono text-[10.5px] text-ink hover:border-warn disabled:cursor-default"
                      >
                        #{r.id} · {r.repaired_at || r.created_at.slice(0, 10)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Block index="01" title="故障现象">{item.symptom}</Block>
              <Block index="02" title="诊断过程">{item.diagnosis || '暂无记录'}</Block>
              <Block index="03" title="解决方案">{item.solution || '暂无记录'}</Block>
              <Block index="04" title="备注">{item.note || '无'}</Block>

              <div className="mt-5">
                <SubTitle>现场照片</SubTitle>
                <AttachmentGallery attachments={attachments} />
              </div>

              <div className="mt-6">
                <SubTitle>同型号历史案例（最近 5 条已归档，不含本条）</SubTitle>
                {similar.length === 0 ? (
                  <p className="m-0 rounded-lg border border-dashed border-line px-4 py-4 text-center text-[11.5px] text-muted">
                    暂无同型号的其他已归档案例
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {similar.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!onOpenCase}
                        onClick={() => {
                          if (!onOpenCase) return;
                          api.getCase(s.id).then(onOpenCase).catch(() => undefined);
                        }}
                        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent disabled:cursor-default"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] text-accent">#{s.id}</span>
                          {s.category && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">{s.category}</span>}
                          <span className="ml-auto font-mono text-[10px] text-muted">
                            维修：{s.repaired_at || '—'} · 创建：{s.created_at.slice(0, 10)}
                          </span>
                        </div>
                        <div className="mt-1 text-[12px] leading-[1.6] text-ink">{s.symptom}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 font-mono text-[10px] text-[#A6ACB4]">最近更新：{item.updated_at}</div>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-line bg-surface-2 px-6 py-4">
          {editing ? (
            <>
              <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-accent px-5 py-[10px] text-[12px] font-medium text-white disabled:opacity-60">
                {saving ? '保存中…' : '保存修改'}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-line bg-surface px-4 py-[10px] text-[12px] text-muted">
                取消
              </button>
            </>
          ) : rejecting ? (
            <div className="w-full">
              <textarea
                className={inputCls}
                rows={2}
                placeholder="请填写驳回原因（必填），作者可以看到"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void review('reject')} className="rounded-lg bg-bad px-4 py-2 text-[12px] text-white">确认驳回</button>
                <button type="button" onClick={() => setRejecting(false)} className="rounded-lg border border-line bg-surface px-4 py-2 text-[12px] text-muted">取消</button>
              </div>
            </div>
          ) : (
            <>
              {canEdit && (
                <>
                  <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-[10px] text-[12px] text-[#4B535E] hover:text-accent">
                    <Icon name="edit" className="h-[14px] w-[14px]" /> 编辑
                  </button>
                  <button type="button" onClick={remove} className="flex items-center gap-1.5 rounded-lg border border-bad/30 bg-surface px-4 py-[10px] text-[12px] text-bad hover:bg-bad-soft">
                    <Icon name="trash" className="h-[14px] w-[14px]" /> 删除
                  </button>
                </>
              )}
              {canReview && item.status === 'pending' && (
                <>
                  <button type="button" onClick={() => void review('approve')} className="ml-auto rounded-lg bg-ok px-5 py-[10px] text-[12px] font-medium text-white">通过并归档</button>
                  <button type="button" onClick={() => setRejecting(true)} className="rounded-lg border border-bad/30 bg-surface px-4 py-[10px] text-[12px] text-bad">驳回</button>
                </>
              )}
              {!canEdit && !canReview && (
                <span className="text-[11.5px] text-muted">当前账号为只读权限</span>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-[10px] text-[13px] leading-[1.7] text-ink outline-none focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10';

function CaseSourceTag({ source }: { source?: 'sample' | 'manual' | 'import' }) {
  const map: Record<string, { label: string; cls: string }> = {
    sample: { label: '示例数据', cls: 'bg-[#F0EDE6] text-[#7A828C]' },
    manual: { label: '真实录入', cls: 'bg-accent-soft text-accent' },
    import: { label: '批量导入', cls: 'bg-[#E8EEF6] text-[#4A6FA5]' },
  };
  const item = map[source || 'manual'] || map.manual;
  return <span className={`rounded px-2 py-1 text-[10.5px] ${item.cls}`}>{item.label}</span>;
}

function formatMonth(date: string) {
  const m = String(date || '').slice(0, 7).split('-');
  return m.length === 2 ? `${m[0]}年${m[1]}月` : date;
}

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-[7px] ${full ? 'col-span-2' : ''}`}>
      <span className="text-[12px] font-semibold text-[#454D57]">
        {label}{required && <em className="ml-[3px] not-italic text-accent">*</em>}
      </span>
      {children}
    </label>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <div className="mb-3 font-mono text-[10px] tracking-[.14em] text-accent">{children}</div>;
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-[13px] py-[11px]">
      <span className="mb-[5px] block text-[10.5px] text-muted">{label}</span>
      <b className="font-mono text-[12px] font-medium text-ink">{value}</b>
    </div>
  );
}

function Block({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-[22px]">
      <div className="mb-[9px] border-l-2 border-accent pl-[10px] font-mono text-[10px] tracking-[.14em] text-accent">{index} / {title}</div>
      <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.9] text-[#3E4650]">{children}</p>
    </div>
  );
}
