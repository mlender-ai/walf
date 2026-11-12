// 가격·재고를 읽는 곳(데이터 소스). AI를 부르지 않는다 — 상품 페이지에 들어 있는 가격·옵션 재고만 읽는다.
// 공식 API나 이용이 허용된 방식이 확인되지 않은 판매처는 열지 않고 UNSUPPORTED · PENDING_INTEGRATION 으로 남긴다.
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { normSize, colorsIn } from './catalog.ts';

export type SourceStatus = 'SUPPORTED' | 'PENDING_INTEGRATION' | 'UNSUPPORTED' | 'TEST_ONLY';
export type SourceInfo = { id: string; label: string; kind: 'new' | 'used' | 'resale' | 'any'; status: SourceStatus; hosts: string[]; reason: string; checked: string };

/** 판매처별 자동 접근 판단(근거: 2026-11-09 실험 브랜치 판매처 접근 검증 · 각 사 이용약관·robots.txt) */
export const SOURCES: SourceInfo[] = [
  { id: 'page', label: '상품 페이지(공식몰 등)', kind: 'new', status: 'SUPPORTED', hosts: [], checked: '2026-11-13',
    reason: '사용자·운영자가 준 상품 페이지 한 곳만 하루 1회 연다. robots.txt 허용·약관 차단 목록 밖일 때만. 카페24 옵션 재고(option_stock_data)·schema.org 구조화 데이터를 읽는다' },
  { id: 'bunjang', label: '번개장터', kind: 'used', status: 'UNSUPPORTED', hosts: ['bunjang.co.kr'], checked: '2026-11-09', reason: '이용약관 제39조 ⑦ 1호 — 자동화 도구로 데이터 수집 금지. 운영자 수동 확인만' },
  { id: 'soldout', label: '솔드아웃', kind: 'resale', status: 'UNSUPPORTED', hosts: ['soldout.co.kr'], checked: '2026-11-09', reason: '무신사 이용약관 제11조 ② 9호 — 사전 협의 없는 자동 수집·모니터링 금지' },
  { id: 'musinsa', label: '무신사', kind: 'new', status: 'UNSUPPORTED', hosts: ['musinsa.com'], checked: '2026-11-09', reason: '무신사 이용약관 제11조 ② 9호 · robots.txt 일반 수집기 금지' },
  { id: 'wconcept', label: 'W컨셉', kind: 'new', status: 'UNSUPPORTED', hosts: ['wconcept.co.kr'], checked: '2026-11-09', reason: 'robots.txt 일반 수집기 전체 금지' },
  { id: 'kream', label: 'KREAM', kind: 'resale', status: 'PENDING_INTEGRATION', hosts: ['kream.co.kr'], checked: '2026-11-09', reason: 'robots.txt·약관을 확인하지 못함(접속 오류) — 확인 전까지 열지 않음' },
  { id: 'joongna', label: '중고나라', kind: 'used', status: 'PENDING_INTEGRATION', hosts: ['joongna.com'], checked: '2026-11-09', reason: '자체 검색 접근은 실험에서 확인. 약관 제20조 2호(얻은 정보의 제3자 제공) 법무 확인 전' },
  { id: 'fruitsfamily', label: '후루츠패밀리', kind: 'used', status: 'PENDING_INTEGRATION', hosts: ['fruitsfamily.com'], checked: '2026-11-09', reason: '자체 검색을 주소로 열 수 없고 공식 API 미확인' },
  { id: '29cm', label: '29CM', kind: 'new', status: 'PENDING_INTEGRATION', hosts: ['29cm.co.kr'], checked: '2026-11-09', reason: '약관 확인 전' },
  { id: 'mock', label: '테스트 가격(Fixture)', kind: 'any', status: 'TEST_ONLY', hosts: [], checked: '2026-11-13', reason: 'QA·자동 테스트 전용. 실제 판매 가격이 아니다' },
];
export const sourceInfo = (id: string | null | undefined) => SOURCES.find(s => s.id === id);
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
export const onHost = (h: string, d: string) => h === d || h.endsWith('.' + d);

