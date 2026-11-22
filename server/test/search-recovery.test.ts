// Search Recovery — 실제 상품 탐색 실패를 고친 부분(탐색 시작 구조 · 실제 검색 경로 · 다단계 검색어 · 사진 유사도 · 불확실성 처리)을 단계마다 확인한다.
// 네트워크는 열지 않는다(가짜 fetcher·가짜 이미지 모델 응답). 실측 결과는 docs/WALF_SEARCH_RECOVERY.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as S from '../src/findsearch.ts';
import { saveRequestStyle, isKids, styleFromText } from '../src/catalog.ts';
import { cleanIdentify } from '../src/ai.ts';
import { identifyAllowed } from '../src/aijobs.ts';
import { planQueries, clueQueries, recordQuery, skipReason } from '../src/queryplan.ts';
import { joongnaListings, joongnaSource, looksLikeProduct, INDEX_SOURCES, shopifyHits, shopifySource } from '../src/websources.ts';
import { brainFromEnv, imageScores } from '../src/brain.ts';
import { curateOffers } from '../src/curation.ts';
import { clearRobotsCache } from '../src/sources.ts';
import { SEARCH_SOURCES, type SourceCtx } from '../src/searchsources.ts';
import { offersOf } from '../src/offers.ts';
import { setClock } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const T0 = Date.UTC(2026, 10, 22, 1, 0);
const noPace = async () => {};
const ctx = (over: Partial<SourceCtx> = {}): SourceCtx => ({ isMock: false, mockAllowed: false, env: {}, malls: [], pace: noPace, ...over });
const JN_HTML = `<html><a href="/product/101"><img loading="lazy" src="https://img2.joongna.com/media/original/a.jpg?impolicy=thumb&amp;size=150" alt="남자 커브드 부츠컷 데님 네이비 32 이미지"/><span>남자 커브드 부츠컷 데님 네이비 32</span><span>45,000원</span><span>3시간 전</span></a>
<a href="/product/102"><img src="https://img2.joongna.com/media/original/b.jpg?impolicy=thumb&amp;size=150" alt="여 24 부츠컷 청바지 이미지"/><span>23,000원</span></a>
<a href="/product/103"><img src="https://img2.joongna.com/media/original/c.jpg?impolicy=thumb&amp;size=150" alt="부츠컷 청바지 32 이미지"/><span>판매완료</span><span>10,000원</span></a>
<a href="/product/form?type=regist">판매하기</a></html>`;
const fakeFetch = (pages: Record<string, { status?: number; body: string; type?: string }>) => (async (url: string) => {
  const p = Object.entries(pages).find(([k]) => url.startsWith(k))?.[1];
  return new Response(p ? p.body : 'not found', { status: p ? p.status ?? 200 : 404, headers: { 'content-type': p?.type || 'text/html' } });
}) as any;
const PUBLIC = async () => ['104.18.0.1'];

// ── STEP 1 · 탐색 시작 구조 ──
test('[1] 사진만 있어도(식별 결과 없음) 사진 특징으로 탐색을 시작한다 · 브랜드·상품명을 적었으면 AI 식별을 기다리지 않는다(확인 전 그대로)', () => {
  setClock(T0);
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-rec-0001', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'x.jpg' }, { isMock: false });
  assert.equal(S.targetsOf(db, id).length, 0, '사진 분석 전에는 단서가 없다');
  saveRequestStyle(db, id, { category: ['trousers'], silhouette: ['bootcut'], material: ['denim'], gender: ['men'] }, 'ai');
  const ts = S.targetsOf(db, id);
  assert.deepEqual(ts.map(t => t.basis), ['style_only']);
  assert.deepEqual(ts[0].style?.silhouette, ['bootcut'], '특징 검색어에 쓸 디자인이 실린다');
  const env: S.SearchEnv = { sources: SEARCH_SOURCES, mockAllowed: false, env: { WALF_EXPERIMENT_SOURCES: 'joongna' }, malls: [], pace: noPace, maxDetails: 6, reuseMs: 3600_000 };
  const q = S.queueFindSearch(db, env, id);
  assert.ok(q.id && !q.skipped, `탐색이 대기열에 들어간다(${q.skipped})`);
  const offEnv = { ...env, env: {} };
  assert.match(String(S.queueFindSearch(db, offEnv, D.createRequest(db, D.upsertUser(db, 'device-rec-0002', 'ios').id, { photo: 'y.jpg' }, { isMock: false })).skipped), /식별|단서|소스/);

  const u3 = D.upsertUser(db, 'device-rec-0003', 'ios');
  const id3 = D.createRequest(db, u3.id, { brand: 'Levi’s', productName: '517 부츠컷' } as any, { isMock: false });
  const t3 = S.targetsOf(db, id3);
  assert.equal(t3[0].basis, 'user_input');
  assert.equal(t3[0].certain, false, '사용자 입력은 검증된 상품 정보로 올리지 않는다');
});

