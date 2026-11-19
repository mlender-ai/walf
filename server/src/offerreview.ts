// 판매처 후보·대체 상품 검수 — 자동 탐색·추천 결과는 운영자가 고른 것만 사용자에게 보인다(기존 검수 정책 그대로).
// exact: 같은 상품 확인(품번 일치 또는 운영자가 확인한 근거) · possible: 같은 상품일 수 있음 · alternative: 비슷한 디자인(같은 상품 아님).
// 어느 쪽도 “구매 가능”을 뜻하지 않는다 — 가격·재고는 페이지를 읽은 시각 기준이고, 바뀔 수 있다고 함께 보여 준다.
import { type DB, tx } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { offerOf, type ProductOffer, type StoredOffer } from './offers.ts';
import { logReview } from './reviewlog.ts';
import { feedbackMap, priorityOptions } from './feedback.ts';
import { now, kWhen } from './time.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export type ReviewAction = 'exact' | 'possible' | 'alternative' | 'reject' | 'hide';
export const TIER_LABEL: Record<string, string> = { exact: '같은 상품 확인', possible: '같은 상품일 수 있음', alternative: '비슷한 디자인' };
export const REJECT_REASONS = ['다른 상품', '판매 종료·품절', '페이지가 열리지 않음', '가격·옵션 정보가 틀림', '디자인이 많이 다름', '판매처를 믿기 어려움', '기타'];

/** 사용자 화면에 찾아줘 결과가 이미 보이는가(식별 결과 또는 판매처·대체 상품을 공개했음) */
export function findVisible(db: DB, requestId: number) {
  return !!one(db, `SELECT 1 FROM product_identities WHERE request_id=? AND status IN ('published','confirmed')`, requestId)
    || !!one(db, 'SELECT 1 FROM offers WHERE request_id=? AND published=1', requestId);
}

/**
 * 운영자 검수 한 건. 찾아줘 결과가 이미 보이면 바로 공개(알림 한 번)하고, 아니면 “공개 대기” — 찾아줘 결과를 공개할 때 함께 나간다.
 * 같은 상품 확인(exact)은 품번이 페이지에 있을 때만 근거 없이 되고, 그 밖에는 운영자가 직접 확인한 근거(10자 이상)가 있어야 한다.
 */
export function reviewOffer(db: DB, offerId: number, action: ReviewAction, input: { reason?: string }, operator: string): StoredOffer {
  const row = one(db, 'SELECT * FROM offers WHERE id=?', offerId);
  if (!row) throw new HttpError(404, 'not_found');
  const o = offerOf(row);
  const reason = String(input.reason ?? '').trim().slice(0, 300);
  checkAction(o, action, reason);
  if (o.watchId && !o.requestId) return reviewWatchOffer(db, o, action, reason, operator);
  if (!o.requestId) throw new HttpError(409, 'bad_state', '의뢰나 기다려줘에 묶이지 않은 후보예요.');
  const r = D.getRequest(db, o.requestId);
  if (['cancelled', 'expired'].includes(r.status) && action !== 'hide' && action !== 'reject') throw new HttpError(409, 'bad_state', '끝난 의뢰에는 공개할 수 없어요.');
  const t = now();
  const mock = o.isMock || !!r.is_mock;
  let publishedNow = false;
  tx(db, () => {
    if (action === 'reject') run(db, `UPDATE offers SET review_state='rejected', publish_tier=NULL, published=0, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`, operator, t, reason, o.id);
    else if (action === 'hide') run(db, 'UPDATE offers SET published=0, reviewed_by=?, reviewed_at=? WHERE id=?', operator, t, o.id);
    else {
      publishedNow = findVisible(db, r.id);
      run(db, `UPDATE offers SET review_state='approved', publish_tier=?, published=?, published_at=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`,
        action, publishedNow ? 1 : 0, publishedNow ? t : null, operator, t, reason || null, o.id);
    }
    if (publishedNow) logPublished(db, r, [action], operator, mock);
    logReview(db, { operator, subject: 'offer', subjectId: o.id, requestId: r.id, action, auto: autoOf(o), reason: reason || null, isMock: mock, at: t });
  });
  if (publishedNow) notifyPublished(db, r, [action], mock, t);
  return offerOf(one(db, 'SELECT * FROM offers WHERE id=?', o.id)!);
}

