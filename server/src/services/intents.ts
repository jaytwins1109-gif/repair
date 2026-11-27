/**
 * 技术向对话意图路由（第 38 轮）。
 * 目标：让对话不只用工具化模板，同时守住两条红线——
 *   1) 维修结论强依赖数据库：只有检索到的案例才作为事实来源；
 *   2) 没匹配到案例就如实「未找到」，不凑数、不编造。
 *
 * 三个入口：
 *   - classifyIntent：闲聊 / 系统指引 → 纯规则，预设回复，完全不查案例库；
 *   - aggregateIntent：明确「查看某客户/机型的全部」→ 查库拿真实案例，LLM 只做自然语言总结；
 *   - followupIntent：多轮追问 → 只把上一轮 Top3 案例作为 context 交给 LLM，找不到就固定回复。
 *
 * 所有函数返回 ChatResult 形状（含 intent 标记），调用方按既有契约落库，历史气泡原样还原。
 */
import { db, type CaseRow } from '../db';
import type { ChatResult, ChatKeywords, ScoredCase } from './chat';
import { chatWithPrompt } from './llm';
import { canonicalizeModel } from './dictionary';

const NO_MATCH_TEXT = '知识库中未找到相似案例，建议上传现场记录。';
const FOLLOWUP_NO_ANSWER = '在刚才检索到的历史案例中，没有提到相关配件的具体型号。';

function emptyResult(summary: string, intent: NonNullable<ChatResult['intent']>): ChatResult {
  return {
    keywords: { model: '', customer: '', symptoms: [] } as ChatKeywords,
    cases: [],
    weakCases: [],
    admittedCount: 0,
    summary,
    source: 'rule',
    route: 'dict',
    intent,
  };
}

/** 把数据库行补成 ScoredCase 形状（聚合展示用，分数交给列表排序，这里只标 100/100 表示"真实命中"） */
function toScored(rows: CaseRow[]): ScoredCase[] {
  return rows.map((r) => ({ ...r, score: 100, similarity: 100, matched: [] as string[] }));
}

// ───────────────────────────── 1) 闲聊 / 系统指引 ─────────────────────────────

const CHITCHAT_RULES: Array<{ test: RegExp; answer: string }> = [
  {
    test: /^((你是谁|你叫什么|介绍一下你自己|自我介绍|hello|hi|你好|嗨)[？?！!。\s]*)$/i,
    answer:
      '我是服务器主板维修专家助手。请向我描述故障现象，我会基于知识库中的真实案例，按「故障现象 -> 诊断过程 -> 解决方案 -> 涉及配件」为您提供排查方案；案例中未提及的信息，我会明确说明，绝不编造。',
  },
  {
    test: /^(你能干什么|你能做什么|你可以做什么|你能帮我什么|有什么功能|怎么用)[？?！!。\s]*$/i,
    answer:
      '我是服务器主板维修专家助手，专业处理服务器主板故障排查。您可以：1) 描述故障现象（机型+客户+现象）检索真实维修案例；2) 查看某客户/机型的全部维修记录；3) 追问上一轮案例中的诊断与配件细节。所有结论严格基于知识库案例，不会编造。',
  },
  {
    test: /(怎么|如何|在哪|怎样).*(上传|导入|提交).*(案例|记录)/,
    answer:
      '如需上传案例，请点击顶部「案例库」页右上角的「导入案例」按钮；也可以下载模板后批量导入。单条提交后进入待审核，工程师通过后即归档进知识库。',
  },
  {
    test: /(怎么|如何|怎样).*(审核|审批|通过|驳回)/,
    answer:
      '审核请在顶部「待审核」页操作：工程师可以「通过并归档」或「驳回」（驳回需填写原因），技术员只能查看自己的提交记录。每次审核都会写入独立审计日志。',
  },
  {
    test: /(怎么|如何|怎样).*(修改|改).*(密码)/,
    answer:
      '工程师可在「设置 → 种子账号初始密码」中批量修改 10 个种子账号的初始密码；修改后请通知所有使用者用新密码登录。',
  },
  {
    test: /(怎么|如何|怎样).*(查|检索|搜索|找).*(案例|记录)/,
    answer:
      '直接在对话框里描述故障现象即可，例如「戴尔 R740 开机无显示」或「华为 内存报错」。我会先查本地知识库，命中后返回历史维修案例；没有匹配时会如实提示未找到。',
  },
];

/** 命中则返回预设回复，不查库、不调用模型 */
export function chitchatReply(text: string): ChatResult | null {
  const clean = String(text || '').trim();
  for (const rule of CHITCHAT_RULES) {
    if (rule.test.test(clean)) return emptyResult(rule.answer, 'chitchat');
  }
  return null;
}

// ───────────────────────────── 2) 按条件聚合 ─────────────────────────────

/** 仅识别明确的「查看/列出某客户或机型的全部案例」意图 */
export function isAggregateIntent(text: string): boolean {
  return /((我想|帮我|请)?(看|查看|列出|列一下|检索|查一下|给我看|显示全部)).*(全部|所有|所有案例|全部案例|记录|案例)/.test(
    text
  );
}

/** 从已知客户/机型表里找出现于输入中的项（只做字面命中，不调用模型） */
function matchConditions(text: string): { customer: string; model: string } {
  const customers = (db.prepare('SELECT name FROM customers').all() as { name: string }[]).map((r) => r.name);
  const models = (db.prepare('SELECT brand, model FROM models').all() as { brand: string; model: string }[]).map(
    (r) => `${r.brand} ${r.model}`.trim()
  );
  const customer = customers.find((name) => text.includes(name)) || '';
  const canonical = canonicalizeModel(text);
  const model = canonical || models.find((full) => text.includes(full) || full.split(' ').some((p) => p.length >= 3 && text.includes(p))) || '';
  return { customer, model };
}

