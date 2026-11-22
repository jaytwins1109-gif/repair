import { Router } from 'express';
import { db, type CaseRow, type ModelRow, type CustomerRow } from '../db';
import { requireAuth, requireRole, type AuthUser } from '../middleware/auth';
import { uploadErrorToMessage, uploadImages } from '../middleware/upload';
import { fail, ok } from '../response';
import { deleteAttachmentsOfCase, listAttachments, saveAttachments } from '../services/attachments';
import { clearCache } from '../services/cache';
import { backupDatabase } from '../services/backup';

const router = Router();

export const CASE_CATEGORIES = ['供电类', '内存类', 'CPU 供电类', '固件类', '散热类', '接口类', '其他'];

/** 故障分类为空的案例在分面里统一归到这个虚拟值，工程师可直接筛出来补填 */
export const UNCATEGORIZED = '__uncategorized__';
export const FACET_KEYS = ['customer', 'model', 'category', 'status'] as const;
type FacetKey = (typeof FACET_KEYS)[number];

interface CaseFilters {
  customer: string;
  model: string;
  category: string;
  status: string;
  source: string;
  q: string;
  scope: string;
}

function readCaseFilters(query: Record<string, unknown>): CaseFilters {
  const s = (k: string) => String(query[k] ?? '').trim();
  return {
    customer: s('customer'),
    model: s('model'),
    category: s('category'),
    status: s('status'),
    source: s('source'),
    q: s('q'),
    scope: s('scope'),
  };
}

/**
 * 条数统计必须落在当前登录人的可见范围内：
 * 技术员只能看已归档案例 + 自己提交的案例；工程师看全部。
 * 列表接口与分面接口共用此函数，避免两处口径漂移。
 */
function caseScope(user: AuthUser, scope: string): { sql: string; params: any[] } | { error: string } {
  if (scope === 'review' && user.role !== 'engineer') return { error: '仅工程师可查看审核队列' };
  if (scope === 'review') return { sql: "status IN ('pending','rejected')", params: [] };
  if (scope === 'mine') return { sql: 'author = ?', params: [user.name] };
  if (user.role === 'technician') {
    return { sql: '(status = ? OR author = ?)', params: ['approved', user.name] };
  }
  return { sql: '1 = 1', params: [] };
}

/**
 * 第 18 轮：cases.model 是自由文本，同一机型存在「SR650」和「联想 SR650」等写法。
 * 这里用 model_alias（规范值 + 别名）与 models（品牌 + 型号）构造机型族映射，
 * 只在查询/聚合时归并，零数据写入、不回填历史行。
 */
type ModelFamilyMap = Map<string, string>;

function normModel(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadModelFamilyMap(): ModelFamilyMap {
  const map: ModelFamilyMap = new Map();
  const aliases = db.prepare('SELECT canonical, alias FROM model_alias').all() as Array<{
    canonical: string;
    alias: string;
  }>;
  for (const r of aliases) {
    const canonical = String(r.canonical || '').trim();
    if (!canonical) continue;
    map.set(normModel(r.alias), canonical);
    map.set(normModel(canonical), canonical);
  }
  const models = db.prepare('SELECT brand, model FROM models').all() as Array<{
    brand: string;
    model: string;
  }>;
  for (const m of models) {
    const model = String(m.model || '').trim();
    if (!model) continue;
    const brand = String(m.brand || '').trim();
    const canonical = map.get(normModel(model)) || `${brand} ${model}`.trim();
    map.set(normModel(model), canonical);
    map.set(normModel(`${brand} ${model}`), canonical);
    map.set(normModel(`${brand}${model}`), canonical);
  }
  return map;
}

/** 把库里任一自由文本写法归一到机型族规范值；未登记的写法保持原样 */
function modelFamily(value: string, map: ModelFamilyMap): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return map.get(normModel(raw)) || raw;
}

/** 展开某机型族在 cases 表里的全部实际写法，供列表 IN 查询使用（不漏数据） */
function modelVariantsOf(family: string, map: ModelFamilyMap): string[] {
  const variants = new Set<string>([family]);
  const rows = db.prepare('SELECT DISTINCT model FROM cases').all() as Array<{ model: string }>;
  for (const r of rows) {
    if (modelFamily(r.model, map) === family) variants.add(r.model);
  }
  return Array.from(variants);
}

