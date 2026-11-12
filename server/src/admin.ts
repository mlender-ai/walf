import express from 'express';
import crypto from 'node:crypto';
import type { DB } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { uploader, baseOf } from './api.ts';
import { now, kDate, kTime, kWhen, HOUR, DAY } from './time.ts';
import type { AiProvider } from './ai.ts';
import * as A from './aijobs.ts';
import * as F from './find.ts';
import * as W from './watch.ts';
import * as C from './cost.ts';
import { STYLE_LABEL, styleLabel } from './catalog.ts';
import { SOURCES } from './sources.ts';

type Cfg = { uploads: string; password: string; secret: string; qaTools: boolean; ai?: AiProvider | null; limits?: C.Limits; policy?: W.WatchPolicy; checker?: { step: (t?: number) => Promise<number | null> } };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const MOCK = '<span class="mk">모의</span>';

const CSS = `
:root{--b:#111;--cv:#F7F7F7;--sf:#F1F1F1;--g5:#767676;--g3:#D9D9D9}
*{box-sizing:border-box}body{margin:0;font:14px/1.55 "Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",sans-serif;color:#111;background:#fff;letter-spacing:-.01em;word-break:keep-all}
a{color:inherit}header.t{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--g3);display:flex;align-items:center;gap:20px;padding:0 28px;height:56px}
header.t b{font-size:20px;font-weight:900;letter-spacing:-.05em}header.t nav{display:flex;gap:4px}header.t nav a{text-decoration:none;padding:6px 12px;border-radius:99px;font-weight:600}
header.t nav a.on{background:#111;color:#fff}header.t .sp{flex:1}header.t small{color:var(--g5)}
main{max-width:1240px;margin:0 auto;padding:28px}h1{font-size:26px;letter-spacing:-.04em;margin:0 0 4px}h2{font-size:18px;letter-spacing:-.03em;margin:0 0 12px}
h3{font-size:15px;margin:0 0 8px}.sub{color:var(--g5)}section{border:1px solid var(--g3);border-radius:14px;padding:20px 22px;margin-top:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--sf);vertical-align:top}th{font-size:12px;color:var(--g5);font-weight:700}
.tg{display:inline-flex;align-items:center;height:22px;padding:0 7px;border-radius:4px;font-size:11.5px;font-weight:700;white-space:nowrap}
.tg.v{background:#111;color:#fff}.tg.o{box-shadow:inset 0 0 0 1.2px #111}.tg.p{border:1.2px dashed var(--g5);color:#4d4d4d}.tg.x{background:var(--sf)}
.mk{display:inline-block;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:2px 6px;border-radius:4px;border:1px dashed #111;margin-left:6px;vertical-align:middle}
.st{display:inline-block;padding:3px 9px;border-radius:99px;background:var(--sf);font-weight:700;font-size:12.5px}
.btn{appearance:none;border:0;background:#111;color:#fff;font:700 14px inherit;font-family:inherit;padding:0 16px;height:40px;border-radius:10px;cursor:pointer}
.btn.s{background:#fff;color:#111;box-shadow:inset 0 0 0 1px var(--g3)}.btn.sm{height:32px;padding:0 12px;font-size:13px;border-radius:8px}
input[type=text],input[type=url],input[type=number],input[type=password],input[type=datetime-local],select,textarea{font:inherit;padding:8px 10px;border:1px solid var(--g3);border-radius:8px;width:100%;background:#fff}
textarea{min-height:64px}label{display:block;font-size:12.5px;font-weight:700;margin:10px 0 4px}label.in{display:inline-flex;gap:6px;align-items:center;font-weight:600;margin:0 12px 0 0}
.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.row>*{flex:1}.kv{display:grid;grid-template-columns:120px 1fr;gap:6px 12px}.kv dt{color:var(--g5)}.kv dd{margin:0;font-weight:600}
.app{border:1px solid #111;border-radius:14px;padding:16px 18px;background:#fff}.app small{color:var(--g5);font-weight:600}.app b{display:block;font-size:19px;letter-spacing:-.035em;margin:4px 0}
.ph{width:120px;height:120px;border-radius:10px;background:var(--cv) center/cover no-repeat;flex:none}.empty{color:var(--g5);padding:14px 0}
.flash{padding:12px 16px;border-radius:10px;background:#111;color:#fff;margin-bottom:12px}.err{background:#fff;color:#111;box-shadow:inset 0 0 0 2px #111}
.q{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--sf)}.q:last-child{border:0}
.n{font-size:30px;font-weight:800;letter-spacing:-.04em}.log li{display:grid;grid-template-columns:150px 70px 1fr;gap:10px;padding:7px 0;border-bottom:1px solid var(--sf)}
ul{list-style:none;margin:0;padding:0}details summary{cursor:pointer;font-weight:700;padding:6px 0}.warn{border:2px dashed #111}
:focus-visible{outline:2px solid #111;outline-offset:2px}
.ai{border:1.5px solid #111;border-radius:12px;padding:14px 16px;margin:10px 0;background:var(--cv)}.ai h3 .sub{font-weight:600}
.ai .id{background:#fff;border:1px solid var(--g3);border-radius:10px;padding:12px 14px;margin:10px 0}.ai .id ul{list-style:disc;padding-left:18px;margin:6px 0}
.ai .id ul li{margin:2px 0}.tg.aip{border:1.2px dashed #111;background:#fff}.fd{border-top:1px solid var(--g3);padding:12px 0}.fd:first-of-type{border-top:0}
.aibar{display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:10px;background:var(--sf);margin-bottom:14px}
`;
const FONT = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">';

