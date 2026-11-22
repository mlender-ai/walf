// WALF V2.1 Gate A — 찾아줘 판매처 탐색을 HTTP로 끝까지 확인한다.
// 사진 접수 → 모의 AI 식별 → (자동) 판매처 탐색 대기열 → 7단계 → 어드민에서 같은 상품·가능성·확인 못 함·다른 상품 + 소스별 처리 확인
// → 사용자 화면에는 검수 전 결과가 보이지 않음 → 같은 조건 재검색 막기 · 운영자 다시 실행 → 매물 없는 식별 → 서버 재시작 → 계정 삭제.
// 임시 DB에서 돌고 끝나면 지운다. AI는 모의 제공자, 판매처는 테스트 Fixture(mock://) — 실제 판매처·유료 API 호출 없음.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walf-e2e-v21-'));
const PORT = 4500 + Math.floor(Math.random() * 50);
const B = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(tmp, 'e2e.db');
// 이 맥의 server/.env(로컬 실험 경로·이미지 모델)가 E2E에 섞이지 않게 비워 둔다
const ENV = { ...process.env, WALF_EXPERIMENT_SOURCES: '', WALF_BRAIN_URL: '', WALF_PORT: String(PORT), WALF_DB: DB_FILE, WALF_UPLOADS: path.join(tmp, 'up'), WALF_BACKUPS: path.join(tmp, 'bk'), WALF_ADMIN_PASSWORD: 'e2e-pass-v21',
  WALF_QA_TOOLS: '1', WALF_PUSH_DISABLED: '1', WALF_AI_PROVIDER: 'mock', WALF_AI_POLL_MS: '100', ANTHROPIC_API_KEY: '', WALF_SECRET: 'e2e-secret-v21',
  WALF_NAVER_CLIENT_ID: '', WALF_NAVER_CLIENT_SECRET: '', WALF_SEARCH_POLL_MS: '150', WALF_SEARCH_PACE_MS: '0', WALF_WATCH_POLL_MS: '3600000' };
