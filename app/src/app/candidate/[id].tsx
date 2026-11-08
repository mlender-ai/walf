import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Image, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Btn, DOG, ErrorBox, Icon, Loading, MockBanner, ProductImage, T, Tags, TextBtn } from '@/components/ui';
import { call, ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';
import type { Candidate } from '@/lib/types';

type Resp = { candidate: Candidate; request: { id: number; status: string; title: string; brand: string | null; isMock: boolean } };

/** S06 매물 발견 결과 — 같은 화면, 확인 전(유력 후보)과 후(구매 가능 확인)는 배지·가격·버튼 무게가 다르다 */
export default function CandidateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bottom } = useSafeAreaInsets();
  const { refresh } = useStore();
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const askOnReturn = useRef(false);
  const load = useCallback(() => { call<Resp>('GET', `/candidates/${id}`).then(x => { setD(x); setErr(null); }, setErr); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 외부 판매처에서 돌아오면 구매 여부를 묻는다 — 링크를 연 것만으로 구매 완료로 보지 않는다(PRD 2.5)
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active' && askOnReturn.current) { askOnReturn.current = false; askPurchase(); } });
    return () => sub.remove();
  });
  const askPurchase = () => {
    if (!d || d.request.status !== 'active') return;
    Alert.alert('구매하셨나요?', '샀다면 탐색과 수배를 멈출게요.', [
      { text: '아직이요', style: 'cancel' },
      { text: '샀어요', onPress: async () => {
        try { await call('POST', `/requests/${d.request.id}/purchase`, { candidateId: d.candidate.id }); await refresh(); router.dismissAll(); }
        catch (e: any) { Alert.alert('처리하지 못했어요', e.message); }
      } },
    ]);
  };
  const openSeller = async (c: Candidate) => {
    if (!c.url) return;
    askOnReturn.current = c.kind === 'offer';
    const res = await WebBrowser.openBrowserAsync(c.url).catch(() => null);
    if (res && askOnReturn.current) { askOnReturn.current = false; askPurchase(); } // 인앱 브라우저를 닫고 돌아온 경우
  };
  const dismiss = (c: Candidate) => Alert.alert('이 매물은 넘길까요?', '추적함의 “조건이 맞지 않았어요”로 옮기고 계속 찾아요.', [
    { text: '취소', style: 'cancel' },
    { text: '넘기기', onPress: async () => { try { await call('POST', `/candidates/${c.id}/dismiss`); await refresh(); router.back(); } catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } } },
  ]);

  if (err) return <View style={{ flex: 1, backgroundColor: '#fff' }}><Header back title="발견한 매물" /><ErrorBox message={err.status === 404 ? '이 매물은 더 이상 볼 수 없어요.' : err.message} onRetry={load} /></View>;
  if (!d) return <View style={{ flex: 1, backgroundColor: '#fff' }}><Header back title="발견한 매물" /><Loading /></View>;
  const c = d.candidate, ok = c.kind === 'offer', active = d.request.status === 'active';
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="발견한 매물" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        {c.isMock ? <MockBanner text="테스트용 모의 매물이에요. 실제 판매 중인 상품이 아니에요." /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', minHeight: 96, paddingBottom: 12, gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T size={ok ? 24 : 22} w={800} lh={30} ls={-1.05} accessibilityRole="header">{ok ? c.headline : c.kind === 'lead' ? c.headline : '확인한 매물'}</T>
            <T size={13.5} color={C.gray500} lh={19.5} style={{ marginTop: 4 }}>{ok ? c.sub : c.kind === 'lead' ? c.sub : c.reasons.join(' · ') || c.budgetLabel}</T>
          </View>
          {/* M04·M05 발견 모션이 멈추는 자리 — 지금은 출발 GIF 1프레임 */}
          <View style={{ width: 84, height: 96, overflow: 'hidden', marginBottom: -12 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Image source={DOG.stand} style={{ width: 230, height: 229, position: 'absolute', left: -76, top: -8 }} />
          </View>
        </View>
        <View>
          <ProductImage uri={c.photoUrl} style={{ height: c.photoUrl ? 320 : 140 }} label="판매자가 올린 사진" emptyText="판매자 사진이 아직 없어요" />
          {c.photoUrl ? <View style={{ position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(17,17,17,0.62)', borderRadius: R.tag, paddingHorizontal: 7, paddingVertical: 4 }}><T size={11} w={700} color={C.white} max={1.2} lh={13}>판매자 사진</T></View> : null}
        </View>
        <Tags tags={c.tags} style={{ marginTop: 14 }} />
        <View style={{ marginTop: 12 }}>
          {d.request.brand ? <T size={11.5} w={800} ls={0.5}>{d.request.brand.toUpperCase()}</T> : null}
          <T size={17} w={600} lh={24} numberOfLines={3} style={{ marginTop: 3 }}>{c.title || d.request.title}</T>
          <T size={13} color={C.gray500} style={{ marginTop: 3 }}>{[c.size, c.conditionLabel].filter(Boolean).join(' · ')}</T>
        </View>
        <View style={{ marginTop: 16 }} accessible accessibilityLabel={`${ok ? '' : '판매자가 적은 가격, 아직 확인 전. '}${c.priceLabel}. ${c.totalLabel}. ${c.budgetLabel}`}>
          <T size={28} w={800} lh={32} ls={-1.1} color={ok ? C.black : C.gray500} max={1.3}>{c.priceLabel}</T>
          <T size={13} color={C.gray500} style={{ marginTop: 6 }}>{ok ? c.totalLabel : `판매자가 적은 가격 · ${c.totalLabel || '배송비 미확인'} · 아직 확인 전`}</T>
          {ok && c.budgetLabel ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}><Icon name="check" size={16} /><T size={13.5} w={700}>{c.budgetLabel}</T></View> : null}
        </View>
        {ok ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
            {c.checks.map(k => (
              <View key={k.label} style={{ width: '48.5%', flexGrow: 1, padding: 12, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 }}>
                <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Icon name={k.ok ? 'check' : 'close'} size={14} /><T size={11.5} w={600} color={C.gray500}>{k.label}</T></View>
                <T size={13.5} w={700} style={{ marginTop: 2 }}>{k.value}</T>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ marginTop: 28 }}>
          <T size={16} w={800} ls={-0.5} accessibilityRole="header">{ok ? '왈프 팀이 이렇게 확인했어요' : '지금까지 확인한 것'}</T>
          {c.evidence.length ? c.evidence.map((e, i) => <Ev key={i} text={e} done />) : <T size={13} color={C.gray500} style={{ marginTop: 8 }}>아직 확인을 마친 항목이 없어요.</T>}
          {!ok && c.pending.length ? <>
            <T size={16} w={800} ls={-0.5} style={{ marginTop: 20 }} accessibilityRole="header">아직 확인 중인 것</T>
            {c.pending.map((e, i) => <Ev key={i} text={e} />)}
          </> : null}
          <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: C.surface, paddingTop: 6 }}>
            {[['판매처', `${c.seller} · ${c.condition === 'new' ? '새 상품' : '개인 판매'}`], ['찾은 경로', c.sourceLabel], [ok ? '확인 시각' : '공개 시각', (ok ? c.checkedLabel : c.publishedLabel) || '—']].map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', paddingVertical: 8 }}><T size={13} color={C.gray500} style={{ width: 72 }}>{k}</T><T size={13} w={600} style={{ flex: 1 }}>{v}</T></View>
            ))}
          </View>
        </View>
        <View style={{ marginTop: 22, padding: 14, borderRadius: R.card, backgroundColor: C.canvas }}>
          <T size={12.5} lh={20}>{ok ? `구매는 ${c.seller}에서 진행돼요. 왈프는 결제·배송에 관여하지 않아요. 상태와 정품 여부는 판매자와 한 번 더 확인하고, 안전결제를 이용해 주세요.` : '확인 전 매물이에요. 직접 보러 간다면 사이즈와 판매 여부를 꼭 확인하세요.'}</T>
        </View>
        {active && !c.dismissed && (ok || c.kind === 'lead' || c.kind === 'price_watch') ? <TextBtn label="이 매물은 넘기고 계속 찾기" center onPress={() => dismiss(c)} /> : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(bottom, 16), borderTopWidth: 1, borderTopColor: C.surface }}>
        <T size={12} w={500} color={C.gray500} style={{ textAlign: 'center', marginBottom: 8 }}>
          {!active ? '끝난 의뢰의 기록이에요' : ok ? `중고 매물은 먼저 팔릴 수 있어요 · ${c.checkedLabel} 확인` : '확인이 끝나면 알림으로 알려드려요'}
        </T>
        {c.url ? <Btn label={ok ? c.ctaLabel! : '판매글 직접 보기'} kind={ok ? 'pri' : 'sec'} icon="ext" onPress={() => openSeller(c)} a11y={`${ok ? c.ctaLabel : '판매글 직접 보기'}, 외부 페이지로 이동`} /> : null}
      </View>
    </View>
  );
}

function Ev({ text, done }: { text: string; done?: boolean }) {
  const [b, d] = text.includes('|') ? text.split('|').map(s => s.trim()) : [text, ''];
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 10 }}>
      <View style={[{ width: 15, height: 15, borderRadius: 8, marginTop: 3, alignItems: 'center', justifyContent: 'center' }, done ? { backgroundColor: C.black } : { borderWidth: 1.2, borderStyle: 'dashed', borderColor: C.gray500 }]}>
        {done ? <Icon name="check" size={10} color={C.white} stroke={3} /> : null}
      </View>
      <View style={{ flex: 1 }}><T size={14} w={700}>{b}</T>{d ? <T size={13} color={C.gray500} lh={19.5} style={{ marginTop: 2 }}>{d}</T> : null}</View>
    </View>
  );
}
