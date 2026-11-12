import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as F from '../src/find.ts';
import { curate, loadBrandSeed, normSize, sameColor, colorsIn } from '../src/catalog.ts';
import { mockProvider, cleanIdentify } from '../src/ai.ts';
import { setClock } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 13, 1, 0);
const SEED = [
  { name: 'Brand Minimal', tags: [{ kind: 'mood', value: 'minimal' }, { kind: 'material', value: 'wool' }, { kind: 'category', value: 'jacket' }] },
  { name: 'Brand Work', tags: [{ kind: 'mood', value: 'workwear' }, { kind: 'detail', value: 'zip' }] },
  { name: 'Brand Tech', tags: [{ kind: 'mood', value: 'techwear' }, { kind: 'material', value: 'nylon' }] },
];

async function setup(note: string) {
  setClock(T0);
  const db = openDb(':memory:');
  loadBrandSeed(db, SEED as any, 'fixture');
  const u = D.upsertUser(db, 'device-find-0001', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'x.jpg', note, size: 'M' }, { isMock: true });
  const p = mockProvider(); const w = A.createAiWorker(db, p, '/tmp');
  A.ensureAiJobs(db, p); await w.step();
  return { db, u, id };
}

test('등급은 서버 규칙으로: 근거 주소 없는 “높음”은 MATCH가 아니라 LIKELY, 낮음은 숨김', () => {
  assert.equal(F.tierOf({ confidence: 'high', brand: 'B', name: 'N', refs: ['https://b.com/p'], uncertain: ['시즌: 모름'] }), 'match');
  assert.equal(F.tierOf({ confidence: 'high', brand: 'B', name: 'N', refs: [] }), 'likely');
  assert.equal(F.tierOf({ confidence: 'high', brand: 'B', name: 'N', refs: ['https://b.com/p'], uncertain: ['모델: 비슷한 다른 상품일 수 있어요'] }), 'likely', '모델이 불확실하면 MATCH 아님');
  assert.equal(F.tierOf({ confidence: 'low', brand: 'B', name: 'N', refs: ['https://b.com/p'] }), 'hidden');
});

test('AI가 본 적 없는 근거 주소는 빼고, 뺐다는 사실을 남긴다', () => {
  const r = cleanIdentify({ identities: [{ brand: 'B', name: 'N', confidence: 'high', refs: ['https://b.com/p', 'https://made.up/x'], matched: [], uncertain: [] }] }, new Set(['b.com/p']));
  assert.deepEqual(r.identities[0].refs, ['https://b.com/p']);
  assert.match(r.identities[0].uncertain.at(-1)!, /근거 주소: 1개/);
});

