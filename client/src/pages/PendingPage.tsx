import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Case } from '../api/types';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';

export function PendingPage({
  onChanged,
  onOpenCase,
  onEditCase,
}: {
  onChanged: () => void;
  onOpenCase: (item: Case) => void;
  onEditCase: (item: Case) => void;
}) {
  const { isAdmin, user } = useRole();
  const toast = useToast();
  const [list, setList] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasonFor, setReasonFor] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const load = () => {
    setLoading(true);
    api
      .listCases({
        status: isAdmin ? undefined : undefined,
        scope: isAdmin ? 'review' : 'mine',
        pageSize: 100,
        sort: 'created_at',
        order: 'desc',
      })
      .then((res) => setList(res.list))
      .catch((e: any) => toast(e.message || '加载列表失败', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [isAdmin, user?.emp_no, onChanged, toast]);

  const review = async (item: Case, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') {
        await api.approveCase(item.id);
        toast('已通过并归档');
      } else {
        if (!reason.trim()) return toast('驳回原因不能为空', 'error');
        await api.rejectCase(item.id, reason.trim());
        toast('已驳回，原因已通知作者');
      }
      setReasonFor(null);
      setReason('');
      load();
      onChanged();
    } catch (e: any) {
      toast(e.message || '操作失败', 'error');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="engineering-grid flex shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-7 py-4">
        <div className="text-[12.5px] text-muted">
          {isAdmin ? '待审核 / 已驳回' : '我的提交'}：
          <b className="mx-1 font-mono text-[15px] text-accent">{list.length}</b> 条
        </div>
        <div className="flex-1" />
        {!isAdmin && (
          <span className="rounded bg-[#EFECE5] px-2.5 py-1 text-[11px] text-[#6E7680]">
            当前账号为只读权限
          </span>
        )}
      </div>

      <div className="engineering-grid flex-1 overflow-y-auto p-7">
        {loading ? (
          <div className="py-20 text-center text-[12.5px] text-muted">加载中…</div>
        ) : list.length === 0 ? (
          <div className="py-20 text-center">
            <Icon name="review" className="mx-auto mb-4 h-10 w-10 text-[#C8C2B7]" />
            <p className="m-0 text-[13px] text-muted">暂无记录</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4">
            {list.map((item) => (
              <article key={item.id} className="flex cursor-pointer flex-col gap-3 rounded-card border border-line bg-surface p-[18px] shadow-card transition-all hover:-translate-y-0.5 hover:border-accent" onClick={() => onOpenCase(item)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-graphite px-2 py-1 font-mono text-[10.5px] text-[#F3F5F7]">{item.model}</span>
                  <span className="text-[11.5px] text-muted">{item.customer || '未指定客户'}</span>
                  <span className="ml-auto font-mono text-[10px] text-[#A1A7AF]">#{item.id}</span>
                </div>
                <h3 className="m-0 text-[14px] font-semibold leading-[1.6] text-ink">{item.symptom}</h3>
                {item.status === 'rejected' && item.reject_reason && (
                  <div className="rounded bg-bad-soft px-3 py-2 text-[11.5px] leading-[1.7] text-bad">
                    驳回原因：{item.reject_reason}
                  </div>
                )}
                <p className="m-0 line-clamp-2 text-[12px] leading-[1.75] text-muted">{item.diagnosis || item.solution || '暂无详细记录'}</p>
                <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
                  <StatusBadge status={item.status} />
                  <span className="font-mono text-[10px] text-[#A6ACB4]">{item.created_at}</span>
                  <span className="ml-auto text-[11px] text-accent">查看详情</span>
                </div>

                {isAdmin && item.status !== 'approved' && (
                  <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void review(item, 'approve')} className="flex-1 rounded-lg bg-ok px-3 py-2 text-[12px] font-medium text-white">通过并归档</button>
                      <button type="button" onClick={() => { setReasonFor(item.id); setReason(''); }} className="flex-1 rounded-lg border border-bad/30 bg-surface px-3 py-2 text-[12px] text-bad">驳回</button>
                    </div>
                    {reasonFor === item.id && (
                      <div>
                        <textarea
                          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] outline-none focus:border-accent"
                          rows={2}
                          placeholder="驳回原因（必填）"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <div className="mt-1 flex gap-2">
                          <button type="button" onClick={() => void review(item, 'reject')} className="rounded bg-bad px-3 py-1.5 text-[11.5px] text-white">确认驳回</button>
                          <button type="button" onClick={() => setReasonFor(null)} className="rounded border border-line px-3 py-1.5 text-[11.5px] text-muted">取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!isAdmin && item.status === 'rejected' && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEditCase(item); }}
                    className="rounded-lg border border-accent/40 px-3 py-2 text-[12px] text-accent"
                  >
                    修改并重新提交
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
