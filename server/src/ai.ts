// AI 보조 — 맡긴 사진·링크·이름으로 어떤 상품인지 후보를 좁히고(식별), 확정된 상품을 국내 판매처에서 찾아본다(탐색).
// 결과는 언제나 “AI 제안 · 검수 전”이다. 왈프 팀이 확인하기 전에는 사용자에게 보이지 않고, 구매 가능으로 표시하지 않는다.
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

export type Seller = { id: number; name: string; domain: string };
export type IdentifyInput = { productName?: string | null; brand?: string | null; productUrl?: string | null; note?: string | null; size?: string | null; color?: string | null; photoPath?: string | null };
export type Identity = { brand: string; name: string; color: string; category: string; confidence: 'high' | 'medium' | 'low'; reasons: string[]; refs: string[] };
export type IdentifyResult = { identities: Identity[]; missing: string[]; summary: string };
export type SearchInput = { brand: string; name: string; color?: string | null; size?: string | null; maxPrice?: number | null; usedOk: boolean; day: number; sellers: Seller[]; known: string[] };
export type Listing = { seller: string; url: string; title: string; price: number | null; size: string; condition: 'new' | 'used' | 'unknown'; match: 'same_likely' | 'similar' | 'unknown'; stock: 'listed' | 'sold_out' | 'unknown'; reason: string; urlSeen: boolean | null };
export type SellerNote = { seller: string; searched: boolean; note: string };
export type SearchResult = { sellers: SellerNote[]; listings: Listing[]; summary: string; dropped: number; blocked: string[] };
export type Usage = { model: string; inputTokens: number; outputTokens: number; searches: number };
export interface AiProvider {
  kind: 'claude' | 'mock';
  label: string;
  identify(input: IdentifyInput): Promise<{ data: IdentifyResult; usage: Usage }>;
  search(input: SearchInput): Promise<{ data: SearchResult; usage: Usage }>;
}

export class AiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/** server/.env 로 고른다. 키가 없으면 AI 없이(운영자 직접 확인) 돈다 — 없는 결과를 만들어 내지 않는다. */
export function aiFromEnv(env = process.env): AiProvider | null {
  if (env.WALF_AI_PROVIDER === 'off') return null;
  if (env.WALF_AI_PROVIDER === 'mock') return mockProvider();
  if (env.WALF_AI_PROVIDER === 'claude' || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return claudeProvider({ model: env.WALF_AI_MODEL, effort: env.WALF_AI_EFFORT });
  return null;
}

// ── 결과 정리(모델 출력은 그대로 믿지 않는다) ─────────────────────────
const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean).slice(0, n);
const isHttp = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const pick = <T extends string>(v: unknown, ok: readonly T[], dflt: T): T => (ok as readonly string[]).includes(String(v)) ? v as T : dflt;
/** 같은 페이지인지 비교할 때 쓰는 열쇠(프로토콜·www·m·끝 슬래시·#은 무시) */
export const urlKey = (u: string) => { try { const x = new URL(u); return x.host.toLowerCase().replace(/^(www|m)\./, '') + x.pathname.replace(/\/+$/, '') + x.search; } catch { return u; } };
const onDomain = (u: string, domain: string) => { try { const h = new URL(u).host.toLowerCase(); return h === domain || h.endsWith('.' + domain); } catch { return false; } };

export function cleanIdentify(raw: any): IdentifyResult {
  const identities = (Array.isArray(raw?.identities) ? raw.identities : []).map((x: any): Identity => ({
    brand: str(x?.brand, 60), name: str(x?.name, 120), color: str(x?.color, 40), category: str(x?.category, 40),
    confidence: pick(x?.confidence, ['high', 'medium', 'low'] as const, 'low'),
    reasons: strs(x?.reasons, 5, 200), refs: strs(x?.refs, 5, 1000).filter(isHttp),
  })).filter((x: Identity) => x.name).slice(0, 3);
  return { identities, missing: strs(raw?.missing, 4, 200), summary: str(raw?.summary, 300) };
}

