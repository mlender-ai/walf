// V2.1 최종 코드 리뷰 후속 — 회귀 테스트.
// 1 품번 부분 일치로 같은 상품 확정 금지(브랜드·품번 충돌) · 2 likely → matched 자동 승격 제거 · 3 새 매물 알림 조건 전부 확인(possible 분리)
// 4 기기 ID만으로 이전 버전 계정을 가져가는 길 차단 · 5 AI 첫 후보가 틀려도 다른 식별 후보 검증 · 제품: 단종·품번 없음·정확한 상품 없음·실제/테스트 구분
// 네트워크는 열지 않는다(테스트 판매처 Fixture). 실제 판매 가격이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import * as F from '../src/find.ts';
import * as S from '../src/findsearch.ts';
import * as R from '../src/offerreview.ts';
import * as W from '../src/watch.ts';
import * as X from '../src/discovery.ts';
import * as FB from '../src/feedback.ts';
import { apiErrors, userApi } from '../src/api.ts';
import { compareProduct, codeOnPage, strongCode } from '../src/sameproduct.ts';
import { fitOf, offersOf, type ProductOffer, type StoredOffer, type WatchWant } from '../src/offers.ts';
import { loadBrandSeed } from '../src/catalog.ts';
import { mockProvider } from '../src/ai.ts';
import { setClock, DAY } from '../src/time.ts';
import { SEARCH_SOURCES, mockSource, type SourceCtx } from '../src/searchsources.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 19, 1, 0);
const MALLS = [{ brand: 'BADBLOOD', aliases: ['배드블러드'], domain: 'badblood.co.kr', platform: 'cafe24' as const, checked: '2026-11-09', basis: 'test' }];
const env = (over: Partial<S.SearchEnv> = {}): S.SearchEnv => ({ sources: SEARCH_SOURCES, mockAllowed: true, env: {}, malls: MALLS, pace: async () => {}, maxDetails: 6, reuseMs: 20 * 3600_000, ...over });
const ctx = (over: Partial<SourceCtx> = {}): SourceCtx => ({ isMock: true, mockAllowed: true, env: {}, malls: MALLS, pace: async () => {}, ...over });
const policy: W.WatchPolicy = { maxActive: 3, checkEveryMs: DAY, renewAfterMs: 30 * DAY, unreachableAfter: 3, maxAttempts: 3, leaseMs: 120_000, mockAllowed: true };
const runAll = async (db: any, e = env()) => { const w = S.createOfferSearcher(db, e); while (await w.step()) {} };
const BB = { brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', modelCode: 'W-JKT26-055', aliases: ['배드블러드'] };
const v = (t: any, title: string, brand: string | null = null) => compareProduct(t, { title, brand }).verdict;

async function request(note: string, opts: { mock?: boolean; device?: string } = {}) {
  setClock(T0);
  const db = openDb(':memory:');
  loadBrandSeed(db, [{ name: 'BADBLOOD', ko: ['배드블러드'], tags: [] }] as any, 'fixture');
  const u = D.upsertUser(db, opts.device || 'device-review-0001', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'x.jpg', note, size: 'M' }, { isMock: opts.mock ?? true });
  const p = mockProvider(); A.ensureAiJobs(db, p); await A.createAiWorker(db, p, '/tmp').step();
  return { db, u, id };
}

// ── 1 · 품번 판정 ───────────────────────────────────────────────
test('[리뷰 1] 품번 일부만 겹치면 같은 상품이 아니다 — 정확히 같은 품번만 same_code', () => {
  assert.equal(v({ ...BB, modelCode: 'W-JKT26-05' }, 'BADBLOOD Mystic Nylon Track Jacket W-JKT26-055', 'BADBLOOD'), 'different', '찾는 품번이 페이지 품번의 앞부분');
  assert.equal(v(BB, 'BADBLOOD Mystic Nylon Track Jacket W-JKT26-0551', 'BADBLOOD'), 'different', '페이지 품번이 찾는 품번을 품음');
  assert.equal(v({ ...BB, modelCode: 'JKT26055' }, 'BADBLOOD Track Jacket XJKT26055A', 'BADBLOOD'), 'different');
  assert.equal(v(BB, 'BADBLOOD Mystic Nylon Track Jacket Navy W-JKT26-055', 'BADBLOOD'), 'same_code');
  assert.equal(v(BB, '[w-jkt26-055] 미스틱 나일론 트랙 자켓', 'BADBLOOD'), 'same_code', '대소문자·괄호는 상관없음');
  assert.equal(v(BB, 'BADBLOOD Track Jacket W-JKT26-055-NAVY', 'BADBLOOD'), 'same_code', '품번 뒤에 색·사이즈만 붙은 옵션 표기');
  assert.equal(v(BB, 'BADBLOOD Track Jacket W-JKT26-055-2', 'BADBLOOD'), 'different', '색·사이즈가 아닌 꼬리는 다른 품번');
  assert.equal(codeOnPage('W-JKT26-055', 'xw-jkt26-055'), false);
});

