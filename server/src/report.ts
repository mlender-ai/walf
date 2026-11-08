// 7일 실험 리포트 — 오픈소스 엔진(provider='oss') 작업 기록만으로 계산한다. 없는 데이터는 “없음”으로 보인다.
// 검색 실패(차단·오류)와 매물 미발견(결과 없음)을 따로 센다.
import type { DB } from './db.ts';
import * as D from './domain.ts';
import { kWhen, won } from './time.ts';

type Row = Record<string, any>;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const parse = (s: string | null, d: any) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const sec = (ms: number) => ms >= 60_000 ? `${Math.floor(ms / 60_000)}분 ${Math.round((ms % 60_000) / 1000)}초` : `${Math.round(ms / 1000)}초`;
const none = (t = '데이터 없음') => `<p class="empty">${t}</p>`;
const PAGE: Record<string, string> = { ok: '확인 완료', stock_unknown: '재고 확인 불가', partial: '일부만 확인', sold: '판매 완료', login: '로그인 필요', blocked: '접근 제한',
  robots: '수집 금지(robots)', deleted: '삭제', error: '열지 못함', not_crawled: '열지 않음' };
const SELLER_ST: Record<string, string> = { results: '결과 있음', no_results: '결과 없음', blocked: '검색 차단', failed: '검색 실패' };

