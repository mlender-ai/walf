# WALF V2 구조

- 작성: 2026-11-13 · 브랜치 `feat/walf-v2`(main `1b999b5` 기준)
- 기존 구조(Expo SDK 58 · Node 24 · Express 5 · 내장 SQLite · 운영자 어드민)를 그대로 쓰고 넓혔어요. Rust·새 프레임워크는 넣지 않았어요.

## 1. 두 축

```
            ┌──────────── 찾아줘(FIND) ────────────┐        ┌──────────── 기다려줘(WATCH) ────────────┐
 사진·링크 → │ AI 식별(제안) → 운영자 검수·공개      │        │ 상품 링크·이름 + 원하는 가격·사이즈     │
            │   MATCH · LIKELY · DISCOVER          │        │ 하루 1회 상품 페이지 가격·옵션 재고 확인 │
            │ 사용자 “이 옷이 맞아요” ──┬─ 7일 수배(기존) │        │ (AI 없음 · 같은 페이지는 1번만 읽음)    │
            │                       ├─ 기다려줘 등록 ─┼──────▶ │ 조건 충족 확인 → 알림(중복 없음)        │
            │                       └─ 저장만         │        │ 30일마다 계속할지 확인                  │
            └──────────────────────────────────────┘        └────────────────────────────────────────┘
                          └──────────────── 공통 상품(products) · 내가 찾는 옷 목록 ────────────────┘
```

- 찾아줘와 기다려줘는 **생명주기가 달라요.** 찾아줘는 기존 7일 정책(운영자 확인 전에는 기간이 흐르지 않음)을 그대로 쓰고, 기다려줘는 7일이 아니라 30일 단위로 계속할지 묻는 장기 감시예요.
- 두 기능의 옷은 앱 **추적함 → 내가 찾는 옷** 한 목록에서 함께 보여요(`GET /api/items`, `/api/me`의 `items`).

## 2. 데이터 모델

| 개념 | 표 | 비고 |
|---|---|---|
| Product | `products` | 상품 = 브랜드 + 모델명 + (알면) 품번 + (알면) 시즌. `canonical_key`=`브랜드\|모델#품번@시즌`(정규화). 품번·시즌이 다르면 이름이 같아도 다른 줄이고, 이름만 아는 상품과 품번 있는 상품은 합치지 않아요. 색상·사이즈는 상품이 아니라 Variant. `verified`=운영자 확인(MATCH) 또는 백필 시 운영자가 확인한 이름. `url`은 참고용이고 기다려줘가 이어받지 않아요 |
| Product Variant | `product_variants` | 사이즈·색상별. 가격·재고는 옵션 단위로 `price_observations`에 따로 남김 |
| Product Identity | `ai_identities`(AI 원본) → `product_identities`(공개본) | 공개본에 등급(match·likely·discover)·확인한 속성·확인 못 한 속성·근거 주소 |
| Style Tags | `brands` · `style_tags` | 브랜드 전체 또는 라인·시즌·제품군 단위(`scope`). 상태: verified(운영자 확인) · sourced(출처 있음·검수 전) · ai(사진에서 본 것) · fixture(테스트) |
| Listing | `listings`(상품 페이지) · `candidates`(7일 수배에서 운영자가 등록한 매물, 기존) | `listings.identity`: same_page(사용자·운영자가 준 그 페이지) · same_confirmed · unverified |
| Price Observation | `price_observations` | 확인 시각·판매처·옵션·판매가·표시 할인가·배송비(모르면 NULL)·재고·데이터 출처·성공/실패 |
| Find Request | `requests`(기존 표 그대로) | 상태·7일 정책·운영자 검수 그대로. `product_id` 컬럼만 더함 |
| Watch | `watches` · `watch_events` | needs_info · active · paused · renew_due · ended |
| Notification | `notifications`(기존) | `watch_id`·`dedupe_key` 컬럼 추가, (사용자, 열쇠) 고유 → 같은 알림 두 번 안 만듦 |
| 가격 조회 작업 | `price_checks` | (대상 페이지, 시간 창) 고유 → 재시작해도 같은 날 같은 페이지를 두 번 안 읽음 |
| 운영 설정 | `settings` | 월 추가 예산 승인 등. 키·비밀번호는 넣지 않음 |

