// 찾아줘 판매처 탐색 — AI가 “어떤 옷인지” 식별한 것과 따로, 그 옷을 실제로 파는 상품 페이지를 찾는다.
// 1 식별 결과 → 탐색 대상 · 2 검색 조건 · 3 소스 검색 · 4 같은 페이지·상품 통합 · 5 상품 정보 정리 · 6 동일 상품 검증 · 7 비교 결과
// 단계마다 따로 부를 수 있고(테스트), runFindSearch 가 순서대로 잇는다. AI를 부르지 않는다(무료 소스만). 결과는 검수 전까지 사용자에게 보이지 않는다.
import crypto from 'node:crypto';
import { type DB } from './db.ts';
import { tierOf } from './find.ts';
import { brandKey, colorsIn, normSize, sameColor } from './catalog.ts';
import { urlKey, SourceError, type Snapshot } from './sources.ts';
import { codesIn, compact, compareProduct, nameTokens, type Check, type Verdict } from './sameproduct.ts';
import { cleanOffer, itemPrice, offersOf, RULES_RECOMMENDER, saveOffers, totalPrice, type ProductOffer } from './offers.ts';
import { SEARCH_SOURCES, loadMalls, mallFor, pacer, type RawHit, type SearchQuery, type SearchSource, type SourceCtx } from './searchsources.ts';
import { now } from './time.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
const parse = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const json = (v: unknown) => JSON.stringify(v);

// ── 1 · 식별 결과 → 탐색 대상 ───────────────────────────────────
export type Basis = 'ai_draft' | 'operator_published' | 'user_confirmed';
export type SearchTarget = { brand: string | null; name: string; modelCode: string | null; season: string | null; color: string | null; category: string | null;
  basis: Basis; ref: string; aliases: string[]; isMock: boolean };
export type Want = { size: string | null; color: string | null; usedOk: boolean; maxPrice: number | null };
export const BASIS_LABEL: Record<Basis, string> = { ai_draft: 'AI 식별 제안(검수 전)', operator_published: '왈프 팀이 공개한 식별 결과', user_confirmed: '사용자가 “이 옷이 맞아요”로 고른 결과' };

/** 이름 앞에 붙은 브랜드는 뗀다(“BADBLOOD Mystic …” → “Mystic …”) */
const stripBrand = (name: string, brand: string | null) => {
  const b = String(brand || '').trim();
  return b && name.toLowerCase().startsWith(b.toLowerCase() + ' ') ? name.slice(b.length + 1).trim() : name.trim();
};
export function targetFrom(x: Row, basis: Basis, ref: string, aliases: string[], isMock: boolean): SearchTarget {
  return { brand: x.brand || null, name: stripBrand(String(x.name || ''), x.brand), modelCode: x.model_code || null, season: x.season || null, color: x.color || null,
    category: x.category || null, basis, ref, aliases, isMock };
}
/** 탐색할 식별 결과: 사용자 확인 > 운영자 공개 > AI 제안(숨김 제외) 순. 앞의 것이 기본 대상이다 */
export function targetsOf(db: DB, requestId: number, malls: { brand: string; aliases?: string[] }[] = []): SearchTarget[] {
  const r = one(db, 'SELECT * FROM requests WHERE id=?', requestId);
  if (!r) return [];
  const aliasesOf = (brand: string | null) => {
    const b = one(db, 'SELECT aliases FROM brands WHERE key=?', brandKey(brand));
    const m = mallFor(malls as any, brand);
    return [...new Set([...parse(b?.aliases ?? null, []), ...(m?.aliases || [])].filter((a: string) => a && compact(a) !== compact(brand)))] as string[];
  };
  const out: SearchTarget[] = [];
  for (const x of all(db, `SELECT * FROM product_identities WHERE request_id=? AND status='confirmed' AND tier<>'discover' ORDER BY id DESC`, requestId))
    out.push(targetFrom(x, 'user_confirmed', `product_identity:${x.id}`, aliasesOf(x.brand), !!x.is_mock || !!r.is_mock));
  for (const x of all(db, `SELECT * FROM product_identities WHERE request_id=? AND status='published' AND tier<>'discover' ORDER BY tier='match' DESC, rank`, requestId))
    out.push(targetFrom(x, 'operator_published', `product_identity:${x.id}`, aliasesOf(x.brand), !!x.is_mock || !!r.is_mock));
  const job = one(db, `SELECT id FROM ai_jobs WHERE request_id=? AND kind='identify' AND status='done' ORDER BY id DESC LIMIT 1`, requestId);
  if (job) for (const x of all(db, 'SELECT * FROM ai_identities WHERE job_id=? ORDER BY rank', job.id)) {
    if (tierOf({ ...x, refs: parse(x.refs, []), uncertain: parse(x.uncertain, []) }) === 'hidden') continue;
    out.push(targetFrom(x, 'ai_draft', `ai_identity:${x.id}`, aliasesOf(x.brand), !!x.is_mock || !!r.is_mock));
  }
  // 같은 상품을 여러 번 담지 않는다(앞의 근거가 우선)
  const seen = new Set<string>();
  return out.filter(t => { const k = compact(`${t.brand}|${t.name}|${t.modelCode}`); if (seen.has(k)) return false; seen.add(k); return true; });
}
export const wantOf = (r: Row): Want => ({ size: r.size ? normSize(r.size) : null, color: r.color || null, usedOk: !!r.used_ok, maxPrice: r.max_price ?? null });

