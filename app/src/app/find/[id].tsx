import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Header } from '@/components/Header';
import { Avatar, Btn, Empty, ErrorBox, Gap, Icon, Loading, MockBanner, MockPill, ProductImage, Section, T, Tag, TextBtn } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { call, ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';
import type { FindItem, FindView } from '@/lib/types';
import { OfferCard } from '@/components/OfferCard';
import { PriorityPicker } from '@/components/PriorityPicker';

/**
 * 찾아줘 결과 — 왈프 팀이 검수해 공개한 것만 보인다.
 * 맡긴 옷(원본) → 결과 세 갈래(정확히 찾음 · 유력 후보 · 못 찾음) → 판매처(같은 상품 확인 · 같은 상품일 수 있음) → 회색 띠: 비슷한 디자인의 옷 · 비슷한 스타일의 브랜드(같은 상품 아님).
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

  /** 이 옷으로 정하고 다음 일을 고른다(같은 옷 확인이면 버튼 한 번, 유력 후보는 “이 옷이 맞아요”로 한 번 더 묻는다) */
  const go = async (x: FindItem, next: 'hunt' | 'watch' | 'save') => {
    setBusy(true);
    try {
      const out = await call<{ productId: number }>('POST', `/requests/${id}/find/confirm`, { identityId: x.id, next });
      await refresh();
      if (next === 'hunt') router.replace('/');
      else if (next === 'watch') router.replace({ pathname: '/watch/new', params: { productId: String(out.productId), requestId: String(id), title: x.name, brand: x.brand || '', ...carry(x.tier === 'match') } });
      else load();
    } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(false); }
  };
  /** 기다려줘로 넘길 때 다시 묻지 않게: 맡길 때 적은 사이즈·색상, 같은 상품으로 확인된 판매 페이지(정확히 찾은 옷일 때만) */
  const carry = (exact: boolean) => ({ size: f?.original.size || '', color: f?.original.color || '', url: (exact && f?.sale.exact.find(o => o.url)?.url) || '' });
  const confirm = (x: FindItem) => Alert.alert('이 옷이 맞아요', '다음에 무엇을 할까요?', [
    ...(f?.canHunt ? [{ text: '7일 동안 매물 찾기', onPress: () => go(x, 'hunt') }] : []),
    { text: '원하는 가격 기다리기', onPress: () => go(x, 'watch') },
    { text: '저장만 하기', onPress: () => go(x, 'save') },
    { text: '취소', style: 'cancel' as const },
  ]);
  // 같은 옷을 확정하지 못했을 때: 맡긴 사진·정보로 기다려줘를 남겨 왈프 팀이 계속 찾는다(새 화면 없이 기다려줘 등록으로)
  const keepLooking = () => f && router.push({ pathname: '/watch/new', params: { requestId: String(id), title: f.original.name || '사진으로 맡긴 옷', brand: f.original.brand || '',
    size: f.original.size || '', color: f.original.color || '', keep: '1' } });
  const alts = f?.alternatives.items || [];
  // 추천 피드백·선호 — 열어 본 것은 만족으로 치지 않는다(서버에 행동 기록으로만)
  const feedback = async (offerId: number, kind: string) => { try { await call('POST', `/offers/${offerId}/feedback`, { kind }); load(); } catch (e: any) { Alert.alert('저장하지 못했어요', e.message); } };
  const opened = (offerId: number) => { call('POST', `/offers/${offerId}/open`).catch(() => {}); };
  const pick = async (p: string | null) => { setBusy(true); try { setF(await call<FindView>('POST', `/requests/${id}/priority`, { priority: p })); } catch (e: any) { Alert.alert('저장하지 못했어요', e.message); } finally { setBusy(false); } };
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
  // 같은 옷을 확정하지 못한 결과도 여기서 마칠 수 있어야 새 찾아줘를 맡길 수 있다(찾아줘는 한 번에 한 벌)
  const finish = () => Alert.alert('찾아줘를 여기서 마칠까요?', '결과와 기록은 추적함에 남아요. 마치면 새 옷을 맡길 수 있어요.', [
    { text: '아니요', style: 'cancel' },
    { text: '마치기', onPress: async () => {
      setBusy(true);
      try { await call('POST', `/requests/${id}/find/close`); await refresh(); router.replace('/'); } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(false); }
    } },
  ]);
  const confirmedItem = f ? [f.match, ...f.likely].find(x => x?.confirmed) || null : null;
  const hero = !f ? null : f.state === 'confirmed'
    ? { title: '이 옷으로 저장했어요', sub: confirmedItem?.tier === 'match' ? '왈프 팀이 같은 옷으로 확인한 결과예요.' : '직접 이 옷이 맞다고 골랐어요. 왈프 팀이 같은 상품으로 확정한 건 아니에요.' }
    : f.outcome === 'exact' ? { title: '같은 옷을 찾았어요', sub: `브랜드와 모델을 판매 페이지로 확인했어요.${f.match?.uncertain.length ? ' 확인하지 못한 부분도 함께 적었어요.' : ''}` }
    : f.outcome === 'likely' ? { title: '이 옷일 가능성이 높아요', sub: '확정하지는 못했어요. 맞는 점과 확인하지 못한 점을 나눠 적었어요.' }
    : { title: '같은 옷은 아직 못 찾았어요', sub: '확인하지 못한 브랜드나 모델은 적지 않았어요. 사진에서 읽은 것만 보여 드려요.' };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="찾아줘 결과" />
      {err ? <ErrorBox message={err.status === 404 ? '이 의뢰를 찾을 수 없어요.' : err.message} onRetry={load} /> : !f ? <Loading /> : f.state === 'pending' ? (
        <Empty title="왈프 팀이 확인하고 있어요" desc="AI가 먼저 살펴본 결과를 왈프 팀이 확인한 뒤 보여 드려요. 확인 전에는 결과를 보여 드리지 않아요." />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: TAB_SPACE }}>
          <View style={{ paddingHorizontal: 20 }}>
            {f.isMock ? <MockBanner text="테스트용 모의 결과예요. 실제 분석이 아니에요." /> : null}
            <Original o={f.original} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}><Avatar /><T size={12.5} w={600} color={C.gray500}>왈프 팀 확인 · {f.publishedLabel}</T></View>
            <T size={24} w={800} lh={31} ls={-1} style={{ marginTop: 10 }} accessibilityRole="header">{hero!.title}</T>
            <T size={14} lh={21} color={C.gray500} style={{ marginTop: 4 }}>{hero!.sub}</T>
          </View>

          {/* 정확히 찾음: 상품 사진·근거·다음 행동을 한 화면에서(확인 창 없이) */}
          {f.match ? <Card x={f.match} busy={busy} actions={f.state === 'ready' ? <>
            <Btn label="원하는 가격 기다리기" busy={busy} onPress={() => go(f.match!, 'watch')} style={{ marginTop: 14 }} />
            {f.canHunt ? <Btn label="7일 동안 매물 찾기" kind="sec" busy={busy} onPress={() => go(f.match!, 'hunt')} style={{ marginTop: 8 }} /> : null}
            <TextBtn label="저장만 하기" center onPress={() => go(f.match!, 'save')} />
          </> : undefined} /> : null}
          {/* 유력 후보: 맞는 점·확인 못 한 점, 고르려면 한 번 더 묻는다 */}
          {f.likely.map(x => <Card key={x.id} x={x} busy={busy} actions={f.state === 'ready' ? <Btn label="이 옷이 맞아요" kind="sec" busy={busy} onPress={() => confirm(x)} style={{ marginTop: 12 }} /> : undefined} />)}
          {f.state === 'confirmed' && confirmedItem ? (
            <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
              <Btn label="원하는 가격 기다리기" onPress={() => router.push({ pathname: '/watch/new', params: { productId: String(f.productId ?? ''), requestId: String(id), title: confirmedItem.name, brand: confirmedItem.brand || '', ...carry(confirmedItem.tier === 'match') } })} />
            </View>
          ) : null}
          {/* 못 찾음: 어디까지 파악했는지 */}
          {f.outcome === 'not_found' ? <Understood u={f.understood} /> : null}
          {/* 확정하지 못했으면 계속 찾기 */}
          {f.state === 'ready' && f.outcome !== 'exact' ? (
            <View style={s.keep}>
              <T size={15} w={800}>같은 옷을 계속 찾아 드릴까요?</T>
              <T size={12.5} lh={18} color={C.gray500} style={{ marginTop: 4 }}>원하는 가격과 사이즈를 정해 두면 왈프 팀이 맡긴 사진으로 계속 찾아요. 같은 옷이 나타나면 알려 드려요.</T>
              <Btn label="계속 찾아 주세요" kind={f.outcome === 'not_found' ? 'pri' : 'sec'} small onPress={keepLooking} style={{ marginTop: 12 }} />
              <TextBtn label="여기서 마치고 새 옷 맡기기" center onPress={finish} />
            </View>
          ) : null}

          {identified ? <>
            <Gap h={8} />
            <Head title="판매처" sub="같은 상품을 파는 곳" desc="실제로 파는 곳 중 왈프 팀이 확인한 것만 보여 드려요." />
            {f.sale.coverage ? <Scope kind={f.sale.coverage.kind} text={f.sale.coverage.note} /> : null}
            {saleCards.length && f.sale.dataKind !== 'real' && f.sale.coverage?.kind !== 'test' ? <DataLine kind={f.sale.dataKind} /> : null}
            {saleCards.length ? <>
              {f.sale.exact.map(o => <OfferCard key={o.id} o={o} onOpen={() => opened(o.id)} />)}
              {f.sale.possible.map(o => <OfferCard key={o.id} o={o} onOpen={() => opened(o.id)} />)}
            </> : <View style={[s.note, { marginTop: 12 }]}><T size={14} w={700}>{SALE_TITLE[f.sale.state]}</T><T size={12.5} lh={18} color={C.gray500} style={{ marginTop: 4 }}>{saleDesc}</T></View>}
            {saleCards.length || f.sale.state === 'none' ? <T size={12} lh={17} color={C.gray500} style={{ marginHorizontal: 20, marginTop: 10 }}>{f.sale.note}</T> : null}
          </> : null}

          {/* 대체 추천 — 원본·판매처와 다른 바탕으로 묶어 “같은 상품 아님”을 한눈에 */}
          {alts.length || ['searching', 'reviewing'].includes(f.alternatives.state) || f.discover.length ? (
            <View style={s.band}>
              {alts.length || ['searching', 'reviewing'].includes(f.alternatives.state) ? <>
                <Head title="비슷한 디자인의 옷" sub="같은 상품 아님" desc={`${!saleCards.length && identified ? '같은 옷을 파는 곳을 아직 못 찾았어요. ' : ''}실루엣·디테일·소재가 비슷한 순서예요.`} />
                {f.priorities?.length ? <PriorityPicker options={f.priorities} onPick={pick} busy={busy} /> : null}
                {alts.length && f.alternatives.dataKind !== 'real' ? <DataLine kind={f.alternatives.dataKind} /> : null}
                {alts.length ? alts.map(o => <OfferCard key={o.id} o={o} onFeedback={k => feedback(o.id, k)} onOpen={() => opened(o.id)} />) : <View style={[s.note, { backgroundColor: C.white }]}><T size={14} w={700}>비슷한 옷을 고르고 있어요</T><T size={12.5} color={C.gray500} style={{ marginTop: 4 }}>왈프 팀이 확인한 뒤 보여 드려요.</T></View>}
              </> : null}
              {f.discover.length ? (
                <Section title="비슷한 스타일의 브랜드" sub="브랜드 추천 · 같은 상품 아님">
                  <T size={12.5} color={C.gray500} style={{ marginTop: 6 }}>브랜드 단위 추천이에요. 판매 중인 상품을 고른 건 아니에요.</T>
                  {f.discover.map(x => (
                    <View key={x.id} style={s.disc}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><T size={15} w={800} style={{ flex: 1 }}>{x.name}</T><Tag t={{ kind: 'x', text: '같은 상품 아님' }} /></View>
                      <T size={13} lh={19} style={{ marginTop: 4 }}>{x.matched.map(m => m.text).join(' · ')}</T>
                      {x.note ? <T size={12} color={C.gray500} style={{ marginTop: 2 }}>{x.note}</T> : null}
                      {x.evidence[0] ? <TextBtn label={`스타일 근거 보기 · ${x.evidence[0].host}`} onPress={() => WebBrowser.openBrowserAsync(x.evidence[0].url).catch(() => {})} /> : null}
                    </View>
                  ))}
                </Section>
              ) : null}
            </View>
          ) : null}
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

