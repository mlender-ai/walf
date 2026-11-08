import React from 'react';
import { ActivityIndicator, Image as RNImage, Pressable, StyleSheet, Text, TextProps, View, ViewStyle, StyleProp, TextStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import { C, FONT, R, Weight } from '@/lib/theme';
import type { Candidate, TagT } from '@/lib/types';

// ── 글자 ──────────────────────────────────────────────────────
type TP = TextProps & { size?: number; w?: Weight; color?: string; lh?: number; ls?: number; max?: number; style?: StyleProp<TextStyle> };
export function T({ size = 15, w = 400, color = C.black, lh, ls, max = 1.6, style, ...p }: TP) {
  return <Text maxFontSizeMultiplier={max} {...p}
    style={[{ fontFamily: FONT[w], fontSize: size, color, lineHeight: lh ?? Math.round(size * 1.5), letterSpacing: ls ?? -0.012 * size }, style]} />;
}

// ── 아이콘(1차 시안과 같은 24 그리드) ─────────────────────────
const P: Record<string, string[]> = {
  home: ['M4 10.4 12 4l8 6.4v9.1a1 1 0 0 1-1 1h-4.6v-5.8H9.6v5.8H5a1 1 0 0 1-1-1z'],
  paw: ['M12 11.7c-2.7 0-5.1 2.7-5.1 5.2 0 1.7 1.2 2.6 2.6 2.6 1 0 1.6-.6 2.5-.6s1.5.6 2.5.6c1.4 0 2.6-.9 2.6-2.6 0-2.5-2.4-5.2-5.1-5.2z'],
  bell: ['M6.2 16.4v-5.2a5.8 5.8 0 1 1 11.6 0v5.2l1.6 2.1H4.6z', 'M10 20.5a2.1 2.1 0 0 0 4 0'],
  user: ['M4.6 20.2c.9-3.7 3.9-5.7 7.4-5.7s6.5 2 7.4 5.7'],
  back: ['M19.5 12H5M11 5.5 4.5 12l6.5 6.5'], close: ['M6 6l12 12M18 6 6 18'],
  ext: ['M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10'],
  check: ['M5 12.6l4.3 4.3L19 7.2'], chev: ['M9.5 5.5 16 12l-6.5 6.5'], plus: ['M12 5v14M5 12h14'],
  camera: ['M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
};
const DOTS: Record<string, [number, number, number][]> = {
  paw: [[6.5, 10.3, 1.9], [9.9, 6.3, 1.9], [14.1, 6.3, 1.9], [17.5, 10.3, 1.9]], user: [[12, 8.2, 3.7]], camera: [[12, 13, 3.2]],
  more: [[5.5, 12, 1.4], [12, 12, 1.4], [18.5, 12, 1.4]],
};
export function Icon({ name, size = 24, color = C.black, filled = false, stroke = 1.7 }: { name: string; size?: number; color?: string; filled?: boolean; stroke?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {(P[name] || []).map((d, i) => <Path key={i} d={d} fill={filled ? color : 'none'} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />)}
      {(DOTS[name] || []).map(([cx, cy, r], i) => <Circle key={'c' + i} cx={cx} cy={cy} r={r} fill={name === 'more' || filled ? color : 'none'} stroke={name === 'more' ? 'none' : color} strokeWidth={stroke} />)}
    </Svg>
  );
}

// ── 버튼 ──────────────────────────────────────────────────────
type BtnP = { label: string; onPress?: () => void; kind?: 'pri' | 'sec'; icon?: string; disabled?: boolean; busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; a11y?: string };
export function Btn({ label, onPress, kind = 'pri', icon, disabled, busy, small, style, a11y }: BtnP) {
  const pri = kind === 'pri', fg = pri ? C.white : C.black;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={a11y || label} accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [s.btn, small && s.btnSm, pri ? s.pri : s.sec, (disabled || busy) && { opacity: 0.35 }, pressed && { opacity: 0.8 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <>
        <T size={small ? 14 : 16} w={700} color={fg} max={1.3} ls={-0.3}>{label}</T>
        {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      </>}
    </Pressable>
  );
}
export function TextBtn({ label, onPress, color = C.gray500, center, a11y }: { label: string; onPress?: () => void; color?: string; center?: boolean; a11y?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y || label} hitSlop={8} style={[{ minHeight: 44, justifyContent: 'center' }, center && { alignSelf: 'center' }]}>
      <T size={13.5} w={600} color={color} style={{ textDecorationLine: 'underline' }}>{label}</T>
    </Pressable>
  );
}
export function IconBtn({ name, onPress, label }: { name: string; onPress: () => void; label: string }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={s.iconBtn}><Icon name={name} /></Pressable>;
}

// ── 증거 배지: v 확인됨(채움) · o 유력(테두리) · p 확인 중(점선) · x 불일치(회색) ──
export function Tag({ t }: { t: TagT }) {
  const st = t.kind === 'v' ? s.tv : t.kind === 'o' ? s.to : t.kind === 'p' ? s.tp : s.tx;
  return (
    <View style={[s.tag, st]} accessibilityLabel={t.text}>
      {t.kind === 'v' ? <Icon name="check" size={12} color={C.white} stroke={2.6} /> : null}
      <T size={11.5} w={700} color={t.kind === 'v' ? C.white : C.black} max={1.3} lh={14}>{t.text}</T>
    </View>
  );
}
export const Tags = ({ tags, style }: { tags: TagT[]; style?: StyleProp<ViewStyle> }) => <View style={[{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }, style]}>{tags.map((t, i) => <Tag key={i} t={t} />)}</View>;

/** 모의 데이터 표시 — 실제 탐색 결과와 섞이지 않게 항상 보인다 */
export function MockPill({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[s.mock, style]} accessibilityLabel="모의 데이터"><T size={10.5} w={800} max={1.2} lh={13} ls={0.3}>모의 데이터</T></View>;
}
export function MockBanner({ text = '이 의뢰에는 테스트용 모의 데이터가 섞여 있어요. 실제 탐색 결과가 아니에요.' }: { text?: string }) {
  return <View style={s.mockBanner}><MockPill /><T size={12.5} style={{ flex: 1 }}>{text}</T></View>;
}

// ── 캐릭터 ────────────────────────────────────────────────────
export const DOG = { stand: require('../../assets/walf/stand.png'), depart: require('../../assets/walf/depart.png'), far: require('../../assets/walf/far.png') };
/** 상태 문장 아바타 — 출발 GIF 1프레임의 얼굴(28px) */
export function Avatar({ quiet }: { quiet?: boolean }) {
  return (
    <View style={[s.av, quiet && { opacity: 0.45 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <RNImage source={DOG.stand} style={{ width: 107, height: 107, position: 'absolute', left: -41, top: -12 }} />
    </View>
  );
}

// ── 상품 사진 · 없을 때 ───────────────────────────────────────
export function ProductImage({ uri, style, label, compact, emptyText = '사진 없이 맡긴 옷' }: { uri?: string | null; style?: StyleProp<ViewStyle>; label: string; compact?: boolean; emptyText?: string }) {
  if (uri) return <Image source={{ uri }} style={[{ backgroundColor: C.canvas, borderRadius: R.card }, style as any]} contentFit="cover" transition={150} accessibilityLabel={label} />;
  return (
    <View style={[{ backgroundColor: C.canvas, borderRadius: R.card, alignItems: 'center', justifyContent: 'center', padding: 8 }, style]} accessibilityLabel={`${label} · ${emptyText}`}>
      {compact ? <Icon name="camera" size={20} color={C.gray500} /> : <><Icon name="camera" size={28} color={C.gray500} /><T size={12.5} color={C.gray500} style={{ marginTop: 6 }}>{emptyText}</T></>}
    </View>
  );
}

// ── 후보 한 줄(홈·추적함) ─────────────────────────────────────
export function CandRow({ c, onPress }: { c: Candidate; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${c.tags.map(t => t.text).join(', ')}. ${c.seller} ${c.size || ''} ${c.priceLabel}. 자세히 보기`}
      style={({ pressed }) => [s.crow, pressed && { backgroundColor: C.canvas }]}>
      <ProductImage uri={c.photoUrl} style={{ width: 56, height: 56, borderRadius: R.thumb }} label="판매자 사진" compact />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><Tag t={c.tags[0]} />{c.isMock ? <MockPill /> : null}</View>
        <T size={14.5} w={700} numberOfLines={1}>{[c.seller, c.size, c.priceLabel].filter(Boolean).join(' · ')}</T>
        <T size={12} color={C.gray500} numberOfLines={1}>{c.kind === 'offer' ? `구매 가능 확인 · ${c.checkedLabel || ''}` : c.kind === 'price_watch' ? c.budgetLabel : `${c.source === 'report' ? '판매자 제보' : '왈프 팀 탐색'} · 왈프 팀 확인 중`}</T>
      </View>
      <Icon name="chev" size={20} color={C.gray500} />
    </Pressable>
  );
}

// ── 7일 칸 ────────────────────────────────────────────────────
export function Seg7({ days, done }: { days?: { state: string }[]; done?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginTop: 10 }} accessibilityLabel={`7일 중 ${done ?? 0}일 탐색`}>
      {Array.from({ length: 7 }, (_, i) => {
        const st = days?.[i]?.state;
        return <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: st === 'done' ? C.black : st === 'missed' ? C.gray500 : C.gray300 }} />;
      })}
    </View>
  );
}

// ── 상태 · 오류 · 빈 화면 ─────────────────────────────────────
export function Loading({ label = '불러오는 중' }: { label?: string }) {
  return <View style={s.center} accessibilityLabel={label}><ActivityIndicator color={C.black} /></View>;
}
export function ErrorBox({ message, onRetry, onServer }: { message: string; onRetry?: () => void; onServer?: () => void }) {
  return (
    <View style={s.errBox} accessibilityRole="alert">
      <T size={15} w={700}>연결이 원활하지 않아요</T>
      <T size={13.5} color={C.gray500} style={{ marginTop: 4 }}>{message}</T>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {onRetry ? <Btn label="다시 시도" kind="sec" small onPress={onRetry} /> : null}
        {onServer ? <Btn label="서버 주소 확인" kind="sec" small onPress={onServer} /> : null}
      </View>
    </View>
  );
}
/** 이미 보이는 데이터가 있을 때의 연결 오류 — 화면을 가리지 않는 한 줄 */
export function ErrorStrip({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${message} 다시 시도`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, minHeight: 40, borderRadius: R.thumb, backgroundColor: C.black }}>
      <T size={12.5} w={600} color={C.white} style={{ flex: 1 }} numberOfLines={1}>연결이 끊겼어요 · 마지막으로 받은 내용이에요</T>
      <T size={12.5} w={700} color={C.white} style={{ textDecorationLine: 'underline' }}>다시 시도</T>
    </Pressable>
  );
}
export function Empty({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 28, gap: 6 }}>
      <T size={16} w={700} style={{ textAlign: 'center' }}>{title}</T>
      {desc ? <T size={13.5} color={C.gray500} style={{ textAlign: 'center' }}>{desc}</T> : null}
      {children}
    </View>
  );
}
export const Gap = ({ h = 8 }: { h?: number }) => <View style={{ height: h, backgroundColor: C.surface }} />;
export const Hair = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[{ height: 1, backgroundColor: C.surface }, style]} />;

