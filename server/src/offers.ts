// 실제 상품 후보(Offer) — 판매처의 상품 페이지 하나. 찾아줘 판매처 탐색(relation=same)과 대체 상품 추천(relation=similar)이 같은 모양을 쓴다.
// AI가 어떤 옷인지 식별한 결과(product_identities)와는 다른 결과다: 식별했다고 판매 중인 매물이 있다는 뜻이 아니다.
// 외부 추천 엔진(패션 브레인 등)이 주는 값도 cleanOffer 를 거쳐야 저장된다. 검수 전에는 사용자에게 보이지 않는다.
import { type DB, tx } from './db.ts';
import { urlKey, type Stock } from './sources.ts';
import { CONDITION_LABEL, CONDITIONS, cleanStyle, colorsIn, newLike, normSize, sameColor, type Condition, type Style } from './catalog.ts';
import type { Check, Verdict } from './sameproduct.ts';
import { now } from './time.ts';
import { fxText, type Fx } from './fx.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const parse = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const json = (v: unknown) => JSON.stringify(v);

export type OfferOption = { color: string; size: string; stock: Stock; price: number | null };
export type WantSize = 'ok' | 'sold_out' | 'missing' | 'unknown' | 'any';
export type WantColor = 'ok' | 'other' | 'unknown' | 'any';
export type ProductOffer = {
  relation: 'same' | 'similar';
  source: string; seller: string; url: string;
  brand: string | null; name: string | null; modelCode: string | null; season: string | null; imageUrl: string | null;
  price: number | null; salePrice: number | null; currency: string; shipping: number | null;
  /** new · unused(미사용) · deadstock(단종 신품 재고) · used · unknown — catalog.ts conditionOf */
  condition: Condition;
  options: OfferOption[]; stock: Stock; wantSize: WantSize; wantColor: WantColor;
  verdict: Verdict; checks: Check[];
  /** 원래 옷과 비슷한 점·다른 점(추천 상품은 필수, 같은 상품 후보는 색·상태 차이 등) */
  similarPoints: string[]; diffPoints: string[];
  /** 이 상품의 디자인 요소(실루엣·소재·디테일 등 통제 어휘) — 대체 상품 정렬에 쓴다 */
  style: Style | null;
  /** 누가 골랐는지 — 규칙 탐색이면 walf-rules, 외부 추천 엔진이면 그 이름과 버전 */
  recommender: string; recommenderVersion: string; score: number | null;
  detail: 'fetched' | 'listed_only' | 'failed'; detailNote: string | null; queries: string[]; fetchedAt: number | null;
  groupKey: string | null; isMock: boolean;
  /** 판매처 탐색: 어느 식별 후보 기준으로 검증했는지(여러 후보를 함께 찾을 때) — 예: ai_identity:12 · 1부터 */
  targetRef?: string | null; targetRank?: number | null;
  /** 맡긴 사진과의 사진 유사도(코사인, 로컬 이미지 모델) — 같은 상품 판정 근거가 아니다. 정렬·비교에만 쓴다 */
  imageScore?: number | null; imageModel?: string | null;
};
export const RULES_RECOMMENDER = { recommender: 'walf-rules', recommenderVersion: 'find-search-1' };

// ── 외부 값 정리 ─────────────────────────────────────────────
const str = (v: unknown, max: number) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return s || null; };
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean).slice(0, n) as string[];
const won = (v: unknown) => { if (v == null || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null; };
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok as readonly string[]).includes(String(v)) ? v as T : d;
const STOCKS = ['in_stock', 'sold_out', 'unknown'] as const;
const VERDICTS = ['same_code', 'likely', 'unverified', 'different'] as const;

/**
 * 외부(추천 엔진·검색 소스)가 준 상품 후보를 저장할 수 있는 모양으로 맞춘다. 주소·판매처·이름·추천 모델이 없으면 버린다(null).
 * 판정(verdict)은 외부 값을 믿지 않고 unverified 로 둔다 — 같은 상품인지는 WALF 규칙(sameproduct.ts)과 운영자가 정한다.
 */
