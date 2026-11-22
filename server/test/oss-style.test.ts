// 무료 엔진 연결(oss.ts) — 글→디자인 태그, 대체 추천 검색어, 운영자가 고친 기준 디자인 보존
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import * as D from '../src/domain.ts';
import { requestStyle, saveRequestStyle, styleFromText } from '../src/catalog.ts';
import { similarQueries } from '../src/oss.ts';

test('글→디자인 태그: 딥블루는 네이비 · 부츠컷은 바지(신발 아님) · 커브드 절개', () => {
  assert.deepEqual(styleFromText('바지 베이지 딥블루 데님 소재'), { category: ['trousers'], color: ['navy', 'beige'], material: ['denim'] });
  assert.deepEqual(styleFromText('리바이스 517 부츠컷 청바지'), { category: ['trousers'], silhouette: ['bootcut'] });
  assert.deepEqual(styleFromText('Levis 517 boot-cut jeans').category, ['trousers'], 'boot-cut 은 신발이 아니다');
  assert.deepEqual(styleFromText('첼시 부츠 블랙').category, ['footwear']);
  assert.deepEqual(styleFromText('커브드 팬츠 네이비').detail, ['curved-seam']);
  assert.deepEqual(styleFromText('라이트 블루 청바지').color, ['blue']);
});

test('대체 추천 검색어: 색마다 하나(최대 2개) · 가장 또렷한 특징만', () => {
  assert.deepEqual(similarQueries({ category: ['trousers'], color: ['navy', 'beige'], silhouette: ['bootcut'], detail: ['curved-seam'] }), ['네이비 부츠컷', '베이지 부츠컷', '커브드 부츠컷']);
  assert.deepEqual(similarQueries({ gender: ['men'], category: ['trousers'], color: ['navy', 'beige'], silhouette: ['bootcut'], detail: ['curved-seam'] }),
    ['남자 네이비 부츠컷', '남자 베이지 부츠컷', '남자 커브드 부츠컷'], '성별을 검색어 앞에');
  assert.deepEqual(similarQueries({ category: ['shirts'], color: ['red', 'white'], detail: ['check'] }), ['레드 체크 셔츠', '화이트 체크 셔츠']);
  assert.deepEqual(similarQueries({ category: ['trousers'], color: ['beige'], detail: ['curved-seam'] }), ['베이지 커브드 바지']);
  assert.deepEqual(similarQueries({ color: ['red'] }), [], '제품군을 모르면 검색하지 않는다');
});

test('운영자가 고친 기준 디자인은 AI가 다시 살펴봐도 덮어쓰지 않는다', () => {
  const db = openDb(':memory:');
  const u = D.upsertUser(db, 'device-oss-style-01', 'ios');
  const id = D.createRequest(db, u.id, { photo: 'x.jpg', note: '' }, { isMock: true });
  saveRequestStyle(db, id, { category: ['trousers'], color: ['blue'] }, 'ai');
  saveRequestStyle(db, id, { category: ['trousers'], color: ['navy', 'beige'], silhouette: ['bootcut'] }, 'verified', '운영자');
  saveRequestStyle(db, id, { category: ['trousers'], color: ['blue'] }, 'ai');
  assert.deepEqual(requestStyle(db, id), { silhouette: ['bootcut'], category: ['trousers'], color: ['navy', 'beige'] });
  assert.equal((db.prepare(`SELECT updated_by FROM style_tags WHERE subject='request' AND subject_key=? LIMIT 1`).get(String(id)) as any).updated_by, '운영자');
});

test('성별: 제목 단서로 읽고(66 은 여성복 사이즈) · 찾는 옷이 남성이면 여성 상품은 대체 추천에서 뺀다', async () => {
  const { curateOffers } = await import('../src/curation.ts');
  assert.deepEqual(styleFromText('남자 네이비 베이지 데님 부츠컷 커브드 바지').gender, ['men']);
  assert.deepEqual(styleFromText('새것 스파오 부츠컷66 통바지66').gender, ['women']);
  assert.deepEqual(styleFromText('Women bootcut jeans').gender, ['women'], 'women 안의 men 은 남성 단서가 아니다');
  assert.equal(styleFromText('남녀공용 남자 여자 부츠컷').gender, undefined, '둘 다 보이면 모른다');
  const want = { gender: ['men'], category: ['trousers'], silhouette: ['bootcut'], material: ['denim'], color: ['beige'] };
  const offer = (name: string) => ({ url: `https://web.joongna.com/product/${name.length}${Math.round(Math.random() * 1e6)}`, seller: '중고나라', name, recommender: 'walf-oss', recommenderVersion: 'oss-1', style: styleFromText(name), condition: 'used' });
  const out = curateOffers([offer('띠어리 여성 베이지 부츠컷 데님 팬츠'), offer('남자 베이지 부츠컷 데님 팬츠'), offer('베이지 부츠컷 데님 팬츠 32')],
    { style: want, brand: null, name: '', modelCode: null, size: null, limit: 6, mockAllowed: false } as any);
  assert.deepEqual(out.offers.map((o: any) => o.name).sort(), ['남자 베이지 부츠컷 데님 팬츠', '베이지 부츠컷 데님 팬츠 32'], '성별을 모르는 상품은 남겨 운영자가 사진으로 본다');
  assert.equal(out.dropped.gender, 1);
});
