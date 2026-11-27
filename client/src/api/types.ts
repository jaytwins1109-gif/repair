export type Role = 'engineer' | 'technician';

export interface AuthUser {
  id: number;
  emp_no: string;
  name: string;
  role: Role;
  position: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export type CaseStatus = 'approved' | 'pending' | 'rejected';

export const CASE_CATEGORIES = [
  '供电类',
  '内存类',
  'CPU 供电类',
  '固件类',
  '散热类',
  '接口类',
  '其他',
] as const;

export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export interface Attachment {
  id: number;
  case_id: number;
  original_name: string;
  stored_name: string;
  relative_path: string;
  mime_type: string;
  size: number;
  uploader: string;
  created_at: string;
}

export interface ModelAsset {
  id: number;
  model_name: string;
  file_type: 'image' | 'pdf';
  original_name: string;
  relative_path: string;
  size: number;
  uploader: string;
  created_at: string;
}

/** 第 45 轮：技术知识库五个固定分类，顺序与服务端 KNOWLEDGE_CATEGORIES 一致 */
export const KNOWLEDGE_CATEGORIES = [
  'BMC原理',
  '上电时序',
  'CPU架构',
  '机种架构',
  '其他',
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeDoc {
  id: number;
  category: string;
  title: string;
  file_name: string;
  relative_path: string;
  file_type: string;
  size: number;
  uploader: string;
  created_at: string;
}

export interface Case {
  id: number;
  model: string;
  customer: string;
  symptom: string;
  diagnosis: string;
  solution: string;
  parts: string;
  note: string;
  repaired_at: string | null;
  source: 'sample' | 'manual' | 'import';
  recurrence_count?: number;
  status: CaseStatus;
  author: string;
  model_id: number | null;
  customer_id: number | null;
  category: string;
  reviewer: string;
  reviewed_at: string | null;
  reject_reason: string;
  import_batch_no: string;
  created_at: string;
  updated_at: string;
  attachments?: Attachment[];
}

export interface Model {
  id: number;
  brand: string;
  model: string;
  platform: string;
  note: string;
  created_at: string;
}

export interface Customer {
  id: number;
  name: string;
  contact: string;
  note: string;
  created_at: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 级联分面的一个选项：值 / 展示名 / 当前登录人可见范围内的条数 */
export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface CaseFacets {
  customer: FacetOption[];
  model: FacetOption[];
  category: FacetOption[];
  status: FacetOption[];
  /** 当前所有条件下（不排除任何维度）的可见总数，用于条数对账 */
  total: number;
}

export const UNCATEGORIZED = '__uncategorized__';

export interface CaseInput {
  model: string;
  model_id?: number;
  customer?: string;
  customer_id?: number;
  symptom: string;
  diagnosis?: string;
  solution: string;
  parts?: string;
  note?: string;
  repaired_at?: string | null;
  author?: string;
  category?: string;
  import_batch_no?: string;
}

export interface ChatKeywords {
  model: string;
  customer: string;
  symptoms: string[];
}

export interface TokenScoreTrace {
  field: 'model' | 'customer' | 'symptom' | 'extra';
  text: string;
  label: string;
  weight: number;
  hit: boolean;
  hitVariant?: string;
}

export interface ScoreTrace {
  tokens: TokenScoreTrace[];
  totalWeight: number;
  hitWeight: number;
  formula: string;
  caseId: number;
}

export interface AdmissionBasis {
  /** 命中机型或客户之一所靠的词元 */
  anchor?: string;
  /** 命中现象词族所靠的词元（标注 dict / raw，AI 扩展词不参与准入） */
  semantic?: string;
}

export interface ScoredCase extends Case {
  score: number;
  similarity: number;
  matched: string[];
  admissionBasis?: AdmissionBasis;
}

export interface ChatResult {
  keywords: ChatKeywords;
  cases: ScoredCase[];
  /** 低于阈值、单独折叠展示的弱相关组，最多 3 条，不混入主列表 */
  weakCases?: ScoredCase[];
  /** 通过硬性准入的案例总数，用于区分「库里确实少」与「被阈值截断」 */
  admittedCount?: number;
  summary: string;
  source: 'ai' | 'rule' | 'cache';
  fallbackReason?: string;
  matchDetail?: string[];
  normalizedSymptoms?: string[];
  cacheHits?: number;
  route?: 'dict' | 'llm' | 'cache';
  scoreTrace?: ScoreTrace;
  /** 意图路由：chitchat=闲聊/指引、aggregate=条件聚合、followup=多轮追问 */
  intent?: 'chitchat' | 'aggregate' | 'followup';
}

/** 会话表：所属用户、标题、创建时间、最后更新时间 */
export interface ChatSession {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

/** 消息表：所属会话、角色、内容、JSON 元数据 */
export interface StoredChatMessage {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  meta: Partial<ChatResult>;
  created_at: string;
}

export interface ChatAskResult extends ChatResult {
  session_id: number;
  session_title: string;
  user_message_id: number;
  assistant_message_id: number;
}

export interface RecurrenceInfo {
  total: number;
  list: Array<{
    id: number;
    model: string;
    customer: string;
    symptom: string;
    repaired_at: string | null;
    created_at: string;
    source: string;
  }>;
  last_repaired: string | null;
}

export interface SymptomDict {
  id: number;
  standard: string;
  aliases: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface ModelAlias {
  id: number;
  canonical: string;
  alias: string;
  created_at: string;
}

export interface DictionaryData {
  symptoms: SymptomDict[];
  modelAliases: ModelAlias[];
}

export interface SimilarCase {
  id: number;
  model: string;
  symptom: string;
  category: string;
  repaired_at: string | null;
  created_at: string;
}

export type LlmPlatform = 'deepseek' | 'openai' | 'custom';

export interface LlmConfig {
  id: number;
  name: string;
  platform: LlmPlatform;
  base_url: string;
  api_key_masked: string;
  has_api_key: boolean;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  thinking_enabled: boolean;
  /** 自定义系统提示词；空字符串表示使用内置默认值 */
  system_prompt: string;
  /** 后端内置默认 Prompt，供「恢复默认值」使用 */
  system_prompt_default: string;
  enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LlmConfigInput {
  name: string;
  platform: LlmPlatform;
  base_url: string;
  api_key?: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  thinking_enabled: boolean;
  system_prompt?: string;
  enabled: boolean;
}

export interface LlmRuntime {
  llm_enabled: boolean;
  daily_limit: number;
  today_calls: number;
  active_config: LlmConfig | null;
  cache_stats: {
    prompt_cache_hit_tokens: number;
    prompt_cache_miss_tokens: number;
    collected: number;
    hit_rate: number | null;
  };
}

export interface LlmCall {
  id: number;
  config_id: number | null;
  platform: string;
  model: string;
  kind: string;
  success: number;
  error: string;
  latency_ms: number;
  prompt_chars: number;
  completion_chars: number;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
  user_emp_no: string;
  created_at: string;
}

export interface ImportField {
  key: string;
  label: string;
}

export interface ImportRowPreview {
  index: number;
  values: Record<string, string>;
  issues: string[];
  duplicate: boolean;
  recurrence: boolean;
  modelMissing: boolean;
  customerMissing: boolean;
  qualified: boolean;
}

export interface ImportParseResult {
  token: string;
  headers: string[];
  suggestions: Record<string, number>;
  rows: number;
  preview: ImportRowPreview[];
  duplicateFlags?: boolean[];
  recurrenceFlags?: boolean[];
  fields: ImportField[];
}

export interface ImportBatch {
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
}

export interface ImportExecuteResult {
  batchNo: string;
  processed: number;
  success: number;
  skipped: number;
  failed: number;
  total: number;
  done: boolean;
  failures: { index: number; reason: string }[];
}

export interface AppSettings {
  engineer_auto_approve: boolean;
  match_threshold: number;
  cache: { entries: number; hits: number };
  routes: { total: number; skip: number; cache: number; llm: number; saved: number; savedRate: number };
  backups: { name: string; size: number }[];
}
