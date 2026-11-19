# WALF 평가 데이터 형식 — 추천 피드백 · 운영자 검수 기록

추천 엔진(패션 브레인)과 같은 상품 판정을 고치거나 평가할 때 쓰는 내보내기 형식이에요(V2.1 Gate D).

- 내보내기: 어드민 로그인 후 `GET /admin/export/feedback.json` · `GET /admin/export/reviews.json`
- 모의 데이터는 기본으로 빠져요. `?mock=1`을 붙이면 함께 나오고, 줄마다 `isMock`이 있어요.
- 응답 모양: `{ "exportedAt": "ISO 시각", "schema": "docs/WALF_EVAL_DATA.md", "count": n, "rows": [...] }` (파일 이름 `walf-<feedback|reviews>-<날짜>[-with-mock].json`)
- 시각은 모두 UTC ISO 8601이에요.

## 1. 개인 정보

- 사용자는 가명 `u_` + 12자리(서버 비밀값 `WALF_SECRET`으로 만든 HMAC)로만 나와요.
  - 같은 `WALF_SECRET`이면 같은 사용자는 같은 가명이에요.
  - 비밀값이 바뀌면 가명도 바뀌어요.
- 사진·메모·기기 ID·푸시 토큰은 넣지 않아요.
- 계정을 지우면 그 사용자의 피드백 줄은 지워져요. 검수 기록은 남지만 `requestId`·`watchId`가 `null`이 돼요.

## 2. 추천 피드백(`feedback.json` 의 `rows[]`)

원본 표: `offer_signals`. 사용자가 공개된 후보에 남긴 신호 한 건이 한 줄이에요. 기록은 고치지 않고 쌓기만 해요(마지막 줄이 현재 값).

| 필드 | 형식 | 뜻 |
|---|---|---|
| `type` | `"feedback"` | |
| `at` | ISO 시각 | 남긴 시각 |
| `user` | `u_xxxxxxxxxxxx` | 가명 |
| `signal` | 아래 표 | 신호 종류 |
| `explicit` | boolean | 사용자가 직접 평가했는지. 행동 기록은 `false` |
| `satisfaction` | `1` · `0` · `-1` · `null` | 만족 값. 직접 평가에만 있어요 |
| `context` | `"find"` · `"watch"` | 찾아줘 결과 / 기다려줘 상세 |
| `target.requestId` · `target.watchId` | 숫자 · null | 어느 찾아줘·기다려줘에서 |
| `target.productId` | 숫자 · null | 확인된 상품(products.id)이 있으면 |
| `target.priority` | 아래 선호 · null | 그때 고른 “무엇이 중요한지” |
| `item.offerId` | 숫자 · null | 후보 ID(후보가 지워지면 null) |
| `item.urlKey` | 문자열 | 상품 페이지 열쇠. 다시 골라도 같은 페이지면 같다 |
| `item.brand` · `item.name` | 문자열 | 그때의 브랜드·상품명 |
| `item.relation` | `"same"` · `"similar"` | 같은 상품 판매처 / 비슷한 디자인 |
| `item.publishTier` | `"exact"` · `"possible"` · `"alternative"` | 운영자가 공개한 등급 |
| `model.recommender` · `model.version` | 문자열 | 추천 엔진과 버전(예: 대체 상품 `walf-fixture-curator` · `fixture-1`, 판매처 탐색 `walf-rules` · `find-search-1`) |
| `model.ranker` | 문자열 · null | 정렬 규칙(예: `walf-design-rank-1:material_detail`) |
| `model.rank` | 숫자 | 그때 화면 순위(1부터) |
| `model.score` | 숫자 · null | 디자인 점수(0~1) |
| `isMock` | boolean | 모의 데이터 |

**신호 종류**

| `signal` | 앱 문구 | `explicit` | `satisfaction` |
|---|---|---|---|
| `like` | 마음에 들어요 | true | 1 |
| `not_quite` | 비슷하지만 원하는 느낌은 아니에요 | true | 0 |
| `not_interested` | 관심 없어요 | true | -1 |
| `cleared` | (되돌리기) | true | null |
| `open` | 판매 페이지 열기 | false | null |
| `save` · `unsave` | 저장 · 저장 해제 | false | null |

- 직접 평가(`like`·`not_quite`·`not_interested`)는 `relation="similar"`에만 남아요.
- **열기·저장을 만족으로 세지 마세요.** 그래서 `satisfaction`이 비어 있어요.
- 사용자의 현재 평가는 `(user, context, requestId|watchId, urlKey)`로 묶어 `explicit=true`인 마지막 줄을 보면 돼요. `cleared`면 평가 없음이에요.

**선호(`priority`)**: `silhouette` 실루엣 · `material_detail` 소재·디테일 · `brand_archive` 브랜드·아카이브 · `vibe` 비슷한 느낌이면 OK · `null` 고르지 않음

예시(모의):

```json
{ "type": "feedback", "at": "2026-11-19T05:12:03.000Z", "user": "u_3f9a1c0d2b7e", "signal": "like", "explicit": true, "satisfaction": 1,
  "context": "find", "target": { "requestId": 12, "watchId": null, "productId": null, "priority": "material_detail" },
  "item": { "offerId": 88, "urlKey": "fixture.test/p/wool-shacket-charcoal", "brand": "TEST STUDIO", "name": "울 셔켓 차콜", "relation": "similar", "publishTier": "alternative" },
  "model": { "recommender": "walf-fixture-curator", "version": "fixture-1", "ranker": "walf-design-rank-1:material_detail", "rank": 1, "score": 0.81 }, "isMock": true }
```

