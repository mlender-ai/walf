// 기다려줘 화면의 두 번째·세 번째 부분 — 새 매물 탐색(Listing Discovery)과 기다리는 동안 볼 대체 상품.
// 상품 페이지 가격 감시(Price Watch)는 watch.ts 그대로다. 여기 결과는 가격 감시 상태·알림에 섞이지 않는다.
// 사용자에게는 운영자가 검수해 공개한 것만 보인다. 지원하지 않는 판매처는 “찾지 않는 곳”으로 이유와 함께 보여 준다.
import { type DB } from './db.ts';
import { HttpError } from './domain.ts';
import * as S from './findsearch.ts';
import { card, wantOfWatch, watchFit, type OfferCard } from './offerreview.ts';
import { currentSimilar, offerOf } from './offers.ts';
import { feedbackMap, priorityOptions, recordSignal, savedSet } from './feedback.ts';
import { now, kWhen } from './time.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
const parse = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export type DiscoverySource = { id: string; label: string; status: string; usable: boolean; selected: boolean; reason: string; paid: boolean;
  /** 사용자에게 보여 줄 쉬운 설명(조항·내부 사정은 reason 에 — 어드민용) */ note: string };
const noteOf = (status: string, usable: boolean, paid: boolean, isMock: boolean, reason: string) => usable ? '찾아볼 수 있어요'
  : reason === '이 기다려줘에서 끈 판매처예요' ? '꺼 두었어요'
  : status === 'UNSUPPORTED' ? '이용약관상 자동으로 찾을 수 없어요 · 필요하면 왈프 팀이 직접 확인해요'
  : status === 'PENDING_INTEGRATION' ? '약관·연동을 확인하고 있어요'
  : status === 'PENDING_EXTERNAL_SETUP' ? (paid ? '유료 기능이라 아직 쓰지 않아요' : '연결을 준비하고 있어요')
  : isMock ? '테스트 기다려줘라 실제 판매처는 열지 않아요' : /공식몰/.test(reason) ? '이 브랜드 공식몰은 아직 등록 전이에요' : '지금은 찾아볼 수 없어요';
/** meetsTarget: 원하는 조건이 모두 확인됨(확인 못 한 값이 있으면 false) · targetNote: 맞지 않거나 확인하지 못한 조건 한 줄 */
export type DiscoveryCard = OfferCard & { isNew: boolean; meetsTarget: boolean; targetNote: string | null };

/** 이 기다려줘에서 찾아볼 수 있는 곳 — 사용자가 켜고 끌 수 있는 곳(usable)과 찾지 않는 곳(이유) */
export function discoverySources(db: DB, e: S.SearchEnv, w: Row): DiscoverySource[] {
  const t = S.watchTargetOf(db, w, e.malls);
  const picked = parse(w.discovery_sources ?? null, null) as string[] | null;
  const ctx = { isMock: !!w.is_mock, mockAllowed: e.mockAllowed, env: e.env, malls: e.malls, pace: e.pace };
  return e.sources.map(x => {
    const a = t ? x.availability(t, ctx) : { status: 'SUPPORTED', usable: false, reason: '상품 이름을 몰라 찾을 수 없어요' };
    return { id: x.id, label: x.label, status: a.status, usable: a.usable, selected: a.usable && (!picked || picked.includes(x.id)), reason: a.reason, paid: x.cost === 'paid',
      note: noteOf(a.status, a.usable, x.cost === 'paid', !!w.is_mock, a.reason) };
  }).filter(x => x.id !== 'mock' || w.is_mock);  // 실제 기다려줘에는 테스트 판매처를 보여 주지 않는다
}

