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
  assert.equal(watch(db, a).title, '테스트 트랙 자켓 네이비(품절)', '링크만 줬으면 페이지 상품명을 이름으로');
  assert.equal(watch(db, a).last_state, 'sold_out', 'M은 품절');
  assert.equal(watch(db, b).last_state, 'met', 'L은 재고 있음 · 목표 이하');
  assert.equal(notis(db, u.id).length, 0);
  assert.equal(notis(db, u2.id).length, 1);
  await day(db, checker, 1); // M 재입고
  assert.equal(watch(db, a).last_state, 'met');
  assert.equal(notis(db, u.id).length, 1, '재입고 + 목표가 이하면 알린다');
  assert.ok(db.prepare(`SELECT 1 FROM watch_events WHERE watch_id=? AND kind='stock' AND title='재고가 들어왔어요'`).get(a));
});

test('사이즈 옵션이 없으면 조건 충족이 아니다', async () => {
  const { db, u, checker } = setup();
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/size-mismatch', size: 'M', targetPrice: 150000 }, policy);
  await day(db, checker, 0);
  assert.equal(watch(db, a).last_state, 'size_missing');
  assert.equal(notis(db, u.id).length, 0);
});

test('[리뷰 1] 배송비를 모르면 “상품 가격은 충족, 배송비 미확인” — 알림 없음. “배송비 제외”를 고른 경우와 운영자가 배송비를 확인한 뒤에만 조건 충족', async () => {
  const { db, u, checker } = setup();
  const total = W.createWatch(db, u.id, { productUrl: 'mock://fixture/unknown-shipping', size: 'M', color: '블랙', targetPrice: 100000 }, policy);
  await day(db, checker, 0);
  assert.equal(watch(db, total).last_state, 'shipping_unknown');
  assert.equal(notis(db, u.id).length, 0, '총액을 모르면 구매 가능 알림을 보내지 않는다');
  const d = W.watchDisplay(watch(db, total), policy);
  assert.equal(d.key, 'attention'); assert.equal(d.title, '상품 가격은 충족, 배송비 미확인');
  // 사용자가 명시적으로 “배송비 제외”를 고르면 상품가로 비교
  W.updateWatch(db, u.id, total, { priceBasis: 'item' }, policy);
  assert.equal(watch(db, total).last_state, 'met');
  assert.match(notis(db, u.id)[0].body, /상품가 98,000원\(배송비 제외 기준\)/);
  // 총액 기준으로 되돌리고 운영자가 배송비 3,000원을 확인 → 101,000원 > 100,000원이라 충족 아님
  W.updateWatch(db, u.id, total, { priceBasis: 'total' }, policy);
  assert.equal(watch(db, total).last_state, 'shipping_unknown');
  W.confirmShipping(db, total, '3000', '운영자', policy);
  assert.equal(watch(db, total).last_state, 'above');
  W.updateWatch(db, u.id, total, { targetPrice: 101000 }, policy);
  assert.equal(watch(db, total).last_state, 'met');
  assert.match(notis(db, u.id).at(-1).body, /배송비 포함 총 101,000원/);
  await day(db, checker, 1); // 다음 날도 페이지에는 배송비가 없지만 운영자가 확인한 값으로 계속 총액 비교
  assert.equal(watch(db, total).last_state, 'met');
  assert.equal(notis(db, u.id).filter(n => n.kind === 'watch_met').length, 2, '조건이 깨졌다 다시 맞았을 때만 다시 알림');
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
  assert.equal(W.evaluate({ size: 'M', target_price: 150000, condition: 'any' }, s, 'pending').state, 'unverified', '판단 전 페이지도 알림 대상 아님');
  assert.equal(W.evaluate({ size: 'M', target_price: 150000, condition: 'any' }, s, 'mismatch').state, 'mismatch');
  assert.equal(W.evaluate({ size: 'M', target_price: 150000, condition: 'new' }, s, 'page_defined').state, 'condition', '새 상품만 원하면 중고는 제외');
  assert.equal(W.evaluate({ size: '95', target_price: 150000, condition: 'any' }, s, 'page_defined').state, 'met', '95 = M');
});

test('[리뷰 2] 원하는 색을 정했는데 옵션에 색이 없으면 상품명 색으로만 확인하고, 그래도 모르면 color_unknown(알림 없음)', () => {
  const snap = (title: string, opts: { color: string; size: string }[]): Snapshot => ({ url: 'x', source: 'page', seller: 's', title, brand: null, image: null, condition: 'new', price: 100000, salePrice: null, shipping: 0, shippingNote: null,
    options: opts.map(o => ({ label: [o.color, o.size].filter(Boolean).join('-'), ...o, stock: 'in_stock' as const, price: 100000, basis: 'x' })), pageStock: 'in_stock', basis: [], isMock: true });
  const want = { size: 'M', color: '네이비', target_price: 150000, condition: 'any' };
  assert.equal(W.evaluate(want, snap('트랙 자켓', [{ color: '', size: 'M' }]), 'page_defined').state, 'color_unknown', '옵션·상품명 어디에도 색이 없음');
  assert.equal(W.evaluate(want, snap('트랙 자켓 - 네이비', [{ color: '', size: 'M' }]), 'page_defined').state, 'met', '상품명에 원하는 색만 적혀 있으면 확인');
  assert.equal(W.evaluate(want, snap('트랙 자켓 - 블루그레이', [{ color: '', size: 'M' }]), 'page_defined').state, 'color_missing', '상품명 색이 다르면 색 없음');
  assert.equal(W.evaluate(want, snap('트랙 자켓', [{ color: '블랙', size: 'M' }, { color: '', size: 'M' }]), 'page_defined').state, 'color_unknown', '색 없는 옵션을 원하는 색으로 치지 않는다');
  assert.equal(W.evaluate(want, snap('트랙 자켓', [{ color: '블랙', size: 'M' }]), 'page_defined').state, 'color_missing');
  assert.equal(W.evaluate(want, snap('트랙 자켓', []), 'page_defined').state, 'stock_unknown', '옵션이 없으면 사이즈 재고부터 확인 못 함');
  assert.equal(W.evaluate({ ...want, size: null }, snap('트랙 자켓', []), 'page_defined').state, 'color_unknown');
});