## 3. 운영자 검수 기록(`reviews.json` 의 `rows[]`)

원본 표: `review_log`. 운영자가 판단할 때마다 한 줄씩 남아요. 자동 판정(`auto`)과 운영자 결정(`decision`)을 나란히 둬요.

| 필드 | 형식 | 뜻 |
|---|---|---|
| `type` | `"review"` | |
| `at` | ISO 시각 | 결정 시각 |
| `operator` | 문자열 | 로그인 때 적은 운영자 이름 |
| `subject` · `subjectId` | 아래 표 · 숫자 | 무엇을 판단했는지 |
| `requestId` · `watchId` | 숫자 · null | 어느 찾아줘·기다려줘(계정 삭제 시 null) |
| `decision` | 아래 표 | 운영자 결정 |
| `auto` | 객체 · null | 결정 전 자동 판정 |
| `before` · `after` | 객체 · null | 운영자가 값을 고쳤을 때 고치기 전·후 |
| `reason` | 문자열 · null | 운영자가 적은 근거 |
| `isMock` | boolean | 모의 데이터 |

| `subject` | `decision` | `auto` 주요 필드 |
|---|---|---|
| `identity` 식별 결과 공개 | `match` 같은 옷 확인 · `likely` 유력 후보 · `skip` 공개 안 함 | `tier` 서버 판정 · `confidence` · `brand` · `name` · `modelCode` · `season` · `refs` 근거 수 · `uncertain` |
| `discover` 비슷한 스타일 브랜드 | `publish` | `brand` · `scope` · `score` · `reasons` · `status` |
| `offer` 판매처 후보·대체 상품 | `exact` 같은 상품 확인 · `possible` 같은 상품일 수 있음 · `alternative` 비슷한 디자인 · `reject` 제외 · `hide` 숨김 | `relation` · `verdict`(`same_code`·`likely`·`unverified`·`different`) · `checks`(`[항목, 결과]`, 항목 `model_code`·`brand`·`name`·`color`·`size`·`image`, 결과 `match`·`mismatch`·`unknown`·`not_checked`) · `score` · `rank` · `recommender` · `recommenderVersion` · `seller` · `name` · `url` · `price` · `shipping` · `similarPoints` · `diffPoints` · `targetRef`·`targetRank`(여러 식별 후보로 찾았을 때 어느 후보 기준인지) · 기다려줘면 `meetsWatch`와 `fit`(`state` `met`·`unmet`·`unknown` · `met`/`unmet`/`unknown` 조건 문장) |
| `watch_url` 상품 페이지 연결 | `attach` | — (`before.url` → `after.url`) |
| `watch_page` 페이지 동일성 | `page_same` · `page_diff` | `pageIdentity` · `note` · `url` · `title` |
| `shipping` 배송비 확인 | `shipping` | `url` (`before.fee` → `after.fee`) |

계정 이어받기 기록(`subject="account"`)은 보안 기록이라 내보내기에 넣지 않아요.

`identity`에서 운영자가 브랜드·이름을 고쳤으면 `before`·`after`에 `{brand, name}`이 들어가요. 고치지 않았으면 둘 다 `null`이에요.

**쓰는 예**

- **같은 상품 판정 정확도**: `subject="offer"` · `auto.relation="same"`인 줄에서 `auto.verdict`와 `decision`을 비교해요(예: `likely`인데 `exact`로 확인, `same_code`인데 `reject`).
- **식별 등급 보정**: `subject="identity"`에서 `auto.tier`와 `decision`이 다른 비율, `before`/`after`로 이름 수정 빈도
- **추천 품질**: `subject="offer"` · `decision="alternative"|"reject"`(운영자 기준)와 피드백의 `satisfaction`(사용자 기준)을 `urlKey` 또는 `offerId`로 이어 봐요.

예시(모의):

```json
{ "type": "review", "at": "2026-11-19T04:58:41.000Z", "operator": "운영자 QA봇", "subject": "offer", "subjectId": 3, "requestId": 12, "watchId": null,
  "decision": "exact", "auto": { "relation": "same", "verdict": "likely", "checks": [["model_code","unknown"],["brand","match"],["name","match"],["color","match"],["size","match"],["image","not_checked"]],
  "score": 0.92, "rank": 3, "recommender": "walf-rules", "recommenderVersion": "find-search-1", "seller": "테스트 편집숍", "price": 179000, "shipping": null },
  "before": null, "after": null, "reason": "로고 자수·소매 절개선·지퍼 위치가 공식몰 사진과 같음", "isMock": true }
```

## 4. 주의

- 지금 쌓이는 데이터는 대부분 **모의**예요. 실제 추천 엔진·판매처 연결 전이라, 이 데이터로 정확도를 말하면 안 돼요.
- 피드백은 아직 추천 순서에 쓰지 않아요. 수집·내보내기만 해요.
- 형식을 바꾸면 이 문서와 `server/src/feedback.ts`의 `exportFeedback`·`exportReviews`를 함께 고쳐요.
