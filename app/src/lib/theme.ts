// 1차 시안(WALF_Core_Screens) 토큰 그대로 — 포인트 컬러 없음, 상태는 형태와 명도로 구분한다.
export const C = {
  black: '#111111',
  white: '#FFFFFF',
  canvas: '#F7F7F7',
  surface: '#F1F1F1',
  gray500: '#767676',
  gray300: '#D9D9D9',
  dark: '#202020',
} as const;

export const FONT = {
  400: 'Pretendard-Regular',
  500: 'Pretendard-Medium',
  600: 'Pretendard-SemiBold',
  700: 'Pretendard-Bold',
  800: 'Pretendard-ExtraBold',
  900: 'Pretendard-Black',
} as const;
export type Weight = keyof typeof FONT;

export const SP = { gutter: 20 } as const;
export const R = { tag: 4, thumb: 8, card: 12, pill: 999 } as const;
