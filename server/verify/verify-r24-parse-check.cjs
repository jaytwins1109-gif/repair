/** 只读解析已落盘的 chat 原始响应，纠正脚本字段误用（data.list -> data.cases）。不联网、不写库。 */
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'verify-r24-real-closure-out.txt');
const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('RESPONSE_BODY={"code":0,"data":{"keywords"'));
if (!line) throw new Error('未找到 chat 原始 RESPONSE_BODY');
const raw = line.slice('RESPONSE_BODY='.length);
const data = JSON.parse(raw).data;
const list = data.cases;
const target = list.find((x) => x.id === 39);
console.log('CHAT_LIST_FIELD=data.cases');
console.log('CHAT_LIST_COUNT=' + list.length);
console.log('CHAT_LIST_IDS=' + JSON.stringify(list.map((x) => ({ id: x.id, source: x.source, score: x.score, similarity: x.similarity }))));
console.log('NEW_CASE_IN_LIST=' + !!target);
console.log('NEW_CASE_ITEM=' + JSON.stringify(target && { id: target.id, model: target.model, source: target.source, status: target.status, score: target.score, similarity: target.similarity, matched: target.matched, author: target.author, reviewer: target.reviewer }));
console.log('SUMMARY=' + data.summary);
console.log('SCORE_TRACE=' + JSON.stringify(data.scoreTrace));
console.log('WEAK_CASES=' + JSON.stringify(data.weakCases));
console.log('ADMITTED_COUNT=' + data.admittedCount);