/** 검수 기록에 남길 자동 판정(운영자 결정과 비교하는 평가 데이터) */
const autoOf = (o: StoredOffer) => ({ relation: o.relation, verdict: o.verdict, detail: o.detail, wantSize: o.wantSize, wantColor: o.wantColor, stock: o.stock, score: o.score, rank: o.rank,
  recommender: o.recommender, recommenderVersion: o.recommenderVersion, checks: o.checks.map(c => [c.field, c.result]), seller: o.seller, name: o.name, url: o.url,
  price: o.salePrice ?? o.price, shipping: o.shipping, similarPoints: o.similarPoints, diffPoints: o.diffPoints });

/** 검수 규칙(찾아줘·기다려줘 공통) */
function checkAction(o: StoredOffer, action: ReviewAction, reason: string) {
  if (action === 'exact' || action === 'possible') {
    if (o.relation !== 'same') throw new HttpError(400, 'bad_relation', '대체 추천 상품은 같은 상품으로 공개할 수 없어요. “비슷한 디자인”으로 공개하세요.');
    if (action === 'exact' && o.verdict !== 'same_code' && reason.length < 10)
      throw new HttpError(400, 'exact_needs_reason', '페이지에서 품번 일치를 확인하지 못한 후보예요. 같은 상품으로 공개하려면 직접 확인한 근거(10자 이상: 무엇이 같은지)를 적어 주세요. 아니면 “같은 상품일 수 있음”으로 공개하세요.');
    if (o.verdict === 'different' && reason.length < 10)
      throw new HttpError(400, 'different_needs_reason', '자동 판정이 “다른 상품”이에요. 공개하려면 같은 상품이라고 본 근거(10자 이상)를 적어 주세요.');
  }
  if (action === 'alternative' && o.relation !== 'similar') throw new HttpError(400, 'bad_relation', '판매처 후보는 대체 상품으로 공개하지 않아요. 같은 상품 확인·같은 상품일 수 있음 중에서 고르세요.');
  if (action === 'reject' && !reason) throw new HttpError(400, 'need_reason', '제외 사유를 골라 주세요.');
}

