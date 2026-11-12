import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as C from '../src/cost.ts';
import type { AiProvider } from '../src/ai.ts';
import { setClock, HOUR } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 13, 1, 0);
const limits = (o: Partial<C.Limits> = {}): C.Limits => ({ monthlyUsd: 1, perRequestCalls: 10, defaultExpected: { identify: 0.3, search: 0.5 }, ...o });
let calls = 0;
/** 실제 API 대신 사용량만 돌려주는 가짜 Claude(유료 경로로 집계되는지 보려고 kind=claude) */
const paid: AiProvider = {
  kind: 'claude', label: 'stub',
  async identify() { calls++; return { usage: { model: 'claude-opus-5-5', inputTokens: 40000, outputTokens: 4000, searches: 6 }, data: { identities: [], missing: [], summary: '', style: {} } }; },
  async search(i) { calls++; return { usage: { model: 'claude-opus-5-5', inputTokens: 60000, outputTokens: 6000, searches: 12 }, data: { sellers: i.sellers.map(s => ({ seller: s.name, searched: true, note: '' })), listings: [], summary: '', dropped: 0, blocked: [] } }; },
};

test('추정 비용: Opus 5.5 입력 4만·출력 4천·검색 6회 = $0.30 · 모르는 모델은 null', () => {
  assert.equal(C.estimateUsd({ model: 'claude-opus-5-5', inputTokens: 40000, outputTokens: 4000, searches: 6 }), 0.3);
  assert.equal(C.estimateUsd({ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 0, searches: 0 }), 2);
  assert.equal(C.estimateUsd({ model: 'unknown-model', inputTokens: 1, outputTokens: 1, searches: 0 }), null);
});

test('월 예산을 넘길 작업은 시작하지 않고 “보류” → 운영자가 추가 예산을 확인하면 다시 대기열로', async () => {
  setClock(T0); calls = 0;
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-cost-0001');
  D.createRequest(db, u.id, { productName: 'A' });
  const w = A.createAiWorker(db, paid, '/tmp', limits({ monthlyUsd: 0.5 }));
  A.ensureAiJobs(db, paid); await w.step();
  assert.equal(calls, 1);
  assert.equal(C.spent(db).usd, 0.3);
  const u2 = D.upsertUser(db, 'device-cost-0002');
  D.createRequest(db, u2.id, { productName: 'B' });
  A.ensureAiJobs(db, paid); await w.step();
  assert.equal(calls, 1, '예산($0.5)을 넘길 작업은 API를 부르지 않는다');
  const held = db.prepare(`SELECT * FROM ai_jobs WHERE status='held'`).get() as any;
  assert.match(held.error, /이번 달 AI 예산/);
  assert.throws(() => A.rerunAi(db, paid, held.request_id, 'identify', 'op'), (e: any) => e.code === 'ai_held');
  assert.equal(C.approveExtra(db, 1, '운영자'), 1);
  await w.step();
  assert.equal(calls, 2);
  assert.equal(C.costReport(db, limits({ monthlyUsd: 0.5 })).budget.total, 1.5);
});

test('의뢰별 호출 상한', async () => {
  setClock(T0); calls = 0;
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-cost-0003');
  const id = D.createRequest(db, u.id, { productName: 'A' });
  const w = A.createAiWorker(db, paid, '/tmp', limits({ monthlyUsd: 100, perRequestCalls: 1 }));
  A.ensureAiJobs(db, paid); await w.step();
  D.requestInfo(db, id, '태그 사진', 'op'); setClock(T0 + 1000); D.submitInfo(db, u.id, id, { text: '태그' });
  A.ensureAiJobs(db, paid); await w.step();
  assert.equal(calls, 1);
  assert.match((db.prepare(`SELECT error FROM ai_jobs WHERE status='held'`).get() as any).error, /의뢰별 AI 호출 상한/);
});

test('같은 조건의 국내 탐색은 하루 안에 다시 부르지 않고 결과를 재사용한다(비용 0)', async () => {
  setClock(T0); calls = 0;
  const db = openDb(':memory:');
  const w = A.createAiWorker(db, paid, '/tmp', limits({ monthlyUsd: 100 }));
  for (const dev of ['device-cost-0010', 'device-cost-0011']) {
    const u = D.upsertUser(db, dev);
    const id = D.createRequest(db, u.id, { productName: 'BADBLOOD Track Jacket', size: 'M', color: '네이비', maxPrice: 150000 });
    D.activate(db, id, { brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket' }, 'op');
  }
  A.ensureAiJobs(db, paid); await w.step(); await w.step();
  assert.equal(calls, 1, '두 번째 의뢰는 같은 검색을 재사용');
  const jobs = db.prepare(`SELECT * FROM ai_jobs WHERE kind='search' ORDER BY id`).all() as any[];
  assert.equal(jobs[1].reused_from, jobs[0].id);
  assert.equal(jobs[1].est_cost_usd, 0);
  setClock(T0 + 21 * HOUR);
});

test('재시작: API를 부른 뒤 끊긴 유료 작업은 자동으로 다시 돌리지 않는다(중복 과금 방지)', () => {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-cost-0020');
  D.createRequest(db, u.id, { productName: 'A' });
  A.ensureAiJobs(db, paid);
  db.prepare(`UPDATE ai_jobs SET status='running', attempts=1`).run();
  assert.equal(A.recoverAiJobs(db), 0);
  assert.equal((db.prepare('SELECT status FROM ai_jobs').get() as any).status, 'interrupted');
  assert.equal(A.ensureAiJobs(db, paid), 0, '끊긴 작업이 있으면 자동으로 새로 만들지 않는다');
  A.rerunAi(db, paid, 1, 'identify', '운영자'); // 운영자가 확인하고 다시 실행
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM ai_jobs WHERE status='queued'`).get() as any).n, 1);
});

test('모의 실행은 비용 집계에서 빠진다', async () => {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-cost-0030');
  D.createRequest(db, u.id, { productName: 'A' });
  const { mockProvider } = await import('../src/ai.ts');
  const p = mockProvider();
  const w = A.createAiWorker(db, p, '/tmp', limits({ monthlyUsd: 0 }));
  A.ensureAiJobs(db, p); await w.step();
  assert.equal((db.prepare('SELECT status FROM ai_jobs').get() as any).status, 'done', '예산 0이어도 모의는 돈다');
  assert.equal(C.spent(db).calls, 0);
});
