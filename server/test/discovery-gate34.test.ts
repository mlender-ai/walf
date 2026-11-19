// Discovery Upgrade Gate 3·4 — 허용 목록 · 판매처 판정 · 상품 상태 5분류 · 통화·환율 · 판매 예정 일정 · 지시서 §9 QA 기준
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as W from '../src/watch.ts';
import * as S from '../src/sources.ts';
import { conditionOf, CONDITION_LABEL } from '../src/catalog.ts';
import { fitOf } from '../src/offers.ts';
import { latestFx, recordFx, FX_MAX_AGE } from '../src/fx.ts';
import { addRelease, cancelRelease } from '../src/release.ts';
import { setClock, DAY, HOUR } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 20, 1, 0); // 2026-11-20 10:00 KST
const MALL: S.PageHost = { domain: 'badblood.co.kr', label: 'BADBLOOD 공식몰', checked: '2026-11-09', basis: 'test' };
const policy: W.WatchPolicy = { maxActive: 3, checkEveryMs: DAY, renewAfterMs: 30 * DAY, unreachableAfter: 3, maxAttempts: 3, leaseMs: 120_000, mockAllowed: true, pageHosts: [MALL] };
const notis = (db: any, uid: number) => db.prepare('SELECT kind, title, body FROM notifications WHERE user_id=? ORDER BY id').all(uid) as any[];
const watch = (db: any, id: number) => db.prepare('SELECT * FROM watches WHERE id=?').get(id) as any;
function setup(p = policy) {
  setClock(T0);
  const db = openDb(':memory:');
  let fetched: string[] = [];
  const checker = W.createChecker(db, p, { fetchPage: async u => { fetched.push(u); throw new S.SourceError('timeout', '테스트: 열지 않아야 하는 페이지'); }, fixture: S.fixtureSnapshot });
  return { db, u: D.upsertUser(db, 'device-gate34-0001', 'ios'), u2: D.upsertUser(db, 'device-gate34-0002', 'ios'), checker, fetched: () => fetched };
}

// ── 1 · 링크 자동 확인은 허용 목록만 ──
test('[허용 목록] 운영자가 확인한 판매처(공식몰·page-hosts)만 연다 — 목록 밖·제휴 필요·약관 금지는 열지 않는다', () => {
  const hosts = [MALL, { domain: 'shop.example.com', label: '테스트 상점', checked: '2026-11-20', basis: 'test' }];
  assert.equal(S.sourceFor('https://badblood.co.kr/product/x/1/', { hosts }).ok, true);
  assert.equal(S.sourceFor('https://m.shop.example.com/p/1', { hosts }).ok, true, '하위 도메인 포함');
  const unknown = S.sourceFor('https://random-vintage.example.jp/item/1', { hosts });
  assert.equal(unknown.ok, false); assert.equal(unknown.reason, S.NOT_ALLOWED, '공개 페이지라는 이유만으로 열지 않는다');
  for (const [u, id, access] of [['https://jp.mercari.com/item/m123', 'mercari', 'partner_required'], ['https://www.ebay.com/itm/1', 'ebay', 'partner_required'], ['https://zozo.jp/shop/x/goods/1/', 'zozoused', 'partner_required'],
    ['https://www.2ndstreet.jp/goods/detail/1', '2ndstreet', 'unverified'], ['https://www.29cm.co.kr/products/1', '29cm', 'partner_required'], ['https://fruitsfamily.com/product/1', 'fruitsfamily', 'link_only'],
    ['https://m.bunjang.co.kr/products/1', 'bunjang', 'prohibited']] as const) {
    const r = S.sourceFor(u, { hosts });
    assert.equal(r.ok, false, `${id}는 열지 않는다`); assert.equal(r.source.id, id); assert.equal(r.source.access, access);
  }
  // 기본 허용 목록 = seed/page-hosts.json(비어 있음) + seed/official-malls.json(BADBLOOD)
  assert.deepEqual(S.loadPageHosts({} as any).map(h => h.domain), ['badblood.co.kr']);
});

test('[허용 목록] 목록 밖 링크로 등록하면 확인 필요로 두고 페이지를 열지 않는다', async () => {
  const { db, u, checker, fetched } = setup();
  const id = W.createWatch(db, u.id, { productUrl: 'https://jp.mercari.com/item/m999', productName: '테스트 재킷', targetPrice: '150000' }, policy);
  assert.equal(watch(db, id).status, 'needs_info');
  assert.match(watch(db, id).info_note, /Mercari은\(는\) 자동 확인을 지원하지 않아요/);
  W.tickWatches(db, policy); while (await checker.step()) { /* */ }
  assert.deepEqual(fetched(), []);
  const id2 = W.createWatch(db, u.id, { productUrl: 'https://shop.unknown-select.example/p/1', productName: '테스트 니트', targetPrice: '90000' }, policy);
  assert.equal(watch(db, id2).info_note, S.NOT_ALLOWED);
  // 운영자도 허용 목록 밖 페이지는 연결할 수 없다
  assert.throws(() => W.attachUrl(db, id2, 'https://www.ebay.com/itm/1', '운영자', policy), /eBay/);
});

