// 판매처 후보·대체 상품 검수 — 자동 탐색·추천 결과는 운영자가 고른 것만 사용자에게 보인다(기존 검수 정책 그대로).
// exact: 같은 상품 확인(품번 일치 또는 운영자가 확인한 근거) · possible: 같은 상품일 수 있음 · alternative: 비슷한 디자인(같은 상품 아님).
// 어느 쪽도 “구매 가능”을 뜻하지 않는다 — 가격·재고는 페이지를 읽은 시각 기준이고, 바뀔 수 있다고 함께 보여 준다.
import { type DB, tx } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { currentSimilar, fitOf, offerOf, watchWantOf, type Fit, type ProductOffer, type StoredOffer } from './offers.ts';
import { CONDITION_LABEL, colorsIn, newLike, sameColor, type Condition } from './catalog.ts';
import { logReview } from './reviewlog.ts';
import { feedbackMap, priorityOptions } from './feedback.ts';
import { now, kWhen } from './time.ts';
import type { Coverage } from './findsearch.ts';
import { latestFx } from './fx.ts';

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
  price: o.salePrice ?? o.price, shipping: o.shipping, similarPoints: o.similarPoints, diffPoints: o.diffPoints, targetRef: o.targetRef ?? null, targetRank: o.targetRank ?? null });

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
/**
 * 이 후보가 기다려줘 조건(원하는 가격·색상·사이즈 재고·상품 상태)에 맞는지 — 페이지를 읽은 시각 기준.
 * met 은 모든 조건이 “확인됨”일 때만이다. 확인하지 못한 값(배송비·재고·색상·상태·할인 조건)이 하나라도 있으면 unknown 이고 알림을 보내지 않는다.
 */
/** db 를 주면 원화가 아닌 후보에 최근 환율(출처·기준 시각)을 붙여 판단한다 — 없으면 가격은 확인 못 함 */
export const watchFit = (o: StoredOffer | ProductOffer, w: Row, db?: DB): Fit => fitOf(o, watchWantOf(w), db && o.currency && o.currency !== 'KRW' ? latestFx(db, o.currency) : null);
export const meetsWatch = (o: StoredOffer | ProductOffer, w: Row) => watchFit(o, w).state === 'met';
function watchEvent(db: DB, w: Row, kind: string, title: string, detail: string, t: number) {
  run(db, 'INSERT INTO watch_events(watch_id, actor, kind, title, detail, is_mock, at) VALUES (?,?,?,?,?,?,?)', w.id, 'team', kind, title, detail, w.is_mock, t);
}
const fitText = (f: Fit) => f.state === 'met' ? '원하는 조건 충족(페이지를 읽은 시각 기준)' : f.state === 'unmet' ? `조건과 달라요: ${f.unmet.join(' · ')}` : `확인하지 못한 조건: ${f.unknown.join(' · ')}`;
/**
 * 기다려줘 화면은 늘 보이므로 검수하면 바로 공개한다. 알림은 원하는 조건이 모두 확인된 후보만(같은 페이지는 한 번), 대체 상품은 하루 한 번.
 * 같은 상품 확인(exact)과 같은 상품일 수 있음(possible)은 알림 종류·문구를 나눈다 — possible 은 “조건에 맞는 같은 상품”이라고 말하지 않는다.
 */