/** 맡긴 원본 — 사용자가 올린 사진과 적은 정보. 판매처·추천 카드와 섞이지 않게 맨 위 회색 바탕에 */
function Original({ o }: { o: FindView['original'] }) {
  const meta = [o.brand, o.size, o.color].filter(Boolean).join(' · ');
  return (
    <View style={s.original} accessibilityLabel={`맡긴 옷: ${o.name || '사진으로 맡긴 옷'}${meta ? `, ${meta}` : ''}`}>
      <ProductImage uri={o.photoUrl} style={{ width: 64, height: 76, borderRadius: R.thumb }} label="맡긴 옷 사진" compact />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={11.5} w={700} color={C.gray500}>맡긴 옷</T>
        <T size={15} w={700} lh={21} style={{ marginTop: 2 }} numberOfLines={2}>{o.name || '사진으로 맡긴 옷'}</T>
        {meta ? <T size={12.5} color={C.gray500} style={{ marginTop: 2 }} numberOfLines={1}>{meta}</T> : null}
      </View>
    </View>
  );
}

/** 같은 옷을 못 찾았을 때 — 사진에서 읽은 것과 아직 모르는 것(만들어 낸 브랜드·모델 없이) */
function Understood({ u }: { u: FindView['understood'] }) {
  return (
    <View style={[s.note, { marginTop: 16 }]}>
      <T size={12} w={700}>사진에서 읽은 것</T>
      {u.known.length ? <View style={s.chips}>{u.known.map(k => <View key={k} style={s.chip}><T size={12.5} w={600}>{k}</T></View>)}</View>
        : <T size={12.5} color={C.gray500} style={{ marginTop: 4 }}>사진에서 읽은 특징이 아직 없어요.</T>}
      {u.unknown.length ? <>
        <T size={12} w={700} style={{ marginTop: 12 }}>아직 모르는 것</T>
        <T size={12.5} lh={18} color={C.gray500} style={{ marginTop: 2 }}>{u.unknown.join(' · ')} — 태그·케어라벨 사진이 있으면 찾는 데 도움이 돼요.</T>
      </> : null}
    </View>
  );
}

