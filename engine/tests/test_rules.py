"""판정 규칙 테스트 — 외부 의존 없음. 실행: python3 -m unittest discover -s engine/tests"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import rules  # noqa: E402

B = dict(brand="BADBLOOD", name="Mystic Nylon Track Jacket", brand_aliases=["배드블러드"], name_aliases=["미스틱 나일론 트랙 자켓"], code="W-JKT26-055")


class Color(unittest.TestCase):
    def test_navy_vs_other_colors(self):
        self.assertEqual(rules.color_match("네이비", "배드블러드 미스틱 트랙 자켓 네이비 M"), "match")
        self.assertEqual(rules.color_match("Navy", "BADBLOOD Mystic Track Jacket BLACK"), "mismatch")
        self.assertEqual(rules.color_match("네이비", "배드블러드 트랙자켓 M"), "unknown", "색 표기가 없으면 모름")
        self.assertEqual(rules.color_match("네이비", "dark blue 나일론"), "match", "dark blue 는 네이비로 본다")
        self.assertNotIn("blue", rules.colors_in("dark blue"), "dark blue 를 blue 로 두 번 세지 않는다")
        self.assertEqual(rules.color_match("", "블랙"), "any")


class Size(unittest.TestCase):
    def test_size_needs_marker_for_single_letter(self):
        self.assertEqual(rules.size_match("M", "배드블러드 트랙자켓 M사이즈 네이비"), "match")
        self.assertEqual(rules.size_match("M", "배드블러드 트랙자켓 (L) 네이비"), "mismatch")
        self.assertEqual(rules.size_match("M", "MYSTIC JACKET"), "unknown", "단어 속 M 은 사이즈가 아니다")
        self.assertEqual(rules.size_match("M", "트랙 자켓 95 사이즈"), "match", "95 는 M")
        self.assertEqual(rules.size_match("M", "Mystic Nylon Track Jacket M"), "unknown", "표시 없는 한 글자 M 은 믿지 않는다")


class Listing(unittest.TestCase):
    def test_wanted_post_is_not_a_listing(self):
        self.assertTrue(rules.is_wanted_post("배드블러드 미스틱 트랙자켓 M 구해요"))
        self.assertTrue(rules.is_wanted_post("[삽니다] badblood 트랙 자켓"))
        self.assertFalse(rules.is_wanted_post("배드블러드 미스틱 트랙자켓 M 팝니다"))

    def test_stock(self):
        self.assertEqual(rules.stock_from("https://schema.org/InStock", "자켓", "본문"), "listed")
        self.assertEqual(rules.stock_from("https://schema.org/OutOfStock", "자켓", ""), "sold_out")
        self.assertEqual(rules.stock_from("", "[판매완료] 배드블러드 자켓", ""), "sold_out")
        self.assertEqual(rules.stock_from("", "배드블러드 자켓 (예약중)", ""), "reserved")
        self.assertEqual(rules.stock_from("", "배드블러드 자켓", "가격 120,000원"), "unknown", "판매 중 근거가 없으면 모름 — 구매 가능으로 보지 않는다")
        self.assertEqual(rules.stock_from("https://schema.org/InStock", "자켓", "SOLD OUT 재입고 알림"), "sold_out", "화면에 품절이 보이면 품절")

    def test_page_flags(self):
        self.assertTrue(rules.page_flags("삭제된 상품입니다")["deleted"])
        self.assertTrue(rules.page_flags("로그인이 필요합니다")["login"])


class Judge(unittest.TestCase):
    def test_same_likely_needs_brand_and_model_or_code(self):
        self.assertEqual(rules.judge(**B, text="배드블러드 미스틱 나일론 트랙 자켓 네이비")["match"], "same_likely")
        self.assertEqual(rules.judge(**B, text="BADBLOOD W-JKT26-055 jacket")["match"], "same_likely")
        self.assertEqual(rules.judge(**B, text="BADBLOOD wjkt26055")["code_hit"], True, "품번은 하이픈 없이도 맞춘다")

    def test_same_line_other_garment_is_not_same(self):
        self.assertEqual(rules.judge(**B, text="BADBLOOD Mystic Nylon Track Pants - Navy")["match"], "similar", "같은 미스틱 라인이어도 팬츠는 아니다")
        self.assertEqual(rules.judge(**B, text="BADBLOOD Mystic Big Patch Ball Cap")["match"], "similar")
        self.assertEqual(rules.judge(**B, text="BADBLOOD Mystic Fleece Jacket")["match"], "similar", "소재·라인 단어(나일론·트랙)가 하나도 없으면 비슷한 상품")
        self.assertEqual(rules.judge(**B, text="배드블러드(BADBLOOD) 미스틱 나일론 트랙 자켓 - 네이비")["match"], "same_likely")

    def test_generic_words_do_not_make_same(self):
        self.assertEqual(rules.judge(**B, text="배드블러드 나일론 트랙 자켓 블랙")["match"], "similar", "브랜드 + 흔한 단어(나일론·트랙·자켓)만이면 비슷한 상품")
        self.assertEqual(rules.judge(**B, text="미스틱 트랙 자켓 (다른 브랜드)")["match"], "unknown")
        self.assertEqual(rules.judge(**B, text="빌리 SS 트랙 자켓 네이비")["match"], "unknown")


class Url(unittest.TestCase):
    def test_product_urls(self):
        self.assertTrue(rules.is_product_url("https://www.musinsa.com/products/4143845", "musinsa.com"))
        self.assertFalse(rules.is_product_url("https://www.musinsa.com/main/musinsa/recommend", "musinsa.com"))
        self.assertTrue(rules.is_product_url("https://m.bunjang.co.kr/products/367611151", "bunjang.co.kr"))
        self.assertFalse(rules.is_product_url("https://m.bunjang.co.kr/search/products?q=x", "bunjang.co.kr"))
        self.assertTrue(rules.is_product_url("https://fruitsfamily.com/product/6bj75/slug-text", "fruitsfamily.com"))

    def test_url_key_ignores_slug_and_tracking(self):
        a = rules.url_key("https://fruitsfamily.com/product/6bj75/%EB%B0%B0%EB%93%9C")
        b = rules.url_key("https://www.fruitsfamily.com/product/6bj75?utm_source=x")
        self.assertEqual(a, b)
        self.assertEqual(rules.url_key("https://m.bunjang.co.kr/products/1"), rules.url_key("https://bunjang.co.kr/products/1/"))
        self.assertEqual(rules.seller_domain("https://web.joongna.com/product/1", ["joongna.com"]), "joongna.com")
        self.assertIsNone(rules.seller_domain("https://joongna.com.evil.example/x", ["joongna.com"]))
        self.assertIsNone(rules.seller_domain("https://global.musinsa.com/us/products/6481755", ["musinsa.com"]), "해외 판매 사이트는 제외")


if __name__ == "__main__":
    unittest.main()
