import React from 'react';
import { Pressable, View } from 'react-native';
import { T } from '@/components/ui';
import { C } from '@/lib/theme';
import type { PriorityOption } from '@/lib/types';

const SHORT: Record<string, string> = { silhouette: '실루엣', material_detail: '소재·디테일', brand_archive: '브랜드·아카이브', vibe: '비슷한 느낌이면 OK' };

/** 무엇이 중요한지(선택) — 고르면 다음 대체 상품 추천부터 그 기준을 앞에 둔다. 다시 누르면 고르지 않음 */
export function PriorityPicker({ options, onPick, busy }: { options: PriorityOption[]; onPick: (id: string | null) => void; busy?: boolean }) {
  return (
    <View style={{ marginHorizontal: 20, marginTop: 12 }}>
      <T size={12.5} w={700}>무엇이 중요해요? <T size={12} color={C.gray500}>선택 · 다음 추천부터 반영돼요</T></T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {options.map(o => (
          <Pressable key={o.id} disabled={busy} onPress={() => onPick(o.selected ? null : o.id)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: o.selected }} accessibilityLabel={o.label}
            style={{ height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: o.selected ? C.black : C.gray300, backgroundColor: o.selected ? C.black : C.white, justifyContent: 'center' }}>
            <T size={12.5} w={600} color={o.selected ? C.white : C.black}>{SHORT[o.id] || o.label}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
