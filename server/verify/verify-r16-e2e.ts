import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseTestDbArg, VERIFY_DIR } from './verify-guard.mjs';

const OUT = path.join(VERIFY_DIR, 'verify-r16-e2e-out.txt');
const lines: string[] = [];
const put = (s: string) => lines.push(s);
const J = (v: unknown) => JSON.stringify(v, null, 2);

const Q1 = '联想SR650 华为 开机不显示 风扇满转 键盘失灵';
const Q2 = '开机不显示，灯不亮';
const Q3 = '开机不显示 主板有糊味';

/** 用 scoreTrace 的 label→weight 表，把某条案例的 matched 反算成命中权重 */
function explainScore(c: any, trace: any) {
  const weightByLabel = new Map<string, number>(
    (trace?.tokens || []).map((t: any) => [t.label, t.weight])
  );
  const parts = (c.matched || []).map((label: string) => ({
    label,
    weight: weightByLabel.get(label) ?? 0,
  }));
  const sum = parts.reduce((s: number, p: any) => s + p.weight, 0);
  return {
    score: c.score,
    hitWeight: sum,
    totalWeight: trace?.totalWeight,
    formula: `${sum} ÷ ${trace?.totalWeight} × 100 = ${c.score}`,
    matchedTokens: parts,
  };
}

async function main() {
  // 守卫必须先设置 REPAIR_DB_PATH，之后才动态 import 服务模块（否则 db 会回落到开发库）
  const dbPath = parseTestDbArg();
  const { db } = await import('../src/db/index.ts');
  const { default: conversations } = await import('../src/routes/conversations.ts');
  const { default: chat } = await import('../src/routes/chat.ts');
  const { createSession } = await import('../src/services/auth.ts');
  const { normalizeQuery } = await import('../src/services/cache.ts');

  put(`TEST_DB=${dbPath}`);
  put(`THRESHOLD=${(db.prepare("SELECT value FROM settings WHERE key = 'match_threshold'").get() as any).value}`);
  put(`CASES_TOTAL=${(db.prepare('SELECT count(*) AS c FROM cases').get() as any).c}`);

  for (const q of [Q1, Q2, Q3]) {
    db.prepare('DELETE FROM search_cache WHERE query_norm = ?').run(normalizeQuery(q));
  }
  put(`CACHE_LEFT=${(db.prepare('SELECT count(*) AS c FROM search_cache').get() as any).c}`);

  const empNo = 'TMPR16' + String(Date.now()).slice(-6);
  const info = db
    .prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(empNo, '第16轮临时测试A', 'engineer', '临时', bcrypt.hashSync('TmpR16@Test', 10));
  const token = createSession(Number(info.lastInsertRowid), empNo);

  const empNo2 = empNo + 'B';
  const info2 = db
    .prepare('INSERT INTO users (emp_no, name, role, position, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(empNo2, '第16轮临时测试B', 'technician', '临时', bcrypt.hashSync('TmpR16@Test', 10));
  const token2 = createSession(Number(info2.lastInsertRowid), empNo2);

  const app = express();
  app.use(express.json());
  app.use('/api', chat);
  app.use('/api', conversations);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as any).port;

  const call = async (method: string, url: string, body?: unknown, authToken = token) => {
    const resp = await fetch(`http://127.0.0.1:${port}/api${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return await resp.json();
  };

  try {
    const created: any = await call('POST', '/chat/sessions');
    put('===== 会话表 / 新建 =====');
    put(J(created));
    const sid = created.data.id;

    for (const q of [Q1, Q2, Q3]) {
      const r: any = await call('POST', `/chat/sessions/${sid}/ask`, { message: q });
      const d = r.data || {};
      put(`===== 实测：${q} =====`);
      put(`code=${r.code} source=${d.source} route=${d.route} fallbackReason=${d.fallbackReason ?? ''}`);
      put(`keywords=${J(d.keywords)}`);
      put(`normalizedSymptoms=${J(d.normalizedSymptoms)}`);
      put(`summary=${d.summary}`);
      put(`scoreTrace=${J(d.scoreTrace)}`);
      put(`admittedCount=${d.admittedCount} cases.length=${(d.cases || []).length} weakCases.length=${(d.weakCases || []).length}`);
      put(`cases=${J((d.cases || []).map((c: any) => ({ id: c.id, model: c.model, customer: c.customer, score: c.score, admissionBasis: c.admissionBasis })))}`);
      put(`weakCases=${J((d.weakCases || []).map((c: any) => ({ id: c.id, model: c.model, score: c.score, admissionBasis: c.admissionBasis })))}`);
      put(`scoreRecalc=${J((d.cases || []).map((c: any) => ({ id: c.id, ...explainScore(c, d.scoreTrace) })))}`);
    }

    const rep: any = await call('POST', `/chat/sessions/${sid}/ask`, { message: Q2 });
    put('===== 同一会话重复问 Q2（搜索缓存）=====');
    put(`source=${rep.data?.source} route=${rep.data?.route} cacheHits=${rep.data?.cacheHits} cases=${(rep.data?.cases || []).length} summary=${rep.data?.summary}`);

    const hist: any = await call('GET', `/chat/sessions/${sid}/messages`);
    put('===== 历史消息 / 元数据还原 =====');
    put(`messageCount=${hist.data?.length}`);
    put(J((hist.data || []).map((m: any) => ({
      id: m.id,
      role: m.role,
      metaKeys: Object.keys(m.meta || {}),
      metaCases: (m.meta?.cases || []).length,
      metaWeakCases: (m.meta?.weakCases || []).length,
      metaSource: m.meta?.source,
      metaRoute: m.meta?.route,
      hasScoreTrace: !!m.meta?.scoreTrace,
      hasNormalizedSymptoms: Array.isArray(m.meta?.normalizedSymptoms),
    }))));

    const list: any = await call('GET', '/chat/sessions');
    put('===== 会话列表（按 updated_at 倒序）=====');
    put(J(list.data));
    const renamed: any = await call('PATCH', `/chat/sessions/${sid}`, { title: '第16轮验证会话（已重命名）' });
    put(`RENAME=${J(renamed.data)}`);
    const second: any = await call('POST', '/chat/sessions');
    const del: any = await call('DELETE', `/chat/sessions/${second.data.id}`);
    const list2: any = await call('GET', '/chat/sessions');
    put(`AFTER_DELETE=${J(list2.data)}`);
    put(`DELETE_RESULT=${J(del.data)}`);
    const otherList: any = await call('GET', '/chat/sessions', undefined, token2);
    put(`OTHER_USER_SESSION_LIST=${J(otherList.data)}`);
    const otherAsk: any = await call('POST', `/chat/sessions/${sid}/ask`, { message: Q2 }, token2);
    put(`OTHER_USER_ASK=${J({ code: otherAsk.code, message: otherAsk.message })}`);

    put('===== 配置表红线核对（副本只读）=====');
    put(J({
      llm_configs: db.prepare('SELECT id, model, length(api_key) AS key_len, is_active FROM llm_configs').all(),
      settings: db.prepare("SELECT key, value FROM settings WHERE key IN ('llm_enabled','match_threshold','llm_daily_limit','engineer_auto_approve') ORDER BY key").all(),
      symptom_dict: (db.prepare('SELECT count(*) AS c FROM symptom_dict').get() as any).c,
      model_alias: (db.prepare('SELECT count(*) AS c FROM model_alias').get() as any).c,
    }));
  } catch (e: any) {
    put('ERROR=' + String(e?.stack || e));
  } finally {
    fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
    server.close();
    db.close();
    console.log('DONE lines=' + lines.length);
  }
}

void main();
