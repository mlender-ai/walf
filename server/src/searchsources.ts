// 판매처 탐색 소스 — “어디서 찾을 수 있는가”. 접근이 허용된 곳만 열고, 나머지는 왜 열지 않는지를 그대로 남긴다.
// 연동 대기·지원 안 함인 곳을 “매물 없음”으로 보여 주지 않는다(검색하지 않은 곳은 검색하지 않았다고 쓴다).
// 실제 의뢰에는 테스트 데이터(Fixture)를 쓰지 않고, 모의 의뢰에는 실제 판매처를 열지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, fetchPage, robotsOk, safeFetch, SourceError, type Fetcher, type Snapshot, type Stock } from './sources.ts';
import { normSize } from './catalog.ts';
import { compact } from './sameproduct.ts';

export type SearchQuery = { text: string; kind: 'code' | 'brand_code' | 'brand_name' | 'name' | 'alias_name' };
export type RawHit = { source: string; seller: string; url: string; title: string; brand: string | null; price: number | null; imageUrl: string | null;
  condition: 'new' | 'used' | 'unknown'; query: string; rank: number; isMock: boolean };
export type Availability = { status: 'SUPPORTED' | 'TEST_ONLY' | 'PENDING_EXTERNAL_SETUP' | 'PENDING_INTEGRATION' | 'UNSUPPORTED'; usable: boolean; reason: string };
export type Mall = { brand: string; aliases?: string[]; domain: string; platform: 'cafe24'; checked: string; basis: string };
export type SourceCtx = {
  isMock: boolean; mockAllowed: boolean; env: Record<string, string | undefined>; malls: Mall[];
  fetcher?: Fetcher; resolve?: (h: string) => Promise<string[]>;
  /** 같은 판매처에 연달아 요청하지 않게 기다린다 */
  pace: (host: string) => Promise<void>;
};
export type TargetLike = { brand: string | null; name: string; modelCode: string | null };
export interface SearchSource {
  id: string; label: string; kind: 'official' | 'retail' | 'used' | 'resale' | 'any'; cost: 'free' | 'paid';
  /** 이 대상에 이 소스를 쓸 수 있는지(키·약관·공식몰 등록·모의 여부) */
  availability(t: TargetLike, ctx: SourceCtx): Availability;
  /** 이 소스에 보낼 검색어(많아야 maxQueries개) */
  pick(queries: SearchQuery[]): SearchQuery[];
  search(q: SearchQuery, t: TargetLike, ctx: SourceCtx): Promise<RawHit[]>;
  /** 상품 페이지를 읽어 가격·옵션 재고·이미지를 채운다. 없으면 검색 결과만 쓴다 */
  detail?(hit: RawHit, ctx: SourceCtx): Promise<Snapshot>;
}
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

// ── 테스트 판매처(Fixture) ───────────────────────────────────
// mock://shop/<id> — 가상의 판매처·가격. 이미지는 직접 그린 SVG(fixtures/search-images)라 권리 문제가 없다.
type FxItem = { id: string; seller: string; keywords: string[]; title: string; listTitle?: string; brand?: string; image?: string; price?: number | null; salePrice?: number | null;
  shipping?: number | null; condition?: 'new' | 'used'; options?: { color?: string; size?: string; stock: Stock; price?: number | null }[]; detailError?: string };
