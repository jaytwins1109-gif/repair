import type {
  AppSettings,
  Attachment,
  AuthUser,
  Case,
  CaseFacets,
  CaseInput,
  ChatAskResult,
  ChatResult,
  ChatSession,
  Customer,
  StoredChatMessage,
  DictionaryData,
  ImportBatch,
  ImportExecuteResult,
  ImportParseResult,
  LlmCall,
  LlmConfig,
  LlmConfigInput,
  LlmRuntime,
  LoginResult,
  Model,
  ModelAsset,
  PageResult,
  RecurrenceInfo,
  SimilarCase,
} from './types';

const TOKEN_KEY = 'repair-agent-token';
export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(!(options?.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.headers || {}),
      },
    });
  } catch {
    throw new Error('无法连接后端服务，请确认 npm run dev 已启动');
  }

  let json: { code: number; data: T; message: string };
  try {
    json = await response.json();
  } catch {
    throw new Error('服务响应格式异常');
  }

  if (json.code === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (json.code !== 0) {
    const error = new Error(json.message || '请求失败');
    (error as any).code = json.code;
    throw error;
  }
  return json.data;
}

export interface CaseQuery {
  model?: string;
  customer?: string;
  category?: string;
  status?: string;
  source?: 'sample' | 'manual' | 'import';
  q?: string;
  scope?: 'review' | 'mine';
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

function toQuery(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      sp.set(key, String(value));
    }
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (percent: number) => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let json: any;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error('服务响应格式异常'));
      }
      if (json.code === 401) {
        clearToken();
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
      if (json.code !== 0) return reject(new Error(json.message || '上传失败'));
      resolve(json.data as T);
    };
    xhr.onerror = () => reject(new Error('网络连接失败，请重试'));
    xhr.send(form);
  });
}

