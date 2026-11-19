// 대체 상품 큐레이션 — 정확한 상품을 못 찾았거나 기다리는 동안 볼 수 있는 “비슷한 디자인의 실제 판매 상품”.
// 정렬 기준은 브랜드가 아니라 찾는 옷의 디자인이다: 제품군·실루엣 > 디테일·소재 > 색·무드. 브랜드가 비슷하다는 이유만으로 고르지 않는다.
// 추천 엔진(패션 브레인, 별도 연구)은 SimilarProductProvider 로 붙인다. 연결 전에는 권리가 확인된 테스트 Fixture(가상의 상품·직접 그린 그림)만 쓴다.
// 결과는 언제나 “같은 상품 아님”이고, 운영자 검수 전에는 사용자에게 보이지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { styleLabel, type Style, type StyleKind } from './catalog.ts';
import { cleanOffer, type ProductOffer, type WantSize } from './offers.ts';
import { compareProduct } from './sameproduct.ts';
import type { Stock } from './sources.ts';

export type SimilarInput = { style: Style; brand: string | null; name: string | null; modelCode: string | null; size: string | null; limit: number; photoPath?: string | null };
export interface SimilarProductProvider {
  id: string; label: string; version: string; status: 'SUPPORTED' | 'TEST_ONLY' | 'PENDING_INTEGRATION';
  availability(ctx: { isMock: boolean; mockAllowed: boolean }): { usable: boolean; reason: string };
  /** 외부 모양 그대로(검증 전) 돌려준다 — WALF가 cleanOffer 로 정리하고 디자인 점수를 다시 매긴다 */
  find(input: SimilarInput): Promise<unknown[]>;
}

/** 별도로 연구 중인 추천 엔진 자리 — 연결 전에는 쓰지 않는다 */
export const FASHION_BRAIN: SimilarProductProvider = {
  id: 'fashion-brain', label: '패션 브레인(별도 연구)', version: '-', status: 'PENDING_INTEGRATION',
  availability: () => ({ usable: false, reason: '추천 API 연결 전 — Intelligence Lab에서 연구 중이에요' }),
  async find() { return []; },
};

// ── 테스트 큐레이터(Fixture) ─────────────────────────────────
// mock://shop/sim-* — 가상의 브랜드·판매처·가격. 이미지는 직접 그린 SVG라 권리 문제가 없다.
type FxSim = { id: string; seller: string; brand: string; name: string; image?: string; price: number; salePrice?: number | null; shipping?: number | null;
  condition?: 'new' | 'used'; options?: { color?: string; size?: string; stock: Stock }[]; style: Style };
let fx: FxSim[] | null = null;
export function loadSimilarFixtures(file = path.resolve(import.meta.dirname, '..', 'fixtures', 'similar-mock.json')) { fx = JSON.parse(fs.readFileSync(file, 'utf8')).items; return fx!; }
export const FIXTURE_CURATOR: SimilarProductProvider = {
  id: 'walf-fixture-curator', label: '테스트 큐레이터(Fixture)', version: 'fixture-1', status: 'TEST_ONLY',
  availability: ctx => ctx.isMock && ctx.mockAllowed ? { usable: true, reason: 'QA·자동 테스트 전용 — 가상의 상품이에요' }
    : { usable: false, reason: ctx.isMock ? '테스트 소스가 꺼져 있어요' : '실제 의뢰에는 테스트 상품을 쓰지 않아요' },
  // 검색 엔진처럼 같은 제품군 후보를 넓게 돌려준다. 순서·점수는 WALF가 다시 매긴다
  async find(input) {
    const cats = input.style.category || [];
    return (fx || loadSimilarFixtures()).filter(it => !cats.length || (it.style.category || []).some(c => cats.includes(c))).slice(0, 20).map(it => ({
      url: `mock://shop/${it.id}`, seller: it.seller, brand: it.brand, name: it.name, imageUrl: it.image ? `mock://image/${it.image}` : null, price: it.price, salePrice: it.salePrice ?? null,
      shipping: it.shipping ?? null, condition: it.condition || 'new', options: it.options || [], style: it.style, source: 'mock', relation: 'similar',
      recommender: 'walf-fixture-curator', recommenderVersion: 'fixture-1',
    }));
  },
};
export const SIMILAR_PROVIDERS: SimilarProductProvider[] = [FIXTURE_CURATOR, FASHION_BRAIN];

