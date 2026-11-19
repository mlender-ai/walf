# 주말 외부 설정 체크리스트 (WALF V2)

- 작성: 2026-11-13 · 브랜치 `feat/walf-v2`
- 가격·약관은 2026-11-13에 각 사 공식 페이지에서 확인했어요. 결제 화면에 표시되는 금액이 최종이에요.
- 키·비밀번호는 `server/.env`에만 넣어요. `.env`는 저장소에 올라가지 않아요.

## 먼저 결론: 이번 주말에 꼭 필요한 가입은 1개

| 항목 | 목적 | 우선순위 | 지금 필요한가 |
|---|---|---|---|
| Anthropic Console 계정·API 키 | 찾아줘 실제 이미지 식별·AI 탐색 | **필수** | **예** — 이것 없이는 찾아줘가 모의 AI로만 돌아요 |
| Anthropic 웹 검색 권한 | 실제 상품 페이지 검색 | 필수 확인 | 가입 아님 — 기본으로 켜져 있어요. 꺼져 있지 않은지만 확인 |
| Anthropic 사용 한도·예산 | API 과금 통제 | **필수** | 예 — 키를 만들 때 함께 설정 |
| 쇼핑몰별 공식 데이터 접근 | 기다려줘 가격·재고 감시 | 필수 조사 | 가입 아님 — 공식몰 상품 페이지는 지금도 동작. 중고 플랫폼은 법무·제휴 확인 |
| 추가 검색 API(Brave·SerpApi·Tavily) | 현재 검색으로 부족할 때 | 선택 | **아니요** — Claude 웹 검색으로 먼저 실측한 뒤 결정 |
| 서버 호스팅 계정·환경변수 | 외부 테스트 환경 배포 | 추후 | 아니요 — 보안 항목(진행 보고서 4장)을 먼저 정리 |
| Apple Developer 계정 | TestFlight·원격 푸시 | 추후 | 아니요 — 무료 Personal Team 케이블 설치로 QA 가능 |
| 도메인 구매 | 공개 서비스 주소 | 현재 불필요 | 아니요 |

**기다려줘는 가입 없이 동작해요.** 공식몰(카페24 등) 상품 페이지의 가격·옵션 재고를 직접 읽어요(robots.txt 허용·약관 차단 목록 밖일 때만).

---

## 1. Anthropic Console 계정·API 키 — 필수

| 항목 | 내용 |
|---|---|
| 서비스 | Anthropic Claude API |
| 가입·키 | https://platform.claude.com/ → Settings → API keys(https://platform.claude.com/settings/keys) |
| 필요한 인증·권한 | 조직 계정 로그인, 결제 수단 등록, 선불 크레딧 구매(API 사용 전에 필요, 1년 뒤 만료·환불 불가). 최소 구매액은 공식 페이지에 없어요 |
| 비용 | Opus 5.5 입력 $4 · 출력 $20 / 100만 토큰. Sonnet 5.5 $2 · $10. 웹 검색 1,000회당 $10(결과 토큰은 별도). 웹 페이지 열람은 토큰 비용만 |
| 쓰는 기능 | 찾아줘 식별(사진→브랜드·모델 후보·근거 주소·스타일), 7일 수배의 하루 1회 국내 판매처 탐색 |
| 환경변수 | `ANTHROPIC_API_KEY=sk-ant-...` · `WALF_AI_PROVIDER=`(비우거나 `claude`) · `WALF_AI_MODEL=claude-opus-5-5`(싸게: `claude-sonnet-5-5`) · `WALF_AI_EFFORT=high`(싸게: `medium`) |
| 연결 후 검증 | ① 서버 시작 로그에 `AI  Claude claude-opus-5-5 · 월 예산 $…` ② 앱에서 사진으로 찾아줘 1건 → 어드민 의뢰 상세 “AI가 먼저 살펴본 결과”가 완료되고 “찾아줘 결과 공개”에 후보가 뜨는지 ③ 어드민 **비용** 화면에 토큰·검색 횟수·추정 비용이 쌓이는지 ④ 실패하면 어드민에 사유만 남고 성공처럼 보이지 않는지 |
| 미설정 시 | `WALF_AI_PROVIDER=mock`(모의, 결과 전부 “모의” 표시) 또는 키 없이 운영자가 직접 확인 |
| 현재 상태 | `PENDING_EXTERNAL_SETUP` — 코드·요청 형식은 로컬 가짜 API로 검증(`server/test/claude.test.ts`), 실제 호출은 한 번도 안 함 |

