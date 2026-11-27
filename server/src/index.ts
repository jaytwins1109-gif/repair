import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import './db';
import { db, migrationReport, seedReport } from './db';
import auth from './routes/auth';
import attachments from './routes/attachments';
import modelAssets from './routes/modelAssets';
import knowledgeDocs from './routes/knowledgeDocs';
import settings from './routes/settings';
import imports from './routes/imports';
import exportRouter from './routes/export';
import models from './routes/models';
import customers from './routes/customers';
import cases from './routes/cases';
import chat from './routes/chat';
import conversations from './routes/conversations';
import llm from './routes/llm';
import dictionary from './routes/dictionary';
import { cleanupExpiredSessions } from './services/auth';
import { backupDatabase } from './services/backup';
import { ok, fail } from './response';

cleanupExpiredSessions();
// 第 26 轮：长期运行进程每小时清理一次过期会话，避免 chat_sessions 无限累积。
// 注意：expires_at 存的是毫秒时间戳整数（见 services/auth.ts createSession），
// 因此用 cleanupExpiredSessions() 的 Date.now() 比较语义，而不是 datetime('now','localtime') 文本比较。
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const sessionCleanupTimer = setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);
sessionCleanupTimer.unref();
const startupBackup = backupDatabase(db);
console.log('[migration]', JSON.stringify(migrationReport));
console.log('[seed]', JSON.stringify(seedReport));
console.log('[backup]', startupBackup);

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) =>
  ok(res, { status: 'ok', time: new Date().toISOString() })
);

app.use('/api', auth);
app.use('/api', settings);
app.use('/api', imports);
app.use('/api', exportRouter);
app.use('/api', attachments);
app.use('/api', modelAssets);
app.use('/api', knowledgeDocs);
app.use('/api', models);
app.use('/api', customers);
app.use('/api', cases);
app.use('/api', chat);
app.use('/api', conversations);
app.use('/api', llm);
app.use('/api', dictionary);

app.use('/api', (_req, res) => fail(res, '接口不存在', 404, 404));

// 第 43 轮：生产模式下由同一个 Express 进程托管前端构建产物，只需暴露一个端口。
// 路径相对编译后的 server/dist/index.js 解析：server/dist/../../client/dist。
const clientDist = path.resolve(process.env.REPAIR_CLIENT_DIST || path.join(__dirname, '../../client/dist'));
const indexHtml = path.join(clientDist, 'index.html');
const hasClientBuild = fs.existsSync(indexHtml);
if (hasClientBuild) {
  app.use(express.static(clientDist, { index: false }));
  // React 前端使用客户端路由/刷新深链接时统一回退到 index.html；API 不参与回退。
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return fail(res, '接口不存在', 404, 404);
    return res.sendFile(indexHtml);
  });
} else {
  app.get('*', (_req, res) => fail(res, '前端构建产物不存在，请先执行 npm run build', 503, 503));
}
console.log('[static]', JSON.stringify({ dir: clientDist, enabled: hasClientBuild }));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server error]', err);
  return fail(res, err.message || '服务器内部错误', 500, 500);
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`[repair-agent-server] http://localhost:${PORT}`);
});