test('[리뷰 1] 브랜드가 부딪히면 품번이 같아도 다른 상품 · 품번 충돌 · 여러 품번은 확정하지 않음', () => {
  assert.equal(v(BB, 'OTHERLABEL Track Jacket W-JKT26-055', 'OTHERLABEL'), 'different', '같은 품번 · 다른 브랜드');
  const r = compareProduct(BB, { title: 'OTHERLABEL Track Jacket W-JKT26-055', brand: 'OTHERLABEL' });
  assert.deepEqual(r.checks.map(c => [c.field, c.result]), [['brand', 'mismatch']]);
  assert.equal(v(BB, 'BADBLOOD Mystic Nylon Track Jacket W-JKT26-054', 'BADBLOOD'), 'different', '같은 브랜드 · 다른 품번');
  const both = compareProduct(BB, { title: 'BADBLOOD 세트 W-JKT26-055 + W-PNT26-031', brand: 'BADBLOOD' });
  assert.notEqual(both.verdict, 'same_code', '같은 품번과 다른 품번이 함께 있으면 확정하지 않는다');
  assert.ok(both.checks.some(c => c.field === 'model_code' && c.result === 'unknown' && /여러 개/.test(c.text)));
  // 브랜드는 부분 문자열로 맞추지 않는다
  assert.equal(v({ brand: 'ADER', name: 'Logo Hoodie', modelCode: 'AD-HD-2401' }, 'Logo Hoodie AD-HD-2401', 'ADERERROR'), 'different');
  // 한글 표기는 별칭으로만 같은 브랜드 — 별칭이 없으면 다른 브랜드로 본다(같은 품번이어도). 페이지에 브랜드가 없으면 “확인 못 함”
  const ko = compareProduct(BB, { title: '미스틱 트랙자켓 W-JKT26-055 네이비', brand: '배드블러드' });
  assert.equal(ko.verdict, 'same_code'); assert.ok(ko.checks.some(c => c.field === 'brand' && c.result === 'match'));
  assert.equal(v({ ...BB, aliases: [] }, '미스틱 트랙자켓 W-JKT26-055', '배드블러드'), 'different');
  const noBrand = compareProduct(BB, { title: '미스틱 트랙자켓 W-JKT26-055', brand: null });
  assert.equal(noBrand.verdict, 'same_code'); assert.ok(noBrand.checks.some(c => c.field === 'brand' && c.result === 'unknown'));
  assert.match(noBrand.note, /브랜드는 페이지에서 확인하지 못했어요/);
});

test('[리뷰 1] 짧은 품번·시즌 표기·상품명만 같은 경우', () => {
  assert.equal(strongCode('M65'), false); assert.equal(strongCode('W-JKT26-055'), true); assert.equal(strongCode('12345678'), true);
  assert.notEqual(v({ brand: 'ALPHA', name: 'Field Jacket', modelCode: 'M65' }, 'ALPHA M65 Field Jacket', 'ALPHA'), 'same_code', '짧은 품번만으로는 확정하지 않는다');
  assert.equal(v(BB, 'BADBLOOD 2024FW Mystic Nylon Track Jacket W-JKT26-055', 'BADBLOOD'), 'same_code', '시즌 표기는 품번 충돌이 아니다');
  assert.equal(v({ ...BB, modelCode: null }, 'BADBLOOD 미스틱 나일론 트랙 자켓 (Mystic Nylon Track Jacket) 네이비', null), 'likely', '상품명만 같으면 가능성 높음까지');
});

