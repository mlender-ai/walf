import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Header } from '@/components/Header';
import { Btn, T } from '@/components/ui';
import { C } from '@/lib/theme';

/** 알 수 없는 주소(오래된 알림 링크 등)로 들어왔을 때 — 개발용 안내 대신 홈으로 돌려보낸다 */
export default function NotFound() {
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header close onBack={() => router.replace('/')} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 6, paddingBottom: 80 }}>
        <T size={18} w={800} style={{ textAlign: 'center' }} accessibilityRole="header">찾을 수 없는 화면이에요</T>
        <T size={14} lh={21} color={C.gray500} style={{ textAlign: 'center' }}>링크가 바뀌었거나 끝난 의뢰일 수 있어요.</T>
        <Btn label="홈으로" kind="sec" small onPress={() => router.replace('/')} style={{ marginTop: 14, paddingHorizontal: 22 }} />
      </View>
    </View>
  );
}
