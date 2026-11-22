// 패션 브레인(로컬 이미지 유사도) — Intelligence Lab의 MODA 서비스(walf-intelligence integration/brain_service.py)를 같은 맥에서 부른다.
// 사용자 사진은 업로드 폴더 안 파일 경로로만 넘기고(서비스가 허용 폴더 밖은 읽지 않음) 밖으로 보내지 않는다.
// 후보 사진은 접근을 확인한 검색 결과의 이미지 주소만 넘긴다. 유사도는 같은 상품 판정 근거가 아니라 정렬·비교 근거다.

export type Brain = { url: string; timeoutMs: number; fetcher?: typeof fetch };
export type ImageScores = { model: string; revision: string; ms: number; scores: Map<string, number>; failed: number };

/** WALF_BRAIN_URL(예: http://127.0.0.1:8790)이 있을 때만 쓴다. 이 맥 안 주소만 받는다 */
export function brainFromEnv(env: Record<string, string | undefined> = process.env): Brain | null {
  const u = env.WALF_BRAIN_URL?.trim();
  if (!u) return null;
  try { const h = new URL(u).hostname; if (!['127.0.0.1', 'localhost', '::1'].includes(h)) return null; } catch { return null; }
  return { url: u.replace(/\/$/, ''), timeoutMs: Number(env.WALF_BRAIN_TIMEOUT_MS || 60_000) };
}

