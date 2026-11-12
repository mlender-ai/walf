// AI 작업 순서 — 접수되면 AI가 먼저 상품을 식별하고, 7일 탐색이 시작되면 그날의 국내 판매처 탐색을 먼저 한다.
// 왈프 팀은 그 제안을 검수(채택·수정·제외)한다. AI 결과는 검수 전까지 사용자에게 보이지 않는다.
import crypto from 'node:crypto';
import path from 'node:path';
import { type DB, tx } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { now } from './time.ts';
import { type AiProvider, type Usage, aiErrorText, urlKey } from './ai.ts';
import { canStart, estimateUsd, limitsFromEnv, type Limits } from './cost.ts';
import { saveRequestStyle } from './catalog.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
const json = (v: unknown) => JSON.stringify(v);
export const CONF_LABEL: Record<string, string> = { high: '높음', medium: '보통', low: '낮음' };
/** 확정할 때 쓰는 상품명 — 모델명에 색상이 없으면 붙인다 */
export const identityLabel = (x: Row) => x.color && !String(x.name).includes(x.color) ? `${x.name} ${x.color}` : x.name;

function addJob(db: DB, provider: AiProvider, r: Row, kind: 'identify' | 'search', runId: number | null, by: string | null) {
  run(db, `INSERT INTO ai_jobs(request_id, run_id, kind, status, provider, requested_by, is_mock, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    r.id, runId, kind, 'queued', provider.kind, by, provider.kind === 'mock' || r.is_mock ? 1 : 0, now());
}

/** 할 일 만들기: 접수(또는 보완) 뒤 식별을 아직 안 했으면 식별, 진행 중인 탐색에 AI 탐색이 없으면 탐색. 몇 번 불러도 같다. */
export function ensureAiJobs(db: DB, provider: AiProvider) {
  let n = 0;
  for (const r of all(db, `SELECT * FROM requests WHERE status='submitted'`)) {
    const input = one(db, `SELECT MAX(at) t FROM activity WHERE request_id=? AND kind IN ('submitted','info')`, r.id)?.t ?? r.created_at;
    const last = one(db, `SELECT MAX(created_at) t FROM ai_jobs WHERE request_id=? AND kind='identify'`, r.id)?.t;
    if (last == null || last < input) { addJob(db, provider, r, 'identify', null, null); n++; }
  }
  for (const s of all(db, `SELECT s.id run_id, r.* FROM search_runs s JOIN requests r ON r.id=s.request_id
      WHERE s.status='pending' AND r.status='active' AND NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.run_id=s.id)`)) {
    addJob(db, provider, s, 'search', s.run_id, null); n++;
  }
  return n;
}

/**
 * 서버가 꺼지며 끊긴 작업. 아직 API를 부르기 전(attempts=0)이거나 모의 작업이면 다시 대기열로.
 * 이미 유료 API를 불렀을 수 있는 작업은 자동으로 다시 돌리지 않는다(중복 과금 방지) — 어드민에서 “다시 실행”한다.
 */
export function recoverAiJobs(db: DB) {
  run(db, `UPDATE ai_jobs SET status='interrupted', finished_at=?, error='서버가 다시 켜지며 중단됐어요. 이미 API를 불렀을 수 있어 자동으로 다시 실행하지 않아요(중복 과금 방지).'
    WHERE status='running' AND attempts>0 AND provider<>'mock' AND is_mock=0`, now());
  return Number(run(db, `UPDATE ai_jobs SET status='queued', started_at=NULL WHERE status='running'`).changes);
}

/** 운영자가 다시 실행 */
export function rerunAi(db: DB, provider: AiProvider | null, requestId: number, kind: 'identify' | 'search', operator: string) {
  if (!provider) throw new HttpError(409, 'ai_off', 'AI가 연결되어 있지 않아요. server/.env 에 ANTHROPIC_API_KEY 를 넣고 서버를 다시 켜세요.');
  const r = D.getRequest(db, requestId);
  if (one(db, `SELECT id FROM ai_jobs WHERE request_id=? AND kind=? AND status IN ('queued','running')`, requestId, kind)) throw new HttpError(409, 'ai_busy', '이미 AI가 살펴보고 있어요.');
  if (one(db, `SELECT id FROM ai_jobs WHERE request_id=? AND kind=? AND status='held'`, requestId, kind)) throw new HttpError(409, 'ai_held', '예산·호출 상한 때문에 멈춘 AI 작업이 있어요. 어드민 비용 화면에서 먼저 확인하세요.');
  if (kind === 'identify') {
    if (r.status !== 'submitted') throw new HttpError(409, 'bad_state', '상품 확인 대기 중인 의뢰만 다시 식별할 수 있어요.');
    addJob(db, provider, r, 'identify', null, operator);
  } else {
    const s = one(db, `SELECT * FROM search_runs WHERE request_id=? AND status='pending' ORDER BY day DESC LIMIT 1`, requestId);
    if (r.status !== 'active' || !s) throw new HttpError(409, 'bad_state', '진행 중인 탐색이 있어야 AI 탐색을 다시 할 수 있어요.');
    addJob(db, provider, r, 'search', s.id, operator);
  }
}

function finish(db: DB, jobId: number, status: string, fields: { summary?: string | null; detail?: unknown; error?: string | null; usage?: Usage; reusedFrom?: number }) {
  const est = fields.usage ? (fields.usage.model === 'mock' ? 0 : estimateUsd(fields.usage)) : null;
  run(db, `UPDATE ai_jobs SET status=?, summary=?, detail=?, error=?, model=COALESCE(?, model), input_tokens=?, output_tokens=?, searches=?, est_cost_usd=?, reused_from=?, finished_at=? WHERE id=?`,
    status, fields.summary ?? null, fields.detail === undefined ? null : json(fields.detail), fields.error ?? null, fields.usage?.model ?? null,
    fields.usage?.inputTokens ?? null, fields.usage?.outputTokens ?? null, fields.usage?.searches ?? null, est, fields.reusedFrom ?? null, now(), jobId);
}

/** 같은 조건의 국내 탐색인지 가르는 열쇠 — 하루 안에 같은 열쇠의 검색 결과가 있으면 다시 부르지 않고 쓴다 */
export function searchKey(i: { brand: string; name: string; color?: string | null; size?: string | null; maxPrice?: number | null; usedOk: boolean; sellers: { domain: string }[] }) {
  const n = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(json([n(i.brand), n(i.name), n(i.color), n(i.size), i.maxPrice ?? null, i.usedOk, i.sellers.map(s => s.domain).sort()])).digest('hex').slice(0, 32);
}
const REUSE_MS = 20 * 3600_000;

/** 대기열에서 하나를 꺼내 실행한다. 한 번에 하나씩만. 유료 작업은 시작 전에 예산·의뢰별 상한을 확인한다 */
export function createAiWorker(db: DB, provider: AiProvider, uploads: string, limits: Limits = limitsFromEnv()) {
  let busy = false, timer: NodeJS.Timeout | null = null;
  async function step(): Promise<number | null> {
    if (busy) return null;
    busy = true;
    try {
      const j = one(db, `SELECT * FROM ai_jobs WHERE status='queued' ORDER BY id LIMIT 1`);
      if (!j) return null;
      const r = one(db, 'SELECT * FROM requests WHERE id=?', j.request_id);
      const s = j.run_id ? one(db, 'SELECT * FROM search_runs WHERE id=?', j.run_id) : undefined;
      // 그사이 운영자가 먼저 처리했거나 의뢰가 끝났으면 하지 않는다
      if (!r || (j.kind === 'identify' && r.status !== 'submitted') || (j.kind === 'search' && (r.status !== 'active' || s?.status !== 'pending'))) {
        finish(db, j.id, 'cancelled', { summary: '의뢰 상태가 바뀌어 실행하지 않았어요' });
        return j.id;
      }
      const gate = canStart(db, j, limits);
      if (!gate.ok) {
        run(db, `UPDATE ai_jobs SET status='held', error=? WHERE id=?`, gate.reason, j.id);
        console.warn(`AI ${j.kind} #${j.id} 보류 · 의뢰 #${j.request_id} · ${gate.reason}`);
        return j.id;
      }
      // 이 줄 이후로는 API를 불렀을 수 있다 — attempts 로 표시해 재시작 때 자동으로 다시 돌리지 않는다
      run(db, `UPDATE ai_jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?`, now(), j.id);
      try {
        if (j.kind === 'identify') {
          const out = await provider.identify({ productName: r.product_name, brand: r.brand, productUrl: r.product_url, note: r.note, size: r.size, color: r.color, photoPath: r.photo ? path.join(uploads, r.photo) : null });
          saveIdentify(db, j, r, out.data, out.usage);
        } else {
          const sellers = all(db, 'SELECT id, name, domain FROM sellers WHERE active=1 ORDER BY sort') as any[];
          const known = [...all(db, 'SELECT url FROM candidates WHERE request_id=? AND url IS NOT NULL', r.id), ...all(db, `SELECT url FROM ai_finds WHERE request_id=? AND url IS NOT NULL AND url<>''`, r.id)].map(x => x.url);
          const input = { brand: r.identified_brand || r.brand || '', name: r.identified_name || r.product_name || '', color: r.color, size: r.size, maxPrice: r.max_price, usedOk: !!r.used_ok, day: s!.day, sellers, known };
          const key = searchKey(input);
          run(db, 'UPDATE ai_jobs SET dedupe_key=? WHERE id=?', key, j.id);
          const prev = one(db, `SELECT * FROM ai_jobs WHERE kind='search' AND status='done' AND dedupe_key=? AND id<>? AND is_mock=? AND finished_at>? ORDER BY id DESC LIMIT 1`, key, j.id, j.is_mock, now() - REUSE_MS);
          if (prev) reuseSearch(db, j, r, s!, sellers, known, prev);
          else {
            const out = await provider.search(input);
            saveSearch(db, j, r, s!, sellers, known, out.data, out.usage);
          }
        }
      } catch (e) {
        finish(db, j.id, 'failed', { error: aiErrorText(e) });
        console.warn(`AI ${j.kind} #${j.id} 실패 · 의뢰 #${j.request_id} · ${aiErrorText(e)}`);
      }
      return j.id;
    } finally { busy = false; }
  }
  return {
    step,
    start(ms: number) { timer = setInterval(() => { ensureAiJobs(db, provider); step().catch(e => console.error('AI 작업 오류', e)); }, ms); },
    stop() { if (timer) clearInterval(timer); },
  };
}

