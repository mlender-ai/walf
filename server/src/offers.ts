// 실제 상품 후보(Offer) — 판매처의 상품 페이지 하나. 찾아줘 판매처 탐색(relation=same)과 대체 상품 추천(relation=similar)이 같은 모양을 쓴다.
// AI가 어떤 옷인지 식별한 결과(product_identities)와는 다른 결과다: 식별했다고 판매 중인 매물이 있다는 뜻이 아니다.
// 외부 추천 엔진(패션 브레인 등)이 주는 값도 cleanOffer 를 거쳐야 저장된다. 검수 전에는 사용자에게 보이지 않는다.
import { type DB, tx } from './db.ts';
import { urlKey, type Stock } from './sources.ts';
import { cleanStyle, normSize, type Style } from './catalog.ts';
import type { Check, Verdict } from './sameproduct.ts';
import { now } from './time.ts';

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
  condition: 'new' | 'used' | 'unknown';
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
    price: won(raw?.price), salePrice: won(raw?.salePrice), currency: /^[A-Z]{3}$/.test(String(raw?.currency || '')) ? raw.currency : 'KRW', shipping: won(raw?.shipping),
    condition: pick(raw?.condition, ['new', 'used', 'unknown'] as const, 'unknown'),
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

// ── 저장 · 읽기 ──────────────────────────────────────────────
/** 탐색 한 번의 결과를 순위대로 저장한다. 같은 상품 페이지는 listings 에 한 줄(처음 본 시각을 남겨 새 매물을 가른다) */
export function saveOffers(db: DB, searchId: number, owner: { requestId?: number | null; watchId?: number | null }, offers: ProductOffer[], t = now()) {
  const requestId = owner.requestId ?? null, watchId = owner.watchId ?? null;
  tx(db, () => {
    const ins = db.prepare(`INSERT INTO offers(search_id, request_id, listing_id, relation, rank, group_key, source, seller, url, url_key, brand, name, model_code, season, image_url,
      price, sale_price, currency, shipping, condition, options, stock, want_size, want_color, verdict, checks, similar_points, diff_points, recommender, recommender_version, score,
      detail, detail_note, queries, fetched_at, is_mock, created_at, style, watch_id) VALUES (${Array(39).fill('?').join(',')})`);
    offers.forEach((o, i) => {
      const key = urlKey(o.url);
      let l = one(db, 'SELECT id FROM listings WHERE url_key=?', key);
      if (!l) {
        db.prepare(`INSERT INTO listings(product_id, source, seller, url, url_key, title, condition, identity, is_mock, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(null, o.source, o.seller, o.url, key, o.name, o.condition === 'used' ? 'used' : 'new', 'unverified', o.isMock ? 1 : 0, t, t);
        l = one(db, 'SELECT id FROM listings WHERE url_key=?', key)!;
      } else db.prepare('UPDATE listings SET last_seen=? WHERE id=?').run(t, l.id);
      ins.run(searchId, requestId, l.id, o.relation, i + 1, o.groupKey, o.source, o.seller, o.url, key, o.brand, o.name, o.modelCode, o.season, o.imageUrl,
        o.price, o.salePrice, o.currency, o.shipping, o.condition, json(o.options), o.stock, o.wantSize, o.wantColor, o.verdict, json(o.checks), json(o.similarPoints), json(o.diffPoints),
        o.recommender, o.recommenderVersion, o.score, o.detail, o.detailNote, json(o.queries), o.fetchedAt, o.isMock ? 1 : 0, t, o.style ? json(o.style) : null, watchId);
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
    similarPoints: parse(r.similar_points, []), diffPoints: parse(r.diff_points, []), recommender: r.recommender, recommenderVersion: r.recommender_version, score: r.score,
    detail: r.detail, detailNote: r.detail_note, queries: parse(r.queries, []), fetchedAt: r.fetched_at, groupKey: r.group_key, isMock: !!r.is_mock,
  };
}
export const offersOf = (db: DB, searchId: number) => all(db, 'SELECT * FROM offers WHERE search_id=? ORDER BY rank', searchId).map(offerOf);