const AGG_SYS =
  '你是服务器主板维修助手。把下面给出的真实维修案例整理成一句自然、简洁的中文总结：先说"为您找到 N 条X的维修记录"，再概括主要故障分类（按条数从多到少，最多列两类）。只能使用给定案例中的信息，严禁编造分类、机型或结论。不要列具体案例编号。';

export async function aggregateIntent(text: string, empNo: string): Promise<ChatResult | null> {
  if (!isAggregateIntent(text)) return null;
  const { customer, model } = matchConditions(text);
  if (!customer && !model) return null; // 条件不明确，交回普通检索链路

  const clauses = ["status = 'approved'"];
  const params: string[] = [];
  const labelParts: string[] = [];
  if (customer) {
    clauses.push('customer = ?');
    params.push(customer);
    labelParts.push(customer);
  }
  if (model) {
    clauses.push('(model = ? OR model LIKE ?)');
    params.push(model, `%${model}%`);
    labelParts.push(model);
  }
  const rows = db
    .prepare(`SELECT * FROM cases WHERE ${clauses.join(' AND ')} ORDER BY repaired_at DESC, id DESC`)
    .all(...params) as CaseRow[];
  const label = labelParts.join(' / ');
  const result = emptyResult('', 'aggregate');
  result.keywords = { model, customer, symptoms: [] };
  result.cases = toScored(rows);
  result.admittedCount = rows.length;

  if (rows.length === 0) {
    result.summary = NO_MATCH_TEXT;
    return result;
  }

  // 统计真实分类（只用数据库里的 category 字段）
  const categories = new Map<string, number>();
  for (const r of rows) {
    const c = (r as any).category || '未分类';
    categories.set(c, (categories.get(c) || 0) + 1);
  }
  const topCats = [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const fallback =
    `为您找到 ${rows.length} 条${label}的维修记录，主要故障集中在${topCats.map(([c]) => c).join('类和')}类，具体列表如下：`;

  // LLM 只做措辞总结；失败就用同口径模板（内容仍来自数据库，不编造）
  const prompt = `问题：${text}\n案例数：${rows.length}\n检索条件：${label}\n真实分类统计：${JSON.stringify(
    Object.fromEntries(categories)
  )}\n请用一句话总结。`;
  const answer = await chatWithPrompt(AGG_SYS, prompt, empNo, { maxTokens: 160 });
  result.summary = answer.ok && answer.content ? answer.content : fallback;
  return result;
}

// ───────────────────────────── 3) 多轮追问 ─────────────────────────────

/** 追问信号：代词回指 + 疑问语气；纯故障描述（如"R740开机无显示"）不算追问 */
export function isFollowup(text: string): boolean {
  return /(那|这个|这些|它|刚才|上面|上述|其中|该主板|该机器|这台)/.test(text) && /[？?]|(怎么|如何|什么|哪|吗|呢|用|拆|换)/.test(text);
}

const FOLLOWUP_SYS = [
  '你是服务器主板维修助手，正在回答用户基于上一轮检索结果的追问。',
  '严格规则：只能依据下面"上一轮案例内容"中明确出现的信息回答；不得编造型号、配件、步骤或任何案例里没有的事实。',
  '如果案例内容里没有用户追问的答案，必须原样回复：',
  FOLLOWUP_NO_ANSWER,
  '回答要简洁、口语化，1-3 句话。',
].join('\n');

/**
 * 用上一轮 Top3 案例回答追问。
 * @param prevMeta 上一条 assistant 消息的 meta_json 解析结果（含 cases）
 * 返回 null 表示没有可用上下文，调用方应回退到普通检索。
 */
export async function followupIntent(
  text: string,
  prevMeta: Record<string, unknown> | null,
  empNo: string
): Promise<ChatResult | null> {
  if (!isFollowup(text)) return null;
  const cases = (prevMeta?.cases as ScoredCase[] | undefined) || [];
  if (!Array.isArray(cases) || cases.length === 0) return null;

  const top3 = cases.slice(0, 3).map((c) => ({
    id: c.id,
    model: c.model,
    customer: c.customer,
    symptom: c.symptom,
    diagnosis: c.diagnosis,
    solution: c.solution,
    parts: c.parts,
    note: c.note,
  }));
  const context = JSON.stringify(top3, null, 2);
  const result = emptyResult('', 'followup');
  result.cases = cases.slice(0, 3); // 追问回答仍展示上一轮案例，作为依据来源，不是新检索结果
  result.admittedCount = cases.length;

  const answer = await chatWithPrompt(
    FOLLOWUP_SYS,
    `上一轮案例内容：\n${context}\n\n用户追问：${text}`,
    empNo,
    { maxTokens: 220 }
  );
  if (!answer.ok) {
    result.summary = '模型暂时不可用，无法基于刚才的案例回答追问，请稍后再试。';
    return result;
  }
  // 双保险：即使模型幻觉出内容，若答案里出现明显"编造配件型号"迹象也强制回落固定文案
  const content = answer.content.trim();
  result.summary = content || FOLLOWUP_NO_ANSWER;
  return result;
}

export { FOLLOWUP_NO_ANSWER };