/** 이 주소의 가격을 어디서 읽을지. 막힌 판매처면 그 사유를 돌려준다 */
export function sourceFor(url: string, opts: { mockAllowed?: boolean } = {}): { source: SourceInfo; ok: boolean; reason?: string } {
  if (url.startsWith('mock://')) {
    const s = sourceInfo('mock')!;
    return opts.mockAllowed ? { source: s, ok: true } : { source: s, ok: false, reason: '테스트 전용 주소예요.' };
  }
  const h = hostOf(url);
  const blocked = SOURCES.find(s => s.hosts.some(d => onHost(h, d)));
  if (blocked) return { source: blocked, ok: false, reason: `${blocked.label}은(는) 자동 확인을 지원하지 않아요 — ${blocked.reason}` };
  return { source: sourceInfo('page')!, ok: true };
}

/** 같은 페이지인지 비교할 열쇠(프로토콜·www·m·끝 슬래시·추적 쿼리 무시) */
export function urlKey(u: string) {
  if (u.startsWith('mock://')) return u;
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|cafe_mkt|NaPm|n_)/i.test(k)) x.searchParams.delete(k);
    x.searchParams.sort();
    return x.hostname.toLowerCase().replace(/^(www|m)\./, '') + x.pathname.replace(/\/+$/, '') + (x.search || '');
  } catch { return u; }
}

// ── 안전하게 열기: 내부망 차단 · robots.txt · 크기·시간 제한 ─────────
export class SourceError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const PRIVATE_V4 = [[0, 8], [10, 8], [100.64, 10], [127, 8], [169.254, 16], [172.16, 12], [192.168, 16], [198.18, 15], [224, 4], [240, 4]] as const;
function v4Private(ip: string) {
  const n = ip.split('.').reduce((a, b) => a * 256 + Number(b), 0);
  return PRIVATE_V4.some(([base, bits]) => {
    const parts = String(base).split('.').map(Number); while (parts.length < 4) parts.push(0);
    const b = parts.reduce((a, x) => a * 256 + x, 0), mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((b & mask) >>> 0);
  });
}
export function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) return v4Private(ip);
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}
/** 사용자가 준 상품 링크를 서버가 열기 전에 확인한다(SSRF 방지) */
export async function assertPublicUrl(u: string, resolve: (h: string) => Promise<string[]> = h => dns.lookup(h, { all: true }).then(a => a.map(x => x.address))) {
  let x: URL;
  try { x = new URL(u); } catch { throw new SourceError('bad_url', '주소 형식이 올바르지 않아요.'); }
  if (!/^https?:$/.test(x.protocol)) throw new SourceError('bad_url', 'http(s) 주소만 확인할 수 있어요.');
  if (x.username || x.password) throw new SourceError('bad_url', '로그인 정보가 들어 있는 주소는 열지 않아요.');
  if (x.port && !['80', '443'].includes(x.port)) throw new SourceError('bad_url', '기본 포트(80·443)가 아닌 주소는 열지 않아요.');
  const h = x.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes('.') || h === 'localhost' || /\.(local|internal|localhost|lan|home|corp)$/.test(h)) throw new SourceError('bad_url', '내부망 주소는 열지 않아요.');
  const ips = net.isIP(h) ? [h] : await resolve(h).catch(() => { throw new SourceError('dns', '주소를 찾지 못했어요.'); });
  if (!ips.length || ips.some(isPrivateIp)) throw new SourceError('bad_url', '내부망 주소는 열지 않아요.');
  return x;
}

export const UA = 'Mozilla/5.0 (compatible; WALF-PriceCheck/0.2; +https://github.com/mlender-ai/walf)';
export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;