/** 판매처 도메인이 아닌 주소(해외·다른 사이트)는 버리고, 검색 결과에 없던 주소는 표시해 둔다 */
export function cleanSearch(raw: any, sellers: Seller[], seen: Set<string> | null, blocked: string[] = []): SearchResult {
  const byName = new Map(sellers.map(s => [s.name, s]));
  const notes = (Array.isArray(raw?.sellers) ? raw.sellers : []).filter((x: any) => byName.has(x?.seller))
    .map((x: any): SellerNote => ({ seller: x.seller, searched: x.searched === true && !blocked.includes(x.seller), note: str(x?.note, 200) }));
  for (const s of sellers) if (!notes.some((n: SellerNote) => n.seller === s.name)) notes.push({ seller: s.name, searched: false, note: blocked.includes(s.name) ? 'AI가 이 사이트를 검색할 수 없었어요' : 'AI가 결과를 남기지 않았어요' });
  let dropped = 0;
  const listings: Listing[] = [];
  for (const x of Array.isArray(raw?.listings) ? raw.listings : []) {
    const s = byName.get(x?.seller);
    const url = str(x?.url, 1000);
    if (!s || (url && (!isHttp(url) || !onDomain(url, s.domain)))) { dropped++; continue; }
    const price = x?.price == null || x.price === '' ? null : Math.round(Number(x.price));
    listings.push({
      seller: s.name, url, title: str(x?.title, 160), price: Number.isFinite(price) && price! >= 0 ? price : null, size: str(x?.size, 20),
      condition: pick(x?.condition, ['new', 'used', 'unknown'] as const, 'unknown'), match: pick(x?.match, ['same_likely', 'similar', 'unknown'] as const, 'unknown'),
      stock: pick(x?.stock, ['listed', 'sold_out', 'unknown'] as const, 'unknown'), reason: str(x?.reason, 300),
      urlSeen: !url || !seen || !seen.size ? null : seen.has(urlKey(url)),
    });
  }
  return { sellers: notes, listings: listings.slice(0, 20), summary: str(raw?.summary, 300), dropped, blocked };
}

// ── 사진 ─────────────────────────────────────────────────────
/** 긴 변 1568px JPEG로 줄여 보낸다(API 이미지 한도 안, 토큰 절약). 읽지 못하면 실패로 알린다. */
export async function photoBlock(file: string) {
  try {
    const buf = await sharp(file, { failOn: 'none' }).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: buf.toString('base64') } };
  } catch (e: any) {
    throw new AiError('bad_image', `사진을 읽지 못했어요(${str(e?.message, 80)}). 다른 형식으로 다시 받아야 할 수 있어요.`);
  }
}

// ── Claude ───────────────────────────────────────────────────
const KR = { type: 'approximate' as const, country: 'KR', city: 'Seoul', timezone: 'Asia/Seoul' };
const SELLER_HINT = '무신사, 29CM, W컨셉, 번개장터, 중고나라, 후루츠패밀리';

const IDENTIFY_SYSTEM = `너는 국내 중고·리셀 의류 탐색 서비스 WALF의 상품 식별 보조다. 사용자가 맡긴 사진·링크·상품명·메모를 보고 이 옷이 정확히 어떤 상품(브랜드·모델·색상)인지 후보를 좁힌다. 네 결과는 왈프 팀 운영자가 검수한 뒤에만 쓰인다.

- 웹 검색으로 브랜드 공식몰과 국내 판매처(${SELLER_HINT} 등)의 상품 페이지를 찾아 모델명과 색상 표기를 확인한다. 링크가 있으면 먼저 열어 본다.
- 후보는 가장 유력한 것부터 최대 3개. 사진·페이지로 확인한 근거와 추정에 그친 부분을 구분해 reasons에 한 줄씩 적는다.
- 확실하지 않으면 confidence를 low로 두고, 판단에 더 필요한 정보(예: 케어라벨·태그 사진, 구매 링크)를 missing에 적는다.
- 상품명은 판매 페이지에서 실제로 쓰는 표기를 따른다. 찾지 못한 모델명을 지어내지 않는다.
- refs에는 검색 결과나 열어 본 페이지에서 실제로 확인한 주소만 넣는다.
- 결과는 반드시 submit_identification 도구로 한 번 제출한다. 모든 문장은 한국어로, 운영자가 바로 읽을 수 있게 짧게 쓴다.`;