## 2. Anthropic 웹 검색 권한 — 필수 확인

| 항목 | 내용 |
|---|---|
| 확인할 곳 | https://platform.claude.com/settings/capabilities |
| 필요한 권한 | 조직 관리자. 웹 검색·웹 열람은 **관리자가 끄지 않는 한 기본으로 켜져 있어요** |
| 비용 | 1번과 같음 |
| 쓰는 기능 | 찾아줘 식별의 근거 주소, 7일 수배의 판매처 탐색(도메인 제한 검색) |
| 환경변수 | 없음 |
| 연결 후 검증 | 어드민 의뢰 상세의 “검색 n회”가 0이 아닌지. 꺼져 있으면 어드민에 “조직 설정에서 웹 검색이 꺼져 있을 수 있어요”가 떠요 |
| 미설정 시 | 사진만 보고 판단 → 근거 주소가 없어 MATCH로 공개할 수 없어요(서버 규칙) |
| 현재 상태 | `PENDING_EXTERNAL_SETUP` |

## 3. Anthropic 사용 한도·예산 — 필수

| 항목 | 내용 |
|---|---|
| 설정할 곳 | 조직 지출 한도: https://platform.claude.com/settings/spend-limits · 워크스페이스별 한도(워크스페이스 화면) |
| 주의 | **기본 워크스페이스에는 지출 한도를 걸 수 없어요.** `walf` 워크스페이스를 새로 만들고, 그 안에서 키를 발급해 한도를 거는 걸 권해요. Start 티어의 월 상한은 $500이에요(사용 이력에 따라 자동으로 오름) |
| WALF 쪽 가드레일 | `WALF_AI_MONTHLY_BUDGET_USD`(기본 10) — 이번 달 추정 비용이 넘을 작업은 “보류”되고 어드민 **비용** 화면에서 운영자가 확인해야 계속돼요. `WALF_AI_MAX_CALLS_PER_REQUEST`(기본 10) |
| 권장값(첫 달) | Console 워크스페이스 한도 $20 · `WALF_AI_MONTHLY_BUDGET_USD=10`(비용 모델 문서 10명 시나리오 기준) |
| 연결 후 검증 | `WALF_AI_MONTHLY_BUDGET_USD=0.01`로 잠깐 켜고 찾아줘 1건 → 어드민 “예산·상한으로 멈춘 AI 작업”에 뜨는지, “확인하고 계속” 뒤 실행되는지 |
| 현재 상태 | WALF 쪽 가드레일은 구현·테스트 완료(`server/test/v2-cost.test.ts`). Console 한도는 `PENDING_EXTERNAL_SETUP` |

## 4. 쇼핑몰별 공식 데이터 접근 — 필수 조사(가입 아님)

| 판매처 | 지금 상태 | 근거 | 할 일 |
|---|---|---|---|
| 브랜드 공식몰(카페24) · schema.org 구조화 데이터가 있는 쇼핑몰 | **SUPPORTED** | 공개 상품 페이지만, 하루 1회, robots.txt 허용 시. 2026-11-13 배드블러드 페이지에서 옵션별 재고·정가·할인가를 일반 HTTP로 읽는 것 확인 | 없음. 브랜드마다 약관에 자동 수집 금지 조항이 생기면 차단 목록에 추가 |
| 번개장터 | UNSUPPORTED | 이용약관 제39조 ⑦ 1호(자동화 도구 수집 금지) | 공식 제휴·API 문의 |
| 솔드아웃 · 무신사 | UNSUPPORTED | 무신사 이용약관 제11조 ② 9호 | 공식 제휴 문의 |
| W컨셉 | UNSUPPORTED | robots.txt 일반 수집기 전체 금지 | — |
| 중고나라 | PENDING_INTEGRATION | 자체 검색 접근은 실험에서 확인. 약관 제20조 2호(얻은 정보의 제3자 제공) | **법무 확인** |
| 후루츠패밀리 | PENDING_INTEGRATION | 자체 검색을 주소로 열 수 없음, 공식 API 미확인 | 제휴·API 문의 |
| KREAM | PENDING_INTEGRATION | robots.txt·약관 확인 못 함(접속 오류) | 약관 재확인 |
| 29CM | PENDING_INTEGRATION | 약관 확인 전 | 약관 확인 |

- 환경변수: 없음. 차단 목록은 `server/src/sources.ts`의 `SOURCES`.
- 연결 후 검증: 어드민 **기다려줘 → 판매처 자동 확인 범위** 표와 앱 `GET /api/sources`.

