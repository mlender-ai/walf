// 기다려줘(WATCH) — 이미 아는 옷을 원하는 사이즈·가격이 될 때까지 하루 한 번 지켜본다.
// 가격 확인은 AI를 부르지 않는다. 같은 상품 페이지는 Watch가 여러 개여도 하루 한 번만 읽고 결과를 함께 쓴다.
// “구매 가능” 알림은 같은 상품·원하는 사이즈·재고·가격이 모두 확인됐을 때만 보낸다.
import { type DB, tx } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { now, DAY, HOUR, kClock, kDate, kTime, kWhen, kRelDay, won } from './time.ts';
import { colorsIn, normSize, sameColor, sameSize, upsertProduct, variantOf } from './catalog.ts';
import { fetchPage, fixtureSnapshot, sourceFor, sourceInfo, urlKey, SourceError, type OptionRow, type Snapshot } from './sources.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
const parse = (s: string | null, d: any = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ── 정책(설정 가능) ──────────────────────────────────────────
export type WatchPolicy = { maxActive: number; checkEveryMs: number; renewAfterMs: number; unreachableAfter: number; maxAttempts: number; leaseMs: number; mockAllowed: boolean };
export function policyFromEnv(env = process.env): WatchPolicy {
  const n = (v: string | undefined, d: number) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    maxActive: n(env.WALF_WATCH_MAX_ACTIVE, 3),                 // 사용자당 활성 Watch(일시중지·종료 제외)
    checkEveryMs: n(env.WALF_WATCH_CHECK_HOURS, 24) * HOUR,     // 하루 1회
    renewAfterMs: n(env.WALF_WATCH_RENEW_DAYS, 30) * DAY,       // 30일마다 계속할지 묻기
    unreachableAfter: n(env.WALF_WATCH_UNREACHABLE_AFTER, 3),   // 연속 실패가 이만큼이면 “확인 불가”
    maxAttempts: 3, leaseMs: 2 * 60_000,
    mockAllowed: env.WALF_QA_TOOLS === '1' || env.WALF_AI_PROVIDER === 'mock' || env.WALF_MOCK_SOURCES === '1',
  };
}
const COUNTED = ['needs_info', 'active', 'renew_due'];
const LINK_TITLE = '링크로 등록한 옷';
/** 조회 시간 창 — 24시간이면 KST 날짜. 같은 창에서는 같은 페이지를 한 번만 읽는다 */
const slotOf = (t: number, every: number) => String(Math.floor((t + 9 * HOUR) / every));
const nextSlotAt = (t: number, every: number) => (Math.floor((t + 9 * HOUR) / every) + 1) * every - 9 * HOUR;
const targetKeyOf = (source: string, url: string) => `${source}:${urlKey(url)}`;

function event(db: DB, w: Row, actor: string, kind: string, title: string, detail?: string | null, at = now()) {
  run(db, 'INSERT INTO watch_events(watch_id, actor, kind, title, detail, is_mock, at) VALUES (?,?,?,?,?,?,?)', w.id, actor, kind, title, detail ?? null, w.is_mock, at);
}
const clean = (s: unknown, max: number) => { const v = String(s ?? '').trim(); if (!v) return null; if (v.length > max) throw new HttpError(400, 'too_long', `${max}자 이하로 입력해 주세요.`); return v; };
function priceOf(v: unknown) {
  const p = Number(String(v ?? '').replace(/[^\d]/g, ''));
  if (!Number.isFinite(p) || p < 1000 || p > 100_000_000) throw new HttpError(400, 'bad_price', '원하는 가격은 1,000원 이상으로 입력해 주세요.');
  return p;
}

// ── 등록 · 변경 ──────────────────────────────────────────────
export type NewWatch = { productName?: string; productUrl?: string; brand?: string; size?: string; color?: string; targetPrice?: unknown; condition?: string; priceBasis?: string; photo?: string | null; productId?: number | null; requestId?: number | null };