// ── 디자인 비교 · 정렬 ───────────────────────────────────────
/** 제품군·실루엣이 가장 무겁다. 브랜드는 점수에 넣지 않는다 */
export const DESIGN_WEIGHT: Record<StyleKind, number> = { category: 3, silhouette: 3, detail: 2, material: 2, color: 1, mood: 1 };
export const RANKER = 'walf-design-rank-1';
/** 사용자가 고를 수 있는 선호(무엇이 중요한지). 고르지 않으면 기본(제품군·실루엣 우선) */
export const PRIORITIES = ['silhouette', 'material_detail', 'brand_archive', 'vibe'] as const;
export type Priority = typeof PRIORITIES[number];
export const PRIORITY_LABEL: Record<Priority, string> = { silhouette: '실루엣이 중요해요', material_detail: '소재와 디테일이 중요해요', brand_archive: '브랜드와 아카이브 가치가 중요해요', vibe: '비슷한 느낌이면 괜찮아요' };
const PRIORITY_RULE: Record<Priority, { weights: Record<StyleKind, number>; min: number }> = {
  silhouette: { weights: { category: 3, silhouette: 5, detail: 1, material: 1, color: 0.5, mood: 0.5 }, min: 0.35 },
  material_detail: { weights: { category: 3, silhouette: 1, detail: 4, material: 4, color: 0.5, mood: 0.5 }, min: 0.35 },
  brand_archive: { weights: { category: 3, silhouette: 2, detail: 1, material: 1, color: 0.5, mood: 3 }, min: 0.35 },   // 같은 브랜드·아카이브 무드에 가산점
  vibe: { weights: { category: 2, silhouette: 1, detail: 1, material: 1, color: 2, mood: 3 }, min: 0.25 },                 // 느낌(무드·색) 위주로 넓게
};
export const isPriority = (v: unknown): v is Priority => (PRIORITIES as readonly string[]).includes(String(v));
export const rankerOf = (p: Priority | null | undefined) => `${RANKER}:${p || 'default'}`;
const KIND_KO: Record<StyleKind, string> = { category: '제품군', silhouette: '실루엣', detail: '디테일', material: '소재', color: '색', mood: '무드' };
const ORDER: StyleKind[] = ['category', 'silhouette', 'detail', 'material', 'color', 'mood'];
const KIND_SUBJ: Record<StyleKind, string> = { category: '제품군이', silhouette: '실루엣이', detail: '디테일이', material: '소재가', color: '색이', mood: '무드가' };
const labels = (xs: string[]) => xs.map(styleLabel).join('·');

/** 찾는 옷의 디자인(want)과 후보의 디자인(have)을 종류별로 비교한다. 점수는 0~1(찾는 옷에 있는 종류만 센다) */
export function designMatch(want: Style, have: Style, weights: Record<StyleKind, number> = DESIGN_WEIGHT) {
  let got = 0, max = 0;
  const similar: string[] = [], diff: string[] = [];
  // 보여 주는 순서도 중요도 순(실루엣 → 디테일 → 소재 → 색 → 무드). 제품군은 같아야 고르므로 비슷한 점에 따로 적지 않는다
  for (const k of ORDER) {
    const w = want[k] || [];
    if (!w.length) continue;
    max += weights[k];
    const h = have[k] || [];
    const hit = w.filter(v => h.includes(v));
    // 제품군은 하나라도 겹치면 같은 제품군(자켓·아우터 등 여러 이름으로 붙는다). 나머지는 겹친 비율만큼
    if (hit.length) { got += weights[k] * (k === 'category' ? 1 : hit.length / w.length); if (k !== 'category') similar.push(`${KIND_KO[k]} ${labels(hit)}`); }
    else if (h.length && k !== 'category') diff.push(`${KIND_SUBJ[k]} 달라요 — ${labels(h)}(찾는 옷은 ${labels(w)})`);
  }
  const wc = want.category || [], hc = have.category || [];
  return { score: max ? Math.round(got / max * 100) / 100 : 0, similar, diff, categoryOk: !wc.length || !hc.length || wc.some(c => hc.includes(c)) };
}

