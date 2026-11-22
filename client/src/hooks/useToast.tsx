import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  text: string;
  type: ToastType;
}

const ToastContext = createContext<{ push: (text: string, type?: ToastType) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((text: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, text, type }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-8 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`animate-pop flex items-center gap-2 rounded-lg border-l-[3px] px-5 py-3 text-[12.5px] text-white shadow-pop ${
              item.type === 'error'
                ? 'border-bad bg-graphite'
                : item.type === 'info'
                  ? 'border-accent bg-graphite'
                  : 'border-ok bg-graphite'
            }`}
          >
            <Icon
              name={item.type === 'error' ? 'alert' : 'check'}
              className="h-4 w-4 shrink-0"
            />
            {item.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx.push;
}
