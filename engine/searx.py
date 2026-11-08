"""SearXNG 검색 — 판매처별 site: 검색. 차단·실패·결과 없음을 구분해 남긴다.

결과 없음 ≠ 매물 없음: 검색 엔진에 색인되지 않았거나, 엔진이 막혔을 수 있다.
"""
from __future__ import annotations

import asyncio
import time

import httpx

BLOCK_WORDS = ("captcha", "access denied", "too many requests", "suspended", "forbidden", "429", "403")


async def query(client: httpx.AsyncClient, base: str, q: str, *, n_engines: int, timeout: float = 20.0) -> dict:
    """한 번 검색. status: ok(결과 있음) · empty(엔진은 답했지만 결과 없음) · blocked(응답한 엔진이 없고 차단 사유) · failed"""
    t0 = time.monotonic()
    try:
        r = await client.get(f"{base}/search", params={"q": q, "format": "json", "language": "ko-KR", "safesearch": 0},
                             headers={"X-Real-IP": "127.0.0.1"}, timeout=timeout)
    except Exception as e:  # 연결 실패·시간 초과
        return {"q": q, "status": "failed", "error": f"{type(e).__name__}: {e}"[:200], "results": [], "engines_ok": [], "engines_bad": [], "ms": int((time.monotonic() - t0) * 1000)}
    ms = int((time.monotonic() - t0) * 1000)
    if r.status_code != 200:
        st = "blocked" if r.status_code in (403, 429) else "failed"
        return {"q": q, "status": st, "error": f"SearXNG HTTP {r.status_code}", "results": [], "engines_ok": [], "engines_bad": [], "ms": ms}
    d = r.json()
    results = [{"url": x.get("url", ""), "title": x.get("title", ""), "content": (x.get("content") or "")[:400], "engines": x.get("engines", []),
                "img": x.get("thumbnail") or x.get("img_src") or ""}
               for x in d.get("results", []) if x.get("url")]
    bad = [[e, str(why)] for e, why in d.get("unresponsive_engines", [])]
    ok = sorted({e for x in results for e in x["engines"]})
    if results:
        st = "ok"
    elif len(bad) >= n_engines:  # 켜 둔 엔진이 모두 실패
        st = "blocked" if any(any(w in why.lower() for w in BLOCK_WORDS) for _, why in bad) else "failed"
    else:
        st = "empty"  # 답한 엔진이 있지만 결과가 없다(색인 안 됨일 수도, 매물이 없을 수도)
    return {"q": q, "status": st, "results": results, "engines_ok": ok, "engines_bad": bad, "ms": ms}


async def search_sites(base: str, plan: list[tuple[str, str]], *, delay: float = 1.5, log=print) -> list[dict]:
    """plan: [(판매처 도메인, 검색어)] — 한 판매처에서 차단(blocked)이 나오면 그 판매처의 남은 검색은 하지 않는다(요청 제한 존중)."""
    out: list[dict] = []
    stopped: set[str] = set()
    async with httpx.AsyncClient() as client:
        n_engines = await enabled_engines(client, base)
        for i, (domain, q) in enumerate(plan):
            if domain in stopped:
                out.append({"domain": domain, "q": q, "status": "skipped", "results": [], "engines_ok": [], "engines_bad": [], "ms": 0, "error": "같은 판매처 검색이 차단돼 멈춤"})
                continue
            if i:
                await asyncio.sleep(delay)
            r = await query(client, base, q, n_engines=n_engines)
            r["domain"] = domain
            out.append(r)
            log(f"  검색 [{r['status']}] {q} → {len(r['results'])}건 · 응답 {','.join(r['engines_ok']) or '-'} · 실패 {r['engines_bad'] or '-'} · {r['ms']}ms")
            if r["status"] == "blocked":
                stopped.add(domain)
    return out


async def enabled_engines(client: httpx.AsyncClient, base: str) -> int:
    try:
        cfg = (await client.get(f"{base}/config", timeout=10)).json()
        return max(1, sum(1 for e in cfg.get("engines", []) if e.get("enabled") and "general" in (e.get("categories") or [])))
    except Exception:
        return 7