/**
 * 四个级联条件（客户 → 型号 → 故障分类 → 状态）。
 * exclude 指定「算哪个下拉」时，就忽略该下拉自己已选中的值，只套用其他条件（自排除）。
 * source / q 属于列表的附加过滤，不参与级联统计。
 */
function caseConditions(f: CaseFilters, exclude?: FacetKey, familyMap?: ModelFamilyMap) {
  const where: string[] = [];
  const params: any[] = [];
  if (f.customer && exclude !== 'customer') {
    where.push('customer = ?');
    params.push(f.customer);
  }
  if (f.model && exclude !== 'model') {
    const map = familyMap || loadModelFamilyMap();
    const variants = modelVariantsOf(modelFamily(f.model, map), map);
    where.push(`model IN (${variants.map(() => '?').join(', ')})`);
    params.push(...variants);
  }
  if (f.category && exclude !== 'category') {
    if (f.category === UNCATEGORIZED) where.push("(category IS NULL OR TRIM(category) = '')");
    else {
      where.push('category = ?');
      params.push(f.category);
    }
  }
  if (f.status && exclude !== 'status') {
    where.push('status = ?');
    params.push(f.status);
  }
  if (f.source && ['sample', 'manual', 'import'].includes(f.source)) {
    where.push('source = ?');
    params.push(f.source);
  }
  if (f.q) {
    where.push(
      '(model LIKE ? OR customer LIKE ? OR symptom LIKE ? OR diagnosis LIKE ? OR solution LIKE ? OR parts LIKE ?)'
    );
    const kw = `%${f.q}%`;
    params.push(kw, kw, kw, kw, kw, kw);
  }
  return { where, params };
}

const FACET_EXPR: Record<FacetKey, string> = {
  customer: 'customer',
  model: 'model',
  category: `CASE WHEN category IS NULL OR TRIM(category) = '' THEN '${UNCATEGORIZED}' ELSE category END`,
  status: 'status',
};

function canModifyCase(user: AuthUser, row: Pick<CaseRow, 'author' | 'status'>) {
  if (user.role === 'engineer') return true;
  return row.author === user.name && ['pending', 'rejected'].includes(row.status);
}

function autoApproveEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'engineer_auto_approve'").get() as
    | { value: string }
    | undefined;
  return row?.value === '1';
}

function initialStatus(user: AuthUser) {
  if (user.role === 'engineer' && autoApproveEnabled()) {
    return { status: 'approved', reviewer: user.name, reviewed_at: new Date().toISOString() };
  }
  return { status: 'pending', reviewer: '', reviewed_at: null as string | null };
}

function resolveModel(text: string, id?: number) {
  if (id) {
    const row = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow | undefined;
    if (row) return row;
  }
  const value = String(text || '').trim();
  if (!value) return null;
  const exact = db.prepare('SELECT * FROM models WHERE model = ? OR brand || ? = ?').get(value, ' ', value) as
    | ModelRow
    | undefined;
  if (exact) return exact;
  const combined = db.prepare('SELECT * FROM models WHERE ? LIKE ? OR ? LIKE ?').all(
    value,
    `%${value}%`,
    value,
    `%${value}%`
  ) as ModelRow[];
  return combined[0] || null;
}

function resolveCustomer(text: string, id?: number) {
  if (id) {
    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined;
    if (row) return row;
  }
  const value = String(text || '').trim();
  if (!value) return null;
  const exact = db.prepare('SELECT * FROM customers WHERE name = ?').get(value) as CustomerRow | undefined;
  if (exact) return exact;
  const fuzzy = db.prepare('SELECT * FROM customers WHERE name LIKE ? OR ? LIKE name').get(`%${value}%`, value) as
    | CustomerRow
    | undefined;
  return fuzzy || null;
}

