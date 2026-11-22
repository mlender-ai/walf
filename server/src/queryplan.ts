// 실상품 검색어 엔진(Search Recovery STEP 3) — 상품을 모르는 상태에서도 찾을 수 있게 검색어를 단계별로 만든다.
// 1 품번·브랜드 → 2 상품명 변형·별칭 → 3 브랜드+디자인 특징 → 4 브랜드 뺀 디자인 특징(한국어) → 5 영어·일본어 표현 → 6 검색 결과에서 얻은 단서.
// 같은 검색어는 한 번만, 지난 탐색에서 결과가 없던 검색어는 한동안 다시 보내지 않는다(query_stats). 정답을 아는 평가에서도 정답을 검색어에 넣지 않는다.
import crypto from 'node:crypto';
import { type DB } from './db.ts';
import { type Style } from './catalog.ts';
import { compact, nameTokens } from './sameproduct.ts';
import { now } from './time.ts';

export const STAGES = ['code', 'brand_code', 'brand_name', 'name', 'alias_name', 'brand_feature', 'feature', 'feature_en', 'feature_ja', 'clue'] as const;
export type Stage = typeof STAGES[number];
export type PlannedQuery = { text: string; kind: Stage; lang: 'ko' | 'en' | 'ja' | 'any' };
/** 식별 단계(상품을 알 때) · 특징 단계(한국어) · 다른 언어·단서 단계 — 앞 단계에서 후보가 충분하면 뒤 단계는 보내지 않는다 */
export const STAGE_GROUPS: Stage[][] = [['code', 'brand_code', 'brand_name', 'name', 'alias_name'], ['brand_feature', 'feature'], ['feature_en', 'feature_ja', 'clue']];

// 통제 어휘 → 검색에 쓰는 말(한국어·영어·일본어). 사람이 쇼핑몰·중고 매물 제목에 실제로 쓰는 말을 고른다
const W: Record<string, [string, string, string]> = {
  shirts: ['셔츠', 'shirt', 'シャツ'], tees: ['티셔츠', 't-shirt', 'Tシャツ'], jacket: ['자켓', 'jacket', 'ジャケット'], outerwear: ['아우터', 'jacket', 'アウター'],
  knitwear: ['니트', 'sweater', 'ニット'], trousers: ['바지', 'pants', 'パンツ'], bags: ['가방', 'bag', 'バッグ'], footwear: ['신발', 'shoes', 'シューズ'],
  oversized: ['오버핏', 'oversized', 'オーバーサイズ'], relaxed: ['와이드', 'wide', 'ワイド'], slim: ['슬림', 'slim', 'スリム'], boxy: ['박시', 'boxy', 'ボクシー'],
  cropped: ['크롭', 'cropped', 'クロップド'], bootcut: ['부츠컷', 'bootcut', 'ブーツカット'], layered: ['레이어드', 'layered', 'レイヤード'],
  nylon: ['나일론', 'nylon', 'ナイロン'], wool: ['울', 'wool', 'ウール'], cotton: ['코튼', 'cotton', 'コットン'], denim: ['데님', 'denim', 'デニム'], leather: ['가죽', 'leather', 'レザー'],
  'technical-fabric': ['기능성', 'technical', 'テック'], knit: ['니트', 'knit', 'ニット'], linen: ['린넨', 'linen', 'リネン'],
  'utility-pockets': ['카고', 'cargo', 'カーゴ'], zip: ['지퍼', 'zip', 'ジップ'], pleats: ['플리츠', 'pleated', 'プリーツ'], deconstruction: ['해체', 'deconstructed', '再構築'],
  washed: ['워싱', 'washed', 'ウォッシュ'], patchwork: ['패치워크', 'patchwork', 'パッチワーク'], reflective: ['리플렉티브', 'reflective', 'リフレクター'],
  check: ['체크', 'check', 'チェック'], 'curved-seam': ['커브드', 'curved', 'カーブ'],
  black: ['블랙', 'black', 'ブラック'], white: ['화이트', 'white', 'ホワイト'], navy: ['네이비', 'navy', 'ネイビー'], blue: ['블루', 'blue', 'ブルー'], gray: ['그레이', 'gray', 'グレー'],
  brown: ['브라운', 'brown', 'ブラウン'], beige: ['베이지', 'beige', 'ベージュ'], green: ['그린', 'green', 'グリーン'], red: ['레드', 'red', 'レッド'],
  men: ['남자', 'mens', 'メンズ'], women: ['여자', 'womens', 'レディース'],
};
const L = { ko: 0, en: 1, ja: 2 } as const;
const word = (v: string | undefined, lang: keyof typeof L) => (v && W[v] ? W[v][L[lang]] : '');

