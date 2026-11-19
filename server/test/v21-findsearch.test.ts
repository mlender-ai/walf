// V2.1 Gate A — 찾아줘 판매처 탐색 파이프라인(1 식별 → 2 검색 조건 → 3 소스 검색 → 4 통합 → 5 정리 → 6 검증 → 7 결과)을 단계마다 따로 확인한다.
// 네트워크는 열지 않는다(가짜 fetcher · 테스트 판매처 Fixture). 실제 판매 가격이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as F from '../src/find.ts';
import * as S from '../src/findsearch.ts';
import { loadBrandSeed } from '../src/catalog.ts';
import { mockProvider } from '../src/ai.ts';
import { setClock } from '../src/time.ts';
import { cleanOffer, offersOf } from '../src/offers.ts';
import { clearRobotsCache, SourceError } from '../src/sources.ts';
import { SEARCH_SOURCES, mockSource, naverSource, officialLinks, officialSource, type RawHit, type SearchSource, type SourceCtx } from '../src/searchsources.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 16, 1, 0);
const MALLS = [{ brand: 'BADBLOOD', aliases: ['배드블러드'], domain: 'badblood.co.kr', platform: 'cafe24' as const, checked: '2026-11-09', basis: 'test' }];
const noPace = async () => {};
const ctx = (over: Partial<SourceCtx> = {}): SourceCtx => ({ isMock: true, mockAllowed: true, env: {}, malls: MALLS, pace: noPace, ...over });
const env = (over: Partial<S.SearchEnv> = {}): S.SearchEnv => ({ sources: SEARCH_SOURCES, mockAllowed: true, env: {}, malls: MALLS, pace: noPace, maxDetails: 6, reuseMs: 20 * 3600_000, ...over });
const TARGET: S.SearchTarget = { brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', modelCode: 'W-JKT26-055', season: null, color: 'Navy', category: '아우터', basis: 'operator_published', ref: 't', aliases: ['배드블러드'], isMock: true };
const WANT: S.Want = { size: 'M', color: null, usedOk: true, maxPrice: null };

async function setup(note: string, opts: { size?: string; mock?: boolean } = {}) {
  setClock(T0);
  const db = openDb(':memory:');
  loadBrandSeed(db, [{ name: 'BADBLOOD', ko: ['배드블러드'], tags: [] }] as any, 'fixture');
  const u = D.upsertUser(db, 'device-v21-0001', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'x.jpg', note, size: opts.size ?? 'M' }, { isMock: opts.mock ?? true });
  const p = mockProvider(); const w = A.createAiWorker(db, p, '/tmp');
  A.ensureAiJobs(db, p); await w.step();
  return { db, u, id };
}