// ── 2 · 검색 조건 ────────────────────────────────────────────
/** 품번(가장 정확) → 브랜드+모델명 → 모델명만 → 한글 브랜드명+모델명 순. 같은 검색어는 한 번만 */
export function buildQueries(t: SearchTarget): SearchQuery[] {
  const out: SearchQuery[] = [];
  const add = (text: string, kind: SearchQuery['kind']) => { const s = text.replace(/\s+/g, ' ').trim(); if (s && !out.some(q => compact(q.text) === compact(s))) out.push({ text: s, kind }); };
  if (t.modelCode) { add(t.modelCode, 'code'); if (t.brand) add(`${t.brand} ${t.modelCode}`, 'brand_code'); }
  if (t.brand) add(`${t.brand} ${t.name}`, 'brand_name');
  if (nameTokens(t.name, t.brand).length >= 2) add(t.name, 'name');
  if (t.aliases[0]) add(`${t.aliases[0]} ${t.name}`, 'alias_name');
  return out.slice(0, 6);
}

// ── 3 · 소스 검색 ────────────────────────────────────────────
export type SourceReport = { id: string; label: string; cost: string; status: string; outcome: 'ok' | 'empty' | 'not_run' | 'failed' | 'blocked'; reason: string;
  queries: string[]; hits: number; ms: number; errors: string[] };
export const OUTCOME_LABEL: Record<SourceReport['outcome'], string> = { ok: '검색함 · 결과 있음', empty: '검색함 · 결과 없음', not_run: '검색하지 않음', failed: '검색 실패', blocked: '접근 막힘' };
/** 소스마다 독립적으로 돈다 — 한 곳이 실패해도 다른 곳은 계속한다. 쓸 수 없는 곳은 이유만 남기고 열지 않는다 */
export async function searchSources(sources: SearchSource[], t: SearchTarget, queries: SearchQuery[], ctx: SourceCtx) {
  const hits: RawHit[] = [], report: SourceReport[] = [];
  for (const s of sources) {
    const a = s.availability(t, ctx);
    const rep: SourceReport = { id: s.id, label: s.label, cost: s.cost, status: a.status, outcome: 'not_run', reason: a.reason, queries: [], hits: 0, ms: 0, errors: [] };
    report.push(rep);
    if (!a.usable) continue;
    const t0 = Date.now();
    for (const q of s.pick(queries)) {
      rep.queries.push(q.text);
      try { const got = await s.search(q, t, ctx); hits.push(...got); rep.hits += got.length; }
      catch (e: any) {
        const err = e instanceof SourceError ? e : new SourceError('network', String(e?.message || e).slice(0, 160));
        rep.errors.push(`${q.text}: ${err.message}`);
        if (['robots', 'blocked'].includes(err.code)) { rep.outcome = 'blocked'; break; } // 막힌 곳은 다른 검색어로 다시 두드리지 않는다
      }
    }
    rep.ms = Date.now() - t0;
    if (rep.outcome !== 'blocked') rep.outcome = rep.hits ? 'ok' : rep.errors.length === rep.queries.length && rep.errors.length ? 'failed' : 'empty';
  }
  return { hits, report };
}

