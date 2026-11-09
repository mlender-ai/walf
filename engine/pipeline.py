"""탐색 파이프라인 — 검색 소스가 무엇이든 같은 단계를 거치고, 단계마다 남은 수와 탈락 이유를 남긴다.

단계
  1 수집(raw)            소스가 돌려준 URL
  2 정규화·중복 제거      같은 상품 주소(slug·추적 쿼리 차이)를 하나로
  3 범위 필터             해외 판매용 사이트·국내가 아닌 곳·관련 없는 사이트 제외
  4 상품 페이지 여부       목록·검색·기획전·첫 화면 제외
  5 이미 본 주소           지난 탐색에서 본 것
  6 수집 정책             robots.txt 가 막은 곳은 열지 않음(검색 결과로만 남김)
  7 페이지 확인            HTTP 오류·삭제·접근 제한·로그인 필요
  8 상품 정보 추출         상품명·가격 등
  9 판정                 같은 상품 후보 · 색상/사이즈 불일치 · 구매글
 10 운영자 검수 가능 후보

검색 결과에 나온 것(발견)과 상세 페이지를 자동 수집해도 되는 것(수집 정책)은 따로 기록한다.
"""
from __future__ import annotations

import re
from urllib.parse import unquote, urlsplit

import pages
import rules

# 판매처 6곳 밖에서 함께 볼 국내 판매처(발견 대상). 수집 가능 여부는 robots.txt 로 따로 판단한다.
EXTRA = {"kream.co.kr": "KREAM", "soldout.co.kr": "솔드아웃"}
EXTRA_PRODUCT = {"kream.co.kr": r"/products/\d+", "soldout.co.kr": r"/products?/\d+"}
GENERIC_PRODUCT = r"/(product|products|goods|item|items|catalog)/[^/?#]+"
# 상품 판매와 상관없는 사이트(검색 결과에 자주 섞임)
NOISE = ("tumblr.com", "blogspot.", "wordpress.com", "youtube.com", "youtu.be", "support.google.com", "blog.naver.com", "in.naver.com", "namu.wiki", "wikipedia.org", "instagram.com", "facebook.com",
         "x.com", "twitter.com", "tiktok.com", "pinterest.", "news.", "starnewskorea.com")


