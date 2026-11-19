// 운영자 검수 기록 — 제품 정보를 고치거나 같은 상품 여부를 정한 일을 지우지 않고 남긴다.
// 자동 판정(auto)과 운영자 결정(action·after·reason)을 나란히 남겨, 추천·탐색 엔진을 평가하는 데이터로 쓴다(docs/WALF_EVAL_DATA.md).
import { type DB } from './db.ts';
import { now } from './time.ts';

export type ReviewEntry = { operator: string; subject: string; subjectId?: number | null; requestId?: number | null; watchId?: number | null; action: string;
  auto?: unknown; before?: unknown; after?: unknown; reason?: string | null; isMock?: boolean; at?: number };
const j = (v: unknown) => v === undefined || v === null ? null : JSON.stringify(v);
export function logReview(db: DB, e: ReviewEntry) {
  db.prepare(`INSERT INTO review_log(at, operator, subject, subject_id, request_id, watch_id, action, auto, before, after, reason, is_mock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(e.at ?? now(), e.operator, e.subject, e.subjectId ?? null, e.requestId ?? null, e.watchId ?? null, e.action, j(e.auto), j(e.before), j(e.after), e.reason ?? null, e.isMock ? 1 : 0);
}
export function reviewLogOf(db: DB, opts: { requestId?: number; watchIds?: number[] }) {
  const w = opts.watchIds?.length ? opts.watchIds : [-1];
  return db.prepare(`SELECT * FROM review_log WHERE request_id=? OR watch_id IN (${w.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 200`).all(opts.requestId ?? -1, ...w) as Record<string, any>[];
}
