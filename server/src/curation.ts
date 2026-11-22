// 대체 상품 큐레이션 — 정확한 상품을 못 찾았거나 기다리는 동안 볼 수 있는 “비슷한 디자인의 실제 판매 상품”.
// 정렬 기준은 브랜드가 아니라 찾는 옷의 디자인이다: 제품군·실루엣 > 디테일·소재 > 색·무드. 브랜드가 비슷하다는 이유만으로 고르지 않는다.
// 후보는 실제 검색 경로(findsearch.webSimilarProvider)나 테스트 Fixture(가상의 상품·직접 그린 그림)가 내고, 패션 브레인(로컬 이미지 모델, brain.ts)은 사진 유사도로 정렬만 돕는다.
// 결과는 언제나 “같은 상품 아님”이고, 운영자 검수 전에는 사용자에게 보이지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { isKids, styleLabel, type Style, type StyleKind } from './catalog.ts';
import { cleanOffer, type ProductOffer, type WantSize } from './offers.ts';
import { compareProduct } from './sameproduct.ts';
import { urlKey } from './sources.ts';
import type { Stock } from './sources.ts';

export type SimilarInput = { style: Style; brand: string | null; name: string | null; modelCode: string | null; size: string | null; limit: number; photoPath?: string | null };
export interface SimilarProductProvider {
  id: string; label: string; version: string; status: 'SUPPORTED' | 'TEST_ONLY' | 'PENDING_INTEGRATION';
  availability(ctx: { isMock: boolean; mockAllowed: boolean }): { usable: boolean; reason: string };
  /** 외부 모양 그대로(검증 전) 돌려준다 — WALF가 cleanOffer 로 정리하고 디자인 점수를 다시 매긴다 */
  find(input: SimilarInput): Promise<unknown[]>;
}

/**
 * 패션 브레인(Intelligence Lab MODA) — 후보를 새로 지어내는 공급원이 아니라, 실제 검색 경로가 모은 후보의 사진을 맡긴 사진과 비교하는 정렬 엔진이다.
 * 연결은 brain.ts(WALF_BRAIN_URL, 같은 맥의 로컬 서비스)로 하고 runSimilarSearch·runFindSearch 가 부른다. 여기서는 후보를 내지 않는다.
 */
