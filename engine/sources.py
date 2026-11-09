"""검색 소스 — 네이버 API HUB(웹문서·카페글) · Tavily(무료 플랜) · SearXNG(비교·보조).

모든 소스는 같은 모양을 돌려준다:
    {"source", "q", "status": ok|empty|blocked|failed|quota|no_key|skipped, "results": [{"url","title","content"}], "ms", "error", "cost"}

돈이 나가지 않게 지킨다
- 키는 저장소 밖 ~/.walf-oss/keys.env 또는 환경변수에서만 읽는다.
- 소스마다 하루·한 달 호출 상한을 스스로 센다(~/.walf-oss/usage.json). 넘으면 부르지 않는다(quota).
- 요청 제한(429)·한도·결제 관련 응답(Tavily 432/433, 네이버 한도)이 오면 그 소스는 이번 실행에서 멈춘다.
- Tavily 는 1크레딧짜리 basic 검색만 쓰고 auto_parameters 를 끈다. 네이버 API HUB 는 ‘한시적 무료’ — 유료 전환 공지가 나면 WALF_NAVER_HUB=off.
"""
from __future__ import annotations

import html as htmllib
import json
import os
import re
import time
from datetime import date

import httpx

HOME = os.path.expanduser(os.environ.get("WALF_OSS_HOME", "~/.walf-oss"))
NAVER = "https://naverapihub.apigw.ntruss.com"
TAVILY = "https://api.tavily.com/search"
# 스스로 정한 상한(무료 범위 안쪽으로 넉넉히 낮게)
LIMITS = {"naver": {"day": int(os.environ.get("WALF_NAVER_DAY_CAP", "1000"))}, "tavily": {"month": int(os.environ.get("WALF_TAVILY_MONTH_CAP", "800"))},
          # SerpApi 무료 250회/월·50회/시간 — 스스로 200회에서 멈춘다(캐시된 검색은 SerpApi 가 세지 않지만 여기서는 보수적으로 센다)
          "serpapi": {"month": int(os.environ.get("WALF_SERPAPI_MONTH_CAP", "200"))}}


def load_keys() -> dict:
    keys = {}
    f = os.path.join(HOME, "keys.env")
    if os.path.exists(f):
        for line in open(f, encoding="utf-8"):
            m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
            if m and m.group(2):
                keys[m.group(1)] = m.group(2)
    keys.update({k: v for k, v in os.environ.items() if k.startswith(("WALF_NAVER_HUB_", "WALF_TAVILY_", "WALF_SERPAPI_", "WALF_BRAVE_")) and v})
    return keys


def _usage() -> dict:
    try:
        return json.load(open(os.path.join(HOME, "usage.json")))
    except Exception:
        return {}


def _count(source: str, n: int = 1):
    u = _usage()
    d, mth = date.today().isoformat(), date.today().isoformat()[:7]
    s = u.setdefault(source, {})
    day, month = s.setdefault("day", {}), s.setdefault("month", {})
    day[d] = day.get(d, 0) + n
    month[mth] = month.get(mth, 0) + n
    os.makedirs(HOME, exist_ok=True)
    json.dump(u, open(os.path.join(HOME, "usage.json"), "w"), indent=1)


def over_cap(source: str) -> bool:
    u, lim = _usage().get(source, {}), LIMITS.get(source, {})
    d, mth = date.today().isoformat(), date.today().isoformat()[:7]
    return ("day" in lim and u.get("day", {}).get(d, 0) >= lim["day"]) or ("month" in lim and u.get("month", {}).get(mth, 0) >= lim["month"])


def _clean(s: str | None) -> str:
    return htmllib.unescape(re.sub(r"</?b>", "", s or "")).strip()


def _res(source, q, status, results=(), ms=0, error="", cost=0):
    return {"source": source, "q": q, "status": status, "results": list(results), "ms": ms, "error": error[:200], "cost": cost}


