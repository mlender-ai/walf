// 판매 예정(아카이브 재발매·한정 판매) 일정 — 판매처·브랜드가 공식으로 발표한 시작 시각만 운영자가 등록한다.
// 일정 알림과 재고 알림은 다르다: 시작 시각이 되면 “판매가 시작됐어요(재고·가격은 확인 중)”만 알리고, 조건에 맞는 재고 알림은 평소 가격 확인 결과로 따로 보낸다.
// 시작 시각에 한 번 더 확인하는 것은 그 페이지가 허용 목록에 있을 때만이다(판매처 요청 제한을 지키려고 반복 조회하지 않는다).
import { type DB, tx } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { logReview } from './reviewlog.ts';
import { sourceFor, urlKey } from './sources.ts';
import { kWhen, now, HOUR } from './time.ts';
import type { WatchPolicy } from './watch.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
const isHttp = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

export type NewRelease = { seller: string; url?: string | null; startsAt: number; announcedUrl: string; note?: string | null };

/** 운영자: 공식 발표로 확인한 판매 시작 일정을 기다려줘에 붙인다. 사용자에게는 “판매 예정”으로만 알린다(구매 가능이라고 하지 않는다) */
export function addRelease(db: DB, watchId: number, x: NewRelease, operator: string, t = now()) {
  const w = one(db, 'SELECT * FROM watches WHERE id=?', watchId);
  if (!w) throw new HttpError(404, 'not_found');
  if (w.status === 'ended') throw new HttpError(409, 'bad_state', '끝난 기다려줘에는 일정을 붙일 수 없어요.');
  const seller = String(x.seller ?? '').trim().slice(0, 60);
  if (!seller) throw new HttpError(400, 'no_seller', '판매처를 적어 주세요.');
  const announced = String(x.announcedUrl ?? '').trim();
  if (!isHttp(announced)) throw new HttpError(400, 'no_announcement', '판매처·브랜드의 공식 발표 주소(근거)를 넣어 주세요. 추측한 일정은 등록하지 않아요.');
  const url = String(x.url ?? '').trim() || null;
  if (url && !isHttp(url)) throw new HttpError(400, 'bad_url', '판매 페이지 주소는 http(s)로 시작해야 해요.');
  const startsAt = Number(x.startsAt);
  if (!Number.isFinite(startsAt) || startsAt < t - HOUR) throw new HttpError(400, 'bad_time', '판매 시작 시각을 확인해 주세요(이미 지난 일정은 등록하지 않아요).');
  const note = String(x.note ?? '').trim().slice(0, 200) || null;
  return tx(db, () => {
    const id = Number(run(db, `INSERT INTO release_schedules(watch_id, product_id, seller, url, starts_at, announced_url, note, status, created_by, is_mock, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      w.id, w.product_id ?? null, seller, url, startsAt, announced, note, 'scheduled', operator, w.is_mock, t).lastInsertRowid);
    run(db, 'INSERT INTO watch_events(watch_id, actor, kind, title, detail, is_mock, at) VALUES (?,?,?,?,?,?,?)', w.id, 'team', 'release', '판매 예정 일정을 확인했어요', `${seller} · ${kWhen(startsAt)} 시작(공식 발표 기준)`, w.is_mock, t);
    D.notifyUser(db, w.user_id, { kind: 'watch_release_scheduled', title: '판매 예정 일정이 있어요', body: `${w.title} · ${seller}에서 ${kWhen(startsAt)}에 판매를 시작한다고 발표했어요. 재고·가격은 시작 후 확인해 알려 드려요.`,
      link: `walf://watch/${w.id}`, watchId: w.id, isMock: !!w.is_mock, dedupeKey: `watch:${w.id}:release:${id}:scheduled` });
    logReview(db, { operator, subject: 'release', subjectId: id, watchId: w.id, action: 'schedule', before: null, after: { seller, url, startsAt, announced }, isMock: !!w.is_mock, at: t });
    return id;
  });
}

export function cancelRelease(db: DB, id: number, operator: string, reason: string, t = now()) {
  const r = one(db, 'SELECT * FROM release_schedules WHERE id=?', id);
  if (!r) throw new HttpError(404, 'not_found');
  if (r.status !== 'scheduled') throw new HttpError(409, 'bad_state', '이미 시작했거나 취소한 일정이에요.');
  tx(db, () => {
    run(db, `UPDATE release_schedules SET status='cancelled' WHERE id=?`, id);
    logReview(db, { operator, subject: 'release', subjectId: id, watchId: r.watch_id, action: 'cancel', before: { status: r.status }, after: { status: 'cancelled' }, reason, isMock: !!r.is_mock, at: t });
  });
}

/**
 * 시작 시각이 된 일정: “판매 시작”만 알리고(재고 알림 아님), 기다려줘 페이지가 허용 목록에 있으면 그때 한 번 가격·재고를 확인하도록 줄 세운다.
 * 하루 1회 조회와 겹치지 않게 일정마다 따로 한 번(slot=release:{id})이다.
 */
export function tickReleases(db: DB, policy: WatchPolicy, t = now()) {
  let started = 0, queued = 0;
  for (const r of all(db, `SELECT * FROM release_schedules WHERE status='scheduled' AND starts_at<=?`, t)) {
    const w = one(db, 'SELECT * FROM watches WHERE id=?', r.watch_id);
    tx(db, () => {
      run(db, `UPDATE release_schedules SET status='started', started_at=?, notified_at=? WHERE id=?`, t, t, r.id);
      if (!w || w.status === 'ended') return;
      run(db, 'INSERT INTO watch_events(watch_id, actor, kind, title, detail, is_mock, at) VALUES (?,?,?,?,?,?,?)', w.id, 'walf', 'release_started', '판매 시작 시각이 됐어요', `${r.seller} · 재고·가격 확인 전`, w.is_mock, t);
      D.notifyUser(db, w.user_id, { kind: 'watch_release_started', title: '판매가 시작됐어요', body: `${r.seller}에서 ${w.title} 판매 시작 시각이 됐어요. 재고와 가격은 아직 확인 전이에요 — 조건에 맞으면 따로 알려 드려요.`,
        link: `walf://watch/${w.id}`, watchId: w.id, isMock: !!w.is_mock, dedupeKey: `watch:${w.id}:release:${r.id}:started` });
      const src = w.url && w.source ? (w.source === 'mock' ? { ok: policy.mockAllowed } : sourceFor(w.url, { mockAllowed: policy.mockAllowed, hosts: policy.pageHosts })) : { ok: false };
      if (w.status === 'active' && src.ok) {
        queued += Number(run(db, `INSERT OR IGNORE INTO price_checks(target_key, url, source, slot, status, is_mock, created_at) VALUES (?,?,?,?,?,?,?)`,
          `${w.source}:${urlKey(w.url)}`, w.url, w.source, `release:${r.id}`, 'queued', w.is_mock, t).changes);
      }
    });
    started++;
  }
  return { started, queued };
}

export function releasesView(db: DB, watchId: number) {
  return all(db, `SELECT * FROM release_schedules WHERE watch_id=? AND status<>'cancelled' ORDER BY starts_at`, watchId).map(r => ({
    id: r.id, seller: r.seller, url: r.url, startsAt: r.starts_at, startsAtText: kWhen(r.starts_at), status: r.status as 'scheduled' | 'started',
    announcedUrl: r.announced_url, note: r.note,
    label: r.status === 'scheduled' ? `${r.seller} · ${kWhen(r.starts_at)} 판매 시작 예정(공식 발표)` : `${r.seller} · 판매 시작됨 — 재고·가격은 확인 결과로 알려 드려요`,
  }));
}
