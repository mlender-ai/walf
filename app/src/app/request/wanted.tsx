import React, { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Avatar, Btn, Empty, ProductImage, T } from '@/components/ui';
import { call } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';

/** 수배 동의 — 공개할 정보를 사용자가 고르고, 승인해도 실제 게시는 왈프 팀이 채널별로 한다(승인 ≠ 게시) */
export default function WantedConsent() {
  const { bottom } = useSafeAreaInsets();
  const { me, refresh } = useStore();
  const r = me?.active;
  const [f, setF] = useState({ photo: !!r?.product.photoUrl, sizeColor: true, maxPrice: false });
  const [busy, setBusy] = useState<'' | 'approve' | 'decline'>('');
  if (!r || !r.wanted || r.wanted.status !== 'proposed') {
    return <View style={{ flex: 1, backgroundColor: '#fff' }}><Header back title="공개 수배" />
      <Empty title={r?.wanted ? '이미 정했어요' : '결정할 수배 제안이 없어요'} desc="수배 상태는 추적함에서 볼 수 있어요." /></View>;
  }
  const decide = async (decision: 'approve' | 'decline') => {
    setBusy(decision);
    try { await call('POST', `/requests/${r.id}/wanted`, { decision, fields: f }); await refresh(); router.back(); }
    catch (e: any) { Alert.alert('처리하지 못했어요', e.message); } finally { setBusy(''); }
  };
  const c = r.conditions;
  const sizeColor = [c.size, c.color].filter(Boolean).join(' · ');
  const rows: [keyof typeof f | 'model', string, string, boolean][] = [
    ['photo', '사진', r.product.photoUrl ? '맡기신 사진을 그대로 써요' : '맡기신 사진이 없어요', !r.product.photoUrl],
    ['model', '브랜드 · 모델', '수배에 꼭 필요해서 항상 공개돼요', true],
    ['sizeColor', '사이즈 · 색상', sizeColor || '정한 조건이 없어요', !sizeColor],
    ['maxPrice', '희망가', c.maxPrice ? `${c.maxPrice.toLocaleString('ko-KR')}원 이하` : '정한 희망가가 없어요', !c.maxPrice],
  ];
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="공개 수배" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        <T size={24} w={800} lh={31} ls={-1} style={{ marginTop: 8 }} accessibilityRole="header">수배지를 붙여볼까요?</T>
        <T size={14} lh={21} color={C.gray500} style={{ marginTop: 6 }}>{r.display.key === 'awaiting_consent' ? r.display.desc : '첫 탐색에서 조건에 맞는 매물을 찾지 못했어요.'} 수배지를 보고 가진 사람이 연락해 올 수 있어요.</T>
        <T size={13} w={700} style={{ marginTop: 24 }}>수배지 미리보기</T>
        <View style={{ marginTop: 8, borderRadius: R.card, borderWidth: 1, borderColor: C.black, padding: 16 }} accessibilityLabel="수배지 미리보기">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Avatar /><T size={12.5} w={700}>왈프 공식 계정</T></View>
          <T size={19} w={800} lh={25} ls={-0.6} style={{ marginTop: 10 }}>이 옷을 찾고 있어요</T>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
            {f.photo && r.product.photoUrl ? <ProductImage uri={r.product.photoUrl} style={{ width: 84, height: 84, borderRadius: R.thumb }} label="수배지 사진" /> : null}
            <View style={{ flex: 1, gap: 3 }}>
              {r.product.brandLabel ? <T size={11.5} w={800} ls={0.5}>{r.product.brandLabel.toUpperCase()}</T> : null}
              <T size={15} w={700} numberOfLines={3}>{r.product.title}</T>
              {f.sizeColor && sizeColor ? <T size={13}>{sizeColor}</T> : null}
              {f.maxPrice && c.maxPrice ? <T size={13}>{c.maxPrice.toLocaleString('ko-KR')}원 이하로 구해요</T> : null}
            </View>
          </View>
          <T size={12} color={C.gray500} style={{ marginTop: 12 }}>판매 의사가 있으면 이 게시글에 댓글·채팅으로 알려주세요.</T>
        </View>
        <T size={13} w={700} style={{ marginTop: 24 }}>공개할 정보</T>
        {rows.map(([k, label, desc, locked]) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.surface }}>
            <View style={{ flex: 1 }}><T size={14.5} w={600}>{label}</T><T size={12.5} color={C.gray500}>{desc}</T></View>
            <Switch value={k === 'model' ? true : !locked && f[k as keyof typeof f]} disabled={locked}
              onValueChange={v => setF(x => ({ ...x, [k]: v }))} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel={`${label} 공개`} />
          </View>
        ))}
        <T size={12.5} color={C.gray500} lh={19} style={{ marginTop: 12 }}>이름·연락처 같은 개인 정보는 공개하지 않아요.</T>
        <T size={13} w={700} style={{ marginTop: 22 }}>올리는 곳</T>
        <T size={13.5} lh={21} style={{ marginTop: 6 }}>번개장터 · 중고나라 · 후루츠패밀리 — 왈프 공식 계정으로 채널마다 한 번씩 올려요.</T>
        <T size={12.5} color={C.gray500} lh={19} style={{ marginTop: 6 }}>채널 정책상 올리지 못하면 사유와 함께 추적함에 남겨요. 게시가 끝나기 전에는 “게시 완료”로 보이지 않아요. 언제든 수배를 내릴 수 있어요.</T>
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(bottom, 16), borderTopWidth: 1, borderTopColor: C.surface, gap: 8 }}>
        <Btn label="수배 동의하기" busy={busy === 'approve'} disabled={!!busy} onPress={() => decide('approve')} />
        <Btn label="비공개로 계속 찾기" kind="sec" busy={busy === 'decline'} disabled={!!busy} onPress={() => decide('decline')} />
      </View>
    </View>
  );
}