export const FASHION_BRAIN: SimilarProductProvider = {
  id: 'fashion-brain', label: '패션 브레인(로컬 이미지 모델 — 정렬 엔진)', version: 'moda-1',
  // 이 맥에서 이미지 모델 서비스 주소가 설정돼 있을 때만 연결됨으로 본다(설정이 없으면 연결 전)
  get status() { return process.env.WALF_BRAIN_URL ? 'SUPPORTED' as const : 'PENDING_INTEGRATION' as const; },
  availability: () => ({ usable: false, reason: '후보 공급원이 아니라 정렬 엔진이에요 — 실제 검색 후보의 사진을 비교할 때 따로 불러요(WALF_BRAIN_URL)' }),
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
// 패션 브레인은 후보를 내지 않으므로 목록에 넣지 않는다 — 탐색 보고에는 runSimilarSearch 가 사진 비교 결과 한 줄로 남긴다
export const SIMILAR_PROVIDERS: SimilarProductProvider[] = [FIXTURE_CURATOR];

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
/**
 * 정렬 방식(STEP 6 비교): design 디자인 태그만(사진 비교 없음) · image 사진 유사도만 · image_dna 사진 유사도+디자인 태그 · pref 사용자 선호 가중치+사진 유사도.
 * 사진 유사도는 후보 묶음 안에서 0~1로 다시 맞춰(최저·최고) 디자인 점수와 섞는다.
 */
export const RANK_MODES = ['design', 'image', 'image_dna', 'pref'] as const;
export type RankMode = typeof RANK_MODES[number];
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
export function curateOffers(raw: unknown[], input: SimilarInput & { mockAllowed: boolean; priority?: Priority | null; mode?: RankMode;
  images?: { scores: Map<string, number>; model: string } | null; photoGender?: Map<string, { gender: 'men' | 'women'; p: number }> }) {
  const mode: RankMode = input.mode && (input.images || input.mode === 'design') ? input.mode : 'design';
  const rule = input.priority && (mode === 'design' || mode === 'pref') ? PRIORITY_RULE[input.priority] : { weights: DESIGN_WEIGHT, min: MIN_DESIGN_SCORE };
  const weights = rule.weights;
  const dropped = { invalid: 0, noStyle: 0, category: 0, gender: 0, same: 0, low: 0 };
  const kept: (ProductOffer & { _d: number })[] = [];
  const img = (o: ProductOffer) => input.images?.scores.get(urlKey(o.url)) ?? null;
  const vals = [...(input.images?.scores.values() || [])];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const norm = (v: number | null) => v == null ? 0 : hi > lo ? (v - lo) / (hi - lo) : 0.5;
  for (const r of raw) {
    const o = cleanOffer(r, { mockAllowed: input.mockAllowed, relation: 'similar' });
    if (!o) { dropped.invalid++; continue; }
    if (isKids(o.name)) { dropped.category++; continue; }   // 아동복은 다른 제품군
    const iv = img(o);
    // 제목에서 디자인을 못 읽어도 사진 비교가 됐으면 남긴다(목록 제목이 불완전한 매물을 상세 확인 전에 버리지 않는다)
    if ((!o.style || !Object.keys(o.style).length) && iv == null) { dropped.noStyle++; continue; }
    o.style ||= {};
    if (input.name) {
      const v = compareProduct({ brand: input.brand, name: input.name, modelCode: input.modelCode }, { title: o.name, brand: o.brand }).verdict;
      if (v === 'same_code' || v === 'likely') { dropped.same++; continue; }
    }
    const m = designMatch(input.style, o.style, weights);
    if (!m.categoryOk) { dropped.category++; continue; }
    // 찾는 옷의 성별이 정해져 있으면 제목에 반대 성별 단서가 보이는 상품은 뺀다(성별을 모르는 상품은 운영자가 사진으로 본다)
    const wg = input.style.gender || [], hg = o.style.gender || [];
    if (wg.length && hg.length && !wg.some(x => hg.includes(x))) { dropped.gender++; continue; }
    // 사진으로만 본 성별은 추정이라 빼지 않고 다른 점에 적고 점수를 깎는다
    const pg = !hg.length && wg.length ? input.photoGender?.get(urlKey(o.url)) : undefined;
    const photoOther = pg && !wg.includes(pg.gender) ? `사진으로는 ${pg.gender === 'women' ? '여성용' : '남성용'}으로 보여요(추정 ${Math.round(pg.p * 100)}%)` : null;
    // “브랜드와 아카이브 가치”: 찾는 옷과 같은 브랜드이거나 아카이브 무드면 가산점(다른 선호에서는 브랜드를 보지 않는다)
    if (input.priority === 'brand_archive' && ((input.brand && o.brand && o.brand.toLowerCase() === input.brand.toLowerCase()) || (o.style.mood || []).includes('archive'))) {
      m.score = Math.min(1, Math.round((m.score + 0.15) * 100) / 100); m.similar.push(o.brand && input.brand && o.brand.toLowerCase() === input.brand.toLowerCase() ? '같은 브랜드' : '아카이브 무드');
    }
    // 사진 유사도를 쓰는 방식에서는 디자인 점수 하한 대신 합친 점수로 정렬한다(제목이 짧아 태그가 적은 매물도 사진이 닮으면 남긴다)
    if (mode === 'design' && m.score < rule.min) { dropped.low++; continue; }
    if (mode !== 'design' && iv == null && m.score < rule.min) { dropped.low++; continue; }
    const d = mode === 'design' ? m.score : mode === 'image' ? norm(iv) : 0.6 * norm(iv) + 0.4 * m.score;
    const ws = sizeFit(o, input.size);
    const diff = [...m.diff, ...o.diffPoints.filter(x => !m.diff.includes(x))];
    if (ws === 'sold_out') diff.push(`${input.size} 사이즈는 품절이에요`);
    if (ws === 'missing') diff.push(`${input.size} 사이즈 옵션이 없어요`);
    if (o.condition === 'used') diff.push('중고 상품이에요');
    if (photoOther) diff.unshift(photoOther);
    const similar = [...m.similar, ...o.similarPoints.filter(x => !m.similar.includes(x))];
    if (iv != null && norm(iv) >= 0.7) similar.unshift('사진이 맡긴 옷과 많이 닮았어요(사진 유사도 — 같은 상품 판정 아님)');
    kept.push({ ...o, score: m.score, imageScore: iv, imageModel: iv == null ? null : input.images!.model, _d: photoOther ? d - 0.3 : d,
      wantSize: ws, stock: ws === 'ok' ? 'in_stock' : ws === 'sold_out' ? 'sold_out' : 'unknown', verdict: 'unverified',
      similarPoints: similar.slice(0, 6), diffPoints: diff.slice(0, 6),
      checks: [{ field: 'image', result: iv == null ? 'not_checked' : 'unknown', text: iv == null ? '사진 비교를 하지 않았어요' : `사진 유사도 ${iv.toFixed(2)}(${input.images!.model.split('@')[0].toUpperCase()}) — 같은 상품 판정 근거는 아니에요` }],
      detail: 'listed_only', detailNote: '검색 결과 값이에요(판매처 상품 페이지를 따로 읽지 않음)' });
  }
  const price = (o: ProductOffer) => (o.salePrice ?? o.price ?? 1e9) + (o.shipping ?? 0);
  kept.sort((a, b) => b._d - a._d || (b.score ?? 0) - (a.score ?? 0) || (a.wantSize === 'ok' ? 0 : 1) - (b.wantSize === 'ok' ? 0 : 1) || price(a) - price(b));
  return { offers: kept.slice(0, input.limit).map(({ _d, ...o }) => o as ProductOffer), dropped, mode };
}
