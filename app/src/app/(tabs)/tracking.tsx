import React, { useCallback } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Header } from '@/components/Header';
import { TrackingView } from '@/components/Tracking';
import { Btn, Empty, ErrorBox, Icon, Loading, MockPill, T } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';

export default function TrackingTab() {
  const { ready, me, error, loading, refresh, reinit } = useStore();
  useFocusEffect(useCallback(() => { refresh(); }, [refresh])); // 탭에 들어올 때마다 서버 상태를 다시 읽는다
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header title="추적함" />
      {!ready || (!me && loading) ? <Loading /> : !me ? <ErrorBox message={error?.message || ''} onRetry={reinit} onServer={() => router.navigate('/my')} /> :
        me.active ? <TrackingView r={me.active} onChange={refresh} refreshing={loading} onRefresh={refresh} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }}>
            <Empty title="진행 중인 의뢰가 없어요" desc="옷을 맡기면 7일 동안 왈프가 한 일이 여기에 쌓여요.">
              <Btn label="왈프에게 맡기기" onPress={() => router.push('/request/new')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
            </Empty>
            {me.past.length ? <View style={{ paddingHorizontal: 20 }}>
              <T size={17} w={800} ls={-0.5} accessibilityRole="header">지난 의뢰 {me.past.length}건</T>
              {me.past.map(p => (
                <Pressable key={p.id} onPress={() => router.push({ pathname: '/past/[id]', params: { id: String(p.id) } })} accessibilityRole="button"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.surface }}>
                  <View style={{ flex: 1 }}>
                    <T size={12} color={C.gray500}>{p.display.label}{p.isMock ? ' · 모의' : ''}</T>
                    <T size={14.5} w={700} numberOfLines={2}>{p.title}</T>
                  </View>
                  {p.isMock ? <MockPill /> : null}<Icon name="chev" size={18} color={C.gray500} />
                </Pressable>
              ))}
            </View> : null}
          </ScrollView>
        )}
    </View>
  );
}
