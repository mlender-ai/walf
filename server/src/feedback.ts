// 사용자 선호·추천 피드백 — 추천 엔진(패션 브레인)을 고칠 때 쓸 수 있는 모양으로 남긴다(docs/WALF_EVAL_DATA.md).
// 직접 평가(마음에 들어요 · 비슷하지만 아니에요 · 관심 없어요)와 행동 기록(열어 보기 · 저장)을 나눠 남긴다.
// 열어 보기·저장은 만족으로 치지 않는다(explicit=0). 피드백마다 상품·추천 모델·버전·정렬 규칙·순위·그때의 선호를 함께 남긴다.
import crypto from 'node:crypto';
import { type DB } from './db.ts';
import { HttpError } from './domain.ts';
import { isPriority, type Priority, PRIORITY_LABEL, PRIORITIES } from './curation.ts';
import { now } from './time.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export const EXPLICIT = ['like', 'not_quite', 'not_interested', 'cleared'] as const;
export const IMPLICIT = ['open', 'save', 'unsave'] as const;
export type SignalKind = typeof EXPLICIT[number] | typeof IMPLICIT[number];
export const FEEDBACK_LABEL: Record<string, string> = { like: '마음에 들어요', not_quite: '비슷하지만 원하는 느낌은 아니에요', not_interested: '관심 없어요' };

/** 찾아줘·기다려줘에서 “무엇이 중요한지” — 고르지 않아도 된다(null). 바꾸면 다음 대체 상품 추천부터 반영 */
export function setPriority(db: DB, userId: number, target: { requestId?: number; watchId?: number }, priority: unknown) {
  const p: Priority | null = priority == null || priority === '' ? null : isPriority(priority) ? priority : (() => { throw new HttpError(400, 'bad_priority', '고를 수 있는 선호가 아니에요.'); })();
  if (target.requestId) {
    const r = one(db, 'SELECT * FROM requests WHERE id=?', target.requestId);
    if (!r || r.user_id !== userId) throw new HttpError(404, 'not_found');
    run(db, 'UPDATE requests SET priority=?, updated_at=? WHERE id=?', p, now(), r.id);
  } else if (target.watchId) {
    const w = one(db, 'SELECT * FROM watches WHERE id=?', target.watchId);
    if (!w || w.user_id !== userId) throw new HttpError(404, 'not_found');
    run(db, 'UPDATE watches SET priority=?, updated_at=? WHERE id=?', p, now(), w.id);
    if ((w.priority || null) !== p) run(db, 'INSERT INTO watch_events(watch_id, actor, kind, title, detail, is_mock, at) VALUES (?,?,?,?,?,?,?)', w.id, 'user', 'priority', '추천 기준', p ? PRIORITY_LABEL[p] : '고르지 않음', w.is_mock, now());
  }
  return p;
}
export const priorityOptions = (cur: unknown) => PRIORITIES.map(id => ({ id, label: PRIORITY_LABEL[id], selected: cur === id }));

/** 공개된 후보에 대한 신호 한 건. 자기 찾아줘·기다려줘의 공개 후보에만 남길 수 있다 */
export function recordSignal(db: DB, userId: number, offerId: number, kind: SignalKind) {
  if (![...EXPLICIT, ...IMPLICIT].includes(kind as any)) throw new HttpError(400, 'bad_feedback', '고를 수 있는 피드백이 아니에요.');
  const o = one(db, 'SELECT o.*, s.ranker FROM offers o JOIN offer_searches s ON s.id=o.search_id WHERE o.id=? AND o.published=1', offerId);
  const owner = o?.watch_id ? one(db, 'SELECT * FROM watches WHERE id=?', o.watch_id) : o?.request_id ? one(db, 'SELECT * FROM requests WHERE id=?', o.request_id) : undefined;
  if (!o || !owner || owner.user_id !== userId) throw new HttpError(404, 'not_found');
  const explicit = (EXPLICIT as readonly string[]).includes(kind);
  if (explicit && kind !== 'cleared' && o.relation !== 'similar') throw new HttpError(400, 'bad_feedback', '추천(비슷한 디자인) 상품에만 남길 수 있어요.');
  run(db, `INSERT INTO offer_signals(user_id, offer_id, kind, explicit, context, request_id, watch_id, product_id, offer_url_key, offer_brand, offer_name, relation, publish_tier,
    recommender, recommender_version, ranker, rank, score, priority, is_mock, created_at) VALUES (${Array(21).fill('?').join(',')})`,
    userId, o.id, kind, explicit ? 1 : 0, o.watch_id ? 'watch' : 'find', o.request_id ?? null, o.watch_id ?? null, owner.product_id ?? null, o.url_key, o.brand, o.name, o.relation, o.publish_tier,
    o.recommender, o.recommender_version, o.ranker ?? null, o.rank, o.score, owner.priority ?? null, o.is_mock, now());
  return { kind, explicit };
}

