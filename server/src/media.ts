// 사용자 사진 접근 — 업로드 폴더를 공개 정적 경로로 열지 않는다. 서버가 그 사진을 볼 수 있는 화면을 줄 때만 서명한 주소(만료 있음)를 만든다.
// 주소를 아는 것만으로는 오래 볼 수 없고(최대 13시간), 서명이 맞지 않거나 만료된 주소는 403.
import crypto from 'node:crypto';

let secret: Buffer = crypto.randomBytes(32);
/** 서버 시작 때 WALF_SECRET 으로 맞춘다(없으면 재시작마다 바뀌어 이전 주소는 만료된다) */
export function setMediaSecret(s: string) { secret = Buffer.from(s); }
export const MEDIA_TTL_MS = 12 * 3600_000;
const NAME = /^[\w-]+\.(jpg|jpeg|png|webp|heic|heif)$/i;
const sign = (name: string, exp: number) => crypto.createHmac('sha256', secret).update(`upload|${name}|${exp}`).digest('base64url').slice(0, 32);

/** 앱·어드민 화면용 사진 주소. 만료 시각은 한 시간 단위로 맞춰 같은 사진 주소가 자주 바뀌지 않게 한다(이미지 캐시) */
export function uploadUrl(base: string, name: string | null | undefined, t = Date.now()) {
  if (!name || !NAME.test(name)) return null;
  const exp = (Math.floor((t + MEDIA_TTL_MS) / 3600_000) + 1) * 3600_000;
  return `${base}/uploads/${name}?exp=${exp}&sig=${sign(name, exp)}`;
}
export function verifyUpload(name: string, exp: unknown, sig: unknown, t = Date.now()) {
  if (!NAME.test(name)) return false;
  const e = Number(exp);
  if (!Number.isInteger(e) || e < t || e > t + MEDIA_TTL_MS + 2 * 3600_000) return false;
  const want = Buffer.from(sign(name, e)), got = Buffer.from(String(sig ?? ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