/** 사용자 설정: 새 판매처 찾기 켜기/끄기 · 찾아볼 곳 고르기(쓸 수 있는 곳만). 바꾸면 다음 확인 때 반영 */
export function updateDiscovery(db: DB, userId: number, watchId: number, patch: { discovery?: unknown; discoverySources?: unknown }, e: S.SearchEnv) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', watchId);
  if (!w || w.user_id !== userId) throw new HttpError(404, 'not_found');
  if (w.status === 'ended') throw new HttpError(409, 'bad_state', '끝난 기다려줘는 바꿀 수 없어요.');
  const t = now();
  const diff: string[] = [];
  if (patch.discovery !== undefined) {
    const on = patch.discovery === true || patch.discovery === 'true' || patch.discovery === 1;
    if (on !== !!w.discovery) { run(db, 'UPDATE watches SET discovery=?, next_discovery_at=NULL, updated_at=? WHERE id=?', on ? 1 : 0, t, w.id); diff.push(on ? '새 판매처도 찾아봐요' : '새 판매처 찾기를 껐어요'); }
  }
  if (patch.discoverySources !== undefined) {
    if (!Array.isArray(patch.discoverySources)) throw new HttpError(400, 'bad_sources', '찾아볼 곳을 골라 주세요.');
    const usable = discoverySources(db, e, w).filter(x => x.usable).map(x => x.id);
    const ids = [...new Set(patch.discoverySources.map(String))];
    const bad = ids.filter(x => !usable.includes(x));
    if (bad.length) throw new HttpError(400, 'unsupported_source', '지금 찾아볼 수 없는 곳이 들어 있어요. 지원하지 않거나 연동을 기다리는 판매처는 고를 수 없어요.');
    run(db, 'UPDATE watches SET discovery_sources=?, next_discovery_at=NULL, updated_at=? WHERE id=?', JSON.stringify(ids), t, w.id);
    const labels = discoverySources(db, e, { ...w, discovery_sources: JSON.stringify(ids) }).filter(x => x.selected).map(x => x.label);
    diff.push(labels.length ? `찾아볼 곳: ${labels.join(' · ')}` : '찾아볼 곳을 모두 껐어요');
  }
  if (diff.length) run(db, 'INSERT INTO watch_events(watch_id, actor, kind, title, detail, is_mock, at) VALUES (?,?,?,?,?,?,?)', w.id, 'user', 'discovery_settings', '새 판매처 찾기 설정', diff.join(' · '), w.is_mock, t);
}

