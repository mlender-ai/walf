import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconBtn, T } from './ui';

/** 탭 루트: 워드마크 또는 페이지 제목 · 한 단계 아래: 뒤로 + 가운데 제목 */
export function Header({ title, wordmark, back, close, right, onBack, modal }: { title?: string; wordmark?: boolean; back?: boolean; close?: boolean; right?: React.ReactNode; onBack?: () => void; modal?: boolean }) {
  const insets = useSafeAreaInsets();
  const top = modal ? 8 : insets.top; // iOS 시트 모달은 상태바 아래에서 시작한다
  const nav = back || close;
  return (
    <View style={{ paddingTop: top, backgroundColor: '#fff' }}>
      <View style={{ height: 52, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' }}>
        {nav ? <View style={{ marginLeft: -12 }}><IconBtn name={close ? 'close' : 'back'} label={close ? '닫기' : '뒤로'} onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace('/')))} /></View> : null}
        {wordmark ? <T size={23} w={900} ls={-1.3} lh={26} accessibilityRole="header" accessibilityLabel="WALF">WALF.</T> : null}
        {title && !nav ? <T size={26} w={800} ls={-1} lh={32} accessibilityRole="header">{title}</T> : null}
        {title && nav ? <View style={{ position: 'absolute', left: 64, right: 64, alignItems: 'center' }} pointerEvents="none"><T size={16} w={700} numberOfLines={1} accessibilityRole="header">{title}</T></View> : null}
        <View style={{ flex: 1 }} />
        {right}
      </View>
    </View>
  );
}
