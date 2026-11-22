import type { ScoredCase } from '../api/types';
import { StatusBadge } from './StatusBadge';
import { Icon } from './Icon';

export function CaseCard({
  item,
  onOpen,
}: {
  item: ScoredCase;
  onOpen: (item: ScoredCase) => void;
}) {
  return (
    <article
      onClick={() => onOpen(item)}
      className="animate-rise mt-[11px] cursor-pointer overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-all hover:-translate-y-px hover:border-accent"
    >
      <div className="flex flex-wrap items-center gap-[9px] border-b border-line bg-surface-2 px-[14px] py-[11px]">
        <span className="rounded bg-graphite px-[9px] py-1 font-mono text-[10.5px] text-[#F3F5F7]">
          {item.model}
        </span>
        <span className="text-[11.5px] text-muted">{item.customer || '未指定客户'}</span>
        <StatusBadge status={item.status} />
        <span className="ml-auto font-mono text-[10px] text-[#A1A7AF]">
          {item.created_at}
        </span>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-accent">
          {item.similarity > 0 ? (
            <>
              匹配 {item.similarity}%
              <span className="h-[3px] w-11 overflow-hidden rounded bg-[#E8E3DA]">
                <span className="block h-full rounded bg-accent" style={{ width: `${item.similarity}%` }} />
              </span>
            </>
          ) : (
            <span className="rounded bg-[#E8F0E4] px-1.5 py-0.5 text-[#3C7A2E]">缓存结果</span>
          )}
        </div>
      </div>

      {item.matched && item.matched.length > 0 && (
        <div className="border-b border-line bg-accent-soft/30 px-[14px] py-[7px] text-[10.5px] leading-[1.6] text-[#6B6258]">
          <span className="font-mono text-[9.5px] tracking-[.06em] text-accent">命中：</span>
          {item.matched.join('、')}
        </div>
      )}

      <div className="grid gap-[9px] px-[14px] py-[13px]">
        <Row label="现象" value={item.symptom} />
        <Row label="诊断" value={item.diagnosis || '—'} />
        <Row label="方案" value={item.solution || '—'} />
        {item.parts && <Row label="配件" value={item.parts} />}
      </div>

      {(item.matched?.length > 0 || item.note) && (
        <div className="flex flex-wrap items-center gap-1.5 px-[14px] pb-[13px]">
          {item.matched?.slice(0, 4).map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className={`rounded px-2 py-[3px] text-[10.5px] ${
                i === 0 ? 'bg-accent-soft text-accent' : 'bg-[#F0EDE6] text-[#7A828C]'
              }`}
            >
              {tag}
            </span>
          ))}
          {item.note && (
            <span className="ml-auto flex items-center gap-1 text-[10.5px] text-[#9BA1A9]">
              <Icon name="alert" className="h-3 w-3" />
              {item.note}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-[10px] text-[12.5px] leading-[1.7]">
      <span className="w-[38px] shrink-0 text-[11.5px] font-medium text-[#9BA1A9]">
        {label}
      </span>
      <span className="min-w-0 text-[#363E48]">{value}</span>
    </div>
  );
}
