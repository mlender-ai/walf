import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

// 상태 값은 PRD v0.3 6장(서비스 상태)과 디자인 스펙 7.1을 따른다.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  device_id TEXT UNIQUE NOT NULL,
  platform TEXT,
  push_token TEXT,
  push_permission TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                 -- submitted | needs_info | active | completed | expired | cancelled
  product_name TEXT, brand TEXT, product_url TEXT, photo TEXT, note TEXT,
  size TEXT, color TEXT, max_price INTEGER, used_ok INTEGER NOT NULL DEFAULT 1,
  identified_brand TEXT, identified_name TEXT, identified_note TEXT,
  info_request TEXT,
  activated_at INTEGER, expires_at INTEGER, ended_at INTEGER, end_reason TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sellers(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  domain TEXT                           -- AI 탐색이 검색할 수 있는 유일한 사이트(해외 판매처 제외)
);
CREATE TABLE IF NOT EXISTS search_runs(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  scheduled_for INTEGER NOT NULL, window_end INTEGER NOT NULL,
  status TEXT NOT NULL,                 -- pending | done | missed | cancelled
  outcome TEXT,                         -- no_match | leads | offer | nothing_new
  completed_at INTEGER, operator TEXT, summary TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0,
  UNIQUE(request_id, day)
);
CREATE TABLE IF NOT EXISTS seller_checks(
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES sellers(id),
  status TEXT NOT NULL,                 -- checked | unreachable | skipped
  result TEXT,                          -- none | same | similar
  note TEXT
);
CREATE TABLE IF NOT EXISTS candidates(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  run_id INTEGER,
  source TEXT NOT NULL,                 -- search | report
  seller TEXT NOT NULL, url TEXT, title TEXT, photo TEXT,
  size TEXT, color_ok INTEGER NOT NULL DEFAULT 1,
  price INTEGER, shipping INTEGER NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT 'used', condition_note TEXT,
  match_grade TEXT NOT NULL,            -- same_confirmed | same_likely | similar | unknown
  availability TEXT NOT NULL,           -- purchasable | listed_unverified | option_mismatch | sold_out
  evidence TEXT, pending TEXT,          -- JSON 문자열 배열
  checked_at INTEGER,
  published INTEGER NOT NULL DEFAULT 0, published_at INTEGER,
  user_dismissed INTEGER NOT NULL DEFAULT 0,
  needs_recheck INTEGER NOT NULL DEFAULT 0,  -- 조건 변경으로 운영자 재확인이 필요한 후보
  notified TEXT,                        -- 이미 보낸 알림 종류(lead, offer)
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wanted(
  id INTEGER PRIMARY KEY,
  request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                 -- proposed | approved | declined | withdrawn
  public_fields TEXT,
  proposed_at INTEGER, decided_at INTEGER, withdrawn_at INTEGER,
  is_mock INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wanted_posts(
  id INTEGER PRIMARY KEY,
  wanted_id INTEGER NOT NULL REFERENCES wanted(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,                 -- queued | posted | skipped | rejected | removal_requested | removed | cancelled
  url TEXT, posted_at INTEGER, reason TEXT, updated_at INTEGER,
  is_mock INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activity(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,                  -- walf(자동) | team(운영자) | user | system
  kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT,
  operator TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id INTEGER, candidate_id INTEGER,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, link TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, read_at INTEGER,
  push_status TEXT NOT NULL,            -- no_token | sending | sent | failed | disabled
  push_detail TEXT
);
-- AI 보조(PRD: AI는 후보 식별·검색의 보조 수단, 최종 판단은 왈프 팀). 결과는 운영자가 검수하기 전까지 사용자에게 보이지 않는다.
CREATE TABLE IF NOT EXISTS ai_jobs(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES search_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                   -- identify(상품 식별) | search(국내 판매처 탐색)
  status TEXT NOT NULL,                 -- queued | running | done | failed | cancelled
  provider TEXT NOT NULL,               -- claude | mock
  model TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  summary TEXT, detail TEXT, error TEXT,  -- detail: 판매처별 결과 등(JSON)
  input_tokens INTEGER, output_tokens INTEGER, searches INTEGER,
  requested_by TEXT,                    -- 운영자가 다시 실행했으면 그 이름, 자동이면 NULL
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_identities(
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL, brand TEXT, name TEXT NOT NULL, color TEXT, category TEXT,
  confidence TEXT NOT NULL,             -- high | medium | low
  reasons TEXT, refs TEXT,              -- JSON 문자열 배열
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | accepted | passed
  is_mock INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_finds(
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES search_runs(id) ON DELETE CASCADE,
  seller_id INTEGER REFERENCES sellers(id),
  url TEXT, url_seen INTEGER,           -- 1: 검색·열람 결과에 있던 주소, 0: 없던 주소, NULL: 알 수 없음
  title TEXT, price INTEGER, size TEXT, condition TEXT,
  match_guess TEXT NOT NULL,            -- same_likely | similar | unknown (AI 추정)
  stock_guess TEXT NOT NULL,            -- listed | sold_out | unknown (AI 추정)
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | accepted | rejected
  candidate_id INTEGER, decided_by TEXT, decided_at INTEGER, reject_reason TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_req_user ON requests(user_id, status);
CREATE INDEX IF NOT EXISTS ix_ai_job ON ai_jobs(status, id);
CREATE INDEX IF NOT EXISTS ix_ai_find ON ai_finds(request_id, status);
CREATE INDEX IF NOT EXISTS ix_act_req ON activity(request_id, at);
CREATE INDEX IF NOT EXISTS ix_noti_user ON notifications(user_id, created_at);
`;

// ── V2: 찾아줘(FIND) · 기다려줘(WATCH) ─────────────────────────────
// requests 는 그대로 “찾아줘” 의뢰(7일 수배 정책 유지)다. 아래 표는 그 위에 더한다 — 기존 표·데이터를 지우거나 바꾸지 않는다.
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY,
  canonical_key TEXT NOT NULL,          -- 브랜드|모델(소문자·공백 정리) — 같은 상품을 한 줄로 모은다
  brand TEXT, name TEXT NOT NULL, model_code TEXT, season TEXT, color TEXT, category TEXT,
  url TEXT, image TEXT,
  verified INTEGER NOT NULL DEFAULT 0,  -- 1: 운영자가 확인했거나 상품 페이지에서 직접 읽은 값
  source TEXT NOT NULL,                 -- user | ai | operator | page | backfill
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS product_variants(
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '',  -- 사이즈·색상별로 가격·재고를 따로 본다
  label TEXT,
  UNIQUE(product_id, color, size)
);
-- 찾아줘 결과: AI 제안(ai_identities)을 운영자가 검수해 사용자에게 보여 주는 형태(MATCH · LIKELY · DISCOVER)
CREATE TABLE IF NOT EXISTS product_identities(
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  ai_identity_id INTEGER REFERENCES ai_identities(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id),
  tier TEXT NOT NULL,                   -- match | likely | discover
  rank INTEGER NOT NULL,
  brand TEXT, name TEXT NOT NULL, model_code TEXT, season TEXT, color TEXT, category TEXT,
  matched TEXT, uncertain TEXT, evidence TEXT, reasons TEXT,  -- JSON 배열
  status TEXT NOT NULL,                 -- published | confirmed | rejected | withdrawn
  published_by TEXT, is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, decided_at INTEGER
);
-- 브랜드·스타일 매핑. 출처가 있는 것만 넣고, 운영자가 확인하면 verified
CREATE TABLE IF NOT EXISTS brands(
  id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, aliases TEXT, country TEXT, site TEXT,
  status TEXT NOT NULL                  -- sourced | verified | fixture
);
CREATE TABLE IF NOT EXISTS style_tags(
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,                -- brand | request
  subject_key TEXT NOT NULL,            -- brands.key · requests.id
  scope TEXT NOT NULL DEFAULT '',       -- 브랜드 전체면 '' · 라인·시즌·제품군이면 그 이름(예: Veilance, 2024FW, outerwear)
  kind TEXT NOT NULL,                   -- mood | silhouette | material | detail | category | color
  value TEXT NOT NULL,
  source_url TEXT, basis TEXT,
  status TEXT NOT NULL,                 -- verified(운영자 확인) | sourced(출처 있음·검수 전) | ai(AI가 사진에서 본 것) | fixture(테스트)
  updated_by TEXT, created_at INTEGER NOT NULL,
  UNIQUE(subject, subject_key, scope, kind, value)
);
-- 기다려줘: 이미 아는 옷을 원하는 사이즈·가격이 될 때까지 지켜본다(7일 정책과 다른 생명주기)
CREATE TABLE IF NOT EXISTS watches(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,  -- 찾아줘에서 넘어왔으면 그 의뢰
  status TEXT NOT NULL,                 -- needs_info | active | paused | renew_due | ended
  title TEXT NOT NULL, brand TEXT, url TEXT, photo TEXT,
  size TEXT, color TEXT, target_price INTEGER NOT NULL,
  condition TEXT NOT NULL DEFAULT 'any',  -- new | used | any
  source TEXT,                          -- 가격을 읽을 곳(sources.ts) — 없으면 확인 요청
  info_note TEXT,                       -- 확인이 필요한 이유(사용자에게 보임)
  last_checked_at INTEGER, next_check_at INTEGER, last_state TEXT, last_result TEXT,  -- last_result: 마지막 판정(JSON)
  fail_streak INTEGER NOT NULL DEFAULT 0,
  met_at INTEGER, alert_episode INTEGER NOT NULL DEFAULT 0, alerted INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER, renew_at INTEGER, paused_at INTEGER, ended_at INTEGER, end_reason TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watch_events(
  id INTEGER PRIMARY KEY,
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  actor TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL
);
-- 판매처별 실제 매물(상품 페이지)과 확인 기록. 같은 페이지는 Watch가 여러 개여도 한 줄이다
CREATE TABLE IF NOT EXISTS listings(
  id INTEGER PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  source TEXT NOT NULL, seller TEXT NOT NULL,
  url TEXT NOT NULL, url_key TEXT NOT NULL UNIQUE,
  title TEXT, condition TEXT NOT NULL DEFAULT 'new',
  identity TEXT NOT NULL DEFAULT 'unverified',  -- same_page(사용자·운영자가 준 그 상품 페이지) | same_confirmed(운영자 확인) | unverified
  is_mock INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
-- 하루 한 번 조회 작업. (조회 대상, 시간 창)마다 한 줄 — 서버가 다시 켜져도 같은 날 같은 페이지를 두 번 조회하지 않는다
CREATE TABLE IF NOT EXISTS price_checks(
  id INTEGER PRIMARY KEY,
  target_key TEXT NOT NULL, url TEXT NOT NULL, source TEXT NOT NULL,
  slot TEXT NOT NULL,
  status TEXT NOT NULL,                 -- queued | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, error TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
  UNIQUE(target_key, slot)
);
CREATE TABLE IF NOT EXISTS price_observations(
  id INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  check_id INTEGER REFERENCES price_checks(id) ON DELETE SET NULL,
  target_key TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,                  -- 1 확인함 · 0 확인 실패(error에 사유)
  error TEXT,
  option_label TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '',
  price INTEGER, sale_price INTEGER, shipping INTEGER, shipping_note TEXT,
  stock TEXT,                           -- in_stock | sold_out | unknown
  source TEXT NOT NULL, basis TEXT,     -- 어떤 데이터에서 읽었는지(option_stock_data · json-ld · fixture)
  is_mock INTEGER NOT NULL DEFAULT 0
);
-- 운영 설정(예산 확인 등). 키·비밀번호는 넣지 않는다
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);
CREATE INDEX IF NOT EXISTS ix_product_key ON products(canonical_key);
CREATE INDEX IF NOT EXISTS ix_pid_req ON product_identities(request_id, status);
CREATE INDEX IF NOT EXISTS ix_watch_user ON watches(user_id, status);
CREATE INDEX IF NOT EXISTS ix_watch_due ON watches(status, next_check_at);
CREATE INDEX IF NOT EXISTS ix_obs_target ON price_observations(target_key, checked_at);
CREATE INDEX IF NOT EXISTS ix_check_status ON price_checks(status, id);
CREATE INDEX IF NOT EXISTS ix_style_kind ON style_tags(kind, value);
`;
// ── V2.1: 판매처 탐색(식별과 분리) · 실제 상품 후보 ─────────────────
// AI가 어떤 옷인지 식별한 것(product_identities)과 실제로 판매 중인 상품 페이지를 찾은 것(offers)은 다른 결과다.
// 판매처 탐색은 허용된 데이터 소스만 쓰고, 소스마다 무엇을 했는지(검색함·건너뜀·연동 대기)를 report 에 남긴다.
const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS offer_searches(
  id INTEGER PRIMARY KEY,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  watch_id INTEGER REFERENCES watches(id) ON DELETE CASCADE,  -- 기다려줘 새 매물 탐색(Gate C)
  product_id INTEGER REFERENCES products(id),
  purpose TEXT NOT NULL,                -- find(찾아줘 판매처 탐색) | discovery(기다려줘 새 매물)
  target TEXT NOT NULL,                 -- 탐색 대상(JSON: 브랜드·이름·품번·시즌·색·식별 근거)
  target_basis TEXT NOT NULL,           -- ai_draft(AI 제안·검수 전) | operator_published(운영자 공개) | user_confirmed(사용자 확인)
  search_key TEXT NOT NULL,             -- 같은 대상·같은 소스면 같은 열쇠 — 하루 안에 다시 검색하지 않는다
  status TEXT NOT NULL,                 -- queued | running | done | failed | cancelled
  queries TEXT, report TEXT,            -- JSON: 검색 조건 · 소스별 처리 결과
  summary TEXT, error TEXT,
  reused_from INTEGER, requested_by TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  is_mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
);
-- 실제 상품 후보: 판매처의 상품 페이지 하나. relation=same 은 찾는 옷의 판매처 후보, similar 는 대체 추천(같은 상품이라고 말하지 않는다)
CREATE TABLE IF NOT EXISTS offers(
  id INTEGER PRIMARY KEY,
  search_id INTEGER NOT NULL REFERENCES offer_searches(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  listing_id INTEGER REFERENCES listings(id),
  relation TEXT NOT NULL,               -- same | similar
  rank INTEGER NOT NULL, group_key TEXT,
  source TEXT NOT NULL, seller TEXT NOT NULL, url TEXT NOT NULL, url_key TEXT NOT NULL,
  brand TEXT, name TEXT, model_code TEXT, season TEXT, image_url TEXT,
  price INTEGER, sale_price INTEGER, currency TEXT NOT NULL DEFAULT 'KRW', shipping INTEGER,
  condition TEXT NOT NULL DEFAULT 'unknown',  -- new | used | unknown
  options TEXT,                         -- JSON [{color,size,stock,price}]
  stock TEXT NOT NULL DEFAULT 'unknown',      -- 원하는 사이즈(없으면 페이지 전체) 기준: in_stock | sold_out | unknown
  want_size TEXT NOT NULL DEFAULT 'any',      -- ok | sold_out | missing | unknown | any
  want_color TEXT NOT NULL DEFAULT 'any',     -- ok | other | unknown | any
  verdict TEXT NOT NULL,                -- 자동 판정: same_code | likely | unverified | different (사진 비교 없음)
  checks TEXT,                          -- JSON [{field,result,text}] — 일치·불일치·확인 못 함 근거
  similar_points TEXT, diff_points TEXT,  -- JSON — 원래 옷과 비슷한 점·다른 점
  recommender TEXT NOT NULL, recommender_version TEXT NOT NULL, score REAL,
  detail TEXT NOT NULL,                 -- fetched(상품 페이지를 읽음) | listed_only(검색 결과만) | failed
  detail_note TEXT, queries TEXT, fetched_at INTEGER,
  review_state TEXT NOT NULL DEFAULT 'pending',  -- pending | approved(publish_tier 로 공개) | rejected (운영자 검수)
  reviewed_by TEXT, reviewed_at INTEGER, review_note TEXT,
  is_mock INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_osearch_req ON offer_searches(request_id, id);
CREATE INDEX IF NOT EXISTS ix_osearch_status ON offer_searches(status, id);
CREATE INDEX IF NOT EXISTS ix_osearch_key ON offer_searches(search_key, finished_at);
CREATE INDEX IF NOT EXISTS ix_offer_search ON offers(search_id, rank);
`;
export const SCHEMA_VERSION = 3;

export const SELLERS: [string, string, string][] = [
  ['무신사', 'new', 'musinsa.com'], ['29CM', 'new', '29cm.co.kr'], ['W컨셉', 'new', 'wconcept.co.kr'],
  ['번개장터', 'used', 'bunjang.co.kr'], ['중고나라', 'used', 'joongna.com'], ['후루츠패밀리', 'used', 'fruitsfamily.com'],
];
export const WANTED_CHANNELS = ['번개장터', '중고나라', '후루츠패밀리'];

export type OpenOpts = { backupDir?: string; log?: (s: string) => void };

/** 열 때마다 스키마를 맞춘다. 파일 DB를 V2로 처음 올릴 때는 바꾸기 전에 사본을 남긴다(VACUUM INTO). */
export function openDb(file: string, opts: OpenOpts = {}): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  const version = (db.prepare('PRAGMA user_version').get() as any).user_version as number;
  const hadData = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='requests'`).get();
  if (file !== ':memory:' && hadData && version < SCHEMA_VERSION && opts.backupDir) {
    fs.mkdirSync(opts.backupDir, { recursive: true });
    const to = path.join(opts.backupDir, `walf-v${version}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
    opts.log?.(`DB 스키마 v${version} → v${SCHEMA_VERSION}: 바꾸기 전 사본 ${to}`);
  }
  db.exec(SCHEMA);
  // 이전 스키마로 만든 DB에 없는 컬럼만 더한다
  const add = (t: string, col: string, def: string) => {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`);
  };
  add('candidates', 'needs_recheck', 'INTEGER NOT NULL DEFAULT 0');
  add('wanted', 'is_mock', 'INTEGER NOT NULL DEFAULT 0');
  add('users', 'deleted_at', 'INTEGER');
  add('sellers', 'domain', 'TEXT');
  const ins = db.prepare('INSERT OR IGNORE INTO sellers(name, kind, sort) VALUES (?, ?, ?)');
  const dom = db.prepare('UPDATE sellers SET domain=? WHERE name=? AND domain IS NULL');
  SELLERS.forEach(([n, k, d], i) => { ins.run(n, k, i); dom.run(d, n); });
  // V2 — 새 표와 기존 표의 새 컬럼
  db.exec(SCHEMA_V2);
  add('requests', 'product_id', 'INTEGER REFERENCES products(id)');
  add('notifications', 'watch_id', 'INTEGER');
  add('notifications', 'dedupe_key', 'TEXT');
  add('ai_jobs', 'est_cost_usd', 'REAL');
  add('ai_jobs', 'dedupe_key', 'TEXT');
  add('ai_jobs', 'reused_from', 'INTEGER');
  add('ai_identities', 'season', 'TEXT');
  add('ai_identities', 'model_code', 'TEXT');
  add('ai_identities', 'matched', 'TEXT');
  add('ai_identities', 'uncertain', 'TEXT');
  // PR #1 리뷰 반영
  add('watches', 'price_basis', `TEXT NOT NULL DEFAULT 'total'`);   // total(상품가+배송비) | item(사용자가 “배송비 제외”를 고름)
  add('watches', 'page_identity', `TEXT NOT NULL DEFAULT 'pending'`); // 이 상품 페이지가 등록한 옷인지: pending | page_defined | matched | operator_confirmed | unverified | mismatch
  add('watches', 'identity_note', 'TEXT');
  add('listings', 'shipping_fee', 'INTEGER');  // 운영자가 확인한 배송비(페이지에 없을 때)
  add('listings', 'shipping_by', 'TEXT');
  add('listings', 'shipping_at', 'INTEGER');
  add('product_identities', 'verify_reason', 'TEXT'); // 운영자가 MATCH로 올린 근거(서버 판정이 MATCH가 아니거나 이름을 고쳤을 때 필수)
  add('product_identities', 'verify_url', 'TEXT');
  // 같은 알림을 두 번 만들지 않는다(서버 재시작·동시 실행에도) — 열쇠가 있는 알림만
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_noti_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL');
  // V2.1 — 새 표만 더한다(기존 데이터는 그대로)
  db.exec(SCHEMA_V3);
  // Gate B — 대체 상품의 디자인 요소와 사용자 공개(운영자 검수 후에만)
  add('offers', 'style', 'TEXT');                 // 이 상품의 디자인 요소(통제 어휘 JSON) — 대체 상품 정렬·비슷한 점/다른 점
  add('offers', 'publish_tier', 'TEXT');          // exact(같은 상품 확인) | possible(같은 상품일 수 있음) | alternative(비슷한 디자인)
  add('offers', 'published', 'INTEGER NOT NULL DEFAULT 0');
  add('offers', 'published_at', 'INTEGER');
  // Gate C — 기다려줘 새 매물 탐색(Listing Discovery)·대체 상품. 상품 페이지 가격 감시(price_checks)와 따로 돈다
  add('offers', 'watch_id', 'INTEGER');
  // Gate D — 기기 세션 토큰(서버가 발급, 해시만 저장). 기기 ID만 알아서는 그 사용자로 요청할 수 없다
  add('users', 'token_hash', 'TEXT');
  add('users', 'token_at', 'INTEGER');
  // 리뷰 후속 — 토큰 발급 전 계정은 기기 ID만으로 열지 않는다. 운영자가 만든 일회용 이어받기 코드(해시·만료)로만 이어받는다
  add('users', 'claim_hash', 'TEXT');
  add('users', 'claim_until', 'INTEGER');
  // 리뷰 후속 — 확정 전 식별 후보를 함께 찾는 판매처 탐색(최대 3개). 매물마다 어느 후보 기준으로 검증했는지 남긴다
  add('offer_searches', 'targets', 'TEXT');
  add('offers', 'target_ref', 'TEXT');
  add('offers', 'target_rank', 'INTEGER');
  // Gate D — 사용자 선호(무엇이 중요한지)·추천 피드백·운영자 검수 기록(추천 엔진 평가 데이터)
  add('requests', 'priority', 'TEXT');   // silhouette | material_detail | brand_archive | vibe | NULL(고르지 않음)
  add('watches', 'priority', 'TEXT');
  add('offer_searches', 'ranker', 'TEXT'); // 대체 상품 정렬 규칙과 그때의 선호(예: walf-design-rank-1:silhouette)
  db.exec(`CREATE TABLE IF NOT EXISTS offer_signals(
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,          -- 직접 평가: like | not_quite | not_interested | cleared · 행동 기록: open | save | unsave
    explicit INTEGER NOT NULL,   -- 1 직접 평가 · 0 행동 기록(열어 보기·저장은 만족으로 치지 않는다)
    context TEXT NOT NULL,       -- find | watch
    request_id INTEGER, watch_id INTEGER, product_id INTEGER,
    offer_url_key TEXT, offer_brand TEXT, offer_name TEXT, relation TEXT, publish_tier TEXT,
    recommender TEXT, recommender_version TEXT, ranker TEXT, rank INTEGER, score REAL, priority TEXT,
    is_mock INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_signal_offer ON offer_signals(user_id, offer_id, id)');
  db.exec(`CREATE TABLE IF NOT EXISTS review_log(
    id INTEGER PRIMARY KEY, at INTEGER NOT NULL, operator TEXT NOT NULL,
    subject TEXT NOT NULL,       -- identity | discover | offer | watch_page | watch_url | shipping
    subject_id INTEGER, request_id INTEGER, watch_id INTEGER,
    action TEXT NOT NULL,        -- 운영자가 한 일(예: match · likely · skip · exact · possible · alternative · reject · hide · page_same · page_diff · attach · shipping)
    auto TEXT,                   -- 그때 자동 판정(JSON: 서버 등급·판정·점수·추천 모델·버전·순위·근거)
    before TEXT, after TEXT,     -- 운영자가 바꾼 값(JSON)
    reason TEXT, is_mock INTEGER NOT NULL DEFAULT 0)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_review_req ON review_log(request_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_review_watch ON review_log(watch_id, id)');                           // 기다려줘에서 찾은 후보면 그 Watch(찾아줘면 request_id)
  add('watches', 'discovery', 'INTEGER NOT NULL DEFAULT 1');      // 같은 상품을 파는 다른 판매처·새 매물도 찾아볼지(사용자 설정)
  add('watches', 'discovery_sources', 'TEXT');                    // 사용자가 고른 탐색 소스(JSON 배열) · 없으면 쓸 수 있는 곳 전부
  add('watches', 'next_discovery_at', 'INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS offer_saves(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, UNIQUE(user_id, offer_id))`);  // 사용자가 저장한 대체 상품(저장해도 기다려줘는 계속된다)
  db.exec('CREATE INDEX IF NOT EXISTS ix_offer_watch ON offers(watch_id, url_key)');
  // Discovery Gate 4 — 가격 통화(원화가 아니면 환율 확인 전에는 원하는 가격과 비교하지 않는다) · 환율(출처·기준 시각) · 판매 예정 일정
  add('price_observations', 'currency', 'TEXT');                  // NULL = 이 열을 넣기 전 기록(모두 국내 원화 페이지)
  db.exec(`CREATE TABLE IF NOT EXISTS fx_rates(
    id INTEGER PRIMARY KEY, currency TEXT NOT NULL, krw_per_unit REAL NOT NULL,   -- 외화 1단위가 몇 원인지(엔화 100엔 고시는 1엔으로 나눠 저장)
    source TEXT NOT NULL, observed_at INTEGER NOT NULL, entered_by TEXT, is_mock INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_fx_cur ON fx_rates(currency, observed_at)');
  db.exec(`CREATE TABLE IF NOT EXISTS release_schedules(
    id INTEGER PRIMARY KEY, watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE, product_id INTEGER REFERENCES products(id),
    seller TEXT NOT NULL, url TEXT, starts_at INTEGER NOT NULL,
    announced_url TEXT NOT NULL,  -- 판매처·브랜드의 공식 발표(일정 근거). 추측한 일정은 넣지 않는다
    note TEXT, status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | started | cancelled
    notified_at INTEGER, started_at INTEGER, created_by TEXT NOT NULL, is_mock INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_release_due ON release_schedules(status, starts_at)');
  if (version < 2) backfillProducts(db);
  if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
  return db;
}

/** V1 의뢰마다 상품 한 줄을 만든다. 운영자가 확인(7일 시작)한 이름만 verified. 원래 의뢰 값은 그대로 둔다. */
function backfillProducts(db: DB) {
  const rows = db.prepare('SELECT * FROM requests WHERE product_id IS NULL AND COALESCE(identified_name, product_name) IS NOT NULL').all() as any[];
  if (!rows.length) return;
  tx(db, () => {
    for (const r of rows) {
      const verified = r.identified_name ? 1 : 0;
      const brand = (verified ? r.identified_brand : null) || r.brand || null;
      const name = verified ? r.identified_name : r.product_name;
      const key = productKey(brand, name);
      const t = Date.now();
      const p = db.prepare('SELECT id FROM products WHERE canonical_key=? AND is_mock=? ORDER BY verified DESC, id LIMIT 1').get(key, r.is_mock) as any;
      const pid = p ? p.id : Number(db.prepare(`INSERT INTO products(canonical_key, brand, name, color, url, verified, source, is_mock, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(key, brand, name, r.color || null, r.product_url || null, verified, 'backfill', r.is_mock, t, t).lastInsertRowid);
      db.prepare('UPDATE requests SET product_id=? WHERE id=?').run(pid, r.id);
    }
  });
}

/**
 * 같은 상품인지 비교할 열쇠. 상품(Product) = 브랜드 + 모델명 + (알면) 품번 + (알면) 시즌. 색상·사이즈는 상품이 아니라 변형(product_variants)이다.
 * 품번·시즌을 아는 상품은 이름이 같아도 품번·시즌이 다르면 다른 줄, 이름만 아는 상품과도 합치지 않는다(다른 시즌·품번이 섞이지 않게).
 */
export function productKey(brand: string | null | undefined, name: string | null | undefined, code?: string | null, season?: string | null) {
  const n = (s: string | null | undefined) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const b = n(brand), m = n(name), c = n(code).replace(/\s+/g, ''), s = n(season).replace(/\s+/g, '');
  return `${b}|${b && m.startsWith(b + ' ') ? m.slice(b.length + 1) : m}${c ? `#${c}` : ''}${s ? `@${s}` : ''}`;
}

export function getSetting(db: DB, key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any)?.value ?? null;
}
export function setSetting(db: DB, key: string, value: string, by: string | null, t = Date.now()) {
  db.prepare('INSERT INTO settings(key, value, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by').run(key, value, t, by);
}

/** 이미 트랜잭션 안이면 바깥 트랜잭션에 합류한다(실패하면 바깥까지 함께 되돌린다) */
export function tx<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