/** 리다이렉트도 한 번씩 다시 검사하며 연다. 3MB·15초를 넘으면 멈춘다 */
export async function safeFetch(u: string, opts: { fetcher?: Fetcher; resolve?: (h: string) => Promise<string[]>; maxBytes?: number; timeoutMs?: number } = {}) {
  const fetcher = opts.fetcher || (fetch as unknown as Fetcher);
  let url = u;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(url, opts.resolve);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000);
    try {
      const res = await fetcher(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' }, signal: ctl.signal, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) { url = new URL(res.headers.get('location')!, url).toString(); continue; }
      const max = opts.maxBytes ?? 3_000_000;
      if (Number(res.headers.get('content-length') || 0) > max) throw new SourceError('too_large', '페이지가 너무 커요.');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > max) throw new SourceError('too_large', '페이지가 너무 커요.');
      return { status: res.status, url, text: buf.toString('utf8') };
    } catch (e: any) {
      if (e instanceof SourceError) throw e;
      throw new SourceError(e?.name === 'AbortError' ? 'timeout' : 'network', e?.name === 'AbortError' ? '응답이 늦어 확인하지 못했어요.' : '페이지에 연결하지 못했어요.');
    } finally { clearTimeout(timer); }
  }
  throw new SourceError('redirects', '리다이렉트가 너무 많아요.');
}

/** robots.txt 해석(RFC 9309): 우리 UA 그룹이 없으면 * 그룹, 가장 긴 규칙이 이긴다. 404·410이면 허용, 다른 실패는 확인 못 함 → 열지 않음 */
export function robotsAllows(txt: string, pathAndQuery: string, agent = 'walf-pricecheck') {
  const groups: { agents: string[]; rules: [boolean, string][] }[] = [];
  let cur: { agents: string[]; rules: [boolean, string][] } | null = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === 'disallow' && v) cur.rules.push([false, v]);
    if (k === 'allow' && v) cur.rules.push([true, v]);
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && agent.startsWith(a)));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  let best: [boolean, number] = [true, -1];
  for (const [allow, pat] of rules) {
    const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathAndQuery) && (pat.length > best[1] || (pat.length === best[1] && allow))) best = [allow, pat.length];
  }
  return best[0];
}
const robotsCache = new Map<string, { at: number; status: number; text: string }>();
export async function robotsOk(u: string, opts: { fetcher?: Fetcher; resolve?: (h: string) => Promise<string[]>; now?: number } = {}) {
  const x = new URL(u);
  const t = opts.now ?? Date.now();
  let c = robotsCache.get(x.origin);
  if (!c || t - c.at > 24 * 3600_000) {
    try { const r = await safeFetch(`${x.origin}/robots.txt`, { ...opts, maxBytes: 500_000 }); c = { at: t, status: r.status, text: r.text }; }
    catch { c = { at: t, status: 0, text: '' }; }
    robotsCache.set(x.origin, c);
  }
  if (c.status === 404 || c.status === 410) return { ok: true, why: 'robots.txt 없음(허용)' };
  if (c.status !== 200) return { ok: false, why: `robots.txt를 확인하지 못했어요(${c.status || '연결 실패'}) — 확인 전까지 열지 않아요` };
  return robotsAllows(c.text, x.pathname + x.search) ? { ok: true, why: 'robots.txt 허용' } : { ok: false, why: 'robots.txt가 이 페이지 수집을 막고 있어요' };
}
export const clearRobotsCache = () => robotsCache.clear();

