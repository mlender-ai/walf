import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import { Header } from '@/components/Header';
import { Btn, Icon, T } from '@/components/ui';
import { TAB_SPACE } from '@/components/TabBar';
import { call, claimLegacy, getBase, getDevice, legacyLocked, resetDevice, setBase, DEFAULT_BASE } from '@/lib/api';
import { enablePush } from '@/lib/push';
import { useStore } from '@/lib/store';
import { C, FONT, R } from '@/lib/theme';

export default function MyTab() {
  const { reinit, refresh } = useStore();
  const params = useLocalSearchParams<{ dev?: string }>();
  const [perm, setPerm] = useState<string>('…');
  const [base, setB] = useState(getBase());
  const [code, setCode] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [devPick, setDev] = useState<boolean | null>(null);
  const dev = devPick ?? params.dev === '1'; // 개발자 설정 — 버전 줄을 길게 누르거나 연결 오류 화면에서 들어올 때만 연다
  const readPerm = useCallback(() => { Notifications.getPermissionsAsync().then(p => setPerm(p.status)).catch(() => setPerm('unknown')); }, []);
  useEffect(() => { readPerm(); legacyLocked().then(setLegacy).catch(() => {}); }, [readPerm]);
  useEffect(() => { const sub = AppState.addEventListener('change', s => { if (s === 'active') readPerm(); }); return () => sub.remove(); }, [readPerm]); // 설정 앱에서 돌아오면 다시 읽는다
  const claim = async () => {
    try { await claimLegacy(code); setCode(''); setLegacy(false); await reinit(); Alert.alert('이어받았어요', '이전 기록을 이 기기로 옮겼어요.'); }
    catch (e: any) { Alert.alert('이어받지 못했어요', e.message); }
  };
  const turnOn = async () => { try { Alert.alert('알림', await enablePush()); } catch (e: any) { Alert.alert('알림', e.message); } readPerm(); refresh(); };
  const wipe = () => Alert.alert('데이터를 삭제할까요?', '이 기기의 의뢰, 사진, 활동 기록, 알림을 서버에서 지워요. 외부에 게시된 수배글이 있으면 삭제 처리를 위해 채널 기록만 남겨요. 되돌릴 수 없어요.', [
    { text: '취소', style: 'cancel' },
    { text: '삭제', style: 'destructive', onPress: async () => { try { await call('DELETE', '/me'); await resetDevice(); await reinit(); Alert.alert('삭제했어요'); } catch (e: any) { Alert.alert('삭제하지 못했어요', e.message); } } },
  ]);
  const version = Constants.expoConfig?.version || '';
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <Header title="MY" />
      <ScrollView style={{ backgroundColor: C.canvas }} contentContainerStyle={{ paddingBottom: TAB_SPACE }} keyboardShouldPersistTaps="handled">
        {legacy ? (
          <View style={st.notice}>
            <T size={15} w={700}>이전 버전 기록이 잠겨 있어요</T>
            <T size={13} lh={19} color={C.gray500} style={{ marginTop: 4 }}>이 기기의 이전 기록은 기기 ID만으로는 열 수 없어 잠가 두었어요. 왈프 팀에게 받은 코드를 넣으면 이 기기로 옮겨 와요.</T>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TextInput value={code} onChangeText={v => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} autoComplete="off" keyboardType="ascii-capable" placeholder="ABCD-EFGH" placeholderTextColor={C.gray500} accessibilityLabel="이어받기 코드" maxLength={12} style={[st.input, { flex: 1 }]} />
              <Btn label="이어받기" kind="sec" small style={{ flex: 0, paddingHorizontal: 16 }} onPress={claim} disabled={code.replace(/[^A-Z0-9]/g, '').length < 8} />
            </View>
          </View>
        ) : null}

        <Group title="알림" foot="찾은 옷이 확인됐을 때, 기다리던 가격이 됐을 때 알려 드려요. 알림을 꺼도 ALERTS 탭에서 볼 수 있어요.">
          <Row label="푸시 알림" value={perm === 'granted' ? '켜짐' : perm === '…' ? '' : '꺼짐'}
            right={perm === 'undetermined' ? <Btn label="켜기" kind="sec" small style={st.inline} onPress={turnOn} />
              : perm === 'denied' ? <Btn label="설정 열기" kind="sec" small style={st.inline} onPress={() => Linking.openSettings()} /> : undefined} />
        </Group>

        <Group title="이용 안내">
          <Row label="왈프는 이렇게 찾아요" chev onPress={() => router.push('/guide')} />
          <Row label="구매·결제와 개인정보" chev onPress={() => router.push({ pathname: '/guide', params: { at: 'privacy' } })} last />
        </Group>

        <Group title="앱 정보">
          <Row label="버전" value={version} onLongPress={() => setDev(!dev)} last={!dev} a11y={`버전 ${version}`} />
          {dev ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
              <T size={13} w={700}>개발자 설정</T>
              <T size={12.5} lh={18} color={C.gray500}>실기기에서 맥의 서버에 붙을 때 같은 Wi-Fi의 주소(예: http://192.168.0.10:4300)를 넣어요.</T>
              <TextInput value={base} onChangeText={setB} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="서버 주소" style={st.input} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn label="서버 바꾸기" kind="sec" small style={{ flex: 1 }} onPress={async () => { try { await setBase(base); await reinit(); Alert.alert('서버 주소', `${getBase()}에 연결했어요.`); } catch (e: any) { Alert.alert('서버 주소', e.message); } }} />
                <Btn label="기본값" kind="sec" small style={{ flex: 1 }} onPress={() => setB(DEFAULT_BASE)} />
              </View>
              <T size={12.5} color={C.gray500}>기기 ID {(getDevice() || '').slice(0, 8)}… · {Platform.OS}</T>
            </View>
          ) : null}
        </Group>

        <Group>
          <Row label="내 의뢰·알림 데이터 삭제" onPress={wipe} last a11y="내 의뢰·알림 데이터 삭제" />
        </Group>
        <T size={12} lh={18} color={C.gray500} style={{ paddingHorizontal: 20, marginTop: 10 }}>무료 베타 · 결제·구독·크레딧은 없어요.</T>
      </ScrollView>
    </View>
  );
}

