import React, { useCallback, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Header } from '@/components/Header';
import { Field } from '@/components/Field';
import { ActRow } from '@/components/Home';
import { Avatar, Btn, ErrorBox, Hair, Icon, IconBtn, Loading, MockBanner, MockPill, ProductImage, Section, T, Tag } from '@/components/ui';
import { call, ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { usePull } from '@/lib/usePull';
import { C, R } from '@/lib/theme';
import type { TagT, WatchView } from '@/lib/types';
import { OfferCard } from '@/components/OfferCard';
import { PriorityPicker } from '@/components/PriorityPicker';

const won = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('ko-KR')}원`);
const STOCK: Record<string, string> = { in_stock: '재고 있음', sold_out: '품절', unknown: '재고 미확인', option_missing: '원하는 옵션 없음' };

/**
 * 기다려줘 상세 — 위는 요약(옷 · 지금 상태 · 마지막 가격), 아래는 탭으로 나눈다.
 * 가격: 확인 기록(실패 포함) · 다른 판매처: 같은 상품을 파는 다른 곳(왈프 팀 확인분만) · 비슷한 옷: 같은 상품 아님 · 기록: 활동
 * 조건 바꾸기 · 멈춤/계속/끝내기는 오른쪽 위 ⋯ 메뉴. 새 판매처·비슷한 옷 알림은 ?tab= 으로 그 탭을 바로 연다.
 */
export default function WatchScreen() {
  const { id, tab: tab0 } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { refresh } = useStore();
  const { height } = useWindowDimensions(); const insets = useSafeAreaInsets();
  const [w, setW] = useState<WatchView | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<TabKey>(tab0 === 'offers' || tab0 === 'similar' ? tab0 : 'price');
  const [price, setPrice] = useState(''); const [size, setSize] = useState(''); const [itemOnly, setItemOnly] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const y = useRef(0), topH = useRef(0);
  const load = useCallback(() => call<WatchView>('GET', `/watches/${id}`).then(x => { setW(x); setErr(null); }, setErr), [id]);
  const { pulling, onPull } = usePull(load);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = (action: 'pause' | 'resume' | 'end' | 'renew', confirm?: [string, string, string]) => {
    const run = async () => {
      setBusy(true);
      try { setW(await call<WatchView>('POST', `/watches/${id}/${action}`)); refresh(); } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(false); }
    };
    if (!confirm) return run();
    Alert.alert(confirm[0], confirm[1], [{ text: '아니요', style: 'cancel' }, { text: confirm[2], style: 'destructive', onPress: run }]);
  };
  const openEdit = () => {
    if (!w) return;
    setPrice(String(w.conditions.targetPrice).replace(/\B(?=(\d{3})+(?!\d))/g, ',')); setSize(w.conditions.size || ''); setItemOnly(w.conditions.priceBasis === 'item'); setEdit(true);
  };
  const save = async () => {
    setBusy(true);
    try { setW(await call<WatchView>('PATCH', `/watches/${id}`, { targetPrice: price.replace(/[^\d]/g, '') || undefined, size, priceBasis: itemOnly ? 'item' : 'total' })); setEdit(false); refresh(); }
    catch (e: any) { Alert.alert('저장하지 못했어요', e.message); } finally { setBusy(false); }
  };

  const setDiscovery = async (patch: { discovery?: boolean; discoverySources?: string[]; priority?: string | null }) => {
    setBusy(true);
    try { setW(await call<WatchView>('PATCH', `/watches/${id}`, patch)); } catch (e: any) { Alert.alert('저장하지 못했어요', e.message); } finally { setBusy(false); }
  };
  const feedback = async (offerId: number, kind: string) => { try { await call('POST', `/offers/${offerId}/feedback`, { kind }); load(); } catch (e: any) { Alert.alert('저장하지 못했어요', e.message); } };
  const opened = (offerId: number) => { call('POST', `/offers/${offerId}/open`).catch(() => {}); };
  const toggleSave = async (offerId: number, on: boolean) => {
    try { await call(on ? 'POST' : 'DELETE', `/offers/${offerId}/save`); load(); } catch (e: any) { Alert.alert('저장하지 못했어요', e.message); }
  };

  if (err) return <View style={st.page}><Header back title="기다려줘" /><ErrorBox message={err.status === 404 ? '이 기다려줘를 찾을 수 없어요.' : err.message} onRetry={load} /></View>;
  if (!w) return <View style={st.page}><Header back title="기다려줘" /><Loading /></View>;
  const d = w.display, L = w.latest, dv = w.discovery, av = w.alternatives;
  const url = w.product.url;
  const picked = dv ? dv.sources.filter(x => x.selected).map(x => x.id) : [];
  const discDesc = !dv ? '' : dv.state === 'off' ? '켜면 같은 상품을 파는 다른 판매처도 하루 한 번 찾아봐요.'
    : dv.state === 'unavailable' ? '지금 자동으로 찾아볼 수 있는 곳이 없어요. 아래에서 찾아볼 곳을 확인해 주세요.'
    : dv.state === 'none' ? `${dv.searchedSources.length ? `${dv.searchedSources.join(' · ')}에서 찾아봤어요. ` : ''}다음 확인 때 다시 볼게요.`
    : dv.state === 'failed' ? '이번에는 판매처를 확인하지 못했어요. 매물이 없다는 뜻은 아니에요.'
    : dv.state === 'reviewing' ? '찾은 곳은 왈프 팀이 같은 상품인지 확인한 뒤 보여 드려요.' : '곧 찾아볼게요.';
  const showAlt = !!(av?.available && w.status !== 'ended' && (av.items.length || ['searching', 'reviewing'].includes(av.state)));
  const tabs: { k: TabKey; label: string; n?: number }[] = [
    { k: 'price', label: '가격' },
    ...(dv ? [{ k: 'offers' as const, label: '다른 판매처', n: dv.items.length }] : []),
    ...(showAlt ? [{ k: 'similar' as const, label: '비슷한 옷', n: av!.items.length }] : []),
    { k: 'log', label: '기록' },
  ];
  const cur = tabs.some(x => x.k === tab) ? tab : 'price';
  const pick = (k: TabKey) => { setTab(k); if (y.current > topH.current) scroll.current?.scrollTo({ y: topH.current, animated: false }); }; // 탭을 바꿔도 탭 막대 위치는 그대로

  // 관리 동작은 오른쪽 위 ⋯ 한곳에 — 본문은 확인한 사실과 찾은 곳만
  const menu = () => {
    const items = [
      w.actions.edit && { label: '조건 바꾸기', run: openEdit },
      url && { label: `${w.product.seller || '판매 페이지'}에서 보기`, run: () => { WebBrowser.openBrowserAsync(url).catch(() => {}); } },
      w.actions.pause && { label: '잠시 멈추기', run: () => act('pause') },
      w.actions.resume && { label: '다시 지켜보기', run: () => act('resume') },
      w.actions.end && { label: '기다려줘 끝내기', run: () => act('end', ['기다려줘를 끝낼까요?', '가격 확인을 멈춰요. 기록은 남아 있어요.', '끝내기']), destructive: true },
    ].filter(Boolean) as { label: string; run: () => void; destructive?: boolean }[];
    if (Platform.OS === 'ios') return ActionSheetIOS.showActionSheetWithOptions({ options: [...items.map(x => x.label), '취소'], cancelButtonIndex: items.length, destructiveButtonIndex: items.findIndex(x => x.destructive) }, i => items[i]?.run());
    Alert.alert('기다려줘', undefined, [...items.map(x => ({ text: x.label, onPress: x.run, style: x.destructive ? 'destructive' as const : 'default' as const })), { text: '취소', style: 'cancel' as const }]);
  };

  return (
    <View style={st.page}>
      <Header back title="기다려줘" right={<View style={{ marginRight: -12 }}><IconBtn name="more" label="기다려줘 관리" onPress={menu} /></View>} />
      <ScrollView ref={scroll} stickyHeaderIndices={[1]} onScroll={e => { y.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={C.black} />}>
        {/* 0 · 요약: 어떤 옷 · 지금 상태 · 마지막 가격 */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 8, borderBottomColor: C.surface }} onLayout={e => { topH.current = e.nativeEvent.layout.height; }}>
          {w.isMock ? <MockBanner text="테스트용 모의 가격이에요. 실제 판매 가격이 아니에요." /> : null}
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 6 }}>
            <ProductImage uri={w.product.photoUrl} style={{ width: 64, height: 76, borderRadius: R.thumb }} label="기다리는 옷" compact />
            <View style={{ flex: 1 }}>
              {w.product.brand ? <T size={11.5} w={800} ls={0.5} numberOfLines={1}>{w.product.brand.toUpperCase()}</T> : null}
              <T size={16} w={700} lh={22} numberOfLines={2}>{w.product.title}</T>
              <Pressable onPress={w.actions.edit ? openEdit : undefined} disabled={!w.actions.edit} accessibilityRole={w.actions.edit ? 'button' : 'text'} accessibilityLabel={`조건 ${w.conditions.label}${w.actions.edit ? ', 바꾸기' : ''}`} hitSlop={6}>
                <T size={12.5} color={C.gray500} numberOfLines={2}>{w.conditions.label}{w.actions.edit ? <T size={12.5} w={600} color={C.black}>  바꾸기</T> : null}</T>
              </Pressable>
            </View>
          </View>
          <View style={st.stm} accessibilityLiveRegion="polite">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Avatar quiet={['paused', 'ended'].includes(d.key)} /><T size={12.5} w={600} color={C.gray500} style={{ flex: 1 }}>{d.eyebrow || d.label}</T>{d.isMock ? <MockPill /> : null}</View>
            <T size={21} w={800} lh={27} ls={-0.85} style={{ marginTop: 10 }} accessibilityRole="header">{d.title}</T>
            <T size={14} lh={21.5} style={{ marginTop: 6 }}>{d.desc}</T>
            {d.notice ? <View style={st.notice} accessibilityRole="alert"><Icon name="close" size={14} /><T size={12.5} w={600} lh={18} style={{ flex: 1 }}>{d.notice}</T></View> : null}
            {w.actions.renew ? <Btn label="30일 더 지켜보기" small onPress={() => act('renew')} style={{ alignSelf: 'flex-start', marginTop: 14 }} busy={busy} /> : null}
            {w.actions.resume && !w.actions.renew ? <Btn label="다시 지켜보기" small onPress={() => act('resume')} style={{ alignSelf: 'flex-start', marginTop: 14 }} busy={busy} /> : null}
            {d.key === 'met' && url ? <Btn label={`${w.product.seller || '판매처'}에서 보기`} small icon="ext" onPress={() => WebBrowser.openBrowserAsync(url).catch(() => {})} style={{ alignSelf: 'flex-start', marginTop: 14 }} /> : null}
          </View>
          <View style={st.price}>
            {L ? <>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Tag t={d.key === 'met' ? { kind: 'v', text: '조건 충족' } : L.meets ? { kind: 'o', text: '목표 가격 이하' } : { kind: 'p', text: '목표가 확인 중' }} />
                <Tag t={{ kind: L.stock === 'in_stock' ? 'o' : 'x', text: STOCK[L.stock || 'unknown'] || '재고 미확인' }} />
              </View>
              <T size={26} w={800} ls={-1} style={{ marginTop: 8, fontVariant: ['tabular-nums'] }}>{won(L.total)}</T>
              <T size={12.5} lh={18} color={C.gray500}>{L.shippingKnown ? `상품 ${won(L.price)} + 배송비 ${won(L.shipping)}` : `상품가 · 배송비 미확인`}{L.option ? ` · ${L.option}` : ''} · 원하는 가격 {won(w.conditions.targetPrice)}{w.conditions.priceBasis === 'item' ? '(배송비 제외)' : ''}</T>
              <Hair style={{ marginVertical: 12 }} />
            </> : null}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Mini k="마지막 확인" v={w.schedule.lastCheckedLabel || '아직 확인 전'} sub={w.source ? w.source.label : '상품 페이지 확인 중'} />
              <Mini k="다음 확인" v={w.schedule.nextCheckLabel || (w.status === 'paused' ? '멈춤' : '—')} sub={w.schedule.renewLabel ? `${w.schedule.renewLabel} 지켜봐요` : '하루 한 번'} />
            </View>
          </View>
          {w.product.pageTitle && !w.page.ok && d.key !== 'mismatch' ? <View style={st.notice} accessibilityRole="alert"><Icon name="close" size={14} /><T size={12.5} w={600} lh={18} style={{ flex: 1 }}>
            {w.page.note || '등록한 옷과 같은 상품 페이지인지 확인하고 있어요'}. 확인 전에는 가격 알림을 보내지 않아요.</T></View> : null}
          {(w.releases || []).map(r => (
            <View key={r.id} style={[st.notice, { backgroundColor: C.surface }]}><Icon name="bell" size={14} />
              <T size={12.5} w={600} lh={18} style={{ flex: 1 }}>{r.label}{r.note ? ` · ${r.note}` : ''}{r.status === 'scheduled' ? '\n재고·가격은 시작 후 확인해 따로 알려 드려요.' : ''}</T></View>
          ))}
        </View>

        {/* 1 · 탭 막대(스크롤해도 위에 붙음) — 고정 헤더는 바깥 View의 스타일을 가져가므로 한 겹 감싼다 */}
        <View><View style={st.tabs} accessibilityRole="tablist">
          {tabs.map(x => {
            const on = x.k === cur;
            return (
              <Pressable key={x.k} onPress={() => pick(x.k)} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${x.label}${x.n ? ` ${x.n}개` : ''}`}>
                <T size={14} w={on ? 800 : 600} color={on ? C.black : C.gray500} max={1.3} numberOfLines={1}>{x.label}{x.n ? <T size={12.5} w={700} color={on ? C.black : C.gray500}> {x.n}</T> : null}</T>
                <View style={[st.bar, on && { backgroundColor: C.black }]} />
              </Pressable>
            );
          })}
        </View></View>

        {/* 2 · 탭 내용 — 짧아도 탭 막대가 튀지 않게 최소 높이 */}
        <View style={{ minHeight: height - insets.top - 52 - 48 }}>
          {cur === 'price' ? <Section title="가격 기록" sub="확인한 그대로">
            {w.history.length ? w.history.map((h, i) => (
              <View key={h.at + '-' + i}>{i ? <Hair /> : null}
                <View style={st.hrow} accessible accessibilityLabel={`${h.label} ${h.ok ? `${won(h.total)} ${STOCK[h.stock || 'unknown'] || ''}` : `확인 못 함 ${h.error || ''}`}`}>
                  <T size={12.5} w={600} color={C.gray500} style={{ width: 112 }}>{h.label}</T>
                  {h.ok ? <View style={{ flex: 1 }}><T size={14} w={700} style={{ fontVariant: ['tabular-nums'] }}>{won(h.total)}{h.shippingKnown ? '' : ' *'}</T><T size={12} color={C.gray500}>{STOCK[h.stock || 'unknown'] || ''}{h.option ? ` · ${h.option}` : ''}{h.isMock ? ' · 모의' : ''}</T></View>
                    : <View style={{ flex: 1 }}><T size={14} w={700} color={C.gray500}>확인 못 함</T><T size={12} color={C.gray500}>{h.error}</T></View>}
                  {h.meets ? <Icon name="check" size={16} stroke={2.2} /> : null}
                </View>
              </View>
            )) : <T size={13.5} color={C.gray500} style={{ marginTop: 8 }}>아직 가격을 확인하지 않았어요.</T>}
            {w.history.some(h => h.ok && !h.shippingKnown) ? <T size={11.5} color={C.gray500} style={{ marginTop: 8 }}>* 배송비를 확인하지 못한 가격이에요. 최종 결제 금액과 다를 수 있어요.</T> : null}
            {w.product.pageTitle ? <T size={12} lh={18} color={C.gray500} style={{ marginTop: 14 }}>페이지에서 읽은 상품명: {w.product.pageTitle}{w.product.seller ? ` · ${w.product.seller}` : ''}</T> : null}
            {w.source && w.source.status !== 'SUPPORTED' && w.source.status !== 'TEST_ONLY' ? <T size={12} lh={18} color={C.gray500} style={{ marginTop: 6 }}>{w.source.label}: {w.source.reason}</T> : null}
          </Section> : null}

          {cur === 'offers' && dv ? <>
            <T size={12.5} lh={18} color={C.gray500} style={{ marginHorizontal: 20, marginTop: 18 }}>위 상품 페이지와 따로, 같은 상품을 파는 다른 판매처를 하루 한 번 찾아요. 왈프 팀이 확인한 곳만 보여 드려요.</T>
            {dv.enabled && dv.coverageNote ? <View style={{ marginHorizontal: 20, marginTop: 10, flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              {w.isMock ? <MockPill /> : <Icon name="search" size={14} stroke={2} color={C.gray500} />}<T size={12.5} lh={18} color={w.isMock ? C.black : C.gray500} style={{ flex: 1 }}>{dv.coverageNote}</T></View> : null}
            {dv.items.length ? dv.items.map(o => <OfferCard key={o.id} o={o} onOpen={() => opened(o.id)} extra={o.isNew ? [{ kind: 'p', text: '새로 찾음' } as TagT] : []}
                note={o.meetsTarget ? <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 8 }}><Icon name="check" size={14} stroke={2.4} /><T size={12.5} w={700} style={{ flex: 1 }}>{o.tier === 'exact' ? `원하는 조건 모두 확인 · ${won(w.conditions.targetPrice)} 이하` : `가격·옵션은 원하는 조건에 맞아요 · 같은 상품인지는 확정 전`}</T></View>
                  : o.targetNote ? <T size={12.5} lh={18} color={C.gray500} style={{ marginTop: 8 }}>{o.targetNote}</T> : null} />)
              : <View style={st.box}><T size={14} w={700}>{DISC_TITLE[dv.state]}</T><T size={12.5} lh={18} color={C.gray500} style={{ marginTop: 4 }}>{discDesc}</T></View>}
            {dv.enabled && (dv.lastLabel || dv.nextLabel) ? <T size={12} color={C.gray500} style={{ marginHorizontal: 20, marginTop: 10 }}>{[dv.lastLabel && `마지막 확인 ${dv.lastLabel}`, dv.nextLabel && `다음 확인 ${dv.nextLabel}`].filter(Boolean).join(' · ')}</T> : null}
            {w.actions.edit ? <View style={st.settings}>
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
                <T size={14} w={600} style={{ flex: 1 }}>새 판매처도 찾아보기</T>
                <Switch value={dv.enabled} disabled={busy} onValueChange={v => setDiscovery({ discovery: v })} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel="새 판매처도 찾아보기" />
              </View>
              {dv.enabled ? <Pressable onPress={() => setSrcOpen(!srcOpen)} accessibilityRole="button" accessibilityState={{ expanded: srcOpen }} hitSlop={8} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center' }}>
                <T size={14} w={600} style={{ flex: 1 }}>찾아볼 곳</T><T size={14} color={C.gray500}>{picked.length}곳 </T><Icon name="chev" size={16} color={C.gray500} /></Pressable> : null}
              {dv.enabled && srcOpen ? dv.sources.map(x => (
                <Pressable key={x.id} disabled={!x.usable || busy} onPress={() => setDiscovery({ discoverySources: x.selected ? picked.filter(i => i !== x.id) : [...picked, x.id] })}
                  style={st.src} accessibilityRole="checkbox" accessibilityState={{ checked: x.selected, disabled: !x.usable }} accessibilityLabel={`${x.label}. ${x.note}`}>
                  <View style={[st.check, x.selected && st.checkOn, !x.usable && { opacity: 0.35 }]}>{x.selected ? <Icon name="check" size={13} color={C.white} stroke={2.6} /> : null}</View>
                  <View style={{ flex: 1 }}><T size={13.5} w={600} color={x.usable ? C.black : C.gray500}>{x.label}</T>
                    <T size={11.5} lh={16} color={C.gray500} numberOfLines={2}>{x.note}</T></View>
                </Pressable>)) : null}
              <T size={11.5} lh={16} color={C.gray500} style={{ marginTop: 4 }}>{dv.note}</T>
            </View> : null}
          </> : null}

          {cur === 'similar' && av ? <>
            <T size={12.5} lh={18} color={C.gray500} style={{ marginHorizontal: 20, marginTop: 18 }}>같은 상품은 아니에요. 기다리는 동안 볼 수 있게 디자인이 비슷한 옷을 골라 봤어요.</T>
            {av.priorities?.length ? <PriorityPicker options={av.priorities} onPick={p => setDiscovery({ priority: p })} busy={busy} /> : null}
            {av.items.length ? av.items.map(o => <OfferCard key={o.id} o={o} onFeedback={k => feedback(o.id, k)} onOpen={() => opened(o.id)} footer={
              <Btn label={o.saved ? '저장함' : '저장'} kind={o.saved ? 'pri' : 'sec'} small onPress={() => toggleSave(o.id, !o.saved)} style={{ alignSelf: 'flex-start', marginTop: 10 }} a11y={o.saved ? '저장 해제' : '이 옷 저장'} />} />)
              : <View style={st.box}><T size={14} w={700}>비슷한 옷을 고르고 있어요</T><T size={12.5} color={C.gray500} style={{ marginTop: 4 }}>왈프 팀이 확인한 뒤 보여 드려요.</T></View>}
            <T size={12} color={C.gray500} style={{ marginHorizontal: 20, marginTop: 10 }}>{av.note}</T>
          </> : null}

          {cur === 'log' ? <Section title="기록">
            {w.events.map((e, i) => <View key={e.id}>{i ? <Hair /> : null}<ActRow a={{ id: e.id, at: e.at, clock: e.clock, group: '', actor: e.actor, kind: e.kind, title: e.title, detail: e.detail, isMock: e.isMock }} /></View>)}
          </Section> : null}
        </View>
      </ScrollView>

      <Modal visible={edit} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEdit(false)}>
        <View style={st.page}>
          <Header modal close title="조건 바꾸기" onBack={() => setEdit(false)} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
            <Field label="원하는 가격" value={price} onChangeText={v => setPrice(v.replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ','))} keyboardType="number-pad" suffix="원 이하" />
            <Field label="사이즈" value={size} onChangeText={setSize} autoCapitalize="characters" maxLength={20} placeholder="예: M" />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, minHeight: 44 }}>
              <View style={{ flex: 1 }}><T size={14} w={600}>배송비 빼고 비교</T><T size={12} color={C.gray500}>끄면 배송비까지 더한 금액으로 비교해요.</T></View>
              <Switch value={itemOnly} onValueChange={setItemOnly} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel="배송비 빼고 비교" />
            </View>
            <Btn label="저장" busy={busy} onPress={save} style={{ marginTop: 24 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

type TabKey = 'price' | 'offers' | 'similar' | 'log';
const Mini = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
  <View style={{ flex: 1 }}><T size={11.5} w={600} color={C.gray500}>{k}</T><T size={14} w={700} lh={20} style={{ marginTop: 2 }}>{v}</T>{sub ? <T size={12} color={C.gray500} numberOfLines={1}>{sub}</T> : null}</View>
);

const DISC_TITLE: Record<string, string> = { off: '새 판매처 찾기가 꺼져 있어요', unavailable: '찾아볼 수 있는 곳이 없어요', not_started: '곧 찾아볼게요', searching: '새 판매처를 찾고 있어요',
  reviewing: '왈프 팀이 찾은 곳을 확인하고 있어요', ready: '', none: '아직 새 판매처를 못 찾았어요', failed: '이번에는 확인하지 못했어요' };

const st = StyleSheet.create({
  box: { marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: R.card, backgroundColor: C.canvas },
  src: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8, minHeight: 44 },
  check: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.black, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: C.black },
  page: { flex: 1, backgroundColor: '#fff' },
  stm: { marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: C.surface },
  tabs: { flexDirection: 'row', backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.surface, paddingHorizontal: 12 },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { height: 2, alignSelf: 'stretch', marginHorizontal: 8, marginTop: 11, backgroundColor: 'transparent' },
  settings: { marginHorizontal: 20, marginTop: 18, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.surface },
  notice: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 12, padding: 10, borderRadius: R.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: C.black },
  price: { marginTop: 16, padding: 16, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 },
});
