import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Btn, CandRow, DOG, Hair, Icon, MockBanner, MockPill, ProductImage, Seg7, T, Tags } from './ui';
import { TAB_SPACE } from './TabBar';
import { C, R } from '@/lib/theme';
import { openLink } from '@/lib/links';
import type { Display, Item, PastItem, RequestView } from '@/lib/types';

// ── V2 두 진입로: 찾아줘(사진으로 정확한 옷 찾기) · 기다려줘(아는 옷의 가격·사이즈 기다리기) ──
export function Entries({ canFind, watchLimit }: { canFind: boolean; watchLimit?: { max: number; used: number } }) {
  const full = !!watchLimit && watchLimit.used >= watchLimit.max;
  return (
    <View style={{ gap: 10 }}>
      {canFind ? <EntryRow primary icon="camera" title="찾아줘" desc="사진 한 장이면 왈프가 찾아볼게요." onPress={() => router.push('/request/new')} /> : null}
      <EntryRow icon="bell" title="기다려줘" desc={full ? `지켜보는 옷이 ${watchLimit!.max}벌이에요. 하나를 멈추면 더 맡길 수 있어요.` : '원하는 가격이 될 때까지 왈프가 지켜볼게요.'}
        disabled={full} onPress={() => router.push('/watch/new')} />
    </View>
  );
}
function EntryRow({ title, desc, icon, primary, disabled, onPress }: { title: string; desc: string; icon: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  const fg = primary ? C.white : C.black;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`} accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [s.entry, primary ? { backgroundColor: C.black } : { borderWidth: 1, borderColor: C.gray300 }, disabled && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
      <Icon name={icon} size={22} color={fg} />
      <View style={{ flex: 1 }}>
        <T size={16} w={800} color={fg} ls={-0.4}>{title}</T>
        <T size={13} lh={18} color={primary ? 'rgba(255,255,255,0.78)' : C.gray500} style={{ marginTop: 1 }}>{desc}</T>
      </View>
      <Icon name="chev" size={18} color={fg} />
    </Pressable>
  );
}
/** 홈 아래 — 내가 찾는 옷 요약 한 줄(목록은 추적함 탭) */
export function ItemsRow({ items }: { items: Item[] }) {
  const open = items.filter(x => !x.ended);
  if (!items.length) return null;
  const head = open[0] || items[0];
  return (
    <Pressable onPress={() => router.navigate('/tracking')} accessibilityRole="button" style={s.last}>
      <View style={{ flex: 1 }}><T size={12} color={C.gray500}>내가 찾는 옷 · {open.length ? `${open.length}벌 진행 중` : '모두 끝남'}</T><T size={14} w={700} numberOfLines={1}>{head.title} · {head.stateLabel}</T></View>
      <T size={13} w={600} color={C.gray500}>전체 보기</T><Icon name="chev" size={18} color={C.gray500} />
    </Pressable>
  );
}

// ── S01 첫 방문 홈 ────────────────────────────────────────────
// 1차 시안 360 폭 기준: 강아지 1.194w, 헤드라인 바닥 = 강아지 발끝
export function FirstVisit({ last, items = [], watchLimit }: { last?: PastItem; items?: Item[]; watchLimit?: { max: number; used: number } }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width, 440);
  const dog = w * 1.194, heroH = w * 1.2;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }} showsVerticalScrollIndicator={false}>
      <View style={{ height: heroH, width: '100%' }}>
        <Image source={DOG.stand} style={{ position: 'absolute', width: dog, height: dog, left: -0.028 * w + (width - w), top: 0.044 * w }}
          accessibilityLabel="정면을 바라보고 선 검은 래브라도, 왈프" />
        <View style={{ position: 'absolute', left: 20, bottom: heroH - (0.044 * w + dog * 342 / 357), maxWidth: w * 0.42, gap: 14 }} accessibilityRole="header">
          <T size={35} w={800} lh={41} ls={-1.75} max={1.25}>{'넌 그냥\n올려.'}</T>
          <T size={35} w={800} lh={41} ls={-1.75} max={1.25}>{'찾는 건\n왈프가\n할게.'}</T>
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
        <T size={14.5} lh={22}>{'사진이나 링크만 주세요.\n어떤 옷인지 찾고, 원하는 가격이 될 때까지 지켜볼게요.'}</T>
        <View style={{ marginTop: 18 }}><Entries canFind watchLimit={watchLimit} /></View>
        <T size={12} w={500} color={C.gray500} style={{ textAlign: 'center', marginTop: 12 }}>무료 베타  ·  찾아줘 한 벌씩  ·  기다려줘 {watchLimit?.max ?? 3}벌까지</T>
        {items.length ? <ItemsRow items={items} /> : last ? (
          <Pressable onPress={() => router.push({ pathname: '/past/[id]', params: { id: String(last.id) } })} accessibilityRole="button" style={s.last}>
            <View style={{ flex: 1 }}><T size={12} color={C.gray500}>지난 의뢰 · {last.display.label}</T><T size={14} w={700} numberOfLines={1}>{last.title}</T></View>
            <T size={13} w={600} color={C.gray500}>결과 보기</T><Icon name="chev" size={18} color={C.gray500} />
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

// ── 상태 문장(홈 가운데) ──────────────────────────────────────
export function StatusModule({ d, children }: { d: Display; children?: React.ReactNode }) {
  return (
    <View style={s.stm} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Avatar quiet={d.muted} /><T size={12.5} w={600} color={C.gray500} style={{ flex: 1 }}>{d.eyebrow}</T>{d.isMock ? <MockPill /> : null}</View>
      <T size={21} w={800} lh={27} ls={-0.85} style={{ marginTop: 10 }} accessibilityRole="header">{d.title}</T>
      <T size={14} lh={21.5} style={{ marginTop: 6 }}>{d.desc}</T>
      {d.notice ? <View style={s.notice} accessibilityRole="alert"><Icon name="close" size={14} /><T size={12.5} w={600} lh={18} style={{ flex: 1 }}>{d.notice}</T></View> : null}
      {children}
      {d.action ? <Btn label={d.action.label} kind={d.action.primary ? 'pri' : 'sec'} small onPress={() => openLink(d.action!.target)} style={{ alignSelf: 'flex-start', marginTop: 14 }} /> : null}
    </View>
  );
}

// ── S04 의뢰 진행 홈 ──────────────────────────────────────────
export function ActiveHome({ r, refreshing, onRefresh, items = [], watchLimit }: { r: RequestView; refreshing: boolean; onRefresh: () => void; items?: Item[]; watchLimit?: { max: number; used: number } }) {
  const watches = items.filter(x => x.kind === 'watch' && !x.ended);
  const lead = r.candidates.leads[0];
  const showLead = r.display.key === 'lead_found' && lead;
  const done = r.schedule.days.filter(d => d.state === 'done').length;
  const sch = r.schedule;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: TAB_SPACE + 18 }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.black} />}>
      {r.isMock ? <MockBanner /> : null}
      <ProductImage uri={r.product.photoUrl} style={{ height: 256, marginTop: 4 }} label={`의뢰한 옷: ${r.product.title}`} />
      <View style={{ marginTop: 14 }}>
        {r.product.brandLabel ? <T size={11.5} w={800} ls={0.5} numberOfLines={1}>{r.product.brandLabel.toUpperCase()}</T> : null}
        <T size={17} w={600} lh={24} ls={-0.4} numberOfLines={2} style={{ marginTop: 3 }}>{r.product.title}</T>
        <T size={13} color={C.gray500} style={{ marginTop: 3 }} numberOfLines={2}>{r.conditions.label || '구매 조건은 나중에 넣을 수 있어요'}</T>
      </View>
      <StatusModule d={r.display}>
        {showLead ? <CandRow c={lead} onPress={() => router.push(`/candidate/${lead.id}`)} /> : null}
      </StatusModule>
      <View style={{ marginTop: 28 }}>
        <View style={s.rowB}><T size={15} w={700}>7일 탐색</T><T size={12.5} color={C.gray500}>{sch.endsLabel || '상품 확인 후 시작'}</T></View>
        <Seg7 days={sch.days} done={done} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <KV k="마지막 탐색" v={sch.lastRun ? sch.lastRun.label : '아직 탐색 전'} sub={sch.lastRun ? `판매처 ${sch.lastRun.checked}곳 확인${sch.lastRun.isMock ? ' · 모의' : ''}` : r.status === 'active' ? '첫 탐색 준비 중' : '상품 확인 후 시작'} />
          <KV k="다음 탐색" v={r.status === 'active' ? (sch.nextRunLabel || '—') : '첫 탐색'} sub={r.status === 'active' ? '하루 한 번' : '확인이 끝나면 바로'} />
        </View>
      </View>
      <View style={{ marginTop: 32 }}>
        <View style={s.rowB}><T size={17} w={800} ls={-0.5}>최근 활동</T>
          <Pressable onPress={() => router.navigate('/tracking')} accessibilityRole="button" hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><T size={13} w={600} color={C.gray500}>전체 보기</T></Pressable></View>
        {r.activity.slice(0, 3).map((a, i) => (
          <View key={a.id}>{i ? <Hair /> : null}<ActRow a={a} /></View>
        ))}
      </View>
      <Btn label="추적함에서 자세히 보기" kind="sec" onPress={() => router.navigate('/tracking')} style={{ marginTop: 20 }} />
      <View style={{ marginTop: 32 }}>
        <View style={s.rowB}><T size={17} w={800} ls={-0.5}>기다려줘</T><T size={12.5} color={C.gray500}>{watches.length}/{watchLimit?.max ?? 3}벌 지켜보는 중</T></View>
        {watches.slice(0, 3).map(w => (
          <Pressable key={w.id} onPress={() => router.push({ pathname: '/watch/[id]', params: { id: String(w.id) } })} accessibilityRole="button" style={s.wrow}>
            <View style={{ flex: 1 }}><T size={12} color={C.gray500}>{w.stateLabel}{w.isMock ? ' · 모의' : ''}</T><T size={14} w={700} numberOfLines={1}>{w.title}</T><T size={12} color={C.gray500} numberOfLines={1}>{w.sub}</T></View>
            <Icon name="chev" size={18} color={C.gray500} />
          </Pressable>
        ))}
        <View style={{ marginTop: 12 }}><Entries canFind={false} watchLimit={watchLimit} /></View>
      </View>
      <T size={12} color={C.gray500} style={{ textAlign: 'center', marginTop: 16 }}>찾아줘는 한 번에 한 벌이에요. 가격을 기다리는 옷은 기다려줘로 따로 맡길 수 있어요.</T>
    </ScrollView>
  );
}

export function KV({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return <View style={s.kv}><T size={11.5} w={600} color={C.gray500}>{k}</T><T size={14} w={700} lh={20} style={{ marginTop: 3 }}>{v}</T>{sub ? <T size={12} w={500} color={C.gray500}>{sub}</T> : null}</View>;
}
export function ActRow({ a }: { a: RequestView['activity'][number] }) {
  return (
    <View style={s.act} accessible accessibilityLabel={`${a.clock} ${a.actor} ${a.title}. ${a.detail || ''}`}>
      <T size={12.5} w={600} color={C.gray500} style={{ width: 44, fontVariant: ['tabular-nums'] }}>{a.clock}</T>
      <View style={{ flex: 1 }}><T size={14} w={700}>{a.title}</T>{a.detail ? <T size={12.5} color={C.gray500} lh={18} style={{ marginTop: 2 }}>{a.detail}</T> : null}</View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}><View style={s.actor}><T size={11} w={700} color={C.gray500} max={1.3} lh={13}>{a.actor}</T></View>{a.isMock ? <T size={10.5} w={700} color={C.gray500}>모의</T> : null}</View>
    </View>
  );
}

const s = StyleSheet.create({
  stm: { marginTop: 24, paddingTop: 22, borderTopWidth: 1, borderTopColor: C.surface },
  notice: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 12, padding: 10, borderRadius: R.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: C.black },
  rowB: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kv: { flex: 1, padding: 14, paddingVertical: 12, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
  act: { flexDirection: 'row', gap: 10, paddingVertical: 12, alignItems: 'flex-start' },
  actor: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: R.tag, borderWidth: 1, borderColor: C.gray300 },
  last: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 24, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingHorizontal: 16, paddingVertical: 12, borderRadius: R.card },
  wrow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.surface },
});
export { Tags };