test('MATCH: 운영자가 공개하기 전에는 사용자에게 보이지 않고, 공개하면 “같은 옷을 찾았어요” → 확인하면 상품 저장 + 7일 시작', async () => {
  const { db, u, id } = await setup('[테스트:정확]');
  assert.equal(D.display(db, D.getRequest(db, id)).key, 'identification_pending', '검수 전에는 결과를 보여 주지 않는다');
  assert.equal(F.findView(db, D.getRequest(db, id)).state, 'pending');
  const draft = F.findDraft(db, id);
  assert.equal(draft.identities[0].tier, 'match');
  assert.equal(draft.discover.length, 0, 'MATCH가 있으면 비슷한 옷을 고르지 않는다');
  F.publishFind(db, id, { items: [{ aiIdentityId: draft.identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  assert.equal(D.display(db, D.getRequest(db, id)).key, 'find_match');
  const v = F.findView(db, D.getRequest(db, id));
  assert.equal(v.match!.modelCode, 'W-JKT26-055');
  assert.ok(v.match!.uncertain.some(x => x.label === '시즌'), '확인 못 한 속성을 함께 보여 준다');
  assert.equal(v.isMock, true);
  const { productId } = F.confirmFind(db, u.id, id, v.match!.id, 'hunt');
  const r = D.getRequest(db, id);
  assert.equal(r.status, 'active');
  assert.equal(r.product_id, productId);
  assert.equal((db.prepare('SELECT verified FROM products WHERE id=?').get(productId) as any).verified, 1, 'MATCH 는 확인된 상품');
  assert.ok(db.prepare(`SELECT 1 FROM notifications WHERE kind='find_ready' AND push_status='skipped_mock'`).get());
});

test('LIKELY: 확인 못 한 부분을 보여 주고, 사용자가 골라도 “확인된 상품”으로 저장하지 않는다 · 아니라고 하면 7일 없이 팀이 다시 본다', async () => {
  const { db, u, id } = await setup('[테스트:유력]');
  const draft = F.findDraft(db, id);
  assert.deepEqual(draft.identities.map(x => x.tier), ['likely', 'likely']);
  assert.throws(() => F.publishFind(db, id, { items: [{ aiIdentityId: draft.identities[0].id, tier: 'match' }], discover: [] }, '운영자'), (e: any) => e.code === 'match_needs_evidence');
  F.publishFind(db, id, { items: draft.identities.map(x => ({ aiIdentityId: x.id, tier: 'likely' as const })), discover: [] }, '운영자');
  assert.equal(D.display(db, D.getRequest(db, id)).key, 'find_likely');
  const v = F.findView(db, D.getRequest(db, id));
  assert.equal(v.likely.length, 2);
  F.rejectFind(db, u.id, id, '소매가 달라요');
  assert.equal(D.getRequest(db, id).status, 'submitted');
  assert.equal(F.rejectedQueue(db).length, 1, '어드민 대기열에 다시 올라온다');
  // 다시 공개 → 사용자 확인(저장만)
  F.publishFind(db, id, { items: [{ aiIdentityId: draft.identities[1].id, tier: 'likely' }], discover: [] }, '운영자');
  assert.equal(F.rejectedQueue(db).length, 0);
  const v2 = F.findView(db, D.getRequest(db, id));
  const { productId } = F.confirmFind(db, u.id, id, v2.likely[0].id, 'watch');
  assert.equal(D.getRequest(db, id).status, 'submitted', '기다려줘로 가면 7일은 시작하지 않는다');
  assert.equal((db.prepare('SELECT verified FROM products WHERE id=?').get(productId) as any).verified, 0);
});

test('DISCOVER: 같은 옷을 못 찾으면 스타일이 2가지 이상 겹치는 브랜드만 고르고, “같은 상품 아님”으로 공개한다', async () => {
  const { db, id } = await setup('[테스트:유사]');
  const draft = F.findDraft(db, id);
  assert.deepEqual(draft.identities.map(x => x.tier), ['hidden']);
  assert.deepEqual(draft.discover.map(c => c.brand), ['Brand Minimal', 'Brand Work'], 'Brand Tech 는 겹치는 게 없어 제외');
  assert.ok(draft.discover[0].score > draft.discover[1].score);
  F.publishFind(db, id, { items: [], discover: draft.discover.map(c => ({ brandKey: c.brandKey, scope: c.scope })) }, '운영자');
  const v = F.findView(db, D.getRequest(db, id));
  assert.equal(v.match, null);
  assert.equal(v.discover.length, 2);
  assert.ok(v.discover[0].matched.length >= 2);
  assert.equal(D.display(db, D.getRequest(db, id)).key, 'find_discover');
  assert.throws(() => F.confirmFind(db, 1, id, v.discover[0].id, 'save'), (e: any) => e.code === 'bad_identity', '비슷한 옷은 “이 옷이 맞아요” 대상이 아니다');
});

test('스타일 매핑: 검수 상태로 거를 수 있고, 출처 없는 seed 는 넣지 않는다', () => {
  setClock(T0);
  const db = openDb(':memory:');
  assert.equal(loadBrandSeed(db, [{ name: 'No Source', tags: [{ kind: 'mood', value: 'minimal' }] }]), 0);
  loadBrandSeed(db, [{ name: 'Sourced', tags: [{ kind: 'mood', value: 'minimal', source_url: 'https://e.com' }, { kind: 'material', value: 'wool', source_url: 'https://e.com' }] }]);
  assert.equal(curate(db, { mood: ['minimal'], material: ['wool'] }, { statuses: ['verified'] }).length, 0);
  assert.equal(curate(db, { mood: ['minimal'], material: ['wool'] }).length, 1);
});

test('사이즈·색상 정규화', () => {
  assert.equal(normSize('m'), 'M'); assert.equal(normSize('95'), 'M'); assert.equal(normSize('M(95)'), 'M'); assert.equal(normSize('Free'), 'FREE');
  assert.deepEqual(colorsIn('블루그레이'), ['blue', 'gray']);
  assert.equal(sameColor('네이비', 'NAVY'), true);
  assert.equal(sameColor('네이비', '블루그레이'), false, '두 색이 붙은 이름은 다른 색');
  assert.equal(sameColor('', '블랙'), true, '색을 정하지 않았으면 상관없음');
});
