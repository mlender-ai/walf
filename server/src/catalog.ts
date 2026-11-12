// 상품(Product)·사이즈/색상(Variant)·브랜드 스타일 매핑 — 찾아줘·기다려줘가 같이 쓰는 공통 상품 정보.
// 확인하지 않은 속성은 확인했다고 표시하지 않는다(verified 는 운영자 확인 또는 상품 페이지에서 직접 읽은 값만).
import fs from 'node:fs';
import path from 'node:path';
import { type DB, productKey, tx } from './db.ts';
import { now } from './time.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];

// ── 사이즈 · 색상 정규화 ──────────────────────────────────────
const NUM_SIZE: Record<string, string> = { '85': 'XS', '90': 'S', '95': 'M', '100': 'L', '105': 'XL', '110': 'XXL', '44': 'S', '55': 'M', '66': 'L', '77': 'XL' };
const SIZE_ALIAS: Record<string, string> = { FREE: 'FREE', F: 'FREE', OS: 'FREE', 'ONE SIZE': 'FREE', ONESIZE: 'FREE', XXL: 'XXL', '2XL': 'XXL' };
/** “m”, “M(95)”, “95” → “M”. 숫자 체계가 다른 사이즈(신발 270 등)는 그대로 둔다 */
export function normSize(s: string | null | undefined): string {
  const v = String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!v) return '';
  const head = v.replace(/\(.*\)$/, '').trim();
  return SIZE_ALIAS[head] || NUM_SIZE[head] || head;
}
export const sameSize = (a: string | null | undefined, b: string | null | undefined) => !!normSize(a) && normSize(a) === normSize(b);

// 한·영 색 이름. 두 색이 붙은 이름(블루그레이 등)은 하나의 색으로 보지 않고 집합으로 비교한다
const COLORS: [string, string[]][] = [
  ['black', ['블랙', '검정', '검은', 'black', 'blk']], ['white', ['화이트', '흰', '흰색', 'white', '오프화이트', 'off white', 'offwhite', 'ivory', '아이보리']],
  ['navy', ['네이비', '남색', 'navy']], ['blue', ['블루', '파랑', 'blue']], ['gray', ['그레이', '회색', 'gray', 'grey', '차콜', 'charcoal', '멜란지', 'melange']],
  ['brown', ['브라운', '갈색', 'brown', '모카', 'mocha', '초코', 'choco', '카멜', 'camel', '탄', 'tan']], ['beige', ['베이지', 'beige', '샌드', 'sand', '크림', 'cream']],
  ['green', ['그린', '초록', 'green', '카키', 'khaki', '올리브', 'olive']], ['red', ['레드', '빨강', 'red', '버건디', 'burgundy']], ['pink', ['핑크', 'pink']],
  ['yellow', ['옐로우', '노랑', 'yellow']], ['purple', ['퍼플', '보라', 'purple']], ['orange', ['오렌지', 'orange']], ['silver', ['실버', 'silver']],
];
/** 문자열에서 찾은 색 이름 집합(정렬). “블루그레이” → [blue, gray] */
export function colorsIn(s: string | null | undefined): string[] {
  const v = String(s ?? '').toLowerCase();
  if (!v.trim()) return [];
  const out = new Set<string>();
  for (const [c, names] of COLORS) if (names.some(n => v.includes(n))) out.add(c);
  return [...out].sort();
}
/** 원하는 색이 없으면 상관없음(true). 있으면 색 집합이 같아야 같은 색 */
export function sameColor(want: string | null | undefined, have: string | null | undefined) {
  const w = colorsIn(want);
  if (!w.length) return !String(want ?? '').trim() || String(want).trim() === String(have ?? '').trim();
  const h = colorsIn(have);
  return h.length === w.length && h.every((x, i) => x === w[i]);
}

// ── 상품 ─────────────────────────────────────────────────────
export type ProductInput = { brand?: string | null; name: string; modelCode?: string | null; season?: string | null; color?: string | null; category?: string | null; url?: string | null; image?: string | null; verified?: boolean; source: string; isMock?: boolean };

