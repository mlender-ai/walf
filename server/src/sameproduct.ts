// 이 판매 페이지가 찾는 옷과 같은 상품인가 — 기다려줘(페이지 동일성)와 찾아줘 판매처 탐색(매물 검증)이 같이 쓰는 규칙.
// 높은 확신(same_code)은 품번이 페이지의 품번과 “정확히” 같을 때만이다. 품번 일부만 겹치는 것(W-JKT26-05 ⊂ W-JKT26-055)은 같다고 보지 않는다.
// 브랜드가 부딪히거나(다른 브랜드) 품번이 부딪히면(다른 품번) “다름”, 상품명 핵심 단어만 같으면 “가능성 높음”(확정 아님), 나머지는 “확인 못 함”이다.
// 사진 비교는 아직 연결하지 않았다(PENDING_INTEGRATION) — 사진으로 같은 옷이라고 말하지 않는다.
import { colorsIn } from './catalog.ts';

export type Target = { brand?: string | null; name?: string | null; modelCode?: string | null; aliases?: string[] | null };
export type PageFacts = { title: string | null; brand: string | null };
/** same_code: 품번 정확히 일치(브랜드·품번 충돌 없음) · likely: 상품명 핵심 단어 80% 이상(확정 아님) · different: 다른 품번·다른 브랜드 · unverified: 판단 못 함 */
export type Verdict = 'same_code' | 'likely' | 'unverified' | 'different';
export type Check = { field: 'model_code' | 'brand' | 'name' | 'color' | 'size' | 'image'; result: 'match' | 'mismatch' | 'unknown' | 'not_checked'; text: string };

export const words = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const compact = (s: unknown) => words(s).replace(/\s+/g, '');
export const CODE_RE = /[a-z]{1,5}[-_]?[a-z]{0,5}\d{2,}(?:[-_][a-z0-9]+)*/gi;
const STOP = new Set(['the', 'and', 'with', 'for', 'new', '신상', '정품', '새상품', '상품', '공용', '남녀공용']);
const SIZE_WORD = /^(xxs|xs|s|m|l|xl|xxl|xxxl|free|f|os|\d{2,3})$/;
/** 시즌·연도 표기(FW2024, SS25 등)는 품번이 아니다 */
const SEASON_RE = /^(ss|fw|aw|sp|su|fa|ho|pf|re|f|s)\d{2,4}$/;

/** 상품명에서 비교에 쓸 핵심 단어(브랜드·색·사이즈·흔한 말 제외) */
export function nameTokens(name: unknown, brand?: unknown) {
  const brandWords = new Set(words(brand).split(' '));
  return [...new Set(words(name).split(' '))].filter(x => x.length >= 2 && !brandWords.has(x) && !STOP.has(x) && !colorsIn(x).length && !SIZE_WORD.test(x));
}
/** 제목에 보이는 품번 모양의 값(5자 이상, 시즌 표기 제외) */
export const codesIn = (title: unknown) => (String(title ?? '').match(CODE_RE) || []).filter(x => compact(x).length >= 5 && !SEASON_RE.test(compact(x)));
/** 품번만으로 같은 상품이라고 할 만큼 긴가 — 짧은 품번(M65·JK01 등)은 여러 브랜드·상품이 함께 쓴다 */
export const strongCode = (code: unknown) => { const c = compact(code); return c.length >= 6 && /\d/.test(c) && (/[a-z]/.test(c) || c.length >= 8); };

