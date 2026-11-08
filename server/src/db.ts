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
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
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
CREATE INDEX IF NOT EXISTS ix_req_user ON requests(user_id, status);
CREATE INDEX IF NOT EXISTS ix_act_req ON activity(request_id, at);
CREATE INDEX IF NOT EXISTS ix_noti_user ON notifications(user_id, created_at);
`;

export const SELLERS: [string, string][] = [
  ['무신사', 'new'], ['29CM', 'new'], ['W컨셉', 'new'],
  ['번개장터', 'used'], ['중고나라', 'used'], ['후루츠패밀리', 'used'],
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
  const ins = db.prepare('INSERT OR IGNORE INTO sellers(name, kind, sort) VALUES (?, ?, ?)');
  SELLERS.forEach(([n, k], i) => ins.run(n, k, i));
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
