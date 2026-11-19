// V2.1 Gate C — 기다려줘: 상품 페이지 가격 감시(Price Watch)와 새 매물 탐색(Listing Discovery)을 나눠 검증하고, 기다리는 동안 볼 대체 상품을 연결한다.
// 판매처는 테스트 Fixture(mock://), 대체 상품은 테스트 큐레이터 — 실제 판매처·실제 추천 엔진이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as F from '../src/find.ts';
import * as S from '../src/findsearch.ts';
import * as R from '../src/offerreview.ts';
import * as W from '../src/watch.ts';
import * as X from '../src/discovery.ts';
import { loadBrandSeed } from '../src/catalog.ts';
import { mockProvider } from '../src/ai.ts';
import { setClock } from '../src/time.ts';
import { offersOf } from '../src/offers.ts';
import { fixtureSnapshot } from '../src/sources.ts';
import { SEARCH_SOURCES } from '../src/searchsources.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 19, 1, 0);
const MALLS = [{ brand: 'BADBLOOD', aliases: ['배드블러드'], domain: 'badblood.co.kr', platform: 'cafe24' as const, checked: '2026-11-09', basis: 'test' }];
const env = (over: Partial<S.SearchEnv> = {}): S.SearchEnv => ({ sources: SEARCH_SOURCES, mockAllowed: true, env: {}, malls: MALLS, pace: async () => {}, maxDetails: 6, reuseMs: 20 * 3600_000, ...over });
const policy = { ...W.policyFromEnv({ WALF_QA_TOOLS: '1' } as any) };
const runAll = async (db: any, e: S.SearchEnv) => { const w = S.createOfferSearcher(db, e); while (await w.step()) {} };