/** 디자인 태그에서 검색용 낱말: 성별·핵심 명사(데님 바지 → 청바지)·실루엣·디테일·소재·색 */
export function featureWords(style: Style, lang: keyof typeof L) {
  const cat = style.category?.[0], mat = style.material || [];
  const jeans = cat === 'trousers' && mat.includes('denim');
  const noun = jeans ? ({ ko: '청바지', en: 'jeans', ja: 'ジーンズ' } as const)[lang] : word(cat, lang);
  return {
    gender: word(style.gender?.[0], lang), noun,
    sil: (style.silhouette || []).map(v => word(v, lang)).filter(Boolean),
    det: (style.detail || []).map(v => word(v, lang)).filter(Boolean),
    mat: jeans ? [] : mat.map(v => word(v, lang)).filter(Boolean),
    colors: (style.color || []).map(v => word(v, lang)).filter(Boolean).slice(0, 2),
  };
}

export type PlanTarget = { brand: string | null; name: string; modelCode: string | null; aliases: string[] };
/** 단계별 검색어. 같은 말(띄어쓰기·대소문자 무시)은 한 번만 */
export function planQueries(t: PlanTarget, style: Style | null | undefined, opts: { maxFeature?: number } = {}): PlannedQuery[] {
  const out: PlannedQuery[] = [];
  const add = (parts: (string | null | undefined)[], kind: Stage, lang: PlannedQuery['lang']) => {
    const s = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (s && !out.some(q => compact(q.text) === compact(s))) out.push({ text: s, kind, lang });
  };
  // 1·2 상품을 알 때(식별 결과·사용자 입력)
  if (t.modelCode) { add([t.modelCode], 'code', 'any'); if (t.brand) add([t.brand, t.modelCode], 'brand_code', 'any'); }
  if (t.brand && t.name) add([t.brand, t.name], 'brand_name', 'any');
  if (t.name && nameTokens(t.name, t.brand).length >= 2) add([t.name], 'name', 'any');
  for (const a of t.aliases.slice(0, 2)) if (t.name) add([a, t.name], 'alias_name', 'any');
  const s = style || {};
  const ko = featureWords(s, 'ko'), en = featureWords(s, 'en'), ja = featureWords(s, 'ja');
  if (!ko.noun && !ko.sil.length) return out;   // 무엇을 찾는지(제품군·실루엣) 모르면 특징 검색을 만들지 않는다
  // 3 브랜드 + 디자인 특징(브랜드를 알거나 후보만 있을 때)
  for (const b of [t.brand, ...t.aliases.slice(0, 1)].filter(Boolean)) add([b, ko.sil[0] || ko.det[0], ko.noun], 'brand_feature', 'ko');
  // 4 브랜드를 뺀 특징 — 가장 또렷한 것부터, 점점 넓게(넓은 검색어는 사진 유사도가 정밀도를 맡는다)
  const max = opts.maxFeature ?? 4, start = out.length;
  const core = ko.sil[0] || ko.det[0] || ko.mat[0] || '';
  add([ko.gender, ko.det[0] !== core ? ko.det[0] : '', core, ko.noun], 'feature', 'ko');
  for (const c of ko.colors) add([ko.gender, c, core, ko.noun], 'feature', 'ko');
  add([core, ko.noun], 'feature', 'ko');
  if (ko.det[0] && ko.det[0] !== core) add([ko.det[0], ko.noun], 'feature', 'ko');
  out.splice(start + max);
  // 5 영어·일본어(해외 판매처·일본 중고 플랫폼)
  const coreEn = en.sil[0] || en.det[0] || en.mat[0] || '', coreJa = ja.sil[0] || ja.det[0] || ja.mat[0] || '';
  add([en.gender, en.det[0] !== coreEn ? en.det[0] : '', coreEn, en.noun], 'feature_en', 'en');
  add([ja.gender, coreJa, ja.noun], 'feature_ja', 'ja');
  return out;
}

