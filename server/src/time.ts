// 시각은 epoch ms로 저장하고, 사용자에게 보이는 문구는 한국 시간(UTC+9, 서머타임 없음)으로 만든다.
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
export const HUNT_MS = 168 * HOUR;

let fixed: number | null = null;
export const now = () => fixed ?? Date.now();
/** 테스트 전용 — 운영 서버에서는 호출하지 않는다 */
export function setClock(t: number | null) { fixed = t; }

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const kst = (t: number) => new Date(t + 9 * HOUR);

export function kDate(t: number) {
  const d = kst(t);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WD[d.getUTCDay()]})`;
}
export function kTime(t: number) {
  const d = kst(t), h = d.getUTCHours(), m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}${m ? ':' + String(m).padStart(2, '0') : '시'}`;
}
export function kClock(t: number) {
  const d = kst(t);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export function kDayKey(t: number) {
  const d = kst(t);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
/** 오늘·어제·내일이면 그 말로, 아니면 날짜로 */
export function kRelDay(t: number, ref = now()) {
  const diff = Math.round((Date.UTC(...ymd(t)) - Date.UTC(...ymd(ref))) / DAY);
  if (diff === 0) return '오늘';
  if (diff === -1) return '어제';
  if (diff === 1) return `내일(${WD[kst(t).getUTCDay()]})`;
  return kDate(t);
}
function ymd(t: number): [number, number, number] { const d = kst(t); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; }
export function kWhen(t: number, ref = now()) { return `${kRelDay(t, ref)} ${kTime(t)}`; }
export function kDayNum(t: number) { return kst(t).getUTCDate(); }

export function won(n: number | null | undefined) {
  if (n == null) return '';
  return n.toLocaleString('ko-KR') + '원';
}
