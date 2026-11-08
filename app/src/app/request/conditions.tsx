import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Field } from '@/components/Field';
import { Btn, Empty, T } from '@/components/ui';
import { call } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C } from '@/lib/theme';

const fmt = (n?: number | null) => (n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '');

export default function EditConditions() {
  const { bottom } = useSafeAreaInsets();
  const { me, refresh } = useStore();
  const r = me?.active;
  const [size, setSize] = useState(r?.conditions.size || ''); const [color, setColor] = useState(r?.conditions.color || '');
  const [price, setPrice] = useState(fmt(r?.conditions.maxPrice)); const [usedOk, setUsedOk] = useState(r?.conditions.usedOk ?? true);
  const [busy, setBusy] = useState(false);
  if (!r) return <View style={{ flex: 1, backgroundColor: '#fff' }}><Header back title="구매 조건" /><Empty title="진행 중인 의뢰가 없어요" /></View>;
  const save = async () => {
    setBusy(true);
    try { await call('PATCH', `/requests/${r.id}/conditions`, { size, color, maxPrice: price.replace(/[^\d]/g, ''), usedOk }); await refresh(); router.back(); }
    catch (e: any) { Alert.alert('저장하지 못했어요', e.message); } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="구매 조건" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <T size={13.5} color={C.gray500} style={{ marginTop: 8 }}>바꾼 조건은 다음 탐색부터 적용돼요. 이미 찾은 매물은 그대로 남아요.</T>
          <Field label="사이즈" defaultValue={r.conditions.size || ''} onChangeText={setSize} placeholder="예: M" autoCapitalize="characters" maxLength={20} />
          <Field label="색상" defaultValue={r.conditions.color || ''} onChangeText={setColor} placeholder="예: 네이비" maxLength={30} />
          <Field label="희망가" value={price} onChangeText={v => setPrice(fmt(Number(v.replace(/[^\d]/g, '')) || null))} keyboardType="number-pad" suffix="원 이하" hint="배송비를 포함한 금액으로 비교해요." />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
            <T size={14} w={600} style={{ flex: 1 }}>중고도 괜찮아요</T>
            <Switch value={usedOk} onValueChange={setUsedOk} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel="중고도 괜찮아요" />
          </View>
        </ScrollView>
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(bottom, 16), borderTopWidth: 1, borderTopColor: C.surface }}>
          <Btn label="저장" busy={busy} onPress={save} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
