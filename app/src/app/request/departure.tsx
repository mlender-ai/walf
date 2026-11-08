import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { Btn, DOG, ProductImage, T } from '@/components/ui';
import { useStore } from '@/lib/store';
import { askPushOnce } from '@/lib/push';
import { C, R } from '@/lib/theme';

const FRAMES = 12, FRAME_MS = 170, HOLD_MS = 350; // 출발 GIF 레퍼런스: 12프레임 × 0.17초

/** S03 출발 · 접수 — 서버가 접수를 확인한 뒤 한 번만 재생. 모션 줄이기면 정지 이미지 + 결과 즉시 */
export default function Departure() {
  const { width } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const { me } = useStore();
  const r = me?.active;
  const [reduce, setReduce] = useState<boolean | null>(null);
  const [frame, setFrame] = useState(0);
  const [done, setDone] = useState(false);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduce, () => setReduce(false)); }, []);
  useEffect(() => {
    if (reduce === null) return;
    if (reduce) { setDone(true); rise.setValue(1); AccessibilityInfo.announceForAccessibility('왈프가 출발했어요. 의뢰가 접수됐어요.'); return; }
    let f = 0, iv: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      iv = setInterval(() => {
        f += 1; setFrame(f);
        if (f >= FRAMES) {
          clearInterval(iv); setDone(true);
          Animated.timing(rise, { toValue: 1, duration: 420, easing: Easing.bezier(0.2, 0.7, 0, 1), useNativeDriver: true }).start();
          AccessibilityInfo.announceForAccessibility('왈프가 출발했어요. 의뢰가 접수됐어요.');
        }
      }, FRAME_MS);
    }, HOLD_MS);
    return () => { clearTimeout(start); clearInterval(iv); };
  }, [reduce, rise]);

  // 출발 직후가 알림 권한을 묻기 가장 자연스러운 순간(1차 시안 결정) — 아직 묻지 않았을 때만
  const goHome = () => { (router.canDismiss() ? router.dismissAll() : router.replace('/')); setTimeout(() => { askPushOnce(); }, 400); };
  const W = Math.min(width, 440), H = W * 357 / 358;
  const show = { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] };
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header close={done} onBack={goHome} />
      {!done && reduce === false ? (
        <View style={{ width: W, height: H, overflow: 'hidden', alignSelf: 'center' }} accessibilityLabel="왈프가 뒤돌아 달려 나가는 모션">
          {frame < FRAMES ? <Image source={DOG.depart} style={{ width: W * FRAMES, height: H, transform: [{ translateX: -frame * W }] }} /> : null}
        </View>
      ) : null}
      {done ? (
        <Animated.View style={[{ paddingHorizontal: 20, paddingTop: 12, flex: 1 }, show]}>
          {reduce ? <Image source={DOG.far} style={{ width: 72, height: 72, marginLeft: -8, marginBottom: 6 }} accessibilityLabel="멀리 달려가는 왈프" /> : null}
          <T size={28} w={800} lh={35} ls={-1.25} accessibilityRole="header">왈프가 출발했어요!</T>
          <T size={15} color={C.gray500} style={{ marginTop: 6 }}>이제 귀찮게 돌아다니지 않아도 돼요.</T>
          {r ? (
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 26, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 }}>
              <ProductImage uri={r.product.photoUrl} style={{ width: 64, height: 64, borderRadius: R.thumb }} label="맡긴 옷" compact />
              <View style={{ flex: 1 }}>
                {r.product.brandLabel ? <T size={11.5} w={800} ls={0.5} numberOfLines={1}>{r.product.brandLabel.toUpperCase()}</T> : null}
                <T size={15} w={600} numberOfLines={2}>{r.product.title}</T>
                <T size={12.5} color={C.gray500} numberOfLines={1}>{r.conditions.label || '구매 조건은 나중에'}</T>
              </View>
            </View>
          ) : null}
          <View style={{ marginTop: 28, gap: 16 }}>
            {[['왈프 팀이 어떤 옷인지 확인해요', '확인이 끝나면 7일 탐색이 시작돼요. 그 전에는 기간이 흐르지 않아요.'],
              ['7일 동안 하루 한 번 국내 판매처를 살펴요', '조건에 맞는 매물이 없으면 수배할지 물어볼게요.'],
              ['소식이 있을 때만 알려드려요', '매일 의미 없는 알림은 보내지 않아요.']].map(([b, d], i) => (
              <View key={b} style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.2, borderColor: C.black, alignItems: 'center', justifyContent: 'center' }}><T size={12} w={800} lh={14} max={1.2}>{i + 1}</T></View>
                <View style={{ flex: 1 }}><T size={15} w={700} lh={22}>{b}</T><T size={13} color={C.gray500} lh={19.5} style={{ marginTop: 2 }}>{d}</T></View>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}
      {done ? (
        <Animated.View style={[{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(bottom, 16), borderTopWidth: 1, borderTopColor: C.surface }, show]}>
          <Btn label="확인" onPress={goHome} />
        </Animated.View>
      ) : null}
    </View>
  );
}
