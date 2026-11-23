import { randomBytes } from 'crypto';
import XLSX from 'xlsx';
import { db, type CaseRow, type ModelRow, type CustomerRow } from '../db';
import { CASE_CATEGORIES } from '../routes/cases';
import { backupDatabase } from './backup';
import { deleteAttachmentsOfCase } from './attachments';
import { clearCache } from './cache';

export const IMPORT_FIELDS = [
  { key: 'brand', label: '品牌' },
  { key: 'model', label: '型号' },
  { key: 'customer', label: '客户' },
  { key: 'symptom', label: '故障现象' },
  { key: 'diagnosis', label: '诊断过程' },
  { key: 'solution', label: '解决方案' },
  { key: 'category', label: '故障分类' },
  { key: 'parts', label: '更换配件' },
  { key: 'repairDate', label: '维修日期' },
  { key: 'note', label: '备注' },
] as const;

export type FieldKey = (typeof IMPORT_FIELDS)[number]['key'];

interface ImportSession {
  token: string;
  fileName: string;
  headers: string[];
  rows: string[][];
  createdAt: number;
}

const sessions = new Map<string, ImportSession>();

function decodeCsv(buffer: Buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk', { fatal: true }).decode(buffer);
    } catch {
      throw new Error('CSV 编码无法识别，请用 Excel 另存为「CSV UTF-8」后重新上传');
    }
  }
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

export function parseImportFile(buffer: Buffer, fileName: string) {
  let table: string[][];
  if (/\.csv$/i.test(fileName)) {
    table = parseCsv(decodeCsv(buffer));
  } else if (/\.xlsx$/i.test(fileName)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: false });
  } else {
    throw new Error('仅支持 .xlsx 或 .csv 文件');
  }

  table = table
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''));

  if (table.length < 2) throw new Error('文件中没有可导入的数据行');
  if (table.length - 1 > 500) throw new Error('一次最多处理 500 行，请拆分文件后再导入');

  const headers = table[0];
  const rows = table.slice(1);
  const token = randomBytes(16).toString('hex');
  sessions.set(token, { token, fileName, headers, rows, createdAt: Date.now() });
  const mapping = suggestMapping(headers);

  return {
    token,
    headers,
    suggestions: mapping,
    rows: rows.length,
    preview: rows.slice(0, 20).map((row, index) => validateRow(row, mapping, index)),
    duplicateFlags: rows.map((row, index) => validateRow(row, mapping, index).duplicate),
    recurrenceFlags: rows.map((row, index) => validateRow(row, mapping, index).recurrence),
  };
}

export function suggestMapping(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  headers.forEach((header, index) => {
    const h = String(header).trim();
    for (const field of IMPORT_FIELDS) {
      if (result[field.key] !== undefined) continue;
      if (h === field.label || h.includes(field.label) || field.label.includes(h)) {
        result[field.key] = index;
        break;
      }
    }
  });
  return result;
}

function normalized(value: string) {
  return String(value || '').toLowerCase().replace(/[\s_－-]/g, '');
}