// ── 1 · 식별 결과 → 탐색 대상 ──
test('[1 식별] AI 제안 → 운영자 공개 → 사용자 확인 순으로 근거가 강한 식별 결과가 탐색 대상이 된다(숨김 후보 제외)', async () => {
  const { db, u, id } = await setup('[테스트:정확]');
  let t = S.targetsOf(db, id, MALLS);
  assert.equal(t[0].basis, 'ai_draft');
  assert.deepEqual([t[0].brand, t[0].name, t[0].modelCode, t[0].isMock], ['BADBLOOD', 'Mystic Nylon Track Jacket', 'W-JKT26-055', true]);
  assert.deepEqual(t[0].aliases, ['배드블러드'], '브랜드 한글 이름은 브랜드 표·공식몰 목록에서');
  const d = F.findDraft(db, id);
  F.publishFind(db, id, { items: [{ aiIdentityId: d.identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  t = S.targetsOf(db, id, MALLS);
  assert.equal(t[0].basis, 'operator_published');
  assert.equal(t.length, 1, '같은 상품은 한 번만(근거가 강한 쪽)');
  F.confirmFind(db, u.id, id, F.findView(db, D.getRequest(db, id)).match!.id, 'save');
  assert.equal(S.targetsOf(db, id, MALLS)[0].basis, 'user_confirmed');

  const low = await setup('[테스트:유사]');
  assert.equal(S.targetsOf(low.db, low.id).length, 0, '신뢰도 낮음(숨김) 후보로는 판매처를 찾지 않는다');
});

// ── 2 · 검색 조건 ──
test('[2 검색 조건] 품번 → 브랜드+품번 → 브랜드+모델명 → 모델명 → 한글 브랜드+모델명, 같은 검색어는 한 번만', () => {
  const q = S.buildQueries(TARGET);
  assert.deepEqual(q.map(x => x.kind), ['code', 'brand_code', 'brand_name', 'name', 'alias_name']);
  assert.deepEqual(q.map(x => x.text), ['W-JKT26-055', 'BADBLOOD W-JKT26-055', 'BADBLOOD Mystic Nylon Track Jacket', 'Mystic Nylon Track Jacket', '배드블러드 Mystic Nylon Track Jacket']);
  const noCode = S.buildQueries({ ...TARGET, modelCode: null, aliases: [], brand: null, name: '울 집업 자켓' });
  assert.deepEqual(noCode.map(x => x.kind), ['name'], '품번·브랜드가 없으면 모델명만');
  assert.equal(S.buildQueries({ ...TARGET, modelCode: null, aliases: [], name: 'Jacket' }).length, 1, '핵심 단어가 하나뿐인 이름은 따로 검색하지 않는다');
});

// ── 3 · 소스 검색 ──
const fake = (id: string, fn: SearchSource['search'], usable = true): SearchSource => ({ id, label: id, kind: 'any', cost: 'free',
  availability: () => ({ status: 'SUPPORTED', usable, reason: usable ? 'ok' : '연동 대기' }), pick: qs => qs.slice(0, 2), search: fn });
const hit = (source: string, url: string, title: string, query = 'q', rank = 1): RawHit => ({ source, seller: source, url, title, brand: null, price: 100000, imageUrl: null, condition: 'new', query, rank, isMock: true });

test('[3 소스 검색] 소스마다 따로 돈다: 실패해도 다른 소스는 계속, 막힌 곳은 다시 두드리지 않고, 쓸 수 없는 곳은 “검색하지 않음”으로 남긴다', async () => {
  let blockedCalls = 0;
  const { hits, report } = await S.searchSources([
    fake('ok', async q => [hit('ok', 'https://a.example/p/1', `A ${q.text}`, q.text)]),
    fake('robots', async () => { blockedCalls++; throw new SourceError('robots', 'robots.txt가 막고 있어요'); }),
    fake('flaky', async q => { if (q.kind === 'code') throw new SourceError('timeout', '늦음'); return []; }),
    fake('pending', async () => { throw new Error('부르면 안 됨'); }, false),
  ], TARGET, S.buildQueries(TARGET), ctx());
  const by = Object.fromEntries(report.map(r => [r.id, r]));
  assert.equal(hits.length, 2);
  assert.equal(by.ok.outcome, 'ok');
  assert.equal(by.robots.outcome, 'blocked'); assert.equal(blockedCalls, 1, '막히면 다른 검색어로 다시 열지 않는다');
  assert.equal(by.flaky.outcome, 'empty', '검색어 하나가 실패해도 다른 검색어는 했다');
  assert.equal(by.flaky.errors.length, 1);
  assert.equal(by.pending.outcome, 'not_run'); assert.equal(by.pending.reason, '연동 대기'); assert.equal(by.pending.hits, 0);
});

test('[3 소스 검색] 모의 의뢰는 테스트 판매처만, 실제 의뢰는 실제 판매처만 — 공식몰은 등록된 브랜드만, 종료된 네이버 쇼핑 API·약관 금지 판매처는 열지 않는다', () => {
  const real = { ...TARGET, isMock: false };
  const av = (s: SearchSource, t: S.SearchTarget, c: SourceCtx) => s.availability(t, c);
  assert.equal(av(mockSource, TARGET, ctx()).usable, true);
  assert.equal(av(mockSource, real, ctx({ isMock: false })).usable, false);
  assert.equal(av(officialSource, TARGET, ctx()).usable, false, '모의 의뢰에 실제 공식몰을 열지 않는다');
  assert.equal(av(officialSource, real, ctx({ isMock: false })).usable, true);
  assert.match(av(officialSource, { ...real, brand: 'LEMAIRE' }, ctx({ isMock: false })).reason, /공식몰\(카페24\)이 등록되어 있지 않아요/);
  assert.equal(av(naverSource, real, ctx({ isMock: false })).status, 'UNSUPPORTED');
  assert.equal(av(naverSource, real, ctx({ isMock: false, env: { WALF_NAVER_CLIENT_ID: 'x', WALF_NAVER_CLIENT_SECRET: 'y' } })).usable, false, '키가 있어도 종료된 API는 열지 않는다');
  assert.match(av(naverSource, real, ctx({ isMock: false })).reason, /2026-07-31 종료/);
  for (const id of ['ai_web', 'bunjang', 'musinsa', 'soldout', 'wconcept', 'kream', 'joongna', 'fruitsfamily', '29cm']) {
    const s = SEARCH_SOURCES.find(x => x.id === id)!;
    assert.equal(av(s, real, ctx({ isMock: false })).usable, false, `${id}는 열지 않는다`);
  }
  assert.equal(SEARCH_SOURCES.find(x => x.id === 'ai_web')!.cost, 'paid');
});

test('[3 소스 검색] 공식몰: robots.txt 를 먼저 보고, 카페24 검색 결과에서 이 쇼핑몰의 상품 페이지 주소만 고른다', async () => {
  clearRobotsCache();
  const html = `<a href="/product/w-jkt26-055-%EB%AF%B8%EC%8A%A4%ED%8B%B1-%EC%9E%90%EC%BC%93/14555/category/1/display/2/">x</a>
    <a href="/product/w-jkt26-055-%EB%AF%B8%EC%8A%A4%ED%8B%B1-%EC%9E%90%EC%BC%93/14555/">dup</a>
    <a href="https://evil.example/product/fake/1/">다른 사이트</a><a href="/product/detail.html?product_no=777&cate_no=1">상세</a><a href="/product/list.html?cate_no=1">목록</a>`;
  assert.deepEqual(officialLinks(html, 'https://badblood.co.kr'), [
    { url: 'https://badblood.co.kr/product/w-jkt26-055-%EB%AF%B8%EC%8A%A4%ED%8B%B1-%EC%9E%90%EC%BC%93/14555/', title: 'w jkt26 055 미스틱 자켓' },
    { url: 'https://badblood.co.kr/product/detail.html?product_no=777', title: '' },
  ], '같은 상품의 두 주소는 하나로 · 다른 사이트·목록 화면은 버린다');
  const opened: string[] = [];
  const fetcher = async (u: string) => { opened.push(new URL(u).pathname); return u.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /member/\n') : new Response(html); };
  const c = ctx({ isMock: false, fetcher: fetcher as any, resolve: async () => ['93.184.216.34'] });
  const got = await officialSource.search({ text: 'W-JKT26-055', kind: 'code' }, { ...TARGET, isMock: false }, c);
  assert.deepEqual(opened, ['/robots.txt', '/product/search.html']);
  assert.equal(got.length, 2); assert.equal(got[0].seller, 'BADBLOOD 공식몰'); assert.equal(got[0].isMock, false);
  clearRobotsCache();
  const blocked = ctx({ isMock: false, fetcher: (async (u: string) => new Response(u.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /product/search' : html)) as any, resolve: async () => ['93.184.216.34'] });
  await assert.rejects(officialSource.search({ text: 'x', kind: 'code' }, { ...TARGET, isMock: false }, blocked), (e: any) => e.code === 'robots');
  clearRobotsCache();
});

// ── 4 · 통합 ──
test('[4 통합] 여러 검색어·추적 쿼리로 나온 같은 페이지는 하나로, 품번이 같은 페이지는 같은 상품 묶음으로', () => {
  const m = S.mergeHits([
    hit('a', 'https://shop.example/p/1?utm_source=x', 'BADBLOOD Track Jacket W-JKT26-055', 'q1', 3),
    hit('a', 'https://www.shop.example/p/1/', 'BADBLOOD Track Jacket W-JKT26-055 Navy', 'q2', 1),
    hit('b', 'https://other.example/9', '배드블러드 트랙자켓 w-jkt26-055 중고', 'q1', 2),
    hit('b', 'https://other.example/10', 'Mystic Nylon Track Jacket', 'q1', 4),
  ]);
  assert.equal(m.length, 3);
  assert.deepEqual(m[0].queries, ['q1', 'q2']); assert.equal(m[0].rank, 1); assert.match(m[0].title, /Navy$/, '더 긴 제목을 남긴다');
  assert.equal(m[0].groupKey, m[1].groupKey, '판매처가 달라도 품번이 같으면 같은 묶음');
  assert.notEqual(m[2].groupKey, m[0].groupKey);
});

// ── 5 · 정리 ──
test('[5 정리] 같은 상품일 가능성이 큰 페이지부터 상세를 읽고(한도 안), 다른 상품·한도 밖·실패는 그렇게 표시한다', async () => {
  const c = ctx();
  const hits = [...await mockSource.search({ text: 'W-JKT26-055', kind: 'code' }, TARGET, c), ...await mockSource.search({ text: 'BADBLOOD Mystic Nylon Track Jacket', kind: 'brand_name' }, TARGET, c)];
  const merged = S.mergeHits(hits);
  const out = await S.normalizeHits(merged, TARGET, [mockSource], c, 3);
  const of = (id: string) => out.find(o => o.url === `mock://shop/${id}`)!;
  assert.equal(of('official-055-navy').detail, 'fetched');
  assert.deepEqual([of('official-055-navy').price, of('official-055-navy').salePrice, of('official-055-navy').shipping, of('official-055-navy').imageUrl], [189000, 170100, 3000, 'mock://image/track-jacket-navy.svg']);
  assert.equal(of('official-055-navy').options.length, 3);
  assert.equal(of('official-pants').detail, 'listed_only'); assert.match(of('official-pants').detailNote!, /다른 상품으로 보여/);
  assert.equal(out.filter(o => o.detail === 'fetched').length + out.filter(o => o.detail === 'failed').length <= 3, true, '상세는 한도(3)까지만');
  const all = await S.normalizeHits(merged, TARGET, [mockSource], c, 10);
  assert.equal(all.find(o => o.url === 'mock://shop/slow-shop')!.detail, 'failed');
  assert.match(all.find(o => o.url === 'mock://shop/slow-shop')!.detailNote!, /응답이 늦어/);
});

// ── 6 · 검증 ──
test('[6 검증] 품번 일치만 “같은 상품”, 다른 품번·다른 브랜드는 “다른 상품”, 표기가 달라 모르면 “확인 못 함” — 사진 비교는 하지 않았다고 적는다', async () => {
  const c = ctx();
  const merged = S.mergeHits([...await mockSource.search({ text: 'W-JKT26-055', kind: 'code' }, TARGET, c), ...await mockSource.search({ text: 'BADBLOOD Mystic Nylon Track Jacket', kind: 'brand_name' }, TARGET, c)]);
  const vs = (await S.normalizeHits(merged, TARGET, [mockSource], c, 10)).map(o => S.verifyOffer(TARGET, o, WANT));
  const v = (id: string) => vs.find(o => o.url === `mock://shop/${id}`)!;
  assert.equal(v('official-055-navy').verdict, 'same_code');
  assert.equal(v('used-055').verdict, 'same_code');
  assert.equal(v('select-mystic-navy').verdict, 'likely', '품번은 없지만 브랜드·모델명이 같음');
  assert.equal(v('official-054-bluegray').verdict, 'different', '같은 모델 다른 색 = 다른 품번');
  assert.equal(v('official-pants').verdict, 'different');
  assert.equal(v('other-brand').verdict, 'different');
  assert.equal(v('slow-shop').verdict, 'unverified');
  assert.equal(v('official-055-navy').wantSize, 'ok'); assert.equal(v('official-055-navy').stock, 'in_stock'); assert.equal(v('official-055-navy').wantColor, 'ok');
  assert.ok(vs.every(o => o.checks.some(k => k.field === 'image' && k.result === 'not_checked')), '사진 비교를 했다고 말하지 않는다');
  assert.ok(v('used-055').diffPoints.includes('중고 상품이에요'));
  assert.ok(S.verifyOffer(TARGET, v('used-055'), { ...WANT, usedOk: false }).diffPoints.includes('새 상품만 원했는데 중고예요'));
  assert.equal(S.verifyOffer(TARGET, v('official-055-navy'), { ...WANT, size: 'S' }).wantSize, 'sold_out');
  assert.equal(S.verifyOffer(TARGET, v('official-055-navy'), { ...WANT, size: 'XL' }).wantSize, 'missing');
  assert.equal(S.verifyOffer(TARGET, v('slow-shop'), WANT).wantSize, 'unknown', '상세를 못 읽으면 사이즈를 모른다');
  assert.equal(S.verifyOffer(TARGET, v('official-054-bluegray'), WANT).wantColor, 'other');
  assert.ok(S.verifyOffer(TARGET, v('official-055-navy'), { ...WANT, maxPrice: 150000 }).diffPoints.some(x => /희망가/.test(x)), '총액(할인가+배송비 173,100)이 희망가보다 비쌈');
});

// ── 7 · 결과 ──
test('[7 결과] 식별 결과와 판매 매물 결과를 나누고, 같은 상품 → 가능성 높음 → 확인 못 함 → 다른 상품으로 묶어 비교할 수 있게 돌려준다', async () => {
  const c = ctx();
  const queries = S.buildQueries(TARGET);
  const found = await S.searchSources([mockSource, officialSource, naverSource], TARGET, queries, c);
  const offers = (await S.normalizeHits(S.mergeHits(found.hits), TARGET, [mockSource], c, 10)).map(o => S.verifyOffer(TARGET, o, WANT));
  const r = S.assemble(TARGET, offers, found.report);
  assert.equal(r.identification.modelCode, 'W-JKT26-055');
  assert.match(r.identification.note, /판매 중인지는 아래 판매처 탐색 결과로 따로/);
  assert.equal(r.sale.state, 'found_same');
  assert.deepEqual(r.sale.same.map(o => o.url), ['mock://shop/used-055', 'mock://shop/official-055-navy'], '둘 다 M 재고 있음 → 총액이 싼 순(124,000 < 173,100)');
  assert.deepEqual(r.sale.likely.map(o => o.url), ['mock://shop/select-mystic-navy']);
  assert.deepEqual(r.sale.unverified.map(o => o.url), ['mock://shop/slow-shop']);
  assert.equal(r.sale.different.length, 3);
  assert.ok(r.limits.some(x => /검색하지 않은 곳 2곳/.test(x)), '공식몰(모의 의뢰)·네이버(종료)는 검색하지 않음(매물 없음이 아님)');
  assert.ok(r.limits.some(x => /사진으로 비교하지 않았어요/.test(x)));
  const none = S.assemble({ ...TARGET, brand: '테스트브랜드A' }, [], found.report);
  assert.equal(none.sale.state, 'none');
});

// ── 실행 · 대기열 ──
test('[실행] 모의 찾아줘: 식별 → 탐색 대기열 → 7단계 실행 → 후보 저장(모의 표시) · 같은 조건은 하루 안에 다시 검색하지 않고, 다른 의뢰는 결과를 다시 쓴다', async () => {
  const { db, id } = await setup('[테스트:정확]');
  const e = env();
  const q = S.queueFindSearch(db, e, id);
  assert.ok(q.id && !q.skipped);
  assert.equal(S.queueFindSearch(db, e, id).skipped, '같은 조건의 탐색이 이미 있어요');
  const w = S.createOfferSearcher(db, e);
  assert.equal(await w.step(), q.id);
  const s = db.prepare('SELECT * FROM offer_searches WHERE id=?').get(q.id) as any;
  assert.equal(s.status, 'done'); assert.equal(s.is_mock, 1); assert.equal(s.target_basis, 'ai_draft');
  assert.match(s.summary, /같은 상품\(품번\) 2 · 가능성 높음 1 · 확인 못 함 1 · 다른 상품 3/);
  const offers = offersOf(db, q.id!);
  assert.equal(offers.length, 7);
  assert.ok(offers.every(o => o.isMock && o.reviewState === 'pending' && o.relation === 'same' && o.recommender === 'walf-rules'));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM listings WHERE is_mock=1').get() as any).n, 7, '상품 페이지는 listings 에 한 줄씩(새 매물 판단용)');
  assert.equal(S.queueFindSearch(db, e, id).skipped, '같은 조건의 탐색이 이미 있어요', '하루 안에는 다시 넣지 않는다');
  assert.equal(D.getRequest(db, id).status, 'submitted', '판매처 탐색은 의뢰 상태를 바꾸지 않는다');
  assert.equal(F.findView(db, D.getRequest(db, id)).state, 'pending', '검수 전 결과는 사용자에게 보이지 않는다');

  // 다른 의뢰가 같은 옷을 찾으면 하루 안의 결과를 다시 쓴다(소스를 다시 열지 않음)
  const u2 = D.upsertUser(db, 'device-v21-0002', 'ios');
  const id2 = D.createRequest(db, u2.id, { photo: 'y.jpg', note: '[테스트:정확]', size: 'S' }, { isMock: true });
  const p = mockProvider(); A.ensureAiJobs(db, p); await A.createAiWorker(db, p, '/tmp').step();
  let calls = 0;
  const spy: SearchSource = { ...mockSource, async search(...a) { calls++; return mockSource.search(...a); } };
  const e2 = env({ sources: [spy, ...SEARCH_SOURCES.filter(x => x.id !== 'mock')] });
  const q2 = S.queueFindSearch(db, e2, id2);
  await S.createOfferSearcher(db, e2).step();
  const s2 = db.prepare('SELECT * FROM offer_searches WHERE id=?').get(q2.id) as any;
  assert.equal(calls, 0); assert.equal(s2.reused_from, q.id);
  assert.equal(offersOf(db, q2.id!).find(o => o.url === 'mock://shop/official-055-navy')!.wantSize, 'sold_out', '다시 쓸 때도 이 의뢰의 사이즈(S)로 다시 검증');
  // 운영자가 다시 실행하면(force) 새로 검색한다
  const q3 = S.queueFindSearch(db, e2, id2, { by: '운영자', force: true });
  await S.createOfferSearcher(db, e2).step();
  assert.ok(calls > 0); assert.equal((db.prepare('SELECT reused_from FROM offer_searches WHERE id=?').get(q3.id) as any).reused_from, null);
});

test('[실행] 식별했어도 판매 매물이 없으면 “없음”으로 끝난다 · 실제 의뢰에서 쓸 소스가 없으면 대기열에 넣지 않는다 · 실패한 탐색은 자동으로 다시 넣지 않는다', async () => {
  const { db, id } = await setup('[테스트:유력]');
  const e = env();
  const q = S.queueFindSearch(db, e, id);
  await S.createOfferSearcher(db, e).step();
  const r = S.searchResultOf(db, db.prepare('SELECT * FROM offer_searches WHERE id=?').get(q.id) as any);
  assert.equal(r.identification.brand, '테스트브랜드A', '식별 결과는 있다');
  assert.equal(r.sale.state, 'none', '판매 매물은 없다 — 식별했다고 매물이 있다고 하지 않는다');
  assert.match(r.search.summary, /검색한 곳에서 판매 페이지를 찾지 못했어요/);

  const real = await setup('LEMAIRE 크루아상 백', { mock: false });
  real.db.prepare(`UPDATE ai_identities SET brand='LEMAIRE', name='Croissant Bag', confidence='medium', is_mock=0`).run();
  real.db.prepare(`UPDATE requests SET is_mock=0`).run();
  assert.match(S.queueFindSearch(real.db, env(), real.id).skipped!, /쓸 수 있는 판매처 소스가 없어요/);
  assert.equal((real.db.prepare('SELECT COUNT(*) n FROM offer_searches').get() as any).n, 0);

  const broken = env({ sources: [{ ...mockSource, async search() { throw new Error('boom'); }, pick: () => { throw new Error('pick 실패'); } }], similar: [] });
  const { db: db3, id: id3 } = await setup('[테스트:정확]');
  const q3 = S.queueFindSearch(db3, broken, id3);
  await S.createOfferSearcher(db3, broken).step();
  assert.equal((db3.prepare('SELECT status FROM offer_searches WHERE id=?').get(q3.id) as any).status, 'failed');
  assert.equal(S.ensureFindSearches(db3, broken), 0, '하루 안에는 실패한 탐색을 자동으로 다시 넣지 않는다');
});

test('[실행] 서버가 꺼져 끊긴 탐색은 다시 대기열로(무료 소스뿐) — 세 번 끊기면 멈춘다', async () => {
  const { db, id } = await setup('[테스트:정확]');
  const q = S.queueFindSearch(db, env(), id);
  db.prepare(`UPDATE offer_searches SET status='running', attempts=1 WHERE id=?`).run(q.id);
  assert.equal(S.recoverOfferSearches(db), 1);
  assert.equal((db.prepare('SELECT status FROM offer_searches WHERE id=?').get(q.id) as any).status, 'queued');
  db.prepare(`UPDATE offer_searches SET status='running', attempts=3 WHERE id=?`).run(q.id);
  S.recoverOfferSearches(db);
  assert.equal((db.prepare('SELECT status FROM offer_searches WHERE id=?').get(q.id) as any).status, 'failed');
});

// ── 실제 상품 후보 스키마 ──
test('[스키마] 외부 추천 엔진 값은 cleanOffer 를 거친다: 주소·판매처·이름·추천 모델·버전이 없으면 버리고, “같은 상품” 판정은 믿지 않는다', () => {
  const ok = cleanOffer({ url: 'https://shop.example/p/1', seller: '테스트샵', name: '울 블루종', recommender: 'fashion-brain', recommenderVersion: '0.3.1', verdict: 'same_code',
    price: '159000.4', currency: 'usd', imageUrl: 'javascript:x', options: [{ size: 'm', stock: 'in_stock' }, { size: '95', stock: 'weird' }], similarPoints: ['박시한 실루엣', '울 소재'], score: 0.87654 });
  assert.ok(ok);
  assert.deepEqual([ok!.relation, ok!.verdict, ok!.price, ok!.currency, ok!.imageUrl, ok!.score], ['similar', 'unverified', 159000, 'KRW', null, 0.877]);
  assert.deepEqual(ok!.options.map(o => [o.size, o.stock]), [['M', 'in_stock'], ['M', 'unknown']]);
  assert.equal(cleanOffer({ url: 'https://x.example', seller: 's', name: 'n', recommender: 'r' }), null, '버전이 없으면 버린다');
  assert.equal(cleanOffer({ url: 'ftp://x', seller: 's', name: 'n', recommender: 'r', recommenderVersion: '1' }), null);
  assert.equal(cleanOffer({ url: 'mock://shop/x', seller: 's', name: 'n', recommender: 'r', recommenderVersion: '1' }), null, '테스트 주소는 테스트가 켜졌을 때만');
  assert.ok(cleanOffer({ url: 'mock://shop/x', seller: 's', name: 'n', recommender: 'r', recommenderVersion: '1' }, { mockAllowed: true })!.isMock);
});
