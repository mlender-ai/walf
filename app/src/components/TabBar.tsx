import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Icon, T } from './ui';
import { C } from '@/lib/theme';
import { useStore } from '@/lib/store';

const TABS: Record<string, { label: string; icon: string; ko: string }> = {
  index: { label: 'HOME', icon: 'home', ko: '홈' },
  tracking: { label: 'TRACKING', icon: 'paw', ko: '추적함' },
  alerts: { label: 'ALERTS', icon: 'bell', ko: '알림' },
  my: { label: 'MY', icon: 'user', ko: 'MY' },
};
export const TAB_SPACE = 110; // 스크롤 끝 여백 — 마지막 줄이 떠 있는 탭에 가리지 않게

/** 1차 시안의 떠 있는 알약형 하단 탭 — 선택 탭은 배경 + 굵기 + 채운 아이콘 */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { me } = useStore();
  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom: Math.max(insets.bottom - 10, 10) }]}>
      <View style={s.bar}>
        {state.routes.map((route, i) => {
          const t = TABS[route.name]; if (!t) return null;
          const on = state.index === i;
          const dot = route.name === 'alerts' && (me?.unread || 0) > 0;
          return (
            <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${t.ko}${dot ? ', 새 알림 있음' : ''}`}
              onPress={() => { if (!on) navigateToTab(route.key); }}
              style={[s.tab, on && s.on]}>
              <View><Icon name={t.icon} color={on ? C.black : C.gray500} filled={on} />{dot ? <View style={s.dot} /> : null}</View>
              <T size={11} w={on ? 800 : 600} color={on ? C.black : C.gray500} max={1.15} lh={13} ls={0.2}>{t.label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  bar: { height: 62, borderRadius: 31, flexDirection: 'row', padding: 5, backgroundColor: C.white, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,17,17,0.14)',
    shadowColor: '#111', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 26, gap: 2 },
  on: { backgroundColor: C.surface },
  dot: { position: 'absolute', right: -3, top: 0, width: 6, height: 6, borderRadius: 3, backgroundColor: C.black, borderWidth: 1.5, borderColor: C.white },
});
