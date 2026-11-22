# WALF Search Recovery — 실제 패션 상품 탐색 실패 해결

기준: PR #3 `5537c06`(feat/walf-discovery-upgrade). 이 작업: 브랜치 `feat/walf-search-recovery`.
목표: WALF가 실행되는 것이 아니라 **실제로 옷을 찾는 것**. 기존 대비 실측 결과는 §7.

## 0. 한눈에

| 단계 | 기존(PR #3) | 바꾼 뒤 |
|---|---|---|
| 탐색 시작 | 식별 결과(AI 제안·공개·사용자 확인)가 있어야만. 사진만·브랜드만·식별 실패면 **판매처 탐색 0회** | 사진 특징만으로도, 사용자가 적은 브랜드·상품명으로도, 낮은 신뢰도 브랜드 단서로도 시작 |
| 실제 검색 경로 | BADBLOOD 공식몰 1곳(카페24 자체 검색) | + 중고나라 자체 검색(로컬 실험 전용) · 검색 API 4종(키 있을 때) · Shopify Global Catalog(프로필 있을 때) · 로컬 메타검색(실험) |
| 검색어 | 품번·브랜드·상품명만 | 6단계: 품번·브랜드 → 상품명·별칭 → 브랜드+특징 → 특징(한국어) → 영어·일본어 → 검색 결과 단서 |
| 사진 비교 | 없음(`FASHION_BRAIN` 빈 배열) | 로컬 MODA(Intelligence Lab) 사진 유사도로 후보 정렬 · 제로샷으로 성별·제품군·바지 실루엣 보완 |
| 대체 추천 | 실제 의뢰에 쓸 엔진 없음(테스트 큐레이터만) | 실제 검색 후보 + 정렬 4방식(디자인 / 사진 / 사진+디자인 / 선호+사진) |

같은 상품 판정은 바꾸지 않았다. 사진 유사도는 **순서와 비교 근거**로만 쓰고, 같은 상품(same_code·likely)은 여전히 품번·브랜드·상품명 규칙과 운영자 확인으로만 정한다. 결과는 운영자 검수 전에는 사용자에게 보이지 않는다.

## 1. 실제 실패 사례 재현 (STEP 0)

사용자가 휴대폰으로 직접 맡긴 의뢰 2건(로컬 DB `server/data/phone.db`, 2026-11-21~22). 원본 사진·개인정보는 저장소에 넣지 않는다.

| 항목 | 의뢰 #1 | 의뢰 #2 |
|---|---|---|
| 입력 | 사진 1장(여러 사람이 나온 캡처) + 메모 "왼쪽 사람의 빨간 체크 셔츠, 브랜드 모름" | 사진 1장(같은 디자인 바지 2색, 남성) |
| 실행 코드 | walf-v2 작업 폴더(PR #3 + 휴대폰 시험용 무료 엔진 연결, 커밋 전) | 같음 |
| AI 제공자 | `oss` — 로컬 Qwen3-VL-8B + SearXNG(네이버·빙·브레이브) + Crawl4AI. 유료 API 없음 | 같음 |
| 사진 분석 | 1차: 다른 옷(베이지 재킷)을 읽음 → 메모 보완 후 "빨강·흰색 체크 셔츠" | "바지·베이지·딥블루·데님" — 부츠컷·커브드 절개·성별은 못 읽음 |
| 식별 검색어 | `빨강 코튼 자켓 site:musinsa.com` 등 6~12회(체크 셔츠인데 "자켓"으로 만든 버그 포함) | `베이지 바지 site:musinsa.com` 등 9회 |
| 검색 출처 | 무신사·29CM·W컨셉 `site:` 검색만 | 같음 |
| 열 수 있던 상품 페이지 | **0** (14쪽 중 약관 9·robots 5로 열지 않음) | **0** (14쪽 중 robots 10·약관 4) |
| 식별 결과 | 썸네일 비교로 다른 상품 4개 제안(트래블 트랙 재킷, 빈폴 키즈 셔츠 등) | 무신사 스탠다드 치노·사파리스팟 버뮤다(틀림) — 모두 숨김 |
| 판매처 탐색(find) | **한 번도 시작 안 함** — 숨김 후보뿐이라 탐색 대상 없음 | **한 번도 시작 안 함** |
| 비슷한 옷(similar) | 중고나라 엔진 검색 14건 → 디자인 점수 6개 → 운영자 사진 대조 후 1개 공개 | 검색 5회: "블루 바지"(472건 중 50) → 여성 부츠컷 공개(사용자 지적) → 운영자가 기준 디자인에 남성·부츠컷·커브드 절개 입력 → "남자 커브드 부츠컷" 0건 |
| 웹 검색 엔진 상태 | 빙 연결 끊음, 브레이브 429 | 2026-11-22 10:00 재시도: 브레이브 1회 뒤 429·1시간 정지, 빙 연결 끊음, 네이버는 사이트 첫 화면 주소만 |
| 최종 | 완료(사용자가 마침) | `not_found` · 대체 추천 0개 |

**실패한 곳(원인 순서)**
1. **식별이 막힌 판매처 안에서만 검색했다.** 무신사·29CM·W컨셉은 약관·robots로 열 수 없는 곳이라 상품 페이지 0개, 썸네일만으로 고른 후보는 틀렸다.
2. **식별 실패 = 탐색 중단.** `targetsOf()`가 숨김 후보를 빼면 대상이 없어 `queueFindSearch()`가 "탐색할 식별 결과가 없어요"로 끝났다.
3. **검색어가 상품을 알 때만 만들어졌다.** `buildQueries()`는 품번·브랜드·상품명뿐이라 사진만 있는 의뢰엔 검색어가 0개였다.
4. **실제로 동작한 검색 경로가 중고나라 하나**(엔진 실험 경로)였고, 웹 검색 엔진은 스크레이핑 방식이라 막혔다.
5. **사진을 비교하지 않았다.** 제목 글로만 디자인 점수를 매겨 여성 부츠컷이 남성 의뢰에 올라갔다(제목에 성별이 없었다).

PR #3 코드(`5537c06`)를 그대로 꺼내 같은 입력으로 돌린 결과(로컬, 2026-11-22):

| 입력 | 판매처 탐색 | 대체 추천 |
|---|---|---|
| 사진만(사진 분석 완료: 남성·부츠컷·데님 바지) | 탐색할 식별 결과가 없어요 | 지금 쓸 수 있는 추천 엔진이 없어요 |
| 브랜드+상품명 입력(Levi's 517) | 탐색할 식별 결과가 없어요 | 지금 쓸 수 있는 추천 엔진이 없어요 |
| 브랜드+상품명 입력(BADBLOOD, 공식몰 등록) | 탐색할 식별 결과가 없어요(AI 식별 전) | 지금 쓸 수 있는 추천 엔진이 없어요 |

## 2. 탐색 시작 구조 (STEP 1) — `server/src/findsearch.ts`

`targetsOf()`가 입력 유형마다 독립적으로 대상을 만든다. 식별 실패가 탐색 중단으로 이어지지 않는다.

| 입력 | 탐색 대상(basis) | 비고 |
|---|---|---|
| A 사진만 | `style_only` — 사진에서 읽은 특징(디자인 태그) | 대상에 `style`이 실려 특징 검색어를 만든다 |
| B 브랜드·상품명 | `user_input` — AI 식별을 기다리지 않는다 | `certain=false`: 검증된 상품 정보로 올리지 않는다 |
| C 상품 링크 | 기존 허용 목록 방식 유지 | 목록 밖 링크는 열지 않고 운영자 확인(검색 단서로 남김) |
| D 브랜드 후보만 | `ai_clue` — 브랜드 + 디자인 특징 검색 | 상품명은 쓰지 않는다(틀린 이름이 검색을 좁힘) |
| E 정확한 식별 없음 | 숨김(낮은 신뢰도) 후보의 브랜드만 `ai_clue`로 | 검색 단서로만 · 사용자에게 공개하지 않음 |

사진 분석이 로고·라벨로 짐작한 브랜드(`brand_guess`)는 신뢰도 낮음 후보로 저장돼 숨김 처리되고 위 E 경로로만 쓰인다(`oss.ts` `ossIdentifyData`).
식별 검색은 접근이 허용된 판매처만 쓴다(`aijobs.ts` `identifyAllowed` — 약관 금지·제휴 필요·확인 전 판매처는 `site:` 검색에서 뺌). 실제 판매 페이지 발견은 판매처 탐색이 따로 한다.

## 3. 실제 웹 탐색 경로 (STEP 2) — `server/src/websources.ts`

기존 `SearchSource` 모양 그대로. 단계를 나눴다: ① 검색 인덱스로 상품 페이지 **발견** ② 허용 목록에 있는 곳만 상품 페이지 **검증**(detail) ③ **사진 비교**(brain.ts) ④ 가격·재고 확인. **상품 URL 발견 ≠ 가격·재고 자동 수집 권한** — 발견만 한 주소는 `listed_only`(운영자 확인 대상)로 남는다. 차단 우회·봇 위장 없음.

| 경로 | 상태(이 PR) | 켜는 조건 | 무료 한도·가격 | 비고 |
|---|---|---|---|---|
| 중고나라 자체 검색 | 구현 · **운영에선 닫힘** | `WALF_EXPERIMENT_SOURCES=joongna`(로컬 실험) | 무료 | robots.txt `Allow: /` 확인(2026-11-22). 약관 제20조 2호 법무 확인 전 — 운영 배포 금지. 검색 목록만 읽고 판매 완료 제외 |
| 카카오 다음 웹문서 검색 | 구현(키 대기) | `WALF_KAKAO_REST_KEY` | 하루 3만 건 · 카드 언급 없음 | **무료 1순위 추천**. 캐시는 사용자 경험 개선 목적만 |
| 네이버 API HUB 웹문서 | 구현(키 대기) | `WALF_NAVER_HUB_ID`·`_SECRET` | 한시적 무료(유료 전환 예고) | 쇼핑 검색 API는 2026-07-31 종료(대체 없음) |
| Tavily | 구현(키 대기) | `WALF_TAVILY_KEY` | 월 1,000크레딧 · 카드 불필요 | 한국어 커버리지 미확인 |
| Brave Search API | 구현(키 대기) | `WALF_BRAVE_API_KEY` | 월 $5 크레딧 · 카드 필요 · 이후 $5/1,000회 | 일시 저장 외 저장 금지 |
| Shopify Global Catalog | 구현(설정 대기) | `WALF_SHOPIFY_AGENT_PROFILE`(공개 주소의 에이전트 프로필) | 키 없음 · 한도 비공개 | Shopify 상점만(해외 브랜드·아카이브). 사진 검색은 사진을 Shopify로 보내야 해서 쓰지 않음(승인 전). 가격 10분·이미지 24시간 캐시, 대량 수집 금지 |
| 로컬 메타검색(SearXNG) | 구현 · 실험 전용 | `WALF_EXPERIMENT_SOURCES=searxng` + `WALF_SEARXNG_URL` | 무료 | 검색 엔진 화면 대리 수집이라 운영 경로 아님(빙·브레이브가 막음) |
| 사진으로 찾기(유료가 필요할 때) | 구현 안 함 | — | Google Vision Web Detection 월 1,000건 무료 후 $3.50/1,000건 · 결제 계정 필요 | 같은 이미지가 실린 페이지만 찾음(착용 사진은 약함). 사용자 사진을 외부로 보내므로 승인 필요 |

넣지 않은 경로: SerpApi·Serper(원 출처 허가 아님), Bing(2025-08 종료, 후속은 저장·색인 금지), eBay 이미지 검색(EPN 승인·4개 마켓), 쿠팡·11번가(공식 조건 미확인), Grailed(약관상 자동 접근 금지). 조사 출처는 부록.

## 4. 실상품 검색어 엔진 (STEP 3) — `server/src/queryplan.ts`

- 6단계 `planQueries()`: 품번·브랜드 → 상품명·별칭 → 브랜드+특징 → **브랜드 뺀 특징(한국어)** → **영어·일본어** → **검색 결과 단서**(`clueQueries`: 사진이 가장 닮은 후보 제목에 두 번 이상 나온 고유 낱말).
- 특징 낱말은 통제 어휘 → 사람들이 매물 제목에 실제로 쓰는 말(데님 바지 → 청바지, bootcut → 부츠컷·bootcut·ブーツカット).
- 단계 묶음마다 검색하고, 후보가 충분하면(`WALF_SEARCH_ENOUGH`, 기본 40) 뒤 단계를 보내지 않는다. 두 번째 식별 후보부터는 검색어 3개까지.
- `query_stats` 표: 소스·검색어별 실행 수·결과 수·정답 수. 같은 소스에서 두 번 넘게 0건이면 3일 동안 다시 보내지 않는다(`skipReason`). 정답을 낸 검색어는 `markCorrect`로 표시해 효과 낮은 검색어를 고르는 근거로 쓴다.
- 평가에서 정답(브랜드·모델)을 검색어에 넣지 않는다.

## 5. Intelligence 실연동 (STEP 4)

- 서비스: walf-intelligence `integration/brain_service.py` — MODA(`HopitAI/moda-fashion-distilled@1cdaaaf`, R2 카탈로그 Top-1 57.4%·착용 52.1%)를 이 맥에서 띄운다(127.0.0.1만). `POST /similarity`(맡긴 사진 경로 + 후보 이미지 주소 → 코사인), `POST /zeroshot`.
- 사용자 사진은 **업로드 폴더 안 파일 경로로만** 넘긴다(서비스가 허용 폴더 밖은 읽지 않음). 외부 전송 없음. 후보 사진은 접근을 확인한 검색 결과의 썸네일만.
- WALF 쪽: `server/src/brain.ts`(`WALF_BRAIN_URL`은 이 맥 안 주소만 받음). `runFindSearch()`·`runSimilarSearch()`가 실제로 사진을 넘기고 점수를 받는다(기존: `runSimilarSearch`가 사진을 공급자에 안 넘김 → 고침).
- 쓰임: ① 후보 정렬(같은 판정·같은 재고 조건 안에서만) ② 검색 결과 단서 고르기 ③ 제로샷으로 빈 성별·제품군·바지 실루엣 채우기(높은 확률만, 운영자가 고친 기준은 덮지 않음) ④ 제목에 성별이 없을 때 사진 성별 추정은 "다른 점"에 적고 순서만 내림.
- 판정은 바꾸지 않는다: 사진이 닮아도 `unverified`. 확인 항목에 "사진 유사도 0.64(MODA) — 같은 상품 판정 근거는 아니에요".
- 통합 테스트: 단위 테스트(가짜 서비스) + **실제 WALF 서버 코드가 실제 로컬 MODA 서비스에 요청하고 결과를 받은 실측**(§7, `tools/search-eval.ts`).

## 6. 필터·불확실성 (STEP 5)

- 넓게 모으고 검증에서 좁힌다: 특징 검색은 넓게(예: "부츠컷 청바지"), 사진 유사도가 정밀도를 맡는다. 저장은 확인 못 함·다른 상품 합쳐 앞에서 30개(`WALF_SEARCH_KEEP`).
- 제목이 불완전해 디자인 태그를 못 읽어도 사진 비교가 됐으면 버리지 않는다(대체 추천).
- **확실히 다른 상품**(제목에 반대 성별·아동복 표기 → `different`)과 **정보 부족**(사진으로만 반대 성별로 보임 → 다른 점에 적고 순서만 내림)을 구별한다.
- `cleanIdentify()`: 확인된 주소 집합이 비어 있으면 검증 안 된 근거 주소를 그대로 두던 경로를 고쳤다(이제 모두 빼고 그 사실을 남김).
- 색·사이즈·가격은 기존대로 식별(verdict)과 분리된 구매 조건(`wantColor`·`wantSize`·희망가)으로만 본다.
- 아동복(유아동·키즈·"(4-5세)"·"7호(4-5T") 표기와 "여 24"(여성 허리 인치) 표기를 인식한다(2026-11-22 실측에서 섞여 나옴).

## 7. 실제 탐색 성능 평가 (STEP 7)

**평가셋**: 권리가 확인된 실제 상품 사진 26건(walf-intelligence `data/search-recovery-eval/`, Wikimedia Commons CC0·CC BY·CC BY-SA·PD, Met Open Access CC0 — `fetch.py --check`로 라이선스 재확인). 흔한 현행 상품 7 · 해외 브랜드 의류 6 · 단종·아카이브 4 · 국내 브랜드 3(신발만 — 얼굴 없는 국내 의류 사진을 못 찾음, 프로스펙스 2건은 Commons 라이선스 검토 대기) · 동일 상품 없음 3 · 무지 기본템 3.
**입력**: 모든 사례를 **사진만** 맡긴 의뢰로(브랜드·상품명·메모 없음). 정답·평가 메모는 검색어·사진 분석에 넣지 않고 채점에만 쓴다.
**경로**: 로컬 사진 분석(Qwen3-VL-8B) + MODA 제로샷 → 판매처 탐색(실제 검색 경로는 중고나라 자체 검색 1곳 — 검색 API 키 없음) → MODA 사진 유사도 정렬. 비용 0원.
**채점**: 매물 제목이 사례의 정답 규칙(브랜드+모델 낱말 정규식)과 맞으면 "정답 후보". 규칙은 브랜드·모델 낱말만 본다 — **같은 계열 다른 모델·다른 색도 정답 후보로 세어진다**(예: 컨버스 런스타 레거시, 에어포스1 다른 색). 같은 상품 확정이 아니다.
**"사진 비교 없음"**은 같은 후보 묶음을 기존 규칙 정렬(판정·재고·상세·가격)로 다시 줄 세운 것(단서 검색어로만 나온 후보 제외)이다.

### 7-1. 기존 대비 (같은 26건)

| 지표 | PR #3 `5537c06` | 1차 | 2차 | 3차(최종) |
|---|---|---|---|---|
| 검색 자체가 실행된 비율 | **0/26** | 25/26 | 26/26 | **26/26** |
| 정답 후보 발견(시장에 있는 18건) | 0/18 | 7/18 | 9/18 | **10/18 (56%)** |
| 상위 5개 안 정답 — 사진 유사도 정렬 | 0/18 | 5/18 | 7/18 | **6/18 (33%)** |
| 상위 5개 안 정답 — 같은 후보, 사진 없이 | — | 1/18 | 2/18 | 4/18 (22%) |
| 유사품 발견(동일 상품 없음·기본템·시장에 없는 아카이브 8건, 규칙 일치) | 0/8 | 3/8 | 4/8 | 4/8 (상위 5개 안 4) |
| 브랜드 식별(사진 분석의 로고·라벨 추정이 정답 브랜드) | — | 5 | 4 | 6 |
| 실제 판매 매물 발견(판매 완료 제외 검색 목록 기준) | 0/18 | 7/18 | 9/18 | 10/18 |
| 다른 상품 오확정(같은 상품·가능성 높음으로) | 0 | 0 | 0 | **0** |
| 대체 추천 상위 5개 평균 사진 유사도 — 디자인 태그만 / 사진 / 사진+디자인 / 선호(실루엣)+사진 | 추천 엔진 없음 | 0.40 / 0.56 / 0.53 / 0.53 | 0.43 / 0.64 / 0.62 / 0.62 | 0.39 / 0.57 / 0.56 / 0.56 |
| 한 건 처리 시간(중앙값) | — | 90초 | 51초 | 44초(사진 분석 21초) |
| 한 건 비용 | — | 0원 | 0원 | 0원 |

- 1차 → 2차: 사진 분석 질문이 "상의(외투)"로 고정돼 신발 사진에 "상의가 보이지 않습니다"라고 답하던 결함을 고침(엔진 `vision.py`), 문장형 답을 검색어에서 거름, 신발에 핏 낱말을 붙이지 않음, 모델 번호를 브랜드와 붙여 검색.
- 2차 → 3차: 질문 속 예시("하이탑 스니커즈", "라이더 재킷")를 모델이 그대로 베끼던 결함을 고침, 브랜드 추정을 별칭 사전으로 맞춤(耐克 → Nike, 한글 이름으로도 검색).
- **같은 평가셋으로 세 번 고쳐 돌렸으므로 수치가 이 셋에 유리할 수 있다.** 고친 것은 사례에 맞춘 조정이 아니라 일반 결함이지만, 브랜드 별칭 사전(`seed/brand-aliases.json`, 61개)에는 평가셋 브랜드도 들어 있다. 새 사례로 다시 재야 한다.
- 로컬 사진 분석은 실행마다 답이 조금씩 다르다(같은 사진: 2차 "하이탑 스니커즈" → 3차 "화이트 라이트 레이스"). 사례별로 오르내림이 있어(에어포스1·리바이스·칼하트·프레드페리) 1회 측정만으로 판단하지 않는다.
- **이미지 모델 성능과 인터넷 탐색 성공률은 다르다.** 정답이 후보 묶음에 들어오기만 하면 사진 정렬이 순위를 크게 올렸다(뉴발란스 574: 규칙 25위 → 사진 1위, 아디다스 삼바: 81위 → 1위, 리바이스 501: 83위 → 1위). 정답이 아예 검색되지 않은 8건은 사진 모델이 도울 수 없었다 — 병목은 여전히 **검색 경로**(중고나라 하나)다.
- 대체 추천의 자동 적합도 지표(제목의 제품군·성별·아동복 확인)는 1~3차 모두 88~100%로 포화돼 구분이 안 된다. 사진으로 직접 본 결과가 더 분명하다: 디자인 태그만 쓴 정렬은 1920년대 드레스 사례 상위 5개에 PC 파워 서플라이·청바지가 섞였고, 사진+디자인 정렬은 드레스·니트처럼 같은 종류를 올렸다(1차 검수, 로컬 대조 화면).
- 사람 평가(대체 추천이 실제로 쓸 만한지)는 아직 하지 않았다.

### 7-2. 카카오(다음) 검색 키를 넣은 뒤 (2026-11-22, 같은 26건)

| 지표 | 3차(중고나라만) | + 다음 웹문서 검색 | + 웹문서·이미지 검색 |
|---|---|---|---|
| 정답 후보 발견(18건) | 10/18 | 10/18 | **11/18 (61%)** |
| 상위 5개 안 정답 — 사진 정렬 | 6/18 | 6/18 | **8/18 (44%)** |
| 다른 상품 오확정 | 0 | 0 | 0 |

- 웹문서 검색만으로는 정답 규칙 매물이 27건 늘었지만(헬로마켓·패션플러스·머스트잇 등) 모두 이미 찾은 사례라 사례 수는 그대로였다. 글 결과에 사진이 없어 사진 정렬도 못 했다.
- 이미지 검색을 함께 쓰면(같은 상품 주소면 글 제목+사진을 합침) 프레드페리가 새로 1위, 리바이스 501이 6위 → 5위 안으로 들어왔다.
- 실측 중 찾은 결함: 사진 없는 후보가 30개 저장 한도에서 모두 잘림(의뢰 #2: 카카오 8건 → 0건 저장) — 고침(`e18c80b`).
- 카카오 결과에는 가격비교·딜 알림 사이트(지름알림·엔스토어프라이스)가 많다 — 판매처가 아니므로 운영자 검수에서 거르고, 다음 개선으로 발견 단계에서 뺀다.
- 의뢰 #2(남성 커브드 부츠컷)는 카카오로도 맞는 매물을 못 찾아 공개하지 않았다.

## 8. 사례별 기록 (STEP 8, 3차 기준)

입력 사진은 저장소에 넣지 않는다(출처·라이선스는 walf-intelligence `data/search-recovery-eval/cases.json`). 모든 사례의 기존(PR #3) 결과는 "탐색 시작 안 함 · 대체 추천 엔진 없음"이다(§1 표). 적용한 수정은 §2~6 전부.

| 사례 | 정답 | 사진 분석(제로샷 보완) | 검색어 | 후보 | 정답 순위(사진/규칙) | 사진 유사도(정답 최고/전체 최고) | 실패 단계 |
|---|---|---|---|---|---|---|---|
| c01_converse_chuck_allstar_hi_white | Converse Chuck Taylor All Star Hi (클래식 하 | 흰색 고무창 스니커즈/흰색 스니커즈/고무창 · category:footwear color:red,white material:cotton gender:men (+성별 남성(사진 추정 94%)) · 브랜드 추정 Converse | Converse 신발 / 컨버스 신발 / 남자 레드 흰색 고무창 스니커즈 / 흰색 고무창 스니커즈 | 88 | 2/2 | 0.8368/0.8539 | —(상위 5개 안) |
| c02_drmartens_1460_8eye_brown | Dr. Martens 1460 8홀 부츠 (스무스 레더) | 딥 레드 브라운 부츠/드라마트너스/딥 레드 부츠 · category:footwear color:red,brown gender:men (+성별 남성(사진 추정 93%)) · 브랜드 추정 DR. MARTENS | Dr. Martens 신발 / 닥터마틴 신발 / 남자 딥 레드 브라운 부츠 / 딥 레드 브라운 부츠 | 56 | 48/23 | 0.8088/0.8088 | 정렬(정답이 5위 밖) |
| c03_nike_airforce1_low_white | Nike Air Force 1 '07 Low (트리플 화이트) | 화이트 라이트 레이스/화이트 신발/라이트 레이스 · category:footwear color:white gender:men (+성별 남성(사진 추정 93%)) · 브랜드 추정 耐克 | Nike 신발 / 나이키 신발 / 남자 화이트 라이트 레이스 / 화이트 라이트 레이스 | 114 | 1/19 | 0.6923/0.6923 | —(상위 5개 안) |
| c04_adidas_samba_og_white | adidas Samba OG (클라우드 화이트/코어 블랙/검) | 흰색 스니커즈/아디다스/산바 · category:footwear color:white,black,brown material:leather gender:men (+성별 남성(사진 추정 94%)) · 브랜드 추정 아디다스 | adidas 신발 / 아디다스 신발 / 남자 화이트 흰색 스니커즈 / 흰색 스니커즈 | 189 | 1/96 | 0.8633/0.8633 | —(상위 5개 안) |
| c05_newbalance_574_grey | New Balance 574 코어 (그레이) | 그레이 뉴발란스 신발/뉴발란스/574 · category:footwear color:white,gray gender:men (+성별 남성(사진 추정 99%)) · 브랜드 추정 뉴발란스 | New Balance 신발 / 뉴발란스 신발 / 뉴발란스 574 / 남자 화이트 그레이 뉴발란스 신발 | 164 | 1/2 | 0.9249/0.9249 | —(상위 5개 안) |
| c06_birkenstock_arizona_black | Birkenstock Arizona (ESD 버전, 블랙) | 블랙 라이딩 슬라이드/블랙 슬라이드/코르크 밑창 · category:footwear color:black gender:men (+성별 남성(사진 추정 96%)) · 브랜드 추정 Birkenstock | Birkenstock 신발 / 버켄스탁 신발 / 남자 블랙 라이딩 슬라이드 / 블랙 라이딩 슬라이드 | 55 | -/- | -/0.7282 | 발견 실패(검색어·출처) |
| c07_levis_501_lightwash | Levi's 501 (라이트 워시, 무릎 디스트레스) | - · category:trousers silhouette:slim (+제품군 jeans(사진 추정 97%), 실루엣 skinny pants(사진 추정 57%)) | 슬림 바지 / 워싱 바지 | 99 | 7/- | 0.6627/0.7482 | 정렬(정답이 5위 밖) |
| o01_fredperry_m12_twin_tipped_black | Fred Perry Twin Tipped Fred Perry Shirt  | 블랙 폴로 셔츠/폴로 셔츠/블랙 폴로 · category:shirts color:red,white,black gender:men (+성별 남성(사진 추정 100%)) · 브랜드 추정 프레드 페르디 | 프레드 페르디 셔츠 / 남자 레드 블랙 폴로 셔츠 / 블랙 폴로 셔츠 / 폴로셔츠 셔츠 | 146 | -/- | -/0.675 | 발견 실패(검색어·출처) |
| o02_fjallraven_greenland_winter_brown | Fjällräven Greenland Winter Jacket (다크 브 | 후드 자켓/단추 자켓/포켓 자켓 · category:jacket,outerwear color:brown gender:men (+성별 남성(사진 추정 100%)) · 브랜드 추정 Fjällräven | Fjällräven 자켓 / 피엘라벤 자켓 / 남자 브라운 후드 자켓 / 후드 자켓 | 106 | 3/34 | 0.7216/0.7568 | —(상위 5개 안) |
| o03_schott_613_one_star_perfecto_black | Schott NYC 613 One Star Perfecto (블랙 레더) | 블랙 레더 바이크 재킷/블랙 레더 재킷/바이크 재킷 · category:jacket,outerwear color:black material:leather detail:zip gender:men (+성별 남성(사진 추정 97%)) · 브랜드 추정 Penrero | Penrero 지퍼 자켓 / 남자 블랙 레더 바이크 재킷 / 블랙 레더 바이크 재킷 / 남자 지퍼 자켓 | 56 | -/- | -/0.634 | 발견 실패(검색어·출처) |
| o04_arcteryx_alpha_sv_orange | Arc'teryx Alpha SV Jacket (남성, 오렌지) | 오렌지색 방수 자켓/아크테릭스/방수 자켓 · category:jacket,outerwear color:black detail:zip gender:men (+성별 남성(사진 추정 98%)) · 브랜드 추정 ARC'TERYX | Arc'teryx 지퍼 자켓 / 아크테릭스 지퍼 자켓 / 남자 블랙 오렌지색 방수 자켓 / 오렌지색 방수 자켓 | 106 | -/- | -/0.7376 | 발견 실패(검색어·출처) |
| o05_lacoste_l1212_polo_mint | Lacoste L.12.12 클래식 피케 폴로 (민트 블루) | 라이트 그린 폴로 셔츠/라이트그린 폴로/라코스테 폴로 · category:shirts color:green · 브랜드 추정 라코스테 | Lacoste 셔츠 / 라코스테 셔츠 / 라이트 그린 폴로 셔츠 / 반팔 셔츠 | 148 | 1/2 | 0.7716/0.7716 | —(상위 5개 안) |
| o06_carhartt_duck_hooded_jacket_brown | Carhartt 덕 후드 재킷 (Active/Sierra 계열, 칼하트  | 카라트/헤드/shearling · category:jacket,outerwear color:beige detail:zip gender:men (+성별 남성(사진 추정 99%)) · 브랜드 추정 Carhartt | Carhartt 지퍼 자켓 / 칼하트 지퍼 자켓 / 남자 베이지 카라트 / 카라트 | 152 | -/- | -/0.6943 | 발견 실패(검색어·출처) |
| a01_worth_afternoon_jacket_1895 | House of Worth Afternoon jacket, 1895 (애 | 볼드 럭셔리 재킷/벨벳 재킷/볼륨 소매 · category:jacket color:gray,brown | 그레이 볼드 럭셔리 재킷 / 볼드 럭셔리 재킷 / jacket / ジャケット | 0 | -/- | -/- | 검색 결과 없음 |
| a02_lucile_dress_1925_pink | House of Lucile Dress, ca. 1925 (1920년대  | 핑크색 무늬 카미즈/핑크 카미즈/무늬 원피스 · gender:women (+성별 여성(사진 추정 99%)) | 여자 핑크색 무늬 카미즈 / 핑크색 무늬 카미즈 / womens / レディース | 0 | -/- | -/- | 검색 결과 없음 |
| a03_chanel_suit_early1960s_cream | Chanel 스리피스 수트 (1960년대 초, 코코 샤넬) | 크롭 재킷/크림색 재킷/포켓 장식 · category:jacket,outerwear color:red,black silhouette:cropped gender:women (+성별 여성(사진 추정 96%)) | 여자 레드 크롭 재킷 / 크롭 재킷 / 여자 크롭 자켓 / 여자 레드 크롭 자켓 | 155 | 124/101 | 0.3401/0.6901 | 정렬(정답이 5위 밖) |
| a04_polo_rl_vintage_cycle_racing_jacket | Polo Ralph Lauren 빈티지 사이클 프린트 레이싱 재킷 (19 | 컬러 블록 자켓/폴로 램스/레이싱 자켓 · category:jacket,outerwear color:red,blue detail:zip gender:men (+성별 남성(사진 추정 99%)) · 브랜드 추정 폴로 램스 | 폴로 램스 지퍼 자켓 / 남자 레드 컬러 블록 자켓 / 컬러 블록 자켓 / 남자 지퍼 자켓 | 106 | -/- | -/0.7386 | 발견 실패(검색어·출처) |
| k01_prospecs_stacks105_black | Pro-Specs (프로스펙스) 스택스 105 (블랙) | 블랙 러버 소재 트렌디한 디자인 신발/블랙 러버 신발/트렌디 신발 · category:footwear color:white,black gender:men (+성별 남성(사진 추정 97%)) | 남자 화이트 블랙 러버 소재 트렌디한 디자인 신발 / 블랙 러버 소재 트렌디한 디자인 신발 / mens shoes / メンズ シューズ | 0 | -/- | -/- | 검색 결과 없음 |
| k02_prospecs_white_leather_sneaker | Pro-Specs (프로스펙스) 흰색 가죽 코트 스니커즈 (모델명 미상) | 흰색 브랜드 로고 스니커즈/흰색 스니커즈/PRO-SPECS · category:footwear color:white gender:men (+성별 남성(사진 추정 93%)) · 브랜드 추정 PRO-SPECS | Pro-Specs 신발 / 프로스펙스 신발 / 남자 화이트 흰색 브랜드 로고 스니커즈 / 흰색 브랜드 로고 스니커즈 | 91 | 17/2 | 0.5571/0.6647 | 정렬(정답이 5위 밖) |
| k03_fila_float_maxxi_lime | FILA (휠라) Float Maxxi (네온 라임) — 뒤쪽은 Axil | 노란색 러닝화/FILA 러닝화/FLOAT MAXX · category:footwear color:red,white,black gender:men (+성별 남성(사진 추정 99%)) · 브랜드 추정 FILA | FILA 신발 / 휠라 신발 / 남자 레드 노란색 러닝화 / 노란색 러닝화 | 87 | -/- | -/0.6866 | 발견 실패(검색어·출처) |
| n01_noh_costume_karaori_cherry | 노(能) 무대 의상 가라오리 — 벚꽃·격자문 (18세기 전반, 일본) | 꽃무늬 케이프식 코트/꽃무늬 코트/일본 전통옷 · category:outerwear color:white,blue,beige | 화이트 꽃무늬 케이프식 코트 / 꽃무늬 케이프식 코트 / jacket / アウター | 0 | -/- | -/- | 검색 결과 없음 |
| n02_handknit_pastel_striped_pullover | 손뜨개 파스텔 스트라이프 풀오버 (수제) | 무늬 줄무늬 스웨터/무늬 스웨터/줄무늬 · gender:women category:knitwear color:white,blue silhouette:oversized | 여자 화이트 무늬 줄무늬 스웨터 / 무늬 줄무늬 스웨터 / 여자 오버핏 니트 / 여자 화이트 오버핏 니트 | 104 | 2/4 | 0.6846/0.6996 | —(상위 5개 안) |
| n03_korean_girls_saekdong_jeogori | 여아 색동저고리 (20세기, 한국) | 무늬 조끼/색상 조합/전통 의상 · color:red category:jacket (+제품군 jacket(사진 추정 62%)) | 레드 무늬 조끼 / 무늬 조끼 / jacket / ジャケット | 25 | -/- | -/0.5446 | 유사품 규칙 불일치 |
| g01_basic_vneck_tee_charcoal | H&M (Commons 분류 기준, 사진에서는 식별 어려움) 기본 브이넥 | V넥 반팔 티셔츠/V넥 티셔츠/회색 반팔 · category:tees color:gray gender:men (+성별 남성(사진 추정 100%)) | 남자 그레이 V넥 반팔 티셔츠 / V넥 반팔 티셔츠 | 61 | 1/2 | 0.7099/0.7099 | —(상위 5개 안) |
| g02_basic_blue_jeans_mens | 남성 기본 청바지 (미드 워시, 스트레이트~루즈) | 청바지/스트레이트/블루 · gender:men category:trousers color:blue material:cotton,denim | 남자 블루 청바지 / 청바지 | 63 | 1/5 | 0.7356/0.7356 | —(상위 5개 안) |
| g03_hooded_windbreaker_lightgrey | Lafuma (Commons 분류 기준, 사진에서는 식별 어려움) 후드  | 울트라 베이지/울트라 방수/Lafuma · category:jacket,outerwear color:black,beige detail:zip gender:men (+성별 남성(사진 추정 100%)) · 브랜드 추정 Lafuma | Lafuma 지퍼 자켓 / 라푸마 지퍼 자켓 / 남자 블랙 울트라 베이지 / 울트라 베이지 | 113 | 3/1 | 0.6949/0.7336 | —(상위 5개 안) |

### 실제 발견한 근거 주소(정답 규칙 일치 — 같은 계열 다른 모델·색 포함)

- c01_converse_chuck_allstar_hi_white: [컨버스 척테일러 런스타 레거시 CX 퓨처 컴포트 에그렛 하이탑 A0086](https://web.joongna.com/product/233982764) · [컨버스 척테일러 올스타 하이 차콜, 반스 올드스쿨 캔버스 신발 230](https://web.joongna.com/product/233607458)
- c02_drmartens_1460_8eye_brown: (상위 8개 밖)
- c03_nike_airforce1_low_white: [290 나이키 에어포스1 밍크 운동화 스니커즈 신발 290사이즈 완전좋아](https://web.joongna.com/product/233297741) · [나이키 에어포스 1 07 카카오와우 280사이즈 새상태 Nike 스니커즈](https://web.joongna.com/product/227861472)
- c04_adidas_samba_og_white: [[240] 아디다스 삼바 OG 화이트클라우드 신발 차정원 운동화 스니커즈](https://web.joongna.com/product/175160729) · [[240] 아디다스 삼바 OG 화이트클라우드 신발 운동화 스니커즈](https://web.joongna.com/product/229730555)
- c05_newbalance_574_grey: [뉴발란스 New Balance 574 그레이 회색 스니커즈 신발 남성28](https://web.joongna.com/product/233364038) · [뉴발란스 574 U574WR2 265](https://web.joongna.com/product/229605340)
- c07_levis_501_lightwash: [리바이스 501 청바지 버튼 워싱 데님 사이즈30 R8068](https://web.joongna.com/product/234234863)
- o02_fjallraven_greenland_winter_brown: [피엘라벤 그린란드 50주년 기념 자켓](https://web.joongna.com/product/233495893)
- o05_lacoste_l1212_polo_mint: [100 LACOSTE 라코스테 반팔 카라티 피케 셔츠 블루](https://web.joongna.com/product/231562475) · [남성 라코스테 5 사이즈 다크그린 PK 카라 폴로 반팔 셔츠 Lacost](https://web.joongna.com/product/233350696)
- a03_chanel_suit_early1960s_cream: (상위 8개 밖)
- k02_prospecs_white_leather_sneaker: (상위 8개 밖)
- n02_handknit_pastel_striped_pullover: [줄무늬 단가라 니트 스웨터 카키 분홍 아이보리](https://web.joongna.com/product/226055806) · [여성 스컬프터 스트라이프 오버핏 코튼 니트 F](https://web.joongna.com/product/224626301)
- g01_basic_vneck_tee_charcoal: [망사 V넥 반팔 티셔츠 블랙](https://web.joongna.com/product/214370377) · [에르메네질도 제냐 벨벳 V넥 반팔 티셔츠 네이비](https://web.joongna.com/product/223642285)
- g02_basic_blue_jeans_mens: [버커루 남성청바지34-36 빈티지 워싱진](https://web.joongna.com/product/232968239) · [남성의류 트루릴리젼 데님 청바지 2장--- 개당가격이에요](https://web.joongna.com/product/234025760)
- g03_hooded_windbreaker_lightgrey: [(M)컬럼비아남자방수지퍼블랙후드바람막이자켓](https://web.joongna.com/product/224707185)

### 여전히 못 찾은 이유

| 사례 | 못 찾은 이유 | 다음 |
|---|---|---|
| 버켄스탁 아리조나 · 쇼트 613 · 아크테릭스 알파 SV · 프로스펙스 스택스 · 휠라 플로트 맥시 | 중고나라 목록 제목에 모델명이 거의 없거나 매물이 적다. 쇼트는 브랜드 추정이 "Penrero"로 틀림 | 검색 API(카카오) 키로 쇼핑몰 상품 페이지까지 넓히기 · 브랜드 추정 별칭 보강 |
| 칼하트 덕 후드 재킷 | 3차에서 사진 분석이 옷 이름을 "카라트·헤드"로 잘못 읽음(1차에는 상위 5개 안) | 사진 분석 결과가 이상하면 제로샷 제품군으로 검색어를 다시 만들기 |
| 프레드페리 · 라코스테 | "폴로 셔츠" 검색에 랄프로렌 "폴로" 매물이 섞임. 프레드페리는 브랜드 추정 철자 오류("프레드 페르디") | "피케·카라티"로 바꾸기, 철자 오류 브랜드 맞추기(평가 후 과제 — 측정하지 않음) |
| 아카이브(Worth 1895 · Lucile 1925 · 샤넬 1960년대 · 폴로 사이클 재킷) | 시장에 같은 상품이 거의 없고, 사진 분석이 "카미즈"처럼 드문 이름을 써 검색 결과 0건(2건) | 결과가 0건이면 제품군만으로 넓혀 다시 찾기 |
| 색동저고리 · 노(能) 의상 | 한복·전통복 어휘가 없어 "무늬 조끼·꽃무늬 코트"로 찾음 | 전통복 어휘 추가 |
| 리바이스 501(3차) | 사진 분석이 이름을 비워 "슬림 바지"로만 찾음(정답 7위) | 제로샷 제품군(청바지)·모델 번호 읽기 보강 |

## 9. 남은 것 · 다음 개선

1. **검색 경로가 가장 큰 병목** — 실제로 돈 경로는 중고나라 1곳(그것도 법무 확인 전이라 로컬 실험 전용)이다. 무료 1순위는 **카카오(다음) 검색 API 키**(하루 3만 건). 키를 받으면 같은 26건으로 다시 잰다. 운영에 중고나라를 쓰려면 약관 제20조 2호 법무 확인이 먼저다.
2. Shopify Global Catalog는 키가 없지만 **에이전트 프로필을 공개 주소에 올려야** 해서(외부 게시) 사용자 결정 대기. 해외 브랜드·아카이브용.
3. 사진으로 찾기(같은 이미지가 실린 페이지)는 유료 경로(Google Vision Web Detection 월 1,000건 무료 후 .50/1,000건, 결제 계정 필요)만 있다. 사용자 사진을 외부로 보내는 일이라 승인 전에는 하지 않는다.
4. 사진 분석 품질: 실행마다 다른 답·드문 이름·색 잡음(흰 신발에 "레드")이 검색어를 흔든다. 같은 사진을 두 번 분석해 겹치는 말만 쓰거나, 제로샷 결과로 검색어를 보정한다.
5. 평가: 새 사례(평가셋 밖)로 다시 재기 · 사람이 대체 추천을 직접 평가 · 정답 규칙을 색·모델까지 보도록 엄격하게.
6. `query_stats`의 정답 표시(`markCorrect`)를 운영자 검수(공개한 후보)와 연결해 효과 낮은 검색어를 실제로 걸러 내기.
7. 휴대폰 시험 서버(로컬)는 이 브랜치 코드 + 중고나라 실험 경로 + MODA로 돌고 있다. 의뢰 #2 새 후보(부츠컷 청바지류)는 커브드 절개가 없고 여성 사이즈로 보이는 것이 섞여 공개하지 않았다.

## 부록 · 검색 경로 조사 출처(2026-11-22)

카카오 developers.kakao.com/docs/ko/daum-search/dev-guide · /docs/ko/getting-started/quota · 네이버 guide.ncloud-docs.com/docs/apihub-overview · Brave brave.com/search/api · Tavily tavily.com/pricing, docs.tavily.com · Exa exa.ai/pricing · Shopify shopify.dev/docs/agents/catalog, /global-catalog · Google Vision cloud.google.com/vision/pricing, /docs/detecting-web · eBay developer.ebay.com/api-docs/buy/static/buy-requirements.html · Bing learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement · 중고나라 web.joongna.com/robots.txt · Grailed grailed.com/about/terms · Awin awin.com/gb/compliance-and-regulations/application-process-and-joining-fee · CJ developers.cj.com/graphql/reference/Product%20Feed

## 실행 방법

```bash
# 1) 로컬 이미지 모델(walf-intelligence 저장소, 받아 둔 가중치만 — 인터넷 없이)
HF_HUB_OFFLINE=1 .venv/bin/python integration/brain_service.py --port 8790 --roots <WALF server/data/uploads>
# 2) WALF 서버(로컬 실험): 중고나라 자체 검색 + 이미지 모델
WALF_EXPERIMENT_SOURCES=joongna WALF_BRAIN_URL=http://127.0.0.1:8790 npm start
# 3) 평가(사진 분석에 무료 엔진 WALF_OSS_* 설정 필요) — 결과 폴더는 저장소 밖
node tools/search-eval.ts <cases.json> <결과 폴더>
node tools/search-eval-html.ts <결과 폴더>/results.jsonl <사례 폴더> <결과 폴더>/eval.html
```
