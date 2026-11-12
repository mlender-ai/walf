import { type DB, tx, WANTED_CHANNELS } from './db.ts';
import { now, DAY, HUNT_MS, kDate, kTime, kWhen, kRelDay, kDayNum, won } from './time.ts';
import { sendPush } from './push.ts';

export class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message?: string) { super(message || code); this.status = status; this.code = code; }
}

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export const OPEN_STATUSES = ['submitted', 'needs_info', 'active'];
export const ACTOR_LABEL: Record<string, string> = { walf: '왈프', team: '왈프 팀', user: '나', system: '시스템' };

// ── 사용자 ────────────────────────────────────────────────────
/** 계정·데이터 삭제. 외부에 게시된 수배글이 남아 있으면 삭제 처리에 필요한 채널 기록만 남기고 나머지는 지운다. 지울 사진 파일 이름을 돌려준다. */
export function deleteUser(db: DB, userId: number) {
  const photos: string[] = [];
  tx(db, () => {
    for (const r of all(db, 'SELECT * FROM requests WHERE user_id=?', userId)) {
      if (OPEN_STATUSES.includes(r.status)) closeOut(db, r, 'cancelled', 'account_deleted');
      if (r.photo) photos.push(r.photo);
      const pending = one(db, `SELECT COUNT(*) n FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id WHERE w.request_id=? AND p.status='removal_requested'`, r.id)!.n;
      if (pending) {
        run(db, 'UPDATE requests SET photo=NULL, note=NULL, product_url=NULL, updated_at=? WHERE id=?', now(), r.id);
        run(db, 'DELETE FROM activity WHERE request_id=?', r.id);
        log(db, r.id, 'system', 'account_deleted', '사용자 데이터 삭제', '게시된 수배글 삭제 처리를 위해 채널 기록만 남겼어요', { isMock: !!r.is_mock });
      } else run(db, 'DELETE FROM requests WHERE id=?', r.id);
    }
    for (const w of all(db, 'SELECT photo FROM watches WHERE user_id=? AND photo IS NOT NULL', userId)) photos.push(w.photo);
    run(db, 'DELETE FROM watches WHERE user_id=?', userId); // 기다려줘·감시 기록(watch_events)도 함께. 상품 페이지 가격 기록은 개인 정보가 아니라 남는다
    run(db, 'DELETE FROM notifications WHERE user_id=?', userId);
    if (one(db, 'SELECT COUNT(*) n FROM requests WHERE user_id=?', userId)!.n) run(db, `UPDATE users SET device_id='deleted:'||id||':'||?, push_token=NULL, deleted_at=? WHERE id=?`, now(), now(), userId);
    else run(db, 'DELETE FROM users WHERE id=?', userId);
  });
  return photos;
}

export function upsertUser(db: DB, deviceId: string, platform?: string) {
  if (!deviceId || deviceId.length < 8 || deviceId.length > 80 || deviceId.startsWith('deleted:')) throw new HttpError(400, 'bad_device');
  const u = one(db, 'SELECT * FROM users WHERE device_id=?', deviceId);
  if (u) return u;
  run(db, 'INSERT INTO users(device_id, platform, created_at) VALUES (?,?,?)', deviceId, platform || null, now());
  return one(db, 'SELECT * FROM users WHERE device_id=?', deviceId)!;
}
export function userByDevice(db: DB, deviceId: string) { return one(db, 'SELECT * FROM users WHERE device_id=?', deviceId); }

export function getRequest(db: DB, id: number) {
  const r = one(db, 'SELECT * FROM requests WHERE id=?', id);
  if (!r) throw new HttpError(404, 'not_found');
  return r;
}
export function ownRequest(db: DB, userId: number, id: number) {
  const r = getRequest(db, id);
  if (r.user_id !== userId) throw new HttpError(404, 'not_found');
  return r;
}
export function openRequestOf(db: DB, userId: number) {
  return one(db, `SELECT * FROM requests WHERE user_id=? AND status IN ('submitted','needs_info','active') ORDER BY id DESC LIMIT 1`, userId);
}

// ── 기록 · 알림 ───────────────────────────────────────────────
export function log(db: DB, requestId: number, actor: string, kind: string, title: string, detail?: string | null, opts: { operator?: string; isMock?: boolean; at?: number } = {}) {
  run(db, 'INSERT INTO activity(request_id, actor, kind, title, detail, operator, is_mock, at) VALUES (?,?,?,?,?,?,?,?)',
    requestId, actor, kind, title, detail ?? null, opts.operator ?? null, opts.isMock ? 1 : 0, opts.at ?? now());
}

export function notify(db: DB, req: Row, kind: string, title: string, body: string, link: string, opts: { candidateId?: number; isMock?: boolean; forcePush?: boolean; dedupeKey?: string } = {}) {
  return notifyUser(db, req.user_id, { kind, title, body, link, requestId: req.id, candidateId: opts.candidateId, isMock: !!opts.isMock || !!req.is_mock, forcePush: opts.forcePush, dedupeKey: opts.dedupeKey });
}

