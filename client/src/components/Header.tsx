import { useAuth } from '../hooks/useAuth';
import { Icon } from './Icon';

export function Header({
  title,
  subtitle,
  onUpload,
}: {
  title: string;
  subtitle: string;
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
