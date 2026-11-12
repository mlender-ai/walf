// 비용 가드레일 — 유료 AI 호출 전에 월 예산·의뢰별 호출 상한을 확인하고, 호출마다 추정 비용을 남긴다.
// 모의(mock) 실행은 비용 집계에 넣지 않는다. 가격 확인(상품 페이지 읽기)은 AI를 부르지 않으므로 여기서 막지 않고 횟수만 센다.
import { type DB, getSetting, setSetting } from './db.ts';
import { now, HOUR } from './time.ts';

type Row = Record<string, any>;
const one = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];

/** USD / 100만 토큰. 출처: https://platform.claude.com/docs/en/about-claude/pricing (2026-11-13 확인) */
export const PRICES: Record<string, { in: number; out: number; note?: string }> = {
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.5, out: 2.5, note: '프롬프트 10만 토큰 초과 단가로 계산(보수적). 10만 이하면 $0.10/$0.50' },
  'claude-fable-5-1': { in: 10, out: 50 },
};
export const WEB_SEARCH_PER_1K = 10; // 웹 검색 1,000회당 $10 + 결과 토큰. 웹 페이지 열람(web_fetch)은 토큰 비용만
export const PRICES_CHECKED = '2026-11-13 · platform.claude.com/docs/en/about-claude/pricing';

import type { Usage } from './ai.ts';
/** 추정 비용(USD). 캐시 읽기도 입력 단가로 셈 → 실제보다 크게 나온다(보수적). 모르는 모델은 null */
export function estimateUsd(u: Usage, env = process.env): number | null {
  const p = priceOf(u.model, env);
  if (!p) return null;
  return round((u.inputTokens * p.in + u.outputTokens * p.out) / 1e6 + (u.searches * WEB_SEARCH_PER_1K) / 1000);
}
function priceOf(model: string, env = process.env) {
  // 환경변수로 덮어쓸 수 있다(가격이 바뀌었을 때) — WALF_AI_PRICE_IN · WALF_AI_PRICE_OUT
  if (env.WALF_AI_PRICE_IN && env.WALF_AI_PRICE_OUT) return { in: Number(env.WALF_AI_PRICE_IN), out: Number(env.WALF_AI_PRICE_OUT) };
  const id = Object.keys(PRICES).find(k => model === k || model.startsWith(k + '-') || model.startsWith(k + '@'));
  return id ? PRICES[id] : null;
}
const round = (n: number) => Math.round(n * 10000) / 10000;

// ── 예산 ─────────────────────────────────────────────────────
export const monthKey = (t = now()) => new Date(t + 9 * HOUR).toISOString().slice(0, 7); // KST 기준 YYYY-MM
export function monthRange(key: string) {
  const [y, m] = key.split('-').map(Number);
  return [Date.UTC(y, m - 1, 1) - 9 * HOUR, Date.UTC(y, m, 1) - 9 * HOUR] as const;
}
export type Limits = { monthlyUsd: number; perRequestCalls: number; defaultExpected: Record<string, number> };
export function limitsFromEnv(env = process.env): Limits {
  const n = (v: string | undefined, d: number) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    monthlyUsd: n(env.WALF_AI_MONTHLY_BUDGET_USD, 10),
    perRequestCalls: n(env.WALF_AI_MAX_CALLS_PER_REQUEST, 10),
    // 실제 기록이 쌓이기 전 한 번 호출의 예상 비용(Opus 5.5 · 식별: 입력 4만·출력 4천·검색 6회, 탐색: 입력 6만·출력 6천·검색 12회 가정)
    defaultExpected: { identify: n(env.WALF_AI_EXPECT_IDENTIFY_USD, 0.3), search: n(env.WALF_AI_EXPECT_SEARCH_USD, 0.5) },
  };
}
const PAID = `provider<>'mock' AND is_mock=0`;
export function spent(db: DB, key = monthKey()) {
  const [a, b] = monthRange(key);
  const r = one(db, `SELECT COALESCE(SUM(est_cost_usd),0) usd, COUNT(*) n, SUM(CASE WHEN est_cost_usd IS NULL AND status IN ('done','failed','interrupted') AND attempts>0 THEN 1 ELSE 0 END) unknown
    FROM ai_jobs WHERE ${PAID} AND COALESCE(started_at, created_at)>=? AND COALESCE(started_at, created_at)<?`, a, b)!;
  return { usd: round(r.usd), calls: r.n, unknown: r.unknown || 0 };
}
export function budgetOf(db: DB, limits: Limits, key = monthKey()) {
  const extra = Number(getSetting(db, `budget_extra:${key}`) || 0);
  return { base: limits.monthlyUsd, extra, total: round(limits.monthlyUsd + extra) };
}
/** 최근 실제 호출의 평균(없으면 기본 가정값) */
export function expectedUsd(db: DB, kind: string, limits: Limits) {
  const r = one(db, `SELECT AVG(est_cost_usd) a, COUNT(*) n FROM (SELECT est_cost_usd FROM ai_jobs WHERE ${PAID} AND kind=? AND est_cost_usd IS NOT NULL ORDER BY id DESC LIMIT 20)`, kind)!;
  return r.n >= 3 ? round(r.a) : limits.defaultExpected[kind] ?? 0.5;
}