async function post(b: Brain, p: string, body: unknown): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), b.timeoutMs);
  try {
    const r = await (b.fetcher || fetch)(`${b.url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`이미지 모델 서비스 오류(HTTP ${r.status}) ${j?.error || ''}`.trim());
    return j;
  } finally { clearTimeout(timer); }
}

export async function brainHealth(b: Brain | null): Promise<{ model: string; revision?: string; device?: string } | null> {
  if (!b) return null;
  try { const r = await (b.fetcher || fetch)(`${b.url}/health`, { signal: AbortSignal.timeout(3000) }); const j: any = await r.json(); return j?.ok ? j : null; } catch { return null; }
}

const httpImage = (u: string | null | undefined) => !!u && /^https?:\/\//i.test(u);

/** 맡긴 사진(photoPath)과 후보 사진들의 유사도. 서비스가 없거나 실패하면 null(규칙만으로 계속한다) */
export async function imageScores(b: Brain | null, photoPath: string | null | undefined, cands: { id: string; imageUrl: string | null }[]): Promise<ImageScores | null> {
  if (!b || !photoPath) return null;
  const list = cands.filter(c => httpImage(c.imageUrl)).map(c => ({ id: c.id, url: c.imageUrl! }));
  if (!list.length) return null;
  try {
    const j = await post(b, '/similarity', { query: { path: photoPath }, candidates: list });
    const scores = new Map<string, number>();
    let failed = 0;
    for (const s of j.scores || []) { if (typeof s.score === 'number') scores.set(String(s.id), s.score); else failed++; }
    return { model: `${j.model}@${String(j.revision || '').slice(0, 7)}`, revision: j.revision, ms: j.ms, scores, failed };
  } catch (e: any) {
    console.warn(`이미지 유사도 실패 · ${e?.message || e}`);
    return null;
  }
}

/** 사진으로 본 성별(제로샷 추정). 확률이 높을 때만 값을 준다 — 제목에 성별이 없을 때의 보조 단서 */
export async function imageGender(b: Brain | null, cands: { id: string; imageUrl: string | null }[], min = 0.85): Promise<Map<string, { gender: 'men' | 'women'; p: number }>> {
  const out = new Map<string, { gender: 'men' | 'women'; p: number }>();
  const list = cands.filter(c => httpImage(c.imageUrl)).map(c => ({ id: c.id, url: c.imageUrl! }));
  if (!b || !list.length) return out;
  try {
    const j = await post(b, '/zeroshot', { images: list, labels: ["men's clothing", "women's clothing"], prompt: 'a product photo of {}' });
    for (const r of j.results || []) {
      if (!Array.isArray(r.probs)) continue;
      const [m, w] = r.probs as number[];
      if (Math.max(m, w) >= min) out.set(String(r.id), m > w ? { gender: 'men', p: m } : { gender: 'women', p: w });
    }
  } catch (e: any) { console.warn(`사진 성별 추정 실패 · ${e?.message || e}`); }
  return out;
}

/** 사진 유사도 점수를 사람이 읽을 말로(판정 아님) */
export const imageNote = (score: number | null | undefined, model: string) =>
  score == null ? '사진 유사도를 계산하지 못했어요' : `사진 유사도 ${score.toFixed(2)}(${model.split('@')[0].toUpperCase()}) — 같은 상품 판정 근거는 아니에요`;


// ── 사진 속성 채우기(제로샷) ─────────────────────────────────────
// 로컬 사진 분석(VLM)이 놓친 성별·제품군·바지 실루엣을 이미지 모델 제로샷으로 채운다. 확률이 높을 때만, 비어 있는 종류만(운영자가 고친 기준은 덮지 않는다).
// 2026-11-22 의뢰 #2: VLM은 "바지·데님"만 읽었고, MODA 제로샷은 부츠컷 0.64·남성복 0.997로 맞혔다(커브드 절개는 못 읽음 → 쓰지 않음).
const CATS: [string, string][] = [['jacket', 'jacket'], ['coat', 'outerwear'], ['shirt', 'shirts'], ['t-shirt', 'tees'], ['sweater', 'knitwear'], ['hoodie', 'knitwear'],
  ['pants', 'trousers'], ['jeans', 'trousers'], ['sneakers', 'footwear'], ['boots', 'footwear'], ['bag', 'bags']];
const LEGS: [string, string | null][] = [['bootcut flared pants', 'bootcut'], ['straight leg pants', null], ['wide leg pants', 'relaxed'], ['skinny pants', 'slim']];
export async function photoAttributes(b: Brain | null, photoPath: string | null | undefined, style: Record<string, string[] | undefined>): Promise<{ add: Record<string, string[]>; notes: string[] }> {
  const add: Record<string, string[]> = {}, notes: string[] = [];
  if (!b || !photoPath) return { add, notes };
  const zs = async (labels: string[]) => {
    try { const j = await post(b, '/zeroshot', { images: [{ id: 'q', path: photoPath }], labels, prompt: 'a product photo of {}' }); return (j.results?.[0]?.probs || null) as number[] | null; }
    catch { return null; }
  };
  const top = (p: number[] | null) => { if (!p) return null; const i = p.indexOf(Math.max(...p)); return { i, p: p[i] }; };
  if (!style.gender?.length) {
    const t = top(await zs(['menswear', 'womenswear']));
    if (t && t.p >= 0.9) { add.gender = [t.i === 0 ? 'men' : 'women']; notes.push(`성별 ${t.i === 0 ? '남성' : '여성'}(사진 추정 ${Math.round(t.p * 100)}%)`); }
  }
  let cat = style.category?.[0];
  if (!cat) {
    const t = top(await zs(CATS.map(x => x[0])));
    if (t && t.p >= 0.6) { cat = CATS[t.i][1]; add.category = [cat]; notes.push(`제품군 ${CATS[t.i][0]}(사진 추정 ${Math.round(t.p * 100)}%)`); }
  }
  if (cat === 'trousers' && !style.silhouette?.length) {
    const t = top(await zs(LEGS.map(x => x[0])));
    if (t && t.p >= 0.55 && LEGS[t.i][1]) { add.silhouette = [LEGS[t.i][1]!]; notes.push(`실루엣 ${LEGS[t.i][0]}(사진 추정 ${Math.round(t.p * 100)}%)`); }
  }
  return { add, notes };
}
