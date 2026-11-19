<!-- Discovery Upgrade Gate 0 · 2026-11-19~20 조사. 제품 코드의 판매처 판단표(server/src/sources.ts SOURCES, server/src/searchsources.ts SEARCH_SOURCES)와 함께 읽는다. -->

> **제품 코드와 대조한 결과** (메인 세션, 2026-11-20)
> - **네이버 쇼핑 검색 API 종료:** 개발자센터 공지 원문(developers.naver.com/notice/article/32564)을 직접 열어 "서비스 종료 적용 일시 2026년 7월 31일"을 확인했다. 코드의 `naver_shopping`을 `PENDING_EXTERNAL_SETUP`에서 `UNSUPPORTED`로 바꾸고 화면 문구를 "서비스가 종료돼 찾을 수 없어요"로 고쳤다. 체크리스트 5-1도 종료 안내로 바꿨다.
> - **29CM:** 코드에는 `PENDING_INTEGRATION`("약관 확인 전")으로 남아 있다. 이 조사에서는 무신사 통합 약관(§11②9 자동 수집·모니터링 금지)이 29CM에도 적용된다고 확인했다. Gate 3 Source Registry 정리 때 `UNSUPPORTED`로 맞춘다.
> - **후루츠패밀리:** 코드는 `PENDING_INTEGRATION`이고, 이 조사의 판정은 "사용자가 준 링크만 확인 가능"이다. Gate 3에서 판정 체계를 이 문서의 5단계로 넓힐 때 맞춘다.
> - **조사 중 규칙 이탈 1건:** 정책 링크를 찾으려고 www.musinsa.com 홈페이지를 1회 요청했는데, robots.txt가 막는 경로였다(§5 조사 메모). 그 뒤로는 robots.txt가 허용하는 방식으로만 읽었다. 제품 코드는 무신사를 열지 않는다.

# WALF Source Access Matrix (Gate 0)

- 목적: 찾아줘(같은 상품 매물 탐색)와 기다려줘(가격·재고·새 매물 감시)에 쓸 판매처·검색 경로를 WALF가 적법하게 이용할 수 있는지 판정한다. 연동 구현은 하지 않는다.
- 확인일: 2026-11-19(KST). 날짜가 바뀐 뒤 다시 확인한 항목은 (2026-11-20)으로 따로 적었다.
- 조사 방법: 공개 정책 페이지, 개발자 문서, robots.txt만 읽었다. 가입·로그인·키 발급·약관 동의·폼 제출은 하지 않았다. 403·418·500·503 같은 차단 응답은 우회하지 않고 "미확인"으로 남겼다.
- 인용 원칙: 원문 인용은 출처 문서 하나에 1개만 넣었다. 15단어 이하로 줄였고, 나머지 조항은 조항 번호와 요약으로 적었다. 따라서 조항마다 인용이 붙어 있지는 않다.
- robots.txt 요청 UA는 `Mozilla/5.0 (compatible; WALF-policy-research/0.1)`이다. robots.txt는 크롤러 규칙일 뿐이다. robots.txt가 허용해도 약관상 허용된다는 뜻은 아니다.

## 0. 결론 먼저

1. **승인이나 협의 없이 지금 실서비스에 쓸 수 있는 공식 경로는 Shopify Global Catalog 1개뿐이다.** 이것도 찾아줘의 즉시 검색에만 해당한다. 주기 감시와 상품 DB 구축은 가이드라인과 API 약관이 막는다.
2. **기대했던 국내외 공식 검색 경로 셋이 지금은 막혀 있다.**
   - 네이버 쇼핑 검색 API는 2026-07-31에 종료됐다.
   - Google Custom Search JSON API는 신규 고객을 받지 않는다.
   - 라쿠텐은 2026-11-09부터 관리 화면이 점검 중이라 신규 앱을 만들 수 없다. 복구 시점은 미정이다.
3. **조사한 13개 판매처 중 공식 상품 검색 API를 공개한 곳은 없다.** 판매처 사이트를 자동으로 주기 조회해 기다려줘를 구현해도 되는 곳도 없다.

## 판정 기준

| 판정 | 뜻 |
|---|---|
| 공식 연동 가능 | 공식 API나 문서가 제3자 앱의 사용을 허용한다. 사전 승인이나 별도 협의 없이 가입만으로 쓸 수 있다. |
| 제휴·허가 필요 | 공식 경로는 있지만 승인, 상업 이용 협의, 제휴 계약이 먼저 필요하다. 약관이 사전 동의 없는 자동 접근이나 영리 이용을 금지하는 경우도 여기에 넣었다. |
| 사용자가 준 링크만 확인 가능 | 자동 수집을 명시적으로 금지하지는 않지만 API가 없고 포괄 금지 조항이 있다. 사용자가 요청한 1건을 그때 1회 확인하는 수준까지만 권장한다. 주기 감시에는 허가가 필요하다. |
| 자동 접근 불가 | 약관이 자동 수집을 명시적으로 금지하는 경우다. 공식 API가 종료됐거나 신규 가입이 불가한 경우, 원 출처의 허가 없이 스크래핑하는 경로도 여기에 넣었다. |
| 미확인 | 약관 원문을 읽지 못해 판단할 수 없다. |

---

## 1. 요약표

### 1-1. 판정 집계

| 판정 | 판매처 (13곳) | 검색 경로 (10개) | 합계 |
|---|---|---|---|
| 공식 연동 가능 | 0 | 1 (Shopify Global Catalog) | 1 |
| 제휴·허가 필요 | 5 (무신사, 구구스, Mercari, ZOZOUSED, ARCHIVE STORE) | 4 (Yahoo!ショッピング, eBay, Amazon Creators API, Depop) | 9 |
| 사용자가 준 링크만 확인 가능 | 3 (후루츠패밀리, トレファク, KINDAL) | 0 | 3 |
| 자동 접근 불가 | 1 (번개장터) | 3 (네이버 쇼핑 API, Google CSE, SerpApi) | 4 |
| 미확인 | 4 (KREAM, Mercari Shops, 2nd STREET, RAGTAG) | 2 (라쿠텐 API, 쿠팡 파트너스) | 6 |

### 1-2. 한국 판매처

