import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fetchModelAssetBlob } from '../api';
import type { ModelAsset } from '../api/types';
import { useToast } from '../hooks/useToast';
import { Icon } from './Icon';
import { ZoomImagePreview } from './ZoomImagePreview';

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
}

export function ModelAssetDrawer({
  open,
  modelName,
  onClose,
}: {
  open: boolean;
  modelName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [assets, setAssets] = useState<ModelAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ asset: ModelAsset; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!open || !modelName) return;
    setLoading(true);
    api
      .listModelAssets(modelName)
      .then(setAssets)
      .catch((e: any) => toast(e.message || '加载图纸资料失败', 'error'))
      .finally(() => setLoading(false));
  }, [open, modelName, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => { if (!open) setPreview(null); }, [open]);

  if (!open) return null;

  const doUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const row = await api.uploadModelAsset(modelName, file);
      setAssets((prev) => [row, ...prev]);
      toast('图纸资料已上传');
    } catch (e: any) {
      toast(e.message || '上传失败', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openPreview = async (asset: ModelAsset) => {
    try {
      const blob = await fetchModelAssetBlob(asset.id);
      const url = URL.createObjectURL(blob);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { asset, url };
      });
    } catch (e: any) {
      toast(e.message || '预览失败', 'error');
    }
  };

  const remove = async (asset: ModelAsset) => {
    if (!window.confirm(`确认删除图纸「${asset.original_name}」？`)) return;
    try {
      await api.deleteModelAsset(asset.id);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      toast('图纸资料已删除');
    } catch (e: any) {
      toast(e.message || '删除失败', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-[#14181D]/55 backdrop-blur-[3px]" onClick={onClose} />
      <aside className="animate-pop absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col bg-surface shadow-pop">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-[18px]">
          <span className="rounded bg-graphite px-2 py-1 font-mono text-[10.5px] text-[#F3F5F7]">{modelName}</span>
          <div className="text-[13px] font-semibold text-ink">机型资料图纸</div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3 py-[9px] text-[12px] font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
          >
            <Icon name="upload" className="h-[14px] w-[14px]" />
            {uploading ? '上传中…' : '上传图纸'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => void doUpload(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={onClose}
            className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-surface-2 text-muted hover:text-bad"
            title="关闭"
          >
            <Icon name="close" className="h-[15px] w-[15px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="mb-4 text-[11.5px] leading-[1.7] text-muted">
            图纸按机型共享，支持 PDF / PNG / JPEG / WEBP，单个文件最大 30MB。图片可滚轮缩放与拖拽平移。
          </p>
          {loading ? (
            <div className="py-16 text-center text-[12.5px] text-muted">加载中…</div>
          ) : assets.length === 0 ? (
            <div className="py-16 text-center text-[12.5px] text-muted">该机型暂无图纸资料，点击右上角上传。</div>
          ) : (
            <div className="grid gap-3">
              {assets.map((asset) => (
                <div key={asset.id} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-graphite px-2 py-1 font-mono text-[10px] text-white">
                      {asset.file_type === 'pdf' ? 'PDF' : '图片'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={asset.original_name}>
                      {asset.original_name}
                    </span>
                    <button type="button" onClick={() => void openPreview(asset)} className="text-[11.5px] text-accent hover:underline">
                      预览
                    </button>
                    <button type="button" onClick={() => void remove(asset)} className="text-[11.5px] text-bad hover:underline">
                      删除
                    </button>
                  </div>
                  <div className="mt-2 font-mono text-[10px] text-muted">
                    {formatSize(asset.size)} · {asset.uploader} · {asset.created_at}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {preview &&
        (preview.asset.file_type === 'image' ? (
          <ZoomImagePreview
            src={preview.url}
            alt={preview.asset.original_name}
            title={preview.asset.original_name}
            onClose={() => setPreview(null)}
          />
        ) : (
          <div className="fixed inset-0 z-[70] flex flex-col bg-[#14181D]/90">
            <div className="flex shrink-0 items-center gap-3 bg-[#1B2027] px-5 py-3 text-white">
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{preview.asset.original_name}</span>
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
                title={preview.asset.original_name}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        ))}
    </div>
  );
}
