import { db, type CaseRow } from '../db';
import { extractKeywordsWithLlm } from './llm';
import { buildTokens, canonicalizeModel, normalizeSymptoms, type MatchToken } from './dictionary';
import { getCached, setCached, normalizeQuery, recordRoute } from './cache';

export interface ChatKeywords {
  model: string;
  customer: string;
  symptoms: string[];
}

/** 单个词元的打分明细，用于人工复算 */
export interface TokenScoreTrace {
  field: MatchToken['field'];
  text: string;
  label: string;
  weight: number;
  hit: boolean;
  hitVariant?: string;
}

/** 分数可核对：分母、分子、每个词元是否命中，都能看到 */
export interface ScoreTrace {
  tokens: TokenScoreTrace[];
  totalWeight: number;
  hitWeight: number;
  formula: string;
  caseId: number;
}

/** 硬性准入依据：靠哪个词元进的候选池 */
export interface AdmissionBasis {
  /** 命中的机型/客户词元 */
  anchor?: string;
  /** 命中的词典标准词族或用户原话词元（AI 扩展词不会出现在这一项） */
  semantic?: string;
}

export interface ScoredCase extends CaseRow {
  score: number;
  similarity: number;
  matched: string[];
  admissionBasis?: AdmissionBasis;
}

export interface ChatResult {
  keywords: ChatKeywords;
  cases: ScoredCase[];
  /** 低于阈值的弱相关单独成组，最多 3 条，绝不混入主列表凑数 */
  weakCases: ScoredCase[];
  /** 通过硬性准入的案例总数（含被阈值截断的），用于区分「库里确实少」和「被闸门刷掉」 */
  admittedCount: number;
  summary: string;
  source: 'ai' | 'rule' | 'cache';
  fallbackReason?: string;
  matchDetail?: string[];
  normalizedSymptoms?: string[];
  /** 缓存复用次数（命中缓存时 >0） */
  cacheHits?: number;
  /** 路由标记：dict=前置拦截走规则，llm=实际调用模型，cache=命中本地缓存 */
  route?: 'dict' | 'llm' | 'cache';
  /** 打分过程（取首条案例），让分数可手动复算 */
  scoreTrace?: ScoreTrace;
  /** 意图路由标记：chitchat=闲聊/指引、search=故障检索、aggregate=条件聚合、followup=多轮追问 */
  intent?: 'chitchat' | 'search' | 'aggregate' | 'followup';
}

const NO_MATCH_TEXT = '知识库中未找到相似案例，建议上传现场记录。';
/** LLM 判定为 chitchat 时使用的统一预设文案：不查库、不编造，也不暴露模型内部 JSON */
const LLM_CHITCHAT_ANSWER =
  '我是服务器主板维修专家助手，专业处理服务器主板故障排查。您可以描述故障现象（机型+客户+现象）检索真实维修案例，也可以查看某客户/机型的全部维修记录或追问上一轮案例细节。与维修无关的问题我无法回答，案例中未提及的信息也绝不会编造。';

/**
 * 字段权重（命中一个词元即得该字段满权重，不做模糊比例加分）：
 * 机型 40 / 客户 30 / 现象 20 / 补充词 6。
 * 分母 = 本次查询实际生成的全部词元权重之和（不是固定 96）；
 * 分数 = round(命中词元权重之和 / 分母 × 100)，即“词元覆盖率×100”。
 */
export const FIELD_WEIGHT: Record<MatchToken['field'], number> = {
  model: 40,
  customer: 30,
  symptom: 20,
  extra: 6,
};

function getMatchThreshold(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'match_threshold'").get() as
    | { value: string }
    | undefined;
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : 60;
}

const SYMPTOM_KEYWORDS = [
  '开机无显示', '风扇满转', '风扇全速', '风扇不转', '不通电', '无法开机', '开机无反应',
  '黑屏', '无图像', '蓝屏', '死机', '频繁重启', '自动重启', '无网络', '网口不通',
  '报警', '异响', '过热', '温度高', '识别不到硬盘', '掉盘', '内存报错', 'ECC',
  'BMC', 'POST', '指示灯', '电源', '12V',
];

