// V2.1 Gate D — 기기 세션 토큰 · 사진 주소 서명 · 추천 선호·피드백 · 운영자 검수 기록(평가 데이터) · 삭제 정책.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as F from '../src/find.ts';
import * as S from '../src/findsearch.ts';
import * as R from '../src/offerreview.ts';
import * as W from '../src/watch.ts';
import * as FB from '../src/feedback.ts';
import { saveOffer } from '../src/discovery.ts';
import { loadBrandSeed } from '../src/catalog.ts';
import { mockProvider } from '../src/ai.ts';
import { setClock } from '../src/time.ts';
import { offersOf } from '../src/offers.ts';
import { FIXTURE_CURATOR, curateOffers, rankerOf } from '../src/curation.ts';
import { setMediaSecret, uploadUrl, verifyUpload } from '../src/media.ts';
import { SEARCH_SOURCES } from '../src/searchsources.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 19, 1, 0);
const env = (): S.SearchEnv => ({ sources: SEARCH_SOURCES, mockAllowed: true, env: {}, malls: [], pace: async () => {}, maxDetails: 6, reuseMs: 20 * 3600_000 });
const runAll = async (db: any) => { const w = S.createOfferSearcher(db, env()); while (await w.step()) {} };
const WOOL = { mood: ['minimal', 'workwear'], material: ['wool'], silhouette: ['boxy'], detail: ['zip'], category: ['jacket', 'outerwear'], color: ['brown'] };
async function setup(note = '[테스트:정확]') {
  setClock(T0);
  const db = openDb(':memory:');
  loadBrandSeed(db, [{ name: 'BADBLOOD', ko: ['배드블러드'], tags: [] }] as any, 'fixture');
  const u = D.upsertUser(db, 'device-v21d-0001', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'a1b2c3.jpg', note, size: 'M' }, { isMock: true });
  const p = mockProvider(); A.ensureAiJobs(db, p); await A.createAiWorker(db, p, '/tmp').step();
  return { db, u, id };
}

test('[세션] 처음 세션을 열면 토큰을 한 번 주고, 그 뒤로는 기기 ID만으로는 세션을 열 수 없다', () => {
  const db = openDb(':memory:');
  const a = D.openSession(db, 'device-session-0001', 'ios', null);
  assert.ok(a.token && a.token.length >= 40);
  assert.equal(a.user.token_hash.length, 64, '토큰은 해시만 저장');
  assert.notEqual(a.user.token_hash, a.token);
  assert.throws(() => D.openSession(db, 'device-session-0001', 'ios', null), (e: any) => e.status === 401 && e.code === 'device_claimed');
  assert.throws(() => D.openSession(db, 'device-session-0001', 'ios', 'x'.repeat(43)), (e: any) => e.code === 'device_claimed');
  const again = D.openSession(db, 'device-session-0001', 'ios', a.token);
  assert.equal(again.user.id, a.user.id); assert.equal(again.token, undefined, '토큰은 다시 주지 않는다');
  assert.equal(D.tokenOk(again.user, a.token), true); assert.equal(D.tokenOk(again.user, undefined), false);
  // 토큰 발급 전(이전 버전) 계정은 기기 ID만으로 열 수 없다(리뷰 후속 — 이어받기 코드로만, test/v21-review.test.ts)
  const legacy = D.upsertUser(db, 'device-legacy-0001', 'ios');
  assert.equal(D.tokenOk(legacy, undefined), false);
  assert.throws(() => D.openSession(db, 'device-legacy-0001', 'ios', null), (e: any) => e.status === 401 && e.code === 'legacy_locked');
});

