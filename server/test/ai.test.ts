import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import { AiError, cleanSearch, mockProvider, type AiProvider } from '../src/ai.ts';
import { setClock, HOUR } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 6, 1, 0);
const usage = { model: 'stub', inputTokens: 10, outputTokens: 5, searches: 2 };

/** 실제 API 대신 정해진 답을 돌려주는 가짜 제공자(실제 결과처럼 is_mock=0으로 저장되는지 보려고 kind는 claude) */
function stub(over: Partial<AiProvider> = {}): AiProvider {
  return {
    kind: 'claude', label: 'stub',
    async identify() {
      return { usage, data: { summary: '공식몰 상품명과 일치해요', missing: [], identities: [
        { brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', color: 'Navy', category: '아우터', confidence: 'high', reasons: ['로고 자수 위치가 같아요'], refs: ['https://badblood.co.kr/product/1'] },
        { brand: 'BADBLOOD', name: 'Nylon Track Jacket', color: 'Black', category: '아우터', confidence: 'low', reasons: ['색이 달라 보여요'], refs: [] },
      ] } };
    },
    async search(i) {
      return { usage, data: cleanSearch({ summary: '번개장터에서 같은 상품 1건', sellers: i.sellers.map(s => ({ seller: s.name, searched: s.name !== '중고나라', note: s.name === '번개장터' ? 'M 1건' : '없음' })),
        listings: [
          { seller: '번개장터', url: 'https://m.bunjang.co.kr/products/111', title: '배드블러드 트랙자켓 네이비 M', price: 118000, size: 'm', condition: 'used', match: 'same_likely', stock: 'listed', reason: '제목·사진이 같아요' },
          { seller: '무신사', url: 'https://www.musinsa.com/products/222', title: '비슷한 트랙자켓', price: null, size: '', condition: 'new', match: 'similar', stock: 'unknown', reason: '디자인 비슷' },
          { seller: '무신사', url: 'https://www.grailed.com/listings/9', title: '해외 매물', price: 90000, size: 'M', condition: 'used', match: 'same_likely', stock: 'listed', reason: '' },
          { seller: '번개장터', url: 'https://bunjang.co.kr/products/111/', title: '중복', price: 1, size: 'M', condition: 'used', match: 'same_likely', stock: 'listed', reason: '' },
        ] }, i.sellers, new Set(['bunjang.co.kr/products/111']), []) };
    },
    ...over,
  };
}
function setup(input: Partial<D.NewRequest> = { productName: '배드블러드 트랙자켓', size: 'M', maxPrice: 150000 }) {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-ai-0001', 'ios');
  const id = D.createRequest(db, u.id, input);
  return { db, u, id };
}
const acts = (db: any, id: number) => db.prepare('SELECT actor, kind, is_mock FROM activity WHERE request_id=? ORDER BY id').all(id) as any[];
const sellerIds = (db: any) => (db.prepare('SELECT id FROM sellers ORDER BY sort').all() as any[]).map(s => s.id);

test('AI가 먼저: 접수하면 식별 작업이 생기고, 결과는 검수 전 제안으로만 남는다', async () => {
  const { db, id, u } = setup();
  const p = stub();
  assert.equal(A.ensureAiJobs(db, p), 1);
  assert.equal(A.ensureAiJobs(db, p), 0, '같은 접수에 식별을 두 번 만들지 않는다');
  await A.createAiWorker(db, p, '/tmp').step();
  const job = db.prepare(`SELECT * FROM ai_jobs WHERE request_id=?`).get(id) as any;
  assert.equal(job.status, 'done'); assert.equal(job.searches, 2); assert.equal(job.is_mock, 0);
  const ids = db.prepare('SELECT * FROM ai_identities WHERE request_id=? ORDER BY rank').all(id) as any[];
  assert.deepEqual(ids.map(x => [x.rank, x.status, x.confidence]), [[1, 'proposed', 'high'], [2, 'proposed', 'low']]);
  // 팀이 확정하기 전이라 7일은 흐르지 않고, 사용자 화면도 “확인 중” 그대로다
  const r = D.getRequest(db, id);
  assert.equal(r.status, 'submitted'); assert.equal(r.expires_at, null);
  assert.equal(D.display(db, r).key, 'identification_pending');
  assert.deepEqual(acts(db, id).map(a => a.actor + ':' + a.kind), ['user:submitted', 'walf:ai_identify']);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(u.id) as any).n, 0, 'AI 제안만으로 알림을 보내지 않는다');
});

