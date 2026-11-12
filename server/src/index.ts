import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from './db.ts';
import { userApi, apiErrors } from './api.ts';
import { adminRouter } from './admin.ts';
import { tick } from './domain.ts';
import { aiFromEnv } from './ai.ts';
import { createAiWorker, recoverAiJobs, ensureAiJobs } from './aijobs.ts';
import { loadSeedFile } from './catalog.ts';
import { limitsFromEnv } from './cost.ts';
import { createChecker, policyFromEnv, tickWatches } from './watch.ts';

const root = path.resolve(import.meta.dirname, '..');
// .env (있으면) — 이미 설정된 환경변수가 우선
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const PORT = Number(process.env.WALF_PORT || 4300);
const dbFile = path.resolve(root, process.env.WALF_DB || 'data/walf.db');
const uploads = path.resolve(root, process.env.WALF_UPLOADS || 'data/uploads');
fs.mkdirSync(path.dirname(dbFile), { recursive: true }); fs.mkdirSync(uploads, { recursive: true });
const password = process.env.WALF_ADMIN_PASSWORD;
if (!password) { console.error('WALF_ADMIN_PASSWORD 가 없어요. server/.env.example 을 .env 로 복사해 설정하세요.'); process.exit(1); }

if (password === 'change-me' || password.length < 12) console.warn('⚠ 어드민 비밀번호가 예시 값이거나 너무 짧아요. 같은 네트워크에 공개하기 전에 server/.env 의 WALF_ADMIN_PASSWORD 를 12자 이상으로 바꾸세요.');
// 스키마를 올릴 때는 바꾸기 전 사본을 data/backups 에 남긴다
const db = openDb(dbFile, { backupDir: path.resolve(root, process.env.WALF_BACKUPS || 'data/backups'), log: s => console.log(s) });
const seeded = loadSeedFile(db);
if (seeded) console.log(`브랜드 스타일 seed ${seeded}건을 넣었어요(출처 있음 · 운영자 검수 전).`);
// AI 보조: 키가 있으면 접수 즉시 AI가 먼저 식별·탐색하고 왈프 팀이 검수한다. 없으면 운영자가 직접 확인한다.
const ai = aiFromEnv();
const limits = limitsFromEnv();
const policy = policyFromEnv();
const app = express();
app.set('trust proxy', process.env.WALF_TRUST_PROXY === '1');
app.disable('x-powered-by');
app.set('etag', false); // 앱 상태는 항상 새로 읽는다(기기 캐시로 304가 섞이지 않게)
// 요청 한 줄 기록(QA용) — 본문·헤더 값은 남기지 않는다
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => { if (!req.path.startsWith('/uploads')) console.log(`${new Date().toISOString().slice(11, 19)} ${req.ip?.replace('::ffff:', '')} ${req.method} ${req.path} → ${res.statusCode} ${Date.now() - t}ms${req.get('content-length') ? ` (${Math.round(Number(req.get('content-length')) / 1024)}KB)` : ''}`); });
  next();
});
app.use('/uploads', express.static(uploads, { maxAge: '7d', immutable: true, fallthrough: false }));
app.use('/api', userApi(db, { uploads, pushConfigured: process.env.WALF_PUSH_DISABLED !== '1', policy }), apiErrors);
const checker = createChecker(db, policy);
app.use('/admin', adminRouter(db, { uploads, password, secret: process.env.WALF_SECRET || crypto.randomBytes(32).toString('hex'), qaTools: process.env.WALF_QA_TOOLS === '1', ai, limits, policy, checker }));
app.get('/', (_q, res) => res.redirect('/admin'));

const every = Number(process.env.WALF_TICK_MS || 30_000);
const doTick = () => { try { const r = tick(db); if (r.runs || r.missed || r.expired) console.log(new Date().toISOString(), 'tick', r); } catch (e) { console.error('tick 실패', e); } };
doTick(); setInterval(doTick, every);
if (ai) {
  const back = recoverAiJobs(db);
  ensureAiJobs(db, ai);
  createAiWorker(db, ai, uploads, limits).start(Number(process.env.WALF_AI_POLL_MS || 5000));
  if (back) console.log(`AI 작업 ${back}건을 다시 대기열에 넣었어요(서버 재시작).`);
}
// 기다려줘: 하루 한 번 가격 확인(AI 호출 없음). 끊긴 조회는 tick 이 회수한다
const w0 = tickWatches(db, policy);
if (w0.recovered) console.log(`가격 확인 ${w0.recovered}건을 다시 대기열에 넣었어요(서버 재시작).`);
checker.start(Number(process.env.WALF_WATCH_POLL_MS || 10_000));

app.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log(`WALF server  http://localhost:${PORT}  (LAN http://${lan}:${PORT})`);
  console.log(`  admin  http://localhost:${PORT}/admin   db ${path.relative(root, dbFile)}   QA도구 ${process.env.WALF_QA_TOOLS === '1' ? '켜짐' : '꺼짐'}`);
  console.log(`  AI     ${ai ? ai.label : '꺼짐 — server/.env 에 ANTHROPIC_API_KEY 가 없어 운영자가 직접 확인해요'} · 월 예산 $${limits.monthlyUsd} · 의뢰별 ${limits.perRequestCalls}회`);
  console.log(`  기다려줘 활성 ${policy.maxActive}개/사용자 · ${policy.checkEveryMs / 3600_000}시간마다 확인 · 테스트 가격 소스 ${policy.mockAllowed ? '켜짐' : '꺼짐'}`);
});