/** 规则抽取：机型走别名表、现象走词典归一化 */
function extractKeywords(text: string): ChatKeywords {
  const low = text.toLowerCase();
  const models = db.prepare('SELECT brand, model FROM models').all() as { brand: string; model: string }[];
  const customers = db.prepare('SELECT name FROM customers').all() as { name: string }[];

  let model = canonicalizeModel(text);
  if (!model) {
    for (const m of models) {
      if (m.model && low.includes(m.model.toLowerCase())) { model = m.model; break; }
    }
  }
  if (!model) {
    for (const m of models) {
      if (m.brand && text.includes(m.brand)) { model = m.model; break; }
    }
  }

  let customer = '';
  for (const c of customers) {
    if (c.name && text.includes(c.name)) { customer = c.name; break; }
  }

  const norm = normalizeSymptoms(text);
  const standards = norm.standards.length ? norm.standards : SYMPTOM_KEYWORDS.filter((k) => low.includes(k.toLowerCase()));

  // 把原文拆成片段，找出「词典/关键词表都没覆盖」的现象说法，原样保留成词元（source=raw），不许消失。
  // 这样混合查询如「开机不显示 主板有糊味」里未覆盖的「主板有糊味」也能进 buildTokens，
  // 既参与匹配又让前置拦截在词元粒度判断出「有未覆盖词 → 需要调用模型」。
  let rest = text;
  if (model) rest = rest.split(model).join(' ');
  if (customer) rest = rest.split(customer).join(' ');
  const pieces = rest
    .split(/[\s，,。；;、/（）()]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !/^\d+$/.test(p))
    .filter(
      (p) =>
        !canonicalizeModel(p) &&
        !models.some((m) => p.toLowerCase().includes(m.model.toLowerCase()) || m.model.toLowerCase().includes(p.toLowerCase()))
    );

  const familyWords = standards.flatMap((std) => {
    const row = db.prepare('SELECT standard, aliases FROM symptom_dict WHERE standard = ?').get(std) as
      | { standard: string; aliases: string }
      | undefined;
    return row ? [row.standard, ...String(row.aliases || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean)] : [std];
  });
  const covered = (p: string) =>
    familyWords.some((w) => p.toLowerCase().includes(w.toLowerCase()) || w.toLowerCase().includes(p.toLowerCase())) ||
    standards.some((s) => p.includes(s) || s.includes(p)) ||
    normalizeSymptoms(p).standards.length > 0;

  const uncovered = pieces.filter((p) => !covered(p)).slice(0, 8);
  const symptoms = Array.from(new Set([...standards, ...uncovered]));
  return { model, customer, symptoms };
}

export interface ChatSearchOptions {
  keywords?: ChatKeywords;
  source?: 'ai' | 'rule' | 'cache';
  fallbackReason?: string;
  aiExpanded?: string[];
  aiExpandedByTerm?: Record<string, string[]>;
  route?: 'dict' | 'llm' | 'cache';
  cacheHits?: number;
}

/** 词元是否命中（等价形式任一出现在案例文本里即算命中，不做部分比例加分） */
function tokenHit(token: MatchToken, haystack: string): { hit: boolean; variant?: string } {
  for (const v of token.variants) {
    if (v && haystack.includes(v.toLowerCase())) return { hit: true, variant: v };
  }
  return { hit: false };
}

function matchLabel(token: MatchToken): string {
  const base = token.text;
  if (token.source === 'dict' && token.from) return `${base}(来自${token.from})`;
  if (token.source === 'ai') return `${base}(AI扩展${token.from ? ':' + token.from : ''})`;
  return base;
}

/** 同分排序兜底：分数高的在前 → 维修日期新的在前（无日期排最后）→ id 大的在前 */
function compareCases(a: ScoredCase, b: ScoredCase): number {
  if (b.score !== a.score) return b.score - a.score;
  const ar = a.repaired_at || '';
  const br = b.repaired_at || '';
  if (ar !== br) {
    if (!ar) return 1;
    if (!br) return -1;
    return br.localeCompare(ar);
  }
  return b.id - a.id;
}