function insertCase(user: AuthUser, body: any, files?: Express.Multer.File[]) {
  const modelText = String(body?.model || '').trim();
  const customerText = String(body?.customer || '').trim();
  const symptom = String(body?.symptom || '').trim();
  const solution = String(body?.solution || '').trim();

  if (!modelText) return { error: '型号不能为空' };
  if (!symptom) return { error: '现象描述不能为空' };
  if (!solution) return { error: '解决方案不能为空' };

  const category = String(body?.category || '').trim();
  if (category && !CASE_CATEGORIES.includes(category)) return { error: '故障分类不在可选值里' };

  const modelRow = resolveModel(modelText, Number(body?.model_id) || undefined);
  const customerRow = resolveCustomer(customerText, Number(body?.customer_id) || undefined);
  const initial = initialStatus(user);

  const info = db
    .prepare(
      `INSERT INTO cases
       (model, customer, symptom, diagnosis, solution, parts, note, repaired_at, status, author,
        model_id, customer_id, category, reviewer, reviewed_at, reject_reason, import_batch_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
    )
    .run(
      modelText,
      customerText,
      symptom,
      String(body?.diagnosis || '').trim(),
      solution,
      String(body?.parts || '').trim(),
      String(body?.note || '').trim(),
      body?.repaired_at ? String(body.repaired_at).trim() || null : null,
      initial.status,
      String(body?.author || user.name).trim() || user.name,
      modelRow?.id ?? null,
      customerRow?.id ?? null,
      category,
      initial.reviewer,
      initial.reviewed_at,
      String(body?.import_batch_no || '').trim()
    );

  const id = Number(info.lastInsertRowid);
  if (files?.length) saveAttachments(id, files, user.name);
  clearCache();
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow;
  return { row };
}

router.get('/cases', requireAuth, (req, res) => {
  try {
    const f = readCaseFilters(req.query as Record<string, unknown>);
    const sort = String(req.query.sort || 'created_at');
    const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(String(req.query.pageSize || '10'), 10) || 10));

    const scopeResult = caseScope(req.user!, f.scope);
    if ('error' in scopeResult) return fail(res, scopeResult.error, 403, 403);
    const cond = caseConditions(f);
    const where: string[] = ['1 = 1', scopeResult.sql, ...cond.where];
    const params: any[] = [...scopeResult.params, ...cond.params];

    const whereSql = where.join(' AND ');
    const orderParams: any[] = [];
    // 按维修日期排序时，未填维修日期的排最后（不参与时间比较），避免播种当天created_at干扰
    let orderSql = `CASE WHEN repaired_at IS NULL THEN 1 ELSE 0 END ASC, repaired_at ${order}, created_at ${order}`;

    if (sort === 'created_at') {
      orderSql = `created_at ${order}`;
    } else if (sort === 'repaired_at') {
      orderSql = `CASE WHEN repaired_at IS NULL THEN 1 ELSE 0 END ASC, repaired_at ${order}, created_at ${order}`;
    } else if (sort === 'similarity') {
      if (f.q) {
        const kw = `%${f.q}%`;
        orderSql = `(CASE WHEN model LIKE ? THEN 40 ELSE 0 END
                   + CASE WHEN customer LIKE ? THEN 20 ELSE 0 END
                   + CASE WHEN symptom LIKE ? THEN 20 ELSE 0 END
                   + CASE WHEN diagnosis LIKE ? OR solution LIKE ? THEN 10 ELSE 0 END) DESC`;
        orderParams.push(kw, kw, kw, kw, kw);
      } else {
        orderSql = 'id DESC';
      }
    } else if (sort === 'updated_at') {
      orderSql = `updated_at ${order}`;
    }

    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM cases WHERE ${whereSql}`).get(...params) as { c: number }
    ).c;

    const list = db
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM cases r
           WHERE r.model = c.model AND r.customer = c.customer AND r.symptom = c.symptom) AS recurrence_count
         FROM cases c WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`
      )
      .all(...params, ...orderParams, pageSize, (page - 1) * pageSize);

    return ok(res, { list, total, page, pageSize });
  } catch (e: any) {
    return fail(res, e.message || '查询案例失败');
  }
});

interface FacetOption {
  value: string;
  label: string;
  count: number;
}

const STATUS_LABEL: Record<string, string> = {
  approved: '已存档',
  pending: '待审核',
  rejected: '已驳回',
};

/**
 * 级联分面统计接口（第 17 轮）。
 * 顺序：客户 → 型号 → 故障分类 → 状态。
 * 算某一个下拉时，忽略该下拉自己已选中的值、只套用其他条件（自排除），
 * 因此选了「华为」之后客户下拉里其他客户仍有非零条数，用户能随时换着看。
 * 条数一律先套当前登录人的可见范围，技术员不会通过计数看到别人的案例数量。
 * 关键字搜索保持现状、不参与级联；数据量小，直接 SQL GROUP BY，无索引/缓存/新依赖。
 */
router.get('/cases/facets', requireAuth, (req, res) => {
  try {
    const f = readCaseFilters(req.query as Record<string, unknown>);
    const scopeResult = caseScope(req.user!, f.scope);
    if ('error' in scopeResult) return fail(res, scopeResult.error, 403, 403);

    // 关键字不参与级联；来源筛选仍作为公共条件保留（列表与条数口径一致）
    const base: CaseFilters = { ...f, q: '' };
    const familyMap = loadModelFamilyMap();

    const facets: Record<FacetKey, FacetOption[]> = {
      customer: [],
      model: [],
      category: [],
      status: [],
    };

    for (const key of FACET_KEYS) {
      const cond = caseConditions(base, key, familyMap);
      const whereSql = ['1 = 1', scopeResult.sql, ...cond.where].join(' AND ');
      const params = [...scopeResult.params, ...cond.params];
      const rows = db
        .prepare(
          `SELECT ${FACET_EXPR[key]} AS value, COUNT(*) AS count
           FROM cases WHERE ${whereSql} GROUP BY value ORDER BY count DESC, value ASC`
        )
        .all(...params) as Array<{ value: string | null; count: number }>;

      // 型号维度按机型族归并：SQL 仍按 model GROUP BY，同族写法在结果里合并成一项并累加条数
      if (key === 'model') {
        const merged = new Map<string, FacetOption>();
        for (const r of rows) {
          const raw = r.value === null || String(r.value).trim() === '' ? '' : String(r.value);
          const value = modelFamily(raw, familyMap);
          const label = value || '未填写型号';
          const prev = merged.get(value);
          if (prev) prev.count += Number(r.count);
          else merged.set(value, { value, label, count: Number(r.count) });
        }
        facets.model = Array.from(merged.values()).sort(
          (a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh')
        );
        continue;
      }

      facets[key] = rows.map((r) => {
        const value = r.value === null || String(r.value).trim() === '' ? '' : String(r.value);
        let label = value;
        if (key === 'category') label = value === UNCATEGORIZED || value === '' ? '未分类' : value;
        if (key === 'status') label = STATUS_LABEL[value] || value;
        if (key === 'customer') label = value || '未填写客户';
        return { value, label, count: Number(r.count) };
      });
    }

    // 全条件下（不排除任何维度）的可见总数，用于对账：无筛选时客户下拉条数之和应等于它
    const all = caseConditions(base, undefined, familyMap);
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM cases WHERE ${['1 = 1', scopeResult.sql, ...all.where].join(' AND ')}`
        )
        .get(...scopeResult.params, ...all.params) as { c: number }
    ).c;

    return ok(res, { facets, total, applied: f });
  } catch (e: any) {
    return fail(res, e.message || '统计分面失败');
  }
});

