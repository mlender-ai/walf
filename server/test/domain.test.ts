import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import { setClock, DAY, HOUR } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 6, 1, 0); // 2026-11-06 10:00 KST

function setup() {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-test-0001', 'ios');
  const id = D.createRequest(db, u.id, { productName: 'BADBLOOD Mystic Nylon Track Jacket Navy', brand: 'BADBLOOD', size: 'm', color: '네이비', maxPrice: 150000 });
  return { db, u, id };
}
const sellers = (db: any) => db.prepare('SELECT id FROM sellers ORDER BY sort').all().map((s: any) => s.id) as number[];
const checkAll = (db: any, over: Record<number, any> = {}) => sellers(db).map(id => ({ sellerId: id, status: 'checked', result: 'none', ...over[id] }));
const notis = (db: any, uid: number) => db.prepare('SELECT kind, push_status FROM notifications WHERE user_id=? ORDER BY id').all(uid) as any[];
const disp = (db: any, id: number) => D.display(db, D.getRequest(db, id));
const run1 = (db: any, id: number, day = 1) => (db.prepare('SELECT * FROM search_runs WHERE request_id=? AND day=?').get(id, day) as any);

test('한 사용자에 진행 중 의뢰는 1건', () => {
  const { db, u } = setup();
  assert.throws(() => D.createRequest(db, u.id, { productName: '두 번째' }), (e: any) => e.status === 409 && e.code === 'active_exists');
});

test('사진·링크·상품명이 모두 없으면 거절', () => {
  setClock(T0); const db = openDb(':memory:'); const u = D.upsertUser(db, 'device-test-0002');
  assert.throws(() => D.createRequest(db, u.id, { size: 'M' }), (e: any) => e.code === 'empty');
  assert.throws(() => D.createRequest(db, u.id, { productUrl: 'ftp://x' }), (e: any) => e.code === 'bad_url');
});

test('접수 ≠ 탐색 시작: 운영자 확인 전에는 7일이 흐르지 않는다', () => {
  const { db, id } = setup();
  assert.equal(disp(db, id).key, 'identification_pending');
  assert.equal(D.getRequest(db, id).expires_at, null);
  setClock(T0 + 5 * HOUR);
  D.activate(db, id, { name: 'BADBLOOD Mystic Nylon Track Jacket Navy' }, '운영자');
  const r = D.getRequest(db, id);
  assert.equal(r.expires_at - r.activated_at, 168 * HOUR);
  assert.equal(r.size, 'M');
  assert.equal(disp(db, id).key, 'first_search_pending');
  assert.equal(run1(db, id).status, 'pending');
});

test('정기 탐색은 하루 1회, 최대 7회, 종료 후 생성 안 함', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  for (let h = 0; h <= 200; h += 6) D.ensureRuns(db, T0 + h * HOUR);
  const n = (db.prepare('SELECT COUNT(*) n FROM search_runs WHERE request_id=?').get(id) as any).n;
  assert.equal(n, 7);
  const days = db.prepare('SELECT day, scheduled_for FROM search_runs WHERE request_id=? ORDER BY day').all(id) as any[];
  days.forEach((d, i) => assert.equal(d.scheduled_for, T0 + i * DAY));
});

test('창 안에 못 한 탐색은 “하지 못함” — 매물 없음으로 보이지 않는다', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  setClock(T0 + DAY + 1);
  D.tick(db);
  assert.equal(run1(db, id).status, 'missed');
  assert.equal(disp(db, id).key, 'paused_failed');
  assert.ok(db.prepare(`SELECT 1 FROM activity WHERE request_id=? AND kind='missed'`).get(id));
});

test('첫 탐색 조건 불일치 → 수배 제안 · 동의 요청 알림', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db), outcome: 'no_match' }, 'op');
  assert.equal(disp(db, id).key, 'awaiting_consent');
  assert.deepEqual(notis(db, u.id).map(n => n.kind), ['consent']);
  assert.equal(notis(db, u.id)[0].push_status, 'no_token');
});

test('확인한 판매처가 없으면 탐색 완료로 기록하지 않는다', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  const all = sellers(db).map(s => ({ sellerId: s, status: 'unreachable' as const }));
  assert.throws(() => D.completeRun(db, run1(db, id).id, { checks: all, outcome: 'no_match' }, 'op'), (e: any) => e.code === 'no_checks');
});

