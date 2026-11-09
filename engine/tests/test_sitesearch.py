"""판매처 자체 검색 결과 해석·옵션 재고 — 2026-11-09 실제 페이지 모양을 줄인 가짜 HTML로(네트워크 없음)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
# test_pipeline 이 가짜 pages 모듈을 끼워 두므로, 여기서는 진짜 모듈을 다시 읽는다
if getattr(sys.modules.get("pages"), "__file__", None) is None:
    sys.modules.pop("pages", None)
    sys.modules.pop("sitesearch", None)
try:
    import pages
    import sitesearch
    HAVE = True
except ImportError:  # crawl4ai 가 없는 곳(CI 판정 규칙 작업)에서는 건너뛴다
    HAVE = False
import rules  # noqa: E402

CAFE24_SEARCH = '''<ul class="prdList">
<li><a href="/product/w-jkt26-055-%EB%AF%B8%EC%8A%A4%ED%8B%B1-%EB%82%98%EC%9D%BC%EB%A1%A0-%ED%8A%B8%EB%9E%99-%EC%9E%90%EC%BC%93-%EB%84%A4%EC%9D%B4%EB%B9%84/14555/category/1771/display/1/"><img></a>
<a href="/product/w-jkt26-055-%EB%AF%B8%EC%8A%A4%ED%8B%B1-%EB%82%98%EC%9D%BC%EB%A1%A0-%ED%8A%B8%EB%9E%99-%EC%9E%90%EC%BC%93-%EB%84%A4%EC%9D%B4%EB%B9%84/14555/category/1771/display/1/">미스틱</a></li>
<li><a href="/product/w-jkt26-054-%EB%B8%94%EB%A3%A8%EA%B7%B8%EB%A0%88%EC%9D%B4/14554/category/1771/display/1/">x</a></li>
<li><a href="/product/list.html?cate_no=1784">JACKET</a></li></ul>'''
CAFE24_PAGE = r"""<script>var option_stock_data = '{\"P0000VNV000A\":{\"stock_number\":0,\"use_stock\":true,\"is_selling\":\"T\",\"is_display\":\"T\",\"option_value_orginal\":[\"\\ub124\\uc774\\ube44\",\"S\"]},\"P0000VNV000B\":{\"stock_number\":0,\"use_stock\":true,\"is_selling\":\"T\",\"is_display\":\"T\",\"option_value_orginal\":[\"\\ub124\\uc774\\ube44\",\"M\"]},\"P0000VNV000C\":{\"stock_number\":3,\"use_stock\":true,\"is_selling\":\"T\",\"is_display\":\"T\",\"option_value_orginal\":[\"\\ub124\\uc774\\ube44\",\"L\"]}}';</script>"""
JOONGNA = '''<a href="/product/230738770"><div>Bad blood 배드블러드 블랙 바람막이 나일론 트랙 집업 자켓 블랙</div><div>90,000 원</div><span>3시간 전</span></a>
<a href="/product/230738770"><img></a>
<a href="/product/221149542">배드블러드 미스틱 나일론 리플렉티브 후드 집업 챠콜도트 95,000 원 무료배송</a>
<a href="/search?category=8">카테고리</a>'''


@unittest.skipUnless(HAVE, "crawl4ai 없음")
class Parse(unittest.TestCase):
    def test_official_search_links_keep_product_path_once(self):
        links = sitesearch.official_links(CAFE24_SEARCH, "badblood.co.kr")
        self.assertEqual([x["url"] for x in links], [
            "https://badblood.co.kr/product/w-jkt26-055-%EB%AF%B8%EC%8A%A4%ED%8B%B1-%EB%82%98%EC%9D%BC%EB%A1%A0-%ED%8A%B8%EB%9E%99-%EC%9E%90%EC%BC%93-%EB%84%A4%EC%9D%B4%EB%B9%84/14555/",
            "https://badblood.co.kr/product/w-jkt26-054-%EB%B8%94%EB%A3%A8%EA%B7%B8%EB%A0%88%EC%9D%B4/14554/"])
        self.assertEqual(links[0]["title"], "w jkt26 055 미스틱 나일론 트랙 자켓 네이비", "제목은 주소 속 상품명")

    def test_joongna_listing_title_price(self):
        ls = sitesearch.joongna_listings(JOONGNA)
        self.assertEqual(len(ls), 2, "같은 매물 링크는 하나로, 카테고리 링크는 뺀다")
        self.assertEqual(ls[0]["price"], 90000)
        self.assertTrue(ls[0]["title"].endswith("블랙"))
        self.assertEqual(sitesearch.total_of("**'배드블러드'** 검색결과 총 83개"), 83)

    def test_cafe24_option_stock(self):
        opts = pages.option_stock(CAFE24_PAGE)
        self.assertEqual([(o["option"], o["stock"]) for o in opts], [("네이비-S", 0), ("네이비-M", 0), ("네이비-L", 3)])
        self.assertEqual(rules.option_for(opts, "네이비", "M")["stock"], "sold_out", "M 재고 0 → 품절")
        self.assertEqual(rules.option_for(opts, "네이비", "L")["stock"], "listed")
        self.assertEqual(rules.option_for(opts, "블랙", "M")["stock"], "none", "원하는 색 옵션이 없음")

    def test_official_domains_from_note(self):
        self.assertIn("badblood.co.kr", sitesearch.official_domains("BADBLOOD", "품번 W-JKT26-055 · 공식몰: www.badblood.co.kr"))

    def test_tos_blocked_sites_are_not_opened(self):
        self.assertIsNotNone(pages.tos_block("https://m.bunjang.co.kr/search/products?q=x"))
        self.assertIsNone(pages.tos_block("https://web.joongna.com/search/x"))


class OptionRule(unittest.TestCase):
    def test_compound_color_is_not_navy(self):
        opts = [{"option": "블루그레이-M", "values": ["블루그레이", "M"], "stock": 5, "selling": True}]
        self.assertEqual(rules.option_for(opts, "네이비", "M")["stock"], "none", "블루그레이는 네이비가 아니다")
        self.assertEqual(rules.option_for(opts, "블루그레이", "95")["stock"], "listed", "95 = M")

    def test_unmanaged_stock_is_unknown_not_buyable(self):
        opts = [{"option": "네이비-M", "values": ["네이비", "M"], "stock": None, "selling": True}]
        self.assertEqual(rules.option_for(opts, "네이비", "M")["stock"], "unknown", "재고 관리를 안 하는 옵션은 구매 가능으로 보지 않는다")


if __name__ == "__main__":
    unittest.main()
