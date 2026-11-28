import { useEffect, useState, type ReactNode } from 'react';
import { api, fetchKnowledgeDocBlob } from '../api';
import { KNOWLEDGE_CATEGORIES, type KnowledgeDoc } from '../api/types';
import { Icon } from '../components/Icon';
import { ZoomImagePreview } from '../components/ZoomImagePreview';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';

type Preview = { doc: KnowledgeDoc; url: string } | null;

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

export function KnowledgePage() {
  const { role } = useRole();
  const canManageKnowledge = role === 'engineer';
  const toast = useToast();
  const [allDocs, setAllDocs] = useState<KnowledgeDoc[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [formCategory, setFormCategory] = useState<string>(KNOWLEDGE_CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);

  const loadAll = () => {
    api
      .listKnowledgeDocs()
      .then(setAllDocs)
      .catch((e: any) => toast(e.message || '加载分类统计失败', 'error'));
  };

  const load = () => {
    setLoading(true);
    api
      .listKnowledgeDocs(category, q)
      .then(setDocs)
      .catch((e: any) => toast(e.message || '加载文档列表失败', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, q, toast]);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const counts = KNOWLEDGE_CATEGORIES.reduce<Record<string, number>>((acc, name) => {
    acc[name] = allDocs.filter((d) => d.category === name).length;
    return acc;
  }, {});

  const openPreview = async (doc: KnowledgeDoc) => {
    if (doc.file_type !== 'pdf' && doc.file_type !== 'image') return;
    try {
      const blob = await fetchKnowledgeDocBlob(doc.id);
      const url = URL.createObjectURL(blob);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { doc, url };
      });
    } catch (e: any) {
      toast(e.message || '文档预览失败', 'error');
    }
  };

  const download = (doc: KnowledgeDoc) => {
    api
      .downloadKnowledgeDoc(doc.id, doc.file_name)
      .catch((e: any) => toast(e.message || '下载失败', 'error'));
  };

  const remove = async (doc: KnowledgeDoc) => {
    if (!window.confirm(`确认删除文档「${doc.title}」？`)) return;
    try {
      await api.deleteKnowledgeDoc(doc.id);
      toast('文档已删除');
      loadAll();
      load();
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      toast('请填写文档标题', 'error');
      return;
    }
    if (!file) {
      toast('请选择要上传的文档', 'error');
      return;
    }
    setUploading(true);
    try {
      await api.uploadKnowledgeDoc(formCategory, title.trim(), file);
      toast('技术文档已上传');
      setUploadOpen(false);
      setTitle('');
      setFile(null);
      loadAll();
      load();
    } catch (e: any) {
      toast(e.message || '上传失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  const navCls = (active: boolean) =>
    `mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors ${
      active ? 'bg-accent/15 text-accent' : 'text-[#4B535E] hover:bg-surface hover:text-ink'
    }`;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[224px] shrink-0 overflow-y-auto border-r border-line bg-surface-2 px-3 py-5">
        <div className="px-3 pb-3 text-[11px] font-semibold tracking-wide text-muted">分类目录</div>
        <button type="button" className={navCls(category === '')} onClick={() => setCategory('')}>
          <span>全部文档</span>
          <span className="font-mono text-[10.5px] opacity-70" aria-hidden="true">{allDocs.length}</span>
        </button>
        {KNOWLEDGE_CATEGORIES.map((name) => (
          <button
            type="button"
            key={name}
            className={navCls(category === name)}
            onClick={() => setCategory(name)}
          >
            <span>{name}</span>
            <span className="font-mono text-[10.5px] opacity-70" aria-hidden="true">{counts[name] || 0}</span>
          </button>
        ))}
        <p className="mt-6 px-3 text-[11px] leading-5 text-muted">
          仅按标题与文件名检索，暂不支持文档全文检索。PDF 与图片可在线预览，Office 文档请下载到本地查看。
        </p>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="engineering-grid flex shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-7 py-4">
          <div className="text-[12.5px] text-muted">
            共 <b className="mx-1 font-mono text-[15px] text-ink">{docs.length}</b> 篇文档
          </div>
          <div className="flex-1" />
          {!canManageKnowledge && (
            <span className="rounded bg-[#EFECE5] px-2.5 py-1 text-[11px] text-[#6E7680]">当前账号为只读权限</span>
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题 / 文件名…"
            className="w-[240px] rounded-lg border border-line bg-surface px-3 py-[9px] text-[12px] text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
          />
          {canManageKnowledge && (
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-[9px] text-[12px] font-medium text-white transition-colors hover:bg-accent-dark"
            >
              <Icon name="plus" className="h-[14px] w-[14px]" />
              上传文档
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-7">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">标题</th>
                  <th className="px-4 py-3 font-medium">分类</th>
                  <th className="px-4 py-3 font-medium">文件名</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">大小</th>
                  <th className="px-4 py-3 font-medium">上传人</th>
                  <th className="px-4 py-3 font-medium">上传时间</th>
                  <th className="w-[210px] px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-16 text-center text-[12.5px] text-muted">加载中…</td></tr>
                ) : docs.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-16 text-center text-[12.5px] text-muted">该分类下暂无文档</td></tr>
                ) : (
                  docs.map((doc) => (
                    <tr key={doc.id} className="border-b border-line/70 text-[12.5px] last:border-0 hover:bg-surface-2">
                      <td className="px-4 py-3 font-mono text-[11px] text-[#A1A7AF]">#{doc.id}</td>
                      <td className="px-4 py-3 text-ink">{doc.title}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-graphite px-2 py-1 text-[10.5px] text-[#F3F5F7]">{doc.category}</span>
                      </td>
                      <td className="px-4 py-3 text-[#4B535E]">{doc.file_name}</td>
                      <td className="px-4 py-3 font-mono text-[10.5px] uppercase text-muted">{doc.file_type}</td>
                      <td className="px-4 py-3 font-mono text-[10.5px] text-muted">{formatSize(doc.size)}</td>
                      <td className="px-4 py-3 text-muted">{doc.uploader}</td>
                      <td className="px-4 py-3 font-mono text-[10.5px] text-[#A1A7AF]">{doc.created_at}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {(doc.file_type === 'pdf' || doc.file_type === 'image') && (
                            <button type="button" onClick={() => void openPreview(doc)} className="text-[11.5px] text-accent hover:underline">
                              预览
                            </button>
                          )}
                          <button type="button" onClick={() => download(doc)} className="text-[11.5px] text-accent hover:underline">
                            下载
                          </button>
                          {canManageKnowledge && (
                            <button type="button" onClick={() => void remove(doc)} className="text-[11.5px] text-bad hover:underline">
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-[#14181D]/50 backdrop-blur-[3px]" onClick={() => setUploadOpen(false)} />
          <div className="animate-pop relative w-full max-w-[520px] rounded-[14px] bg-surface shadow-pop">
            <div className="flex items-center gap-2 border-b border-line px-6 py-[18px]">
              <h3 className="m-0 font-display text-[16px] font-bold">上传技术文档</h3>
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="ml-auto grid h-[30px] w-[30px] place-items-center rounded-lg bg-surface-2 text-muted hover:text-bad"
              >
                <Icon name="close" className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="grid gap-4 px-6 py-6">
              <Field label="分类 *">
                <select className={inputCls} value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                  {KNOWLEDGE_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="标题 *">
                <input
                  className={inputCls}
                  value={title}
                  placeholder="如 Intel 平台上电时序"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="文件 * (PDF / Word / Excel / PPT / 图片，最大 50MB)">
                <input
                  type="file"
                  accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,image/*"
                  className={inputCls}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-3 border-t border-line bg-surface-2 px-6 py-4">
              <button type="button" onClick={() => setUploadOpen(false)} className="rounded-lg border border-line bg-surface px-4 py-[10px] text-[12px] text-muted hover:border-accent hover:text-accent">取消</button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => void submit()}
                className="rounded-lg bg-accent px-5 py-[10px] text-[12px] font-medium text-white hover:bg-accent-dark disabled:opacity-60"
              >
                {uploading ? '上传中…' : '上传'}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview &&
        (preview.doc.file_type === 'image' ? (
          <ZoomImagePreview
            src={preview.url}
            alt={preview.doc.file_name}
            title={preview.doc.title}
            onClose={() => setPreview(null)}
          />
        ) : (
          <div className="fixed inset-0 z-[70] flex flex-col bg-[#14181D]/90">
            <div className="flex shrink-0 items-center gap-3 bg-[#1B2027] px-5 py-3 text-white">
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{preview.doc.title}</span>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-white/10 hover:bg-white/20"
                title="关闭预览"
              >
                <Icon name="close" className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <iframe
                src={`${preview.url}#toolbar=1`}
                title={preview.doc.file_name}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        ))}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-[10px] text-[13px] text-ink outline-none focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-[12px] font-semibold text-[#454D57]">{label}</span>
      {children}
    </label>
  );
}
