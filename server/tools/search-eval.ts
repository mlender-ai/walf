// Search Recovery 평가(STEP 7) — 권리가 확인된 실제 상품 사진으로 "WALF가 실제로 옷을 찾는지"를 잰다.
// 사례마다: 사진만 맡긴 의뢰를 만들고 → 로컬 사진 분석(제품과 같은 Qwen3-VL) → 판매처 탐색(실제 검색 경로) → 사진 유사도 정렬 → 정답 규칙으로 채점.
// 정답(브랜드·모델)은 검색어에 넣지 않는다 — 채점에만 쓴다. 이미지 모델 성능(사진 유사도)과 실제 인터넷 탐색 성공률을 따로 적는다.
//
// 사용: node tools/search-eval.ts <cases.json> <결과 폴더> [사례 id,...]
// 환경: WALF_EXPERIMENT_SOURCES=joongna · WALF_BRAIN_URL=http://127.0.0.1:8790 · WALF_OSS_* (엔진) · 결과 폴더는 저장소 밖(scratchpad)에 둔다
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as S from '../src/findsearch.ts';
import { saveRequestStyle, styleFromText, isKids, type Style } from '../src/catalog.ts';
import { offersOf, type ProductOffer } from '../src/offers.ts';
import { curateOffers, RANK_MODES, type RankMode } from '../src/curation.ts';
import { ossIdentifyData, ossOptions, runEngine } from '../src/oss.ts';
import { imageGender, photoAttributes } from '../src/brain.ts';
import { urlKey } from '../src/sources.ts';

type Case = { id: string; group: string; image: string; license: string; source_url: string; note?: string;
  truth: { brand: string | null; model: string | null; aliases_ko?: string[]; aliases_en?: string[]; category: string; color?: string; gender?: string; match_regex: string | null; market_presence: string } };
const [casesFile, outDir, only] = process.argv.slice(2);
if (!casesFile || !outDir) { console.error('사용: node tools/search-eval.ts <cases.json> <결과 폴더> [id,...]'); process.exit(1); }
const cases: Case[] = JSON.parse(fs.readFileSync(casesFile, 'utf8')).filter((c: Case) => !only || only.split(',').includes(c.id));
const baseDir = path.dirname(casesFile);
fs.mkdirSync(path.join(outDir, 'uploads'), { recursive: true });
const db = openDb(path.join(outDir, 'eval.db'));
const e = S.searchEnvFrom({ mockAllowed: false, uploads: path.join(outDir, 'uploads'), env: { ...process.env, WALF_SEARCH_KEEP: '500' } });
const oss = ossOptions(process.env);
const resultsFile = path.join(outDir, 'results.jsonl');
const done = new Set(fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);

// 정답 판정: 규칙(정규식)이 있으면 제목에, 없으면(시장에 같은 상품 없음) 정답 없음
const isHit = (c: Case, title: string | null) => !!c.truth.match_regex && new RegExp(c.truth.match_regex, 'i').test(String(title || ''));
const CAT: Record<string, string[]> = { trousers: ['trousers'], jeans: ['trousers'], pants: ['trousers'], shirt: ['shirts'], shirts: ['shirts'], tee: ['tees'], 't-shirt': ['tees'], tees: ['tees'],
  jacket: ['jacket', 'outerwear'], coat: ['outerwear', 'jacket'], outerwear: ['outerwear', 'jacket'], knitwear: ['knitwear'], sweater: ['knitwear'], sweatshirt: ['knitwear', 'tees'], hoodie: ['knitwear', 'tees'],
  footwear: ['footwear'], shoes: ['footwear'], sneakers: ['footwear'], boots: ['footwear'], sandals: ['footwear'], bags: ['bags'], bag: ['bags'], dress: ['dress'], skirt: ['skirt'], polo: ['tees', 'shirts'] };
const catOf = (c: Case) => CAT[String(c.truth.category || '').toLowerCase()] || [String(c.truth.category || '').toLowerCase()];
/** 대체 추천 적합도(자동 근사): 제목의 제품군이 정답 제품군과 맞고(모르면 통과), 성별이 반대가 아니고, 아동복이 아님 */
const fits = (c: Case, o: ProductOffer) => {
  const st = styleFromText(o.name), want = catOf(c);
  const catOk = !st.category?.length || st.category.some(x => want.includes(x));
  const g = st.gender?.[0], tg = c.truth.gender;
  const genderOk = !g || !tg || tg === 'unisex' || g === tg;
  return catOk && genderOk && !isKids(o.name);
};