// ── STEP 2 · 실제 웹 탐색 경로 ──
test('[2] 중고나라 자체 검색: 법무 확인 전이라 운영에선 닫힘 · 로컬 실험에서만 열림 · 판매 완료 매물 제외 · 400px 썸네일', async () => {
  assert.equal(joongnaSource.availability({ brand: null, name: '', modelCode: null }, ctx()).usable, false);
  assert.equal(joongnaSource.availability({ brand: null, name: '', modelCode: null }, ctx({ env: { WALF_EXPERIMENT_SOURCES: 'joongna' } })).usable, true);
  const ls = joongnaListings(JN_HTML);
  assert.deepEqual(ls.map(x => [x.url.split('/').pop(), x.price, x.status]), [['101', 45000, 'on_sale'], ['102', 23000, 'on_sale'], ['103', 10000, 'sold']]);
  assert.match(ls[0].image!, /size=400/);
  clearRobotsCache();
  const c = ctx({ env: { WALF_EXPERIMENT_SOURCES: 'joongna' }, resolve: PUBLIC, fetcher: fakeFetch({ 'https://web.joongna.com/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' }, 'https://web.joongna.com/search/': { body: JN_HTML } }) });
  const hits = await joongnaSource.search({ text: '남자 부츠컷 청바지', kind: 'feature' }, { brand: null, name: '', modelCode: null }, c);
  assert.deepEqual(hits.map(h => h.url.split('/').pop()), ['101', '102'], '판매 완료는 뺀다');
  assert.equal(hits[0].condition, 'used');
});

test('[2] 검색 API는 키가 없으면 열지 않고 이유를 남긴다 · 발견 결과는 상품 페이지 주소만(목록·약관 금지 판매처 제외)', async () => {
  for (const s of INDEX_SOURCES) assert.match(s.availability({ brand: null, name: '', modelCode: null }, ctx()).reason, /키 없음/);
  assert.equal(looksLikeProduct('https://shop.example.kr/product/detail.html?product_no=123'), true);
  assert.equal(looksLikeProduct('https://shop.example.kr/product/list.html?cate_no=24'), false);
  assert.equal(looksLikeProduct('https://shop.example.kr/category/pants/24/'), false);
  const tavily = INDEX_SOURCES.find(s => s.id === 'tavily')!;
  const c = ctx({ env: { WALF_TAVILY_KEY: 't' }, fetcher: fakeFetch({ 'https://api.tavily.com/search': { type: 'application/json', body: JSON.stringify({ results: [
    { url: 'https://boseshop.kr/product/curved-bootcut/55/', title: '커브드 부츠컷', content: '' },
    { url: 'https://www.musinsa.com/products/123', title: '무신사', content: '' },
    { url: 'https://boseshop.kr/product/list.html?cate_no=1', title: '목록', content: '' }] }) } }) });
  const hits = await tavily.search({ text: '커브드 부츠컷', kind: 'feature' }, { brand: null, name: '', modelCode: null }, c);
  assert.deepEqual(hits.map(h => h.seller), ['boseshop.kr'], '무신사(제휴 필요)·목록 페이지는 후보로 남기지 않는다');
});

test('[2] Shopify Global Catalog: 에이전트 프로필 없으면 닫힘 · 응답에서 판매자 상품 페이지·판매자·이미지·조건', () => {
  assert.equal(shopifySource.availability({ brand: null, name: '', modelCode: null }, ctx()).usable, false);
  const hits = shopifyHits({ result: { structuredContent: { products: [{ title: 'Barbour Bedale Wax Jacket', media: [{ type: 'image', url: 'https://cdn.shopify.com/a.jpg' }],
    variants: [{ url: 'https://shop.example.com/products/bedale?shcgid=1', price: { amount: 45000000, currency: 'KRW' }, seller: { name: 'Example', domain: 'shop.example.com' }, condition: ['secondhand'], availability: { available: true } }] }] } } }, 'barbour bedale');
  assert.deepEqual([hits[0].seller, hits[0].url, hits[0].condition, hits[0].imageUrl], ['shop.example.com', 'https://shop.example.com/products/bedale?shcgid=1', 'used', 'https://cdn.shopify.com/a.jpg']);
});

