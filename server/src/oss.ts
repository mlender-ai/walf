// 무료 오픈소스 엔진(experiment/opensource-hunt-7d 의 engine/hunt.py)을 작업마다 한 번 실행하는 AI 공급자·대체 추천 공급자.
// 유료 API를 부르지 않는다: 사진은 이 맥의 Ollama(Qwen3-VL), 검색은 이 맥의 SearXNG·중고나라 자체 검색, 페이지는 이 맥의 Crawl4AI.
// WALF_AI_PROVIDER=oss 일 때만 켜진다(기본 꺼짐). 엔진 진행 기록(stderr)은 data/hunt-logs 에 남기고, 실패·시간 초과는 실패로 알린다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type AiProvider, type IdentifyInput, type SearchInput, AiError, cleanIdentify, cleanSearch, urlKey } from './ai.ts';
import { styleFromText, type Style } from './catalog.ts';
import type { SimilarProductProvider } from './curation.ts';

export type OssOptions = { python: string; script: string; logDir: string; timeoutMs: number; vlm: string };

export function ossOptions(env = process.env): OssOptions {
  return {
    python: env.WALF_OSS_PYTHON || path.join(os.homedir(), '.walf-oss/venv/bin/python'),
    // 엔진은 실험 브랜치 작업 폴더에 있다 — 경로를 .env 의 WALF_OSS_SCRIPT 로 준다
    script: env.WALF_OSS_SCRIPT || path.resolve(import.meta.dirname, '../../engine/hunt.py'),
    logDir: path.resolve(import.meta.dirname, '..', env.WALF_OSS_LOGS || 'data/hunt-logs'),
    timeoutMs: Number(env.WALF_OSS_TIMEOUT_MS || 25 * 60_000),
    vlm: env.WALF_OSS_VLM || 'qwen3-vl:8b-instruct',
  };
}
export const ossFromEnv = (env = process.env): AiProvider => ossProvider(ossOptions(env));

