import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as W from '../src/watch.ts';
import { SourceError, type Snapshot } from '../src/sources.ts';
import { setClock, DAY, HOUR } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 13, 1, 0); // 2026-11-13 10:00 KST
const policy: W.WatchPolicy = { maxActive: 3, checkEveryMs: DAY, renewAfterMs: 30 * DAY, unreachableAfter: 3, maxAttempts: 3, leaseMs: 120_000, mockAllowed: true };

function setup() {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-watch-0001', 'ios');
  return { db, u, checker: W.createChecker(db, policy) };
}
const notis = (db: any, uid: number) => db.prepare('SELECT kind, title, body, push_status, is_mock FROM notifications WHERE user_id=? ORDER BY id').all(uid) as any[];
const watch = (db: any, id: number) => db.prepare('SELECT * FROM watches WHERE id=?').get(id) as any;
/** 하루씩 넘기며 스케줄러 → 조회 한 번 */
async function day(db: any, checker: any, n: number) {
  setClock(T0 + n * DAY);
  W.tickWatches(db, policy);
  while (await checker.step()) { /* 대기열이 빌 때까지 */ }
}

test('기다려줘: 220,000 → 190,000 → 145,000(+배송비 3,000) · 목표 150,000 → 세 번째 확인에서 한 번만 알림', async () => {
  const { db, u, checker } = setup();
  const id = W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', productName: '테스트 트랙 자켓', size: 'M', color: '네이비', targetPrice: '150,000' }, policy);
  assert.equal(watch(db, id).status, 'active');
  assert.equal(watch(db, id).is_mock, 1, '테스트 가격 소스는 항상 모의');
  await day(db, checker, 0);
  assert.equal(watch(db, id).last_state, 'above');
  await day(db, checker, 1);
  assert.equal(watch(db, id).last_state, 'above');
  assert.equal(notis(db, u.id).length, 0, '목표가 위에서는 알리지 않는다');
  await day(db, checker, 2);
  const w = watch(db, id);
  assert.equal(w.last_state, 'met');
  assert.equal(JSON.parse(w.last_result).total, 148000, '배송비를 확인할 수 있으면 상품가+배송비로 비교');
  const n = notis(db, u.id);
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'watch_met');
  assert.equal(n[0].push_status, 'skipped_mock', '모의 데이터는 푸시하지 않는다');
  assert.match(n[0].body, /배송비 포함 총 148,000원/);
  await day(db, checker, 3); // 같은 값이 다시 나와도
  assert.equal(notis(db, u.id).length, 1, '조건이 계속 맞는 동안은 다시 알리지 않는다');
  const v = W.watchView(db, watch(db, id), 'http://x', policy);
  assert.deepEqual(v.history.map(h => h.total).reverse(), [223000, 193000, 148000, 148000], '가격 이력(배송비 포함)');
  assert.equal(v.display.key, 'met');
  assert.ok(v.events.some(e => e.kind === 'price' && e.detail === '193,000원 → 148,000원'));
});

