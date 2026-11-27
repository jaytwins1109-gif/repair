import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { CASE_CATEGORIES, type Customer, type Model } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Icon } from './Icon';
import { ImagePicker } from './ImagePicker';

const initial = {
  model: '',
  customer: '',
  symptom: '',
  diagnosis: '',
  solution: '',
  parts: '',
  note: '',
  category: '',
  repaired_at: '',
};

export function UploadCaseModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState(initial);
  const [models, setModels] = useState<Model[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) return;
    api.listModels().then(setModels).catch(() => undefined);
    api.listCustomers().then(setCustomers).catch(() => undefined);
  }, [open]);

  const set = (key: keyof typeof initial, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setForm(initial);
    setFiles([]);
    setProgress(0);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.model.trim() || !form.symptom.trim() || !form.solution.trim()) {
      toast('请填写型号、现象描述与解决方案', 'error');
      return;
    }

    // datalist 展示的是「品牌 + 型号」（与截图一致），校验时必须兼容两种写法
    const modelText = form.model.trim().replace(/\s+/g, ' ');
    const modelRow = models.find((m) => {
      const bare = m.model.trim().replace(/\s+/g, ' ');
      const withBrand = `${m.brand} ${bare}`.trim();
      return bare === modelText || withBrand === modelText ||
        withBrand.replace(/\s+/g, '') === modelText.replace(/\s+/g, '');
    });
    if (!modelRow) {
      toast('型号请从下拉列表中选择已有机型', 'error');
      return;
    }
    const customerRow = customers.find((c) => c.name === form.customer.trim());

    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.set(key, value));
    data.set('model_id', String(modelRow.id));
    if (customerRow) data.set('customer_id', String(customerRow.id));
    files.forEach((file) => data.append('attachments', file));

    setSubmitting(true);
    setProgress(0);
    try {
      await api.uploadCase(data, setProgress);
      toast('案例已提交');
      reset();
      onSuccess();
      onClose();
    } catch (e: any) {
      toast(e.message || '提交失败，请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-[#14181D]/50 backdrop-blur-[3px]" onClick={onClose} />
      <div className="animate-pop relative flex max-h-[86vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[14px] bg-surface shadow-pop">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-6 py-[18px]">
          <Icon name="upload" className="h-[18px] w-[18px] text-accent" />
          <h3 className="m-0 font-display text-[16px] font-bold">上传维修案例</h3>
          <span className="ml-2 rounded-full bg-warn-soft px-2.5 py-1 text-[10.5px] text-warn">
            提交后进入审核流程
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-[30px] w-[30px] place-items-center rounded-lg bg-surface-2 text-muted transition-colors hover:bg-bad-soft hover:text-bad"
          >
            <Icon name="close" className="h-[15px] w-[15px]" />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-[22px]">
            <SectionTitle>01 / 基础信息</SectionTitle>
            <div className="grid grid-cols-2 gap-[18px]">
              <Field label="型号" required>
                <input
                  className={inputCls}
                  list="upload-models"
                  placeholder="输入或选择已有机型"
                  value={form.model}
                  onChange={(e) => set('model', e.target.value)}
                />
                <datalist id="upload-models">
                  {models.map((m) => (
                    <option key={m.id} value={`${m.brand} ${m.model}`.trim()} />
                  ))}
                </datalist>
              </Field>
              <Field label="客户">
                <input
                  className={inputCls}
                  list="upload-customers"
                  placeholder="输入或选择客户"
                  value={form.customer}
                  onChange={(e) => set('customer', e.target.value)}
                />
                <datalist id="upload-customers">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="故障分类">
                <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
                  <option value="">未分类</option>
                  {CASE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="填报人">
                <div className="flex h-[42px] items-center rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-muted">
                  {user?.name}（取自登录账号）
                </div>
              </Field>
              <Field label="更换配件">
                <input
                  className={inputCls}
                  placeholder="如 电源模块、内存"
                  value={form.parts}
                  onChange={(e) => set('parts', e.target.value)}
                />
              </Field>
              <Field label="维修日期">
                <input
                  className={inputCls}
                  type="date"
                  value={form.repaired_at}
                  onChange={(e) => set('repaired_at', e.target.value)}
                />
              </Field>
            </div>

            <SectionTitle className="mt-[30px]">02 / 维修过程</SectionTitle>
            <div className="grid grid-cols-2 gap-[18px]">
              <Field label="现象描述" required full>
                <textarea className={inputCls} rows={3} value={form.symptom} onChange={(e) => set('symptom', e.target.value)} />
              </Field>
              <Field label="诊断过程" full>
                <textarea className={inputCls} rows={3} value={form.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
              </Field>
              <Field label="解决方案" required full>
                <textarea className={inputCls} rows={3} value={form.solution} onChange={(e) => set('solution', e.target.value)} />
              </Field>
              <Field label="备注" full>
                <textarea className={inputCls} rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
              </Field>
            </div>

            <SectionTitle className="mt-[30px]">03 / 现场照片</SectionTitle>
            <ImagePicker files={files} onChange={setFiles} disabled={submitting} />
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-surface-2 px-6 py-4">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-accent px-6 py-[11px] text-[13px] font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
            >
              <Icon name="send" className="h-[15px] w-[15px]" />
              {submitting ? `上传中 ${progress}%` : '提交案例'}
            </button>
            {submitting && (
              <div className="h-[5px] w-40 overflow-hidden rounded bg-line">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-line bg-surface px-5 py-[10px] text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              取消
            </button>
            <span className="ml-auto text-[11.5px] text-muted">
              照片保存在服务器，查看需登录鉴权
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-[10px] text-[13px] leading-[1.7] text-ink outline-none transition-colors placeholder:text-[#B4BAC2] focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10';

function SectionTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mb-5 border-b border-line pb-3 font-mono text-[10.5px] tracking-[.16em] text-accent ${className}`}>
      {children}
    </div>
  );
}

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-[7px] ${full ? 'col-span-2' : ''}`}>
      <span className="text-[12px] font-semibold text-[#454D57]">
        {label}
        {required && <em className="ml-[3px] not-italic text-accent">*</em>}
      </span>
      {children}
    </label>
  );
}