// ── 4 · 같은 페이지·같은 상품 통합 ─────────────────────────────
export type MergedHit = RawHit & { queries: string[]; groupKey: string };
/** 상품 묶음 열쇠: 제목에 품번이 있으면 품번, 없으면 핵심 단어 집합 */
export function groupKeyOf(title: string | null, brand: string | null) {
  const code = codesIn(title)[0];
  if (code) return `code:${compact(code)}`;
  return `name:${compact(brand)}|${nameTokens(title, brand).sort().join(' ')}`;
}
/** 여러 검색어·소스에서 나온 같은 페이지는 하나로 합치고(검색어는 모아 둔다), 같은 상품끼리 같은 묶음 열쇠를 단다 */
export function mergeHits(hits: RawHit[]): MergedHit[] {
  const byUrl = new Map<string, MergedHit>();
  for (const h of hits) {
    const k = urlKey(h.url);
    const cur = byUrl.get(k);
    if (cur) { if (!cur.queries.includes(h.query)) cur.queries.push(h.query); if (h.rank < cur.rank) cur.rank = h.rank; cur.price ??= h.price; cur.imageUrl ??= h.imageUrl; if (h.title.length > cur.title.length) cur.title = h.title; continue; }
    byUrl.set(k, { ...h, queries: [h.query], groupKey: '' });
  }
  return [...byUrl.values()].map(h => ({ ...h, groupKey: groupKeyOf(h.title, h.brand) })).sort((a, b) => a.rank - b.rank);
}

// ── 5 · 상품 정보 정리(이미지·가격·판매처·사이즈) ───────────────────
/** 같은 상품일 가능성이 큰 페이지부터 상세 페이지를 읽는다(많아야 maxDetails개). 못 읽은 곳은 검색 결과 값만 남기고 그렇게 표시한다 */
export async function normalizeHits(merged: MergedHit[], t: SearchTarget, sources: SearchSource[], ctx: SourceCtx, maxDetails = 6): Promise<ProductOffer[]> {
  const ORDER: Record<Verdict, number> = { same_code: 0, likely: 1, unverified: 2, different: 3 };
  const pre = merged.map(h => ({ h, v: compareProduct(t, { title: h.title, brand: h.brand }).verdict }));
  const fetchOrder = [...pre].sort((a, b) => ORDER[a.v] - ORDER[b.v] || a.h.rank - b.h.rank).filter(x => x.v !== 'different').slice(0, maxDetails).map(x => x.h);
  const out: ProductOffer[] = [];
  for (const { h } of pre) {
    const src = sources.find(s => s.id === h.source);
    let snap: Snapshot | null = null, detail: ProductOffer['detail'] = 'listed_only', note: string | null = null;
    if (src?.detail && fetchOrder.includes(h)) {
      try { snap = await src.detail(h, ctx); detail = 'fetched'; }
      catch (e: any) { detail = 'failed'; note = e instanceof SourceError ? e.message : '상품 페이지를 읽지 못했어요'; }
    } else note = !src?.detail ? '검색 결과 값만 있어요(이 소스는 상품 페이지를 열지 않아요)' : pre.find(x => x.h === h)!.v === 'different' ? '다른 상품으로 보여 상세 페이지를 열지 않았어요' : `상세 확인 한도(${maxDetails}개)를 넘어 검색 결과만 저장했어요`;
    const name = snap?.title || h.title || null;
    const brand = snap?.brand || h.brand;
    out.push({
      relation: 'same', source: h.source, seller: snap?.seller || h.seller, url: h.url, brand, name, modelCode: codesIn(name)[0] || null, season: null,
      imageUrl: snap?.image || h.imageUrl, price: snap ? snap.price : h.price, salePrice: snap?.salePrice ?? null, currency: 'KRW', shipping: snap ? snap.shipping : null,
      condition: snap?.condition || h.condition, options: (snap?.options || []).map(o => ({ color: o.color, size: o.size, stock: o.stock, price: o.price })),
      stock: snap?.pageStock || 'unknown', wantSize: 'unknown', wantColor: 'unknown', verdict: 'unverified', checks: [], similarPoints: [], diffPoints: [],
      ...RULES_RECOMMENDER, score: null, detail, detailNote: note, queries: h.queries, fetchedAt: snap ? now() : null, groupKey: groupKeyOf(name, brand), isMock: h.isMock,
    });
  }
  return out;
}

