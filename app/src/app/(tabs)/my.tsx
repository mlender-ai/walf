import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Header } from '@/components/Header';
import { Btn, Hair, T, TextBtn } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { call, getBase, getDevice, resetDevice, setBase, DEFAULT_BASE } from '@/lib/api';
import { enablePush, remotePushAvailable } from '@/lib/push';
import { useStore } from '@/lib/store';
import { C, FONT, R } from '@/lib/theme';

export default function MyTab() {
  const { me, reinit, refresh } = useStore();
  const [perm, setPerm] = useState<string>('…');
  const [base, setB] = useState(getBase());
  useEffect(() => { Notifications.getPermissionsAsync().then(p => setPerm(p.status)).catch(() => setPerm('unknown')); }, []);
  const permLabel = perm === 'granted' ? (me?.user.pushToken ? '켜짐 · 푸시 연결됨' : remotePushAvailable() ? '켜짐 · 기기 등록 중' : '켜짐 · 이 설치본은 원격 푸시 없음(앱 안 알림만)') : perm === 'denied' ? '꺼짐' : '아직 묻지 않음';
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header title="MY" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: TAB_SPACE }} keyboardShouldPersistTaps="handled">
        <Row k="알림" v={permLabel} />
        <Btn label="알림 켜기" kind="sec" small style={{ alignSelf: 'flex-start', marginBottom: 16 }}
          onPress={async () => { try { Alert.alert('알림', await enablePush()); } catch (e: any) { Alert.alert('알림', e.message); } Notifications.getPermissionsAsync().then(p => setPerm(p.status)); refresh(); }} />
        <Hair />
        <T size={17} w={800} ls={-0.5} style={{ marginTop: 22 }} accessibilityRole="header">이용 안내</T>
        {['무료 베타 — 결제·구독·크레딧은 없어요.', '한 번에 한 벌, 7일 동안 맡길 수 있어요.', '7일은 왈프 팀이 상품을 확인한 때부터 흘러요.', '국내 판매처를 하루 한 번 살펴요. 해외 탐색은 하지 않아요.',
          '결과는 왈프 팀이 직접 확인해요. 확인 전 매물은 “유력 후보”로만 보여드려요.', '공개 수배는 동의하신 경우에만, 동의한 정보만 올려요.', '구매는 각 판매처에서 진행돼요. 왈프는 결제·배송에 관여하지 않아요.']
          .map(x => <T key={x} size={13.5} lh={21} style={{ marginTop: 8 }}>· {x}</T>)}
        <Hair style={{ marginTop: 22 }} />
        <T size={17} w={800} ls={-0.5} style={{ marginTop: 22 }} accessibilityRole="header">테스트 빌드 설정</T>
        <T size={12.5} color={C.gray500} style={{ marginTop: 6 }}>실기기에서 맥의 서버에 붙을 때 같은 Wi-Fi의 주소(예: http://192.168.0.10:4300)를 넣어요.</T>
        <TextInput value={base} onChangeText={setB} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="서버 주소"
          style={{ marginTop: 10, borderWidth: 1, borderColor: C.gray300, borderRadius: R.card, paddingHorizontal: 14, height: 48, fontFamily: FONT[500], fontSize: 14, color: C.black }} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Btn label="서버 바꾸기" kind="sec" small style={{ flex: 1 }} onPress={async () => { try { await setBase(base); await reinit(); Alert.alert('서버 주소', `${getBase()}에 연결했어요.`); } catch (e: any) { Alert.alert('서버 주소', e.message); } }} />
          <Btn label="기본값" kind="sec" small style={{ flex: 1 }} onPress={() => setB(DEFAULT_BASE)} />
        </View>
        <Row k="기기 ID" v={(getDevice() || '').slice(0, 8) + '…'} />
        <Row k="앱 버전" v={`${Constants.expoConfig?.version} · ${Platform.OS}`} />
        <Hair style={{ marginTop: 10 }} />
        <TextBtn label="내 의뢰·알림 데이터 삭제" onPress={() => Alert.alert('데이터를 삭제할까요?', '이 기기의 의뢰, 사진, 활동 기록, 알림을 서버에서 지워요. 외부에 게시된 수배글이 있으면 삭제 처리를 위해 채널 기록만 남겨요. 되돌릴 수 없어요.', [
          { text: '취소', style: 'cancel' },
          { text: '삭제', style: 'destructive', onPress: async () => { try { await call('DELETE', '/me'); await resetDevice(); await reinit(); Alert.alert('삭제했어요'); } catch (e: any) { Alert.alert('삭제하지 못했어요', e.message); } } },
        ])} />
      </ScrollView>
    </View>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => (
  <View style={{ flexDirection: 'row', paddingVertical: 14, gap: 12 }}><T size={14} color={C.gray500} style={{ width: 72 }}>{k}</T><T size={14} w={600} style={{ flex: 1 }}>{v}</T></View>
);