/** 어디서 찾아봤는지 — 실제 판매처가 몇 곳뿐인지, 테스트 판매처뿐인지 숨기지 않는다 */
function Scope({ kind, text }: { kind: 'real' | 'test' | 'none'; text: string }) {
  return (
    <View style={s.scope} accessibilityLabel={`찾아본 곳: ${text}`}>
      {kind === 'test' ? <MockPill /> : <Icon name="search" size={14} stroke={2} color={C.gray500} />}
      <T size={12.5} lh={18} color={kind === 'test' ? C.black : C.gray500} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}
/** 카드가 테스트 데이터인지 — 실제 판매 상품과 섞여 보이지 않게 */
function DataLine({ kind }: { kind: 'test' | 'real' | 'mixed' | null }) {
  if (!kind || kind === 'real') return null;
  return <View style={[s.scope, { marginTop: 6 }]}><MockPill /><T size={12.5} lh={18} style={{ flex: 1 }}>{kind === 'test' ? '아래는 모두 테스트 데이터예요. 실제 판매 상품이 아니에요.' : '테스트 데이터가 섞여 있어요. “모의” 표시가 있는 카드는 실제 판매 상품이 아니에요.'}</T></View>;
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

function Card({ x, busy, actions }: { x: FindItem; busy: boolean; actions?: React.ReactNode }) {
  const facts = [['품번', x.modelCode], ['시즌', x.season], ['색상', x.color], ['종류', x.category]].filter(([, v]) => v) as [string, string][];
  return (
    <View style={s.card}>
      {x.image ? <View style={{ marginBottom: 12 }}>
        <ProductImage uri={x.image} style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: R.thumb }} label={`${x.name} 판매처 사진`} />
        <T size={11.5} color={C.gray500} style={{ marginTop: 4 }}>판매처 사진 · 맡긴 사진이 아니에요</T>
      </View> : null}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Tag t={x.tier === 'match' ? { kind: 'v', text: '같은 옷 확인' } : { kind: 'o', text: '유력 후보' }} />
        {x.confirmed ? <Tag t={{ kind: 'v', text: '내가 확인함' }} /> : null}
      </View>
      {x.brand ? <T size={11.5} w={800} ls={0.5} style={{ marginTop: 10 }} numberOfLines={1}>{x.brand.toUpperCase()}</T> : null}
      <T size={17} w={700} lh={24} ls={-0.4} style={{ marginTop: 2 }}>{x.name}</T>
      {facts.length ? <T size={12.5} color={C.gray500} style={{ marginTop: 3 }}>{facts.map(([k, v]) => `${k} ${v}`).join(' · ')}</T> : null}
      {x.matched.length ? <View style={{ marginTop: 12, gap: 6 }}>
        <T size={12} w={700}>{x.tier === 'match' ? '확인한 근거' : '맞는 점'}</T>
        {x.matched.map((m, i) => (
          <View key={i} style={s.attr}><Icon name="check" size={15} stroke={2.2} /><T size={13} lh={19} style={{ flex: 1 }}>{m.label ? <T size={13} w={700}>{m.label} </T> : null}{m.text}</T></View>
        ))}</View> : null}
      {x.uncertain.length ? <View style={s.unsure}>
        <T size={12} w={700}>아직 확인하지 못한 것</T>
        {x.uncertain.map((m, i) => <T key={i} size={12.5} lh={18} color={C.gray500}>{m.label ? `${m.label} · ` : ''}{m.text}</T>)}
      </View> : null}
      {x.evidence.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>{x.evidence.map(e => (
        <TextBtn key={e.url} label={`근거 페이지 · ${e.host}`} onPress={() => WebBrowser.openBrowserAsync(e.url).catch(() => {})} />
      ))}</View> : null}
      {actions}
    </View>
  );
}