test('[허용 목록] 이미 감시 중인 링크가 허용 목록에서 빠지면 다음 확인 전에 멈추고 왈프 팀 확인으로 돌린다(대기열에 든 조회도 열지 않음)', async () => {
  const wide = { ...policy, pageHosts: [MALL, { domain: 'shop.example.com', label: '테스트 상점', checked: '2026-11-20', basis: 'test' }] };
  const { db, u, fetched } = setup(wide);
  const a = W.createWatch(db, u.id, { productUrl: 'https://shop.example.com/product/1', productName: 'A', targetPrice: '150000' }, wide);
  const b = W.createWatch(db, u.id, { productUrl: 'https://shop.example.com/product/2', productName: 'B', targetPrice: '150000' }, wide);
  assert.equal(watch(db, a).status, 'active');
  // a: 대기열에 들어간 뒤 목록에서 빠짐 → 조회 워커가 열지 않는다
  W.tickWatches(db, wide);
  const narrow = { ...policy };
  const checker = W.createChecker(db, narrow, { fetchPage: async x => { fetched().push(x); throw new Error('x'); }, fixture: S.fixtureSnapshot });
  while (await checker.step()) { /* */ }
  assert.deepEqual(fetched(), [], '허용 목록에서 빠진 페이지는 열지 않는다');
  for (const id of [a, b]) { assert.equal(watch(db, id).status, 'needs_info'); assert.equal(watch(db, id).source, null); assert.equal(watch(db, id).info_note, S.NOT_ALLOWED); }
  assert.equal(notis(db, u.id).filter(n => n.kind === 'watch_unreachable').length, 0, '조회 실패로 세지 않는다');
  // 다음 날 스케줄러도 다시 줄 세우지 않는다
  setClock(T0 + DAY); const r = W.tickWatches(db, narrow);
  assert.equal(r.queued, 0);
});

// ── 2 · 상품 상태 5분류 ──
test('[상품 상태] 판매처가 중고 플랫폼이라고 모두 중고로 두지 않는다 · 미사용·단종 신품 재고·중고·미확인 구분', () => {
  assert.equal(conditionOf('BADBLOOD 트랙 자켓 미사용 택포함', null, 'used'), 'unused');
  assert.equal(conditionOf('バッドブラッド ジャケット 未使用', 'used', 'used'), 'unused');
  assert.equal(conditionOf('Track Jacket DEADSTOCK 2019', 'new', 'retail'), 'deadstock');
  assert.equal(conditionOf('트랙 자켓 M 사이즈', null, 'used'), 'unknown', '중고 플랫폼이라도 표기가 없으면 미확인');
  assert.equal(conditionOf('트랙 자켓 중고 사용감 있음', null, 'used'), 'used');
  assert.equal(conditionOf('트랙 자켓 새상품', null, 'official'), 'new');
  assert.equal(conditionOf('트랙 자켓', 'new', 'official'), 'new');
  // “새 상품만”: 미사용·단종 신품 재고는 조건 충족(카드에 구분 표시) · 중고는 불충족 · 미확인은 확인 못 함
  const want = { size: null, color: null, condition: 'new' as const, targetPrice: 200000, basis: 'item' as const };
  const o = (condition: any) => ({ options: [], name: 'x', condition, stock: 'in_stock' as const, price: 150000, salePrice: null, shipping: 0, currency: 'KRW' });
  assert.equal(fitOf(o('unused'), want).state, 'met'); assert.ok(fitOf(o('unused'), want).met.includes(CONDITION_LABEL.unused));
  assert.equal(fitOf(o('deadstock'), want).state, 'met');
  assert.equal(fitOf(o('used'), want).state, 'unmet');
  assert.equal(fitOf(o('unknown'), want).state, 'unknown');
});