/** 校验维修日期是否合法：空字符串视为合法（可空字段），否则必须是 YYYY-MM-DD 且日期存在 */
function isValidRepairDate(value: string): boolean {
  const v = String(value || '').trim();
  if (!v) return true;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function findModel(brand: string, model: string) {
  const target = normalized(model);
  return (db.prepare('SELECT * FROM models').all() as ModelRow[]).find((m) => {
    const full = normalized(`${m.brand}${m.model}`);
    return (
      full === normalized(`${brand}${model}`) ||
      normalized(m.model) === target ||
      full.includes(target) && target.length >= 4
    );
  });
}

function findCustomer(customer: string) {
  const target = normalized(customer);
  if (!target) return undefined;
  return (db.prepare('SELECT * FROM customers').all() as CustomerRow[]).find((c) => {
    const name = normalized(c.name);
    return name === target || name.includes(target) || target.includes(name);
  });
}

function symptomMatch(a: string, b: string): boolean {
  const x = normalized(a);
  const y = normalized(b);
  return x === y || x.includes(y) || y.includes(x);
}

/** 完全重复：同型号+客户+现象+维修日期（都相同才算重复，返修不同日期不算） */
function isDuplicate(model: string, customer: string, symptom: string, repairDate: string) {
  const m = normalized(model);
  const c = normalized(customer);
  if (!m) return false;
  const rows = db.prepare('SELECT model, customer, symptom, repaired_at FROM cases').all() as CaseRow[];
  return rows.some((row) => {
    if (normalized(row.model) !== m) return false;
    if (c && normalized(row.customer) !== c) return false;
    if (!symptomMatch(row.symptom, symptom)) return false;
    return (row.repaired_at || '') === (repairDate || '');
  });
}

/** 疑似同故障历史复发：同型号+客户+现象但维修日期不同 */
function isRecurrence(model: string, customer: string, symptom: string, repairDate: string) {
  const m = normalized(model);
  const c = normalized(customer);
  if (!m) return false;
  const rows = db.prepare('SELECT model, customer, symptom, repaired_at FROM cases').all() as CaseRow[];
  return rows.some((row) => {
    if (normalized(row.model) !== m) return false;
    if (c && normalized(row.customer) !== c) return false;
    if (!symptomMatch(row.symptom, symptom)) return false;
    return (row.repaired_at || '') !== (repairDate || '');
  });
}

export interface RowPreview {
  index: number;
  values: Record<string, string>;
  issues: string[];
  duplicate: boolean;
  recurrence: boolean;
  modelMissing: boolean;
  customerMissing: boolean;
  qualified: boolean;
}

function validateRow(row: string[], mapping: Record<string, number>, index: number): RowPreview {
  const values: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    const col = mapping[field.key];
    values[field.key] = col === undefined ? '' : String(row[col] ?? '').trim();
  }

  const issues: string[] = [];
  if (!values.symptom) issues.push('故障现象为空');
  if (!values.solution) issues.push('解决方案为空');
  if (!values.model) issues.push('型号为空');
  if (values.category && !CASE_CATEGORIES.includes(values.category)) {
    // 回显用户原始值放到最前，既方便对照修正，也让“导出失败行 CSV”能真实覆盖公式注入防护
    issues.push(`${values.category}：故障分类不在可选值里`);
  }
  if (!isValidRepairDate(values.repairDate)) {
    issues.push('维修日期不是合法日期（应为 YYYY-MM-DD）');
  }

  const modelRow = findModel(values.brand, values.model);
  const customerRow = values.customer ? findCustomer(values.customer) : undefined;
  const modelMissing = !!values.model && !modelRow;
  const customerMissing = !!values.customer && !customerRow;
  const duplicate = isDuplicate(values.model, values.customer, values.symptom, values.repairDate);
  const recurrence = !duplicate && isRecurrence(values.model, values.customer, values.symptom, values.repairDate);

  return {
    index,
    values,
    issues,
    duplicate,
    recurrence,
    modelMissing,
    customerMissing,
    qualified: issues.length === 0,
  };
}

export function getSession(token: string) {
  return sessions.get(token);
}

export interface ExecuteResult {
  batchNo: string;
  processed: number;
  success: number;
  skipped: number;
  failed: number;
  total: number;
  done: boolean;
  failures: { index: number; reason: string }[];
}