const SEARCH_SYSTEM = `너는 국내 중고·리셀 의류 탐색 서비스 WALF의 매물 탐색 보조다. 왈프 팀이 확인한 상품을 지정된 국내 판매처에서 찾는다. 네 결과는 왈프 팀 운영자가 검수한 뒤에만 사용자에게 전해진다.

- 지정된 판매처 사이트만 검색한다. 해외 판매처·해외 직구 매물은 찾지 않는다.
- 판매처마다 검색을 시도했는지(searched)와 본 것을 note에 한 줄로 적는다. 검색이 막혔거나 결과를 보지 못했으면 searched=false로 두고 이유를 적는다. 검색하지 않은 판매처를 “매물 없음”으로 적지 않는다.
- listings에는 같은 상품으로 보이는 매물(match=same_likely)과 비슷한 상품(match=similar)을 넣는다. url은 검색 결과나 열어 본 페이지에 있던 판매 페이지 주소만 쓴다.
- 가격·사이즈·판매 상태는 페이지에서 본 그대로만 적는다. 모르면 price=null, size="", stock=unknown.
- 매물을 지금 살 수 있다고 단정하지 않는다. 구매 가능 여부는 왈프 팀이 확인한다.
- 이미 알려진 주소는 다시 넣지 않는다.
- 결과는 반드시 submit_search 도구로 한 번 제출한다. 모든 문장은 한국어로 짧게 쓴다.`;

const S = { type: 'string' } as const;
const SA = { type: 'array', items: S } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

const IDENTIFY_TOOL = {
  name: 'submit_identification', strict: true,
  description: '상품 식별 결과를 왈프 팀에 제출한다. 모든 확인이 끝난 뒤 한 번만 호출한다.',
  input_schema: obj({
    identities: { type: 'array', description: '유력한 순서, 최대 3개', items: obj({ brand: S, name: { type: 'string', description: '판매 페이지 표기 그대로의 모델명' }, color: S, category: S,
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, reasons: SA, refs: { type: 'array', items: S, description: '확인한 페이지 주소' } }) },
    missing: { type: 'array', items: S, description: '판단에 더 필요한 정보' },
    summary: { type: 'string', description: '운영자에게 한두 문장 요약' },
  }),
};
const searchTool = (names: string[]) => ({
  name: 'submit_search', strict: true,
  description: '판매처 탐색 결과를 왈프 팀에 제출한다. 모든 판매처를 살펴본 뒤 한 번만 호출한다.',
  input_schema: obj({
    sellers: { type: 'array', items: obj({ seller: { type: 'string', enum: names }, searched: { type: 'boolean' }, note: S }) },
    listings: { type: 'array', items: obj({ seller: { type: 'string', enum: names }, url: S, title: S, price: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: '원 단위, 모르면 null' },
      size: S, condition: { type: 'string', enum: ['new', 'used', 'unknown'] }, match: { type: 'string', enum: ['same_likely', 'similar', 'unknown'] },
      stock: { type: 'string', enum: ['listed', 'sold_out', 'unknown'] }, reason: S }) },
    summary: S,
  }),
});

/** 응답 안에 보인 웹 주소(검색 결과·열어 본 페이지·인용). 지어낸 주소를 가려내는 데 쓴다.
 *  모델이 직접 쓴 입력(제출 도구·검색어·열어 달라고 한 주소)은 “본 것”이 아니라서 세지 않는다. */
function collectUrls(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) { node.forEach(x => collectUrls(x, out)); return; }
  if (!node || typeof node !== 'object') return;
  if ((node as any).type === 'tool_use' || (node as any).type === 'server_tool_use') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' && typeof v === 'string' && isHttp(v)) out.add(urlKey(v));
    else if (typeof v === 'object') collectUrls(v, out);
  }
}