// ── 2 · 기다려줘 페이지 동일성 ─────────────────────────────────────
test('[리뷰 2] 상품명만 같은 페이지는 likely — 목표가·재고가 맞아도 확정 알림 없음, 운영자 확인 후에만', async () => {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-review-0002', 'ios');
  const checker = W.createChecker(db, policy);
  const id = W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', productName: '테스트 트랙 자켓', size: 'M', targetPrice: '230,000' }, policy);
  W.tickWatches(db, policy); while (await checker.step()) {}
  const w = db.prepare('SELECT * FROM watches WHERE id=?').get(id) as any;
  assert.equal(w.page_identity, 'likely');
  assert.equal(w.last_state, 'unverified', '가격(223,000 ≤ 230,000)·재고가 맞아도');
  assert.match(JSON.parse(w.last_result).reasons[0], /품번으로 같은 상품인지 확인하지 못했어요/);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(u.id) as any).n, 0);
  assert.ok((db.prepare(`SELECT * FROM watch_events WHERE watch_id=? AND kind='page_check'`).get(id) as any), '확인 중이라고 기록');
  assert.equal(W.watchView(db, w, 'http://h', policy).display.key, 'attention');
  // 예전 규칙으로 자동 “같음”이 된 감시(조건 충족·알림 보냄 상태)는 서버 시작 때 지금 규칙으로 다시 판정된다
  db.prepare(`UPDATE watches SET page_identity='matched', identity_note='상품명 핵심 단어 3/3개가 페이지 상품명과 같아요', last_state='met', alerted=1 WHERE id=?`).run(id);
  assert.equal(W.resettleAutoMatched(db, policy), 1);
  const after = db.prepare('SELECT * FROM watches WHERE id=?').get(id) as any;
  assert.deepEqual([after.page_identity, after.last_state, after.alerted], ['likely', 'unverified', 0]);
  assert.ok(db.prepare(`SELECT 1 FROM watch_events WHERE watch_id=? AND kind='unmet'`).get(id), '조건 충족이 풀렸다고 기록');
  // 운영자가 같은 상품 페이지로 확인해야 조건 충족 알림
  W.confirmPage(db, id, true, '운영자', policy);
  const n = db.prepare('SELECT * FROM notifications WHERE user_id=?').all(u.id) as any[];
  assert.equal(n.length, 1); assert.equal(n[0].kind, 'watch_met');
});

// ── 3 · 새 매물 알림 조건 ──────────────────────────────────────────
const offer = (over: Partial<ProductOffer> = {}): Pick<ProductOffer, 'options' | 'name' | 'condition' | 'stock' | 'price' | 'salePrice' | 'shipping'> => ({
  name: 'BADBLOOD Mystic Nylon Track Jacket Navy W-JKT26-055', condition: 'new', stock: 'in_stock', price: 150000, salePrice: null, shipping: 3000,
  options: [{ color: 'Navy', size: 'M', stock: 'in_stock', price: null }], ...over });