router.get('/cases/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as CaseRow | undefined;
    if (!row) return fail(res, '案例不存在');
    if (!canViewCase(req.user!, row)) return fail(res, '无权查看该案例', 403, 403);
    return ok(res, { ...row, attachments: listAttachments(row.id) });
  } catch (e: any) {
    return fail(res, e.message || '获取案例失败');
  }
});

function canViewCase(user: AuthUser, row: Pick<CaseRow, 'author' | 'status'>) {
  if (user.role === 'engineer') return true;
  return row.status === 'approved' || row.author === user.name;
}

router.post('/cases', requireAuth, (req, res) => {
  try {
    const result = insertCase(req.user!, req.body || {});
    if (result.error) return fail(res, result.error);
    return ok(res, result.row, '案例已提交');
  } catch (e: any) {
    return fail(res, e.message || '新增案例失败');
  }
});

router.post(
  '/cases/upload',
  requireAuth,
  (req, res, next) => {
    uploadImages.array('attachments', 9)(req, res, (error: any) => {
      if (error) return fail(res, uploadErrorToMessage(error));
      return next();
    });
  },
  (req, res) => {
    try {
      const body = { ...(req.body || {}) };
      if (typeof body.deleteAttachmentIds === 'string') {
        try {
          body.deleteAttachmentIds = JSON.parse(body.deleteAttachmentIds);
        } catch {
          body.deleteAttachmentIds = [];
        }
      }
      const files = (req.files as Express.Multer.File[]) || [];
      const result = insertCase(req.user!, body, files);
      if (result.error) return fail(res, result.error);
      return ok(res, result.row, '案例与图片已提交');
    } catch (e: any) {
      return fail(res, e.message || '上传案例失败');
    }
  }
);

