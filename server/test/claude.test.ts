// 실제 키 없이 Claude 요청 모양과 응답 처리만 확인한다 — 가짜 API 서버(로컬)가 정해진 응답을 돌려준다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { claudeProvider, AiError, aiErrorText } from '../src/ai.ts';

let srv: http.Server;
const got: { headers: http.IncomingHttpHeaders; body: any }[] = [];
let replies: ((body: any) => [number, any])[] = [];
const msg = (stop_reason: string, content: any[]) => ({ id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason, stop_sequence: null, content,
  usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } });
const sellers = [{ id: 1, name: '무신사', domain: 'musinsa.com' }, { id: 4, name: '번개장터', domain: 'bunjang.co.kr' }];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walf-claude-'));

before(async () => {
  srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
      const body = JSON.parse(raw || '{}'); got.push({ headers: req.headers, body });
      const [status, out] = (replies.shift() || (() => [500, { type: 'error', error: { type: 'api_error', message: 'no reply' } }]))(body);
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(srv.address() as any).port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-test-local-only';
});
after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.ANTHROPIC_BASE_URL; delete process.env.ANTHROPIC_API_KEY; });

test('식별: 사진을 줄여 보내고, 웹 검색 반복 한도(pause_turn)를 이어서 받아 제출 도구 입력을 쓴다', async () => {
  got.length = 0;
  const photo = path.join(tmp, 'big.png');
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#203040' } }).png().toFile(photo);
  replies = [
    () => [200, msg('pause_turn', [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'badblood track jacket' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://badblood.co.kr/product/1', title: 'x', encrypted_content: 'e', page_age: null }] }])],
    () => [200, msg('tool_use', [{ type: 'tool_use', id: 'toolu_1', name: 'submit_identification', input: {
      identities: [{ brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket', color: 'Navy', category: '아우터', confidence: 'high', reasons: ['공식몰 상품명'], refs: ['https://badblood.co.kr/product/1', 'javascript:alert(1)'] }],
      missing: [], summary: '공식몰과 일치' } }])],
  ];
  const out = await claudeProvider().identify({ productName: null, photoPath: photo, size: 'M' });
  assert.equal(out.data.identities[0].name, 'Mystic Nylon Track Jacket');
  assert.deepEqual(out.data.identities[0].refs, ['https://badblood.co.kr/product/1'], 'http(s)가 아닌 주소는 버린다');
  assert.equal(out.usage.searches, 2); assert.equal(out.usage.inputTokens, 200);
  assert.equal(got.length, 2);
  const [a, b] = got;
  assert.equal(a.body.model, 'claude-opus-5-5');
  assert.deepEqual(a.body.thinking, { type: 'adaptive' }); assert.equal(a.body.output_config.effort, 'high');
  assert.equal(a.body.fallbacks, 'default'); assert.match(String(a.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(a.body.temperature, undefined);
  const ws = a.body.tools.find((t: any) => t.name === 'web_search');
  assert.equal(ws.type, 'web_search_20260209'); assert.equal(ws.user_location.country, 'KR');
  const submit = a.body.tools.find((t: any) => t.name === 'submit_identification');
  assert.equal(submit.strict, true); assert.equal(a.body.tool_choice, undefined, '강제 도구 선택은 이 모델에서 400 — 쓰지 않는다');
  const img = a.body.messages[0].content.find((c: any) => c.type === 'image');
  assert.equal(img.source.media_type, 'image/jpeg');
  const meta = await sharp(Buffer.from(img.source.data, 'base64')).metadata();
  assert.equal(Math.max(meta.width!, meta.height!), 1568, '긴 변 1568px로 줄인다');
  // 이어 받기: 앞선 assistant 응답을 그대로 붙이고 user 메시지를 더하지 않는다
  assert.equal(b.body.messages.length, 2); assert.equal(b.body.messages[1].role, 'assistant');
});

test('탐색: 판매처 도메인으로만 검색하고, 크롤러가 막힌 판매처는 빼고 다시 시도한다', async () => {
  got.length = 0;
  replies = [
    () => [400, { type: 'error', error: { type: 'invalid_request_error', message: 'allowed_domains.1: bunjang.co.kr is not accessible to our crawler' } }],
    (body) => [200, msg('tool_use', [{ type: 'tool_use', id: 'toolu_2', name: 'submit_search', input: {
      sellers: [{ seller: '무신사', searched: true, note: '없음' }],
      listings: [{ seller: '무신사', url: 'https://www.musinsa.com/products/1', title: 't', price: 99000, size: 'M', condition: 'new', match: 'same_likely', stock: 'listed', reason: '' }],
      summary: body.tools.find((t: any) => t.name === 'web_search').allowed_domains.join(',') } }])],
  ];
  const out = await claudeProvider({ effort: 'medium' }).search({ brand: 'BADBLOOD', name: 'Mystic Nylon Track Jacket Navy', size: 'M', maxPrice: 150000, usedOk: true, day: 1, sellers, known: [] });
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].body.tools.find((t: any) => t.name === 'web_search').allowed_domains, ['musinsa.com', 'bunjang.co.kr']);
  assert.deepEqual(got[0].body.tools.find((t: any) => t.name === 'web_fetch').allowed_domains, ['musinsa.com', 'bunjang.co.kr']);
  assert.equal(got[1].body.output_config.effort, 'medium');
  assert.equal(out.data.summary, 'musinsa.com');
  assert.deepEqual(out.data.blocked, ['번개장터']);
  assert.deepEqual(out.data.sellers.map(s => [s.seller, s.searched]), [['무신사', true], ['번개장터', false]]);
  assert.equal(out.data.listings[0].urlSeen, null, '응답에 보인 주소가 없으면 “알 수 없음”으로 둔다(없던 주소로 단정하지 않음)');
});

test('거절·미제출·인증 오류는 실패로 알린다', async () => {
  replies = [() => [200, { ...msg('refusal', []), stop_details: { type: 'refusal', category: 'cyber', explanation: '' } }]];
  await assert.rejects(claudeProvider().identify({ productName: 'x' }), (e: any) => e instanceof AiError && e.code === 'refusal' && /cyber/.test(e.message));
  replies = [() => [200, msg('end_turn', [{ type: 'text', text: '모르겠어요' }])], () => [200, msg('end_turn', [{ type: 'text', text: '모르겠어요' }])]];
  await assert.rejects(claudeProvider().identify({ productName: 'x' }), (e: any) => e.code === 'no_result');
  replies = [() => [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }]];
  await assert.rejects(claudeProvider().identify({ productName: 'x' }), (e: any) => /API 키가 맞지 않아요/.test(aiErrorText(e)));
});
