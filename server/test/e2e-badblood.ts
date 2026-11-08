// BADBLOOD Mystic Nylon Track Jacket Navy / M 으로 등록 → 운영자 검수 → 추적 → 수배 → 결과 알림 → 종료를 HTTP로 끝까지 확인한다.
// 임시 DB에서 돌고 끝나면 지운다. 운영자가 입력하는 탐색·후보·게시 데이터는 모두 “모의(mock)”로 표시한다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walf-e2e-'));
const PORT = 4390 + Math.floor(Math.random() * 50);
const B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['src/index.ts'], { cwd: root, env: { ...process.env, WALF_PORT: String(PORT), WALF_DB: path.join(tmp, 'e2e.db'), WALF_UPLOADS: path.join(tmp, 'up'), WALF_ADMIN_PASSWORD: 'e2e-pass', WALF_QA_TOOLS: '1', WALF_PUSH_DISABLED: '1', WALF_TICK_MS: '600000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);

const steps: string[] = [];
const ok = (s: string) => { steps.push('PASS  ' + s); console.log('PASS ', s); };
const DEV = { 'x-walf-device': 'e2e-device-badblood-01' };
async function api(method: string, p: string, body?: any, headers: Record<string, string> = DEV) {
  const r = await fetch(B + '/api' + p, { method, headers: { ...headers, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
let cookie = '', csrf = '';
async function admin(p: string, form?: Record<string, string>) {
  const r = await fetch(B + '/admin' + p + (form ? `?_csrf=${csrf}` : ''), { method: form ? 'POST' : 'GET', redirect: 'manual', headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
  const loc = r.headers.get('location') || '';
  if (form && loc.includes('e=')) throw new Error('어드민 오류: ' + decodeURIComponent(loc.split('e=')[1]));
  return { status: r.status, loc, html: await r.text() };
}
const me = async () => (await api('GET', '/me')).j;
const key = async () => (await me()).active?.display.key;
const sellers = ['1', '2', '3', '4', '5', '6'];

async function main() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }

  // 1. 앱: 세션 · 의뢰 등록
  assert.equal((await api('POST', '/session', { deviceId: DEV['x-walf-device'], platform: 'ios' })).status, 200);
  const fd = new FormData();
  Object.entries({ productName: 'BADBLOOD Mystic Nylon Track Jacket Navy', brand: 'BADBLOOD', size: 'M', color: '네이비', maxPrice: '150000', usedOk: 'true' }).forEach(([k, v]) => fd.append(k, v));
  // 1×1 PNG — 업로드·표시 경로 확인용
  fd.append('photo', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'tag.png');
  const created = await api('POST', '/requests', fd);
  assert.equal(created.status, 201, JSON.stringify(created.j));
  const id = created.j.id;
  assert.equal(created.j.display.key, 'identification_pending');
  assert.equal(created.j.schedule.expiresAt, null);
  ok(`의뢰 등록 #${id} · 상태 “${created.j.display.title}” · 7일 아직 시작 안 함`);
  const img = await fetch(created.j.product.photoUrl); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  ok(`업로드 사진 서빙 ${new URL(created.j.product.photoUrl).pathname} (요청한 호스트 기준 절대 주소)`);
  assert.equal((await api('POST', '/requests', { productName: '두 번째 옷' })).status, 409);
  ok('두 번째 의뢰는 409 active_exists — 1인 1벌');

  // 2. 어드민: 로그인 · 상품 확인
  const lg = await fetch(B + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ op: 'QA봇', pw: 'e2e-pass' }) });
  cookie = (lg.headers.get('set-cookie') || '').split(';')[0]; assert.ok(cookie.startsWith('walf_ops='));
  const home = (await admin('/')).html; assert.ok(home.includes('상품 확인 대기'));
  csrf = /_csrf=([\w-]+)/.exec(home)![1];
  const nocsrf = await fetch(B + `/admin/requests/${created.j.id}/activate`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=x' });
  assert.equal(nocsrf.status, 403);
  ok('어드민 POST는 CSRF 토큰 없으면 403');
  await admin(`/requests/${id}/activate`, { brand: 'BADBLOOD', name: 'BADBLOOD Mystic Nylon Track Jacket Navy', note: '브랜드 공식 상품명 기준' });
  let m = await me();
  assert.equal(m.active.display.key, 'first_search_pending');
  assert.equal(m.active.schedule.expiresAt - m.active.schedule.activatedAt, 168 * 3600_000);
  ok(`운영자 확인 → 7일 시작 · 앱 “${m.active.display.title}” · ${m.active.schedule.endsLabel}`);
  const detail = await admin(`/requests/${id}`);
  assert.ok(detail.html.includes(m.active.display.title), '어드민이 앱과 같은 문장을 보여줘야 함');
  ok('어드민 “사용자 앱에 지금 보이는 문장” = 앱 상태 문장');

  // 3. 첫 탐색 기록(모의) → 수배 제안
  const run1 = /action="\/admin\/runs\/(\d+)\/complete/.exec(detail.html)![1];
  const runForm: Record<string, string> = { outcome: 'no_match', summary: 'E2E 모의 탐색', mock: '1' };
  sellers.forEach(s => { runForm[`st_${s}`] = 'checked'; runForm[`rs_${s}`] = 'none'; runForm[`nt_${s}`] = ''; });
  runForm.st_1 = 'checked'; runForm.rs_1 = 'same'; runForm.nt_1 = '동일 상품 · L만 있음';
  await admin(`/runs/${run1}/complete`, runForm);
  m = await me();
  assert.equal(m.active.display.key, 'awaiting_consent');
  assert.equal(m.active.sellers.items.length, 6); assert.ok(m.active.sellers.isMock);
  const al1 = (await api('GET', '/alerts')).j;
  assert.equal(al1[0].kind, 'consent'); assert.equal(al1[0].push, 'skipped_mock'); assert.ok(al1[0].isMock); assert.ok(m.active.display.isMock);
  ok(`첫 탐색(모의) 6곳 → “${m.active.display.title}” · 동의 요청 알림도 모의 표시 · 모의라 푸시 안 보냄`);

  // 4. 앱: 수배 승인 → 어드민: 채널별 게시 결과
  await api('POST', `/requests/${id}/wanted`, { decision: 'approve', fields: { photo: true, sizeColor: true, maxPrice: false } });
  assert.equal(await key(), 'wanted_queued');
  ok('수배 승인 → “수배지 게시를 준비하고 있어요” (승인 ≠ 게시)');
  const wd = await admin(`/requests/${id}`);
  const posts = [...wd.html.matchAll(/action="\/admin\/posts\/(\d+)\?/g)].map(x => x[1]);
  assert.equal(posts.length, 3);
  const bad = await fetch(B + `/admin/posts/${posts[0]}?_csrf=${csrf}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ status: 'posted', url: '' }) });
  assert.ok((bad.headers.get('location') || '').includes('e='));
  await admin(`/posts/${posts[0]}`, { status: 'posted', url: 'https://example.com/mock/bunjang-wanted', mock: '1' });
  await admin(`/posts/${posts[1]}`, { status: 'posted', url: 'https://example.com/mock/joongna-wanted', mock: '1' });
  await admin(`/posts/${posts[2]}`, { status: 'skipped', reason: '구매 희망글을 받지 않는 채널', mock: '1' });
  m = await me();
  assert.equal(m.active.display.key, 'wanted_published');
  ok(`게시 주소 없이 완료 처리 거부 · 2곳 게시 1곳 미게시 → “${m.active.display.desc}”`);

  // 5. QA: 다음 날로 → 2일차 탐색 생성 · 기록
  await admin(`/requests/${id}/qa/shift`, {});
  const d2 = await admin(`/requests/${id}`);
  const run2 = /action="\/admin\/runs\/(\d+)\/complete/.exec(d2.html)![1];
  assert.notEqual(run2, run1);
  const f2 = { ...runForm, outcome: 'nothing_new' }; f2.rs_1 = 'none'; f2.nt_1 = '';
  await admin(`/runs/${run2}/complete`, f2);
  m = await me();
  assert.equal(m.active.schedule.day, 2);
  assert.equal(m.active.schedule.days.filter((d: any) => d.state === 'done').length, 2);
  ok(`QA 일정 당김 → DAY 02 탐색 작업 생성 · 기록 → “${m.active.display.title}”`);

  // 6. 판매자 제보(모의) → 유력 후보 · 푸시 없음
  const candForm = { source: 'report', seller: '번개장터', url: 'https://example.com/mock/listing-123', title: 'BADBLOOD 트랙자켓 네이비 M', size: 'M', price: '118000', shipping: '4000', condition: 'used', conditionNote: '사용감 적음(판매자 기재)', matchGrade: 'same_likely', availability: 'listed_unverified', colorOk: '1', evidence: '사진 속 로고 자수와 지퍼 형태가 같아요', pending: '사이즈 | M 택 사진을 요청했어요\n판매 여부 | 판매자에게 묻고 있어요', publish: '1', mock: '1' };
  await admin(`/requests/${id}/candidates`, candForm);
  m = await me();
  assert.equal(m.active.display.key, 'lead_found');
  const lead = m.active.candidates.leads[0];
  assert.deepEqual(lead.tags.map((t: any) => t.text), ['동일 상품 유력', '재고 미확인']);
  assert.ok(lead.isMock);
  assert.equal((await api('GET', '/alerts')).j.filter((a: any) => a.kind === 'lead').length, 0);
  ok(`판매자 제보(모의) 공개 → “${m.active.display.title}” · 배지 ${lead.tags.map((t: any) => t.text).join('/')} · 확인 전 푸시 없음`);

  // 7. 운영자 검수 → 구매 가능 확인 → 알림
  await admin(`/candidates/${lead.id}`, { ...candForm, matchGrade: 'same_confirmed', availability: 'purchasable', checkedNow: '1', evidence: '같은 옷이에요 | 케어라벨 품번이 공식 상품과 같아요\nM 사이즈예요 | 사이즈 택 사진으로 확인했어요\n지금 팔고 있어요 | 판매자에게 판매 중임을 확인했어요', pending: '' });
  m = await me();
  assert.equal(m.active.display.key, 'offer_verified');
  const alerts = (await api('GET', '/alerts')).j;
  assert.equal(alerts[0].kind, 'offer'); assert.equal(alerts[0].title, '왈프가 물어왔어요!'); assert.ok(alerts[0].isMock);
  const cv = (await api('GET', `/candidates/${lead.id}`)).j.candidate;
  assert.equal(cv.kind, 'offer'); assert.equal(cv.total, 122000); assert.equal(cv.ctaLabel, '번개장터에서 보기');
  assert.equal(cv.evidence.length, 3);
  ok(`검수 → “${m.active.display.title}” · 알림 “${alerts[0].title} ${alerts[0].body}” · 총 ${cv.total}원`);
  await admin(`/candidates/${lead.id}`, { ...candForm, matchGrade: 'same_confirmed', availability: 'purchasable', checkedNow: '1', pending: '' });
  assert.equal((await api('GET', '/alerts')).j.filter((a: any) => a.kind === 'offer').length, 1);
  ok('같은 매물을 다시 저장해도 구매 가능 알림은 한 번만');

  // 8. 앱: 구매 확인 → 완료 · 수배글 삭제 요청
  await api('POST', '/alerts/read', {});
  assert.equal((await me()).unread, 0);
  await api('POST', `/requests/${id}/purchase`, { candidateId: lead.id });
  m = await me();
  assert.equal(m.active, null); assert.equal(m.past[0].status, 'completed');
  const q = await admin('/');
  assert.ok(q.html.includes('수배글 삭제 요청') && q.html.match(/번개장터|중고나라/));
  const full = (await api('GET', `/requests/${id}`)).j;
  assert.equal(full.wanted.posts.filter((p: any) => p.status === 'removal_requested').length, 2);
  ok(`구매 확인 → “${full.display.title}” · 게시된 수배지 2건 삭제 요청 대기열로`);
  ok(`활동 일지 ${full.activity.length}건: ` + full.activity.slice().reverse().map((a: any) => `${a.actor}·${a.title}`).join(' → '));

  // 9. 두 번째 의뢰 → 7일 종료
  const r2 = await api('POST', '/requests', { productName: 'BADBLOOD Mystic Nylon Track Jacket Navy', size: 'M' });
  assert.equal(r2.status, 201);
  await admin(`/requests/${r2.j.id}/activate`, { name: 'BADBLOOD Mystic Nylon Track Jacket Navy' });
  await admin(`/requests/${r2.j.id}/qa/expire`, {});
  const e2 = (await api('GET', `/requests/${r2.j.id}`)).j;
  assert.equal(e2.status, 'expired'); assert.equal(e2.display.title, '이번에는 빈 입으로 돌아왔어요');
  assert.ok((await api('GET', '/alerts')).j.some((a: any) => a.kind === 'expired'));
  ok(`종료 처리 → “${e2.display.title}” · 종료 보고 알림 · 남은 탐색 작업 취소`);

  // 10. 다른 기기는 남의 의뢰를 못 본다
  await api('POST', '/session', { deviceId: 'e2e-device-other-02' }, {});
  assert.equal((await api('GET', `/requests/${id}`, undefined, { 'x-walf-device': 'e2e-device-other-02' })).status, 404);
  ok('다른 기기 세션으로 남의 의뢰 조회 → 404');
}

main().then(() => { console.log(`\n${steps.length} steps passed`); }, e => { console.error('\nFAIL', e); console.error(srvLog.slice(-2000)); process.exitCode = 1; })
  .finally(() => { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