test('[리뷰 3] A 상품을 등록하고 B 상품 페이지를 연결하면 A의 조건 충족 알림은 절대 나가지 않는다', async () => {
  const { db, u, checker } = setup();
  // 브랜드가 다른 페이지 → 다른 상품
  const a = W.createWatch(db, u.id, { productName: 'ANDROS Wool Zip Jacket', brand: 'ANDROS', productUrl: 'mock://fixture/price-drop', size: 'M', targetPrice: 300000 }, policy);
  // 브랜드를 안 썼고 상품명 단어가 거의 안 겹치는 페이지 → 확인 필요
  const b = W.createWatch(db, u.id, { productName: '울 블루종 자켓', productUrl: 'mock://fixture/sold-out', size: 'L', targetPrice: 300000 }, policy);
  for (let i = 0; i < 3; i++) await day(db, checker, i);
  assert.equal(watch(db, a).page_identity, 'mismatch'); assert.equal(watch(db, a).last_state, 'mismatch');
  assert.equal(watch(db, b).page_identity, 'unverified'); assert.equal(watch(db, b).last_state, 'unverified');
  assert.equal(notis(db, u.id).length, 0, '가격·사이즈·재고가 다 맞아도 다른(또는 확인 안 된) 상품 페이지면 알림 없음');
  assert.equal(W.watchDisplay(watch(db, a), policy).key, 'mismatch');
  assert.ok(W.watchView(db, watch(db, b), 'http://x', policy).history.every(h => !h.meets), '다른(확인 안 된) 페이지 가격 기록에 “목표 이하” 표시를 하지 않는다');
  // 운영자가 “다른 상품”으로 판단하면 페이지를 떼고 확인 요청으로
  W.confirmPage(db, a, false, '운영자', policy);
  assert.equal(watch(db, a).status, 'needs_info'); assert.equal(watch(db, a).url, null);
  // 운영자가 “같은 상품”으로 확인해야만 알림
  W.confirmPage(db, b, true, '운영자', policy);
  assert.equal(watch(db, b).last_state, 'met');
  assert.equal(notis(db, u.id).length, 1);
});

test('[리뷰 3] 페이지 동일성 자동 판정: 품번 일치 → 같음 · 다른 품번 → 다름 · 링크만 준 경우는 그 페이지가 상품', () => {
  const pi = (w: any, prod: any, title: string, brand: string | null = null) => W.pageIdentity({ title: '', page_identity: 'pending', ...w }, prod, { title, brand }).identity;
  const prod = { name: 'Mystic Nylon Track Jacket', brand: 'BADBLOOD', model_code: 'W-JKT26-055' };
  assert.equal(pi({ title: prod.name, brand: 'BADBLOOD' }, prod, '[w-jkt26-055] 미스틱 나일론 트랙 자켓 - 네이비', 'badblood'), 'matched', '영문 이름·한글 페이지여도 품번이 같으면 같음');
  assert.equal(pi({ title: prod.name, brand: 'BADBLOOD' }, prod, '[w-jkt26-054] 미스틱 나일론 트랙 자켓 - 블루그레이', 'badblood'), 'mismatch', '품번이 다르면 다른 상품');
  assert.equal(pi({ title: 'BADBLOOD Mystic Nylon Track Jacket', brand: 'BADBLOOD' }, undefined, '미스틱 나일론 트랙 자켓', 'badblood'), 'unverified', '표기가 달라 자동으로 못 맞추면 운영자 확인');
  assert.equal(pi({ title: '미스틱 나일론 트랙 자켓 네이비' }, undefined, '[w-jkt26-055] 미스틱 나일론 트랙 자켓 - 네이비'), 'matched');
  assert.equal(pi({ title: 'x', page_identity: 'page_defined' }, undefined, '아무 상품'), 'page_defined');
});

test('[리뷰 3] 찾아줘 상품의 근거 주소는 기다려줘 상품 페이지로 이어받지 않는다', () => {
  const { db, u } = setup();
  const pid = db.prepare(`INSERT INTO products(canonical_key, brand, name, url, verified, source, is_mock, created_at, updated_at) VALUES ('k','B','N','https://blog.example.com/review',1,'operator',0,1,1)`).run().lastInsertRowid;
  const a = W.createWatch(db, u.id, { productId: Number(pid), targetPrice: 150000 }, policy);
  assert.equal(watch(db, a).url, null, '상품의 주소(근거·리뷰일 수 있음)를 그대로 감시하지 않는다');
  assert.equal(watch(db, a).status, 'needs_info');
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

test('다른 사용자의 기다려줘는 보거나 바꿀 수 없다', () => {
  const { db, u } = setup();
  const other = D.upsertUser(db, 'device-watch-0003');
  const a = W.createWatch(db, u.id, { productUrl: 'mock://fixture/price-drop', targetPrice: 150000 }, policy);
  assert.throws(() => W.ownWatch(db, other.id, a), (e: any) => e.status === 404);
  assert.throws(() => W.setWatchState(db, other.id, a, 'end', policy), (e: any) => e.status === 404);
  assert.throws(() => W.updateWatch(db, other.id, a, { targetPrice: 1000 }, policy), (e: any) => e.status === 404);
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
