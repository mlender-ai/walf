// Search Recovery 평가 결과 → 보고서용 표(마크다운). 사진은 넣지 않는다(사례 id·출처 주소만).
// 사용: node tools/search-eval-report.ts <results.jsonl> <cases.json>
import fs from 'node:fs';

const [resultsFile, casesFile] = process.argv.slice(2);
const rows = fs.readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const caseOf = (id: string) => cases.find((c: any) => c.id === id) || {};
const pct = (a: number, b: number) => b ? `${a}/${b} (${Math.round(a / b * 100)}%)` : '-';
const exact = rows.filter(r => r.exact), sim = rows.filter(r => !r.exact);
const modes = ['design', 'image', 'image_dna', 'pref'];
const fitOf = (m: string, xs = rows) => { const n = xs.reduce((a, r) => a + (r.alternatives?.[m]?.n || 0), 0); return n ? Math.round(xs.reduce((a, r) => a + (r.alternatives?.[m]?.fit || 0), 0) / n * 100) : 0; };
const imgOf = (m: string) => { const xs = rows.map(r => r.alternatives?.[m]?.img).filter((x: any) => typeof x === 'number'); return xs.length ? (xs.reduce((a: number, b: number) => a + b, 0) / xs.length).toFixed(3) : '-'; };
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

console.log(`### 요약 (${rows.length}건 · 같은 상품을 시장에서 찾을 수 있는 사례 ${exact.length}건 · 유사품만 기대하는 사례 ${sim.length}건)\n`);
console.log('| 지표 | PR #3(5537c06) | 새 경로 · 사진 비교 없음 | 새 경로 · 사진 비교(MODA) |');
console.log('|---|---|---|---|');
console.log(`| 검색 자체가 실행된 비율 | 0/${rows.length} (0%) — 식별 결과 없으면 시작 안 함 | ${pct(rows.filter(r => r.search.executed).length, rows.length)} | 같음 |`);
console.log(`| 정답 상품 후보 발견율 | 0/${exact.length} | ${pct(exact.filter(r => r.rankText).length, exact.length)} | ${pct(exact.filter(r => r.found).length, exact.length)} |`);
console.log(`| 상위 5개 안 정답 | 0/${exact.length} | ${pct(exact.filter(r => r.top5Text).length, exact.length)} | ${pct(exact.filter(r => r.top5Image).length, exact.length)} |`);
console.log(`| 유사품 발견(규칙 일치, 유사품 사례) | 0/${sim.length} | ${pct(sim.filter(r => r.rankText).length, sim.length)} | ${pct(sim.filter(r => r.found).length, sim.length)} |`);
console.log(`| 정확한 브랜드 식별(사진 분석 로고·라벨 추정) | - | ${pct(rows.filter(r => r.brandHit).length, rows.filter(r => r.truth.brand && r.truth.brand !== 'None').length)} | 같음 |`);
console.log(`| 실제 판매 매물 발견(판매 완료 제외 목록 기준) | 0/${exact.length} | - | ${pct(exact.filter(r => r.onSale).length, exact.length)} |`);
console.log(`| 다른 상품 오확정(같은 상품·가능성 높음으로) | 0 | 0 | ${rows.reduce((a, r) => a + r.falseConfirm, 0)}건 |`);
console.log(`| 대체 추천 적합도(자동 근사, 상위 5개) | 추천 엔진 없음 | 디자인만 ${fitOf('design')}% | 사진 ${fitOf('image')}% · 사진+디자인 ${fitOf('image_dna')}% · 선호(실루엣)+사진 ${fitOf('pref')}% |`);
console.log(`| 대체 추천 평균 사진 유사도(상위 5개) | - | ${imgOf('design')} | 사진 ${imgOf('image')} · 사진+디자인 ${imgOf('image_dna')} · 선호+사진 ${imgOf('pref')} |`);
console.log(`| 한 건 처리 시간(중앙값) | - | - | 사진 분석 ${Math.round(med(rows.map(r => r.identify.ms)) / 1000)}초 · 탐색 ${Math.round(med(rows.map(r => r.search.ms)) / 1000)}초 · 전체 ${Math.round(med(rows.map(r => r.ms)) / 1000)}초 |`);
console.log(`| 한 건 비용 | - | 0원 | 0원(로컬 모델·무료 경로) |`);
console.log('\n### 사례별\n');
console.log('| 사례 | 정답 | 사진 분석(제로샷 보완) | 검색어 | 후보 | 정답 순위(사진/규칙) | 사진 유사도(정답 최고/전체 최고) | 실패 단계 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const c = caseOf(r.id);
  const st = Object.entries(r.identify.style || {}).map(([k, v]: any) => `${k}:${v.join(',')}`).join(' ');
  const stage = !r.search.executed ? `탐색 시작 안 함(${r.search.skipped})`
    : !r.search.candidates ? '검색 결과 없음'
    : r.found ? (r.top5Image ? '—(상위 5개 안)' : '정렬(정답이 5위 밖)')
    : r.exact ? '발견 실패(검색어·출처)' : '유사품 규칙 불일치';
  console.log(`| ${r.id} | ${[r.truth.brand, r.truth.model].filter((x: any) => x && x !== 'None').join(' ').slice(0, 40)} | ${(r.identify.terms || []).join('/') || r.identify.garment || '-'} · ${st}${r.identify.zeroshot?.length ? ` (+${r.identify.zeroshot.join(', ')})` : ''}${r.identify.brandGuess ? ` · 브랜드 추정 ${r.identify.brandGuess}` : ''} | ${r.search.queries.slice(0, 4).map((q: string) => q.split(':').slice(1).join(':')).join(' / ')} | ${r.search.candidates} | ${r.rankImage ?? '-'}/${r.rankText ?? '-'} | ${r.image.hitMax ?? '-'}/${r.image.max ?? '-'} | ${stage} |`);
}
console.log('\n### 실제 발견한 근거 주소(정답 규칙 일치, 사례마다 최대 2개)\n');
for (const r of rows.filter(r => r.found)) console.log(`- ${r.id}: ${r.top.filter((t: any) => t.hit).slice(0, 2).map((t: any) => `[${String(t.name).slice(0, 40)}](${t.url})`).join(' · ') || '(상위 8개 밖)'}`);
void caseOf;
