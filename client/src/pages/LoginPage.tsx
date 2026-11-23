import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Icon } from '../components/Icon';

export function LoginPage() {
  const { login } = useAuth();
  const [empNo, setEmpNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    if (!empNo.trim() || !password) {
      setError('工号或密码不正确');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(empNo.trim(), password);
    } catch (e: any) {
      setError(e.message || '工号或密码不正确');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-graphite">
      <div className="sidebar-grid relative hidden w-[45%] flex-col justify-between overflow-hidden border-r border-white/[.07] p-[7vh_6vw] md:flex">
        <div className="pointer-events-none absolute -left-24 top-[18%] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(216,91,42,.22),transparent_68%)]" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[10px] border border-accent/55 bg-accent/10 text-accent">
            <Icon name="board" className="h-6 w-6" />
          </div>
          <div>
            <div className="font-display text-[16px] font-bold text-white">主板维修助手</div>
            <div className="mt-[3px] font-mono text-[9.5px] tracking-[.18em] text-[#7D8794]">
              REPAIR AGENT / v1.0
            </div>
          </div>
        </div>

        <div className="relative max-w-[520px]">
          <div className="mb-5 font-mono text-[11px] tracking-[.22em] text-accent">
            SERVER BOARD · KNOWLEDGE SYSTEM
          </div>
          <h1 className="m-0 font-display text-[clamp(34px,4.2vw,58px)] font-bold leading-[1.2] tracking-[-.02em] text-white">
            维修经验，
            <br />
            <span className="text-accent">按权限沉淀</span>
          </h1>
          <p className="mt-6 max-w-[440px] text-[14px] leading-[2] text-[#9BA4AF]">
            对话检索历史案例，上传现场维修记录，由工程师审核后归档为团队知识。
          </p>
        </div>

        <div className="relative font-mono text-[10.5px] leading-[1.9] text-[#616B77]">
          ENGINEER / 全量查询 · 编辑 · 审核 · 基础数据管理
          <br />
          TECHNICIAN / 检索 · 已归档查看 · 上传 · 本人记录维护
        </div>
      </div>

      <div className="engineering-grid flex flex-1 items-center justify-center bg-paper px-8">
        <div className="w-full max-w-[390px]">
          <div className="mb-9 md:hidden">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-[10px] bg-graphite text-accent">
              <Icon name="board" className="h-6 w-6" />
            </div>
            <div className="font-display text-[20px] font-bold">主板维修助手</div>
          </div>

          <div className="mb-2 font-mono text-[10px] tracking-[.2em] text-accent">
            AUTHENTICATION
          </div>
          <h2 className="mb-2 font-display text-[30px] font-bold tracking-tight">登录工作台</h2>
          <p className="mb-8 text-[13px] text-muted">请使用工号与密码进入系统</p>

          <form onSubmit={(e) => void submit(e)} className="space-y-5">
            <label className="block">
              <span className="mb-[7px] block text-[12px] font-semibold text-[#454D57]">工号</span>
              <div className="relative">
                <Icon
                  name="user"
                  className="pointer-events-none absolute left-[13px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-muted"
                />
                <input
                  autoFocus
                  value={empNo}
                  onChange={(e) => {
                    setEmpNo(e.target.value);
                    setError('');
                  }}
                  placeholder="例如 WX1001"
                  className="w-full rounded-lg border border-line bg-white py-[13px] pl-10 pr-3 font-mono text-[13.5px] outline-none transition-colors placeholder:font-body placeholder:text-[#B4BAC2] focus:border-accent focus:ring-4 focus:ring-accent/10"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-[7px] block text-[12px] font-semibold text-[#454D57]">密码</span>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="请输入密码"
                className="w-full rounded-lg border border-line bg-white px-[14px] py-[13px] text-[13.5px] outline-none transition-colors placeholder:text-[#B4BAC2] focus:border-accent focus:ring-4 focus:ring-accent/10"
              />
            </label>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-bad/20 bg-bad-soft px-3 py-[10px] text-[12px] text-bad">
                <Icon name="alert" className="h-[15px] w-[15px] shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-[13px] text-[14px] font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
            >
              {submitting ? '登录中…' : '登录'}
              {!submitting && <Icon name="chevronRight" className="h-[16px] w-[16px]" />}
            </button>
          </form>

          <div className="mt-8 border-t border-line pt-5 text-[11.5px] leading-[1.9] text-muted">
            演示账号（初始密码统一 <b className="font-mono text-ink">Repair@2026</b>）
            <br />
            <span className="font-mono text-[#5E6670]">WX1001</span> 陈立群 · 工程师
            <span className="mx-2 text-[#C8C2B7]">/</span>
            <span className="font-mono text-[#5E6670]">WX2001</span> 李文博 · 技术员
          </div>
        </div>
      </div>
    </div>
  );
}