const SALE_TITLE: Record<string, string> = { not_started: '판매처는 아직 찾지 않았어요', searching: '판매처를 찾고 있어요', reviewing: '왈프 팀이 판매처를 확인하고 있어요', ready: '', none: '확인한 판매처에서는 아직 못 찾았어요', failed: '이번에는 판매처를 확인하지 못했어요' };

const s = StyleSheet.create({
  note: { marginHorizontal: 20, padding: 14, borderRadius: R.card, backgroundColor: C.canvas },
  scope: { marginHorizontal: 20, marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  card: { marginHorizontal: 20, marginTop: 18, padding: 16, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
  attr: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  unsure: { marginTop: 12, padding: 10, gap: 3, borderRadius: R.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: C.gray500 },
  disc: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.gray300 },
  original: { marginTop: 8, padding: 12, borderRadius: R.card, backgroundColor: C.canvas, flexDirection: 'row', gap: 12, alignItems: 'center' },
  keep: { marginHorizontal: 20, marginTop: 16, padding: 16, borderRadius: R.card, borderWidth: 1, borderColor: C.black },
  band: { marginTop: 24, paddingBottom: 18, backgroundColor: C.canvas },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill, backgroundColor: C.white, borderWidth: 1, borderColor: C.gray300 },
});