// ── 상품 페이지 해석 ─────────────────────────────────────────
export type Stock = 'in_stock' | 'sold_out' | 'unknown';
export type OptionRow = { label: string; color: string; size: string; stock: Stock; price: number | null; basis: string };
export type Snapshot = {
  url: string; source: string; seller: string; title: string | null; brand: string | null; image: string | null; condition: 'new' | 'used';
  price: number | null; salePrice: number | null; shipping: number | null; shippingNote: string | null;
  options: OptionRow[]; pageStock: Stock; basis: string[]; isMock: boolean;
};
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const AVAIL: Record<string, Stock> = { instock: 'in_stock', limitedavailability: 'in_stock', onlineonly: 'in_stock', instoreonly: 'unknown', preorder: 'unknown', backorder: 'unknown', outofstock: 'sold_out', soldout: 'sold_out', discontinued: 'sold_out' };
const availOf = (v: unknown): Stock => AVAIL[String(v ?? '').split('/').pop()!.toLowerCase()] || 'unknown';
const decodeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function jsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1].trim()); const list = Array.isArray(j) ? j : j['@graph'] || [j]; out.push(...list); } catch { /* 깨진 블록은 건너뛴다 */ }
  }
  return out.filter(x => /Product/i.test(String(x?.['@type'] ?? '')));
}
function meta(html: string, prop: string) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[:.]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop.replace(/[:.]/g, '\\$&')}["']`, 'i'));
  return m ? decodeHtml(m[1]) : null;
}
/** 카페24 공통: 페이지에 들어 있는 옵션별 재고(두 번 이스케이프된 JSON) */
export function cafe24Options(html: string) {
  const m = html.match(/option_stock_data\s*=\s*'([\s\S]*?)';/);
  if (!m) return null;
  let d: Record<string, any>;
  try { d = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')); } catch { return null; }
  return Object.values(d).map((o: any) => {
    const vals: string[] = Array.isArray(o.option_value_orginal) ? o.option_value_orginal.map(String) : String(o.option_value || '').split('-');
    const size = vals.map(normSize).find(v => /^(XXS|XS|S|M|L|XL|XXL|FREE|\d{2,3})$/.test(v)) || '';
    const color = vals.find(v => colorsIn(v).length) || (vals.length > 1 ? vals[0] : '');
    const selling = o.is_selling === 'T' && o.is_display !== 'F';
    const stock: Stock = !selling ? 'sold_out' : o.use_stock === true || o.use_stock === 'T' ? (Number(o.stock_number) > 0 ? 'in_stock' : 'sold_out') : 'unknown';
    return { label: String(o.option_value || vals.join('-')), color, size, stock, price: num(o.option_price), basis: 'option_stock_data' } as OptionRow;
  });
}

/** 상품 페이지 HTML에서 이름·가격·옵션 재고를 읽는다. 읽지 못한 값은 null/unknown 으로 둔다 */
export function parseProductPage(html: string, url: string): Snapshot {
  const host = hostOf(url).replace(/^(www|m)\./, '');
  const lds = jsonLd(html);
  const group = lds.find(x => Array.isArray(x.hasVariant)) || lds[0];
  const basis: string[] = [];
  const offerOf = (x: any) => (Array.isArray(x?.offers) ? x.offers[0] : x?.offers) || null;
  const ldVariants: OptionRow[] = (group?.hasVariant || []).map((v: any) => {
    const o = offerOf(v);
    return { label: [v.color, v.size].filter(Boolean).join('-'), color: String(v.color || ''), size: normSize(v.size), stock: availOf(o?.availability), price: num(o?.price ?? o?.lowPrice), basis: 'json-ld' };
  });
  if (lds.length) basis.push('json-ld');
  let options = cafe24Options(html);
  if (options) {
    basis.push('option_stock_data');
    // 카페24 재고와 구조화 데이터가 다르게 말하면 확인 못 함으로 둔다
    options = options.map(o => {
      const v = ldVariants.find(x => x.size === o.size && (!o.color || !x.color || colorsIn(x.color).join() === colorsIn(o.color).join()));
      if (!v) return o;
      if (o.stock === 'unknown') return { ...o, stock: v.stock, price: o.price ?? v.price, basis: 'option_stock_data+json-ld' };
      if (v.stock !== 'unknown' && v.stock !== o.stock) return { ...o, stock: 'unknown', price: v.price ?? o.price, basis: '데이터 불일치(option_stock_data≠json-ld)' };
      return { ...o, price: v.price ?? o.price };
    });
  } else options = ldVariants;
  const o0 = offerOf(group);
  const listPrice = num(o0?.price ?? o0?.lowPrice) ?? ldVariants.find(v => v.price)?.price ?? num(meta(html, 'product:price:amount')) ?? num(html.match(/var\s+product_price\s*=\s*'(\d+)'/)?.[1]);
  const sale = num(meta(html, 'product:sale_price:amount')) ?? num(html.match(/var\s+product_sale_price\s*=\s*(\d+)/)?.[1]);
  const ship = o0?.shippingDetails?.shippingRate?.value ?? (Array.isArray(o0?.shippingDetails) ? o0.shippingDetails[0]?.shippingRate?.value : undefined);
  const shipping = ship === 0 || ship === '0' ? 0 : num(ship);
  const pageStock: Stock = options.length ? (options.some(o => o.stock === 'in_stock') ? 'in_stock' : options.every(o => o.stock === 'sold_out') ? 'sold_out' : 'unknown') : availOf(o0?.availability);
  const brand = typeof group?.brand === 'string' ? group.brand : group?.brand?.name || null;
  const img = Array.isArray(group?.image) ? group.image[0] : group?.image || (options.length ? null : meta(html, 'og:image'));
  const title = group?.name || html.match(/var\s+product_name\s*=\s*'([^']+)'/)?.[1] || meta(html, 'og:title');
  return {
    url, source: 'page', seller: host, title: title ? decodeHtml(String(title)).slice(0, 160) : null, brand, image: typeof img === 'string' ? img : null, condition: 'new',
    price: listPrice ?? null, salePrice: sale && listPrice && sale < listPrice ? sale : null,
    shipping, shippingNote: shipping == null ? '페이지에서 배송비를 확인하지 못했어요' : null,
    options, pageStock, basis, isMock: false,
  };
}