// ── 기다려줘 후보(새 판매처·대체 상품) ─────────────────────────
/** 이 후보가 기다려줘 조건(원하는 가격·사이즈·상태)에 맞는지 — 페이지를 읽은 시각 기준. 맞을 때만 알림 후보 */
export function meetsWatch(o: StoredOffer | ProductOffer, w: Row) {
  const item = o.salePrice ?? o.price;
  const priceOk = w.price_basis === 'item' ? item != null && item <= w.target_price : item != null && o.shipping != null && item + o.shipping <= w.target_price;
  return priceOk && ['ok', 'any'].includes(o.wantSize) && o.stock !== 'sold_out' && !(w.condition === 'new' && o.condition === 'used');
}
function watchEvent(db: DB, w: Row, kind: string, title: string, detail: string, t: number) {
  run(db, 'INSERT INTO watch_events(watch_id, actor, kind, title, detail, is_mock, at) VALUES (?,?,?,?,?,?,?)', w.id, 'team', kind, title, detail, w.is_mock, t);
}
/** 기다려줘 화면은 늘 보이므로 검수하면 바로 공개한다. 조건에 맞는 새 판매처만 알림(같은 페이지는 한 번), 대체 상품은 하루 한 번 */
function reviewWatchOffer(db: DB, o: StoredOffer, action: ReviewAction, reason: string, operator: string) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', o.watchId);
  if (!w) throw new HttpError(404, 'not_found');
  if (w.status === 'ended' && action !== 'hide' && action !== 'reject') throw new HttpError(409, 'bad_state', '끝난 기다려줘에는 공개할 수 없어요.');
  const t = now();
  const mock = o.isMock || !!w.is_mock;
  tx(db, () => {
    if (action === 'reject') run(db, `UPDATE offers SET review_state='rejected', publish_tier=NULL, published=0, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`, operator, t, reason, o.id);
    else if (action === 'hide') run(db, 'UPDATE offers SET published=0, reviewed_by=?, reviewed_at=? WHERE id=?', operator, t, o.id);
    else {
      run(db, `UPDATE offers SET review_state='approved', publish_tier=?, published=1, published_at=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`, action, t, operator, t, reason || null, o.id);
      // 대체 상품 기록은 하루 한 줄(여러 벌을 공개해도)
      if (action === 'alternative') { if (!one(db, `SELECT 1 FROM watch_events WHERE watch_id=? AND kind='alternatives_published' AND at>?`, w.id, t - 86_400_000)) watchEvent(db, w, 'alternatives_published', '기다리는 동안 볼 비슷한 옷을 골랐어요', '같은 상품은 아니에요 · 기다려줘는 그대로 계속돼요', t); }
      else watchEvent(db, w, 'discovery_published', '왈프 팀이 다른 판매처를 확인했어요', `${o.seller} · ${action === 'exact' ? '같은 상품 확인' : '같은 상품일 수 있음'} · 가격·재고는 바뀔 수 있어요`, t);
    }
    logReview(db, { operator, subject: 'offer', subjectId: o.id, watchId: w.id, action, auto: { ...autoOf(o), meetsWatch: meetsWatch(o, w) }, reason: reason || null, isMock: mock, at: t });
  });
  if (action === 'exact' || action === 'possible') {
    if (meetsWatch(o, w)) {
      const item = o.salePrice ?? o.price;
      const total = item != null && o.shipping != null ? item + o.shipping : null;
      D.notifyUser(db, w.user_id, { kind: 'watch_discovery', title: '다른 판매처에서 원하는 조건의 매물을 찾았어요',
        body: `${o.seller} · ${total != null ? `배송비 포함 ${total.toLocaleString('ko-KR')}원` : `${(item ?? 0).toLocaleString('ko-KR')}원`}${w.size ? ` · ${w.size} 재고 있음` : ''}(페이지를 읽은 시각 기준). ${action === 'exact' ? '왈프 팀이 같은 상품인지 확인했어요.' : '같은 상품일 수 있어요. 확인하지 못한 점을 함께 적었어요.'} 먼저 팔릴 수 있어요.`,
        link: `walf://watch/${w.id}`, watchId: w.id, isMock: mock, dedupeKey: `watch:${w.id}:discovery:${o.url}` });
    }
  } else if (action === 'alternative') {
    D.notifyUser(db, w.user_id, { kind: 'watch_alternatives', title: '기다리는 동안 볼 비슷한 옷을 골라 봤어요', body: '같은 상품은 아니에요. 기다려줘는 그대로 계속돼요.',
      link: `walf://watch/${w.id}`, watchId: w.id, isMock: mock, dedupeKey: `watch:${w.id}:alternatives:${Math.floor(t / 86_400_000)}` });
  }
  return offerOf(one(db, 'SELECT * FROM offers WHERE id=?', o.id)!);
}

/** 찾아줘 결과를 공개할 때 검수해 둔(공개 대기) 후보도 함께 공개한다. 공개한 등급 목록을 돌려준다 */
export function publishPendingOffers(db: DB, requestId: number, t = now()) {
  const rows = db.prepare(`SELECT DISTINCT publish_tier FROM offers WHERE request_id=? AND review_state='approved' AND published=0 AND publish_tier IS NOT NULL`).all(requestId) as Row[];
  // 같은 페이지가 여러 탐색에 있으면 가장 최근 줄만 공개한다
  run(db, `UPDATE offers SET published=1, published_at=? WHERE request_id=? AND review_state='approved' AND published=0 AND publish_tier IS NOT NULL
    AND id=(SELECT MAX(id) FROM offers x WHERE x.request_id=offers.request_id AND x.url_key=offers.url_key AND x.relation=offers.relation AND x.review_state='approved')`, t, requestId);
  return rows.map(x => x.publish_tier as string);
}

