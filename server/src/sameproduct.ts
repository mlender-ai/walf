// 이 판매 페이지가 찾는 옷과 같은 상품인가 — 기다려줘(페이지 동일성)와 찾아줘 판매처 탐색(매물 검증)이 같이 쓰는 규칙.
// 자동으로는 품번이 같거나 상품명 핵심 단어가 대부분 같을 때만 “같음 쪽”으로 보고, 다른 브랜드·다른 품번은 “다름”, 나머지는 “확인 못 함”이다.
// 사진 비교는 아직 연결하지 않았다(PENDING_INTEGRATION) — 사진으로 같은 옷이라고 말하지 않는다.
import { colorsIn } from './catalog.ts';

export type Target = { brand?: string | null; name?: string | null; modelCode?: string | null };
export type PageFacts = { title: string | null; brand: string | null };
/** same_code: 품번이 페이지에 있음 · likely: 브랜드가 맞고 상품명 핵심 단어 80% 이상 · different: 다른 품번·다른 브랜드 · unverified: 판단 못 함 */
export type Verdict = 'same_code' | 'likely' | 'unverified' | 'different';
export type Check = { field: 'model_code' | 'brand' | 'name' | 'color' | 'size' | 'image'; result: 'match' | 'mismatch' | 'unknown' | 'not_checked'; text: string };

export const words = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const compact = (s: unknown) => words(s).replace(/\s+/g, '');
export const CODE_RE = /[a-z]{1,5}[-_]?[a-z]{0,5}\d{2,}(?:[-_][a-z0-9]+)*/gi;
const STOP = new Set(['the', 'and', 'with', 'for', 'new', '신상', '정품', '새상품', '상품', '공용', '남녀공용']);
const SIZE_WORD = /^(xxs|xs|s|m|l|xl|xxl|free|\d{2,3})$/;

/** 상품명에서 비교에 쓸 핵심 단어(브랜드·색·사이즈·흔한 말 제외) */
export function nameTokens(name: unknown, brand?: unknown) {
  const brandWords = new Set(words(brand).split(' '));
  return [...new Set(words(name).split(' '))].filter(x => x.length >= 2 && !brandWords.has(x) && !STOP.has(x) && !colorsIn(x).length && !SIZE_WORD.test(x));
}
/** 제목에 보이는 품번 모양의 값(5자 이상) */
export const codesIn = (title: unknown) => (String(title ?? '').match(CODE_RE) || []).filter(x => compact(x).length >= 5);

export function compareProduct(t: Target, p: PageFacts): { verdict: Verdict; note: string; checks: Check[] } {
  const title = p.title || '';
  const tw = words(`${title} ${p.brand || ''}`), tc = tw.replace(/\s+/g, '');
  const checks: Check[] = [];
  const code = t.modelCode;
  if (code) {
    const c = compact(code);
    if (c && tc.includes(c)) return { verdict: 'same_code', note: `품번 ${code}이(가) 페이지 상품명에 있어요`, checks: [{ field: 'model_code', result: 'match', text: `품번 ${code} 일치` }] };
    const other = codesIn(title).find(x => compact(x) !== c);
    if (other) return { verdict: 'different', note: `품번이 달라요(등록 ${code} · 페이지 ${other})`, checks: [{ field: 'model_code', result: 'mismatch', text: `품번 다름(찾는 옷 ${code} · 페이지 ${other})` }] };
    checks.push({ field: 'model_code', result: 'unknown', text: '페이지에 품번이 없어요' });
  }
  const bk = compact(t.brand);
  if (bk && p.brand && !compact(p.brand).includes(bk) && !bk.includes(compact(p.brand)) && !tc.includes(bk))
    return { verdict: 'different', note: `브랜드가 달라요(페이지: ${p.brand})`, checks: [...checks, { field: 'brand', result: 'mismatch', text: `브랜드 다름(페이지: ${p.brand})` }] };
  if (bk) checks.push(tc.includes(bk) || (p.brand && compact(p.brand).includes(bk)) ? { field: 'brand', result: 'match', text: '브랜드 일치' } : { field: 'brand', result: 'unknown', text: '페이지에서 브랜드를 확인하지 못했어요' });
  const tokens = nameTokens(t.name, t.brand);
  if (tokens.length >= 2) {
    const hit = tokens.filter(x => tw.includes(x)).length;
    checks.push({ field: 'name', result: hit / tokens.length >= 0.8 ? 'match' : 'unknown', text: `상품명 핵심 단어 ${hit}/${tokens.length}개 같음` });
    if (hit / tokens.length >= 0.8) return { verdict: 'likely', note: `상품명 핵심 단어 ${hit}/${tokens.length}개가 페이지 상품명과 같아요`, checks };
  }
  return { verdict: 'unverified', note: '등록한 옷과 같은 상품 페이지인지 자동으로 확인하지 못했어요(표기·언어 차이 등). 왈프 팀이 확인해요', checks };
}