export function claudeProvider(opts: { model?: string; effort?: string } = {}): AiProvider {
  const client = new Anthropic();
  const model = opts.model || 'claude-opus-5-5';
  const effort = pick(opts.effort, ['low', 'medium', 'high', 'xhigh', 'max'] as const, 'high');

  /** 웹 검색을 쓰게 하고, 마지막에 제출 도구로 받은 입력을 돌려준다. 거절·중단·미제출은 실패로 알린다. */
  async function ask(system: string, content: Anthropic.Beta.BetaContentBlockParam[], tools: any[], submit: any) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
    const usage: Usage = { model, inputTokens: 0, outputTokens: 0, searches: 0 };
    const seen = new Set<string>();
    let nudged = false;
    for (let turn = 0; turn < 8; turn++) {
      const res = await client.beta.messages.create({
        model, max_tokens: 16000, system, messages, tools: [...tools, submit],
        thinking: { type: 'adaptive' }, output_config: { effort },
        // 안전 분류기가 거절하면 Anthropic이 권하는 모델로 서버에서 다시 시도한다
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      } as any, { timeout: 8 * 60_000 }) as Anthropic.Beta.BetaMessage;
      const u: any = res.usage;
      usage.model = res.model;
      usage.inputTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      usage.outputTokens += u.output_tokens || 0;
      usage.searches += u.server_tool_use?.web_search_requests || 0;
      collectUrls(res.content, seen);
      if (res.stop_reason === 'refusal') throw new AiError('refusal', `AI가 이 요청을 처리하지 않았어요${(res as any).stop_details?.category ? ` (${(res as any).stop_details.category})` : ''}.`);
      const call = res.content.find((b: any) => b.type === 'tool_use' && b.name === submit.name) as any;
      if (call) {
        if (res.stop_reason === 'max_tokens') throw new AiError('max_tokens', 'AI 결과가 길이 한도에서 잘렸어요. 다시 실행해 주세요.');
        return { input: call.input, usage, seen };
      }
      if (res.stop_reason === 'max_tokens') throw new AiError('max_tokens', 'AI가 결과를 내기 전에 길이 한도에 닿았어요. 다시 실행해 주세요.');
      messages.push({ role: 'assistant', content: res.content as any });
      if (res.stop_reason === 'pause_turn') continue; // 서버 도구 반복 한도 — 그대로 다시 보내면 이어서 한다
      if (nudged) break;
      nudged = true;
      messages.push({ role: 'user', content: `확인한 내용을 ${submit.name} 도구로 제출해 주세요.` });
    }
    throw new AiError('no_result', 'AI가 결과를 제출하지 않았어요. 다시 실행해 주세요.');
  }

  return {
    kind: 'claude', label: `Claude ${model}`,
    async identify(i) {
      const lines = [
        '맡긴 의뢰 정보',
        `- 사용자가 쓴 상품명: ${i.productName || '없음'}`, `- 브랜드: ${i.brand || '없음'}`, `- 링크: ${i.productUrl || '없음'}`,
        `- 메모: ${i.note || '없음'}`, `- 원하는 사이즈·색상: ${[i.size, i.color].filter(Boolean).join(' · ') || '없음'}`,
        `- 사진: ${i.photoPath ? '첨부 1장' : '없음'}`,
      ];
      const content: any[] = [...(i.photoPath ? [await photoBlock(i.photoPath)] : []), { type: 'text', text: lines.join('\n') }];
      const tools = [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: KR },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4, max_content_tokens: 8000 },
      ];
      const out = await ask(IDENTIFY_SYSTEM, content, tools, IDENTIFY_TOOL);
      return { data: cleanIdentify(out.input), usage: out.usage };
    },
    async search(i) {
      let sellers = i.sellers.filter(s => s.domain);
      const blocked: string[] = [];
      // 크롤러가 접근할 수 없는 도메인은 요청 전체를 400으로 막는다 — 그 판매처만 빼고 다시 시도하고, “AI 검색 불가”로 남긴다
      for (;;) {
        const domains = sellers.map(s => s.domain);
        const lines = [
          `DAY ${i.day} 탐색`, `확인된 상품: ${[i.brand, i.name].filter(Boolean).join(' ')}`,
          `색상: ${i.color || '상관없음'} · 사용자가 원하는 사이즈: ${i.size || '미정'} · 희망가: ${i.maxPrice ? `${i.maxPrice.toLocaleString('ko-KR')}원 이하(배송비 포함)` : '없음'} · 중고: ${i.usedOk ? '괜찮음' : '새 상품만'}`,
          `판매처: ${sellers.map(s => `${s.name}(${s.domain})`).join(', ')}`,
          `이미 알려진 주소: ${i.known.length ? i.known.slice(0, 40).join(' , ') : '없음'}`,
        ];
        const tools = [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 12, allowed_domains: domains, user_location: KR },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8, allowed_domains: domains, max_content_tokens: 6000 },
        ];
        try {
          const out = await ask(SEARCH_SYSTEM, [{ type: 'text', text: lines.join('\n') }], tools, searchTool(sellers.map(s => s.name)));
          return { data: cleanSearch(out.input, i.sellers, out.seen, blocked), usage: out.usage };
        } catch (e) {
          const bad = e instanceof Anthropic.BadRequestError ? sellers.filter(s => String(e.message).includes(s.domain)) : [];
          if (!bad.length || bad.length === sellers.length) throw e;
          blocked.push(...bad.map(s => s.name));
          sellers = sellers.filter(s => !bad.includes(s));
        }
      }
    },
  };
}