export function Section({ title, right, onRight, children, sub }: { title: string; right?: string; onRight?: () => void; sub?: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 22 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T size={17} w={800} ls={-0.5} accessibilityRole="header">{title}</T>
        {right ? <Pressable onPress={onRight} disabled={!onRight} accessibilityRole={onRight ? 'button' : 'text'} hitSlop={10} style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center', marginVertical: -12 }}>
          <T size={13} w={onRight ? 600 : 500} color={C.gray500}>{right}</T></Pressable> : sub ? <T size={12.5} color={C.gray500}>{sub}</T> : null}
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 54, borderRadius: R.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
  btnSm: { minHeight: 44, borderRadius: 10 },
  pri: { backgroundColor: C.black }, sec: { backgroundColor: C.white, borderWidth: 1, borderColor: C.gray300 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 22, paddingHorizontal: 7, borderRadius: R.tag, alignSelf: 'flex-start' },
  tv: { backgroundColor: C.black }, to: { borderWidth: 1.2, borderColor: C.black }, tp: { borderWidth: 1.2, borderColor: C.gray500, borderStyle: 'dashed' }, tx: { backgroundColor: C.surface },
  mock: { borderWidth: 1, borderColor: C.black, borderStyle: 'dashed', borderRadius: R.tag, paddingHorizontal: 5, paddingVertical: 2, alignSelf: 'flex-start' },
  mockBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300, borderStyle: 'dashed', marginBottom: 12 },
  av: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden', backgroundColor: C.white, borderWidth: 1, borderColor: 'rgba(17,17,17,0.1)' },
  crow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300, marginTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  errBox: { margin: 20, padding: 16, borderRadius: R.card, borderWidth: 1, borderColor: C.gray300 },
});