router.put('/cases/:id', requireAuth, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as CaseRow | undefined;
    if (!existing) return fail(res, '案例不存在');
    if (!canModifyCase(req.user!, existing)) {
      return fail(res, '只能编辑本人提交的待审核或已驳回案例', 403, 403);
    }

    const body = req.body || {};
    const modelText = String(body.model ?? existing.model).trim();
    const customerText = String(body.customer ?? existing.customer).trim();
    const symptom = String(body.symptom ?? existing.symptom).trim();
    const solution = String(body.solution ?? existing.solution).trim();
    const category = String(body.category ?? existing.category ?? '').trim();

    if (!modelText) return fail(res, '型号不能为空');
    if (!symptom) return fail(res, '现象描述不能为空');
    if (!solution) return fail(res, '解决方案不能为空');
    if (category && !CASE_CATEGORIES.includes(category)) return fail(res, '故障分类不在可选值里');

    const modelRow = resolveModel(modelText, Number(body.model_id) || existing.model_id || undefined);
    const customerRow = resolveCustomer(customerText, Number(body.customer_id) || existing.customer_id || undefined);
    const resubmitted = existing.status === 'rejected';
    const nextStatus = resubmitted ? 'pending' : existing.status;
    const nextAuthor =
      req.user!.role === 'engineer' && body.author !== undefined
        ? String(body.author).trim()
        : String(existing.author);

    db.prepare(
      `UPDATE cases SET model = ?, customer = ?, symptom = ?, diagnosis = ?, solution = ?,
       parts = ?, note = ?, repaired_at = ?, author = ?, status = ?, category = ?, model_id = ?, customer_id = ?,
       updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(
      modelText,
      customerText,
      symptom,
      String(body.diagnosis ?? existing.diagnosis).trim(),
      solution,
      String(body.parts ?? existing.parts).trim(),
      String(body.note ?? existing.note).trim(),
      body.repaired_at !== undefined ? String(body.repaired_at).trim() || null : existing.repaired_at,
      nextAuthor,
      nextStatus,
      category,
      modelRow?.id ?? null,
      customerRow?.id ?? null,
      req.params.id
    );

    clearCache();
    return ok(
      res,
      db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id),
      resubmitted ? '已修改并重新提交，等待审核' : '更新成功'
    );
  } catch (e: any) {
    return fail(res, e.message || '更新案例失败');
  }
});

router.delete('/cases/:id', requireAuth, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as CaseRow | undefined;
    if (!existing) return fail(res, '案例不存在');
    if (!canModifyCase(req.user!, existing)) {
      return fail(res, '只能删除本人提交的待审核或已驳回案例', 403, 403);
    }

    deleteAttachmentsOfCase(Number(req.params.id));
    const info = db.prepare('DELETE FROM cases WHERE id = ?').run(req.params.id);
    if (!info.changes) return fail(res, '案例不存在');
    clearCache();
    return ok(res, { id: Number(req.params.id) }, '删除成功');
  } catch (e: any) {
    return fail(res, e.message || '删除案例失败');
  }
});

/** 同型号 + 同客户 + 同故障现象的历史复发记录（含本条），按维修日期从新到旧 */
router.get('/cases/:id/recurrences', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id) as CaseRow | undefined;
    if (!row) return fail(res, '案例不存在');
    if (!canViewCase(req.user!, row)) return fail(res, '无权查看该案例', 403, 403);
    const list = db
      .prepare(
        `SELECT id, model, customer, symptom, repaired_at, created_at, source FROM cases
         WHERE model = ? AND customer = ? AND symptom = ?
         ORDER BY CASE WHEN repaired_at IS NULL THEN 1 ELSE 0 END ASC, repaired_at DESC, created_at DESC`
      )
      .all(row.model, row.customer, row.symptom);
    const dated = (list as any[]).filter((x) => x.repaired_at);
    return ok(res, {
      total: list.length,
      list,
      last_repaired: dated.length ? dated[0].repaired_at : null,
    });
  } catch (e: any) {
    return fail(res, e.message || '查询复发记录失败');
  }
});

router.get('/cases/:id/similar', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT id, model FROM cases WHERE id = ?').get(req.params.id) as
      | { id: number; model: string }
      | undefined;
    if (!row) return fail(res, '案例不存在');
    if (!canViewCase(req.user!, row as CaseRow)) return fail(res, '无权查看该案例', 403, 403);
    const list = db
      .prepare(
        `SELECT id, model, symptom, category, repaired_at, created_at FROM cases
         WHERE status = 'approved' AND model = ? AND id <> ?
         ORDER BY CASE WHEN repaired_at IS NULL THEN 1 ELSE 0 END ASC, repaired_at DESC, created_at DESC LIMIT 5`
      )
      .all(row.model, row.id);
    return ok(res, list);
  } catch (e: any) {
    return fail(res, e.message || '查询同型号案例失败');
  }
});

router.post('/cases/:id/approve', requireRole('engineer'), (req, res) => {
  try {
    const info = db
      .prepare(
        `UPDATE cases SET status = 'approved', reviewer = ?, reviewed_at = datetime('now','localtime'),
         reject_reason = '', updated_at = datetime('now','localtime') WHERE id = ?`
      )
      .run(req.user!.name, req.params.id);
    if (!info.changes) return fail(res, '案例不存在');
    clearCache();
    return ok(res, db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id), '已通过并归档');
  } catch (e: any) {
    return fail(res, e.message || '审核失败');
  }
});

router.post('/cases/:id/reject', requireRole('engineer'), (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return fail(res, '驳回原因不能为空');
    const info = db
      .prepare(
        `UPDATE cases SET status = 'rejected', reviewer = ?, reviewed_at = datetime('now','localtime'),
         reject_reason = ?, updated_at = datetime('now','localtime') WHERE id = ?`
      )
      .run(req.user!.name, reason, req.params.id);
    if (!info.changes) return fail(res, '案例不存在');
    clearCache();
    return ok(res, db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id), '已驳回');
  } catch (e: any) {
    return fail(res, e.message || '驳回失败');
  }
});

/** 清除全部示例数据：先备份，再连带删除附件；仅工程师可用，需前端二次确认 */
router.post('/cases/purge-samples', requireRole('engineer'), (_req, res) => {
  try {
    const ids = (db.prepare("SELECT id FROM cases WHERE source = 'sample'").all() as { id: number }[]).map((r) => r.id);
    if (ids.length === 0) return ok(res, { deleted: 0, backup: null }, '没有示例数据需要清除');
    const target = backupDatabase(db);
    db.transaction(() => {
      for (const id of ids) deleteAttachmentsOfCase(id);
      db.prepare("DELETE FROM cases WHERE source = 'sample'").run();
      clearCache();
    })();
    return ok(res, { deleted: ids.length, backup: target }, `已清除 ${ids.length} 条示例数据`);
  } catch (e: any) {
    return fail(res, e.message || '清除示例数据失败');
  }
});

export default router;