function saveIdentify(db: DB, j: Row, r: Row, data: import('./ai.ts').IdentifyResult, usage: Usage) {
  const mock = !!j.is_mock;
  tx(db, () => {
    const ins = db.prepare('INSERT INTO ai_identities(job_id, request_id, rank, brand, name, color, category, confidence, reasons, refs, season, model_code, matched, uncertain, is_mock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    data.identities.forEach((x, i) => ins.run(j.id, r.id, i + 1, x.brand || null, x.name, x.color || null, x.category || null, x.confidence, json(x.reasons), json(x.refs),
      x.season || null, x.code || null, json(x.matched || []), json(x.uncertain || []), mock ? 1 : 0));
    finish(db, j.id, 'done', { summary: data.summary || null, detail: { missing: data.missing, style: data.style || {} }, usage });
    saveRequestStyle(db, r.id, data.style || {}, mock ? 'fixture' : 'ai');
    // 사용자 일지에는 “왈프가 먼저 살펴봤고, 팀이 확인 중”이라는 사실만 남긴다(후보 내용은 검수 전이라 보이지 않는다)
    const parts = [r.photo && '사진', r.product_url && '링크', r.product_name && '상품명'].filter(Boolean) as string[];
    D.log(db, r.id, 'walf', 'ai_identify', '왈프가 먼저 살펴봤어요', data.identities.length
      ? `맡긴 ${parts.join(' · ')}${D.eul(parts[parts.length - 1] || '옷')} 보고 어떤 상품인지 후보를 추렸어요 · 왈프 팀이 확인하고 있어요`
      : '어떤 옷인지 아직 좁히지 못했어요 · 왈프 팀이 직접 확인하고 있어요', { isMock: mock });
  });
}