/** 기다려줘 화면: 새 판매처(검수 후 공개분) · 기다리는 동안 볼 대체 상품 · 저장 표시 */
export function watchExtrasView(db: DB, w: Row, base: string, e: S.SearchEnv, userId: number, t = now()) {
  const saved = savedSet(db, userId, w.id);
  const rows = all(db, `SELECT * FROM offers WHERE watch_id=? AND published=1 AND ${currentSimilar('watch_id')} ORDER BY CASE publish_tier WHEN 'exact' THEN 0 WHEN 'possible' THEN 1 ELSE 2 END, search_id DESC, rank`, w.id).map(offerOf);
  const last = one(db, `SELECT * FROM offer_searches WHERE watch_id=? AND purpose='discovery' ORDER BY id DESC LIMIT 1`, w.id);
  const lastDone = one(db, `SELECT * FROM offer_searches WHERE watch_id=? AND purpose='discovery' AND status='done' ORDER BY id DESC LIMIT 1`, w.id);
  // “새로 찾음”: 마지막 탐색에서 이 기다려줘가 처음 본 페이지
  const isNew = (id: number) => !!lastDone && !!one(db, `SELECT 1 FROM offers o WHERE o.id=? AND o.search_id=? AND NOT EXISTS (SELECT 1 FROM offers p WHERE p.watch_id=o.watch_id AND p.url_key=o.url_key AND p.id<o.id)`, id, lastDone.id);
  const items: DiscoveryCard[] = rows.filter(o => o.relation === 'same').map(o => {
    const f = watchFit(o, w);
    return { ...card(o, wantOfWatch(w), base), isNew: isNew(o.id), meetsTarget: f.state === 'met',
      targetNote: f.state === 'unmet' ? `조건과 달라요 · ${f.unmet[0]}` : f.state === 'unknown' ? `확인하지 못한 조건 · ${f.unknown[0]}` : null };
  });
  const sources = discoverySources(db, e, w);
  // 실제 판매처가 몇 곳뿐인지 숨기지 않는다(테스트 기다려줘는 가상의 판매처만)
  const tg = S.watchTargetOf(db, w, e.malls);
  const realSel = sources.filter(x => x.selected && x.id !== 'mock').map(x => x.id === 'official' ? `${tg?.brand || '브랜드'} 공식몰` : x.id === 'naver_shopping' ? '네이버 쇼핑' : x.label);
  const coverageNote = w.is_mock ? '테스트 판매처(가상의 상점·가격)에서만 찾아요. 실제 판매처 결과가 아니에요.'
    : realSel.length ? `지금 자동으로 찾아보는 실제 판매처는 ${realSel.join('·')} ${realSel.length}곳${realSel.length === 1 ? '뿐' : ''}이에요.` : '지금 자동으로 찾아볼 수 있는 실제 판매처가 없어요.';
  const pendingCands = lastDone ? all(db, `SELECT * FROM offers WHERE search_id=? AND review_state='pending'`, lastDone.id).map(offerOf).filter(o => S.discoveryCandidate(o, w)).length : 0;
  const state = !w.discovery ? 'off' : items.length ? 'ready' : !sources.some(x => x.selected) ? 'unavailable' : !last ? 'not_started'
    : ['queued', 'running'].includes(last.status) ? 'searching' : last.status === 'failed' ? 'failed' : pendingCands ? 'reviewing' : 'none';
  const searched = parse(lastDone?.report ?? null, []).filter((x: any) => x.outcome !== 'not_run').map((x: any) => x.label);
  const fb = feedbackMap(db, userId, rows.filter(o => o.relation === 'similar').map(o => o.id));
  const alts = rows.filter(o => o.relation === 'similar').map(o => ({ ...card(o, wantOfWatch(w), base), saved: saved.has(o.id), feedback: fb.get(o.id) ?? null }));
  const simLast = one(db, `SELECT * FROM offer_searches WHERE watch_id=? AND purpose='similar' ORDER BY id DESC LIMIT 1`, w.id);
  const simPending = simLast?.status === 'done' && !!one(db, `SELECT 1 FROM offers WHERE search_id=? AND review_state='pending'`, simLast.id);
  return {
    discovery: {
      enabled: !!w.discovery, state, items,
      lastLabel: lastDone?.finished_at ? kWhen(lastDone.finished_at, t) : null,
      nextLabel: w.discovery && w.next_discovery_at && ['active', 'needs_info'].includes(w.status) ? (w.next_discovery_at <= t ? '곧 확인' : kWhen(w.next_discovery_at, t)) : null,
      searchedSources: searched, sources, coverageNote,
      note: '번개장터·무신사 등은 약관·제휴 확인 전이라 자동으로 찾지 않아요. 찾은 곳은 왈프 팀이 같은 상품인지 확인한 뒤 보여 드려요.',
    },
    alternatives: {
      available: !!w.request_id, state: alts.length ? 'ready' : simLast && ['queued', 'running'].includes(simLast.status) ? 'searching' : simPending ? 'reviewing' : simLast ? 'none' : 'not_started',
      items: alts, note: '저장하거나 열어 봐도 기다려줘는 그대로 계속돼요.',
      priority: w.priority ?? null, priorities: priorityOptions(w.priority),
    },
  };
}

/** 사용자가 공개된 대체 상품·판매처를 저장/해제 — 자기 기다려줘·찾아줘의 공개 후보만. 기다려줘 상태는 바꾸지 않는다 */
export function saveOffer(db: DB, userId: number, offerId: number, on: boolean) {
  const o = one(db, 'SELECT * FROM offers WHERE id=? AND published=1', offerId);
  const owner = o?.watch_id ? one(db, 'SELECT user_id FROM watches WHERE id=?', o.watch_id)?.user_id : o?.request_id ? one(db, 'SELECT user_id FROM requests WHERE id=?', o.request_id)?.user_id : null;
  if (!o || owner !== userId) throw new HttpError(404, 'not_found');
  const changed = on ? Number(run(db, 'INSERT OR IGNORE INTO offer_saves(user_id, offer_id, created_at) VALUES (?,?,?)', userId, o.id, now()).changes)
    : Number(run(db, 'DELETE FROM offer_saves WHERE user_id=? AND offer_id=?', userId, o.id).changes);
  if (changed) recordSignal(db, userId, o.id, on ? 'save' : 'unsave'); // 행동 기록(만족으로 치지 않는다)
  return { saved: on };
}
