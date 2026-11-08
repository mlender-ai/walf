import { DatabaseSync } from 'node:sqlite';

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

export const SELLERS: [string, string, string][] = [
  ['무신사', 'new', 'musinsa.com'], ['29CM', 'new', '29cm.co.kr'], ['W컨셉', 'new', 'wconcept.co.kr'],
  ['번개장터', 'used', 'bunjang.co.kr'], ['중고나라', 'used', 'joongna.com'], ['후루츠패밀리', 'used', 'fruitsfamily.com'],
];
export const WANTED_CHANNELS = ['번개장터', '중고나라', '후루츠패밀리'];

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
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
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