export type Notice = { kind: string; title: string; body: string; link: string; requestId?: number | null; candidateId?: number | null; watchId?: number | null; isMock?: boolean; forcePush?: boolean; dedupeKey?: string };
/** 사용자 알림 한 통. dedupeKey 가 같은 알림은 두 번 만들지 않는다(0을 돌려준다) */
export function notifyUser(db: DB, userId: number, n: Notice) {
  const user = one(db, 'SELECT * FROM users WHERE id=?', userId);
  if (!user || user.deleted_at) return 0;
  const isMock = !!n.isMock;
  // 모의 데이터는 푸시하지 않는다. 예외는 운영자가 명시적으로 보내는 “테스트 알림”(forcePush) 하나뿐
  const status = isMock && !n.forcePush ? 'skipped_mock' : user.push_token ? 'sending' : 'no_token';
  const detail = status === 'skipped_mock' ? '모의 데이터라 푸시를 보내지 않음 — 앱 안 알림에만 표시' : user.push_token ? null : '기기 푸시 토큰 없음 — 앱 안 알림으로만 전달';
  const info = run(db, `INSERT OR IGNORE INTO notifications(user_id, request_id, candidate_id, watch_id, kind, title, body, link, is_mock, created_at, push_status, push_detail, dedupe_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, userId, n.requestId ?? null, n.candidateId ?? null, n.watchId ?? null, n.kind, n.title, n.body, n.link, isMock ? 1 : 0, now(), status, detail, n.dedupeKey ?? null);
  if (!info.changes) return 0;
  const nid = Number(info.lastInsertRowid);
  if (status === 'sending') {
    sendPush(user.push_token, n.title, n.body, { link: n.link }).then(
      r => {
        run(db, 'UPDATE notifications SET push_status=?, push_detail=? WHERE id=?', r.ok ? 'sent' : 'failed', r.detail, nid);
        if (r.unregistered) run(db, 'UPDATE users SET push_token=NULL WHERE id=? AND push_token=?', user.id, user.push_token); // 지워진 기기 토큰은 버린다
      },
      e => run(db, 'UPDATE notifications SET push_status=?, push_detail=? WHERE id=?', 'failed', String(e).slice(0, 300), nid));
  }
  return nid;
}

/** QA 도구 — 이 의뢰를 맡긴 기기로 테스트 푸시 한 통. 알림 기록에 “테스트”로 남는다 */
export function sendTestPush(db: DB, requestId: number, operator: string) {
  const r = getRequest(db, requestId);
  const u = one(db, 'SELECT * FROM users WHERE id=?', r.user_id);
  if (!u?.push_token) throw new HttpError(409, 'no_token', '이 기기는 아직 푸시 토큰을 등록하지 않았어요. 앱 MY에서 알림을 켜야 해요.');
  notify(db, r, 'test', '테스트 알림', `운영자 ${operator}가 보낸 알림 확인용 메시지예요. 실제 소식이 아니에요.`, `walf://request/${r.id}`, { isMock: true, forcePush: true });
}

// ── 의뢰 등록 ─────────────────────────────────────────────────
export type NewRequest = { productName?: string; brand?: string; productUrl?: string; photo?: string | null; note?: string; size?: string; color?: string; maxPrice?: number | null; usedOk?: boolean };

/** 받침에 맞는 목적격 조사(을/를) */
export const eul = (w: string) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를'; };
const clean = (s: unknown, max: number) => {
  if (s == null) return null;
  const v = String(s).trim();
  if (!v) return null;
  if (v.length > max) throw new HttpError(400, 'too_long', `${max}자 이하로 입력해 주세요.`);
  return v;
};
export function normalizeConditions(c: { size?: unknown; color?: unknown; maxPrice?: unknown; usedOk?: unknown }) {
  const size = clean(c.size, 20);
  const color = clean(c.color, 30);
  let maxPrice: number | null = null;
  if (c.maxPrice !== undefined && c.maxPrice !== null && String(c.maxPrice).trim() !== '') {
    maxPrice = Number(String(c.maxPrice).replace(/[^\d]/g, ''));
    if (!Number.isFinite(maxPrice) || maxPrice < 1000 || maxPrice > 100_000_000) throw new HttpError(400, 'bad_price', '희망가는 1,000원 이상으로 입력해 주세요.');
  }
  const usedOk = c.usedOk === undefined ? true : (c.usedOk === true || c.usedOk === 'true' || c.usedOk === '1' || c.usedOk === 1);
  return { size: size?.toUpperCase() ?? null, color, maxPrice, usedOk };
}

export function createRequest(db: DB, userId: number, input: NewRequest, opts: { isMock?: boolean } = {}) {
  const name = clean(input.productName, 120), brand = clean(input.brand, 60), note = clean(input.note, 500);
  let url = clean(input.productUrl, 1000);
  if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'bad_url', '링크는 http(s)로 시작해야 해요.');
  if (!name && !url && !input.photo) throw new HttpError(400, 'empty', '사진, 링크, 상품명 중 하나는 있어야 해요.');
  const c = normalizeConditions(input);
  return tx(db, () => {
    if (openRequestOf(db, userId)) throw new HttpError(409, 'active_exists', '진행 중인 의뢰가 있어요. 한 번에 한 벌만 맡길 수 있어요.');
    const t = now();
    const info = run(db, `INSERT INTO requests(user_id, status, product_name, brand, product_url, photo, note, size, color, max_price, used_ok, is_mock, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, userId, 'submitted', name, brand, url, input.photo || null, note, c.size, c.color, c.maxPrice, c.usedOk ? 1 : 0, opts.isMock ? 1 : 0, t, t);
    const id = Number(info.lastInsertRowid);
    const parts = [input.photo && '사진', url && '링크', name && '상품명'].filter(Boolean) as string[];
    log(db, id, 'user', 'submitted', '의뢰 접수', `${parts.join(' · ')}${eul(parts[parts.length - 1])} 맡겼어요`, { isMock: opts.isMock });
    return id;
  });
}

// ── 운영자: 식별 · 보완 요청 · 활성화 ───────────────────────────
export function requestInfo(db: DB, id: number, message: string, operator: string) {
  const r = getRequest(db, id);
  if (!['submitted', 'needs_info'].includes(r.status)) throw new HttpError(409, 'bad_state', '접수·보완 대기 상태에서만 요청할 수 있어요.');
  const msg = clean(message, 300);
  if (!msg) throw new HttpError(400, 'empty', '요청 내용을 적어 주세요.');
  tx(db, () => {
    run(db, 'UPDATE requests SET status=?, info_request=?, updated_at=? WHERE id=?', 'needs_info', msg, now(), id);
    log(db, id, 'team', 'needs_info', '정보 보완 요청', msg, { operator, isMock: !!r.is_mock });
  });
  notify(db, r, 'needs_info', '정보가 조금 더 필요해요', msg, `walf://request/${id}/info`);
}

export function submitInfo(db: DB, userId: number, id: number, input: { text?: string; productUrl?: string; photo?: string | null }) {
  const r = ownRequest(db, userId, id);
  if (r.status !== 'needs_info') throw new HttpError(409, 'bad_state');
  const text = clean(input.text, 500), url = clean(input.productUrl, 1000);
  if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'bad_url', '링크는 http(s)로 시작해야 해요.');
  if (!text && !url && !input.photo) throw new HttpError(400, 'empty', '보낼 정보를 하나 이상 넣어 주세요.');
  tx(db, () => {
    run(db, `UPDATE requests SET status='submitted', note=COALESCE(?, note), product_url=COALESCE(?, product_url), photo=COALESCE(?, photo), updated_at=? WHERE id=?`,
      text ? [r.note, text].filter(Boolean).join('\n') : null, url, input.photo || null, now(), id);
    const sent = [text && '설명', url && '링크', input.photo && '사진'].filter(Boolean) as string[];
    log(db, id, 'user', 'info', '정보 보완', `${sent.join(' · ')}${eul(sent[sent.length - 1])} 보냈어요`, { isMock: !!r.is_mock });
  });
}

export function activate(db: DB, id: number, data: { brand?: string; name?: string; note?: string }, operator: string, opts: { isMock?: boolean } = {}) {
  const r = getRequest(db, id);
  if (!['submitted', 'needs_info'].includes(r.status)) throw new HttpError(409, 'bad_state', '이미 시작했거나 끝난 의뢰예요.');
  const name = clean(data.name, 120) || r.product_name;
  if (!name) throw new HttpError(400, 'empty', '확인한 상품명을 적어 주세요.');
  const t = now();
  tx(db, () => {
    run(db, `UPDATE requests SET status='active', identified_brand=?, identified_name=?, identified_note=?, info_request=NULL,
      activated_at=?, expires_at=?, updated_at=? WHERE id=?`, clean(data.brand, 60) || r.brand, name, clean(data.note, 300), t, t + HUNT_MS, t, id);
    log(db, id, 'team', 'activated', '의뢰 시작', '상품 확인 완료 · 7일 탐색 시작', { operator, isMock: !!r.is_mock || !!opts.isMock, at: t });
    run(db, `UPDATE ai_identities SET status='passed' WHERE request_id=? AND status='proposed'`, id); // 남은 AI 제안은 고르지 않은 것으로
    ensureRuns(db, t, id);
  });
}

// ── 탐색 일정 ─────────────────────────────────────────────────
/** 활성 의뢰마다 1~7일차 탐색 작업을 시각이 되면 만든다(최대 7회). */
export function ensureRuns(db: DB, t = now(), onlyId?: number) {
  const reqs = onlyId ? all(db, `SELECT * FROM requests WHERE id=? AND status='active'`, onlyId) : all(db, `SELECT * FROM requests WHERE status='active'`);
  let created = 0;
  for (const r of reqs) {
    for (let d = 1; d <= 7; d++) {
      const at = r.activated_at + (d - 1) * DAY;
      if (at > t || at >= r.expires_at) break;
      const info = run(db, 'INSERT OR IGNORE INTO search_runs(request_id, day, scheduled_for, window_end, status, is_mock) VALUES (?,?,?,?,?,?)',
        r.id, d, at, Math.min(at + DAY, r.expires_at), 'pending', r.is_mock);
      created += Number(info.changes);
    }
  }
  return created;
}

/** 창(24시간) 안에 처리되지 않은 탐색은 '하지 못함'으로 남긴다 — 탐색한 것처럼 표시하지 않는다. */
export function markMissed(db: DB, t = now()) {
  const rows = all(db, `SELECT s.*, r.is_mock rm FROM search_runs s JOIN requests r ON r.id=s.request_id WHERE s.status='pending' AND s.window_end<=?`, t);
  for (const s of rows) {
    tx(db, () => {
      run(db, `UPDATE search_runs SET status='missed', completed_at=? WHERE id=?`, t, s.id);
      log(db, s.request_id, 'walf', 'missed', s.day === 1 ? '첫 탐색을 하지 못했어요' : '정기 탐색을 하지 못했어요', '예정된 시간 안에 판매처를 확인하지 못했어요', { isMock: !!s.rm, at: t });
    });
  }
  return rows.length;
}

export type CheckInput = { sellerId: number; status: 'checked' | 'unreachable' | 'skipped'; result?: 'none' | 'same' | 'similar'; note?: string };
export function completeRun(db: DB, runId: number, input: { checks: CheckInput[]; outcome: string; summary?: string; isMock?: boolean }, operator: string) {
  const s = one(db, 'SELECT * FROM search_runs WHERE id=?', runId);
  if (!s) throw new HttpError(404, 'not_found');
  if (s.status !== 'pending') throw new HttpError(409, 'bad_state', '이미 처리된 탐색이에요.');
  const r = getRequest(db, s.request_id);
  if (r.status !== 'active') throw new HttpError(409, 'bad_state', '진행 중인 의뢰가 아니에요.');
  if (!['no_match', 'leads', 'offer', 'nothing_new'].includes(input.outcome)) throw new HttpError(400, 'bad_outcome', '탐색 결과를 골라 주세요.');
  const active = all(db, 'SELECT id FROM sellers WHERE active=1').map(x => x.id);
  for (const id of active) {
    const c = input.checks.find(x => Number(x.sellerId) === id);
    if (!c || !['checked', 'unreachable', 'skipped'].includes(c.status)) throw new HttpError(400, 'missing_check', '모든 판매처의 확인 여부(확인함·접속 실패·확인 안 함)를 골라 주세요.');
    if (c.status === 'checked' && !['none', 'same', 'similar'].includes(c.result || 'none')) throw new HttpError(400, 'bad_result');
  }
  const checked = input.checks.filter(c => c.status === 'checked');
  if (!checked.length) throw new HttpError(400, 'no_checks', '실제로 확인한 판매처가 한 곳 이상 있어야 해요.');
  const unreachable = input.checks.filter(c => c.status === 'unreachable').length;
  const same = checked.filter(c => c.result === 'same').length;
  if ((input.outcome === 'offer' || input.outcome === 'leads') && !same) throw new HttpError(400, 'outcome_mismatch', '후보가 있다면 그 판매처 결과를 “동일 상품 있음”으로 골라 주세요.');
  const unreviewed = one(db, `SELECT COUNT(*) n FROM ai_finds WHERE run_id=? AND status='proposed'`, runId)!.n;
  if (unreviewed) throw new HttpError(409, 'ai_unreviewed', `AI가 찾은 매물 ${unreviewed}건을 먼저 검수해 주세요(후보로 등록하거나 제외).`);
  const isMock = !!input.isMock || !!r.is_mock;
  tx(db, () => {
    const ins = db.prepare('INSERT INTO seller_checks(run_id, seller_id, status, result, note) VALUES (?,?,?,?,?)');
    for (const c of input.checks) ins.run(runId, c.sellerId, c.status, c.status === 'checked' ? (c.result || 'none') : null, clean(c.note, 200));
    run(db, `UPDATE search_runs SET status='done', outcome=?, completed_at=?, operator=?, summary=?, is_mock=? WHERE id=?`,
      input.outcome, now(), operator, clean(input.summary, 300), isMock ? 1 : 0, runId);
    const parts = [`${checked.length}곳 확인`, same ? `동일 상품 ${same}건` : '새 매물 없음'];
    if (input.outcome === 'no_match' && same) parts.push('조건 불일치');
    if (unreachable) parts.push(`${unreachable}곳 접속 실패`);
    log(db, r.id, 'team', 'search', s.day === 1 ? '첫 탐색' : '정기 탐색', parts.join(' · '), { operator, isMock });
  });
  if (s.day === 1 && input.outcome === 'no_match' && !one(db, 'SELECT id FROM wanted WHERE request_id=?', r.id)) proposeWanted(db, r.id, operator, isMock);
}

// ── 공개 수배 ─────────────────────────────────────────────────
export const PUBLIC_FIELDS = ['photo', 'model', 'sizeColor', 'maxPrice'] as const;
export function proposeWanted(db: DB, id: number, operator: string, mock = false) {
  const r = getRequest(db, id);
  if (r.status !== 'active') throw new HttpError(409, 'bad_state');
  if (one(db, 'SELECT id FROM wanted WHERE request_id=?', id)) throw new HttpError(409, 'exists', '이미 수배 제안을 했어요.');
  const isMock = mock || !!r.is_mock;
  tx(db, () => {
    run(db, 'INSERT INTO wanted(request_id, status, proposed_at, is_mock) VALUES (?,?,?,?)', id, 'proposed', now(), isMock ? 1 : 0);
    log(db, id, 'team', 'wanted_proposed', '수배 제안', '조건에 맞는 매물이 없어 공개 수배를 제안했어요', { operator, isMock });
  });
  notify(db, r, 'consent', '수배지를 붙여볼까요?', '첫 탐색에서 조건에 맞는 매물을 찾지 못했어요. 공개 수배 여부를 정해 주세요.', `walf://request/${id}/wanted`, { isMock });
}

export function decideWanted(db: DB, userId: number, id: number, approve: boolean, fields?: Record<string, unknown>) {
  const r = ownRequest(db, userId, id);
  const w = one(db, 'SELECT * FROM wanted WHERE request_id=?', id);
  if (!w || w.status !== 'proposed') throw new HttpError(409, 'bad_state', '결정할 수배 제안이 없어요.');
  if (r.status !== 'active') throw new HttpError(409, 'bad_state');
  tx(db, () => {
    if (approve) {
      const pf: Record<string, boolean> = {};
      for (const k of PUBLIC_FIELDS) pf[k] = !!fields?.[k] && !(k === 'photo' && !r.photo);
      pf.model = true; // 브랜드·모델은 수배의 최소 정보
      run(db, `UPDATE wanted SET status='approved', public_fields=?, decided_at=? WHERE id=?`, JSON.stringify(pf), now(), w.id);
      const ins = db.prepare('INSERT INTO wanted_posts(wanted_id, channel, status, updated_at, is_mock) VALUES (?,?,?,?,?)');
      for (const ch of WANTED_CHANNELS) ins.run(w.id, ch, 'queued', now(), r.is_mock);
      log(db, id, 'user', 'wanted_approved', '수배 승인', '공개할 정보와 채널을 확인했어요', { isMock: !!r.is_mock });
    } else {
      run(db, `UPDATE wanted SET status='declined', decided_at=? WHERE id=?`, now(), w.id);
      log(db, id, 'user', 'wanted_declined', '수배 보류', '공개하지 않고 비공개로 계속 찾아요', { isMock: !!r.is_mock });
    }
  });
}

export function withdrawWanted(db: DB, userId: number | null, id: number, why = '사용자가 수배를 내렸어요') {
  const w = one(db, 'SELECT * FROM wanted WHERE request_id=?', id);
  if (!w || w.status !== 'approved') { if (userId !== null) throw new HttpError(409, 'bad_state', '내릴 수배가 없어요.'); return; }
  const r = getRequest(db, id);
  run(db, `UPDATE wanted SET status='withdrawn', withdrawn_at=? WHERE id=?`, now(), w.id);
  run(db, `UPDATE wanted_posts SET status='removal_requested', updated_at=? WHERE wanted_id=? AND status='posted'`, now(), w.id);
  run(db, `UPDATE wanted_posts SET status='cancelled', reason='게시 전 철회', updated_at=? WHERE wanted_id=? AND status='queued'`, now(), w.id);
  if (userId !== null) log(db, id, 'user', 'wanted_withdrawn', '수배 내리기 요청', '게시된 수배지는 왈프 팀이 삭제해요', { isMock: !!r.is_mock });
  else log(db, id, 'walf', 'wanted_withdrawn', '수배 종료', why, { isMock: !!r.is_mock });
}

const POST_NEXT: Record<string, string[]> = {
  queued: ['posted', 'skipped', 'rejected'],
  posted: ['rejected', 'removed', 'removal_requested'],
  removal_requested: ['removed'],
};
export function updatePost(db: DB, postId: number, input: { status: string; url?: string; reason?: string; isMock?: boolean }, operator: string) {
  const p = one(db, 'SELECT p.*, w.request_id FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id WHERE p.id=?', postId);
  if (!p) throw new HttpError(404, 'not_found');
  if (!(POST_NEXT[p.status] || []).includes(input.status)) throw new HttpError(409, 'bad_transition', `${p.status} → ${input.status} 변경은 할 수 없어요.`);
  const url = clean(input.url, 1000), reason = clean(input.reason, 200);
  if (input.status === 'posted' && (!url || !/^https?:\/\//.test(url))) throw new HttpError(400, 'need_url', '게시한 글의 주소가 있어야 게시 완료로 기록할 수 있어요.');
  if (['skipped', 'rejected'].includes(input.status) && !reason) throw new HttpError(400, 'need_reason', '게시하지 않은 사유를 적어 주세요.');
  const r = getRequest(db, p.request_id);
  const isMock = !!input.isMock || !!p.is_mock || !!r.is_mock;
  tx(db, () => {
    run(db, `UPDATE wanted_posts SET status=?, url=COALESCE(?, url), posted_at=CASE WHEN ?='posted' THEN ? ELSE posted_at END, reason=COALESCE(?, reason), updated_at=?, is_mock=? WHERE id=?`,
      input.status, url, input.status, now(), reason, now(), isMock ? 1 : 0, postId);
    const T: Record<string, [string, string]> = {
      posted: ['수배지 게시', p.channel], skipped: ['게시하지 않음', `${p.channel} · ${reason}`], rejected: ['게시 거절·삭제됨', `${p.channel} · ${reason}`],
      removed: ['수배지 삭제', p.channel], removal_requested: ['수배지 삭제 요청', p.channel],
    };
    log(db, r.id, 'team', 'wanted_' + input.status, T[input.status][0], T[input.status][1], { operator, isMock });
  });
}

// ── 후보 · 매물 ───────────────────────────────────────────────
export type CandInput = {
  source: 'search' | 'report'; seller: string; url?: string; title?: string; photo?: string | null; size?: string; colorOk?: boolean;
  price?: number | null; shipping?: number | null; condition?: 'new' | 'used'; conditionNote?: string;
  matchGrade: string; availability: string; evidence?: string[]; pending?: string[]; checkedAt?: number | null; runId?: number | null; isMock?: boolean;
};
const GRADES = ['same_confirmed', 'same_likely', 'similar', 'unknown'];
const AVAIL = ['purchasable', 'listed_unverified', 'option_mismatch', 'sold_out'];

export function saveCandidate(db: DB, requestId: number, input: CandInput, operator: string, candId?: number) {
  const r = getRequest(db, requestId);
  if (r.status !== 'active') throw new HttpError(409, 'bad_state', '진행 중인 의뢰의 후보만 등록·수정할 수 있어요.');
  if (!GRADES.includes(input.matchGrade) || !AVAIL.includes(input.availability)) throw new HttpError(400, 'bad_grade');
  if (!['search', 'report'].includes(input.source)) throw new HttpError(400, 'bad_source');
  const seller = clean(input.seller, 40);
  if (!seller) throw new HttpError(400, 'empty', '판매처를 적어 주세요.');
  const url = clean(input.url, 1000);
  if (url && !/^https?:\/\//.test(url)) throw new HttpError(400, 'bad_url');
  if (input.availability === 'purchasable' && input.matchGrade === 'same_confirmed' && !input.checkedAt) throw new HttpError(400, 'need_checked_at', '구매 가능 확인에는 확인 시각이 필요해요.');
  if (input.availability === 'purchasable' && input.matchGrade === 'same_confirmed' && (input.price == null || !Number.isFinite(input.price))) throw new HttpError(400, 'need_price', '구매 가능으로 확인하려면 판매가가 있어야 해요.');
  if ((input.price != null && (!Number.isFinite(input.price) || input.price < 0)) || (input.shipping != null && (!Number.isFinite(input.shipping) || input.shipping < 0))) throw new HttpError(400, 'bad_price');
  const prev = candId ? one(db, 'SELECT * FROM candidates WHERE id=? AND request_id=?', candId, requestId) : undefined;
  if (candId && !prev) throw new HttpError(404, 'not_found');
  const ev = JSON.stringify((input.evidence || []).map(s => s.trim()).filter(Boolean).slice(0, 6));
  const pd = JSON.stringify((input.pending || []).map(s => s.trim()).filter(Boolean).slice(0, 6));
  const t = now();
  const vals = [input.source, seller, url, clean(input.title, 160), input.size ? String(input.size).trim().toUpperCase() : null, input.colorOk === false ? 0 : 1,
    input.price ?? null, input.shipping ?? 0, input.condition || 'used', clean(input.conditionNote, 60), input.matchGrade, input.availability, ev, pd,
    input.checkedAt ?? null, (input.isMock || r.is_mock || prev?.is_mock) ? 1 : 0, t];
  if (prev) {
    run(db, `UPDATE candidates SET source=?, seller=?, url=?, title=?, size=?, color_ok=?, price=?, shipping=?, condition=?, condition_note=?, match_grade=?, availability=?,
      evidence=?, pending=?, checked_at=?, is_mock=?, updated_at=?, photo=COALESCE(?, photo), needs_recheck=0 WHERE id=?`, ...vals, input.photo || null, candId!);
    if (prev.published) afterPublish(db, candId!, operator, true);
    return candId!;
  }
  const info = run(db, `INSERT INTO candidates(source, seller, url, title, size, color_ok, price, shipping, condition, condition_note, match_grade, availability,
    evidence, pending, checked_at, is_mock, updated_at, photo, request_id, run_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ...vals, input.photo || null, requestId, input.runId ?? null, t);
  const id = Number(info.lastInsertRowid);
  if (input.source === 'report') log(db, requestId, 'team', 'report', '판매자 제보 접수', `${seller}${input.size ? ' · ' + input.size : ''} 매물을 알려왔어요 · 확인 중`, { operator, isMock: !!(input.isMock || r.is_mock) });
  return id;
}

export function classify(req: Row, c: Row) {
  const total = c.price != null ? c.price + (c.shipping || 0) : null;
  const sizeOk = !req.size || (!!c.size && c.size.toUpperCase() === String(req.size).toUpperCase());
  const priceKnown = total != null;
  const priceOk = !req.max_price || (priceKnown && total! <= req.max_price);
  const overBudget = !!req.max_price && priceKnown && total! > req.max_price;
  const usedOk = !!req.used_ok || c.condition === 'new';
  const colorOk = !!c.color_ok;
  const meets = sizeOk && priceOk && usedOk && colorOk;
  let kind: 'offer' | 'price_watch' | 'lead' | 'mismatch' | 'similar' | 'unknown';
  if (c.match_grade === 'similar') kind = 'similar';
  else if (c.match_grade === 'unknown') kind = 'unknown';
  else if (c.availability === 'sold_out' || c.availability === 'option_mismatch') kind = 'mismatch';
  else if (c.match_grade === 'same_confirmed' && c.availability === 'purchasable') {
    if (!priceKnown || c.needs_recheck) kind = sizeOk && usedOk && colorOk && !overBudget ? 'lead' : 'mismatch';
    else kind = meets ? 'offer' : (sizeOk && usedOk && colorOk && overBudget ? 'price_watch' : 'mismatch');
  }
  else kind = (sizeOk || !c.size) && usedOk && colorOk ? 'lead' : 'mismatch';
  const reasons: string[] = [];
  if (c.availability === 'sold_out') reasons.push('판매 종료·품절');
  if (c.availability === 'option_mismatch' || (c.size && !sizeOk)) reasons.push('원하는 사이즈가 아니에요');
  if (overBudget) reasons.push(`희망가보다 ${won(total! - req.max_price)} 높아요`);
  if (!usedOk) reasons.push('중고는 원하지 않으셨어요');
  if (!colorOk) reasons.push('색상이 달라요');
  return { kind, total, sizeOk, priceOk, priceKnown, overBudget, usedOk, colorOk, meets, reasons };
}

export function publishCandidate(db: DB, candId: number, operator: string, publish = true) {
  const c = one(db, 'SELECT * FROM candidates WHERE id=?', candId);
  if (!c) throw new HttpError(404, 'not_found');
  const r = getRequest(db, c.request_id);
  if (r.status !== 'active' && publish) throw new HttpError(409, 'bad_state', '진행 중인 의뢰에만 공개할 수 있어요.');
  if (publish && ['similar', 'unknown'].includes(c.match_grade)) throw new HttpError(409, 'not_publishable', '유사 상품·식별 불가는 MVP에서 사용자에게 보여주지 않아요.');
  run(db, 'UPDATE candidates SET published=?, published_at=CASE WHEN ?=1 THEN ? ELSE published_at END, updated_at=? WHERE id=?', publish ? 1 : 0, publish ? 1 : 0, now(), now(), candId);
  if (publish) afterPublish(db, candId, operator, false);
}

/** 공개된 후보의 판정이 바뀌면 일지·알림을 남긴다. 제보로 들어온 후보는 운영자 확인(구매 가능 확인) 전까지 알리지 않는다(PRD: 검증된 제보만 알림). */
function afterPublish(db: DB, candId: number, operator: string, isUpdate: boolean) {
  const c = one(db, 'SELECT * FROM candidates WHERE id=?', candId)!;
  const r = getRequest(db, c.request_id);
  if (r.status !== 'active') return;
  const k = classify(r, c);
  const outbox: (() => void)[] = [];
  const isMock = !!c.is_mock;
  const sz = c.size ? ` · ${c.size}` : '';
  const sent: string[] = (c.notified || '').split(',').filter(Boolean);
  if (k.kind === 'offer') {
    if (!sent.includes('offer')) {
      log(db, r.id, 'team', 'offer', '구매 가능 확인', `${c.seller}${sz} · 총 ${won(k.total)} · 판매 중 확인`, { operator, isMock });
      outbox.push(() => notify(db, r, 'offer', '왈프가 물어왔어요!', `${shortName(r)} ${c.size || ''} · 총 ${won(k.total)} · ${c.seller}에서 판매 중이에요(${kTime(c.checked_at)} 확인).`.replace(/\s+/g, ' '),
        `walf://candidate/${c.id}`, { candidateId: c.id, isMock }));
      sent.push('offer');
    }
  } else if (k.kind === 'lead') {
    if (!sent.includes('lead_log')) { log(db, r.id, 'team', 'lead', '유력 후보', `${c.seller}${sz} · 같은 옷인지 확인 중`, { operator, isMock }); sent.push('lead_log'); }
    if (c.source === 'search' && !k.overBudget && !c.needs_recheck && !sent.includes('lead')) {
      outbox.push(() => notify(db, r, 'lead', '왈프가 단서를 물어왔어요', `찾던 ${shortName(r)}와(과) 같은 옷일 수 있어요. 사이즈와 재고를 확인하고 있어요.`, `walf://candidate/${c.id}`, { candidateId: c.id, isMock }));
      sent.push('lead');
    }
  } else if (k.kind === 'price_watch') {
    if (!sent.includes('price_log')) { log(db, r.id, 'team', 'price_watch', '찾았지만 예산 초과', `${c.seller}${sz} · ${won(k.total)}`, { operator, isMock }); sent.push('price_log'); }
  } else if (k.kind === 'mismatch' && !isUpdate) {
    log(db, r.id, 'team', 'mismatch', '조건 불일치', `${c.seller}${sz} · ${k.reasons[0] || '조건이 달라요'}`, { operator, isMock });
  }
  run(db, 'UPDATE candidates SET notified=? WHERE id=?', sent.join(','), candId);
  outbox.forEach(f => f()); // 보낸 표시를 먼저 남기고 알림을 만든다 — 중복 알림 방지
}

export function dismissCandidate(db: DB, userId: number, candId: number) {
  const c = one(db, 'SELECT * FROM candidates WHERE id=?', candId);
  if (!c) throw new HttpError(404, 'not_found');
  const r = ownRequest(db, userId, c.request_id);
  if (!c.published) throw new HttpError(404, 'not_found');
  if (c.user_dismissed) return;
  if (r.status !== 'active') throw new HttpError(409, 'bad_state');
  run(db, 'UPDATE candidates SET user_dismissed=1, updated_at=? WHERE id=?', now(), candId);
  log(db, r.id, 'user', 'dismiss', '이 매물은 넘김', `${c.seller} · 계속 찾아요`, { isMock: !!c.is_mock });
}

// ── 종료 ──────────────────────────────────────────────────────
function closeOut(db: DB, r: Row, status: string, reason: string) {
  run(db, 'UPDATE requests SET status=?, ended_at=?, end_reason=?, updated_at=? WHERE id=?', status, now(), reason, now(), r.id);
  run(db, `UPDATE search_runs SET status='cancelled' WHERE request_id=? AND status='pending'`, r.id);
  run(db, `UPDATE wanted SET status='withdrawn', withdrawn_at=? WHERE request_id=? AND status='proposed'`, now(), r.id);
  withdrawWanted(db, null, r.id, status === 'expired' ? '7일 종료로 수배를 마쳤어요' : '의뢰가 끝나 수배를 마쳤어요');
}

export function confirmPurchase(db: DB, userId: number, id: number, candId?: number | null) {
  const r = ownRequest(db, userId, id);
  if (r.status !== 'active') throw new HttpError(409, 'bad_state');
  if (candId && !one(db, 'SELECT id FROM candidates WHERE id=? AND request_id=? AND published=1', candId, id)) throw new HttpError(400, 'bad_candidate');
  tx(db, () => {
    log(db, id, 'user', 'completed', '구매 완료', '찾던 옷을 구했어요 · 탐색과 수배를 멈춰요', { isMock: !!r.is_mock });
    closeOut(db, r, 'completed', candId ? `purchased:${candId}` : 'purchased');
  });
}
export function cancelRequest(db: DB, userId: number, id: number) {
  const r = ownRequest(db, userId, id);
  if (!OPEN_STATUSES.includes(r.status)) throw new HttpError(409, 'bad_state');
  tx(db, () => {
    log(db, id, 'user', 'cancelled', '의뢰 그만둠', '탐색을 멈추고 게시된 수배지 삭제를 요청했어요', { isMock: !!r.is_mock });
    closeOut(db, r, 'cancelled', 'user_cancelled');
  });
}
export function expireDue(db: DB, t = now(), opts: { onlyId?: number; isMock?: boolean } = {}) {
  const rows = opts.onlyId ? all(db, `SELECT * FROM requests WHERE id=? AND status='active' AND expires_at<=?`, opts.onlyId, t) : all(db, `SELECT * FROM requests WHERE status='active' AND expires_at<=?`, t);
  for (const r of rows) {
    const hadOffer = visibleCands(db, r).some(x => x.k.kind === 'offer');
    tx(db, () => {
      log(db, r.id, 'walf', 'expired', '7일 탐색 종료', '정기 탐색을 멈췄어요 · 기록은 남아 있어요', { isMock: !!r.is_mock, at: t });
      closeOut(db, r, 'expired', '168h');
    });
    notify(db, r, 'expired', '7일 탐색이 끝났어요', hadOffer ? '7일 동안 확인한 내용을 정리해뒀어요.' : '이번에는 빈 입으로 돌아왔어요. 7일 동안 확인한 내용을 정리해뒀어요.', `walf://request/${r.id}`, { isMock: opts.isMock });
  }
  return rows.length;
}
/** QA 도구 — 지금 7일 종료. 일지·알림 모두 모의로 남는다 */
export function expireNow(db: DB, id: number, operator: string) {
  const r = getRequest(db, id);
  if (r.status !== 'active') throw new HttpError(409, 'bad_state');
  const t = now();
  run(db, 'UPDATE requests SET expires_at=? WHERE id=?', t, id);
  log(db, id, 'system', 'qa', '운영 테스트: 종료 시각을 지금으로', `운영자 ${operator}가 QA를 위해 7일 종료를 앞당겼어요`, { operator, isMock: true, at: t });
  expireDue(db, t, { onlyId: id, isMock: true });
}
export function visibleCands(db: DB, r: Row) {
  return all(db, 'SELECT * FROM candidates WHERE request_id=? AND published=1 AND user_dismissed=0 ORDER BY COALESCE(checked_at, published_at) DESC', r.id).map(c => ({ c, k: classify(r, c) }));
}

export function updateConditions(db: DB, userId: number, id: number, input: Record<string, unknown>) {
  const r = ownRequest(db, userId, id);
  if (!OPEN_STATUSES.includes(r.status)) throw new HttpError(409, 'bad_state');
  const c = normalizeConditions(input);
  const diff: string[] = [];
  if ((r.size || null) !== c.size) diff.push(`사이즈 ${r.size || '없음'} → ${c.size || '없음'}`);
  if ((r.color || null) !== c.color) diff.push(`색상 ${r.color || '없음'} → ${c.color || '없음'}`);
  if ((r.max_price || null) !== c.maxPrice) diff.push(`희망가 ${r.max_price ? won(r.max_price) : '없음'} → ${c.maxPrice ? won(c.maxPrice) : '없음'}`);
  if (!!r.used_ok !== c.usedOk) diff.push(`중고 ${c.usedOk ? '괜찮아요' : '원하지 않아요'}`);
  if (!diff.length) return;
  const next = { ...r, size: c.size, color: c.color, max_price: c.maxPrice, used_ok: c.usedOk ? 1 : 0 };
  const flip = all(db, 'SELECT * FROM candidates WHERE request_id=? AND published=1 AND user_dismissed=0', id)
    .filter(x => classify(r, x).kind !== 'offer' && classify(next, x).kind === 'offer');
  tx(db, () => {
    run(db, 'UPDATE requests SET size=?, color=?, max_price=?, used_ok=?, updated_at=? WHERE id=?', c.size, c.color, c.maxPrice, c.usedOk ? 1 : 0, now(), id);
    flip.forEach(x => run(db, 'UPDATE candidates SET needs_recheck=1 WHERE id=?', x.id));
    log(db, id, 'user', 'conditions', '구매 조건 변경', diff.join(' · ') + ' · 다음 탐색부터 적용' + (flip.length ? ` · 이미 찾은 매물 ${flip.length}건은 왈프 팀이 새 조건으로 다시 확인해요` : ''), { isMock: !!r.is_mock });
  });
}

// ── 화면용 상태 계산(앱·어드민 공통) ───────────────────────────
export const shortName = (r: Row) => r.identified_name || r.product_name || (r.product_url ? '링크로 맡긴 옷' : '사진으로 맡긴 옷');
export function dayOf(r: Row, t = now()) {
  if (!r.activated_at) return 0;
  return Math.max(1, Math.min(7, Math.floor((Math.min(t, r.expires_at - 1) - r.activated_at) / DAY) + 1));
}
const dd = (n: number) => String(n).padStart(2, '0');

export type Display = { key: string; label: string; eyebrow: string; title: string; desc: string; action?: { label: string; target: string; primary?: boolean }; muted?: boolean; notice?: string; isMock?: boolean };

export function display(db: DB, r: Row, t = now()): Display {
  const day = dayOf(r, t);
  const L: Record<string, string> = STATE_LABEL;
  const d = (key: string, eyebrow: string, title: string, desc: string, extra: Partial<Display> = {}): Display => ({ key, label: L[key], eyebrow, title, desc, ...extra });
  if (r.status === 'submitted') {
    // 찾아줘 결과(운영자가 검수해 공개한 것)가 있으면 그 결과를 먼저 보여 준다
    const f = findTiers(db, r.id);
    if (f.match) return d('find_match', '찾아줘 결과 · 7일 시작 전', '같은 옷을 찾았어요', '브랜드·모델을 확인했어요. 맞는지 보고, 매물을 찾을지 가격을 기다릴지 골라 주세요.', { action: { label: '결과 보기', target: `find:${r.id}`, primary: true }, isMock: f.mock });
    if (f.likely) return d('find_likely', '찾아줘 결과 · 7일 시작 전', `이 옷일 가능성이 높아요`, `후보 ${f.likely}개를 골라 뒀어요. 확인되지 않은 부분도 함께 적었어요.`, { action: { label: '후보 보기', target: `find:${r.id}`, primary: true }, isMock: f.mock });
    if (f.discover) return d('find_discover', '찾아줘 결과 · 7일 시작 전', '같은 옷은 아직 못 찾았어요', '대신 비슷한 스타일을 골라 뒀어요. 같은 상품이라는 뜻은 아니에요.', { action: { label: '비슷한 옷 보기', target: `find:${r.id}`, primary: true }, isMock: f.mock });
    return d('identification_pending', '의뢰 접수 · 7일 시작 전', '어떤 옷인지 확인하고 있어요', '왈프 팀이 상품을 확인하면 7일 탐색이 시작돼요. 확인 전에는 기간이 흐르지 않아요.');
  }
  if (r.status === 'needs_info') return d('needs_info', '의뢰 접수 · 7일 시작 전', '정보가 조금 더 필요해요', r.info_request || '어떤 옷인지 확인할 정보를 더 보내주세요.', { action: { label: '정보 보내기', target: `info:${r.id}`, primary: true } });
  if (r.status === 'completed' && String(r.end_reason || '').startsWith('find_')) return d('find_done', `${kDate(r.ended_at)} · 찾아줘 완료`, '어떤 옷인지 찾았어요',
    r.end_reason === 'find_watch' ? '기다려줘에서 원하는 사이즈·가격을 지켜보고 있어요.' : '내가 찾는 옷에 저장했어요. 매물을 찾거나 가격을 기다리려면 새로 맡겨 주세요.', { muted: true, isMock: !!r.is_mock });
  if (r.status === 'completed') return d('completed', `${kDate(r.ended_at)} · 구매 확인`, '찾던 옷을 구했어요', '탐색과 수배를 멈췄어요. 게시된 수배지는 내리도록 요청했어요.', { muted: true });
  if (r.status === 'cancelled') return d('cancelled', `${kDate(r.ended_at)} · 그만둠`, '의뢰를 그만뒀어요', '탐색을 멈췄어요. 기록은 추적함에 남아 있어요.', { muted: true });
  const cands = visibleCands(db, r);
  if (r.status === 'expired') {
    const hadOffer = cands.some(x => x.k.kind === 'offer');
    return d('expired', `7일 종료 · ${kDate(r.ended_at)}`, hadOffer ? '7일 탐색이 끝났어요' : '이번에는 빈 입으로 돌아왔어요', '7일 동안 확인한 내용을 정리해뒀어요. 탐색은 멈췄어요.', { muted: true, action: { label: '결과 보기', target: `tracking:${r.id}` } });
  }
  // active — 마지막 탐색이 실패했으면 어떤 상태든 함께 알린다(실패 ≠ 매물 없음)
  const runs = all(db, 'SELECT * FROM search_runs WHERE request_id=? ORDER BY day', r.id);
  const lastClosed = [...runs].reverse().find(s => s.status === 'done' || s.status === 'missed');
  const failN = lastClosed?.status === 'done' ? one(db, `SELECT COUNT(*) n FROM seller_checks WHERE run_id=? AND status='unreachable'`, lastClosed.id)!.n : 0;
  const notice = lastClosed?.status === 'missed' ? `DAY ${dd(lastClosed.day)} 예정된 탐색을 하지 못했어요. 매물이 없다는 뜻은 아니에요.`
    : failN ? `최근 탐색에서 판매처 ${failN}곳에 접속하지 못했어요.` : undefined;
  const mk = (x: Display, mock: boolean, noNotice = false) => ({ ...x, ...(x.key !== 'paused_failed' && notice && !noNotice ? { notice } : {}), isMock: mock || !!r.is_mock });
  const offer = cands.find(x => x.k.kind === 'offer');
  if (offer) {
    const c = offer.c;
    return mk(d('offer_verified', `DAY ${dd(day)} · ${kWhen(c.checked_at, t)} 확인`, '조건에 맞는 매물을 찾았어요', `${c.seller} · ${c.size || '사이즈 미기재'} · 총 ${won(offer.k.total)}. 중고 매물은 먼저 팔릴 수 있어요.`, { action: { label: '확인하기', target: `candidate:${c.id}`, primary: true } }), !!c.is_mock);
  }
  const w = one(db, 'SELECT * FROM wanted WHERE request_id=?', r.id);
  if (w?.status === 'proposed') {
    const first = one(db, `SELECT s.*, (SELECT COUNT(*) FROM seller_checks k WHERE k.run_id=s.id AND k.status='checked') n,
      (SELECT COUNT(*) FROM seller_checks k WHERE k.run_id=s.id AND k.status='unreachable') u FROM search_runs s WHERE request_id=? AND day=1`, r.id);
    return mk(d('awaiting_consent', `DAY ${dd(day)} · 첫 탐색 결과`, '수배지를 붙여볼까요?',
      `${first?.n || ''}곳을 살폈지만 조건에 맞는 매물이 없었어요.${first?.u ? ` ${first.u}곳은 접속하지 못했어요.` : ''} 공개 여부는 직접 정해요.`.trim(), { action: { label: '수배지 미리보기', target: `wanted:${r.id}`, primary: true } }), !!w.is_mock || !!first?.is_mock, lastClosed?.id === first?.id); // 첫 탐색 실패는 설명 문장에 이미 있다
  }
  const lead = cands.find(x => x.k.kind === 'lead');
  if (lead) return mk(d('lead_found', `DAY ${dd(day)} · ${kWhen(lead.c.published_at, t)}`, '새로운 단서를 물어왔어요',
    lead.c.needs_recheck ? '구매 조건이 바뀌어 이미 찾은 매물을 왈프 팀이 새 조건으로 다시 확인하고 있어요.'
      : lead.c.source === 'report' ? '수배글을 본 판매자가 알려왔어요. 같은 옷인지, 지금 살 수 있는지 왈프 팀이 확인하고 있어요.' : '같은 옷일 가능성이 높아요. 왈프 팀이 사이즈와 재고를 확인하고 있어요.'), !!lead.c.is_mock);
  const pw = cands.find(x => x.k.kind === 'price_watch');
  if (pw) return mk(d('price_watch', `DAY ${dd(day)} · ${kWhen(pw.c.checked_at || pw.c.published_at, t)}`, '찾았지만 아직 예산보다 비싸요', `${pw.c.seller} ${pw.c.size || ''} ${won(pw.k.total)}. 희망가 이하로 내려오는지 계속 볼게요.`.replace(/\s+/g, ' ')), !!pw.c.is_mock);
  if (w?.status === 'approved') {
    const posts = all(db, 'SELECT * FROM wanted_posts WHERE wanted_id=?', w.id);
    const posted = posts.filter(p => p.status === 'posted');
    const queued = posts.filter(p => p.status === 'queued');
    const lastPost = posted.reduce((m, p) => Math.max(m, p.posted_at || 0), 0);
    if (!posted.length && queued.length) return mk(d('wanted_queued', `DAY ${dd(day)} · 승인 완료`, '수배지 게시를 준비하고 있어요', '게시가 끝나면 채널과 시각을 알려드릴게요. 아직 올라가지 않았어요.'), !!w.is_mock);
    if (posted.length && (!lastClosed || lastPost > (lastClosed.completed_at || 0))) {
      const skipped = posts.filter(p => ['skipped', 'rejected'].includes(p.status)).map(p => p.channel);
      return mk(d('wanted_published', `DAY ${dd(day)} · ${kWhen(lastPost, t)}`, '수배지를 붙이고 왔어요', `${posted.map(p => p.channel).join(' · ')}에 게시했어요.${skipped.length ? ` ${skipped.join(' · ')}에는 올리지 않았어요.` : ''}`), posted.some(p => p.is_mock));
    }
  }
  if (lastClosed?.status === 'missed') return mk(d('paused_failed', `DAY ${dd(lastClosed.day)} · 탐색 못 함`, '예정된 탐색을 하지 못했어요', '판매처를 확인하지 못했어요. 매물이 없다는 뜻은 아니에요. 다음 탐색에서 다시 살펴볼게요.'), false);
  if (lastClosed?.status === 'done' && failN) return mk(d('paused_failed', `DAY ${dd(lastClosed.day)} · ${kWhen(lastClosed.completed_at, t)}`, '이번 탐색을 다 하지 못했어요', `판매처 ${failN}곳에 접속하지 못했어요. 매물이 없다는 뜻은 아니에요. 다음 탐색에서 다시 시도해요.`), !!lastClosed.is_mock);
  if (!lastClosed) return mk(d('first_search_pending', `DAY 01 · ${kWhen(r.activated_at, t)} 시작`, '첫 탐색을 준비하고 있어요', '국내 판매처를 살펴보고 결과를 정리해 둘게요.'), false);
  const n = one(db, `SELECT COUNT(*) n FROM seller_checks WHERE run_id=? AND status='checked'`, lastClosed.id)!.n;
  const next = runs.find(s => s.status === 'pending');
  const nextAt = next ? next.scheduled_for : r.activated_at + lastClosed.day * DAY;
  const nextText = nextAt < r.expires_at ? (next ? '다음 탐색을 진행하고 있어요.' : `다음 탐색은 ${kRelDay(nextAt, t)} 예정이에요.`) : '남은 탐색이 없어요. 곧 7일이 끝나요.';
  return mk(d('searching', `DAY ${dd(day)} · ${kWhen(lastClosed.completed_at, t)}`, `${kRelDay(lastClosed.completed_at, t)} 판매처 ${n}곳을 살폈어요`, `조건에 맞는 매물은 아직 없어요. ${nextText}`), !!lastClosed.is_mock);
}

/** 사용자에게 공개된 찾아줘 결과 개수(MATCH·LIKELY·DISCOVER) */
export function findTiers(db: DB, requestId: number) {
  const rows = all(db, `SELECT tier, is_mock FROM product_identities WHERE request_id=? AND status='published'`, requestId);
  const n = (t: string) => rows.filter(x => x.tier === t).length;
  return { match: n('match'), likely: n('likely'), discover: n('discover'), mock: rows.some(x => x.is_mock) };
}

export const STATE_LABEL: Record<string, string> = {
  find_match: '같은 옷 찾음', find_likely: '유력 후보 발견', find_discover: '유사 제품 추천', find_done: '완료·종료',
  identification_pending: '제품 식별 중', needs_info: '정보 보완 대기', first_search_pending: '첫 탐색 준비', searching: '탐색 중',
  awaiting_consent: '수배 동의 대기', wanted_queued: '수배 게시 대기', wanted_published: '수배 게시 완료', lead_found: '유력 후보',
  offer_verified: '구매 가능 확인', price_watch: '가격 초과 관찰', paused_failed: '일부 실패', expired: '7일 종료', completed: '구매 완료', cancelled: '그만둠',
};

const TAG: Record<string, [string, string]> = {
  same_confirmed: ['v', '동일 상품 확인'], same_likely: ['o', '동일 상품 유력'], similar: ['x', '유사 상품'], unknown: ['x', '식별 불가'],
  purchasable: ['v', '구매 가능 확인'], listed_unverified: ['p', '재고 미확인'], option_mismatch: ['x', '옵션 불일치'], sold_out: ['x', '판매 종료'],
};

export function candidateView(db: DB, r: Row, c: Row, base = '') {
  const k = classify(r, c);
  const tags = [TAG[c.match_grade]];
  if (c.match_grade !== 'similar' && c.match_grade !== 'unknown') tags.push(k.kind === 'offer' ? TAG.purchasable : (c.availability === 'purchasable' ? ['x', k.priceOk ? '조건 불일치' : '희망가 초과'] : TAG[c.availability]));
  const verified = k.kind === 'offer';
  return {
    id: c.id, kind: k.kind, source: c.source, sourceLabel: c.source === 'report' ? '수배글을 본 판매자 제보' : '왈프 팀 탐색',
    seller: c.seller, url: c.url, title: c.title, photoUrl: c.photo ? `${base}/uploads/${c.photo}` : null,
    size: c.size, condition: c.condition, conditionLabel: c.condition === 'new' ? '새 상품' : `중고${c.condition_note ? ' · ' + c.condition_note : ''}`,
    price: c.price, shipping: c.shipping, total: k.total, priceLabel: c.price != null ? won(c.price) : '가격 미기재',
    totalLabel: k.total != null ? `배송비 ${won(c.shipping || 0)} · 총 ${won(k.total)}` : '',
    budgetLabel: r.max_price && k.total != null ? (k.total <= r.max_price ? `희망가 ${won(r.max_price)}보다 ${won(r.max_price - k.total)} 낮아요` : `희망가 ${won(r.max_price)}보다 ${won(k.total - r.max_price)} 높아요`) : '',
    tags: tags.map(([kind, text]) => ({ kind, text })),
    reasons: k.reasons, evidence: safeJson(c.evidence),
    pending: [...(c.needs_recheck ? ['새 조건으로 다시 확인 | 구매 조건이 바뀌어 왈프 팀이 다시 확인하고 있어요'] : []), ...(!k.priceKnown ? ['가격 | 판매가를 확인하고 있어요'] : []), ...safeJson(c.pending)],
    checks: [
      { label: '사이즈', value: c.size || '미기재', ok: k.sizeOk && !!(c.size || !r.size) },
      { label: '색상', value: r.color || '상관없음', ok: k.colorOk },
      { label: '가격', value: r.max_price ? (k.priceOk ? '희망가 이하' : '희망가 초과') : '희망가 없음', ok: k.priceOk },
      { label: '상태', value: c.condition === 'new' ? '새 상품' : `중고${c.condition_note ? ' · ' + c.condition_note : ''}`, ok: k.usedOk },
    ],
    checkedAt: c.checked_at, checkedLabel: c.checked_at ? `${kDate(c.checked_at)} ${kTime(c.checked_at)}` : null,
    publishedAt: c.published_at, publishedLabel: c.published_at ? `${kDate(c.published_at)} ${kTime(c.published_at)}` : null,
    headline: verified ? '왈프가 물어왔어요!' : '새로운 단서를 물어왔어요',
    sub: verified ? '침은 안 묻혔습니다.' : '같은 옷일 가능성이 높아요. 확인이 끝나면 바로 알려드릴게요.',
    ctaLabel: c.url ? `${c.seller}에서 보기` : null,
    dismissed: !!c.user_dismissed, isMock: !!c.is_mock,
  };
}
const safeJson = (s: string | null) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };

export function requestView(db: DB, r: Row, base = '', t = now()) {
  const runs = all(db, 'SELECT * FROM search_runs WHERE request_id=? ORDER BY day', r.id);
  const cands = all(db, 'SELECT * FROM candidates WHERE request_id=? AND published=1 ORDER BY COALESCE(checked_at, published_at) DESC', r.id);
  const views = cands.map(c => candidateView(db, r, c, base));
  const w = one(db, 'SELECT * FROM wanted WHERE request_id=?', r.id);
  const posts = w ? all(db, 'SELECT * FROM wanted_posts WHERE wanted_id=? ORDER BY id', w.id) : [];
  const lastDone = [...runs].reverse().find(s => s.status === 'done');
  const sellerChecks = lastDone ? all(db, `SELECT k.*, s.name FROM seller_checks k JOIN sellers s ON s.id=k.seller_id WHERE run_id=? ORDER BY s.sort`, lastDone.id) : [];
  const day = dayOf(r, t);
  const days = r.activated_at ? Array.from({ length: 7 }, (_, i) => {
    const at = r.activated_at + i * DAY; const s = runs.find(x => x.day === i + 1);
    const state = s?.status === 'done' ? 'done' : s?.status === 'missed' ? 'missed' : s?.status === 'cancelled' ? 'cancelled' : s ? 'pending' : 'upcoming';
    return { day: i + 1, date: kDayNum(at), state, today: r.status === 'active' && i + 1 === day };
  }) : [];
  const nextRun = runs.find(s => s.status === 'pending');
  const nextDay = runs.length < 7 ? r.activated_at + runs.length * DAY : null;
  const acts = all(db, 'SELECT * FROM activity WHERE request_id=? ORDER BY at DESC, id DESC', r.id).map(a => {
    const dIdx = r.activated_at && a.at >= r.activated_at ? Math.min(7, Math.floor((a.at - r.activated_at) / DAY) + 1) : 0;
    return { id: a.id, at: a.at, time: kTime(a.at).replace('오전 ', '').replace('오후 ', ''), clock: new Date(a.at + 9 * 3600e3).toISOString().slice(11, 16),
      group: dIdx ? `DAY ${dd(dIdx)} · ${kDate(a.at)}` : `접수 · ${kDate(a.at)}`, actor: ACTOR_LABEL[a.actor] || a.actor, kind: a.kind, title: a.title, detail: a.detail, isMock: !!a.is_mock };
  });
  return {
    id: r.id, status: r.status, isMock: !!r.is_mock, display: display(db, r, t),
    product: { name: r.product_name, brand: r.brand, url: r.product_url, note: r.note, photoUrl: r.photo ? `${base}/uploads/${r.photo}` : null,
      identifiedName: r.identified_name, identifiedBrand: r.identified_brand, title: shortName(r), brandLabel: r.identified_brand || r.brand || null },
    conditions: { size: r.size, color: r.color, maxPrice: r.max_price, usedOk: !!r.used_ok,
      label: [r.size, r.color, r.max_price ? `${Math.round(r.max_price / 10000 * 10) / 10}만원 이하` : null, r.used_ok ? '중고 OK' : '새 상품만'].filter(Boolean).join(' · ') },
    infoRequest: r.status === 'needs_info' ? r.info_request : null,
    schedule: {
      day, days, activatedAt: r.activated_at, expiresAt: r.expires_at,
      endsLabel: r.expires_at ? `${kDate(r.expires_at)} ${kTime(r.expires_at)} 종료` : null,
      startedLabel: r.activated_at ? `${kDate(r.activated_at)} 시작` : null,
      lastRun: lastDone ? { at: lastDone.completed_at, label: kWhen(lastDone.completed_at, t), checked: sellerChecks.filter(k => k.status === 'checked').length, isMock: !!lastDone.is_mock } : null,
      nextRunLabel: r.status !== 'active' ? null : nextRun ? '진행 중 · 왈프 팀 확인 중' : nextDay && nextDay < r.expires_at ? kRelDay(nextDay, t) : '남은 탐색 없음',
    },
    candidates: {
      offers: views.filter(v => v.kind === 'offer' && !v.dismissed), leads: views.filter(v => v.kind === 'lead' && !v.dismissed),
      priceWatch: views.filter(v => v.kind === 'price_watch' && !v.dismissed), mismatches: views.filter(v => v.kind === 'mismatch' || v.dismissed),
    },
    wanted: w ? { status: w.status, publicFields: safeJsonObj(w.public_fields), proposedAt: w.proposed_at, decidedAt: w.decided_at,
      posts: posts.map(p => ({ id: p.id, channel: p.channel, status: p.status, url: p.status === 'posted' ? p.url : null, postedLabel: p.posted_at ? `${kDate(p.posted_at)} ${kTime(p.posted_at)}` : null, reason: p.reason, isMock: !!p.is_mock })) } : null,
    sellers: lastDone ? { day: lastDone.day, label: `${kWhen(lastDone.completed_at, t)} 기준`, isMock: !!lastDone.is_mock,
      items: sellerChecks.map(k => ({ name: k.name, status: k.status, text: k.status === 'unreachable' ? '접속하지 못함' : k.status === 'skipped' ? '이번엔 확인 안 함' : k.result === 'same' ? (k.note || '동일 상품 있음') : k.result === 'similar' ? (k.note || '비슷한 상품만 있음') : (k.note || '매물 없음') })) } : null,
    activity: acts,
    createdLabel: kWhen(r.created_at, t), endedLabel: r.ended_at ? kWhen(r.ended_at, t) : null, endReason: r.end_reason,
  };
}
const safeJsonObj = (s: string | null) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

// ── 스케줄러 한 번 ────────────────────────────────────────────
export function tick(db: DB, t = now()) {
  return { runs: ensureRuns(db, t), missed: markMissed(db, t), expired: expireDue(db, t) };
}