def host_of(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def classify_domain(url: str, sellers: list[dict], brand: str, brand_ko: list[str]) -> tuple[str, str]:
    """(분류, 이름) — seller(판매처 6곳) · platform(KREAM·솔드아웃) · official(브랜드 공식몰) · shop(카페24 국내몰) · cafe(네이버 카페) · overseas · other"""
    h = host_of(url)
    if any(h == o or h.endswith("." + o) for o in rules.OVERSEAS_HOSTS) or re.search(r"(^|[.-])(en|english|global|us|jp|cn|hk)\.|taiwan|hongkong|japan|china", h):
        return "overseas", h
    for s in sellers:
        if h == s["domain"] or h.endswith("." + s["domain"]):
            return "seller", s["name"]
    for d, n in EXTRA.items():
        if h == d or h.endswith("." + d):
            return "platform", n
    if h == "cafe.naver.com" or h.endswith(".cafe.naver.com"):
        return "cafe", "네이버 카페"
    if h.endswith(".cafe24.com") or h.endswith(".cafe24shop.com"):
        return "shop", h  # 국내 쇼핑몰 플랫폼(카페24)으로 만든 몰 — 브랜드 아카이브·편집숍 등
    b = re.sub(r"[^a-z0-9]", "", (brand or "").lower())
    if b and len(b) >= 4 and b in re.sub(r"[^a-z0-9]", "", h):
        return "official", h
    return "other", h


def slug_text(url: str) -> str:
    """상품 주소에 들어 있는 이름(카페24 공식몰 등: /product/w-jkt26-055-미스틱-나일론-트랙-자켓-네이비/14555/) — 숫자만 있는 조각은 뺀다"""
    try:
        parts = [unquote(x) for x in urlsplit(url).path.split("/") if x]
    except ValueError:
        return ""
    words = [p for p in parts if re.search(r"[가-힣a-zA-Z]", p) and p.lower() not in ("product", "products", "goods", "category", "display", "item", "catalog")]
    return re.sub(r"[-_+]+", " ", " ".join(words)).strip()


def is_product(url: str, kind: str, name: str, domain_key: str | None) -> bool:
    path = urlsplit(url).path
    if kind == "seller" and domain_key:
        return rules.is_product_url(url, domain_key)
    if kind == "platform":
        return bool(re.search(EXTRA_PRODUCT.get(domain_key or "", GENERIC_PRODUCT), path, re.I))
    if kind == "cafe":
        return bool(re.search(r"/\d+$|ArticleRead|articles/\d+", url))
    if re.search(r"/product/(list|search|recent_view_product|wish_list)\.html", path, re.I):
        return False  # 카페24 목록·검색 화면
    return bool(re.search(GENERIC_PRODUCT, path, re.I))


async def run(*, raw: list[dict], sellers: list[dict], brand: str, model: str, brand_ko: list[str], name_ko: list[str], code: str | None, color: str, size: str,
              known: set[str], max_crawl: int, log=print) -> dict:
    """raw: 소스별 검색 결과 묶음 [{source, q, status, results:[{url,title,content}]}] → 단계별 수·탈락 목록·후보"""
    seller_dom = {s["name"]: s["domain"] for s in sellers}
    drops: list[dict] = []
    funnel: dict[str, dict] = {}

    def f(src: str) -> dict:
        return funnel.setdefault(src, {k: 0 for k in ("raw", "unique", "out_of_scope", "non_product", "known", "robots", "page_error", "extracted", "same", "similar",
                                                     "color_mismatch", "size_mismatch", "wanted_post", "sold", "reviewable")})

    def drop(src, url, stage, reason):
        drops.append({"source": src, "url": url, "stage": stage, "reason": reason})

    # 1~5 단계: 소스별로 센다(같은 주소가 여러 소스에 나오면 각 소스의 수로 모두 센다)
    items: dict[str, dict] = {}  # url_key → 후보
    domain_seen: dict[str, dict] = {}
    for r in raw:
        src = r["source"]
        f(src)["raw"] += len(r["results"])
        seen_here: set[str] = set()
        for x in r["results"]:
            url = x["url"]
            k = rules.url_key(url)
            if k in seen_here:
                continue
            seen_here.add(k)
            f(src)["unique"] += 1
            if any(n in host_of(url) for n in NOISE):
                f(src)["out_of_scope"] += 1
                drop(src, url, "범위", "상품 판매와 상관없는 사이트")
                continue
            kind, name = classify_domain(url, sellers, brand, brand_ko)
            h = host_of(url)
            domain_seen.setdefault(h, {"kind": kind, "name": name, "sources": set(), "urls": 0})
            domain_seen[h]["sources"].add(src)
            domain_seen[h]["urls"] += 1
            if kind == "overseas":
                f(src)["out_of_scope"] += 1
                drop(src, url, "범위", "해외 판매용 사이트")
                continue
            if kind == "other" and not h.endswith(".kr"):
                f(src)["out_of_scope"] += 1
                drop(src, url, "범위", "국내 판매처로 확인되지 않은 사이트")
                continue
            dkey = seller_dom.get(name) if kind == "seller" else next((d for d in EXTRA if h == d or h.endswith("." + d)), None)
            if not is_product(url, kind, name, dkey):
                f(src)["non_product"] += 1
                drop(src, url, "상품 페이지 아님", f"{name} 첫 화면·목록·검색·후기 등")
                continue
            if k in known:
                f(src)["known"] += 1
                drop(src, url, "이미 본 주소", "지난 탐색에서 본 주소")
                continue
            it = items.setdefault(k, {"url": url, "kind": kind, "seller": name, "title": x["title"], "snippet": x.get("content", ""), "sources": set(), "queries": set()})
            it["sources"].add(src)
            it["queries"].add(r["q"])
    # 6~8 단계: 수집 정책 · 페이지 확인 · 추출
    for it in items.values():
        # 공식몰 주소에는 브랜드명이 없다(도메인이 곧 브랜드) — 판정할 때 브랜드를 붙인다
        pre = f"{brand} " if it["kind"] == "official" else ""
        it["judge0"] = rules.judge(brand=brand, name=model, brand_aliases=brand_ko, name_aliases=name_ko, code=code, text=f"{pre}{it['title']} {it['snippet']} {slug_text(it['url'])}", title=pre + it["title"])
        tos = pages.tos_block(it["url"])
        it["robots"] = (False, tos) if tos else pages.robots_ok(it["url"])
        it["tos"] = bool(tos)
    order = sorted(items.values(), key=lambda it: ({"same_likely": 0, "similar": 1}.get(it["judge0"]["match"], 2), it["kind"] != "official"))
    # 여는 한도는 같은 상품이거나 모델 이름 단어가 겹치는 것에만 쓴다(브랜드만 같은 매물 50개를 다 열지 않는다)
    worth = [it for it in order if it["robots"][0] and (it["judge0"]["match"] == "same_likely" or (it["judge0"]["match"] == "similar" and it["judge0"]["model_hits"]))]
    to_open = worth[:max_crawl]
    for it in order:
        if it["robots"][0] and it not in worth and it["judge0"]["match"] != "unknown":
            it["skip_open"] = "브랜드만 같고 모델 이름 단어가 없음"
    opened = {p["url"]: p for p in await pages.crawl([it["url"] for it in to_open], log=log)}
    cands, leads = [], []
    for it in items.values():
        srcs = sorted(it["sources"])
        if not it["robots"][0]:
            for s in srcs:
                f(s)["robots"] += 1
            drop(",".join(srcs), it["url"], "수집 정책", it["robots"][1] + " — 열지 않음, 수동 확인 단서로만")
            leads.append({"url": it["url"], "seller": it["seller"], "title": it["title"], "why": it["robots"][1], "sources": srcs})
            continue
        else:
            p = opened.get(it["url"]) or {"status": "not_crawled"}
            if p["status"] in ("deleted", "error", "blocked", "login"):
                for s in srcs:
                    f(s)["page_error"] += 1
                drop(",".join(srcs), it["url"], "페이지 확인", {"deleted": "삭제·없는 페이지", "error": "열지 못함", "blocked": "접근 제한", "login": "로그인 필요"}[p["status"]] + (f" (HTTP {p.get('http')})" if p.get("http") else ""))
                continue
            if p["status"] in ("ok", "stock_unknown", "sold", "partial") and p.get("title"):
                for s in srcs:
                    f(s)["extracted"] += 1
            if p["status"] == "not_crawled":
                if it.get("skip_open"):
                    drop(",".join(srcs), it["url"], "판정", it["skip_open"])
                    continue
                # 오늘 한도로 열지 않은 것도 제목만으로는 매물로 보지 않는다
                leads.append({"url": it["url"], "seller": it["seller"], "title": it["title"], "why": "오늘 페이지 확인 한도로 열지 않음", "sources": srcs})
                continue
        generic_titles = ("번개장터", "중고나라", "후루츠패밀리", "[w concept]", "모든 취향 곁에, 29cm")
        page_title = p.get("title") if p.get("title") and rules.norm(p.get("title")) not in generic_titles else ""
        slug = slug_text(it["url"])
        # 페이지·검색 제목이 쇼핑몰 이름뿐이면(“배드블러드 BADBLOOD”) 주소 속 상품명을 제목으로 쓴다
        model_tok = [t for t in rules.tokens(model) if t not in rules.GENERIC]
        if slug and not any(t in rules.norm(page_title or it["title"]) for t in model_tok + [rules.norm(x) for x in name_ko]):
            page_title = slug
        title = page_title or it["title"]
        if rules.is_wanted_post(title):
            for s in srcs:
                f(s)["wanted_post"] += 1
            drop(",".join(srcs), it["url"], "판정", "구매글(구해요·삽니다)")
            continue
        pre = f"{brand} " if it["kind"] == "official" else ""
        text = " ".join([pre, it["title"], it["snippet"], page_title, slug, p.get("description") or "", p.get("sku") or "", p.get("brand") or ""])
        j = rules.judge(brand=brand, name=model, brand_aliases=brand_ko, name_aliases=name_ko, code=code, text=text, title=pre + title)
        used = it["kind"] in ("seller",) and it["seller"] in ("번개장터", "중고나라", "후루츠패밀리") or it["kind"] == "cafe"
        head = (p.get("text_head") or "")[:800]
        ctext = " ".join([it["title"], page_title, slug, p.get("color") or ""] + ([it["snippet"], head] if used else []))
        cm = rules.color_match(color, ctext)
        sm = rules.size_match(size, " ".join([it["title"], page_title] + ([head] if used else [])))
        stock = p.get("stock") or rules.stock_from("", it["title"], it["snippet"])
        if p.get("status") == "sold":
            stock = "sold_out"
        opt = None
        if p.get("options"):
            # 카페24 옵션 재고: 원하는 색·사이즈 칸의 재고가 곧 판매 상태다(페이지 전체 품절 표시보다 정확)
            opt = rules.option_for(p["options"], color, size)
            if opt["stock"] == "none":
                sm = "mismatch" if size else sm
            else:
                sm = "match" if size else sm
                cm = "match" if color else cm
                stock = opt["stock"] if opt["stock"] != "unknown" else stock
        if j["match"] == "unknown":
            drop(",".join(srcs), it["url"], "판정", "브랜드·모델 근거 없음")
            continue
        for s in srcs:
            f(s)["same" if j["match"] == "same_likely" else "similar"] += 1
            if cm == "mismatch":
                f(s)["color_mismatch"] += 1
            if sm == "mismatch":
                f(s)["size_mismatch"] += 1
            if stock == "sold_out":
                f(s)["sold"] += 1
            f(s)["reviewable"] += 1
        if cm == "mismatch":
            drop(",".join(srcs), it["url"], "판정(후보로 남김)", f"색상 불일치: {', '.join(sorted(rules.colors_in(ctext)))}")
        ev = list(j["evidence"])
        if opt and opt["stock"] != "none":
            ev.append(f"옵션 재고 {opt['option']}: {opt['count'] if opt['count'] is not None else '수량 미표시'}" + (" (품절)" if opt["stock"] == "sold_out" else ""))
        elif opt:
            ev.append(f"원하는 색·사이즈 옵션이 없어요 ({', '.join(o['option'] for o in p['options'][:6])})")
        cands.append({**it, "sources": srcs, "queries": sorted(it["queries"]), "page": p, "title": title, "match": j["match"], "evidence": ev, "option": opt,
                      "color_match": cm, "size_match": sm, "stock": stock})
    domains = {h: {"kind": d["kind"], "name": d["name"], "sources": sorted(d["sources"]), "urls": d["urls"], "robots": pages.robots_ok(f"https://{h}/")[1] if d["kind"] != "overseas" else "-"}
               for h, d in domain_seen.items() if d["kind"] in ("seller", "platform", "official", "shop", "cafe") or h.endswith(".kr")}
    return {"funnel": funnel, "drops": drops, "candidates": cands, "leads": leads, "domains": domains, "opened": opened}