## 5. 추가 검색 API — 선택(지금은 가입하지 않아도 돼요)

Claude 웹 검색으로 실제 정확도를 먼저 재고, 부족할 때만 가입해요. 연결 코드는 이번 V2에 넣지 않았어요(실험 브랜치 `experiment/opensource-hunt-7d`에 검증용 코드가 있음).

| 서비스 | 가입 | 무료 | 유료 | 카드 |
|---|---|---|---|---|
| Brave Search API | https://api-dashboard.search.brave.com/register | 매월 $5 크레딧(약 1,000회) | 1,000회당 $5 | FAQ에 “악용 방지로 카드를 받는다” — 필수 여부 문구 없음 |
| SerpApi(Google Lens 등) | https://serpapi.com/users/sign_up | 월 250회 | Starter 월 $25(1,000회) | 공식 문구 없음 |
| Tavily | 공식 사이트 | 월 1,000 크레딧 | 크레딧당 $0.008 | 불필요(공식 문구) |

- 현재 상태: `PENDING_EXTERNAL_SETUP`(선택). 미설정 시 대체 경로: Claude 웹 검색 + 공식몰 자체 검색.

### 5-1. 네이버 쇼핑 검색 API — 종료됨(가입하지 않아도 돼요)

- 네이버 개발자센터의 검색 > 쇼핑 API는 **2026-07-31에 종료**됐어요. 출처는 developers.naver.com/notice/article/32564이고, 2026-11-20에 원문을 확인했어요.
- 옮겨 간 NAVER API HUB의 검색 목록에도 쇼핑이 없어요.
- 그래서 키를 받아도 쓸 수 없어요. 코드에서는 `UNSUPPORTED`로 닫아 두었고, 화면에는 "서비스가 종료돼 찾을 수 없어요"라고 보여요.
- 국내외 대체 경로와 각 경로의 조건은 `docs/WALF_SOURCE_ACCESS_MATRIX.md`에 정리했어요.

### 5-2. 공식몰 목록 — 가입 아님(운영자 확인)

찾아줘 판매처 탐색은 `server/seed/official-malls.json`에 들어 있는 브랜드 국내 공식몰(카페24)만 자체 검색으로 열어요. 지금은 BADBLOOD 1곳이에요.

브랜드를 더할 때는 다음 세 가지를 먼저 확인하고 `basis`에 적어 주세요.

1. robots.txt가 `/product/`와 검색 페이지를 막지 않는지
2. 약관에 자동 수집 금지 조항이 없는지
3. 카페24 검색 주소 `https://{공식몰}/product/search.html?keyword=`가 열리는지

검색 결과로 공식몰을 추측해 넣지 않아요.

## 6. 서버 호스팅 — 추후

| 서비스 | 최소 구성(Node 상시 + SQLite 디스크) | 월 비용(공식 단가로 계산) |
|---|---|---|
| Fly.io | 256MB 머신 + 볼륨 1GB | 약 $2.34 → 월 $5 미만이면 청구 면제(개인 조직). 무료 티어 없음, 카드 필요 |
| Render | Starter 512MB + 디스크 1GB | 약 $7.25. 무료 플랜은 디스크 불가 |
| Railway | Hobby | $5(사용분 $5 포함), 볼륨 최대 5GB |

- 필요한 환경변수: `WALF_ADMIN_PASSWORD`(12자 이상) · `WALF_SECRET`(고정 값, 없으면 재시작마다 어드민 로그아웃) · `WALF_TRUST_PROXY=1`(HTTPS 프록시 뒤) · `WALF_QA_TOOLS=0` · `WALF_MOCK_SOURCES=0` · `WALF_DB` · `WALF_UPLOADS` · `WALF_BACKUPS` · 1·3번 AI 키·예산
- **배포 전에 진행 보고서 4장의 보안 항목(기기 ID 인증, 사진 접근 제어)을 먼저 정리해야 해요.** 지금 구조로 외부에 열면 안 돼요.
- 현재 상태: 로컬 실행만.

## 7. Apple Developer — 추후

| 항목 | 내용 |
|---|---|
| 가입 | https://developer.apple.com/programs/ (한국 App Store 표시 ₩129,000/년, 공식 USD $99/년) |
| 쓰는 기능 | TestFlight 배포, 원격 푸시(기다려줘 조건 충족 알림을 앱 밖에서 받기) |
| 환경변수 | 없음(Expo 빌드에서 Apple 로그인) — README 4장 순서 |
| 미설정 시 | 무료 Personal Team 케이블 설치(7일마다 재설치, 푸시 없음 → 앱 안 알림 탭으로 확인) |
| 참고 | Expo 무료 플랜은 iOS 빌드 월 15회, Expo 푸시는 무료 |

