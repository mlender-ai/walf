// 7일 실험 — 오픈소스 탐색 엔진(engine/hunt.py)을 작업마다 한 번 실행하는 AI 공급자.
// 유료 API를 부르지 않는다: 사진은 로컬 Ollama, 검색은 로컬 SearXNG, 페이지는 로컬 Crawl4AI.
// 엔진의 진행 기록(stderr)은 원본 로그로 data/hunt-logs 에 남기고, 실패·시간 초과는 실패로 알린다.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type AiProvider, type IdentifyInput, type SearchInput, AiError, cleanIdentify, cleanSearch, urlKey } from './ai.ts';

export type OssOptions = { python: string; script: string; logDir: string; timeoutMs: number; env?: Record<string, string | undefined>; vlm: string; version?: string };

export function ossFromEnv(env = process.env): AiProvider {
  const root = path.resolve(import.meta.dirname, '../..');
  return ossProvider({
    python: env.WALF_OSS_PYTHON || path.join(os.homedir(), '.walf-oss/venv/bin/python'),
    script: env.WALF_OSS_SCRIPT || path.join(root, 'engine/hunt.py'),
    logDir: path.resolve(root, 'server', env.WALF_OSS_LOGS || 'data/hunt-logs'),
    timeoutMs: Number(env.WALF_OSS_TIMEOUT_MS || 25 * 60_000),
    vlm: env.WALF_OSS_VLM || 'qwen3-vl:8b-instruct',
    // 7일 동안 고친 날이 있으면 어느 코드로 돈 결과인지 구분할 수 있게 커밋을 남긴다
    version: (() => { try { return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() + (execSync('git status --porcelain -- engine server/src', { cwd: root }).toString().trim() ? '+수정중' : ''); } catch { return 'unknown'; } })(),
  });
}

export function ossProvider(o: OssOptions): AiProvider {
  /** 엔진 한 번 실행 — 입력은 stdin JSON, 결과는 stdout 마지막 줄 JSON */
  function run(cmd: 'identify' | 'search', input: unknown): Promise<any> {
    fs.mkdirSync(o.logDir, { recursive: true });
    const logFile = path.join(o.logDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${cmd}.log`);
    const log = fs.createWriteStream(logFile);
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const p = spawn(o.python, [o.script, cmd], { cwd: path.dirname(o.script), env: { ...process.env, ...o.env, WALF_OSS_VLM: o.vlm }, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let killed = false;
      p.stdout.on('data', d => { out += d; });
      p.stderr.pipe(log);
      const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, o.timeoutMs);
      p.on('error', e => { clearTimeout(timer); log.end(); reject(new AiError('engine', `탐색 엔진을 실행하지 못했어요(${e.message}). engine/start.sh 로 설치했는지 확인하세요.`)); });
      p.on('close', code => {
        clearTimeout(timer); log.end();
        const where = `로그 ${path.basename(logFile)}`;
        if (killed) return reject(new AiError('timeout', `탐색 엔진이 ${Math.round(o.timeoutMs / 60_000)}분 안에 끝나지 않아 멈췄어요(${where}).`));
        let j: any;
        try { j = JSON.parse(out.trim().split('\n').pop() || ''); } catch { return reject(new AiError('engine', `탐색 엔진 결과를 읽지 못했어요(종료 코드 ${code}, ${where}).`)); }
        if (j?.error) return reject(new AiError('engine', `탐색 엔진 실패: ${String(j.error).slice(0, 200)} (${where})`));
        resolve({ ...j, _log: path.basename(logFile), _ms: Date.now() - t0 });
      });
      p.stdin.end(JSON.stringify(input));
    });
  }
  const usage = (j: any) => ({ model: `oss:${o.vlm}`, inputTokens: 0, outputTokens: 0, searches: Array.isArray(j?.metrics?.queries) ? j.metrics.queries.length : 0 });
  const withLog = (j: any) => ({ ...(j.metrics || {}), log: j._log, wall_ms: j._ms, version: o.version || 'unknown' });

  return {
    kind: 'oss', label: `오픈소스 엔진(SearXNG·Crawl4AI·${o.vlm}, 유료 API 없음)`,
    async identify(i: IdentifyInput) {
      const j = await run('identify', { ...i, photo: i.photoPath || null, sellers: i.sellers || [] });
      return { data: { ...cleanIdentify(j), features: j.features ?? null, metrics: withLog(j) }, usage: usage(j) };
    },
    async search(i: SearchInput) {
      const j = await run('search', { ...i, photo: i.photoPath || null });
      // 엔진은 검색 결과로 받은 주소만 내보낸다 → 모두 “검색 결과에 있던 주소”
      const seen = new Set<string>((j.listings || []).map((x: any) => urlKey(String(x?.url || ''))));
      return { data: { ...cleanSearch(j, i.sellers, seen, []), metrics: withLog(j) }, usage: usage(j) };
    },
  };
}
