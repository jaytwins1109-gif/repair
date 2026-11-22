import { useAuth } from '../hooks/useAuth';
import { Icon } from './Icon';

export function Header({
  title,
  subtitle,
  search,
  onSearchChange,
  onSearchSubmit,
  onUpload,
}: {
  title: string;
  subtitle: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onUpload: () => void;
}) {
  const { user, logout } = useAuth();

  return (
    <header className="z-10 flex h-[66px] shrink-0 items-center gap-3 border-b border-line bg-white/90 px-[26px] backdrop-blur">
      <div className="min-w-0 font-display text-[16px] font-semibold text-ink">
        {title}
        <small className="mt-[2px] block font-body text-[10.5px] font-normal tracking-normal text-muted">
          {subtitle}
        </small>
      </div>

      <div className="flex-1" />

      <div className="relative w-[min(280px,30vw)]">
        <Icon
          name="search"
          className="pointer-events-none absolute left-[11px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted"
        />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearchSubmit();
          }}
          placeholder="全局搜索案例 / 型号 / 客户"
          className="w-full rounded-lg border border-line bg-surface-2 py-[9px] pl-[34px] pr-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-[#AEB4BC] focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10"
        />
      </div>

      <button
        type="button"
        onClick={onUpload}
        className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface-2 px-3 py-[9px] text-[12px] text-[#4B535E] transition-colors hover:border-accent hover:text-accent"
      >
        <Icon name="upload" className="h-[15px] w-[15px]" />
        上传案例
      </button>

      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 py-[6px] pl-3 pr-[6px]">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-graphite font-display text-[12px] text-white">
          {user?.name.slice(0, 1)}
        </div>
        <div className="whitespace-nowrap leading-tight">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
            {user?.name}
            <span
              className={`rounded px-[6px] py-[2px] text-[10px] font-medium ${
                user?.role === 'engineer'
                  ? 'bg-accent-soft text-accent'
                  : 'bg-[#EFECE5] text-[#6E7680]'
              }`}
            >
              {user?.role === 'engineer' ? '工程师' : '技术员'}
            </span>
          </div>
          <div className="mt-[3px] font-mono text-[9.5px] text-muted">
            {user?.emp_no} · {user?.position}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          title="退出登录"
          className="grid h-[30px] w-[30px] place-items-center rounded-md text-muted transition-colors hover:bg-bad-soft hover:text-bad"
        >
          <Icon name="logout" className="h-[15px] w-[15px]" />
        </button>
      </div>
    </header>
  );
}