const want = (over: Partial<WatchWant> = {}): WatchWant => ({ size: 'M', color: '네이비', condition: 'new', targetPrice: 180000, basis: 'total', ...over });
test('[리뷰 3] 기다려줘 조건 — 색상·재고·사이즈·상품 상태·배송비 포함 목표가를 모두 확인해야 met, 모르는 값은 unknown', () => {
  const ok = fitOf(offer(), want());
  assert.equal(ok.state, 'met'); assert.deepEqual(ok.met, ['네이비 색상', 'M 재고 있음', '새 상품', '배송비 포함 153,000원']);
  // 확인하지 못한 값 → unknown(충족 아님)
  assert.deepEqual(fitOf(offer({ shipping: null }), want()).unknown, ['상품가 150,000원은 원하는 가격 이하지만 배송비를 확인하지 못했어요']);
  assert.equal(fitOf(offer({ options: [{ color: '', size: 'M', stock: 'in_stock', price: null }], name: 'BADBLOOD Track Jacket' }), want()).state, 'unknown', '색을 옵션·상품명 어디서도 못 봄');
  assert.equal(fitOf(offer({ condition: 'unknown' }), want()).state, 'unknown', '새 상품만 원했는데 상태를 모름');
  assert.equal(fitOf(offer({ options: [], stock: 'in_stock' }), want()).state, 'unknown', '사이즈별 재고가 없음');
  assert.equal(fitOf(offer({ options: [{ color: 'Navy', size: 'M', stock: 'unknown', price: null }] }), want()).state, 'unknown');
  assert.equal(fitOf(offer({ price: 189000, salePrice: 170100 }), want()).state, 'unknown', '할인가만 목표 이하(적용 조건 미확인)');
  assert.equal(fitOf(offer({ price: null }), want()).state, 'unknown');
  // 다른 값 → unmet
  assert.equal(fitOf(offer({ options: [{ color: 'Black', size: 'M', stock: 'in_stock', price: null }] }), want()).state, 'unmet');
  assert.equal(fitOf(offer({ options: [{ color: 'Navy', size: 'L', stock: 'in_stock', price: null }] }), want()).state, 'unmet', '원하는 사이즈 옵션 없음');
  assert.equal(fitOf(offer({ options: [{ color: 'Navy', size: 'M', stock: 'sold_out', price: null }] }), want()).state, 'unmet');
  assert.equal(fitOf(offer({ condition: 'used' }), want()).state, 'unmet');
  assert.equal(fitOf(offer({ price: 179000 }), want()).state, 'unmet', '배송비 포함 182,000원');
  // 배송비 제외를 고르면 상품가만 · 중고도 괜찮으면 상태는 보지 않는다
  assert.equal(fitOf(offer({ price: 179000, shipping: null }), want({ basis: 'item' })).state, 'met');
  assert.equal(fitOf(offer({ condition: 'used' }), want({ condition: 'any' })).state, 'met');
});

