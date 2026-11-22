// Search Recovery 평가 화면(로컬 전용) — 사례마다 맡긴 사진과 탐색 후보(사진 유사도 순)·정렬 방식별 대체 추천을 나란히 본다.
// 사용: node tools/search-eval-html.ts <results.jsonl> <사례 사진 폴더(images/ 의 부모)> <출력 html>
// 사진은 파일에 넣지 않고 경로로만 건다(권리 확인 사진·후보 썸네일 주소) — 이 HTML을 저장소에 올리지 않는다.
import fs from 'node:fs';
import path from 'node:path';

const [resultsFile, caseDir, out] = process.argv.slice(2);
if (!resultsFile || !caseDir || !out) { console.error('사용: node tools/search-eval-html.ts <results.jsonl> <사례 폴더> <출력 html>'); process.exit(1); }
const rows = fs.readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const cases = (() => { try { return JSON.parse(fs.readFileSync(path.join(caseDir, 'cases.json'), 'utf8')); } catch { return []; } })();
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const pct = (a: number, b: number) => b ? `${Math.round(a / b * 100)}%` : '-';
const n = rows.length, withTruth = rows.filter(r => r.truth.market !== 'none' && cases.find((c: any) => c.id === r.id)?.truth?.match_regex);
const sum = {
  executed: rows.filter(r => r.search.executed).length, found: withTruth.filter(r => r.found).length, top5img: withTruth.filter(r => r.top5Image).length, top5txt: withTruth.filter(r => r.top5Text).length,
  brand: rows.filter(r => r.truth.brand).length, brandHit: rows.filter(r => r.brandHit).length, falseConfirm: rows.reduce((a, r) => a + r.falseConfirm, 0),
  ms: Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, n) / 1000),
};
const modes = ['design', 'image', 'image_dna', 'pref'];
const modeFit = Object.fromEntries(modes.map(m => [m, rows.reduce((a, r) => a + (r.alternatives?.[m]?.fit || 0), 0) / Math.max(1, rows.reduce((a, r) => a + (r.alternatives?.[m]?.n || 0), 0))]));
const card = (t: any) => `<figure class="${t.hit ? 'hit' : ''}"><img src="${esc(t.img)}" loading="lazy" alt=""><figcaption>${t.score != null ? `<b>${Number(t.score).toFixed(2)}</b> ` : ''}${t.hit ? '<span class="ok">정답</span> ' : ''}${esc(String(t.name).slice(0, 40))}</figcaption></figure>`;
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WALF 탐색 평가</title>
<style>
:root{--bg:#f6f5f2;--fg:#17171a;--mu:#6b6b72;--ln:#e2e0db;--ok:#127a47;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececef;--mu:#9a9aa3;--ln:#2a2a2f;--ok:#4ed19a;--card:#1b1b1f}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"Apple SD Gothic Neo",Pretendard,sans-serif}
main{max-width:1280px;margin:0 auto;padding:32px 24px 80px}h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:40px 0 8px}.mu{color:var(--mu)}
table{border-collapse:collapse;width:100%;margin:12px 0;background:var(--card)}td,th{border:1px solid var(--ln);padding:6px 8px;text-align:left;font-variant-numeric:tabular-nums}
section{border-top:1px solid var(--ln);padding:20px 0}.row{display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:start}
.q img{width:220px;height:220px;object-fit:contain;background:var(--card);border:1px solid var(--ln)}.grid{display:flex;flex-wrap:wrap;gap:8px}
figure{margin:0;width:120px}figure img{width:120px;height:120px;object-fit:contain;background:var(--card);border:1px solid var(--ln)}figure.hit img{outline:3px solid var(--ok)}
figcaption{font-size:11px;line-height:1.3;margin-top:3px}.ok{color:var(--ok);font-weight:700}.tag{display:inline-block;border:1px solid var(--ln);border-radius:4px;padding:0 6px;margin:2px 4px 2px 0;font-size:12px}
</style></head><body><main>
<h1>WALF 실제 상품 탐색 평가</h1><p class="mu">사례 ${n}건 · 사진만 맡긴 의뢰로 사진 분석(로컬 Qwen3-VL + MODA 제로샷) → 판매처 탐색(실제 검색 경로) → 사진 유사도 정렬. 정답은 검색어에 넣지 않고 채점에만 썼어요. 사진 유사도는 같은 상품 판정 근거가 아니에요.</p>
<table><tr><th>지표</th><th>값</th></tr>
<tr><td>검색 자체가 실행된 비율</td><td>${sum.executed}/${n} (${pct(sum.executed, n)})</td></tr>
<tr><td>정답 상품 후보 발견율(시장에 있는 사례)</td><td>${sum.found}/${withTruth.length} (${pct(sum.found, withTruth.length)})</td></tr>
<tr><td>상위 5개 안 정답 — 사진 유사도 정렬</td><td>${sum.top5img}/${withTruth.length} (${pct(sum.top5img, withTruth.length)})</td></tr>
<tr><td>상위 5개 안 정답 — 사진 없이(규칙 정렬)</td><td>${sum.top5txt}/${withTruth.length} (${pct(sum.top5txt, withTruth.length)})</td></tr>
<tr><td>브랜드 식별(사진 분석의 로고·라벨 추정)</td><td>${sum.brandHit}/${sum.brand}</td></tr>
<tr><td>다른 상품 오확정(같은 상품·가능성 높음으로 잘못 판정)</td><td>${sum.falseConfirm}건</td></tr>
<tr><td>대체 추천 적합(자동 근사: 제품군·성별·아동복) — 디자인만 / 사진만 / 사진+디자인 / 선호+사진</td><td>${modes.map(m => `${Math.round(modeFit[m] * 100)}%`).join(' / ')}</td></tr>
<tr><td>한 건 평균 처리 시간 · 비용</td><td>${sum.ms}초 · 0원(로컬 모델·무료 경로)</td></tr></table>
${rows.map(r => { const c = cases.find((x: any) => x.id === r.id); return `<section><h2>${esc(r.id)} <span class="mu">· ${esc(r.group)} · 정답 ${esc([r.truth.brand, r.truth.model].filter(Boolean).join(' ') || '없음(시장에 같은 상품 없음 가정)')}</span></h2>
<div class="row"><div class="q"><img src="${esc(c ? path.join(caseDir, c.image) : '')}" alt="맡긴 사진"><p class="mu">${esc(c?.license || '')}</p></div><div>
<p>${(r.identify.zeroshot || []).map((x: string) => `<span class="tag">${esc(x)}</span>`).join('')}${Object.entries(r.identify.style || {}).map(([k, v]: any) => `<span class="tag">${esc(k)}: ${esc(v.join(','))}</span>`).join('')}${r.identify.brandGuess ? `<span class="tag">브랜드 추정: ${esc(r.identify.brandGuess)}</span>` : ''}</p>
<p class="mu">검색어: ${esc(r.search.queries.join(' · ') || r.search.skipped || '-')} · 후보 ${r.search.candidates}개 · 정답 ${r.foundCount}건 · 사진순위 ${r.rankImage ?? '-'} · 규칙순위 ${r.rankText ?? '-'}</p>
<div class="grid">${r.top.map(card).join('')}</div>
<p class="mu" style="margin-top:12px">대체 추천(사진+디자인)</p><div class="grid">${(r.alternatives?.image_dna?.top || []).map((t: any) => card({ ...t, hit: false })).join('')}</div>
</div></div></section>`; }).join('')}
</main></body></html>`;
fs.writeFileSync(out, html);
console.log(out);