### 마이그레이션(`server/src/db.ts`)
- `PRAGMA user_version` 0 → 2. **파일 DB를 처음 올릴 때 `VACUUM INTO`로 사본을 먼저 남겨요**(`data/backups/walf-v0-<시각>.db`, `WALF_BACKUPS`).
- 기존 표는 지우거나 바꾸지 않고 새 표·새 컬럼만 더해요(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`).
- 기존 의뢰마다 상품 한 줄을 채워요(운영자가 확인한 이름이면 verified=1, 아니면 0). 의뢰 원래 값은 그대로.
- 검증: `server/test/v2-sources.test.ts` “V1 DB를 V2로 올리면…”(V1 스키마 파일로 실제 업그레이드·사본·재실행 시 사본 중복 없음).

## 3. 찾아줘

### 등급 규칙(`server/src/find.ts` `tierOf`) — 모델이 말한 등급을 그대로 믿지 않아요
- **MATCH**: 신뢰도 high + 브랜드·모델 있음 + 실제로 본 근거 주소 1개 이상 + 브랜드·모델이 “확인 못 함”에 없음.
  - 운영자 공개(`publishFind`)는 **서버 판정이 상한**이에요. 서버 판정이 MATCH이고 운영자가 브랜드·상품명을 고치지 않았을 때만 그대로 MATCH로 공개돼요.
  - LIKELY·숨김을 MATCH로 올리거나 이름·브랜드를 고치면, 운영자가 **직접 확인한 상품 페이지 주소 + 확인 사유(10자 이상, 무엇이 같은지)**를 적어야 해요(`verify_url`·`verify_reason`에 남고, 사용자 화면 첫 근거·“왈프 팀 확인”으로 보여요). 근거 주소가 있다는 것만으로는 같은 상품 검증이 아니에요.
- **LIKELY**: 그 밖의 high·medium(최대 3개). 확인한 것과 확인 못 한 것을 나눠 보여요.
- **숨김**: low — 운영자만 봐요.
- **DISCOVER**: MATCH가 없을 때만. 사진에서 본 스타일(통제 어휘)과 브랜드 매핑이 **두 종류 이상** 겹치는 브랜드를 점수순으로(무드 3 · 제품군 2 · 소재 2 · 실루엣 1 · 디테일 1 · 색 0.5). “같은 상품 아님”으로 표시하고, 구매 가능 확정과는 별개 정책이에요.
  - **지금은 브랜드(또는 라인·시즌) 단위 추천뿐이에요. 실제로 판매 중인 비슷한 상품 큐레이션은 구현하지 않았어요.** 앱에도 “브랜드 추천이에요. 지금 판매 중인 비슷한 상품은 아직 골라 드리지 못해요”로 보여요.
  - 붙일 자리: `catalog.ts`의 `SimilarProductProvider`(입력: 사진 스타일·사진·후보 브랜드·제외 브랜드 / 출력: 판매처·주소·가격·이유, `verified: false`). 별도로 연구 중인 패션 브레인을 이 인터페이스로 연결하고, 돌려준 상품은 운영자 검수 전까지 공개하지 않아요. 현재 상태 `PENDING_INTEGRATION`(앱 `similarProducts.status`).
- AI가 응답 안에서 실제로 보지 않은 근거 주소는 버리고, 버렸다는 사실을 “확인 못 함”에 남겨요(`cleanIdentify`).

### 흐름
1. 접수(`requests.status=submitted`) → AI 식별 작업(기존 대기열) → `ai_identities` + 사진 스타일(`style_tags` subject=request)
2. 운영자: 어드민 의뢰 상세 **찾아줘 결과 공개**에서 등급을 고르고 공개 → `product_identities(status=published)` + 알림
3. 사용자: 앱 **찾아줘 결과** → “이 옷이 맞아요” → `products` 저장 →
   - 7일 동안 매물 찾기: 기존 `activate` → 7일 수배(기존 화면 그대로)
   - 원하는 가격 기다리기 / 저장만: 찾아줘는 `completed`(end_reason `find_watch`·`find_save`)로 끝나고 7일은 시작하지 않아요
   - “찾던 옷이 아니에요”: 공개본을 거두고 어드민 대기열 “사용자가 아니라고 함”에 다시 올라와요
4. 운영자가 결과 공개 없이 바로 확정하는 기존 경로(“이 상품으로 확정 → 7일 탐색 시작”)도 그대로예요.

## 4. 기다려줘

### 등록(`server/src/watch.ts` `createWatch`)
- 필수: 상품명 또는 상품 링크 + 원하는 가격. 선택: 브랜드·사이즈·색상·새 상품만·사진.
- 링크가 자동 확인 가능한 곳이면 `active`, 아니면 `needs_info`(사유를 사용자에게 보여 주고, 운영자가 어드민에서 상품 페이지를 연결).
- 정책(환경변수로 조절): 사용자당 활성 3개(`WALF_WATCH_MAX_ACTIVE`, 일시중지·종료는 제외) · 하루 1회(`WALF_WATCH_CHECK_HOURS`) · 30일마다 계속할지(`WALF_WATCH_RENEW_DAYS`) · 연속 3번 실패하면 “확인 불가”(`WALF_WATCH_UNREACHABLE_AFTER`).

### 가격 확인 엔진
- `tickWatches`: 확인할 때가 된 Watch의 페이지를 (페이지, 시간 창)마다 한 줄 대기열에 넣어요. 같은 날 다른 Watch가 이미 읽은 페이지면 다시 열지 않고 그 결과로 판정해요.
- `createChecker().step`: 대기열에서 하나를 **조건부 UPDATE로 임대**(lease 2분)해 처리. 일시 오류(시간 초과·연결)는 3번까지 재시도, robots·차단·404는 바로 실패로 기록. 서버가 꺼져 임대가 끝난 작업은 다음 tick에 다시 대기열로(페이지 읽기는 비용이 없어서).
- 판정(`evaluate`, 순수 함수) — **`met`은 같은 상품 페이지 · 원하는 사이즈 · 원하는 색 · 재고 있음 · 목표가 이하가 모두 확인될 때만**:
  - 사이즈 옵션 없음 → `size_missing` · 색 옵션 없음(또는 상품명 색이 다름) → `color_missing` · 품절 → `sold_out` · 다른 상품 페이지 → `mismatch`
  - 가격은 목표 이하지만 확인할 게 남음(알림 없음, 어드민 확인 대기열): 재고 미확인 `stock_unknown` · **배송비 미확인 `shipping_unknown`(“상품 가격은 충족, 배송비 미확인”)** · **색상 확인 못 함 `color_unknown`** · 같은 상품 페이지 미확인 `unverified` · 표시 할인가만 목표 이하 `sale_only`
  - 그 밖 `above`
- 목표가 비교는 기본이 **상품가+배송비 총액**이에요. 배송비를 모르면 `shipping_unknown`. 사용자가 “배송비 빼고 비교”를 고른 경우(`price_basis=item`)에만 상품가로 비교하고 알림에 “배송비 제외 기준”이라고 적어요. 운영자가 어드민에서 그 페이지의 배송비를 확인해 넣으면(`listings.shipping_fee`) 그 뒤로는 총액으로 판정해요.
- 색: 원하는 색을 정했으면 옵션의 색 값으로 확인하고, 옵션에 색이 없으면 **페이지 상품명에 적힌 색**으로만 확인해요. 둘 다 없으면 `color_unknown`(색 없는 옵션을 원하는 색으로 치지 않아요).
- **페이지 동일성(`watches.page_identity`)** — 사용자가 A 상품을 등록하고 B 상품 페이지를 연결해도 A의 알림이 나가지 않게, Watch마다 따로 판단해요:
  - `page_defined`: 링크만 주고 상품명을 따로 쓰지 않음 → 그 페이지가 곧 등록한 상품(이름도 페이지 상품명으로)
  - `matched`(자동): 찾아줘 상품의 품번이 페이지 상품명에 있음, 또는 상품명 핵심 단어 80% 이상이 페이지와 같음
  - `mismatch`(자동): 브랜드가 다름, 또는 페이지에 다른 품번이 있음
  - `unverified`: 그 밖(표기·언어 차이 등) → 운영자가 어드민에서 “같은 상품 페이지 맞음”(`operator_confirmed`) 또는 “다른 상품 — 페이지 떼기”(확인 요청으로 되돌림)
  - 알림은 `page_defined`·`matched`·`operator_confirmed`일 때만. 찾아줘 근거 주소(블로그·리뷰일 수 있음)는 상품 주소로 저장하지도, 기다려줘가 이어받지도 않아요(이번 등록에서 사용자가 준 링크만).
- `met`일 때만 “기다리던 가격이 됐어요” 알림. 조건이 깨지면 다시 걸리고(재입고·재하락), 같은 조건이 이어지는 동안은 다시 알리지 않아요(`alert_episode` + `dedupe_key`).
- 사이즈 정규화: 95=M, 100=L 등. 색: 블루그레이처럼 두 색이 붙은 이름은 네이비와 다른 색.

### 가격 소스(`server/src/sources.ts`)

| 상태 | 판매처 |
|---|---|
| SUPPORTED | 상품 페이지(카페24 `option_stock_data` · schema.org Product/Offer). robots.txt 허용·약관 차단 목록 밖, 하루 1회, 한 번에 하나씩 |
| UNSUPPORTED | 번개장터(약관 제39조 ⑦ 1호) · 솔드아웃·무신사(무신사 약관 제11조 ② 9호) · W컨셉(robots 전체 금지) |
| PENDING_INTEGRATION | 중고나라(약관 제20조 2호 법무 확인) · 후루츠패밀리(검색 주소·API 없음) · KREAM(약관 확인 못 함) · 29CM(약관 확인 전) |
| TEST_ONLY | `mock://fixture/<이름>` — `server/fixtures/watch-prices.json`, QA 설정에서만 |

- 안전장치: http(s)·기본 포트만, 로그인 정보가 든 주소 거부, DNS가 내부망을 가리키면 거부, 리다이렉트마다 다시 검사, 3MB·15초 제한(SSRF 방지). robots.txt가 404면 허용, 5xx·연결 실패면 확인 못 함 → 열지 않음.
- 카페24 재고와 구조화 데이터가 서로 다르게 말하면 “재고 확인 못 함”으로 둬요.

## 5. AI 제공자와 비용 가드레일

- `AiProvider`(`server/src/ai.ts`) 하나로 Claude·모의가 **같은 결과 형식**을 써요(식별: 후보·확인한/못 한 속성·근거·스타일 / 탐색: 판매처별 결과·매물). 모의 결과는 전부 “모의”로 저장·표시돼요. 테스트 사례는 `server/fixtures/find-mock.json`.
- 고르는 법: `WALF_AI_PROVIDER`(claude·mock·off) · `WALF_AI_MODEL` · `WALF_AI_EFFORT`.
- 유료 작업을 시작하기 전(`server/src/cost.ts` `canStart`):
  1. 의뢰별 호출 상한(`WALF_AI_MAX_CALLS_PER_REQUEST`) 2. 이번 달 추정 사용 + 이 작업 예상 비용 ≤ 월 예산(`WALF_AI_MONTHLY_BUDGET_USD` + 운영자 승인 추가분)
  - 넘으면 작업을 `held`로 멈추고 어드민 대기열·비용 화면에 띄워요. 운영자가 “확인하고 계속”하면 다시 대기열로.
- 같은 조건(브랜드·모델·색·사이즈·희망가·판매처)의 국내 탐색은 20시간 안이면 다시 부르지 않고 재사용(비용 0).
- 호출마다 토큰·검색 횟수·추정 비용(USD)을 `ai_jobs`에 남기고 어드민 **비용** 화면에서 월·의뢰·작업별로 봐요.
- 재시작: API를 부른 뒤 끊긴 유료 작업은 자동으로 다시 돌리지 않고 `interrupted`로 남겨요(중복 과금 방지). 운영자가 “다시 실행”.
- 가격 확인은 AI와 완전히 분리돼 있어요(별도 대기열·별도 작업자).

## 6. API(앱)

| 메서드 · 경로 | 설명 |
|---|---|
| `GET /api/me` | 기존 + `items`(내가 찾는 옷) · `watchLimit` |
| `GET /api/items` | 찾아줘 의뢰 + 기다려줘 통합 목록 |
| `GET /api/sources` | 판매처 자동 확인 범위(UNSUPPORTED·PENDING 사유 포함) |
| `GET /api/requests/:id/find` | 공개된 찾아줘 결과 |
| `POST /api/requests/:id/find/confirm` | `{identityId, next: hunt\|watch\|save}` |
| `POST /api/requests/:id/find/reject` | 찾던 옷이 아니에요 |
| `POST /api/watches` | 등록(JSON 또는 사진 포함 multipart) |
| `GET /api/watches/:id` · `PATCH /api/watches/:id` | 상세(가격 기록·기록) · 조건 변경 |
| `POST /api/watches/:id/pause\|resume\|renew\|end` | 상태 변경 |

- 쓰기 요청은 기기별 10분에 60회로 제한(429).
- 계정 삭제(`DELETE /api/me`)는 기다려줘·감시 기록·사진도 지워요. 상품 페이지 가격 기록은 개인 정보가 아니라 남아요.

## 7. 어드민

- 대기열: 기존 + “찾아줘 결과: 사용자가 아니라고 함” · “기다려줘 확인 필요” · “예산·상한으로 멈춘 AI 작업”
- 의뢰 상세: 기존 + **찾아줘 결과 공개**(등급 선택·이름 수정·DISCOVER 선택)
- **기다려줘**: 판매처 자동 확인 범위, 전체 Watch, 상품 페이지 연결, QA 가격 확인 버튼(`WALF_QA_TOOLS=1`)
- **비용**: 월 추정 사용·예산·멈춘 작업·추가 예산 승인·작업/의뢰별 표·가격 확인 횟수
- **스타일 매핑**: 출처·근거와 함께 보고 “확인”으로 verified 처리

## 8. 기존 구현과 부딪힌 곳 — 원인과 해결

| 부딪힌 곳 | 원인 | 해결 |
|---|---|---|
| 서버 재시작 시 AI 작업 자동 재실행 | 기존 `recoverAiJobs`는 끊긴 작업을 모두 다시 대기열로 → 이미 API를 불렀으면 중복 과금 | 아직 부르기 전(attempts=0)·모의 작업만 다시 대기열로. 유료로 이미 시작한 작업은 `interrupted` + 운영자 재실행. 기존 테스트(시작 전 작업)는 그대로 통과 |
| 사용자에게 AI 결과 공개 | MVP 정책은 “검수 전 비공개, 유사 상품 비공개” | 검수 전 비공개는 유지(운영자 공개 후에만). 유사 상품은 7일 수배 매물 후보로는 계속 비공개, DISCOVER는 “같은 상품 아님” 큐레이션으로 별도 공개 |
| 한 번에 한 벌 | 찾아줘를 끝내지 않으면 새 옷을 못 맡김 | 찾아줘 결과에서 기다려줘·저장을 고르면 찾아줘는 “찾음”으로 끝나 새로 맡길 수 있음. 기다려줘는 따로 3벌 |
| 중첩 트랜잭션 | V2 저장이 기존 트랜잭션 안에서 또 `tx`를 부름 | `tx`가 이미 트랜잭션 안이면 바깥에 합류 |
| 상태 이름 | 스펙 상태 목록(“제품 식별 중”) | `identification_pending` 표시 이름을 “상품 확인 중” → “제품 식별 중”으로(화면 문장은 그대로) |

## 9. PR #1 리뷰 반영(2026-11-13)

| 리뷰 항목 | 원인 | 해결 | 회귀 테스트 |
|---|---|---|---|
| P1-1 배송비 미확인인데 `met` | 배송비 NULL을 0으로 더함 | `shipping_unknown` 분리, 총액 확인 후에만 알림. “배송비 빼고 비교” 선택·운영자 배송비 확인만 예외 | `v2-watch` “[리뷰 1]”, E2E 배송비 단계 |
| P1-2 색 없는 옵션 통과 | `!o.color` 를 일치로 봄 | 상품명 색으로만 확인, 모르면 `color_unknown` | `v2-watch` “[리뷰 2]” |
| P1-3 다른 상품 가격이 섞임 | 근거 URL을 상품 URL로 저장·상속, 페이지를 무조건 `same_page` | 근거 URL 분리(상속 안 함), Watch별 페이지 동일성 판정·운영자 확인 | `v2-watch` “[리뷰 3]” 3건, E2E 다른 브랜드 페이지 단계 |
| P1-4 근거 URL만으로 MATCH 승격 | 운영자 MATCH 선택 시 URL 존재만 검사 | 서버 판정 상한, 승격·이름 수정 시 확인 페이지 주소+사유 필수 | `v2-find` “[리뷰 4]” 2건, E2E 거부 단계 |
| 품질: 상품 키 | 브랜드·이름만 | 품번·시즌 포함, 분리 기준 문서화 | `v2-find` “[품질] 상품 열쇠” |
| 품질: DISCOVER 범위 | 브랜드 추천을 상품 큐레이션으로 오해할 수 있음 | 문구·문서에 “브랜드 단위 추천” 명시, `SimilarProductProvider` 인터페이스(`PENDING_INTEGRATION`) | `v2-find` “[품질] DISCOVER” |

## 10. 파일 지도

| 파일 | 내용 |
|---|---|
| `server/src/db.ts` | 스키마 v2·마이그레이션·백업·`productKey`·설정 |
| `server/src/catalog.ts` | 상품·변형, 사이즈·색 정규화, 스타일 어휘·seed·큐레이션 |
| `server/src/find.ts` | 찾아줘 등급·공개·확인·거절 |
| `server/src/watch.ts` | 기다려줘 등록·정책·대기열·판정·알림·화면용 값 |
| `server/src/sources.ts` | 판매처 범위·SSRF 방지·robots·상품 페이지 해석·Fixture |
| `server/src/cost.ts` | 단가·추정 비용·예산·리포트 |
| `server/seed/brand-styles.json` | 브랜드 37개·태그(출처 있음, 검수 전) |
| `server/fixtures/*.json` | 모의 식별 사례·테스트 가격 시나리오·테스트 스타일 |
| `app/src/app/find/[id].tsx` · `watch/new.tsx` · `watch/[id].tsx` · `(tabs)/tracking.tsx` | 찾아줘 결과 · 기다려줘 등록 · 상세 · 내가 찾는 옷 |