function reviewWatchOffer(db: DB, o: StoredOffer, action: ReviewAction, reason: string, operator: string) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', o.watchId);
  if (!w) throw new HttpError(404, 'not_found');
  if (w.status === 'ended' && action !== 'hide' && action !== 'reject') throw new HttpError(409, 'bad_state', '끝난 기다려줘에는 공개할 수 없어요.');
  const t = now();
  const mock = o.isMock || !!w.is_mock;
  const fit = watchFit(o, w, db);
  tx(db, () => {
    if (action === 'reject') run(db, `UPDATE offers SET review_state='rejected', publish_tier=NULL, published=0, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`, operator, t, reason, o.id);
    else if (action === 'hide') run(db, 'UPDATE offers SET published=0, reviewed_by=?, reviewed_at=? WHERE id=?', operator, t, o.id);
    else {
      run(db, `UPDATE offers SET review_state='approved', publish_tier=?, published=1, published_at=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`, action, t, operator, t, reason || null, o.id);
      // 대체 상품 기록은 하루 한 줄(여러 벌을 공개해도)
      if (action === 'alternative') { if (!one(db, `SELECT 1 FROM watch_events WHERE watch_id=? AND kind='alternatives_published' AND at>?`, w.id, t - 86_400_000)) watchEvent(db, w, 'alternatives_published', '기다리는 동안 볼 비슷한 옷을 골랐어요', '같은 상품은 아니에요 · 기다려줘는 그대로 계속돼요', t); }
      else watchEvent(db, w, 'discovery_published', action === 'exact' ? '왈프 팀이 다른 판매처를 확인했어요' : '같은 상품일 수 있는 판매처를 찾았어요',
        `${o.seller} · ${action === 'exact' ? '같은 상품 확인' : '같은 상품인지 확정하지 못함'} · ${fitText(fit)} · 가격·재고는 바뀔 수 있어요`, t);
    }
    logReview(db, { operator, subject: 'offer', subjectId: o.id, watchId: w.id, action, auto: { ...autoOf(o), meetsWatch: fit.state === 'met', fit }, reason: reason || null, isMock: mock, at: t });
  });
  if ((action === 'exact' || action === 'possible') && fit.state === 'met') {
    const amount = fit.met.find(x => /원/.test(x)) || '';
    if (action === 'exact')
      D.notifyUser(db, w.user_id, { kind: 'watch_discovery', title: '다른 판매처에서 원하는 조건의 매물을 찾았어요',
        body: `${o.seller} · ${[amount, ...fit.met.filter(x => x !== amount)].join(' · ')}(페이지를 읽은 시각 기준). 왈프 팀이 같은 상품인지 확인했어요. 먼저 팔릴 수 있어요.`,
        link: `walf://watch/${w.id}`, watchId: w.id, isMock: mock, dedupeKey: `watch:${w.id}:discovery:${o.url}` });
    else
      D.notifyUser(db, w.user_id, { kind: 'watch_discovery_possible', title: '같은 옷일 수 있는 매물이 있어요',
        body: `${o.seller} · ${amount}(페이지를 읽은 시각 기준). 같은 상품인지는 아직 확정하지 못했어요. 판매 페이지에서 품번·사진을 꼭 확인해 주세요.`,
        link: `walf://watch/${w.id}`, watchId: w.id, isMock: mock, dedupeKey: `watch:${w.id}:possible:${o.url}` });
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
/** 카드에 한 줄로 보이는 옵션 사실 — ok: 원하는 조건과 맞음 · no: 다름 · unknown: 확인 못 함 · info: 원하는 조건이 없어 페이지 값만 */
export type OptionFact = { kind: 'color' | 'size' | 'condition'; state: 'ok' | 'no' | 'unknown' | 'info'; text: string };
/** 카드가 비교할 사용자의 조건(찾아줘 의뢰·기다려줘) */
export type CardWant = { size: string | null; color: string | null; usedOk: boolean };
export const wantOfRequest = (r: Row): CardWant => ({ size: r.size ? String(r.size).toUpperCase() : null, color: r.color || null, usedOk: !!r.used_ok });
export const wantOfWatch = (w: Row): CardWant => ({ size: w.size ? String(w.size).toUpperCase() : null, color: w.color || null, usedOk: w.condition !== 'new' });
export type OfferCard = {
  id: number; tier: 'exact' | 'possible' | 'alternative'; seller: string; brand: string | null; name: string | null; imageUrl: string | null; url: string | null; isMock: boolean;
  price: number | null; salePrice: number | null; shipping: number | null; total: number | null; condition: Condition;
  sizeLabel: string | null; basisLabel: string; confirmed: string[]; unconfirmed: string[]; similarPoints: string[]; diffPoints: string[]; teamNote: string | null;
  /** 색상·사이즈·상태 — 원하는 조건과 맞는지 함께(확인 못 한 값은 “확인 필요”) */
  facts: OptionFact[];
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
const COLOR_KO: Record<string, string> = { black: '블랙', white: '화이트', navy: '네이비', blue: '블루', gray: '그레이', brown: '브라운', beige: '베이지', green: '그린', red: '레드', pink: '핑크', yellow: '옐로우', purple: '퍼플', orange: '오렌지', silver: '실버' };
const colorText = (s: string) => colorsIn(s).map(c => COLOR_KO[c] || c).join('') || s;
function optionFacts(o: StoredOffer, want: CardWant, sizeLabel: string | null): OptionFact[] {
  const out: OptionFact[] = [];
  const optColors = [...new Set(o.options.map(x => x.color).filter(Boolean))];
  const have = optColors.length ? optColors : colorsIn(o.name).length ? [o.name!] : [];
  if (want.color) out.push(!have.length ? { kind: 'color', state: 'unknown', text: `${want.color} 색상인지 확인 필요` }
    : have.some(c => sameColor(want.color, c)) ? { kind: 'color', state: 'ok', text: `${colorText(want.color)} 색상` }
    : { kind: 'color', state: 'no', text: `색상 다름(${[...new Set(have.map(colorText))].slice(0, 3).join('·')})` });
  else if (have.length) out.push({ kind: 'color', state: 'info', text: [...new Set(have.map(colorText))].slice(0, 3).join('·') });
  if (sizeLabel) out.push({ kind: 'size', state: !want.size ? 'info' : o.wantSize === 'ok' ? 'ok' : ['sold_out', 'missing'].includes(o.wantSize) ? 'no' : 'unknown', text: sizeLabel });
  out.push(newLike(o.condition) ? { kind: 'condition', state: want.usedOk ? 'info' : 'ok', text: CONDITION_LABEL[o.condition as Condition] }
    : o.condition === 'used' ? { kind: 'condition', state: want.usedOk ? 'ok' : 'no', text: want.usedOk ? '중고(중고 OK)' : '중고(새 상품만 원함)' }
    : { kind: 'condition', state: 'unknown', text: '새 상품·중고 확인 필요' });
  return out;
}
export function card(o: StoredOffer, want: CardWant, base: string): OfferCard {
  const size = want.size;
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
    facts: optionFacts(o, want, sizeLabel),
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
/** 카드가 모두 테스트 데이터인지, 모두 실제 판매 페이지인지(섞였으면 mixed) — 화면에서 둘을 분명히 나눈다 */
const dataKindOf = (cards: OfferCard[]) => !cards.length ? null : cards.every(c => c.isMock) ? 'test' : cards.some(c => c.isMock) ? 'mixed' : 'real';
export function offersView(db: DB, r: Row, base: string, coverage: Coverage | null = null) {
  // 대체 상품은 가장 최근 추천(선호를 바꿨으면 그 기준)만. 같은 등급 안에서는 최근 탐색의 순서대로
  const rows = (db.prepare(`SELECT * FROM offers WHERE request_id=? AND published=1 AND ${currentSimilar('request_id')} ORDER BY CASE publish_tier WHEN 'exact' THEN 0 WHEN 'possible' THEN 1 ELSE 2 END, search_id DESC, rank`).all(r.id) as Row[]).map(offerOf);
  const cards = rows.map(o => card(o, wantOfRequest(r), base));
  const exact = cards.filter(c => c.tier === 'exact'), possible = cards.filter(c => c.tier === 'possible');
  const fb = feedbackMap(db, r.user_id, cards.filter(c => c.tier === 'alternative').map(c => c.id));
  const alts = cards.filter(c => c.tier === 'alternative').map(c => ({ ...c, feedback: fb.get(c.id) ?? null }));
  const last = one(db, `SELECT report FROM offer_searches WHERE request_id=? AND purpose='find' AND status='done' ORDER BY id DESC LIMIT 1`, r.id);
  const rep = parse(last?.report ?? null, []) as { outcome: string; label: string }[];
  const searched = rep.filter(x => x.outcome !== 'not_run');
  return {
    sale: { ...partState(db, r.id, 'find', exact.length + possible.length), exact, possible,
      searchedSources: searched.map(x => x.label), notSearchedCount: rep.length - searched.length,
      /** 어디서 찾아봤는지 — 실제 판매처가 몇 곳뿐인지 숨기지 않는다 */ coverage, dataKind: dataKindOf([...exact, ...possible]),
      note: '중고 플랫폼(번개장터 등)은 약관·제휴 확인 전이라 자동으로 찾지 않아요. 7일 매물 찾기를 고르면 왈프 팀이 직접 살펴봐요.' },
    alternatives: { ...partState(db, r.id, 'similar', alts.length), items: alts, dataKind: dataKindOf(alts) },
    priority: r.priority ?? null, priorities: priorityOptions(r.priority),
  };
}