// ── 3 · 통화·환율 ──
test('[통화] 엔화 페이지는 환율 확인 전에는 원하는 가격(원)과 비교하지 않는다 · 통화를 모르면 비교하지 않는다', () => {
  const ld = { '@type': 'Product', name: 'テスト ジャケット', offers: { '@type': 'Offer', price: '15000', priceCurrency: 'JPY', availability: 'InStock' } };
  const jp = S.parseProductPage(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`, 'https://shop.example.jp/p/1');
  assert.equal(jp.currency, 'JPY'); assert.equal(jp.price, 15000);
  const ev = W.evaluate({ size: null, color: null, target_price: 150000, condition: 'any' }, { ...jp, shipping: 0 }, 'page_defined');
  assert.equal(ev.state, 'no_price', '15,000엔을 15,000원으로 보고 “목표가 이하”라고 하지 않는다');
  assert.match(ev.reasons[0], /JPY 가격이라 환율/);
  const bare = S.parseProductPage(`<script type="application/ld+json">{"@type":"Product","name":"x","offers":{"price":"9000","availability":"InStock"}}</script>`, 'https://shop.example.com/p/1');
  assert.equal(bare.currency, null);
  assert.match(W.evaluate({ size: null, color: null, target_price: 150000, condition: 'any' }, { ...bare, shipping: 0 }, 'page_defined').reasons[0], /통화를 확인하지 못했어요/);
  const kr = S.parseProductPage(`<script type="application/ld+json">{"@type":"Product","name":"x","offers":{"price":"9000","availability":"InStock"}}</script>`, 'https://shop.example.co.kr/p/1');
  assert.equal(kr.currency, 'KRW', '국내(.kr) 쇼핑몰은 원화');
});

test('[환율] 출처·기준 시각이 있는 최근(3일 이내) 환율로만 바꿔 비교 · 해외 배송비·관부가세는 확인 못 함', () => {
  setClock(T0);
  const db = openDb(':memory:');
  assert.throws(() => recordFx(db, { currency: 'JPY', krw: 920, unit: 100, source: '', observedAt: T0, by: 'op' }), /출처/);
  assert.throws(() => recordFx(db, { currency: 'KRW', krw: 1, source: 'x', observedAt: T0, by: 'op' }), /외화/);
  const o = { options: [{ color: '', size: 'M', stock: 'in_stock' as const, price: 15000 }], name: 'テスト', condition: 'new' as const, stock: 'in_stock' as const, price: 15000, salePrice: null, shipping: 1000, currency: 'JPY' };
  const item = { size: 'M', color: null, condition: 'any' as const, targetPrice: 150000, basis: 'item' as const };
  assert.equal(fitOf(o, item, latestFx(db, 'JPY')).state, 'unknown', '환율이 없으면 확인 못 함');
  assert.match(fitOf(o, item, null).unknown[0], /JPY 가격이라 환율을 확인한 뒤/);
  recordFx(db, { currency: 'JPY', krw: 920, unit: 100, source: '한국수출입은행 고시(테스트)', observedAt: T0 - HOUR, by: 'op' });
  const fx = latestFx(db, 'JPY')!;
  assert.equal(fx.krwPerUnit, 9.2);
  const f = fitOf(o, item, fx);
  assert.equal(f.state, 'met', '15,000엔 × 9.2 = 138,000원 ≤ 150,000원(배송비 제외 기준)');
  assert.match(f.met.join(' '), /상품가 138,000원.*환율 100JPY=920원\(11\/20 09:00 · 한국수출입은행 고시\(테스트\)\)/);
  const total = fitOf(o, { ...item, basis: 'total' }, fx);
  assert.equal(total.state, 'unknown'); assert.ok(total.unknown.some(x => /관부가세/.test(x)), '배송비 포함 기준이면 해외 비용을 모른다');
  setClock(T0 + FX_MAX_AGE + HOUR);
  assert.equal(latestFx(db, 'JPY'), null, '오래된 환율은 쓰지 않는다');
});

// ── 4 · 판매 예정(재발매) 일정 ──
test('[판매 예정] 공식 발표 근거가 있어야 등록 · 일정 알림과 재고 알림은 따로 · 시작 시각에 허용된 페이지만 한 번 확인', async () => {
  const { db, u, checker } = setup();
  const id = W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', productName: '테스트 트랙 자켓', size: 'M', targetPrice: '150000' }, policy);
  assert.throws(() => addRelease(db, id, { seller: 'ZOZOUSED', startsAt: T0 + DAY, announcedUrl: '' }, '운영자'), /공식 발표 주소/);
  assert.throws(() => addRelease(db, id, { seller: 'ZOZOUSED', startsAt: T0 - 3 * HOUR, announcedUrl: 'https://example.com/news/1' }, '운영자'), /이미 지난 일정/);
  const rid = addRelease(db, id, { seller: 'ZOZOUSED', startsAt: T0 + DAY, announcedUrl: 'https://example.com/news/1', note: '선착순' }, '운영자');
  assert.deepEqual(notis(db, u.id).map(n => n.kind), ['watch_release_scheduled']);
  assert.match(notis(db, u.id)[0].body, /판매를 시작한다고 발표했어요. 재고·가격은 시작 후 확인/);
  assert.ok(!/구매 가능/.test(notis(db, u.id)[0].body));
  const view = W.watchView(db, watch(db, id), 'http://x', policy);
  assert.equal(view.releases[0].status, 'scheduled'); assert.match(view.releases[0].label, /판매 시작 예정\(공식 발표\)/);
  // 시작 시각 전: 아무 일 없음 · 시작 시각: 시작 알림 + 일정용 확인 한 번(하루 1회 확인과 별도)
  setClock(T0 + DAY - HOUR); W.tickWatches(db, policy); while (await checker.step()) { /* */ }
  assert.equal(notis(db, u.id).filter(n => n.kind === 'watch_release_started').length, 0);
  setClock(T0 + DAY + 60_000); const r = W.tickWatches(db, policy);
  assert.equal(r.releasesStarted, 1);
  assert.ok(db.prepare(`SELECT 1 FROM price_checks WHERE slot=?`).get(`release:${rid}`), '시작 시각에 한 번 확인');
  const started = notis(db, u.id).filter(n => n.kind === 'watch_release_started');
  assert.equal(started.length, 1); assert.match(started[0].body, /재고와 가격은 아직 확인 전이에요/);
  W.tickWatches(db, policy);
  assert.equal(notis(db, u.id).filter(n => n.kind === 'watch_release_started').length, 1, '시작 알림은 한 번');
  assert.throws(() => cancelRelease(db, rid, '운영자', '취소'), /이미 시작했거나/);
});

test('[판매 예정] 허용 목록 밖 페이지의 기다려줘는 시작 시각에도 페이지를 열지 않는다(알림만)', () => {
  const { db, u } = setup();
  const id = W.createWatch(db, u.id, { productUrl: 'https://zozo.jp/shop/x/goods/1/', productName: '아카이브 재킷', targetPrice: '250000' }, policy);
  const rid = addRelease(db, id, { seller: 'ZOZOUSED', startsAt: T0 + HOUR, announcedUrl: 'https://example.com/news/2' }, '운영자');
  setClock(T0 + 2 * HOUR); W.tickWatches(db, policy);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM price_checks WHERE slot=?`).get(`release:${rid}`)!.n, 0);
  assert.equal(notis(db, u.id).filter(n => n.kind === 'watch_release_started').length, 1);
});