| 판매처 | ① 공식 검색 API | ② 제휴·상품 피드 | ③ 사용 목적·상업 조건 | ④ 약관 (크롤링·자동 접근·이미지) | ⑤ robots.txt (검색·상세 경로) | ⑥ 요청 제한·비용 | ⑦ 가격·재고 갱신 | ⑧ 한국 배송 | ⑨ 판정 |
|---|---|---|---|---|---|---|---|---|---|
| 무신사 | 없음 (입점사용 API만) | 무신사 큐레이터 (인플루언서). 앱 참여는 미확인 | 미확인 | 사전 동의 없는 크롤러·스크립트 추출·모니터링 금지 (§11②9). 영리 목적 복제 금지 (§44②) | `*` 전체 Disallow. 허용 명단 봇만 접근 가능해 WALF 봇은 검색·상세 모두 차단 | 해당 없음 | 미확인 (llms.txt는 라이브 페이지를 기준으로 봄) | 가능 (국내몰) | **제휴·허가 필요** |
| 번개장터 | 공개 문서 없음 | 공개 프로그램은 미확인. 해외 채널 API와 메르카리 구매대행 제휴 선례는 있음 | 미확인 | 자동화 도구로 수집·저장·분석·색인화 금지 (§39⑦1). AI 학습 금지 (§39⑦2). 영리 복제 금지 (§39③) | `*`는 /login, /apps, /talk2만 차단하고 상세·검색은 허용. AI 봇은 전면 차단. api 서브도메인은 `*` 전면 차단 | 해당 없음 | 미확인 | 가능 (국내 C2C) | **자동 접근 불가** |
| KREAM | 미확인 | 미확인 ('제휴 사업자'는 판매 측 계약) | 미확인 | 원문 접근 불가 (HTTP 500). 검색 스니펫에는 자동화 수단 이용 시 제재 조항이 보임 | HTTP 500으로 미확인 | 미확인 | 미확인 | 가능 (국내) | **미확인** |
| 후루츠패밀리 | 없음 | 미확인 | 해당 없음 | 크롤링을 명시한 조항은 없음. 회사가 안내하지 않은 방법의 사용 금지 (§26). 영리 복제는 사전 승낙 필요 (§22④) | `*`는 상품 상세를 허용 (/product/*/edit 등만 차단). AI 학습 봇은 llms.txt 등 일부만 허용 | 해당 없음 | 미확인 | 가능 (국내 안전결제) | **사용자가 준 링크만 확인 가능** |
| 구구스 | 없음 | 제휴문의 창구 공개. 위탁품은 제휴몰에 노출될 수 있음 | 미확인 | 비정상적인 시스템 접근 금지 (§27③). 정보의 영리 이용은 사전 승낙 필요 (§22②) | `*` Allow / (Baiduspider만 차단) | 해당 없음 | 위탁품이 3개월 미판매되면 최대 20% 자동 인하 (§25③). 재고 갱신 방식은 미확인 | 가능 (국내 택배, 매장 수령) | **제휴·허가 필요** |

### 1-3. 일본 판매처

| 판매처 | ① 공식 검색 API | ② 제휴·상품 피드 | ③ 사용 목적·상업 조건 | ④ 약관 (크롤링·자동 접근·이미지) | ⑤ robots.txt (검색·상세 경로) | ⑥ 요청 제한·비용 | ⑦ 가격·재고 갱신 | ⑧ 한국 배송 | ⑨ 판정 |
|---|---|---|---|---|---|---|---|---|---|
| Mercari | 공개 문서 없음 | メルカリアンバサダー (일본 거주 회원 대상, 2% 포인트) | 앰배서더는 경쟁 서비스 제공 금지, 지정 이미지 외 사용 금지 | 회사 제공 인터페이스 외 방법으로 접근 금지. 서면 허가 없이 서비스 밖에서 상업 이용 금지 | `*`는 /search, /item 차단 없음. /v1/, /v2/, /purchase/ 등은 차단 | 앰배서더 지급 상한 있음 | 미확인 | 직접 배송 불가, 대행 필요 (Buyee 공식 제휴, 번개장터 제휴) | **제휴·허가 필요** |
| Mercari Shops | 없음 (판매자용 연동만) | 앰배서더가 적용됨 | Mercari와 같음 | 약관 페이지 403으로 미확인 | /follows, /orders, /purchase, /seller, /signup 차단. jp.mercari.com/shops로 리다이렉트 | 해당 없음 | 미확인 | 직접 배송 불가. 제휴 업체 경유로 해외 판매 | **미확인** |
| ZOZOUSED | zozo.jp는 미확인. ZOZOTOWN Yahoo!店을 Yahoo API로 조회할 수 있음 | 미확인 | Yahoo API 조건을 따름 (기본 비상업) | zozo.jp 약관 접근 불가 (타임아웃) | zozo.jp/robots.txt가 403 Access Denied | Yahoo API 30회/분 | Yahoo API의 price, inStock | Yahoo!店은 일본 국내 발송만, 대행 필요 | **제휴·허가 필요** (Yahoo 경유). 직접 접근은 불가 |
| 2nd STREET | 미확인 | 미확인 | 미확인 | 전 페이지 403으로 미확인 | robots.txt 403 | 미확인 | 미확인 | 미확인 (같은 회사의 楽天 1st STREET은 해외 발송 안 함) | **미확인** |
| RAGTAG | 자사 API는 미확인. 楽天 점포 `ragtag`이 있음 | 미확인 | 楽天 API 약관 미확인 | 자사 약관 403·503으로 미확인 | `*` Allow /. /api/, /app/, /order/, /member/ 차단 (상세·검색은 허용) | 미확인 | 미확인 | 楽天점은 해외 발송 안 함, 대행 필요 | **미확인** |
| トレファク (TREFAC FASHION) | 없음 | 미확인 | 해당 없음 | 크롤링 명시 조항 없음. 과도한 부하, 해석 행위, 포괄 금지 조항 (4조⑧⑨⑯). 지식재산권은 회사 귀속 (6조) | `*`는 /mypage/login.php만 차단. bingbot Crawl-Delay 30 | 해당 없음 | 실매장·타 사이트와 동시 판매, 재고는 수시 갱신 | 해외 배송 안 함. 타사 전송 서비스는 조건부 허용, 대행 필요 | **사용자가 준 링크만 확인 가능** |
| ARCHIVE STORE | 없음 (Shopify몰) | 미확인 | 해당 없음 | 사적 사용 범위를 넘는 이용 금지 (3조). 영업·영리 목적 이용 금지 (4조) | archivestore.jp는 /wp/wp-admin/만 차단. Shopify몰은 /products/ 허용, 정렬·필터 컬렉션 차단 | 해당 없음 | 미확인 | 미확인 | **제휴·허가 필요** |
| KINDAL (カインドオル) | 없음. 楽天 `kind-u`, Yahoo `kindal` 점포가 있음 | 미확인 | 楽天·Yahoo API 조건을 따름 | 크롤링 명시 조항 없음. 과도한 부하, 부정 접근, 포괄 금지 조항 (4조⑧⑩⑯) | kind.co.jp는 /wp-admin/만 차단. shop.kind.co.jp는 /products/ 허용 (variant 등 파라미터 차단) | Yahoo API 30회/분 | 매장과 재고 공유, 매장별 개별 출고 | 楽天점은 해외 발송 안 함, 대행 필요. 자사몰은 미확인 | **사용자가 준 링크만 확인 가능** (楽天·Yahoo 경유는 해당 API 조건) |

### 1-4. 공식 검색 경로

| 경로 | ① 공식 검색 API | ② 제휴·상품 피드 | ③ 사용 목적·상업 조건 | ④ 크롤링·캐싱·이미지 | ⑤ robots.txt (해당 사이트) | ⑥ 요청 제한·비용 | ⑦ 가격·재고 갱신 | ⑧ 한국 배송 정보 | ⑨ 판정 |
|---|---|---|---|---|---|---|---|---|---|
| 네이버 쇼핑 검색 API | **2026-07-31 종료** | 쇼핑커넥트 API는 미확인 | (남은 검색 API 약관) 사용자에게서 대가 수취 금지 | 캐시를 포함한 무단 저장 금지. 검색 결과는 독립적으로 노출 | shopping.naver.com은 `*` 전체 Disallow. search.shopping.naver.com은 418 | 종료 전 25,000회/일 | 종료 전 lprice·hprice 제공, 재고 필드 없음 | 국내 (cbshop 제외 옵션이 있었음) | **자동 접근 불가** (공식 API 종료) |
| 라쿠텐 이치바 상품 검색 API | 있음 (20260701 버전) | 楽天アフィリエイト (affiliateId) | 약관이 503이라 미확인 | 크레딧 표시 필요 (색인 기준). 캐싱 조건은 미확인 | www.rakuten.co.jp는 /shops/ 등 차단. item.rakuten.co.jp는 ?i=, ?s= 파라미터만 차단. search.rakuten.co.jp는 403 | 미확인 | itemPrice. 재고 필드는 미확인 | shipOverseasFlag (색인 기준) | **미확인** (2026-11-09부터 신규 앱 생성 불가) |
| Yahoo!ショッピング itemSearch v3 | 있음 | ValueCommerce | 기본은 비상업. 상업 이용은 API 창구와 협의 | 크레딧 표시 필수. 캐싱·이미지 조건은 미확인 | /search 필터 파라미터, /searchbff 등 차단. 점포 /h_api/, review 차단 | 앱 ID당 30회/분. 비용 미확인 | price, inStock, condition(used), janCode | 해외 배송 필드 없음 (일본 지역만), 대행 필요 | **제휴·허가 필요** |
| eBay Browse API | 있음 | eBay Partner Network (EPN) | 실서비스는 EPN 신청과 승인 필요. 경쟁 서비스, 가격 모델링, AI 학습 금지 | eBay 외 콘텐츠와 섞어 표시 금지. 매물 정보는 6시간 이내 | 명시 허가 없는 자동 접근 금지. `*`는 /sch/ 차단, AI 봇은 전면 차단 | 메서드별 5,000회/일. 비용 미확인 | estimatedAvailabilityStatus, itemEndDate | deliveryCountry:KR 필터, shipToLocations | **제휴·허가 필요** |
| Google Custom Search JSON API | **신규 고객 종료** | 없음 | 기존 고객은 2027-01-01까지 전환 | 해당 없음 | 해당 없음 | 100회/일 무료, 1,000회당 5달러, 일 1만 회 (기존 고객만) | 해당 없음 | 해당 없음 | **자동 접근 불가** (신규 불가) |
| SerpApi | 있음 (검색 페이지 스크래핑 대행) | 없음 | Legal Shield는 상위 플랜만 해당. 수집 책임만 지고, 미국 법원 한정 | 원 사이트 약관이 그대로 적용됨 | 해당 없음 | 무료 250회/월부터 Big Data 30,000회/월까지 | 원 페이지 스냅샷 | 원 사이트에 따름 | **자동 접근 불가** (원 출처 허가가 아님) |
| Shopify Global Catalog | 있음 (MCP: search_catalog, lookup_catalog, get_product) | 승인 개발자만 프로모션 수수료 | 쇼핑 경험 제공에만 사용. 상시 상품 DB, 체계적 수집, 재배포, AI 학습 금지 | 가격·재고는 10분, 메타데이터·이미지는 24시간까지 캐시. 귀속 파라미터 유지 | 해당 없음 (개별 Shopify몰은 /products/ 허용) | 수치 비공개. 키 없는 접근은 한도 상향 불가. 비용 미기재 | variant price, availability.available. 재조회 권장 | filters.ships_to.country, condition=secondhand | **공식 연동 가능** (찾아줘 즉시 검색 한정, 조건부) |
| Amazon Creators API | 있음 (PA-API 5 폐지) | Amazon Associates | 데이터 마이닝·로봇 수집은 라이선스에서 제외. 비교 형식 표시에 조건 있음 | 이미지 캐시 금지 (링크만 24시간). 기타 콘텐츠 24시간 | 해당 없음 | 처음 30일 최대 1TPS·일 8,640회, 이후 매출에 연동 (최대 10TPS). 30일간 적격 판매가 없으면 접근 상실 | 24시간 안에 재조회 | 미확인 | **제휴·허가 필요** |
| Depop Partner API | 비공개 | 없음 | 문의 필요 | 미확인 | 해당 없음 | 미확인 | 미확인 | 미확인 | **제휴·허가 필요** |
| 쿠팡 파트너스 Open API | 미확인 (포털이 JS 전용) | 쿠팡 파트너스 | 미확인 | 미확인 | 해당 없음 | 미확인 | 미확인 | 국내 | **미확인** |

참고로 콜렉티브(빈티지 거래 앱)도 조사했지만 매트릭스에서 뺐다. 2026-11-19 기준으로 App Store 페이지(id1528304160)는 404, collectiv.kr은 DNS 조회 실패, thecollective.co.kr은 다른 사업자였다. 운영 여부를 확인할 수 없었다.

---

## 2. 판매처별 근거 메모

### 2-1. 한국

#### 무신사 (MUSINSA)

**약관**
- 통합서비스 이용약관(2026-10-28 시행)은 무신사, 29CM, 솔드아웃, 무신사 유즈드에 공통으로 적용된다. 출처: https://member.one.musinsa.com/agreement/service (2026-11-19)
- §11②9는 사전 협의나 동의 없이 데이터를 추출하려고 자동 수단을 쓰는 것을 금지한다. 같은 항목에서 콘텐츠·정보를 복사·수집·**모니터링**하는 행위도 금지한다. 출처: 위와 같음 (2026-11-19)
  - 인용: "회사와 사전 협의 또는 동의 없이 데이터 등을 추출하기 위하여 에이전트(Agent), 로봇(Robot), 크롤러(Crawler), 스크립트(Script)"
- §44②는 회사에 지식재산권이 있는 정보를 사전 승낙 없이 영리 목적으로 복제·송신하는 것을 금지한다. 상품 이미지의 권리 귀속을 따로 정한 조항은 찾지 못했다. 출처: 위와 같음 (2026-11-19)

**robots.txt** (Last Updated 2026.10.20)
- 허용 명단 방식이다. Googlebot, Yeti, Bingbot, Claude-User 등 명단에 있는 봇만 `/`를 허용하고, 그 봇들에게도 /auth/, /mypage/, /order/ 등은 막는다.
- `User-agent: *`는 `Disallow: /`이다. 새 봇인 WALF는 검색(/search)과 상품 상세(/products/…)에 모두 접근할 수 없다.
- 출처: https://www.musinsa.com/robots.txt (2026-11-19)
- global.musinsa.com도 `*`는 `Disallow: /`이고, 명단 봇에게도 /api/는 막는다. 출처: https://global.musinsa.com/robots.txt (2026-11-19)

**API·제휴**
- 공개된 상품 검색 API는 찾지 못했다. 입점사(판매자) 전용 API 인증키 발급 안내가 있다는 검색 스니펫만 있다. 원문은 403이라 읽지 못했다. 출처: https://support.cafe24.com/hc/ko/articles/7556127726105 (2026-11-19)
- llms.txt는 가격, 쿠폰, 재고, 배송일을 라이브 페이지에서 확인하라고 안내한다. 참조용 안내일 뿐 이용 허가가 아니다. 출처: https://www.musinsa.com/llms.txt (2026-11-19)
- '무신사 큐레이터'는 사전 승인된 인플루언서가 판매 수수료를 받는 프로그램이다. 앱이나 서비스가 참여할 수 있는지는 미확인이다. 출처: https://www.heraldk.com/article/2025122818155761662 (2026-11-19)
- 글로벌몰이 제휴 네트워크에 등록돼 있다는 제3자 집계는 있다. 무신사 공식 확인은 아니다. 출처: https://www.flexoffers.com/affiliate-programs/musinsa-affiliate-program/ (2026-11-19)

**판정: 제휴·허가 필요**
- 약관이 사전 동의 없는 크롤링과 모니터링을 직접 금지하고, robots.txt도 미등록 봇을 전면 차단한다.
- 사용자가 준 링크라도 WALF 서버가 가져오는 것은 이 조항에 걸린다. 허가를 받기 전에는 링크로 이동시키는 것까지만 할 수 있다.

#### 번개장터 (Bunjang)

**약관**
- 서비스 이용약관(2026-08-05 시행) 출처: https://terms.bunjang.co.kr/terms/service.html (2026-11-19)
- §39⑦1: 자동화된 도구로 데이터를 수집, 복제, 저장, 분석, 색인화하거나 파생저작물을 만드는 것을 금지한다.
  - 인용: "자동화된 도구(로봇, 스파이더, 스크립트, 스크래퍼, 크롤러 등) 내지 이에 준하는 일체의 방식을 활용하여 데이터를 수집"
- §39⑦2: 기계학습, AI 모델 학습, 데이터 마이닝 목적의 이용을 금지한다.
- §39③: 게시물을 포함한 회사 지식재산을 사전 허락 없이 영리 목적으로 복제·송신하는 것을 금지한다. 이미지도 게시물에 포함된다.
- 운영정책(2026-08-05 시행) 4항은 자동 접속 프로그램 등 비정상적인 방법으로 서비스를 쓰는 것을 금지한다. 출처: https://terms.bunjang.co.kr/terms/service-policy.html (2026-11-19)

**robots.txt**
- m.bunjang.co.kr(www.bunjang.co.kr도 이곳으로 리다이렉트)은 `*`에 대해 /login, /apps, /talk2만 막고 `Allow: /`이다. 상품 상세와 검색은 허용된다.
- GPTBot, ClaudeBot, CCBot, img2dataset 등 학습용 봇은 `Disallow: /`이다.
- 출처: https://m.bunjang.co.kr/robots.txt (2026-11-19)
- api.bunjang.co.kr은 Googlebot, Yeti, Daum만 허용하고 `*`는 `Disallow: /`이다. 출처: https://api.bunjang.co.kr/robots.txt (2026-11-19)
- 웹 HTML에 `noimageindex, noarchive` 메타 태그가 있다. 이미지 색인과 보관을 거부한다는 뜻이다. 출처: https://m.bunjang.co.kr/ (2026-11-19)

**API·제휴 선례**
- 공개 개발자 문서는 찾지 못했다.
- API로 해외 판매 채널 13곳에 상품을 연동한다는 보도가 있다. 계약 기반이며 외부에서 신청할 수 있는지는 미확인이다. 출처: https://www.koreatimes.co.kr/business/companies/20250716/bunjang-accelerates-global-expansion-with-borderless-strategy (2026-11-19)
- 메르카리 상품 구매대행 약관(BeeCruise 제휴)이 있다. 출처: https://terms.bunjang.co.kr/terms/mercari.html (2026-11-19)

**판정: 자동 접근 불가**
- robots.txt는 상세 페이지를 허용하지만 약관 §39⑦이 수집·색인화·분석을 명시적으로 금지한다. 이 경우 약관이 우선한다.
- 유일한 길은 제휴 협상이다.

#### KREAM

**접근 상태**
- kream.co.kr과 www.kream.co.kr의 robots.txt, /agreement가 모두 HTTP 500을 돌려줬다(curl·WebFetch). 출처: https://kream.co.kr/robots.txt, https://www.kream.co.kr/agreement (2026-11-19)

**약관 (검색 스니펫 기반, 원문 미검증, 조항 번호 미확인)**
- 자동화된 수단으로 서비스 기능을 비정상적으로 이용해 올린 게시물은 제한될 수 있다는 내용이다.
  - 인용: "자동화된 수단을 활용하는 등 "서비스"의 기능을 비정상적으로 이용하여"
  - 출처: https://www.kream.co.kr/agreement (검색 스니펫, 2026-11-19)
- 판매자센터 약관에는 API 언급이 없다. 출처: https://partner.kream.co.kr/agreement (2026-11-19)

**판정: 미확인**
- 약관 원문을 확인할 때까지는 자동 접근 불가로 취급할 것을 권한다.

#### 후루츠패밀리 (Fruits Family)

**선정 이유**
- 빈티지·세컨핸드·디자이너 아카이브를 거래하는 국내 대표 패션 리세일 플랫폼이다. 개인 판매자와 프로 빈티지샵이 함께 입점해 있다.
- llms.txt에 Comme des Garçons, Yohji Yamamoto, Margiela 등이 명시돼 있다. 출처: https://fruitsfamily.com/llms.txt (2026-11-19)

**약관**
- 서비스 이용약관(적용 2019-06-01, 페이지 갱신 2025-01-13) 출처: https://intercom.help/fruits-family-co/articles/3683933 (2026-11-19)
- 크롤링을 명시적으로 금지하는 조항은 없다.
- §26은 회사가 안내하는 방법이 아닌 방법으로 앱을 쓰는 것을 금지한다.
  - 인용: "'회사'가 안내하는 방법이 아닌 방법으로 앱을 사용하는 행위"
- §22④는 회사에 지식재산권이 있는 정보를 사전 승낙 없이 영리 목적으로 쓰는 것을 금지한다.
- 업계 선례로 후루츠의 '상품 가져오기' 약관(2026-09-09 시행)이 있다. 출처: https://intercom.help/fruits-family-co/ko/articles/16780883 (2026-11-19)
  - 회원이 지정한 타 플랫폼 샵의 공개 정보를, 회원의 명시적 요청이 있을 때 1회만 복사한다.
  - 제휴나 공식 연동이 아니며, 지속 동기화도 하지 않는다고 스스로 밝힌다.
  - WALF의 '사용자 링크 1회 확인' 설계에 참고할 만하다.

**robots.txt**
- `*`는 /my, /checkout/, /upload, /product/*/edit, /login 등만 막는다. 상품 상세는 허용된다.
- GPTBot, ClaudeBot, CCBot, img2dataset 등은 llms.txt와 일부 소개 페이지만 허용하고 나머지는 `Disallow: /`이다.
- 출처: https://fruitsfamily.com/robots.txt (2026-11-19)

**판정: 사용자가 준 링크만 확인 가능**
- 공개 API와 제휴 프로그램이 없다.
- 주기 감시(기다려줘)와 대량 검색(찾아줘)에는 허가가 필요하다.

#### 구구스 (GUGUS)

**선정 이유**
- 2002년 설립된 중고명품 전문 기업이다. 감정을 마친 상품을 직영매장과 온라인에서 판매·매입한다.
- 국내 디자이너·럭셔리 아카이브 매물을 대표하는 판매처다.
- 출처: https://www.gugus.co.kr/llms.txt (2026-11-19)

**약관**
- 이용약관(2025-07-23 시행) 출처: https://www.gugus.co.kr/footer/termsUse (2026-11-19)
- §27③은 비정상적인 방법으로 서비스를 이용하거나 시스템에 접근하는 것을 금지한다.
  - 인용: "비정상적인 방법으로 서비스를 이용하거나 시스템에 접근하는 행위는 금지됩니다"
- §22②는 몰을 이용해 얻은 정보를 사전 승낙 없이 영리 목적으로 쓰는 것을 금지한다.
- §25③에 따르면 위탁품이 3개월 이상 팔리지 않으면 판매가를 최대 20%까지 자동 인하한다. 가격 변동 감시에 의미가 있다.

**robots.txt**
- `*` Allow /이고, Baiduspider만 차단한다. 출처: https://www.gugus.co.kr/robots.txt (2026-11-19)

**제휴**
- 제휴문의 창구(영업, PR·마케팅, 파트너 입점)가 공개돼 있다. 폼은 제출하지 않았다. 출처: https://www.gugus.co.kr/aboutGugus/viewAffiliateInquiry (2026-11-19)
- 약관 §25에 위탁 상품이 제휴 온라인몰에 노출될 수 있다는 내용이 있다.

**판정: 제휴·허가 필요**
- robots.txt는 열려 있지만 약관이 정보의 영리 이용에 사전 승낙을 요구한다.
- 제휴 창구가 공개돼 있어 국내 제휴 후보 1순위다.

### 2-2. 일본

#### Mercari (jp.mercari.com)

**약관·가이드**
- 이용약관상 '유저'는 일본에 거주하는 개인과 회사가 지정한 법인이다. 해외 법인 WALF가 직접 이용자가 될 수 있는지가 불분명하다. 출처: https://static.jp.mercari.com/tos (2026-11-19)
- 금지 행위 가이드는 두 가지를 금지한다. 출처: https://help.jp.mercari.com/guide/articles/900/ (2026-11-19)
  - 회사가 제공하는 인터페이스가 아닌 방법으로 서비스에 접근하는 것. 인용: 「弊社が提供するインターフェイスとは別の手法を用いてサービスにアクセスすること」
  - 서면 허가 없이 서비스 밖에서 콘텐츠·정보를 상업 목적으로 쓰는 것.
- 다른 회원의 이미지를 무단으로 쓰는 것도 금지한다. 출처: https://help.jp.mercari.com/guide/articles/872/ (2026-11-19)

**robots.txt**
- `*`는 /mypage/, /purchase/, /sell/, /transaction/, /v1/, /v2/를 막는다. /search와 /item/은 막지 않는다.
- robots.txt가 허용해도 위 가이드 때문에 자동 접근은 할 수 없다.
- 출처: https://jp.mercari.com/robots.txt (2026-11-19)

**제휴**
- メルカリアンバサダー가 있다. 판매가의 2%를 포인트로 지급하고 상한이 있다. 출처: https://jp-news.mercari.com/info/35659 (2026-11-19)
- 가이드라인은 경쟁 서비스 제공과 지정 이미지 외 사용을 금지한다. 출처: https://help.jp.mercari.com/guide/articles/1486/ (2026-11-19)
- 상품 피드나 API는 없다.

**한국 배송**
- 직접 배송은 하지 않는다.
- 공식 경로는 프록시 서비스 Buyee 제휴다. 출처: https://about.mercari.com/en/press/news/articles/20191115_crossborder-2 (2026-11-19)
- 국내에서는 번개장터 '해외' 탭을 통한 제휴가 있다. 출처: https://byline.network/?p=9004111222537631 (2026-11-19)

**판정: 제휴·허가 필요**
- 공개 API가 없다. 자동 접근은 가이드가 금지하고, 상업 이용은 서면 허가가 필요하다.

#### Mercari Shops

**접근 상태**
- mercari-shops.com은 jp.mercari.com/shops로 리다이렉트된다.
- robots.txt는 /follows, /orders, /purchase, /seller, /signup만 막는다. 출처: https://mercari-shops.com/robots.txt (2026-11-19)
- メルカリShops 이용약관은 403이라 읽지 못했다. 출처: https://support.mercari-shops.com/hc/ja/articles/900005891046 (2026-11-19)

**해외 판매**
- 판매자가 제휴 업체에 국내 발송하면 그 업체가 해외로 보낸다. 출처: https://jp-news.mercari.com/mercari-shops/info/45776 (2026-11-19)

**판정: 미확인**
- Mercari 본체 약관이 적용된다면 제휴·허가 필요로 볼 수 있지만 확인하지 못했다.

#### ZOZOUSED (ZOZOTOWN)

**접근 상태**
- zozo.jp/robots.txt와 zozo.jp/zozoused/robots.txt는 403(Akamai Access Denied)을 돌려줬다. 출처: https://zozo.jp/robots.txt (2026-11-19)
- 이용약관(https://zozo.jp/info/kiyaku.html)은 타임아웃으로 읽지 못했다.

**Yahoo 경유 경로**
- 「ZOZOTOWN Yahoo!店」이 중고(ZOZOUSED) 상품을 판매한다.
  - 점포 첫 화면에 「古着から探す (1,551,397件)」이 있다. 출처: https://store.shopping.yahoo.co.jp/zozo/ (2026-11-19)
  - 이용 가이드에 중고(ZOZOUSED) 상품이 언급돼 있고, 해외 배송 없이 일본 국내 발송만 한다. 출처: https://store.shopping.yahoo.co.jp/zozo/guide.html (2026-11-19)
- Yahoo itemSearch 문서의 예시 응답에 `zozo_` 상품 코드가 나온다. 따라서 `seller_id=zozo`로 조회할 수 있다. 출처: https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html (2026-11-19)

**판정: 제휴·허가 필요**
- Yahoo API 상업 이용 협의가 전제다. zozo.jp 직접 자동 접근은 차단돼 있어 불가하다.

#### 2nd STREET (セカンドストリート)

**접근 상태**
- www.2ndstreet.jp의 robots.txt, /help/, /guide/, /terms가 모두 403이고, geonet.co.jp도 403이다. 출처: https://www.2ndstreet.jp/robots.txt (2026-11-19)

**관련 점포**
- 같은 회사(株式会社セカンドストリート)가 楽天 「1st STREET」을 운영한다. 해외로는 발송하지 않는다. 출처: https://www.rakuten.co.jp/1ststreet/info.html (2026-11-19)
- 1st STREET이 중고 재고를 다루는지는 미확인이다.

**판정: 미확인**
- 실질적으로는 자동 접근이 막혀 있다.

#### RAGTAG

**선정 이유**
- 일본의 대표적인 디자이너스 古着 판매처다.

**robots.txt**
- `*` Allow /이고, /api/, /app/, /order/, /member/, /item-assess/ 등을 막는다. 상품 상세와 검색은 막지 않는다.
- 출처: https://www.ragtag.jp/robots.txt (2026-11-19)
- 다른 조사 시점에는 같은 주소가 403을 돌려준 적도 있다.

**약관**
- /, /guide/, /help/, /kiyaku/, /terms/가 403·503이라 미확인이다.

**楽天 점포**
- 「RAGTAG（ブランド古着のラグタグ）」이고, 운영사는 株式会社ティンパンアレイ다. 해외로는 발송하지 않는다. 출처: https://www.rakuten.co.jp/ragtag/info.html (2026-11-19)
- 楽天 API의 `shopCode=ragtag` 조회 후보지만, 楽天 API 자체가 미확인이다.

**판정: 미확인**

#### トレファク (TREFAC FASHION, www.trefac.jp)

**선정 이유**
- 매장과 연동된 대형 古着 체인의 온라인몰이다.

**약관**
- トレファク 이용약관(2026-03-02 개정)이 trefac.jp 등에 적용된다. 출처: https://www.treasurefactory.co.jp/others/terms.html (2026-11-19)
- 크롤링을 명시적으로 금지하는 조항은 없다.
- 4条⑧은 서비스 네트워크나 시스템에 과도한 부담을 주는 행위를 금지한다.
  - 인용: 「本件サービスのネットワーク又はシステム等に過度な負担をかける行為」
- 4条⑨는 해석 행위, 4条⑯은 회사가 부적절하다고 판단하는 행위를 금지한다.
- 6条는 지식재산권이 회사나 라이선스 허락자에게 있다고 정한다.

**robots.txt**
- `*`는 /mypage/login.php만 막고, bingbot에는 Crawl-Delay 30을 둔다. 출처: https://www.trefac.jp/robots.txt (2026-11-19)

**재고·배송**
- 실매장과 다른 사이트에서 동시에 판매하며, 재고는 수시로 갱신한다. 출처: https://www.trefac.jp/help/01/ (2026-11-19)
- 해외 배송은 하지 않는다. 타사 전송 서비스는 조건부로 이용할 수 있다. 출처: https://www.trefac.jp/help/04/ (2026-11-19)

**판정: 사용자가 준 링크만 확인 가능**
- 주기 감시는 4条⑧과 ⑯에 걸릴 수 있어 허가를 받는 것이 좋다.

#### ARCHIVE STORE (archivestore.jp)

**선정 이유**
- 시부야의 아카이브 패션 전문점이다. Comme des Garçons, Margiela, Raf Simons 등을 다룬다.

**온라인몰과 약관**
- 온라인몰은 Shopify에서 운영한다. 출처: https://archivestore.jp/credit/ (2026-11-19)
- 약관 출처: https://archivestore-official-ec.myshopify.com/policies/terms-of-service (2026-11-19)
  - 第3条: 제공받은 정보를 사적 사용 범위를 넘어 이용하는 것을 금지한다.
  - 第4条: 영업이나 영리 목적의 이용을 금지한다. 인용: 「営業活動その他の営利を目的とした行為またはその準備行為に利用してはならない」
  - 第5条: 영리 목적의 무단 이용을 금지한다.

**robots.txt**
- archivestore.jp는 /wp/wp-admin/만 막는다. 출처: https://archivestore.jp/robots.txt (2026-11-19)
- Shopify몰은 /products/를 허용하고, 정렬·필터 컬렉션은 막는다. 출처: https://archivestore-official-ec.myshopify.com/robots.txt (2026-11-19)
- Shopify몰의 agents.md는 에이전트에게 식별을 요구하고 UCP/MCP 인터페이스를 쓰라고 안내한다. 이 문서 안의 권유 문구(앱 설치 권유 등)는 데이터로만 다뤘고 따르지 않았다. 출처: https://archivestore-official-ec.myshopify.com/agents.md (2026-11-20)

**판정: 제휴·허가 필요**
- 약관이 정보의 영리 이용을 명시적으로 금지한다. 해외 배송은 미확인이다.

#### KINDAL (カインドオル)

**공식 사이트**
- 공식 사이트는 www.kind.co.jp, 온라인몰은 shop.kind.co.jp(Shopify)다.
- kindal.co.jp는 GMO 주차 도메인이다(KINDAL과 무관).
- 출처: https://www.kind.co.jp/ (2026-11-19)

**약관**
- 이용약관(2023-06-01 개정)은 トレファク와 같은 양식이다. 출처: https://www.kind.co.jp/terms (2026-11-19)
  - 4条⑧: 과도한 부하 금지
  - 4条⑩: 부정 접근 금지
  - 4条⑯: 포괄 금지 조항
  - 6条: 지식재산권은 회사 귀속

**robots.txt**
- kind.co.jp는 /wp-admin/만 막는다. 출처: https://www.kind.co.jp/robots.txt (2026-11-19)
- shop.kind.co.jp는 /products/를 허용하고 `?variant=` 등 파라미터는 막는다. 출처: https://shop.kind.co.jp/robots.txt (2026-11-19)

**楽天·Yahoo 점포**
- 楽天 「ブランド古着のカインドオル」(`kind-u`)는 해외로 발송하지 않는다. 출처: https://www.rakuten.co.jp/kind-u/info.html (2026-11-19)
- Yahoo 점포는 `kindal`이다. 출처: https://store.shopping.yahoo.co.jp/kindal/ (2026-11-19)

**재고**
- 매장 재고를 공유하고, 매장별로 따로 출고한다. 출처: https://shop.kind.co.jp/policies/shipping-policy (2026-11-19)

**판정: 사용자가 준 링크만 확인 가능**
- Yahoo `seller_id=kindal` 경유는 Yahoo API 조건(상업 이용 협의)을 따른다.

### 2-3. 공식 검색 경로

#### 네이버 쇼핑 검색 API

**종료**
- 네이버 개발자센터 공지에 따르면 검색 > 쇼핑, 책, 전문자료 API가 2026-07-31(금)에 종료됐다. 출처: https://developers.naver.com/notice/article/32564 (2026-11-20 재확인)
- 검색 API가 옮겨 간 NAVER API HUB의 검색 목록에는 쇼핑이 없다. 출처: https://api.ncloud-docs.com/docs/naver-api-hub-overview.md (2026-11-19)
- 종료 전 문서에는 일 25,000회 한도와 lprice, hprice, mallName, productType 필드가 있었고, 재고 필드는 없었다. 출처: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md (2026-11-19)

**남은 검색 API 약관** (API HUB 약관, 2026-06-25 시행)
- 7.2③: 앱 사용자에게서 API 이용의 대가를 받으면 안 된다.
- 7.3③: 캐시를 포함한 무단 저장을 금지한다.
- 7.3④: 결과 화면에 광고를 함께 노출하면 안 된다.
- 검색 특약 2.1: 검색 결과는 독립적으로 노출해야 한다.
- 출처: NAVER API HUB 이용약관 PDF https://xv-ncloud.pstatic.net/images/provision/NAVER_API_%C3%AC%C2%84%C2%9C%C3%AB%C2%B9%C2%84%C3%AC%C2%8A%C2%A4_%C3%AC%C2%9D%C2%B4%C3%AC%C2%9A%C2%A9%C3%AC%C2%95%C2%BD%C3%AA%C2%B4%C2%80_APIHUB_%C3%AC%C2%B5%C2%9C%C3%AC%C2%A2%C2%85_260624_KR_clean_1782291589723.pdf (2026-11-19)

**robots.txt**
- shopping.naver.com은 AI·RAG 목적 접근 금지를 주석으로 밝히고, `*`는 `Disallow: /`다.
- Yeti(네이버 검색)는 /v1, /my, 스토어 경로 등을 막는다. Googlebot은 일부 홈만 허용한다.
- 출처: https://shopping.naver.com/robots.txt (2026-11-19)
- search.shopping.naver.com/robots.txt는 HTTP 418(봇 차단 페이지)을 돌려줬다.

**판정: 자동 접근 불가**
- 공식 API가 종료됐고 대체 쇼핑 API가 없다. 사이트 크롤링도 robots.txt가 전면 금지한다.

#### 라쿠텐 이치바 상품 검색 API

**API 현황**
- 현재 버전은 20260701이다. 엔드포인트는 `openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701`이다.
- 공식 문서는 503이라 검색 색인으로만 확인했다. 출처: https://webservice.rakuten.co.jp/documentation/ichiba-item-search (2026-11-19)

**신규 앱 생성 중단**
- 2026-11-09 00:00(JST)부터 관리 화면(UI 포털)이 점검 중이라 신규 앱을 만들 수 없다.
- 기존 앱은 계속 쓸 수 있다. 복구 시점은 미정이다.
- 출처: https://www.tumblr.com/rakuten-webservice/832776364114460672 (2026-11-20 재확인)

**제휴·표시·배송 (색인 기준)**
- affiliateId를 넘기면 affiliateUrl을 받는다.
- 크레딧 표시가 필요하다. 출처: https://webservice.rakuten.co.jp/guide/credit (색인 기준)
- 해외 배송 여부는 shipOverseasFlag로 표시된다.

**미확인 항목**
- 이용 규약(https://webservice.rakuten.co.jp/guide/rule)의 상업 이용, 캐싱, 이미지 조건은 503이라 읽지 못했다.
- 현재 요청 한도와 비용도 미확인이다.

**robots.txt**
- www.rakuten.co.jp는 `*`에 대해 /com/, /images/, /shops/ 등을 막는다. 출처: https://www.rakuten.co.jp/robots.txt (2026-11-19)
- item.rakuten.co.jp는 `?i=`, `?s=` 파라미터만 막는다. 출처: https://item.rakuten.co.jp/robots.txt (2026-11-19)
- search.rakuten.co.jp는 403이었다.

**판정: 미확인**
- 신규 개발자는 지금 시작할 수 없고 약관 원문도 확인하지 못했다.

#### Yahoo!ショッピング 商品検索 API v3 (itemSearch)

**API 개요**
- 엔드포인트는 `shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch`다. 출처: https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html (2026-11-19)
- 응답 필드: price, inStock, priceLabel, condition(new/used), janCode, seller
- 요청 파라미터: in_stock, condition, jan_code, seller_id
- 문서에 단시간 대량 접근 시 제한이 걸릴 수 있다고 나온다(1쿼리/초).

**요청 한도**
- 앱 ID마다 1분에 30요청이다(2022-06-21부터). 출처: https://developer.yahoo.co.jp/changelog/2022-05-20-shopping294.html (2026-11-20 재확인)

**상업 이용**
- 기본은 이용자 자신의 편의를 위한 비상업 목적이고, 상업 이용은 API 창구와 협의해야 한다.
  - 인용: 「利用者自身の便宜をはかる非商用目的のみ」
  - 출처: https://support.yahoo-net.jp/PccDeveloper/s/article/H000011080 (2026-11-19)
- 크레딧 표시가 필수다. 출처: https://developer.yahoo.co.jp/attribution/ (2026-11-19)
- ValueCommerce 어필리에이트를 연계할 수 있다. 출처: https://developer.yahoo.co.jp/webapi/shopping/affiliate.html (2026-11-19)

**한국 배송**
- 해외 배송 필드는 없다. delivery_area는 일본 도도부현만 받는다.

**robots.txt** (사이트 크롤링용)
- shopping.yahoo.co.jp는 /search/의 필터 파라미터, /searchbff/, /stores/search 등을 막는다. 출처: https://shopping.yahoo.co.jp/robots.txt (2026-11-19)
- store.shopping.yahoo.co.jp는 /h_api/, /*/review/, 점포 내 검색 필터 등을 막는다. 출처: https://store.shopping.yahoo.co.jp/robots.txt (2026-11-19)

**판정: 제휴·허가 필요**
- 비상업 검증은 할 수 있지만, 상업 앱인 WALF는 LY(LINEヤフー)와 협의해야 한다.
- ZOZOUSED와 KINDAL 점포를 커버한다.
- 해외 거주자가 Yahoo! JAPAN ID를 만들 수 있는지는 미확인이다.

#### eBay Browse API

**API·이용 자격**
- item_summary/search(키워드, GTIN, 이미지 검색)와 getItem을 제공한다. 출처: https://developer.ebay.com/api-docs/buy/static/api-browse.html (2026-11-19)
- 실서비스(프로덕션)는 eBay 파트너만 쓸 수 있다. EPN을 통해 신청하며 승인은 보장되지 않는다. 출처: https://developer.ebay.com/api-docs/buy/static/buy-requirements.html (2026-11-20 재확인)

**API License Agreement** (출처: https://developer.ebay.com/join/api-license-agreement, 열람은 https://www.edp.ebay.com/join/api-license-agreement (2026-11-20 재확인))
- §8.1.2: 공개 표시하는 eBay 콘텐츠를 eBay 외 콘텐츠와 섞으면 안 된다.
  - 인용: "eBay Content in a Public Display may not be co-mingled or combined with non-eBay Content."
- §8.1.3: 표시하는 매물 정보는 eBay보다 6시간, 그 밖의 콘텐츠는 24시간 넘게 뒤처지면 안 된다.
- §9.3: 경쟁 서비스 구축을 금지한다.
- §9.5: eBay 콘텐츠로 가격을 제시하거나 모델링하는 것을 금지한다.
- §9.10: AI 학습을 금지한다.

**요청 한도**
- Browse API는 getItems를 뺀 모든 메서드가 하루 5,000회, getItems도 하루 5,000회다.
- 한도 상향은 Application Growth Check 심사를 거친다.
- 출처: https://developer.ebay.com/develop/api/buy/api_call_limits (2026-11-20 재확인)

**한국 배송**
- filter `deliveryCountry:KR`로 한국 배송 가능 매물만 받을 수 있다. 출처: https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html (2026-11-19)
- shipToLocations로 배송 가능 지역을 볼 수 있다. 출처: https://developer.ebay.com/api-docs/buy/browse/types/gct:Item (2026-11-19)

**robots.txt**
- 주석에 명시 허가 없는 로봇 자동 접근을 금지한다고 적혀 있다.
- `*`는 /sch/(검색)를 막는다.
- ClaudeBot, GPTBot 등은 `Disallow: /`다.
- 출처: https://www.ebay.com/robots.txt (2026-11-19)

**판정: 제휴·허가 필요**
- EPN 승인이 필요하다.
- 승인 뒤에도 eBay 결과는 다른 판매처와 섞지 말고 별도 구역에 보여줘야 한다.

#### Google Custom Search JSON API

**신규 가입 종료**
- 신규 고객을 받지 않는다.
  - 인용: "The Custom Search JSON API is closed to new customers."
- 기존 고객도 2027-01-01까지 다른 수단으로 옮겨야 한다.
- 출처: https://developers.google.com/custom-search/v1/overview (2026-11-20 재확인)

**요금 (기존 고객만)**
- 하루 100쿼리 무료, 추가는 1,000쿼리당 5달러, 하루 최대 1만 쿼리다.

**판정: 자동 접근 불가**
- 신규 가입이 안 된다.

#### SerpApi

**서비스 성격**
- 검색 페이지 결과를 스크래핑해 제공하는 서비스다.
- 문서화된 엔진은 Google Shopping, Google Lens, eBay, Amazon, Naver Search(쇼핑 없음), Yahoo Search(search.yahoo.com) 등이다.
- 라쿠텐, Yahoo!ショッピング, Mercari, 국내 판매처 엔진은 없다.
- 출처: https://serpapi.com/search-api (2026-11-19)

**약관** (Last updated 2026-08-27)
- U.S. Legal Shield는 Free, Starter, Developer 플랜에는 적용되지 않는다.
- 공개 검색 데이터를 '수집'하는 책임만 지고, 데이터를 어떻게 쓰는지는 책임지지 않는다.
- 미국 법원에서 미국 법에 따른 청구에만 적용된다.
- 출처: https://serpapi.com/legal (2026-11-19)

**요금**
- Free 250회/월, Starter 25달러/1,000회, Developer 75달러/5,000회, Production 150달러/15,000회, Big Data 275달러/30,000회다.
- 출처: https://serpapi.com/pricing (2026-11-19)

**판정: 자동 접근 불가**
- 원 사이트(Google 등)가 허가한 경로가 아니다. 한국법 리스크도 Legal Shield 범위 밖이다. 쓰려면 먼저 법무 검토가 필요하다.

#### Shopify Global Catalog (조사 중 찾은 경로)

**개요**
- Global Catalog는 Shopify 전체 상점의 상품을 검색하고, Storefront Catalog는 상점 하나 안에서 검색한다.
- 도구는 `search_catalog`, `lookup_catalog`, `get_product`다.
- 엔드포인트는 `https://catalog.shopify.com/api/ucp/mcp`다.
- 출처: https://shopify.dev/docs/agents/catalog (2026-11-20)

**검색 기능**
- 텍스트 검색과 이미지 검색(`catalog.like`)을 지원한다.
- 필터: `ships_to.country`, `condition`(new/secondhand), `available`, `price`, `shops`(상점 도메인 지정)
- 응답에 variant price, `availability.available`, checkout_url, seller가 있다.
- 출처: https://shopify.dev/docs/agents/catalog/global-catalog (2026-11-20)

**가이드라인** (출처: https://shopify.dev/docs/agents/catalog, 2026-11-20)
- 쇼핑 경험 제공에만 쓸 수 있다. 인용: "Use Catalog data only for shopper experiences."
- 캐시: 가격·재고는 10분, 메타데이터·이미지는 24시간까지.
- 귀속 파라미터와 체크아웃 URL은 바꾸면 안 된다.
- 대량 수집, 상시 상품 DB나 상거래 색인 구축, 재배포, AI 학습은 금지다.
- 브라우징 결과를 대량 추출이나 재고 동기화에 쓰지 말라는 문구도 있다. 출처: https://shopify.dev/docs/agents/catalog/global-catalog (2026-11-20)

**API 약관** (2026-10-07 갱신)
- 2.3.14: 체계적·자동 데이터 수집과 상품 색인 구축을 금지한다.
- 2.1·2.2: 원칙적으로 Partner 계정이 필요하다.
- 출처: https://www.shopify.com/legal/api-terms (2026-11-20)

**인증·한도**
- 키 없이 에이전트 프로필로 접근할 수 있지만 한도 상향은 지원하지 않는다.
- 키 방식은 Dev Dashboard에서 발급한다.
- 요금은 문서에 없다.

**판정: 공식 연동 가능 (찾아줘 즉시 검색 한정, 조건부)**
- 기다려줘처럼 주기적으로 다시 조회하는 것이 '체계적 수집'이나 '재고 동기화'에 해당하는지는 미확인이다. Shopify에 문의해야 한다.
- ARCHIVE STORE나 KINDAL 온라인몰 같은 개별 상점이 Global Catalog에 노출되는지도 미확인이다.

#### Amazon Creators API (PA-API 5 후속)

**API 현황**
- PA-API 5는 폐지됐다. 출처: https://affiliate.amazon.co.jp/creatorsapi/docs/en-us/paapiv5-deprecation (2026-11-19)
- 요청 한도는 처음 30일 최대 1 TPS·하루 8,640회이고, 이후 출고 매출에 연동돼 최대 10 TPS까지 늘어난다. 30일 연속 적격 판매가 없으면 접근을 잃는다. 출처: https://affiliate.amazon.co.jp/creatorsapi/docs/en-us/concepts/api-rates (2026-11-20 재확인)

**Associates 프로그램 정책** (미국판, 출처: https://affiliate-program.amazon.com/help/operating/policies (2026-11-19))
- 라이선스에서 데이터 마이닝과 로봇 수집은 제외된다.
- 이미지는 캐시할 수 없고, 이미지 링크만 24시간 저장할 수 있다. 그 밖의 콘텐츠도 24시간 안에 갱신해야 한다.
- 비교 형식으로 가격을 보여줄 때는 추가 조건이 있다.

**판정: 제휴·허가 필요**
- Associates 승인과 판매 실적이 필요하다.

#### Depop Partner API

- Partner API는 비공개이고, 문의가 필요하다. 출처: https://partnerapi.depop.com/api-docs/ (2026-11-19)

**판정: 제휴·허가 필요**

#### 쿠팡 파트너스 Open API

- 공식 포털이 JS 전용이라 승인 조건, 호출 한도, 약관을 확인하지 못했다. 출처: https://partners.coupang.com/ (2026-11-19)

**판정: 미확인**

---

## 3. WALF가 지금 바로 적법하게 쓸 수 있는 경로 Top 3와 이유

"지금 바로 프로덕션에서" 승인 없이 쓸 수 있는 경로는 1번 하나뿐이다. 2번과 3번은 오늘 시작할 수 있지만, 출시 전에 승인이나 협의를 마쳐야 한다.

### 1. Shopify Global Catalog: 찾아줘의 즉시 검색

**이유**
- 공식 문서가 제3자 에이전트와 앱의 상품 검색을 명시적으로 허용한다. 승인 절차 언급이 없다.
- 이미지 검색, 중고 필터(`condition=secondhand`), 한국 배송 필터(`ships_to.country`)가 있어 '같은 상품 찾기'에 맞는다.

**지켜야 할 조건**
- 사용자가 요청할 때만 조회한다.
- 가격·재고는 10분, 메타데이터·이미지는 24시간 넘게 캐시하지 않는다.
- 상품 DB를 만들지 않는다.
- 체크아웃 URL과 귀속 파라미터를 바꾸지 않는다.

**한계**
- 기다려줘의 주기 재조회는 허용 여부가 미확인이라 Shopify에 문의해야 한다.
- 국내 대형 판매처는 Shopify가 아니어서 커버하지 못한다.

### 2. eBay Browse API (+ eBay Partner Network): 해외 아카이브 매물

**이유**
- 가장 성숙한 공식 검색 API다.
- `deliveryCountry:KR` 필터와 shipToLocations로 한국 배송 가능 여부를 바로 거를 수 있다.
- 6시간 신선도 규정이 기다려줘 갱신 주기의 기준이 될 수 있다.

**지금 할 수 있는 것**
- 샌드박스 개발과 EPN 프로덕션 신청이다.

**한계**
- 승인은 보장되지 않는다.
- eBay 결과는 다른 판매처와 섞어 보여주면 안 된다(§8.1.2).
- 가격 제시·모델링 기능(§9.5)은 피해야 한다.

### 3. Yahoo!ショッピング itemSearch v3: 일본 古着 점포

**이유**
- ZOZOUSED(ZOZOTOWN Yahoo!店)와 KINDAL처럼 자사 사이트에 자동 접근할 수 없는 일본 중고 판매처의 재고를 공식 API로 볼 수 있는 유일한 경로다.
- `condition=used`, `inStock`, `jan_code`가 동일 상품 매칭과 재고 감시에 맞는다.

**지금 할 수 있는 것**
- 비상업 검증이다.

**한계**
- 상업 출시 전에 LY와 협의해야 한다.
- 일본 국내 발송만 되므로 배송대행 안내가 필요하다.
- 한도가 앱 ID당 30회/분이다.

### Top 3 밖의 기본선

모든 판매처에 적법하게 적용할 수 있는 최소 경로는 **사용자가 준 링크를 저장하고 원 판매처로 보내는 것**이다. 서버가 페이지를 가져오지 않고, 사용자가 판매처에서 직접 확인한다.

- 후루츠패밀리, トレファク, KINDAL은 사용자가 요청할 때 공개 페이지를 1회 확인하는 정도가 후보다. 출시 전 법무 검토가 필요하다.
- 무신사, 번개장터, 메르카리는 링크 이동만 가능하다.

**제휴 우선순위 제안**
1. 구구스: 제휴 창구가 공개돼 있다.
2. 메르카리: Buyee와 번개장터 제휴 선례가 있다.
3. 무신사
4. 번개장터: 해외 채널 API 선례가 있다.

---

## 4. 확인하지 못한 핵심 항목

**한국 판매처**
- KREAM 약관 원문과 robots.txt (HTTP 500)
- 무신사 큐레이터에 앱이 참여할 수 있는지, 글로벌몰 제휴 피드가 공식인지
- 번개장터 해외 채널 API를 외부에서 신청할 수 있는지

**일본 판매처**
- ZOZOTOWN 이용약관 (타임아웃), 2nd STREET 전 항목 (403), RAGTAG 자사 약관 (403·503), メルカリShops 이용약관 (403)
- 일본 판매처들의 어필리에이트 프로그램
- ARCHIVE STORE 해외 배송

**검색 경로**
- 라쿠텐 API 이용 규약(상업 이용, 캐싱, 이미지), 현재 요청 한도와 비용, 관리 화면 복구 시점
- Yahoo itemSearch의 비용, 캐싱·이미지 조건, 상업 이용 협의 조건, 해외 거주자의 Yahoo! JAPAN ID 가입 가능 여부
- Shopify Global Catalog의 주기 재조회 허용 여부, 요금과 수치 한도, 한국·일본 빈티지 상점의 노출 여부
- eBay API 이용료
- 쿠팡 파트너스 약관과 한도
- 네이버 쇼핑커넥트 API가 있는지

## 5. 조사 메모

**차단·오류 응답** (우회하지 않음)

| 주소 | 응답 |
|---|---|
| kream.co.kr, www.kream.co.kr (robots.txt, /agreement) | 500 |
| zozo.jp/robots.txt | 403 (WebFetch는 타임아웃) |
| www.2ndstreet.jp (robots.txt 포함 전 페이지) | 403 |
| search.shopping.naver.com/robots.txt | 418 |
| search.rakuten.co.jp/robots.txt | 403 |
| webservice.rakuten.co.jp 문서·규약 | 503 |
| support.mercari-shops.com | 403 |
| member.one.musinsa.com | curl 403 (WebFetch로 열람) |

**무신사 홈페이지 요청**
- 정책 링크를 찾으려고 www.musinsa.com 홈페이지를 curl로 1회 요청했다. robots.txt의 `*` 전체 Disallow에 해당하는 요청이었다.
- 그 뒤로 무신사 페이지는 WebFetch(Claude-User, robots.txt 허용 명단에 있음)로만 읽었다.

**페이지 안의 지시문**
- ARCHIVE STORE Shopify robots.txt와 agents.md에 에이전트를 향한 권유 문구가 있었다. 데이터로만 기록했고 따르지 않았다.
