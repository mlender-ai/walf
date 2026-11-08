"""검색 소스 비교 — 같은 상품·같은 검색어로 소스마다 결과를 비교한다(Gate 2 재검증).

    python compare.py testb      # 정확한 상품 검색(BADBLOOD Mystic Nylon Track Jacket · 네이비 · M)
    python compare.py testa      # 사진 식별(특징 추출 · 모델명 추정 · 후보 이미지 비교를 따로)

결과: engine/reports/compare-<test>-<시각>.json · .md   (키가 없는 소스는 “실행 안 함”으로 남는다)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time

import pages
import pipeline
from sources import Sources
from vision import Vision

SEARXNG = os.environ.get("WALF_SEARXNG_URL", "http://localhost:8888")
OLLAMA = os.environ.get("WALF_OLLAMA_URL", "http://localhost:11434")
VLM = os.environ.get("WALF_OSS_VLM", "qwen3-vl:8b-instruct")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
SOURCES = ["naver_web", "naver_cafe", "tavily", "searxng"]
SELLERS = [{"name": "무신사", "domain": "musinsa.com"}, {"name": "29CM", "domain": "29cm.co.kr"}, {"name": "W컨셉", "domain": "wconcept.co.kr"},
           {"name": "번개장터", "domain": "bunjang.co.kr"}, {"name": "중고나라", "domain": "joongna.com"}, {"name": "후루츠패밀리", "domain": "fruitsfamily.com"}]
LOG: list[str] = []


def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    LOG.append(line)
    print(line, file=sys.stderr, flush=True)


async def search_all(src: Sources, queries: list[str], pause: float = 3.0) -> list[dict]:
    raw = []
    for s in SOURCES:
        for q in queries:
            r = src.search(s, q)
            raw.append(r)
            if r["status"] not in ("no_key", "skipped", "quota"):
                await asyncio.sleep(pause if s == "searxng" else 0.3)
    return raw


def save(test: str, data: dict, md: str):
    os.makedirs(OUT, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M")
    base = os.path.join(OUT, f"compare-{test}-{stamp}")
    json.dump(data, open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=list)
    open(base + ".md", "w", encoding="utf-8").write(md)
    open(base + ".log", "w", encoding="utf-8").write("\n".join(LOG))
    print(base + ".md")


def status_line(raw: list[dict], s: str) -> str:
    rs = [r for r in raw if r["source"] == s]
    if all(r["status"] == "no_key" for r in rs):
        return "실행 안 함 — " + rs[0]["error"]
    sts = {}
    for r in rs:
        sts[r["status"]] = sts.get(r["status"], 0) + 1
    errs = sorted({r["error"] for r in rs if r["error"]})
    return " · ".join(f"{k} {v}" for k, v in sts.items()) + (f" · 오류: {'; '.join(errs)[:160]}" if errs else "")


# ── TEST B: 정확한 상품 검색 ─────────────────────────────────────
B = {"brand": "BADBLOOD", "model": "Mystic Nylon Track Jacket", "brand_ko": ["배드블러드"], "name_ko": ["미스틱 나일론 트랙 자켓"], "code": "W-JKT26-055", "color": "네이비", "size": "M"}
B_QUERIES = ["BADBLOOD Mystic Nylon Track Jacket", "배드블러드 미스틱 나일론 트랙 자켓", "BADBLOOD W-JKT26-055", "배드블러드 미스틱 나일론 트랙 자켓 네이비 M"]
# 알려진 실제 상품 페이지(2026-11-09 검색 결과에서 확인) — 주소 모양으로 맞춘다
B_KNOWN = [("배드블러드 공식몰 W-JKT26-055", r"badblood\.co\.kr/product/w-jkt26-055"), ("배드블러드 스토어 W-JKT26-055", r"badbloodstores\.com/product/w-jkt26-055")]


async def test_b():
    src = Sources(SOURCES, SEARXNG, log)
    avail = src.available()
    log("소스", avail)
    t0 = time.monotonic()
    raw = await search_all(src, B_QUERIES)
    res = await pipeline.run(raw=raw, sellers=SELLERS, brand=B["brand"], model=B["model"], brand_ko=B["brand_ko"], name_ko=B["name_ko"], code=B["code"],
                             color=B["color"], size=B["size"], known=set(), max_crawl=20, log=log)
    total_ms = int((time.monotonic() - t0) * 1000)
    rows, per = [], {}
    for s in SOURCES:
        rs = [r for r in raw if r["source"] == s]
        mine = [c for c in res["candidates"] if s in c["sources"]]
        same = [c for c in mine if c["match"] == "same_likely" and c["color_match"] != "mismatch"]
        wrong = [c for c in mine if c["match"] == "same_likely" and c["color_match"] == "mismatch"]
        urls = {r_["url"] for r in rs for r_ in r["results"]}
        known = [label for label, pat in B_KNOWN if any(re.search(pat, u, re.I) for u in urls)]
        buyable = [c for c in same if c["kind"] in ("seller", "platform", "cafe") and c["size_match"] == "match" and c["stock"] == "listed"]
        per[s] = {"status": status_line(raw, s), "search_ms": sum(r["ms"] for r in rs), "calls": sum(1 for r in rs if r["status"] not in ("no_key", "skipped", "quota")),
                  "cost": sum(r.get("cost", 0) for r in rs), "funnel": res["funnel"].get(s, {}), "known_found": known,
                  "same_pages": [{"url": c["url"], "where": c["seller"], "title": c["title"][:80], "page": c["page"].get("status"), "size": c["size_match"], "stock": c["stock"]} for c in same],
                  "filtered_color": [{"url": c["url"], "why": "같은 모델·다른 색(걸러냄)", "title": c["title"][:80]} for c in wrong],
                  "wrong": [{"url": c["url"], "why": "운영자 확인 필요", "title": c["title"][:80]} for c in same if c["kind"] == "other"], "buyable_m": [c["url"] for c in buyable]}
        rows.append(s)
    data = {"test": "B", "product": B, "queries": B_QUERIES, "available": avail, "total_ms": total_ms, "per_source": per,
            "domains": res["domains"], "drops": res["drops"], "candidates": [{k: v for k, v in c.items() if k not in ("page", "judge0", "robots")} | {"page_status": c["page"].get("status")} for c in res["candidates"]]}
    md = [f"# 검색 소스 비교 — TEST B (정확한 상품 검색) · {time.strftime('%Y-%m-%d %H:%M')}", "",
          f"상품: {B['brand']} {B['model']} · {B['color']} · {B['size']} · 품번 {B['code']}  ", f"같은 검색어 {len(B_QUERIES)}개: " + " / ".join(f"`{q}`" for q in B_QUERIES), "",
          "| 소스 | 실행 | 검색 시간 | 호출·비용 | 수집 URL | 중복 제거 후 | 범위 밖 | 상품 아님 | robots | 페이지 오류 | 추출 성공 | 같은 상품 | 색·사이즈 불일치 | 검수 가능 | 알려진 페이지 | 구매 가능 M |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for s in rows:
        p, fu = per[s], per[s]["funnel"]
        md.append(f"| {s} | {p['status']} | {p['search_ms'] / 1000:.1f}초 | {p['calls']}회 · {p['cost']}크레딧 | {fu.get('raw', 0)} | {fu.get('unique', 0)} | {fu.get('out_of_scope', 0)} | {fu.get('non_product', 0)} | "
                  f"{fu.get('robots', 0)} | {fu.get('page_error', 0)} | {fu.get('extracted', 0)} | {fu.get('same', 0)} | {fu.get('color_mismatch', 0)}·{fu.get('size_mismatch', 0)} | {fu.get('reviewable', 0)} | "
                  f"{', '.join(p['known_found']) or '없음'} | {len(p['buyable_m'])} |")
    for s in rows:
        p = per[s]
        if p["same_pages"] or p["wrong"] or p["filtered_color"]:
            md += ["", f"## {s} — 같은 상품으로 본 페이지", ""] + [f"- [{x['where']}] {x['title']} — {x['url']} (페이지 {x['page']}, 사이즈 {x['size']}, 판매 {x['stock']})" for x in p["same_pages"]]
            md += [f"- 걸러냄: {x['title']} — {x['url']} ({x['why']})" for x in p["filtered_color"]]
            md += [f"- ✗ 의심: {x['title']} — {x['url']} ({x['why']})" for x in p["wrong"]]
    md += ["", "## 발견한 국내 도메인과 수집 정책", "", "| 도메인 | 분류 | 나온 소스 | URL 수 | robots.txt(일반 수집기) |", "|---|---|---|---|---|"]
    md += [f"| {h} | {d['kind']} {d['name'] if d['kind'] == 'seller' else ''} | {', '.join(d['sources'])} | {d['urls']} | {d['robots']} |" for h, d in sorted(res["domains"].items(), key=lambda x: -x[1]["urls"])]
    md += ["", f"## 탈락한 URL ({len(res['drops'])}건, 처음 60건)", ""] + [f"- [{d['source']}] {d['stage']} · {d['reason']} — {d['url'][:120]}" for d in res["drops"][:60]]
    md += ["", f"총 실행 시간 {total_ms / 1000:.0f}초(검색 + 페이지 확인). 유료 API 호출 0."]
    save("testb", data, "\n".join(md))


# ── TEST A: 사진 식별 ───────────────────────────────────────────
PHOTO = os.environ.get("WALF_TEST_A_PHOTO", "")
A_CHECK = {"브라운 계열": r"브라운|갈색|모카|초콜릿|카멜", "울·트위드 질감": r"울|트위드|부클|텍스처", "지퍼 여밈": r"지퍼", "가슴 지퍼 포켓": r"가슴[^,]*지퍼|지퍼[^,]*포켓", "소매·암 절개선": r"소매[^,]*(절개|라인|컷)|암\s*컷|절개[^,]*소매"}
A_NEG = ["https://fruitsfamily.com/product/6lx03/%EB%B0%B0%EB%93%9C-%EB%B8%94%EB%9F%AC%EB%93%9C-%EB%8B%A4%ED%81%AC-%EB%B9%8C%EB%A6%AC-%EB%82%98%EC%9D%BC%EB%A1%A0-%ED%8A%B8%EB%9E%99-%EC%9E%90%EC%BC%93-%EC%B1%A0%EC%BD%9C%EB%B8%8C%EB%9D%BC%EC%9A%B4-s"]
A_REF = {"brand": "FAR FROM WHAT", "model": "FAR WOOL ARM CUTLINE JACKET", "brand_ko": ["파프롬왓"], "name_ko": []}


async def test_a():
    if not PHOTO or not os.path.exists(PHOTO):
        print("WALF_TEST_A_PHOTO 에 사진 경로를 주세요", file=sys.stderr)
        sys.exit(2)
    v = Vision(OLLAMA, VLM, log)
    # (1) 특징 추출 — 같은 사진 3회, 기준 항목을 몇 번 맞췄나·소재가 흔들리나
    runs = []
    for i in range(3):
        f = v.analyze(PHOTO)
        text = " ".join([f.get("material", ""), f.get("texture", ""), " ".join(f.get("details") or []), " ".join(f.get("colors") or [])])
        runs.append({"ms": f["_ms"], "hits": {k: bool(re.search(p, text)) for k, p in A_CHECK.items()}, "material": f.get("material"), "colors": f.get("colors"),
                     "details": f.get("details"), "brand_guess": f.get("brand_guess"), "keywords_ko": f.get("keywords_ko")})
        log(f"특징 {i + 1}회차 {runs[-1]['hits']} · 소재 {f.get('material')}")
    # (2) 모델명 추정 — 사진 검색어로 소스마다 검색해 결과에 FAR FROM WHAT 이 나오나
    import hunt  # 검색어 만드는 규칙을 그대로 쓴다
    qs = hunt.photo_queries({"garment": "자켓", "colors": runs[0]["colors"], "material": runs[0]["material"] or "", "texture": "", "details": runs[0]["details"], "keywords_ko": runs[0]["keywords_ko"]})
    src = Sources(SOURCES, SEARXNG, log)
    raw = await search_all(src, qs)
    hit = re.compile(r"far\s*from\s*what|파프롬왓|파\s*프롬\s*왓|far wool", re.I)
    est = {s: sorted({x["url"] for r in raw if r["source"] == s for x in r["results"] if hit.search(x["title"] + " " + x["url"] + " " + x["content"])}) for s in SOURCES}
    # (3) 후보 이미지 비교 — 기준 상품(정답 후보) 페이지와, 브랜드가 다른 브라운 자켓 페이지의 이미지를 사진과 비교
    ref_raw = await search_all(src, [f"{A_REF['brand']} {A_REF['model']}", "파프롬왓 울 암 컷라인 자켓"])
    ref = await pipeline.run(raw=ref_raw, sellers=SELLERS, brand=A_REF["brand"], model=A_REF["model"], brand_ko=A_REF["brand_ko"], name_ko=A_REF["name_ko"], code=None,
                             color="브라운", size="", known=set(), max_crawl=8, log=log)
    import hunt as _h
    compares = []
    # 정답 후보: 주소·제목에 모델명(ARM CUTLINE)이 보이는 페이지. 브랜드명이 주소에 없을 수 있어(fararchive.cafe24.com) 모델명으로 고른다
    pos = [c for c in ref["candidates"] if re.search(r"arm[\s-]*cutline|암\s*컷라인", c["url"] + " " + c["title"], re.I) and c["page"].get("image")][:2]
    log("정답 후보 이미지", [c["url"] for c in pos], "· 후보 전체", [(c["url"], c["match"], c["page"].get("status")) for c in ref["candidates"]])
    # 오답 표본(정해 둔 것): 다른 브랜드·모델의 브라운 계열 자켓 실매물 — 사진 비교가 “비슷하다”와 “같은 모델”을 가르는지 본다
    neg = [p for p in await pages.crawl(A_NEG, log=log) if p.get("image")]
    for label, items in (("정답 후보(FAR WOOL ARM CUTLINE)", pos), ("다른 브라운 자켓", neg)):
        for c in items:
            img_url = c["page"].get("image") if "page" in c else c.get("image")
            img = _h.fetch_image(img_url)
            src_kind = (c["page"] if "page" in c else c).get("image_src")
            if img and src_kind == "guess":
                r = v.compare(PHOTO, img, c.get("title", ""))
                compares.append({"label": label, "url": c["url"], "verdict": f"검증 무효 — 상품 이미지를 확정하지 못함(페이지 안 다른 이미지 {img_url}), 모델 판정 {r['verdict']}"})
                continue
            if not img:
                compares.append({"label": label, "url": c["url"], "verdict": "이미지 못 받음"})
                continue
            r = v.compare(PHOTO, img, c.get("title", ""))
            compares.append({"label": label, "url": c["url"], "verdict": r["verdict"], "matching": r["matching"], "differing": r["differing"], "ms": r["_ms"]})
            log(f"비교 {label} {c['url']} → {r['verdict']}")
    data = {"test": "A", "features": runs, "photo_queries": qs, "model_estimate": est, "ref_candidates": [c["url"] for c in ref["candidates"]], "compares": compares,
            "ref_drops": ref["drops"], "available": src.available()}
    md = [f"# TEST A (사진 식별) 분리 평가 · {time.strftime('%Y-%m-%d %H:%M')}", "", "## 1. 특징 추출(같은 사진 3회)", "", "| 회차 | 시간 | " + " | ".join(A_CHECK) + " | 소재 |", "|---|---|" + "---|" * len(A_CHECK) + "---|"]
    md += [f"| {i + 1} | {r['ms'] / 1000:.0f}초 | " + " | ".join("○" if r["hits"][k] else "✗" for k in A_CHECK) + f" | {r['material']} |" for i, r in enumerate(runs)]
    md += ["", "## 2. 모델명 추정(사진 검색어 → 결과에 FAR FROM WHAT 이 나오나)", "", "검색어: " + " / ".join(f"`{q}`" for q in qs), ""]
    md += [f"- {s}: {status_line(raw, s)} → FAR FROM WHAT 언급 {len(est[s])}건 {est[s][:3]}" for s in SOURCES]
    md += ["", "## 3. 후보 이미지 비교", ""] + ([f"- {c['label']} — {c['url']} → **{c['verdict']}**" + (f" · 같음 {c.get('matching', [])[:3]} · 다름 {c.get('differing', [])[:3]}" if c.get("matching") is not None else "") for c in compares] or ["- 비교할 후보 이미지를 얻지 못함(검증 못 함)"])
    md += ["", f"정답 후보 검색에서 찾은 페이지: {data['ref_candidates'] or '없음'}"]
    save("testa", data, "\n".join(md))


if __name__ == "__main__":
    asyncio.run({"testb": test_b, "testa": test_a}[sys.argv[1]]())
