import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Header } from '@/components/Header';
import { TrackingView } from '@/components/Tracking';
import { ErrorBox, Loading } from '@/components/ui';
import { call, ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { RequestView } from '@/lib/types';

/** 알림·지난 의뢰에서 여는 의뢰 기록 */
export default function PastRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refresh } = useStore();
  const [r, setR] = useState<RequestView | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const load = useCallback(() => { call<RequestView>('GET', `/requests/${id}`).then(x => { setR(x); setErr(null); }, setErr); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="의뢰 기록" />
      {err ? <ErrorBox message={err.status === 404 ? '이 의뢰를 찾을 수 없어요.' : err.message} onRetry={load} /> : !r ? <Loading /> :
        <TrackingView r={r} onChange={() => { load(); refresh(); }} />}
    </View>
  );
}
