import React, { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Header } from '@/components/Header';
import { TrackingView } from '@/components/Tracking';
import { Entries } from '@/components/Home';
import { Empty, ErrorBox, Icon, Loading, MockPill, ProductImage, T } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';
import type { Item } from '@/lib/types';

/** 추적함 — 진행 중인 찾아줘 의뢰는 지금처럼 바로 보이고, 그 아래에 “내가 찾는 옷”(찾아줘 + 기다려줘) 목록 */
export default function TrackingTab() {
  const { ready, me, error, loading, refresh, reinit } = useStore();
  useFocusEffect(useCallback(() => { refresh(); }, [refresh])); // 탭에 들어올 때마다 서버 상태를 다시 읽는다
  if (!ready || (!me && loading)) return <View style={st.page}><Header title="추적함" /><Loading /></View>;
  if (!me) return <View style={st.page}><Header title="추적함" /><ErrorBox message={error?.message || ''} onRetry={reinit} onServer={() => router.navigate('/my')} /></View>;
  const items = me.items || [];
  const watches = items.filter(x => x.kind === 'watch');
  const others = items.filter(x => !(x.kind === 'find' && x.id === me.active?.id));
  // 진행 중인 찾아줘가 있으면 기존 추적함 그대로(7일 여정) + 아래에 기다려줘 목록
  if (me.active) return (
    <View style={st.page}>
      <Header title="추적함" />
      <TrackingView r={me.active} onChange={refresh} refreshing={loading} onRefresh={refresh}
        footer={<ItemList title="기다려줘" items={watches} empty="가격을 기다리는 옷이 없어요." limit={me.watchLimit} />} />
    </View>
  );
  return (
    <View style={st.page}>
      <Header title="내가 찾는 옷" />
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { refresh(); }} tintColor={C.black} />}>
        {!others.length ? (
          <Empty title="아직 찾는 옷이 없어요" desc="사진으로 찾거나, 아는 옷의 가격을 기다려 보세요.">
            <View style={{ alignSelf: 'stretch', marginTop: 16 }}><Entries canFind watchLimit={me.watchLimit} /></View>
          </Empty>
        ) : <>
          <ItemList title="진행 중" items={others.filter(x => !x.ended)} empty="진행 중인 옷이 없어요." limit={me.watchLimit} />
          <View style={{ paddingHorizontal: 20, marginTop: 4 }}><Entries canFind watchLimit={me.watchLimit} /></View>
          {others.some(x => x.ended) ? <ItemList title="끝난 옷" items={others.filter(x => x.ended)} empty="" /> : null}
        </>}
      </ScrollView>
    </View>
  );
}

export function ItemList({ title, items, empty, limit }: { title: string; items: Item[]; empty: string; limit?: { max: number; used: number } }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T size={17} w={800} ls={-0.5} accessibilityRole="header">{title} {items.length ? items.length : ''}</T>
        {limit ? <T size={12.5} color={C.gray500}>기다려줘 {limit.used}/{limit.max}벌</T> : null}
      </View>
      {items.length ? items.map(x => <ItemRow key={`${x.kind}-${x.id}`} x={x} />) : empty ? <T size={13.5} color={C.gray500} style={{ marginTop: 10 }}>{empty}</T> : null}
    </View>
  );
}

function ItemRow({ x }: { x: Item }) {
  const open = () => x.kind === 'watch' ? router.push({ pathname: '/watch/[id]', params: { id: String(x.id) } }) : router.push({ pathname: '/past/[id]', params: { id: String(x.id) } });
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${x.kind === 'watch' ? '기다려줘' : '찾아줘'} ${x.title}. ${x.stateLabel}. ${x.sub}`}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: C.canvas }]}>
      <ProductImage uri={x.photoUrl} style={{ width: 52, height: 52, borderRadius: R.thumb }} label={x.title} compact />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <View style={[st.kind, x.kind === 'watch' && st.kindW]}><T size={10.5} w={800} max={1.2} lh={13} color={x.kind === 'watch' ? C.black : C.white}>{x.kind === 'watch' ? '기다려줘' : '찾아줘'}</T></View>
          <T size={12} w={600} color={x.ended ? C.gray500 : C.black}>{x.stateLabel}</T>{x.isMock ? <MockPill /> : null}
        </View>
        <T size={14.5} w={700} numberOfLines={1} color={x.ended ? C.gray500 : C.black}>{x.title}</T>
        <T size={12} color={C.gray500} numberOfLines={1}>{x.target ? `${x.target} · ` : ''}{x.sub}</T>
      </View>
      <Icon name="chev" size={18} color={C.gray500} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.surface },
  kind: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: R.tag, backgroundColor: C.black },
  kindW: { backgroundColor: C.white, borderWidth: 1, borderColor: C.black },
});