export type Gate = { ok: true } | { ok: false; code: 'budget' | 'request_cap'; reason: string };
/** 유료 AI 작업 하나를 시작해도 되는지. 모의 제공자는 늘 통과(비용 0) */
export function canStart(db: DB, job: Row, limits: Limits, t = now()): Gate {
  if (job.provider === 'mock' || job.is_mock) return { ok: true };
  const calls = one(db, `SELECT COUNT(*) n FROM ai_jobs WHERE request_id=? AND ${PAID} AND attempts>0 AND id<>?`, job.request_id, job.id)!.n;
  if (calls >= limits.perRequestCalls) return { ok: false, code: 'request_cap', reason: `의뢰별 AI 호출 상한(${limits.perRequestCalls}회)에 닿았어요. 운영자가 직접 확인하거나 WALF_AI_MAX_CALLS_PER_REQUEST 를 올려야 해요.` };
  const key = monthKey(t);
  const s = spent(db, key), b = budgetOf(db, limits, key), exp = expectedUsd(db, job.kind, limits);
  if (s.usd + exp > b.total) return { ok: false, code: 'budget', reason: `이번 달 AI 예산 $${b.total} 중 $${s.usd} 사용 — 이 작업(예상 $${exp})을 하면 넘어요. 어드민 비용 화면에서 확인한 뒤 계속할 수 있어요.` };
  return { ok: true };
}
/** 운영자가 이번 달 예산을 더 쓰기로 확인 → 멈춘 작업을 다시 대기열로 */
export function approveExtra(db: DB, usd: number, operator: string, t = now()) {
  if (!Number.isFinite(usd) || usd <= 0 || usd > 1000) throw Object.assign(new Error('bad_amount'), { status: 400, code: 'bad_amount', message: '추가 예산은 0보다 크고 1000 이하로 입력하세요.' });
  const key = monthKey(t);
  const cur = Number(getSetting(db, `budget_extra:${key}`) || 0);
  setSetting(db, `budget_extra:${key}`, String(round(cur + usd)), operator, t);
  return Number(db.prepare(`UPDATE ai_jobs SET status='queued', error=NULL WHERE status='held' AND error LIKE '이번 달 AI 예산%'`).run().changes);
}

// ── 리포트 ───────────────────────────────────────────────────
export function costReport(db: DB, limits: Limits, key = monthKey()) {
  const [a, b] = monthRange(key);
  const jobs = all(db, `SELECT kind, provider, status, COUNT(*) n, COALESCE(SUM(input_tokens),0) inp, COALESCE(SUM(output_tokens),0) outp, COALESCE(SUM(searches),0) srch,
      COALESCE(SUM(est_cost_usd),0) usd, SUM(CASE WHEN reused_from IS NOT NULL THEN 1 ELSE 0 END) reused, SUM(is_mock) mock
    FROM ai_jobs WHERE COALESCE(started_at, created_at)>=? AND COALESCE(started_at, created_at)<? GROUP BY kind, provider, status ORDER BY kind, provider, status`, a, b);
  const perRequest = all(db, `SELECT request_id, COUNT(*) n, COALESCE(SUM(est_cost_usd),0) usd, COALESCE(SUM(searches),0) srch FROM ai_jobs
    WHERE ${PAID} AND COALESCE(started_at, created_at)>=? AND COALESCE(started_at, created_at)<? GROUP BY request_id ORDER BY usd DESC LIMIT 20`, a, b);
  const checks = all(db, `SELECT source, status, is_mock, COUNT(*) n FROM price_checks WHERE created_at>=? AND created_at<? GROUP BY source, status, is_mock ORDER BY source`, a, b);
  const held = all(db, `SELECT id, request_id, kind, error FROM ai_jobs WHERE status='held' ORDER BY id`);
  return { key, spent: spent(db, key), budget: budgetOf(db, limits, key), limits, jobs, perRequest, checks, held, pricesChecked: PRICES_CHECKED };
}
