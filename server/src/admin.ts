import express from 'express';
import crypto from 'node:crypto';
import type { DB } from './db.ts';
import * as D from './domain.ts';
import { HttpError } from './domain.ts';
import { uploader, baseOf } from './api.ts';
import { now, kDate, kTime, kWhen, HOUR, DAY } from './time.ts';

type Cfg = { uploads: string; password: string; secret: string; qaTools: boolean };
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
`;
const FONT = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">';

function page(title: string, body: string, op?: string, tab = '') {
  const nav = op ? `<nav><a href="/admin" class="${tab === 'home' ? 'on' : ''}">대기열</a><a href="/admin/requests" class="${tab === 'list' ? 'on' : ''}">전체 의뢰</a></nav><span class="sp"></span><small>운영자 ${esc(op)}</small><form method="post" action="/admin/logout"><button class="btn s sm">로그아웃</button></form>` : '';
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
    const sections: [string, string, string][] = [
      ['상품 확인 대기', '접수 후 7일이 아직 시작되지 않았어요', q(`SELECT * FROM requests WHERE status='submitted' ORDER BY created_at`).map(x => link(x, `접수 ${kWhen(x.created_at, t)}`)).join('')],
      ['정보 보완 대기', '사용자 답을 기다려요', q(`SELECT * FROM requests WHERE status='needs_info' ORDER BY updated_at`).map(x => link(x, esc(x.info_request))).join('')],
      ['오늘 할 탐색', '창이 닫히면 “하지 못함”으로 기록돼요', q(`SELECT s.*, r.product_name, r.identified_name, r.product_url, r.is_mock, r.id rid FROM search_runs s JOIN requests r ON r.id=s.request_id WHERE s.status='pending' ORDER BY s.window_end`)
        .map(s => link({ ...s, id: s.rid }, `DAY ${s.day} · 마감 ${kWhen(s.window_end, t)}`)).join('')],
      ['검수 대기 후보', '아직 사용자에게 보이지 않거나 재고 미확인', q(`SELECT c.*, r.product_name, r.identified_name, r.product_url FROM candidates c JOIN requests r ON r.id=c.request_id WHERE r.status='active' AND c.user_dismissed=0 AND (c.published=0 OR c.needs_recheck=1 OR c.availability='listed_unverified' OR c.match_grade='same_likely') ORDER BY c.created_at`)
        .map(c => link({ ...c, id: c.request_id }, `${esc(c.seller)} · ${c.source === 'report' ? '제보' : '탐색'} · ${c.needs_recheck ? '조건 변경 재확인' : c.published ? '공개됨' : '비공개'}`)).join('')],
      ['수배 게시 대기', '게시 주소를 남겨야 완료로 보여요', q(`SELECT p.*, w.request_id, r.product_name, r.identified_name, r.product_url, r.is_mock FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id JOIN requests r ON r.id=w.request_id WHERE p.status='queued'`)
        .map(p => link({ ...p, id: p.request_id }, esc(p.channel))).join('')],
      ['수배글 삭제 요청', '철회·종료된 의뢰의 게시글', q(`SELECT p.*, w.request_id, r.product_name, r.identified_name, r.product_url, r.is_mock FROM wanted_posts p JOIN wanted w ON w.id=p.wanted_id JOIN requests r ON r.id=w.request_id WHERE p.status='removal_requested'`)
        .map(p => link({ ...p, id: p.request_id }, esc(p.channel))).join('')],
      ['24시간 안에 7일 종료', '종료 보고가 자동으로 발송돼요', q(`SELECT * FROM requests WHERE status='active' AND expires_at<=?`, t + DAY).map(x => link(x, `${kWhen(x.expires_at, t)} 종료`)).join('')],
    ];
    const counts = (db.prepare(`SELECT status, COUNT(*) n FROM requests GROUP BY status`).all() as any[]).reduce((m, x) => (m[x.status] = x.n, m), {} as any);
    send(req, res, page('대기열', `<h1>오늘의 대기열</h1><p class="sub">${kDate(t)} ${kTime(t)} 기준 · 활성 ${counts.active || 0} · 접수 ${counts.submitted || 0} · 보완 ${counts.needs_info || 0} · 종료 ${(counts.completed || 0) + (counts.expired || 0) + (counts.cancelled || 0)}</p>
      <div class="grid">${sections.map(([h, s, body]) => `<section><h2>${h}</h2><p class="sub" style="margin:-8px 0 8px">${s}</p>${body || '<p class="empty">없음</p>'}</section>`).join('')}</div>`, OP(req), 'home'));
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
      <dt>구매 조건</dt><dd>${esc(v.conditions.label) || '나중에 입력'}</dd><dt>기간</dt><dd>${rq.activated_at ? `DAY ${D.dayOf(rq, t)} · ${esc(v.schedule.startedLabel)} → ${esc(v.schedule.endsLabel)}` : '7일 시작 전'}</dd>${pushRow}</dl></div>
      <div style="flex:2"><p class="sub" style="margin:0 0 6px">사용자 앱에 지금 보이는 문장 (서버 계산값 그대로)</p><div class="app"><small>${esc(v.display.eyebrow)}</small><b>${esc(v.display.title)}</b><span>${esc(v.display.desc)}</span>
      <p style="margin:8px 0 0"><span class="st">${esc(v.display.label)}</span> <span class="sub">${esc(v.display.key)}</span></p></div></div></div>`;

    let ident = '';
    if (['submitted', 'needs_info'].includes(rq.status)) ident = `<section class="warn"><h2>1 · 상품 확인</h2><p class="sub">확인하면 지금부터 168시간(7일) 탐색이 시작되고 1일차 탐색 작업이 생겨요.${rq.status === 'needs_info' ? ` 현재 보완 요청: “${esc(rq.info_request)}”` : ''}</p>
      <div class="grid"><form method="post" action="/admin/requests/${rq.id}/activate"><label>확인한 브랜드</label><input type="text" name="brand" value="${esc(rq.identified_brand || rq.brand || '')}">
      <label>확인한 상품명(모델·색상)</label><input type="text" name="name" required value="${esc(rq.identified_name || rq.product_name || '')}"><label>근거 메모(내부)</label><input type="text" name="note" value="${esc(rq.identified_note || '')}">
      <p><button class="btn">상품 확인 → 7일 탐색 시작</button></p></form>
      <form method="post" action="/admin/requests/${rq.id}/info-request"><label>정보 보완 요청(사용자에게 그대로 보여요)</label><textarea name="message" required maxlength="300" placeholder="예: 정확한 모델을 확인할 수 있게 태그 사진이나 구매 링크를 보내주세요."></textarea>
      <p><button class="btn s">보완 요청 보내기</button></p></form></div></section>`;

    const runsHtml = runs.map(s => {
      if (s.status !== 'pending') {
        const ks = db.prepare('SELECT k.*, se.name FROM seller_checks k JOIN sellers se ON se.id=k.seller_id WHERE run_id=? ORDER BY se.sort').all(s.id) as any[];
        return `<details><summary>DAY ${s.day} · ${s.status === 'done' ? `완료 ${kWhen(s.completed_at, t)} · ${esc(s.operator)} · 결과 ${esc(s.outcome)}` : s.status === 'missed' ? '하지 못함(창 마감)' : '취소'}${s.is_mock ? MOCK : ''}</summary>
          ${ks.length ? `<table><tbody>${ks.map(k => `<tr><td>${esc(k.name)}</td><td>${esc(k.status)}</td><td>${esc(k.result || '')}</td><td>${esc(k.note || '')}</td></tr>`).join('')}</tbody></table>` : ''}${s.summary ? `<p>${esc(s.summary)}</p>` : ''}</details>`;
      }
      return `<form method="post" action="/admin/runs/${s.id}/complete" class="warn" style="border-radius:12px;padding:14px 16px;margin:10px 0"><h3>DAY ${s.day} 탐색 기록 · 마감 ${kWhen(s.window_end, t)}</h3>
        <p class="sub">실제로 가격·재고를 확인한 곳만 “확인함”으로 고르세요. 접속이 안 되면 “접속 실패”로 남겨야 사용자에게 매물 없음으로 보이지 않아요.</p>
        <table><thead><tr><th>판매처</th><th>확인</th><th>결과</th><th>메모(사용자에게 보임)</th></tr></thead><tbody>${sellers.map(se => `<tr><td><b>${esc(se.name)}</b></td>
        <td><select name="st_${se.id}" required><option value="" selected disabled>선택</option><option value="checked">확인함</option><option value="unreachable">접속 실패</option><option value="skipped">확인 안 함</option></select></td>
        <td><select name="rs_${se.id}"><option value="none">매물 없음</option><option value="same">동일 상품 있음</option><option value="similar">유사 상품만</option></select></td>
        <td><input type="text" name="nt_${se.id}" maxlength="200" placeholder="예: M 품절, 동일 상품 1건 · 사이즈 L"></td></tr>`).join('')}</tbody></table>
        <div class="row"><div><label>결과</label><select name="outcome" required><option value="" selected disabled>선택</option>${s.day === 1 ? '<option value="no_match">조건에 맞는 매물 없음 → 수배 제안</option>' : '<option value="nothing_new">새 소식 없음</option><option value="no_match">조건에 맞는 매물 없음</option>'}
        <option value="leads">유력 후보 있음(아래에서 후보 등록)</option><option value="offer">구매 가능 매물 있음(아래에서 후보 등록)</option></select></div><div><label>내부 메모</label><input type="text" name="summary" maxlength="300"></div></div>
        <p>${mockBox()}</p><p><button class="btn">탐색 기록 저장</button></p></form>`;
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
      <section><h2>2 · 탐색 작업</h2>${runsHtml}</section>
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
  r.post('/requests/:id/wanted/propose', act(req => { const id = Number(req.params.id); D.proposeWanted(db, id, OP(req)); return [id, '수배를 제안했어요.']; }));
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
