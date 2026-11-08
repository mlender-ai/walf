"""판매처별 매물 URL 확보 방법 검증 — 허용된 방식만 쓴다(2026-11-09 조사 기준).

    python site_check.py      → engine/reports/site-check-<시각>.json · .md

- 브랜드 공식몰(카페24): 자체 검색(product/search.html)으로 상품 페이지를 찾고, 페이지에 들어 있는 옵션 재고(option_stock_data)를 읽는다
- 중고나라: 자체 검색(/search/{검색어})의 현재 매물 목록에서 제목·가격·등록 시각을 읽고 판정한다
- 번개장터·솔드아웃·무신사·KREAM: 약관·robots 때문에 열지 않는다(pages.TOS_BLOCK)
- 후루츠패밀리: 자체 검색은 주소로 열리지 않아(스크립트 검색) 확인 못 함 — 상품 페이지만 열 수 있다
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from urllib.parse import quote, unquote

from bs4 import BeautifulSoup

os.environ.setdefault("CRAWL4AI_NO_CLOUD_NOTICE", "1")
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig  # noqa: E402

import pages  # noqa: E402
import rules  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
P = {"brand": "BADBLOOD", "name": "Mystic Nylon Track Jacket", "brand_aliases": ["배드블러드"], "name_aliases": ["미스틱 나일론 트랙 자켓", "미스틱 트랙 자켓", "미스틱 트랙자켓"], "code": "W-JKT26-055"}
COLOR, SIZE = "네이비", "M"
OFFICIAL = "https://badblood.co.kr"
JOONGNA_Q = ["배드블러드", "배드블러드 트랙 자켓", "배드블러드 미스틱", "배드블러드 트랙자켓"]


def anchors(html: str, pat: str, base: str) -> dict[str, str]:
    soup = BeautifulSoup(html or "", "lxml")
    out: dict[str, str] = {}
    for a in soup.find_all("a", href=re.compile(pat)):
        u = base + a["href"] if a["href"].startswith("/") else a["href"]
        t = " ".join(a.get_text(" ").split())
        if t and len(t) > len(out.get(u, "")):
            out[u] = t
    return out


def option_stock(html: str) -> list[dict]:
    """카페24 상품 페이지 안의 옵션별 재고"""
    m = re.search(r"option_stock_data\s*=\s*'(\{.*?\})';", html or "", re.S)
    if not m:
        return []
    data = json.loads(m.group(1).replace('\\"', '"').encode().decode("unicode_escape") if '\\"' in m.group(1) else m.group(1))
    out = []
    for k, v in data.items():
        vals = v.get("option_value_orginal") or str(v.get("option_value", "")).split("-")
        out.append({"code": k, "option": "-".join(vals), "stock": v.get("stock_number"), "selling": v.get("is_selling") == "T", "use_soldout": v.get("use_soldout")})
    return out


async def main():
    t_all = time.monotonic()
    rep: dict = {"at": time.strftime("%Y-%m-%d %H:%M"), "product": P | {"color": COLOR, "size": SIZE}, "sites": {}}
    cfg = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, wait_until="networkidle", page_timeout=45000, delay_before_return_html=4, user_agent=pages.UA, verbose=False)
    async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False, user_agent=pages.UA)) as c:
        # 1) 공식몰: 알려진 상품 페이지 찾기 + 옵션 재고
        off = {"method": "공식몰 자체 검색(product/search.html) + 상품 페이지 옵션 재고", "robots": pages.robots_ok(OFFICIAL + "/product/search.html?keyword=x")[1], "searches": [], "pages": []}
        found = {}
        for kw in [P["code"], "미스틱 나일론 트랙 자켓"]:
            t0 = time.monotonic()
            r = await c.arun(url=f"{OFFICIAL}/product/search.html?keyword={quote(kw)}", config=cfg)
            links = {OFFICIAL + l: unquote(l) for l in re.findall(r'href="(/product/[^"]+/\d+/[^"]*)"', r.html or "")}
            off["searches"].append({"q": kw, "http": r.status_code, "ms": int((time.monotonic() - t0) * 1000), "links": list(links.values())})
            found.update(links)
            await asyncio.sleep(3)
        for url, path in found.items():
            # 공식몰은 도메인이 곧 브랜드 — 주소 속 상품명 앞에 브랜드를 붙여 판정
            t = "배드블러드 " + path.replace("-", " ")
            j = rules.judge(**P, text=t, title=t)
            r = await c.arun(url=url, config=cfg)
            st = option_stock(r.html or "")
            m_opt = [o for o in st if re.search(r"네이비|navy", o["option"], re.I) and re.search(r"(^|-)M$", o["option"])]
            off["pages"].append({"url": url, "path": path, "match": j["match"], "color": rules.color_match(COLOR, path.replace("-", " ")), "options": st,
                                 "navy_m": m_opt[0] if m_opt else None, "http": r.status_code})
            await asyncio.sleep(3)
        rep["sites"]["배드블러드 공식몰"] = off
        # 2) 중고나라: 자체 검색의 현재 매물
        jn = {"method": "중고나라 자체 검색(/search/{검색어})", "robots": pages.robots_ok("https://web.joongna.com/search/x")[1], "searches": [], "listings": {}}
        for kw in JOONGNA_Q:
            t0 = time.monotonic()
            r = await c.arun(url="https://web.joongna.com/search/" + quote(kw), config=cfg)
            md = getattr(r.markdown, "raw_markdown", "") or ""
            tot = re.search(r"검색결과\s*총\s*\**\s*([\d,]+)\s*\**\s*개", md) or re.search(r"총\s*([\d,]+)\s*개", md)
            its = anchors(r.html, r"^/product/\d+$", "https://web.joongna.com")
            jn["searches"].append({"q": kw, "http": r.status_code, "ms": int((time.monotonic() - t0) * 1000), "total": tot.group(1) if tot else None, "on_page": len(its)})
            for u, t in its.items():
                j = rules.judge(**P, text=t, title=t)
                jn["listings"][u] = {"title": t[:160], "match": j["match"], "color": rules.color_match(COLOR, t), "size": rules.size_match(SIZE, t),
                                     "wanted": rules.is_wanted_post(t), "sold": rules.stock_from("", t, t) == "sold_out", "q": kw}
            await asyncio.sleep(4)
        rep["sites"]["중고나라"] = jn
    rep["total_ms"] = int((time.monotonic() - t_all) * 1000)
    os.makedirs(OUT, exist_ok=True)
    base = os.path.join(OUT, "site-check-" + time.strftime("%Y%m%d-%H%M"))
    json.dump(rep, open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 요약 마크다운
    md = [f"# 판매처별 매물 URL 확보 검증 · {rep['at']}", "", f"상품: {P['brand']} {P['name']} · {COLOR} · {SIZE} · 품번 {P['code']}", ""]
    md += ["## 배드블러드 공식몰", ""] + [f"- 검색 `{s['q']}` → 상품 링크 {len(s['links'])}개 ({s['ms'] / 1000:.1f}초): {', '.join(s['links'])}" for s in off["searches"]]
    for pg in off["pages"]:
        md.append(f"- {pg['path']} → 판정 {pg['match']} · 색 {pg['color']} · 네이비 M: {pg['navy_m'] or '옵션 없음'}")
        md.append("  - 옵션 재고: " + ", ".join(f"{o['option']} {o['stock']}" for o in pg["options"]))
    md += ["", "## 중고나라 (현재 매물)", ""] + [f"- 검색 `{s['q']}` → 검색결과 {s['total'] or '?'}개 · 이 페이지 {s['on_page']}개 ({s['ms'] / 1000:.1f}초)" for s in jn["searches"]]
    rel = {u: x for u, x in jn["listings"].items() if x["match"] != "unknown" and re.search(r"트랙|track|미스틱|mystic", x["title"], re.I)}
    md += ["", "트랙·미스틱 관련 매물:"] + [f"- [{x['match']}] 색 {x['color']} · 사이즈 {x['size']} | {x['title'][:90]} | {u}" for u, x in rel.items()]
    md += ["", f"같은 상품(네이비·M) 매물: {sum(1 for x in jn['listings'].values() if x['match'] == 'same_likely' and x['color'] != 'mismatch' and x['size'] != 'mismatch' and not x['wanted'] and not x['sold'])}개 · 총 {rep['total_ms'] / 1000:.0f}초"]
    open(base + ".md", "w", encoding="utf-8").write("\n".join(md))
    print(base + ".md")


if __name__ == "__main__":
    asyncio.run(main())
