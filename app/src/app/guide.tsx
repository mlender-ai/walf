import React, { useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Hair, T } from '@/components/ui';
import { useStore } from '@/lib/store';
import { C } from '@/lib/theme';

/** 이용 안내 — MY에서 들어온다. 사실 문구는 이전 MY 안내 목록 그대로이고, 주제별로 묶기만 했다 */
export default function Guide() {
  const { at } = useLocalSearchParams<{ at?: string }>();
  const { me } = useStore();
  const insets = useSafeAreaInsets();
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const max = me?.watchLimit.max;
  const parts: { id: string; title: string; lines: string[] }[] = [
    { id: 'find', title: '찾아줘', lines: ['한 번에 한 벌, 7일 동안 맡길 수 있어요.', '7일은 왈프 팀이 상품을 확인한 때부터 흘러요.', '국내 판매처를 하루 한 번 살펴요. 해외 탐색은 하지 않아요.', '결과는 왈프 팀이 직접 확인해요. 확인 전 매물은 “유력 후보”로만 보여드려요.'] },
    { id: 'watch', title: '기다려줘', lines: [`아는 옷의 판매 링크와 원하는 가격을 남기면, 가격과 사이즈 재고를 하루 한 번 확인해요.${max ? ` ${max}벌까지 맡길 수 있어요.` : ''}`, '원하는 사이즈가 있고, 정한 가격 이하일 때만 알려 드려요. 확인하지 못한 정보가 있으면 알리지 않아요.'] },
    { id: 'privacy', title: '구매·결제와 개인정보', lines: ['구매는 각 판매처에서 진행돼요. 왈프는 결제·배송에 관여하지 않아요.', '공개 수배는 동의하신 경우에만, 동의한 정보만 올려요.', 'MY의 ‘내 의뢰·알림 데이터 삭제’로 이 기기의 기록을 서버에서 지울 수 있어요.'] },
    { id: 'beta', title: '무료 베타', lines: ['결제·구독·크레딧은 없어요.'] },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="이용 안내" />
      <ScrollView ref={ref} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {parts.map((p, i) => (
          <View key={p.id} onLayout={e => { if (at === p.id) ref.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: false }); }}>
            {i ? <Hair style={{ marginHorizontal: 20 }} /> : null}
            <View style={{ paddingHorizontal: 20, paddingVertical: 24 }}>
              <T size={17} w={800} ls={-0.5} accessibilityRole="header">{p.title}</T>
              {p.lines.map(x => <T key={x} size={14.5} lh={22} color={C.dark} style={{ marginTop: 10 }}>{x}</T>)}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