test('접속 실패가 섞인 탐색은 일부 실패로 표시', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  const s = sellers(db);
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db, { [s[0]]: { status: 'unreachable' } }), outcome: 'nothing_new' }, 'op');
  const d = disp(db, id);
  assert.equal(d.key, 'paused_failed');
  assert.match(d.desc, /1곳에 접속하지 못했어요/);
});

test('수배: 승인 → 게시 대기 → 주소 있어야 게시 완료 → 사유 있어야 미게시', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db), outcome: 'no_match' }, 'op');
  D.decideWanted(db, u.id, id, true, { photo: true, sizeColor: true });
  const w = db.prepare('SELECT * FROM wanted WHERE request_id=?').get(id) as any;
  assert.equal(JSON.parse(w.public_fields).photo, false, '사진이 없는 의뢰는 사진 공개 불가');
  assert.equal(disp(db, id).key, 'wanted_queued');
  const posts = db.prepare('SELECT * FROM wanted_posts WHERE wanted_id=? ORDER BY id').all(w.id) as any[];
  assert.throws(() => D.updatePost(db, posts[0].id, { status: 'posted' }, 'op'), (e: any) => e.code === 'need_url');
  assert.throws(() => D.updatePost(db, posts[2].id, { status: 'skipped' }, 'op'), (e: any) => e.code === 'need_reason');
  setClock(T0 + 2 * HOUR);
  D.updatePost(db, posts[0].id, { status: 'posted', url: 'https://example.com/post/1' }, 'op');
  D.updatePost(db, posts[2].id, { status: 'skipped', reason: '구매 희망글을 받지 않는 채널' }, 'op');
  const d = disp(db, id);
  assert.equal(d.key, 'wanted_published');
  assert.match(d.desc, /번개장터에 게시했어요/);
  assert.match(d.desc, /후루츠패밀리에는 올리지 않았어요/);
  assert.throws(() => D.updatePost(db, posts[0].id, { status: 'queued' }, 'op'), (e: any) => e.code === 'bad_transition');
});

test('제보 후보는 확인 전 푸시 없음, 탐색 후보는 유효 후보 알림', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  const rep = D.saveCandidate(db, id, { source: 'report', seller: '번개장터', size: 'M', price: 120000, shipping: 4000, matchGrade: 'same_likely', availability: 'listed_unverified' }, 'op');
  D.publishCandidate(db, rep, 'op');
  assert.equal(disp(db, id).key, 'lead_found');
  assert.deepEqual(notis(db, u.id).map(n => n.kind), []);
  const s = D.saveCandidate(db, id, { source: 'search', seller: '후루츠패밀리', size: 'M', price: 130000, matchGrade: 'same_likely', availability: 'listed_unverified' }, 'op');
  D.publishCandidate(db, s, 'op');
  assert.deepEqual(notis(db, u.id).map(n => n.kind), ['lead']);
});

test('구매 가능 확인: 일치·재고·조건 모두 맞을 때만, 알림은 한 번', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  const c = D.saveCandidate(db, id, { source: 'report', seller: '번개장터', size: 'M', price: 120000, shipping: 4000, matchGrade: 'same_likely', availability: 'listed_unverified' }, 'op');
  D.publishCandidate(db, c, 'op');
  assert.throws(() => D.saveCandidate(db, id, { source: 'report', seller: '번개장터', size: 'M', price: 120000, matchGrade: 'same_confirmed', availability: 'purchasable' }, 'op', c), (e: any) => e.code === 'need_checked_at');
  D.saveCandidate(db, id, { source: 'report', seller: '번개장터', size: 'M', price: 120000, shipping: 4000, matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0 + HOUR, evidence: ['같은 옷이에요'] }, 'op', c);
  assert.equal(disp(db, id).key, 'offer_verified');
  D.saveCandidate(db, id, { source: 'report', seller: '번개장터', size: 'M', price: 119000, shipping: 4000, matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0 + 2 * HOUR }, 'op', c);
  assert.deepEqual(notis(db, u.id).map(n => n.kind), ['offer']);
  const v = D.candidateView(db, D.getRequest(db, id), D.getRequest(db, id) && db.prepare('SELECT * FROM candidates WHERE id=?').get(c) as any);
  assert.equal(v.total, 123000);
  assert.deepEqual(v.tags.map(t => t.text), ['동일 상품 확인', '구매 가능 확인']);
});