let fx: FxItem[] | null = null;
export function loadSearchFixtures(file = path.resolve(import.meta.dirname, '..', 'fixtures', 'search-mock.json')) { fx = JSON.parse(fs.readFileSync(file, 'utf8')).items; return fx!; }
const fxItems = () => fx || loadSearchFixtures();
export const mockSource: SearchSource = {
  id: 'mock', label: '테스트 판매처(Fixture)', kind: 'any', cost: 'free',
  availability: (_t, ctx) => ctx.isMock && ctx.mockAllowed ? { status: 'TEST_ONLY', usable: true, reason: 'QA·자동 테스트 전용 — 가상의 판매처·가격이에요' }
    : { status: 'TEST_ONLY', usable: false, reason: ctx.isMock ? '테스트 소스가 꺼져 있어요(WALF_QA_TOOLS·모의 AI 아님)' : '실제 의뢰에는 테스트 데이터를 쓰지 않아요' },
  pick: qs => qs.slice(0, 4),
  async search(q) {
    // 실제 검색처럼 검색어 단어의 60% 이상이 맞으면 결과에 나온다(다른 상품도 섞여 나온다)
    const words = compact(q.text) ? q.text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}-]+/u).filter(w => w.length >= 2) : [];
    const hits = (it: FxItem) => words.filter(w => it.keywords.some(k => k.toLowerCase().includes(w) || w.includes(k.toLowerCase()))).length;
    return fxItems().filter(it => words.length && hits(it) / words.length >= 0.6).map((it, i) => ({
      source: 'mock', seller: it.seller, url: `mock://shop/${it.id}`, title: it.listTitle || it.title, brand: null, price: it.salePrice ?? it.price ?? null,
      imageUrl: it.image ? `mock://image/${it.image}` : null, condition: it.condition || 'new', query: q.text, rank: i + 1, isMock: true,
    }));
  },
  async detail(hit) {
    const it = fxItems().find(x => `mock://shop/${x.id}` === hit.url);
    if (!it) throw new SourceError('gone', '없는 테스트 상품이에요.');
    if (it.detailError) throw new SourceError(it.detailError, `테스트: ${it.detailError === 'timeout' ? '응답이 늦어 확인하지 못했어요' : '페이지를 열지 못했어요'}`);
    const options = (it.options || []).map(o => ({ label: [o.color, o.size].filter(Boolean).join('-'), color: o.color || '', size: normSize(o.size), stock: o.stock, price: o.price ?? it.price ?? null, basis: 'fixture' }));
    return { url: hit.url, source: 'mock', seller: it.seller, title: it.title, brand: it.brand || null, image: it.image ? `mock://image/${it.image}` : null, condition: it.condition || 'new',
      price: it.price ?? null, salePrice: it.salePrice ?? null, shipping: it.shipping ?? null, shippingNote: it.shipping == null ? '테스트: 배송비 미확인' : null, options,
      pageStock: options.some(o => o.stock === 'in_stock') ? 'in_stock' : options.length && options.every(o => o.stock === 'sold_out') ? 'sold_out' : 'unknown', basis: ['fixture'], isMock: true };
  },
};