/**
 * 사용자별 후보의 현재 직접 평가(마지막 값, 지웠으면 null). 추천을 다시 고르면 같은 상품 페이지가 새 줄이 되므로
 * 같은 찾아줘·기다려줘 안에서는 상품 페이지(url_key) 기준으로 이어 본다. 기록 자체(그때의 순위·버전)는 바꾸지 않는다.
 */
export function feedbackMap(db: DB, userId: number, offerIds: number[]) {
  const m = new Map<number, string | null>();
  for (const o of offerIds.length ? all(db, `SELECT id, url_key, request_id, watch_id FROM offers WHERE id IN (${offerIds.map(() => '?').join(',')})`, ...offerIds) : []) {
    const r = one(db, `SELECT kind FROM offer_signals WHERE user_id=? AND explicit=1 AND offer_url_key=? AND ${o.watch_id ? 'watch_id' : 'request_id'}=? ORDER BY id DESC LIMIT 1`, userId, o.url_key, o.watch_id ?? o.request_id);
    m.set(o.id, r && r.kind !== 'cleared' ? r.kind : null);
  }
  return m;
}
/** 저장 표시도 같은 상품 페이지 기준으로 이어 본다 */
export function savedSet(db: DB, userId: number, watchId: number) {
  return new Set(all(db, `SELECT o2.id FROM offer_saves s JOIN offers o1 ON o1.id=s.offer_id JOIN offers o2 ON o2.url_key=o1.url_key AND o2.watch_id=o1.watch_id WHERE s.user_id=? AND o1.watch_id=?`, userId, watchId).map(x => x.id as number));
}

// ── 평가 데이터 내보내기(운영자) ─────────────────────────────
// 사용자는 가명(서버 비밀값으로 만든 해시)으로만 남긴다. 사진·메모·기기 정보는 넣지 않는다. 모의 데이터는 기본으로 빼고 표시한다.
const pseudo = (secret: string, userId: number) => `u_${crypto.createHmac('sha256', secret).update(`user|${userId}`).digest('hex').slice(0, 12)}`;
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
export function exportFeedback(db: DB, secret: string, opts: { mock?: boolean } = {}) {
  return all(db, `SELECT * FROM offer_signals WHERE is_mock<=? ORDER BY id`, opts.mock ? 1 : 0).map(r => ({
    type: 'feedback', at: new Date(r.created_at).toISOString(), user: pseudo(secret, r.user_id), signal: r.kind, explicit: !!r.explicit,
    satisfaction: r.kind === 'like' ? 1 : r.kind === 'not_quite' ? 0 : r.kind === 'not_interested' ? -1 : null,  // 행동 기록·지움은 만족 값이 없다
    context: r.context, target: { requestId: r.request_id, watchId: r.watch_id, productId: r.product_id, priority: r.priority },
    item: { offerId: r.offer_id, urlKey: r.offer_url_key, brand: r.offer_brand, name: r.offer_name, relation: r.relation, publishTier: r.publish_tier },
    model: { recommender: r.recommender, version: r.recommender_version, ranker: r.ranker, rank: r.rank, score: r.score }, isMock: !!r.is_mock,
  }));
}
export function exportReviews(db: DB, opts: { mock?: boolean } = {}) {
  // 계정 이어받기(account)는 보안 기록이라 평가 데이터에 넣지 않는다
  return all(db, `SELECT * FROM review_log WHERE is_mock<=? AND subject<>'account' ORDER BY id`, opts.mock ? 1 : 0).map(r => ({
    type: 'review', at: new Date(r.at).toISOString(), operator: r.operator, subject: r.subject, subjectId: r.subject_id, requestId: r.request_id, watchId: r.watch_id,
    decision: r.action, auto: parse(r.auto), before: parse(r.before), after: parse(r.after), reason: r.reason, isMock: !!r.is_mock,
  }));
}
