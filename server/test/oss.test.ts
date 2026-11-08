// 오픈소스 엔진 공급자 — 실제 엔진 대신 같은 입출력 약속을 지키는 가짜 엔진(파이썬 몇 줄)으로 서버 연결만 확인한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import * as A from '../src/aijobs.ts';
import { aiFromEnv } from '../src/ai.ts';
import { ossProvider } from '../src/oss.ts';
import { reportHtml } from '../src/report.ts';
import { setClock } from '../src/time.ts';

process.env.WALF_PUSH_DISABLED = '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walf-oss-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const script = path.join(tmp, 'fake_hunt.py');
fs.writeFileSync(script, `
import json, sys, time, os
cmd = sys.argv[1]; inp = json.load(sys.stdin)
print("가짜 엔진", cmd, file=sys.stderr)
mode = os.environ.get("FAKE_MODE", "")
if mode == "hang": time.sleep(30)
if mode == "fail": print(json.dumps({"error": "SearXNG 연결 실패"})); sys.exit(1)
if cmd == "identify":
    print(json.dumps({"identities": [{"brand": "FAR FROM WHAT", "name": "FAR WOOL ARM CUTLINE JACKET", "color": "", "category": "자켓", "confidence": "medium",
      "reasons": ["사진 비교(로컬 모델): 같은 모델로 보임"], "refs": ["https://www.29cm.co.kr/products/1"]}], "missing": [], "summary": "후보 1개",
      "features": {"garment": "자켓", "colors": ["브라운"]}, "metrics": {"engine": "oss", "queries": [{"q": "a"}, {"q": "b"}], "external_api_calls": 0, "timing": {"total_ms": 1000}}}))
else:
    rec = inp.get("recheck") or []
    print(json.dumps({"sellers": [{"seller": "번개장터", "searched": True, "note": "검색 3회", "status": "results"}, {"seller": "무신사", "searched": False, "note": "검색 엔진이 막음", "status": "blocked"}],
      "listings": [
        {"seller": "번개장터", "url": "https://m.bunjang.co.kr/products/111", "title": "배드블러드 미스틱 트랙자켓 M 네이비", "price": 118000, "size": "M", "condition": "used", "match": "same_likely", "stock": "listed",
         "reason": "브랜드명이 같아요", "pageStatus": "ok", "colorMatch": "match", "sizeMatch": "match", "image": "https://media.bunjang.co.kr/x.jpg", "snippet": "s", "evidence": ["브랜드명이 같아요", "사이즈 M 표기가 있어요"], "query": "q1", "visual": None, "reserved": False},
        {"seller": "무신사", "url": "https://global.musinsa.com/us/products/1", "title": "해외", "price": None, "size": "", "condition": "new", "match": "same_likely", "stock": "unknown", "reason": "", "pageStatus": "robots", "evidence": []}],
      "summary": "검색 3회", "metrics": {"engine": "oss", "queries": [{"q": "q1"}, {"q": "q2"}, {"q": "q3"}], "counts": {"new_urls": 2}, "photo_given": bool(inp.get("photo")), "features_given": inp.get("features"),
        "rechecks": [{"url": r["url"], "prevPrice": r.get("price"), "price": 99000, "status": "ok", "stock": "listed"} for r in rec], "external_api_calls": 0, "timing": {"total_ms": 2000}}}))
`);
const prov = (timeoutMs = 10_000) => ossProvider({ python: 'python3', script, logDir: path.join(tmp, 'logs'), timeoutMs, vlm: 'test-vlm' });

test('실험 공급자는 기본 꺼짐 — WALF_AI_PROVIDER=oss 일 때만 켜진다', () => {
  assert.equal(aiFromEnv({}), null);
  assert.equal(aiFromEnv({ WALF_AI_PROVIDER: 'oss' })?.kind, 'oss');
  assert.equal(aiFromEnv({ ANTHROPIC_API_KEY: 'x' })?.kind, 'claude', '기존 Claude 공급자는 그대로');
});