function Group({ title, foot, children }: { title?: string; foot?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: title ? 26 : 22 }}>
      {title ? <T size={13} w={600} color={C.gray500} style={{ paddingHorizontal: 20, marginBottom: 8 }} accessibilityRole="header">{title}</T> : null}
      <View style={st.group}>{children}</View>
      {foot ? <T size={12} lh={18} color={C.gray500} style={{ paddingHorizontal: 20, marginTop: 8 }}>{foot}</T> : null}
    </View>
  );
}

function Row({ label, value, right, chev, onPress, onLongPress, last, a11y }: { label: string; value?: string; right?: React.ReactNode; chev?: boolean; onPress?: () => void; onLongPress?: () => void; last?: boolean; a11y?: string }) {
  const body = (
    <View style={[st.row, !last && st.rowLine]}>
      <T size={15} w={500} style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      {value ? <T size={15} color={C.gray500}>{value}</T> : null}
      {right}
      {chev ? <Icon name="chev" size={18} color={C.gray500} /> : null}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={600} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={a11y || label}
    style={({ pressed }) => pressed && onPress ? { backgroundColor: C.surface } : undefined}>{body}</Pressable>;
}

const st = {
  group: { marginHorizontal: 16, backgroundColor: C.white, borderRadius: R.card, overflow: 'hidden' as const },
  row: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: C.surface },
  inline: { minHeight: 36, paddingHorizontal: 14, marginVertical: -4 },
  notice: { marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: R.card, backgroundColor: C.white, borderWidth: 1, borderColor: C.black },
  input: { borderWidth: 1, borderColor: C.gray300, borderRadius: R.thumb, paddingHorizontal: 12, height: 44, fontFamily: FONT[500], fontSize: 14, color: C.black, backgroundColor: C.white },
};
