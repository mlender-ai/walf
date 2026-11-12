import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, productKey, SCHEMA_VERSION } from '../src/db.ts';
import * as S from '../src/sources.ts';

// 카페24 상품 페이지 모양을 줄인 가짜 HTML(가상의 상품) — 구조는 2026-11-13 공식몰 상품 페이지와 같다
const ld = { '@context': 'https://schema.org', '@type': 'ProductGroup', name: '[T-001] 테스트 자켓 - 네이비', brand: { '@type': 'Brand', name: 'testbrand' }, image: ['https://shop.example.com/a.jpg'],
  hasVariant: ['S', 'M', 'L'].map((size, i) => ({ '@type': 'Product', color: '네이비', size, offers: { '@type': 'Offer', price: 189000, priceCurrency: 'KRW', availability: i === 1 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } })) };
const stock = { A: ['S', 3], B: ['M', 0], C: ['L', 5] };
const optionData = JSON.stringify(Object.fromEntries(Object.entries(stock).map(([k, [size, n]]) => [`P0000T${k}`, { use_stock: true, is_selling: 'T', is_display: 'T', option_price: 189000, option_value: `네이비-${size}`, stock_number: n, option_value_orginal: ['네이비', size] }])))
  .replace(/"/g, '\\"');
const HTML = `<html><head><meta property="product:price:amount" content="189000" /><meta property="product:sale_price:amount" content="170100" />
<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><script>var product_name = '[T-001] 테스트 자켓 - 네이비'; var option_stock_data = '${optionData}';</script></body></html>`;

test('카페24 상품 페이지: 옵션별 재고·가격, 할인가는 따로, 배송비는 모르면 null', () => {
  const s = S.parseProductPage(HTML, 'https://shop.example.com/product/t-001/1/');
  assert.equal(s.title, '[T-001] 테스트 자켓 - 네이비');
  assert.equal(s.brand, 'testbrand');
  assert.equal(s.price, 189000);
  assert.equal(s.salePrice, 170100, '표시 할인가는 정가와 따로 둔다');
  assert.equal(s.shipping, null);
  assert.deepEqual(s.options.map(o => [o.size, o.stock]), [['S', 'in_stock'], ['M', 'sold_out'], ['L', 'in_stock']]);
  assert.ok(s.basis.includes('option_stock_data') && s.basis.includes('json-ld'));
});

test('카페24 재고와 구조화 데이터가 다르면 “확인 못 함”', () => {
  const s = S.parseProductPage(HTML.replace('"stock_number\\":0', '"stock_number\\":4'), 'https://shop.example.com/p/1');
  const m = s.options.find(o => o.size === 'M')!;
  assert.equal(m.stock, 'unknown');
  assert.match(m.basis, /불일치/);
});

test('구조화 데이터만 있는 일반 쇼핑몰도 읽는다', () => {
  const html = `<script type="application/ld+json">{"@type":"Product","name":"Knit","offers":{"@type":"Offer","price":"98000","availability":"InStock","shippingDetails":{"shippingRate":{"value":"0"}}}}</script>`;
  const s = S.parseProductPage(html, 'https://www.other.example/item/9');
  assert.equal(s.price, 98000); assert.equal(s.shipping, 0); assert.equal(s.pageStock, 'in_stock'); assert.equal(s.options.length, 0);
});

test('robots.txt: 우리 UA 그룹 우선, 가장 긴 규칙, Allow 예외', () => {
  const txt = 'User-agent: *\nDisallow: /admin\nDisallow: /*board*page=\nAllow: /admin/public\n\nUser-agent: GPTBot\nDisallow: /';
  assert.equal(S.robotsAllows(txt, '/product/x/1/'), true);
  assert.equal(S.robotsAllows(txt, '/admin/x'), false);
  assert.equal(S.robotsAllows(txt, '/admin/public/x'), true);
  assert.equal(S.robotsAllows(txt, '/board/free/list.html?page=2'), false);
  assert.equal(S.robotsAllows('User-agent: walf-pricecheck\nDisallow: /\n\nUser-agent: *\nAllow: /', '/p'), false);
});

test('SSRF 방지: 내부망·로그인 정보·비표준 포트 주소는 열지 않는다', async () => {
  const pub = async () => ['93.184.216.34'];
  for (const u of ['http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://169.254.169.254/latest', 'http://[::1]/x', 'ftp://e.com/x', 'https://user:pw@e.com/x', 'https://e.com:8080/x', 'http://intranet/x'])
    await assert.rejects(S.assertPublicUrl(u, pub), (e: any) => e instanceof S.SourceError, u);
  await assert.rejects(S.assertPublicUrl('https://evil.example.com/x', async () => ['192.168.0.10']), (e: any) => e.code === 'bad_url', 'DNS가 내부 주소를 가리키면 거부');
  assert.ok(await S.assertPublicUrl('https://shop.example.com/p', pub));
});

test('리다이렉트로 내부망에 가는 것도 막는다', async () => {
  const fetcher: S.Fetcher = async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  await assert.rejects(S.safeFetch('https://shop.example.com/p', { fetcher, resolve: async () => ['93.184.216.34'] }), (e: any) => e.code === 'bad_url');
});

test('robots.txt 가 막으면 상품 페이지를 열지 않고, robots.txt 를 못 읽으면(5xx) 열지 않는다', async () => {
  S.clearRobotsCache();
  const seen: string[] = [];
  const mk = (robots: Response) => (async (u: string) => { seen.push(u); return u.endsWith('/robots.txt') ? robots.clone() : new Response(HTML, { status: 200 }); }) as S.Fetcher;
  const resolve = async () => ['93.184.216.34'];
  await assert.rejects(S.fetchPage('https://a.example.com/product/1', { fetcher: mk(new Response('User-agent: *\nDisallow: /product', { status: 200 })), resolve }), (e: any) => e.code === 'robots');
  assert.ok(!seen.includes('https://a.example.com/product/1'));
  await assert.rejects(S.fetchPage('https://b.example.com/product/1', { fetcher: mk(new Response('', { status: 503 })), resolve }), (e: any) => e.code === 'robots');
  const snap = await S.fetchPage('https://c.example.com/product/1', { fetcher: mk(new Response('', { status: 404 })), resolve });
  assert.equal(snap.price, 189000, 'robots.txt 가 없으면(404) 허용');
});

test('약관이 자동 수집을 금지한 판매처는 UNSUPPORTED, 확인 전인 곳은 PENDING_INTEGRATION', () => {
  assert.equal(S.sourceFor('https://m.bunjang.co.kr/products/1').source.status, 'UNSUPPORTED');
  assert.equal(S.sourceFor('https://kream.co.kr/products/1').source.status, 'PENDING_INTEGRATION');
  assert.equal(S.sourceFor('https://web.joongna.com/product/1').ok, false);
  assert.equal(S.sourceFor('https://badblood.co.kr/product/x/1/').ok, true);
  assert.equal(S.sourceFor('mock://fixture/price-drop').ok, false, '테스트 주소는 QA 설정에서만');
  assert.equal(S.urlKey('https://www.shop.com/p/1/?utm_source=x&b=2&a=1'), 'shop.com/p/1?a=1&b=2');
});

test('V1 DB를 V2로 올리면 먼저 사본을 남기고, 기존 의뢰는 그대로 두고 상품을 채운다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walf-mig-'));
  const file = path.join(dir, 'walf.db');
  // V1 스키마로 만든 DB(필요한 표만): 운영자가 확인한 의뢰 1건, 아직 확인 전 1건
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, device_id TEXT UNIQUE NOT NULL, platform TEXT, push_token TEXT, push_permission TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE requests(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, status TEXT NOT NULL, product_name TEXT, brand TEXT, product_url TEXT, photo TEXT, note TEXT,
      size TEXT, color TEXT, max_price INTEGER, used_ok INTEGER NOT NULL DEFAULT 1, identified_brand TEXT, identified_name TEXT, identified_note TEXT, info_request TEXT,
      activated_at INTEGER, expires_at INTEGER, ended_at INTEGER, end_reason TEXT, is_mock INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, request_id INTEGER, candidate_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, link TEXT,
      is_mock INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, read_at INTEGER, push_status TEXT NOT NULL, push_detail TEXT);
    INSERT INTO users VALUES (1,'dev-old-0001','ios',NULL,NULL,1);
    INSERT INTO requests(id,user_id,status,product_name,brand,identified_brand,identified_name,size,created_at,updated_at) VALUES (1,1,'active','배드블러드 트랙자켓','BADBLOOD','BADBLOOD','Mystic Nylon Track Jacket Navy','M',1,1);
    INSERT INTO requests(id,user_id,status,product_name,created_at,updated_at) VALUES (2,1,'submitted','이름만 쓴 옷',2,2);
    INSERT INTO notifications(user_id,kind,title,body,created_at,push_status) VALUES (1,'offer','t','b',3,'sent');`);
  old.close();
  const logs: string[] = [];
  const db = openDb(file, { backupDir: path.join(dir, 'backups'), log: s => logs.push(s) });
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION);
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(backups.length, 1);
  const bk = new DatabaseSync(path.join(dir, 'backups', backups[0]));
  assert.equal((bk.prepare('SELECT COUNT(*) n FROM requests').get() as any).n, 2, '사본에 원래 데이터');
  bk.close();
  const r1 = db.prepare('SELECT * FROM requests WHERE id=1').get() as any;
  assert.equal(r1.identified_name, 'Mystic Nylon Track Jacket Navy', '기존 값은 그대로');
  const p1 = db.prepare('SELECT * FROM products WHERE id=?').get(r1.product_id) as any;
  assert.equal(p1.verified, 1); assert.equal(p1.canonical_key, productKey('BADBLOOD', 'Mystic Nylon Track Jacket Navy'));
  const p2 = db.prepare('SELECT p.* FROM requests r JOIN products p ON p.id=r.product_id WHERE r.id=2').get() as any;
  assert.equal(p2.verified, 0, '운영자 확인 전 이름은 확인되지 않은 상품');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM notifications').get() as any).n, 1);
  db.close();
  // 두 번째로 열면 사본을 또 만들지 않는다
  openDb(file, { backupDir: path.join(dir, 'backups') }).close();
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
});