export function chatSearch(rawText: string, options: ChatSearchOptions = {}): ChatResult {
  const text = String(rawText || '').trim();
  const keywords = options.keywords || extractKeywords(text);
  const source = options.source || 'rule';
  const route = options.route || 'dict';

  const built = buildTokens({
    model: keywords.model,
    customer: keywords.customer,
    symptoms: keywords.symptoms,
    aiExpanded: options.aiExpanded,
    aiExpandedByTerm: options.aiExpandedByTerm,
  });
  const tokens = built.tokens;
  const totalWeight = tokens.reduce((sum, t) => sum + FIELD_WEIGHT[t.field], 0) || 1;
  const semanticTokens = tokens.filter((t) => t.field === 'symptom' || t.field === 'extra');

  const rows = db.prepare("SELECT * FROM cases WHERE status = 'approved'").all() as CaseRow[];
  const scored: ScoredCase[] = [];
  let scoreTrace: ScoreTrace | undefined;
  const hasAnchorTokens = tokens.some((t) => t.field === 'model' || t.field === 'customer');
  const hasSemanticTokens = semanticTokens.length > 0;

  for (const row of rows) {
    const haystack =
      `${row.model} ${row.customer} ${row.symptom} ${row.diagnosis} ${row.solution} ${row.parts} ${row.category}`.toLowerCase();

    let hitWeight = 0;
    let hitAnchor = false;
    let hitSemantic = false;
    let anchorLabel: string | undefined;
    let semanticLabel: string | undefined;
    const matched: string[] = [];
    const tokenTraces: TokenScoreTrace[] = [];
    for (const token of tokens) {
      const result = tokenHit(token, haystack);
      const label = matchLabel(token);
      tokenTraces.push({
        field: token.field,
        text: token.text,
        label,
        weight: FIELD_WEIGHT[token.field],
        hit: result.hit,
        hitVariant: result.variant,
      });
      if (result.hit) {
        // AI 扩展词仍参与打分排序，但绝不参与下面的准入判定
        hitWeight += FIELD_WEIGHT[token.field];
        if (token.field === 'model' || token.field === 'customer') {
          hitAnchor = true;
          if (!anchorLabel) anchorLabel = `${label}[${token.source}]`;
        }
        if ((token.field === 'symptom' || token.field === 'extra') && token.source !== 'ai') {
          hitSemantic = true;
          if (!semanticLabel) semanticLabel = `${label}[${token.source}]`;
        }
        if (!matched.includes(label)) matched.push(label);
      }
    }
    if (hitWeight <= 0) continue;

    // 硬性准入与绝对分数脱钩：有现象词元时必须命中词典标准词族或用户原话词元，
    // 且若本次生成了机型/客户词元，还须命中其中之一（防止只凭机型凑数）；
    // 没有现象词元时（纯机型/客户查询），命中锚点即准入，保留原有可检索行为。
    const anchored = !hasAnchorTokens || hitAnchor;
    const qualified = hasSemanticTokens ? hitSemantic && anchored : hitAnchor;
    if (!qualified) continue;

    const score = Math.round((hitWeight / totalWeight) * 100);
    scored.push({
      ...row,
      score,
      similarity: score,
      matched,
      admissionBasis: { anchor: anchorLabel, semantic: semanticLabel },
    });
    if (!scoreTrace) {
      scoreTrace = {
        caseId: row.id,
        tokens: tokenTraces,
        totalWeight,
        hitWeight,
        formula: `${hitWeight} ÷ ${totalWeight} × 100 = ${score}`,
      };
    }
  }

  scored.sort(compareCases);
  const threshold = getMatchThreshold();

  // 阈值只用于「排序截断」：达到阈值的进主列表；未达到的另起一组、最多 3 条、
  // 界面默认折叠，绝不用来补足主列表。没有任何案例通过硬性准入时，两个列表都为空，
  // 如实返回「未找到」，不为了避免空结果硬塞弱相关。
  const RESULT_LIMIT = 10;
  const WEAK_LIMIT = 3;
  const top = scored.filter((c) => c.score >= threshold).slice(0, RESULT_LIMIT);
  const weakCases = scored.filter((c) => c.score < threshold).slice(0, WEAK_LIMIT);
  const lowMatch = scored.length === 0;
  const matchDetail = top.length ? top[0].matched : [];
  if (scoreTrace && top.length && scoreTrace.caseId !== top[0].id) {
    // 让 trace 对应最终排第一的案例：重新为其生成一条
    const leader = top[0];
    const hay = `${leader.model} ${leader.customer} ${leader.symptom} ${leader.diagnosis} ${leader.solution} ${leader.parts} ${leader.category}`.toLowerCase();
    let hw = 0;
    const tt: TokenScoreTrace[] = tokens.map((token) => {
      const r = tokenHit(token, hay);
      if (r.hit) hw += FIELD_WEIGHT[token.field];
      return { field: token.field, text: token.text, label: matchLabel(token), weight: FIELD_WEIGHT[token.field], hit: r.hit, hitVariant: r.variant };
    });
    scoreTrace = { caseId: leader.id, tokens: tt, totalWeight, hitWeight: hw, formula: `${hw} ÷ ${totalWeight} × 100 = ${leader.score}` };
  }

  const categoryCounts = top.reduce<Record<string, number>>((acc, c) => {
    if (c.category) acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {});
  const parts = Array.from(new Set(top.map((c) => c.parts).filter(Boolean)));

  let summary = '';
  if (lowMatch) {
    summary = NO_MATCH_TEXT;
  } else if (top.length === 0) {
    summary = `共找到 0 条达到排序截断阈值的结果；另有 ${weakCases.length} 条弱相关（仅供参考，默认折叠），不作为推荐依据。`;
  } else {
    const kwDesc: string[] = [];
    if (keywords.model) kwDesc.push(`型号 ${keywords.model}`);
    if (keywords.customer) kwDesc.push(`客户 ${keywords.customer}`);
    if (built.normSymptoms.standards.length) kwDesc.push(`现象「${built.normSymptoms.standards.join('、')}」`);
    summary = `共找到 ${top.length} 条相似案例`;
    if (kwDesc.length) summary += `（识别到 ${kwDesc.join('，')}）`;
    summary += '。';
    const categoryDesc = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count} 条`)
      .join('、');
    if (categoryDesc) summary += `按故障分类统计：${categoryDesc}。`;
    if (parts.length) summary += `高频涉及配件：${parts.slice(0, 3).join('、')}。`;
    summary += `推荐优先参考 #${top[0].id}（${top[0].model}）的处理方案。`;
  }

  return {
    keywords,
    cases: top,
    weakCases,
    admittedCount: scored.length,
    summary,
    source,
    fallbackReason: options.fallbackReason,
    matchDetail,
    normalizedSymptoms: built.normSymptoms.standards,
    cacheHits: options.cacheHits,
    route,
    scoreTrace,
  };
}