/** 제목을 품번 단위 조각으로 나눈다(공백·괄호·구분 기호 기준, 품번 안의 -·_ 는 남긴다) */
const codePieces = (title: unknown) => String(title ?? '').toLowerCase().normalize('NFKC').split(/[\s[\](){}/,|·:;#]+/)
  .map(x => x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
/** 페이지 제목에서 찾는 품번이 “정확히” 보이는가. 품번 뒤에 색·사이즈만 붙은 옵션 표기(W-JKT26-055-NAVY)는 같은 품번으로 본다 */
export function codeOnPage(code: unknown, title: unknown): boolean {
  const c = compact(code);
  if (!c) return false;
  return codePieces(title).some(p => {
    if (compact(p) === c) return true;
    for (let i = p.length - 1; i > 0; i--) {
      if (p[i] !== '-' && p[i] !== '_') continue;
      const rest = p.slice(i + 1);
      if (compact(p.slice(0, i)) === c && rest.split(/[-_]/).every(x => SIZE_WORD.test(x) || colorsIn(x).length > 0)) return true;
    }
    return false;
  });
}

/** 연달아 붙은 단어 1~3개를 이은 값 중 하나가 브랜드 이름과 같은가(“BAD BLOOD” = “BADBLOOD”) */
const phraseIn = (ws: string[], name: string) => ws.some((_, i) => [1, 2, 3].some(n => i + n <= ws.length && ws.slice(i, i + n).join('') === name));
/**
 * 브랜드 확인: match(페이지 브랜드·제목에 이름이나 별칭이 단어로 있음) · mismatch(페이지 브랜드가 이름·별칭 어느 것과도 다름) · unknown(페이지에 브랜드가 없음).
 * 부분 문자열로 맞추지 않는다(“NIKE” ≠ “NIKELAB”). 한글·영문 표기는 별칭(brands 표·공식몰 목록)으로만 같은 브랜드로 본다.
 */
export function brandState(t: Target, p: PageFacts): 'match' | 'mismatch' | 'unknown' {
  const names = [...new Set([t.brand, ...(t.aliases || [])].map(compact).filter(Boolean))];
  if (!names.length) return 'unknown';
  if (names.some(n => phraseIn(words(p.title).split(' '), n))) return 'match';
  if (!p.brand) return 'unknown';
  const pw = words(p.brand).split(' ');
  if (names.some(n => compact(p.brand) === n || phraseIn(pw, n))) return 'match';
  return compact(p.brand) ? 'mismatch' : 'unknown';
}

export function compareProduct(t: Target, p: PageFacts): { verdict: Verdict; note: string; checks: Check[] } {
  const title = p.title || '';
  const tw = words(`${title} ${p.brand || ''}`);
  const checks: Check[] = [];
  // 1 브랜드 충돌 — 품번이 같아 보여도 다른 브랜드면 다른 상품이다
  const b = brandState(t, p);
  if (b === 'mismatch') return { verdict: 'different', note: `브랜드가 달라요(페이지: ${p.brand})`, checks: [{ field: 'brand', result: 'mismatch', text: `브랜드 다름(페이지: ${p.brand})` }] };
  // 2 품번 — 정확히 같을 때만 근거. 페이지에 다른 품번만 있으면 충돌(다른 상품), 같은 품번과 다른 품번이 함께 있으면 판단하지 않는다
  const code = t.modelCode ? String(t.modelCode).trim() : '';
  let codeHit = false;
  if (code) {
    const c = compact(code);
    codeHit = codeOnPage(code, title);
    const others = codesIn(title).filter(x => compact(x) !== c && !codeOnPage(code, x));
    if (!codeHit && others.length) return { verdict: 'different', note: `품번이 달라요(찾는 옷 ${code} · 페이지 ${others[0]})`, checks: [{ field: 'model_code', result: 'mismatch', text: `품번 다름(찾는 옷 ${code} · 페이지 ${others[0]})` }] };
    if (codeHit && others.length) checks.push({ field: 'model_code', result: 'unknown', text: `페이지에 품번이 여러 개 있어요(${[code, ...others.slice(0, 2)].join(' · ')})` });
    else if (codeHit && !strongCode(code)) checks.push({ field: 'model_code', result: 'unknown', text: `품번 ${code}이(가) 짧아 품번만으로는 같은 상품이라고 하지 않아요` });
    else if (codeHit) checks.push({ field: 'model_code', result: 'match', text: `품번 ${code} 일치` });
    else checks.push({ field: 'model_code', result: 'unknown', text: '페이지에 품번이 없어요' });
  }
  if (t.brand) checks.push(b === 'match' ? { field: 'brand', result: 'match', text: '브랜드 일치' } : { field: 'brand', result: 'unknown', text: '페이지에서 브랜드를 확인하지 못했어요' });
  if (checks.some(c => c.field === 'model_code' && c.result === 'match'))
    return { verdict: 'same_code', note: `품번 ${code}이(가) 페이지 상품명과 정확히 같아요${b === 'match' ? '' : ' · 브랜드는 페이지에서 확인하지 못했어요'}`, checks };
  // 3 상품명 핵심 단어 — 대부분 같아도 “가능성 높음”까지만(같은 상품 확정 아님)
  const tokens = nameTokens(t.name, t.brand);
  if (tokens.length >= 2) {
    const hit = tokens.filter(x => tw.includes(x)).length;
    checks.push({ field: 'name', result: hit / tokens.length >= 0.8 ? 'match' : 'unknown', text: `상품명 핵심 단어 ${hit}/${tokens.length}개 같음` });
    if (hit / tokens.length >= 0.8) return { verdict: 'likely', note: `상품명 핵심 단어 ${hit}/${tokens.length}개가 페이지 상품명과 같아요(품번으로 확인하지 못함)`, checks };
  }
  return { verdict: 'unverified', note: '등록한 옷과 같은 상품 페이지인지 자동으로 확인하지 못했어요(표기·언어 차이 등). 왈프 팀이 확인해요', checks };
}
