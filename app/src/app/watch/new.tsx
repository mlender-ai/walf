import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Field } from '@/components/Field';
import { Btn, Icon, T } from '@/components/ui';
import { call, photoPart, reportClientError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';
import type { WatchView } from '@/lib/types';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const fmt = (v: string) => v.replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 기다려줘 등록 — 상품명이나 링크 + 원하는 가격만 있으면 된다. 찾아줘에서 넘어오면 상품이 채워져 있다 */
export default function NewWatch() {
  const p = useLocalSearchParams<{ productId?: string; requestId?: string; title?: string; brand?: string }>();
  const { bottom } = useSafeAreaInsets();
  const { refresh } = useStore();
  const fromFind = !!p.productId;
  const [url, setUrl] = useState(''); const [name, setName] = useState(p.title || ''); const [brand, setBrand] = useState(p.brand || '');
  const [price, setPrice] = useState(''); const [size, setSize] = useState(''); const [color, setColor] = useState(''); const [newOnly, setNewOnly] = useState(false); const [itemOnly, setItemOnly] = useState(false);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const can = !!(url.trim() || name.trim()) && !!price.replace(/[^\d]/g, '');

  const pick = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('사진 접근이 꺼져 있어요', '사진 없이도 등록할 수 있어요.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (!res.canceled && res.assets[0]) setPhoto(res.assets[0]);
    } catch (e: any) { reportClientError('watch_pick_photo', e); }
  };

  const submit = async () => {
    setErr(''); setBusy(true);
    const fields: Record<string, string> = { productName: name.trim(), productUrl: url.trim(), brand: brand.trim(), size: size.trim(), color: color.trim(),
      targetPrice: price.replace(/[^\d]/g, ''), condition: newOnly ? 'new' : 'any', priceBasis: itemOnly ? 'item' : 'total', productId: p.productId || '', requestId: p.requestId || '' };
    try {
      let w: WatchView;
      if (photo) {
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => { if (v) fd.append(k, v); });
        fd.append('photo', photoPart(photo.uri));
        w = await call<WatchView>('POST', '/watches', undefined, { form: fd, timeoutMs: 40000 });
      } else w = await call<WatchView>('POST', '/watches', Object.fromEntries(Object.entries(fields).filter(([, v]) => v)));
      await refresh();
      router.replace({ pathname: '/watch/[id]', params: { id: String(w.id) } });
    } catch (e: any) {
      const msg = e?.message || '등록하지 못했어요. 다시 시도해 주세요.';
      setErr(msg); Alert.alert('등록하지 못했어요', msg);
      if (e?.status !== 409 && e?.status !== 400) reportClientError('create_watch', e);
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header close title="기다려줘" modal={Platform.OS === 'ios'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <T size={24} w={800} lh={31} ls={-1} style={{ marginTop: 8 }} accessibilityRole="header">어떤 옷을 기다릴까요?</T>
          <T size={14} color={C.gray500} style={{ marginTop: 4 }}>원하는 사이즈와 가격이 되면 알려 드릴게요. 하루 한 번 확인해요.</T>

          {fromFind ? (
            <View style={{ marginTop: 18, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 }}>
              <T size={12} color={C.gray500}>찾아줘에서 확인한 옷</T>
              {p.brand ? <T size={11.5} w={800} ls={0.5} style={{ marginTop: 4 }}>{p.brand.toUpperCase()}</T> : null}
              <T size={15} w={700}>{p.title}</T>
            </View>
          ) : null}
          <Field label={fromFind ? '살 수 있는 상품 페이지 링크(있으면 바로 지켜봐요)' : '상품 링크'} defaultValue="" onChangeText={setUrl} placeholder="공식몰 등 상품 페이지 https://" autoCapitalize="none" autoCorrect={false} keyboardType="url"
            hint={fromFind ? '찾아줘 근거 페이지는 판매 페이지가 아닐 수 있어 가져오지 않아요. 링크가 없으면 왈프 팀이 찾아 연결해요.' : '공식몰 같은 상품 페이지는 바로 지켜봐요. 번개장터·무신사 등 자동 수집을 금지한 곳은 왈프 팀이 확인해요.'} />
          {fromFind ? null : <>
            <Field label="상품명" defaultValue={p.title || ''} onChangeText={setName} placeholder="예: BADBLOOD Mystic Nylon Track Jacket Navy" maxLength={120} />
            <Field label="브랜드 (선택)" defaultValue={p.brand || ''} onChangeText={setBrand} placeholder="예: BADBLOOD" maxLength={60} />
          </>}
          <Field label="원하는 가격" value={price} onChangeText={v => setPrice(fmt(v))} placeholder="예: 150,000" keyboardType="number-pad" suffix="원 이하"
            hint={itemOnly ? '상품 가격만 비교해요. 배송비는 따로 들 수 있어요.' : '상품 가격과 배송비를 더한 금액으로 비교해요. 배송비를 모르면 확인될 때까지 알리지 않아요. 쿠폰·회원가는 조건을 몰라 쓰지 않아요.'} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
            <View style={{ flex: 1 }}><T size={14} w={600}>배송비 빼고 비교</T><T size={12} color={C.gray500}>켜면 상품 가격만 원하는 가격과 비교해요</T></View>
            <Switch value={itemOnly} onValueChange={setItemOnly} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel="배송비 빼고 비교" />
          </View>

          <T size={13} w={700} style={{ marginTop: 18 }}>사이즈 (선택)</T>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {SIZES.map(x => (
              <Pressable key={x} onPress={() => setSize(size === x ? '' : x)} accessibilityRole="button" accessibilityState={{ selected: size === x }}
                style={{ minWidth: 52, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: size === x ? C.black : C.white, borderWidth: 1, borderColor: size === x ? C.black : C.gray300 }}>
                <T size={14} w={700} color={size === x ? C.white : C.black} max={1.3}>{x}</T>
              </Pressable>
            ))}
          </View>
          <Field label="다른 사이즈" value={SIZES.includes(size) ? '' : size} onChangeText={setSize} placeholder="예: 2, 95, FREE" autoCapitalize="characters" maxLength={20} />
          <Field label="색상 (선택)" defaultValue="" onChangeText={setColor} placeholder="예: 네이비" maxLength={30} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
            <View style={{ flex: 1 }}><T size={14} w={600}>새 상품만</T><T size={12} color={C.gray500}>끄면 중고도 함께 봐요(중고 판매처는 연동 준비 중)</T></View>
            <Switch value={newOnly} onValueChange={setNewOnly} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel="새 상품만" />
          </View>

          <T size={13} w={700} style={{ marginTop: 22 }}>사진 (선택)</T>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            {photo ? (
              <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel="사진 빼기">
                <Image source={{ uri: photo.uri }} style={{ width: 84, height: 84, borderRadius: R.card, backgroundColor: C.canvas }} contentFit="cover" />
              </Pressable>
            ) : (
              <Pressable onPress={pick} accessibilityRole="button" accessibilityLabel="사진 고르기"
                style={{ width: 84, height: 84, borderRadius: R.card, borderWidth: 1.2, borderStyle: 'dashed', borderColor: C.gray500, backgroundColor: C.canvas, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={20} />
              </Pressable>
            )}
            <T size={12} color={C.gray500} style={{ flex: 1, alignSelf: 'center' }}>목록에서 알아보기 쉽게 보여 줄 사진이에요. 분석에는 쓰지 않아요.</T>
          </View>
        </ScrollView>
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(bottom, 16), borderTopWidth: 1, borderTopColor: C.surface }}>
          {err ? <View accessibilityRole="alert" style={{ marginBottom: 10, padding: 12, borderRadius: R.card, borderWidth: 1, borderColor: C.black }}><T size={13} w={600}>{err}</T></View>
            : <T size={12} w={500} color={C.gray500} style={{ textAlign: 'center', marginBottom: 8 }}>무료 베타 · 30일마다 계속할지 물어봐요</T>}
          <Btn label={busy ? '등록하는 중' : '이 가격 기다리기'} busy={busy} disabled={!can} onPress={submit} a11y={can ? '이 가격 기다리기' : '상품명이나 링크, 원하는 가격을 넣으면 등록할 수 있어요'} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
