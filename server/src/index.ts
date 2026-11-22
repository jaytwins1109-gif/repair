import express from 'express';
import cors from 'cors';
import './db';
import { db, migrationReport, seedReport } from './db';
import auth from './routes/auth';
import attachments from './routes/attachments';
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
app.use('/api', models);
app.use('/api', customers);
app.use('/api', cases);
app.use('/api', chat);
app.use('/api', conversations);
app.use('/api', llm);
app.use('/api', dictionary);

app.use('/api', (_req, res) => fail(res, '接口不存在', 404, 404));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server error]', err);
  return fail(res, err.message || '服务器内部错误', 500, 500);
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`[repair-agent-server] http://localhost:${PORT}`);
});