for (const [n, c] of cases.entries()) {
  if (done.has(c.id)) continue;
  const t0 = Date.now();
  const src = path.resolve(baseDir, c.image);
  const photo = `${c.id}${path.extname(src) || '.jpg'}`;
  fs.copyFileSync(src, path.join(outDir, 'uploads', photo));
  const u = D.upsertUser(db, `eval-device-${c.id}`.padEnd(16, '0'), 'ios');
  const id = D.createRequest(db, u.id, { photo, note: c.note || undefined }, { isMock: false });
  // 1 사진 분석(제품의 무료 엔진 식별과 같은 단계 — 식별 검색 판매처 없음, 이번 변경 그대로)
  const t1 = Date.now();
  let features: any = null, style: Style = {}, identities: any[] = [], idErr: string | null = null;
  try {
    const j = await runEngine(oss, 'identify', { photo: path.join(outDir, 'uploads', photo), sellers: [], note: c.note || '' });
    features = j.features || null;
    // 제품의 무료 엔진 식별과 같은 변환(낮은 신뢰도 브랜드 추정은 숨김 후보 → 내부 검색 단서)
    const data = ossIdentifyData(j, c.note);
    identities = data.identities;
    style = data.style;
  } catch (err: any) { idErr = String(err?.message || err).slice(0, 200); }
  // 제품과 같게: 이미지 모델 제로샷으로 빈 성별·제품군·바지 실루엣을 채운다
  const extra = await photoAttributes(e.brain ?? null, path.join(outDir, 'uploads', photo), style as any);
  for (const [k, v] of Object.entries(extra.add)) if (!(style as any)[k]?.length) (style as any)[k] = v;
  const identifyMs = Date.now() - t1;
  saveRequestStyle(db, id, style, 'ai');
  // 식별 결과를 제품처럼 저장한다(숨김 후보도 — targetsOf 가 내부 단서로 쓴다)
  if (identities.length) {
    const jid = Number(db.prepare(`INSERT INTO ai_jobs(request_id, kind, status, provider, is_mock, created_at, finished_at) VALUES (?,?,?,?,?,?,?)`).run(id, 'identify', 'done', 'oss', 0, Date.now(), Date.now()).lastInsertRowid);
    identities.forEach((x, i) => db.prepare(`INSERT INTO ai_identities(job_id, request_id, rank, brand, name, color, category, confidence, reasons, refs, season, model_code, matched, uncertain, status, is_mock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(jid, id, i + 1, x.brand, x.name, x.color, x.category, x.confidence, JSON.stringify(x.reasons), JSON.stringify(x.refs), x.season, x.code, JSON.stringify(x.matched), JSON.stringify(x.uncertain), 'proposed', 0));
  }
  // 2 판매처 탐색(새 경로)
  const t2 = Date.now();
  const q = S.queueFindSearch(db, e, id, { by: 'search-eval', force: true });
  let offers: ProductOffer[] = [], report: any[] = [], queries: any[] = [], summary = q.skipped || '';
  if (q.id && !q.skipped) {
    db.prepare(`UPDATE offer_searches SET status='running' WHERE id=?`).run(q.id);
    await S.runFindSearch(db, e, q.id);
    const s = db.prepare('SELECT * FROM offer_searches WHERE id=?').get(q.id) as any;
    offers = offersOf(db, q.id); report = JSON.parse(s.report || '[]'); queries = JSON.parse(s.queries || '[]'); summary = s.summary;
  }
  const findMs = Date.now() - t2;
  // 채점: C = 저장 순서(사진 유사도 정렬) · B = 같은 후보를 사진 없이(판정·재고·상세·가격 순, 단서 검색어로만 나온 후보 제외)
  const clue = new Set(queries.filter((x: any) => x.kind === 'clue').map((x: any) => x.text));
  const textOrder = S.rankOffers(offers.filter(o => !(o.queries || []).every((x: string) => clue.has(x))).map(o => ({ ...o, imageScore: null })));
  const rankOf = (xs: ProductOffer[]) => { const i = xs.findIndex(o => isHit(c, o.name)); return i < 0 ? null : i + 1; };
  const imgRank = rankOf(offers), txtRank = rankOf(textOrder);
  const hits = offers.filter(o => isHit(c, o.name));
  const falseConfirm = offers.filter(o => (o.verdict === 'same_code' || o.verdict === 'likely') && !isHit(c, o.name)).length;
  // 정답 사진 유사도(이미지 모델 성능)와 전체 분포
  const scored = offers.filter(o => o.imageScore != null).map(o => o.imageScore!);
  const hitScores = hits.filter(o => o.imageScore != null).map(o => o.imageScore!);
  // 3 대체 상품 정렬 방식 비교(같은 후보 묶음)
  const raw = offers.filter(o => o.verdict !== 'same_code').map(o => ({ url: o.url, seller: o.seller, brand: o.brand || '', name: o.name, imageUrl: o.imageUrl, price: o.price, shipping: null,
    condition: o.condition === 'new' ? 'new' : o.condition === 'used' ? 'used' : 'unknown', options: [], style: styleFromText(o.name), source: o.source, relation: 'similar', recommender: 'walf-web-similar', recommenderVersion: 'web-1' }));
  const images = offers.some(o => o.imageScore != null) ? { scores: new Map(offers.filter(o => o.imageScore != null).map(o => [urlKey(o.url), o.imageScore!])), model: offers.find(o => o.imageModel)?.imageModel || 'moda' } : null;
  const gender = style.gender?.length ? await imageGender(e.brain ?? null, raw.filter(x => !styleFromText(x.name).gender?.length).map(x => ({ id: urlKey(x.url), imageUrl: x.imageUrl }))) : new Map();
  const alt: Record<string, any> = {};
  for (const mode of RANK_MODES as readonly RankMode[]) {
    const r = curateOffers(raw, { style, brand: null, name: null, modelCode: null, size: null, limit: 5, mockAllowed: false, priority: mode === 'pref' ? 'silhouette' : null, mode, images, photoGender: gender });
    alt[mode] = { n: r.offers.length, fit: r.offers.filter(o => fits(c, o)).length, exact: r.offers.filter(o => isHit(c, o.name)).length,
      img: r.offers.length && images ? Math.round(r.offers.reduce((a, o) => a + (images.scores.get(urlKey(o.url)) ?? 0), 0) / r.offers.length * 1000) / 1000 : null,
      top: r.offers.slice(0, 5).map(o => ({ name: o.name, url: o.url, img: o.imageUrl, score: o.imageScore ?? null })) };
  }
  const row = {
    id: c.id, group: c.group, truth: { brand: c.truth.brand, model: c.truth.model, category: c.truth.category, gender: c.truth.gender, market: c.truth.market_presence },
    identify: { ms: identifyMs, error: idErr, zeroshot: extra.notes, garment: features?.garment ?? null, brandGuess: features?.brand_guess || null, identities: identities.map(x => `${x.brand} ${x.name}`), style },
    brandHit: !!c.truth.brand && !!features?.brand_guess && [c.truth.brand, ...(c.truth.aliases_ko || []), ...(c.truth.aliases_en || [])].some(a => a && String(features.brand_guess).toLowerCase().includes(String(a).toLowerCase())),
    search: { executed: !!q.id && !q.skipped, skipped: q.skipped || null, ms: findMs, summary, queries: queries.map((x: any) => `${x.kind}:${x.text}`),
      sources: report.map((x: any) => ({ id: x.id, outcome: x.outcome, hits: x.hits, n: x.queries?.length || 0 })), candidates: offers.length },
    found: hits.length > 0, foundCount: hits.length, rankImage: imgRank, rankText: txtRank, top5Image: !!imgRank && imgRank <= 5, top5Text: !!txtRank && txtRank <= 5,
    onSale: hits.length > 0 /* 중고나라 검색 목록의 판매 완료 매물은 이미 뺐다 — 판매 중 여부는 목록 기준(상세 미확인) */,
    falseConfirm, image: { n: scored.length, max: scored.length ? Math.max(...scored) : null, hitMax: hitScores.length ? Math.max(...hitScores) : null,
      hitPct: hitScores.length && scored.length ? Math.round(scored.filter(x => x <= Math.max(...hitScores)).length / scored.length * 100) : null },
    alternatives: alt,
    top: offers.slice(0, 8).map(o => ({ name: o.name, url: o.url, img: o.imageUrl, score: o.imageScore ?? null, verdict: o.verdict, hit: isHit(c, o.name) })),
    ms: Date.now() - t0, costKrw: 0,
  };
  fs.appendFileSync(resultsFile, JSON.stringify(row) + '\n');
  console.log(`[${n + 1}/${cases.length}] ${c.id} ${c.group} · 분석 ${Math.round(identifyMs / 1000)}초 ${features?.garment || idErr || ''} · 탐색 ${row.search.executed ? `${offers.length}후보` : `안 함(${q.skipped})`} · 정답 ${hits.length}건 · 사진순위 ${imgRank ?? '-'} · 글순위 ${txtRank ?? '-'} · ${Math.round(row.ms / 1000)}초`);
}
console.log('끝', resultsFile);