// ── 브랜드 공식몰(카페24 자체 검색) ──────────────────────────────
// 2026-11-09 실험에서 확인한 방식: https://{공식몰}/product/search.html?keyword=… → 상품 페이지 → 옵션 재고(option_stock_data).
// 공식몰 주소는 운영자가 확인해 seed/official-malls.json 에 넣은 곳만 연다(검색으로 공식몰을 추측하지 않는다).
export function loadMalls(file = process.env.WALF_OFFICIAL_MALLS || path.resolve(import.meta.dirname, '..', 'seed', 'official-malls.json')): Mall[] {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).malls || []; } catch { return []; }
}
export const mallFor = (malls: Mall[], brand: string | null) => {
  const b = compact(brand);
  return b ? malls.find(m => [m.brand, ...(m.aliases || [])].some(x => compact(x) === b)) : undefined;
};
/** 카페24 검색 결과에서 상품 페이지 주소만 고른다. 목록 화면의 글은 쇼핑몰마다 달라 믿지 않고, 주소 속 상품명을 제목으로 쓴다 */
export function officialLinks(html: string, origin: string) {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/href=["']((?:https?:\/\/[^"'/]+)?\/product\/([^"'?#/]+)\/(\d+)\/[^"']*)["']/gi)) {
    const key = `${origin}/product/${m[2]}/${m[3]}/`;
    if (m[1].startsWith('http') && new URL(m[1]).origin !== origin) continue; // 다른 사이트 주소는 버린다
    if (!out.has(key)) { let slug = m[2]; try { slug = decodeURIComponent(slug); } catch {} out.set(key, slug.replace(/-/g, ' ')); }
  }
  for (const m of html.matchAll(/href=["'][^"']*\/product\/detail\.html\?product_no=(\d+)[^"']*["']/gi)) {
    const key = `${origin}/product/detail.html?product_no=${m[1]}`;
    if (![...out.keys()].some(k => k.endsWith(`/${m[1]}/`)) && !out.has(key)) out.set(key, '');
  }
  return [...out.entries()].slice(0, 20).map(([url, title]) => ({ url, title }));
}
export const officialSource: SearchSource = {
  id: 'official', label: '브랜드 공식몰(카페24 자체 검색)', kind: 'official', cost: 'free',
  availability(t, ctx) {
    if (ctx.isMock) return { status: 'SUPPORTED', usable: false, reason: '모의 의뢰라 실제 판매처를 열지 않아요' };
    const m = mallFor(ctx.malls, t.brand);
    return m ? { status: 'SUPPORTED', usable: true, reason: `${m.domain} 자체 검색(확인 ${m.checked}) · robots.txt 확인 후 열어요` }
      : { status: 'SUPPORTED', usable: false, reason: t.brand ? `${t.brand}의 국내 공식몰(카페24)이 등록되어 있지 않아요(seed/official-malls.json)` : '브랜드를 몰라 공식몰을 정할 수 없어요' };
  },
  // 공식몰 안에서는 브랜드를 빼고 품번 → 모델명 순으로 찾는다
  pick: qs => [...qs.filter(q => q.kind === 'code'), ...qs.filter(q => q.kind === 'name' || q.kind === 'alias_name')].slice(0, 2),
  async search(q, t, ctx) {
    const m = mallFor(ctx.malls, t.brand)!;
    const url = `https://${m.domain}/product/search.html?keyword=${encodeURIComponent(q.text)}`;
    const robots = await robotsOk(url, ctx);
    if (!robots.ok) throw new SourceError('robots', robots.why);
    await ctx.pace(m.domain);
    const r = await safeFetch(url, ctx);
    if (r.status === 403 || r.status === 429) throw new SourceError('blocked', `공식몰이 접근을 막았어요(HTTP ${r.status})`);
    if (r.status >= 400) throw new SourceError('http', `검색 페이지를 열지 못했어요(HTTP ${r.status})`);
    return officialLinks(r.text, new URL(r.url).origin).map((x, i) => ({ source: 'official', seller: `${m.brand} 공식몰`, url: x.url, title: x.title, brand: m.brand, price: null, imageUrl: null,
      condition: 'new' as const, query: q.text, rank: i + 1, isMock: false }));
  },
  async detail(hit, ctx) { await ctx.pace(hostOf(hit.url)); return { ...(await fetchPage(hit.url, ctx)), source: 'official', seller: hit.seller }; },
};

// ── 네이버 쇼핑 검색 API(키 필요) ─────────────────────────────
// 무료 API(하루 호출 한도 있음). 키가 없으면 PENDING_EXTERNAL_SETUP. 결과는 검색 목록 값뿐이라 사이즈·재고는 모른다(listed_only).
const stripTags = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim();
export function naverItems(j: any, query: string): RawHit[] {
  return (Array.isArray(j?.items) ? j.items : []).filter((x: any) => /^https?:\/\//.test(String(x?.link || ''))).map((x: any, i: number) => {
    const type = Number(x.productType);
    return { source: 'naver_shopping', seller: stripTags(x.mallName) || '네이버 쇼핑', url: String(x.link), title: stripTags(x.title).slice(0, 160), brand: stripTags(x.brand) || null,
      price: Number(x.lprice) > 0 ? Math.round(Number(x.lprice)) : null, imageUrl: /^https?:\/\//.test(String(x.image || '')) ? String(x.image) : null,
      condition: type >= 4 && type <= 6 ? 'used' as const : type >= 1 && type <= 3 ? 'new' as const : 'unknown' as const, query, rank: i + 1, isMock: false };
  });
}
export const naverSource: SearchSource = {
  id: 'naver_shopping', label: '네이버 쇼핑 검색 API', kind: 'retail', cost: 'free',
  availability(_t, ctx) {
    if (ctx.isMock) return { status: 'PENDING_EXTERNAL_SETUP', usable: false, reason: '모의 의뢰라 실제 판매처를 열지 않아요' };
    return ctx.env.WALF_NAVER_CLIENT_ID && ctx.env.WALF_NAVER_CLIENT_SECRET ? { status: 'SUPPORTED', usable: true, reason: '네이버 검색 API(쇼핑) — 검색 목록의 가격·이미지만, 사이즈·재고는 판매처 확인 필요' }
      : { status: 'PENDING_EXTERNAL_SETUP', usable: false, reason: '네이버 검색 API 키(WALF_NAVER_CLIENT_ID·SECRET) 설정 전 — 주말 설정 체크리스트 참고' };
  },
  pick: qs => [...qs.filter(q => q.kind === 'brand_code'), ...qs.filter(q => q.kind === 'brand_name' || q.kind === 'alias_name')].slice(0, 2),
  async search(q, _t, ctx) {
    await ctx.pace('openapi.naver.com');
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const f = ctx.fetcher || (fetch as unknown as Fetcher);
      const res = await (f as any)(`https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(q.text)}&display=20&sort=sim`,
        { headers: { 'X-Naver-Client-Id': ctx.env.WALF_NAVER_CLIENT_ID!, 'X-Naver-Client-Secret': ctx.env.WALF_NAVER_CLIENT_SECRET! }, signal: ctl.signal, redirect: 'manual' });
      if (res.status === 401 || res.status === 403) throw new SourceError('auth', '네이버 API 키가 맞지 않아요');
      if (res.status === 429) throw new SourceError('blocked', '네이버 API 호출 한도에 걸렸어요');
      if (res.status >= 400) throw new SourceError('http', `네이버 API 오류(HTTP ${res.status})`);
      return naverItems(await res.json(), q.text);
    } catch (e: any) { if (e instanceof SourceError) throw e; throw new SourceError(e?.name === 'AbortError' ? 'timeout' : 'network', '네이버 API에 연결하지 못했어요'); }
    finally { clearTimeout(timer); }
  },
};

