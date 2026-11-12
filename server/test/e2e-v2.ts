// WALF V2 — 찾아줘(사진 → 모의 식별 → 운영자 공개 → MATCH/LIKELY/DISCOVER → 사용자 확인 → 상품 저장)와
// 기다려줘(등록 → 목표가 → 테스트 가격 220,000 → 190,000 → 145,000 → 조건 충족 알림 1번)를 HTTP로 끝까지 확인한다.
// 임시 DB에서 돌고 끝나면 지운다. AI는 모의 제공자, 가격은 Fixture(mock://) — 실제 API·실제 판매 가격 호출 없음. 모든 결과는 “모의”로 표시된다.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walf-e2e-v2-'));
const PORT = 4440 + Math.floor(Math.random() * 50);
const B = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(tmp, 'e2e.db');
const ENV = { ...process.env, WALF_PORT: String(PORT), WALF_DB: DB_FILE, WALF_UPLOADS: path.join(tmp, 'up'), WALF_BACKUPS: path.join(tmp, 'bk'), WALF_ADMIN_PASSWORD: 'e2e-pass-v2',
  WALF_QA_TOOLS: '1', WALF_PUSH_DISABLED: '1', WALF_AI_PROVIDER: 'mock', WALF_AI_POLL_MS: '100', ANTHROPIC_API_KEY: '', WALF_SECRET: 'e2e-secret-v2',
  WALF_STYLE_SEED: path.join(root, 'fixtures', 'brand-styles-test.json'),
  WALF_WATCH_CHECK_HOURS: String(1.5 / 3600), WALF_WATCH_POLL_MS: '3600000' }; // 1.5초마다 새 조회 창(테스트 시간 압축) · 자동 조회는 끄고 QA 버튼으로만