// ── STEP 3 · 다단계 검색어 ──
test('[3] 상품을 몰라도 검색어를 만든다: 성별·특징(한국어) → 넓게 → 영어·일본어 · 정답(브랜드·모델)은 들어가지 않는다', () => {
  const style = { gender: ['men'], category: ['trousers'], material: ['denim'], silhouette: ['bootcut'], detail: ['curved-seam'], color: ['navy', 'beige'] };
  const q = planQueries({ brand: null, name: '', modelCode: null, aliases: [] }, style);
  assert.deepEqual(q.filter(x => x.kind === 'feature').map(x => x.text), ['남자 커브드 부츠컷 청바지', '남자 네이비 부츠컷 청바지', '남자 베이지 부츠컷 청바지', '부츠컷 청바지', '커브드 청바지']);
  // 통제 어휘에 없는 종류는 사진 분석이 읽은 옷 이름으로(제품군만 남는 넓은 검색어는 만들지 않는다)
  assert.deepEqual(planQueries({ brand: null, name: '', modelCode: null, aliases: [], terms: ['하이탑 스니커즈'] }, { category: ['footwear'], color: ['white'] }).filter(x => x.kind === 'feature').map(x => x.text), ['화이트 하이탑 스니커즈', '하이탑 스니커즈']);
  assert.deepEqual(q.filter(x => x.kind !== 'feature').map(x => x.text), ['mens curved bootcut jeans', 'メンズ ブーツカット ジーンズ']);
  const qb = planQueries({ brand: 'Levi’s', name: '517', modelCode: null, aliases: ['리바이스'] }, style);
  assert.deepEqual(qb.slice(0, 3).map(x => x.kind), ['brand_name', 'alias_name', 'brand_feature']);
  assert.deepEqual(planQueries({ brand: null, name: '', modelCode: null, aliases: [] }, { color: ['red'] }), [], '무엇인지(제품군·실루엣) 모르면 특징 검색을 만들지 않는다');
});
test('[3] 검색 결과에서 얻은 단서(되풀이된 고유 낱말) · 결과 없던 검색어는 3일 동안 다시 보내지 않는다', () => {
  const clues = clueQueries(['카레라 청바지 부츠컷 흑청 사이즈27 R8074', '카레라 부츠컷 데님 32', '갭 스판 부츠컷 30'], { category: ['trousers'], material: ['denim'] }, ['부츠컷 청바지']);
  assert.deepEqual(clues.map(x => x.text), ['카레라 청바지'], '사이즈·관리번호·핏 낱말은 단서가 아니다');
  setClock(T0);
  const db = openDb(':memory:');
  recordQuery(db, 'joongna', { text: '남자 커브드 부츠컷', kind: 'feature' }, 0);
  assert.equal(skipReason(db, 'joongna', '남자 커브드 부츠컷'), null, '한 번 0건은 다시 보낸다');
  recordQuery(db, 'joongna', { text: '남자  커브드 부츠컷', kind: 'feature' }, 0);
  assert.match(String(skipReason(db, 'joongna', '남자 커브드 부츠컷')), /건너뜀/);
  setClock(T0 + 4 * 86400_000);
  assert.equal(skipReason(db, 'joongna', '남자 커브드 부츠컷'), null, '3일이 지나면 다시 보낸다');
});

