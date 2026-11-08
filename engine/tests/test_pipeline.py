"""파이프라인 단계별 수·탈락 이유, 검색 소스의 한도 안전장치 — 네트워크 없이(가짜 응답)."""
import asyncio
import os
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# 페이지 수집(브라우저)은 가짜로 바꾼다
fake_pages = types.ModuleType("pages")
ROBOTS_BLOCK = ("musinsa.com",)
fake_pages.robots_ok = lambda url: (not any(d in url for d in ROBOTS_BLOCK), "robots.txt: 일반 수집기(*)를 막음" if any(d in url for d in ROBOTS_BLOCK) else "robots.txt: 허용")
PAGES = {
    "https://badblood.co.kr/product/w-jkt26-055-%EB%AF%B8%EC%8A%A4%ED%8B%B1-%EB%82%98%EC%9D%BC%EB%A1%A0-%ED%8A%B8%EB%9E%99-%EC%9E%90%EC%BC%93-%EB%84%A4%EC%9D%B4%EB%B9%84/14555/":
        {"status": "stock_unknown", "title": "배드블러드 BADBLOOD", "price": 189000, "stock": "unknown"},
    "https://fruitsfamily.com/product/aaa/x": {"status": "sold", "title": "배드블러드 미스틱 나일론 트랙 자켓 네이비 M", "price": 90000, "stock": "sold_out"},
    "https://m.bunjang.co.kr/products/1": {"status": "deleted", "http": 404},
}


async def _crawl(urls, log=print):
    return [{"url": u, **PAGES.get(u, {"status": "partial", "title": ""})} for u in urls]
fake_pages.crawl = _crawl
sys.modules["pages"] = fake_pages
import pipeline  # noqa: E402

SELLERS = [{"name": "무신사", "domain": "musinsa.com"}, {"name": "번개장터", "domain": "bunjang.co.kr"}, {"name": "후루츠패밀리", "domain": "fruitsfamily.com"}]
R = lambda url, title="", content="": {"url": url, "title": title, "content": content}  # noqa: E731


class Funnel(unittest.TestCase):
    def test_each_stage_counts_and_keeps_reasons(self):
        raw = [{"source": "naver_web", "q": "q", "status": "ok", "results": [
            R(list(PAGES)[0], "배드블러드 BADBLOOD"),                                  # 공식몰(주소 속 상품명으로 판정)
            R(list(PAGES)[0] + "?utm_source=x", "배드블러드 BADBLOOD"),                  # 같은 주소(중복)
            R("https://global.musinsa.com/us/products/1", "BADBLOOD Mystic"),          # 해외몰
            R("https://www.musinsa.com/main/musinsa/recommend", "배드블러드 미스틱 나일론 트랙 자켓 - 네이비 전체 후기"),  # 상품 페이지 아님
            R("https://www.musinsa.com/products/123", "배드블러드(BADBLOOD) 미스틱 나일론 트랙 자켓 - 네이비"),       # robots
            R("https://fruitsfamily.com/product/aaa/x", "배드블러드 미스틱 나일론 트랙 자켓 네이비 M"),             # 판매 완료
            R("https://m.bunjang.co.kr/products/1", "배드블러드 미스틱 트랙자켓"),                               # 삭제
            R("https://m.bunjang.co.kr/products/2", "배드블러드 미스틱 나일론 트랙 자켓 M 구해요"),                 # 구매글
            R("https://www.youtube.com/watch?v=1", "BAD"),                                                  # 관련 없음
        ]}]
        res = asyncio.run(pipeline.run(raw=raw, sellers=SELLERS, brand="BADBLOOD", model="Mystic Nylon Track Jacket", brand_ko=["배드블러드"],
                                       name_ko=["미스틱 나일론 트랙 자켓"], code="W-JKT26-055", color="네이비", size="M", known=set(), max_crawl=10, log=lambda *a: None))
        f = res["funnel"]["naver_web"]
        self.assertEqual(f["raw"], 9)
        self.assertEqual(f["unique"], 8, "추적 쿼리만 다른 같은 주소는 하나로")
        self.assertEqual(f["out_of_scope"], 2, "해외몰·유튜브")
        self.assertEqual(f["non_product"], 1)
        self.assertEqual(f["robots"], 1)
        self.assertEqual(f["page_error"], 1)
        self.assertEqual(f["wanted_post"], 1)
        reasons = {d["reason"] for d in res["drops"]}
        self.assertTrue(any("해외" in r for r in reasons) and any("구매글" in r for r in reasons) and any("삭제" in r for r in reasons))
        by = {c["url"]: c for c in res["candidates"]}
        off = by[list(PAGES)[0]]
        self.assertEqual(off["match"], "same_likely", "제목이 쇼핑몰 이름뿐이어도 주소 속 품번·상품명으로 판정")
        self.assertEqual(off["color_match"], "match")
        self.assertEqual(off["kind"], "official")
        self.assertEqual(by["https://fruitsfamily.com/product/aaa/x"]["stock"], "sold_out", "판매 완료는 판매 완료")
        self.assertEqual(by["https://www.musinsa.com/products/123"]["page"]["status"], "robots", "robots 가 막은 곳은 열지 않고 검색 결과로만 판정")


class Sources(unittest.TestCase):
    def setUp(self):
        try:
            import httpx  # noqa: F401
        except ImportError:
            self.skipTest("httpx 없음")
        self.tmp = tempfile.mkdtemp()
        os.environ["WALF_OSS_HOME"] = self.tmp
        for k in ("WALF_NAVER_HUB_ID", "WALF_NAVER_HUB_SECRET", "WALF_TAVILY_KEY"):
            os.environ.pop(k, None)
        import importlib
        import sources
        self.sources = importlib.reload(sources)

    def test_no_key_means_not_run(self):
        s = self.sources.Sources(["naver_web", "tavily"], "http://x", log=lambda *a: None)
        self.assertEqual(s.search("tavily", "q")["status"], "no_key")
        self.assertIn("키 없음", s.search("naver_web", "q")["error"])

    def test_quota_stops_source_for_the_run(self):
        os.environ["WALF_TAVILY_KEY"] = "tvly-test"
        s = self.sources.Sources(["tavily"], "http://x", log=lambda *a: None)

        class Resp:
            status_code = 432
            text = "exceeds your plan's set usage limit"
        s.client.post = lambda *a, **k: Resp()
        self.assertEqual(s.search("tavily", "q1")["status"], "quota")
        self.assertEqual(s.search("tavily", "q2")["status"], "skipped", "한도에 걸리면 이번 실행에서 다시 부르지 않는다(유료 전환 없음)")

    def test_self_cap(self):
        os.environ["WALF_TAVILY_KEY"] = "tvly-test"
        self.sources.LIMITS["tavily"]["month"] = 1
        self.sources._count("tavily")
        s = self.sources.Sources(["tavily"], "http://x", log=lambda *a: None)
        self.assertEqual(s.search("tavily", "q")["status"], "quota")
        os.environ.pop("WALF_TAVILY_KEY")


if __name__ == "__main__":
    unittest.main()