// ── 6 · 동일 상품 검증 ───────────────────────────────────────
const COLOR_KO: Record<string, string> = { black: '블랙', white: '화이트', navy: '네이비', blue: '블루', gray: '그레이', brown: '브라운', beige: '베이지', green: '그린', red: '레드', pink: '핑크', yellow: '옐로우', purple: '퍼플', orange: '오렌지', silver: '실버' };
const colorText = (s: string) => colorsIn(s).map(c => COLOR_KO[c] || c).join('') || s;
/** 품번·브랜드·상품명으로 같은 상품인지 정하고, 원하는 색·사이즈·상태와 맞는지 따로 적는다. 사진 비교는 하지 않는다(연결 전) */
export function verifyOffer(t: SearchTarget, o: ProductOffer, want: Want): ProductOffer {
  const r = compareProduct({ brand: t.brand, name: t.name, modelCode: t.modelCode }, { title: o.name, brand: o.brand });
  const checks: Check[] = [...r.checks];
  // 색상: 원하는 색(없으면 식별한 색)과 옵션·상품명의 색
  const wantColor = want.color || t.color;
  // 옵션에 색이 있으면 옵션 색, 없으면 상품명에 적힌 색으로만 본다
  const optColors = [...new Set(o.options.map(x => x.color).filter(Boolean))];
  const have = optColors.length ? optColors : colorsIn(o.name).length ? [o.name!] : [];
  let wc: ProductOffer['wantColor'] = 'any';
  if (wantColor) {
    wc = !have.length ? 'unknown' : have.some(c => sameColor(wantColor, c)) ? 'ok' : 'other';
    checks.push({ field: 'color', result: wc === 'ok' ? 'match' : wc === 'other' ? 'mismatch' : 'unknown', text: wc === 'ok' ? `색상 ${colorText(wantColor)} 일치` : wc === 'other' ? `색상 다름(페이지: ${have.map(colorText).join('·')})` : '색상을 확인하지 못했어요' });
  }
  // 사이즈: 원하는 사이즈 옵션(색이 정해졌으면 그 색)의 재고
  let ws: ProductOffer['wantSize'] = 'any', stock = o.stock;
  if (want.size) {
    const rows = o.options.filter(x => x.size === want.size && (!wantColor || !x.color || sameColor(wantColor, x.color)));
    ws = !o.options.length ? 'unknown' : !rows.length ? 'missing' : rows.some(x => x.stock === 'in_stock') ? 'ok' : rows.every(x => x.stock === 'sold_out') ? 'sold_out' : 'unknown';
    stock = ws === 'ok' ? 'in_stock' : ws === 'sold_out' ? 'sold_out' : 'unknown';
    checks.push({ field: 'size', result: ws === 'ok' ? 'match' : ws === 'missing' || ws === 'sold_out' ? 'mismatch' : 'unknown',
      text: { ok: `${want.size} 재고 있음`, sold_out: `${want.size} 품절`, missing: `${want.size} 옵션 없음`, unknown: `${want.size} 재고를 확인하지 못했어요`, any: '' }[ws] });
  }
  checks.push({ field: 'image', result: 'not_checked', text: '사진 비교는 아직 연결 전이라 하지 않았어요' });
  const diff: string[] = [];
  if (r.verdict === 'different') diff.push(r.note);
  if (wc === 'other') diff.push(`찾는 색(${colorText(wantColor!)})과 달라요`);
  if (ws === 'sold_out') diff.push(`${want.size} 사이즈는 품절이에요`);
  if (ws === 'missing') diff.push(`${want.size} 사이즈 옵션이 없어요`);
  if (o.condition === 'used') diff.push(want.usedOk ? '중고 상품이에요' : '새 상품만 원했는데 중고예요');
  if (o.detail !== 'fetched') diff.push(o.detail === 'failed' ? '상품 페이지를 읽지 못해 사이즈·재고를 몰라요' : '검색 결과만 봐서 사이즈·재고를 몰라요');
  const total = totalPrice(o);
  if (want.maxPrice && total != null && total > want.maxPrice) diff.push(`희망가(${want.maxPrice.toLocaleString('ko-KR')}원)보다 비싸요`);
  return { ...o, verdict: r.verdict, checks, wantColor: wc, wantSize: ws, stock,
    similarPoints: checks.filter(c => c.result === 'match').map(c => c.text), diffPoints: diff.slice(0, 6) };
}

