import { useEffect, useState } from 'react';
import { fetchAttachmentBlob } from '../api';
import type { Attachment } from '../api/types';
import { Icon } from './Icon';

function useAttachmentSrc(id: number | null): string {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (id === null) {
      setSrc('');
      return;
    }
    let cancelled = false;
    let objectUrl = '';
    fetchAttachmentBlob(id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc('');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return src;
}

function Thumbnail({
  item,
  onOpen,
  removable,
  onRemove,
}: {
  item: Attachment;
  onOpen: () => void;
  removable: boolean;
  onRemove?: (id: number) => void;
}) {
  const src = useAttachmentSrc(item.id);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-2">
      <button type="button" onClick={onOpen} className="block h-full w-full" title={item.original_name}>
        {src ? (
          <img src={src} alt={item.original_name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[11px] text-muted">加载中…</span>
        )}
      </button>
      {removable && onRemove && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          title="删除这张照片"
          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-graphite/80 text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function LargeImage({ item }: { item: Attachment }) {
  const src = useAttachmentSrc(item.id);
  return src ? (
    <img
      src={src}
      alt={item.original_name}
      className="max-h-[86vh] max-w-[86vw] object-contain"
      onClick={(e) => e.stopPropagation()}
    />
  ) : (
    <div className="grid h-[40vh] w-[40vw] place-items-center text-[13px] text-white/60" onClick={(e) => e.stopPropagation()}>
      图片加载中…
    </div>
  );
}

export function AttachmentGallery({
  attachments,
  onRemove,
  removable = false,
}: {
  attachments: Attachment[];
  onRemove?: (id: number) => void;
  removable?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const current = active === null ? null : attachments.find((a) => a.id === active) || null;

  useEffect(() => {
    if (current === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  function move(delta: number) {
    if (active === null || attachments.length === 0) return;
    const index = attachments.findIndex((a) => a.id === active);
    const next = (index + delta + attachments.length) % attachments.length;
    setActive(attachments[next].id);
  }

  if (attachments.length === 0) {
    return <p className="m-0 rounded-lg border border-dashed border-line px-4 py-5 text-center text-[12px] text-muted">暂无现场照片</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {attachments.map((item) => (
          <Thumbnail
            key={item.id}
            item={item}
            onOpen={() => setActive(item.id)}
            removable={removable}
            onRemove={onRemove}
          />
        ))}
      </div>

      {current && (
        <div key={current.id} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-6" onClick={() => setActive(null)}>
          <button
            type="button"
            onClick={() => move(-1)}
            className="absolute left-6 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="chevronLeft" className="h-6 w-6" />
          </button>
          <LargeImage item={current} />
          <button
            type="button"
            onClick={() => move(1)}
            className="absolute right-6 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="chevronRight" className="h-6 w-6" />
          </button>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center text-[12px] text-white/80">
            {current.original_name}
            <div className="mt-1 font-mono text-[10px] text-white/50">← → 切换 · ESC 关闭</div>
          </div>
        </div>
      )}
    </>
  );
}