/** 从缓存结果重建 ChatResult（命中缓存时不再查库、不调用模型） */
function resultFromCache(queryNorm: string, entry: NonNullable<ReturnType<typeof getCached>>): ChatResult {
  const rows = db.prepare("SELECT * FROM cases WHERE status = 'approved'").all() as CaseRow[];
  const cases = entry.case_ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is CaseRow => !!r)
    .map((r) => ({ ...r, score: 0, similarity: 0, matched: [] as string[] }));
  recordRoute('total');
  recordRoute('cache');
  return {
    keywords: { model: '', customer: '', symptoms: [] },
    cases,
    weakCases: [],
    admittedCount: cases.length,
    summary: `缓存命中：直接返回之前 ${entry.case_ids.length} 条结果，未调用大模型。`,
    source: 'cache',
    route: 'cache',
    cacheHits: entry.hit_count,
  };
}

export async function chatSearchSmart(rawText: string, userEmpNo: string): Promise<ChatResult> {
  const text = String(rawText || '').trim();
  recordRoute('total');
  const queryNorm = normalizeQuery(text);

  const dbEnabled =
    (db.prepare("SELECT value FROM settings WHERE key = 'llm_enabled'").get() as { value: string } | undefined)
      ?.value === '1';

  /** Level 3：LLM 不可用时的本地检索兜底，意图一律按 search 处理 */
  const localSearch = (reason: string, recordSkip = false): ChatResult => {
    if (recordSkip) recordRoute('skip');
    const cached = getCached(queryNorm);
    if (cached) return resultFromCache(queryNorm, cached);
    const result = chatSearch(text, { source: 'rule', route: 'dict', fallbackReason: reason });
    setCached(queryNorm, result.cases.map((c) => c.id), 'dict');
    return result;
  };

  if (!dbEnabled) return localSearch('对话检索大模型总开关已关闭', true);

  // Level 2：本地白名单未命中的输入，统一调用一次 LLM 做意图识别 + 条件抽取。
  // 断网/欠费/超限/解析失败/空条件一律落回 Level 3，默认 intent=search。
  recordRoute('llm');
  let outcome: Awaited<ReturnType<typeof extractKeywordsWithLlm>> | null = null;
  try {
    outcome = await extractKeywordsWithLlm(text, userEmpNo);
  } catch (e: any) {
    return localSearch(`模型调用异常，已回退规则匹配：${String(e?.message || e).slice(0, 120)}`);
  }

  if (outcome.ok && outcome.intent === 'chitchat') {
    // 不查案例库、不写 search_cache，直接返回统一预设文案
    return {
      keywords: { model: '', customer: '', symptoms: [] },
      cases: [],
      weakCases: [],
      admittedCount: 0,
      summary: LLM_CHITCHAT_ANSWER,
      source: 'ai',
      route: 'llm',
      intent: 'chitchat',
    };
  }

  const kw = outcome.keywords;
  const hasEffectiveKeywords =
    !!kw && (!!kw.model || !!kw.customer || (Array.isArray(kw.symptoms) && kw.symptoms.length > 0));
  if (outcome.ok && outcome.intent === 'search' && hasEffectiveKeywords && kw) {
    const cached = getCached(queryNorm);
    if (cached) return resultFromCache(queryNorm, cached);
    const result = chatSearch(text, {
      keywords: kw,
      source: 'ai',
      aiExpanded: kw.expanded,
      aiExpandedByTerm: kw.expandedByTerm,
      route: 'llm',
    });
    result.intent = 'search';
    setCached(queryNorm, result.cases.map((c) => c.id), 'ai');
    return result;
  }

  return localSearch(
    outcome.reason ||
      (outcome.ok ? '模型未抽取到有效检索条件，已回退规则匹配' : 'LLM 不可用，已回退规则匹配')
  );
}
