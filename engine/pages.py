"""Crawl4AI로 상품 페이지를 열어 상품 정보를 뽑는다.

- robots.txt 를 지킨다. Crawl4AI 의 자체 확인은 robots.txt 요청이 403 으로 막히면 “허용”으로 보기 때문에(무신사 실측),
  여기서 브라우저처럼 robots.txt 를 직접 읽어 일반 수집기(*) 규칙으로 판단하고, 읽지 못하면 열지 않는다.
- 로그인·차단 회피(magic·simulate_user·override_navigator)는 쓰지 않는다.
- 구조화 데이터(JSON-LD Product, og/product 메타)를 먼저 쓰고, 없을 때만 본문 문구로 보충한다.
- 상태: ok(확인 완료) · stock_unknown(상품 정보는 있으나 재고 확인 불가) · partial(일부만 확인) · sold(판매 완료)
        · login(로그인 필요) · blocked(접근 제한) · robots(robots.txt 가 막음) · deleted(삭제·없는 페이지) · error(열지 못함)
"""
from __future__ import annotations

import asyncio
import html as htmllib
import urllib.robotparser
from urllib.parse import urlsplit
import json
import os
import re
import time

import httpx  # noqa: E402

os.environ.setdefault("CRAWL4AI_NO_CLOUD_NOTICE", "1")
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig  # noqa: E402

import rules  # noqa: E402

_LD = re.compile(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", re.S | re.I)
_META = re.compile(r"<meta\s+[^>]*(?:property|name)=[\"']([^\"']+)[\"'][^>]*content=[\"']([^\"']*)[\"'][^>]*>", re.I)
_META_REV = re.compile(r"<meta\s+[^>]*content=[\"']([^\"']*)[\"'][^>]*(?:property|name)=[\"']([^\"']+)[\"'][^>]*>", re.I)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
_PRICE_TEXT = re.compile(r"(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원")


UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
_robots: dict[str, tuple[urllib.robotparser.RobotFileParser | None, str]] = {}


SNAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "robots")


def _snapshot(netloc: str, why: str):
    """자동 읽기가 막혔을 때(보안 장치가 robots.txt 요청을 403 으로 막는 판매처) 사람이 확인해 저장한 원문을 따른다. 없으면 열지 않는다."""
    f = os.path.join(SNAP, netloc + ".txt")
    if not os.path.exists(f):
        return (False, f"robots.txt 를 읽지 못함({why})")
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(open(f, encoding="utf-8", errors="replace").read().splitlines())
    return (rp, f"robots.txt 저장본(자동 읽기 {why})")


def robots_ok(url: str) -> tuple[bool, str]:
    """(열어도 되는지, 사유). 일반 수집기(*) 규칙을 따른다. robots.txt 를 읽지 못하면 열지 않는다(404 는 제한 없음)."""
    u = urlsplit(url)
    host = f"{u.scheme}://{u.netloc}"
    if host not in _robots:
        try:
            r = httpx.get(host + "/robots.txt", headers={"User-Agent": UA}, timeout=10, follow_redirects=True)
            if r.status_code == 404:
                _robots[host] = (None, "robots.txt 없음")
            elif r.status_code == 200:
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(r.text.splitlines())
                _robots[host] = (rp, "robots.txt")
            else:
                _robots[host] = _snapshot(u.netloc, f"HTTP {r.status_code}")
        except Exception as e:
            _robots[host] = _snapshot(u.netloc, type(e).__name__)
    rp, why = _robots[host]
    if rp is None:
        return True, why
    if rp is False:
        return False, why
    allowed = rp.can_fetch("*", url)
    return (allowed, f"{why}: 일반 수집기(*) 허용" if allowed else f"{why}: 일반 수집기(*)를 막음")


def _walk(node):
    if isinstance(node, list):
        for x in node:
            yield from _walk(x)
    elif isinstance(node, dict):
        yield node
        for k in ("@graph", "mainEntity", "itemOffered"):
            if k in node:
                yield from _walk(node[k])


def _first(v):
    if isinstance(v, list):
        return _first(v[0]) if v else None
    return v


def jsonld_product(html: str) -> dict | None:
    for raw in _LD.findall(html or ""):
        try:
            data = json.loads(htmllib.unescape(raw.strip()))
        except Exception:
            continue
        for d in _walk(data):
            t = d.get("@type")
            if t == "Product" or (isinstance(t, list) and "Product" in t):
                offers = d.get("offers") or {}
                offers_l = [o for o in _walk(offers) if isinstance(o, dict)]
                o = next((x for x in offers_l if x.get("price") or x.get("lowPrice")), offers_l[0] if offers_l else {})
                brand = d.get("brand")
                brand = brand.get("name") if isinstance(brand, dict) else _first(brand)
                img = _first(d.get("image"))
                img = img.get("url") if isinstance(img, dict) else img
                price = o.get("price") or o.get("lowPrice")
                return {"name": d.get("name"), "brand": brand, "price": _num(price), "currency": o.get("priceCurrency"),
                        "availability": str(o.get("availability") or ""), "image": img, "color": d.get("color"), "sku": d.get("sku") or d.get("mpn"),
                        "description": (d.get("description") or "")[:300]}
    return None