function saveSearch(db: DB, j: Row, r: Row, s: Row, sellers: Row[], known: string[], data: import('./ai.ts').SearchResult, usage: Usage) {
  const mock = !!j.is_mock;
  const sid = new Map(sellers.map(x => [x.name, x.id]));
  const knownKeys = new Set(known.map(urlKey));
  let dup = 0;
  tx(db, () => {
    const ins = db.prepare(`INSERT INTO ai_finds(job_id, request_id, run_id, seller_id, url, url_seen, title, price, size, condition, match_guess, stock_guess, reason, is_mock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const x of data.listings) {
      if (x.url && knownKeys.has(urlKey(x.url))) { dup++; continue; }
      if (x.url) knownKeys.add(urlKey(x.url));
      ins.run(j.id, r.id, s.id, sid.get(x.seller) ?? null, x.url || null, x.urlSeen == null ? null : x.urlSeen ? 1 : 0, x.title || null, x.price, x.size ? x.size.toUpperCase() : null,
        x.condition, x.match, x.stock, x.reason || null, mock ? 1 : 0);
    }
    const added = data.listings.length - dup;
    finish(db, j.id, 'done', { summary: data.summary || null, usage,
      detail: { sellers: data.sellers.map(n => ({ ...n, sellerId: sid.get(n.seller) })), dropped: data.dropped, duplicates: dup, blocked: data.blocked, added } });
    const searched = data.sellers.filter(n => n.searched).length;
    D.log(db, r.id, 'walf', 'ai_search', '국내 판매처를 먼저 살펴봤어요', searched
      ? `${searched}곳을 검색했어요 · 결과는 왈프 팀이 확인한 뒤 알려 드려요`
      : '이번에는 판매처를 검색하지 못했어요 · 왈프 팀이 직접 확인해요', { isMock: mock });
  });
}

/** 하루 안에 같은 조건으로 검색한 결과를 이 의뢰에 다시 쓴다(추가 비용 없음). 이미 아는 주소는 뺀다 */
function reuseSearch(db: DB, j: Row, r: Row, s: Row, sellers: Row[], known: string[], prev: Row) {
  const knownKeys = new Set(known.map(urlKey));
  const src = all(db, 'SELECT * FROM ai_finds WHERE job_id=?', prev.id).filter(f => !f.url || !knownKeys.has(urlKey(f.url)));
  const mock = !!j.is_mock;
  tx(db, () => {
    const ins = db.prepare(`INSERT INTO ai_finds(job_id, request_id, run_id, seller_id, url, url_seen, title, price, size, condition, match_guess, stock_guess, reason, is_mock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const f of src) ins.run(j.id, r.id, s.id, f.seller_id, f.url, f.url_seen, f.title, f.price, f.size, f.condition, f.match_guess, f.stock_guess, f.reason, mock ? 1 : 0);
    const detail = (() => { try { return JSON.parse(prev.detail || '{}'); } catch { return {}; } })();
    finish(db, j.id, 'done', { summary: `같은 조건으로 ${Math.round((now() - prev.finished_at) / 3600_000)}시간 전에 검색한 결과를 다시 썼어요(추가 비용 없음)`, reusedFrom: prev.id,
      usage: { model: prev.model || 'reuse', inputTokens: 0, outputTokens: 0, searches: 0 }, detail: { ...detail, added: src.length, duplicates: 0, reusedFrom: prev.id } });
    run(db, 'UPDATE ai_jobs SET est_cost_usd=0 WHERE id=?', j.id);
    const searched = (detail.sellers || []).filter((n: any) => n.searched).length;
    D.log(db, r.id, 'walf', 'ai_search', '국내 판매처를 먼저 살펴봤어요', searched ? `${searched}곳을 검색했어요 · 결과는 왈프 팀이 확인한 뒤 알려 드려요` : '이번에는 판매처를 검색하지 못했어요 · 왈프 팀이 직접 확인해요', { isMock: mock });
  });
}

// ── 운영자 검수 ──────────────────────────────────────────────
/** AI가 제안한 상품을 (고쳐 쓰고) 확정 → 7일 탐색 시작 */
export function acceptIdentity(db: DB, identityId: number, edits: { brand?: string; name?: string; note?: string }, operator: string) {
  const it = one(db, 'SELECT * FROM ai_identities WHERE id=?', identityId);
  if (!it) throw new HttpError(404, 'not_found');
  if (it.status !== 'proposed') throw new HttpError(409, 'bad_state', '이미 처리한 AI 제안이에요.');
  const label = identityLabel(it);
  const edited = (edits.name?.trim() && edits.name.trim() !== label) || (edits.brand != null && edits.brand.trim() !== (it.brand || ''));
  D.activate(db, it.request_id, {
    brand: edits.brand ?? it.brand, name: edits.name?.trim() || label,
    note: edits.note?.trim() || `AI 제안 ${it.rank}순위${edited ? '를 고쳐' : ''} 채택 · 신뢰도 ${CONF_LABEL[it.confidence]}`,
  }, operator, { isMock: !!it.is_mock });
  run(db, `UPDATE ai_identities SET status='accepted' WHERE id=?`, identityId);
}

export type FindDecision = { matchGrade: string; availability: string; title?: string; size?: string; price?: number | null; shipping?: number | null; condition?: 'new' | 'used'; conditionNote?: string;
  colorOk?: boolean; evidence?: string[]; pending?: string[]; checkedAt?: number | null; publish?: boolean; isMock?: boolean };

/** AI가 찾은 매물을 운영자가 확인한 값으로 후보에 올린다(기본은 비공개) */
export function acceptFind(db: DB, findId: number, input: FindDecision, operator: string) {
  const f = one(db, 'SELECT f.*, s.name seller FROM ai_finds f LEFT JOIN sellers s ON s.id=f.seller_id WHERE f.id=?', findId);
  if (!f) throw new HttpError(404, 'not_found');
  if (f.status !== 'proposed') throw new HttpError(409, 'bad_state', '이미 검수한 매물이에요.');
  if (input.publish && ['similar', 'unknown'].includes(input.matchGrade)) throw new HttpError(409, 'not_publishable', '유사 상품·식별 불가는 MVP에서 사용자에게 공개하지 않아요. 공개 체크를 빼고 저장하세요.');
  const cid = D.saveCandidate(db, f.request_id, {
    source: 'search', seller: f.seller || '판매처 미상', url: f.url || undefined, title: input.title ?? f.title, size: input.size ?? f.size, colorOk: input.colorOk,
    price: input.price === undefined ? f.price : input.price, shipping: input.shipping ?? 0, condition: input.condition || (f.condition === 'new' ? 'new' : 'used'),
    conditionNote: input.conditionNote, matchGrade: input.matchGrade, availability: input.availability, evidence: input.evidence, pending: input.pending,
    checkedAt: input.checkedAt ?? null, runId: f.run_id, isMock: !!f.is_mock || !!input.isMock,
  }, operator);
  run(db, `UPDATE ai_finds SET status='accepted', candidate_id=?, decided_by=?, decided_at=? WHERE id=?`, cid, operator, now(), findId);
  if (input.publish) D.publishCandidate(db, cid, operator);
  return cid;
}

export function rejectFind(db: DB, findId: number, reason: string, operator: string) {
  const f = one(db, 'SELECT * FROM ai_finds WHERE id=?', findId);
  if (!f) throw new HttpError(404, 'not_found');
  if (f.status !== 'proposed') throw new HttpError(409, 'bad_state', '이미 검수한 매물이에요.');
  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw new HttpError(400, 'need_reason', '제외 사유를 골라 주세요.');
  run(db, `UPDATE ai_finds SET status='rejected', reject_reason=?, decided_by=?, decided_at=? WHERE id=?`, why, operator, now(), findId);
}

// ── 어드민 화면용 ─────────────────────────────────────────────
const parse = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export function aiView(db: DB, requestId: number) {
  const identify = one(db, `SELECT * FROM ai_jobs WHERE request_id=? AND kind='identify' ORDER BY id DESC LIMIT 1`, requestId);
  const lastDone = one(db, `SELECT * FROM ai_jobs WHERE request_id=? AND kind='identify' AND status='done' ORDER BY id DESC LIMIT 1`, requestId);
  const identities = lastDone ? all(db, 'SELECT * FROM ai_identities WHERE job_id=? ORDER BY rank', lastDone.id).map(x => ({ ...x, reasons: parse(x.reasons, []), refs: parse(x.refs, []) })) : [];
  const searchOf = (runId: number) => {
    const j = one(db, `SELECT * FROM ai_jobs WHERE run_id=? ORDER BY id DESC LIMIT 1`, runId);
    return j ? { ...j, detail: parse(j.detail, {}) } : undefined;
  };
  const finds = all(db, `SELECT f.*, s.name seller, sr.day FROM ai_finds f LEFT JOIN sellers s ON s.id=f.seller_id LEFT JOIN search_runs sr ON sr.id=f.run_id WHERE f.request_id=? ORDER BY f.status='proposed' DESC, f.id DESC`, requestId);
  return { identify: identify ? { ...identify, detail: parse(identify.detail, {}) } : undefined, identifyDone: lastDone ? { ...lastDone, detail: parse(lastDone.detail, {}) } : undefined, identities, searchOf, finds };
}
