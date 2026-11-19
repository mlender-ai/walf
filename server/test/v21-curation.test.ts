// V2.1 Gate B — 대체 상품 큐레이션(디자인·실루엣 우선) · 운영자 검수 · 사용자 공개(검수한 것만)를 확인한다.
// 대체 상품은 테스트 큐레이터(가상의 상품·직접 그린 그림)만 쓴다. 실제 판매 상품·실제 추천 엔진이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as F from '../src/find.ts';
import * as S from '../src/findsearch.ts';
import * as R from '../src/offerreview.ts';
import { loadBrandSeed } from '../src/catalog.ts';
import { mockProvider } from '../src/ai.ts';
import { setClock } from '../src/time.ts';
import { offersOf } from '../src/offers.ts';
import { FIXTURE_CURATOR, curateOffers, designMatch } from '../src/curation.ts';
import { SEARCH_SOURCES } from '../src/searchsources.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 19, 1, 0);
const MALLS = [{ brand: 'BADBLOOD', aliases: ['배드블러드'], domain: 'badblood.co.kr', platform: 'cafe24' as const, checked: '2026-11-09', basis: 'test' }];
const env = (over: Partial<S.SearchEnv> = {}): S.SearchEnv => ({ sources: SEARCH_SOURCES, mockAllowed: true, env: {}, malls: MALLS, pace: async () => {}, maxDetails: 6, reuseMs: 20 * 3600_000, ...over });
const WOOL = { mood: ['minimal', 'workwear'], material: ['wool'], silhouette: ['boxy'], detail: ['zip'], category: ['jacket', 'outerwear'], color: ['brown'] };
const TRACK = { mood: ['sportswear', 'street'], material: ['nylon'], detail: ['zip'], category: ['jacket', 'outerwear'], color: ['navy'] };

async function setup(note: string, opts: { mock?: boolean; device?: string } = {}) {
  setClock(T0);
  const db = openDb(':memory:');
  loadBrandSeed(db, [{ name: 'BADBLOOD', ko: ['배드블러드'], tags: [] }] as any, 'fixture');
  const u = D.upsertUser(db, opts.device || 'device-v21b-0001', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'x.jpg', note, size: 'M' }, { isMock: opts.mock ?? true });
  const p = mockProvider(); A.ensureAiJobs(db, p); await A.createAiWorker(db, p, '/tmp').step();
  return { db, u, id };
}
const runAll = async (db: any, e: S.SearchEnv) => { const w = S.createOfferSearcher(db, e); while (await w.step()) {} };

// ── 정렬 규칙 ──
test('[큐레이션] 디자인 점수는 제품군·실루엣이 가장 무겁고 브랜드는 넣지 않는다 — 무드만 닮은 옷·제품군이 다른 옷은 고르지 않는다', async () => {
  const m = designMatch(WOOL, { silhouette: ['boxy'], category: ['jacket'], material: ['cotton'] });
  assert.equal(m.score, Math.round((3 + 3) / 12 * 100) / 100);
  assert.deepEqual(m.similar, ['실루엣 박시'], '제품군은 같아야 고르므로 비슷한 점에 따로 적지 않는다');
  assert.ok(m.diff.includes('소재가 달라요 — 코튼(찾는 옷은 울)'));
  assert.equal(designMatch(WOOL, { category: ['knitwear'], material: ['wool'] }).categoryOk, false);
  // 같은 브랜드(무드만 비슷) vs 다른 브랜드(실루엣·소재·디테일이 같음)
  const raw = [
    { url: 'mock://shop/a', seller: 's', brand: 'TEST MINIMAL', name: '같은 무드 코트', style: { mood: ['minimal', 'workwear'], category: ['outerwear'], silhouette: ['relaxed'] }, price: 100000, recommender: 'r', recommenderVersion: '1' },
    { url: 'mock://shop/b', seller: 's', brand: 'TEST OTHER', name: '박시 울 집업', style: { silhouette: ['boxy'], material: ['wool'], detail: ['zip'], category: ['jacket'] }, price: 300000, recommender: 'r', recommenderVersion: '1' },
  ];
  const { offers, dropped } = curateOffers(raw, { style: WOOL, brand: 'TEST MINIMAL', name: '울 블루종', modelCode: null, size: 'M', limit: 6, mockAllowed: true });
  assert.deepEqual(offers.map(o => o.url), ['mock://shop/b'], '브랜드·무드가 닮았다는 이유만으로 고르지 않는다');
  assert.equal(dropped.low, 1);
});

