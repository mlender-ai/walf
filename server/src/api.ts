import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import * as F from './find.ts';
import * as W from './watch.ts';
import { SOURCES } from './sources.ts';

type Cfg = { uploads: string; pushConfigured: boolean; policy: W.WatchPolicy; rate?: { writes: number; windowMs: number } };

/** 사용자(기기)별 쓰기 요청 제한 — 메모리 고정 창. 서버 한 대 기준(여러 대면 공용 저장소로 옮겨야 함) */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string, t = Date.now()) => {
    const h = hits.get(key);
    if (!h || h.until <= t) { hits.set(key, { n: 1, until: t + windowMs }); if (hits.size > 5000) for (const [k, v] of hits) if (v.until <= t) hits.delete(k); return true; }
    h.n += 1;
    return h.n <= max;
  };
}
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/heic-sequence': '.heic', 'image/heif-sequence': '.heif' };
// 기기가 형식을 못 정해 보낸 경우(octet-stream 등)는 파일 이름 확장자로 판단한다
const BY_NAME: Record<string, string> = { jpg: '.jpg', jpeg: '.jpg', png: '.png', webp: '.webp', heic: '.heic', heif: '.heif' };
const extOf = (f: Express.Multer.File) => EXT[f.mimetype] || BY_NAME[(f.originalname.split('.').pop() || '').toLowerCase()];

export function uploader(dir: string) {
  return multer({
    storage: multer.diskStorage({ destination: dir, filename: (_q, f, cb) => cb(null, crypto.randomUUID() + (extOf(f) || '.jpg')) }),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (_q, f, cb) => extOf(f) ? cb(null, true) : cb(new HttpError(400, 'bad_image', `JPG·PNG·WEBP·HEIC 사진만 올릴 수 있어요. (받은 형식: ${f.mimetype})`)),
  });
}
export const baseOf = (req: express.Request) => `${req.protocol}://${req.get('host')}`;
const removeUpload = (dir: string, f?: Express.Multer.File) => { if (f) fs.rm(path.join(dir, f.filename), () => {}); };