function logPublished(db: DB, r: Row, tiers: string[], operator: string, mock: boolean) {
  if (tiers.includes('exact') || tiers.includes('possible'))
    D.log(db, r.id, 'team', 'offers_published', '왈프 팀이 판매처를 확인했어요', tiers.includes('exact') ? '같은 상품을 파는 곳을 찾았어요 · 가격·재고는 바뀔 수 있어요' : '같은 상품일 수 있는 판매처예요 · 확인하지 못한 점을 함께 적었어요', { operator, isMock: mock });
  if (tiers.includes('alternative')) D.log(db, r.id, 'team', 'alternatives_published', '비슷한 디자인의 옷을 골랐어요', '같은 상품은 아니에요 · 비슷한 점과 다른 점을 함께 적었어요', { operator, isMock: mock });
}
/** 같은 의뢰·같은 등급의 알림은 한 번만 */
export function notifyPublished(db: DB, r: Row, tiers: string[], mock: boolean, t = now()) {
  const day = Math.floor(t / 86_400_000);
  if (tiers.includes('exact')) D.notify(db, r, 'find_offers', '같은 옷을 파는 곳을 찾았어요', '왈프 팀이 같은 상품인지 확인했어요. 가격·재고는 바뀔 수 있으니 판매 페이지에서 확인해 주세요.', `walf://find/${r.id}`, { isMock: mock, dedupeKey: `offers:${r.id}:exact:${day}` });
  else if (tiers.includes('possible')) D.notify(db, r, 'find_offers', '같은 옷일 수 있는 판매처가 있어요', '확인하지 못한 점을 함께 적었어요. 판매 페이지에서 한 번 더 확인해 주세요.', `walf://find/${r.id}`, { isMock: mock, dedupeKey: `offers:${r.id}:possible:${day}` });
  if (tiers.includes('alternative')) D.notify(db, r, 'find_alternatives', '비슷한 디자인의 옷을 골라 봤어요', '같은 상품은 아니에요. 비슷한 점과 다른 점을 함께 적었어요.', `walf://find/${r.id}`, { isMock: mock, dedupeKey: `offers:${r.id}:alternative:${day}` });
}
export { logPublished };