// ── 6 · 검색 결과에서 얻은 단서 ────────────────────────────────
const STOP = new Set(['새상품', '상품', '정품', '판매', '팝니다', '판매합니다', '사이즈', '미착용', '택포', '무료배송', '급처', '새제품', '중고', '빈티지', '남자', '여자', '남성', '여성', '공용',
  '바지', '청바지', '셔츠', '자켓', '데님', '팬츠', '블랙', '화이트', '네이비', '블루', '베이지', '그레이', 'free', 'size', 'new',
  // 핏·색감·소재처럼 어디에나 붙는 말은 단서가 아니다(브랜드·모델명 같은 고유한 낱말만 단서로)
  '스판', '데님팬츠', '진청', '흑청', '중청', '연청', '슬림', '슬림핏', '와이드', '스트레이트', '부츠컷', '일자', '카펜터', '기모', '크롭', '롱', '오버핏', '루즈핏', '레귤러',
  '정사이즈', '빅사이즈', '거의새것', '새것', '깨끗', '상태', '최저가', '세일', '특가', '데일리', '아메카지', 'jeans', 'denim', 'pants', 'slim', 'fit']);
/** 사진이 가장 닮은 후보들의 제목에 두 번 이상 나온, 아직 검색하지 않은 낱말(브랜드·모델명일 가능성) → 새 검색어 */
export function clueQueries(titles: string[], style: Style | null | undefined, tried: string[], max = 2): PlannedQuery[] {
  const noun = featureWords(style || {}, 'ko').noun;
  const seen = new Set(tried.flatMap(q => q.toLowerCase().split(/\s+/)));
  const count = new Map<string, number>();
  for (const t of titles) {
    // 숫자가 섞인 낱말(사이즈28·r5237 같은 판매자 관리번호·치수)은 단서가 아니다
    const words = new Set((t.toLowerCase().normalize('NFKC').match(/[\p{L}][\p{L}\p{N}-]{1,}/gu) || []).filter(w => !STOP.has(w) && !/\d/.test(w) && !/^(xs|s|m|l|xl|xxl)$/.test(w)));
    for (const w of words) if (!seen.has(w)) count.set(w, (count.get(w) || 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, max)
    .map(([w]) => ({ text: [w, noun].filter(Boolean).join(' '), kind: 'clue' as const, lang: 'any' as const }));
}

// ── 검색어별 효과 기록 ─────────────────────────────────────────
export const queryKey = (q: string) => crypto.createHash('sha1').update(compact(q)).digest('hex').slice(0, 20);
/** 같은 소스에 보내 두 번 넘게 결과가 없었던 검색어는 3일 동안 다시 보내지 않는다 */
export function skipReason(db: DB | null | undefined, source: string, q: string, t = now()): string | null {
  if (!db) return null;
  const r = db.prepare('SELECT runs, hits, last_run FROM query_stats WHERE source=? AND query_key=?').get(source, queryKey(q)) as any;
  return r && r.runs >= 2 && r.hits === 0 && t - r.last_run < 3 * 86400_000 ? `지난 ${r.runs}번 결과가 없어 건너뜀` : null;
}
export function recordQuery(db: DB | null | undefined, source: string, q: PlannedQuery | { text: string; kind: string }, hits: number, t = now()) {
  if (!db) return;
  db.prepare(`INSERT INTO query_stats(source, query, query_key, stage, runs, hits, last_hits, last_run) VALUES (?,?,?,?,1,?,?,?)
    ON CONFLICT(source, query_key) DO UPDATE SET runs=runs+1, hits=hits+excluded.hits, last_hits=excluded.last_hits, last_run=excluded.last_run`).run(source, q.text, queryKey(q.text), q.kind, hits, hits, t);
}
/** 평가·운영자 검수에서 정답(또는 공개한 후보)을 낸 검색어에 표시 — 효과 낮은 검색어를 고르는 근거 */
export function markCorrect(db: DB, source: string, q: string, candidates = 1) {
  db.prepare('UPDATE query_stats SET correct=correct+1, candidates=candidates+? WHERE source=? AND query_key=?').run(candidates, source, queryKey(q));
}