/** 엔진 한 번 실행 — 입력은 stdin JSON, 결과는 stdout 마지막 줄 JSON */
export function runEngine(o: OssOptions, cmd: 'identify' | 'search', input: unknown): Promise<any> {
  fs.mkdirSync(o.logDir, { recursive: true });
  const logFile = path.join(o.logDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${cmd}.log`);
  const log = fs.createWriteStream(logFile);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn(o.python, [o.script, cmd], { cwd: path.dirname(o.script), env: { ...process.env, WALF_OSS_VLM: o.vlm }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let killed = false;
    p.stdout.on('data', d => { out += d; });
    p.stderr.pipe(log);
    const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, o.timeoutMs);
    p.on('error', e => { clearTimeout(timer); log.end(); reject(new AiError('engine', `무료 엔진을 실행하지 못했어요(${e.message}). engine/start.sh 로 준비했는지 확인하세요.`)); });
    p.on('close', code => {
      clearTimeout(timer); log.end();
      const where = `로그 ${path.basename(logFile)}`;
      if (killed) return reject(new AiError('timeout', `무료 엔진이 ${Math.round(o.timeoutMs / 60_000)}분 안에 끝나지 않아 멈췄어요(${where}).`));
      let j: any;
      try { j = JSON.parse(out.trim().split('\n').pop() || ''); } catch { return reject(new AiError('engine', `무료 엔진 결과를 읽지 못했어요(종료 코드 ${code}, ${where}).`)); }
      if (j?.error) return reject(new AiError('engine', `무료 엔진 실패: ${String(j.error).slice(0, 200)} (${where})`));
      resolve({ ...j, _log: path.basename(logFile), _ms: Date.now() - t0 });
    });
    p.stdin.end(JSON.stringify(input));
  });
}

/** 엔진의 사진 분석 결과(features)를 한 덩어리 글로 — 모르는 값·추정 표시는 그대로 둬도 어휘에 안 걸린다 */
const featureText = (f: any) => [f?.garment, f?.category, ...(f?.colors || []), f?.material, f?.texture, f?.silhouette, ...(f?.details || []), ...(f?.keywords_ko || [])]
  .filter(Boolean).join(' ');

/**
 * 엔진 식별 결과 → WALF 식별 결과. 대체 추천·특징 검색에 쓸 디자인 태그는 사진에서 읽은 특징 + 사용자가 적은 설명(어느 옷인지).
 * 상품 후보가 없고 사진에서 로고·라벨로 브랜드를 짐작했으면 그 브랜드를 신뢰도 낮음 후보로 남긴다 — 사용자에게는 보이지 않고(숨김) 판매처 탐색의 내부 단서(ai_clue)로만 쓴다.
 */
export function ossIdentifyData(j: any, note?: string | null) {
  const data = cleanIdentify(j);
  const style = Object.keys(data.style).length ? data.style : styleFromText(`${featureText(j.features)} ${note || ''}`);
  const guess = String(j?.features?.brand_guess || '').trim();
  if (!data.identities.length && guess && guess.length <= 40 && !/모름|없음|unknown|none|n\/a/i.test(guess))
    data.identities = [{ brand: guess, name: String(j.features?.garment || '의류').slice(0, 60), color: (j.features?.colors || [])[0] || '', category: '', confidence: 'low', reasons: ['사진에서 읽은 로고·라벨로 짐작한 브랜드(추정)'],
      refs: [], season: '', code: '', matched: [], uncertain: ['사진 분석만으로 짐작했어요 — 검색 단서로만 쓰고 식별 결과로 보여 주지 않아요'] }];
  return { ...data, style };
}
export function ossProvider(o: OssOptions): AiProvider {
  const usage = (j: any) => ({ model: `oss:${o.vlm}`, inputTokens: 0, outputTokens: 0, searches: Array.isArray(j?.metrics?.queries) ? j.metrics.queries.length : 0 });
  return {
    kind: 'oss', label: `무료 엔진(로컬 ${o.vlm} · SearXNG · Crawl4AI, 유료 API 없음)`,
    async identify(i: IdentifyInput) {
      const j = await runEngine(o, 'identify', { ...i, photo: i.photoPath || null, sellers: i.sellers || [] });
      return { data: ossIdentifyData(j, i.note), usage: usage(j) };
    },
    async search(i: SearchInput) {
      const j = await runEngine(o, 'search', { ...i, photo: null });
      // 엔진은 검색 결과로 받은 주소만 내보낸다 → 모두 “검색 결과에 있던 주소”
      const seen = new Set<string>((j.listings || []).map((x: any) => urlKey(String(x?.url || ''))));
      return { data: cleanSearch(j, i.sellers, seen, []), usage: usage(j) };
    },
  };
}

// ── 대체 추천: 중고나라 자체 검색(약관·robots 확인한 곳)으로 비슷한 옷 매물 ─────────────
const KO: Record<string, string> = { shirts: '셔츠', tees: '티셔츠', jacket: '자켓', outerwear: '아우터', knitwear: '니트', trousers: '바지', bags: '가방', footwear: '신발',
  red: '레드', white: '화이트', black: '블랙', navy: '네이비', blue: '블루', gray: '그레이', brown: '브라운', beige: '베이지', green: '그린', check: '체크' };
const JOONGNA = { id: 0, name: '중고나라', domain: 'joongna.com' };
/**
 * 디자인 태그 → 검색어(색마다 하나, 최대 2개 + 커브드 절개가 있으면 하나 더). 엔진은 색·성별을 뺀 낱말이 매물 제목에 모두 있어야
 * 비슷한 옷 후보로 남기므로 가장 또렷한 특징 한두 낱말만 쓴다(부츠컷은 그 자체가 바지라 제품군을 붙이지 않는다).
 * 성별(남자·여자)은 검색어 앞에 붙인다 — 검색 엔진이 그 성별 상품을 앞에 보여 주고, 엔진은 반대 성별 매물을 뺀다.
 */
export function similarQueries(style: Style): string[] {
  const cat = KO[style.category?.[0] || ''] || '';
  const g = style.gender?.[0] === 'men' ? '남자' : style.gender?.[0] === 'women' ? '여자' : '';
  const boot = style.silhouette?.includes('bootcut'), curved = style.detail?.includes('curved-seam');
  const core = boot ? '부츠컷'
    : style.detail?.includes('check') ? `체크 ${cat}`
    : curved ? `커브드 ${cat}`
    : cat;
  if (!core.trim()) return [];
  const colors = (style.color || []).map(c => KO[c]).filter(Boolean).slice(0, 2);
  const out = (colors.length ? colors : ['']).map(c => [g, c, core].filter(Boolean).join(' '));
  if (boot && curved) out.push([g, '커브드 부츠컷'].filter(Boolean).join(' '));
  return [...new Set(out)];
}
export const ossSimilarFromEnv = (env = process.env): SimilarProductProvider => ossSimilarProvider(ossOptions(env));
export function ossSimilarProvider(o: OssOptions): SimilarProductProvider {
  return {
    id: 'walf-oss-joongna', label: '무료 엔진 · 중고나라 자체 검색 + 웹 검색(robots 허용 국내몰)', version: 'oss-1', status: 'SUPPORTED',
    availability: ctx => ctx.isMock ? { usable: false, reason: '테스트 의뢰에는 실제 판매처를 열지 않아요' } : { usable: true, reason: '이 맥의 무료 엔진으로 중고나라와 웹 검색(robots.txt 가 허락한 국내몰)을 찾아요(유료 API 없음)' },
    async find(input) {
      // 브랜드를 모르면 사용자가 확인한 이름(“빨간·흰색 체크 셔츠”)을, 아니면 디자인 태그로 만든 검색어(색마다 하나)를
      const names = !input.brand && input.name ? [input.name] : similarQueries(input.style);
      const seen = new Set<string>();
      const out: any[] = [];
      for (const name of names) {
        const j = await runEngine(o, 'search', { brand: input.brand || '', name, color: null, size: input.size, maxPrice: null, usedOk: true, day: 0, sellers: [JOONGNA], known: [] });
        // 판매처로 등록한 곳(중고나라) + 웹 검색에서 찾은 국내몰(보세몰 등 — robots.txt 가 허락한 페이지만 열었다)
        for (const l of [...(j.listings || []), ...(j.metrics?.outside_sellers || [])]) {
          if (l.pageStatus && !['ok', 'stock_unknown', 'partial'].includes(l.pageStatus)) continue;
          if (l.stock === 'sold_out' || !['similar', 'same_likely'].includes(l.match) || seen.has(urlKey(String(l.url || '')))) continue;
          seen.add(urlKey(String(l.url || '')));
          out.push({
            url: l.url, seller: String(l.seller || JOONGNA.name).replace(/^www\./, ''), brand: '', name: l.title, imageUrl: l.image || null, price: l.price ?? null, shipping: null,
            condition: l.condition === 'new' ? 'new' : 'used', options: [], style: styleFromText(l.title), source: l.seller === JOONGNA.name ? 'joongna' : 'web', relation: 'similar',
            recommender: 'walf-oss', recommenderVersion: 'oss-1', similarPoints: [], diffPoints: ['같은 상품인지는 확인하지 않았어요'],
          });
        }
      }
      return out;
    },
  };
}