// ── 5 · 지시서 §9 QA 기준 ──
test('[QA] 서로 다른 사용자의 감시 조건을 섞지 않는다 — 같은 페이지는 한 번만 읽고 사용자마다 따로 판정', async () => {
  const { db, u, u2, checker } = setup();
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/sold-out', productName: '테스트 트랙 자켓', size: 'M', targetPrice: '150000' }, policy);
  const b = W.createWatch(db, u2.id, { productUrl: 'mock://fixture/sold-out', productName: '테스트 트랙 자켓', size: 'L', targetPrice: '100000' }, policy);
  for (const id of [a, b]) W.confirmPage(db, id, true, '운영자', policy);
  W.tickWatches(db, policy); while (await checker.step()) { /* */ }
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM price_checks WHERE url='mock://fixture/sold-out'`).get()!.n, 1, '같은 페이지는 한 번');
  assert.equal(watch(db, a).last_state, 'sold_out', 'A는 M 품절');
  assert.equal(watch(db, b).last_state, 'above', 'B는 L 재고 있음이지만 목표가 100,000원 위');
  assert.equal(notis(db, u.id).filter(n => /met/.test(n.kind)).length + notis(db, u2.id).filter(n => /met/.test(n.kind)).length, 0);
});

test('[QA] 조회가 실패하면 성공·조건 충족 알림을 보내지 않는다(실패 기록만)', async () => {
  const { db, u, checker } = setup();
  const id = W.createWatch(db, u.id, { productUrl: 'mock://fixture/fetch-fail', productName: '테스트 상품', targetPrice: '150000' }, policy);
  W.confirmPage(db, id, true, '운영자', policy);
  for (let d = 0; d < 3; d++) { setClock(T0 + d * DAY); W.tickWatches(db, policy); while (await checker.step()) { /* */ } }
  const kinds = notis(db, u.id).map(n => n.kind);
  assert.ok(!kinds.some(k => /met|discovery/.test(k)), '실패한 조회로 조건 충족 알림 없음');
  assert.equal(watch(db, id).last_state, 'check_failed');
});
