import type { CaseStatus } from '../api/types';

const MAP: Record<CaseStatus, { label: string; className: string }> = {
  approved: { label: '已存档', className: 'bg-ok-soft text-ok' },
  pending: { label: '待审核', className: 'bg-warn-soft text-warn' },
  rejected: { label: '已驳回', className: 'bg-bad-soft text-bad' },
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  const item = MAP[status] || MAP.pending;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10.5px] font-medium ${item.className}`}
    >
      {item.label}
    </span>
  );
}