async function watchSetup(target: string, over: { color?: string } = {}) {
  const { db, u, id: rid } = await request('[테스트:정확]');
  F.publishFind(db, rid, { items: [{ aiIdentityId: F.findDraft(db, rid).identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  const { productId } = F.confirmFind(db, u.id, rid, F.findView(db, D.getRequest(db, rid)).match!.id, 'watch');
  const wid = W.createWatch(db, u.id, { productId, requestId: rid, targetPrice: target, size: 'M', color: over.color }, policy);
  S.queueDiscovery(db, env(), wid); await runAll(db);
  const sid = S.latestSearchesFor(db, wid, 'discovery', 1)[0].id;
  const by = (url: string) => offersOf(db, sid).find(o => o.url === `mock://shop/${url}`)!;
  const w = () => db.prepare('SELECT * FROM watches WHERE id=?').get(wid) as any;
  const notis = () => db.prepare('SELECT kind, title, body FROM notifications WHERE user_id=? AND watch_id=? ORDER BY id').all(u.id, wid) as any[];
  return { db, u, wid, by, w, notis };
}
test('[리뷰 3] 새 매물: 확인 못 한 조건이 있으면 알림 없음 · possible 은 확정 알림과 다른 종류·문구', async () => {
  const { db, u, wid, by, w, notis } = await watchSetup('180000');
  // 공식몰: 판매가 189,000+3,000 > 180,000 · 할인가 170,100만 목표 이하 → 확인 못 함
  R.reviewOffer(db, by('official-055-navy').id, 'exact', {}, '운영자');
  // 편집숍: 배송비 모름
  R.reviewOffer(db, by('select-mystic-navy').id, 'exact', { reason: '품번 태그 사진이 공식몰과 같음(운영자 확인)' }, '운영자');
  assert.equal(notis().length, 0, '조건을 모두 확인하지 못하면 알리지 않는다');
  const ev = db.prepare(`SELECT detail FROM watch_events WHERE watch_id=? AND kind='discovery_published' ORDER BY id`).all(wid) as any[];
  assert.match(ev[0].detail, /확인하지 못한 조건: 표시된 할인가 170,100원은 적용 조건/);
  assert.match(ev[1].detail, /배송비를 확인하지 못했어요/);
  // 중고마켓(124,000원 · M 재고 · 중고 괜찮음) — 같은 상품일 수 있음으로 공개 → 확정 알림이 아닌 별도 알림
  R.reviewOffer(db, by('used-055').id, 'possible', {}, '운영자');
  const n = notis();
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'watch_discovery_possible');
  assert.equal(n[0].title, '같은 옷일 수 있는 매물이 있어요');
  assert.match(n[0].body, /배송비 포함 124,000원/); assert.match(n[0].body, /아직 확정하지 못했어요/);
  assert.ok(!/확인했어요|구매 가능/.test(n[0].body + n[0].title), '확정처럼 말하지 않는다');
  const v2 = X.watchExtrasView(db, w(), 'http://h', env(), u.id);
  const card = (seller: string) => v2.discovery.items.find(c => c.seller === seller)!;
  assert.equal(card('테스트 공식몰').meetsTarget, false);
  assert.match(card('테스트 공식몰').targetNote!, /^확인하지 못한 조건 · 표시된 할인가/);
  assert.equal(card('테스트 중고마켓').meetsTarget, true);
  // 같은 페이지를 다시 공개해도 알림은 한 번
  R.reviewOffer(db, by('used-055').id, 'possible', {}, '운영자');
  assert.equal(notis().length, 1);
});
test('[리뷰 3] 새 매물: 원하는 색이 아니면 확정(exact)이어도 알림 없음 · 운영자 화면에는 이유', async () => {
  const { db, by, notis } = await watchSetup('180000', { color: '블랙' });
  R.reviewOffer(db, by('used-055').id, 'exact', {}, '운영자');
  assert.equal(notis().length, 0);
  const log = db.prepare(`SELECT auto FROM review_log WHERE subject='offer' ORDER BY id DESC LIMIT 1`).get() as any;
  const fit = JSON.parse(log.auto).fit;
  assert.equal(fit.state, 'unmet'); assert.deepEqual(fit.unmet, ['원하는 색(블랙)이 아니에요']);
});

// ── 4 · 이전 버전 계정 ─────────────────────────────────────────────
async function api(db: any) {
  const app = express(); app.use('/api', userApi(db, { uploads: '/tmp', pushConfigured: false, policy }), apiErrors);
  const srv = app.listen(0); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}/api`;
  const call = async (method: string, path: string, opts: { device?: string; token?: string; body?: unknown } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(opts.device ? { 'x-walf-device': opts.device } : {}), ...(opts.token ? { 'x-walf-token': opts.token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) as any };
  };
  return { call, close: () => srv.close() };
}
test('[리뷰 4] 토큰 없는 이전 버전 계정은 기기 ID만으로 열 수 없다 — 세션 열기·API 모두 거절', async () => {
  setClock(T0);
  const db = openDb(':memory:');
  const legacy = D.upsertUser(db, 'device-legacy-0001', 'ios');
  D.createRequest(db, legacy.id, { photo: 'x.jpg', note: '예전 의뢰', size: 'M' }, { isMock: true });
  const { call, close } = await api(db);
  try {
    assert.deepEqual([(await call('GET', '/me', { device: 'device-legacy-0001' })).status, (await call('GET', '/me', { device: 'device-legacy-0001' })).json.error], [401, 'bad_token']);
    const s = await call('POST', '/session', { body: { deviceId: 'device-legacy-0001', platform: 'ios' } });
    assert.equal(s.status, 401); assert.equal(s.json.error, 'legacy_locked'); assert.equal(s.json.token, undefined, '토큰을 주지 않는다');
    assert.equal((db.prepare('SELECT token_hash FROM users WHERE id=?').get(legacy.id) as any).token_hash, null, '아무도 토큰을 받지 못했다');
    assert.equal((await call('GET', `/requests/1`, { device: 'device-legacy-0001' })).status, 401);
    // 새 기기는 평소처럼 토큰을 받고, 이전 기록은 보이지 않는다
    const fresh = await call('POST', '/session', { body: { deviceId: 'device-fresh-0001', platform: 'ios' } });
    assert.ok(fresh.json.token);
    const me = await call('GET', '/me', { device: 'device-fresh-0001', token: fresh.json.token });
    assert.equal(me.status, 200); assert.notEqual(me.json.user.id, legacy.id);
  } finally { close(); }
});
test('[리뷰 4] 이어받기 코드: 운영자가 만든 코드로만 · 한 번만 · 30분 · 틀린 코드·새 기록이 있으면 거절 · 시도 제한', async () => {
  setClock(T0);
  const db = openDb(':memory:');
  const legacy = D.upsertUser(db, 'device-legacy-0002', 'ios');
  const rid = D.createRequest(db, legacy.id, { photo: 'x.jpg', note: '예전 의뢰', size: 'M' }, { isMock: true });
  db.prepare(`UPDATE users SET push_token='ExponentPushToken[old]' WHERE id=?`).run(legacy.id);
  const { call, close } = await api(db);
  try {
    const a = (await call('POST', '/session', { body: { deviceId: 'device-new-0002' } })).json.token;
    const asA = { device: 'device-new-0002', token: a };
    assert.equal((await call('POST', '/session/claim', { ...asA, body: { code: 'ABCD-EFGH' } })).json.error, 'bad_code', '운영자가 만들지 않은 코드');
    assert.throws(() => D.issueClaimCode(db, D.userByDevice(db, 'device-new-0002')!.id, '운영자'), /이미 토큰 세션/);
    const { code } = D.issueClaimCode(db, legacy.id, '운영자');
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.notEqual((db.prepare('SELECT claim_hash FROM users WHERE id=?').get(legacy.id) as any).claim_hash, code.replace('-', ''), '코드는 해시만 저장');
    const ok = await call('POST', '/session/claim', { ...asA, body: { code: code.toLowerCase() } });
    assert.equal(ok.status, 200); assert.equal(ok.json.userId, legacy.id);
    const me = await call('GET', '/me', asA);
    assert.equal(me.json.user.id, legacy.id, '이 기기 세션이 이전 계정으로');
    assert.equal((await call('GET', `/requests/${rid}`, asA)).status, 200, '이전 기록이 보인다');
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(legacy.id) as any;
    assert.deepEqual([row.device_id, row.claim_hash, row.push_token], ['device-new-0002', null, null]);
    // 다시 쓸 수 없다 · 이전 기기 ID로는 여전히 이전 기록을 못 연다(새 빈 계정이 된다)
    const b = (await call('POST', '/session', { body: { deviceId: 'device-new-0003' } })).json.token;
    assert.equal((await call('POST', '/session/claim', { device: 'device-new-0003', token: b, body: { code } })).json.error, 'bad_code');
    const old = await call('POST', '/session', { body: { deviceId: 'device-legacy-0002' } });
    const oldMe = await call('GET', '/me', { device: 'device-legacy-0002', token: old.json.token });
    assert.notEqual(oldMe.json.user.id, legacy.id);
    // 만료
    const legacy2 = D.upsertUser(db, 'device-legacy-0003', 'ios');
    const c2 = D.issueClaimCode(db, legacy2.id, '운영자');
    setClock(T0 + D.CLAIM_TTL + 1000);
    assert.equal((await call('POST', '/session/claim', { device: 'device-new-0003', token: b, body: { code: c2.code } })).json.error, 'bad_code', '30분 지나면 못 쓴다');
    // 지금 기기에 새 기록이 있으면 섞지 않는다
    const c3 = D.issueClaimCode(db, legacy2.id, '운영자');
    D.createRequest(db, D.userByDevice(db, 'device-new-0003')!.id, { photo: 'y.jpg', note: '새 의뢰', size: 'L' }, { isMock: true });
    const busy = await call('POST', '/session/claim', { device: 'device-new-0003', token: b, body: { code: c3.code } });
    assert.equal(busy.status, 409); assert.equal(busy.json.error, 'has_data');
    // 시도 제한(사용자당 10분에 5번)
    for (let i = 0; i < 2; i++) await call('POST', '/session/claim', { device: 'device-new-0003', token: b, body: { code: 'ZZZZ-ZZZZ' } });
    assert.equal((await call('POST', '/session/claim', { device: 'device-new-0003', token: b, body: { code: c3.code } })).status, 429);
    // 기록: 코드 발급·이어받기는 남기되 평가 데이터 내보내기에는 넣지 않는다
    assert.deepEqual((db.prepare(`SELECT action FROM review_log WHERE subject='account' ORDER BY id`).all() as any[]).map(x => x.action), ['claim_code', 'claimed', 'claim_code', 'claim_code']);
    assert.ok(!FB.exportReviews(db, { mock: true }).some((x: any) => x.subject === 'account'));
  } finally { close(); }
});

// ── 5 · 여러 식별 후보 ─────────────────────────────────────────────
test('[리뷰 5] AI 첫 후보(품번 W-JKT26-056)가 틀려도 두 번째 후보(055)로 같은 상품을 찾는다 — 후보 3개까지·검색어·상세 한도', async () => {
  const { db, u, id } = await request('[테스트:첫후보틀림]');
  const ts = S.targetsToSearch(db, id, env());
  assert.deepEqual(ts.map(t => [t.basis, t.modelCode]), [['ai_draft', 'W-JKT26-056'], ['ai_draft', 'W-JKT26-055']]);
  assert.equal(S.targetsToSearch(db, id, env({ maxTargets: 1 })).length, 1, '한도 1이면 첫 후보만');
  S.queueFindSearch(db, env(), id); await runAll(db);
  const s = S.latestSearches(db, id, 1)[0];
  const r = S.searchResultOf(db, s);
  assert.equal(r.candidates.length, 2);
  assert.deepEqual([r.candidates[0].same, r.candidates[1].same], [0, 2], '첫 후보로는 품번 일치 없음 · 두 번째 후보로 2곳');
  const off = (u: string) => offersOf(db, s.id).find(o => o.url === `mock://shop/${u}`)!;
  assert.deepEqual([off('official-055-navy').verdict, off('official-055-navy').targetRank, off('official-055-navy').targetRef], ['same_code', 2, `ai_identity:${F.findDraft(db, id).identities[1].id}`]);
  assert.equal(off('official-054-bluegray').verdict, 'different');
  assert.match(s.summary, /식별 후보 2개 탐색/);
  const qs = JSON.parse(s.queries) as any[];
  assert.ok(qs.filter(q => q.target === 2).length <= 3, '두 번째 후보부터는 검색어 3개까지');
  assert.ok(offersOf(db, s.id).filter(o => o.detail === 'fetched').length <= 6, '상세 확인은 후보 합쳐 한도 안');
  // 사용자가 “이 옷이 맞아요”로 고르면 그 후보 하나만 찾는다
  F.publishFind(db, id, { items: F.findDraft(db, id).identities.map(x => ({ aiIdentityId: x.id, tier: 'likely' as const })), discover: [] }, '운영자');
  const second = F.findView(db, D.getRequest(db, id)).likely.find(x => x.modelCode === 'W-JKT26-055')!;
  F.confirmFind(db, u.id, id, second.id, 'save');
  assert.deepEqual(S.targetsToSearch(db, id, env()).map(t => [t.basis, t.modelCode]), [['user_confirmed', 'W-JKT26-055']]);
});

// ── 제품: 단종 · 품번 없음 · 정확한 상품 없음 · 실제/테스트 구분 ─────────────
async function pipeline(target: S.SearchTarget, w: S.Want = { size: 'M', color: null, usedOk: true, maxPrice: null }) {
  const c = ctx();
  const found = await S.searchSources([mockSource], target, S.buildQueries(target), c);
  const offers = (await S.normalizeHits(S.mergeHits(found.hits), target, [mockSource], c, 10)).map(o => S.verifyOffer(target, o, w));
  return S.assemble(target, offers, found.report);
}
const T = (over: Partial<S.SearchTarget>): S.SearchTarget => ({ brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', modelCode: null, season: null, color: null, category: '아우터',
  basis: 'operator_published', ref: 't', aliases: ['배드블러드'], isMock: true, ...over });
test('[제품] 단종(판매 종료) — 같은 상품 페이지는 있어도 원하는 사이즈 품절, 카드·알림 조건에 그대로 보인다 · 페이지가 아예 없으면 “못 찾음”(매물 없음 확정 아님)', async () => {
  const r = await pipeline(T({ name: 'Archive Coach Jacket', modelCode: 'W-JKT19-012' }));
  assert.equal(r.sale.same.length, 1);
  const o = r.sale.same[0];
  assert.deepEqual([o.verdict, o.wantSize, o.stock], ['same_code', 'sold_out', 'sold_out']);
  assert.ok(o.diffPoints.includes('M 사이즈는 품절이에요'));
  assert.equal(fitOf(o, want({ color: null, condition: 'any', targetPrice: 300000 })).state, 'unmet');
  const c = R.card({ ...o, id: 1, publishTier: 'exact', reviewNote: null } as StoredOffer, { size: 'M', color: null, usedOk: true }, 'http://h');
  assert.deepEqual(c.facts.find(f => f.kind === 'size'), { kind: 'size', state: 'no', text: 'M 품절' });
  const gone = await pipeline(T({ name: 'Old Bomber Jacket', modelCode: 'W-JKT18-999' }));
  assert.equal(gone.sale.state, 'none');
  assert.ok(gone.sources.every(x => x.outcome === 'empty'), '검색은 했고 결과가 없었다(검색하지 않은 것과 구분)');
});
test('[제품] 품번 없는 상품 — 상품명이 같아도 “가능성 높음”까지(확정하려면 운영자 근거 필요) · 기다려줘도 확정 알림 없음', async () => {
  const r = await pipeline(T({ modelCode: null }));
  assert.equal(r.sale.same.length, 0, '품번이 없으면 same_code 없음');
  assert.ok(r.sale.likely.some(o => o.url === 'mock://shop/official-055-navy'));
  assert.equal(r.sale.state, 'possible_only');
  assert.equal(W.pageIdentity({ title: 'Mystic Nylon Track Jacket', brand: 'BADBLOOD', page_identity: 'pending' }, undefined, { title: 'BADBLOOD Mystic Nylon Track Jacket Navy', brand: 'BADBLOOD' }).identity, 'likely');
});
test('[제품] 정확한 상품이 없음 — 비슷한 이름의 다른 품번 페이지는 “다른 상품”, 같은 상품 0', async () => {
  const r = await pipeline(T({ name: 'Mystic Nylon Track Jacket', modelCode: 'W-JKT26-099' }));
  assert.equal(r.sale.same.length, 0);
  for (const u of ['official-055-navy', 'official-054-bluegray', 'used-055']) assert.equal(r.sale.different.find(o => o.url === `mock://shop/${u}`)?.verdict, 'different', u);
  assert.notEqual(r.sale.state, 'found_same');
});
test('[제품] 결과 화면: 테스트 판매처뿐이면 그렇게 · 실제 판매처가 1곳뿐이면 그 한계를 그대로 · 카드가 모두 테스트면 dataKind=test', async () => {
  // 모의 의뢰 — 테스트 판매처만
  const { db, id } = await request('[테스트:정확]');
  F.publishFind(db, id, { items: [{ aiIdentityId: F.findDraft(db, id).identities[0].id, tier: 'match' }], discover: [] }, '운영자');
  S.queueFindSearch(db, env(), id); await runAll(db);
  const cov = S.coverageOf(db, id, env())!;
  assert.equal(cov.kind, 'test'); assert.match(cov.note, /테스트 판매처\(가상의 상점·가격\)에서만 찾았어요/);
  const s = S.latestSearches(db, id, 1)[0];
  R.reviewOffer(db, offersOf(db, s.id).find(o => o.url === 'mock://shop/official-055-navy')!.id, 'exact', {}, '운영자');
  const view = F.findView(db, D.getRequest(db, id), 'http://h', cov);
  assert.equal(view.sale.dataKind, 'test'); assert.equal(view.sale.coverage!.kind, 'test');
  assert.deepEqual(view.sale.exact[0].facts.map(f => f.kind), ['color', 'size', 'condition']);
  // 실제 의뢰(BADBLOOD) — 탐색 전에도 “실제 판매처 1곳뿐”과 연결 준비 중인 곳을 말한다
  const real = await request('실제 의뢰', { mock: false, device: 'device-review-real' });
  real.db.prepare(`INSERT INTO product_identities(request_id, tier, rank, brand, name, model_code, status, is_mock, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(real.id, 'match', 1, 'BADBLOOD', 'Mystic Nylon Track Jacket', 'W-JKT26-055', 'published', 0, T0);
  const rc = S.coverageOf(real.db, real.id, env())!;
  assert.equal(rc.kind, 'real'); assert.deepEqual(rc.real, ['BADBLOOD 공식몰']);
  assert.match(rc.note, /^지금 자동으로 찾아보는 실제 판매처는 BADBLOOD 공식몰 1곳뿐이에요\. 네이버 쇼핑·KREAM·중고나라 등 \d곳은 연결을 준비하고 있어 아직 찾지 않아요\.$/);
  // 공식몰이 등록되지 않은 브랜드 — 찾아볼 수 있는 실제 판매처가 없다고
  assert.match(S.coverageOf(real.db, real.id, env({ malls: [] }))!.note, /^이 옷은 아직 자동으로 찾아볼 수 있는 실제 판매처가 없어요/);
});