export function cleanOffer(raw: any, opts: { mockAllowed?: boolean; relation?: 'same' | 'similar' } = {}): ProductOffer | null {
  const url = str(raw?.url, 1000);
  const okUrl = !!url && (/^https?:\/\//i.test(url) || (!!opts.mockAllowed && url.startsWith('mock://')));
  const seller = str(raw?.seller, 60), name = str(raw?.name, 160);
  const recommender = str(raw?.recommender, 60), version = str(raw?.recommenderVersion, 40);
  if (!okUrl || !seller || !name || !recommender || !version) return null;
  const relation = opts.relation || pick(raw?.relation, ['same', 'similar'] as const, 'similar');
  const options: OfferOption[] = (Array.isArray(raw?.options) ? raw.options : []).slice(0, 60).map((o: any) => ({
    color: str(o?.color, 30) || '', size: normSize(str(o?.size, 20)), stock: pick(o?.stock, STOCKS, 'unknown'), price: won(o?.price),
  }));
  const img = str(raw?.imageUrl, 1000);
  const score = Number(raw?.score);
  return {
    relation, source: str(raw?.source, 40) || recommender, seller, url: url!,
    brand: str(raw?.brand, 60), name, modelCode: str(raw?.modelCode, 40), season: str(raw?.season, 40),
    imageUrl: img && (/^https?:\/\//i.test(img) || (opts.mockAllowed && img.startsWith('mock://'))) ? img : null,
    price: won(raw?.price), salePrice: won(raw?.salePrice), currency: raw?.currency == null || raw?.currency === '' ? 'KRW' : /^[A-Z]{3}$/.test(String(raw.currency).trim().toUpperCase()) ? String(raw.currency).trim().toUpperCase() : 'XXX', shipping: won(raw?.shipping), // 통화를 알 수 없으면 XXX(비교하지 않음)
    condition: pick(raw?.condition, CONDITIONS, 'unknown'),
    options, stock: pick(raw?.stock, STOCKS, 'unknown'), wantSize: 'unknown', wantColor: 'unknown',
    verdict: 'unverified', checks: [],
    similarPoints: strs(raw?.similarPoints, 6, 120), diffPoints: strs(raw?.diffPoints, 6, 120), style: raw?.style ? cleanStyle(raw.style) : null,
    recommender: recommender!, recommenderVersion: version!, score: Number.isFinite(score) ? Math.round(score * 1000) / 1000 : null,
    detail: 'listed_only', detailNote: null, queries: [], fetchedAt: null, groupKey: null, isMock: url!.startsWith('mock://'),
  };
}

/** 할인가가 있으면 할인가, 없으면 판매가 */
export const itemPrice = (o: Pick<ProductOffer, 'price' | 'salePrice'>) => o.salePrice ?? o.price;
/** 배송비를 알면 총액, 모르면 null(배송비를 0원으로 치지 않는다) */
export const totalPrice = (o: Pick<ProductOffer, 'price' | 'salePrice' | 'shipping'>) => itemPrice(o) != null && o.shipping != null ? itemPrice(o)! + o.shipping : null;

// ── 기다려줘 조건과 맞는지(새 매물 알림) ──────────────────────────
// 원하는 가격·색상·사이즈 재고·상품 상태를 하나씩 본다. 모두 “확인됨”일 때만 met — 확인하지 못한 값은 충족으로 치지 않는다(unknown).
// 가격은 판매가 기준이다. 표시된 할인가만 목표 이하면 적용 조건(회원·쿠폰 등)을 모르므로 unknown(가격 감시 watch.ts 의 sale_only 와 같은 규칙).
export type WatchWant = { size: string | null; color: string | null; condition: 'new' | 'any'; targetPrice: number; basis: 'total' | 'item' };
export type Fit = { state: 'met' | 'unmet' | 'unknown'; met: string[]; unmet: string[]; unknown: string[] };
export const watchWantOf = (w: Row): WatchWant => ({ size: w.size ? normSize(w.size) : null, color: w.color || null, condition: w.condition === 'new' ? 'new' : 'any',
  targetPrice: Number(w.target_price), basis: w.price_basis === 'item' ? 'item' : 'total' });
const wonText = (n: number) => `${n.toLocaleString('ko-KR')}원`;
/** fx: 원화가 아닌 가격일 때 쓸 환율(출처·기준 시각 포함). 없으면 가격 조건은 “확인 못 함” */
export function fitOf(o: Pick<ProductOffer, 'options' | 'name' | 'condition' | 'stock' | 'price' | 'salePrice' | 'shipping'> & { currency?: string | null }, want: WatchWant, fx: Fx | null = null): Fit {
  const met: string[] = [], unmet: string[] = [], unknown: string[] = [];
  // 색상: 옵션에 색이 있으면 옵션 색, 없으면 상품명에 적힌 색으로만
  const optColors = [...new Set(o.options.map(x => x.color).filter(Boolean))];
  const have = optColors.length ? optColors : colorsIn(o.name).length ? [o.name!] : [];
  if (want.color) {
    if (!have.length) unknown.push(`${want.color} 색상인지 확인하지 못했어요`);
    else if (have.some(c => sameColor(want.color, c))) met.push(`${want.color} 색상`);
    else unmet.push(`원하는 색(${want.color})이 아니에요`);
  }
  // 사이즈·재고: 원하는 사이즈(색이 정해졌으면 그 색) 옵션의 재고. 사이즈를 정하지 않았으면 페이지 재고
  const sizeRows = o.options.filter(x => !want.size || normSize(x.size) === want.size);
  const rows = sizeRows.filter(x => !want.color || !x.color || sameColor(want.color, x.color));
  const label = want.size ? `${want.size} ` : '';
  if (want.size && o.options.length && !sizeRows.length) unmet.push(`${want.size} 사이즈 옵션이 없어요`);
  else if (sizeRows.length && !rows.length) { if (!unmet.length) unmet.push(`${want.color} ${label}옵션이 없어요`); } // 색이 달라 맞는 옵션이 없으면 색상에서 이미 말했다
  else if (rows.some(x => x.stock === 'in_stock') || (!o.options.length && !want.size && o.stock === 'in_stock')) met.push(`${label}재고 있음`);
  else if ((rows.length && rows.every(x => x.stock === 'sold_out')) || (!o.options.length && !want.size && o.stock === 'sold_out')) unmet.push(`${label}품절이에요`);
  else unknown.push(want.size && !o.options.length ? `페이지에 사이즈별 재고가 없어 ${want.size} 재고를 확인하지 못했어요` : `${label}재고를 확인하지 못했어요`);
  // 상품 상태
  if (want.condition === 'new') {
    if (newLike(o.condition)) met.push(CONDITION_LABEL[o.condition]);
    else if (o.condition === 'used') unmet.push('중고예요(새 상품만 원하셨어요)');
    else unknown.push('새 상품인지 확인하지 못했어요');
  }
  // 가격(판매가 기준. 원하는 옵션의 가격이 따로 있으면 그 가격). 원화가 아니면 출처·기준 시각이 있는 환율로만 바꿔 비교하고, 해외 배송비·관부가세는 확인 못 함으로 둔다
  const cur = o.currency || 'KRW';
  const foreign = cur !== 'KRW';
  if (foreign && !fx) { unknown.push(cur === 'XXX' ? '가격의 통화를 확인하지 못했어요' : `${cur} 가격이라 환율을 확인한 뒤 비교해요`); return { state: unmet.length ? 'unmet' : 'unknown', met, unmet, unknown }; }
  const krw = (n: number | null | undefined) => n == null ? null : foreign ? Math.round(n * fx!.krwPerUnit) : n;
  const price = krw(rows.find(x => x.stock === 'in_stock' && x.price != null)?.price ?? o.price);
  const ship = want.basis === 'item' ? 0 : krw(o.shipping);
  const sale = krw(o.salePrice);
  const saleOk = sale != null && sale + (ship ?? 0) <= want.targetPrice;
  if (foreign && want.basis === 'total') unknown.push('해외 배송비·관부가세·구매대행 비용을 확인하지 못했어요');
  if (price == null) unknown.push('가격을 읽지 못했어요');
  else if (price + (ship ?? 0) > want.targetPrice) (saleOk ? unknown : unmet).push(saleOk ? `표시된 할인가 ${wonText(o.salePrice!)}은 적용 조건(회원·쿠폰 등)을 확인하지 못했어요` : `원하는 가격보다 ${wonText(price + (ship ?? 0) - want.targetPrice)} 높아요${ship == null ? '(배송비 미확인)' : ''}`);
  else if (ship == null) unknown.push(`상품가 ${wonText(price)}은 원하는 가격 이하지만 배송비를 확인하지 못했어요`);
  else met.push((want.basis === 'item' ? `상품가 ${wonText(price)}(배송비 제외 기준)` : `배송비 포함 ${wonText(price + ship)}`) + (foreign ? ` · ${fxText(fx!)}` : ''));
  return { state: unmet.length ? 'unmet' : unknown.length ? 'unknown' : 'met', met, unmet, unknown };
}

// ── 저장 · 읽기 ──────────────────────────────────────────────
/** 탐색 한 번의 결과를 순위대로 저장한다. 같은 상품 페이지는 listings 에 한 줄(처음 본 시각을 남겨 새 매물을 가른다) */
export function saveOffers(db: DB, searchId: number, owner: { requestId?: number | null; watchId?: number | null }, offers: ProductOffer[], t = now()) {
  const requestId = owner.requestId ?? null, watchId = owner.watchId ?? null;
  tx(db, () => {
    const ins = db.prepare(`INSERT INTO offers(search_id, request_id, listing_id, relation, rank, group_key, source, seller, url, url_key, brand, name, model_code, season, image_url,
      price, sale_price, currency, shipping, condition, options, stock, want_size, want_color, verdict, checks, similar_points, diff_points, recommender, recommender_version, score,
      detail, detail_note, queries, fetched_at, is_mock, created_at, style, watch_id, target_ref, target_rank, image_score, image_model) VALUES (${Array(43).fill('?').join(',')})`);
    offers.forEach((o, i) => {
      const key = urlKey(o.url);
      let l = one(db, 'SELECT id FROM listings WHERE url_key=?', key);
      if (!l) {
        db.prepare(`INSERT INTO listings(product_id, source, seller, url, url_key, title, condition, identity, is_mock, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(null, o.source, o.seller, o.url, key, o.name, o.condition, 'unverified', o.isMock ? 1 : 0, t, t); // 미확인을 새 상품으로 바꿔 적지 않는다
        l = one(db, 'SELECT id FROM listings WHERE url_key=?', key)!;
      } else db.prepare('UPDATE listings SET last_seen=? WHERE id=?').run(t, l.id);
      ins.run(searchId, requestId, l.id, o.relation, i + 1, o.groupKey, o.source, o.seller, o.url, key, o.brand, o.name, o.modelCode, o.season, o.imageUrl,
        o.price, o.salePrice, o.currency, o.shipping, o.condition, json(o.options), o.stock, o.wantSize, o.wantColor, o.verdict, json(o.checks), json(o.similarPoints), json(o.diffPoints),
        o.recommender, o.recommenderVersion, o.score, o.detail, o.detailNote, json(o.queries), o.fetchedAt, o.isMock ? 1 : 0, t, o.style ? json(o.style) : null, watchId, o.targetRef ?? null, o.targetRank ?? null, o.imageScore ?? null, o.imageModel ?? null);
      // 같은 의뢰에서 같은 페이지를 다시 찾으면 운영자 검수를 이어받는다(공개 중이면 새 줄로 옮겨 최신 가격으로 보이게)
      const id = Number(one(db, 'SELECT last_insert_rowid() id')!.id);
      if (requestId != null || watchId != null) {
        const prev = one(db, `SELECT * FROM offers WHERE ${requestId != null ? 'request_id' : 'watch_id'}=? AND url_key=? AND relation=? AND id<? AND review_state<>'pending' ORDER BY id DESC LIMIT 1`, requestId ?? watchId, key, o.relation, id);
        if (prev) {
          db.prepare('UPDATE offers SET review_state=?, publish_tier=?, published=?, published_at=?, reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?')
            .run(prev.review_state, prev.publish_tier, prev.published, prev.published_at, prev.reviewed_by, prev.reviewed_at, prev.review_note, id);
          if (prev.published) db.prepare('UPDATE offers SET published=0 WHERE id=?').run(prev.id);
        }
      }
    });
  });
}

/**
 * 대체 상품은 가장 최근에 끝난 추천 결과만 보여 준다(SQL 조건, offers 표 기준). 선호를 바꿔 다시 고르면 예전 추천에만 있던 옷은 화면에서 빠진다.
 * 검수 결과는 지우지 않는다 — 다시 같은 페이지를 고르면 saveOffers 가 그 검수를 이어받는다
 */
export const currentSimilar = (owner: 'request_id' | 'watch_id') =>
  `(relation<>'similar' OR search_id=(SELECT MAX(s.id) FROM offer_searches s WHERE s.${owner}=offers.${owner} AND s.purpose='similar' AND s.status='done'))`;

export type StoredOffer = ProductOffer & { id: number; searchId: number; requestId: number | null; watchId: number | null; rank: number; listingId: number | null;
  reviewState: 'pending' | 'approved' | 'rejected'; publishTier: 'exact' | 'possible' | 'alternative' | null; published: boolean; publishedAt: number | null;
  reviewedBy: string | null; reviewedAt: number | null; reviewNote: string | null };
export function offerOf(r: Row): StoredOffer {
  return {
    id: r.id, searchId: r.search_id, requestId: r.request_id, watchId: r.watch_id ?? null, rank: r.rank, listingId: r.listing_id, reviewState: r.review_state, publishTier: r.publish_tier ?? null,
    published: !!r.published, publishedAt: r.published_at ?? null, reviewedBy: r.reviewed_by ?? null, reviewedAt: r.reviewed_at ?? null, reviewNote: r.review_note ?? null, style: parse(r.style, null),
    relation: r.relation, source: r.source, seller: r.seller, url: r.url, brand: r.brand, name: r.name, modelCode: r.model_code, season: r.season, imageUrl: r.image_url,
    price: r.price, salePrice: r.sale_price, currency: r.currency, shipping: r.shipping, condition: r.condition, options: parse(r.options, []), stock: r.stock,
    wantSize: r.want_size, wantColor: r.want_color, verdict: VERDICTS.includes(r.verdict) ? r.verdict : 'unverified', checks: parse(r.checks, []),
    similarPoints: parse(r.similar_points, []), diffPoints: parse(r.diff_points, []), recommender: r.recommender, recommenderVersion: r.recommender_version, score: r.score, imageScore: r.image_score ?? null, imageModel: r.image_model ?? null,
    detail: r.detail, detailNote: r.detail_note, queries: parse(r.queries, []), fetchedAt: r.fetched_at, groupKey: r.group_key, isMock: !!r.is_mock,
    targetRef: r.target_ref ?? null, targetRank: r.target_rank ?? null,
  };
}
export const offersOf = (db: DB, searchId: number) => all(db, 'SELECT * FROM offers WHERE search_id=? ORDER BY rank', searchId).map(offerOf);