class Sources:
    """한 번의 실행 동안 쓰는 검색 소스 묶음. 멈춘 소스는 기억해 다시 부르지 않는다."""

    def __init__(self, enabled: list[str], searx_base: str, log=print):
        self.keys = load_keys()
        self.enabled = enabled
        self.searx_base = searx_base
        self.log = log
        self.stopped: dict[str, str] = {}
        self.client = httpx.Client(timeout=20)

    def available(self) -> dict[str, str]:
        """소스별 상태: ready 또는 쓸 수 없는 이유"""
        out = {}
        for s in self.enabled:
            if s.startswith("naver") and (os.environ.get("WALF_NAVER_HUB") == "off"):
                out[s] = "꺼둠(WALF_NAVER_HUB=off)"
            elif s.startswith("naver") and not (self.keys.get("WALF_NAVER_HUB_ID") and self.keys.get("WALF_NAVER_HUB_SECRET")):
                out[s] = "키 없음(~/.walf-oss/keys.env 의 WALF_NAVER_HUB_ID·WALF_NAVER_HUB_SECRET)"
            elif s == "tavily" and not self.keys.get("WALF_TAVILY_KEY"):
                out[s] = "키 없음(~/.walf-oss/keys.env 의 WALF_TAVILY_KEY)"
            else:
                out[s] = "ready"
        return out

    def search(self, source: str, q: str, *, domains: list[str] | None = None) -> dict:
        if source in self.stopped:
            return _res(source, q, "skipped", error=self.stopped[source])
        why = self.available().get(source, "켜지 않음")
        if why != "ready":
            return _res(source, q, "no_key", error=why)
        base = "naver" if source.startswith("naver") else source
        if base in LIMITS and over_cap(base):
            self.stopped[source] = "스스로 정한 호출 상한 도달"
            return _res(source, q, "quota", error=self.stopped[source])
        t0 = time.monotonic()
        try:
            r = {"naver_web": self._naver, "naver_cafe": self._naver, "tavily": self._tavily, "searxng": self._searx}[source](source, q, domains)
        except httpx.HTTPError as e:
            r = _res(source, q, "failed", error=f"{type(e).__name__}: {e}")
        r["ms"] = int((time.monotonic() - t0) * 1000)
        if r["status"] in ("quota", "blocked"):
            self.stopped[source] = r["error"] or r["status"]
        self.log(f"  [{source}] {r['status']} {q} → {len(r['results'])}건 · {r['ms']}ms{' · ' + r['error'][:80] if r['error'] else ''}")
        return r

    def _naver(self, source, q, _domains):
        kind = "webkr" if source == "naver_web" else "cafearticle"
        params = {"query": q, "display": 30 if kind == "webkr" else 30, "start": 1, "format": "json"}
        if kind == "cafearticle":
            params["sort"] = "sim"
        r = self.client.get(f"{NAVER}/search/v1/{kind}", params=params,
                            headers={"X-NCP-APIGW-API-KEY-ID": self.keys["WALF_NAVER_HUB_ID"], "X-NCP-APIGW-API-KEY": self.keys["WALF_NAVER_HUB_SECRET"]})
        _count("naver")
        if r.status_code == 429:
            return _res(source, q, "quota", error="네이버 API 한도·초당 제한(429)")
        if r.status_code in (401, 403):
            return _res(source, q, "failed", error=f"인증 실패(HTTP {r.status_code}) {r.text[:120]}")
        if r.status_code != 200:
            return _res(source, q, "failed", error=f"HTTP {r.status_code} {r.text[:120]}")
        items = r.json().get("items", [])
        res = [{"url": i.get("link", ""), "title": _clean(i.get("title")), "content": _clean(i.get("description")) + (f" · 카페 {i.get('cafename')}" if i.get("cafename") else "")} for i in items if i.get("link")]
        return _res(source, q, "ok" if res else "empty", res)

    def _tavily(self, source, q, domains):
        body = {"query": q, "search_depth": "basic", "max_results": 20, "auto_parameters": False, "include_answer": False, "include_raw_content": False}
        if domains:
            body["include_domains"] = domains[:300]
        r = self.client.post(TAVILY, json=body, headers={"Authorization": f"Bearer {self.keys['WALF_TAVILY_KEY']}"})
        _count("tavily")
        if r.status_code in (429, 432, 433):
            return _res(source, q, "quota", error=f"Tavily 한도·요청 제한(HTTP {r.status_code}) — 멈춤(유료 전환 안 함)")
        if r.status_code in (401, 403):
            return _res(source, q, "failed", error=f"인증 실패(HTTP {r.status_code})")
        if r.status_code != 200:
            return _res(source, q, "failed", error=f"HTTP {r.status_code} {r.text[:120]}")
        d = r.json()
        res = [{"url": x.get("url", ""), "title": x.get("title", ""), "content": (x.get("content") or "")[:400]} for x in d.get("results", []) if x.get("url")]
        return _res(source, q, "ok" if res else "empty", res, cost=(d.get("usage") or {}).get("credits", 1))

    def _searx(self, source, q, domains):
        # SearXNG 는 site: 를 검색어에 붙여 판매처를 좁힌다(도메인이 여러 개면 판매처 제한 없이)
        qq = f"{q} site:{domains[0]}" if domains and len(domains) == 1 else q
        r = self.client.get(f"{self.searx_base}/search", params={"q": qq, "format": "json", "language": "ko-KR", "safesearch": 0}, headers={"X-Real-IP": "127.0.0.1"})
        if r.status_code != 200:
            return _res(source, qq, "failed", error=f"SearXNG HTTP {r.status_code}")
        d = r.json()
        res = [{"url": x.get("url", ""), "title": x.get("title", ""), "content": (x.get("content") or "")[:400], "engines": x.get("engines", [])} for x in d.get("results", []) if x.get("url")]
        bad = d.get("unresponsive_engines", [])
        st = "ok" if res else ("blocked" if bad and all(any(w in str(why).lower() for w in ("captcha", "denied", "too many")) for _, why in bad) and len(bad) >= 3 else "empty")
        return _res(source, qq, st, res, error="; ".join(f"{e}:{why}" for e, why in bad)[:200])