/** 같은 열쇠의 상품이 있으면 그 줄을 쓰고(비어 있는 값만 채움), 없으면 만든다. 모의와 실제 상품은 섞지 않는다 */
export function upsertProduct(db: DB, p: ProductInput): number {
  const name = String(p.name || '').trim().slice(0, 160);
  if (!name) throw new Error('product name required');
  const key = productKey(p.brand, name, p.modelCode, p.season);
  const t = now();
  const cur = one(db, 'SELECT * FROM products WHERE canonical_key=? AND is_mock=? ORDER BY verified DESC, id LIMIT 1', key, p.isMock ? 1 : 0);
  if (cur) {
    db.prepare(`UPDATE products SET brand=COALESCE(brand, ?), model_code=COALESCE(model_code, ?), season=COALESCE(season, ?), color=COALESCE(color, ?), category=COALESCE(category, ?),
      url=COALESCE(url, ?), image=COALESCE(image, ?), verified=MAX(verified, ?), updated_at=? WHERE id=?`)
      .run(p.brand || null, p.modelCode || null, p.season || null, p.color || null, p.category || null, p.url || null, p.image || null, p.verified ? 1 : 0, t, cur.id);
    return cur.id;
  }
  return Number(db.prepare(`INSERT INTO products(canonical_key, brand, name, model_code, season, color, category, url, image, verified, source, is_mock, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, p.brand || null, name, p.modelCode || null, p.season || null, p.color || null, p.category || null, p.url || null, p.image || null,
    p.verified ? 1 : 0, p.source, p.isMock ? 1 : 0, t, t).lastInsertRowid);
}

export function variantOf(db: DB, productId: number, color: string | null | undefined, size: string | null | undefined) {
  const c = String(color ?? '').trim(), s = normSize(size);
  db.prepare('INSERT OR IGNORE INTO product_variants(product_id, color, size, label) VALUES (?,?,?,?)').run(productId, c, s, [c, s].filter(Boolean).join(' / ') || '기본');
  return one(db, 'SELECT * FROM product_variants WHERE product_id=? AND color=? AND size=?', productId, c, s)!.id as number;
}

// ── 브랜드 · 스타일 매핑 ─────────────────────────────────────
// 초기에는 큰 지식 그래프를 만들지 않는다. 출처가 있는 seed 와 운영자 확인만 쓰고, 나중에 이미지 임베딩·벡터 검색을 붙일 수 있게 열쇠만 맞춰 둔다.
export const STYLE_KINDS = ['mood', 'silhouette', 'material', 'detail', 'category', 'color'] as const;
export type StyleKind = typeof STYLE_KINDS[number];
export type Style = Partial<Record<StyleKind, string[]>>;
export const STYLE_LABEL: Record<string, string> = {
  techwear: '테크웨어', archive: '아카이브', minimal: '미니멀', workwear: '워크웨어', street: '스트리트', outdoor: '아웃도어', tailoring: '테일러링', 'avant-garde': '아방가르드',
  military: '밀리터리', sportswear: '스포츠웨어', heritage: '헤리티지', preppy: '프레피',
  oversized: '오버사이즈', relaxed: '여유 있는 핏', slim: '슬림', boxy: '박시', cropped: '크롭', layered: '레이어드',
  nylon: '나일론', wool: '울', cotton: '코튼', denim: '데님', leather: '가죽', 'technical-fabric': '기능성 원단', knit: '니트', linen: '린넨',
  'utility-pockets': '유틸리티 포켓', zip: '지퍼', pleats: '플리츠', deconstruction: '해체주의', washed: '워싱', patchwork: '패치워크', reflective: '리플렉티브',
  outerwear: '아우터', jacket: '자켓', knitwear: '니트웨어', trousers: '바지', shirts: '셔츠', tees: '티셔츠', bags: '가방', footwear: '신발',
  black: '블랙', white: '화이트', navy: '네이비', blue: '블루', gray: '그레이', brown: '브라운', beige: '베이지', green: '그린', red: '레드',
};
export const styleLabel = (v: string) => STYLE_LABEL[v] || v;
const WEIGHT: Record<StyleKind, number> = { mood: 3, category: 2, material: 2, silhouette: 1, detail: 1, color: 0.5 };

/** 모델이 낸 스타일 값을 통제 어휘로 맞춘다(소문자·하이픈). 모르는 값은 그대로 두되 매핑 점수에는 같은 값끼리만 맞는다 */
export function cleanStyle(raw: any): Style {
  const out: Style = {};
  for (const k of STYLE_KINDS) {
    const vals = (Array.isArray(raw?.[k]) ? raw[k] : []).map((x: unknown) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, '-')).filter((x: string) => x && x.length <= 30);
    if (k === 'color') { out[k] = [...new Set(vals.flatMap((v: string) => colorsIn(v).length ? colorsIn(v) : [v]))].slice(0, 4) as string[]; continue; }
    if (vals.length) out[k] = [...new Set(vals)].slice(0, 5) as string[];
  }
  if (!out.color?.length) delete out.color;
  return out;
}

export type BrandSeed = { name: string; ko?: string[] | string; country?: string; official_site?: string; tags: { kind: string; value: string; source_url?: string; basis?: string; scope?: string }[] };

/** seed 파일을 넣는다(없는 줄만). 출처가 없는 태그는 버린다. 이미 운영자가 확인한 값은 건드리지 않는다 */
export function loadBrandSeed(db: DB, seeds: BrandSeed[], status: 'sourced' | 'fixture' = 'sourced') {
  let tags = 0;
  tx(db, () => {
    const insB = db.prepare('INSERT OR IGNORE INTO brands(key, name, aliases, country, site, status) VALUES (?,?,?,?,?,?)');
    const insT = db.prepare('INSERT OR IGNORE INTO style_tags(subject, subject_key, scope, kind, value, source_url, basis, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const b of seeds) {
      const key = brandKey(b.name);
      if (!key) continue;
      insB.run(key, b.name, JSON.stringify(Array.isArray(b.ko) ? b.ko : b.ko ? [b.ko] : []), b.country || null, b.official_site || null, status);
      for (const t of b.tags || []) {
        if (!(STYLE_KINDS as readonly string[]).includes(t.kind) || !t.value) continue;
        if (status === 'sourced' && !t.source_url) continue; // 출처 없는 매핑은 넣지 않는다
        tags += Number(insT.run('brand', key, t.scope || '', t.kind, String(t.value).toLowerCase(), t.source_url || null, t.basis || null, status, now()).changes);
      }
    }
  });
  return tags;
}
export const brandKey = (s: string | null | undefined) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

/** 서버 시작 시 seed/brand-styles.json(또는 WALF_STYLE_SEED)을 읽는다(있으면) */
export function loadSeedFile(db: DB, f = process.env.WALF_STYLE_SEED || path.resolve(import.meta.dirname, '..', 'seed', 'brand-styles.json')) {
  if (!fs.existsSync(f)) return 0;
  return loadBrandSeed(db, JSON.parse(fs.readFileSync(f, 'utf8')));
}

export type Curated = { brand: string; brandKey: string; scope: string; score: number; reasons: string[]; sources: string[]; status: 'verified' | 'sourced' | 'fixture' };

// ── 비슷한 “상품” 큐레이션(미구현) ─────────────────────────────
// 지금 DISCOVER 는 브랜드(또는 라인·시즌) 단위 스타일 추천뿐이다. 실제로 판매 중인 비슷한 상품을 고르는 일은 하지 않는다.
// 별도로 연구 중인 패션 브레인(이미지·스타일 이해)을 붙일 자리만 정해 둔다 — 붙이기 전까지 결과는 늘 빈 목록이다.
export type SimilarProduct = { brand: string; name: string; url: string; imageUrl: string | null; price: number | null; seller: string; reasons: string[]; source: string; verified: false };
export interface SimilarProductProvider {
  id: string; label: string; status: 'PENDING_INTEGRATION' | 'SUPPORTED';
  /** style: 사진에서 본 스타일(통제 어휘) · exclude: 이미 결과에 있는 브랜드 · 돌려준 상품은 운영자 검수 전까지 공개하지 않는다 */
  find(input: { style: Style; photoPath?: string | null; brands: string[]; exclude: string[]; limit: number }): Promise<SimilarProduct[]>;
}
export const SIMILAR_PRODUCTS: SimilarProductProvider = {
  id: 'fashion-brain', label: '패션 브레인(별도 연구)', status: 'PENDING_INTEGRATION',
  async find() { return []; },
};

/**
 * DISCOVER — 정확한 상품을 찾지 못했을 때 비슷한 스타일의 브랜드를 고른다(브랜드 단위 추천 · 판매 상품 큐레이션 아님). 같은 상품이라고 말하지 않는다.
 * 두 가지 이상 종류(무드·소재·제품군 등)가 겹치는 브랜드만, 점수 높은 순.
 */
export function curate(db: DB, style: Style, opts: { exclude?: string[]; limit?: number; statuses?: string[] } = {}): Curated[] {
  const statuses = opts.statuses || ['verified', 'sourced'];
  const exclude = new Set((opts.exclude || []).map(brandKey));
  const want = STYLE_KINDS.flatMap(k => (style[k] || []).map(v => [k, v] as const));
  if (!want.length) return [];
  const q = `SELECT t.*, b.name brand_name, b.status brand_status FROM style_tags t JOIN brands b ON b.key=t.subject_key
    WHERE t.subject='brand' AND t.status IN (${statuses.map(() => '?').join(',')}) AND (${want.map(() => '(t.kind=? AND t.value=?)').join(' OR ')})`;
  const rows = all(db, q, ...statuses, ...want.flat());
  const by = new Map<string, { brand: string; scope: string; kinds: Set<string>; score: number; reasons: string[]; sources: Set<string>; worst: string }>();
  for (const r of rows) {
    if (exclude.has(r.subject_key)) continue;
    const id = `${r.subject_key}|${r.scope}`;
    const g = by.get(id) || { brand: r.brand_name, scope: r.scope, kinds: new Set(), score: 0, reasons: [], sources: new Set(), worst: 'verified' };
    if (!g.reasons.includes(styleLabel(r.value))) { g.score += WEIGHT[r.kind as StyleKind] || 0; g.reasons.push(styleLabel(r.value)); }
    g.kinds.add(r.kind);
    if (r.source_url) g.sources.add(r.source_url);
    if (r.status !== 'verified') g.worst = r.status;
    by.set(id, g);
  }
  return [...by.entries()].filter(([, g]) => g.kinds.size >= 2)
    .map(([id, g]) => ({ brand: g.brand, brandKey: id.split('|')[0], scope: g.scope, score: Math.round(g.score * 10) / 10, reasons: g.reasons.slice(0, 4), sources: [...g.sources].slice(0, 3), status: g.worst as Curated['status'] }))
    .sort((a, b) => b.score - a.score || a.brand.localeCompare(b.brand)).slice(0, opts.limit ?? 3);
}

/** 사진에서 본 스타일(AI)을 의뢰에 남긴다 — 큐레이션과 운영자 검수에 쓴다 */
export function saveRequestStyle(db: DB, requestId: number, style: Style, status: 'ai' | 'fixture') {
  tx(db, () => {
    db.prepare(`DELETE FROM style_tags WHERE subject='request' AND subject_key=?`).run(String(requestId));
    const ins = db.prepare('INSERT OR IGNORE INTO style_tags(subject, subject_key, scope, kind, value, status, created_at) VALUES (?,?,?,?,?,?,?)');
    for (const k of STYLE_KINDS) for (const v of style[k] || []) ins.run('request', String(requestId), '', k, v, status, now());
  });
}
export function requestStyle(db: DB, requestId: number): Style {
  const out: Style = {};
  for (const r of all(db, `SELECT kind, value FROM style_tags WHERE subject='request' AND subject_key=? ORDER BY id`, String(requestId))) (out[r.kind as StyleKind] ||= []).push(r.value);
  return out;
}
export const styleWords = (s: Style) => STYLE_KINDS.flatMap(k => (s[k] || []).map(styleLabel));