/** 사진으로 찾아줘 → 운영자 MATCH 공개 → “원하는 가격 기다리기” → 기다려줘(원하는 가격 180,000 · M) */
async function setup(opts: { url?: string; condition?: string; device?: string; target?: string } = {}) {
  setClock(T0);
  const db = openDb(':memory:');
  loadBrandSeed(db, [{ name: 'BADBLOOD', ko: ['배드블러드'], tags: [] }] as any, 'fixture');
  const u = D.upsertUser(db, opts.device || 'device-v21c-0001', 'ios');
  const rid = D.createRequest(db, u.id, { photo: 'x.jpg', note: '[테스트:정확]', size: 'M' }, { isMock: true });
  const p = mockProvider(); A.ensureAiJobs(db, p); await A.createAiWorker(db, p, '/tmp').step();
  F.publishFind(db, rid, { items: [{ aiIdentityId: F.findDraft(db, rid).identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  const { productId } = F.confirmFind(db, u.id, rid, F.findView(db, D.getRequest(db, rid)).match!.id, 'watch');
  const wid = W.createWatch(db, u.id, { productId, requestId: rid, productUrl: opts.url, targetPrice: opts.target || '180000', size: 'M', condition: opts.condition }, policy);
  return { db, u, rid, wid, w: () => db.prepare('SELECT * FROM watches WHERE id=?').get(wid) as any };
}
const count = (db: any, sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).n as number;

test('[분리] 상품 페이지 가격 감시와 새 매물 탐색은 다른 작업 — 서로의 기록·상태·알림을 바꾸지 않는다', async () => {
  const { db, wid, w } = await setup({ url: 'mock://fixture/price-drop' });
  // Price Watch: 등록한 상품 페이지 한 곳
  W.tickWatches(db, policy);
  await W.createChecker(db, policy, { fetchPage: async () => { throw new Error('실제 페이지를 열면 안 됨'); }, fixture: fixtureSnapshot }).step();
  const obs = count(db, 'SELECT COUNT(*) n FROM price_observations');
  assert.ok(obs > 0); assert.equal(count(db, 'SELECT COUNT(*) n FROM offers WHERE watch_id=?', wid), 0, '가격 확인은 새 매물 후보를 만들지 않는다');
  const before = { ...w() };
  // Listing Discovery: 같은 상품을 파는 다른 판매처
  const q = S.queueDiscovery(db, env(), wid);
  assert.ok(q.id && !q.skipped);
  await runAll(db, env());
  assert.ok(count(db, 'SELECT COUNT(*) n FROM offers WHERE watch_id=?', wid) > 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM price_observations'), obs, '새 매물 탐색은 가격 기록을 만들지 않는다');
  const after = w();
  for (const k of ['last_state', 'last_result', 'alerted', 'met_at', 'status', 'url', 'page_identity']) assert.equal(after[k], before[k], `${k}는 그대로`);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM notifications WHERE watch_id=?', wid), 0, '검수 전에는 새 매물 알림이 없다');
  assert.equal(count(db, `SELECT COUNT(*) n FROM offer_searches WHERE watch_id=? AND purpose='discovery'`, wid), 1);
});

test('[새 매물] 지켜보는 상품 페이지는 빼고 · 같은 상품·원하는 사이즈만 알림 후보 · 다음 탐색에서는 “처음 본 곳”이 아니다', async () => {
  const { db, wid, w } = await setup();
  db.prepare(`UPDATE watches SET url='mock://shop/official-055-navy' WHERE id=?`).run(wid); // 공식몰 페이지를 이미 지켜보는 중
  S.queueDiscovery(db, env(), wid); await runAll(db, env());
  let offers = offersOf(db, S.latestSearchesFor(db, wid, 'discovery', 1)[0].id);
  assert.ok(!offers.some(o => o.url === 'mock://shop/official-055-navy'), '지켜보는 페이지는 Price Watch 몫');
  const cand = offers.filter(o => S.discoveryCandidate(o, w())).map(o => o.url).sort();
  assert.deepEqual(cand, ['mock://shop/select-mystic-navy', 'mock://shop/used-055'], '다른 품번·다른 브랜드·상세를 못 읽은 곳(확인 못 함)은 후보가 아니다');
  assert.match(S.latestSearchesFor(db, wid, 'discovery', 1)[0].summary, /알림 후보\(같은 상품·원하는 옵션\) 2 · 처음 본 곳 2/);
  // 새 상품만 원하면 중고는 후보에서 빠진다
  db.prepare(`UPDATE watches SET condition='new' WHERE id=?`).run(wid);
  assert.ok(!offers.filter(o => S.discoveryCandidate(o, w())).some(o => o.condition === 'used'));
  db.prepare(`UPDATE watches SET condition='any' WHERE id=?`).run(wid);
  // 다음 날 다시 찾으면 이미 본 곳
  setClock(T0 + 25 * 3600_000);
  S.queueDiscovery(db, env(), wid, { t: T0 + 25 * 3600_000 }); await runAll(db, env());
  assert.match(S.latestSearchesFor(db, wid, 'discovery', 1)[0].summary, /처음 본 곳 0/);
  assert.equal(S.queueDiscovery(db, env(), wid, { t: T0 + 25 * 3600_000 }).skipped, '오늘은 이미 찾아봤어요');
});

test('[검수·알림] 운영자가 확인해야 사용자에게 보이고, 원하는 조건(가격·사이즈) 충족 판매처만 알림 — 같은 판매처 알림은 한 번', async () => {
  // 원하는 가격 195,000 — 공식몰 판매가 189,000 + 배송비 3,000(할인가가 아니라 판매가로 충족)
  const { db, u, wid, w } = await setup({ target: '195000' });
  S.queueDiscovery(db, env(), wid); await runAll(db, env());
  const sid = S.latestSearchesFor(db, wid, 'discovery', 1)[0].id;
  const by = (url: string) => offersOf(db, sid).find(o => o.url === url)!;
  let v = X.watchExtrasView(db, w(), 'http://h', env(), u.id);
  assert.equal(v.discovery.state, 'reviewing'); assert.equal(v.discovery.items.length, 0, '검수 전에는 보이지 않는다');
  R.reviewOffer(db, by('mock://shop/official-055-navy').id, 'exact', {}, '운영자');           // 192,000원 ≤ 195,000 · M 재고
  R.reviewOffer(db, by('mock://shop/select-mystic-navy').id, 'possible', {}, '운영자');      // 배송비 모름 → 알림 없음
  R.reviewOffer(db, by('mock://shop/other-brand').id, 'reject', { reason: '다른 상품' }, '운영자');
  const n = db.prepare('SELECT * FROM notifications WHERE user_id=? AND kind=?').all(u.id, 'watch_discovery') as any[];
  assert.equal(n.length, 1);
  assert.equal(n[0].title, '다른 판매처에서 원하는 조건의 매물을 찾았어요');
  assert.match(n[0].body, /테스트 공식몰 · 배송비 포함 192,000원 · M 재고 있음\(페이지를 읽은 시각 기준\)\. 왈프 팀이 같은 상품인지 확인했어요/);
  assert.ok(!/구매 가능/.test(n[0].body + n[0].title));
  v = X.watchExtrasView(db, w(), 'http://h', env(), u.id);
  assert.equal(v.discovery.state, 'ready');
  assert.deepEqual(v.discovery.items.map(c => [c.seller, c.tier, c.meetsTarget, c.isNew]), [['테스트 공식몰', 'exact', true, true], ['테스트 편집숍', 'possible', false, true]]);
  assert.equal(w().last_state, null, '새 매물 공개는 가격 감시 상태를 바꾸지 않는다');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM watch_events WHERE watch_id=? AND kind='discovery_published'`).get(wid).n, 2);
  // 다시 찾아도(같은 판매처) 알림은 한 번 · 검수는 이어받는다
  S.queueDiscovery(db, env(), wid, { force: true }); await runAll(db, env());
  R.reviewOffer(db, offersOf(db, S.latestSearchesFor(db, wid, 'discovery', 1)[0].id).find(o => o.url === 'mock://shop/official-055-navy')!.id, 'exact', {}, '운영자');
  assert.equal(count(db, `SELECT COUNT(*) n FROM notifications WHERE kind='watch_discovery'`), 1);
  v = X.watchExtrasView(db, w(), 'http://h', env(), u.id);
  assert.equal(v.discovery.items.length, 2, '같은 판매처가 두 번 보이지 않는다');
  assert.ok(v.discovery.items.every(c => !c.isNew), '두 번째 탐색에서는 처음 본 곳이 아니다');
});

test('[설정] 새 판매처 찾기 끄기 · 찾아볼 곳 고르기(지원하지 않는 곳은 못 고름) · 끈 곳은 “검색하지 않음”', async () => {
  const { db, u, wid, w } = await setup();
  const src = X.discoverySources(db, env(), w());
  assert.deepEqual(src.filter(x => x.usable).map(x => x.id), ['mock'], '모의 기다려줘는 테스트 판매처만');
  assert.equal(src.find(x => x.id === 'bunjang')!.usable, false); assert.match(src.find(x => x.id === 'bunjang')!.reason, /제39조/);
  assert.equal(src.find(x => x.id === 'bunjang')!.note, '이용약관상 자동으로 찾을 수 없어요 · 필요하면 왈프 팀이 직접 확인해요', '사용자에게는 쉬운 말로');
  assert.equal(src.find(x => x.id === 'ai_web')!.note, '유료 기능이라 아직 쓰지 않아요');
  assert.equal(src.find(x => x.id === 'naver_shopping')!.status, 'PENDING_EXTERNAL_SETUP');
  assert.throws(() => X.updateDiscovery(db, u.id, wid, { discoverySources: ['mock', 'bunjang'] }, env()), /지금 찾아볼 수 없는 곳/);
  X.updateDiscovery(db, u.id, wid, { discoverySources: [] }, env());
  assert.match(S.queueDiscovery(db, env(), wid).skipped!, /쓸 수 있는 판매처 소스가 없어요/);
  X.updateDiscovery(db, u.id, wid, { discoverySources: ['mock'] }, env());
  X.updateDiscovery(db, u.id, wid, { discovery: false }, env());
  assert.equal(S.queueDiscovery(db, env(), wid).skipped, '새 판매처 찾기를 꺼 두었어요');
  assert.equal(X.watchExtrasView(db, w(), 'http://h', env(), u.id).discovery.state, 'off');
  assert.ok((db.prepare(`SELECT COUNT(*) n FROM watch_events WHERE watch_id=? AND kind='discovery_settings'`).get(wid) as any).n >= 3, '설정 바꾼 기록');
  // 실제(모의 아님) 기다려줘에서 사용자가 끈 곳은 “이 기다려줘에서 끈 판매처예요”로 남는다
  const real = { ...w(), is_mock: 0, brand: 'BADBLOOD', discovery: 1, discovery_sources: JSON.stringify([]) };
  const t = S.watchTargetOf(db, real, MALLS)!;
  const official = S.sourcesFor(env(), real).find(x => x.id === 'official')!;
  assert.equal(official.availability(t, { isMock: false, mockAllowed: true, env: {}, malls: MALLS, pace: async () => {} }).reason, '이 기다려줘에서 끈 판매처예요');
  assert.ok(!X.discoverySources(db, env(), real).some(x => x.id === 'mock'), '실제 기다려줘에는 테스트 판매처를 보여 주지 않는다');
});

test('[대체 상품] 기다리는 동안 볼 비슷한 옷 — 공개하면 바로 보이고, 저장·해제해도 기다려줘는 그대로 · 남의 후보는 저장 못 함', async () => {
  const { db, u, wid, w } = await setup();
  const q = S.queueWatchSimilar(db, env(), wid);
  assert.ok(q.id && !q.skipped);
  await runAll(db, env());
  const sims = offersOf(db, q.id!);
  assert.equal(sims[0].name, '나일론 트랙 자켓 블랙'); assert.ok(sims.every(o => o.relation === 'similar' && o.watchId === wid));
  R.reviewOffer(db, sims[0].id, 'alternative', {}, '운영자');
  R.reviewOffer(db, sims[1].id, 'alternative', {}, '운영자');
  let v = X.watchExtrasView(db, w(), 'http://h', env(), u.id);
  assert.equal(v.alternatives.items.length, 2); assert.equal(v.alternatives.state, 'ready');
  assert.equal(count(db, `SELECT COUNT(*) n FROM notifications WHERE kind='watch_alternatives'`), 1, '하루 한 번');
  assert.equal(count(db, `SELECT COUNT(*) n FROM watch_events WHERE watch_id=? AND kind='alternatives_published'`, wid), 1, '기록도 하루 한 줄');
  const status = w().status;
  X.saveOffer(db, u.id, sims[0].id, true); X.saveOffer(db, u.id, sims[0].id, true);
  v = X.watchExtrasView(db, w(), 'http://h', env(), u.id);
  assert.deepEqual(v.alternatives.items.map(c => c.saved), [true, false]);
  assert.equal(w().status, status, '저장해도 기다려줘는 끝나지 않는다');
  X.saveOffer(db, u.id, sims[0].id, false);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM offer_saves'), 0);
  const other = D.upsertUser(db, 'device-v21c-9999', 'ios');
  assert.throws(() => X.saveOffer(db, other.id, sims[0].id, true), /not_found/);
  assert.throws(() => X.saveOffer(db, u.id, sims[3]?.id ?? sims[2].id, true), /not_found/, '공개하지 않은 후보는 저장 못 함');
  // 링크로만 등록한(찾아줘에서 넘어오지 않은) 기다려줘는 디자인 정보가 없어 고르지 않는다
  const w2 = W.createWatch(db, u.id, { productName: 'BADBLOOD Mystic Nylon Track Jacket', targetPrice: '150000' }, policy, { isMock: true });
  assert.match(S.queueWatchSimilar(db, env(), w2).skipped!, /디자인 정보가 없어/);
});

test('[일정] 하루 한 번: 할 때가 된 기다려줘만 넣고, 끝낸·멈춘 기다려줘는 찾지 않는다', async () => {
  const { db, u, wid } = await setup();
  assert.equal(S.ensureDiscoveries(db, env(), policy.checkEveryMs, T0), 1);
  assert.equal(S.ensureDiscoveries(db, env(), policy.checkEveryMs, T0 + 60_000), 0, '다음 확인 시각 전에는 다시 넣지 않는다');
  assert.equal(count(db, `SELECT COUNT(*) n FROM offer_searches WHERE watch_id=? AND purpose='similar'`, wid), 1, '대체 상품도 함께(하루 한 번)');
  W.setWatchState(db, u.id, wid, 'pause', policy);
  assert.equal(S.ensureDiscoveries(db, env(), policy.checkEveryMs, T0 + 2 * 86_400_000), 0);
  assert.equal(S.queueDiscovery(db, env(), wid).skipped, '지켜보는 중일 때만 찾아요');
});