def _num(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(round(float(str(v).replace(",", ""))))
    except ValueError:
        return None


def meta(html: str) -> dict:
    out: dict[str, str] = {}
    for k, v in _META.findall(html or ""):
        out.setdefault(k.lower(), htmllib.unescape(v))
    for v, k in _META_REV.findall(html or ""):
        out.setdefault(k.lower(), htmllib.unescape(v))
    return out


def extract(url: str, html: str, text: str, http: int | None) -> dict:
    ld = jsonld_product(html) or {}
    m = meta(html)
    title = ld.get("name") or m.get("og:title") or (htmllib.unescape(_TITLE.search(html).group(1).strip()) if _TITLE.search(html or "") else "")
    price = ld.get("price") or _num(m.get("product:price:amount") or m.get("og:price:amount"))
    price_src = "jsonld" if ld.get("price") else ("meta" if price else None)
    if price is None:
        pm = _PRICE_TEXT.search((text or "")[:3000])
        if pm:
            price, price_src = _num(pm.group(1)), "text"
    availability = ld.get("availability") or m.get("product:availability") or m.get("og:availability") or ""
    stock = rules.stock_from(availability, title, text)
    flags = rules.page_flags(text)
    has_product = bool(title) and (bool(ld) or price is not None)
    if flags["deleted"] and not ld:
        status = "deleted"
    elif flags["blocked"] and not has_product:
        status = "blocked"
    elif flags["login"] and not has_product:
        status = "login"
    elif stock == "sold_out":
        status = "sold"
    elif title and price is not None and stock == "listed":
        status = "ok"
    elif title and price is not None:
        status = "stock_unknown"
    else:
        status = "partial"
    return {"url": url, "http": http, "status": status, "title": (title or "")[:200], "brand": ld.get("brand") or m.get("product:brand") or "",
            "price": price, "price_src": price_src, "availability": availability, "stock": stock, "jsonld": bool(ld),
            "image": ld.get("image") or m.get("og:image") or "", "color": ld.get("color") or "", "sku": ld.get("sku") or "",
            "description": ld.get("description") or m.get("og:description", "")[:300], "text_head": (text or "")[:2500]}


async def crawl(urls: list[str], *, log=print, timeout_ms: int = 30000, pause: float = 2.0) -> list[dict]:
    """한 번에 하나씩, 사이에 쉬면서 연다(판매처 부담을 줄인다). 상품 정보가 비면 네트워크가 잠잠해질 때까지 한 번 더 기다린다."""
    out: list[dict] = []
    if not urls:
        return out
    fast = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, check_robots_txt=True, page_timeout=timeout_ms, wait_until="domcontentloaded",
                            delay_before_return_html=2.0, user_agent=UA, verbose=False)
    slow = fast.clone(wait_until="networkidle", delay_before_return_html=3.0)
    opened = 0
    async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False, user_agent=UA)) as crawler:
        for url in urls:
            ok, why = robots_ok(url)
            if not ok:
                out.append({"url": url, "status": "robots", "error": why, "ms": 0})
                log(f"  페이지 [robots] {url} · {why} — 열지 않음")
                continue
            if opened:
                await asyncio.sleep(pause)
            opened += 1
            t0 = time.monotonic()
            p = await _one(crawler, url, fast, timeout_ms)
            if p["status"] == "partial":
                await asyncio.sleep(pause)
                p2 = await _one(crawler, url, slow, timeout_ms)
                if p2["status"] not in ("error", "partial"):
                    p = p2
            p["ms"] = int((time.monotonic() - t0) * 1000)
            out.append(p)
            log(f"  페이지 [{p['status']}] {url} · {p.get('title', '')[:40]} · {p.get('price')}원 · {p['ms']}ms{' · ' + p['error'][:60] if p.get('error') else ''}")
    return out


async def _one(crawler, url: str, cfg, timeout_ms: int) -> dict:
    try:
        r = await asyncio.wait_for(crawler.arun(url=url, config=cfg), timeout=timeout_ms / 1000 + 20)
    except Exception as e:
        return {"url": url, "status": "error", "error": f"{type(e).__name__}: {e}"[:200]}
    http = getattr(r, "status_code", None)
    err = (getattr(r, "error_message", "") or "")[:200]
    if not r.success:
        low = err.lower()
        st = "robots" if "robots" in low else "blocked" if http in (401, 403, 429) else "deleted" if http in (404, 410) else "error"
        return {"url": url, "status": st, "http": http, "error": err}
    if http in (404, 410):
        return {"url": url, "status": "deleted", "http": http}
    if http in (401, 403, 429):
        return {"url": url, "status": "blocked", "http": http}
    md = r.markdown
    text = getattr(md, "raw_markdown", None) or (md if isinstance(md, str) else "") or ""
    return extract(url, r.html or "", text, http)