export function createWatch(db: DB, userId: number, input: NewWatch, policy: WatchPolicy, opts: { isMock?: boolean } = {}) {
  const prod = input.productId ? one(db, 'SELECT * FROM products WHERE id=?', Number(input.productId)) : undefined;
  if (input.productId && !prod) throw new HttpError(400, 'bad_product');
  const req = input.requestId ? D.ownRequest(db, userId, Number(input.requestId)) : undefined;
  // 상품의 예전 주소·찾아줘 근거 주소는 이어받지 않는다 — 이번 등록에서 사용자가 준 상품 링크만 본다(다른 상품 가격이 섞이지 않게)
  const url = clean(input.productUrl, 1000);
  const typedName = clean(input.productName, 120);
  const name = typedName || prod?.name || null;
  if (!name && !url) throw new HttpError(400, 'empty', '상품명이나 상품 링크 중 하나는 있어야 해요.');
  if (url && !/^https?:\/\//i.test(url) && !(policy.mockAllowed && url.startsWith('mock://'))) throw new HttpError(400, 'bad_url', '링크는 http(s)로 시작해야 해요.');
  const target = priceOf(input.targetPrice);
  const condition = input.condition === 'new' ? 'new' : 'any';
  const priceBasis = input.priceBasis === 'item' ? 'item' : 'total'; // item: 사용자가 “배송비 제외”를 고름
  // 링크만 주고 상품명을 따로 쓰지 않았으면 그 페이지가 곧 등록한 상품이다. 상품명·찾아줘 상품이 있으면 페이지를 읽은 뒤 같은 상품인지 본다
  const pageIdentity = url && !typedName && !prod ? 'page_defined' : 'pending';
  const size = clean(input.size, 20), color = clean(input.color, 30), brand = clean(input.brand, 60) || prod?.brand || null;
  const src = url ? sourceFor(url, { mockAllowed: policy.mockAllowed }) : null;
  const isMock = !!opts.isMock || src?.source.id === 'mock' || !!prod?.is_mock || !!req?.is_mock;
  const t = now();
  return tx(db, () => {
    const n = one(db, `SELECT COUNT(*) n FROM watches WHERE user_id=? AND status IN (${COUNTED.map(() => '?').join(',')})`, userId, ...COUNTED)!.n;
    if (n >= policy.maxActive) throw new HttpError(409, 'watch_limit', `지켜보는 옷은 한 번에 ${policy.maxActive}벌까지예요. 하나를 멈추거나 끝내면 새로 등록할 수 있어요.`);
    if (url && all(db, `SELECT url, size FROM watches WHERE user_id=? AND status<>'ended' AND url IS NOT NULL`, userId).some(x => urlKey(x.url) === urlKey(url) && (x.size || '') === normSize(size)))
      throw new HttpError(409, 'watch_exists', '같은 상품·사이즈를 이미 지켜보고 있어요.');
    const pid = prod?.id ?? upsertProduct(db, { brand, name: name || LINK_TITLE, url, verified: false, source: 'user', isMock });
    if (size || color) variantOf(db, pid, color, size);
    const status = src?.ok ? 'active' : 'needs_info';
    const note = !url ? '상품 링크가 있으면 바로 지켜볼 수 있어요. 왈프 팀이 상품 페이지를 찾고 있어요.' : !src!.ok ? src!.reason! : null;
    const id = Number(run(db, `INSERT INTO watches(user_id, product_id, request_id, status, title, brand, url, photo, size, color, target_price, condition, price_basis, page_identity, source, info_note,
      next_check_at, started_at, renew_at, is_mock, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId, pid, req?.id ?? null, status, name || LINK_TITLE, brand, url, input.photo || null, size ? normSize(size) : null, color, target, condition, priceBasis, pageIdentity,
      src?.ok ? src.source.id : null, note, status === 'active' ? t : null, t, t + policy.renewAfterMs, isMock ? 1 : 0, t, t).lastInsertRowid);
    const w = one(db, 'SELECT * FROM watches WHERE id=?', id)!;
    event(db, w, 'user', 'created', '기다려줘 시작', `${won(target)} 이하${priceBasis === 'item' ? '(배송비 제외)' : ''}${size ? ` · ${normSize(size)}` : ''}${color ? ` · ${color}` : ''}${condition === 'new' ? ' · 새 상품만' : ''}`, t);
    if (status === 'needs_info') event(db, w, 'walf', 'needs_info', '확인이 필요해요', note, t);
    return id;
  });
}

export function ownWatch(db: DB, userId: number, id: number) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', id);
  if (!w || w.user_id !== userId) throw new HttpError(404, 'not_found');
  return w;
}

/** 조건을 바꾸면 알림을 다시 걸고, 마지막으로 읽은 가격으로 바로 다시 판정한다(페이지를 다시 열지 않음) */
export function updateWatch(db: DB, userId: number, id: number, patch: { targetPrice?: unknown; size?: string; color?: string; condition?: string; priceBasis?: string }, policy: WatchPolicy) {
  const w = ownWatch(db, userId, id);
  if (w.status === 'ended') throw new HttpError(409, 'bad_state', '끝난 기다려줘는 바꿀 수 없어요.');
  const next = {
    target_price: patch.targetPrice !== undefined ? priceOf(patch.targetPrice) : w.target_price,
    size: patch.size !== undefined ? (clean(patch.size, 20) ? normSize(patch.size) : null) : w.size,
    color: patch.color !== undefined ? clean(patch.color, 30) : w.color,
    condition: patch.condition !== undefined ? (patch.condition === 'new' ? 'new' : 'any') : w.condition,
    price_basis: patch.priceBasis !== undefined ? (patch.priceBasis === 'item' ? 'item' : 'total') : w.price_basis,
  };
  const diff: string[] = [];
  if (next.target_price !== w.target_price) diff.push(`원하는 가격 ${won(w.target_price)} → ${won(next.target_price)}`);
  if ((next.size || null) !== (w.size || null)) diff.push(`사이즈 ${w.size || '상관없음'} → ${next.size || '상관없음'}`);
  if ((next.color || null) !== (w.color || null)) diff.push(`색상 ${w.color || '상관없음'} → ${next.color || '상관없음'}`);
  if (next.condition !== w.condition) diff.push(next.condition === 'new' ? '새 상품만' : '중고도 괜찮아요');
  if (next.price_basis !== w.price_basis) diff.push(next.price_basis === 'item' ? '배송비 제외하고 비교' : '배송비 포함 총액으로 비교');
  if (!diff.length) return;
  tx(db, () => {
    run(db, 'UPDATE watches SET target_price=?, size=?, color=?, condition=?, price_basis=?, alerted=0, updated_at=? WHERE id=?', next.target_price, next.size, next.color, next.condition, next.price_basis, now(), id);
    event(db, w, 'user', 'conditions', '조건 변경', diff.join(' · '));
  });
  reevaluate(db, id, policy);
}

export function setWatchState(db: DB, userId: number, id: number, action: 'pause' | 'resume' | 'end' | 'renew', policy: WatchPolicy) {
  const w = ownWatch(db, userId, id);
  const t = now();
  tx(db, () => {
    if (action === 'pause') {
      if (!['active', 'needs_info'].includes(w.status)) throw new HttpError(409, 'bad_state', '지켜보는 중일 때만 멈출 수 있어요.');
      run(db, `UPDATE watches SET status='paused', paused_at=?, updated_at=? WHERE id=?`, t, t, id);
      event(db, w, 'user', 'paused', '잠시 멈춤', '다시 시작할 때까지 가격을 확인하지 않아요', t);
    } else if (action === 'resume' || action === 'renew') {
      if (action === 'resume' && w.status !== 'paused') throw new HttpError(409, 'bad_state', '멈춘 기다려줘만 다시 시작할 수 있어요.');
      if (action === 'renew' && w.status !== 'renew_due') throw new HttpError(409, 'bad_state', '계속할지 묻는 중일 때만 연장할 수 있어요.');
      if (action === 'resume') {
        const n = one(db, `SELECT COUNT(*) n FROM watches WHERE user_id=? AND id<>? AND status IN (${COUNTED.map(() => '?').join(',')})`, w.user_id, id, ...COUNTED)!.n;
        if (n >= policy.maxActive) throw new HttpError(409, 'watch_limit', `지켜보는 옷은 한 번에 ${policy.maxActive}벌까지예요.`);
      }
      const status = w.source ? 'active' : 'needs_info';
      run(db, `UPDATE watches SET status=?, paused_at=NULL, next_check_at=?, renew_at=?, updated_at=? WHERE id=?`, status, status === 'active' ? t : null,
        action === 'renew' || (w.renew_at ?? 0) <= t ? t + policy.renewAfterMs : w.renew_at, t, id);
      event(db, w, 'user', action, action === 'renew' ? '30일 더 지켜보기' : '다시 시작', action === 'renew' ? `${kDate(t + policy.renewAfterMs)}까지 지켜봐요` : '하루 한 번 가격을 확인해요', t);
    } else {
      if (w.status === 'ended') return;
      run(db, `UPDATE watches SET status='ended', ended_at=?, end_reason='user', updated_at=? WHERE id=?`, t, t, id);
      // 같은 페이지를 보는 다른 Watch가 없으면 대기 중인 조회도 거둔다
      if (w.url && w.source) {
        const key = targetKeyOf(w.source, w.url);
        const others = all(db, `SELECT url, source FROM watches WHERE status='active' AND id<>? AND url IS NOT NULL AND source IS NOT NULL`, id).some(x => targetKeyOf(x.source, x.url) === key);
        if (!others) run(db, `UPDATE price_checks SET status='failed', error='감시 종료로 조회하지 않음', finished_at=? WHERE status='queued' AND target_key=?`, t, key);
      }
      event(db, w, 'user', 'ended', '기다려줘 끝', '가격 확인을 멈췄어요 · 기록은 남아 있어요', t);
    }
  });
}

/** 운영자: 확인이 필요한 Watch에 상품 페이지를 붙인다 → 바로 지켜보기 시작 */
export function attachUrl(db: DB, id: number, url: string, operator: string, policy: WatchPolicy) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', id);
  if (!w) throw new HttpError(404, 'not_found');
  if (!['needs_info', 'active', 'paused'].includes(w.status)) throw new HttpError(409, 'bad_state');
  const u = clean(url, 1000);
  if (!u || !(/^https?:\/\//i.test(u) || (policy.mockAllowed && u.startsWith('mock://')))) throw new HttpError(400, 'bad_url', 'http(s) 상품 페이지 주소를 넣어 주세요.');
  const src = sourceFor(u, { mockAllowed: policy.mockAllowed });
  if (!src.ok) throw new HttpError(400, 'unsupported', src.reason!);
  const t = now();
  tx(db, () => {
    run(db, `UPDATE watches SET url=?, source=?, info_note=NULL, page_identity='operator_confirmed', identity_note=?, status=CASE WHEN status='needs_info' THEN 'active' ELSE status END, next_check_at=?, fail_streak=0, alerted=0, updated_at=? WHERE id=?`,
      u, src.source.id, `${operator}가 상품 페이지를 연결함`, t, t, id);
    if (w.product_id) run(db, 'UPDATE products SET url=COALESCE(url, ?), updated_at=? WHERE id=?', u, t, w.product_id);
    event(db, w, 'team', 'url', '왈프 팀이 상품 페이지를 찾았어요', `${operator} · 하루 한 번 이 페이지의 가격을 확인해요`, t);
  });
}

/** 운영자: 이 상품 페이지가 등록한 옷과 같은지 판단. 같으면 알림이 가능해지고, 다르면 페이지를 떼고 확인 요청으로 돌린다 */
export function confirmPage(db: DB, id: number, same: boolean, operator: string, policy: WatchPolicy) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', id);
  if (!w) throw new HttpError(404, 'not_found');
  if (!w.url) throw new HttpError(409, 'bad_state', '연결된 상품 페이지가 없어요.');
  const t = now();
  tx(db, () => {
    if (same) {
      run(db, `UPDATE watches SET page_identity='operator_confirmed', identity_note=?, updated_at=? WHERE id=?`, `${operator}가 같은 상품 페이지임을 확인함`, t, id);
      event(db, w, 'team', 'page_ok', '같은 상품 페이지임을 확인했어요', operator, t);
    } else {
      run(db, `UPDATE watches SET page_identity='pending', identity_note=?, url=NULL, source=NULL, status=CASE WHEN status='active' THEN 'needs_info' ELSE status END,
        info_note='등록한 옷과 다른 상품 페이지였어요. 왈프 팀이 맞는 상품 페이지를 찾고 있어요.', last_state=NULL, last_result=NULL, alerted=0, next_check_at=NULL, updated_at=? WHERE id=?`, `${operator}가 다른 상품 페이지로 판단함`, t, id);
      event(db, w, 'team', 'page_mismatch', '등록한 옷과 다른 상품 페이지였어요', '맞는 상품 페이지를 연결할 때까지 가격 알림을 보내지 않아요', t);
    }
  });
  if (same) reevaluate(db, id, policy);
}

/** 운영자: 페이지에 없는 배송비를 확인해 넣는다(이 상품 페이지에 적용). 그 뒤로는 상품가+배송비 총액으로 판정한다 */
export function confirmShipping(db: DB, id: number, fee: unknown, operator: string, policy: WatchPolicy) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', id);
  if (!w) throw new HttpError(404, 'not_found');
  const f = Number(String(fee ?? '').replace(/[^\d]/g, ''));
  if (String(fee ?? '').trim() === '' || !Number.isInteger(f) || f < 0 || f > 200_000) throw new HttpError(400, 'bad_fee', '배송비는 0원 이상 200,000원 이하 숫자로 넣어 주세요.');
  const l = w.url ? one(db, 'SELECT * FROM listings WHERE url_key=?', urlKey(w.url)) : undefined;
  if (!l) throw new HttpError(409, 'bad_state', '아직 이 상품 페이지를 읽은 적이 없어요.');
  const t = now();
  tx(db, () => {
    run(db, 'UPDATE listings SET shipping_fee=?, shipping_by=?, shipping_at=? WHERE id=?', f, operator, t, l.id);
    event(db, w, 'team', 'shipping', '왈프 팀이 배송비를 확인했어요', `${won(f)} · ${operator}`, t);
  });
  for (const x of all(db, `SELECT id, url FROM watches WHERE status='active' AND url IS NOT NULL`)) if (urlKey(x.url) === l.url_key) reevaluate(db, x.id, policy);
}

// ── 이 상품 페이지가 등록한 옷인가 ─────────────────────────────
// 사용자가 A 상품을 등록하고 B 상품 페이지를 연결해도 A의 조건 충족 알림이 나가면 안 된다.
// 자동으로는 품번이 같거나 상품명 핵심 단어가 대부분 같을 때만 “같음”으로 보고, 다른 브랜드·다른 품번은 “다름”, 나머지는 운영자 확인을 기다린다.
export const PAGE_OK = ['page_defined', 'matched', 'operator_confirmed'];
const words = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = (s: unknown) => words(s).replace(/\s+/g, '');
const CODE_RE = /[a-z]{1,5}[-_]?[a-z]{0,5}\d{2,}(?:[-_][a-z0-9]+)*/gi;
const STOP = new Set(['the', 'and', 'with', 'for', 'new', '신상', '정품', '새상품', '상품', '공용', '남녀공용']);
export function pageIdentity(w: { page_identity?: string | null; identity_note?: string | null; title: string; brand?: string | null }, prod: { name?: string | null; brand?: string | null; model_code?: string | null } | undefined,
  s: { title: string | null; brand: string | null }): { identity: string; note: string } {
  if (w.page_identity === 'page_defined' || w.page_identity === 'operator_confirmed') return { identity: w.page_identity, note: w.identity_note || '' };
  const title = s.title || '';
  const tw = words(`${title} ${s.brand || ''}`), tc = tw.replace(/\s+/g, '');
  const code = prod?.model_code;
  if (code) {
    const c = compact(code);
    if (c && tc.includes(c)) return { identity: 'matched', note: `품번 ${code}이(가) 페이지 상품명에 있어요` };
    const other = (title.match(CODE_RE) || []).find(x => compact(x).length >= 5 && compact(x) !== c);
    if (other) return { identity: 'mismatch', note: `품번이 달라요(등록 ${code} · 페이지 ${other})` };
  }
  const brand = w.brand || prod?.brand;
  const bk = compact(brand);
  if (bk && s.brand && !compact(s.brand).includes(bk) && !bk.includes(compact(s.brand)) && !tc.includes(bk)) return { identity: 'mismatch', note: `브랜드가 달라요(페이지: ${s.brand})` };
  const brandWords = new Set(words(brand).split(' '));
  const tokens = [...new Set(words(w.title || prod?.name).split(' '))].filter(x => x.length >= 2 && !brandWords.has(x) && !STOP.has(x) && !colorsIn(x).length && !/^(xxs|xs|s|m|l|xl|xxl|free|\d{2,3})$/.test(x));
  if (tokens.length >= 2) {
    const hit = tokens.filter(x => tw.includes(x)).length;
    if (hit / tokens.length >= 0.8) return { identity: 'matched', note: `상품명 핵심 단어 ${hit}/${tokens.length}개가 페이지 상품명과 같아요` };
  }
  return { identity: 'unverified', note: '등록한 옷과 같은 상품 페이지인지 자동으로 확인하지 못했어요(표기·언어 차이 등). 왈프 팀이 확인해요' };
}
/** 판정 전에 페이지 동일성을 정하고 바뀌었으면 기록한다 */
function settleIdentity(db: DB, w: Row, s: { title: string | null; brand: string | null }, t: number) {
  const prod = w.product_id ? one(db, 'SELECT * FROM products WHERE id=?', w.product_id) : undefined;
  const r = pageIdentity(w, prod, s);
  if (r.identity !== w.page_identity) {
    run(db, 'UPDATE watches SET page_identity=?, identity_note=?, updated_at=? WHERE id=?', r.identity, r.note, t, w.id);
    if (r.identity === 'mismatch') event(db, w, 'walf', 'page_mismatch', '등록한 옷과 다른 상품 페이지로 보여요', `${r.note} · 확인 전에는 가격 알림을 보내지 않아요`, t);
    else if (r.identity === 'unverified') event(db, w, 'walf', 'page_check', '같은 상품 페이지인지 확인하고 있어요', r.note, t);
  }
  return r.identity;
}
/** 페이지에 배송비가 없으면 운영자가 확인한 배송비를 쓴다 */
function withShipping(s: Snapshot, l: Row | undefined): Snapshot {
  if (s.shipping != null || l?.shipping_fee == null) return s;
  return { ...s, shipping: l.shipping_fee, shippingNote: `왈프 팀 확인 배송비(${l.shipping_by || '운영자'} · ${kDate(l.shipping_at)})` };
}

// ── 스케줄 · 조회 작업 ───────────────────────────────────────
/** 스케줄러 한 번: 30일 연장 묻기 · 확인할 때가 된 페이지를 대기열에 · 끊긴 작업 회수 */
export function tickWatches(db: DB, policy: WatchPolicy, t = now()) {
  let renew = 0, queued = 0, recovered = 0;
  for (const w of all(db, `SELECT * FROM watches WHERE status='active' AND renew_at<=?`, t)) {
    tx(db, () => {
      run(db, `UPDATE watches SET status='renew_due', updated_at=? WHERE id=?`, t, w.id);
      event(db, w, 'walf', 'renew_due', '30일이 지났어요', '계속 지켜볼지 알려 주세요', t);
    });
    D.notifyUser(db, w.user_id, { kind: 'watch_renew', title: '계속 지켜볼까요?', body: `${w.title}을(를) 30일 동안 지켜봤어요. 계속하려면 앱에서 알려 주세요.`, link: `walf://watch/${w.id}`, watchId: w.id, isMock: !!w.is_mock, dedupeKey: `watch:${w.id}:renew:${w.renew_at}` });
    renew++;
  }
  const slot = slotOf(t, policy.checkEveryMs);
  for (const w of all(db, `SELECT * FROM watches WHERE status='active' AND url IS NOT NULL AND source IS NOT NULL AND next_check_at<=?`, t)) {
    const key = targetKeyOf(w.source, w.url);
    const n = Number(run(db, `INSERT OR IGNORE INTO price_checks(target_key, url, source, slot, status, is_mock, created_at) VALUES (?,?,?,?,?,?,?)`, key, w.url, w.source, slot, 'queued', w.is_mock, t).changes);
    queued += n;
    if (n) continue;
    // 오늘 이미 다른 Watch를 위해 이 페이지를 읽었으면 다시 열지 않고 그 결과로 판정한다
    const c = one(db, 'SELECT * FROM price_checks WHERE target_key=? AND slot=?', key, slot)!;
    if (c.status === 'done') reevaluate(db, w.id, policy, nextSlotAt(t, policy.checkEveryMs));
    else if (c.status === 'failed') run(db, 'UPDATE watches SET next_check_at=? WHERE id=?', nextSlotAt(t, policy.checkEveryMs), w.id);
  }
  // 서버가 꺼져 끊긴 조회(임대 시간 지남) — 페이지 읽기는 비용이 없으니 다시 대기열로, 단 3번까지
  recovered += Number(run(db, `UPDATE price_checks SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'queued' END, error=CASE WHEN attempts>=? THEN '여러 번 끊겨 중단' ELSE error END
    WHERE status='running' AND lease_until<?`, policy.maxAttempts, policy.maxAttempts, t).changes);
  return { renew, queued, recovered };
}

export type Deps = { fetchPage: (url: string) => Promise<Snapshot>; fixture: (url: string, step: number) => Snapshot };
const TRANSIENT = ['timeout', 'network', 'dns'];

/** 조회 작업을 하나씩 처리한다. 같은 작업을 두 군데서 집지 않게 상태를 조건부로 바꿔 임대한다 */
export function createChecker(db: DB, policy: WatchPolicy, deps: Deps = { fetchPage: u => fetchPage(u), fixture: fixtureSnapshot }) {
  let busy = false, timer: NodeJS.Timeout | null = null;
  async function step(t = now()): Promise<number | null> {
    if (busy) return null;
    busy = true;
    try {
      const c = one(db, `SELECT * FROM price_checks WHERE status='queued' ORDER BY id LIMIT 1`);
      if (!c) return null;
      const got = run(db, `UPDATE price_checks SET status='running', attempts=attempts+1, lease_until=?, started_at=? WHERE id=? AND status='queued'`, t + policy.leaseMs, t, c.id).changes;
      if (!got) return null;
      let snap: Snapshot | null = null, err: SourceError | null = null;
      try {
        if (c.source === 'mock') {
          const done = one(db, `SELECT COUNT(*) n FROM price_checks WHERE target_key=? AND status IN ('done','failed') AND id<?`, c.target_key, c.id)!.n;
          snap = deps.fixture(c.url, done);
        } else snap = await deps.fetchPage(c.url);
      } catch (e: any) { err = e instanceof SourceError ? e : new SourceError('network', String(e?.message || e).slice(0, 200)); }
      const fin = now() > t ? now() : t;
      if (snap) saveSnapshot(db, c, snap, fin, policy);
      else if (TRANSIENT.includes(err!.code) && c.attempts + 1 < policy.maxAttempts) run(db, `UPDATE price_checks SET status='queued', error=? WHERE id=?`, err!.message, c.id);
      else saveFailure(db, c, err!, fin, policy);
      return c.id;
    } finally { busy = false; }
  }
  return {
    step,
    start(ms: number) { timer = setInterval(() => { try { tickWatches(db, policy); } catch (e) { console.error('watch tick 실패', e); } step().catch(e => console.error('가격 확인 오류', e)); }, ms); },
    stop() { if (timer) clearInterval(timer); },
  };
}

function saveSnapshot(db: DB, c: Row, s0: Snapshot, t: number, policy: WatchPolicy) {
  let s = s0;
  const watchers = all(db, `SELECT * FROM watches WHERE status IN ('active','renew_due','paused') AND url IS NOT NULL AND source=?`, c.source).filter(w => targetKeyOf(w.source, w.url) === c.target_key);
  tx(db, () => {
    const key = urlKey(c.url);
    let l = one(db, 'SELECT * FROM listings WHERE url_key=?', key);
    if (!l) {
      // 이 페이지가 어떤 Watch의 옷과 같은지는 Watch마다 다르다(watches.page_identity). 리스팅 자체는 “확인 안 됨”으로 둔다
      run(db, `INSERT INTO listings(product_id, source, seller, url, url_key, title, condition, identity, is_mock, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        null, c.source, s.seller, c.url, key, s.title, s.condition, 'unverified', s.isMock ? 1 : 0, t, t);
      l = one(db, 'SELECT * FROM listings WHERE url_key=?', key)!;
    } else run(db, 'UPDATE listings SET title=COALESCE(?, title), last_seen=? WHERE id=?', s.title, t, l.id);
    s = withShipping(s, l);
    const ins = db.prepare(`INSERT INTO price_observations(listing_id, check_id, target_key, checked_at, ok, option_label, color, size, price, sale_price, shipping, shipping_note, stock, source, basis, is_mock)
      VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)`);
    const rows: OptionRow[] = s.options.length ? s.options : [{ label: '', color: '', size: '', stock: s.pageStock, price: s.price, basis: s.basis.join('+') }];
    for (const o of rows) ins.run(l.id, c.id, c.target_key, t, o.label, o.color, o.size, o.price ?? s.price, s.salePrice, s.shipping, s.shippingNote, o.stock, s.source, o.basis, s.isMock ? 1 : 0);
    run(db, `UPDATE price_checks SET status='done', finished_at=?, error=NULL WHERE id=?`, t, c.id);
    // 사용자가 쓴 상품명은 바꾸지 않는다. 링크만 주고 이름을 쓰지 않았으면(page_defined) 페이지에서 읽은 상품명을 이름으로 쓴다
    for (const w of watchers) {
      if (w.product_id) run(db, 'UPDATE products SET image=COALESCE(image, ?), updated_at=? WHERE id=?', s.image, t, w.product_id);
      if (w.page_identity === 'page_defined' && w.title === LINK_TITLE && s.title) run(db, 'UPDATE watches SET title=? WHERE id=?', s.title.slice(0, 120), w.id);
    }
  });
  for (const w of watchers.filter(x => x.status === 'active')) applyEval(db, w, evaluate(w, s, settleIdentity(db, w, s, t)), t, nextSlotAt(t, policy.checkEveryMs));
}

function saveFailure(db: DB, c: Row, err: SourceError, t: number, policy: WatchPolicy) {
  const watchers = all(db, `SELECT * FROM watches WHERE status='active' AND url IS NOT NULL AND source=?`, c.source).filter(w => targetKeyOf(w.source, w.url) === c.target_key);
  tx(db, () => {
    run(db, `INSERT INTO price_observations(check_id, target_key, checked_at, ok, error, source, is_mock) VALUES (?,?,?,0,?,?,?)`, c.id, c.target_key, t, `${err.code}: ${err.message}`, c.source, c.is_mock);
    run(db, `UPDATE price_checks SET status='failed', finished_at=?, error=? WHERE id=?`, t, err.message, c.id);
    for (const w of watchers) {
      const streak = w.fail_streak + 1;
      run(db, `UPDATE watches SET fail_streak=?, last_checked_at=?, next_check_at=?, last_state='check_failed', last_result=?, updated_at=? WHERE id=?`,
        streak, t, nextSlotAt(t, policy.checkEveryMs), JSON.stringify({ state: 'check_failed', error: err.message, code: err.code }), t, w.id);
      event(db, w, 'walf', 'check_failed', '가격을 확인하지 못했어요', err.message, t);
      if (streak === policy.unreachableAfter)
        D.notifyUser(db, w.user_id, { kind: 'watch_unreachable', title: '가격을 확인하지 못하고 있어요', body: `${w.title} 페이지를 ${streak}번 연속 확인하지 못했어요. 왈프 팀이 살펴볼게요.`, link: `walf://watch/${w.id}`, watchId: w.id, isMock: !!w.is_mock, dedupeKey: `watch:${w.id}:unreachable:${w.alert_episode}:${Math.floor(t / DAY)}` });
    }
  });
}

// ── 판정 ─────────────────────────────────────────────────────
export type EvalState = 'met' | 'above' | 'sold_out' | 'size_missing' | 'color_missing' | 'color_unknown' | 'stock_unknown' | 'shipping_unknown' | 'unverified' | 'mismatch' | 'sale_only' | 'condition' | 'no_price';
export type Eval = { state: EvalState; basis: 'total' | 'item'; price: number | null; salePrice: number | null; shipping: number | null; shippingKnown: boolean; total: number | null; stock: string; option: string | null; seller: string; reasons: string[] };
/** 가격은 원하는 만큼 내려왔지만 확인할 게 남은 상태 — 구매 가능 알림을 보내지 않고 왈프 팀 확인 대기열에 올린다 */
export const ATTENTION: EvalState[] = ['stock_unknown', 'shipping_unknown', 'color_unknown', 'unverified', 'sale_only'];

/**
 * 한 Watch 조건으로 한 번 읽은 페이지를 판정한다(순수 함수). identity: 이 페이지가 등록한 옷인지(PAGE_OK 만 조건 충족 가능).
 * 조건 충족(met)은 같은 상품 페이지 · 원하는 사이즈 · 원하는 색 · 재고 있음 · 목표가 이하가 모두 확인될 때만.
 * 목표가 비교는 기본이 상품가+배송비 총액이다. 배송비를 모르면 “상품 가격은 충족, 배송비 미확인”(shipping_unknown)으로 따로 둔다.
 * 사용자가 “배송비 제외”를 고른 경우(price_basis=item)에만 상품가로 비교한다.
 */
export function evaluate(w: { size?: string | null; color?: string | null; target_price: number; condition: string; price_basis?: string | null }, s: Snapshot, identity: string): Eval {
  const basis: 'total' | 'item' = w.price_basis === 'item' ? 'item' : 'total';
  const base = { basis, salePrice: s.salePrice, shipping: s.shipping, shippingKnown: s.shipping != null, seller: s.seller };
  const wantColor = !!String(w.color ?? '').trim();
  // 색: 옵션에 색 값이 있으면 그걸로, 없으면 상품명에 적힌 색으로만 확인한다. 둘 다 없으면 “색상 확인 못 함”
  const titleColor = colorsIn(s.title);
  const byTitle = (): 'ok' | 'unknown' | 'other' => !titleColor.length ? 'unknown' : sameColor(w.color, s.title) ? 'ok' : 'other';
  let colorState: 'ok' | 'unknown' = 'ok';
  let opt: OptionRow | null = null;
  if (s.options.length) {
    const bySize = w.size ? s.options.filter(o => sameSize(o.size, w.size)) : s.options;
    if (w.size && !bySize.length) return { ...base, state: 'size_missing', price: s.price, total: null, stock: 'unknown', option: null, reasons: [`${normSize(w.size)} 사이즈 옵션이 없어요`] };
    let cand = bySize;
    if (wantColor) {
      const same = bySize.filter(o => o.color && sameColor(w.color, o.color));
      const blank = bySize.filter(o => !o.color);
      if (same.length) cand = same;
      else if (!blank.length) return { ...base, state: 'color_missing', price: s.price, total: null, stock: 'unknown', option: null, reasons: [`${w.color} 색상 옵션이 없어요`] };
      else {
        const t = byTitle();
        if (t === 'other') return { ...base, state: 'color_missing', price: s.price, total: null, stock: 'unknown', option: null, reasons: [`페이지 상품명의 색이 ${w.color}이(가) 아니에요`] };
        cand = blank; colorState = t;
      }
    }
    opt = cand.find(o => o.stock === 'in_stock') || cand[0];
  } else if (wantColor) {
    const t = byTitle();
    if (t === 'other') return { ...base, state: 'color_missing', price: s.price, total: null, stock: s.pageStock, option: null, reasons: [`페이지 상품명의 색이 ${w.color}이(가) 아니에요`] };
    colorState = t;
  }
  const stock = opt ? opt.stock : w.size ? 'unknown' : s.pageStock;
  const price = opt?.price ?? s.price;
  const option = opt?.label || null;
  if (identity === 'mismatch') return { ...base, state: 'mismatch', price, total: null, stock, option, reasons: ['등록한 옷과 다른 상품 페이지로 보여요'] };
  if (w.condition === 'new' && s.condition === 'used') return { ...base, state: 'condition', price, total: null, stock, option, reasons: ['새 상품만 원하셨어요'] };
  if (price == null) return { ...base, state: 'no_price', price: null, total: null, stock, option, reasons: ['가격을 읽지 못했어요'] };
  const total = price + (s.shipping ?? 0);
  const compare = basis === 'item' ? price : total;
  if (stock === 'sold_out') return { ...base, state: 'sold_out', price, total, stock, option, reasons: [`${option || '원하는 옵션'} 품절`] };
  if (compare <= w.target_price) {
    if (stock !== 'in_stock') return { ...base, state: 'stock_unknown', price, total, stock, option, reasons: [!opt && w.size ? '페이지에 사이즈별 재고가 없어 원하는 사이즈 재고를 확인하지 못했어요' : '재고를 확인하지 못했어요'] };
    if (basis === 'total' && s.shipping == null) return { ...base, state: 'shipping_unknown', price, total, stock, option, reasons: [`상품 가격 ${won(price)}은 원하는 가격 이하지만 배송비를 확인하지 못했어요`] };
    if (colorState === 'unknown') return { ...base, state: 'color_unknown', price, total, stock, option, reasons: [`원하는 색(${w.color})인지 페이지에서 확인하지 못했어요`] };
    if (!PAGE_OK.includes(identity)) return { ...base, state: 'unverified', price, total, stock, option, reasons: ['등록한 옷과 같은 상품 페이지인지 아직 확인하지 않았어요'] };
    return { ...base, state: 'met', price, total, stock, option, reasons: [] };
  }
  const sale = s.salePrice != null ? s.salePrice + (basis === 'item' ? 0 : s.shipping ?? 0) : null;
  if (sale != null && sale <= w.target_price)
    return { ...base, state: 'sale_only', price, total, stock, option, reasons: [`표시된 할인가 ${won(s.salePrice)}는 적용 조건(회원·쿠폰 등)을 확인하지 못했어요`] };
  return { ...base, state: 'above', price, total, stock, option, reasons: [`원하는 가격보다 ${won(compare - w.target_price)} 높아요${basis === 'item' ? '(배송비 제외)' : s.shipping == null ? '(배송비 미확인)' : ''}`] };
}
/** 알림·화면에 쓰는 금액 문구 */
export const amountText = (ev: Pick<Eval, 'basis' | 'price' | 'shipping' | 'shippingKnown' | 'total'>) =>
  ev.basis === 'item' ? `상품가 ${won(ev.price)}(배송비 제외 기준${ev.shippingKnown ? ` · 배송비 ${won(ev.shipping)} 별도` : ''})`
    : ev.shippingKnown ? `배송비 포함 총 ${won(ev.total)}` : `상품가 ${won(ev.price)}(배송비 미확인)`;

function applyEval(db: DB, w0: Row, ev: Eval, t: number, nextAt: number | null) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', w0.id)!;
  const prev = parse(w.last_result, {});
  const outbox: (() => void)[] = [];
  tx(db, () => {
    let alerted = w.alerted, episode = w.alert_episode;
    // 가격·재고 변화를 먼저 남기고 판정 결과를 뒤에 남긴다(최신순 목록에서 결과가 위)
    if (prev.total != null && ev.total != null && prev.total !== ev.total) event(db, w, 'walf', 'price', '가격이 바뀌었어요', `${won(prev.total)} → ${won(ev.total)}`, t);
    if (prev.stock && prev.stock !== ev.stock && ev.stock !== 'unknown') event(db, w, 'walf', 'stock', ev.stock === 'in_stock' ? '재고가 들어왔어요' : '품절됐어요', ev.option, t);
    if (ev.state === 'met' && !w.alerted) {
      episode += 1; alerted = 1;
      const ship = amountText(ev);
      event(db, w, 'walf', 'met', '원하는 가격이 됐어요', `${ev.seller}${ev.option ? ` · ${ev.option}` : ''} · ${ship} · 재고 있음`, t);
      outbox.push(() => D.notifyUser(db, w.user_id, { kind: 'watch_met', title: '기다리던 가격이 됐어요', link: `walf://watch/${w.id}`, watchId: w.id, isMock: !!w.is_mock, dedupeKey: `watch:${w.id}:met:${episode}`,
        body: `${w.title}${w.size ? ` ${w.size}` : ''} · ${ship} · ${ev.seller}에서 판매 중이에요(${kTime(t)} 확인). 먼저 팔릴 수 있어요.` }));
    } else if (ev.state !== 'met' && w.alerted) {
      alerted = 0; // 조건이 깨지면 다시 맞을 때 한 번 더 알린다(재입고·가격 재하락)
      event(db, w, 'walf', 'unmet', '조건이 다시 맞지 않아요', ev.reasons[0] || null, t);
    }
    if (ATTENTION.includes(ev.state) && prev.state !== ev.state) event(db, w, 'walf', 'attention', '가격은 내려왔지만 확인할 게 있어요', `${ev.reasons[0]} · 확인 전에는 구매 가능 알림을 보내지 않아요`, t);
    run(db, `UPDATE watches SET last_checked_at=?, next_check_at=COALESCE(?, next_check_at), last_state=?, last_result=?, fail_streak=0, alerted=?, alert_episode=?, met_at=CASE WHEN ?='met' THEN COALESCE(met_at, ?) ELSE met_at END, updated_at=? WHERE id=?`,
      t, nextAt, ev.state, JSON.stringify(ev), alerted, episode, ev.state, t, now(), w.id);
  });
  outbox.forEach(f => f());
}

/** 마지막으로 읽은 값으로 다시 판정한다(조건 변경 · 같은 날 이미 읽은 페이지). 페이지를 다시 열지 않는다 */
function reevaluate(db: DB, id: number, _policy: WatchPolicy, nextAt: number | null = null) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', id)!;
  if (w.status !== 'active' || !w.url || !w.source) return;
  const last = one(db, `SELECT MAX(check_id) c FROM price_observations WHERE target_key=? AND ok=1`, targetKeyOf(w.source, w.url))?.c;
  if (!last) return;
  const obs = all(db, 'SELECT * FROM price_observations WHERE check_id=?', last);
  const l = one(db, 'SELECT * FROM listings WHERE id=?', obs[0].listing_id);
  const s0: Snapshot = { url: w.url, source: w.source, seller: l?.seller || '', title: l?.title || null, brand: null, image: null, condition: l?.condition || 'new',
    price: obs[0].price, salePrice: obs[0].sale_price, shipping: obs[0].shipping, shippingNote: obs[0].shipping_note,
    options: obs.filter(o => o.option_label || o.size || o.color).map(o => ({ label: o.option_label, color: o.color, size: o.size, stock: o.stock, price: o.price, basis: o.basis })),
    pageStock: obs.some(o => o.stock === 'in_stock') ? 'in_stock' : 'unknown', basis: [], isMock: !!obs[0].is_mock };
  const s = withShipping(s0, l);
  applyEval(db, w, evaluate(w, s, settleIdentity(db, w, s, obs[0].checked_at)), obs[0].checked_at, nextAt);
}

// ── 화면용 ───────────────────────────────────────────────────
export const WATCH_LABEL: Record<string, string> = { needs_info: '확인 필요', watching: '가격 감시 중', first: '가격 감시 중', met: '조건 충족', attention: '가격 감시 중', mismatch: '확인 필요', paused: '감시 일시중지', renew_due: '계속할지 확인', unreachable: '확인 불가', ended: '완료·종료' };

export function watchDisplay(w: Row, policy: Pick<WatchPolicy, 'unreachableAfter'>, t = now()) {
  const ev: Eval | null = parse(w.last_result, null);
  const d = (key: string, title: string, desc: string, extra: Record<string, unknown> = {}) => ({ key, label: WATCH_LABEL[key], title, desc, isMock: !!w.is_mock, ...extra });
  if (w.status === 'ended') return d('ended', '기다려줘를 끝냈어요', `${kDate(w.ended_at)}에 멈췄어요. 가격 기록은 남아 있어요.`);
  if (w.status === 'paused') return d('paused', '잠시 멈췄어요', '다시 시작하면 하루 한 번 가격을 확인해요.');
  if (w.status === 'renew_due') return d('renew_due', '계속 지켜볼까요?', '30일이 지났어요. 계속하면 30일 더 지켜볼게요.');
  if (w.status === 'needs_info') return d('needs_info', '상품을 확인하고 있어요', w.info_note || '어떤 상품 페이지를 볼지 확인하고 있어요.');
  if (w.fail_streak >= policy.unreachableAfter) return d('unreachable', '가격을 확인하지 못하고 있어요', `${w.fail_streak}번 연속 확인하지 못했어요(${ev && (ev as any).error ? (ev as any).error : '페이지 오류'}). 매물이 없다는 뜻은 아니에요.`);
  if (!w.last_checked_at || !ev) return d('first', '첫 확인을 준비하고 있어요', '곧 가격과 재고를 확인할게요.');
  if ((ev as any).state === 'check_failed') return d('watching', '이번에는 가격을 확인하지 못했어요', `${(ev as any).error || ''} 다음 확인 때 다시 볼게요.`);
  const when = `${kWhen(w.last_checked_at, t)} 확인`;
  const ship = ev.price == null ? '' : amountText({ ...ev, basis: ev.basis || 'total' });
  if (ev.state === 'mismatch') return d('mismatch', '등록한 옷과 다른 상품 페이지로 보여요', `${w.identity_note || ev.reasons[0]}. 왈프 팀이 맞는 페이지를 확인할 때까지 가격 알림을 보내지 않아요.`, { eyebrow: when, notice: '왈프 팀이 확인하고 있어요' });
  if (ev.state === 'met') return d('met', '원하는 가격이 됐어요', `${ev.seller}${ev.option ? ` · ${ev.option}` : ''} · ${ship} · 재고 있음. 먼저 팔릴 수 있어요.`, { eyebrow: when });
  if (ATTENTION.includes(ev.state)) return d('attention', ev.state === 'shipping_unknown' ? '상품 가격은 충족, 배송비 미확인' : `${kRelDay(w.last_checked_at, t)} ${ship}`,
    `${ev.reasons[0]}. 확인되기 전에는 구매 가능 알림을 보내지 않아요.`, { eyebrow: when, notice: '왈프 팀이 확인하고 있어요' });
  const desc: Record<string, string> = {
    above: `${ev.reasons[0]}. 하루 한 번 확인해요.`, sold_out: `${ev.reasons[0]}이에요. 다시 들어오고 원하는 가격 이하면 알려 드릴게요.`,
    size_missing: `${ev.reasons[0]}. 다른 사이즈로 바꾸거나 계속 지켜볼 수 있어요.`, color_missing: `${ev.reasons[0]}.`, condition: ev.reasons[0], no_price: `${ev.reasons[0]}. 다음 확인 때 다시 볼게요.`,
  };
  return d('watching', ev.total != null ? `${kRelDay(w.last_checked_at, t)} 확인한 가격 ${ship}` : '가격을 지켜보고 있어요', desc[ev.state] || '', { eyebrow: when });
}

export function watchView(db: DB, w: Row, base: string, policy: Pick<WatchPolicy, 'unreachableAfter'>, t = now()) {
  const p = w.product_id ? one(db, 'SELECT * FROM products WHERE id=?', w.product_id) : undefined;
  const key = w.url && w.source ? targetKeyOf(w.source, w.url) : null;
  const obs = key ? all(db, `SELECT * FROM price_observations WHERE target_key=? AND checked_at>=? ORDER BY checked_at DESC, id LIMIT 300`, key, w.created_at) : [];
  // 확인 한 번마다 이 Watch 조건에 맞는 옵션 한 줄
  const byCheck = new Map<number, Row[]>();
  for (const o of obs) { const k = o.check_id ?? -o.id; byCheck.set(k, [...(byCheck.get(k) || []), o]); }
  const history = [...byCheck.values()].slice(0, 60).map(rows => {
    const ok = rows[0].ok === 1;
    const pick = rows.find(o => (!w.size || sameSize(o.size, w.size)) && (!w.color || !o.color || sameColor(w.color, o.color))) || (rows.length === 1 ? rows[0] : null);
    const total = pick?.price != null ? pick.price + (pick.shipping ?? 0) : null;
    return { at: rows[0].checked_at, label: `${kDate(rows[0].checked_at).replace(/\(.\)$/, '')} ${kClock(rows[0].checked_at)}`, ok, error: ok ? null : rows[0].error?.replace(/^\w+:\s*/, ''),
      price: pick?.price ?? null, shipping: pick?.shipping ?? null, shippingKnown: pick ? pick.shipping != null : false, total, stock: pick?.stock || (ok ? 'option_missing' : null),
      option: pick?.option_label || null, source: rows[0].source, isMock: !!rows[0].is_mock,
      // 이 줄의 가격이 목표 이하인지만 표시한다(조건 충족 여부는 상태 문장이 말한다). 총액 기준인데 배송비를 모르면 표시하지 않는다
      meets: PAGE_OK.includes(w.page_identity) && pick?.stock === 'in_stock' && (w.price_basis === 'item' ? pick.price != null && pick.price <= w.target_price : total != null && pick.shipping != null && total <= w.target_price) };
  });
  const src = sourceInfo(w.source);
  const listing = w.url ? one(db, 'SELECT * FROM listings WHERE url_key=?', urlKey(w.url)) : undefined;
  const events = all(db, 'SELECT * FROM watch_events WHERE watch_id=? ORDER BY at DESC, id DESC LIMIT 50', w.id).map(e => ({ id: e.id, at: e.at, label: kWhen(e.at, t), clock: kClock(e.at), actor: D.ACTOR_LABEL[e.actor] || e.actor, kind: e.kind, title: e.title, detail: e.detail, isMock: !!e.is_mock }));
  return {
    id: w.id, status: w.status, isMock: !!w.is_mock, display: watchDisplay(w, policy, t),
    product: { title: w.title, brand: w.brand || p?.brand || null, url: w.url && !w.url.startsWith('mock://') ? w.url : null, photoUrl: w.photo ? `${base}/uploads/${w.photo}` : p?.image || null,
      pageTitle: listing?.title || null, seller: listing?.seller || null, productId: w.product_id },
    conditions: { size: w.size, color: w.color, targetPrice: w.target_price, condition: w.condition, priceBasis: w.price_basis === 'item' ? 'item' : 'total',
      label: [`${won(w.target_price)} 이하${w.price_basis === 'item' ? '(배송비 제외)' : ''}`, w.size, w.color, w.condition === 'new' ? '새 상품만' : '중고도 OK'].filter(Boolean).join(' · ') },
    page: { identity: w.page_identity, ok: PAGE_OK.includes(w.page_identity), note: w.identity_note || null },
    source: src ? { id: src.id, label: src.label, status: src.status, reason: src.reason } : null,
    latest: history.find(h => h.ok) || null, history, events,
    schedule: { lastCheckedLabel: w.last_checked_at ? kWhen(w.last_checked_at, t) : null, nextCheckLabel: w.status === 'active' && w.next_check_at ? (w.next_check_at <= t ? '곧 확인' : kWhen(w.next_check_at, t)) : null,
      renewLabel: w.renew_at ? `${kDate(w.renew_at)}까지` : null, startedLabel: kDate(w.started_at || w.created_at) },
    actions: { pause: ['active', 'needs_info'].includes(w.status), resume: w.status === 'paused', renew: w.status === 'renew_due', end: w.status !== 'ended', edit: w.status !== 'ended' },
    requestId: w.request_id, createdAt: w.created_at,
  };
}

/** 내가 찾는 옷 — 찾아줘 의뢰와 기다려줘를 한 목록으로 */
export function myItems(db: DB, userId: number, base: string, policy: Pick<WatchPolicy, 'unreachableAfter' | 'maxActive'>, t = now()) {
  const reqs = all(db, 'SELECT * FROM requests WHERE user_id=? ORDER BY id DESC LIMIT 30', userId).map(r => {
    const d = D.display(db, r, t);
    const ended = !D.OPEN_STATUSES.includes(r.status);
    return { kind: 'find' as const, id: r.id, title: D.shortName(r), brand: r.identified_brand || r.brand || null, photoUrl: r.photo ? `${base}/uploads/${r.photo}` : null,
      stateKey: d.key, stateLabel: ended ? '완료·종료' : r.status === 'active' && !['offer_verified', 'lead_found'].includes(d.key) ? '7일 탐색 중' : d.label, sub: d.title, isMock: !!r.is_mock || !!d.isMock, updatedAt: r.updated_at, ended };
  });
  const watches = all(db, 'SELECT * FROM watches WHERE user_id=? ORDER BY id DESC LIMIT 30', userId).map(w => {
    const d = watchDisplay(w, policy, t);
    return { kind: 'watch' as const, id: w.id, title: w.title, brand: w.brand, photoUrl: w.photo ? `${base}/uploads/${w.photo}` : null,
      stateKey: d.key, stateLabel: d.label, sub: d.title, isMock: !!w.is_mock, updatedAt: w.updated_at, ended: w.status === 'ended', target: `${won(w.target_price)} 이하${w.size ? ` · ${w.size}` : ''}` };
  });
  const items = [...reqs, ...watches].sort((a, b) => Number(a.ended) - Number(b.ended) || b.updatedAt - a.updatedAt);
  const activeWatches = watches.filter(w => !['paused', 'ended'].includes(w.stateKey)).length;
  return { items, watchLimit: { max: policy.maxActive, used: activeWatches } };
}

// ── 어드민 ───────────────────────────────────────────────────
export function adminWatchRows(db: DB) {
  return all(db, `SELECT w.*, u.device_id FROM watches w JOIN users u ON u.id=w.user_id ORDER BY CASE w.status WHEN 'needs_info' THEN 0 WHEN 'active' THEN 1 WHEN 'renew_due' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END, w.id DESC LIMIT 200`);
}
export { targetKeyOf };