// ── 7 · 비교 결과 ────────────────────────────────────────────
export type FindSearchResult = {
  identification: { basis: Basis; basisLabel: string; brand: string | null; name: string; modelCode: string | null; season: string | null; color: string | null; note: string };
  sale: { state: 'found_same' | 'possible_only' | 'unverified_only' | 'none'; same: ProductOffer[]; likely: ProductOffer[]; unverified: ProductOffer[]; different: ProductOffer[] };
  sources: SourceReport[]; limits: string[]; isMock: boolean;
};
const V_ORDER: Record<Verdict, number> = { same_code: 0, likely: 1, unverified: 2, different: 3 };
const FIT: Record<string, number> = { ok: 0, any: 1, unknown: 2, sold_out: 3, missing: 4 };
/** 같은 상품 확인 → 원하는 사이즈 재고 → 상세 확인 → 총액(배송비 모르면 뒤로) 순 */
export function rankOffers(xs: ProductOffer[]) {
  const price = (o: ProductOffer) => totalPrice(o) ?? (itemPrice(o) != null ? itemPrice(o)! + 1e8 : 2e9);
  return [...xs].sort((a, b) => V_ORDER[a.verdict] - V_ORDER[b.verdict] || FIT[a.wantSize] - FIT[b.wantSize] || (a.detail === 'fetched' ? 0 : 1) - (b.detail === 'fetched' ? 0 : 1) || price(a) - price(b));
}
export function assemble(t: SearchTarget, offers: ProductOffer[], report: SourceReport[]): FindSearchResult {
  const xs = rankOffers(offers);
  const by = (v: Verdict) => xs.filter(o => o.verdict === v);
  const same = by('same_code'), likely = by('likely'), unverified = by('unverified');
  const notRun = report.filter(r => r.outcome === 'not_run');
  const limits = [
    '같은 옷인지 사진으로 비교하지 않았어요(사진 비교 연결 전) — 품번·브랜드·상품명으로만 판단했어요.',
    '판매 중·구매 가능 여부는 왈프 팀이 확인하기 전까지 확정하지 않아요.',
    ...(notRun.length ? [`검색하지 않은 곳 ${notRun.length}곳(연동 대기·지원 안 함·해당 없음) — “매물 없음”이 아니에요.`] : []),
    ...(offers.some(o => o.detail !== 'fetched') ? [`상품 페이지를 읽지 못한 후보 ${offers.filter(o => o.detail !== 'fetched').length}개는 사이즈·재고·배송비를 몰라요.`] : []),
  ];
  return {
    identification: { basis: t.basis, basisLabel: BASIS_LABEL[t.basis], brand: t.brand, name: t.name, modelCode: t.modelCode, season: t.season, color: t.color,
      note: '어떤 옷인지 식별한 결과예요. 판매 중인지는 아래 판매처 탐색 결과로 따로 확인해요.' },
    sale: { state: same.length ? 'found_same' : likely.length ? 'possible_only' : unverified.length ? 'unverified_only' : 'none', same, likely, unverified, different: by('different') },
    sources: report, limits, isMock: t.isMock,
  };
}

// ── 실행 · 대기열 ────────────────────────────────────────────
export type SearchEnv = { sources: SearchSource[]; mockAllowed: boolean; env: Record<string, string | undefined>; malls: SourceCtx['malls'];
  fetcher?: SourceCtx['fetcher']; resolve?: SourceCtx['resolve']; pace: SourceCtx['pace']; maxDetails: number; reuseMs: number };
export function searchEnvFrom(opts: { mockAllowed: boolean; env?: Record<string, string | undefined> }): SearchEnv {
  const env = opts.env || process.env;
  return { sources: SEARCH_SOURCES, mockAllowed: opts.mockAllowed, env, malls: loadMalls(), pace: pacer(Number(env.WALF_SEARCH_PACE_MS ?? 1000)),
    maxDetails: Number(env.WALF_SEARCH_MAX_DETAILS || 6), reuseMs: 20 * 3600_000 };
}
const ctxOf = (e: SearchEnv, isMock: boolean): SourceCtx => ({ isMock, mockAllowed: e.mockAllowed, env: e.env, malls: e.malls, fetcher: e.fetcher, resolve: e.resolve, pace: e.pace });
export const usableSources = (e: SearchEnv, t: SearchTarget) => e.sources.filter(s => s.availability(t, ctxOf(e, t.isMock)).usable).map(s => s.id);