// ── STEP 4 · 이미지 모델 실연동 ──
test('[4] 이미지 모델은 이 맥 안 주소만 · 맡긴 사진은 파일 경로로만 넘긴다 · 실패하면 null(규칙만으로 계속)', async () => {
  assert.equal(brainFromEnv({ WALF_BRAIN_URL: 'https://example.com' }), null, '외부 주소로 사진 비교를 보내지 않는다');
  const sent: any[] = [];
  const b = { ...brainFromEnv({ WALF_BRAIN_URL: 'http://127.0.0.1:8790' })!, fetcher: (async (_u: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ model: 'moda', revision: '1cdaaaf', ms: 5, scores: [{ id: 'a', score: 0.71 }, { id: 'b', score: null, error: 'x' }] })); }) as any };
  const r = await imageScores(b, '/uploads/q.jpg', [{ id: 'a', imageUrl: 'https://img2.joongna.com/a.jpg' }, { id: 'b', imageUrl: 'https://img2.joongna.com/b.jpg' }, { id: 'c', imageUrl: 'mock://image/x.svg' }]);
  assert.deepEqual(sent[0].query, { path: '/uploads/q.jpg' });
  assert.equal(sent[0].candidates.length, 2, 'http(s) 후보 사진만');
  assert.deepEqual([r!.scores.get('a'), r!.failed, r!.model], [0.71, 1, 'moda@1cdaaaf']);
  const bad = { ...b, fetcher: (async () => { throw new Error('down'); }) as any };
  assert.equal(await imageScores(bad, '/uploads/q.jpg', [{ id: 'a', imageUrl: 'https://img2.joongna.com/a.jpg' }]), null);
});

test('[4·6] 실제 판매처 탐색 끝까지: 사진 특징 검색 → 사진 유사도 정렬(판정은 그대로 unverified) · 반대 성별·아동복은 다른 상품', async () => {
  setClock(T0); clearRobotsCache();
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-rec-0010', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'q.jpg' }, { isMock: false });
  saveRequestStyle(db, id, { gender: ['men'], category: ['trousers'], material: ['denim'], silhouette: ['bootcut'] }, 'ai');
  const html = JN_HTML.replace('<a href="/product/103">', '<a href="/product/104"><img src="https://img2.joongna.com/media/original/d.jpg?size=150" alt="유아동 부츠컷 청바지 (4-5세) 이미지"/><span>9,000원</span></a><a href="/product/103">');
  const brain = { url: 'http://127.0.0.1:8790', timeoutMs: 1000, fetcher: (async (u: string, init: any) => {
    const body = JSON.parse(init.body);
    if (u.endsWith('/zeroshot')) return new Response(JSON.stringify({ results: body.images.map((x: any) => ({ id: x.id, probs: [0.5, 0.5] })) }));
    return new Response(JSON.stringify({ model: 'moda', revision: 'r', ms: 1, scores: body.candidates.map((c: any) => ({ id: c.id, score: c.url.includes('/b.jpg') ? 0.9 : 0.6 })) }));
  }) as any };
  const e: S.SearchEnv = { sources: SEARCH_SOURCES, mockAllowed: false, env: { WALF_EXPERIMENT_SOURCES: 'joongna' }, malls: [], pace: noPace, maxDetails: 6, reuseMs: 3600_000, uploads: '/uploads', brain, enough: 1,
    resolve: PUBLIC, fetcher: fakeFetch({ 'https://web.joongna.com/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' }, 'https://web.joongna.com/search/': { body: html } }) };
  const q = S.queueFindSearch(db, e, id);
  db.prepare(`UPDATE offer_searches SET status='running' WHERE id=?`).run(q.id);
  await S.runFindSearch(db, e, q.id!);
  const offs = offersOf(db, q.id!);
  const by = (n: string) => offs.find(o => o.url.endsWith(`/${n}`))!;
  assert.equal(by('101').verdict, 'unverified', '사진이 닮아도 같은 상품으로 올리지 않는다');
  assert.equal(by('101').imageScore, 0.6);
  assert.match(by('101').checks.find(c => c.field === 'image')!.text, /판정 근거는 아니에요/);
  assert.equal(by('102').verdict, 'different', '제목에 여성 표기(여 24) → 다른 상품');
  assert.equal(by('104').verdict, 'different', '아동복 → 다른 상품');
  const s = db.prepare('SELECT report, queries FROM offer_searches WHERE id=?').get(q.id) as any;
  assert.ok(JSON.parse(s.report).some((x: any) => x.id === 'fashion-brain' && x.outcome === 'ok'));
  assert.equal(JSON.parse(s.queries)[0].kind, 'feature', '첫 검색어부터 사진 특징(식별 결과 없음)');
});

