import React, { useCallback } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Header } from '@/components/Header';
import { ActiveHome, FirstVisit } from '@/components/Home';
import { ErrorBox, ErrorStrip, Loading } from '@/components/ui';
import { useStore } from '@/lib/store';
import { usePull } from '@/lib/usePull';

export default function HomeTab() {
  const { ready, me, error, loading, refresh, reinit } = useStore();
  const { pulling, onPull } = usePull(refresh);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh])); // 탭에 들어올 때마다 서버 상태를 다시 읽는다
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header wordmark />
      {me && error ? <ErrorStrip message={error.message} onRetry={refresh} /> : null}
      {!ready || (!me && loading) ? <Loading /> :
        !me ? <ErrorBox message={error?.message || '잠시 후 다시 시도해 주세요.'} onRetry={reinit} onServer={() => router.navigate({ pathname: '/my', params: { dev: '1' } })} /> :
          me.active ? <ActiveHome r={me.active} refreshing={pulling} onRefresh={onPull} items={me.items} watchLimit={me.watchLimit} />
            : <FirstVisit last={me.past[0]} items={me.items} watchLimit={me.watchLimit} />}
    </View>
  );
}
