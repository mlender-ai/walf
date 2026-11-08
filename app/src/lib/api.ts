import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

const K_DEVICE = 'walf.device';
const K_BASE = 'walf.apiBase';
export const DEFAULT_BASE = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4300').replace(/\/$/, '');

let base = DEFAULT_BASE;
let device: string | null = null;

export class ApiError extends Error {
  status: number; code: string; detail?: string;
  constructor(status: number, code: string, message: string, detail?: string) { super(message); this.status = status; this.code = code; this.detail = detail; }
}

export async function initApi() {
  base = ((await AsyncStorage.getItem(K_BASE)) || DEFAULT_BASE).replace(/\/$/, '');
  device = await AsyncStorage.getItem(K_DEVICE);
  if (!device) { device = Crypto.randomUUID(); await AsyncStorage.setItem(K_DEVICE, device); }
  await call('POST', '/session', { deviceId: device, platform: Platform.OS });
  return { base, device };
}
export const getBase = () => base;
export const getDevice = () => device;
export async function setBase(next: string) {
  const v = next.trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(v)) throw new ApiError(0, 'bad_base', 'http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.');
  base = v; await AsyncStorage.setItem(K_BASE, v);
}
export async function resetDevice() {
  device = Crypto.randomUUID(); await AsyncStorage.setItem(K_DEVICE, device);
  await call('POST', '/session', { deviceId: device, platform: Platform.OS });
}

const MSG: Record<string, string> = {
  network: '서버에 연결하지 못했어요. 네트워크와 서버 주소를 확인해 주세요.',
  timeout: '응답이 늦어요. 잠시 후 다시 시도해 주세요.',
  client: '요청을 보내지 못했어요. 다시 시도해 주세요. 계속되면 왈프 팀에 알려 주세요.',
};

export async function call<T = any>(method: string, path: string, body?: unknown, opts: { form?: FormData; timeoutMs?: number } = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(base + '/api' + path, {
      method,
      headers: { ...(device ? { 'x-walf-device': device } : {}), ...(body && !opts.form ? { 'content-type': 'application/json' } : {}), accept: 'application/json' },
      body: opts.form ?? (body ? JSON.stringify(body) : undefined),
      signal: ctl.signal,
    });
  } catch (e: any) {
    const raw = String(e?.message || e?.name || '');
    // 실제 연결 실패만 “서버에 연결하지 못했어요”로 안내한다. 앱 안에서 요청을 만들다 난 오류는 따로 구분한다.
    const code = e?.name === 'AbortError' ? 'timeout' : /network|connect|offline|timed out|NSURLErrorDomain|host/i.test(raw) ? 'network' : 'client';
    throw new ApiError(0, code, MSG[code], raw);
  } finally { clearTimeout(timer); }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error || 'error', json.message || '요청을 처리하지 못했어요.');
  return json as T;
}

/** 앱에서 난 실패를 서버 로그에 한 줄로 남긴다(QA용, 실패해도 무시). 사진·입력값은 보내지 않는다. */
export function reportClientError(where: string, e: any, extra?: Record<string, string | number | null | undefined>) {
  call('POST', '/client-log', { where, code: e?.code ?? null, status: e?.status ?? null, message: String(e?.message ?? e).slice(0, 300), detail: e?.detail ? String(e.detail).slice(0, 300) : null, ...extra }, { timeoutMs: 5000 }).catch(() => {});
}

/**
 * expo-image-picker 결과를 multipart 로 보낸다.
 * SDK 58은 전역 fetch가 expo/fetch라서 예전 React Native 방식({ uri, type, name })을 받지 않는다
 * ("Unsupported FormDataPart implementation"). expo-file-system 의 File 을 넣는다(Expo 문서 방식).
 */
export function photoPart(uri: string) {
  return new File(uri) as any;
}
