// 찾아줘(FIND) 결과 — AI 식별 제안을 MATCH(같은 옷 확인) · LIKELY(유력 후보) · DISCOVER(비슷한 옷)로 나누고,
// 운영자가 검수해 공개한 것만 사용자에게 보인다. DISCOVER 공개는 “같은 상품”이 아니라는 별도 정책이고, 구매 가능 확정과도 다르다.
import { type DB, tx } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { now, kWhen } from './time.ts';
import { curate, requestStyle, styleWords, upsertProduct, type Curated } from './catalog.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const parse = (s: string | null, d: any = []) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const json = (v: unknown) => JSON.stringify(v);

export type Tier = 'match' | 'likely' | 'hidden';
const CORE = /^(브랜드|모델|상품명|brand|model)\s*[:：]/i;
/**
 * 서버 규칙으로 등급을 정한다(모델이 말한 등급을 그대로 믿지 않는다).
 * MATCH: 신뢰도 높음 + 브랜드·모델 있음 + 확인한 근거 주소 1개 이상 + 브랜드·모델이 “확인 못 함”에 없음.
 * LIKELY: 그 밖의 높음·보통. 낮음은 사용자에게 보이지 않는다(운영자만 본다).
 */
export function tierOf(x: { confidence: string; brand?: string | null; name?: string | null; refs?: string[]; uncertain?: string[] }): Tier {
  if (x.confidence === 'low' || !x.name) return 'hidden';
  const coreUnsure = (x.uncertain || []).some(u => CORE.test(u));
  if (x.confidence === 'high' && x.brand && (x.refs || []).length > 0 && !coreUnsure) return 'match';
  return 'likely';
}

/** 운영자 검수 화면용 초안: 마지막 AI 식별 결과 + (MATCH가 없을 때) 스타일 큐레이션 후보 */
export function findDraft(db: DB, requestId: number) {
  const job = one(db, `SELECT * FROM ai_jobs WHERE request_id=? AND kind='identify' AND status='done' ORDER BY id DESC LIMIT 1`, requestId);
  const ids = job ? all(db, 'SELECT * FROM ai_identities WHERE job_id=? ORDER BY rank', job.id).map(x => {
    const v = { ...x, reasons: parse(x.reasons), refs: parse(x.refs), matched: parse(x.matched), uncertain: parse(x.uncertain) };
    return { ...v, tier: tierOf(v) };
  }) : [];
  const style = requestStyle(db, requestId);
  const hasMatch = ids.some(x => x.tier === 'match');
  const discover: Curated[] = hasMatch ? [] : curate(db, style, { exclude: ids.map(x => x.brand).filter(Boolean), limit: 3, statuses: ['verified', 'sourced', 'fixture'] });
  const published = all(db, `SELECT * FROM product_identities WHERE request_id=? AND status IN ('published','confirmed','rejected') ORDER BY id DESC`, requestId);
  return { job, identities: ids, style, styleWords: styleWords(style), discover, published, isMock: !!job?.is_mock };
}

