import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type {
  ImportBatch,
  ImportExecuteResult,
  ImportField,
  ImportParseResult,
  ImportRowPreview,
} from '../api/types';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import { Icon } from './Icon';

type Decision = { missing?: 'auto' | 'skip'; duplicate?: 'skip' | 'import' };

export function ImportModal({
  open,
  onClose,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const toast = useToast();
  const { isAdmin } = useRole();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [directApprove, setDirectApprove] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ImportExecuteResult | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);

  const loadBatches = () => {
    api.listImportBatches().then(setBatches).catch(() => undefined);
  };

  useEffect(() => {
    if (!open) return;
    loadBatches();
  }, [open]);

  const reset = () => {
    setFile(null);
    setParsed(null);
    setMapping({});
    setDecisions({});
    setReport(null);
    setProgress(0);
  };

  const parse = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!file) return toast('请先选择文件', 'error');
    setRunning(true);
    try {
      const data = new FormData();
      data.set('file', file);
      const result = await api.parseImport(data);
      setParsed(result);
      setMapping(result.suggestions);
      setDecisions({});
      setReport(null);
      toast(`已解析 ${result.rows} 行，请先确认列映射`);
    } catch (err: any) {
      toast(err.message || '文件解析失败', 'error');
    } finally {
      setRunning(false);
    }
  };

  const setDecision = (index: number, key: keyof Decision, value: 'auto' | 'skip' | 'import') => {
    setDecisions((prev) => ({ ...prev, [String(index)]: { ...prev[String(index)], [key]: value } }));
  };

  const execute = async () => {
    if (!parsed) return;
    setRunning(true);
    setProgress(0);
    let batchNo: string | undefined;
    let offset = 0;
    const failures: { index: number; reason: string }[] = [];
    let last: ImportExecuteResult | null = null;

    try {
      while (offset < parsed.rows) {
        const result = await api.executeImport({
          token: parsed.token,
          mapping,
          decisions,
          directApprove,
          batchNo,
          offset,
          limit: 50,
        });
        batchNo = result.batchNo;
        offset += result.processed;
        setProgress(Math.round((offset / parsed.rows) * 100));
        failures.push(...result.failures);
        last = result;
        if (result.done) break;
      }
      setReport(last ? { ...last, failures } : null);
      toast('导入完成，请查看报告');
      loadBatches();
      onFinished();
    } catch (e: any) {
      toast(e.message || '导入失败', 'error');
    } finally {
      setRunning(false);
    }
  };

  const rollback = async (batchNo: string) => {
    if (!window.confirm(`确认撤销批次 ${batchNo}？该批次导入的案例和照片都会被删除。`)) return;
    try {
      const result = await api.rollbackImportBatch(batchNo);
      toast(`已撤销，删除 ${result.deletedCases} 条案例`);
      loadBatches();
      onFinished();
    } catch (e: any) {
      toast(e.message || '撤销失败', 'error');
    }
  };

  const exportFailures = () => {
    if (!report) return;
    const header = ['行号', '失败原因'];
    const lines = [header, ...report.failures.map((f) => [String(f.index + 1), f.reason])];
    const csv = '\uFEFF' + lines.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-failures-${report.batchNo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-[#14181D]/55 backdrop-blur-[3px]" onClick={onClose} />
      <div className="animate-pop relative flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[14px] bg-surface shadow-pop">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-[18px]">
          <Icon name="upload" className="h-[18px] w-[18px] text-accent" />
          <h3 className="m-0 font-display text-[16px] font-bold">批量导入历史案例</h3>
          <button type="button" onClick={() => { reset(); onClose(); }} className="ml-auto grid h-[30px] w-[30px] place-items-center rounded-lg bg-surface-2 text-muted hover:text-bad">
            <Icon name="close" className="h-[15px] w-[15px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 text-[11.5px] leading-[1.8] text-bad">
            高危操作提醒：正式写库前系统会自动备份 repair.db；导入的案例默认进入待审核，不会污染现有检索结果。
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-[12px]" />
            <button type="button" onClick={() => void api.downloadImportTemplate()} className="rounded-lg border border-line px-3 py-2 text-[12px] text-[#4B535E] hover:border-accent hover:text-accent">
              下载导入模板 (.xlsx)
            </button>
            <button type="button" onClick={() => void parse()} disabled={!file || running} className="rounded-lg bg-accent px-4 py-2 text-[12px] text-white disabled:opacity-50">
              {running ? '解析中…' : '解析并预览'}
            </button>
            <span className="text-[11px] text-muted">支持 .xlsx / .csv（自动识别 UTF-8 与 GBK）</span>
          </div>

          {parsed && (
            <>
              <h4 className="mb-2 mt-6 font-display text-[14px] font-bold">01 / 列映射</h4>
              <div className="grid grid-cols-2 gap-3">
                {parsed.fields.map((field: ImportField) => (
                  <label key={field.key} className="flex items-center gap-2 text-[12px]">
                    <span className="w-[90px] shrink-0 text-[#454D57]">{field.label}</span>
                    <select
                      className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 py-2 text-[12px]"
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value === '' ? -1 : Number(e.target.value) }))}
                    >
                      <option value="">不导入</option>
                      {parsed.headers.map((header, index) => (
                        <option key={index} value={index}>{header || `第 ${index + 1} 列`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <h4 className="mb-2 mt-6 font-display text-[14px] font-bold">02 / 前 20 行预览与决策</h4>
              <div className="space-y-2">
                {parsed.preview.map((row: ImportRowPreview) => (
                  <div key={row.index} className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[11.5px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="font-mono text-[10px] text-[#A1A7AF]">行 {row.index + 1}</b>
                      <span>{row.values.brand} {row.values.model}</span>
                      <span className="text-muted">/ {row.values.customer || '无客户'}</span>
                      <span className="truncate text-muted">/ {row.values.symptom || '无现象'}</span>
                      {row.qualified ? <span className="ml-auto text-ok">合格</span> : <span className="ml-auto text-bad">不合格：{row.issues.join('；')}</span>}
                    </div>
                    {row.duplicate && (
                      <div className="mt-2 flex items-center gap-2 text-warn">
                        <span>完全重复（型号/客户/现象/维修日期都相同）：</span>
                        <button type="button" onClick={() => setDecision(row.index, 'duplicate', 'skip')} className={`rounded border px-2 py-1 ${decisions[String(row.index)]?.duplicate !== 'import' ? 'border-warn bg-warn-soft' : 'border-line'}`}>跳过</button>
                        <button type="button" onClick={() => setDecision(row.index, 'duplicate', 'import')} className={`rounded border px-2 py-1 ${decisions[String(row.index)]?.duplicate === 'import' ? 'border-accent bg-accent-soft' : 'border-line'}`}>照样导入</button>
                      </div>
                    )}
                    {row.recurrence && (
                      <div className="mt-2 rounded border border-warn/30 bg-warn-soft px-2 py-1 text-warn">
                        疑似同故障历史复发：型号/客户/现象相同但维修日期不同（返修或复发），将作为新记录正常入库，请工程师确认。
                      </div>
                    )}
                    {(row.modelMissing || row.customerMissing) && (
                      <div className="mt-2 flex items-center gap-2 text-muted">
                        <span>{row.modelMissing ? '机型' : ''}{row.modelMissing && row.customerMissing ? '、' : ''}{row.customerMissing ? '客户' : ''}库中不存在：</span>
                        <button type="button" onClick={() => setDecision(row.index, 'missing', 'auto')} className={`rounded border px-2 py-1 ${decisions[String(row.index)]?.missing === 'auto' ? 'border-accent bg-accent-soft' : 'border-line'}`}>自动创建</button>
                        <button type="button" onClick={() => setDecision(row.index, 'missing', 'skip')} className={`rounded border px-2 py-1 ${decisions[String(row.index)]?.missing !== 'auto' ? 'border-warn bg-warn-soft' : 'border-line'}`}>跳过此行</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {isAdmin && (
                <label className="mt-5 flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={directApprove} onChange={(e) => setDirectApprove(e.target.checked)} />
                  本次导入直接归档（仅工程师可用；不勾选则全部 pending）
                </label>
              )}

              <button type="button" onClick={() => void execute()} disabled={running} className="mt-5 rounded-lg bg-accent px-5 py-2.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
                {running ? `导入中 ${progress}%` : `确认导入 ${parsed.rows} 行`}
              </button>
              {running && <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-line"><div className="h-full bg-accent" style={{ width: `${progress}%` }} /></div>}
            </>
          )}

          {report && (
            <div className="mt-6 rounded-lg border border-line bg-surface-2 p-4">
              <h4 className="m-0 font-display text-[14px] font-bold">03 / 导入报告</h4>
              <p className="mb-3 mt-2 text-[12px]">
                批次 {report.batchNo} · 共 {report.total} 行 · 成功 <b className="text-ok">{report.success}</b> · 跳过 {report.skipped} · 失败 <b className="text-bad">{report.failed}</b>
              </p>
              {report.failures.length > 0 && (
                <button type="button" onClick={exportFailures} className="rounded-lg border border-bad/30 px-3 py-2 text-[12px] text-bad">导出失败行 CSV</button>
              )}
            </div>
          )}

          <h4 className="mb-2 mt-7 font-display text-[14px] font-bold">历史导入批次</h4>
          <div className="space-y-2">
            {batches.length === 0 && <p className="text-[12px] text-muted">暂无导入批次</p>}
            {batches.map((b) => (
              <div key={b.batch_no} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 text-[11.5px]">
                <span className="font-mono text-accent">{b.batch_no}</span>
                <span>{b.operator} · {b.created_at}</span>
                <span>共 {b.total} / 成功 {b.success} / 跳过 {b.skipped} / 失败 {b.failed}</span>
                <button type="button" onClick={() => void rollback(b.batch_no)} className="ml-auto text-bad hover:underline">撤销此批次</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