test('가격 초과는 관찰, 사이즈 다르면 불일치 — 구매 가능으로 승격하지 않음', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  const r = D.getRequest(db, id);
  const base = { source: 'search' as const, seller: '무신사', matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0, condition: 'new' as const };
  assert.equal(D.classify(r, { ...row(base), size: 'M', price: 189000 }).kind, 'price_watch');
  assert.equal(D.classify(r, { ...row(base), size: 'L', price: 99000 }).kind, 'mismatch');
  assert.equal(D.classify(r, { ...row(base), size: 'M', price: 99000, color_ok: 0 }).kind, 'mismatch');
  assert.equal(D.classify(r, { ...row(base), size: 'M', price: 99000 }).kind, 'offer');
  assert.equal(D.classify({ ...r, used_ok: 0 }, { ...row(base), size: 'M', price: 99000, condition: 'used' }).kind, 'mismatch');
});
const row = (b: any) => ({ match_grade: b.matchGrade, availability: b.availability, checked_at: b.checkedAt, condition: b.condition, shipping: 0, color_ok: 1 });

test('유사 상품은 사용자에게 공개할 수 없다(MVP)', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  const c = D.saveCandidate(db, id, { source: 'search', seller: '무신사', matchGrade: 'similar', availability: 'purchasable', checkedAt: T0 }, 'op');
  assert.throws(() => D.publishCandidate(db, c, 'op'), (e: any) => e.code === 'not_publishable');
});

test('구매 완료 → 탐색 중단 · 게시글 삭제 요청', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db), outcome: 'no_match' }, 'op');
  D.decideWanted(db, u.id, id, true, {});
  const p = db.prepare('SELECT p.* FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id WHERE w.request_id=? ORDER BY p.id').all(id) as any[];
  D.updatePost(db, p[0].id, { status: 'posted', url: 'https://example.com/p' }, 'op');
  setClock(T0 + DAY + HOUR); D.tick(db);
  D.confirmPurchase(db, u.id, id);
  const r = D.getRequest(db, id);
  assert.equal(r.status, 'completed');
  assert.equal(disp(db, id).key, 'completed');
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM search_runs WHERE request_id=? AND status='pending'`).get(id) as any).n, 0);
  const st = (db.prepare('SELECT status FROM wanted_posts WHERE id IN (?,?)').all(p[0].id, p[1].id) as any[]).map(x => x.status).sort();
  assert.deepEqual(st, ['cancelled', 'removal_requested']);
  assert.equal(D.openRequestOf(db, u.id), undefined, '끝나면 새 의뢰 가능');
});

test('168시간이 지나면 자동 종료 · 종료 보고 알림', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  setClock(T0 + 168 * HOUR - 1); D.tick(db);
  assert.equal(D.getRequest(db, id).status, 'active');
  setClock(T0 + 168 * HOUR); D.tick(db);
  assert.equal(D.getRequest(db, id).status, 'expired');
  assert.equal(disp(db, id).title, '이번에는 빈 입으로 돌아왔어요');
  assert.ok(notis(db, u.id).some(n => n.kind === 'expired'));
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM search_runs WHERE request_id=? AND status='pending'`).get(id) as any).n, 0);
});

test('정보 보완 요청 → 사용자 답 → 다시 확인 대기', () => {
  const { db, u, id } = setup();
  D.requestInfo(db, id, '태그 사진을 보내주세요', 'op');
  assert.equal(disp(db, id).key, 'needs_info');
  assert.ok(notis(db, u.id).some(n => n.kind === 'needs_info'));
  D.submitInfo(db, u.id, id, { text: '2024 FW 제품이에요' });
  assert.equal(D.getRequest(db, id).status, 'submitted');
});

test('조건 변경은 일지에 바뀐 내용과 적용 시점을 남긴다', () => {
  const { db, u, id } = setup();
  D.updateConditions(db, u.id, id, { size: 'L', color: '네이비', maxPrice: '150,000', usedOk: true });
  const a = db.prepare(`SELECT * FROM activity WHERE request_id=? AND kind='conditions'`).get(id) as any;
  assert.match(a.detail, /사이즈 M → L/);
  assert.match(a.detail, /다음 탐색부터 적용/);
});