test('같은 상품 페이지는 Watch가 여럿이어도 하루 한 번만 읽고, 사이즈별로 따로 판정한다', async () => {
  const { db, u, checker } = setup();
  const u2 = D.upsertUser(db, 'device-watch-0002');
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/sold-out', size: 'M', targetPrice: 150000 }, policy);
  const b = W.createWatch(db, u2.id, { productUrl: 'mock://fixture/sold-out', size: 'L', targetPrice: 150000 }, policy);
  await day(db, checker, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM price_checks').get() as any).n, 1, '조회 1번을 두 Watch가 함께 쓴다');
  assert.equal(watch(db, a).last_state, 'sold_out', 'M은 품절');
  assert.equal(watch(db, b).last_state, 'met', 'L은 재고 있음 · 목표 이하');
  assert.equal(notis(db, u.id).length, 0);
  assert.equal(notis(db, u2.id).length, 1);
  await day(db, checker, 1); // M 재입고
  assert.equal(watch(db, a).last_state, 'met');
  assert.equal(notis(db, u.id).length, 1, '재입고 + 목표가 이하면 알린다');
  assert.ok(db.prepare(`SELECT 1 FROM watch_events WHERE watch_id=? AND kind='stock' AND title='재고가 들어왔어요'`).get(a));
});

test('사이즈 옵션이 없으면 조건 충족이 아니고, 배송비를 모르면 “배송비 미확인”으로만 말한다', async () => {
  const { db, u, checker } = setup();
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/size-mismatch', size: 'M', targetPrice: 150000 }, policy);
  const b = W.createWatch(db, u.id, { productUrl: 'mock://fixture/unknown-shipping', size: 'M', color: '블랙', targetPrice: 100000 }, policy);
  await day(db, checker, 0);
  assert.equal(watch(db, a).last_state, 'size_missing');
  const wb = watch(db, b);
  assert.equal(wb.last_state, 'met');
  assert.equal(JSON.parse(wb.last_result).shippingKnown, false);
  assert.match(notis(db, u.id)[0].body, /98,000원\(배송비 미확인\)/);
});

test('표시 할인가만 목표 이하면 구매 가능으로 알리지 않는다', async () => {
  const { db, u, checker } = setup();
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/sale-only', size: 'M', targetPrice: 150000 }, policy);
  await day(db, checker, 0);
  assert.equal(watch(db, a).last_state, 'sale_only');
  assert.equal(notis(db, u.id).length, 0);
  assert.equal(W.watchDisplay(watch(db, a), policy).key, 'attention');
});

test('같은 상품인지 확인하지 않은 매물은 가격이 맞아도 구매 가능 알림을 보내지 않는다', () => {
  const s: Snapshot = { url: 'x', source: 'page', seller: 's', title: 't', brand: null, image: null, condition: 'used', price: 100000, salePrice: null, shipping: 0, shippingNote: null,
    options: [{ label: 'M', color: '', size: 'M', stock: 'in_stock', price: 100000, basis: 'x' }], pageStock: 'in_stock', basis: [], isMock: true };
  assert.equal(W.evaluate({ size: 'M', target_price: 150000, condition: 'any' }, s, 'unverified').state, 'unverified');
  assert.equal(W.evaluate({ size: 'M', target_price: 150000, condition: 'new' }, s, 'same_page').state, 'condition', '새 상품만 원하면 중고는 제외');
  assert.equal(W.evaluate({ size: '95', target_price: 150000, condition: 'any' }, s, 'same_page').state, 'met', '95 = M');
});

test('조회 실패: 일시 오류는 3번까지 다시 시도하고, 연속 3일 실패하면 “확인 불가” + 알림 한 번', async () => {
  const { db, u, checker } = setup();
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/fetch-fail', targetPrice: 150000 }, policy);
  await day(db, checker, 0);
  assert.equal((db.prepare('SELECT attempts, status FROM price_checks').get() as any).attempts, 3);
  assert.equal(watch(db, a).fail_streak, 1);
  await day(db, checker, 1); await day(db, checker, 2);
  assert.equal(W.watchDisplay(watch(db, a), policy).key, 'unreachable');
  await day(db, checker, 3);
  assert.deepEqual(notis(db, u.id).map(n => n.kind), ['watch_unreachable'], '확인 불가 알림은 한 번');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM price_observations WHERE ok=0').get() as any).n, 4, '실패도 가격 이력에 남긴다');
});

test('서버가 꺼져 끊긴 조회는 다시 대기열로 돌아가고, 같은 날 같은 페이지를 두 번 읽지 않는다', async () => {
  const { db, u } = setup();
  W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', size: 'M', targetPrice: 150000 }, policy);
  W.tickWatches(db, policy);
  db.prepare(`UPDATE price_checks SET status='running', attempts=1, lease_until=?`).run(T0 + 60_000); // 조회 중에 서버가 꺼졌다
  setClock(T0 + 10 * 60_000);
  const re = W.tickWatches(db, policy);
  assert.equal(re.recovered, 1);
  assert.equal(re.queued, 0, '같은 시간 창에는 조회 작업을 새로 만들지 않는다');
  const fresh = W.createChecker(db, policy); // 다시 켜진 서버
  await fresh.step();
  assert.equal((db.prepare('SELECT status FROM price_checks').get() as any).status, 'done');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM price_checks').get() as any).n, 1);
});

test('정책: 활성 3개 · 일시중지·재개 · 종료 · 30일 뒤 계속할지 확인', async () => {
  const { db, u, checker } = setup();
  const ids = [1, 2, 3].map(i => W.createWatch(db, u.id, { productName: `옷 ${i}`, targetPrice: 100000 }, policy));
  assert.equal(watch(db, ids[0]).status, 'needs_info', '링크 없이 이름만이면 확인 요청');
  assert.throws(() => W.createWatch(db, u.id, { productName: '옷 4', targetPrice: 100000 }, policy), (e: any) => e.code === 'watch_limit');
  W.setWatchState(db, u.id, ids[0], 'pause', policy);
  const four = W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', targetPrice: 100000 }, policy);
  assert.throws(() => W.setWatchState(db, u.id, ids[0], 'resume', policy), (e: any) => e.code === 'watch_limit', '한도가 차 있으면 다시 시작할 수 없다');
  W.setWatchState(db, u.id, ids[1], 'end', policy);
  W.setWatchState(db, u.id, ids[0], 'resume', policy);
  assert.throws(() => W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', targetPrice: 1 }, policy), (e: any) => e.code === 'bad_price');
  await day(db, checker, 30);
  assert.equal(watch(db, four).status, 'renew_due');
  assert.ok(notis(db, u.id).some(n => n.kind === 'watch_renew'));
  W.tickWatches(db, policy);
  assert.equal(notis(db, u.id).filter(n => n.kind === 'watch_renew').length, 1, '연장 질문은 한 번');
  W.setWatchState(db, u.id, four, 'renew', policy);
  assert.equal(watch(db, four).status, 'active');
  assert.equal(watch(db, four).renew_at, T0 + 60 * DAY);
});

test('운영자가 상품 페이지를 붙이면 확인 요청이 풀리고, 막힌 판매처는 붙일 수 없다', async () => {
  const { db, u, checker } = setup();
  const a = W.createWatch(db, u.id, { productName: 'BADBLOOD 트랙 자켓', size: 'M', targetPrice: 150000 }, policy);
  assert.throws(() => W.attachUrl(db, a, 'https://m.bunjang.co.kr/products/1', '운영자', policy), (e: any) => e.code === 'unsupported');
  W.attachUrl(db, a, 'mock://fixture/price-drop', '운영자', policy);
  assert.equal(watch(db, a).status, 'active');
  await day(db, checker, 0);
  assert.equal(watch(db, a).last_state, 'above');
  const b = W.createWatch(db, u.id, { productUrl: 'https://www.musinsa.com/products/1', targetPrice: 150000 }, policy);
  assert.equal(watch(db, b).status, 'needs_info');
  assert.match(watch(db, b).info_note, /약관/);
});

test('조건을 바꾸면 페이지를 다시 열지 않고 마지막 값으로 다시 판정한다', async () => {
  const { db, u, checker } = setup();
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', size: 'M', targetPrice: 150000 }, policy);
  await day(db, checker, 0);
  assert.equal(watch(db, a).last_state, 'above');
  W.updateWatch(db, u.id, a, { targetPrice: 230000 }, policy);
  assert.equal(watch(db, a).last_state, 'met');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM price_checks').get() as any).n, 1);
  assert.equal(notis(db, u.id).length, 1);
});

test('실제 페이지 조회 함수가 실패를 던지면 그 사유를 그대로 남긴다(차단은 재시도하지 않음)', async () => {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-watch-0009');
  let calls = 0;
  const checker = W.createChecker(db, policy, { fetchPage: async () => { calls++; throw new SourceError('robots', 'robots.txt가 이 페이지 수집을 막고 있어요'); }, fixture: () => { throw new Error('x'); } });
  const a = W.createWatch(db, u.id, { productUrl: 'https://shop.example.com/product/1', targetPrice: 150000 }, policy);
  W.tickWatches(db, policy); await checker.step();
  assert.equal(calls, 1);
  assert.match(JSON.parse(watch(db, a).last_result).error, /robots/);
});
