// 운영 비용 시나리오 계산기 — docs/WALF_COST_SCENARIOS.md 의 표를 다시 만든다(node server/tools/cost-scenarios.ts).
// 단가는 2026-11-19 공식 페이지 값, 사용량은 모두 가정이다(실제 관측 사용량이 아니다). 바꾸려면 아래 상수만 고친다.

// ── 공식 단가(USD, 2026-11-19 확인) ─────────────────────────
const P = {
  haiku55: { in: 0.10, out: 0.50 },          // 프롬프트 10만 토큰 이하
  sonnet55: { in: 2, out: 10 },
  gemini38flash2027: { in: 1.50, out: 7.50 }, // 2027-01-01부터 단가(2026년 말까지는 절반)
  claudeWebSearchPer1k: 10,
  visionOcrPer1k: 1.5, visionOcrFree: 1000,   // Google Cloud Vision TEXT_DETECTION
  lightsail4gbSeoul: 24,                       // 2 vCPU · 4GB · 서울
  hfCpuX2PerHour: 0.067,                       // HF Inference Endpoints aws intel-spr x2
  serpapi: [[250, 0], [1000, 25], [5000, 75], [15000, 150], [30000, 275]] as [number, number][],
};

// ── 사용량 가정 ─────────────────────────────────────────────
const A = {
  requestsPerUser: 1,      // 월 탐색 요청(지시서 기본 가정: 1,000명 → 1,000건)
  watchesPerUser: 0.3,     // 활성 감시(1,000명 → 300건)
  searchesPerRequest: 5,   // 요청당 최초 후보 검색
  recheckRate: 0.3,        // 추가 AI 검수 비율
  days: 30,
  failRate: 0.05,          // 호출 실패율, 최대 2회 재시도
  newCandidateRate: 0.05,  // 감시 탐색 중 새 후보라 AI로 다시 확인해야 하는 비율
  imagesPerRecheck: 4,     // 사용자 사진 1 + 후보 사진 3
  imageTokensClaude: 1296, // 1000×1000 → ⌈1000/28⌉² (Claude 고해상도 등급)
  imageTokensGemini: 1120, // media_resolution high
  textIn: 1500, textOut: 500,
  ocrImagesPerRequest: 1.5,
  reviewMinutes: 3,        // 운영자 검수 1건(가정)
  identifySonnetUsd: 0.18, // 현재 설계(Claude 식별 + 웹 검색 6회) 1회 — docs/WALF_V2_COST_MODEL.md 의 가정값
};

const retry = 1 + A.failRate + A.failRate ** 2;
const tokCost = (p: { in: number; out: number }, inTok: number, outTok: number) => (inTok * p.in + outTok * p.out) / 1e6;
const recheck = {
  haiku: tokCost(P.haiku55, A.imagesPerRecheck * A.imageTokensClaude + A.textIn, A.textOut),
  sonnet: tokCost(P.sonnet55, A.imagesPerRecheck * A.imageTokensClaude + A.textIn, A.textOut),
  gemini: tokCost(P.gemini38flash2027, A.imagesPerRecheck * A.imageTokensGemini + A.textIn, A.textOut),
};
const serp = (n: number) => { const plan = P.serpapi.find(([q]) => n <= q); return plan ? plan[1] : null; };
const usd = (x: number | null) => x === null ? '미확인(맞춤 견적)' : `$${x < 10 ? x.toFixed(2) : Math.round(x).toLocaleString('en-US')}`;

console.log('재검증 1회 단가', Object.fromEntries(Object.entries(recheck).map(([k, v]) => [k, v.toFixed(5)])), '재시도 배수', retry.toFixed(4));
for (const users of [100, 1000, 10000]) {
  const R = users * A.requestsPerUser, W = users * A.watchesPerUser;
  console.log(`\n## ${users.toLocaleString()}명 · 탐색 ${R.toLocaleString()}건 · 감시 ${W.toLocaleString()}건`);
  for (const d of [0, 0.3, 0.6]) {
    const pageReads = W * A.days * (1 - d);
    const discovery = W * A.days * (1 - d);
    const searches = R * A.searchesPerRequest + discovery;
    const rechecks = (R * A.recheckRate + discovery * A.newCandidateRate) * retry;
    const ocrUnits = R * A.ocrImagesPerRequest;
    const row = {
      '감시 페이지 조회': Math.round(pageReads),
      '검색 호출': Math.round(searches),
      'AI 재검증 호출': Math.round(rechecks),
      'B 재검증 Haiku': usd(rechecks * recheck.haiku),
      'B 재검증 Sonnet': usd(rechecks * recheck.sonnet),
      'B 재검증 Gemini(2027)': usd(rechecks * recheck.gemini),
      'A 식별 Sonnet+웹검색': usd(R * A.identifySonnetUsd * retry),
      '검색 SerpApi': usd(serp(searches)),
      '검색 Claude 웹검색': usd(searches * retry / 1000 * P.claudeWebSearchPer1k),
      'OCR Vision': usd(Math.max(0, ocrUnits - P.visionOcrFree) / 1000 * P.visionOcrPer1k),
      '운영자 검수 시간': `${(R * A.recheckRate * A.reviewMinutes / 60).toFixed(1)}h`,
    };
    console.log(`중복 제거 ${d * 100}%`, JSON.stringify(row));
  }
}
console.log('\n고정: 서울 4GB 서버', usd(P.lightsail4gbSeoul), '· 임베딩 호스팅(HF CPU x2 상시)', usd(P.hfCpuX2PerHour * 730));