const sizeFit = (o: ProductOffer, size: string | null): WantSize => {
  if (!size) return 'any';
  const rows = o.options.filter(x => x.size === size);
  return !o.options.length ? 'unknown' : !rows.length ? 'missing' : rows.some(x => x.stock === 'in_stock') ? 'ok' : rows.every(x => x.stock === 'sold_out') ? 'sold_out' : 'unknown';
};
export const MIN_DESIGN_SCORE = 0.35;

/**
 * 추천 엔진이 준 후보를 정리하고 디자인 점수로 다시 정렬한다.
 * 빠지는 것: 주소·추천 모델·버전이 없는 값 · 디자인 정보가 없는 상품 · 제품군이 다른 상품 · 찾는 옷과 같은 상품(같은 상품은 판매처 탐색 쪽) · 점수가 낮은 상품.
 */
export function curateOffers(raw: unknown[], input: SimilarInput & { mockAllowed: boolean; priority?: Priority | null }) {
  const rule = input.priority ? PRIORITY_RULE[input.priority] : { weights: DESIGN_WEIGHT, min: MIN_DESIGN_SCORE };
  const weights = rule.weights;
  const dropped = { invalid: 0, noStyle: 0, category: 0, same: 0, low: 0 };
  const kept: ProductOffer[] = [];
  for (const r of raw) {
    const o = cleanOffer(r, { mockAllowed: input.mockAllowed, relation: 'similar' });
    if (!o) { dropped.invalid++; continue; }
    if (!o.style || !Object.keys(o.style).length) { dropped.noStyle++; continue; }
    if (input.name) {
      const v = compareProduct({ brand: input.brand, name: input.name, modelCode: input.modelCode }, { title: o.name, brand: o.brand }).verdict;
      if (v === 'same_code' || v === 'likely') { dropped.same++; continue; }
    }
    const m = designMatch(input.style, o.style, weights);
    if (!m.categoryOk) { dropped.category++; continue; }
    // “브랜드와 아카이브 가치”: 찾는 옷과 같은 브랜드이거나 아카이브 무드면 가산점(다른 선호에서는 브랜드를 보지 않는다)
    if (input.priority === 'brand_archive' && ((input.brand && o.brand && o.brand.toLowerCase() === input.brand.toLowerCase()) || (o.style.mood || []).includes('archive'))) {
      m.score = Math.min(1, Math.round((m.score + 0.15) * 100) / 100); m.similar.push(o.brand && input.brand && o.brand.toLowerCase() === input.brand.toLowerCase() ? '같은 브랜드' : '아카이브 무드');
    }
    if (m.score < rule.min) { dropped.low++; continue; }
    const ws = sizeFit(o, input.size);
    const diff = [...m.diff, ...o.diffPoints.filter(x => !m.diff.includes(x))];
    if (ws === 'sold_out') diff.push(`${input.size} 사이즈는 품절이에요`);
    if (ws === 'missing') diff.push(`${input.size} 사이즈 옵션이 없어요`);
    if (o.condition === 'used') diff.push('중고 상품이에요');
    kept.push({ ...o, score: m.score, wantSize: ws, stock: ws === 'ok' ? 'in_stock' : ws === 'sold_out' ? 'sold_out' : 'unknown', verdict: 'unverified',
      similarPoints: [...m.similar, ...o.similarPoints.filter(x => !m.similar.includes(x))].slice(0, 6), diffPoints: diff.slice(0, 6),
      checks: [{ field: 'image', result: 'not_checked', text: '사진 비교는 아직 연결 전이라 하지 않았어요' }], detail: 'listed_only', detailNote: '추천 엔진이 준 값이에요(판매처 상품 페이지를 따로 읽지 않음)' });
  }
  const price = (o: ProductOffer) => (o.salePrice ?? o.price ?? 1e9) + (o.shipping ?? 0);
  kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.wantSize === 'ok' ? 0 : 1) - (b.wantSize === 'ok' ? 0 : 1) || price(a) - price(b));
  return { offers: kept.slice(0, input.limit), dropped };
}
