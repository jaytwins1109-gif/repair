import { createTestDbCopy } from './verify-guard.mjs';

// 用法：node server/verify/verify-copy.mjs --db=<server/verify/.db/<批次>/data/repair.db 绝对路径>
// 源库以 readonly 打开，只做 VACUUM INTO，不写任何一行。
const dest = createTestDbCopy();
console.log(`TEST_DB=${dest}`);
