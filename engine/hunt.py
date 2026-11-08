"""WALF 오픈소스 탐색 엔진 — 서버(oss 공급자)가 작업마다 한 번 실행한다.

    python hunt.py identify|search < 입력.json > 결과.json      (진행 기록은 stderr = 원본 로그)

외부 유료 AI를 부르지 않는다: 사진은 로컬 Ollama(Qwen3-VL), 검색은 로컬 SearXNG, 페이지는 로컬 Crawl4AI.
결과 형식은 서버의 AiProvider(IdentifyResult · SearchResult)와 같고, metrics 에 실험 지표를 덧붙인다.
판정은 제안일 뿐이다 — 동일 상품 확인·구매 가능 확인은 운영자만 한다.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time

import httpx

import pages
import pipeline
import rules
import searx
from sources import Sources
from vision import Vision

SEARXNG = os.environ.get("WALF_SEARXNG_URL", "http://localhost:8888")
OLLAMA = os.environ.get("WALF_OLLAMA_URL", "http://localhost:11434")
VLM = os.environ.get("WALF_OSS_VLM", "qwen3-vl:8b-instruct")
MAX_CRAWL = int(os.environ.get("WALF_OSS_MAX_CRAWL", "14"))
MAX_COMPARE = int(os.environ.get("WALF_OSS_MAX_COMPARE", "5"))
DELAY = float(os.environ.get("WALF_OSS_DELAY", "8"))  # 검색 엔진이 막지 않도록 천천히(브레이브는 4초 간격에서 막혔다)
CACHE = os.path.expanduser(os.environ.get("WALF_OSS_CACHE", "~/.walf-oss/cache"))
NEW_SELLERS = {"musinsa.com", "29cm.co.kr", "wconcept.co.kr"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


def hangul_only(xs) -> list[str]:
    """로컬 모델이 만든 한글 표기 중 한글·숫자·공백만으로 된 것만 쓴다(“니лон” 같은 섞인 글자는 버린다)"""
    return [x.strip() for x in xs or [] if x and re.fullmatch(r"[가-힣0-9 ]+", x.strip())]


# ── 별칭(한글 표기) ───────────────────────────────────────────
def _cache(name: str) -> dict:
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, name)
    try:
        return json.load(open(f, encoding="utf-8"))
    except Exception:
        return {}


def _save(name: str, d: dict):
    json.dump(d, open(os.path.join(CACHE, name), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def aliases_for(brand: str, note: str) -> dict:
    """한글 표기: 운영자 메모(“한글: 배드블러드 미스틱 나일론 트랙 자켓”) + 검색 결과·페이지에서 배운 브랜드 표기.
    로컬 모델이 만든 표기는 틀린 경우가 많아(“바드블러드”) 검색어에 쓰지 않는다."""
    learned = _cache("aliases.json")
    brand_ko, name_ko = [], []
    m = re.search(r"(?:한글|별칭)\s*[:：]\s*([^\n/|·]+)", note or "")
    if m:
        words = m.group(1).split()
        brand_ko += hangul_only(words[:1])
        name_ko += hangul_only([" ".join(words[1:])])
    brand_ko += learned.get(rules.norm(brand), [])
    return {"brand_ko": list(dict.fromkeys(x for x in brand_ko if x)), "name_ko": list(dict.fromkeys(x for x in name_ko if x))}


def learn_from_titles(brand: str, results: list[dict]):
    """“배드블러드(BADBLOOD)”·“BADBLOOD(배드블러드)” 같은 표기를 검색 결과 제목에서 배운다"""
    if not brand:
        return
    for r in results:
        for x in r["results"]:
            learn_alias(brand, {"title": x["title"], "description": x["content"]})


def learn_alias(brand: str, page: dict):
    """무신사 설명처럼 “배드블러드(BADBLOOD)” 표기가 보이면 그 한글 표기를 브랜드 별칭으로 배운다"""
    text = " ".join(str(page.get(k) or "") for k in ("description", "brand", "title"))
    hits = re.findall(r"([가-힣]{2,15})\s*\(\s*" + re.escape(brand) + r"\s*\)", text, re.I)
    hits += re.findall(re.escape(brand) + r"\s*\(\s*([가-힣]{2,15})\s*\)", text, re.I)
    b = page.get("brand") or ""
    if re.fullmatch(r"[가-힣 ]{2,15}", b) and brand.lower() in text.lower():
        hits.append(b.strip())
    if hits:
        d = _cache("aliases.json")
        cur = d.setdefault(rules.norm(brand), [])
        for h in hits:
            if h not in cur:
                cur.append(h)
                log(f"  별칭 배움: {brand} → {h}")
        _save("aliases.json", d)


# ── 공통: 검색 → 상품 주소 → 페이지 ─────────────────────────────
def collect(results: list[dict], domains: list[str], seen: set[str]) -> tuple[list[dict], dict]:
    """검색 결과에서 판매처 상품 주소만 고르고 중복을 지운다"""
    per: dict[str, dict] = {d: {"results": 0, "product_urls": 0, "new": 0, "dup": 0, "wanted_posts": 0, "other_pages": 0} for d in domains}
    picked: dict[str, dict] = {}
    for r in results:
        for x in r["results"]:
            d = rules.seller_domain(x["url"], domains)
            if not d:
                continue
            per[d]["results"] += 1
            if not rules.is_product_url(x["url"], d):
                per[d]["other_pages"] += 1
                continue
            per[d]["product_urls"] += 1
            k = rules.url_key(x["url"])
            if k in seen:
                per[d]["dup"] += 1
                continue
            if k in picked:
                continue
            if rules.is_wanted_post(x["title"]):
                per[d]["wanted_posts"] += 1
                picked[k] = {"url": x["url"], "domain": d, "title": x["title"], "snippet": x["content"], "query": r["q"], "wanted": True}
                continue
            per[d]["new"] += 1
            picked[k] = {"url": x["url"], "domain": d, "title": x["title"], "snippet": x["content"], "query": r["q"], "img": x.get("img"), "wanted": False}
    return list(picked.values()), per


def fetch_image(url: str) -> bytes | None:
    if not url or not url.startswith("http"):
        return None
    ok, _ = pages.robots_ok(url)
    if not ok:
        return None
    try:
        r = httpx.get(url, headers={"User-Agent": pages.UA}, timeout=15, follow_redirects=True)
        return r.content if r.status_code == 200 and r.headers.get("content-type", "").startswith("image") and len(r.content) < 8_000_000 else None
    except Exception:
        return None


# ── 식별 ─────────────────────────────────────────────────────
MATERIALS = ["트위드", "부클", "울", "코듀로이", "나일론", "가죽", "레더", "스웨이드", "데님", "린넨", "코튼", "플리스", "니트"]


def photo_queries(f: dict) -> list[str]:
    """사진 특징을 쇼핑몰 검색어로 — 색 + 소재 + (집업) + 옷 종류 + 눈에 띄는 디테일. “지퍼 포켓”처럼 옷 종류 없는 검색어는 쓰지 않는다."""
    col = next(iter(f.get("colors") or []), "")
    mat_text = " ".join([f.get("material") or "", f.get("texture") or ""])
    mat = next((m for m in MATERIALS if m in mat_text), "")
    g = f.get("garment") or ""
    kind = "블루종" if "블루종" in g else "코트" if "코트" in g else "점퍼" if "점퍼" in g else "자켓"
    det = " ".join(f.get("details") or [])
    zip_up = "집업" if re.search(r"여밈[^,]*지퍼|지퍼[^,]*여밈|중앙\s*지퍼|집업", det) else ""
    pocket = "가슴 지퍼 포켓" if re.search(r"가슴[^,]*지퍼|지퍼[^,]*포켓", det) else "가슴 포켓" if "가슴" in det and "포켓" in det else ""
    qs = [f"{col} {mat} {zip_up} {kind}", f"{col} {mat} {kind} {pocket}", f"{col} {zip_up} {kind} {pocket}"]
    gw = set(rules.GARMENTS["jacket"] + rules.GARMENTS["coat"])
    qs += [k for k in (f.get("keywords_ko") or []) if any(w in k for w in gw)][:1]
    return [re.sub(r"\s+", " ", q).strip() for q in qs if len(q.split()) >= 2]



async def identify(inp: dict) -> dict:
    t0 = time.monotonic()
    v = Vision(OLLAMA, VLM, log)
    sellers = inp["sellers"]
    domains = [s["domain"] for s in sellers]
    name, brand = (inp.get("productName") or "").strip(), (inp.get("brand") or "").strip()
    if brand and name.lower().startswith(brand.lower()):
        name = name[len(brand):].strip()  # “BADBLOOD BADBLOOD …” 처럼 브랜드가 두 번 들어가지 않게
    features = None
    if inp.get("photo"):
        log("사진 분석(로컬)", VLM)
        try:
            features = v.analyze(inp["photo"])
            log("  특징", json.dumps({k: features[k] for k in ("garment", "colors", "material", "details", "brand_guess")}, ensure_ascii=False))
        except Exception as e:
            log("  사진 분석 실패", type(e).__name__, str(e)[:120])
    # 검색어: 이름이 있으면 이름, 없으면 사진 특징
    queries: list[str] = []
    if name:
        queries += [f"{brand} {name}".strip(), name]
    if features:
        queries += photo_queries(features)
    queries = [re.sub(r"\s+", " ", q).strip()[:60] for q in dict.fromkeys(queries) if q.strip()][:4]
    targets = [d for d in domains if d in NEW_SELLERS] or domains
    plan = [(d, f"{q} site:{d}") for q in queries for d in targets]
    if name:
        plan.append(("*", f"{brand} {name}".strip()))  # 판매처 제한 없이 — 공식몰·다른 판매 페이지를 근거로만 쓴다
    log(f"검색 {len(plan)}회 · 검색어 {queries}")
    results = await searx.search_sites(SEARXNG, plan, delay=DELAY, log=log)
    learn_from_titles(brand, results)
    cands, per = collect(results, domains, set())
    cands = [c for c in cands if not c["wanted"]]
    # 판매처 밖(공식몰 등) 검색 결과 중 이름이 맞는 것 — 상품 근거 주소로만 쓴다
    refs_extra = []
    if name:
        for r in results:
            for x in r["results"]:
                host = (re.match(r"https?://([^/]+)", x["url"]) or [None, ""])[1].lower()
                if rules.seller_domain(x["url"], domains) or any(host == h or host.endswith("." + h) for h in rules.OVERSEAS_HOSTS):
                    continue  # 판매처 6곳은 위에서 따로 보고, 해외 판매용 사이트는 근거로도 쓰지 않는다
                cm = rules.color_match(inp.get("color"), x["title"])
                j = rules.judge(brand=brand, name=name, brand_aliases=aliases_for(brand, inp.get("note") or "")["brand_ko"], name_aliases=[], code=rules.codes_in(inp.get("note") or "")[0] if rules.codes_in(inp.get("note") or "") else None,
                                text=f"{x['title']} {x['content']} {x['url']}", title=x["title"])
                if j["match"] == "same_likely" and re.search(r"/product", x["url"]) and cm != "mismatch" and x["url"] not in {y["url"] for y in refs_extra}:
                    refs_extra.append({"url": x["url"], "title": x["title"], "evidence": j["evidence"]})
    # 이름이 있으면 글자 근거로, 없으면 검색 순서대로 앞의 것을 연다
    if name:
        for c in cands:
            c["judge"] = rules.judge(brand=brand, name=name, brand_aliases=aliases_for(brand, inp.get("note") or "")["brand_ko"], name_aliases=[], code=None, text=f"{c['title']} {c['snippet']}", title=c["title"])
        cands.sort(key=lambda c: {"same_likely": 0, "similar": 1}.get(c["judge"]["match"], 2))
    cands = cands[:MAX_CRAWL]
    pg = {p["url"]: p for p in await pages.crawl([c["url"] for c in cands], log=log)}  # robots 가 막은 곳은 crawl 안에서 열지 않는다
    for c in cands:
        p = pg.get(c["url"], {})
        c["page"] = p
        if brand and p.get("status") not in (None, "robots", "error"):
            learn_alias(brand, p)
    # 사진이 있으면 후보 이미지와 하나씩 비교(근거 수집). 점수만으로 같은 상품이라 하지 않는다.
    compared = 0
    if inp.get("photo") and features:
        for c in cands:
            if compared >= MAX_COMPARE:
                break
            img = fetch_image(c["page"].get("image") or c.get("img") or "")
            if not img:
                continue
            try:
                c["visual"] = v.compare(inp["photo"], img, c["page"].get("title") or c["title"])
                compared += 1
                log(f"  비교 {c['url']} → {c['visual']['verdict']} · 같음 {c['visual']['matching'][:3]} · 다름 {c['visual']['differing'][:3]}")
            except Exception as e:
                log("  비교 실패", type(e).__name__)
    rank = {"same_model_likely": 0, "similar": 2, "cannot_tell": 3, "different": 5}

    def score(c):
        s = rank.get((c.get("visual") or {}).get("verdict"), 4)
        if c.get("judge"):
            s += {"same_likely": -2, "similar": 0}.get(c["judge"]["match"], 1)
        return s
    cands.sort(key=score)
    identities = []
    for c in cands:
        vis = c.get("visual") or {}
        p = c["page"]
        if p.get("status") in ("deleted", "error", "blocked"):
            continue  # 없는 페이지·열지 못한 페이지는 상품 근거가 될 수 없다
        if vis.get("verdict") == "different" or (not vis and not (c.get("judge") or {}).get("match") == "same_likely"):
            continue
        title = p.get("title") or c["title"]
        conf = "medium" if vis.get("verdict") == "same_model_likely" or (c.get("judge") or {}).get("match") == "same_likely" else "low"
        reasons = []
        if vis:
            reasons += [f"사진 비교(로컬 모델): {'같은 모델로 보임' if vis['verdict'] == 'same_model_likely' else '비슷함' if vis['verdict'] == 'similar' else '판단 어려움'}"]
            reasons += [f"같은 점: {x}" for x in vis.get("matching", [])[:3]] + [f"다른 점: {x}" for x in vis.get("differing", [])[:2]]
        if c.get("judge"):
            reasons += c["judge"]["evidence"][:2]
        reasons.append(f"페이지 상태: {STATUS_KO.get(p.get('status'), p.get('status') or '열지 않음')}")
        identities.append({"brand": p.get("brand") or brand, "name": title, "color": "", "category": (features or {}).get("garment", ""), "confidence": conf,
                           "reasons": reasons[:5], "refs": [c["url"]] + [x["url"] for x in refs_extra[:2]]})
        if len(identities) >= 3:
            break
    if name and not identities and refs_extra:
        # 판매처 상품 주소는 못 찾았지만 공식몰 등에서 이름·품번이 맞는 페이지를 찾았다
        x = refs_extra[0]
        identities.append({"brand": brand, "name": name, "color": "", "category": "", "confidence": "medium",
                           "reasons": ["판매처 6곳에서는 상품 주소를 찾지 못했어요", f"판매처 밖 페이지에서 확인: {x['title'][:60]}", *x["evidence"][:2]], "refs": [y["url"] for y in refs_extra[:3]]})
    missing = list((features or {}).get("unknowns") or [])
    if not identities:
        missing.append("정확한 모델명을 알 수 있는 태그·케어라벨 사진이나 구매 링크")
    metrics = {
        "engine": "oss", "vlm": VLM, "features": features, "queries": [{k: r[k] for k in ("domain", "q", "status", "engines_ok", "engines_bad", "ms")} | {"n": len(r["results"])} for r in results],
        "refs_outside_sellers": refs_extra[:10], "per_seller": per, "candidates": [{"url": c["url"], "title": c["page"].get("title") or c["title"], "page_status": c["page"].get("status"), "visual": c.get("visual"),
                                            "judge": (c.get("judge") or {}).get("match")} for c in cands],
        "timing": {"total_ms": int((time.monotonic() - t0) * 1000), "vision_ms": v.ms, "vision_calls": v.calls,
                   "search_ms": sum(r["ms"] for r in results), "crawl_ms": sum(p.get("ms", 0) for p in pg.values())},
        "external_api_calls": 0, "cost_krw": 0,
    }
    summary = (f"로컬 사진 분석 → {features.get('garment', '')} · {', '.join(features.get('colors') or [])} · {features.get('material', '')}. " if features else "") + \
              f"후보 {len(identities)}개(검색 {len(results)}회, 페이지 {len(pg)}개, 사진 비교 {compared}회)."
    return {"identities": identities, "missing": missing[:4], "summary": summary[:300], "features": features, "metrics": metrics}


STATUS_KO = {"ok": "확인 완료", "stock_unknown": "재고 확인 불가", "partial": "일부만 확인", "sold": "판매 완료", "login": "로그인 필요", "blocked": "접근 제한",
             "robots": "수집 금지(robots.txt)", "deleted": "삭제된 페이지", "error": "열지 못함", "not_crawled": "열지 않음(오늘 한도)"}


# ── 정기 탐색 ─────────────────────────────────────────────────
async def search(inp: dict) -> dict:
    """정기 탐색 — 검색 소스(WALF_OSS_SOURCES)로 같은 검색어를 돌리고, pipeline 의 단계별 진단을 그대로 남긴다."""
    t0 = time.monotonic()
    v = Vision(OLLAMA, VLM, log)
    sellers = inp["sellers"]
    brand, name = (inp.get("brand") or "").strip(), (inp.get("name") or "").strip()
    note = inp.get("note") or ""
    model = " ".join(w for w in name.split() if not rules.colors_in(w) and w.lower() != brand.lower())
    color, size = inp.get("color") or "", (inp.get("size") or "").upper()
    code = next(iter(rules.codes_in(note) + rules.codes_in(name)), None)
    color_word = {"navy": "네이비", "black": "블랙", "brown": "브라운", "grey": "그레이", "white": "화이트", "beige": "베이지", "blue": "블루", "green": "그린", "ivory": "아이보리"}.get(rules.color_of(color) or "", color)
    al = aliases_for(brand, note)
    ko = f"{al['brand_ko'][0]} {(al['name_ko'] or [model])[0]}" if al["brand_ko"] else ""
    queries = [q for q in dict.fromkeys([f"{brand} {model}".strip(), ko, f"{brand} {code}" if code else "", f"{ko} {color_word} {size}".strip() if ko else ""]) if q]
    enabled = [x.strip() for x in os.environ.get("WALF_OSS_SOURCES", "naver_web,naver_cafe,tavily,searxng").split(",") if x.strip()]
    src = Sources(enabled, SEARXNG, log)
    log(f"DAY {inp.get('day')} 탐색 · {brand} {model} · 색 {color or '-'} · 사이즈 {size or '-'} · 품번 {code or '-'} · 소스 {src.available()} · 검색어 {queries}")
    raw = []
    for s_ in enabled:
        for q in queries:
            r = src.search(s_, q)
            raw.append(r)
            if r["status"] not in ("no_key", "skipped", "quota"):
                await asyncio.sleep(DELAY if s_ == "searxng" else 0.3)
    learn_from_titles(brand, raw)
    known = {rules.url_key(u) for u in inp.get("known") or []}
    res = await pipeline.run(raw=raw, sellers=sellers, brand=brand, model=model, brand_ko=al["brand_ko"], name_ko=al["name_ko"], code=code, color=color, size=size,
                             known=known, max_crawl=MAX_CRAWL, log=log)
    recheck_in = [r for r in inp.get("recheck") or [] if r.get("url")][:10]
    rechecked = await pages.crawl([r["url"] for r in recheck_in], log=log) if recheck_in else []
    listings, outside = [], []
    compared = 0
    for c in res["candidates"]:
        p = c["page"]
        vis = None
        if inp.get("photo") and inp.get("features") and compared < MAX_COMPARE and c["match"] == "same_likely":
            img = fetch_image(p.get("image") or "") if p.get("image_src") in ("jsonld", "og") else None
            if img:
                try:
                    vis = v.compare(inp["photo"], img, c["title"])
                    compared += 1
                except Exception as e:
                    log("  비교 실패", type(e).__name__)
        ev = list(c["evidence"]) + ([f"다른 색상 표기({c['color_match']})"] if c["color_match"] == "mismatch" else []) + ([f"사이즈 {size} 표기가 있어요"] if c["size_match"] == "match" else [])
        row = {"seller": c["seller"], "url": c["url"], "title": c["title"][:160], "price": p.get("price"), "size": ",".join(sorted(rules.sizes_in(c["title"]))),
               "condition": "used" if c["seller"] in ("번개장터", "중고나라", "후루츠패밀리") or c["kind"] == "cafe" else "new", "match": c["match"],
               "stock": "sold_out" if c["stock"] == "sold_out" else ("listed" if c["stock"] == "listed" else "unknown"), "reason": " · ".join(ev)[:300],
               "pageStatus": p.get("status") or "not_crawled", "colorMatch": c["color_match"], "sizeMatch": c["size_match"], "image": p.get("image") or "",
               "snippet": c["snippet"][:300], "evidence": ev, "query": c["queries"][0] if c["queries"] else "", "visual": vis, "reserved": c["stock"] == "reserved", "sources": c["sources"]}
        # 판매처 6곳은 운영자 검수 목록으로, 그 밖(공식몰·KREAM·솔드아웃·카페)은 리포트의 “판매처 밖 발견”으로
        (listings if c["kind"] == "seller" else outside).append(row)
    notes = []
    for s in sellers:
        mine = [d for d in res["drops"] if s["domain"] in d["url"]]
        found = [x for x in listings if x["seller"] == s["name"]]
        notes.append({"seller": s["name"], "searched": any(r["status"] in ("ok", "empty") for r in raw), "status": "results" if found else "no_results",
                      "note": (f"검수 후보 {len(found)}건" if found else "검수 후보 없음") + (f" · 탈락 {len(mine)}건" if mine else "")})
    metrics = {
        "engine": "oss", "vlm": VLM, "day": inp.get("day"), "aliases": al, "code": code, "sources": src.available(), "queries_text": queries,
        "queries": [{k: r.get(k) for k in ("source", "q", "status", "ms", "error", "cost")} | {"n": len(r["results"])} for r in raw],
        "funnel": res["funnel"], "drops": res["drops"][:300], "domains": res["domains"], "outside_sellers": outside[:30],
        "seller_status": {n["seller"]: n["status"] for n in notes},
        "counts": {"queries": sum(1 for r in raw if r["status"] not in ("no_key", "skipped")), "listings": len(listings), "outside": len(outside),
                   "same_likely": sum(1 for x in listings if x["match"] == "same_likely"), "new_urls": sum(f.get("unique", 0) for f in res["funnel"].values()),
                   "dup_urls": sum(f.get("known", 0) for f in res["funnel"].values()), "wanted_posts": sum(f.get("wanted_post", 0) for f in res["funnel"].values()),
                   "valid_unverified": sum(1 for x in listings + outside if x["match"] == "same_likely" and x["colorMatch"] != "mismatch" and x["sizeMatch"] != "mismatch" and x["stock"] != "sold_out"),
                   "compared": compared},
        "rechecks": [{"url": r["url"], "prevPrice": r.get("price"), "price": p.get("price"), "status": p.get("status"), "stock": p.get("stock")} for r, p in zip(recheck_in, rechecked)],
        "timing": {"total_ms": int((time.monotonic() - t0) * 1000), "search_ms": sum(r["ms"] for r in raw), "crawl_ms": sum(p.get("ms", 0) for p in [*res["opened"].values(), *rechecked]),
                   "vision_ms": v.ms, "vision_calls": v.calls},
        # 무료 API(네이버 API HUB 한시적 무료·Tavily 무료 크레딧) 호출 수와 유료 호출(0)을 따로 센다
        "free_api_calls": sum(1 for r in raw if r["source"] != "searxng" and r["status"] not in ("no_key", "skipped", "quota")),
        "external_api_calls": 0, "cost_krw": 0, "tavily_credits": sum(r.get("cost", 0) for r in raw if r["source"] == "tavily"),
    }
    summary = f"검색 {metrics['counts']['queries']}회({', '.join(k for k, v_ in src.available().items() if v_ == 'ready')}) · 판매처 검수 후보 {len(listings)}건 · 판매처 밖 발견 {len(outside)}건 · 조건 맞음(검수 전) {metrics['counts']['valid_unverified']}건"
    return {"sellers": notes, "listings": listings, "summary": summary, "metrics": metrics}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    inp = json.load(sys.stdin)
    fn = {"identify": identify, "search": search}.get(cmd)
    if not fn:
        print(json.dumps({"error": f"알 수 없는 명령: {cmd}"}), flush=True)
        sys.exit(2)
    try:
        out = asyncio.run(fn(inp))
    except Exception as e:  # 실패는 실패로 돌려준다(서버가 작업 실패로 기록)
        log("엔진 실패", type(e).__name__, str(e)[:300])
        print(json.dumps({"error": f"{type(e).__name__}: {str(e)[:300]}"}, ensure_ascii=False), flush=True)
        sys.exit(1)
    print(json.dumps(out, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