let srv: ChildProcess, srvLog = '';
function start() {
  srv = spawn(process.execPath, ['src/index.ts'], { cwd: root, env: ENV });
  srv.stdout!.on('data', d => srvLog += d); srv.stderr!.on('data', d => srvLog += d);
}
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(100); } throw new Error('서버가 뜨지 않음'); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const steps: string[] = [];
const ok = (s: string) => { steps.push('PASS  ' + s); console.log('PASS ', s); };
const A = { 'x-walf-device': 'e2e-v2-device-find-01' }, Bdev = { 'x-walf-device': 'e2e-v2-device-disc-02' };
async function api(method: string, p: string, body?: any, headers: Record<string, string> = A) {
  const r = await fetch(B + '/api' + p, { method, headers: { ...headers, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) as any };
}
let cookie = '', csrf = '';
async function login() {
  const lg = await fetch(B + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ op: 'QA봇', pw: 'e2e-pass-v2' }) });
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
async function waitFor(p: string, marker: string) {
  for (let i = 0; i < 80; i++) { const h = await page(p); if (h.includes(marker)) return h; await sleep(100); }
  throw new Error('기다리던 표시가 없음: ' + marker);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
/** 가격 확인 한 번(QA 버튼) — 조회 창이 바뀌도록 1.6초 기다린 뒤 */
async function checkOnce() { await sleep(1600); await post('/watches/qa/check', {}); }

async function main() {
  start(); await ready();
  assert.match(srvLog, /브랜드 스타일 seed 7건/);
  assert.match(srvLog, /AI {5}모의 AI\(실제 분석 아님\)/, '유료 AI 꺼짐 — 모의 제공자');
  await api('POST', '/session', { deviceId: A['x-walf-device'], platform: 'ios' }, {});
  await login();

  // ── 찾아줘 ──
  const fd = new FormData();
  fd.append('note', '[테스트:유력] 용산에서 본 브라운 울 자켓'); fd.append('size', 'M');
  fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'look.png');
  const created = await api('POST', '/requests', fd);
  assert.equal(created.status, 201);
  const id = created.j.id;
  ok(`찾아줘 접수 #${id}(사진 + 메모) → 모의 AI가 먼저 식별`);
  let html = await waitFor(`/requests/${id}`, 'data-ai="find:draft"');
  assert.equal((await api('GET', `/requests/${id}/find`)).j.state, 'pending');
  assert.equal((await api('GET', '/me')).j.active.display.key, 'identification_pending');
  ok('식별 결과는 운영자가 공개하기 전에는 앱에 보이지 않는다(“제품 식별 중”)');
  const tiers = [...html.matchAll(/name="tier_(\d+)"/g)].map(x => x[1]);
  assert.equal(tiers.length, 2);
  // [리뷰 4] 서버 판정이 LIKELY 인 후보는 확인 근거 없이 MATCH로 공개할 수 없다
  await assert.rejects(post(`/requests/${id}/find/publish`, { [`tier_${tiers[0]}`]: 'match', [`tier_${tiers[1]}`]: 'skip' }), /직접 확인한 상품 페이지 주소와 확인 사유/);
  assert.equal((await api('GET', `/requests/${id}/find`)).j.state, 'pending');
  ok('서버 판정 LIKELY 를 근거 없이 MATCH로 올리면 거부 — 결과도 공개되지 않음');
  await post(`/requests/${id}/find/publish`, Object.fromEntries(tiers.map(t => [`tier_${t}`, 'likely'])));
  let me = (await api('GET', '/me')).j;
  assert.equal(me.active.display.key, 'find_likely');
  let find = (await api('GET', `/requests/${id}/find`)).j;
  assert.equal(find.likely.length, 2); assert.equal(find.match, null); assert.ok(find.isMock);
  assert.ok(find.likely[0].uncertain.some((u: any) => u.label === '모델'), '확인 못 한 속성을 함께 보여 준다');
  const al = (await api('GET', '/alerts')).j;
  assert.equal(al[0].kind, 'find_ready'); assert.equal(al[0].push, 'skipped_mock');
  ok(`운영자 공개 → 앱 “${me.active.display.title}” · LIKELY 2개 · 확인 못 한 속성 표시 · 알림(모의라 푸시 없음)`);
  assert.equal((await api('POST', `/requests/${id}/find/reject`, { reason: '소매 절개선이 달라요' })).status, 200);
  assert.ok((await page('/')).includes('찾아줘 결과: 사용자가 아니라고 함'));
  assert.equal((await api('GET', '/me')).j.active.display.key, 'identification_pending');
  ok('사용자 “찾던 옷이 아니에요” → 결과를 거두고 어드민 대기열에 다시 올라옴 · 7일은 시작 안 함');
  html = await page(`/requests/${id}`);
  await post(`/requests/${id}/find/publish`, { [`tier_${tiers[0]}`]: 'skip', [`tier_${tiers[1]}`]: 'likely' });
  find = (await api('GET', `/requests/${id}/find`)).j;
  const conf = await api('POST', `/requests/${id}/find/confirm`, { identityId: find.likely[0].id, next: 'watch' });
  assert.equal(conf.status, 200, JSON.stringify(conf.j));
  assert.ok(conf.j.productId > 0); assert.equal(conf.j.request.status, 'completed'); assert.equal(conf.j.request.display.key, 'find_done');
  assert.equal((await api('GET', '/me')).j.active, null, '찾아줘가 끝나 새 옷을 맡길 수 있다');
  ok(`다시 공개한 후보를 “이 옷이 맞아요” → 상품 #${conf.j.productId} 저장 · 찾아줘 “${conf.j.request.display.title}” · 7일 탐색 없이 기다려줘로`);

  // ── 기다려줘 ──
  // [리뷰 3] 찾아줘 상품(테스트브랜드B 울 블루종 자켓)에 다른 상품 페이지(TESTBRAND 트랙 자켓)를 연결 → 가격·재고가 맞아도 알림 없음
  const wrong = await api('POST', '/watches', { productId: conf.j.productId, requestId: id, productUrl: 'mock://fixture/sold-out', size: 'L', targetPrice: '300,000' });
  assert.equal(wrong.status, 201, JSON.stringify(wrong.j));
  await checkOnce(); await checkOnce();
  const wr = (await api('GET', `/watches/${wrong.j.id}`)).j;
  assert.equal(wr.display.key, 'mismatch'); assert.equal(wr.page.identity, 'mismatch'); assert.match(wr.page.note, /브랜드가 달라요/);
  assert.equal((await api('GET', '/alerts')).j.filter((a: any) => a.kind === 'watch_met').length, 0);
  assert.ok((await page('/')).includes(`W${wrong.j.id}`), '어드민 대기열 “기다려줘 확인 필요”');
  ok(`찾아줘 상품에 다른 브랜드 상품 페이지를 연결 → “${wr.display.title}” · L 재고·가격이 맞아도 알림 0건`);
  assert.equal((await api('POST', `/watches/${wrong.j.id}/end`)).j.status, 'ended');

  const w = await api('POST', '/watches', { productUrl: 'mock://fixture/price-drop', size: 'M', color: '네이비', targetPrice: '150,000', condition: 'any' });
  assert.equal(w.status, 201, JSON.stringify(w.j));
  assert.equal(w.j.status, 'active'); assert.ok(w.j.isMock); assert.equal(w.j.display.key, 'first'); assert.equal(w.j.page.identity, 'page_defined');
  const wid = w.j.id;
  ok(`기다려줘 등록 W${wid}(상품 링크만) · 150,000원 이하(배송비 포함) · M · 네이비 · 테스트 가격 소스(모의)`);
  const totals: number[] = [];
  for (let i = 0; i < 3; i++) { await checkOnce(); totals.push((await api('GET', `/watches/${wid}`)).j.latest.total); }
  assert.deepEqual(totals, [223000, 193000, 148000]);
  let wv = (await api('GET', `/watches/${wid}`)).j;
  assert.equal(wv.display.key, 'met');
  assert.deepEqual(wv.history.map((h: any) => h.total), [148000, 193000, 223000]);
  let alerts = (await api('GET', '/alerts')).j.filter((a: any) => a.kind === 'watch_met');
  assert.equal(alerts.length, 1); assert.equal(alerts[0].push, 'skipped_mock'); assert.match(alerts[0].body, /배송비 포함 총 148,000원/);
  ok(`가격 확인 3번: ${totals.map(t => t.toLocaleString()).join(' → ')}원(배송비 포함) → “${wv.display.title}” · 알림 1번(모의)`);
  await checkOnce();
  alerts = (await api('GET', '/alerts')).j.filter((a: any) => a.kind === 'watch_met');
  assert.equal(alerts.length, 1);
  assert.equal((await api('GET', `/watches/${wid}`)).j.history.length, 4);
  ok('같은 조건이 계속 맞아도 알림은 다시 보내지 않는다(중복 방지) · 이력 4건');

  // [리뷰 1] 배송비가 없는 페이지 → “상품 가격은 충족, 배송비 미확인”, 운영자가 배송비를 확인한 뒤에만 조건 충족
  const ship = await api('POST', '/watches', { productUrl: 'mock://fixture/unknown-shipping', size: 'M', color: '블랙', targetPrice: '101,000' });
  await checkOnce();
  let sv = (await api('GET', `/watches/${ship.j.id}`)).j;
  assert.equal(sv.display.title, '상품 가격은 충족, 배송비 미확인');
  assert.equal((await api('GET', '/alerts')).j.filter((a: any) => a.kind === 'watch_met').length, 1, '배송비 미확인으로는 알림 없음');
  assert.ok((await page('/watches')).includes('배송비 확인'));
  await post(`/watches/${ship.j.id}/shipping`, { fee: '3000' });
  sv = (await api('GET', `/watches/${ship.j.id}`)).j;
  assert.equal(sv.display.key, 'met');
  assert.match((await api('GET', '/alerts')).j[0].body, /배송비 포함 총 101,000원/);
  ok('배송비 미확인 → 알림 없이 “상품 가격은 충족, 배송비 미확인” → 운영자가 배송비 3,000원 확인 → 총 101,000원으로 조건 충족 알림');
  assert.equal((await api('POST', `/watches/${ship.j.id}/end`)).j.status, 'ended');

  // 내가 찾는 옷 — 찾아줘 + 기다려줘 한 목록
  me = (await api('GET', '/me')).j;
  assert.ok(me.items.some((x: any) => x.kind === 'find') && me.items.some((x: any) => x.kind === 'watch'));
  assert.equal(me.items.find((x: any) => x.kind === 'watch' && x.id === wid).stateLabel, '조건 충족');
  assert.deepEqual(me.watchLimit, { max: 3, used: 1 });
  ok(`내가 찾는 옷: ${me.items.map((x: any) => `${x.kind === 'find' ? '찾아줘' : '기다려줘'}·${x.stateLabel}`).join(' / ')}`);

  // 정책: 확인 요청 · 약관 차단 판매처 · 활성 3개 · 일시중지·재개·종료
  const byName = await api('POST', '/watches', { productName: 'ANDROS Wool Zip Jacket', targetPrice: '200000', size: 'M' });
  assert.equal(byName.j.status, 'needs_info');
  const bj = await api('POST', '/watches', { productUrl: 'https://m.bunjang.co.kr/products/123', productName: '번개장터 매물', targetPrice: '100000' });
  assert.equal(bj.j.status, 'needs_info'); assert.match(bj.j.display.desc, /약관/);
  assert.equal((await api('POST', '/watches', { productName: '네 번째', targetPrice: '100000' })).j.error, 'watch_limit');
  ok('이름만 → “상품을 확인하고 있어요” · 번개장터 링크 → 약관 사유로 자동 확인 안 함 · 활성 4번째는 409');
  assert.equal((await api('POST', `/watches/${bj.j.id}/end`)).j.status, 'ended');
  assert.equal((await api('POST', `/watches/${wid}/pause`)).j.display.key, 'paused');
  assert.equal((await api('POST', `/watches/${wid}/resume`)).j.status, 'active');
  await post(`/watches/${byName.j.id}/url`, { url: 'mock://fixture/size-mismatch' });
  await checkOnce();
  const sz = (await api('GET', `/watches/${byName.j.id}`)).j;
  assert.equal(sz.display.key, 'watching'); assert.match(sz.display.desc, /M 사이즈 옵션이 없어요/);
  ok('종료·일시중지·재개 · 운영자가 상품 페이지 연결 → 사이즈 불일치는 조건 충족 아님');
  const srcs = (await api('GET', '/sources')).j;
  assert.ok(srcs.some((s: any) => s.id === 'bunjang' && s.status === 'UNSUPPORTED') && srcs.some((s: any) => s.id === 'joongna' && s.status === 'PENDING_INTEGRATION'));
  ok('판매처 범위 API: 번개장터 UNSUPPORTED · 중고나라 PENDING_INTEGRATION');

  // ── 서버 재시작: 끊긴 가격 확인 회수 · 상태 유지 ──
  srv.kill(); await sleep(400);
  const raw = new DatabaseSync(DB_FILE);
  raw.prepare(`INSERT INTO price_checks(target_key, url, source, slot, status, attempts, lease_until, is_mock, created_at) VALUES ('mock:mock://fixture/price-drop','mock://fixture/price-drop','mock','crash-slot','running',1,1,1,1)`).run();
  raw.close();
  srvLog = ''; start(); await ready(); await login();
  assert.match(srvLog, /가격 확인 1건을 다시 대기열에 넣었어요/);
  await post('/watches/qa/check', {});
  const db2 = new DatabaseSync(DB_FILE);
  assert.equal((db2.prepare(`SELECT status FROM price_checks WHERE slot='crash-slot'`).get() as any).status, 'done');
  db2.close();
  assert.equal((await api('GET', `/watches/${wid}`)).j.status, 'active');
  assert.equal((await api('GET', '/alerts')).j.filter((a: any) => a.kind === 'watch_met' && a.link === `walf://watch/${wid}`).length, 1);
  ok('서버 재시작 → 끊긴 가격 확인을 다시 대기열에 넣어 끝냄 · 상태 유지 · 알림 중복 없음');

  // ── DISCOVER(다른 기기) ──
  await api('POST', '/session', { deviceId: Bdev['x-walf-device'] }, {});
  const fd2 = new FormData();
  fd2.append('note', '[테스트:유사] 로고 없는 브라운 자켓'); fd2.append('photo', new Blob([PNG], { type: 'image/png' }), 'sns.png');
  const d2 = await api('POST', '/requests', fd2, Bdev);
  assert.equal(d2.status, 201, JSON.stringify(d2.j));
  const did = d2.j.id;
  html = await waitFor(`/requests/${did}`, 'data-ai="find:draft"');
  const discs = [...html.matchAll(/name="disc" value="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(discs.map(x => x.split('|')[0]).sort(), ['testminimal', 'testwork']);
  await post(`/requests/${did}/find/publish`, { [`tier_${/name="tier_(\d+)"/.exec(html)![1]}`]: 'skip', disc: discs });
  const df = (await api('GET', `/requests/${did}/find`, undefined, Bdev)).j;
  assert.equal(df.discover.length, 2); assert.equal(df.likely.length, 0);
  assert.equal((await api('GET', '/me', undefined, Bdev)).j.active.display.key, 'find_discover');
  ok(`DISCOVER: 같은 옷을 못 찾음 → 스타일이 겹치는 ${df.discover.map((x: any) => x.name).join('·')} 공개(“같은 상품 아님”)`);

  // 어드민 화면 · 비용
  assert.ok((await page('/watches')).includes('판매처 자동 확인 범위'));
  const cost = await page('/costs');
  assert.ok(cost.includes('$0.00') && cost.includes('모의'), '모의 실행은 비용 0');
  assert.ok((await page('/styles')).includes('TEST MINIMAL'));
  ok('어드민: 기다려줘 목록 · 비용(모의 $0) · 스타일 매핑 화면');

  // 계정 삭제 → 기다려줘도 지운다
  const w3 = await api('POST', '/watches', { productUrl: 'mock://fixture/unknown-shipping', targetPrice: '100000' }, Bdev);
  assert.equal(w3.status, 201);
  assert.equal((await api('DELETE', '/me', undefined, Bdev)).status, 200);
  const db3 = new DatabaseSync(DB_FILE);
  assert.equal((db3.prepare('SELECT COUNT(*) n FROM watches WHERE id=?').get(w3.j.id) as any).n, 0);
  db3.close();
  ok('계정 삭제 → 그 사용자의 기다려줘·감시 기록도 삭제');
  assert.equal((await api('GET', `/watches/${wid}`, undefined, Bdev)).status, 401);
}

main().then(() => { console.log(`\n${steps.length} steps passed`); }, e => { console.error('\nFAIL', e); console.error(srvLog.slice(-3000)); process.exitCode = 1; })
  .finally(() => { srv?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
