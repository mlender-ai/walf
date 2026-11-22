"""규칙 기반 판정 — 외부 의존 없음. 검색 결과·페이지 문구는 판정 재료(데이터)일 뿐 지시로 취급하지 않는다.

판정은 언제나 보수적으로 한다.
- 같은 상품: 브랜드 + 모델 고유 단어(또는 품번)가 함께 보여야 '같은 상품으로 보임'. 확정(동일 상품 확인)은 운영자만 한다.
- 판매 상태: 판매 중이라는 근거가 없으면 '모름'. 구매 가능은 절대 판정하지 않는다.
- 구매글(구해요·삽니다)·삭제된 글은 매물이 아니다.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlsplit

# ── 색상 ─────────────────────────────────────────────────────
COLORS: dict[str, list[str]] = {
    "navy": ["navy", "네이비", "남색", "곤색", "dark blue", "다크블루", "다크 블루", "midnight"],
    "black": ["black", "블랙", "검정", "검은", "흑색"],
    "white": ["white", "화이트", "흰색", "하얀"],
    "ivory": ["ivory", "아이보리", "cream", "크림", "ecru", "에크루"],
    "grey": ["grey", "gray", "그레이", "회색", "charcoal", "차콜", "melange", "멜란지"],
    "brown": ["brown", "브라운", "갈색", "mocha", "모카", "chocolate", "초콜릿", "camel", "카멜", "tan"],
    "beige": ["beige", "베이지", "sand", "샌드", "oatmeal", "오트밀"],
    "blue": ["blue", "블루", "파랑", "파란", "sky", "스카이", "light blue"],
    "green": ["green", "그린", "초록", "olive", "올리브", "khaki", "카키", "forest"],
    "red": ["red", "레드", "빨강", "빨간", "burgundy", "버건디", "wine", "와인"],
    "purple": ["purple", "퍼플", "보라", "violet"],
    "pink": ["pink", "핑크"],
    "yellow": ["yellow", "옐로우", "노랑", "노란", "mustard", "머스타드"],
    "orange": ["orange", "오렌지"],
}
# 'dark blue' 처럼 다른 색 이름을 품은 표현이 있으므로 긴 표현부터 찾고 지운다
_COLOR_TERMS = sorted(((t, c) for c, ts in COLORS.items() for t in ts), key=lambda x: -len(x[0]))


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"\s+", " ", s).strip()


def color_of(text: str | None) -> str | None:
    """사용자가 쓴 색(“네이비”, “Navy”)을 표준 이름으로"""
    found = colors_in(text)
    return next(iter(found)) if len(found) == 1 else None


def colors_in(text: str | None) -> set[str]:
    t = " " + norm(text) + " "
    out: set[str] = set()
    for term, color in _COLOR_TERMS:
        # 영문은 단어 경계, 한글은 그대로(“네이비M” 처럼 붙여 쓰는 경우가 많다)
        pat = r"(?<![a-z])" + re.escape(term) + r"(?![a-z])" if term.isascii() else re.escape(term)
        if re.search(pat, t):
            out.add(color)
            t = re.sub(pat, " ", t)
    return out


def color_match(wanted: str | None, text: str | None) -> str:
    """match: 원하는 색이 보임 · mismatch: 다른 색만 보임 · unknown: 색 표기가 없음 · any: 원하는 색 없음"""
    w = color_of(wanted)
    if not w:
        return "any"
    found = colors_in(text)
    if not found:
        return "unknown"
    return "match" if w in found else "mismatch"


# ── 사이즈 ────────────────────────────────────────────────────
_ALPHA = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "FREE"]
_NUM_TO_ALPHA = {"85": "XS", "90": "S", "95": "M", "100": "L", "105": "XL", "110": "XXL"}


def sizes_in(text: str | None) -> set[str]:
    t = unicodedata.normalize("NFKC", text or "").upper()
    out: set[str] = set()
    for m in re.finditer(r"(?<![A-Z0-9])(XXXL|XXL|XL|XXS|XS|2XL|3XL|FREE|[SML])(?![A-Z0-9])", t):
        tok = m.group(1)
        # 한 글자 S/M/L 은 근처에 사이즈 표시가 있을 때만 믿는다(“M사이즈”, “사이즈 M”, “(M)”, “/ M”)
        if len(tok) == 1:
            around = t[max(0, m.start() - 6): m.end() + 6]
            if not re.search(r"사이즈|SIZE|\(|\)|/|\[|\]|,|·|호|착용", around):
                continue
        out.add({"2XL": "XXL", "3XL": "XXXL"}.get(tok, tok))
    for m in re.finditer(r"(?<!\d)(85|90|95|100|105|110)(?!\d)\s*(?:사이즈|호|size)?", t, re.I):
        around = t[max(0, m.start() - 6): m.end() + 6]
        if re.search(r"사이즈|SIZE|호|\(|\)", around):
            out.add(_NUM_TO_ALPHA[m.group(1)])
    return out


def size_match(wanted: str | None, text: str | None) -> str:
    """match · mismatch(다른 사이즈만 보임) · unknown(사이즈 표기 없음) · any(원하는 사이즈 없음)"""
    w = (wanted or "").strip().upper()
    if not w:
        return "any"
    w = _NUM_TO_ALPHA.get(w, w)
    found = sizes_in(text)
    if not found:
        return "unknown"
    return "match" if w in found else "mismatch"


# ── 글 종류 · 판매 상태 ─────────────────────────────────────────
_WANTED = re.compile(r"구해요|구합니다|구함|삽니다|사요\b|매입|구매합니다|구매원해|찾습니다|찾아요|wtb", re.I)
_SOLD = re.compile(r"판매\s*완료|거래\s*완료|품절|sold\s*out|soldout|판매\s*종료|판매가\s*종료", re.I)
_RESERVED = re.compile(r"예약\s*중|거래\s*중|예약됨", re.I)
_DELETED = re.compile(r"삭제된\s*(상품|게시|글)|존재하지\s*않는\s*(상품|페이지|게시)|판매\s*중지|찾을\s*수\s*없는\s*(상품|페이지)|페이지를\s*찾을\s*수", re.I)
_LOGIN = re.compile(r"로그인(이|을)?\s*(필요|해\s*주세요|후\s*이용|하세요)|로그인\s*후\s*(확인|이용|구매)", re.I)
_BLOCK = re.compile(r"captcha|접근이\s*(제한|차단)|access\s*denied|too\s*many\s*requests|비정상적인\s*접근|자동화된\s*(접근|요청)", re.I)


def is_wanted_post(title: str | None) -> bool:
    return bool(_WANTED.search(norm(title)))


def stock_from(availability: str | None, title: str | None, text: str | None) -> str:
    """listed(판매 중 표시) · sold_out · reserved · unknown — 구매 가능은 판정하지 않는다"""
    a = norm(availability)
    head = norm(title) + " " + norm((text or "")[:1500])
    if "outofstock" in a or "soldout" in a or "discontinued" in a or _SOLD.search(norm(title)):
        return "sold_out"
    if _RESERVED.search(norm(title)):
        return "reserved"
    if "instock" in a or "limitedavailability" in a or "preorder" in a:
        # 본문 앞부분에 판매 완료 표시가 있으면 구조화 데이터보다 화면 문구를 믿는다
        return "sold_out" if _SOLD.search(head) else "listed"
    if _SOLD.search(head):
        return "sold_out"
    return "unknown"


def page_flags(text: str | None) -> dict[str, bool]:
    t = (text or "")[:4000]
    return {"deleted": bool(_DELETED.search(t)), "login": bool(_LOGIN.search(t)), "blocked": bool(_BLOCK.search(t))}


# ── 같은 상품인지 ──────────────────────────────────────────────
GENERIC = {
    "jacket", "jackets", "자켓", "재킷", "점퍼", "jumper", "coat", "코트", "shirt", "셔츠", "pants", "팬츠", "바지", "top", "tee", "티셔츠",
    "nylon", "나일론", "wool", "울", "cotton", "코튼", "track", "트랙", "zip", "집업", "zipup", "zip-up", "블루종", "blouson", "hoodie", "후드",
    "men", "mens", "women", "womens", "남성", "여성", "unisex", "공용", "new", "신상", "정품", "새상품", "중고", "the", "and", "of", "with",
}


# 옷 종류 — 찾는 옷과 종류가 다르면(자켓 ↔ 팬츠·모자) 같은 라인 이름이어도 같은 상품이 아니다
GARMENTS: dict[str, list[str]] = {
    "jacket": ["jacket", "자켓", "재킷", "점퍼", "jumper", "blouson", "블루종", "windbreaker", "윈드브레이커", "바람막이", "parka", "파카", "anorak", "아노락"],
    "coat": ["coat", "코트"], "vest": ["vest", "베스트", "조끼"],
    "pants": ["pants", "팬츠", "바지", "jogger", "joggers", "조거", "trousers", "jeans", "jean", "청바지", "데님팬츠", "bootcut", "부츠컷", "슬랙스"],
    "shorts": ["shorts", "쇼츠", "반바지", "bermuda", "버뮤다"], "skirt": ["skirt", "스커트", "치마"],
    "top": ["tee", "t-shirt", "티셔츠", "shirt", "셔츠", "long sleeve", "longsleeve", "롱슬리브", "sweatshirt", "맨투맨", "knit", "니트", "cardigan", "가디건", "hoodie", "hooded", "후드", "후디", "top"],
    "cap": ["cap", "캡", "모자", "hat", "beanie", "비니"], "bag": ["bag", "백", "가방"], "shoes": ["shoes", "신발", "sneakers", "스니커즈"],
    "acc": ["towel", "타월", "socks", "양말", "keyring", "키링", "belt", "벨트"],
}


def garments_in(text: str | None) -> set[str]:
    t = " " + norm(text) + " "
    out = set()
    for g, words in GARMENTS.items():
        for w in words:
            pat = r"(?<![a-z])" + re.escape(w) + r"(?![a-z])" if w.isascii() else re.escape(w)
            if re.search(pat, t):
                out.add(g)
                break
    return out


def tokens(s: str | None) -> list[str]:
    return [t for t in re.split(r"[^0-9a-z가-힣]+", norm(s)) if len(t) >= 2]


def codes_in(s: str | None) -> list[str]:
    """품번처럼 보이는 것(W-JKT26-055, WJKT26055 등)"""
    t = unicodedata.normalize("NFKC", s or "").upper()
    return re.findall(r"\b[A-Z]{1,4}-?[A-Z]{0,4}\d{2}-?\d{2,4}\b", t)


def _squash(s: str) -> str:
    return re.sub(r"[^0-9A-Z]", "", s.upper())


def judge(*, brand: str, name: str, brand_aliases: list[str], name_aliases: list[str], code: str | None, text: str, title: str | None = None) -> dict:
    """같은 상품으로 볼 근거를 모은다. match: same_likely · similar · unknown

    same_likely 는 브랜드가 같고, 품번이 같거나 (모델 고유 단어 + 옷 종류 + 소재·라인 단어)가 함께 맞을 때만.
    옷 종류가 다르면(자켓을 찾는데 팬츠·모자) 같은 라인 이름이어도 similar 다. 제목(title)이 있으면 옷 종류는 제목으로 본다.
    """
    t = norm(text)
    tt = set(tokens(text))
    squashed = _squash(text)
    brands = [b for b in {norm(brand), *map(norm, brand_aliases)} if b]
    brand_hit = any((b in t) or (b.replace(" ", "") in t.replace(" ", "")) for b in brands)
    model = [x for x in dict.fromkeys(tokens(name) + [y for a in name_aliases for y in tokens(a)]) if x not in GENERIC and x not in {norm(b) for b in brands} and not colors_in(x)]
    hits = [x for x in model if x in tt or (len(x) >= 3 and x in t)]
    code_hit = bool(code) and _squash(code) in squashed
    wanted_g = garments_in(" ".join([name, *name_aliases]))
    got_g = garments_in(title if title else text)
    garment_ok = not wanted_g or bool(wanted_g & got_g)
    garment_conflict = bool(wanted_g) and bool(got_g) and not (wanted_g & got_g)
    # 흔한 단어 중 소재·라인 단어(나일론·트랙·울 …)는 보조 근거
    desc = [x for x in dict.fromkeys(tokens(name) + [y for a in name_aliases for y in tokens(a)]) if x in GENERIC and not garments_in(x)]
    desc_hits = [x for x in desc if x in tt or (len(x) >= 3 and x in t)]
    evidence: list[str] = []
    if code_hit:
        evidence.append(f"품번 {code} 표기가 있어요")
    if brand_hit:
        evidence.append("브랜드명이 같아요")
    if hits:
        evidence.append("모델명 단어가 겹쳐요: " + ", ".join(hits[:5]))
    if garment_conflict:
        evidence.append("옷 종류가 달라요: " + ", ".join(sorted(got_g)))
    # 모델 고유 단어는 표기 하나(영문 이름 또는 한글 표기 하나)의 단어가 모두 보여야 한다
    def distinct(x: str) -> list[str]:
        return [w for w in tokens(x) if w not in GENERIC and w not in {norm(b) for b in brands} and not colors_in(w)]
    sets = [d for d in (distinct(x) for x in [name, *name_aliases]) if d]
    # 모델 고유 단어는 제목에 있어야 한다(설명·태그에만 있는 “미스틱”으로 다른 모델을 같은 상품으로 보지 않는다)
    th = norm(title) if title else t
    tth = set(tokens(title)) if title else tt
    full = any(all(w in tth or (len(w) >= 3 and w in th) for w in d) for d in sets)
    model_ok = (not sets or full) and (not desc or bool(desc_hits))
    if brand_hit and code_hit and not garment_conflict:
        match = "same_likely"
    elif brand_hit and hits and model_ok and garment_ok and not garment_conflict:
        match = "same_likely"
    elif brand_hit or (len(hits) >= 2):
        match = "similar"
    else:
        match = "unknown"
    return {"match": match, "brand_hit": brand_hit, "model_hits": hits, "model_tokens": model, "code_hit": code_hit, "garment_conflict": garment_conflict, "evidence": evidence}


# ── 주소 ─────────────────────────────────────────────────────
# 판매처별 “상품 하나”를 가리키는 주소 모양. 목록·검색·기획전 주소는 매물이 아니다.
PRODUCT_PATH = {
    "musinsa.com": r"/(products|app/goods|goods)/\d+",
    "29cm.co.kr": r"/(products|catalog|product)/\d+",
    "wconcept.co.kr": r"/product/\d+",
    "bunjang.co.kr": r"/products/\d+",
    "joongna.com": r"/(product|products)/\d+",
    "fruitsfamily.com": r"/product/[0-9a-z]+",
}


# 같은 회사라도 해외 판매용 사이트는 대상이 아니다(해외 탐색 제외)
OVERSEAS_HOSTS = ("global.musinsa.com", "en.29cm.co.kr", "global.wconcept.co.kr", "us.wconcept.com")


def seller_domain(url: str, domains: list[str]) -> str | None:
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return None
    host = host.lower()
    if any(host == h or host.endswith("." + h) for h in OVERSEAS_HOSTS):
        return None
    return next((d for d in domains if host == d or host.endswith("." + d)), None)


def is_product_url(url: str, domain: str) -> bool:
    pat = PRODUCT_PATH.get(domain)
    if not pat:
        return True
    try:
        return bool(re.search(pat, urlsplit(url).path, re.I))
    except ValueError:
        return False


def url_key(url: str) -> str:
    try:
        u = urlsplit(url)
        host = (u.hostname or "").lower()
        host = re.sub(r"^(www|m)\.", "", host)
        # 상품 주소의 뒤에 붙는 제목 slug·추적용 쿼리는 같은 상품을 다른 주소로 보이게 한다
        path = re.sub(r"/+$", "", u.path)
        m = re.search(r"/(?:products?|goods|catalog)/([0-9a-z]+)", path, re.I)
        if m:
            path = path[: m.end()]
        return host + path
    except ValueError:
        return url


def option_for(options: list[dict], color: str | None, size: str | None) -> dict:
    """옵션 재고에서 원하는 색·사이즈 칸을 찾는다.
    결과 stock: listed(재고 있음) · sold_out(재고 0·판매 안 함) · unknown(재고 관리 안 하는 옵션) · none(원하는 칸이 없음)"""
    want_c = colors_in(color)  # “블루그레이”처럼 색 이름이 둘인 색도 그대로 비교한다
    w = (size or "").strip().upper()
    w = _NUM_TO_ALPHA.get(w, w)
    hits = []
    for o in options or []:
        vals = [norm(x) for x in o.get("values") or []]
        c_ok = not want_c or any(colors_in(x) == want_c for x in vals)
        s_ok = not w or any(x.upper() == w or _NUM_TO_ALPHA.get(x.upper()) == w for x in vals)
        if c_ok and s_ok:
            hits.append(o)
    if not hits:
        return {"stock": "none", "option": None}
    o = next((x for x in hits if x.get("selling") and (x.get("stock") or 0) > 0), hits[0])
    if not o.get("selling") or o.get("stock") == 0:
        st = "sold_out"
    elif o.get("stock") is None:
        st = "unknown"
    else:
        st = "listed"
    return {"stock": st, "option": o["option"], "count": o.get("stock")}


# ── 성별(브랜드 미상 의뢰의 비슷한 옷 찾기) ─────────────────────────────
GENDER_WORDS = {"남자": "men", "남성": "men", "맨즈": "men", "여자": "women", "여성": "women"}
# 매물 제목에 보이는 성별 단서. 44·55·66·77 은 국내 여성복 사이즈 표기다
WOMEN_RE = re.compile(r"여성|여자|우먼|레이디|미시|women|ladies|lady|(?<!\d)(44|55|66|77)(?!\d)", re.I)
MEN_RE = re.compile(r"남성|남자|맨즈|(?<![a-z])men'?s?(?![a-z])|homme|옴므", re.I)


def gender_of(text: str) -> str:
    """제목에서 읽은 성별 — men · women · 둘 다 보이거나 안 보이면 빈 값"""
    w, m = bool(WOMEN_RE.search(text or "")), bool(MEN_RE.search(text or ""))
    return "women" if w and not m else "men" if m and not w else ""
