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
const ENV = { ...process.env, WALF_PORT: String(PORT), WALF_DB: DB_FILE, WALF_UPLOADS: path.join(tmp, 'up'), WALF_BACKUPS: path.join(tmp, 'bk'), WALF_ADMIN_PASSWORD: 'e2e-pass-v21',
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
async function api(method: string, p: string, body?: any, headers: Record<string, string> = A) {
  const r = await fetch(B + '/api' + p, { method, headers: { ...headers, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
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
  assert.match(srvLog, /판매처 탐색 공식몰 1곳 · 네이버 쇼핑 API 키 없음\(대기\) · AI 웹 검색 쓰지 않음 · 테스트 판매처 켜짐/);
  ok('서버 시작: 판매처 탐색 = 공식몰 1곳(BADBLOOD) · 네이버 키 대기 · 유료 AI 웹 검색 쓰지 않음 · 테스트 판매처 켜짐');
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
  assert.match(html, /네이버 쇼핑 검색 API[\s\S]*?PENDING_EXTERNAL_SETUP[\s\S]*?검색하지 않음/);
  assert.match(html, /AI 웹 검색\(Claude\)<\/b> <span class="sub">유료<\/span>[\s\S]*?PENDING_EXTERNAL_SETUP/);
  assert.match(html, /번개장터[\s\S]*?UNSUPPORTED[\s\S]*?검색하지 않음[\s\S]*?제39조/);
  assert.match(html, /검색하지 않은 곳 \d+곳\(연동 대기·지원 안 함·해당 없음\) — “매물 없음”이 아니에요/);
  ok('소스별 처리: 테스트 판매처만 검색 · 공식몰(모의 의뢰라 안 엶) · 네이버(키 대기) · AI 웹(유료, 대기) · 약관 금지 판매처는 “검색하지 않음”(매물 없음이 아님)');

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
  assert.equal(count('SELECT COUNT(*) n FROM offer_searches WHERE request_id=?', id), 1, '운영자가 같은 상품으로 공개해도 같은 조건이라 다시 검색하지 않는다');
  assert.match(decodeURIComponent(await post(`/requests/${id}/offers/search`, {})), /판매처 탐색을 실행했어요/);
  await waitFor(`/requests/${id}`, 'data-offers="done:found_same"');
  assert.equal(count('SELECT COUNT(*) n FROM offer_searches WHERE request_id=?', id), 2);
  assert.match(await page(`/requests/${id}`), /왈프 팀이 공개한 식별 결과[\s\S]*?이전 탐색: #1 done/);
  assert.equal(count(`SELECT COUNT(*) n FROM listings WHERE is_mock=1`), 7, '같은 상품 페이지는 다시 찾아도 listings 한 줄');
  ok('같은 조건 재검색 막기(공개 후에도 1번) → 운영자 “다시 실행”은 새로 검색(2번째 · 근거: 왈프 팀 공개) · 상품 페이지는 한 줄씩');
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
  assert.equal(count('SELECT COUNT(*) n FROM offer_searches'), 1, '다른 사용자의 탐색은 그대로');
  assert.ok(count('SELECT COUNT(*) n FROM listings') > 0, '판매처 상품 페이지 기록(개인 정보 아님)은 남는다');
  ok('계정 삭제 → 그 사용자 의뢰의 판매처 탐색·후보도 삭제(판매처 상품 페이지 기록만 남음)');
}

main().then(main2).then(() => { console.log(`\n${steps.length} steps passed`); }, e => { console.error('\nFAIL', e); console.error(srvLog.slice(-3000)); process.exitCode = 1; })
  .finally(() => { srv?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