// ── 열지 않는 곳 ─────────────────────────────────────────────
const closed = (id: string, label: string, kind: SearchSource['kind'], cost: SearchSource['cost'], a: Availability): SearchSource =>
  ({ id, label, kind, cost, availability: () => a, pick: () => [], async search() { return []; } });
export const aiWebSource = closed('ai_web', 'AI 웹 검색(Claude)', 'any', 'paid', { status: 'PENDING_EXTERNAL_SETUP', usable: false,
  reason: '유료 호출 — API 키·월 예산을 정하기 전에는 판매처 탐색에 쓰지 않아요(7일 탐색의 AI 탐색과 같은 비용 상한으로 연결 예정)' });
/** sources.ts 의 판매처 판단(약관·robots.txt)을 그대로 따른다 */
const marketplaces = SOURCES.filter(s => !['page', 'mock'].includes(s.id)).map(s => closed(s.id, s.label, s.kind === 'new' ? 'retail' : s.kind === 'used' ? 'used' : 'resale', 'free',
  { status: s.status as Availability['status'], usable: false, reason: `${s.reason} (${s.checked})` }));

export const SEARCH_SOURCES: SearchSource[] = [mockSource, officialSource, naverSource, aiWebSource, ...marketplaces];

/** 같은 판매처 요청 사이 간격(기본 1초) */
export function pacer(ms: number) {
  const last = new Map<string, number>();
  return async (host: string) => {
    const wait = (last.get(host) ?? 0) + ms - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last.set(host, Date.now());
  };
}