test('AI 제안을 채택하면 7일이 시작되고, 1일차 탐색도 AI가 먼저 한다 → 팀 검수 전에는 탐색 기록을 저장할 수 없다', async () => {
  const { db, id } = setup();
  const p = stub(); const w = A.createAiWorker(db, p, '/tmp');
  A.ensureAiJobs(db, p); await w.step();
  const top = db.prepare('SELECT * FROM ai_identities WHERE request_id=? AND rank=1').get(id) as any;
  setClock(T0 + HOUR);
  A.acceptIdentity(db, top.id, { brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket Navy' }, '운영자');
  const r = D.getRequest(db, id);
  assert.equal(r.status, 'active'); assert.equal(r.identified_name, 'Mystic Nylon Track Jacket Navy'); assert.equal(r.expires_at - r.activated_at, 168 * HOUR);
  assert.match(r.identified_note, /AI 제안 1순위 채택/);
  assert.deepEqual((db.prepare('SELECT status FROM ai_identities WHERE request_id=? ORDER BY rank').all(id) as any[]).map(x => x.status), ['accepted', 'passed']);

  assert.equal(A.ensureAiJobs(db, p), 1, '1일차 탐색 작업에 AI 탐색이 붙는다');
  await w.step();
  const finds = db.prepare('SELECT f.*, s.name seller FROM ai_finds f JOIN sellers s ON s.id=f.seller_id WHERE f.request_id=? ORDER BY f.id').all(id) as any[];
  assert.deepEqual(finds.map(f => [f.seller, f.match_guess, f.url_seen]), [['번개장터', 'same_likely', 1], ['무신사', 'similar', 0]], '해외 주소는 버리고, 같은 주소는 한 번만, 검색 결과에 없던 주소는 표시');
  assert.equal(finds[0].size, 'M');
  const job = db.prepare(`SELECT * FROM ai_jobs WHERE kind='search'`).get() as any;
  const det = JSON.parse(job.detail);
  assert.equal(det.dropped, 1); assert.equal(det.duplicates, 1); assert.equal(det.sellers.find((n: any) => n.seller === '중고나라').searched, false);
  assert.equal(D.requestView(db, D.getRequest(db, id)).sellers, null, 'AI 탐색 결과는 팀이 저장하기 전까지 사용자에게 안 보인다');

  const run = db.prepare('SELECT * FROM search_runs WHERE request_id=? AND day=1').get(id) as any;
  const checks = sellerIds(db).map((sid, i) => ({ sellerId: sid, status: 'checked' as const, result: (i === 3 ? 'same' : 'none') as any }));
  assert.throws(() => D.completeRun(db, run.id, { checks, outcome: 'leads' }, '운영자'), (e: any) => e.code === 'ai_unreviewed');

  // 검수: 같은 상품은 후보로(기본 비공개), 비슷한 상품은 제외
  assert.throws(() => A.rejectFind(db, finds[1].id, '', '운영자'), (e: any) => e.code === 'need_reason');
  const cid = A.acceptFind(db, finds[0].id, { matchGrade: 'same_likely', availability: 'listed_unverified', size: 'M', price: 118000 }, '운영자');
  A.rejectFind(db, finds[1].id, '다른 상품', '운영자');
  assert.throws(() => A.acceptFind(db, finds[0].id, { matchGrade: 'same_likely', availability: 'listed_unverified' }, '운영자'), (e: any) => e.code === 'bad_state');
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(cid) as any;
  assert.equal(c.source, 'search'); assert.equal(c.seller, '번개장터'); assert.equal(c.run_id, run.id); assert.equal(c.published, 0); assert.equal(c.url, 'https://m.bunjang.co.kr/products/111');
  D.completeRun(db, run.id, { checks, outcome: 'leads' }, '운영자');
  assert.equal((db.prepare('SELECT status FROM search_runs WHERE id=?').get(run.id) as any).status, 'done');
  assert.deepEqual(acts(db, id).map(a => a.actor + ':' + a.kind), ['user:submitted', 'walf:ai_identify', 'team:activated', 'walf:ai_search', 'team:search']);
});

test('AI가 구매 가능으로 단정한 매물도 팀 확인(시각·가격) 없이는 구매 가능 후보가 되지 않는다', async () => {
  const { db, id } = setup();
  const p = stub(); const w = A.createAiWorker(db, p, '/tmp');
  A.ensureAiJobs(db, p); await w.step();
  A.acceptIdentity(db, (db.prepare('SELECT id FROM ai_identities WHERE rank=1').get() as any).id, {}, 'op');
  A.ensureAiJobs(db, p); await w.step();
  const f = db.prepare(`SELECT * FROM ai_finds WHERE match_guess='same_likely'`).get() as any;
  assert.throws(() => A.acceptFind(db, f.id, { matchGrade: 'same_confirmed', availability: 'purchasable', price: 118000 }, 'op'), (e: any) => e.code === 'need_checked_at');
  assert.throws(() => A.acceptFind(db, f.id, { matchGrade: 'similar', availability: 'listed_unverified', publish: true }, 'op'), (e: any) => e.code === 'not_publishable');
  assert.equal((db.prepare('SELECT status FROM ai_finds WHERE id=?').get(f.id) as any).status, 'proposed', '실패한 검수는 그대로 남는다');
});

test('AI 실패는 성공처럼 보이지 않는다 — 실패 사유만 어드민에 남고 사용자 일지·알림은 없다', async () => {
  const { db, id } = setup();
  const p = stub({ async identify() { throw new AiError('refusal', 'AI가 이 요청을 처리하지 않았어요.'); } });
  A.ensureAiJobs(db, p);
  const warn = console.warn; console.warn = () => {};
  try { await A.createAiWorker(db, p, '/tmp').step(); } finally { console.warn = warn; }
  const job = db.prepare('SELECT * FROM ai_jobs').get() as any;
  assert.equal(job.status, 'failed'); assert.equal(job.error, 'AI가 이 요청을 처리하지 않았어요.');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM ai_identities').get() as any).n, 0);
  assert.deepEqual(acts(db, id).map(a => a.kind), ['submitted']);
  assert.equal(A.ensureAiJobs(db, p), 0, '실패한 식별을 저절로 반복하지 않는다(운영자가 다시 실행)');
  A.rerunAi(db, p, id, 'identify', '운영자');
  assert.throws(() => A.rerunAi(db, p, id, 'identify', '운영자'), (e: any) => e.code === 'ai_busy');
  assert.throws(() => A.rerunAi(db, null, id, 'identify', '운영자'), (e: any) => e.code === 'ai_off');
});

test('운영자가 먼저 직접 확정하면 대기 중이던 AI 식별은 실행하지 않고, 남은 제안은 고르지 않은 것으로 남는다', async () => {
  const { db, id } = setup();
  let called = 0;
  const p = stub({ async identify() { called++; return { usage, data: { identities: [], missing: [], summary: '' } }; } });
  A.ensureAiJobs(db, p);
  D.activate(db, id, { name: '직접 확인한 이름' }, 'op');
  await A.createAiWorker(db, p, '/tmp').step();
  assert.equal(called, 0);
  assert.equal((db.prepare(`SELECT status FROM ai_jobs WHERE kind='identify'`).get() as any).status, 'cancelled');
});

test('보완 정보를 받으면 AI가 다시 식별한다', async () => {
  const { db, id, u } = setup({ photo: 'x.jpg' });
  const p = stub(); const w = A.createAiWorker(db, p, '/tmp');
  A.ensureAiJobs(db, p); await w.step();
  D.requestInfo(db, id, '태그 사진을 보내주세요', 'op');
  assert.equal(A.ensureAiJobs(db, p), 0, '보완 대기 중에는 식별하지 않는다');
  setClock(T0 + 1000);
  D.submitInfo(db, u.id, id, { text: '태그에 MYSTIC 이라고 써 있어요' });
  assert.equal(A.ensureAiJobs(db, p), 1);
});

test('서버가 꺼져 끊긴 작업은 다시 대기열로', () => {
  const { db } = setup();
  const p = stub();
  A.ensureAiJobs(db, p);
  db.prepare(`UPDATE ai_jobs SET status='running'`).run();
  assert.equal(A.recoverAiJobs(db), 1);
  assert.equal((db.prepare('SELECT status FROM ai_jobs').get() as any).status, 'queued');
});

test('모의 AI 결과는 모두 모의로 저장·표시된다', async () => {
  const { db, id } = setup();
  const p = mockProvider(); const w = A.createAiWorker(db, p, '/tmp');
  A.ensureAiJobs(db, p); await w.step();
  const it = db.prepare('SELECT * FROM ai_identities').get() as any;
  assert.equal(it.is_mock, 1); assert.equal((db.prepare('SELECT is_mock FROM ai_jobs').get() as any).is_mock, 1);
  A.acceptIdentity(db, it.id, {}, 'op');
  A.ensureAiJobs(db, p); await w.step();
  const f = db.prepare('SELECT * FROM ai_finds').get() as any;
  assert.equal(f.is_mock, 1); assert.equal(f.url, null);
  const cid = A.acceptFind(db, f.id, { matchGrade: 'same_likely', availability: 'listed_unverified' }, 'op');
  assert.equal((db.prepare('SELECT is_mock FROM candidates WHERE id=?').get(cid) as any).is_mock, 1);
  assert.ok(acts(db, id).filter(a => a.actor === 'walf').every(a => a.is_mock === 1));
  assert.ok(acts(db, id).find(a => a.kind === 'activated').is_mock, '모의 제안으로 시작한 기록도 모의 표시');
});
