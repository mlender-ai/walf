import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Header } from '@/components/Header';
import { Avatar, Btn, Empty, ErrorBox, Gap, Icon, Loading, MockBanner, Section, T, Tag, TextBtn } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { call, ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';
import type { FindItem, FindView } from '@/lib/types';
import { OfferCard } from '@/components/OfferCard';

/**
 * 찾아줘 결과 — 왈프 팀이 검수해 공개한 것만 보인다.
 * 어떤 옷인지(MATCH·LIKELY) → 판매처(같은 상품 확인 · 같은 상품일 수 있음) → 비슷한 디자인의 옷(같은 상품 아님) → 비슷한 스타일의 브랜드.
 * 같은 옷을 못 찾았거나 판매처가 없으면 비슷한 디자인으로 이어진다. 가격·재고는 페이지를 읽은 시각 기준이라 “구매 가능”이라고 말하지 않는다.
 */
export default function FindResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refresh } = useStore();
  const [f, setF] = useState<FindView | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { call<FindView>('GET', `/requests/${id}/find`).then(x => { setF(x); setErr(null); }, setErr); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirm = (x: FindItem) => {
    const go = async (next: 'hunt' | 'watch' | 'save') => {
      setBusy(true);
      try {
        const out = await call<{ productId: number }>('POST', `/requests/${id}/find/confirm`, { identityId: x.id, next });
        await refresh();
        if (next === 'hunt') router.replace('/');
        else if (next === 'watch') router.replace({ pathname: '/watch/new', params: { productId: String(out.productId), requestId: String(id), title: x.name, brand: x.brand || '' } });
        else router.back();
      } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(false); }
    };
    Alert.alert('이 옷이 맞아요', '다음에 무엇을 할까요?', [
      ...(f?.canHunt ? [{ text: '7일 동안 매물 찾기', onPress: () => go('hunt') }] : []),
      { text: '원하는 가격 기다리기', onPress: () => go('watch') },
      { text: '저장만 하기', onPress: () => go('save') },
      { text: '취소', style: 'cancel' as const },
    ]);
  };
  const alts = f?.alternatives.items || [];
  const saleCards = f ? [...f.sale.exact, ...f.sale.possible] : [];
  const identified = !!(f?.match || f?.likely.length);
  const saleDesc = !f ? '' : f.sale.state === 'none' ? `${f.sale.searchedSources.length ? `${f.sale.searchedSources.join(' · ')}에서 찾아봤어요.` : ''} 다른 판매처는 아직 자동으로 확인하지 못해요.`.trim()
    : f.sale.state === 'failed' ? '판매처에 연결하지 못했어요. 매물이 없다는 뜻은 아니에요.'
    : f.sale.state === 'not_started' ? '판매처 탐색을 아직 시작하지 않았어요. 7일 매물 찾기를 고르면 왈프 팀이 직접 살펴봐요.'
    : '찾은 판매처는 왈프 팀이 같은 상품인지 확인한 뒤 보여 드려요.';
  const reject = () => Alert.alert('찾던 옷이 아닌가요?', '왈프 팀이 다시 확인할게요. 7일 탐색은 시작하지 않아요.', [
    { text: '아니요', style: 'cancel' },
    { text: '찾던 옷이 아니에요', style: 'destructive', onPress: async () => {
      setBusy(true);
      try { await call('POST', `/requests/${id}/find/reject`, { reason: '' }); await refresh(); load(); } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(false); }
    } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="찾아줘 결과" />
      {err ? <ErrorBox message={err.status === 404 ? '이 의뢰를 찾을 수 없어요.' : err.message} onRetry={load} /> : !f ? <Loading /> : f.state === 'pending' ? (
        <Empty title="왈프 팀이 확인하고 있어요" desc="AI가 먼저 살펴본 결과를 왈프 팀이 확인한 뒤 보여 드려요. 확인 전에는 결과를 보여 드리지 않아요." />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }}>
          <View style={{ paddingHorizontal: 20 }}>
            {f.isMock ? <MockBanner text="테스트용 모의 결과예요. 실제 분석이 아니에요." /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}><Avatar /><T size={12.5} w={600} color={C.gray500}>왈프 팀 확인 · {f.publishedLabel}</T></View>
            <T size={24} w={800} lh={31} ls={-1} style={{ marginTop: 10 }} accessibilityRole="header">
              {f.state === 'confirmed' ? '이 옷으로 저장했어요' : f.match ? '같은 옷을 찾았어요' : f.likely.length ? '이 옷일 가능성이 높아요' : '같은 옷은 아직 못 찾았어요'}
            </T>
            <T size={14} lh={21} color={C.gray500} style={{ marginTop: 4 }}>
              {f.match ? '브랜드와 모델을 페이지로 확인했어요. 확인하지 못한 부분도 함께 적었어요.' : f.likely.length ? '비슷한 디자인의 다른 옷일 수 있어요. 확인한 것과 못 한 것을 나눠 적었어요.'
                : alts.length ? '대신 비슷한 디자인의 옷을 골라 뒀어요. 같은 상품이라는 뜻은 아니에요.' : '대신 비슷한 스타일의 브랜드를 골라 뒀어요. 같은 상품이라는 뜻은 아니에요.'}
            </T>
          </View>
          {f.match ? <Card x={f.match} onConfirm={f.state === 'ready' ? () => confirm(f.match!) : undefined} busy={busy} /> : null}
          {f.likely.map(x => <Card key={x.id} x={x} onConfirm={f.state === 'ready' ? () => confirm(x) : undefined} busy={busy} />)}
          {identified ? <>
            <Gap h={8} />
            <Head title="판매처" sub="같은 상품을 파는 곳" desc="실제로 파는 곳 중 왈프 팀이 확인한 것만 보여 드려요." />
            {saleCards.length ? <>
              {f.sale.exact.map(o => <OfferCard key={o.id} o={o} />)}
              {f.sale.possible.map(o => <OfferCard key={o.id} o={o} />)}
            </> : <View style={s.note}><T size={14} w={700}>{SALE_TITLE[f.sale.state]}</T><T size={12.5} lh={18} color={C.gray500} style={{ marginTop: 4 }}>{saleDesc}</T></View>}
            {saleCards.length || f.sale.state === 'none' ? <T size={12} lh={17} color={C.gray500} style={{ marginHorizontal: 20, marginTop: 10 }}>{f.sale.note}</T> : null}
          </> : null}
          {alts.length || ['searching', 'reviewing'].includes(f.alternatives.state) ? <>
            <Gap h={8} />
            <Head title="비슷한 디자인의 옷" sub="같은 상품 아님" desc={`${!saleCards.length && identified ? '같은 옷을 파는 곳을 아직 못 찾았어요. 디자인이 비슷한 옷도 살펴볼까요? ' : ''}실루엣·디테일·소재가 비슷한 순서예요.`} />
            {alts.length ? alts.map(o => <OfferCard key={o.id} o={o} />) : <View style={s.note}><T size={14} w={700}>비슷한 옷을 고르고 있어요</T><T size={12.5} color={C.gray500} style={{ marginTop: 4 }}>왈프 팀이 확인한 뒤 보여 드려요.</T></View>}
          </> : null}
          {f.discover.length ? <>
            <Gap />
            <Section title="비슷한 스타일의 브랜드" sub="브랜드 추천 · 같은 상품 아님">
              <T size={12.5} color={C.gray500} style={{ marginTop: 6 }}>브랜드 단위 추천이에요. 판매 중인 상품을 고른 건 아니에요.</T>
              {f.styleWords.length ? <T size={12.5} color={C.gray500} style={{ marginTop: 2 }}>사진에서 본 특징: {f.styleWords.join(' · ')}</T> : null}
              {f.discover.map(x => (
                <View key={x.id} style={s.disc}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><T size={15} w={800} style={{ flex: 1 }}>{x.name}</T><Tag t={{ kind: 'x', text: '같은 상품 아님' }} /></View>
                  <T size={13} lh={19} style={{ marginTop: 4 }}>{x.matched.map(m => m.text).join(' · ')}</T>
                  {x.note ? <T size={12} color={C.gray500} style={{ marginTop: 2 }}>{x.note}</T> : null}
                  {x.evidence[0] ? <TextBtn label={`스타일 근거 보기 · ${x.evidence[0].host}`} onPress={() => WebBrowser.openBrowserAsync(x.evidence[0].url).catch(() => {})} /> : null}
                </View>
              ))}
            </Section>
          </> : null}
          {f.state === 'ready' && (f.match || f.likely.length) ? (
            <View style={{ alignItems: 'center', paddingTop: 12, paddingHorizontal: 20 }}>
              <TextBtn label="찾던 옷이 아니에요" onPress={reject} />
              <T size={12} color={C.gray500} style={{ marginTop: -4, textAlign: 'center' }}>왈프 팀이 다시 확인해요. 태그·케어라벨 사진이 있으면 더 정확해요.</T>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/** 구역 제목 — 아래 카드와 붙어 보이게 아래 여백을 줄였다 */
function Head({ title, sub, desc }: { title: string; sub: string; desc: string }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T size={17} w={800} ls={-0.5} accessibilityRole="header">{title}</T><T size={12.5} color={C.gray500}>{sub}</T>
      </View>
      <T size={12.5} lh={18} color={C.gray500} style={{ marginTop: 6 }}>{desc}</T>
    </View>
  );
}

function Card({ x, onConfirm, busy }: { x: FindItem; onConfirm?: () => void; busy: boolean }) {
  const facts = [['품번', x.modelCode], ['시즌', x.season], ['색상', x.color], ['종류', x.category]].filter(([, v]) => v) as [string, string][];
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Tag t={x.tier === 'match' ? { kind: 'v', text: '같은 옷 확인' } : { kind: 'o', text: '유력 후보' }} />
        {x.confirmed ? <Tag t={{ kind: 'v', text: '내가 확인함' }} /> : null}
      </View>
      {x.brand ? <T size={11.5} w={800} ls={0.5} style={{ marginTop: 10 }} numberOfLines={1}>{x.brand.toUpperCase()}</T> : null}
      <T size={17} w={700} lh={24} ls={-0.4} style={{ marginTop: 2 }}>{x.name}</T>
      {facts.length ? <T size={12.5} color={C.gray500} style={{ marginTop: 3 }}>{facts.map(([k, v]) => `${k} ${v}`).join(' · ')}</T> : null}
      {x.matched.length ? <View style={{ marginTop: 12, gap: 6 }}>{x.matched.map((m, i) => (
        <View key={i} style={s.attr}><Icon name="check" size={15} stroke={2.2} /><T size={13} lh={19} style={{ flex: 1 }}>{m.label ? <T size={13} w={700}>{m.label} </T> : null}{m.text}</T></View>
      ))}</View> : null}
      {x.uncertain.length ? <View style={s.unsure}>
        <T size={12} w={700}>아직 확인하지 못한 것</T>
        {x.uncertain.map((m, i) => <T key={i} size={12.5} lh={18} color={C.gray500}>{m.label ? `${m.label} · ` : ''}{m.text}</T>)}
      </View> : null}
      {x.evidence.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>{x.evidence.map(e => (
        <TextBtn key={e.url} label={`근거 페이지 · ${e.host}`} onPress={() => WebBrowser.openBrowserAsync(e.url).catch(() => {})} />
      ))}</View> : null}
      {onConfirm ? <Btn label="이 옷이 맞아요" busy={busy} onPress={onConfirm} style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

const SALE_TITLE: Record<string, string> = { not_started: '판매처는 아직 찾지 않았어요', searching: '판매처를 찾고 있어요', reviewing: '왈프 팀이 판매처를 확인하고 있어요', ready: '', none: '확인한 판매처에서는 아직 못 찾았어요', failed: '이번에는 판매처를 확인하지 못했어요' };

const s = StyleSheet.create({
  note: { marginHorizontal: 20, padding: 14, borderRadius: R.card, backgroundColor: C.canvas },
  card: { marginHorizontal: 20, marginTop: 18, padding: 16, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
  attr: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  unsure: { marginTop: 12, padding: 10, gap: 3, borderRadius: R.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: C.gray500 },
  disc: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.surface },
});