test('다른 사용자의 의뢰는 볼 수 없다', () => {
  const { db, id } = setup();
  const other = D.upsertUser(db, 'device-test-9999');
  assert.throws(() => D.ownRequest(db, other.id, id), (e: any) => e.status === 404);
});

// ── 리뷰에서 나온 결함 회귀 테스트 ─────────────────────────────
test('실제 의뢰의 모의 탐색 → 수배 제안·알림도 모의, 푸시는 보내지 않음', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db), outcome: 'no_match', isMock: true }, 'op');
  const n = db.prepare('SELECT * FROM notifications WHERE user_id=?').get(u.id) as any;
  assert.equal(n.is_mock, 1); assert.equal(n.push_status, 'skipped_mock');
  assert.equal(disp(db, id).isMock, true);
  assert.equal((db.prepare(`SELECT is_mock FROM activity WHERE request_id=? AND kind='wanted_proposed'`).get(id) as any).is_mock, 1);
});

test('끝난 의뢰의 후보는 등록·수정할 수 없다(알림도 없음)', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  const c = D.saveCandidate(db, id, { source: 'search', seller: '무신사', size: 'M', price: 90000, matchGrade: 'same_likely', availability: 'listed_unverified' }, 'op');
  D.publishCandidate(db, c, 'op');
  D.cancelRequest(db, u.id, id);
  const before = notis(db, u.id).length;
  assert.throws(() => D.saveCandidate(db, id, { source: 'search', seller: '무신사', size: 'M', price: 90000, matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0 }, 'op', c), (e: any) => e.status === 409);
  assert.equal(notis(db, u.id).length, before);
});

test('가격을 모르면 구매 가능·예산 초과로 판정하지 않는다', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  assert.throws(() => D.saveCandidate(db, id, { source: 'search', seller: '무신사', size: 'M', matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0 }, 'op'), (e: any) => e.code === 'need_price');
  const r = D.getRequest(db, id);
  assert.equal(D.classify(r, { match_grade: 'same_likely', availability: 'listed_unverified', size: 'M', price: null, shipping: 0, condition: 'used', color_ok: 1 }).kind, 'lead');
});

test('탐색 실패는 수배 동의 대기 중에도 함께 알린다', () => {
  const { db, id } = setup();
  const s = sellers(db);
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db, { [s[1]]: { status: 'unreachable' } }), outcome: 'no_match' }, 'op');
  let d = disp(db, id);
  assert.equal(d.key, 'awaiting_consent'); assert.match(d.desc, /1곳은 접속하지 못했어요/);
  setClock(T0 + 2 * DAY + 1); D.tick(db);
  d = disp(db, id);
  assert.equal(d.key, 'awaiting_consent'); assert.match(d.notice || '', /예정된 탐색을 하지 못했어요/);
});

test('탐색 기록은 모든 판매처를 직접 골라야 하고, 후보 결과에는 “동일 상품 있음”이 있어야 한다', () => {
  const { db, id } = setup();
  D.activate(db, id, {}, 'op');
  const partial = checkAll(db).slice(1);
  assert.throws(() => D.completeRun(db, run1(db, id).id, { checks: partial as any, outcome: 'no_match' }, 'op'), (e: any) => e.code === 'missing_check');
  assert.throws(() => D.completeRun(db, run1(db, id).id, { checks: checkAll(db), outcome: 'offer' }, 'op'), (e: any) => e.code === 'outcome_mismatch');
});

test('공개 안 된 후보는 넘길 수 없고, 구매 확인도 이 의뢰의 공개 후보만', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  const c = D.saveCandidate(db, id, { source: 'search', seller: '비공개', matchGrade: 'same_likely', availability: 'listed_unverified' }, 'op');
  assert.throws(() => D.dismissCandidate(db, u.id, c), (e: any) => e.status === 404);
  assert.throws(() => D.confirmPurchase(db, u.id, id, c), (e: any) => e.code === 'bad_candidate');
});

test('조건을 바꿔 구매 가능이 되는 후보는 운영자 재확인 전까지 유력 후보', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  const c = D.saveCandidate(db, id, { source: 'search', seller: '무신사', size: 'L', price: 90000, condition: 'new', matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0 }, 'op');
  D.publishCandidate(db, c, 'op');
  assert.notEqual(disp(db, id).key, 'offer_verified', 'L은 불일치');
  D.updateConditions(db, u.id, id, { size: 'L', color: '네이비', maxPrice: 150000 });
  assert.equal(disp(db, id).key, 'lead_found');
  assert.equal(notis(db, u.id).filter(n => n.kind === 'offer').length, 0);
  D.saveCandidate(db, id, { source: 'search', seller: '무신사', size: 'L', price: 90000, condition: 'new', matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0 + HOUR }, 'op', c);
  assert.equal(disp(db, id).key, 'offer_verified');
  assert.equal(notis(db, u.id).filter(n => n.kind === 'offer').length, 1);
});