let srv: ChildProcess, srvLog = '';
function start() {
  srv = spawn(process.execPath, ['src/index.ts'], { cwd: root, env: ENV });
  srv.stdout!.on('data', d => srvLog += d); srv.stderr!.on('data', d => srvLog += d);
}
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(100); } throw new Error('서버가 뜨지 않음'); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const steps: string[] = [];
const ok = (s: string) => { steps.push('PASS  ' + s); console.log('PASS ', s); };
const A = { 'x-walf-device': 'e2e-v21-device-find-01' };
const TOKENS = new Map<string, string>();
async function api(method: string, p: string, body?: any, headers: Record<string, string> = A) {
  // 기기 세션: 세션을 열 때 받은 토큰을 그 기기 요청마다 함께 보낸다(앱과 같게)
  const dev = p === '/session' ? body?.deviceId : headers['x-walf-device'];
  const tok = dev ? TOKENS.get(dev) : undefined;
  const r = await fetch(B + '/api' + p, { method, headers: { ...headers, ...(tok ? { 'x-walf-token': tok } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  if (p === '/session' && r.ok) { const t = (await r.clone().json().catch(() => ({})) as any).token; if (t) TOKENS.set(dev, t); }
  return { status: r.status, text: await r.clone().text(), j: await r.json().catch(() => ({})) as any };
}
let cookie = '', csrf = '', FIRST = 0;
async function login() {
  const lg = await fetch(B + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ op: 'QA봇', pw: 'e2e-pass-v21' }) });
  cookie = (lg.headers.get('set-cookie') || '').split(';')[0];
  csrf = /_csrf=([\w-]+)/.exec(await (await fetch(B + '/admin', { headers: { cookie } })).text())![1];
}
const page = async (p: string) => { const r = await fetch(B + '/admin' + p, { headers: { cookie } }); assert.equal(r.status, 200, p); return r.text(); };
async function post(p: string, form: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) ([] as string[]).concat(v).forEach(x => body.append(k, x));
  const r = await fetch(B + '/admin' + p + `?_csrf=${csrf}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const loc = r.headers.get('location') || '';
  if (loc.includes('e=')) throw new Error('어드민 오류: ' + decodeURIComponent(loc.split('e=')[1]));
  return loc;
}
async function waitFor(p: string, marker: string | RegExp) {
  for (let i = 0; i < 100; i++) { const h = await page(p); if (typeof marker === 'string' ? h.includes(marker) : marker.test(h)) return h; await sleep(100); }
  throw new Error('기다리던 표시가 없음: ' + marker);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const count = (sql: string, ...p: any[]) => { const d = new DatabaseSync(DB_FILE, { readOnly: true }); try { return (d.prepare(sql).get(...p) as any).n as number; } finally { d.close(); } };
async function submit(note: string, size = 'M', headers = A) {
  const fd = new FormData();
  fd.append('note', note); fd.append('size', size);
  fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'look.png');
  const r = await api('POST', '/requests', fd, headers);
  assert.equal(r.status, 201);
  return r.j.id as number;
}

async function main() {
  start(); await ready();
  assert.match(srvLog, /판매처 탐색 공식몰 1곳 · 실제 검색 경로 [^\n]+ · 이미지 모델 [^\n]+ · 테스트 판매처 켜짐/);
  ok('서버 시작: 판매처 탐색 = 공식몰 1곳(BADBLOOD) · 네이버 쇼핑 API 종료 · 유료 AI 웹 검색 쓰지 않음 · 테스트 판매처 켜짐');
  await api('POST', '/session', { deviceId: A['x-walf-device'], platform: 'ios' }, {});
  await login();

  // ── 1~7단계: 식별 → 자동 탐색 ──
  const id = FIRST = await submit('[테스트:정확] 성수에서 본 네이비 트랙 자켓');
  let html = await waitFor(`/requests/${id}`, 'data-offers="done:found_same"');
  ok(`찾아줘 #${id} 접수 → 모의 AI 식별(BADBLOOD W-JKT26-055) → 판매처 탐색이 자동으로 대기열에 들어가 7단계를 마침`);
  assert.match(html, /AI 식별 제안\(검수 전\)/, '탐색 대상의 근거(아직 운영자 검수 전)를 함께 보여 준다');
  assert.match(html, /같은 상품\(품번\) 2 · 가능성 높음 1 · 확인 못 함 1 · 다른 상품 3/);
  for (const [label, n] of [['같은 상품 · 품번 일치', 2], ['같은 상품일 가능성 높음', 1], ['같은 상품인지 확인 못 함', 1], ['다른 상품(제외)', 3]] as const) assert.ok(html.includes(`<summary>${label} ${n}</summary>`), label);
  ok('결과를 같은 상품(품번) 2 · 가능성 높음 1 · 확인 못 함 1 · 다른 상품 3으로 나눠 보여 줌');
  assert.match(html, /테스트 공식몰<\/b>[\s\S]*?189,000원 → <b>170,100원<\/b>[\s\S]*?173,100원/, '판매가 → 할인가 · 총액(배송비 포함)');
  assert.match(html, /테스트 편집숍<\/b>[\s\S]*?179,000원 \+ 배송비 모름/, '배송비를 모르면 총액을 만들지 않는다');
  assert.match(html, /✕ 품번 다름\(찾는 옷 W-JKT26-055 · 페이지 W-JKT26-054\)/, '같은 모델 다른 색(다른 품번)은 다른 상품');
  assert.match(html, /– 사진 비교는 아직 연결 전이라 하지 않았어요/);
  assert.match(html, /상품 페이지 읽기 실패[\s\S]*?응답이 늦어 확인하지 못했어요/);
  assert.equal((html.match(/src="\/admin\/mock-image\/[a-z-]+\.svg"/g) || []).length >= 6, true, '상품 이미지(테스트 그림)');
  const img = await fetch(B + '/admin/mock-image/track-jacket-navy.svg', { headers: { cookie } });
  assert.equal(img.status, 200); assert.match(img.headers.get('content-type') || '', /^image\/svg\+xml/);
  assert.equal((await fetch(B + '/admin/mock-image/..%2Fsearch-mock.json', { headers: { cookie } })).status, 404);
  assert.equal((await fetch(B + '/admin/mock-image/track-jacket-navy.svg', { redirect: 'manual' })).status, 302, '어드민 로그인 없이는 못 본다');
  ok('후보마다 이미지·판매처·판매가/할인가/배송비/총액·사이즈 재고·일치/불일치 근거를 보여 줌(사진 비교는 안 했다고 표시)');
  assert.match(html, /브랜드 공식몰\(카페24 자체 검색\)[\s\S]*?검색하지 않음[\s\S]*?모의 의뢰라 실제 판매처를 열지 않아요/);
  assert.match(html, /네이버 쇼핑 검색 API[\s\S]*?UNSUPPORTED[\s\S]*?검색하지 않음[\s\S]*?2026-07-31 종료/);
  assert.match(html, /AI 웹 검색\(Claude\)<\/b> <span class="sub">유료<\/span>[\s\S]*?PENDING_EXTERNAL_SETUP/);
  assert.match(html, /번개장터[\s\S]*?UNSUPPORTED[\s\S]*?검색하지 않음[\s\S]*?제39조/);
  assert.match(html, /검색하지 않은 곳 \d+곳\(연동 대기·지원 안 함·해당 없음\) — “매물 없음”이 아니에요/);
  ok('소스별 처리: 테스트 판매처만 검색 · 공식몰(모의 의뢰라 안 엶) · 네이버(API 종료) · AI 웹(유료, 대기) · 약관 금지 판매처는 “검색하지 않음”(매물 없음이 아님)');

  // 사용자 화면에는 검수 전 탐색 결과가 보이지 않는다
  const fv = await api('GET', `/requests/${id}/find`);
  assert.equal(fv.j.state, 'pending');
  assert.ok(!/mock:\/\/shop|테스트 공식몰|170100/.test(fv.text + (await api('GET', '/me')).text + (await api('GET', `/requests/${id}`)).text), '앱 API에 탐색 후보가 새지 않는다');
  ok('앱(사용자) 화면에는 검수 전 판매처 후보가 보이지 않음 — 식별도 “제품 식별 중”');
  assert.match(await page('/'), new RegExp(`판매처 탐색: 같은 상품 후보[\\s\\S]*?#${id} [\\s\\S]*?같은 상품\\(품번\\) 2`));
  ok('어드민 대기열에 “판매처 탐색: 같은 상품 후보”로 올라옴');

  // 같은 조건은 하루 안에 다시 검색하지 않는다 → 운영자가 다시 실행하면 새로 검색
  const tiers = [...(await page(`/requests/${id}`)).matchAll(/name="tier_(\d+)"/g)].map(x => x[1]);
  await post(`/requests/${id}/find/publish`, { [`tier_${tiers[0]}`]: 'match' });
  await sleep(600);
  assert.equal(count(`SELECT COUNT(*) n FROM offer_searches WHERE request_id=? AND purpose='find'`, id), 1, '운영자가 같은 상품으로 공개해도 같은 조건이라 다시 검색하지 않는다');
  assert.match(decodeURIComponent(await post(`/requests/${id}/offers/search`, {})), /판매처 탐색을 실행했어요/);
  await waitFor(`/requests/${id}`, 'data-offers="done:found_same"');
  assert.equal(count(`SELECT COUNT(*) n FROM offer_searches WHERE request_id=? AND purpose='find'`, id), 2);
  assert.match(await page(`/requests/${id}`), /왈프 팀이 공개한 식별 결과[\s\S]*?이전 탐색: #1 done/);
  assert.equal(count(`SELECT COUNT(*) n FROM listings WHERE is_mock=1 AND url NOT LIKE 'mock://shop/sim-%'`), 7, '같은 상품 페이지는 다시 찾아도 listings 한 줄');
  ok('같은 조건 재검색 막기(공개 후에도 1번) → 운영자 “다시 실행”은 새로 검색(2번째 · 근거: 왈프 팀 공개) · 상품 페이지는 한 줄씩');

  // ── Gate B: 대체 상품 · 운영자 검수 · 앱 공개 ──
  html = await waitFor(`/requests/${id}`, /data-similar="done:\d+"/);
  assert.match(html, /대체 상품[\s\S]*?정렬: 제품군·실루엣 > 디테일·소재 > 색·무드\(브랜드는 점수에 넣지 않음\)/);
  // Search Recovery: 패션 브레인은 후보 공급원이 아니라 정렬 엔진(로컬 이미지 모델) — 이미지 모델 주소가 없는 테스트 환경에서는 연결 전으로 보인다
  assert.match(html, /테스트 큐레이터\(Fixture\)[\s\S]*?패션 브레인\(로컬 이미지 모델[\s\S]*?PENDING_INTEGRATION/);
  assert.match(html, /나일론 트랙 자켓 블랙[\s\S]*?비슷한 디자인 · 같은 상품 아님/);
  assert.ok(!/sim-mystic-same/.test(html), '찾는 옷과 같은 상품은 대체 상품에서 뺀다');
  ok('대체 상품: 테스트 큐레이터 후보를 디자인·실루엣 순으로 정렬(브랜드 점수 없음) · 패션 브레인은 연결 전 · 같은 상품은 뺌');
  const offerId = (url: string, purpose = 'find') => { const d = new DatabaseSync(DB_FILE, { readOnly: true }); try { return (d.prepare(`SELECT o.id FROM offers o JOIN offer_searches s ON s.id=o.search_id WHERE o.request_id=? AND o.url=? AND s.purpose=? ORDER BY o.id DESC LIMIT 1`).get(id, url, purpose) as any).id as number; } finally { d.close(); } };
  const simIds = (() => { const d = new DatabaseSync(DB_FILE, { readOnly: true }); try { return (d.prepare(`SELECT o.id FROM offers o JOIN offer_searches s ON s.id=o.search_id WHERE o.request_id=? AND s.purpose='similar' AND s.id=(SELECT MAX(id) FROM offer_searches WHERE request_id=? AND purpose='similar') ORDER BY o.rank`).all(id, id) as any[]).map(x => x.id); } finally { d.close(); } })();
  await assert.rejects(post(`/offers/${offerId('mock://shop/select-mystic-navy')}/review`, { action: 'exact' }), /직접 확인한 근거/);
  await post(`/offers/${offerId('mock://shop/official-055-navy')}/review`, { action: 'exact' });
  await post(`/offers/${offerId('mock://shop/select-mystic-navy')}/review`, { action: 'exact', note: '로고 자수·소매 절개선·지퍼 위치가 공식몰 사진과 같음' });
  await post(`/offers/${offerId('mock://shop/slow-shop')}/review`, { action: 'possible' });
  await assert.rejects(post(`/offers/${offerId('mock://shop/other-brand')}/review`, { action: 'reject' }), /제외 사유/);
  await post(`/offers/${offerId('mock://shop/other-brand')}/review`, { action: 'reject', reason: '다른 상품' });
  await post(`/offers/${simIds[0]}/review`, { action: 'alternative' });
  await post(`/offers/${simIds[1]}/review`, { action: 'alternative' });
  await assert.rejects(post(`/offers/${simIds[2]}/review`, { action: 'exact' }), /비슷한 디자인/);
  ok('운영자 검수: 품번 미확인 후보를 근거 없이 “같은 상품 확인”으로 공개 못 함 · 제외는 사유 필수 · 대체 상품은 “같은 상품”으로 공개 못 함');
  const f = (await api('GET', `/requests/${id}/find`)).j;
  assert.equal(f.sale.state, 'ready');
  assert.deepEqual(f.sale.exact.map((o: any) => o.seller), ['테스트 공식몰', '테스트 편집숍']);
  assert.deepEqual(f.sale.possible.map((o: any) => o.seller), ['테스트 편집숍2']);
  assert.equal(f.alternatives.items.length, 2);
  assert.equal(f.alternatives.items[0].name, '나일론 트랙 자켓 블랙');
  assert.ok(f.alternatives.items[0].similarPoints.length && f.alternatives.items[0].diffPoints.length);
  assert.equal(f.sale.exact[0].url, null, '테스트 상품은 판매 페이지 주소를 주지 않는다');
  assert.ok(!/구매 가능|other-brand|mock:\/\//.test(JSON.stringify(f)), '“구매 가능”·제외한 후보·테스트 주소가 앱에 가지 않는다');
  const png = await fetch(f.sale.exact[0].imageUrl);
  assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png');
  const notis = (await api('GET', '/alerts')).j;
  const list = Array.isArray(notis) ? notis : notis.items || [];
  assert.equal(list.filter((n: any) => n.title === '같은 옷을 파는 곳을 찾았어요').length, 1);
  assert.equal(list.filter((n: any) => n.title === '비슷한 디자인의 옷을 골라 봤어요').length, 1);
  ok('앱: 판매처(같은 상품 확인 2 · 같은 상품일 수 있음 1)와 비슷한 디자인 2개가 보임 · 이미지(PNG) · “구매 가능” 표현 없음 · 알림은 종류별 한 번');

  // ── Gate C: 기다려줘 — 상품 페이지 가격 감시와 새 매물 탐색 분리 · 대체 상품 ──
  const conf = await api('POST', `/requests/${id}/find/confirm`, { identityId: f.match.id, next: 'watch' });
  assert.equal(conf.status, 200);
  // 원하는 가격 195,000 — 공식몰 판매가 189,000 + 배송비 3,000(할인가만으로는 조건 충족으로 치지 않는다)
  const cw = await api('POST', '/watches', { productId: String(conf.j.productId), requestId: String(id), targetPrice: '195000', size: 'M' });
  assert.equal(cw.status, 201);
  const wid = cw.j.id;
  assert.equal(cw.j.status, 'needs_info', '상품 페이지가 없으니 가격 감시는 확인 대기');
  assert.equal(cw.j.discovery.enabled, true);
  assert.deepEqual(cw.j.discovery.sources.filter((x: any) => x.usable).map((x: any) => x.id), ['mock']);
  assert.ok(cw.j.discovery.sources.some((x: any) => x.id === 'bunjang' && !x.usable && /제39조/.test(x.reason)), '지원하지 않는 곳은 이유와 함께 “찾지 않는 곳”');
  const wh = await waitFor(`/watches/${wid}`, /data-discovery="done:3"/);
  assert.match(wh, /1 · 상품 페이지 가격 감시[\s\S]*?상품 페이지 없음[\s\S]*?2 · 새 판매처·새 매물 탐색/);
  assert.match(wh, /알림 후보 3[\s\S]*?원하는 조건 모두 확인\(페이지 기준\)[\s\S]*?테스트 공식몰/);
  assert.match(await page('/'), new RegExp(`기다려줘: 새 판매처 후보[\\s\\S]*?W${wid} `));
  let wv = (await api('GET', `/watches/${wid}`)).j;
  assert.equal(wv.discovery.state, 'reviewing'); assert.equal(wv.discovery.items.length, 0, '검수 전 후보는 앱에 보이지 않는다');
  ok('기다려줘 등록(상품 페이지 없음 → 가격 감시는 확인 대기) · 새 매물 탐색은 따로 돌아 알림 후보 3곳(공식몰·편집숍·중고) · 번개장터 등은 “찾지 않는 곳” · 검수 전에는 앱에 안 보임');
  const dOffer = (url: string) => { const d = new DatabaseSync(DB_FILE, { readOnly: true }); try { return (d.prepare(`SELECT o.id FROM offers o WHERE o.watch_id=? AND o.url=? ORDER BY o.id DESC LIMIT 1`).get(wid, url) as any).id as number; } finally { d.close(); } };
  await post(`/offers/${dOffer('mock://shop/official-055-navy')}/review`, { action: 'exact' });
  await post(`/offers/${dOffer('mock://shop/select-mystic-navy')}/review`, { action: 'possible' });
  wv = (await api('GET', `/watches/${wid}`)).j;
  assert.deepEqual(wv.discovery.items.map((o: any) => [o.seller, o.tier, o.meetsTarget, o.isNew]), [['테스트 공식몰', 'exact', true, true], ['테스트 편집숍', 'possible', false, true]]);
  assert.equal(wv.status, 'needs_info'); assert.equal(wv.latest, null); assert.equal(wv.history.length, 0, '새 판매처 공개는 상품 페이지 가격 감시 기록·상태를 바꾸지 않는다');
  const al = ((await api('GET', '/alerts')).j as any[]).filter(n => n.kind === 'watch_discovery');
  assert.equal(al.length, 1); assert.equal(al[0].title, '다른 판매처에서 원하는 조건의 매물을 찾았어요');
  assert.ok(!/구매 가능/.test(JSON.stringify(wv) + al[0].body));
  ok('운영자 검수 후 앱에 새 판매처 2곳(같은 상품 확인 · 같은 상품일 수 있음) · 원하는 조건을 모두 확인한 곳(판매가+배송비 192,000원 ≤ 195,000 · M)만 알림 1번 · 배송비 모르는 곳은 알림 없음 · 가격 감시 상태는 그대로');
  assert.equal((await api('PATCH', `/watches/${wid}`, { discoverySources: ['mock', 'bunjang'] })).status, 400, '지원하지 않는 곳은 고를 수 없다');
  const wsh = await waitFor(`/watches/${wid}`, /data-watch-similar="done"/);
  const simW = [...wsh.matchAll(/id="offer-(\d+)"/g)].map(x => Number(x[1])).filter(n => { const d = new DatabaseSync(DB_FILE, { readOnly: true }); try { return (d.prepare(`SELECT relation FROM offers WHERE id=?`).get(n) as any)?.relation === 'similar'; } finally { d.close(); } });
  await post(`/offers/${simW[0]}/review`, { action: 'alternative' });
  wv = (await api('GET', `/watches/${wid}`)).j;
  assert.equal(wv.alternatives.items.length, 1); assert.equal(wv.alternatives.items[0].saved, false);
  assert.equal((await api('POST', `/offers/${simW[0]}/save`)).j.saved, true);
  wv = (await api('GET', `/watches/${wid}`)).j;
  assert.equal(wv.alternatives.items[0].saved, true); assert.equal(wv.status, 'needs_info', '대체 상품을 저장해도 기다려줘는 그대로');
  assert.equal((await api('POST', `/offers/${dOffer('mock://shop/other-brand')}/save`)).status, 404, '공개하지 않은 후보는 저장할 수 없다');
  ok('기다리는 동안 볼 비슷한 옷: 공개 → 저장(기다려줘는 계속) · 지원하지 않는 판매처는 고를 수 없음 · 공개 전 후보는 저장 못 함');

  // ── Gate D: 세션·사진 보호 · 선호·피드백 · 한 화면 검수 · 평가 데이터 ──
  const noTok = await fetch(B + '/api/me', { headers: A });
  assert.equal(noTok.status, 401); assert.equal((await noTok.json() as any).error, 'bad_token', '기기 ID만으로는 내 계정에 들어올 수 없다');
  const steal = await fetch(B + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: A['x-walf-device'] }) });
  assert.equal(steal.status, 401); assert.equal((await steal.json() as any).error, 'device_claimed', '기기 ID를 알아도 세션을 새로 열 수 없다');
  const photo = (await api('GET', `/requests/${id}`)).j.product.photoUrl as string;
  assert.match(photo, /\/uploads\/[\w-]+\.png\?exp=\d+&sig=[\w-]+$/);
  assert.equal((await fetch(photo)).status, 200);
  assert.equal((await fetch(photo.split('?')[0])).status, 403, '서명 없는 사진 주소는 열리지 않는다');
  assert.equal((await fetch(photo.replace(/sig=[\w-]+/, 'sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))).status, 403);
  assert.equal((await fetch(B + '/uploads/..%2F..%2Fserver%2F.env?exp=1&sig=x')).status, 403);
  ok('보안: 기기 ID만으로는 401(토큰 필요) · 남의 기기 ID로 세션 못 엶 · 사용자 사진은 서명·만료 주소로만(서명 없음·위조·경로 조작 403)');
  const pr = await api('POST', `/requests/${id}/priority`, { priority: 'material_detail' });
  assert.equal(pr.status, 200); assert.equal(pr.j.priorities.find((x: any) => x.selected).id, 'material_detail');
  assert.equal((await api('POST', `/requests/${id}/priority`, { priority: 'cheap' })).status, 400);
  const alt0 = f.alternatives.items[0].id, sale0 = f.sale.exact[0].id;
  assert.equal((await api('POST', `/offers/${alt0}/feedback`, { kind: 'like' })).status, 200);
  assert.equal((await api('POST', `/offers/${f.alternatives.items[1].id}/feedback`, { kind: 'not_interested' })).status, 200);
  assert.equal((await api('POST', `/offers/${sale0}/feedback`, { kind: 'like' })).status, 400, '같은 상품 판매처에는 추천 평가를 남기지 않는다');
  assert.equal((await api('POST', `/offers/${sale0}/open`)).status, 200);
  const fv2 = (await api('GET', `/requests/${id}/find`)).j;
  assert.deepEqual(fv2.alternatives.items.map((x: any) => x.feedback), ['like', 'not_interested']);
  ok('추천 기준 고르기(소재·디테일) · 비슷한 디자인에 “마음에 들어요”·“관심 없어요” · 판매 페이지 열기는 행동 기록으로만');
  const rv = await page(`/requests/${id}/review`);
  for (const k of ['data-review=', '사용자 원본', 'AI 식별', '같은 상품 후보 · 다른 판매처의 매물', '비슷한 디자인 추천', '출처와 검증 상태', '검수 기록']) assert.ok(rv.includes(k), k);
  assert.match(rv, /<img class="u" src="[^"]*\/uploads\/[\w-]+\.png\?exp=/, '사용자 원본 사진(서명 주소)');
  assert.match(rv, /기다려줘 W\d+ 새 판매처/, '다른 판매처의 매물(기다려줘 새 판매처)도 함께');
  assert.match(rv, /마음에 들어요 1/); assert.match(rv, /✓ 나일론|✕ /, '디자인 요소 일치·불일치');
  assert.ok(Number(/data-review-log="(\d+)"/.exec(rv)![1]) >= 6, '검수 기록(공개·후보 검수)');
  ok('한 화면 검수: 사용자 원본 사진 · AI 식별 · 같은 상품 후보·다른 판매처 · 대체 추천(디자인 요소 ✓/✕·사용자 피드백) · 출처 · 검수 기록');
  const ef = await (await fetch(B + '/admin/export/feedback.json?mock=1', { headers: { cookie } })).json() as any;
  const lk = ef.rows.find((x: any) => x.signal === 'like');
  assert.deepEqual([lk.explicit, lk.satisfaction, lk.item.relation, lk.model.version, lk.model.rank, lk.target.priority], [true, 1, 'similar', 'fixture-1', 1, 'material_detail']);
  assert.ok(ef.rows.some((x: any) => x.signal === 'open' && x.explicit === false && x.satisfaction === null), '열어 보기는 만족 값 없음');
  assert.ok(!JSON.stringify(ef).includes(A['x-walf-device']) && /^u_[0-9a-f]{12}$/.test(lk.user), '사용자는 가명');
  const er = await (await fetch(B + '/admin/export/reviews.json?mock=1', { headers: { cookie } })).json() as any;
  assert.ok(er.rows.some((x: any) => x.subject === 'identity' && x.decision === 'match' && x.auto.tier === 'match'));
  assert.ok(er.rows.some((x: any) => x.subject === 'offer' && x.decision === 'exact' && x.reason === '로고 자수·소매 절개선·지퍼 위치가 공식몰 사진과 같음' && x.auto.verdict === 'likely'), '자동 판정(가능성)과 운영자 결정(같은 상품 확인)·근거');
  assert.equal(((await (await fetch(B + '/admin/export/feedback.json', { headers: { cookie } })).json()) as any).count, 0, '모의 데이터는 기본으로 뺀다');
  ok('평가 데이터 내보내기: 피드백(상품·모델 버전·순위·선호, 가명) · 검수(자동 판정 대 운영자 결정·근거) · 모의 데이터는 기본 제외');
}

async function main2() {
  // ── 식별은 했지만 판매 매물이 없는 경우(다른 사용자) ──
  const B2 = { 'x-walf-device': 'e2e-v21-device-like-02' };
  await api('POST', '/session', { deviceId: B2['x-walf-device'], platform: 'ios' }, {});
  const id2 = await submit('[테스트:유력] 브라운 울 자켓', 'M', B2);
  const h2 = await waitFor(`/requests/${id2}`, 'data-offers="done:none"');
  assert.match(h2, /검색한 곳에서 판매 페이지를 찾지 못했어요/);
  assert.match(h2, /테스트브랜드A 울 집업 자켓 브라운/, '식별 결과(대상)는 그대로 보인다');
  assert.equal((await api('GET', `/requests/${id2}/find`, undefined, B2)).j.state, 'pending');
  ok('식별은 됐지만 판매 페이지가 없으면 “찾지 못했어요” — 식별 결과와 매물 결과를 섞지 않음');

  // ── 서버 재시작: 끊긴 탐색 회수 · 중복 없음 ──
  const before = count('SELECT COUNT(*) n FROM offer_searches');
  srv.kill(); await sleep(400);
  const raw = new DatabaseSync(DB_FILE);
  raw.prepare(`UPDATE offer_searches SET status='running', attempts=1 WHERE id=(SELECT MAX(id) FROM offer_searches)`).run();
  raw.close();
  start(); await ready(); await login();
  assert.match(srvLog, /판매처 탐색 1건을 다시 대기열에 넣었어요/);
  await sleep(800);
  assert.equal(count(`SELECT COUNT(*) n FROM offer_searches WHERE status IN ('queued','running')`), 0);
  assert.equal(count('SELECT COUNT(*) n FROM offer_searches'), before, '재시작해도 새 탐색을 더 만들지 않는다');
  ok('서버 재시작 → 끊긴 탐색을 다시 대기열에 넣어 끝냄(무료 소스) · 탐색이 더 생기지 않음');

  // ── 계정 삭제 ──
  assert.equal((await api('DELETE', '/me')).status, 200);
  assert.equal(count('SELECT COUNT(*) n FROM offers WHERE request_id=?', FIRST), 0);
  assert.equal(count('SELECT COUNT(*) n FROM offer_searches WHERE request_id=?', FIRST), 0);
  assert.equal(count('SELECT COUNT(*) n FROM offers WHERE watch_id IS NOT NULL'), 0, '기다려줘의 새 판매처·대체 상품 후보도 함께 삭제');
  assert.equal(count('SELECT COUNT(*) n FROM offer_saves'), 0, '저장한 옷 기록도 삭제');
  assert.equal(count('SELECT COUNT(*) n FROM offer_signals'), 0, '추천 피드백·행동 기록도 삭제');
  assert.ok(count('SELECT COUNT(*) n FROM review_log') > 0 && count('SELECT COUNT(*) n FROM review_log WHERE request_id=?', FIRST) === 0, '운영자 검수 기록은 남기되 사용자 의뢰와의 연결은 끊음');
  assert.ok(count('SELECT COUNT(*) n FROM offer_searches WHERE request_id<>?', FIRST) >= 1, '다른 사용자의 탐색은 그대로');
  assert.ok(count('SELECT COUNT(*) n FROM listings') > 0, '판매처 상품 페이지 기록(개인 정보 아님)은 남는다');
  ok('계정 삭제 → 판매처 탐색·후보·기다려줘 새 판매처·저장한 옷·추천 피드백 삭제 · 운영자 검수 기록은 연결만 끊고 남김 · 판매처 상품 페이지 기록은 남음');
}

main().then(main2).then(() => { console.log(`\n${steps.length} steps passed`); }, e => { console.error('\nFAIL', e); console.error(srvLog.slice(-3000)); process.exitCode = 1; })
  .finally(() => { srv?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