export type PublishInput = {
  items: { aiIdentityId: number; tier: 'match' | 'likely' | 'skip'; brand?: string; name?: string }[];
  discover: { brandKey: string; scope?: string }[];
};
/** 운영자가 고른 결과를 사용자에게 공개한다. 이전에 공개한 결과는 내린다 */
export function publishFind(db: DB, requestId: number, input: PublishInput, operator: string) {
  const r = D.getRequest(db, requestId);
  if (r.status !== 'submitted') throw new HttpError(409, 'bad_state', '상품 확인 대기 중인 의뢰만 결과를 공개할 수 있어요.');
  const draft = findDraft(db, requestId);
  const items = input.items.filter(x => x.tier !== 'skip');
  if (items.filter(x => x.tier === 'match').length > 1) throw new HttpError(400, 'too_many_match', 'MATCH(같은 옷 확인)는 하나만 고를 수 있어요.');
  if (items.length > 3) throw new HttpError(400, 'too_many', '후보는 3개까지 공개할 수 있어요.');
  const hasMatch = items.some(x => x.tier === 'match');
  const disc = hasMatch ? [] : input.discover.slice(0, 3).map(d => draft.discover.find(c => c.brandKey === d.brandKey && (d.scope ?? '') === c.scope)).filter(Boolean) as Curated[];
  if (!items.length && !disc.length) throw new HttpError(400, 'empty', '공개할 결과를 하나 이상 골라 주세요.');
  const t = now();
  const mock = draft.isMock || !!r.is_mock;
  tx(db, () => {
    db.prepare(`UPDATE product_identities SET status='withdrawn', decided_at=? WHERE request_id=? AND status='published'`).run(t, requestId);
    const ins = db.prepare(`INSERT INTO product_identities(request_id, ai_identity_id, tier, rank, brand, name, model_code, season, color, category, matched, uncertain, evidence, reasons, status, published_by, is_mock, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    items.forEach((x, i) => {
      const a = draft.identities.find(v => v.id === Number(x.aiIdentityId));
      if (!a) throw new HttpError(400, 'bad_identity', '이 의뢰의 AI 제안이 아니에요.');
      // MATCH 는 근거 주소가 있어야 한다 — 확인하지 않은 것을 확인했다고 보여 주지 않는다
      if (x.tier === 'match' && !a.refs.length) throw new HttpError(400, 'match_needs_evidence', 'MATCH로 공개하려면 확인한 근거 주소가 있어야 해요. LIKELY로 공개하세요.');
      ins.run(requestId, a.id, x.tier, i + 1, (x.brand ?? a.brand) || null, (x.name || '').trim() || a.name, a.model_code || null, a.season || null, a.color || null, a.category || null,
        json(a.matched), json(a.uncertain), json(a.refs), json(a.reasons), 'published', operator, mock ? 1 : 0, t);
    });
    disc.forEach((c, i) => ins.run(requestId, null, 'discover', i + 1, c.brand, c.scope ? `${c.brand} ${c.scope}` : c.brand, null, null, null, null,
      json(c.reasons), json([]), json(c.sources), json([`스타일 근거: ${c.status === 'verified' ? '왈프 팀 확인' : c.status === 'fixture' ? '테스트 데이터' : '출처 있음 · 검수 전'}`]), 'published', operator, mock ? 1 : 0, t));
    D.log(db, requestId, 'team', 'find_ready', '찾아줘 결과', hasMatch ? '같은 옷을 확인했어요 · 결과를 확인해 주세요' : items.length ? `유력 후보 ${items.length}개를 골랐어요` : '같은 옷은 못 찾았어요 · 비슷한 스타일을 골랐어요', { operator, isMock: mock });
  });
  D.notify(db, r, 'find_ready', hasMatch ? '같은 옷을 찾았어요' : items.length ? '이 옷일 가능성이 높아요' : '비슷한 옷을 골라봤어요',
    hasMatch ? '맞는지 확인하고, 매물을 찾을지 가격을 기다릴지 골라 주세요.' : items.length ? '후보를 확인해 주세요. 확인되지 않은 부분도 함께 적었어요.' : '같은 상품은 아직 못 찾았어요. 대신 비슷한 스타일을 골라 뒀어요.',
    `walf://find/${requestId}`, { isMock: mock, dedupeKey: `find:${requestId}:${t}` });
}

/** 앱 화면용 — 공개된 결과만 */
export function findView(db: DB, r: Row) {
  const rows = all(db, `SELECT * FROM product_identities WHERE request_id=? AND status IN ('published','confirmed') ORDER BY tier, rank`, r.id);
  const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
  const item = (x: Row) => ({
    id: x.id, tier: x.tier, brand: x.brand, name: x.name, modelCode: x.model_code, season: x.season, color: x.color, category: x.category,
    matched: parse(x.matched).map(splitAttr), uncertain: parse(x.uncertain).map(splitAttr), evidence: parse(x.evidence).map((u: string) => ({ url: u, host: host(u) })),
    note: parse(x.reasons)[0] || null, confirmed: x.status === 'confirmed', isMock: !!x.is_mock,
  });
  const confirmed = rows.find(x => x.status === 'confirmed');
  const style = styleWords(requestStyle(db, r.id));
  return {
    requestId: r.id, status: r.status, state: confirmed ? 'confirmed' : rows.length ? 'ready' : 'pending',
    publishedLabel: rows[0] ? kWhen(rows[0].created_at) : null,
    match: rows.filter(x => x.tier === 'match').map(item)[0] || null,
    likely: rows.filter(x => x.tier === 'likely').map(item),
    discover: rows.filter(x => x.tier === 'discover').map(item),
    styleWords: style, productId: r.product_id ?? null, canHunt: r.status === 'submitted', isMock: rows.some(x => x.is_mock) || !!r.is_mock,
  };
}
const splitAttr = (s: string) => { const m = s.match(/^([^:：]{1,12})\s*[:：]\s*(.+)$/); return m ? { label: m[1].trim(), text: m[2].trim() } : { label: '', text: s }; };

/**
 * 사용자가 “이 옷이 맞아요”: 상품으로 저장한다. next=hunt 면 7일 탐색을 시작한다(운영자가 이미 검수해 공개한 결과라서).
 * MATCH 만 상품을 “확인됨”으로 저장한다. LIKELY 를 고르면 사용자 확인일 뿐 확인된 상품은 아니다.
 */
export function confirmFind(db: DB, userId: number, requestId: number, identityId: number, next: 'hunt' | 'watch' | 'save') {
  const r = D.ownRequest(db, userId, requestId);
  const x = one(db, `SELECT * FROM product_identities WHERE id=? AND request_id=? AND status='published'`, identityId, requestId);
  if (!x || x.tier === 'discover') throw new HttpError(400, 'bad_identity', '확인할 수 있는 결과가 아니에요.');
  if (next === 'hunt' && r.status !== 'submitted') throw new HttpError(409, 'bad_state', '이미 시작했거나 끝난 의뢰예요.');
  const t = now();
  let productId = 0;
  tx(db, () => {
    productId = upsertProduct(db, { brand: x.brand, name: x.name, modelCode: x.model_code, season: x.season, color: x.color || r.color, category: x.category,
      url: parse(x.evidence)[0] || null, verified: x.tier === 'match', source: x.tier === 'match' ? 'operator' : 'user', isMock: !!x.is_mock || !!r.is_mock });
    db.prepare(`UPDATE product_identities SET status='confirmed', product_id=?, decided_at=? WHERE id=?`).run(productId, t, x.id);
    db.prepare(`UPDATE requests SET product_id=?, updated_at=? WHERE id=?`).run(productId, t, requestId);
    D.log(db, requestId, 'user', 'find_confirmed', '이 옷이 맞아요', `${[x.brand, x.name].filter(Boolean).join(' ')}${x.tier === 'likely' ? ' · 유력 후보를 골랐어요' : ''}`, { isMock: !!x.is_mock || !!r.is_mock });
    // 7일 매물 탐색을 고르지 않으면 찾아줘는 여기서 끝난다(식별 완료). 기다려줘는 따로 이어진다
    if (next !== 'hunt' && r.status === 'submitted') {
      db.prepare(`UPDATE requests SET status='completed', ended_at=?, end_reason=?, updated_at=? WHERE id=?`).run(t, `find_${next}`, t, requestId);
      db.prepare(`UPDATE ai_identities SET status='passed' WHERE request_id=? AND status='proposed'`).run(requestId);
      D.log(db, requestId, 'walf', 'find_done', '찾아줘 완료', next === 'watch' ? '기다려줘에서 원하는 가격을 지켜봐요' : '내가 찾는 옷에 저장했어요', { isMock: !!x.is_mock || !!r.is_mock });
    }
  });
  // activate 는 자체 트랜잭션을 쓴다 — 위 저장이 끝난 뒤 부른다
  if (next === 'hunt') D.activate(db, requestId, { brand: x.brand, name: x.name, note: `찾아줘 결과(${x.tier === 'match' ? 'MATCH' : 'LIKELY'}) · 왈프 팀 ${x.published_by} 검수 · 사용자 확인` }, x.published_by || '왈프 팀', { isMock: !!x.is_mock });
  return { productId };
}

/** 사용자가 “찾던 옷이 아니에요” — 결과를 거두고 왈프 팀이 다시 확인한다(7일은 시작하지 않는다) */
export function rejectFind(db: DB, userId: number, requestId: number, reason?: string) {
  const r = D.ownRequest(db, userId, requestId);
  if (r.status !== 'submitted') throw new HttpError(409, 'bad_state');
  const n = Number(db.prepare(`UPDATE product_identities SET status='rejected', decided_at=? WHERE request_id=? AND status='published' AND tier<>'discover'`).run(now(), requestId).changes);
  if (!n) throw new HttpError(409, 'bad_state', '다시 볼 결과가 없어요.');
  D.log(db, requestId, 'user', 'find_rejected', '찾던 옷이 아니에요', String(reason || '').trim().slice(0, 200) || '왈프 팀이 다시 확인해요', { isMock: !!r.is_mock });
}

/** 어드민 대기열: 사용자가 아니라고 한 의뢰 */
export function rejectedQueue(db: DB) {
  return all(db, `SELECT r.*, MAX(p.decided_at) rejected_at FROM product_identities p JOIN requests r ON r.id=p.request_id
    WHERE p.status='rejected' AND r.status='submitted' AND NOT EXISTS (SELECT 1 FROM product_identities q WHERE q.request_id=r.id AND q.status='published' AND q.id>p.id)
    GROUP BY r.id ORDER BY rejected_at`);
}
