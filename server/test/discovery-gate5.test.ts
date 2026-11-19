// Discovery Upgrade Gate 5 — 찾아줘 결과 세 갈래(정확히 찾음 · 유력 후보 · 못 찾음) · 맡긴 원본 · 파악한 것 · 계속 찾기(기다려줘)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as F from '../src/find.ts';
import * as W from '../src/watch.ts';
import { loadBrandSeed } from '../src/catalog.ts';
import { mockProvider } from '../src/ai.ts';
import { setClock, DAY } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 20, 1, 0);
const policy: W.WatchPolicy = { maxActive: 3, checkEveryMs: DAY, renewAfterMs: 30 * DAY, unreachableAfter: 3, maxAttempts: 3, leaseMs: 120_000, mockAllowed: true };
const SEED = [{ name: 'Brand Minimal', tags: [{ kind: 'mood', value: 'minimal' }, { kind: 'material', value: 'wool' }, { kind: 'category', value: 'jacket' }] }];

async function setup(note: string) {
  setClock(T0);
  const db = openDb(':memory:');
  loadBrandSeed(db, SEED as any, 'fixture');
  const u = D.upsertUser(db, 'device-gate5-0001', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'orig.jpg', note, size: 'M', color: '네이비', productName: '네이비 나일론 트랙 자켓' } as any, { isMock: true });
  const p = mockProvider(); const w = A.createAiWorker(db, p, '/tmp');
  A.ensureAiJobs(db, p); await w.step();
  return { db, u, id };
}
const view = (db: any, id: number) => F.findView(db, D.getRequest(db, id), 'http://api.test');

test('[결과] 정확히 찾음: outcome=exact · 맡긴 원본(사진·적은 정보)은 판매처 사진과 따로 · 모르는 것 목록 없음', async () => {
  const { db, id } = await setup('[테스트:정확]');
  const d = F.findDraft(db, id);
  F.publishFind(db, id, { items: [{ aiIdentityId: d.identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  const v = view(db, id);
  assert.equal(v.outcome, 'exact');
  assert.equal(v.original.size, 'M'); assert.equal(v.original.color, '네이비');
  assert.match(v.original.photoUrl || '', /orig\.jpg/, '맡긴 사진은 서명 주소로');
  assert.deepEqual(v.understood.unknown, []);
  assert.equal(v.match!.image ?? null, null, '확인된 판매처 사진이 없으면 사용자 사진을 상품 사진처럼 쓰지 않는다');
});

test('[결과] 유력 후보만: outcome=likely · 확인 못 한 점을 함께 · 같은 옷이라고 말하지 않는다', async () => {
  const { db, id } = await setup('[테스트:유력]');
  const d = F.findDraft(db, id);
  F.publishFind(db, id, { items: d.identities.map(x => ({ aiIdentityId: x.id, tier: 'likely' as const })), discover: [] }, '운영자');
  const v = view(db, id);
  assert.equal(v.outcome, 'likely');
  assert.equal(v.match, null);
  assert.ok(v.likely.every(x => x.tier === 'likely'));
  assert.ok(v.likely.some(x => x.uncertain.length), '확인 못 한 점');
});

test('[결과] 못 찾음: outcome=not_found · 만들어 낸 브랜드·모델 없이 사진에서 읽은 것과 모르는 것만', async () => {
  const { db, id } = await setup('[테스트:유사]');
  const d = F.findDraft(db, id);
  assert.ok(d.discover.length, '비슷한 스타일의 브랜드 후보');
  F.publishFind(db, id, { items: [], discover: d.discover.slice(0, 1).map(c => ({ brandKey: c.brandKey, scope: c.scope })) }, '운영자');
  const v = view(db, id);
  assert.equal(v.outcome, 'not_found');
  assert.equal(v.match, null); assert.equal(v.likely.length, 0, '식별 후보를 보여 주지 않는다');
  assert.ok(v.understood.known.length > 0, '사진에서 읽은 특징');
  assert.deepEqual(v.understood.unknown, ['브랜드', '모델명·품번', '시즌']);
});

test('[계속 찾기] 확정하지 못한 의뢰에서 기다려줘를 남기면 맡긴 사진·의뢰가 이어지고, 상품 링크 없이 왈프 팀이 찾는다', async () => {
  const { db, u, id } = await setup('[테스트:유사]');
  const wid = W.createWatch(db, u.id, { productName: '네이비 나일론 트랙 자켓', size: 'M', color: '네이비', targetPrice: '150000', requestId: id }, policy);
  const w = db.prepare('SELECT * FROM watches WHERE id=?').get(wid) as any;
  assert.equal(w.request_id, id); assert.equal(w.photo, 'orig.jpg', '맡긴 사진을 이어받는다');
  assert.equal(w.status, 'needs_info'); assert.match(w.info_note, /왈프 팀이 상품 페이지를 찾고 있어요/);
});
