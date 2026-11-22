import { db, type ModelAliasRow, type SymptomDictRow } from '../db';

export interface NormalizeResult {
  standards: string[];
  details: Array<{ standard: string; from: string; category: string }>;
}

export interface MatchToken {
  field: 'model' | 'customer' | 'symptom' | 'extra';
  /** 展示用的规范文本 */
  text: string;
  /** 用于匹配的等价形式（标准词 + 别名 / 机型别名） */
  variants: string[];
  source: 'raw' | 'dict' | 'ai';
  from?: string;
}

function splitAliases(s: string): string[] {
  return String(s || '')
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function loadSymptomDict(): SymptomDictRow[] {
  return db.prepare('SELECT * FROM symptom_dict').all() as SymptomDictRow[];
}

function loadModelAliases(): ModelAliasRow[] {
  return db.prepare('SELECT * FROM model_alias').all() as ModelAliasRow[];
}

/** 把文本中的现象说法归一化为标准词，并记录从哪个别名命中 */
export function normalizeSymptoms(text: string): NormalizeResult {
  const low = String(text || '').toLowerCase();
  const standards: string[] = [];
  const details: NormalizeResult['details'] = [];
  for (const row of loadSymptomDict()) {
    const allWords = [row.standard, ...splitAliases(row.aliases)];
    const hit = allWords.find((w) => low.includes(w.toLowerCase()));
    if (hit) {
      standards.push(row.standard);
      details.push({ standard: row.standard, from: hit === row.standard ? '标准词' : hit, category: row.category });
    }
  }
  return { standards, details };
}

/** 把一个标准词展开为等价词族 */
export function symptomWordFamily(standard: string): string[] {
  const row = db.prepare('SELECT standard, aliases FROM symptom_dict WHERE standard = ?').get(standard) as
    | { standard: string; aliases: string }
    | undefined;
  if (!row) return [standard];
  return [row.standard, ...splitAliases(row.aliases)];
}

/** 把用户写的机型别名换成规范型号：整句匹配 → 拆词匹配（支持“650”命中“联想650”） */
export function canonicalizeModel(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  const aliases = loadModelAliases();
  for (const row of aliases) {
    if (low.includes(row.alias.toLowerCase())) return row.canonical;
  }
  const pieces = raw.split(/[\s，,。；;、/（）()]+/).filter((p) => p.length >= 2);
  for (const piece of pieces) {
    const pl = piece.toLowerCase();
    for (const row of aliases) {
      if (pl === row.alias.toLowerCase() || row.alias.toLowerCase().includes(pl) || pl.includes(row.alias.toLowerCase())) {
        return row.canonical;
      }
    }
  }
  return '';
}

export interface BuildTokensInput {
  model: string;
  customer: string;
  symptoms: string[];
  aiExpanded?: string[];
  /** 按现象词分组的 AI 扩展：{ "主板有糊味": ["焦糊味","异味"] } */
  aiExpandedByTerm?: Record<string, string[]>;
}

/**
 * 构造检索词元：词典扩展优先，模型扩展仅在词典未覆盖时补充。
 * 每个词族合并为一个词元（variants 为等价形式），避免分母膨胀。
 */
export function buildTokens(input: BuildTokensInput): {
  tokens: MatchToken[];
  canonicalModel: string;
  normSymptoms: NormalizeResult;
} {
  const tokens: MatchToken[] = [];

  const canonicalModel = canonicalizeModel(input.model) || input.model;
  if (canonicalModel) {
    const variants = [canonicalModel, input.model];
    // 加入规范型号的全部别名，兼容库里以简称存储的案例（如 SR650）
    for (const row of loadModelAliases()) {
      if (row.canonical === canonicalModel) variants.push(row.alias);
    }
    tokens.push({
      field: 'model',
      text: canonicalModel,
      variants: Array.from(new Set(variants.filter(Boolean))),
      source: 'raw',
    });
  }

  if (input.customer) {
    tokens.push({ field: 'customer', text: input.customer, variants: [input.customer], source: 'raw' });
  }

  const symptomText = input.symptoms.join(' ');
  const norm = normalizeSymptoms(symptomText);
  for (const d of norm.details) {
    tokens.push({
      field: 'symptom',
      text: d.standard,
      variants: symptomWordFamily(d.standard),
      source: 'dict',
      from: d.from === '标准词' ? undefined : d.from,
    });
  }

  // 原始现象中未被词典覆盖的片段：先用原词做字面词元，再用 AI 针对“该词”给出的扩展候选补充
  const uncovered = input.symptoms
    .map((s) => s.trim())
    .filter((s) => s && !norm.standards.some((std) => symptomWordFamily(std).some((w) => s.toLowerCase().includes(w.toLowerCase()) || w.toLowerCase().includes(s.toLowerCase()))));
  for (const word of uncovered) {
    tokens.push({ field: 'extra', text: word, variants: [word], source: 'raw' });
    // 词元级 AI 扩展：只取模型针对这个未覆盖词给出的候选，不牵连已被词典覆盖的词
    const grouped = input.aiExpandedByTerm?.[word];
    const candidates = grouped && grouped.length ? grouped : input.aiExpanded || [];
    for (const exp of candidates.slice(0, 6)) {
      tokens.push({ field: 'extra', text: exp, variants: [exp], source: 'ai', from: word });
    }
  }

  return { tokens, canonicalModel, normSymptoms: norm };
}