## 8. 도메인 — 현재 불필요

호스팅 업체가 주는 HTTPS 주소로 테스트할 수 있어요. 공개 출시 때 결정해요.

---

## 9. V2.1 코드 리뷰 후속 기준 — 아직 외부 설정이 필요한 것(PENDING_EXTERNAL_SETUP)
코드는 준비돼 있고, 키·계정·제휴가 생기면 켜지는 것들이에요. 키·유료 호출은 사용자가 직접 넣고, 무료 한도를 넘어도 유료로 자동 전환하지 않아요.

| 항목 | 지금 상태 | 필요한 것 | 누가 |
|---|---|---|---|
| `WALF_SECRET` 고정 값 | 비우면 재시작마다 로그인·사진 주소 만료 | 32자 이상 값을 server/.env 에 | 사용자 |
| 실제 판매처 늘리기 | 자동으로 찾는 실제 판매처는 BADBLOOD 공식몰 1곳뿐(결과 화면에도 표시) | 공식몰 목록 추가(5-2) · 판매처 제휴·허가(`docs/WALF_SOURCE_ACCESS_MATRIX.md`, 네이버 쇼핑 API는 종료) | 운영자(목록) · 사용자(제휴 결정) |
| 브랜드 한글·영문 별칭 | 별칭이 없으면 “배드블러드”와 “BADBLOOD”를 다른 브랜드로 봄(같은 상품 확정 안 함) | brands 시드의 `ko` 별칭 보강 | 운영자 |
| 사진 비교(같은 옷인지) | 연결 전 — 품번·브랜드·상품명으로만 판단 | 이미지 비교 모델·권리 확인 | Intelligence Lab |
| 패션 이미지 모델·상품 DNA 추천 | `SimilarProductProvider` 자리만 있음(`fashion-brain`, PENDING_INTEGRATION) | 추천 API 주소·키·응답 계약 | Intelligence Lab |
| HTTPS·외부 배포 | 막아 둠 | 호스팅·도메인·인증서 | 추후 |
| 링크 자동 확인 허용 목록 | BADBLOOD 공식몰 1곳(`server/seed/page-hosts.json` 비어 있음) — 목록 밖 링크는 왈프 팀이 직접 확인 | 판매처 약관(자동 접근·영리 이용)·robots.txt를 확인해 목록에 추가 | 운영자 |
| 환율(엔화 등) | 운영자 기록 함수만(`server/src/fx.ts` `recordFx`) — 환율이 없으면 외화 가격은 비교하지 않음 | 한국수출입은행 환율 API 인증키(하루 1,000회, 무료 여부는 페이지에 명시 없음) | 사용자(키) |
| Shopify Global Catalog | 연결 전 — 가입만으로 쓸 수 있는 유일한 공식 검색 경로(찾아줘 즉시 검색만) | 요금·한도, 기다려줘 주기 재조회 허용 여부 확인 후 연결 결정 | 사용자(결정) |
| eBay Partner Network · Yahoo!ショッピング 상업 이용 | 신청·협의 전 | 해외 아카이브·일본 중고 매물 | 사용자(신청) |

## 키를 넣은 뒤 실 API 테스트 순서(30분)

```bash
cd server
# .env 에 ANTHROPIC_API_KEY · WALF_AI_MONTHLY_BUDGET_USD=10 · WALF_AI_MAX_CALLS_PER_REQUEST=10 을 넣고
npm test && npm run e2e      # 키가 있어도 테스트는 모의로 돈다(실제 과금 없음)
npm start
```

1. 어드민 로그인 → **비용** 화면에 예산 $10이 보이는지
2. 앱에서 사진 한 장으로 찾아줘 → 어드민 의뢰 상세에서 AI 결과 확인 → MATCH/LIKELY 골라 **사용자에게 공개**
3. 앱에서 결과 확인 → “원하는 가격 기다리기” → 공식몰 상품 링크 넣기
4. 어드민 **기다려줘**에서 첫 가격 확인 결과(가격·옵션 재고) 확인
5. **비용** 화면에서 실제 토큰·검색 횟수로 추정 비용을 보고 `WALF_AI_MODEL`·`WALF_AI_EFFORT`를 정해요
