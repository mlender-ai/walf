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
import rules
import searx
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
async def identify(inp: dict) -> dict:
    t0 = time.monotonic()
    v = Vision(OLLAMA, VLM, log)
    sellers = inp["sellers"]
    domains = [s["domain"] for s in sellers]
    name, brand = (inp.get("productName") or "").strip(), (inp.get("brand") or "").strip()
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
        queries += [k for k in (features.get("keywords_ko") or [])[:3]]
        det = " ".join(re.sub(r"^[^:：]+[:：]\s*", "", d).split("(")[0] for d in (features.get("details") or [])[:2])
        col = " ".join((features.get("colors") or [])[:1])
        queries.append(f"{col} {features.get('material', '').split(',')[0].replace('추정', '')} {features.get('garment', '').split('(')[0]} {det}".strip())
    queries = [re.sub(r"\s+", " ", q).strip()[:60] for q in dict.fromkeys(queries) if q.strip()][:4]
    targets = [d for d in domains if d in NEW_SELLERS] or domains
    plan = [(d, f"{q} site:{d}") for q in queries for d in targets]
    log(f"검색 {len(plan)}회 · 검색어 {queries}")
    results = await searx.search_sites(SEARXNG, plan, delay=DELAY, log=log)
    learn_from_titles(brand, results)
    cands, per = collect(results, domains, set())
    cands = [c for c in cands if not c["wanted"]]
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
        if vis.get("verdict") == "different" or (not vis and not (c.get("judge") or {}).get("match") == "same_likely"):
            continue
        p = c["page"]
        title = p.get("title") or c["title"]
        conf = "medium" if vis.get("verdict") == "same_model_likely" or (c.get("judge") or {}).get("match") == "same_likely" else "low"
        reasons = []
        if vis:
            reasons += [f"사진 비교(로컬 모델): {'같은 모델로 보임' if vis['verdict'] == 'same_model_likely' else '비슷함' if vis['verdict'] == 'similar' else '판단 어려움'}"]
            reasons += [f"같은 점: {x}" for x in vis.get("matching", [])[:3]] + [f"다른 점: {x}" for x in vis.get("differing", [])[:2]]
        if c.get("judge"):
            reasons += c["judge"]["evidence"][:2]
        reasons.append(f"페이지 상태: {STATUS_KO.get(p.get('status'), p.get('status') or '열지 않음')}")
        identities.append({"brand": p.get("brand") or "", "name": title, "color": "", "category": (features or {}).get("garment", ""), "confidence": conf,
                           "reasons": reasons[:5], "refs": [c["url"]]})
        if len(identities) >= 3:
            break
    missing = list((features or {}).get("unknowns") or [])
    if not identities:
        missing.append("정확한 모델명을 알 수 있는 태그·케어라벨 사진이나 구매 링크")
    metrics = {
        "engine": "oss", "vlm": VLM, "features": features, "queries": [{k: r[k] for k in ("domain", "q", "status", "engines_ok", "engines_bad", "ms")} | {"n": len(r["results"])} for r in results],
        "per_seller": per, "candidates": [{"url": c["url"], "title": c["page"].get("title") or c["title"], "page_status": c["page"].get("status"), "visual": c.get("visual"),
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
    t0 = time.monotonic()
    v = Vision(OLLAMA, VLM, log)
    sellers = inp["sellers"]
    domains = [s["domain"] for s in sellers]
    name_of = {s["domain"]: s["name"] for s in sellers}
    brand, name = (inp.get("brand") or "").strip(), (inp.get("name") or "").strip()
    note = inp.get("note") or ""
    # 상품명에 섞인 색·사이즈는 모델명 단어에서 뺀다
    model = " ".join(w for w in name.split() if not rules.colors_in(w) and w.lower() != brand.lower())
    color, size = inp.get("color") or "", (inp.get("size") or "").upper()
    code = next(iter(rules.codes_in(note) + rules.codes_in(name)), None)
    color_word = {"navy": "네이비", "black": "블랙", "brown": "브라운", "grey": "그레이", "white": "화이트", "beige": "베이지", "blue": "블루", "green": "그린", "ivory": "아이보리"}.get(rules.color_of(color) or "", color)
    # 1단계 영문 이름 → 결과 제목에서 한글 표기를 배운 뒤 → 2단계 한글 표기. 판매처당 3회 안쪽.
    plan1: list[tuple[str, str]] = []
    for d in domains:
        plan1.append((d, f"{brand} {model} site:{d}".strip()))
        if code and d in NEW_SELLERS:
            plan1.append((d, f"{brand} {code} site:{d}"))
    log(f"DAY {inp.get('day')} 탐색 · {brand} {model} · 색 {color or '-'} · 사이즈 {size or '-'} · 품번 {code or '-'}")
    results = await searx.search_sites(SEARXNG, plan1, delay=DELAY, log=log)
    learn_from_titles(brand, results)
    al = aliases_for(brand, note)
    plan2: list[tuple[str, str]] = []
    if al["brand_ko"]:
        ko = f"{al['brand_ko'][0]} {(al['name_ko'] or [model])[0]}"
        for d in domains:
            plan2.append((d, f"{ko} site:{d}"))
            if size and d not in NEW_SELLERS:
                plan2.append((d, f"{ko} {size} site:{d}"))
    log(f"  한글 표기 {al} · 2단계 검색 {len(plan2)}회")
    if plan2:
        await asyncio.sleep(DELAY)
        results += await searx.search_sites(SEARXNG, plan2, delay=DELAY, log=log)
    known = {rules.url_key(u) for u in inp.get("known") or []}
    cands, per = collect(results, domains, known)
    wanted = [c for c in cands if c["wanted"]]
    cands = [c for c in cands if not c["wanted"]]
    for c in cands:
        c["judge"] = rules.judge(brand=brand, name=model, brand_aliases=al["brand_ko"], name_aliases=al["name_ko"], code=code, text=f"{c['title']} {c['snippet']}", title=c["title"])
        c["robots"] = pages.robots_ok(c["url"])
    cands.sort(key=lambda c: ({"same_likely": 0, "similar": 1}.get(c["judge"]["match"], 2), c["domain"] in NEW_SELLERS))
    # robots.txt 가 막은 판매처(무신사·W컨셉)는 열지 않고 검색 결과만 쓴다 — 열 수 있는 곳에 한도를 쓴다
    blocked = {c["url"]: {"url": c["url"], "status": "robots", "error": c["robots"][1], "ms": 0} for c in cands if not c["robots"][0]}
    to_open = [c for c in cands if c["judge"]["match"] != "unknown" and c["robots"][0]][:MAX_CRAWL]
    pg = {p["url"]: p for p in await pages.crawl([c["url"] for c in to_open], log=log)} | blocked
    # 지난번에 찾은 매물을 다시 열어 가격·판매 상태 변화를 본다
    recheck_in = [r for r in inp.get("recheck") or [] if r.get("url")][:10]
    rechecked = await pages.crawl([r["url"] for r in recheck_in], log=log) if recheck_in else []
    listings, filtered = [], {"wanted_posts": [c["url"] for c in wanted], "deleted": [], "unknown_match": 0}
    compared = 0
    for c in cands:
        p = pg.get(c["url"]) or {"status": "not_crawled"}
        if c["judge"]["match"] == "unknown":
            filtered["unknown_match"] += 1
            continue
        if p.get("status") == "deleted":
            filtered["deleted"].append(c["url"])
            continue
        if brand and p.get("status") in ("ok", "stock_unknown", "sold", "partial"):
            learn_alias(brand, p)
        page_title = p.get("title") if p.get("title") and rules.norm(p.get("title")) not in ("번개장터", "중고나라", "후루츠패밀리", "[w concept]") else ""
        title = page_title or c["title"]
        # 페이지까지 보면 판정을 다시 한다(제목만 보고 고른 것을 페이지 내용으로 확인)
        j = rules.judge(brand=brand, name=model, brand_aliases=al["brand_ko"], name_aliases=al["name_ko"], code=code,
                        text=" ".join([c["title"], c["snippet"], page_title, p.get("description") or "", p.get("sku") or "", p.get("brand") or ""]), title=page_title or c["title"])
        if p.get("status") in ("ok", "stock_unknown", "sold", "partial") and j["match"] == "unknown":
            j = c["judge"]
        head = (p.get("text_head") or "")[:800]
        color_text = " ".join([c["title"], page_title, p.get("color") or ""]) if c["domain"] in NEW_SELLERS else " ".join([c["title"], page_title, c["snippet"], head])
        cm = rules.color_match(color, color_text)
        sm = rules.size_match(size, " ".join([c["title"], page_title, head if c["domain"] not in NEW_SELLERS else ""]))
        stock = p.get("stock") or ("sold_out" if rules.stock_from("", c["title"], c["snippet"]) == "sold_out" else "unknown")
        if p.get("status") == "sold":
            stock = "sold_out"
        evidence = list(j["evidence"])
        if cm == "match":
            evidence.append(f"색상 {color_word} 표기가 있어요")
        elif cm == "mismatch":
            evidence.append(f"다른 색상 표기: {', '.join(sorted(rules.colors_in(color_text)))}")
        if sm == "match":
            evidence.append(f"사이즈 {size} 표기가 있어요")
        elif sm == "mismatch":
            evidence.append(f"다른 사이즈 표기: {', '.join(sorted(rules.sizes_in(c['title'] + ' ' + page_title)))}")
        vis = None
        if inp.get("photo") and inp.get("features") and compared < MAX_COMPARE and j["match"] == "same_likely":
            img = fetch_image(p.get("image") or c.get("img") or "")
            if img:
                try:
                    vis = v.compare(inp["photo"], img, title)
                    compared += 1
                except Exception as e:
                    log("  비교 실패", type(e).__name__)
        listings.append({
            "seller": name_of[c["domain"]], "url": c["url"], "title": title[:160], "price": p.get("price"), "size": ",".join(sorted(rules.sizes_in(c["title"] + " " + page_title))),
            "condition": "new" if c["domain"] in NEW_SELLERS else "used", "match": j["match"], "stock": "sold_out" if stock == "sold_out" else ("listed" if stock == "listed" else "unknown"),
            "reason": " · ".join(evidence)[:300], "pageStatus": p.get("status") or "not_crawled", "colorMatch": cm, "sizeMatch": sm, "image": p.get("image") or c.get("img") or "",
            "snippet": c["snippet"][:300], "evidence": evidence, "query": c["query"], "visual": vis, "priceSrc": p.get("price_src"), "reserved": stock == "reserved",
        })
    # 판매처별 메모
    notes = []
    for s in sellers:
        d = s["domain"]
        rs = [r for r in results if r["domain"] == d]
        sts = [r["status"] for r in rs]
        searched = any(x in ("ok", "empty") for x in sts)
        crawled = [pg[c["url"]] for c in to_open if c["domain"] == d and c["url"] in pg]
        bad = sorted({why for r in rs for _, why in r["engines_bad"]})
        st = "results" if "ok" in sts else "no_results" if "empty" in sts else "blocked" if "blocked" in sts else "failed"
        txt = {"results": f"검색 {len(rs)}회 · 결과 {per[d]['results']}건(상품 {per[d]['product_urls']} · 새 주소 {per[d]['new']} · 중복 {per[d]['dup']})",
               "no_results": f"검색 {len(rs)}회 · 결과 없음(색인 안 됨일 수도 있어요 — 매물 없음과 달라요)",
               "blocked": "검색 엔진이 막음(" + ", ".join(bad)[:80] + ")", "failed": "검색 실패(" + (", ".join(bad) or (rs[0].get("error") if rs else "-"))[:80] + ")"}[st]
        if crawled:
            txt += " · 페이지 " + ", ".join(f"{STATUS_KO.get(k, k)} {sum(1 for p in crawled if p['status'] == k)}" for k in dict.fromkeys(p["status"] for p in crawled))
        notes.append({"seller": s["name"], "searched": searched, "note": txt[:200], "status": st})
    valid = [x for x in listings if x["match"] == "same_likely" and x["colorMatch"] in ("match", "unknown", "any") and x["sizeMatch"] in ("match", "unknown", "any")
             and x["stock"] != "sold_out" and not x["reserved"]]
    metrics = {
        "engine": "oss", "vlm": VLM, "day": inp.get("day"), "aliases": al, "code": code,
        "queries": [{k: r.get(k) for k in ("domain", "q", "status", "engines_ok", "engines_bad", "ms", "error")} | {"n": len(r["results"])} for r in results],
        "per_seller": per, "seller_status": {n["seller"]: n["status"] for n in notes},
        "counts": {"queries": len(results), "results": sum(p["results"] for p in per.values()), "product_urls": sum(p["product_urls"] for p in per.values()),
                   "new_urls": sum(p["new"] for p in per.values()), "dup_urls": sum(p["dup"] for p in per.values()), "wanted_posts": len(wanted),
                   "opened": len(pg) - len(blocked), "robots_skipped": len(blocked), "pages": {k: sum(1 for p in pg.values() if p["status"] == k) for k in dict.fromkeys(p["status"] for p in pg.values())},
                   "listings": len(listings), "same_likely": sum(1 for x in listings if x["match"] == "same_likely"), "similar": sum(1 for x in listings if x["match"] == "similar"),
                   "valid_unverified": len(valid), "stock_confirmed_listed": sum(1 for x in valid if x["stock"] == "listed"), "deleted": len(filtered["deleted"]),
                   "unknown_match": filtered["unknown_match"], "compared": compared},
        "filtered": filtered,
        "rechecks": [{"url": r["url"], "prevPrice": r.get("price"), "price": p.get("price"), "status": p.get("status"), "stock": p.get("stock")} for r, p in zip(recheck_in, rechecked)],
        "timing": {"total_ms": int((time.monotonic() - t0) * 1000), "search_ms": sum(r["ms"] for r in results), "crawl_ms": sum(p.get("ms", 0) for p in [*pg.values(), *rechecked]),
                   "vision_ms": v.ms, "vision_calls": v.calls},
        "external_api_calls": 0, "cost_krw": 0,
    }
    summary = f"검색 {len(results)}회 · 새 상품 주소 {metrics['counts']['new_urls']}건 · 같은 상품으로 보임 {metrics['counts']['same_likely']}건 · 조건 맞음(검수 전) {len(valid)}건 · 구매글 {len(wanted)}건 제외"
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