test('[사진] 사용자 사진은 서명·만료가 있는 주소로만 — 서명이 틀리거나 만료되거나 이상한 파일 이름이면 거절', () => {
  setMediaSecret('test-secret-media');
  const t = Date.UTC(2026, 10, 19, 3, 10);
  const u = new URL(uploadUrl('http://h', 'a1b2c3d4-0000.jpg', t)!);
  const exp = u.searchParams.get('exp'), sig = u.searchParams.get('sig');
  assert.equal(verifyUpload('a1b2c3d4-0000.jpg', exp, sig, t), true);
  assert.equal(verifyUpload('a1b2c3d4-0001.jpg', exp, sig, t), false, '다른 사진에 같은 서명 못 씀');
  assert.equal(verifyUpload('a1b2c3d4-0000.jpg', exp, sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A'), t), false);
  assert.equal(verifyUpload('a1b2c3d4-0000.jpg', exp, sig, Number(exp) + 1), false, '만료');
  assert.equal(verifyUpload('a1b2c3d4-0000.jpg', String(Number(exp) + 86_400_000), sig, t), false, '만료 시각을 늘리면 서명이 안 맞는다');
  assert.equal(uploadUrl('http://h', '../server/.env', t), null);
  assert.equal(verifyUpload('../server/.env', exp, sig, t), false);
  assert.equal(Number(exp) - t <= 13 * 3600_000, true, '최대 13시간');
});

test('[선호] 무엇이 중요한지에 따라 대체 상품 순서가 바뀐다 — 소재·디테일이면 울 셔켓이, 실루엣이면 박시 워크 자켓이 앞으로', async () => {
  const raw = await FIXTURE_CURATOR.find({ style: WOOL, brand: null, name: null, modelCode: null, size: 'M', limit: 12 });
  const order = (priority: any) => curateOffers(raw, { style: WOOL, brand: null, name: null, modelCode: null, size: 'M', limit: 6, mockAllowed: true, priority }).offers.map(o => o.name);
  assert.equal(order(null)[1], '코튼 캔버스 워크 자켓 브라운');
  assert.equal(order('material_detail')[1], '울 셔켓 차콜', '소재(울)가 같은 옷이 앞으로');
  assert.ok(!order('material_detail').includes('나일론 코치 자켓 네이비'), '실루엣만 닮은 옷은 빠진다');
  assert.deepEqual(order('silhouette').slice(0, 3), ['울 집업 블루종 브라운', '코튼 캔버스 워크 자켓 브라운', '나일론 코치 자켓 네이비'], '박시 실루엣 순');
  assert.ok(order('vibe').length >= order(null).length, '비슷한 느낌이면 OK → 더 넓게');
  assert.equal(rankerOf('silhouette'), 'walf-design-rank-1:silhouette'); assert.equal(rankerOf(null), 'walf-design-rank-1:default');

  const { db, u, id } = await setup('[테스트:유사]');
  assert.throws(() => FB.setPriority(db, u.id, { requestId: id }, 'cheap'), /고를 수 있는 선호가 아니에요/);
  const other = D.upsertUser(db, 'device-v21d-9999', 'ios');
  assert.throws(() => FB.setPriority(db, other.id, { requestId: id }, 'vibe'), /not_found/);
  S.queueSimilarSearch(db, env(), id); await runAll(db);
  FB.setPriority(db, u.id, { requestId: id }, 'material_detail');
  const q = S.queueSimilarSearch(db, env(), id);
  assert.ok(q.id && !q.skipped, '선호를 바꾸면 새로 고른다(같은 조건 재검색 막기에 걸리지 않음)');
  await runAll(db);
  const s = db.prepare('SELECT * FROM offer_searches WHERE id=?').get(q.id) as any;
  assert.equal(s.ranker, 'walf-design-rank-1:material_detail');
  assert.equal(offersOf(db, q.id!)[1].name, '울 셔켓 차콜');
  assert.deepEqual(F.findView(db, D.getRequest(db, id), 'http://h').priorities.find((p: any) => p.selected)?.id, 'material_detail');
});

test('[다시 고르기] 선호를 바꿔 다시 고르면 화면에는 새 추천만 — 새 기준에서 빠진 옷은 내려가고, 선호를 되돌리면 다시 골라 예전 검수를 이어받는다', async () => {
  const { db, u, id } = await setup('[테스트:유사]');
  S.queueSimilarSearch(db, env(), id); await runAll(db);
  for (const o of offersOf(db, S.latestSearches(db, id, 1, 'similar')[0].id).slice(0, 3)) R.reviewOffer(db, o.id, 'alternative', {}, '운영자');
  F.publishFind(db, id, { items: [{ aiIdentityId: F.findDraft(db, id).identities[0].id, tier: 'skip' }], discover: [] }, '운영자');
  const names = () => F.findView(db, D.getRequest(db, id), 'http://h').alternatives.items.map((c: any) => c.name);
  const DEFAULT = ['울 집업 블루종 브라운', '코튼 캔버스 워크 자켓 브라운', '나일론 코치 자켓 네이비'];
  assert.deepEqual(names(), DEFAULT);
  FB.setPriority(db, u.id, { requestId: id }, 'material_detail');
  S.queueSimilarSearch(db, env(), id); await runAll(db);
  assert.deepEqual(names(), ['울 집업 블루종 브라운', '코튼 캔버스 워크 자켓 브라운'], '소재·디테일 기준에서 빠진 나일론 코치 자켓은 내려간다(새로 고른 울 셔켓은 검수 전이라 아직 안 보임)');
  assert.equal(D.findTiers(db, id).alternatives, 2);
  FB.setPriority(db, u.id, { requestId: id }, null);
  const back = S.queueSimilarSearch(db, env(), id);
  assert.ok(back.id && !back.skipped, '되돌린 기준으로 다시 고른다(같은 조건 재검색 막기는 지금 보이는 추천에만)');
  await runAll(db);
  assert.deepEqual(names(), DEFAULT, '예전 검수를 이어받아 다시 보인다');
  assert.equal(S.queueSimilarSearch(db, env(), id).skipped, '같은 조건의 추천이 이미 있어요', '같은 기준이면 다시 고르지 않는다');
});

test('[피드백] 추천 상품에만 직접 평가(마음에 들어요·비슷하지만 아니에요·관심 없어요) — 열어 보기·저장은 만족으로 치지 않는다 · 상품·모델·버전·순위와 함께 남는다', async () => {
  const { db, u, id } = await setup();
  S.queueFindSearch(db, env(), id); S.queueSimilarSearch(db, env(), id); await runAll(db);
  const sims = offersOf(db, S.latestSearches(db, id, 1, 'similar')[0].id), same = offersOf(db, S.latestSearches(db, id, 1)[0].id);
  R.reviewOffer(db, sims[0].id, 'alternative', {}, '운영자'); R.reviewOffer(db, sims[1].id, 'alternative', {}, '운영자');
  R.reviewOffer(db, same.find(o => o.verdict === 'same_code')!.id, 'exact', {}, '운영자');
  F.publishFind(db, id, { items: [{ aiIdentityId: F.findDraft(db, id).identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  FB.setPriority(db, u.id, { requestId: id }, 'silhouette');
  assert.throws(() => FB.recordSignal(db, u.id, sims[2].id, 'like'), /not_found/, '공개 전 후보');
  assert.throws(() => FB.recordSignal(db, D.upsertUser(db, 'device-v21d-8888', 'ios').id, sims[0].id, 'like'), /not_found/, '남의 후보');
  assert.throws(() => FB.recordSignal(db, u.id, same.find(o => o.verdict === 'same_code')!.id, 'like'), /추천\(비슷한 디자인\) 상품에만/);
  assert.throws(() => FB.recordSignal(db, u.id, sims[0].id, 'love' as any), /고를 수 있는 피드백이 아니에요/);
  FB.recordSignal(db, u.id, sims[0].id, 'open');
  FB.recordSignal(db, u.id, sims[0].id, 'like');
  FB.recordSignal(db, u.id, sims[1].id, 'not_quite');
  FB.recordSignal(db, u.id, sims[1].id, 'cleared');
  saveOffer(db, u.id, sims[0].id, true); saveOffer(db, u.id, sims[0].id, true);
  const v = F.findView(db, D.getRequest(db, id), 'http://h');
  assert.deepEqual(v.alternatives.items.map((c: any) => c.feedback), ['like', null], '마지막 평가 · 지우면 없음');
  // 선호를 바꿔 추천을 다시 골라도(새 줄) 같은 상품 페이지의 평가는 이어 보인다 — 기록(그때 순위·버전)은 그대로
  S.queueSimilarSearch(db, env(), id); await runAll(db);
  const v2 = F.findView(db, D.getRequest(db, id), 'http://h');
  assert.equal(v2.alternatives.items.find((c: any) => c.name === v.alternatives.items[0].name)!.feedback, 'like');
  assert.notEqual(v2.alternatives.items[0].id, v.alternatives.items[0].id, '새 추천 줄');
  const rows = FB.exportFeedback(db, 'secret-x', { mock: true });
  assert.equal(rows.filter(r => r.explicit).length, 3);
  const like = rows.find(r => r.signal === 'like')!;
  assert.deepEqual([like.satisfaction, like.context, like.target.priority, like.item.relation, like.model.recommender, like.model.version, like.model.ranker, like.model.rank],
    [1, 'find', 'silhouette', 'similar', 'walf-fixture-curator', 'fixture-1', 'walf-design-rank-1:default', 1]);
  assert.ok(rows.filter(r => !r.explicit).every(r => r.satisfaction === null), '열어 보기·저장은 만족 값이 없다');
  assert.deepEqual(rows.filter(r => !r.explicit).map(r => r.signal).sort(), ['open', 'save'], '같은 저장을 두 번 해도 한 번');
  assert.ok(rows.every(r => /^u_[0-9a-f]{12}$/.test(r.user)) && !JSON.stringify(rows).includes('device-v21d'), '사용자는 가명으로만');
  assert.equal(FB.exportFeedback(db, 'secret-x').length, 0, '모의 데이터는 기본으로 뺀다');
});

test('[검수 기록] 운영자가 등급·이름을 고치거나 후보·페이지를 판단한 일을 자동 판정과 함께 남기고, 평가 데이터로 내보낸다', async () => {
  const { db, u, id } = await setup('[테스트:유력]');
  const d = F.findDraft(db, id);
  F.publishFind(db, id, { items: [{ aiIdentityId: d.identities[0].id, tier: 'likely', name: '울 집업 블루종(운영자 수정)' }, { aiIdentityId: d.identities[1].id, tier: 'skip' }], discover: [] }, '운영자A');
  const logs = db.prepare(`SELECT * FROM review_log WHERE request_id=? ORDER BY id`).all(id) as any[];
  assert.deepEqual(logs.map(l => [l.subject, l.action, l.operator]), [['identity', 'likely', '운영자A'], ['identity', 'skip', '운영자A']]);
  assert.equal(JSON.parse(logs[0].auto).tier, 'likely');
  assert.equal(JSON.parse(logs[0].before).name, '울 집업 자켓 브라운', '고치기 전(AI 제안) 이름도 남긴다');
  assert.equal(JSON.parse(logs[0].after).name, '울 집업 블루종(운영자 수정)');
  // 기다려줘 페이지 판단
  const wid = W.createWatch(db, u.id, { productName: '테스트 트랙 자켓', productUrl: 'mock://fixture/price-drop', targetPrice: '100000' }, W.policyFromEnv({ WALF_QA_TOOLS: '1' } as any));
  W.confirmPage(db, wid, true, '운영자B', W.policyFromEnv({ WALF_QA_TOOLS: '1' } as any));
  const wl = db.prepare(`SELECT * FROM review_log WHERE watch_id=?`).all(wid) as any[];
  assert.deepEqual(wl.map(l => [l.subject, l.action, l.operator]), [['watch_page', 'page_same', '운영자B']]);
  const ex = FB.exportReviews(db, { mock: true });
  assert.ok(ex.length >= 3 && ex.every(r => r.type === 'review' && r.decision && r.at));
});

test('[삭제] 계정을 지우면 추천 피드백·저장·행동 기록을 지우고, 운영자 검수 기록은 남기되 사용자와의 연결을 끊는다', async () => {
  const { db, u, id } = await setup();
  S.queueSimilarSearch(db, env(), id); await runAll(db);
  const sims = offersOf(db, S.latestSearches(db, id, 1, 'similar')[0].id);
  R.reviewOffer(db, sims[0].id, 'alternative', {}, '운영자');
  F.publishFind(db, id, { items: [{ aiIdentityId: F.findDraft(db, id).identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  FB.recordSignal(db, u.id, sims[0].id, 'like'); saveOffer(db, u.id, sims[0].id, true);
  D.deleteUser(db, u.id);
  const n = (sql: string) => (db.prepare(sql).get() as any).n;
  assert.equal(n('SELECT COUNT(*) n FROM offer_signals'), 0);
  assert.equal(n('SELECT COUNT(*) n FROM offer_saves'), 0);
  assert.ok(n('SELECT COUNT(*) n FROM review_log') >= 2, '검수 기록은 남는다(상품·판매처 판단)');
  assert.equal(n('SELECT COUNT(*) n FROM review_log WHERE request_id IS NOT NULL'), 0, '사용자 의뢰와의 연결은 끊는다');
});
