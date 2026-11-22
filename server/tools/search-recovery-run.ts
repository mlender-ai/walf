// Search Recovery 실측: 실제 의뢰(DB 사본)로 판매처 탐색·비슷한 옷 추천을 새 경로로 한 번 돌리고 결과를 요약한다.
// 사용: node tools/search-recovery-run.ts <DB 사본> <의뢰 id...>   (원본 DB를 넣지 않는다 — 탐색 기록이 쌓인다)
// 환경: WALF_EXPERIMENT_SOURCES=joongna(로컬 실험) · WALF_BRAIN_URL=http://127.0.0.1:8790(로컬 이미지 모델) · WALF_UPLOADS=사진 폴더
import path from 'node:path';
import { openDb } from '../src/db.ts';
import * as S from '../src/findsearch.ts';
import { offersOf } from '../src/offers.ts';

const [file, ...ids] = process.argv.slice(2);
if (!file || !ids.length || /phone\.db$|walf\.db$/.test(file)) { console.error('DB 사본 경로와 의뢰 id 를 주세요(원본 DB 금지)'); process.exit(1); }
const db = openDb(file);
const e = S.searchEnvFrom({ mockAllowed: false, uploads: path.resolve(process.env.WALF_UPLOADS || 'data/uploads') });
const one = (q: string, ...p: any[]) => db.prepare(q).get(...p) as any;
for (const id of ids.map(Number)) {
  console.log(`\n### 의뢰 #${id}`);
  const ts = S.targetsToSearch(db, id, e);
  console.log('탐색 대상', ts.map(t => `${t.basis}:${[t.brand, t.name].filter(Boolean).join(' ') || '(사진 특징)'}`).join(' | '));
  for (const [kind, q] of [['find', S.queueFindSearch], ['similar', S.queueSimilarSearch]] as const) {
    const t0 = Date.now();
    const r = q(db, e, id, { by: 'search-recovery', force: true });
    if (!r.id || r.skipped) { console.log(kind, '건너뜀', r.skipped); continue; }
    db.prepare(`UPDATE offer_searches SET status='running' WHERE id=?`).run(r.id);
    await S.runFindSearch(db, e, r.id);
    const s = one('SELECT * FROM offer_searches WHERE id=?', r.id);
    console.log(`[${kind}] #${s.id} ${Math.round((Date.now() - t0) / 1000)}초 · ${s.summary}`);
    for (const x of JSON.parse(s.report || '[]').filter((x: any) => x.outcome !== 'not_run' || ['joongna', 'fashion-brain', 'walf-web-similar'].includes(x.id)))
      console.log(`  소스 ${x.id} ${x.outcome} · 검색어 ${JSON.stringify(x.queries)} · ${x.hits}건${x.skipped?.length ? ` · 건너뜀 ${x.skipped.length}` : ''} · ${x.reason.slice(0, 90)}`);
    for (const o of offersOf(db, s.id).slice(0, 12))
      console.log(`   ${String(o.verdict).padEnd(10)} img=${o.imageScore?.toFixed(3) ?? '-'} d=${o.score ?? '-'} ${o.seller} · ${o.name?.slice(0, 50)} · ${o.price ?? '-'}원 · ${o.url}${o.diffPoints[0]?.startsWith('사진으로는') || o.diffPoints[0]?.startsWith('제목에') ? ' · ' + o.diffPoints[0] : ''}`);
  }
}