/** API 오류를 운영자가 읽을 한 문장으로 */
export function aiErrorText(e: any): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 맞지 않아요. server/.env 의 ANTHROPIC_API_KEY 를 확인하세요.';
  if (e instanceof Anthropic.PermissionDeniedError) return `이 키로는 쓸 수 없는 기능이에요(조직 설정에서 웹 검색이 꺼져 있을 수 있어요). ${str(e.message, 200)}`;
  if (e instanceof Anthropic.RateLimitError) return '요청 한도에 걸렸어요. 잠시 뒤 다시 실행하세요.';
  if (e instanceof Anthropic.BadRequestError) return `요청이 거부됐어요: ${str(e.message, 240)}`;
  if (e instanceof Anthropic.APIConnectionError) return 'AI 서버에 연결하지 못했어요. 네트워크를 확인하세요.';
  if (e instanceof Anthropic.APIError) return `AI 서버 오류(${e.status ?? '?'}): ${str(e.message, 200)}`;
  return `AI 작업 실패: ${str(e?.message || e, 200)}`;
}

// ── 모의(QA·자동 테스트 전용) ─────────────────────────────────────
/** 실제로 아무것도 보지 않는다. 결과는 모두 “모의”로 저장되고 어드민·앱에 모의 표시가 붙는다. */
export function mockProvider(): AiProvider {
  const usage: Usage = { model: 'mock', inputTokens: 0, outputTokens: 0, searches: 0 };
  return {
    kind: 'mock', label: '모의 AI(실제 분석 아님)',
    async identify(i) {
      const named = i.productName || '';
      return { usage, data: {
        identities: [{ brand: i.brand || '', name: named || '모의 식별 결과', color: named ? '' : i.color || '', category: '의류', confidence: named ? 'medium' : 'low',
          reasons: [named ? '모의 결과예요 — 사용자가 쓴 이름을 그대로 옮겼어요' : '모의 결과예요 — 사진을 실제로 보지 않았어요'], refs: [] }],
        missing: named ? [] : ['정확한 모델명을 알 수 있는 태그 사진'], summary: '모의 AI 결과 — 실제 분석이 아니에요',
      } };
    },
    async search(i) {
      const used = i.sellers.find(s => s.name === '번개장터') || i.sellers[0];
      return { usage, data: {
        sellers: i.sellers.map(s => ({ seller: s.name, searched: true, note: '모의 — 실제로 검색하지 않았어요' })),
        listings: used ? [{ seller: used.name, url: '', title: `${i.name} (모의 매물)`, price: 129000, size: i.size || '', condition: 'used', match: 'same_likely', stock: 'unknown', reason: '모의 결과예요 — 실제 매물이 아니에요', urlSeen: null }] : [],
        summary: '모의 AI 결과 — 실제 탐색이 아니에요', dropped: 0, blocked: [],
      } };
    },
  };
}