async function download(path: string, fileName: string) {
  const response = await fetch(`/api${path}`, {
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
  });
  if (!response.ok) throw new Error('下载失败');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchAttachmentBlob(id: number): Promise<Blob> {
  const token = getToken();
  const response = await fetch(`/api/attachments/${id}/raw`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new Error('登录已失效，请重新登录');
  }
  if (!response.ok) throw new Error('图片加载失败');
  return response.blob();
}

export async function fetchModelAssetBlob(id: number): Promise<Blob> {
  const token = getToken();
  const response = await fetch(`/api/model-assets/${id}/raw`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new Error('登录已失效，请重新登录');
  }
  if (!response.ok) throw new Error('图纸资料加载失败');
  return response.blob();
}

export const api = {
  login(emp_no: string, password: string) {
    return request<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ emp_no, password }),
    });
  },
  logout() {
    return request<null>('/auth/logout', { method: 'POST' });
  },
  me() {
    return request<AuthUser>('/auth/me');
  },
  changeInitialPassword(newPassword: string) {
    return request<{ updated: number; empNos: string[] }>('/auth/change-initial-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  },

  listModels(q = '') {
    return request<Model[]>(`/models${toQuery({ q })}`);
  },
  createModel(data: Omit<Model, 'id' | 'created_at'>) {
    return request<Model>('/models', { method: 'POST', body: JSON.stringify(data) });
  },
  updateModel(id: number, data: Omit<Model, 'id' | 'created_at'>) {
    return request<Model>(`/models/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteModel(id: number) {
    return request<{ id: number }>(`/models/${id}`, { method: 'DELETE' });
  },

  listModelAssets(model: string) {
    return request<ModelAsset[]>(`/model-assets${toQuery({ model })}`);
  },
  uploadModelAsset(modelName: string, file: File, onProgress?: (percent: number) => void) {
    const form = new FormData();
    form.append('model_name', modelName);
    form.append('file', file);
    return uploadWithProgress<ModelAsset>('/model-assets', form, onProgress);
  },
  deleteModelAsset(id: number) {
    return request<{ id: number }>(`/model-assets/${id}`, { method: 'DELETE' });
  },

  listCustomers(q = '') {
    return request<Customer[]>(`/customers${toQuery({ q })}`);
  },
  createCustomer(data: Omit<Customer, 'id' | 'created_at'>) {
    return request<Customer>('/customers', { method: 'POST', body: JSON.stringify(data) });
  },
  updateCustomer(id: number, data: Omit<Customer, 'id' | 'created_at'>) {
    return request<Customer>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteCustomer(id: number) {
    return request<{ id: number }>(`/customers/${id}`, { method: 'DELETE' });
  },

  listCases(params: CaseQuery = {}) {
    return request<PageResult<Case>>(`/cases${toQuery({ ...params })}`);
  },
  /** 分面统计：传当前四个已选条件，后端算每个下拉时自排除该下拉自身 */
  getCaseFacets(params: CaseQuery = {}) {
    return request<CaseFacets>(
      `/cases/facets${toQuery({
        customer: params.customer,
        model: params.model,
        category: params.category,
        status: params.status,
        source: params.source,
        scope: params.scope,
      })}`
    );
  },
  getCase(id: number) {
    return request<Case>(`/cases/${id}`);
  },
  getSimilarCases(id: number) {
    return request<SimilarCase[]>(`/cases/${id}/similar`);
  },
  getRecurrences(id: number) {
    return request<RecurrenceInfo>(`/cases/${id}/recurrences`);
  },
  purgeSamples() {
    return request<{ deleted: number; backup: string | null }>('/cases/purge-samples', { method: 'POST' });
  },
  clearCache() {
    return request<{ cleared: number }>('/settings/cache', { method: 'DELETE' });
  },
  createCase(data: CaseInput) {
    return request<Case>('/cases', { method: 'POST', body: JSON.stringify(data) });
  },
  updateCase(id: number, data: CaseInput) {
    return request<Case>(`/cases/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteCase(id: number) {
    return request<{ id: number }>(`/cases/${id}`, { method: 'DELETE' });
  },
  approveCase(id: number) {
    return request<Case>(`/cases/${id}/approve`, { method: 'POST' });
  },
  rejectCase(id: number, reason: string) {
    return request<Case>(`/cases/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  uploadCase(form: FormData, onProgress?: (percent: number) => void) {
    return uploadWithProgress<Case>('/cases/upload', form, onProgress);
  },
  listAttachments(caseId: number) {
    return request<Attachment[]>(`/cases/${caseId}/attachments`);
  },
  addAttachments(caseId: number, form: FormData, onProgress?: (percent: number) => void) {
    return uploadWithProgress<Attachment[]>(`/cases/${caseId}/attachments`, form, onProgress);
  },
  deleteAttachment(id: number) {
    return request<{ id: number }>(`/attachments/${id}`, { method: 'DELETE' });
  },

  getSettings() {
    return request<AppSettings>('/settings');
  },
  setAutoApprove(enabled: boolean) {
    return request<{ engineer_auto_approve: boolean }>('/settings/engineer-auto-approve', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },
  setMatchThreshold(value: number) {
    return request<{ match_threshold: number }>('/settings/match-threshold', {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },
  exportJson() {
    return download('/export/json', `repair-data-${new Date().toISOString().slice(0, 10)}.json`);
  },

  downloadImportTemplate() {
    return download('/imports/template', 'repair-case-template.xlsx');
  },
  parseImport(form: FormData) {
    return uploadWithProgress<ImportParseResult>('/imports/parse', form);
  },
  executeImport(data: {
    token: string;
    mapping: Record<string, number>;
    decisions: Record<string, { missing?: 'auto' | 'skip'; duplicate?: 'skip' | 'import' }>;
    directApprove: boolean;
    batchNo?: string;
    offset: number;
    limit: number;
  }) {
    return request<ImportExecuteResult>('/imports/execute', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  listImportBatches() {
    return request<ImportBatch[]>('/imports/batches');
  },
  rollbackImportBatch(batchNo: string) {
    return request<{ deletedCases: number; batchNo: string }>(`/imports/${batchNo}/rollback`, {
      method: 'POST',
    });
  },

  chat(message: string) {
    return request<ChatResult>('/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  listSessions() {
    return request<ChatSession[]>('/chat/sessions');
  },
  createSession() {
    return request<ChatSession>('/chat/sessions', { method: 'POST' });
  },
  renameSession(id: number, title: string) {
    return request<{ id: number; title: string }>(`/chat/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },
  deleteSession(id: number) {
    return request<{ id: number }>(`/chat/sessions/${id}`, { method: 'DELETE' });
  },
  getSessionMessages(id: number) {
    return request<StoredChatMessage[]>(`/chat/sessions/${id}/messages`);
  },
  ask(sessionId: number, message: string) {
    return request<ChatAskResult>(`/chat/sessions/${sessionId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  listLlmConfigs() {
    return request<LlmConfig[]>('/llm/configs');
  },
  createLlmConfig(data: LlmConfigInput) {
    return request<LlmConfig>('/llm/configs', { method: 'POST', body: JSON.stringify(data) });
  },
  updateLlmConfig(id: number, data: LlmConfigInput) {
    return request<LlmConfig>(`/llm/configs/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteLlmConfig(id: number) {
    return request<{ id: number }>(`/llm/configs/${id}`, { method: 'DELETE' });
  },
  activateLlmConfig(id: number) {
    return request<LlmConfig>(`/llm/configs/${id}/activate`, { method: 'POST' });
  },
  testLlmConfig(id: number) {
    return request<{ ok: boolean; message: string }>(`/llm/configs/${id}/test`, { method: 'POST' });
  },
  getLlmRuntime() {
    return request<LlmRuntime>('/llm/runtime');
  },
  setLlmEnabled(enabled: boolean) {
    return request<{ llm_enabled: boolean }>('/llm/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },
  setLlmDailyLimit(limit: number) {
    return request<{ daily_limit: number }>('/llm/daily-limit', {
      method: 'PUT',
      body: JSON.stringify({ limit }),
    });
  },
  listLlmCalls(limit = 50) {
    return request<LlmCall[]>(`/llm/calls?limit=${limit}`);
  },

  getDictionary() {
    return request<DictionaryData>('/dictionary');
  },
  addSymptom(data: { standard: string; aliases: string; category?: string }) {
    return request<DictionaryData>('/dictionary/symptoms', { method: 'POST', body: JSON.stringify(data) });
  },
  updateSymptom(id: number, data: { standard: string; aliases: string; category?: string }) {
    return request<DictionaryData>(`/dictionary/symptoms/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteSymptom(id: number) {
    return request<{ id: number }>(`/dictionary/symptoms/${id}`, { method: 'DELETE' });
  },
  addModelAlias(data: { canonical: string; alias: string }) {
    return request<DictionaryData>('/dictionary/model-aliases', { method: 'POST', body: JSON.stringify(data) });
  },
  deleteModelAlias(id: number) {
    return request<{ id: number }>(`/dictionary/model-aliases/${id}`, { method: 'DELETE' });
  },
};
