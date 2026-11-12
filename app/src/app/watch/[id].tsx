import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Header } from '@/components/Header';
import { Field } from '@/components/Field';
import { ActRow, KV } from '@/components/Home';
import { Avatar, Btn, ErrorBox, Gap, Hair, Icon, Loading, MockBanner, MockPill, ProductImage, Section, T, Tag, TextBtn } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { call, ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';
import type { WatchView } from '@/lib/types';

const won = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('ko-KR')}원`);
const STOCK: Record<string, string> = { in_stock: '재고 있음', sold_out: '품절', unknown: '재고 미확인', option_missing: '원하는 옵션 없음' };

/** 기다려줘 상세 — 상태 문장 · 마지막 가격 · 가격 이력(확인 실패 포함) · 조건 바꾸기 · 멈춤/계속/끝내기 */
export default function WatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refresh } = useStore();
  const [w, setW] = useState<WatchView | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [price, setPrice] = useState(''); const [size, setSize] = useState('');
  const load = useCallback(() => { call<WatchView>('GET', `/watches/${id}`).then(x => { setW(x); setErr(null); }, setErr); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = (action: 'pause' | 'resume' | 'end' | 'renew', confirm?: [string, string, string]) => {
    const run = async () => {
      setBusy(true);
      try { setW(await call<WatchView>('POST', `/watches/${id}/${action}`)); refresh(); } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(false); }
    };
    if (!confirm) return run();
    Alert.alert(confirm[0], confirm[1], [{ text: '아니요', style: 'cancel' }, { text: confirm[2], style: 'destructive', onPress: run }]);
  };
  const save = async () => {
    setBusy(true);
    try { setW(await call<WatchView>('PATCH', `/watches/${id}`, { targetPrice: price.replace(/[^\d]/g, '') || undefined, size })); setEdit(false); refresh(); }
    catch (e: any) { Alert.alert('저장하지 못했어요', e.message); } finally { setBusy(false); }
  };

  if (err) return <View style={st.page}><Header back title="기다려줘" /><ErrorBox message={err.status === 404 ? '이 기다려줘를 찾을 수 없어요.' : err.message} onRetry={load} /></View>;
  if (!w) return <View style={st.page}><Header back title="기다려줘" /><Loading /></View>;
  const d = w.display, L = w.latest;
  return (
    <View style={st.page}>
      <Header back title="기다려줘" />
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.black} />}>
        <View style={{ paddingHorizontal: 20 }}>
          {w.isMock ? <MockBanner text="테스트용 모의 가격이에요. 실제 판매 가격이 아니에요." /> : null}
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 6 }}>
            <ProductImage uri={w.product.photoUrl} style={{ width: 64, height: 76, borderRadius: R.thumb }} label="기다리는 옷" compact />
            <View style={{ flex: 1 }}>
              {w.product.brand ? <T size={11.5} w={800} ls={0.5} numberOfLines={1}>{w.product.brand.toUpperCase()}</T> : null}
              <T size={16} w={700} lh={22} numberOfLines={2}>{w.product.title}</T>
              <T size={12.5} color={C.gray500} numberOfLines={2}>{w.conditions.label}</T>
            </View>
          </View>
          {/* 상태 문장 — 홈과 같은 형태 */}
          <View style={st.stm} accessibilityLiveRegion="polite">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Avatar quiet={['paused', 'ended'].includes(d.key)} /><T size={12.5} w={600} color={C.gray500} style={{ flex: 1 }}>{d.eyebrow || d.label}</T>{d.isMock ? <MockPill /> : null}</View>
            <T size={21} w={800} lh={27} ls={-0.85} style={{ marginTop: 10 }} accessibilityRole="header">{d.title}</T>
            <T size={14} lh={21.5} style={{ marginTop: 6 }}>{d.desc}</T>
            {d.notice ? <View style={st.notice} accessibilityRole="alert"><Icon name="close" size={14} /><T size={12.5} w={600} lh={18} style={{ flex: 1 }}>{d.notice}</T></View> : null}
            {w.actions.renew ? <Btn label="30일 더 지켜보기" small onPress={() => act('renew')} style={{ alignSelf: 'flex-start', marginTop: 14 }} busy={busy} /> : null}
            {d.key === 'met' && w.product.url ? <Btn label={`${w.product.seller || '판매처'}에서 보기`} small icon="ext" onPress={() => WebBrowser.openBrowserAsync(w.product.url!).catch(() => {})} style={{ alignSelf: 'flex-start', marginTop: 14 }} /> : null}
          </View>
          {L ? (
            <View style={st.price}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Tag t={L.meets ? { kind: 'v', text: '조건 충족' } : { kind: 'p', text: '목표가 확인 중' }} />
                <Tag t={{ kind: L.stock === 'in_stock' ? 'o' : 'x', text: STOCK[L.stock || 'unknown'] || '재고 미확인' }} />
              </View>
              <T size={26} w={800} ls={-1} style={{ marginTop: 8, fontVariant: ['tabular-nums'] }}>{won(L.total)}</T>
              <T size={12.5} color={C.gray500}>{L.shippingKnown ? `상품 ${won(L.price)} + 배송비 ${won(L.shipping)}` : `상품가 · 배송비 미확인`}{L.option ? ` · ${L.option}` : ''} · 원하는 가격 {won(w.conditions.targetPrice)}</T>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <KV k="마지막 확인" v={w.schedule.lastCheckedLabel || '아직 확인 전'} sub={w.source ? `${w.source.label}` : '상품 페이지 확인 중'} />
            <KV k="다음 확인" v={w.schedule.nextCheckLabel || (w.status === 'paused' ? '멈춤' : '—')} sub={w.schedule.renewLabel ? `${w.schedule.renewLabel} 지켜봐요` : undefined} />
          </View>
          {w.product.pageTitle ? <T size={12} color={C.gray500} style={{ marginTop: 10 }}>페이지에서 읽은 상품명: {w.product.pageTitle}{w.product.seller ? ` · ${w.product.seller}` : ''}</T> : null}
        </View>
        <Gap h={8} />
        <Section title="가격 기록" sub="확인한 그대로">
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
        </Section>
        <Gap h={8} />
        {w.actions.edit ? (
          <Section title="조건" right={edit ? '닫기' : '바꾸기'} onRight={() => { setEdit(!edit); setPrice(String(w.conditions.targetPrice).replace(/\B(?=(\d{3})+(?!\d))/g, ',')); setSize(w.conditions.size || ''); }}>
            {edit ? <>
              <Field label="원하는 가격" value={price} onChangeText={v => setPrice(v.replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ','))} keyboardType="number-pad" suffix="원 이하" />
              <Field label="사이즈" value={size} onChangeText={setSize} autoCapitalize="characters" maxLength={20} placeholder="예: M" />
              <Btn label="저장" busy={busy} onPress={save} style={{ marginTop: 14 }} />
            </> : <T size={13.5} style={{ marginTop: 6 }}>{w.conditions.label}</T>}
          </Section>
        ) : null}
        <Section title="기록">
          {w.events.map((e, i) => <View key={e.id}>{i ? <Hair /> : null}<ActRow a={{ id: e.id, at: e.at, clock: e.clock, group: '', actor: e.actor, kind: e.kind, title: e.title, detail: e.detail, isMock: e.isMock }} /></View>)}
        </Section>
        {w.source && w.source.status !== 'SUPPORTED' && w.source.status !== 'TEST_ONLY' ? <T size={12} color={C.gray500} style={{ paddingHorizontal: 20 }}>{w.source.label}: {w.source.reason}</T> : null}
        <View style={{ alignItems: 'center', paddingTop: 8, paddingHorizontal: 20, gap: 2 }}>
          {w.actions.pause ? <TextBtn label="잠시 멈추기" onPress={() => act('pause')} /> : null}
          {w.actions.resume ? <TextBtn label="다시 지켜보기" color={C.black} onPress={() => act('resume')} /> : null}
          {w.actions.end ? <TextBtn label="기다려줘 끝내기" onPress={() => act('end', ['기다려줘를 끝낼까요?', '가격 확인을 멈춰요. 기록은 남아 있어요.', '끝내기'])} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  stm: { marginTop: 22, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.surface },
  notice: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 12, padding: 10, borderRadius: R.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: C.black },
  price: { marginTop: 18, padding: 16, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11 },
});