test('7일 종료 알림 문구는 화면과 같은 기준(넘긴 매물 제외)', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  const c = D.saveCandidate(db, id, { source: 'search', seller: '무신사', size: 'M', price: 90000, condition: 'new', matchGrade: 'same_confirmed', availability: 'purchasable', checkedAt: T0 }, 'op');
  D.publishCandidate(db, c, 'op');
  D.dismissCandidate(db, u.id, c);
  setClock(T0 + 168 * HOUR); D.tick(db);
  assert.equal(disp(db, id).title, '이번에는 빈 입으로 돌아왔어요');
  const n = db.prepare(`SELECT body FROM notifications WHERE user_id=? AND kind='expired'`).get(u.id) as any;
  assert.match(n.body, /빈 입/);
});

test('데이터 삭제: 게시된 수배글이 있으면 삭제 처리용 기록만 남긴다', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db), outcome: 'no_match' }, 'op');
  D.decideWanted(db, u.id, id, true, {});
  const p = db.prepare('SELECT p.id FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id WHERE w.request_id=? ORDER BY p.id').get(id) as any;
  D.updatePost(db, p.id, { status: 'posted', url: 'https://example.com/p' }, 'op');
  D.deleteUser(db, u.id);
  assert.equal((db.prepare('SELECT status FROM wanted_posts WHERE id=?').get(p.id) as any).status, 'removal_requested');
  assert.equal(D.userByDevice(db, 'device-test-0001'), undefined, '기기 ID로 다시 접근 불가');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM notifications').get() as any).n, 0);
  const other = D.upsertUser(db, 'device-test-0003');
  const r2 = D.createRequest(db, other.id, { productName: 'x' });
  D.deleteUser(db, other.id);
  assert.equal(db.prepare('SELECT id FROM requests WHERE id=?').get(r2), undefined, '삭제할 게시글이 없으면 모두 지움');
});

test('게시 기록의 모의 표시는 이후 변경에도 유지된다', () => {
  const { db, u, id } = setup();
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db), outcome: 'no_match' }, 'op');
  D.decideWanted(db, u.id, id, true, {});
  const p = db.prepare('SELECT p.id FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id WHERE w.request_id=? ORDER BY p.id').get(id) as any;
  D.updatePost(db, p.id, { status: 'posted', url: 'https://example.com/p', isMock: true }, 'op');
  D.updatePost(db, p.id, { status: 'removed' }, 'op');
  assert.equal((db.prepare('SELECT is_mock FROM wanted_posts WHERE id=?').get(p.id) as any).is_mock, 1);
});

test('수배 승인 직후에는 탐색 실패보다 “게시 준비”를 먼저 보여주고 실패는 안내로 붙인다', () => {
  const { db, u, id } = setup();
  const s = sellers(db);
  D.activate(db, id, {}, 'op');
  D.completeRun(db, run1(db, id).id, { checks: checkAll(db, { [s[1]]: { status: 'unreachable' } }), outcome: 'no_match' }, 'op');
  D.decideWanted(db, u.id, id, true, {});
  const d = disp(db, id);
  assert.equal(d.key, 'wanted_queued');
  assert.match(d.notice || '', /1곳에 접속하지 못했어요/);
});

test('테스트 푸시: 토큰 없으면 거부, 있으면 모의 표시로 남기되 발송 대상', () => {
  const { db, u, id } = setup();
  assert.throws(() => D.sendTestPush(db, id, 'op'), (e: any) => e.code === 'no_token');
  db.prepare('UPDATE users SET push_token=? WHERE id=?').run('ExponentPushToken[test]', u.id);
  D.sendTestPush(db, id, 'op');
  const n = db.prepare(`SELECT * FROM notifications WHERE kind='test'`).get() as any;
  assert.equal(n.is_mock, 1);
  assert.notEqual(n.push_status, 'skipped_mock');
});