// ── 앱 화면용(공개된 것만) ───────────────────────────────────
const parse = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export type OfferCard = {
  id: number; tier: 'exact' | 'possible' | 'alternative'; seller: string; brand: string | null; name: string | null; imageUrl: string | null; url: string | null; isMock: boolean;
  price: number | null; salePrice: number | null; shipping: number | null; total: number | null; condition: 'new' | 'used' | 'unknown';
  sizeLabel: string | null; basisLabel: string; confirmed: string[]; unconfirmed: string[]; similarPoints: string[]; diffPoints: string[]; teamNote: string | null;
  /** 이 사용자의 직접 평가(대체 상품만): like | not_quite | not_interested | null */
  feedback?: string | null;
};
/** mock://image/x.svg → 앱이 읽을 수 있는 PNG 주소(테스트 소스가 켜졌을 때만 서버가 준다) */
export const imageFor = (u: string | null, base: string) => !u ? null : u.startsWith('mock://image/') ? `${base}/api/mock-image/${encodeURIComponent(u.slice(13))}` : /^https?:\/\//.test(u) ? u : null;
/** 판정 근거를 사용자 말로(사이즈는 sizeLabel 로 따로 보여 준다) */
function userCheck(c: StoredOffer['checks'][number]) {
  if (c.field === 'size') return null;
  if (c.field === 'image') return '사진으로는 비교하지 않았어요';
  if (c.field === 'name') return c.result === 'match' ? '상품명 일치' : '상품명 표기가 달라 같은 상품인지 확실하지 않아요';
  if (c.field === 'brand') return c.result === 'match' ? '브랜드 일치' : '판매 페이지에서 브랜드를 확인하지 못했어요';
  if (c.field === 'model_code' && c.result !== 'match') return '판매 페이지에 품번이 없어요';
  if (c.field === 'color' && c.result !== 'match') return '색상을 확인하지 못했어요';
  return c.text;
}
export function card(o: StoredOffer, size: string | null, base: string): OfferCard {
  const item = o.salePrice ?? o.price;
  const stockOf = (s: string) => s === 'in_stock' ? '있음' : s === 'sold_out' ? '품절' : '확인 필요';
  const sizeLabel = size ? { ok: `${size} 재고 있음`, sold_out: `${size} 품절`, missing: `${size} 옵션 없음`, unknown: `${size} 재고 확인 필요`, any: null }[o.wantSize]
    : o.options.length ? o.options.map(x => `${x.size || '?'} ${stockOf(x.stock)}`).join(' · ') : null;
  const t = o.fetchedAt ? `${kWhen(o.fetchedAt)} 판매 페이지 기준` : o.relation === 'similar' ? '추천 정보 기준' : '검색 결과 기준';
  return {
    id: o.id, tier: o.publishTier as OfferCard['tier'], seller: o.seller, brand: o.brand,
    name: o.brand && o.name && o.name.toLowerCase().startsWith(o.brand.toLowerCase() + ' ') ? o.name.slice(o.brand.length + 1) : o.name, imageUrl: imageFor(o.imageUrl, base), url: /^https?:\/\//.test(o.url) ? o.url : null, isMock: o.isMock,
    price: o.price, salePrice: o.salePrice, shipping: o.shipping, total: item != null && o.shipping != null ? item + o.shipping : null, condition: o.condition,
    sizeLabel, basisLabel: `${t} · 가격·재고는 바뀔 수 있어요`,
    confirmed: o.checks.filter(c => c.result === 'match').map(userCheck).filter(Boolean) as string[],
    unconfirmed: o.checks.filter(c => c.result === 'unknown' || c.result === 'not_checked').map(userCheck).filter(Boolean) as string[],
    similarPoints: o.similarPoints, diffPoints: o.diffPoints, teamNote: o.publishTier === 'exact' && o.reviewNote ? o.reviewNote : null,
  };
}
type Part = { state: 'not_started' | 'searching' | 'reviewing' | 'ready' | 'none' | 'failed'; searchedLabel: string | null };
function partState(db: DB, requestId: number, purpose: 'find' | 'similar', published: number): Part {
  const s = one(db, `SELECT * FROM offer_searches WHERE request_id=? AND purpose=? ORDER BY id DESC LIMIT 1`, requestId, purpose);
  const searchedLabel = s?.finished_at ? kWhen(s.finished_at) : null;
  if (published) return { state: 'ready', searchedLabel };
  if (!s) return { state: 'not_started', searchedLabel };
  if (['queued', 'running'].includes(s.status)) return { state: 'searching', searchedLabel };
  if (s.status === 'failed') return { state: 'failed', searchedLabel };
  const pending = one(db, `SELECT COUNT(*) n FROM offers WHERE request_id=? AND relation=? AND review_state='pending' AND verdict<>'different' AND search_id=?`, requestId, purpose === 'find' ? 'same' : 'similar', s.id)!.n;
  return { state: pending ? 'reviewing' : 'none', searchedLabel };
}
/** 찾아줘 결과 화면의 판매처(같은 상품)·대체 상품 — 운영자가 공개한 것만. 검수 전 후보는 개수도 보여 주지 않는다(“확인 중”만) */
export function offersView(db: DB, r: Row, base: string) {
  // 같은 등급 안에서는 가장 최근 탐색·추천(선호를 바꿨으면 그 기준)의 순서가 먼저, 예전 추천에서 남은 공개분은 뒤에
  const rows = (db.prepare(`SELECT * FROM offers WHERE request_id=? AND published=1 ORDER BY CASE publish_tier WHEN 'exact' THEN 0 WHEN 'possible' THEN 1 ELSE 2 END, search_id DESC, rank`).all(r.id) as Row[]).map(offerOf);
  const size = r.size ? String(r.size).toUpperCase() : null;
  const cards = rows.map(o => card(o, size, base));
  const exact = cards.filter(c => c.tier === 'exact'), possible = cards.filter(c => c.tier === 'possible');
  const fb = feedbackMap(db, r.user_id, cards.filter(c => c.tier === 'alternative').map(c => c.id));
  const alts = cards.filter(c => c.tier === 'alternative').map(c => ({ ...c, feedback: fb.get(c.id) ?? null }));
  const last = one(db, `SELECT report FROM offer_searches WHERE request_id=? AND purpose='find' AND status='done' ORDER BY id DESC LIMIT 1`, r.id);
  const rep = parse(last?.report ?? null, []) as { outcome: string; label: string }[];
  const searched = rep.filter(x => x.outcome !== 'not_run');
  return {
    sale: { ...partState(db, r.id, 'find', exact.length + possible.length), exact, possible,
      searchedSources: searched.map(x => x.label), notSearchedCount: rep.length - searched.length,
      note: '중고 플랫폼(번개장터 등)은 약관·제휴 확인 전이라 자동으로 찾지 않아요. 7일 매물 찾기를 고르면 왈프 팀이 직접 살펴봐요.' },
    alternatives: { ...partState(db, r.id, 'similar', alts.length), items: alts },
    priority: r.priority ?? null, priorities: priorityOptions(r.priority),
  };
}
