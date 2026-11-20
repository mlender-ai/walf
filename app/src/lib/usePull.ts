import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { router } from 'expo-router';

/** 당겨서 새로고침 — 사용자가 당길 때만 스피너를 보인다(탭에 들어올 때·20초마다 하는 갱신은 화면을 밀지 않고 조용히) */
export function usePull(refresh: () => Promise<unknown>) {
  const [pulling, setPulling] = useState(false);
  const onPull = useCallback(async () => { setPulling(true); try { await refresh(); } finally { setPulling(false); } }, [refresh]);
  return { pulling, onPull };
}

/** 새로 맡기기 — 찾아줘(사진으로 찾기) · 기다려줘(아는 옷의 가격 기다리기). iOS는 액션 시트 */
export function askNew(opts: { canFind: boolean; watchFull?: boolean }) {
  const items: { label: string; go: () => void }[] = [
    ...(opts.canFind ? [{ label: '찾아줘 · 사진으로 찾기', go: () => router.push('/request/new') }] : []),
    ...(!opts.watchFull ? [{ label: '기다려줘 · 가격 기다리기', go: () => router.push('/watch/new') }] : []),
  ];
  if (!items.length) return Alert.alert('지금은 더 맡길 수 없어요', '진행 중인 찾아줘가 있고, 기다려줘도 가득 찼어요.');
  if (Platform.OS === 'ios') return ActionSheetIOS.showActionSheetWithOptions({ options: [...items.map(x => x.label), '취소'], cancelButtonIndex: items.length }, i => items[i]?.go());
  Alert.alert('새로 맡기기', undefined, [...items.map(x => ({ text: x.label, onPress: x.go })), { text: '취소', style: 'cancel' as const }]);
}