test('[큐레이션] 테스트 큐레이터 후보를 WALF 규칙으로 다시 정렬: 울 박시 집업 → 박시 워크 자켓 순 · 니트(제품군 다름)·무드만 닮은 코트·찾는 옷과 같은 상품은 뺀다', async () => {
  const raw = await FIXTURE_CURATOR.find({ style: WOOL, brand: null, name: null, modelCode: null, size: 'M', limit: 12 });
  const { offers, dropped } = curateOffers(raw, { style: WOOL, brand: null, name: null, modelCode: null, size: 'M', limit: 6, mockAllowed: true });
  assert.deepEqual(offers.slice(0, 2).map(o => o.name), ['울 집업 블루종 브라운', '코튼 캔버스 워크 자켓 브라운']);
  assert.ok(offers.findIndex(o => o.name === '울 셔켓 차콜') > 1, '같은 울·미니멀이어도 실루엣이 다르면 뒤로');
  assert.ok(!offers.some(o => /가디건|트렌치/.test(o.name!)));
  assert.equal(offers[1].wantSize, 'sold_out'); assert.ok(offers[1].diffPoints.includes('M 사이즈는 품절이에요'));
  assert.ok(offers.every(o => o.relation === 'similar' && o.verdict === 'unverified' && o.recommender === 'walf-fixture-curator' && o.recommenderVersion === 'fixture-1' && o.style));
  assert.ok(offers[0].similarPoints.includes('실루엣 박시'));
  const track = curateOffers(await FIXTURE_CURATOR.find({ style: TRACK, brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', modelCode: 'W-JKT26-055', size: 'M', limit: 12 }),
    { style: TRACK, brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', modelCode: 'W-JKT26-055', size: 'M', limit: 6, mockAllowed: true });
  assert.equal(track.dropped.same, 1, '찾는 옷과 같은 상품은 대체 상품에서 뺀다(판매처 탐색 쪽)');
  assert.equal(track.offers[0].name, '나일론 트랙 자켓 블랙');
  assert.equal(dropped.category, 0); assert.ok(!raw.some((x: any) => /가디건/.test(x.name)), '추천 엔진도 같은 제품군만 돌려준다(니트 가디건 없음)');
});

// ── 대체 상품 탐색 ──
test('[대체 상품] 상품을 식별하지 못해도 사진에서 읽은 디자인으로 고른다 · 실제 의뢰에는 테스트 큐레이터를 쓰지 않는다', async () => {
  const { db, id } = await setup('[테스트:유사]');
  const q = S.queueSimilarSearch(db, env(), id);
  assert.ok(q.id && !q.skipped);
  await runAll(db, env());
  const s = db.prepare('SELECT * FROM offer_searches WHERE id=?').get(q.id) as any;
  assert.equal(s.purpose, 'similar'); assert.equal(s.target_basis, 'style_only'); assert.equal(s.is_mock, 1);
  assert.match(s.summary, /비슷한 디자인 \d+개\(정렬 walf-design-rank-1\)/);
  const offers = offersOf(db, q.id!);
  assert.equal(offers[0].name, '울 집업 블루종 브라운');
  assert.equal(S.queueSimilarSearch(db, env(), id).skipped, '같은 조건의 추천이 이미 있어요');

  const real = await setup('[테스트:유사]', { mock: false, device: 'device-v21b-0002' });
  real.db.prepare('UPDATE ai_jobs SET is_mock=0').run(); real.db.prepare('UPDATE requests SET is_mock=0').run();
  assert.match(S.queueSimilarSearch(real.db, env(), real.id).skipped!, /쓸 수 있는 추천 엔진이 없어요/);
});

// ── 검수 · 공개 ──
test('[검수] 같은 상품 확인은 품번 일치일 때만 근거 없이 · 대체 상품은 “비슷한 디자인”으로만 · 제외는 사유 필수 · 검수 전에는 아무것도 보이지 않는다', async () => {
  const { db, u, id } = await setup('[테스트:정확]');
  S.queueFindSearch(db, env(), id); S.queueSimilarSearch(db, env(), id);
  await runAll(db, env());
  const same = offersOf(db, S.latestSearches(db, id, 1)[0].id), sim = offersOf(db, S.latestSearches(db, id, 1, 'similar')[0].id);
  const by = (u: string) => same.find(o => o.url === u)!;
  assert.throws(() => R.reviewOffer(db, by('mock://shop/select-mystic-navy').id, 'exact', {}, '운영자'), /직접 확인한 근거/);
  assert.throws(() => R.reviewOffer(db, sim[0].id, 'exact', {}, '운영자'), /비슷한 디자인/);
  assert.throws(() => R.reviewOffer(db, by('mock://shop/used-055').id, 'alternative', {}, '운영자'), /대체 상품으로 공개하지 않아요/);
  assert.throws(() => R.reviewOffer(db, by('mock://shop/other-brand').id, 'possible', {}, '운영자'), /다른 상품/);
  assert.throws(() => R.reviewOffer(db, by('mock://shop/other-brand').id, 'reject', {}, '운영자'), /제외 사유/);
  const x = R.reviewOffer(db, by('mock://shop/official-055-navy').id, 'exact', {}, '운영자');
  assert.deepEqual([x.reviewState, x.publishTier, x.published], ['approved', 'exact', false], '찾아줘 결과를 공개하기 전에는 공개 대기');
  R.reviewOffer(db, by('mock://shop/select-mystic-navy').id, 'exact', { reason: '로고 자수·소매 절개선·지퍼 위치가 공식몰 사진과 같음' }, '운영자');
  R.reviewOffer(db, by('mock://shop/slow-shop').id, 'possible', {}, '운영자');
  R.reviewOffer(db, by('mock://shop/other-brand').id, 'reject', { reason: '다른 상품' }, '운영자');
  R.reviewOffer(db, sim[0].id, 'alternative', {}, '운영자');
  let v = F.findView(db, D.getRequest(db, id), 'http://h');
  assert.equal(v.state, 'pending'); assert.equal(v.sale.exact.length, 0); assert.equal(v.alternatives.items.length, 0);
  assert.equal(v.sale.state, 'reviewing', '검수 중이라는 사실만 — 후보 개수·내용은 보이지 않는다');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);

  // 찾아줘 결과 공개 → 검수해 둔 판매처·대체 상품이 함께 공개 · 알림은 한 번
  const d = F.findDraft(db, id);
  F.publishFind(db, id, { items: [{ aiIdentityId: d.identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  v = F.findView(db, D.getRequest(db, id), 'http://h');
  assert.equal(v.sale.state, 'ready');
  assert.deepEqual(v.sale.exact.map(c => c.seller), ['테스트 공식몰', '테스트 편집숍']);
  assert.deepEqual(v.sale.possible.map(c => c.seller), ['테스트 편집숍2']);
  assert.equal(v.alternatives.items.length, 1);
  const c0 = v.sale.exact[0];
  assert.deepEqual([c0.imageUrl, c0.url, c0.sizeLabel, c0.total], ['http://h/api/mock-image/track-jacket-navy.svg', null, 'M 재고 있음', 173100]);
  assert.match(c0.basisLabel, /판매 페이지 기준 · 가격·재고는 바뀔 수 있어요/);
  assert.equal(v.sale.exact[1].teamNote, '로고 자수·소매 절개선·지퍼 위치가 공식몰 사진과 같음', '운영자가 확인한 근거를 함께 보여 준다');
  assert.ok(!/구매 가능/.test(JSON.stringify(v)), '“구매 가능”이라고 말하지 않는다');
  assert.ok(!JSON.stringify(v).includes('other-brand'), '제외한 후보는 보이지 않는다');
  const notis = db.prepare('SELECT * FROM notifications WHERE user_id=?').all(u.id) as any[];
  assert.equal(notis.length, 1); assert.match(notis[0].body, /같은 상품을 파는 곳도 확인했어요/);

  // 공개된 뒤 검수한 대체 상품은 바로 공개 · 같은 날 같은 종류 알림은 한 번
  R.reviewOffer(db, sim[1].id, 'alternative', {}, '운영자');
  R.reviewOffer(db, sim[2].id, 'alternative', {}, '운영자');
  assert.equal(F.findView(db, D.getRequest(db, id), 'http://h').alternatives.items.length, 3);
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM notifications WHERE kind='find_alternatives'`).get() as any).n, 1);
  // 내리기
  R.reviewOffer(db, sim[2].id, 'hide', {}, '운영자');
  assert.equal(F.findView(db, D.getRequest(db, id), 'http://h').alternatives.items.length, 2);

  // 다시 탐색해도 검수는 이어지고(최신 가격 줄로), 같은 페이지가 두 번 보이지 않는다
  S.queueFindSearch(db, env(), id, { by: '운영자', force: true });
  await runAll(db, env());
  v = F.findView(db, D.getRequest(db, id), 'http://h');
  assert.deepEqual(v.sale.exact.map(c => c.seller), ['테스트 공식몰', '테스트 편집숍']);
  const latest = offersOf(db, S.latestSearches(db, id, 1)[0].id);
  assert.ok(latest.find(o => o.url === 'mock://shop/official-055-navy')!.published, '새 탐색 줄이 공개를 이어받는다');
  assert.equal(latest.find(o => o.url === 'mock://shop/other-brand')!.reviewState, 'rejected', '제외도 이어받는다');
});

test('[공개] 같은 옷을 못 찾은 의뢰: 검수한 대체 상품만으로도 공개할 수 있고, 홈 카드는 “비슷한 디자인의 옷” · 판매처 탐색은 대상이 없어 시작 안 함', async () => {
  const { db, id } = await setup('[테스트:유사]');
  S.queueSimilarSearch(db, env(), id);
  await runAll(db, env());
  const sim = offersOf(db, S.latestSearches(db, id, 1, 'similar')[0].id);
  R.reviewOffer(db, sim[0].id, 'alternative', {}, '운영자');
  R.reviewOffer(db, sim[1].id, 'alternative', {}, '운영자');
  F.publishFind(db, id, { items: [{ aiIdentityId: F.findDraft(db, id).identities[0].id, tier: 'skip' }], discover: [] }, '운영자');
  const disp = D.display(db, D.getRequest(db, id));
  assert.equal(disp.key, 'find_discover'); assert.match(disp.desc, /비슷한 디자인의 옷/); assert.equal(disp.action!.label, '비슷한 옷 보기');
  const v = F.findView(db, D.getRequest(db, id), 'http://h');
  assert.equal(v.state, 'ready'); assert.equal(v.match, null);
  assert.ok(v.publishedLabel && v.isMock, '식별 결과 없이 대체 상품만 공개해도 공개 시각·모의 표시가 있다');
  assert.equal(v.sale.state, 'not_started');
  assert.deepEqual(v.alternatives.items.map(c => c.name), ['울 집업 블루종 브라운', '코튼 캔버스 워크 자켓 브라운']);
  assert.ok(v.alternatives.items[0].similarPoints.length >= 3 && v.alternatives.items[1].diffPoints.length >= 1, '비슷한 점·다른 점');
  assert.deepEqual(v.similarProducts.items.map((c: any) => c.id), v.alternatives.items.map(c => c.id));
  assert.equal(v.similarProducts.status, 'PENDING_INTEGRATION', '실제 추천 엔진(패션 브레인)은 아직 연결 전');
  const n = db.prepare(`SELECT * FROM notifications`).all() as any[];
  assert.equal(n.length, 1); assert.equal(n[0].title, '비슷한 디자인의 옷을 골라 봤어요');
});