export async function fetchPage(url: string, opts: { fetcher?: Fetcher; resolve?: (h: string) => Promise<string[]> } = {}): Promise<Snapshot> {
  const robots = await robotsOk(url, opts);
  if (!robots.ok) throw new SourceError('robots', robots.why);
  const r = await safeFetch(url, opts);
  if (r.status === 404 || r.status === 410) throw new SourceError('gone', '상품 페이지가 없어졌어요(판매 종료일 수 있어요).');
  if (r.status === 403 || r.status === 429) throw new SourceError('blocked', `판매처가 접근을 막았어요(HTTP ${r.status}). 다시 시도하지 않고 다음 확인 때 봐요.`);
  if (r.status >= 400) throw new SourceError('http', `페이지를 열지 못했어요(HTTP ${r.status}).`);
  const snap = parseProductPage(r.text, url);
  if (snap.price == null && !snap.options.length) throw new SourceError('parse', '페이지에서 가격·옵션을 읽지 못했어요. 지원하지 않는 형식일 수 있어요.');
  return snap;
}

// ── 테스트 가격(Fixture) ─────────────────────────────────────
// mock://fixture/<이름> — 확인할 때마다 다음 단계 값을 돌려준다. 실제 판매 가격이 아니다.
export type FixtureStep = { price?: number | null; salePrice?: number | null; shipping?: number | null; options?: { color?: string; size?: string; stock: Stock; price?: number | null }[]; error?: string };
export type Fixture = { title: string; brand?: string; seller: string; condition?: 'new' | 'used'; steps: FixtureStep[] };
let fixtures: Record<string, Fixture> | null = null;
export function loadFixtures(file = path.resolve(import.meta.dirname, '..', 'fixtures', 'watch-prices.json')) {
  fixtures = JSON.parse(fs.readFileSync(file, 'utf8'));
  return fixtures!;
}
export function fixtureSnapshot(url: string, step: number): Snapshot {
  const fx = (fixtures || loadFixtures())[url.replace(/^mock:\/\/fixture\//, '')];
  if (!fx) throw new SourceError('parse', '없는 테스트 상품이에요.');
  const s = fx.steps[Math.min(step, fx.steps.length - 1)];
  if (s.error) throw new SourceError(s.error, `테스트: ${s.error === 'timeout' ? '응답이 늦어 확인하지 못했어요' : '페이지를 열지 못했어요'}`);
  const options: OptionRow[] = (s.options || []).map(o => ({ label: [o.color, o.size].filter(Boolean).join('-'), color: o.color || '', size: normSize(o.size), stock: o.stock, price: o.price ?? s.price ?? null, basis: 'fixture' }));
  return { url, source: 'mock', seller: fx.seller, title: fx.title, brand: fx.brand || null, image: null, condition: fx.condition || 'new', price: s.price ?? null, salePrice: s.salePrice ?? null,
    shipping: s.shipping ?? null, shippingNote: s.shipping == null ? '테스트: 배송비 미확인' : null, options, pageStock: options.some(o => o.stock === 'in_stock') ? 'in_stock' : 'unknown', basis: ['fixture'], isMock: true };
}
