// 비용·품질 회귀 확인을 한 번에 — 단위 테스트(npm test와 같은 파일) → E2E 3개 → 비용 시나리오 계산을 차례로 돌리고 요약을 남긴다.
// node tools/verify.ts [요약 파일.md]  ·  하나라도 실패하면 종료 코드 1. 외부 사이트·유료 API는 부르지 않는다(모의 AI·모의 판매처).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const run = (args: string[]) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, WALF_PUSH_DISABLED: '1' }, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`, sec: Math.round((Date.now() - t0) / 100) / 10 };
};
const git = (a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim();

const units = fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.ts')).sort().map(f => `test/${f}`);
const unit = run(['--test', ...units]);
const n = (k: string) => Number(unit.out.match(new RegExp(`ℹ ${k} (\\d+)`))?.[1] ?? NaN);
const e2e = ['test/e2e-badblood.ts', 'test/e2e-v2.ts', 'test/e2e-v21.ts'].map(f => { const r = run([f]); return { file: f, ...r, steps: Number(r.out.match(/(\d+) steps passed/)?.[1] ?? 0) }; });
const cost = run(['tools/cost-scenarios.ts']);
const ok = unit.ok && e2e.every(x => x.ok) && cost.ok;

const lines = [
  `# 회귀 확인 요약 — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  `- 커밋: \`${git(['rev-parse', '--short', 'HEAD'])}\`${git(['status', '--porcelain']) ? ' (커밋 안 된 변경 있음)' : ''} · 브랜치 \`${git(['branch', '--show-current'])}\` · Node ${process.version}`,
  `- 결과: **${ok ? '모두 통과' : '실패 있음'}**`,
  '',
  '| 확인 | 결과 | 시간 |',
  '|---|---|---|',
  `| 단위 테스트(${units.length}개 파일) | ${unit.ok ? '통과' : '실패'} · ${n('pass')}개 통과 · ${n('fail')}개 실패 | ${unit.sec}초 |`,
  ...e2e.map(x => `| E2E \`${x.file}\` | ${x.ok ? `통과 · ${x.steps}단계` : '실패'} | ${x.sec}초 |`),
  `| 비용 시나리오 계산(\`tools/cost-scenarios.ts\`) | ${cost.ok ? '계산됨' : '실패'} | ${cost.sec}초 |`,
  '',
  '비용 시나리오(가정 사용량 × 2026-11-19 공식 단가, 실제 관측 사용량 아님):',
  '',
  '```',
  cost.out.trim(),
  '```',
];
const md = lines.join('\n') + '\n';
const outFile = process.argv[2];
if (outFile) fs.writeFileSync(path.resolve(process.cwd(), outFile), md);
process.stdout.write(md);
if (!ok) {
  for (const x of [unit, ...e2e, cost].filter(x => !x.ok)) process.stderr.write(x.out.slice(-4000) + '\n');
  process.exit(1);
}
