"""판매처 자체 검색 — 2026-11-09 검증한 두 가지만 쓴다(engine/reports/site-access-2026-11-09.md).

- 브랜드 공식몰(카페24): https://{공식몰}/product/search.html?keyword={검색어} → 상품 페이지 주소
- 중고나라:             https://web.joongna.com/search/{검색어}       → 현재 매물 주소·제목·가격·등록 시각

결과는 검색 소스(sources.py)와 같은 모양 {source, q, status, results, ms, error} 이라 pipeline 이 그대로 받는다.
여는 주소마다 약관 차단(pages.TOS_BLOCK)·robots.txt 를 먼저 본다. 판매처마다 한 번에 하나씩, 사이를 두고 연다.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from urllib.parse import quote, unquote, urlsplit

from bs4 import BeautifulSoup

os.environ.setdefault("CRAWL4AI_NO_CLOUD_NOTICE", "1")
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig  # noqa: E402

import pages  # noqa: E402

JOONGNA = "https://web.joongna.com"
CACHE = os.path.expanduser(os.environ.get("WALF_OSS_CACHE", "~/.walf-oss/cache"))


def _res(source, q, status, results=(), ms=0, error=""):
    return {"source": source, "q": q, "status": status, "results": list(results), "ms": ms, "error": error[:200], "cost": 0}


def official_links(html: str, domain: str) -> list[dict]:
    """카페24 검색 결과의 상품 주소. 제목은 주소 속 상품명(검색 결과 목록의 글은 쇼핑몰마다 달라 믿지 않는다)"""
    out, seen = [], set()
    for path in re.findall(r'href="(/product/[^"?#]+/\d+/[^"]*)"', html or ""):
        m = re.match(r"(/product/[^/]+/\d+/)", path)
        key = m.group(1) if m else path
        if key in seen:
            continue
        seen.add(key)
        slug = unquote(key.split("/")[2]).replace("-", " ")
        out.append({"url": f"https://{domain}{key}", "title": slug, "content": ""})
    return out


def joongna_listings(html: str) -> list[dict]:
    """중고나라 검색 결과의 매물: 링크 안 글에 제목·가격·등록 시각이 함께 있다"""
    soup = BeautifulSoup(html or "", "lxml")
    out: dict[str, str] = {}
    for a in soup.find_all("a", href=re.compile(r"^/product/\d+$")):
        t = " ".join(a.get_text(" ").split())
        u = JOONGNA + a["href"]
        if t and len(t) > len(out.get(u, "")):
            out[u] = t
    res = []
    for u, t in out.items():
        price = re.search(r"([\d,]{3,})\s*원", t)
        title = t[: price.start()].strip() if price else t
        res.append({"url": u, "title": title[:160], "content": t[:300], "price": int(price.group(1).replace(",", "")) if price else None})
    return res


def total_of(md: str) -> int | None:
    m = re.search(r"검색결과\s*총\s*\**\s*([\d,]+)\s*\**\s*개", md or "")
    return int(m.group(1).replace(",", "")) if m else None


def official_domains(brand: str, note: str) -> list[str]:
    """운영자 메모의 “공식몰: badblood.co.kr” → 지난 탐색에서 배운 공식몰(카페24 검색이 되는 곳)"""
    out = []
    m = re.search(r"공식몰\s*[:：]\s*([a-z0-9.-]+\.[a-z]{2,})", note or "", re.I)
    if m:
        out.append(m.group(1).lower())
    try:
        out += json.load(open(os.path.join(CACHE, "official.json"))).get((brand or "").lower(), [])
    except Exception:
        pass
    return list(dict.fromkeys(d.removeprefix("www.") for d in out))


def learn_official(brand: str, domains: dict, log=print):
    """pipeline 이 ‘브랜드 공식몰’로 분류한 국내 도메인을 기억한다(영문·해외 사이트 제외)"""
    if not brand:
        return
    try:
        d = json.load(open(os.path.join(CACHE, "official.json")))
    except Exception:
        d = {}
    cur = d.setdefault(brand.lower(), [])
    for h, info in domains.items():
        h2 = h.removeprefix("www.")
        if info.get("kind") == "official" and not re.match(r"(en|english|global)\.", h2) and h2 not in cur and "막음" not in str(info.get("robots")):
            cur.append(h2)
            log(f"  공식몰 배움: {brand} → {h2}")
    os.makedirs(CACHE, exist_ok=True)
    json.dump(d, open(os.path.join(CACHE, "official.json"), "w"), ensure_ascii=False, indent=1)


async def run(plan: list[tuple[str, str, str]], *, log=print, pause: float = 3.0) -> list[dict]:
    """plan: [(source, 도메인, 검색어)] — source 는 official | joongna"""
    out = []
    if not plan:
        return out
    cfg = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, wait_until="networkidle", page_timeout=45000, delay_before_return_html=4, user_agent=pages.UA, verbose=False)
    async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False, user_agent=pages.UA)) as c:
        for i, (src, domain, q) in enumerate(plan):
            url = f"https://{domain}/product/search.html?keyword={quote(q)}" if src == "official" else f"{JOONGNA}/search/{quote(q)}"
            tos = pages.tos_block(url)
            ok, why = (False, tos) if tos else pages.robots_ok(url)
            if not ok:
                out.append(_res(src, q, "blocked", error=why))
                log(f"  [{src}] 열지 않음 {q} · {why}")
                continue
            if i:
                await asyncio.sleep(pause)
            t0 = time.monotonic()
            try:
                r = await asyncio.wait_for(c.arun(url=url, config=cfg), timeout=70)
            except Exception as e:
                out.append(_res(src, q, "failed", ms=int((time.monotonic() - t0) * 1000), error=f"{type(e).__name__}: {e}"))
                log(f"  [{src}] 실패 {q} · {type(e).__name__}")
                continue
            ms = int((time.monotonic() - t0) * 1000)
            if not r.success or (r.status_code or 200) >= 400:
                st = "blocked" if r.status_code in (401, 403, 429) else "failed"
                out.append(_res(src, q, st, ms=ms, error=f"HTTP {r.status_code} {(r.error_message or '')[:120]}"))
                log(f"  [{src}] {st} {q} · HTTP {r.status_code}")
                continue
            md = getattr(r.markdown, "raw_markdown", "") or ""
            items = official_links(r.html, urlsplit(url).hostname or domain) if src == "official" else joongna_listings(r.html)
            res = _res(src, q, "ok" if items else "empty", items, ms)
            if src == "joongna":
                res["total"] = total_of(md)
            out.append(res)
            total = f" (검색결과 총 {res['total']}개)" if src == "joongna" else ""
            log(f"  [{src}] {res['status']} {q} → {len(items)}건{total} · {ms}ms")
    return out