export function reportHtml(db: DB, cfg: { ai?: { kind: string; label: string } | null }) {
  const jobs = db.prepare(`SELECT j.*, s.day, r.product_name, r.identified_name, r.product_url, r.is_mock rm FROM ai_jobs j JOIN requests r ON r.id=j.request_id
    LEFT JOIN search_runs s ON s.id=j.run_id WHERE j.provider='oss' ORDER BY j.id`).all() as Row[];
  const reqIds = [...new Set(jobs.map(j => j.request_id))];
  const claude = (db.prepare(`SELECT COUNT(*) n FROM ai_jobs WHERE provider='claude'`).get() as Row).n;
  const head = `<h1>7일 실험 리포트 · 오픈소스 탐색 엔진</h1><p class="sub">엔진: ${esc(cfg.ai?.kind === 'oss' ? cfg.ai.label : '이 서버는 지금 오픈소스 엔진이 꺼져 있어요(WALF_AI_PROVIDER=oss 로 켬)')} · 숫자는 이 서버의 작업 기록에서 바로 계산해요.</p>`;
  if (!jobs.length) return head + `<section>${none('아직 오픈소스 엔진으로 실행한 작업이 없어요.')}</section>`;

  const m = (j: Row) => (parse(j.detail, {}) || {}).metrics || {};
  const search = jobs.filter(j => j.kind === 'search'), ident = jobs.filter(j => j.kind === 'identify');
  const done = search.filter(j => j.status === 'done');
  const runs = db.prepare(`SELECT s.*, r.product_name, r.identified_name FROM search_runs s JOIN requests r ON r.id=s.request_id WHERE s.request_id IN (${reqIds.map(() => '?').join(',')}) ORDER BY s.request_id, s.day`).all(...reqIds) as Row[];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
  const ext = sum(jobs.map(j => m(j).external_api_calls || 0)), cost = sum(jobs.map(j => m(j).cost_krw || 0));
  const totalMs = sum(jobs.map(j => m(j).timing?.total_ms || 0));
  const first = jobs[0].created_at, last = jobs[jobs.length - 1].finished_at || jobs[jobs.length - 1].created_at;

  // 1) 요약
  const missed = runs.filter(r => r.status === 'missed').length;
  const summary = `<section><h2>요약</h2><div class="g3">
    ${[['실험 기간', `${kWhen(first)} → ${kWhen(last)}`], ['대상 의뢰', `${reqIds.length}건`], ['정기 탐색 실행', `${search.length}회 · 정상 완료 ${done.length} · 실패 ${search.filter(j => j.status === 'failed').length}`],
      ['탐색 일정(DAY)', `완료 ${runs.filter(r => r.status === 'done').length} · 하지 못함 ${missed} · 진행 중 ${runs.filter(r => r.status === 'pending').length}`],
      ['유료 AI API', `호출 ${ext}회 · 과금 ${won(cost) || '0원'} · Claude 작업 ${claude}건`], ['총 실행 시간', sec(totalMs)]]
      .map(([k, v]) => `<div><p class="sub" style="margin:0">${k}</p><p style="margin:2px 0 0;font-weight:700">${v}</p></div>`).join('')}</div>
    ${missed ? `<p><b>하지 못한 탐색 ${missed}회</b> — 맥이 꺼져 있었거나 서버가 실행되지 않은 날이에요. 성공으로 세지 않아요.</p>` : ''}</section>`;

  // 2) 날마다
  const dayRows = runs.map(r => {
    const j = search.filter(x => x.run_id === r.id).pop();
    const mm = j ? m(j) : {};
    const c = mm.counts || {};
    return `<tr><td>#${r.request_id} ${esc(D.shortName(r))}</td><td>DAY ${r.day}</td><td>${{ done: '기록 완료', missed: '<b>하지 못함</b>', pending: '진행 중', cancelled: '취소' }[r.status as string] || r.status}</td>
      <td>${j ? `${{ done: '완료', failed: '<b>실패</b>', queued: '대기', running: '실행 중', cancelled: '안 함' }[j.status as string] || j.status}${j.started_at ? '<div class="sub">' + kWhen(j.started_at) + '</div>' : ''}` : '—'}</td>
      <td>${mm.timing ? sec(mm.timing.total_ms) : '—'}</td><td>${c.queries ?? '—'}</td><td>${c.new_urls ?? '—'} / 중복 ${c.dup_urls ?? '—'}</td><td>${c.same_likely ?? '—'}</td><td>${c.valid_unverified ?? '—'}</td>
      <td>${r.review_minutes != null ? r.review_minutes + '분' : '—'}</td><td class="sub">${esc(j?.error || '')}${mm.log ? `<div>로그 ${esc(mm.log)}</div>` : ''}${mm.version ? `<div>코드 ${esc(mm.version)}</div>` : ''}</td></tr>`;
  }).join('');
  const days = `<section><h2>날마다 실행 기록</h2><table><thead><tr><th>의뢰</th><th>DAY</th><th>탐색 기록</th><th>엔진 작업</th><th>걸린 시간</th><th>검색</th><th>새 상품 주소</th><th>같은 상품으로 보임</th><th>조건 맞음(검수 전)</th><th>검수 시간</th><th>오류·로그</th></tr></thead><tbody>${dayRows}</tbody></table></section>`;

  // 3) 판매처별
  const sellers = db.prepare('SELECT * FROM sellers WHERE active=1 ORDER BY sort').all() as Row[];
  const finds = db.prepare(`SELECT f.*, s.name seller, j.provider, sr.day FROM ai_finds f JOIN ai_jobs j ON j.id=f.job_id LEFT JOIN sellers s ON s.id=f.seller_id LEFT JOIN search_runs sr ON sr.id=f.run_id
    WHERE j.provider='oss' ORDER BY f.id`).all() as Row[];
  const sellerRows = sellers.map(se => {
    const st = done.map(j => m(j).seller_status?.[se.name]).filter(Boolean) as string[];
    const cnt = (k: string) => st.filter(x => x === k).length;
    const ok = cnt('results') + cnt('no_results');
    const fs = finds.filter(f => f.seller_id === se.id);
    const pages = Object.entries(fs.reduce((a: Row, f) => (a[f.page_status || '-'] = (a[f.page_status || '-'] || 0) + 1, a), {})).map(([k, v]) => `${PAGE[k] || k} ${v}`).join(' · ');
    return `<tr><td><b>${esc(se.name)}</b><div class="sub">${esc(se.domain)}</div></td><td>${st.length ? `${Math.round(ok / st.length * 100)}%` : '—'}</td>
      <td>${Object.keys(SELLER_ST).map(k => `${SELLER_ST[k]} ${cnt(k)}`).join(' · ')}</td><td>${fs.length}</td><td class="sub">${pages || '—'}</td></tr>`;
  }).join('');
  const engines: Row = {};
  for (const j of jobs) for (const q of m(j).queries || []) {
    for (const e of q.engines_ok || []) (engines[e] ||= { ok: 0, bad: {} }).ok++;
    for (const [e, why] of q.engines_bad || []) { const x = (engines[e] ||= { ok: 0, bad: {} }); const k = String(why).replace(/^Suspended: /, ''); x.bad[k] = (x.bad[k] || 0) + 1; }
  }
  const sellerSec = `<section><h2>판매처별 검색·수집</h2><p class="sub">검색 성공률 = 검색 엔진이 답한 날(결과 있음 + 결과 없음) ÷ 실행한 날. “결과 없음”은 매물이 없다는 뜻이 아니에요(색인 안 됨일 수 있음). 무신사·W컨셉은 robots.txt 가 일반 수집기를 막아 페이지를 열지 않아요.</p>
    <table><thead><tr><th>판매처</th><th>검색 성공률</th><th>날별 검색 결과</th><th>AI가 남긴 매물</th><th>페이지 상태</th></tr></thead><tbody>${sellerRows}</tbody></table>
    <h3 style="margin-top:14px">검색 엔진 응답</h3>${Object.keys(engines).length ? `<table><tbody>${Object.entries(engines).map(([e, x]: [string, any]) => `<tr><td><b>${esc(e)}</b></td><td>응답 ${x.ok}회</td><td class="sub">${Object.entries(x.bad).map(([k, v]) => `${esc(k)} ${v}회`).join(' · ') || '실패 없음'}</td></tr>`).join('')}</tbody></table>` : none()}</section>`;

  // 4) 찾은 것 · 운영자 판단
  const cands = db.prepare(`SELECT c.*, f.id fid FROM candidates c JOIN ai_finds f ON f.candidate_id=c.id JOIN ai_jobs j ON j.id=f.job_id WHERE j.provider='oss'`).all() as Row[];
  const reqOf = (id: number) => db.prepare('SELECT * FROM requests WHERE id=?').get(id) as Row;
  const verifiedSame = cands.filter(c => c.match_grade.startsWith('same'));
  const meets = cands.map(c => ({ c, k: D.classify(reqOf(c.request_id), c) })).filter(x => ['offer', 'lead'].includes(x.k.kind) && x.c.match_grade.startsWith('same'));
  const rejected = finds.filter(f => f.status === 'rejected');
  const byReason = Object.entries(rejected.reduce((a: Row, f) => { const k = String(f.reject_reason || '').split(' · ')[0]; a[k] = (a[k] || 0) + 1; return a; }, {}));
  const findRows = finds.map(f => `<tr><td>DAY ${f.day ?? '?'}</td><td>${esc(f.seller || '')}</td><td>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc((f.title || f.url).slice(0, 60))}</a>` : esc(f.title || '')}</td>
    <td>${f.price != null ? won(f.price) : '—'}</td><td>${esc({ same_likely: '같은 상품으로 보임', similar: '비슷함', unknown: '모름' }[f.match_guess as string] || f.match_guess)}</td><td>색 ${esc(f.color_match || '-')} · 사이즈 ${esc(f.size_match || '-')}</td>
    <td>${esc({ listed: '판매글 있음', sold_out: '판매 종료', unknown: '모름' }[f.stock_guess as string] || f.stock_guess)} · ${esc(PAGE[f.page_status] || f.page_status || '-')}</td>
    <td>${f.status === 'proposed' ? '<b>검수 대기</b>' : f.status === 'accepted' ? `후보 #${f.candidate_id}` : `제외 · ${esc(f.reject_reason)}`}</td></tr>`).join('');
  const dup = sum(done.map(j => m(j).counts?.dup_urls || 0)), wanted = sum(done.map(j => m(j).counts?.wanted_posts || 0)), deleted = sum(done.map(j => m(j).counts?.deleted || 0));
  const found = `<section><h2>찾은 매물과 운영자 판단</h2><div class="g3">
    ${[['AI가 남긴 매물(상품 주소)', finds.length], ['검수 대기', finds.filter(f => f.status === 'proposed').length], ['운영자가 확인한 같은 상품', verifiedSame.length],
      ['조건에 맞는 같은 상품(사이즈·색·가격)', meets.length], ['구매 가능 확인', meets.filter(x => x.k.kind === 'offer').length], ['오탐(운영자 제외)', rejected.length]]
      .map(([k, v]) => `<div><p class="sub" style="margin:0">${k}</p><p class="n" style="margin:0">${v}</p></div>`).join('')}</div>
    <p class="sub">제외 사유: ${byReason.map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || '없음'} · 중복 주소 ${dup}건 · 구매글 ${wanted}건·삭제된 글 ${deleted}건은 엔진이 걸렀어요.</p>
    ${finds.length ? `<details><summary>매물 ${finds.length}건 전체</summary><table><thead><tr><th>DAY</th><th>판매처</th><th>매물</th><th>가격</th><th>AI 판정</th><th>조건</th><th>판매 상태 · 페이지</th><th>운영자</th></tr></thead><tbody>${findRows}</tbody></table></details>` : none('AI가 남긴 매물이 없어요.')}</section>`;

  // 5) 가격 변화
  const obs = db.prepare(`SELECT o.* FROM hunt_observations o WHERE o.request_id IN (${reqIds.map(() => '?').join(',')}) ORDER BY o.url, o.at`).all(...reqIds) as Row[];
  const byUrl: Record<string, Row[]> = {};
  for (const o of obs) (byUrl[o.url] ||= []).push(o);
  const changes = Object.entries(byUrl).filter(([, xs]) => new Set(xs.map(x => x.price).filter(x => x != null)).size > 1 || new Set(xs.map(x => x.stock)).size > 1);
  const price = `<section><h2>가격·판매 상태 변화</h2><p class="sub">지난번에 찾은 같은 상품 매물(검수 대기·등록)을 다음 탐색 때 다시 열어 비교해요. 다시 확인한 주소 ${Object.keys(byUrl).length}개.</p>
    ${changes.length ? `<table><tbody>${changes.map(([u, xs]) => `<tr><td><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.slice(0, 70))}</a></td><td>${xs.map(x => `${kWhen(x.at)} ${x.price != null ? won(x.price) : '가격 —'} ${esc(x.stock || '')}`).join(' → ')}</td></tr>`).join('')}</tbody></table>` : none('바뀐 가격·판매 상태가 없어요.')}</section>`;

  // 6) 시간·비용
  const t = (k: string) => sum(jobs.map(j => m(j).timing?.[k] || 0));
  const decided = finds.filter(f => f.decided_at && f.status !== 'proposed');
  const lat = decided.map(f => f.decided_at - (jobs.find(j => j.id === f.job_id)?.finished_at || f.decided_at)).sort((a, b) => a - b);
  const reviewed = runs.filter(r => r.review_minutes != null);
  const cost2 = `<section><h2>실행 시간·비용·검수 부담</h2><table><tbody>
    <tr><td>총 실행 시간</td><td>${sec(totalMs)} · 작업당 평균 ${sec(totalMs / jobs.length)}</td></tr>
    <tr><td>검색 · 페이지 수집 · 로컬 사진 모델</td><td>${sec(t('search_ms'))} · ${sec(t('crawl_ms'))} · ${sec(t('vision_ms'))} (모델 호출 ${t('vision_calls')}회)</td></tr>
    <tr><td>유료 API</td><td>호출 ${ext}회 · 과금 ${won(cost) || '0원'} (Claude·OpenAI 호출 없음)</td></tr>
    <tr><td>운영자 검수 시간(직접 입력)</td><td>${reviewed.length ? `${sum(reviewed.map(r => r.review_minutes))}분 · ${reviewed.length}일 입력` : '입력 없음'}</td></tr>
    <tr><td>탐색 끝 → 검수까지(대기 포함)</td><td>${lat.length ? `중앙값 ${sec(lat[Math.floor(lat.length / 2)])} · ${lat.length}건` : '데이터 없음'}</td></tr>
    <tr><td>실패·재시도</td><td>실패 ${jobs.filter(j => j.status === 'failed').length}건 · 두 번 이상 시도 ${jobs.filter(j => j.attempts > 1).length}건</td></tr></tbody></table></section>`;

  // 7) 식별(사진)
  const idRows = ident.map(j => {
    const d = parse(j.detail, {}) || {};
    const ids = db.prepare('SELECT * FROM ai_identities WHERE job_id=? ORDER BY rank').all(j.id) as Row[];
    return `<tr><td>#${j.request_id}</td><td>${esc(j.status)}${j.error ? `<div class="sub">${esc(j.error)}</div>` : ''}</td><td>${esc(j.summary || '')}${d.features ? `<div class="sub">특징: ${esc((d.features.details || []).slice(0, 4).join(' / '))}</div>` : ''}</td>
      <td>${ids.map(x => `${x.rank}. ${esc(x.brand || '')} ${esc(x.name)} (${esc(x.confidence)}, ${esc(x.status)})`).join('<br>') || '후보 없음'}</td><td>${d.metrics?.timing ? sec(d.metrics.timing.total_ms) : '—'}</td></tr>`;
  }).join('');
  const idSec = `<section><h2>사진 식별</h2>${ident.length ? `<table><thead><tr><th>의뢰</th><th>상태</th><th>요약</th><th>제안한 상품</th><th>시간</th></tr></thead><tbody>${idRows}</tbody></table>` : none()}</section>`;
  const cmp = `<section><h2>이전 Claude 탐색과 비교</h2>${claude ? `<p>Claude 작업 ${claude}건이 있어요. 같은 의뢰의 결과는 각 의뢰 화면에서 비교하세요.</p>` : none('기준 데이터 없음 — 이 서버에는 Claude로 실행한 탐색 기록이 없어 같은 기준으로 비교할 수 없어요. 유료 호출은 하지 않았어요.')}</section>`;
  return head + summary + days + sellerSec + found + price + cost2 + idSec + cmp;
}
