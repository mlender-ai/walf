import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { call } from './api';

export const projectId = (): string | undefined =>
  (Constants.expoConfig as any)?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
/** 무료 Apple ID로 설치한 테스트 빌드는 원격 푸시 권한이 없다(app.config.js) */
export const remotePushAvailable = () => (Constants.expoConfig as any)?.extra?.walfRemotePush !== false && !!projectId();

async function ensureChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: '왈프 소식', importance: Notifications.AndroidImportance.DEFAULT });
}

/** 권한이 이미 있으면 토큰만 조용히 다시 등록한다(토큰은 바뀔 수 있다). 앱을 열 때마다 부른다. */
export async function refreshPushToken() {
  const p = await Notifications.getPermissionsAsync().catch(() => null);
  if (!p) return;
  if (p.status !== 'granted') { await call('POST', '/push-token', { token: null, permission: p.status }).catch(() => {}); return; }
  const id = projectId();
  if (!id || !remotePushAvailable()) return;
  await ensureChannel();
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await call('POST', '/push-token', { token: data, permission: 'granted' });
}

/** 사용자가 알림을 켜는 순간(출발 화면 확인 · MY). 결과를 사람이 읽을 문장으로 돌려준다. */
export async function enablePush(): Promise<string> {
  await ensureChannel();
  const cur = await Notifications.getPermissionsAsync();
  const st = cur.status === 'granted' ? cur : await Notifications.requestPermissionsAsync();
  if (st.status !== 'granted') { await call('POST', '/push-token', { token: null, permission: st.status }); return '알림 권한이 꺼져 있어요. 설정 앱에서 켤 수 있어요. 앱 안 알림은 계속 볼 수 있어요.'; }
  const id = projectId();
  if (!id || !remotePushAvailable()) { await call('POST', '/push-token', { token: null, permission: 'granted' }); return '알림 권한은 켜졌어요. 다만 이 테스트 설치본은 원격 푸시를 받을 수 없어서, 소식은 ALERTS 탭에서 확인해 주세요.'; }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await call('POST', '/push-token', { token: data, permission: 'granted' });
    return '푸시 알림을 켰어요.';
  } catch (e: any) {
    await call('POST', '/push-token', { token: null, permission: 'granted' });
    return `푸시 토큰을 받지 못했어요(${e?.code || e?.message}). 소식은 ALERTS 탭에서 확인해 주세요.`;
  }
}

/** 아직 묻지 않았을 때만 묻는다 — 거절한 사람에게 다시 띄우지 않는다 */
export async function askPushOnce() {
  const p = await Notifications.getPermissionsAsync().catch(() => null);
  if (p && p.status === 'undetermined' && p.canAskAgain !== false) return enablePush().catch(() => null);
  return null;
}
