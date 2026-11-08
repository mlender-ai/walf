import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Field } from '@/components/Field';
import { Btn, Empty, T } from '@/components/ui';
import { call, photoPart } from '@/lib/api';
import { useStore } from '@/lib/store';
import { C, R } from '@/lib/theme';

/** 정보 보완 요청에 답하기 — 답을 보내면 다시 “상품 확인 중”, 7일은 아직 시작 전 */
export default function InfoReply() {
  const { bottom } = useSafeAreaInsets();
  const { me, refresh } = useStore();
  const r = me?.active;
  const [text, setText] = useState(''); const [url, setUrl] = useState('');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  if (!r || r.status !== 'needs_info') return <View style={{ flex: 1, backgroundColor: '#fff' }}><Header back title="정보 보내기" /><Empty title="보낼 정보 요청이 없어요" /></View>;
  const send = async () => {
    setBusy(true);
    const fd = new FormData();
    if (text.trim()) fd.append('text', text.trim()); if (url.trim()) fd.append('productUrl', url.trim());
    if (photo) fd.append('photo', photoPart(photo.uri));
    try { await call('POST', `/requests/${r.id}/info`, undefined, { form: fd, timeoutMs: 40000 }); await refresh(); router.back(); }
    catch (e: any) { Alert.alert('보내지 못했어요', e.message); } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header back title="정보 보내기" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ marginTop: 8, padding: 14, borderRadius: R.card, backgroundColor: C.canvas }}>
            <T size={12} w={700} color={C.gray500}>왈프 팀의 요청</T><T size={14.5} w={600} lh={22} style={{ marginTop: 4 }}>{r.infoRequest}</T>
          </View>
          <Field label="설명" defaultValue="" onChangeText={setText} multiline placeholder="예: 2024 FW 제품이고 등판에 로고 자수가 있어요." maxLength={500} />
          <Field label="링크" defaultValue="" onChangeText={setUrl} placeholder="https://" autoCapitalize="none" keyboardType="url" />
          <Btn label={photo ? '사진 1장 고름 · 바꾸기' : '사진 고르기'} kind="sec" small style={{ marginTop: 16, alignSelf: 'flex-start' }} onPress={async () => {
            const p = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!p.granted) return;
            const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
            if (!res.canceled) setPhoto(res.assets[0]);
          }} />
        </ScrollView>
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(bottom, 16), borderTopWidth: 1, borderTopColor: C.surface }}>
          <Btn label="보내기" busy={busy} disabled={!text.trim() && !url.trim() && !photo} onPress={send} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
