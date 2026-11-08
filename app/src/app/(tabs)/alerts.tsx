import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Header } from '@/components/Header';
import { Empty, ErrorBox, MockPill, T } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { call, ApiError } from '@/lib/api';
import { openLink } from '@/lib/links';
import { useStore } from '@/lib/store';
import { C } from '@/lib/theme';
import type { Alert } from '@/lib/types';

const ago = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '방금'; if (m < 60) return `${m}분 전`; const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`; return `${Math.floor(h / 24)}일 전`;
};

export default function AlertsTab() {
  const { refresh } = useStore();
  const [items, setItems] = useState<Alert[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await call<Alert[]>('GET', '/alerts')); setErr(null); } catch (e: any) { setErr(e); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const open = async (a: Alert) => {
    if (!a.read) { call('POST', '/alerts/read', { ids: [a.id] }).then(refresh, () => {}); setItems(xs => xs?.map(x => x.id === a.id ? { ...x, read: true } : x) || null); }
    openLink(a.link);
  };
  const unread = items?.some(a => !a.read);
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header title="알림" right={unread ? <Pressable accessibilityRole="button" hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}
        onPress={async () => { await call('POST', '/alerts/read', {}).catch(() => {}); load(); refresh(); }}><T size={13} w={600} color={C.gray500}>모두 읽음</T></Pressable> : null} />
      {err && !items ? <ErrorBox message={err.message} onRetry={load} /> : (
        <FlatList data={items || []} keyExtractor={a => String(a.id)} contentContainerStyle={{ paddingBottom: TAB_SPACE }}
          refreshControl={<RefreshControl refreshing={loading && !!items} onRefresh={load} tintColor={C.black} />}
          ListEmptyComponent={items ? <Empty title="아직 소식이 없어요" desc="왈프는 매물·확인 요청·종료 보고처럼 소식이 있을 때만 알려드려요." /> :undefined}
          renderItem={({ item: a }) => (
            <Pressable onPress={() => open(a)} accessibilityRole="button" accessibilityLabel={`${a.read ? '' : '안 읽음, '}${a.title}. ${a.body}. ${ago(a.createdAt)}`}
              style={({ pressed }) => [{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.surface }, pressed && { backgroundColor: C.canvas }]}>
              <View style={{ width: 8, paddingTop: 7 }}>{!a.read ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.black }} /> : null}</View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><T size={15} w={a.read ? 600 : 800} style={{ flex: 1 }}>{a.title}</T>{a.isMock ? <MockPill /> : null}</View>
                <T size={13.5} lh={20} color={a.read ? C.gray500 : C.black} style={{ marginTop: 3 }}>{a.body}</T>
                <T size={12} color={C.gray500} style={{ marginTop: 4 }}>{ago(a.createdAt)}</T>
              </View>
            </Pressable>
          )} />
      )}
    </View>
  );
}
