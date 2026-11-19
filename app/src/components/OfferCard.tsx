import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Icon, MockPill, ProductImage, T, Tag, TextBtn } from '@/components/ui';
import { C, R } from '@/lib/theme';
import type { OfferCard as Offer, TagT } from '@/lib/types';

const won = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('ko-KR')}원`);
const TAG = { exact: { kind: 'v', text: '같은 상품 확인' }, possible: { kind: 'o', text: '같은 상품일 수 있어요' }, alternative: { kind: 'x', text: '같은 상품 아님' } } as const;
const COND = { new: '새 상품', used: '중고', unknown: '' };
/** 색상·사이즈·상태 한 줄 — 원하는 조건과 다르면 굵게, 확인 못 한 값은 “확인 필요”로(맞는 것처럼 보이지 않게) */
function Facts({ o }: { o: Offer }) {
  if (!o.facts?.length) return null;
  return (
    <T size={12} lh={17} color={C.gray500} style={{ marginTop: 2 }} accessibilityLabel={`옵션: ${o.facts.map(f => f.text).join(', ')}`}>
      {o.facts.map((f, i) => <T key={i} size={12} lh={17} w={f.state === 'no' ? 700 : f.state === 'ok' ? 600 : 400} color={f.state === 'no' || f.state === 'ok' ? C.black : C.gray500}>
        {i ? ' · ' : ''}{f.state === 'ok' ? '✓ ' : ''}{f.text}</T>)}
    </T>
  );
}

/**
 * 판매처 후보·대체 상품 한 장. 가격·재고는 페이지를 읽은 시각 기준이라 “구매 가능”이라고 말하지 않는다.
 * exact: 왈프 팀이 같은 상품으로 확인 · possible: 확인 못 한 점을 함께 · alternative: 비슷한 점과 다른 점(같은 상품 아님)
 */
const FEEDBACK: [string, string][] = [['like', '마음에 들어요'], ['not_quite', '비슷하지만 아니에요'], ['not_interested', '관심 없어요']];

export function OfferCard({ o, extra = [], note, footer, onFeedback, onOpen }: { o: Offer; extra?: TagT[]; note?: React.ReactNode; footer?: React.ReactNode;
  /** 비슷한 디자인 카드의 내 평가 — 같은 걸 다시 누르면 지운다(cleared) */ onFeedback?: (kind: string) => void; onOpen?: () => void }) {
  const item = o.salePrice ?? o.price;
  const facts = o.tier === 'alternative' ? o.similarPoints : o.confirmed;
  const open = () => { if (o.url) { onOpen?.(); WebBrowser.openBrowserAsync(o.url).catch(() => {}); } };
  // “관심 없어요”를 고른 추천은 한 줄로 접는다(되돌릴 수 있다)
  if (o.tier === 'alternative' && onFeedback && o.feedback === 'not_interested') return (
    <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }]}>
      <T size={12.5} color={C.gray500} style={{ flex: 1 }} numberOfLines={1}>관심 없다고 했어요 · {o.name}</T>
      <TextBtn label="되돌리기" color={C.black} onPress={() => onFeedback('cleared')} a11y={`${o.name} 관심 없음 되돌리기`} />
    </View>
  );
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <ProductImage uri={o.imageUrl} style={s.img} label={`${o.name || '상품'} 사진`} compact emptyText="사진 없음" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><Tag t={TAG[o.tier]} />{extra.map((t, i) => <Tag key={i} t={t} />)}{o.isMock ? <MockPill /> : null}</View>
          {o.brand ? <T size={11.5} w={800} ls={0.5} style={{ marginTop: 8 }} numberOfLines={1}>{o.brand.toUpperCase()}</T> : null}
          <T size={14.5} w={700} lh={20} style={{ marginTop: o.brand ? 1 : 8 }} numberOfLines={2}>{o.name}</T>
          <T size={12} color={C.gray500} style={{ marginTop: 2 }} numberOfLines={1}>{o.facts?.length ? o.seller : [o.seller, COND[o.condition]].filter(Boolean).join(' · ')}</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {o.salePrice != null && o.price != null && o.salePrice < o.price ? <T size={12} color={C.gray500} style={{ textDecorationLine: 'line-through' }}>{won(o.price)}</T> : null}
            <T size={16} w={800} ls={-0.3}>{won(item)}</T>
          </View>
          <T size={12} color={C.gray500}>{o.total != null ? `배송비 포함 ${won(o.total)}` : '배송비 확인 필요'}{!o.facts?.length && o.sizeLabel ? ` · ${o.sizeLabel}` : ''}</T>
          <Facts o={o} />
        </View>
      </View>
      {o.tier === 'alternative' && facts.length ? (
        <T size={12.5} lh={19} style={{ marginTop: 12 }}><T size={12.5} w={700}>비슷한 점  </T>{facts.slice(0, 4).join(' · ')}</T>
      ) : facts.length ? (
        <View style={{ marginTop: 12, gap: 4 }}>
          {facts.slice(0, 4).map((f, i) => <View key={i} style={s.row}><Icon name="check" size={14} stroke={2.2} /><T size={12.5} lh={18} style={{ flex: 1 }}>{f}</T></View>)}
        </View>
      ) : null}
      {o.teamNote ? <T size={12.5} lh={18} style={{ marginTop: 6 }}><T size={12.5} w={700}>왈프 팀 확인 </T>{o.teamNote}</T> : null}
      {o.tier === 'alternative' && o.diffPoints.length ? (
        <View style={s.box}><T size={12} w={700}>다른 점</T>{o.diffPoints.slice(0, 4).map((d, i) => <T key={i} size={12.5} lh={18} color={C.gray500}>{d}</T>)}</View>
      ) : null}
      {o.tier === 'possible' && (o.unconfirmed.length || o.diffPoints.length) ? (
        <View style={s.box}><T size={12} w={700}>확인하지 못한 점 · 참고</T>{[...o.unconfirmed, ...o.diffPoints].slice(0, 4).map((d, i) => <T key={i} size={12.5} lh={18} color={C.gray500}>{d}</T>)}</View>
      ) : null}
      {note}
      {o.tier === 'alternative' && onFeedback ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }} accessibilityLabel="이 추천 어땠어요?">
          {FEEDBACK.map(([k, label]) => (
            <Pressable key={k} onPress={() => onFeedback(o.feedback === k ? 'cleared' : k)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: o.feedback === k }}
              style={[s.chip, o.feedback === k && s.chipOn]}><T size={12} w={600} color={o.feedback === k ? C.white : C.black}>{label}</T></Pressable>
          ))}
        </View>
      ) : null}
      <T size={11.5} color={C.gray500} style={{ marginTop: 10 }}>{o.basisLabel}</T>
      {o.url ? <TextBtn label="판매 페이지 열기" onPress={open} color={C.black} a11y={`${o.seller} 판매 페이지 열기`} />
        : o.isMock ? <T size={12} color={C.gray500} style={{ marginTop: 6 }}>테스트 상품이라 판매 페이지가 없어요</T> : null}
      {footer}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
  img: { width: 88, height: 104, borderRadius: R.thumb },
  row: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  box: { marginTop: 10, padding: 10, gap: 3, borderRadius: R.thumb, borderWidth: 1, borderStyle: 'dashed', borderColor: C.gray500 },
  chip: { height: 32, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: C.gray300, justifyContent: 'center' },
  chipOn: { backgroundColor: C.black, borderColor: C.black },
});
