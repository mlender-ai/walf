import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Field } from '@/components/Field';
import { Btn, Icon, T } from '@/components/ui';
import { call, photoPart, reportClientError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

/** S02 의뢰 등록 — 사진·링크·상품명 중 하나로 시작, 구매 조건은 나중에 넣어도 된다(PRD 2.3) */
export default function NewRequest() {
  const { bottom } = useSafeAreaInsets();
  const { refresh } = useStore();
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [url, setUrl] = useState(''); const [name, setName] = useState(''); const [brand, setBrand] = useState('');
  const [cond, setCond] = useState(true);
  const [size, setSize] = useState(''); const [color, setColor] = useState(''); const [price, setPrice] = useState(''); const [usedOk, setUsedOk] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const can = !!(photo || url.trim() || name.trim());

  const pick = async () => {
    try {
      const before = await ImagePicker.getMediaLibraryPermissionsAsync();
      const perm = before.granted ? before : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('사진 접근이 꺼져 있어요', '설정 앱에서 사진 접근을 허용하거나, 링크·상품명으로 맡겨 주세요.'); return; }
      // 권한 창이 닫히는 중에 선택 창을 띄우면 iOS가 무시한다 — 처음 허용한 직후엔 잠깐 기다린다
      if (!before.granted) await new Promise(r => setTimeout(r, 600));
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (!res.canceled && res.assets[0]) setPhoto(res.assets[0]);
    } catch (e: any) {
      reportClientError('pick_photo', e);
      Alert.alert('사진을 불러오지 못했어요', e?.message || '다시 시도해 주세요.');
    }
  };

  const submit = async () => {
    setErr(''); setBusy(true);
    const fd = new FormData();
    const add = (k: string, v: string) => { if (v.trim()) fd.append(k, v.trim()); };
    add('productName', name); add('brand', brand); add('productUrl', url);
    if (cond) { add('size', size); add('color', color); add('maxPrice', price.replace(/[^\d]/g, '')); }
    fd.append('usedOk', String(cond ? usedOk : true));
    if (photo) fd.append('photo', photoPart(photo.uri));
    try {
      await call('POST', '/requests', undefined, { form: fd, timeoutMs: 40000 });
      await refresh();
      router.replace('/request/departure'); // 서버가 접수를 확인한 뒤에만 출발 모션
    } catch (e: any) {
      if (e.code === 'active_exists') { Alert.alert('진행 중인 의뢰가 있어요', e.message, [{ text: '확인', onPress: () => router.back() }]); return; }
      const msg = e?.message || '맡기지 못했어요. 다시 시도해 주세요.';
      setErr(msg);
      Alert.alert('맡기지 못했어요', msg);
      reportClientError('create_request', e, { photo: photo ? `${photo.mimeType || '?'} ${photo.fileSize ? Math.round(photo.fileSize / 1024) + 'KB' : ''} ${photo.width}x${photo.height}` : null });
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header close title="옷 맡기기" modal={Platform.OS === 'ios'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <T size={24} w={800} lh={31} ls={-1} style={{ marginTop: 8 }} accessibilityRole="header">어떤 옷을 찾을까요?</T>
          <T size={14} color={C.gray500} style={{ marginTop: 4 }}>사진·링크·상품명 중 하나면 충분해요.</T>

          <T size={13} w={700} style={{ marginTop: 22 }}>사진</T>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            {photo ? (
              <View>
                <Image source={{ uri: photo.uri }} style={{ width: 104, height: 104, borderRadius: R.card, backgroundColor: C.canvas }} contentFit="cover" accessibilityLabel="고른 사진" />
                <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel="사진 빼기" hitSlop={8}
                  style={{ position: 'absolute', right: -8, top: -8, width: 28, height: 28, borderRadius: 14, backgroundColor: C.black, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={14} color={C.white} stroke={2.2} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={pick} accessibilityRole="button" accessibilityLabel="사진 고르기"
                style={{ width: 104, height: 104, borderRadius: R.card, borderWidth: 1.2, borderStyle: 'dashed', borderColor: C.gray500, backgroundColor: C.canvas, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <Icon name="plus" size={22} /><T size={12} w={600}>사진 고르기</T>
              </Pressable>
            )}
            <T size={12} color={C.gray500} style={{ flex: 1, alignSelf: 'center' }}>SNS 캡처, 태그, 착용 사진 모두 괜찮아요. 한 장만 올릴 수 있어요.</T>
          </View>

          <Field label="상품 링크" defaultValue="" onChangeText={setUrl} placeholder="https:// 로 시작하는 링크 붙여넣기" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Field label="상품명" defaultValue="" onChangeText={setName} placeholder="예: BADBLOOD Mystic Nylon Track Jacket Navy" maxLength={120} />
          <Field label="브랜드 (선택)" defaultValue="" onChangeText={setBrand} placeholder="예: BADBLOOD" maxLength={60} />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 30 }}>
            <View style={{ flex: 1 }}><T size={17} w={800} ls={-0.5}>구매 조건</T><T size={12.5} color={C.gray500}>나중에 추적함에서 넣거나 바꿀 수 있어요.</T></View>
            <Switch value={cond} onValueChange={setCond} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel="구매 조건 지금 입력" />
          </View>
          {cond ? <>
            <T size={13} w={700} style={{ marginTop: 16 }}>사이즈</T>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {SIZES.map(x => (
                <Pressable key={x} onPress={() => setSize(size === x ? '' : x)} accessibilityRole="button" accessibilityState={{ selected: size === x }}
                  style={{ minWidth: 52, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: size === x ? C.black : C.white, borderWidth: 1, borderColor: size === x ? C.black : C.gray300 }}>
                  <T size={14} w={700} color={size === x ? C.white : C.black} max={1.3}>{x}</T>
                </Pressable>
              ))}
            </View>
            <Field label="다른 사이즈" value={SIZES.includes(size) ? '' : size} onChangeText={setSize} placeholder="예: 2, 95, FREE" autoCapitalize="characters" maxLength={20} />
            <Field label="색상" defaultValue="" onChangeText={setColor} placeholder="예: 네이비" maxLength={30} />
            <Field label="희망가" value={price} onChangeText={v => setPrice(v.replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ','))} placeholder="예: 150,000" keyboardType="number-pad" suffix="원 이하" hint="배송비를 포함한 금액으로 비교해요." />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
              <T size={14} w={600} style={{ flex: 1 }}>중고도 괜찮아요</T>
              <Switch value={usedOk} onValueChange={setUsedOk} trackColor={{ true: C.black, false: C.gray300 }} accessibilityLabel="중고도 괜찮아요" />
            </View>
          </> : <T size={12.5} color={C.gray500} style={{ marginTop: 10 }}>조건이 없으면 “조건에 맞는 매물” 알림이 부정확할 수 있어요.</T>}
        </ScrollView>
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(bottom, 16), borderTopWidth: 1, borderTopColor: C.surface }}>
          {err ? <View accessibilityRole="alert" style={{ marginBottom: 10, padding: 12, borderRadius: R.card, borderWidth: 1, borderColor: C.black }}><T size={13} w={600}>{err}</T></View>
            : <T size={12} w={500} color={C.gray500} style={{ textAlign: 'center', marginBottom: 8 }}>무료 베타 · 왈프 팀이 상품을 확인하면 7일 탐색이 시작돼요</T>}
          <Btn label={busy ? '맡기는 중' : '이 옷 맡기기'} busy={busy} disabled={!can} onPress={submit} a11y={can ? '이 옷 맡기기' : '사진, 링크, 상품명 중 하나를 넣으면 맡길 수 있어요'} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