// ── STEP 5 · 불확실성 ──
test('[5] 확인된 주소 집합이 비어 있으면 검증되지 않은 근거 주소를 남기지 않는다 · 식별 검색은 접근 허용된 판매처만', () => {
  const r = cleanIdentify({ identities: [{ brand: 'B', name: 'N', confidence: 'high', refs: ['https://made.up/x'], matched: [], uncertain: [] }] }, new Set());
  assert.deepEqual(r.identities[0].refs, []);
  assert.match(r.identities[0].uncertain.join(' '), /확인되지 않아 뺐어요/);
  assert.deepEqual(['musinsa.com', 'wconcept.co.kr', 'bunjang.co.kr', 'joongna.com', 'badblood.co.kr'].map(identifyAllowed), [false, false, false, false, true]);
});
test('[5·6] 제목이 불완전해도 사진 비교가 됐으면 버리지 않는다 · 정렬 방식 4가지 · 아동복·여성 표기 구분', () => {
  assert.equal(isKids('거의새상품)유아동 기모진청부츠컷청바지 M(4-5세)'), true);
  assert.equal(isKids('리바이스 517 부츠컷 32'), false);
  assert.deepEqual(styleFromText('새상품) 여 24 데님 부츠컷').gender, ['women']);
  const raw = [
    { url: 'https://web.joongna.com/product/1', seller: '중고나라', name: '청바지 팝니다', imageUrl: 'https://i/1.jpg', price: 1, source: 'joongna', relation: 'similar', recommender: 'r', recommenderVersion: '1', style: {} },
    { url: 'https://web.joongna.com/product/2', seller: '중고나라', name: '부츠컷 데님 청바지', imageUrl: 'https://i/2.jpg', price: 1, source: 'joongna', relation: 'similar', recommender: 'r', recommenderVersion: '1', style: styleFromText('부츠컷 데님 청바지') },
  ];
  const style = { category: ['trousers'], silhouette: ['bootcut'], material: ['denim'] };
  const images = { scores: new Map([['web.joongna.com/product/1', 0.9], ['web.joongna.com/product/2', 0.5]]), model: 'moda@r' };
  const base = { style, brand: null, name: null, modelCode: null, size: null, limit: 5, mockAllowed: false };
  const design = curateOffers(raw, { ...base, mode: 'design' });
  assert.deepEqual(design.offers.map(o => o.url.slice(-1)), ['2'], '사진 없이(디자인 태그만)면 제목에 디자인이 없는 매물은 빠진다');
  const img = curateOffers(raw, { ...base, mode: 'image', images });
  assert.deepEqual(img.offers.map(o => o.url.slice(-1)), ['1', '2'], '사진 유사도 정렬에서는 제목이 불완전해도 남는다');
  const dna = curateOffers(raw, { ...base, mode: 'image_dna', images });
  assert.equal(dna.offers[0].imageScore, 0.9);
  assert.ok(dna.offers.every(o => o.verdict === 'unverified'));
});

test('[3·5] 사진 분석 브랜드 추정 정규화(다른 문자·철자) · 문장형 답은 검색어가 아니다 · 모델 번호는 브랜드와 붙여 찾는다', async () => {
  const { normalizeBrand } = await import('../src/catalog.ts');
  const { photoTerms, ossIdentifyData } = await import('../src/oss.ts');
  assert.deepEqual(['耐克', 'dr martens', 'PRO-SPECS', '컨버스', 'Fjallraven', '모르는브랜드'].map(g => normalizeBrand(g)?.name ?? null), ['Nike', 'Dr. Martens', 'Pro-Specs', 'Converse', 'Fjällräven', null]);
  assert.deepEqual(photoTerms({ garment: '사진에 상의(외투)가 보이지 않습니다.', keywords_ko: ['T恤', '회색 V넥 티셔츠', '574'] }), ['회색 V넥 티셔츠', '574']);
  const d = ossIdentifyData({ identities: [], features: { brand_guess: '耐克', garment: '로우탑 가죽 스니커즈' } });
  assert.deepEqual([d.identities[0].brand, d.identities[0].confidence], ['Nike', 'low'], '추정 브랜드는 신뢰도 낮음(숨김 → 내부 단서)으로만');
  const q = planQueries({ brand: 'New Balance', name: '', modelCode: null, aliases: ['뉴발란스'], terms: ['스웨이드 러닝화', '574'] }, { category: ['footwear'], color: ['gray'], silhouette: ['slim'] });
  assert.ok(q.some(x => x.text === '뉴발란스 574'));
  assert.ok(!q.some(x => /슬림/.test(x.text)), '신발에는 핏 낱말을 붙이지 않는다');
});