export function userApi(db: DB, cfg: Cfg) {
  const r = express.Router();
  const up = uploader(cfg.uploads);
  r.use(express.json({ limit: '100kb' }));

  const auth: express.RequestHandler = (req, res, next) => {
    const dev = req.get('x-walf-device');
    const u = dev ? D.userByDevice(db, dev) : undefined;
    if (!u || u.deleted_at) return res.status(401).json({ error: 'no_session', message: '세션이 없어요. 앱을 다시 열어 주세요.' });
    (req as any).user = u; next();
  };
  const uid = (req: express.Request) => (req as any).user.id as number;
  const idp = (v: string) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not_found'); return n; };
  // 쓰기 요청(등록·변경)은 사용자마다 시간당 횟수를 제한한다 — 업로드·외부 조회·AI 작업을 부르는 길이라서
  const allow = rateLimiter(cfg.rate?.writes ?? 60, cfg.rate?.windowMs ?? 10 * 60_000);
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.path === '/session' || req.path === '/client-log') return next();
    const dev = req.get('x-walf-device') || req.ip || 'x';
    if (!allow(dev)) return res.status(429).json({ error: 'rate_limited', message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' });
    next();
  });

  r.get('/health', (_q, res) => res.json({ ok: true, service: 'walf', pushConfigured: cfg.pushConfigured }));

  // 앱이 보낸 실패 한 줄(QA용) — 서버 로그에만 남긴다
  r.post('/client-log', (req, res) => {
    const b = req.body || {}; const s = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300);
    console.log(`  ⚠ 앱 실패 [${s(b.where)}] ${s(b.status)} ${s(b.code)} ${s(b.message)}${b.detail ? ' · ' + s(b.detail) : ''}${b.photo ? ' · 사진 ' + s(b.photo) : ''}`);
    res.json({ ok: true });
  });

  r.post('/session', (req, res) => {
    const u = D.upsertUser(db, String(req.body?.deviceId || ''), String(req.body?.platform || ''));
    res.json({ userId: u.id });
  });

  r.get('/me', auth, (req, res) => {
    const base = baseOf(req);
    const open = D.openRequestOf(db, uid(req));
    const past = db.prepare(`SELECT * FROM requests WHERE user_id=? AND status NOT IN ('submitted','needs_info','active') ORDER BY id DESC LIMIT 20`).all(uid(req)) as any[];
    const unread = (db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(uid(req)) as any).n;
    const u = (req as any).user;
    const mine = W.myItems(db, uid(req), base, cfg.policy);
    res.json({
      user: { id: u.id, pushToken: !!u.push_token, pushPermission: u.push_permission || null, createdAt: u.created_at },
      active: open ? D.requestView(db, open, base) : null,
      past: past.map(p => ({ id: p.id, status: p.status, title: D.shortName(p), brand: p.identified_brand || p.brand, isMock: !!p.is_mock,
        display: D.display(db, p), endedAt: p.ended_at, photoUrl: p.photo ? `${base}/uploads/${p.photo}` : null })),
      items: mine.items, watchLimit: mine.watchLimit,
      unread, pushConfigured: cfg.pushConfigured,
    });
  });

  // ── V2 · 내가 찾는 옷 · 찾아줘 결과 · 기다려줘 ─────────────────
  r.get('/items', auth, (req, res) => res.json(W.myItems(db, uid(req), baseOf(req), cfg.policy)));
  r.get('/sources', auth, (_q, res) => res.json(SOURCES.filter(s => s.status !== 'TEST_ONLY').map(s => ({ id: s.id, label: s.label, kind: s.kind, status: s.status, reason: s.reason, checked: s.checked }))));

  r.get('/requests/:id/find', auth, (req, res) => res.json(F.findView(db, D.ownRequest(db, uid(req), idp(req.params.id)))));
  r.post('/requests/:id/find/confirm', auth, (req, res) => {
    const id = idp(req.params.id), next = req.body?.next;
    if (!['hunt', 'watch', 'save'].includes(next)) throw new HttpError(400, 'bad_next');
    const out = F.confirmFind(db, uid(req), id, Number(req.body?.identityId), next);
    res.json({ ...out, find: F.findView(db, D.getRequest(db, id)), request: D.requestView(db, D.getRequest(db, id), baseOf(req)) });
  });
  r.post('/requests/:id/find/reject', auth, (req, res) => {
    const id = idp(req.params.id);
    F.rejectFind(db, uid(req), id, req.body?.reason);
    res.json(F.findView(db, D.getRequest(db, id)));
  });

  const watchOut = (req: express.Request, id: number) => W.watchView(db, W.ownWatch(db, uid(req), id), baseOf(req), cfg.policy);
  r.post('/watches', auth, up.single('photo'), (req, res) => {
    try {
      const b = req.body || {};
      const id = W.createWatch(db, uid(req), { productName: b.productName, productUrl: b.productUrl, brand: b.brand, size: b.size, color: b.color, targetPrice: b.targetPrice,
        condition: b.condition, priceBasis: b.priceBasis, photo: req.file?.filename || null, productId: b.productId ? Number(b.productId) : null, requestId: b.requestId ? Number(b.requestId) : null }, cfg.policy);
      res.status(201).json(watchOut(req, id));
    } catch (e) { removeUpload(cfg.uploads, req.file); throw e; }
  });
  r.get('/watches/:id', auth, (req, res) => res.json(watchOut(req, idp(req.params.id))));
  r.patch('/watches/:id', auth, (req, res) => {
    const id = idp(req.params.id);
    W.updateWatch(db, uid(req), id, req.body || {}, cfg.policy);
    res.json(watchOut(req, id));
  });
  r.post('/watches/:id/:action', auth, (req, res) => {
    const id = idp(req.params.id), a = req.params.action;
    if (!['pause', 'resume', 'end', 'renew'].includes(a)) throw new HttpError(404, 'not_found');
    W.setWatchState(db, uid(req), id, a as any, cfg.policy);
    res.json(watchOut(req, id));
  });

  r.post('/requests', auth, up.single('photo'), (req, res) => {
    try {
      const b = req.body || {};
      const id = D.createRequest(db, uid(req), {
        productName: b.productName, brand: b.brand, productUrl: b.productUrl, note: b.note, photo: req.file?.filename || null,
        size: b.size, color: b.color, maxPrice: b.maxPrice, usedOk: b.usedOk,
      });
      res.status(201).json(D.requestView(db, D.getRequest(db, id), baseOf(req)));
    } catch (e) { removeUpload(cfg.uploads, req.file); throw e; }
  });

  r.get('/requests/:id', auth, (req, res) => res.json(D.requestView(db, D.ownRequest(db, uid(req), idp(req.params.id)), baseOf(req))));

  r.patch('/requests/:id/conditions', auth, (req, res) => {
    const id = idp(req.params.id);
    D.updateConditions(db, uid(req), id, req.body || {});
    res.json(D.requestView(db, D.getRequest(db, id), baseOf(req)));
  });

  r.post('/requests/:id/info', auth, up.single('photo'), (req, res) => {
    const id = idp(req.params.id);
    const old = D.ownRequest(db, uid(req), id).photo as string | null;
    try { D.submitInfo(db, uid(req), id, { text: req.body?.text, productUrl: req.body?.productUrl, photo: req.file?.filename || null }); }
    catch (e) { removeUpload(cfg.uploads, req.file); throw e; }
    if (req.file && old) fs.rm(path.join(cfg.uploads, old), () => {}); // 바뀐 사진의 이전 파일은 지운다
    res.json(D.requestView(db, D.getRequest(db, id), baseOf(req)));
  });

  r.post('/requests/:id/wanted', auth, (req, res) => {
    const id = idp(req.params.id), dec = req.body?.decision;
    if (dec !== 'approve' && dec !== 'decline') throw new HttpError(400, 'bad_decision');
    D.decideWanted(db, uid(req), id, dec === 'approve', req.body?.fields);
    res.json(D.requestView(db, D.getRequest(db, id), baseOf(req)));
  });
  r.post('/requests/:id/wanted/withdraw', auth, (req, res) => {
    const id = idp(req.params.id);
    D.ownRequest(db, uid(req), id);
    D.withdrawWanted(db, uid(req), id);
    res.json(D.requestView(db, D.getRequest(db, id), baseOf(req)));
  });
  r.post('/requests/:id/purchase', auth, (req, res) => {
    const id = idp(req.params.id);
    D.confirmPurchase(db, uid(req), id, req.body?.candidateId ? Number(req.body.candidateId) : null);
    res.json(D.requestView(db, D.getRequest(db, id), baseOf(req)));
  });
  r.post('/requests/:id/cancel', auth, (req, res) => {
    const id = idp(req.params.id);
    D.cancelRequest(db, uid(req), id);
    res.json(D.requestView(db, D.getRequest(db, id), baseOf(req)));
  });

  r.get('/candidates/:id', auth, (req, res) => {
    const c = db.prepare('SELECT * FROM candidates WHERE id=? AND published=1').get(idp(req.params.id)) as any;
    if (!c) throw new HttpError(404, 'not_found');
    const rq = D.ownRequest(db, uid(req), c.request_id);
    res.json({ candidate: D.candidateView(db, rq, c, baseOf(req)), request: { id: rq.id, status: rq.status, title: D.shortName(rq), brand: rq.identified_brand || rq.brand, isMock: !!rq.is_mock } });
  });
  r.post('/candidates/:id/dismiss', auth, (req, res) => { D.dismissCandidate(db, uid(req), idp(req.params.id)); res.json({ ok: true }); });

  r.get('/alerts', auth, (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 100').all(uid(req)) as any[];
    res.json(rows.map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: !!n.read_at, createdAt: n.created_at, isMock: !!n.is_mock, push: n.push_status })));
  });
  r.post('/alerts/read', auth, (req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (ids.length) { const st = db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND id=? AND read_at IS NULL'); ids.forEach(i => st.run(Date.now(), uid(req), i)); }
    else db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(Date.now(), uid(req));
    res.json({ ok: true });
  });
  r.post('/push-token', auth, (req, res) => {
    const token = req.body?.token ? String(req.body.token).slice(0, 200) : null;
    db.prepare('UPDATE users SET push_token=?, push_permission=? WHERE id=?').run(token, String(req.body?.permission || 'unknown').slice(0, 20), uid(req));
    res.json({ ok: true });
  });
  r.delete('/me', auth, (req, res) => {
    D.deleteUser(db, uid(req)).forEach(f => fs.rm(path.join(cfg.uploads, f), () => {}));
    res.json({ ok: true });
  });
  return r;
}

export const apiErrors: express.ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) { console.log(`  ↳ ${err.status} ${err.code} ${err.message !== err.code ? err.message : ''}`); return res.status(err.status).json({ error: err.code, message: err.message !== err.code ? err.message : undefined }); }
  if (err?.code) console.log(`  ↳ ${err.code} ${err.message || ''}`);
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'too_large', message: '사진은 15MB 이하로 올려 주세요.' });
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') return res.status(400).json({ error: 'bad_body', message: '요청 형식이 올바르지 않아요.' });
  console.error(err);
  res.status(500).json({ error: 'server_error', message: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
};