/** 같은 대상·같은 소스면 같은 열쇠(하루 안에 다시 검색하지 않는다) */
export function searchKeyOf(t: SearchTarget, sourceIds: string[]) {
  return crypto.createHash('sha256').update(json([compact(t.brand), compact(t.name), compact(t.modelCode), compact(t.season), [...sourceIds].sort(), t.isMock])).digest('hex').slice(0, 32);
}

/**
 * 판매처 탐색을 대기열에 넣는다. 쓸 수 있는 소스가 없으면 넣지 않고 이유를 돌려준다.
 * 같은 의뢰·같은 열쇠의 탐색이 대기 중이거나 하루 안에 끝났으면 새로 만들지 않는다(force: 운영자가 다시 실행).
 */
export function queueFindSearch(db: DB, e: SearchEnv, requestId: number, opts: { by?: string | null; force?: boolean } = {}): { id?: number; skipped?: string } {
  const r = one(db, 'SELECT * FROM requests WHERE id=?', requestId);
  if (!r) return { skipped: 'not_found' };
  const t = targetsOf(db, requestId, e.malls)[0];
  if (!t) return { skipped: '탐색할 식별 결과가 없어요(AI 식별 전이거나 모두 숨김)' };
  const ids = usableSources(e, t);
  if (!ids.length) return { skipped: '지금 쓸 수 있는 판매처 소스가 없어요(공식몰 미등록 · 다른 소스는 연동 대기)' };
  const key = searchKeyOf(t, ids);
  const t0 = now();
  if (!opts.force) {
    // 실패한 탐색도 하루 동안은 자동으로 다시 넣지 않는다(운영자가 다시 실행)
    const cur = one(db, `SELECT id FROM offer_searches WHERE request_id=? AND search_key=? AND (status IN ('queued','running') OR (status IN ('done','failed') AND COALESCE(finished_at, created_at)>?)) ORDER BY id DESC LIMIT 1`, requestId, key, t0 - e.reuseMs);
    if (cur) return { id: cur.id, skipped: '같은 조건의 탐색이 이미 있어요' };
  }
  const id = Number(run(db, `INSERT INTO offer_searches(request_id, product_id, purpose, target, target_basis, search_key, status, requested_by, is_mock, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    requestId, r.product_id ?? null, 'find', json(t), t.basis, key, 'queued', opts.by ?? null, t.isMock ? 1 : 0, t0).lastInsertRowid);
  return { id };
}

/** 진행 중인 찾아줘마다 지금 대상으로 탐색이 있는지 본다(식별·공개·사용자 확인으로 대상이 바뀌면 새로 넣는다). 몇 번 불러도 같다 */
export function ensureFindSearches(db: DB, e: SearchEnv) {
  let n = 0;
  for (const r of all(db, `SELECT id FROM requests WHERE status IN ('submitted','active')`)) { const q = queueFindSearch(db, e, r.id); if (q.id && !q.skipped) n++; }
  return n;
}

/** 탐색 한 번을 끝까지 돈다(1→7). 하루 안에 같은 열쇠로 끝난 탐색이 있으면 다시 열지 않고 그 결과를 이 의뢰 조건으로 다시 검증해 쓴다 */
export async function runFindSearch(db: DB, e: SearchEnv, searchId: number) {
  const s = one(db, 'SELECT * FROM offer_searches WHERE id=?', searchId)!;
  const r = s.request_id ? one(db, 'SELECT * FROM requests WHERE id=?', s.request_id) : undefined;
  const t: SearchTarget = parse(s.target, null);
  const want = r ? wantOf(r) : { size: null, color: null, usedOk: true, maxPrice: null };
  const ctx = ctxOf(e, t.isMock);
  const prev = s.requested_by ? undefined : one(db, `SELECT * FROM offer_searches WHERE search_key=? AND status='done' AND id<>? AND reused_from IS NULL AND finished_at>? ORDER BY id DESC LIMIT 1`, s.search_key, s.id, now() - e.reuseMs);
  let offers: ProductOffer[], report: SourceReport[], queries: SearchQuery[];
  if (prev) {
    offers = offersOf(db, prev.id).map(o => verifyOffer(t, { ...o }, want));
    report = parse(prev.report, []).map((x: SourceReport) => ({ ...x, reason: x.outcome === 'not_run' ? x.reason : `${x.reason} · ${Math.round((now() - prev.finished_at) / 3600_000)}시간 전 탐색 결과를 다시 씀` }));
    queries = parse(prev.queries, []);
  } else {
    queries = buildQueries(t);                                                       // 2
    const found = await searchSources(e.sources, t, queries, ctx);                   // 3
    const merged = mergeHits(found.hits);                                            // 4
    const normalized = await normalizeHits(merged, t, e.sources, ctx, e.maxDetails); // 5
    offers = normalized.map(o => verifyOffer(t, o, want));                           // 6
    report = found.report;
  }
  const result = assemble(t, offers, report);                                        // 7
  const ranked = [...result.sale.same, ...result.sale.likely, ...result.sale.unverified, ...result.sale.different];
  const st = result.sale;
  const summary = st.state === 'none' ? (report.some(x => x.outcome === 'ok' || x.outcome === 'empty') ? '검색한 곳에서 판매 페이지를 찾지 못했어요' : '검색할 수 있었던 곳이 없거나 모두 실패했어요')
    : `같은 상품(품번) ${st.same.length} · 가능성 높음 ${st.likely.length} · 확인 못 함 ${st.unverified.length} · 다른 상품 ${st.different.length}`;
  run(db, `UPDATE offer_searches SET status='done', queries=?, report=?, summary=?, reused_from=?, finished_at=? WHERE id=?`, json(queries), json(report), summary, prev?.id ?? null, now(), s.id);
  saveOffers(db, s.id, s.request_id, ranked);
  return result;
}

/** 저장된 탐색 결과를 다시 7단계 모양으로(어드민·검수 화면) */
export function searchResultOf(db: DB, s: Row): FindSearchResult & { search: Row } {
  const t: SearchTarget = parse(s.target, null);
  return { ...assemble(t, offersOf(db, s.id), parse(s.report, [])), search: s };
}
export function latestSearches(db: DB, requestId: number, limit = 3) {
  return all(db, `SELECT * FROM offer_searches WHERE request_id=? AND purpose='find' ORDER BY id DESC LIMIT ?`, requestId, limit);
}

/** 서버가 꺼지며 끊긴 탐색은 다시 대기열로(무료 소스뿐이라 비용 없음) — 세 번까지 */
export function recoverOfferSearches(db: DB) {
  return Number(run(db, `UPDATE offer_searches SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END, error=CASE WHEN attempts>=3 THEN '여러 번 끊겨 중단' ELSE error END WHERE status='running'`).changes);
}

export function createOfferSearcher(db: DB, e: SearchEnv) {
  let busy = false, timer: NodeJS.Timeout | null = null;
  async function step(): Promise<number | null> {
    if (busy) return null;
    busy = true;
    try {
      const s = one(db, `SELECT * FROM offer_searches WHERE status='queued' ORDER BY id LIMIT 1`);
      if (!s) return null;
      if (!run(db, `UPDATE offer_searches SET status='running', attempts=attempts+1, started_at=? WHERE id=? AND status='queued'`, now(), s.id).changes) return null;
      try { await runFindSearch(db, e, s.id); }
      catch (err: any) {
        run(db, `UPDATE offer_searches SET status='failed', error=?, finished_at=? WHERE id=?`, String(err?.message || err).slice(0, 300), now(), s.id);
        console.warn(`판매처 탐색 #${s.id} 실패 · ${err?.message || err}`);
      }
      return s.id;
    } finally { busy = false; }
  }
  return {
    step,
    start(ms: number) { timer = setInterval(() => { try { ensureFindSearches(db, e); } catch (err) { console.error('판매처 탐색 대기열 오류', err); } step().catch(err => console.error('판매처 탐색 오류', err)); }, ms); },
    stop() { if (timer) clearInterval(timer); },
  };
}

/** 외부 추천 엔진이 준 상품 후보를 정리한다(Gate B에서 SimilarProductProvider 와 연결) */
export const cleanProviderOffers = (raw: unknown[], mockAllowed: boolean) => raw.map(x => cleanOffer(x, { mockAllowed })).filter(Boolean) as ProductOffer[];