test('엔진 결과를 기존 형식으로 받고, 원본 로그를 남기며, 판매처 밖(해외) 주소는 버린다', async () => {
  const p = prov();
  const id = await p.identify({ productName: null, photoPath: '/x.jpg', sellers: [{ id: 1, name: '29CM', domain: '29cm.co.kr' }] });
  assert.equal(id.data.identities[0].name, 'FAR WOOL ARM CUTLINE JACKET');
  assert.deepEqual(id.data.features, { garment: '자켓', colors: ['브라운'] });
  assert.equal(id.usage.inputTokens, 0); assert.equal(id.usage.searches, 2); assert.equal(id.usage.model, 'oss:test-vlm');
  const sellers = [{ id: 1, name: '무신사', domain: 'musinsa.com' }, { id: 4, name: '번개장터', domain: 'bunjang.co.kr' }];
  const s = await p.search({ brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', usedOk: true, day: 1, sellers, known: [] });
  assert.equal(s.data.listings.length, 1, 'global.musinsa.com 은 musinsa.com 이 아니라서 버린다');
  assert.equal(s.data.dropped, 1);
  const l = s.data.listings[0];
  assert.equal(l.urlSeen, true); assert.equal(l.extra?.pageStatus, 'ok'); assert.deepEqual(l.extra?.evidence, ['브랜드명이 같아요', '사이즈 M 표기가 있어요']);
  const log = (s.data.metrics as any).log;
  assert.ok(fs.readFileSync(path.join(tmp, 'logs', log), 'utf8').includes('가짜 엔진 search'), '엔진 진행 기록이 원본 로그로 남는다');
});

test('엔진 실패·시간 초과는 실패로 알린다', async () => {
  process.env.FAKE_MODE = 'fail';
  try { await assert.rejects(prov().search({ brand: 'B', name: 'N', usedOk: true, day: 1, sellers: [], known: [] }), /탐색 엔진 실패: SearXNG 연결 실패/); }
  finally { delete process.env.FAKE_MODE; }
  process.env.FAKE_MODE = 'hang';
  try { await assert.rejects(prov(800).search({ brand: 'B', name: 'N', usedOk: true, day: 1, sellers: [], known: [] }), /분 안에 끝나지 않아/); }
  finally { delete process.env.FAKE_MODE; }
});

test('흐름: 접수 사진 특징은 한 번만 보고, 정기 탐색에 넘기며, 찾은 매물은 다음 날 다시 확인한다', async () => {
  setClock(Date.UTC(2026, 10, 9, 1, 0));
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-oss-0001', 'ios');
  const id = D.createRequest(db, u.id, { productName: 'BADBLOOD Mystic Nylon Track Jacket', brand: 'BADBLOOD', size: 'M', color: '네이비', photo: 'a.jpg' });
  const p = prov(); const w = A.createAiWorker(db, p, '/uploads');
  A.ensureAiJobs(db, p); await w.step();
  const idJob = db.prepare(`SELECT * FROM ai_jobs WHERE kind='identify'`).get() as any;
  assert.equal(idJob.provider, 'oss'); assert.equal(idJob.is_mock, 0, '실제 탐색 결과(모의 아님)');
  assert.equal(JSON.parse(idJob.detail).features.garment, '자켓');
  A.acceptIdentity(db, (db.prepare('SELECT id FROM ai_identities').get() as any).id, { name: 'BADBLOOD Mystic Nylon Track Jacket Navy', note: '품번 W-JKT26-055' } as any, '운영자');
  A.ensureAiJobs(db, p); await w.step();
  const sj = db.prepare(`SELECT * FROM ai_jobs WHERE kind='search'`).get() as any;
  const det = JSON.parse(sj.detail);
  assert.equal(det.metrics.photo_given, true); assert.equal(det.metrics.features_given.garment, '자켓', '접수 때 본 특징을 넘긴다(다시 분석하지 않음)');
  const f = db.prepare('SELECT * FROM ai_finds').get() as any;
  assert.equal(f.page_status, 'ok'); assert.equal(f.color_match, 'match'); assert.equal(f.size_match, 'match'); assert.equal(f.query, 'q1');
  assert.deepEqual(JSON.parse(f.evidence), ['브랜드명이 같아요', '사이즈 M 표기가 있어요']);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM hunt_observations').get() as any).n, 1);
  // 다음 날: 같은 매물을 다시 열어 가격 변화를 남긴다
  const run1 = db.prepare('SELECT * FROM search_runs WHERE request_id=? AND day=1').get(id) as any;
  A.rejectFind(db, f.id, '기타', '운영자'); // 제외한 매물은 다시 확인 대상이 아니다
  const r2 = db.prepare(`SELECT COUNT(*) n FROM ai_finds WHERE status IN ('proposed','accepted')`).get() as any;
  assert.equal(r2.n, 0);
  D.completeRun(db, run1.id, { checks: (db.prepare('SELECT id FROM sellers').all() as any[]).map(s => ({ sellerId: s.id, status: 'checked' as const, result: 'none' as const })), outcome: 'no_match', reviewMinutes: 6 } as any, '운영자');
  assert.equal((db.prepare('SELECT review_minutes FROM search_runs WHERE id=?').get(run1.id) as any).review_minutes, 6, '운영자 검수 시간(선택)');
  const html = reportHtml(db, { ai: p });
  assert.match(html, /정기 탐색 실행<\/p><p[^>]*>1회 · 정상 완료 1/);
  assert.match(html, /호출 0회 · 과금 0원/);
  assert.match(html, /기준 데이터 없음/, 'Claude 기록이 없으면 비교할 수 없다고 쓴다');
  assert.match(html, /제외 사유: 기타 1/);
});

test('리포트: 오픈소스 작업이 없으면 없다고 보인다', () => {
  const db = openDb(':memory:');
  assert.match(reportHtml(db, { ai: null }), /아직 오픈소스 엔진으로 실행한 작업이 없어요/);
});