function page(title: string, body: string, op?: string, tab = '') {
  const nav = op ? `<nav><a href="/admin" class="${tab === 'home' ? 'on' : ''}">대기열</a><a href="/admin/requests" class="${tab === 'list' ? 'on' : ''}">찾아줘 의뢰</a><a href="/admin/watches" class="${tab === 'watch' ? 'on' : ''}">기다려줘</a><a href="/admin/costs" class="${tab === 'cost' ? 'on' : ''}">비용</a><a href="/admin/styles" class="${tab === 'style' ? 'on' : ''}">스타일 매핑</a></nav><span class="sp"></span><small>운영자 ${esc(op)}</small><form method="post" action="/admin/logout"><button class="btn s sm">로그아웃</button></form>` : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · WALF OPS</title>${FONT}<style>${CSS}</style></head>
<body><header class="t"><b>WALF.</b><small>OPS</small>${nav}</header><main>${body}</main></body></html>`;
}

export function adminRouter(db: DB, cfg: Cfg) {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '200kb' }));
  const up = uploader(cfg.uploads);

  const sign = (op: string, exp: number) => crypto.createHmac('sha256', cfg.secret).update(`${op}|${exp}`).digest('base64url');
  const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return ''; } };
  const cookieOf = (req: express.Request) => Object.fromEntries((req.get('cookie') || '').split(';').map(s => { const i = s.indexOf('='); return [s.slice(0, i).trim(), dec(s.slice(i + 1).trim())]; }).filter(p => p[0]));
  const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
  const csrfOf = (req: express.Request) => crypto.createHmac('sha256', cfg.secret).update('csrf|' + (cookieOf(req).walf_ops || '')).digest('base64url').slice(0, 32);
  const fails = new Map<string, { n: number; until: number }>();
  /** 로그인한 화면의 POST 폼마다 CSRF 토큰을 주소에 붙인다(멀티파트 폼도 본문 파싱 전에 검사할 수 있게) */
  const send = (req: express.Request, res: express.Response, html: string) => res.send(html.replace(/action="(\/admin\/[^"?]+)"/g, (_m, a) => a === '/admin/login' ? _m : `action="${a}?_csrf=${csrfOf(req)}"`));
  const opOf = (req: express.Request) => {
    const v = cookieOf(req).walf_ops; if (!v) return null;
    const [op, exp, sig] = v.split('|'); if (!op || !exp || !sig || Number(exp) < Date.now()) return null;
    const ok = crypto.timingSafeEqual(digest(sig), digest(sign(op, Number(exp))));
    return ok ? op : null;
  };

  r.get('/login', (_q, res) => res.send(page('로그인', `<section style="max-width:420px;margin:60px auto"><h1>운영자 로그인</h1><p class="sub">운영자 이름은 활동 기록에 남아요.</p>
    <form method="post" action="/admin/login"><label for="op">운영자 이름</label><input id="op" type="text" name="op" required maxlength="20" autocomplete="nickname">
    <label for="pw">비밀번호</label><input id="pw" type="password" name="pw" required autocomplete="current-password"><p><button class="btn">로그인</button></p></form></section>`)));
  r.post('/login', (req, res) => {
    const ip = req.ip || 'x', f = fails.get(ip);
    if (f && f.n >= 10 && f.until > Date.now()) return res.status(429).send(page('로그인', '<section style="max-width:420px;margin:60px auto"><div class="flash err">로그인 시도가 많아요. 10분 뒤에 다시 시도하세요.</div></section>'));
    const op = String(req.body.op || '').trim().slice(0, 20).replace(/[|;=,]/g, '');
    const pw = String(req.body.pw || '');
    const ok = !!op && crypto.timingSafeEqual(digest(pw), digest(cfg.password));
    if (!ok) fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60_000 }); else fails.delete(ip);
    if (!ok) return res.status(401).send(page('로그인', `<section style="max-width:420px;margin:60px auto"><div class="flash err">이름 또는 비밀번호가 맞지 않아요.</div><a href="/admin/login">다시 시도</a></section>`));
    const exp = Date.now() + 12 * HOUR;
    res.setHeader('Set-Cookie', `walf_ops=${encodeURIComponent(`${op}|${exp}|${sign(op, exp)}`)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${12 * 3600}${req.secure ? '; Secure' : ''}`);
    res.redirect('/admin');
  });
  r.post('/logout', (_q, res) => { res.setHeader('Set-Cookie', 'walf_ops=; Path=/admin; Max-Age=0'); res.redirect('/admin/login'); });

  r.use((req, res, next) => {
    const op = opOf(req); if (!op) return res.redirect('/admin/login'); (req as any).op = op;
    if (req.method === 'POST' && req.query._csrf !== csrfOf(req)) return res.status(403).send(page('오류', '<div class="flash err">보안 확인에 실패했어요. 화면을 새로고침한 뒤 다시 시도하세요.</div>', op));
    next();
  });
  const OP = (req: express.Request) => (req as any).op as string;
  const back = (res: express.Response, id: number, msg: string) => res.redirect(`/admin/requests/${id}?m=${encodeURIComponent(msg)}#${'top'}`);

  // ── 대기열 ──
  r.get('/', (req, res) => {
    const t = now();
    const q = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
    const link = (rq: any, extra = '') => `<div class="q"><a href="/admin/requests/${rq.id}"><b>#${rq.id} ${esc(D.shortName(rq))}</b>${rq.is_mock ? MOCK : ''}</a><span class="sub">${extra}</span></div>`;
    const aiJob = (sql: string, id: number) => db.prepare(sql).get(id) as any;
    const aiText = (j: any, proposed = 0) => !j ? (cfg.ai ? ' · AI 대기' : '') : j.status === 'queued' ? ' · AI 대기' : j.status === 'running' ? ' · <b>AI가 살펴보는 중</b>'
      : j.status === 'failed' ? ' · <b>AI 실패 — 직접 확인</b>' : j.status === 'done' ? (proposed ? ` · <b>AI 제안 ${proposed}개 확인 필요</b>` : ' · AI 완료') : '';
    const sections: [string, string, string][] = [
      ['상품 확인 대기', 'AI가 먼저 후보를 추리고, 왈프 팀이 확정하면 7일이 시작돼요', q(`SELECT * FROM requests WHERE status='submitted' ORDER BY created_at`).map(x => link(x, `접수 ${kWhen(x.created_at, t)}${aiText(
        aiJob(`SELECT * FROM ai_jobs WHERE request_id=? AND kind='identify' ORDER BY id DESC LIMIT 1`, x.id), (db.prepare(`SELECT COUNT(*) n FROM ai_identities WHERE request_id=? AND status='proposed'`).get(x.id) as any).n)}`)).join('')],
      ['정보 보완 대기', '사용자 답을 기다려요', q(`SELECT * FROM requests WHERE status='needs_info' ORDER BY updated_at`).map(x => link(x, esc(x.info_request))).join('')],
      ['오늘 할 탐색', '창이 닫히면 “하지 못함”으로 기록돼요', q(`SELECT s.*, r.product_name, r.identified_name, r.product_url, r.is_mock, r.id rid FROM search_runs s JOIN requests r ON r.id=s.request_id WHERE s.status='pending' ORDER BY s.window_end`)
        .map(s => link({ ...s, id: s.rid }, `DAY ${s.day} · 마감 ${kWhen(s.window_end, t)}${aiText(aiJob(`SELECT * FROM ai_jobs WHERE run_id=? ORDER BY id DESC LIMIT 1`, s.id))}`)).join('')],
      ['AI가 찾은 매물 검수', '검수(후보 등록·제외) 전에는 사용자에게 보이지 않아요', q(`SELECT f.request_id id, COUNT(*) n, GROUP_CONCAT(DISTINCT s.name) sellers, r.product_name, r.identified_name, r.product_url, r.is_mock
        FROM ai_finds f JOIN requests r ON r.id=f.request_id LEFT JOIN sellers s ON s.id=f.seller_id WHERE f.status='proposed' AND r.status='active' GROUP BY f.request_id ORDER BY MIN(f.id)`)
        .map(x => link(x, `${x.n}건 · ${esc(x.sellers || '')}`)).join('')],
      ['검수 대기 후보', '아직 사용자에게 보이지 않거나 재고 미확인', q(`SELECT c.*, r.product_name, r.identified_name, r.product_url FROM candidates c JOIN requests r ON r.id=c.request_id WHERE r.status='active' AND c.user_dismissed=0 AND (c.published=0 OR c.needs_recheck=1 OR c.availability='listed_unverified' OR c.match_grade='same_likely') ORDER BY c.created_at`)
        .map(c => link({ ...c, id: c.request_id }, `${esc(c.seller)} · ${c.source === 'report' ? '제보' : '탐색'} · ${c.needs_recheck ? '조건 변경 재확인' : c.published ? '공개됨' : '비공개'}`)).join('')],
      ['수배 게시 대기', '게시 주소를 남겨야 완료로 보여요', q(`SELECT p.*, w.request_id, r.product_name, r.identified_name, r.product_url, r.is_mock FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id JOIN requests r ON r.id=w.request_id WHERE p.status='queued'`)
        .map(p => link({ ...p, id: p.request_id }, esc(p.channel))).join('')],
      ['수배글 삭제 요청', '철회·종료된 의뢰의 게시글', q(`SELECT p.*, w.request_id, r.product_name, r.identified_name, r.product_url, r.is_mock FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id JOIN requests r ON r.id=w.request_id WHERE p.status='removal_requested'`)
        .map(p => link({ ...p, id: p.request_id }, esc(p.channel))).join('')],
      ['24시간 안에 7일 종료', '종료 보고가 자동으로 발송돼요', q(`SELECT * FROM requests WHERE status='active' AND expires_at<=?`, t + DAY).map(x => link(x, `${kWhen(x.expires_at, t)} 종료`)).join('')],
      ['찾아줘 결과: 사용자가 아니라고 함', '다시 확인해 결과를 공개하거나 보완을 요청하세요', F.rejectedQueue(db).map(x => link(x, `${kWhen(x.rejected_at, t)} · 사용자가 다른 옷이라고 했어요`)).join('')],
      ['기다려줘 확인 필요', '상품 페이지가 없거나, 등록한 옷과 같은 페이지인지·배송비·색상·재고를 확인하지 못했거나, 연속으로 확인 못 한 것', q(`SELECT * FROM watches WHERE status='needs_info'
          OR (status='active' AND (last_state IN ('stock_unknown','shipping_unknown','color_unknown','unverified','mismatch','sale_only') OR page_identity IN ('unverified','mismatch') OR fail_streak>=?)) ORDER BY updated_at`, cfg.policy?.unreachableAfter ?? 3)
        .map(w => `<div class="q"><a href="/admin/watches#w${w.id}"><b>W${w.id} ${esc(w.title)}</b>${w.is_mock ? MOCK : ''}</a><span class="sub">${w.status === 'needs_info' ? '상품 페이지 필요' : w.fail_streak >= (cfg.policy?.unreachableAfter ?? 3) ? `연속 ${w.fail_streak}번 확인 실패` : esc(JSON.parse(w.last_result || '{}').reasons?.[0] || '')}</span></div>`).join('')],
      ['예산·상한으로 멈춘 AI 작업', '비용 화면에서 확인한 뒤 계속하거나 직접 확인하세요', q(`SELECT j.*, r.product_name, r.identified_name, r.product_url, r.is_mock rm, r.id rid FROM ai_jobs j JOIN requests r ON r.id=j.request_id WHERE j.status IN ('held','interrupted') ORDER BY j.id`)
        .map(j => link({ ...j, id: j.rid, is_mock: j.rm }, `AI ${j.kind === 'identify' ? '식별' : '탐색'} ${j.status === 'held' ? '보류' : '중단'} · ${esc(String(j.error || '').slice(0, 60))}`)).join('')],
    ];
    const counts = (db.prepare(`SELECT status, COUNT(*) n FROM requests GROUP BY status`).all() as any[]).reduce((m, x) => (m[x.status] = x.n, m), {} as any);
    const jc = (db.prepare(`SELECT status, COUNT(*) n FROM ai_jobs WHERE created_at>? GROUP BY status`).all(t - DAY) as any[]).reduce((m, x) => (m[x.status] = x.n, m), {} as any);
    const aibar = `<div class="aibar">${cfg.ai ? `<b>AI 보조 켜짐</b><span>${esc(cfg.ai.label)}</span><span class="sub">최근 24시간 · 대기 ${jc.queued || 0} · 진행 ${jc.running || 0} · 완료 ${jc.done || 0} · 실패 ${jc.failed || 0}</span>`
      : '<b>AI 보조 꺼짐</b><span class="sub">server/.env 에 ANTHROPIC_API_KEY 를 넣고 서버를 다시 켜면, 접수 즉시 AI가 먼저 상품을 식별하고 국내 판매처를 찾아봐요. 지금은 운영자가 직접 확인해요.</span>'}</div>`;
    send(req, res, page('대기열', `<h1>오늘의 대기열</h1><p class="sub">${kDate(t)} ${kTime(t)} 기준 · 활성 ${counts.active || 0} · 접수 ${counts.submitted || 0} · 보완 ${counts.needs_info || 0} · 종료 ${(counts.completed || 0) + (counts.expired || 0) + (counts.cancelled || 0)}</p>
      ${aibar}<div class="grid">${sections.map(([h, s, body]) => `<section><h2>${h}</h2><p class="sub" style="margin:-8px 0 8px">${s}</p>${body || '<p class="empty">없음</p>'}</section>`).join('')}</div>`, OP(req), 'home'));
  });

  r.get('/requests', (req, res) => {
    const rows = db.prepare('SELECT * FROM requests ORDER BY id DESC LIMIT 200').all() as any[];
    send(req, res, page('전체 의뢰', `<h1>전체 의뢰</h1><section><table><thead><tr><th>#</th><th>상품</th><th>사용자 화면 상태</th><th>DAY</th><th>접수</th><th>종료</th></tr></thead><tbody>${rows.map(x => {
      const d = D.display(db, x);
      return `<tr><td>${x.id}</td><td><a href="/admin/requests/${x.id}"><b>${esc(D.shortName(x))}</b></a>${x.is_mock ? MOCK : ''}<div class="sub">${esc(x.size || '')} ${esc(x.color || '')}</div></td><td><span class="st">${esc(d.label)}</span><div class="sub">${esc(d.title)}</div></td>
      <td>${x.activated_at ? D.dayOf(x) : '—'}</td><td>${kWhen(x.created_at)}</td><td>${x.expires_at ? kWhen(x.expires_at) : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">아직 의뢰가 없어요.</td></tr>'}</tbody></table></section>`, OP(req), 'list'));
  });

  // ── 의뢰 상세 ──
  r.get('/requests/:id', (req, res) => {
    const rq = D.getRequest(db, Number(req.params.id));
    const base = baseOf(req);
    const v = D.requestView(db, rq, base);
    const t = now();
    const sellers = db.prepare('SELECT * FROM sellers WHERE active=1 ORDER BY sort').all() as any[];
    const runs = db.prepare('SELECT * FROM search_runs WHERE request_id=? ORDER BY day').all(rq.id) as any[];
    const cands = db.prepare('SELECT * FROM candidates WHERE request_id=? ORDER BY id DESC').all(rq.id) as any[];
    const w = db.prepare('SELECT * FROM wanted WHERE request_id=?').get(rq.id) as any;
    const posts = w ? db.prepare('SELECT * FROM wanted_posts WHERE wanted_id=? ORDER BY id').all(w.id) as any[] : [];
    const notis = db.prepare('SELECT * FROM notifications WHERE request_id=? ORDER BY id DESC').all(rq.id) as any[];
    const acts = db.prepare('SELECT * FROM activity WHERE request_id=? ORDER BY at DESC, id DESC').all(rq.id) as any[];
    const m = req.query.m ? `<div class="flash">${esc(req.query.m)}</div>` : '';
    const e = req.query.e ? `<div class="flash err">${esc(req.query.e)}</div>` : '';
    const mockBox = (on = false) => `<label class="in"><input type="checkbox" name="mock" value="1" ${on || rq.is_mock ? 'checked' : ''} ${rq.is_mock ? 'disabled' : ''}>모의 데이터(테스트용 — 사용자 화면에 “모의” 표시)</label>`;

    const owner = db.prepare('SELECT * FROM users WHERE id=?').get(rq.user_id) as any;
    const pushRow = `<dt>기기 알림</dt><dd>${owner?.push_token ? '푸시 토큰 등록됨' : '푸시 토큰 없음 — 앱 안 알림만'} · 권한 ${esc(owner?.push_permission || '아직 묻지 않음')} · ${esc(owner?.platform || '')}</dd>`;
    const qaPush = cfg.qaTools ? `<form method="post" action="/admin/requests/${rq.id}/qa/push"><button class="btn s sm" ${owner?.push_token ? '' : 'disabled'}>이 기기로 테스트 푸시 보내기</button></form>` : '';
    const head = `<a id="top"></a>${m}${e}<div class="row" style="align-items:flex-start;gap:20px"><div class="ph" style="background-image:${v.product.photoUrl ? `url('${esc(v.product.photoUrl)}')` : 'none'}"></div>
      <div style="flex:3"><p class="sub">의뢰 #${rq.id} · 접수 ${kWhen(rq.created_at, t)}${rq.is_mock ? MOCK : ''}</p><h1>${esc(v.product.title)}</h1>
      <dl class="kv"><dt>사용자가 쓴 이름</dt><dd>${esc(rq.product_name) || '—'}</dd><dt>브랜드</dt><dd>${esc(rq.brand) || '—'}</dd>
      <dt>링크</dt><dd>${rq.product_url ? `<a href="${esc(rq.product_url)}" target="_blank" rel="noopener noreferrer">${esc(rq.product_url)}</a>` : '—'}</dd><dt>메모</dt><dd style="white-space:pre-wrap">${esc(rq.note) || '—'}</dd>
      <dt>구매 조건</dt><dd>${esc(v.conditions.label) || '나중에 입력'}</dd><dt>기간</dt><dd>${rq.activated_at ? `DAY ${D.dayOf(rq, t)} · ${esc(v.schedule.startedLabel)} → ${esc(v.schedule.endsLabel)}` : '7일 시작 전'}</dd>${pushRow}
      <dt>AI 보조</dt><dd>${cfg.ai ? esc(cfg.ai.label) : '꺼짐 — 운영자가 직접 확인'}</dd></dl></div>
      <div style="flex:2"><p class="sub" style="margin:0 0 6px">사용자 앱에 지금 보이는 문장 (서버 계산값 그대로)</p><div class="app"><small>${esc(v.display.eyebrow)}</small><b>${esc(v.display.title)}</b><span>${esc(v.display.desc)}</span>
      <p style="margin:8px 0 0"><span class="st">${esc(v.display.label)}</span> <span class="sub">${esc(v.display.key)}</span></p></div></div></div>`;

    // AI가 먼저 살펴본 결과 — 운영자는 채택·수정·직접 확인 중에서 고른다
    const av = A.aiView(db, rq.id);
    const jobState = (j: any) => !j ? '아직 없음' : j.status === 'queued' ? '대기 중' : j.status === 'running' ? `살펴보는 중 · ${kWhen(j.started_at, t)} 시작`
      : j.status === 'done' ? `완료 ${kWhen(j.finished_at, t)}` : j.status === 'failed' ? `실패 ${kWhen(j.finished_at, t)}` : '실행 안 함(의뢰 상태 바뀜)';
    const usage = (j: any) => j?.status === 'done' && j.provider !== 'mock' ? ` · 검색 ${j.searches ?? 0}회 · 토큰 ${((j.input_tokens || 0) + (j.output_tokens || 0)).toLocaleString()}` : '';
    const busy = (j: any) => !!j && ['queued', 'running'].includes(j.status);
    const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
    const ids = av.identities.filter((x: any) => x.status === 'proposed');
    const missing: string[] = av.identifyDone?.detail?.missing || [];
    const idCard = (x: any) => `<form method="post" action="/admin/ai/identities/${x.id}/accept" class="id">
      <p style="margin:0 0 6px"><b>${x.rank}순위</b> <span class="tg aip">AI 제안 · 검수 전</span> <span class="tg ${x.confidence === 'high' ? 'o' : 'x'}">신뢰도 ${A.CONF_LABEL[x.confidence]}</span>${x.category ? ` <span class="sub">${esc(x.category)}</span>` : ''}${x.is_mock ? MOCK : ''}</p>
      <div class="row"><div><label>브랜드</label><input type="text" name="brand" value="${esc(x.brand || '')}"></div><div style="flex:2"><label>상품명(모델·색상) — 고쳐서 확정할 수 있어요</label><input type="text" name="name" required maxlength="120" value="${esc(A.identityLabel(x))}"></div></div>
      ${x.reasons.length ? `<ul>${x.reasons.map((r: string) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${x.refs.length ? `<p class="sub" style="margin:4px 0 8px">AI가 확인한 페이지: ${x.refs.map((u: string) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))}</a>`).join(' · ')}</p>` : ''}
      <button class="btn sm">이 상품으로 확정 → 7일 탐색 시작</button></form>`;
    const idJob = av.identify;
    const aiId = !cfg.ai && !idJob ? '<div class="ai" data-ai="identify:off"><h3>AI 식별 꺼짐</h3><p class="sub" style="margin:0">server/.env 에 ANTHROPIC_API_KEY 가 없어서 AI가 먼저 살펴보지 못했어요. 아래에서 직접 확인하세요.</p></div>'
      : `<div class="ai" data-ai="identify:${idJob?.status || 'none'}"><h3>AI가 먼저 살펴본 결과 <span class="sub">· ${esc(jobState(idJob))}${usage(av.identifyDone)}</span>${idJob?.is_mock ? MOCK : ''}</h3>
      ${busy(idJob) ? '<p class="sub">사진·링크를 보고 브랜드 공식몰과 국내 판매처에서 같은 상품을 찾는 중이에요. 보통 1~3분 걸려요. <a href="">새로고침</a></p>' : ''}
      ${idJob?.status === 'failed' ? `<p><b>AI 식별 실패</b> — ${esc(idJob.error)}</p>` : ''}
      ${av.identifyDone?.summary ? `<p style="margin:6px 0">${esc(av.identifyDone.summary)}</p>` : ''}${ids.map(idCard).join('')}
      ${av.identifyDone && !ids.length && !busy(idJob) ? '<p class="sub">AI가 고를 만한 후보를 내지 못했어요. 아래에서 직접 확인하거나 보완을 요청하세요.</p>' : ''}
      ${missing.length ? `<p class="sub">AI가 더 필요하다고 본 정보: ${missing.map(esc).join(' · ')}</p>` : ''}
      ${cfg.ai && rq.status === 'submitted' && !busy(idJob) ? `<form method="post" action="/admin/requests/${rq.id}/ai/identify"><button class="btn s sm">AI 다시 살펴보기</button></form>` : ''}</div>`;
    // V2 찾아줘 결과 — MATCH·LIKELY·DISCOVER 로 골라 사용자에게 공개(공개한 것만 보인다). 사용자가 확인하면 상품 저장 + 7일 탐색 또는 기다려줘
    const fd = F.findDraft(db, rq.id);
    const TIER: Record<string, string> = { match: 'MATCH · 같은 옷 확인', likely: 'LIKELY · 유력 후보', skip: '공개 안 함' };
    const attrList = (xs: string[], cls: string) => xs.length ? `<ul class="${cls}">${xs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
    const pubRows = fd.published.map((p: any) => `<tr><td>${esc(p.tier.toUpperCase())}</td><td><b>${esc([p.brand, p.name].filter(Boolean).join(' '))}</b>${p.is_mock ? MOCK : ''}</td><td>${{ published: '사용자에게 공개됨', confirmed: '<b>사용자가 “이 옷이 맞아요”</b>', rejected: '사용자가 “아니에요”' }[p.status as string] || esc(p.status)}</td><td class="sub">${esc(p.published_by || '')} ${kWhen(p.created_at, t)}</td></tr>`).join('');
    const findBox = !fd.job ? '' : `<div class="ai" data-ai="find:${fd.published.some((p: any) => p.status === 'published') ? 'published' : 'draft'}"><h3>찾아줘 결과 공개 <span class="sub">· 사용자에게 보일 결과를 골라요. 근거 주소가 없으면 MATCH로 공개할 수 없어요</span>${fd.isMock ? MOCK : ''}</h3>
      ${rq.status === 'submitted' ? `<form method="post" action="/admin/requests/${rq.id}/find/publish">${fd.identities.map((x: any) => `<div class="id"><p style="margin:0 0 6px"><b>${x.rank}순위</b> <span class="tg aip">AI 제안</span> <span class="tg ${x.confidence === 'high' ? 'o' : 'x'}">신뢰도 ${A.CONF_LABEL[x.confidence]}</span> <span class="sub">서버 판정: ${x.tier === 'hidden' ? '숨김(신뢰도 낮음)' : TIER[x.tier]}</span></p>
        <div class="row"><div><label>공개 등급</label><select name="tier_${x.id}">${(['match', 'likely', 'skip'] as const).map(k => `<option value="${k}" ${(x.tier === 'hidden' ? 'skip' : x.tier) === k ? 'selected' : ''}>${TIER[k]}</option>`).join('')}</select></div>
        <div><label>브랜드</label><input type="text" name="brand_${x.id}" value="${esc(x.brand || '')}"></div><div style="flex:2"><label>상품명(사용자에게 보임)</label><input type="text" name="name_${x.id}" value="${esc(A.identityLabel(x))}"></div></div>
        <div class="grid"><div><p class="sub" style="margin:6px 0 0">확인한 것</p>${attrList(x.matched, '') || '<p class="empty">없음</p>'}</div><div><p class="sub" style="margin:6px 0 0">확인 못 한 것</p>${attrList(x.uncertain, '') || '<p class="empty">없음</p>'}</div></div>
        ${x.model_code || x.season ? `<p class="sub">품번 ${esc(x.model_code || '—')} · 시즌 ${esc(x.season || '—')}</p>` : ''}${x.refs.length ? `<p class="sub">근거: ${x.refs.map((u: string) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))}</a>`).join(' · ')}</p>` : ''}
        <details><summary class="sub">MATCH로 올리기(서버 판정이 MATCH가 아니거나 이름·브랜드를 고칠 때 필수)</summary>
        <div class="row"><div><label>직접 확인한 상품 페이지 주소</label><input type="url" name="vurl_${x.id}" placeholder="https:// 공식몰·판매 페이지"></div><div style="flex:2"><label>확인 사유(무엇이 같은지, 10자 이상)</label><input type="text" name="vwhy_${x.id}" maxlength="300" placeholder="예: 품번 W-JKT26-055와 소매 절개선·가슴 지퍼 위치가 같음"></div></div>
        <p class="sub">근거 주소가 있다는 것만으로는 같은 상품이 아니에요. 서버 판정이 MATCH이고 이름을 고치지 않았을 때만 이 칸 없이 MATCH로 공개돼요.</p></details></div>`).join('')}
        ${fd.discover.length ? `<div class="id"><p style="margin:0 0 6px"><b>DISCOVER · 비슷한 스타일</b> <span class="sub">MATCH가 없을 때만 공개돼요. 같은 상품이라고 말하지 않아요. 사진에서 본 스타일: ${esc(fd.styleWords.join(' · ') || '없음')}</span></p>
          ${fd.discover.map(c => `<label class="in" style="display:flex;margin:6px 0"><input type="checkbox" name="disc" value="${esc(c.brandKey + '|' + c.scope)}" checked><b>${esc(c.brand)}${c.scope ? ' ' + esc(c.scope) : ''}</b>&nbsp;<span class="sub">점수 ${c.score} · ${esc(c.reasons.join(' · '))} · ${c.status === 'verified' ? '왈프 팀 확인' : c.status === 'fixture' ? '테스트 데이터' : '출처 있음·검수 전'}${c.sources.length ? ` · <a href="${esc(c.sources[0])}" target="_blank" rel="noopener noreferrer">출처</a>` : ''}</span></label>`).join('')}</div>`
          : `<p class="sub">비슷한 스타일 후보 없음${fd.styleWords.length ? ` — 사진에서 본 스타일(${esc(fd.styleWords.join(' · '))})과 2가지 이상 겹치는 브랜드 매핑이 없어요` : ''}.</p>`}
        <p><button class="btn sm">고른 결과를 사용자에게 공개</button> <span class="sub">공개하면 앱에 결과가 보이고 알림이 가요. 사용자가 확인하면 7일 탐색 또는 기다려줘로 이어져요.</span></p></form>` : ''}
      ${pubRows ? `<table><tbody>${pubRows}</tbody></table>` : ''}</div>`;
    let ident = '';
    if (['submitted', 'needs_info'].includes(rq.status)) ident = `<section class="warn"><h2>1 · 상품 확인</h2><p class="sub">AI가 먼저 후보를 추리고 왈프 팀이 확정해요. 확정하면 지금부터 168시간(7일) 탐색이 시작되고, 1일차 탐색도 AI가 먼저 해요.${rq.status === 'needs_info' ? ` 현재 보완 요청: “${esc(rq.info_request)}”` : ''}</p>
      ${aiId}${findBox}
      <div class="grid"><details ${ids.length || busy(idJob) ? '' : 'open'}><summary>직접 확인해서 시작(AI 제안이 틀렸거나 AI 없이)</summary><form method="post" action="/admin/requests/${rq.id}/activate"><label>확인한 브랜드</label><input type="text" name="brand" value="${esc(rq.identified_brand || rq.brand || '')}">
      <label>확인한 상품명(모델·색상)</label><input type="text" name="name" required value="${esc(rq.identified_name || rq.product_name || '')}"><label>근거 메모(내부)</label><input type="text" name="note" value="${esc(rq.identified_note || '')}">
      <p><button class="btn">상품 확인 → 7일 탐색 시작</button></p></form></details>
      <form method="post" action="/admin/requests/${rq.id}/info-request"><label>정보 보완 요청(사용자에게 그대로 보여요)</label><textarea name="message" required maxlength="300" placeholder="${esc(missing.length ? `예: ${missing[0]}${D.eul(missing[0])} 보내주세요.` : '예: 정확한 모델을 확인할 수 있게 태그 사진이나 구매 링크를 보내주세요.')}"></textarea>
      <p><button class="btn s">보완 요청 보내기</button></p></form></div></section>`;

    const MATCH: Record<string, string> = { same_likely: '같은 상품으로 보임', similar: '비슷한 상품', unknown: '판단 못 함' };
    const STOCK: Record<string, string> = { listed: '판매글 있음', sold_out: '판매 종료로 보임', unknown: '판매 상태 모름' };
    const COND: Record<string, string> = { new: '새 상품', used: '중고', unknown: '상태 모름' };
    const REJECT = ['다른 상품', '판매 종료·품절', '해외 판매처', '이미 등록한 매물', '링크가 열리지 않음', '조건과 너무 다름', '기타'];
    const sel2 = (name: string, opts: [string, string][], v?: string) => `<select name="${name}">${opts.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const findCard = (f: any) => `<div class="fd" id="find-${f.id}"><p style="margin:0 0 4px"><b>${esc(f.seller || '판매처 미상')}</b> <span class="sub">DAY ${f.day ?? '?'}</span> <span class="tg aip">AI 제안 · 검수 전</span> <span class="tg x">${MATCH[f.match_guess]}</span> <span class="tg p">${STOCK[f.stock_guess]}</span>${f.is_mock ? MOCK : ''}</p>
      <p style="margin:0">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(f.title || f.url)}</b></a>` : `<b>${esc(f.title || '(주소 없음)')}</b>`} · ${f.price != null ? f.price.toLocaleString() + '원' : '가격 미확인'} · ${esc(f.size || '사이즈 미확인')} · ${COND[f.condition] || '상태 모름'}</p>
      ${f.url_seen === 0 ? '<p><b>⚠ 검색 결과에 없던 주소예요.</b> AI가 잘못 적었을 수 있으니 직접 열어 확인하세요.</p>' : ''}${f.reason ? `<p class="sub" style="margin:4px 0">AI 메모: ${esc(f.reason)}</p>` : ''}
      ${rq.status === 'active' ? `<details><summary>열어서 확인했어요 → 후보로 등록</summary><form method="post" action="/admin/ai/finds/${f.id}/accept"><p class="sub">판매처·주소는 AI가 찾은 그대로 저장돼요. 나머지는 직접 확인한 값으로 고치세요.</p>
        <div class="g3"><div><label>매물 제목</label><input type="text" name="title" value="${esc(f.title || '')}"></div><div><label>사이즈</label><input type="text" name="size" value="${esc(f.size || '')}"></div>
        <div><label>판매가(원)</label><input type="number" name="price" min="0" value="${f.price ?? ''}"></div><div><label>배송비(원)</label><input type="number" name="shipping" min="0" value="0"></div>
        <div><label>상태</label>${sel2('condition', [['used', '중고'], ['new', '새 상품']], f.condition === 'new' ? 'new' : 'used')}</div><div><label>상태 메모</label><input type="text" name="conditionNote" placeholder="예: 사용감 적음(판매자 기재)"></div>
        <div><label>상품 일치 등급</label>${sel2('matchGrade', [['same_likely', '동일 상품 유력'], ['same_confirmed', '동일 상품 확인'], ['similar', '유사 상품(사용자 비공개)'], ['unknown', '식별 불가']], f.match_guess)}</div>
        <div><label>구매 가능 상태</label>${sel2('availability', [['listed_unverified', '판매글 존재·재고 미확인'], ['purchasable', '구매 가능 확인'], ['option_mismatch', '옵션 불일치'], ['sold_out', '판매 종료·품절']], f.stock_guess === 'sold_out' ? 'sold_out' : 'listed_unverified')}</div>
        <div><label class="in" style="margin-top:28px"><input type="checkbox" name="checkedNow" value="1">지금 직접 확인함(확인 시각 기록)</label><label class="in"><input type="checkbox" name="colorOk" value="1" checked>색상 일치</label></div></div>
        <div class="grid"><div><label>확인한 근거(한 줄에 하나 · 사용자에게 보임)</label><textarea name="evidence" placeholder="같은 옷이에요 | 판매글 사진의 로고 자수가 공식 상품과 같아요"></textarea></div>
        <div><label>아직 확인 중인 것(한 줄에 하나)</label><textarea name="pending" placeholder="사이즈 | M 택 사진을 요청했어요"></textarea></div></div>
        <p><label class="in"><input type="checkbox" name="publish" value="1">저장하면서 사용자에게 공개</label>${mockBox(!!f.is_mock)}</p><p><button class="btn sm">후보로 등록</button></p></form></details>
      <form method="post" action="/admin/ai/finds/${f.id}/reject" class="row" style="margin-top:8px;max-width:640px"><select name="reason" required><option value="" selected disabled>제외 사유</option>${REJECT.map(x => `<option>${x}</option>`).join('')}</select><input type="text" name="note" maxlength="150" placeholder="메모(선택)"><button class="btn s sm" style="flex:none">제외</button></form>` : ''}</div>`;
    const openFinds = av.finds.filter((f: any) => f.status === 'proposed');
    const doneFinds = av.finds.filter((f: any) => f.status !== 'proposed');
    const findsHtml = !av.finds.length ? `<p class="empty">${cfg.ai ? '아직 AI가 찾은 매물이 없어요.' : 'AI 탐색 꺼짐'}</p>`
      : `${openFinds.map(findCard).join('') || '<p class="empty">검수할 매물이 없어요.</p>'}
      ${doneFinds.length ? `<details><summary>검수한 AI 매물 ${doneFinds.length}건</summary><table><tbody>${doneFinds.map((f: any) => `<tr><td>DAY ${f.day ?? '?'}</td><td><b>${esc(f.seller || '')}</b> ${esc(f.title || '')}${f.is_mock ? MOCK : ''}</td>
        <td>${f.status === 'accepted' ? `후보 #${f.candidate_id}로 등록` : `제외 · ${esc(f.reject_reason)}`}</td><td class="sub">${esc(f.decided_by || '')} ${f.decided_at ? kWhen(f.decided_at, t) : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}`;

    const lastPending = [...runs].reverse().find(x => x.status === 'pending');
    const hasPending = !!lastPending;
    const findsBox = av.finds.length ? `<div ${openFinds.length ? 'class="warn" style="border-radius:12px;padding:14px 16px;margin:10px 0"' : 'style="margin:10px 0"'}><h3>AI가 찾은 매물 · 검수 ${openFinds.length ? `<span class="sub">${openFinds.length}건 대기</span>` : ''}</h3>
      <p class="sub">AI 추정은 점선 표시예요. 검수해서 후보로 올린 것만 “3 · 후보와 매물”에 들어가고, 공개한 것만 사용자에게 보여요.</p>${findsHtml}</div>` : '';
    const runsHtml = runs.map(s => {
      if (s.status !== 'pending') {
        const ks = db.prepare('SELECT k.*, se.name FROM seller_checks k JOIN sellers se ON se.id=k.seller_id WHERE run_id=? ORDER BY se.sort').all(s.id) as any[];
        return `<details><summary>DAY ${s.day} · ${s.status === 'done' ? `완료 ${kWhen(s.completed_at, t)} · ${esc(s.operator)} · 결과 ${esc(s.outcome)}` : s.status === 'missed' ? '하지 못함(창 마감)' : '취소'}${s.is_mock ? MOCK : ''}</summary>
          ${ks.length ? `<table><tbody>${ks.map(k => `<tr><td>${esc(k.name)}</td><td>${esc(k.status)}</td><td>${esc(k.result || '')}</td><td>${esc(k.note || '')}</td></tr>`).join('')}</tbody></table>` : ''}${s.summary ? `<p>${esc(s.summary)}</p>` : ''}</details>`;
      }
      // AI가 먼저 찾아본 결과 → 판매처별 확인·결과를 미리 골라 둔다(운영자가 근거를 보고 저장해야 기록된다)
      const sj = av.searchOf(s.id);
      const sjDone = sj?.status === 'done';
      const notes: any[] = sjDone ? sj.detail.sellers || [] : [];
      const accepted = db.prepare(`SELECT f.seller_id, c.match_grade FROM ai_finds f JOIN candidates c ON c.id=f.candidate_id WHERE f.run_id=? AND f.status='accepted'`).all(s.id) as any[];
      const pendingFinds = av.finds.filter((f: any) => f.run_id === s.id && f.status === 'proposed').length;
      const rsOf = (sid: number) => { const g = accepted.filter(a => a.seller_id === sid).map(a => a.match_grade); return g.some(x => x.startsWith('same')) ? 'same' : g.includes('similar') ? 'similar' : 'none'; };
      const anySame = accepted.some(a => a.match_grade.startsWith('same'));
      const outDefault = !sjDone ? '' : anySame ? 'leads' : s.day === 1 ? 'no_match' : 'nothing_new';
      const o = (v: string, label: string, cur: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
      const det = sj?.detail || {};
      const aiRun = !cfg.ai && !sj ? '<p class="sub">AI 탐색 꺼짐 — 판매처를 직접 확인해 기록하세요.</p>'
        : `<div class="ai" data-ai="search:${sj?.status || 'none'}"><h3>AI가 먼저 찾아본 결과 <span class="sub">· ${esc(jobState(sj))}${usage(sj)}</span>${sj?.is_mock ? MOCK : ''}</h3>
        ${busy(sj) ? '<p class="sub">국내 판매처 6곳에서 확정한 상품을 찾는 중이에요. <a href="">새로고침</a></p>' : ''}
        ${sj?.status === 'failed' ? `<p><b>AI 탐색 실패</b> — ${esc(sj.error)}</p>` : ''}${sjDone && sj.summary ? `<p style="margin:6px 0">${esc(sj.summary)}</p>` : ''}
        ${sjDone ? `<p class="sub" style="margin:4px 0">새로 찾은 매물 ${det.added ?? 0}건${det.duplicates ? ` · 이미 본 주소 ${det.duplicates}건 제외` : ''}${det.dropped ? ` · 판매처 밖 주소 ${det.dropped}건 버림` : ''}${det.blocked?.length ? ` · AI 검색 불가: ${esc(det.blocked.join(', '))}` : ''}</p>` : ''}
        ${pendingFinds ? `<p><b>검수할 매물 ${pendingFinds}건</b> — 바로 아래에서 후보로 등록하거나 제외해야 이 탐색을 저장할 수 있어요.</p>` : ''}
        ${cfg.ai && !busy(sj) ? `<form method="post" action="/admin/requests/${rq.id}/ai/search"><button class="btn s sm">AI 다시 찾아보기</button></form>` : ''}</div>`;
      return `${aiRun}${s.id === lastPending?.id ? findsBox : ''}<form method="post" action="/admin/runs/${s.id}/complete" class="warn" style="border-radius:12px;padding:14px 16px;margin:10px 0"><h3>DAY ${s.day} 탐색 기록 · 마감 ${kWhen(s.window_end, t)}</h3>
        <p class="sub">${sjDone ? '<b>AI 결과로 미리 골라 뒀어요.</b> 판매처별 AI 메모와 검수한 매물을 보고 맞는지 확인한 뒤 저장하세요. ' : ''}실제로 확인한 곳만 “확인함”으로 고르세요. 접속이 안 되면 “접속 실패”로 남겨야 사용자에게 매물 없음으로 보이지 않아요.</p>
        <table><thead><tr><th>판매처</th><th>AI가 본 것(내부)</th><th>확인</th><th>결과</th><th>메모(사용자에게 보임)</th></tr></thead><tbody>${sellers.map(se => {
          const n = notes.find(x => x.sellerId === se.id);
          const st = n?.searched ? 'checked' : '';
          return `<tr><td><b>${esc(se.name)}</b></td><td class="sub">${n ? `${n.searched ? '검색함' : '<b>검색 못 함</b>'}${n.note ? ' · ' + esc(n.note) : ''}` : '—'}</td>
        <td><select name="st_${se.id}" required><option value="" ${st ? '' : 'selected'} disabled>선택</option>${o('checked', '확인함', st)}${o('unreachable', '접속 실패', st)}${o('skipped', '확인 안 함', st)}</select></td>
        <td><select name="rs_${se.id}">${o('none', '매물 없음', rsOf(se.id))}${o('same', '동일 상품 있음', rsOf(se.id))}${o('similar', '유사 상품만', rsOf(se.id))}</select></td>
        <td><input type="text" name="nt_${se.id}" maxlength="200" placeholder="예: M 품절, 동일 상품 1건 · 사이즈 L"></td></tr>`;
        }).join('')}</tbody></table>
        <div class="row"><div><label>결과</label><select name="outcome" required><option value="" ${outDefault ? '' : 'selected'} disabled>선택</option>${s.day === 1 ? o('no_match', '조건에 맞는 매물 없음 → 수배 제안', outDefault) : o('nothing_new', '새 소식 없음', outDefault) + o('no_match', '조건에 맞는 매물 없음', outDefault)}
        ${o('leads', '유력 후보 있음(아래에서 후보 등록)', outDefault)}${o('offer', '구매 가능 매물 있음(아래에서 후보 등록)', outDefault)}</select></div><div><label>내부 메모</label><input type="text" name="summary" maxlength="300"></div></div>
        <p>${mockBox(!!sj?.is_mock)}</p><p><button class="btn">탐색 기록 저장</button></p></form>`;
    }).join('') || '<p class="empty">상품 확인 후 탐색 작업이 생겨요.</p>';

    const tagOf = (c: any) => { const cv = D.candidateView(db, rq, c, base); return cv.tags.map(x => `<span class="tg ${x.kind}">${esc(x.text)}</span>`).join(' ') + ` <span class="st">${cv.kind}</span>`; };
    const candForm = (c?: any) => {
      const ev = c ? JSON.parse(c.evidence || '[]').join('\n') : '', pd = c ? JSON.parse(c.pending || '[]').join('\n') : '';
      const sel = (name: string, opts: [string, string][], v?: string) => `<select name="${name}">${opts.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      const ca = c?.checked_at ? new Date(c.checked_at + 9 * HOUR).toISOString().slice(0, 16) : '';
      return `<form method="post" enctype="multipart/form-data" action="${c ? `/admin/candidates/${c.id}` : `/admin/requests/${rq.id}/candidates`}">
        <div class="g3"><div><label>출처</label>${sel('source', [['search', '왈프 팀 탐색'], ['report', '판매자 제보']], c?.source)}</div>
        <div><label>판매처</label><input type="text" name="seller" required list="sellers" value="${esc(c?.seller || '')}"></div><div><label>매물 링크</label><input type="url" name="url" value="${esc(c?.url || '')}" placeholder="https://"></div>
        <div><label>매물 제목</label><input type="text" name="title" value="${esc(c?.title || '')}"></div><div><label>사이즈</label><input type="text" name="size" value="${esc(c?.size || '')}"></div>
        <div><label>판매가(원)</label><input type="number" name="price" min="0" value="${c?.price ?? ''}"></div><div><label>배송비(원)</label><input type="number" name="shipping" min="0" value="${c?.shipping ?? 0}"></div>
        <div><label>상태</label>${sel('condition', [['used', '중고'], ['new', '새 상품']], c?.condition)}</div><div><label>상태 메모</label><input type="text" name="conditionNote" value="${esc(c?.condition_note || '')}" placeholder="예: 사용감 적음(판매자 기재)"></div>
        <div><label>상품 일치 등급</label>${sel('matchGrade', [['same_likely', '동일 상품 유력'], ['same_confirmed', '동일 상품 확인'], ['similar', '유사 상품(사용자 비공개)'], ['unknown', '식별 불가']], c?.match_grade)}</div>
        <div><label>구매 가능 상태</label>${sel('availability', [['listed_unverified', '판매글 존재·재고 미확인'], ['purchasable', '구매 가능 확인'], ['option_mismatch', '옵션 불일치'], ['sold_out', '판매 종료·품절']], c?.availability)}</div>
        <div><label>운영자 확인 시각(KST)</label><input type="datetime-local" name="checkedAt" value="${ca}"><label class="in" style="margin-top:6px"><input type="checkbox" name="checkedNow" value="1">지금으로</label></div>
        <div><label>판매자 사진</label><input type="file" name="photo" accept="image/*"></div><div><label class="in" style="margin-top:28px"><input type="checkbox" name="colorOk" value="1" ${!c || c.color_ok ? 'checked' : ''}>색상 일치</label></div></div>
        <div class="grid"><div><label>확인한 근거(한 줄에 하나 · 사용자에게 보임)</label><textarea name="evidence" placeholder="같은 옷이에요 | 케어라벨 품번이 공식 상품과 같아요">${esc(ev)}</textarea></div>
        <div><label>아직 확인 중인 것(한 줄에 하나)</label><textarea name="pending" placeholder="사이즈 | M 사이즈 택 사진을 요청했어요">${esc(pd)}</textarea></div></div>
        <p>${c ? '' : '<label class="in"><input type="checkbox" name="publish" value="1">저장하면서 사용자에게 공개</label>'}${mockBox(!!c?.is_mock)}</p><p><button class="btn">${c ? '후보 수정' : '후보 등록'}</button></p></form>`;
    };
    const candsHtml = cands.map(c => `<details ${c.published && !c.needs_recheck ? '' : 'open'}><summary>#${c.id} ${esc(c.seller)} · ${esc(c.size || '?')} · ${c.price != null ? c.price.toLocaleString() + '원' : '가격 없음'} · ${c.source === 'report' ? '제보' : '탐색'} · ${c.published ? '공개' : '비공개'}${c.user_dismissed ? ' · 사용자가 넘김' : ''}${c.is_mock ? MOCK : ''}</summary>
      <p>${tagOf(c)} · 알림 ${esc(c.notified || '없음')}${c.needs_recheck ? ' · <b>조건 변경 — 다시 확인 후 저장 필요</b>' : ''}</p>
      <form method="post" action="/admin/candidates/${c.id}/publish" style="margin:8px 0"><input type="hidden" name="on" value="${c.published ? 0 : 1}"><button class="btn ${c.published ? 's' : ''} sm" ${!c.published && ['similar', 'unknown'].includes(c.match_grade) ? 'disabled' : ''}>${c.published ? '사용자 화면에서 내리기' : '사용자에게 공개'}</button></form>
      ${candForm(c)}</details>`).join('');

    const wantedHtml = !w ? (rq.status === 'active' ? `<form method="post" action="/admin/requests/${rq.id}/wanted/propose"><p class="sub">첫 탐색에서 “조건에 맞는 매물 없음”을 고르면 자동으로 제안돼요. 그 밖의 경우만 직접 제안하세요.</p><button class="btn s">수배 제안 보내기</button></form>` : '<p class="empty">수배 없음</p>')
      : `<p><span class="st">${esc(w.status)}</span> 제안 ${w.proposed_at ? kWhen(w.proposed_at, t) : ''} ${w.decided_at ? '· 결정 ' + kWhen(w.decided_at, t) : ''}</p>
        ${w.public_fields ? `<p class="sub">공개 승인 항목: ${Object.entries(JSON.parse(w.public_fields)).filter(([, v]) => v).map(([k]) => ({ photo: '사진', model: '브랜드·모델', sizeColor: '사이즈·색상', maxPrice: '희망가' } as any)[k]).join(', ')}</p>` : ''}
        <table><thead><tr><th>채널</th><th>상태</th><th>주소·사유</th><th>변경</th></tr></thead><tbody>${posts.map(p => `<tr><td><b>${esc(p.channel)}</b>${p.is_mock ? MOCK : ''}</td><td>${p.status}${p.posted_at ? '<div class="sub">' + kWhen(p.posted_at, t) + '</div>' : ''}</td>
        <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url)}</a>` : ''} ${esc(p.reason || '')}</td><td>${['queued', 'posted', 'removal_requested'].includes(p.status) ? `<form method="post" action="/admin/posts/${p.id}" class="row">
        <select name="status">${p.status === 'queued' ? '<option value="posted">게시 완료</option><option value="skipped">올리지 않음</option><option value="rejected">게시 거절됨</option>' : p.status === 'posted' ? '<option value="removed">삭제함</option><option value="rejected">플랫폼이 삭제·제한</option>' : '<option value="removed">삭제함</option>'}</select>
        <input type="url" name="url" placeholder="게시글 주소(게시 완료 시 필수)"><input type="text" name="reason" placeholder="사유(올리지 않음·거절 시 필수)"><label class="in"><input type="checkbox" name="mock" value="1" ${rq.is_mock ? 'checked disabled' : ''}>모의</label><button class="btn sm">저장</button></form>` : ''}</td></tr>`).join('')}</tbody></table>`;

    const qa = cfg.qaTools && rq.status === 'active' ? `<section class="warn"><h2>QA 도구 <span class="mk">QA</span></h2><p class="sub">테스트용 일정 조작이에요. 실행하면 일지에 “운영 테스트”로 남고 사용자 화면에도 “모의”로 표시돼요. 운영 환경에서는 WALF_QA_TOOLS를 끄세요.</p>
      <div class="row"><form method="post" action="/admin/requests/${rq.id}/qa/shift"><button class="btn s sm">일정 24시간 당기기(다음 날로)</button></form><form method="post" action="/admin/requests/${rq.id}/qa/expire"><button class="btn s sm">지금 7일 종료 처리</button></form>${qaPush}</div></section>`
      : qaPush ? `<section class="warn"><h2>QA 도구 <span class="mk">QA</span></h2><div class="row">${qaPush}</div></section>` : '';

    const body = `${head}${ident}
      <section><h2>2 · 탐색 작업</h2><p class="sub">AI가 매일 국내 판매처를 먼저 찾아보고, 왈프 팀이 검수해서 기록해요.</p>${runsHtml}</section>
      ${findsBox && !hasPending ? `<section>${findsBox}</section>` : ''}
      <section><h2>3 · 후보와 매물 ${cands.length ? `<span class="sub">${cands.length}</span>` : ''}</h2><p class="sub">공개한 후보만 사용자에게 보여요. 판매자 제보는 “구매 가능 확인” 전까지 푸시를 보내지 않아요(PRD).</p>
        ${candsHtml}<details ${cands.length ? '' : 'open'}><summary>새 후보 등록</summary>${rq.status === 'active' ? candForm() : '<p class="empty">진행 중인 의뢰에만 등록할 수 있어요.</p>'}</details>
        <datalist id="sellers">${sellers.map(s => `<option value="${esc(s.name)}">`).join('')}</datalist></section>
      <section><h2>4 · 공개 수배</h2>${wantedHtml}</section>
      ${qa}
      <div class="grid"><section><h2>알림 발송 기록</h2>${notis.length ? `<table><tbody>${notis.map(n => `<tr><td>${kWhen(n.created_at, t)}</td><td><b>${esc(n.title)}</b><div class="sub">${esc(n.body)}</div></td><td>${n.read_at ? '읽음' : '안 읽음'}<div class="sub">푸시: ${esc(n.push_status)}${n.push_detail ? ' · ' + esc(n.push_detail) : ''}</div></td></tr>`).join('')}</tbody></table>` : '<p class="empty">없음</p>'}</section>
      <section><h2>활동 일지(사용자에게 보이는 기록)</h2><ul class="log">${acts.map(a => `<li><span>${kWhen(a.at, t)}</span><b>${esc(D.ACTOR_LABEL[a.actor] || a.actor)}</b><span><b>${esc(a.title)}</b> ${esc(a.detail || '')}${a.operator ? ` <span class="sub">· ${esc(a.operator)}</span>` : ''}${a.is_mock ? MOCK : ''}</span></li>`).join('')}</ul></section></div>`;
    send(req, res, page(`#${rq.id}`, body, OP(req)));
  });

  // ── 동작 ──
  const act = (fn: (req: express.Request) => [number, string]): express.RequestHandler => (req, res) => {
    try { const [id, msg] = fn(req); back(res, id, msg); }
    catch (e: any) {
      const id = Number((req as any).rid) || Number(req.params.id) || 0;
      if (e instanceof HttpError && id) return res.redirect(`/admin/requests/${id}?e=${encodeURIComponent(e.message)}`);
      throw e;
    }
  };
  r.post('/requests/:id/activate', act(req => { const id = Number(req.params.id); D.activate(db, id, req.body, OP(req)); return [id, '상품을 확인했어요. 7일 탐색이 시작됐어요.']; }));
  r.post('/requests/:id/info-request', act(req => { const id = Number(req.params.id); D.requestInfo(db, id, req.body.message, OP(req)); return [id, '보완 요청을 보냈어요.']; }));
  r.post('/runs/:id/complete', (req, res, next) => {
    const s = db.prepare('SELECT * FROM search_runs WHERE id=?').get(Number(req.params.id)) as any;
    if (!s) return next(new HttpError(404, 'not_found'));
    (req as any).rid = s.request_id;
    const sellers = db.prepare('SELECT * FROM sellers WHERE active=1').all() as any[];
    act(rq => {
      D.completeRun(db, s.id, { outcome: rq.body.outcome, summary: rq.body.summary, isMock: rq.body.mock === '1',
        checks: sellers.map(se => ({ sellerId: se.id, status: rq.body[`st_${se.id}`], result: rq.body[`rs_${se.id}`], note: rq.body[`nt_${se.id}`] })) }, OP(rq));
      return [s.request_id, `DAY ${s.day} 탐색을 기록했어요.`];
    })(req, res, next);
  });
  const candInput = (req: express.Request): D.CandInput => {
    const b = req.body;
    const lines = (s: string) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
    const num = (s: string) => s === '' || s == null ? null : Number(s);
    const checkedAt = b.checkedNow === '1' ? now() : b.checkedAt ? Date.parse(b.checkedAt + ':00+09:00') : null;
    return { source: b.source, seller: b.seller, url: b.url, title: b.title, size: b.size, colorOk: b.colorOk === '1', price: num(b.price), shipping: num(b.shipping) ?? 0,
      condition: b.condition, conditionNote: b.conditionNote, matchGrade: b.matchGrade, availability: b.availability, evidence: lines(b.evidence), pending: lines(b.pending),
      checkedAt: Number.isFinite(checkedAt as number) ? checkedAt : null, isMock: b.mock === '1', photo: req.file?.filename || null };
  };
  r.post('/requests/:id/candidates', up.single('photo'), act(req => {
    const id = Number(req.params.id);
    const input = candInput(req);
    if (req.body.publish === '1' && ['similar', 'unknown'].includes(input.matchGrade)) throw new HttpError(409, 'not_publishable', '유사 상품·식별 불가는 MVP에서 사용자에게 공개하지 않아요. 공개 체크를 빼고 저장하세요.');
    const cid = D.saveCandidate(db, id, input, OP(req));
    if (req.body.publish === '1') D.publishCandidate(db, cid, OP(req));
    return [id, `후보 #${cid}를 등록했어요${req.body.publish === '1' ? ' · 사용자에게 공개' : ''}.`];
  }));
  r.post('/candidates/:id', up.single('photo'), (req, res, next) => {
    const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(Number(req.params.id)) as any;
    if (!c) return next(new HttpError(404, 'not_found'));
    (req as any).rid = c.request_id;
    act(rq => { D.saveCandidate(db, c.request_id, candInput(rq), OP(rq), c.id); return [c.request_id, `후보 #${c.id}를 수정했어요.`]; })(req, res, next);
  });
  r.post('/candidates/:id/publish', (req, res, next) => {
    const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(Number(req.params.id)) as any;
    if (!c) return next(new HttpError(404, 'not_found'));
    (req as any).rid = c.request_id;
    act(rq => { D.publishCandidate(db, c.id, OP(rq), rq.body.on === '1'); return [c.request_id, rq.body.on === '1' ? '사용자에게 공개했어요.' : '사용자 화면에서 내렸어요.']; })(req, res, next);
  });
  r.post('/requests/:id/ai/identify', act(req => { const id = Number(req.params.id); A.rerunAi(db, cfg.ai ?? null, id, 'identify', OP(req)); return [id, 'AI가 다시 살펴보기 시작해요. 1~3분 뒤 새로고침하세요.']; }));
  r.post('/requests/:id/ai/search', act(req => { const id = Number(req.params.id); A.rerunAi(db, cfg.ai ?? null, id, 'search', OP(req)); return [id, 'AI가 다시 찾아보기 시작해요. 몇 분 뒤 새로고침하세요.']; }));
  const withRow = (sql: string, fn: (row: any, req: express.Request) => [number, string]): express.RequestHandler => (req, res, next) => {
    const row = db.prepare(sql).get(Number(req.params.id)) as any;
    if (!row) return next(new HttpError(404, 'not_found'));
    (req as any).rid = row.request_id;
    act(rq => fn(row, rq))(req, res, next);
  };
  r.post('/ai/identities/:id/accept', withRow('SELECT * FROM ai_identities WHERE id=?', (it, req) => {
    A.acceptIdentity(db, it.id, { brand: req.body.brand, name: req.body.name }, OP(req));
    return [it.request_id, 'AI 제안으로 상품을 확정했어요. 7일 탐색이 시작됐고, 1일차 탐색도 AI가 먼저 해요.'];
  }));
  r.post('/ai/finds/:id/accept', withRow('SELECT * FROM ai_finds WHERE id=?', (f, req) => {
    const ci = candInput(req);
    const cid = A.acceptFind(db, f.id, { matchGrade: ci.matchGrade, availability: ci.availability, title: ci.title, size: ci.size, price: ci.price, shipping: ci.shipping, condition: ci.condition,
      conditionNote: ci.conditionNote, colorOk: ci.colorOk, evidence: ci.evidence, pending: ci.pending, checkedAt: ci.checkedAt, publish: req.body.publish === '1', isMock: ci.isMock }, OP(req));
    return [f.request_id, `AI가 찾은 매물을 후보 #${cid}로 등록했어요${req.body.publish === '1' ? ' · 사용자에게 공개' : ''}.`];
  }));
  r.post('/ai/finds/:id/reject', withRow('SELECT * FROM ai_finds WHERE id=?', (f, req) => {
    A.rejectFind(db, f.id, [req.body.reason, req.body.note].map(x => String(x || '').trim()).filter(Boolean).join(' · '), OP(req));
    return [f.request_id, 'AI가 찾은 매물을 제외했어요.'];
  }));
  r.post('/requests/:id/wanted/propose', act(req => { const id = Number(req.params.id); D.proposeWanted(db, id, OP(req)); return [id, '수배를 제안했어요.']; }));

  // ── V2: 찾아줘 결과 공개 ──
  r.post('/requests/:id/find/publish', act(req => {
    const id = Number(req.params.id), b = req.body;
    const items = Object.keys(b).filter(k => k.startsWith('tier_')).map(k => {
      const aid = Number(k.slice(5));
      return { aiIdentityId: aid, tier: b[k], brand: b[`brand_${aid}`], name: b[`name_${aid}`], verifyUrl: b[`vurl_${aid}`], verifyReason: b[`vwhy_${aid}`] };
    });
    const disc = ([] as string[]).concat(b.disc || []).map(v => { const [brandKey, scope = ''] = String(v).split('|'); return { brandKey, scope }; });
    F.publishFind(db, id, { items, discover: disc }, OP(req));
    return [id, '찾아줘 결과를 사용자에게 공개했어요.'];
  }));

  // ── V2: 기다려줘 ──
  const flash = (req: express.Request) => `${req.query.m ? `<div class="flash">${esc(req.query.m)}</div>` : ''}${req.query.e ? `<div class="flash err">${esc(req.query.e)}</div>` : ''}`;
  r.get('/watches', (req, res) => {
    const t = now();
    const policy = cfg.policy!;
    const rows = W.adminWatchRows(db);
    const LS: Record<string, string> = { met: '조건 충족', above: '목표가 위', sold_out: '품절', size_missing: '사이즈 없음', color_missing: '색상 없음', color_unknown: '색상 미확인', stock_unknown: '재고 미확인',
      shipping_unknown: '상품가 충족·배송비 미확인', unverified: '같은 상품 페이지 미확인', mismatch: '다른 상품 페이지', sale_only: '할인가만 목표 이하', condition: '상태 불일치', no_price: '가격 없음', check_failed: '확인 실패' };
    const PI: Record<string, string> = { pending: '아직 판단 전', page_defined: '사용자가 준 링크 자체가 상품', matched: '자동 확인: 같은 상품', operator_confirmed: '왈프 팀 확인: 같은 상품', unverified: '<b>같은 상품인지 확인 필요</b>', mismatch: '<b>다른 상품으로 보임</b>' };
    const qa = cfg.qaTools ? `<form method="post" action="/admin/watches/qa/check" style="display:inline"><button class="btn s sm">지금 확인할 차례인 가격 확인 실행(QA)</button></form>` : '';
    const body = `${flash(req)}<h1>기다려줘</h1><p class="sub">사용자당 활성 ${policy.maxActive}개 · ${policy.checkEveryMs / 3600_000}시간마다 상품 페이지 한 번 · AI 호출 없음 · 같은 페이지는 한 번만 읽어 함께 써요. ${qa}</p>
      <section><h2>판매처 자동 확인 범위</h2><table><thead><tr><th>판매처</th><th>상태</th><th>근거</th></tr></thead><tbody>${SOURCES.map(s => `<tr><td><b>${esc(s.label)}</b></td><td><span class="st">${s.status}</span></td><td class="sub">${esc(s.reason)} (${s.checked})</td></tr>`).join('')}</tbody></table></section>
      <section><h2>전체 ${rows.length}</h2><table><thead><tr><th>#</th><th>옷 · 조건</th><th>사용자 화면</th><th>마지막 확인</th><th>상품 페이지</th></tr></thead><tbody>${rows.map(w => {
        const d = W.watchDisplay(w, policy, t);
        const ev = JSON.parse(w.last_result || 'null');
        return `<tr id="w${w.id}"><td>W${w.id}</td><td><b>${esc(w.title)}</b>${w.is_mock ? MOCK : ''}<div class="sub">${esc(w.brand || '')} · ${w.target_price.toLocaleString()}원 이하 ${esc(w.size || '')} ${esc(w.color || '')} ${w.condition === 'new' ? '· 새 상품만' : ''}</div></td>
          <td><span class="st">${esc(d.label)}</span><div class="sub">${esc(d.title)}</div></td>
          <td>${w.last_checked_at ? kWhen(w.last_checked_at, t) : '—'}<div class="sub">${ev ? esc(LS[ev.state] || ev.state) + (ev.total != null ? ` · ${ev.total.toLocaleString()}원${ev.shippingKnown ? '(배송비 포함)' : '(배송비 미확인)'}` : '') : ''}${w.fail_streak ? ` · 연속 실패 ${w.fail_streak}` : ''}</div></td>
          <td>${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(w.url.slice(0, 60))}</a>` : '<b>없음</b>'}${w.info_note ? `<div class="sub">${esc(w.info_note)}</div>` : ''}
          ${w.url ? `<div class="sub">페이지 동일성: ${PI[w.page_identity] || esc(w.page_identity)}${w.identity_note ? ` · ${esc(w.identity_note)}` : ''}</div>
            ${!['operator_confirmed', 'page_defined'].includes(w.page_identity) ? `<div class="row" style="margin-top:6px"><form method="post" action="/admin/watches/${w.id}/page"><input type="hidden" name="same" value="1"><button class="btn sm">같은 상품 페이지 맞음</button></form>
              <form method="post" action="/admin/watches/${w.id}/page"><input type="hidden" name="same" value="0"><button class="btn s sm">다른 상품 — 페이지 떼기</button></form></div>` : ''}
            ${ev?.state === 'shipping_unknown' ? `<form method="post" action="/admin/watches/${w.id}/shipping" class="row" style="margin-top:6px"><input type="number" name="fee" min="0" max="200000" placeholder="확인한 배송비(원, 무료면 0)" required><button class="btn sm" style="flex:none">배송비 확인</button></form>` : ''}` : ''}
          ${['needs_info', 'active', 'paused'].includes(w.status) ? `<form method="post" action="/admin/watches/${w.id}/url" class="row" style="margin-top:6px"><input type="url" name="url" placeholder="공식몰 등 상품 페이지 주소" required><button class="btn sm" style="flex:none">페이지 연결</button></form>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="empty">아직 기다려줘가 없어요.</td></tr>'}</tbody></table></section>`;
    send(req, res, page('기다려줘', body, OP(req), 'watch'));
  });
  const wback = (res: express.Response, m: string, isErr = false) => res.redirect(`/admin/watches?${isErr ? 'e' : 'm'}=${encodeURIComponent(m)}`);
  r.post('/watches/:id/url', (req, res) => {
    try { W.attachUrl(db, Number(req.params.id), req.body.url, OP(req), cfg.policy!); wback(res, `W${req.params.id}에 상품 페이지를 연결했어요. 다음 확인 때 가격을 읽어요.`); }
    catch (e: any) { if (e instanceof HttpError) return wback(res, e.message, true); throw e; }
  });
  r.post('/watches/:id/page', (req, res) => {
    try { W.confirmPage(db, Number(req.params.id), req.body.same === '1', OP(req), cfg.policy!); wback(res, req.body.same === '1' ? `W${req.params.id}: 같은 상품 페이지로 확인했어요. 이제 조건이 맞으면 알림이 가요.` : `W${req.params.id}: 페이지를 떼고 확인 요청으로 돌렸어요.`); }
    catch (e: any) { if (e instanceof HttpError) return wback(res, e.message, true); throw e; }
  });
  r.post('/watches/:id/shipping', (req, res) => {
    try { W.confirmShipping(db, Number(req.params.id), req.body.fee, OP(req), cfg.policy!); wback(res, `W${req.params.id}: 배송비를 확인했어요. 총액으로 다시 판정했어요.`); }
    catch (e: any) { if (e instanceof HttpError) return wback(res, e.message, true); throw e; }
  });
  if (cfg.qaTools) r.post('/watches/qa/check', async (req, res) => {
    W.tickWatches(db, cfg.policy!);
    let n = 0; while (n < 20 && await cfg.checker?.step()) n++;
    wback(res, `가격 확인 ${n}건을 실행했어요(QA). 실제 페이지는 robots.txt 허용일 때만 열어요.`);
  });

  // ── V2: 비용 ──
  r.get('/costs', (req, res) => {
    const limits = cfg.limits!;
    const key = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : C.monthKey();
    const rep = C.costReport(db, limits, key);
    const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
    const body = `${flash(req)}<h1>AI·조회 비용 <span class="sub">${esc(key)} (KST)</span></h1><p class="sub">추정치예요. 단가 ${esc(rep.pricesChecked)} · 캐시 읽기도 입력 단가로 셈(실제보다 크게). 모의 실행은 비용에서 빠져요.</p>
      <div class="g3"><section><h3>이번 달 추정 사용</h3><p class="n">${usd(rep.spent.usd)}</p><p class="sub">유료 호출 ${rep.spent.calls}건${rep.spent.unknown ? ` · 비용 미상 ${rep.spent.unknown}건(중단·실패)` : ''}</p></section>
      <section><h3>월 예산</h3><p class="n">${usd(rep.budget.total)}</p><p class="sub">기본 ${usd(rep.budget.base)}(WALF_AI_MONTHLY_BUDGET_USD) + 운영자 승인 ${usd(rep.budget.extra)}</p></section>
      <section><h3>의뢰별 AI 호출 상한</h3><p class="n">${limits.perRequestCalls}회</p><p class="sub">WALF_AI_MAX_CALLS_PER_REQUEST</p></section></div>
      <section class="${rep.held.length ? 'warn' : ''}"><h2>멈춘 AI 작업 ${rep.held.length}</h2>${rep.held.length ? `<table><tbody>${rep.held.map(j => `<tr><td>#${j.id}</td><td><a href="/admin/requests/${j.request_id}">의뢰 #${j.request_id}</a> · ${j.kind === 'identify' ? '식별' : '탐색'}</td><td class="sub">${esc(j.error)}</td></tr>`).join('')}</tbody></table>
        <form method="post" action="/admin/costs/approve" class="row" style="max-width:520px;margin-top:10px"><div><label>이번 달 예산 추가(USD)</label><input type="number" name="usd" min="1" max="1000" step="1" value="5" required></div><button class="btn" style="flex:none">확인하고 계속</button></form>
        <p class="sub">추가하면 예산 때문에 멈춘 작업이 다시 대기열로 가요. Anthropic Console의 지출 한도도 함께 확인하세요.</p>` : '<p class="empty">없음</p>'}</section>
      <section><h2>AI 작업</h2><table><thead><tr><th>종류</th><th>제공자</th><th>상태</th><th>건수</th><th>입력 토큰</th><th>출력 토큰</th><th>웹 검색</th><th>추정 비용</th><th>재사용</th></tr></thead><tbody>${rep.jobs.map(j => `<tr><td>${j.kind}</td><td>${esc(j.provider)}${j.mock ? MOCK : ''}</td><td>${j.status}</td><td>${j.n}</td><td>${j.inp.toLocaleString()}</td><td>${j.outp.toLocaleString()}</td><td>${j.srch}</td><td>${j.provider === 'mock' ? '—' : usd(j.usd)}</td><td>${j.reused || ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">없음</td></tr>'}</tbody></table></section>
      <div class="grid"><section><h2>의뢰별 상위 20</h2><table><tbody>${rep.perRequest.map(p => `<tr><td><a href="/admin/requests/${p.request_id}">#${p.request_id}</a></td><td>${p.n}회</td><td>검색 ${p.srch}</td><td>${usd(p.usd)}</td></tr>`).join('') || '<tr><td class="empty">없음</td></tr>'}</tbody></table></section>
      <section><h2>가격 확인(AI 없음)</h2><table><tbody>${rep.checks.map(c => `<tr><td>${esc(c.source)}${c.is_mock ? MOCK : ''}</td><td>${c.status}</td><td>${c.n}건</td></tr>`).join('') || '<tr><td class="empty">없음</td></tr>'}</tbody></table><p class="sub">상품 페이지 읽기는 외부 API 비용이 없고 서버 트래픽만 써요.</p></section></div>`;
    send(req, res, page('비용', body, OP(req), 'cost'));
  });
  r.post('/costs/approve', (req, res) => {
    try { const n = C.approveExtra(db, Number(req.body.usd), OP(req)); res.redirect(`/admin/costs?m=${encodeURIComponent(`이번 달 예산을 늘렸어요. 멈춘 작업 ${n}건을 다시 대기열에 넣었어요.`)}`); }
    catch (e: any) { res.redirect(`/admin/costs?e=${encodeURIComponent(e.message || '실패')}`); }
  });

  // ── V2: 브랜드 스타일 매핑 검수 ──
  r.get('/styles', (req, res) => {
    const brands = db.prepare('SELECT * FROM brands ORDER BY name').all() as any[];
    const tags = db.prepare(`SELECT * FROM style_tags WHERE subject='brand' ORDER BY subject_key, kind, value`).all() as any[];
    const body = `${flash(req)}<h1>브랜드 스타일 매핑</h1><p class="sub">“비슷한 옷(DISCOVER)” 추천에 쓰는 근거예요. 출처가 있는 것만 들어 있고, 왈프 팀이 확인하면 “확인됨”이 돼요. 브랜드 전체가 아니라 라인·시즌 단위(범위)로도 매핑해요. 어휘: ${esc(Object.keys(STYLE_LABEL).slice(0, 12).join(', '))} …</p>
      <section><table><thead><tr><th>브랜드</th><th>범위</th><th>종류</th><th>값</th><th>근거</th><th>상태</th></tr></thead><tbody>${tags.map(x => {
        const b = brands.find(y => y.key === x.subject_key);
        return `<tr><td><b>${esc(b?.name || x.subject_key)}</b>${b?.site ? `<div class="sub">${esc(b.site)}</div>` : ''}</td><td>${esc(x.scope || '브랜드 전체')}</td><td>${esc(x.kind)}</td><td>${esc(styleLabel(x.value))}</td>
          <td class="sub">${esc(x.basis || '')}${x.source_url ? ` <a href="${esc(x.source_url)}" target="_blank" rel="noopener noreferrer">출처</a>` : ''}</td>
          <td><form method="post" action="/admin/styles/${x.id}"><input type="hidden" name="to" value="${x.status === 'verified' ? 'sourced' : 'verified'}"><span class="st">${x.status === 'verified' ? '확인됨' : x.status === 'fixture' ? '테스트' : '검수 전'}</span> ${x.status === 'fixture' ? '' : `<button class="btn s sm">${x.status === 'verified' ? '확인 취소' : '확인'}</button>`}</form></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">매핑이 없어요. server/seed/brand-styles.json 을 넣고 서버를 다시 켜세요.</td></tr>'}</tbody></table></section>`;
    send(req, res, page('스타일 매핑', body, OP(req), 'style'));
  });
  r.post('/styles/:id', (req, res) => {
    const to = req.body.to === 'verified' ? 'verified' : 'sourced';
    db.prepare(`UPDATE style_tags SET status=?, updated_by=? WHERE id=? AND status IN ('sourced','verified')`).run(to, OP(req), Number(req.params.id));
    res.redirect(`/admin/styles?m=${encodeURIComponent(to === 'verified' ? '확인했어요.' : '확인을 취소했어요.')}`);
  });
  r.post('/posts/:id', (req, res, next) => {
    const p = db.prepare('SELECT p.*, w.request_id FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id WHERE p.id=?').get(Number(req.params.id)) as any;
    if (!p) return next(new HttpError(404, 'not_found'));
    (req as any).rid = p.request_id;
    act(rq => { D.updatePost(db, p.id, { status: rq.body.status, url: rq.body.url, reason: rq.body.reason, isMock: rq.body.mock === '1' }, OP(rq)); return [p.request_id, `${p.channel} 상태를 바꿨어요.`]; })(req, res, next);
  });
  if (cfg.qaTools) {
    r.post('/requests/:id/qa/shift', act(req => {
      const id = Number(req.params.id); const rq = D.getRequest(db, id);
      if (rq.status !== 'active') throw new HttpError(409, 'bad_state');
      db.prepare('UPDATE requests SET activated_at=activated_at-?, expires_at=expires_at-? WHERE id=?').run(DAY, DAY, id);
      db.prepare('UPDATE search_runs SET scheduled_for=scheduled_for-?, window_end=window_end-? WHERE request_id=?').run(DAY, DAY, id);
      D.log(db, id, 'system', 'qa', '운영 테스트: 일정 24시간 당김', `운영자 ${OP(req)}가 QA를 위해 다음 날로 넘겼어요`, { operator: OP(req), isMock: true });
      D.tick(db);
      return [id, '일정을 24시간 당겼어요(QA).'];
    }));
    r.post('/requests/:id/qa/push', act(req => {
      const id = Number(req.params.id);
      D.sendTestPush(db, id, OP(req));
      return [id, '테스트 푸시를 보냈어요. 결과는 아래 알림 발송 기록에서 확인하세요.'];
    }));
    r.post('/requests/:id/qa/expire', act(req => {
      const id = Number(req.params.id);
      D.expireNow(db, id, OP(req));
      return [id, '7일 종료 처리를 실행했어요(QA).'];
    }));
  }
  r.use((err: any, req: express.Request, res: express.Response, _n: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).send(page('오류', `<div class="flash err">${esc(err.message)}</div><a href="/admin">대기열로</a>`, (req as any).op));
    console.error(err); res.status(500).send(page('오류', '<div class="flash err">서버 오류가 났어요. 서버 로그를 확인하세요.</div>', (req as any).op));
  });
  return r;
}
