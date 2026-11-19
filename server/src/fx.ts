// 환율 — 원화가 아닌 가격(엔화 등)을 원하는 가격(원)과 비교할 때만 쓴다.
// 출처와 기준 시각이 있는 값만 쓰고, 오래된 값(3일 넘음)은 쓰지 않는다. 환율이 없으면 비교하지 않는다(알림 없음).
import { type DB } from './db.ts';
import { HttpError } from './domain.ts';
import { now, DAY } from './time.ts';

export type Fx = { currency: string; krwPerUnit: number; at: number; source: string };
export const FX_MAX_AGE = 3 * DAY;

export function latestFx(db: DB, currency: string | null | undefined, t = now()): Fx | null {
  const c = String(currency ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(c) || c === 'KRW' || c === 'XXX') return null;
  const r = db.prepare(`SELECT * FROM fx_rates WHERE currency=? AND observed_at<=? AND observed_at>=? ORDER BY observed_at DESC, id DESC LIMIT 1`).get(c, t, t - FX_MAX_AGE) as any;
  return r ? { currency: c, krwPerUnit: r.krw_per_unit, at: r.observed_at, source: r.source } : null;
}

/** 운영자(또는 환율 API 연결 후 서버)가 기록한다. 엔화처럼 100단위로 고시되면 unit=100 으로 넣으면 1단위로 나눠 저장한다 */
export function recordFx(db: DB, x: { currency: string; krw: number; unit?: number; source: string; observedAt: number; by: string; isMock?: boolean }, t = now()) {
  const c = String(x.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c) || c === 'KRW' || c === 'XXX') throw new HttpError(400, 'bad_currency', '외화 통화 코드(예: JPY)를 넣어 주세요.');
  const unit = Number(x.unit ?? 1), krw = Number(x.krw);
  if (!(unit > 0) || !(krw > 0)) throw new HttpError(400, 'bad_rate', '환율은 0보다 커야 해요.');
  const source = String(x.source ?? '').trim();
  if (!source) throw new HttpError(400, 'no_source', '환율 출처(예: 한국수출입은행 고시)를 적어 주세요.');
  if (!(x.observedAt > 0) || x.observedAt > t + 60_000) throw new HttpError(400, 'bad_time', '환율 기준 시각을 확인해 주세요.');
  return Number(db.prepare(`INSERT INTO fx_rates(currency, krw_per_unit, source, observed_at, entered_by, is_mock, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(c, krw / unit, source, x.observedAt, x.by, x.isMock ? 1 : 0, t).lastInsertRowid);
}

export const fxText = (fx: Fx) => {
  const d = new Date(fx.at + 9 * 3600_000);
  const per = fx.currency === 'JPY' ? 100 : 1;
  return `환율 ${per}${fx.currency}=${Math.round(fx.krwPerUnit * per * 100) / 100}원(${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} · ${fx.source})`;
};