export function executeImport(
  token: string,
  options: {
    mapping: Record<string, number>;
    decisions: Record<string, { missing?: 'auto' | 'skip'; duplicate?: 'skip' | 'import' }>;
    directApprove: boolean;
    author: string;
    empNo: string;
    batchNo?: string;
    offset: number;
    limit: number;
  }
): ExecuteResult {
  const session = sessions.get(token);
  if (!session) throw new Error('导入会话已失效，请重新上传文件');
  if (session.rows.length > 500) throw new Error('一次最多处理 500 行');

  let batchNo = String(options.batchNo || '').trim();
  if (!batchNo) {
    backupDatabase(db);
    batchNo = `IMP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare(
      `INSERT INTO import_batches (batch_no, operator, operator_emp_no, direct_approve, total)
       VALUES (?, ?, ?, ?, ?)`
    ).run(batchNo, options.author, options.empNo, options.directApprove ? 1 : 0, session.rows.length);
  }

  const end = Math.min(session.rows.length, options.offset + options.limit);
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const failures: { index: number; reason: string }[] = [];

  const insertCase = db.prepare(
    `INSERT INTO cases
     (model, customer, symptom, diagnosis, solution, parts, note, repaired_at, category, status, author,
      model_id, customer_id, reviewer, reviewed_at, reject_reason, import_batch_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
  );

  const transaction = db.transaction(() => {
    for (let i = options.offset; i < end; i++) {
      const preview = validateRow(session.rows[i], options.mapping, i);
      const decision = options.decisions[String(i)] || {};

      if (!preview.qualified) {
        failed++;
        failures.push({ index: i, reason: preview.issues.join('；') });
        continue;
      }
      if (preview.duplicate && decision.duplicate !== 'import') {
        skipped++;
        continue;
      }
      if ((preview.modelMissing || preview.customerMissing) && decision.missing !== 'auto') {
        skipped++;
        continue;
      }

      let modelRow = findModel(preview.values.brand, preview.values.model);
      if (!modelRow) {
        const info = db
          .prepare('INSERT INTO models (brand, model, platform, note) VALUES (?, ?, ?, ?)')
          .run(preview.values.brand || '', preview.values.model, '', '批量导入自动创建');
        modelRow = db.prepare('SELECT * FROM models WHERE id = ?').get(info.lastInsertRowid) as ModelRow;
      }

      let customerRow = preview.values.customer ? findCustomer(preview.values.customer) : undefined;
      if (preview.values.customer && !customerRow) {
        const info = db
          .prepare('INSERT INTO customers (name, contact, note) VALUES (?, ?, ?)')
          .run(preview.values.customer, '', '批量导入自动创建');
        customerRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid) as CustomerRow;
      }

      const approved = options.directApprove;
      const now = approved ? new Date().toISOString() : null;
      insertCase.run(
        preview.values.model,
        preview.values.customer,
        preview.values.symptom,
        preview.values.diagnosis,
        preview.values.solution,
        preview.values.parts,
        preview.values.note,
        preview.values.repairDate ? preview.values.repairDate.trim() : null,
        preview.values.category,
        approved ? 'approved' : 'pending',
        options.empNo,
        modelRow.id,
        customerRow?.id ?? null,
        approved ? options.author : '',
        now,
        batchNo
      );
      success++;
    }

    db.prepare(
      `UPDATE import_batches SET success = success + ?, skipped = skipped + ?, failed = failed + ? WHERE batch_no = ?`
    ).run(success, skipped, failed, batchNo);
  });

  transaction();
  clearCache();

  return {
    batchNo,
    processed: end - options.offset,
    success,
    skipped,
    failed,
    total: session.rows.length,
    done: end >= session.rows.length,
    failures,
  };
}

export function listBatches() {
  return db.prepare('SELECT * FROM import_batches ORDER BY id DESC').all() as {
    id: number;
    batch_no: string;
    operator: string;
    operator_emp_no: string;
    direct_approve: number;
    total: number;
    success: number;
    skipped: number;
    failed: number;
    created_at: string;
  }[];
}

export function rollbackBatch(batchNo: string) {
  const batch = db.prepare('SELECT * FROM import_batches WHERE batch_no = ?').get(batchNo);
  if (!batch) throw new Error('导入批次不存在');
  const rows = db.prepare('SELECT id FROM cases WHERE import_batch_no = ?').all(batchNo) as { id: number }[];
  rows.forEach((row) => deleteAttachmentsOfCase(row.id));
  db.prepare('DELETE FROM cases WHERE import_batch_no = ?').run(batchNo);
  db.prepare('DELETE FROM import_batches WHERE batch_no = ?').run(batchNo);
  clearCache();
  return { deletedCases: rows.length, batchNo };
}

export function templateRows() {
  return [
    [...IMPORT_FIELDS.map((f) => f.label)],
    [
      '联想',
      'SR650',
      '华为',
      '开机无显示，风扇满转',
      '测量 12V 输出偏低，疑似电源模块老化',
      '更换电源模块后恢复正常',
      '供电类',
      '电源模块',
      '2026-11-21',
      '示例数据，请按实际情况填写',
    ],
  ];
}
