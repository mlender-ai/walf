// 실제 웹 탐색 경로(Search Recovery STEP 2) — 기존 SearchSource 모양을 그대로 따른다.
// 단계를 나눈다: ① 검색 인덱스로 상품 페이지 "발견" ② 허용된 곳만 상품 페이지 "검증"(detail) ③ 사진 비교(brain.ts) ④ 가격·재고 확인.
// 상품 주소를 발견한 것과 그 판매처의 가격·재고를 자동 수집할 권한을 혼동하지 않는다: 발견만 한 주소는 listed_only(운영자 확인 대상)로 둔다.
// 접근 차단을 우회하거나 다른 검색 봇으로 위장하지 않는다. 키가 없거나 법무 확인 전인 경로는 열지 않고 이유를 남긴다.
import { robotsOk, safeFetch, SourceError, SOURCES } from './sources.ts';
import type { RawHit, SearchQuery, SearchSource, SourceCtx, TargetLike } from './searchsources.ts';
import type { Stage } from './queryplan.ts';

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const experiment = (ctx: SourceCtx, id: string) => String(ctx.env.WALF_EXPERIMENT_SOURCES || '').split(',').map(s => s.trim()).includes(id);
const KO_STAGES: Stage[] = ['code', 'brand_code', 'brand_name', 'name', 'alias_name', 'brand_feature', 'feature', 'clue'];
const pickBy = (stages: Stage[], max: number) => (qs: SearchQuery[]) => qs.filter(q => stages.includes(q.kind)).slice(0, max);
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ── 중고나라 자체 검색 ───────────────────────────────────────
// robots.txt: User-agent * Allow /(검색 /search/ 허용, 2026-11-22 확인). 약관 제20조 2호(얻은 정보의 제3자 제공) 법무 확인 전이라
// 운영에서는 닫아 두고, 로컬 실험(WALF_EXPERIMENT_SOURCES=joongna)에서만 연다. 검색 목록만 읽고 매물 상세는 열지 않는다(운영자가 확인).
export const JOONGNA = 'https://web.joongna.com';
/** 검색 결과 HTML → 매물(제목·가격·썸네일). 링크 안 이미지 alt 가 제목이고, 글에 가격·상태가 함께 있다 */
export function joongnaListings(html: string) {
  const out = new Map<string, { url: string; title: string; price: number | null; image: string | null; status: 'on_sale' | 'reserved' | 'sold' }>();
  for (const m of html.matchAll(/<a[^>]*href="\/product\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = `${JOONGNA}/product/${m[1]}`, inner = m[2];
    const img = inner.match(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/) || inner.match(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"/);
    const src = img ? decode(img[0].match(/src="([^"]+)"/)![1]) : null;
    const alt = img ? decode(img[0].match(/alt="([^"]*)"/)![1]).replace(/\s*이미지$/, '') : '';
    const t = text(inner);
    const price = t.match(/([\d,]{3,})\s*원/);
    const title = alt || (price ? t.slice(0, price.index).trim() : t);
    if (!title) continue;
    const status = /판매\s*완료/.test(t) ? 'sold' : /예약\s*중/.test(t) ? 'reserved' : 'on_sale';
    // 목록 썸네일(150px)은 비교하기엔 작다 — 같은 이미지 서버의 400px 썸네일을 쓴다
    const image = src && /^https:\/\/img\d*\.joongna\.com\//.test(src) ? src.replace(/size=\d+/, 'size=400') : null;
    if (!out.has(url) || out.get(url)!.title.length < title.length) out.set(url, { url, title: title.slice(0, 160), price: price ? Number(price[1].replace(/,/g, '')) : null, image, status });
  }
  return [...out.values()];
}
export const joongnaSource: SearchSource = {
  id: 'joongna', label: '중고나라 자체 검색', kind: 'used', cost: 'free',
  availability(_t, ctx) {
    if (ctx.isMock) return { status: 'PENDING_INTEGRATION', usable: false, reason: '모의 의뢰라 실제 판매처를 열지 않아요' };
    const info = SOURCES.find(s => s.id === 'joongna');
    return experiment(ctx, 'joongna')
      ? { status: 'SUPPORTED', usable: true, access: 'unverified', reason: '로컬 실험 전용(WALF_EXPERIMENT_SOURCES) — 검색 목록만 읽어요. 약관 제20조 2호 법무 확인 전이라 운영에는 켜지 않아요' }
      : { status: 'PENDING_INTEGRATION', usable: false, access: info?.access, reason: info?.reason || '약관 법무 확인 전' };
  },
  pick: pickBy(KO_STAGES, 5),
  async search(q, _t, ctx) {
    const url = `${JOONGNA}/search/${encodeURIComponent(q.text)}`;
    const robots = await robotsOk(url, ctx);
    if (!robots.ok) throw new SourceError('robots', robots.why);
    await ctx.pace('web.joongna.com');
    const r = await safeFetch(url, ctx);
    if (r.status === 403 || r.status === 429) throw new SourceError('blocked', `중고나라가 접근을 막았어요(HTTP ${r.status})`);
    if (r.status >= 400) throw new SourceError('http', `검색 페이지를 열지 못했어요(HTTP ${r.status})`);
    // 판매 완료 매물은 뺀다(예약 중은 운영자가 볼 수 있게 남긴다)
    return joongnaListings(r.text).filter(x => x.status !== 'sold').map((x, i): RawHit => ({ source: 'joongna', seller: '중고나라', url: x.url, title: x.title, brand: null,
      price: x.price, imageUrl: x.image, condition: 'used', query: q.text, rank: i + 1, isMock: false }));
  },
};

// ── 검색 인덱스(정식 API) ─────────────────────────────────────
// 키가 있어야 쓴다. 결과는 "발견"만 — 상품 페이지 검증은 허용 목록에 있는 곳만 기존 detail 경로로 한다.
/** 상품 상세 페이지로 보이는 주소(목록·검색·카테고리·블로그는 뺀다) */
export function looksLikeProduct(u: string) {
  let x: URL; try { x = new URL(u); } catch { return false; }
  const p = x.pathname + x.search;
  if (/\/(search|category|categories|list|tag|tags|blog|post|board|cs|notice)\b/i.test(x.pathname) && !/product_no=\d+/.test(p)) return false;
  return /\/product\/[^/]+\/\d+|product_no=\d+|\/products?\/[\w-]{3,}|\/goods\/(view|detail)?[\w/?=-]*\d+|\/item\/\d+|\/p\/\d+|\/(i|itm)\/\d+/i.test(p);
}
/** 약관상 자동 수집이 막힌 곳(sources.ts 판매처 판단)은 발견 결과에서도 링크만 남기고 열지 않는다 */
const prohibited = (u: string) => {
  const h = hostOf(u);
  return SOURCES.some(s => ['prohibited', 'partner_required'].includes(String(s.access)) && (s.hosts || []).some(x => h === x || h.endsWith(`.${x}`)));
};
type IndexSpec = { id: string; label: string; key: string[]; note: string; stages: Stage[]; max: number;
  call(q: SearchQuery, ctx: SourceCtx): Promise<{ url: string; title: string; snippet: string; image?: string | null }[]> };
const ALL_STAGES: Stage[] = ['code', 'brand_code', 'brand_name', 'name', 'alias_name', 'brand_feature', 'feature', 'feature_en', 'feature_ja', 'clue'];
async function getJson(url: string, ctx: SourceCtx, init: RequestInit): Promise<any> {
  const r = await (ctx.fetcher as any || fetch)(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401 || r.status === 403) throw new SourceError('blocked', `키 인증 실패(HTTP ${r.status})`);
  if (r.status === 429 || r.status === 432 || r.status === 433) throw new SourceError('blocked', `무료 한도·요청 제한(HTTP ${r.status}) — 멈추고 유료로 넘어가지 않아요`);
  if (r.status >= 400) throw new SourceError('http', `HTTP ${r.status}`);
  return r.json();
}
const INDEXES: IndexSpec[] = [
  { id: 'tavily', label: 'Tavily 웹 검색 API', key: ['WALF_TAVILY_KEY'], note: '무료 월 1,000크레딧·카드 불필요 — basic 검색(1크레딧)만', stages: ALL_STAGES, max: 3,
    async call(q, ctx) {
      const j = await getJson('https://api.tavily.com/search', ctx, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.env.WALF_TAVILY_KEY}` },
        body: JSON.stringify({ query: q.text, search_depth: 'basic', max_results: 20, auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false }) });
      return (j.results || []).map((x: any) => ({ url: String(x.url || ''), title: String(x.title || ''), snippet: String(x.content || '') }));
    } },
  { id: 'brave_api', label: 'Brave Search API', key: ['WALF_BRAVE_API_KEY'], note: '공식 API(스크레이핑 아님) — 요금·무료 한도는 docs/WALF_SEARCH_RECOVERY.md', stages: ALL_STAGES, max: 3,
    async call(q, ctx) {
      const j = await getJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q.text)}&count=20&country=KR&search_lang=${q.lang === 'en' ? 'en' : q.lang === 'ja' ? 'ja' : 'ko'}`, ctx,
        { headers: { accept: 'application/json', 'x-subscription-token': String(ctx.env.WALF_BRAVE_API_KEY) } });
      return (j.web?.results || []).map((x: any) => ({ url: String(x.url || ''), title: text(String(x.title || '')), snippet: text(String(x.description || '')), image: x.thumbnail?.src || null }));
    } },
  { id: 'kakao_web', label: '다음 웹문서 검색(Kakao API)', key: ['WALF_KAKAO_REST_KEY'], note: 'Kakao Developers REST 키 — 한국어 웹문서', stages: ALL_STAGES.filter(s => s !== 'feature_en' && s !== 'feature_ja'), max: 3,
    async call(q, ctx) {
      const j = await getJson(`https://dapi.kakao.com/v2/search/web?query=${encodeURIComponent(q.text)}&size=50`, ctx, { headers: { authorization: `KakaoAK ${ctx.env.WALF_KAKAO_REST_KEY}` } });
      return (j.documents || []).map((x: any) => ({ url: String(x.url || ''), title: text(String(x.title || '')), snippet: text(String(x.contents || '')) }));
    } },
  { id: 'naver_web', label: '네이버 웹문서 검색(API HUB)', key: ['WALF_NAVER_HUB_ID', 'WALF_NAVER_HUB_SECRET'], note: '한시적 무료(유료 전환 예고) — 쇼핑 검색 API는 2026-07-31 종료', stages: ALL_STAGES.filter(s => s !== 'feature_en' && s !== 'feature_ja'), max: 3,
    async call(q, ctx) {
      const j = await getJson(`https://naverapihub.apigw.ntruss.com/search/v1/webkr?query=${encodeURIComponent(q.text)}&display=30&start=1`, ctx,
        { headers: { 'X-NCP-APIGW-API-KEY-ID': String(ctx.env.WALF_NAVER_HUB_ID), 'X-NCP-APIGW-API-KEY': String(ctx.env.WALF_NAVER_HUB_SECRET) } });
      return (j.items || []).map((x: any) => ({ url: String(x.link || ''), title: text(String(x.title || '')), snippet: text(String(x.description || '')) }));
    } },
];
function indexSource(x: IndexSpec): SearchSource {
  return {
    id: x.id, label: x.label, kind: 'any', cost: 'free',
    availability(_t: TargetLike, ctx) {
      if (ctx.isMock) return { status: 'PENDING_EXTERNAL_SETUP', usable: false, reason: '모의 의뢰라 실제 검색을 하지 않아요' };
      const missing = x.key.filter(k => !ctx.env[k]);
      return missing.length ? { status: 'PENDING_EXTERNAL_SETUP', usable: false, reason: `키 없음(${missing.join('·')}) — ${x.note}` }
        : { status: 'SUPPORTED', usable: true, reason: `${x.note} · 상품 페이지 주소만 후보로 남기고, 허용 목록 밖은 열지 않아요` };
    },
    pick: pickBy(x.stages, x.max),
    async search(q, _t, ctx) {
      const rows = await x.call(q, ctx);
      return rows.filter(r => looksLikeProduct(r.url) && !prohibited(r.url)).map((r, i): RawHit => ({ source: x.id, seller: hostOf(r.url), url: r.url, title: r.title.slice(0, 160),
        brand: null, price: null, imageUrl: r.image || null, condition: 'unknown', query: q.text, rank: i + 1, isMock: false }));
    },
  };
}
export const INDEX_SOURCES: SearchSource[] = INDEXES.map(indexSource);

// ── 로컬 메타검색(SearXNG) — 실험 전용 ──────────────────────────
// 일반 검색 엔진 화면을 대신 읽는 방식이라 엔진 쪽이 자주 막는다(2026-11-22: 빙 연결 끊음·브레이브 429). 운영 경로로 쓰지 않는다.
export const searxngSource: SearchSource = {
  id: 'searxng', label: '로컬 메타검색(SearXNG, 실험)', kind: 'any', cost: 'free',
  availability(_t, ctx) {
    if (ctx.isMock) return { status: 'PENDING_INTEGRATION', usable: false, reason: '모의 의뢰라 실제 검색을 하지 않아요' };
    return experiment(ctx, 'searxng') && ctx.env.WALF_SEARXNG_URL ? { status: 'SUPPORTED', usable: true, reason: '로컬 실험 전용 — 검색 엔진이 자주 막아요(우회하지 않음)' }
      : { status: 'PENDING_INTEGRATION', usable: false, reason: '운영 경로 아님(검색 엔진 화면 대리 수집) — 로컬 실험에서만 켜요' };
  },
  pick: pickBy(ALL_STAGES, 3),
  async search(q, _t, ctx) {
    const base = String(ctx.env.WALF_SEARXNG_URL).replace(/\/$/, '');
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new SourceError('blocked', 'SearXNG는 이 맥 안 주소만 써요');
    const r = await fetch(`${base}/search?q=${encodeURIComponent(q.text)}&format=json&language=ko-KR`, { signal: AbortSignal.timeout(20_000) });
    const j: any = await r.json();
    const dead = (j.unresponsive_engines || []).map((x: any) => x.join(':')).join('; ');
    const rows = (j.results || []).filter((x: any) => looksLikeProduct(String(x.url)) && !prohibited(String(x.url)));
    if (!rows.length && dead) throw new SourceError('network', `검색 엔진 응답 없음(${dead.slice(0, 120)})`);
    return rows.map((x: any, i: number): RawHit => ({ source: 'searxng', seller: hostOf(x.url), url: x.url, title: String(x.title || '').slice(0, 160), brand: null, price: null,
      imageUrl: x.thumbnail || x.img_src || null, condition: 'unknown', query: q.text, rank: i + 1, isMock: false }));
  },
};

// ── Shopify Global Catalog(UCP · search_catalog) ─────────────────────
// 키는 없지만 공개 주소에 올린 에이전트 프로필(WALF_SHOPIFY_AGENT_PROFILE)이 요청마다 필요하다(shopify.dev/docs/agents/catalog, 2026-11-22 확인).
// Shopify 상점만 덮는다(해외 브랜드·아카이브용, 국내 보세몰은 거의 없음). 가격·재고는 10분, 제목·이미지는 24시간까지만 캐시할 수 있고 대량 수집·DB 구축은 금지 —
// 의뢰 한 건을 찾을 때 검색어 몇 개만 보낸다. 사진 검색(like.image)은 사용자 사진을 밖으로 보내는 일이라 쓰지 않는다(사용자 승인 전).
export const SHOPIFY_UCP = 'https://catalog.shopify.com/api/ucp/mcp';
export function shopifyHits(j: any, q: string): RawHit[] {
  const out: RawHit[] = [];
  for (const p of j?.result?.structuredContent?.products || []) {
    const v = (p.variants || []).find((x: any) => x?.availability?.available !== false && x?.url) || (p.variants || [])[0];
    if (!v?.url) continue;
    const amount = Number(v.price?.amount ?? p.price_range?.min?.amount);
    out.push({ source: 'shopify_catalog', seller: String(v.seller?.domain || v.seller?.name || hostOf(v.url)), url: String(v.url), title: String(p.title || '').slice(0, 160), brand: v.seller?.name || null,
      // 가격은 참고값(최소 단위 정수) — 원화가 아니면 비교하지 않는다(fx.ts)
      price: (v.price?.currency || p.price_range?.min?.currency) === 'KRW' && Number.isFinite(amount) ? amount : null,
      imageUrl: (p.media || []).find((m: any) => m?.type === 'image' && m.url)?.url || null,
      condition: (v.condition || []).includes('secondhand') ? 'used' : (v.condition || []).includes('new') ? 'new' : 'unknown', query: q, rank: out.length + 1, isMock: false });
  }
  return out;
}
export const shopifySource: SearchSource = {
  id: 'shopify_catalog', label: 'Shopify Global Catalog', kind: 'any', cost: 'free',
  availability(_t, ctx) {
    if (ctx.isMock) return { status: 'PENDING_EXTERNAL_SETUP', usable: false, reason: '모의 의뢰라 실제 검색을 하지 않아요' };
    return ctx.env.WALF_SHOPIFY_AGENT_PROFILE ? { status: 'SUPPORTED', usable: true, reason: 'Shopify 상점만 — 검색어 몇 개만(대량 수집 금지·가격 10분 캐시)' }
      : { status: 'PENDING_EXTERNAL_SETUP', usable: false, reason: '에이전트 프로필 공개 주소(WALF_SHOPIFY_AGENT_PROFILE)가 없어요 — 키는 필요 없지만 프로필을 공개 주소에 올려야 해요' };
  },
  pick: pickBy(['code', 'brand_code', 'brand_name', 'name', 'alias_name', 'brand_feature', 'feature_en'], 3),
  async search(q, _t, ctx) {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_catalog', arguments: {
      meta: { 'ucp-agent': { profile: ctx.env.WALF_SHOPIFY_AGENT_PROFILE } },
      catalog: { query: q.text, filters: { ships_to: { country: 'KR' }, available: true }, context: { address_country: 'KR' }, pagination: { limit: 20 } } } } };
    const j = await getJson(SHOPIFY_UCP, ctx, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    if (j?.error) throw new SourceError('http', `Shopify 카탈로그 오류: ${String(j.error.message || j.error.code).slice(0, 120)}`);
    return shopifyHits(j, q.text);
  },
};

export const WEB_SOURCES: SearchSource[] = [joongnaSource, ...INDEX_SOURCES, shopifySource, searxngSource];
