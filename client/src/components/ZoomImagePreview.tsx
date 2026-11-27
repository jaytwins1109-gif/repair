import { useEffect, useRef } from 'react';
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import { Icon } from './Icon';

interface Props {
  src: string;
  alt: string;
  title: string;
  onClose: () => void;
}

/** 第 42 轮机型图纸的大图预览：滚轮缩放 + 拖拽平移，第 50 轮抽成共享组件给知识库图片复用 */
export function ZoomImagePreview({ src, alt, title, onClose }: Props) {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const btn = 'rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/20';

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#14181D]/90">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-3">
        <span className="max-w-[420px] truncate text-sm font-semibold text-white">{title}</span>
        <span className="hidden text-[11px] text-white/50 sm:inline">滚轮缩放 · 拖拽平移</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={btn} onClick={() => transformRef.current?.zoomIn(0.3)}>放大</button>
          <button type="button" className={btn} onClick={() => transformRef.current?.zoomOut(0.3)}>缩小</button>
          <button type="button" className={btn} onClick={() => transformRef.current?.resetTransform()}>重置</button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭预览"
            className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <Icon name="close" className="h-[15px] w-[15px]" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          minScale={0.2}
          maxScale={8}
          centerOnInit
          wheel={{ step: 0.12 }}
        >
          <TransformComponent
            wrapperClass="!h-full !w-full"
            contentClass="flex h-full w-full items-center justify-center"
          >
            <img src={src} alt={alt} className="max-w-none select-none shadow-2xl" draggable={false} />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  );
}
