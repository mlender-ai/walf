# 부록 A · FreeLLMAPI 도입 검토 — WALF AI 비용 절감 후보

> 최종 결론은 [`../WALF_FREE_AI_REVIEW.md`](../WALF_FREE_AI_REVIEW.md)에 있다. 이 부록은 그 근거다.

- 대상: https://github.com/tashfeenahmed/freellmapi
- 검토일: 2026-11-20
- 방법: 공개 웹 자료(README·문서·소스 파일·라이선스·이슈·GitHub API·제공업체 공식 페이지)만 읽은 정적 검토. 클론·실행·가입·로그인·키 입력은 하지 않았고, 이미지나 개인정보는 어디에도 보내지 않았다.
- 기준 코드: `main` 브랜치. 검토 시점 마지막 커밋은 `dd0fb71`(2026-11-19)이다 [S5 · 2026-11-20][S5].
- 표기: `[S숫자 · 날짜]`는 출처 링크(클릭하면 URL)와 확인 날짜다. 전체 URL은 맨 아래 출처 목록에 있다. 확인하지 못한 내용은 **미확인**으로 적었다.
- 한계: 웹 페이지는 요약형 가져오기 도구로 읽었다. 숫자를 의사결정에 쓰기 전에 링크 원문을 한 번 더 확인하길 권한다. WALF 쪽 판단은 WALF 소스(`server/src/ai.ts`, `server/src/cost.ts`)와 FreeLLMAPI 소스를 대조한 결과이며, 실행해서 검증하지는 않았다.

---

## 결론

1. **WALF에 쓸 수 있는가:** 운영 경로에는 쓸 수 없다. 저장소가 스스로 "개인 실험·학습용이며 운영용이 아니다", "실제 서비스를 만들면 출시 전에 유료 API로 바꿔라"라고 밝힌다. 설계도 1인용·SLA 없음이다 [S3 · 2026-11-20][S3] [S35 · 2026-11-20][S35] [S12 · 2026-11-20][S12].
2. **어떤 작업에 쓸 수 있는가:** 사진과 개인정보가 없고 실패해도 되는 텍스트 작업에만 맞다. 내부 개발·실험(문구 초안, 테스트 데이터, 프롬프트 사전 실험)이 그 예다. WALF의 `identify`·`search`는 바꿔 끼울 수 없다. 이 둘은 `web_fetch`, `web_search`의 `user_location`, `strict` 도구, `refusal`/`pause_turn` 분기를 쓰는데 FreeLLMAPI는 이 기능을 지원하지 않거나 다르게 바꾼다 [S13 · 2026-11-20][S13] [S15 · 2026-11-20][S15] [W1 · 2026-11-20][W1].
3. **사용자 사진을 보내도 되는가:** 보내면 안 된다. 자동 라우팅으로 사진이 갈 수 있는 곳이 문제다. Gemini 무료 등급은 입력을 제품 개선에 쓰고 사람이 검토할 수 있으며 개인정보 제출을 금지한다. NVIDIA 체험판은 입력으로 AI 모델을 개선한다. Mistral 무료는 학습에 쓸 수 있다. 키 없이 쓰는 Kilo는 학습용으로 로그를 남긴다(FreeLLMAPI 문서 기준). 키가 필요 없는 제공업체는 새로 설치하면 자동으로 켜진다 [G1 · 2026-11-20][G1] [G2 · 2026-11-20][G2] [N1 · 2026-11-20][N1] [M1 · 2026-11-20][M1] [S32 · 2026-11-20][S32] [S26 · 2026-11-20][S26].
4. **상업 서비스에 쓸 수 있는가:** 이 구성으로는 쓰기 어렵다. 저장소가 운영 사용을 권하지 않는다. NVIDIA 체험판은 운영 사용을 금지한다. Groq은 요금을 피할 의도의 사용을, OpenRouter는 재판매와 경쟁 서비스를, Cerebras는 API 키 양도를 금지한다. 여러 무료 키를 묶어 유료 서비스의 백엔드로 쓰는 방식 자체가 약관과 충돌할 수 있다 [S3 · 2026-11-20][S3] [N1 · 2026-11-20][N1] [Q4 · 2026-11-20][Q4] [O3 · 2026-11-20][O3] [C2 · 2026-11-20][C2] [S35 · 2026-11-20][S35].
5. **운영 리스크:** 다섯 가지가 크다. ① 제공업체 계정이 정지된 실제 사례가 있다(#1210 Google AI Studio 키 정지, #1369, #1599). ② 한도가 소진되면 오후로 갈수록 작은 모델로 내려가고, 무료 설치판의 카탈로그는 약 30일 늦게 갱신된다. ③ 스트리밍 도중 실패하면 다른 모델로 넘기지 못한다. ④ 1인이 관리하고 릴리스가 매우 잦은데(3일에 3회) 보안 문서의 지원 버전 표기는 낡았다. ⑤ 응답의 `model` 필드에 실제 모델이 아니라 요청한 Claude 이름이 들어가 WALF 비용 집계가 틀어진다 [S10 · 2026-11-20][S10] [S11 · 2026-11-20][S11] [S35 · 2026-11-20][S35] [S1 · 2026-11-20][S1] [S30 · 2026-11-20][S30] [S7 · 2026-11-20][S7] [S12 · 2026-11-20][S12] [S13 · 2026-11-20][S13].

---

## 1. 무엇인가 — 구조, 동작 방식, 제공업체·모델

### 한 줄 정의
- 여러 LLM 제공업체의 무료 등급을 하나의 OpenAI 호환 `/v1` 엔드포인트로 묶는 **자가 호스팅 라우터**다 [S3 · 2026-11-20][S3].
- 저장소 설명 문구는 "10.1 billion tokens per month. 87 free LLM providers. 1,313 free model endpoints."이다 [S2 · 2026-11-20][S2].

### 구조
- `server/`는 라우터와 API(Node 20+), `client/`는 React 관리 대시보드, `desktop/`는 메뉴바·트레이 앱, `cli/`는 `npx freellmapi` 설정 도구다. 이 밖에 `shared/`, `docker/`, `docs/`가 있다 [S1 · 2026-11-20][S1].
- 모노레포 워크스페이스는 `shared`, `server`, `client`, `cli`이고, 엔진 조건은 `node >=20.18.0 <25.0.0`이다. WALF의 Node 24도 이 범위에 들어간다 [S28 · 2026-11-20][S28].
- 데이터는 Node 내장 `node:sqlite`(`DatabaseSync`)에 저장한다 [S29 · 2026-11-20][S29].
- 설치 방법은 `curl -fsSL https://freellmapi.co/install.sh | bash`(Docker), Docker Compose, 소스 실행, 데스크톱·모바일 앱이다 [S1 · 2026-11-20][S1].

### 동작 방식
- 앱은 `freellmapi-…` 통합 토큰 하나만 쓴다. 각 제공업체 키는 서버가 보관하고 요청마다 메모리에서 복호화한다 [S1 · 2026-11-20][S1].
- 요청마다 라우터가 후보 모델 사슬을 만든다. 한도에 걸리거나 오류가 나면 다음 후보로 넘어간다 [S1 · 2026-11-20][S1] [S30 · 2026-11-20][S30].
- 가상 모델 이름으로 `auto`, `auto:fast`, `auto:smart`, `auto:cheap`, `auto:reliable`, `auto:balanced`, `auto:<프로필명>`을 쓸 수 있고, 특정 모델 ID를 직접 지정할 수도 있다. `fusion`은 여러 모델의 답을 심판 모델이 합친다 [S34 · 2026-11-20][S34] [S1 · 2026-11-20][S1].
- 실제로 처리한 모델은 응답 헤더 `X-Routed-Via: <platform>/<model>`로 알려준다 [S1 · 2026-11-20][S1] [S13 · 2026-11-20][S13].
- 모델 카탈로그는 `api.freellmapi.co`에서 12시간마다 서명된 파일로 받는다. 무료 설치판은 월간 스냅샷이라 새 모델이 약 30일 늦게 들어온다. 프리미엄 키는 연 $19 또는 평생 $49이고 당일 갱신된다 [S24 · 2026-11-20][S24] [S1 · 2026-11-20][S1].

### 제공하는 엔드포인트
- OpenAI 호환: `/v1/chat/completions`, `/v1/responses`, `/v1/completions`, `/v1/images/generations`, `/v1/videos/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/embeddings`, `/v1/models` [S1 · 2026-11-20][S1]
- Anthropic 호환: `/v1/messages`, `/v1/messages/count_tokens`, 그리고 `anthropic-version` 헤더가 있을 때의 `/v1/models` [S13 · 2026-11-20][S13]
- Gemini 네이티브 `/v1beta`, Ollama 에뮬레이션(선택), MCP 서버 `/mcp` [S1 · 2026-11-20][S1]

### 지원 제공업체·모델
- README에 이름이 나온 제공업체는 Google, Groq, Cerebras, OpenCode Zen, Mistral, OpenRouter, Cloudflare, Cohere, Z.ai(Zhipu), NVIDIA, HuggingFace, ModelScope이고, "…and 75 more free providers"라고 덧붙인다 [S1 · 2026-11-20][S1].
- 카탈로그 구성은 chat 1,137, image 29, audio 41, embedding 68, transcription 19, video 6, decision 13이다 [S1 · 2026-11-20][S1].
- 지원 플랫폼 문서의 특이사항 [S32 · 2026-11-20][S32]:
  - SambaNova는 무료 등급이 없어져 퇴출됐다(V23).
  - Chutes는 평가했지만 잔액이 필요해 넣지 않았다.
  - Reka는 2026-09부터 신규 계정에 무료 등급이 없다.
  - OpenCode Zen 무료 모델은 2026-09부터 OpenCode 클라이언트 전용이다.
  - ModelScope는 중국 알리바바 클라우드 실명 계정이 필요하다.
  - GitHub Models는 이 문서에 없다.
- 키 없이 쓰는(keyless) 제공업체로 Kilo, OVH, AI Horde 등이 있다 [S26 · 2026-11-20][S26]. Kilo Gateway는 "prompts/outputs logged for training"으로 표기돼 있다 [S32 · 2026-11-20][S32].
- 모델별 전체 목록과 분당·일당 한도는 `freellmapi.co/models`의 개별 모델 페이지에 있다고 한다. 개별 페이지는 **미확인**이다 [S36 · 2026-11-20][S36].

---

## 2. 관리 상태

| 항목 | 값 | 출처 |
|---|---|---|
| 라이선스 | MIT, "Copyright (c) 2026 Tashfeen Ahmed". 라우터는 MIT이고 카탈로그 프리미엄만 유료다 | [S4 · 2026-11-20][S4] [S1 · 2026-11-20][S1] |
| 생성일 | 2026-04-21 | [S2 · 2026-11-20][S2] |
| 마지막 커밋 | `dd0fb71`, 2026-11-19T11:30:46Z, "Request concise summaries on the OVH summarization endpoint (#2010)" | [S5 · 2026-11-20][S5] |
| 마지막 push | 2026-11-19T11:30:52Z, 보관(archived) 아님 | [S2 · 2026-11-20][S2] |
| 커밋 수(main) | 1,131 | [S1 · 2026-11-20][S1] |
| 기여자 수 | 130명. GitHub API 기준이며 익명은 제외했다(1쪽 100명 + 2쪽 30명) | [S6 · 2026-11-20][S6] [S6b · 2026-11-20][S6b] |
| 기여 편중 | tashfeenahmed 662, suantea 109, tashdroid 85, 나머지는 소수다. 보안 문서도 "1인이 관리한다"고 밝힌다 | [S6 · 2026-11-20][S6] [S12 · 2026-11-20][S12] |
| 인기 | 스타 55,091, 포크 7,805 | [S2 · 2026-11-20][S2] |
| 열린 이슈 | 52건(이슈+PR, API 기준). 저장소 페이지 기준으로는 이슈 23, PR 29 | [S2 · 2026-11-20][S2] [S1 · 2026-11-20][S1] |
| 닫힌 이슈 | 593건 | [S9 · 2026-11-20][S9] |
| 최근 릴리스 | v0.16.36(2026-11-19), v0.16.34(2026-11-17), v0.16.33(2026-11-17) | [S7 · 2026-11-20][S7] |
| 보안 문서 | 보안 수정은 0.13.x에만 한다고 적혀 있다. 현재 릴리스 0.16.x와 맞지 않아 문서가 낡았다 | [S12 · 2026-11-20][S12] [S7 · 2026-11-20][S7] |

- 최근 열린 이슈에는 라벨이 없다. #1978 "Error 429", #1985 카탈로그 동기화 TLS 오류, #1995 `/mcp` 연결 불가, #1977 이미지 생성 실패 등이 열려 있다 [S8 · 2026-11-20][S8].
- 계정 정지 사례는 세 건이다.
  - #1210: 요청 폭주로 Google AI Studio 키 여러 개가 정지됐고 복구에 이틀이 걸렸다. 관리자는 "Google bans on burst traffic, not on the tool"이라고 답하며 Google 계정당 키 하나, RPM 상한, 재시도 지연을 권했다 [S10 · 2026-11-20][S10].
  - #1369: LLMTR 계정 정지 [S11 · 2026-11-20][S11]
  - #1599: 키 상태 점검기가 5분마다 빈 검색을 보내 SERP Search 계정이 정지됐다 [S11 · 2026-11-20][S11]

---

## 3. API 형식

### 3-1. OpenAI 호환인가, Anthropic 호환인가
- 둘 다 지원한다. 기본은 OpenAI 호환 `/v1`이다. `/v1/messages`는 "Anthropic's wire format"을 말하며, README는 Claude Code와 Anthropic SDK가 그대로 붙는다고 설명한다 [S3 · 2026-11-20][S3].
- 인증은 `x-api-key`와 `Authorization: Bearer`를 모두 받는다. 그래서 `new Anthropic({ baseURL, apiKey })`로 붙일 수 있다 [S34 · 2026-11-20][S34].
- 내부에서는 Anthropic 요청을 OpenAI 형식으로 바꿔 무료 모델에 보내고, 응답을 다시 Anthropic 형식으로 바꾼다 [S13 · 2026-11-20][S13].

### 3-2. WALF가 쓰는 기능과 FreeLLMAPI의 동작

WALF `server/src/ai.ts`는 다음을 쓴다 [W1 · 2026-11-20][W1].
- `client.beta.messages.create`
- `thinking: { type: 'adaptive' }`, `output_config: { effort }`
- `betas: ['server-side-fallback-2026-07-01']`, `fallbacks`
- `web_search_20260209`(`user_location: KR`, `allowed_domains`, `max_uses`)
- `web_fetch_20260209`(`allowed_domains`, `max_content_tokens`)
- `strict: true` 제출 도구
- base64 JPEG 사진
- `pause_turn`·`refusal`·`max_tokens` 분기, `res.model`로 비용 집계

| 기능 | FreeLLMAPI 동작 | WALF 영향 | 출처 |
|---|---|---|---|
| 모델 이름 | `claude-*` 계열은 기본으로 `auto`에 연결된다. 관리 화면에서 특정 모델로 고정할 수 있다 | Opus 대신 무료 모델이 답한다 | [S13 · 2026-11-20][S13] [S34 · 2026-11-20][S34] |
| 응답 `model` 필드 | 실제 모델이 아니라 **요청한 이름 그대로** 돌려준다(`model: requestedModel`) | `usage.model = res.model` → `cost.ts`가 무료 호출을 Claude 단가로 집계한다. 실제 모델은 `X-Routed-Via` 헤더로만 알 수 있다 | [S13 · 2026-11-20][S13] [W2 · 2026-11-20][W2] |
| 클라이언트 도구 | OpenAI `function`으로 바꾸며 `name`·`description`·`parameters`만 옮긴다. **`strict`는 버린다** | 제출 도구의 스키마 강제가 사라진다 | [S13 · 2026-11-20][S13] |
| `tool_choice` | `auto`→`auto`, `none`→`none`, `any`→`required`, `tool`→지정 함수. `disable_parallel_tool_use`는 `parallel_tool_calls:false`로 바꾼다 | WALF는 `tool_choice`를 쓰지 않는다 | [S13 · 2026-11-20][S13] |
| `tool_result` | `role:'tool'` 메시지로 바꾼다. **이미지는 버리고**, `is_error`는 읽지 않는다 | — | [S13 · 2026-11-20][S13] |
| 서버 도구 `web_search` | `^web_search_\d{8}$`에 맞는 첫 도구만 함수 도구로 흉내 낸다. **별도 검색 키**(tavily, exa, firecrawl, linkup, parallel, serpsearch, keenable, brave, outcrawl 중 하나)가 있어야 한다. `max_uses`는 지킨다. `allowed_domains`는 결과를 받은 뒤 걸러내고, 도메인이 5개 이하면 `site:`도 붙인다. **`user_location`은 지원하지 않는다.** 결과는 스니펫(1,200자)뿐이고 **citations는 만들지 않는다** | 검색어가 또 다른 외부 검색 업체로 간다. 한국 지역 검색 품질이 보장되지 않는다 | [S15 · 2026-11-20][S15] [S16 · 2026-11-20][S16] [S17 · 2026-11-20][S17] |
| 서버 도구 `web_fetch` | **처리하지 않는다.** `type`을 버리고 빈 스키마의 클라이언트 함수 도구 `web_fetch`로 바꾼다 | 모델이 `web_fetch`를 부르면 WALF에 `tool_use`가 돌아온다. WALF는 서버가 실행한다고 가정하고 `tool_result`를 보내지 않으므로 흐름이 깨질 가능성이 높다(코드 대조 결과, 실행 미검증) | [S13 · 2026-11-20][S13] [S15 · 2026-11-20][S15] [W1 · 2026-11-20][W1] |
| `thinking` | `reasoning_effort`로 바꾼다. 대화 이력의 `thinking` 블록은 버린다 | 추론 품질은 무료 모델에 달려 있다 | [S13 · 2026-11-20][S13] |
| `output_config`(effort·format), `output_format` | 해당 코드가 **없다**. 무시하는지 거부하는지는 **미확인** | effort 지정이 효과가 없을 가능성이 있다 | [S13 · 2026-11-20][S13] |
| `anthropic-beta` 헤더, `safeguards` | OpenAI 호환 제공업체로 전달하지 않는다 | `server-side-fallback` 베타가 동작하지 않는다. `fallbacks` 필드 처리는 **미확인** | [S13 · 2026-11-20][S13] [S34 · 2026-11-20][S34] |
| `stop_reason` | `tool_use`, `max_tokens`, `end_turn`만 나온다. `pause_turn`·`refusal`·`stop_sequence`는 나오지 않는다. `content_filter`는 `end_turn`으로 바뀐다 | WALF의 `refusal` 분기와 `pause_turn` 이어 하기가 동작하지 않는다 | [S13 · 2026-11-20][S13] |
| `usage` | `input_tokens`·`output_tokens`만 준다. 캐시 토큰은 없다. 검색을 흉내 낼 때는 `server_tool_use.web_search_requests`를 준다 | — | [S13 · 2026-11-20][S13] [S15 · 2026-11-20][S15] |
| `count_tokens` | 실제 토크나이저가 아니라 추정치다 | — | [S13 · 2026-11-20][S13] |
| `cache_control` | 업스트림에 전달하지 않는다(내부 압축의 경계로만 쓴다) | 프롬프트 캐시 할인 개념이 없다 | [S13 · 2026-11-20][S13] |
| 이미지 입력 | base64·URL 이미지 블록을 `image_url`로 바꾼다. 큰 이미지는 줄이고, 이미지 1장을 1,000토큰으로 추정한다. 비전 모델로만 보내며, 쓸 수 있는 비전 모델이 없으면 `422 no_vision_model`을 준다 | 형식상으로는 동작한다. 보내도 되는지는 4장과 결론 3을 보라 | [S13 · 2026-11-20][S13] [S34 · 2026-11-20][S34] |
| 문서(PDF 등) | `text`·`content` 소스는 본문에 넣는다. base64·URL 문서는 `400`을 준다 | — | [S13 · 2026-11-20][S13] [S34 · 2026-11-20][S34] |
| 스트리밍 | 지원한다. 도구 호출은 다 모은 뒤 `tool_use`로 보낸다. 바이트를 이미 보낸 뒤 실패하면 다른 모델로 넘기지 못한다 | WALF는 스트리밍을 쓰지 않는다 | [S13 · 2026-11-20][S13] [S30 · 2026-11-20][S30] |
| 오류 형식 | `{type:'error', error:{type, message}}`(Anthropic 형식) | SDK 예외 처리와 맞는다 | [S13 · 2026-11-20][S13] |
| Batches·Files API | 문서에 없다. **미확인** | — | [S34 · 2026-11-20][S34] |

### 3-3. 그대로 바꿔 끼울 수 있는가
- 텍스트와 일반 클라이언트 도구만 쓰는 호출은 `baseURL`만 바꿔서 붙일 수 있다 [S3 · 2026-11-20][S3] [S34 · 2026-11-20][S34].
- WALF의 `identify`·`search`는 그대로 바꿀 수 없다. 빠지는 기능은 다음과 같다.
  - `web_fetch` 서버 실행
  - `web_search`의 `user_location`과 citations, 그리고 Anthropic 자체 검색(별도 검색 업체 키가 필요하다)
  - 도구 `strict`
  - `output_config`
  - `anthropic-beta`(server-side fallback)
  - `pause_turn`·`refusal` 신호
  - 실제 모델명을 담은 `model` 필드
  - 캐시 토큰 집계

  근거: [S13 · 2026-11-20][S13] [S15 · 2026-11-20][S15] [S16 · 2026-11-20][S16]

---

## 4. 멀티모달 — 이미지 입력을 받는 무료 모델

### FreeLLMAPI 카탈로그 기준
`freellmapi.co/models`에서 vision 태그가 보인 모델이다. 페이지는 25개라고 표시했지만 읽힌 카드는 17개이고, 나머지는 **미확인**이다 [S36 · 2026-11-20][S36].
- GLM 5.3 Flash(zhipu 외)
- Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash, Gemini Flash(latest)(Google AI Studio)
- Qwen3.8 Flash, Qwen3.8 Omni Flash(xKiro), Qwen 3.8 27B(Cloudflare Workers AI 외)
- GPT-5.6 Luna(ElectronHub)
- Dots3 Note Preview
- Gemma 4 31B IT
- Moondream 3.1 9B A2B, Moondream 3 Preview
- Gemini 3.8 Live 계열(오디오)

### 제공업체 공식 문서 기준

| 제공업체 | 이미지 입력 무료 모델 | 조건 | 출처 |
|---|---|---|---|
| Groq | `qwen/qwen3.8-27b`(요청당 3장, 이미지당 2,048토큰), `meta-models/muse-spark-open`(제한 프리뷰) | URL 요청은 최대 20MB | [Q3 · 2026-11-20][Q3] |
| Cerebras | `qwen-3.8-27b` | 요청당 2장, 전체 10MiB | [C1 · 2026-11-20][C1] |
| Cloudflare Workers AI | Image-to-Text: `llava-1.5-7b-hf`, `moondream3.1-9B-A2B`. 설명상 이미지 입력: `llama-3.2-11b-vision-instruct`, `llama-4-scout-17b-16e-instruct`, `mistral-small-3.1-24b-instruct` 등 | 일일 무료 Neuron 한도 안에서 | [CF3 · 2026-11-20][CF3] [CF1 · 2026-11-20][CF1] |
| Google Gemini | 가격표의 Gemini 2.5 Flash-Lite 무료 입력 행에 "text, image, video"가 적혀 있다. 다른 Flash는 "멀티모달"이라고만 적혀 있다 | 무료 입력은 제품 개선에 쓰인다 | [G1 · 2026-11-20][G1] [G5 · 2026-11-20][G5] |
| Z.ai | `GLM-4.6V-Flash`(무료, 비전) | 한도 **미확인** | [Z1 · 2026-11-20][Z1] |
| Mistral | 비전 모델 `mistral-small-2506`, `ministral-*-2512` 등 | 무료 플랜에서 쓸 수 있는지 **미확인** | [M4 · 2026-11-20][M4] |
| Cohere | Chat Vision(체험 키 분당 20회) | 체험 키 월 1,000회 | [CO1 · 2026-11-20][CO1] |
| OpenRouter `:free` | 공식 무료 비전 모델 목록 **미확인** | — | — |

- 학습에 쓰지 않는다고 공식 문서가 밝히고 이미지도 받는 조합은 셋이다: Groq `qwen/qwen3.8-27b`, Cerebras `qwen-3.8-27b`, Cloudflare 비전 모델 [Q4 · 2026-11-20][Q4] [C2 · 2026-11-20][C2] [CF2 · 2026-11-20][CF2].
- 다만 FreeLLMAPI의 `auto`는 이 셋으로만 보내지 않는다. 사진을 쓰려면 모델을 고정하고, 키 없는 제공업체와 학습하는 제공업체를 모두 꺼야 한다. 설정만으로 그렇게 보장되는지는 **미확인**이다.

---

## 5. JSON 출력 — structured output / JSON 모드

- **OpenAI 경로(`/v1/chat/completions`):** `response_format`을 제공업체에 넘긴다. 그다음 응답이 JSON으로 파싱되는지 검사하고, 코드 펜스나 산문 속 가장 긴 `{…}`/`[…]`을 꺼내 고친다(healing). 그래도 안 되면 "모델이 형식을 무시했다"고 보고 다음 후보로 넘긴다. 스트리밍도 버퍼에 모아 같은 검사를 한다 [S18 · 2026-11-20][S18].
- **`json_schema` 스키마 검증은 하지 않는다.** 코드가 하는 일은 JSON 파싱 가능 여부 확인뿐이다 [S18 · 2026-11-20][S18].
- 일부 플랫폼은 `response_format`을 버린다(`platformDropsResponseFormat`). 라우터는 모델별 지원 여부를 기록한다 [S31 · 2026-11-20][S31].
- **Anthropic 경로(`/v1/messages`):** `output_format`·`output_config`·`json_schema`를 다루는 코드가 없다 [S13 · 2026-11-20][S13].
- **도구 기반 구조화 출력**(WALF 방식, 제출 도구):
  - `strict`는 버려진다 [S13 · 2026-11-20][S13].
  - 폴백 루프는 "invalid tool arguments"를 재시도 사유로 본다 [S30 · 2026-11-20][S30].
  - `server/src/lib/tool-validate.ts`가 있고 서버 의존성에 `ajv`가 있지만, 스키마를 얼마나 엄격하게 검증하는지는 **미확인**이다 [S27 · 2026-11-20][S27].

---

## 6. 한도·장애

### 무료 한도 관리
- 키마다 (플랫폼, 모델, 키) 단위로 RPM/RPD/TPM/TPD를 슬라이딩 윈도로 센다. 기록된 요청과 진행 중 요청의 합이 한도보다 작을 때만 받아들인다 [S33 · 2026-11-20][S33].
- 계정 단위로 한도를 매기는 제공업체는 공용 풀로 묶는다(예: `openrouter::free`, `groq::account`) [S33 · 2026-11-20][S33].
- 한도 숫자는 응답 헤더가 아니라 **카탈로그 값**에서 가져온다. 대기 시간은 `Retry-After`와 오류 본문에서 읽는다(최대 24시간) [S33 · 2026-11-20][S33].
- 같은 모델의 키는 모델별 커서로 **라운드로빈** 순서를 돈다. 통계가 쌓이면 신뢰도 0.75·속도 0.25 가중 Thompson 샘플링으로 고른다. `least-remaining`(남은 한도가 많은 키 먼저) 옵션도 있다 [S31 · 2026-11-20][S31].
- 전역 전략은 `priority`, `balanced`, `smartest`, `fastest`, `reliable`, `custom`, `decision`이다 [S31 · 2026-11-20][S31].
- 대화는 30분 동안 같은 모델에 붙여 둔다(sticky) [S1 · 2026-11-20][S1].

### 한도 초과·장애 때 동작
| 상황 | 동작 | 출처 |
|---|---|---|
| 429(분당) | 해당 모델+키를 90초 쉬게 한다. 반복되면 2분 → 10분 → 1시간 → 1일로 늘린다 | [S33 · 2026-11-20][S33] |
| 402 / 403 | 1일 쉬게 한다. 402는 해당 플랫폼의 모든 모델에서 그 키를 쉬게 한다 | [S33 · 2026-11-20][S33] [S30 · 2026-11-20][S30] |
| 401 | 그 키를 건너뛰고 다음 키로 돌린다. 다음 상태 점검(약 5분)까지 제외한다 | [S33 · 2026-11-20][S33] [S30 · 2026-11-20][S30] |
| 5xx·타임아웃·전송 오류 | 이번 요청에서 그 플랫폼 전체를 제외하고 다음 후보로 넘긴다 | [S30 · 2026-11-20][S30] |
| 재시도 상한 | 최대 20홉, 기본 시간 예산 45초 | [S30 · 2026-11-20][S30] |
| 모두 한도 초과 | `429 rate_limit_exceeded`와 `Retry-After` 헤더 | [S30 · 2026-11-20][S30] |
| 업스트림 실패가 섞임 | `502 upstream_failed` | [S30 · 2026-11-20][S30] |
| 차단기 작동 / 제공업체 없음 | `503 upstream_unhealthy` / `503 no_providers_configured` | [S30 · 2026-11-20][S30] |
| 스트리밍 도중 실패 | 이미 보낸 바이트가 있으면 다른 모델로 넘기지 못한다 | [S30 · 2026-11-20][S30] |

- 상위 모델은 일일 한도가 작다. 그래서 하루 중 늦은 시간일수록 작은 모델로 내려가고 품질이 떨어진다. 리셋은 UTC 자정이다 [S35 · 2026-11-20][S35].
- 무료 등급이 바뀌면 카탈로그가 갱신될 때까지 429나 인증 오류로 나타난다. 무료 설치판은 30일 주기로 갱신된다 [S35 · 2026-11-20][S35].
- Google은 한도를 **프로젝트 단위**로 적용한다. 한 프로젝트에서 키를 늘려도 한도는 늘지 않는다 [G3 · 2026-11-20][G3]. 같은 계정·IP의 병렬 키는 정지 위험이 있다고 관리자가 직접 경고했다 [S10 · 2026-11-20][S10].

---

## 7. 보안

### 키 저장
- 제공업체 키는 AES-256-GCM으로 암호화해 SQLite에 저장한다. 암호화할 때마다 16바이트 IV를 새로 만든다 [S19 · 2026-11-20][S19].
- 마스터 키는 환경변수 `ENCRYPTION_KEY`(64자리 hex)다.
  - 운영 모드에서 이 값이 없으면 시작하지 않는다.
  - 개발 모드에서는 DB와 같은 디렉터리에 `.encryption-key`를 자동으로 만든다(권한 0600). 데이터 폴더를 통째로 복사하면 키도 같이 복사된다.
  - 키 유도 함수(KDF)는 쓰지 않는다.

  근거: [S19 · 2026-11-20][S19]
- DB 파일 자체는 암호화하지 않는다(`new DatabaseSync(path)`, SQLCipher 없음) [S29 · 2026-11-20][S29].
- 대시보드 계정은 이메일과 비밀번호 하나다(scrypt). 다중 사용자 인증은 일부러 넣지 않았다. 기본으로 `127.0.0.1`에만 바인딩한다. 인터넷에 노출돼 남이 할당량을 쓰는 것은 보안 취약점으로 보지 않는다 [S12 · 2026-11-20][S12].

### 요청·응답 로그
- `requests` 테이블에는 platform, model, key_id, status, error, 지연 시간, 토큰 수, requested/served model, **클라이언트 IP·User-Agent**를 남긴다. 프롬프트·응답·이미지 본문은 남기지 않고, 본문 저장 옵션도 없다 [S20 · 2026-11-20][S20].
- 보관 기간 [S21 · 2026-11-20][S21]:
  - `requests`·검색 로그: 기본 90일, 최대 10만 행(환경변수로 바꿀 수 있다)
  - `server_logs`(warn·error): 7일
- 예외 1. 대시보드 Playground 대화는 프롬프트·응답·이미지 전체를 `playground_conversations`에 JSON으로 저장한다. 해당 파일과 보관 정리 코드에는 자동 만료가 보이지 않는다(대화당 2MB 상한만 있다) [S22 · 2026-11-20][S22] [S21 · 2026-11-20][S21].
- 예외 2. 응답 캐시는 기본으로 꺼져 있다. 켜면 완성된 응답 JSON 전체를 SQLite에 **평문**으로 저장한다(TTL 기본 3,600초). 요청 본문은 해시로만 남긴다 [S23 · 2026-11-20][S23].
- `/v1/messages` 경로는 요청·응답 본문을 로그에 남기지 않는다. 400 오류일 때는 검증 필드 경로만 남긴다 [S13 · 2026-11-20][S13].

### 외부 전송(텔레메트리)
- 카탈로그 동기화 [S24 · 2026-11-20][S24]:
  - `https://api.freellmapi.co/v1/latest`를 12시간마다 부른다. 부팅 10초 뒤 첫 호출을 한다.
  - 프리미엄 키가 있으면 `Authorization`에 담아 보내고, 쿼리는 `since` 하나다.
  - 이 파일에는 설치 ID, 사용 통계, 프롬프트 전송이 없다.
  - `CATALOG_SYNC_DISABLED=1`로 끌 수 있다. 카탈로그는 Ed25519 서명을 검증하지만 라이선스 응답은 검증하지 않는다.
- 업데이트 확인 [S25 · 2026-11-20][S25]:
  - GitHub API를 부르고 설치 커밋 SHA를 URL에 넣는다.
  - 자동 확인은 기본으로 꺼져 있고, `FREELLMAPI_UPDATE_CHECK=off`면 모든 확인을 끈다.
- Sentry·PostHog 같은 분석 SDK는 catalog-sync 파일에서 보이지 않았다. 전체 모듈의 외부 호출을 다 확인하지는 않았으므로 **미확인**이다 [S24 · 2026-11-20][S24].
- **키 없는 제공업체 자동 활성화:** 새로 설치하면 첫 카탈로그 동기화 뒤 키 없는 제공업체를 한 번 자동으로 켠다(무료 설치판은 30일 뒤). 이후 요청이 운영자가 키를 넣지 않은 곳으로도 갈 수 있다 [S26 · 2026-11-20][S26].
- **웹 검색 흉내:** 검색어가 Tavily·Exa·Brave 같은 별도 검색 업체로 간다 [S17 · 2026-11-20][S17].

### 의존성
- 서버 런타임 의존성(`@freellmapi/server` 0.2.1): `@freellmapi/shared`, `ajv ^8.20.0`, `compression ^1.8.0`, `cors ^2.8.5`, `dotenv ^17.4.2`, `express ^5.1.0`, `helmet ^8.1.0`, `multer ^2.2.0`, `sharp ^0.35.3`, `socks-proxy-agent ^10.0.0`, `undici ^6.21.0`, `zod ^4.6.7` [S27 · 2026-11-20][S27]
- 루트 devDependencies: `concurrently`, `jsdom` [S28 · 2026-11-20][S28]
- `sharp`(네이티브 이미지 라이브러리)는 이미지 축소에 쓴다(`image-normalize`) [S13 · 2026-11-20][S13].
- 설치 스크립트를 `curl | bash`로 실행하는 방식은 공급망 측면에서 확인할 점이다. 스크립트 내용은 **미확인**이다 [S1 · 2026-11-20][S1].

---

## 8. 제공업체별 무료 등급 조건표

> 기준: 각 제공업체의 공식 약관·가격·문서 페이지(확인 2026-11-20). 공식 페이지에서 확인하지 못한 칸은 **미확인**으로 두었다. 괄호 안의 "FreeLLMAPI 검토"는 저장소 자체 문서(2026-05 재검토)의 평가이며, 공식 근거가 아니다 [S35 · 2026-11-20][S35].
> Gemini의 "Used to improve our products: Yes"는 다시 확인했다. Gemini 3.8 Flash, 3.6 Flash, 3 Flash Preview, 2.5 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 2.5 Flash-Lite 모두 무료 등급은 **Yes**, 유료는 **No**다 [G1 · 2026-11-20][G1].

| 제공업체 | 무료 한도(분당·일당) | 상업적 이용 | 입력(이미지 포함)의 학습·제품 개선 사용 | 데이터 보관 | 이미지 입력 |
|---|---|---|---|---|---|
| **Google Gemini**(AI Studio 무료) | 프로젝트 단위로 적용하며 RPD는 태평양시 자정에 리셋된다 [G3 · 2026-11-20][G3]. 모델별 무료 수치는 AI Studio(로그인)에만 있어 **미확인** | 약관상 "professional or business purposes"용이고 소비자용이 아니다. 18세 이상만 쓸 수 있다. EEA·스위스·영국 사용자에게 제공하는 앱은 유료만 허용한다 [G2 · 2026-11-20][G2] (FreeLLMAPI 검토: Caution) | **사용한다.** 무료 등급은 "Used to improve our products: Yes" [G1 · 2026-11-20][G1]. 사람이 입력·출력을 읽을 수 있고, 민감·기밀·개인정보를 제출하지 말라고 한다 [G2 · 2026-11-20][G2] | 무료 등급 **미확인**. 유료는 "limited period" 로깅 [G2 · 2026-11-20][G2]. 결제 프로젝트의 로그 기능은 기본 최대 55일 [G4 · 2026-11-20][G4] | 된다(2.5 Flash-Lite 무료 입력에 image 명시) [G1 · 2026-11-20][G1] |
| **Groq** | 조직 단위. `qwen/qwen3.8-27b` 30 RPM·1K RPD·8K TPM·200K TPD, `openai/gpt-oss-120b` 30·1K·8K·200K. 표가 Free/Developer 중 어느 플랜의 값인지 페이지에 표시가 없다 [Q1 · 2026-11-20][Q1] | 고객 애플리케이션 통합과 최종 사용자 제공을 허용한다(§3.1). 재판매·계정 대여는 금지한다(§3.2, §6.3(c)). "요금 발생을 피할 의도의 사용"은 금지한다(§6.3(d)(iii)) [Q4 · 2026-11-20][Q4] | **사용하지 않는다.** 입력·출력으로 학습·미세조정할 수 없다(§4.2) [Q4 · 2026-11-20][Q4] | 기본 미보관. 신뢰성·남용 조사 때 최대 30일 보관한다. ZDR을 켤 수 있다. 미국 GCP에 저장한다 [Q2 · 2026-11-20][Q2] | 된다. `qwen/qwen3.8-27b` 요청당 3장 [Q3 · 2026-11-20][Q3] |
| **OpenRouter**(`:free` 모델) | 20 RPM. 누적 구매 크레딧이 10 미만이면 일 50회, 10 이상이면 일 1,000회 [O1 · 2026-11-20][O1] | 자기 제품에 통합할 수 있다(§5.1). 모델 API 재판매와 경쟁 서비스 개발은 금지한다(§7) [O3 · 2026-11-20][O3] | OpenRouter 자체는 학습에서 빠졌다. **일부 모델 제공자는 입력을 저장·학습할 수 있다**(§6.1). 학습하는 제공자로 보내지 않게 설정할 수 있다(무료·유료 별도) [O3 · 2026-11-20][O3] [O2 · 2026-11-20][O2] | 프롬프트 로깅을 켜지 않으면 분류 후 저장하지 않는다(§6.5). 제공자별 보관은 제공자 정책을 따른다 [O3 · 2026-11-20][O3] [O2 · 2026-11-20][O2] | 모델마다 다르다. 공식 무료 비전 목록은 **미확인** |
| **Mistral**(Studio 무료) | **미확인**(공식 한도 페이지 404) | 상업 약관(2026-09-25 시행)에 무료 플랜 조항이 없어 **미확인** [M3 · 2026-11-20][M3] (FreeLLMAPI 검토: personal·internal business 허용, Likely OK) | **사용할 수 있다.** 무료 모드 입력·출력을 학습에 쓸 수 있고 opt-out할 수 있다. Labs·Preview 모델은 opt-out 대상이 아니다 [M1 · 2026-11-20][M1] [M2 · 2026-11-20][M2] | **미확인** [M3 · 2026-11-20][M3] | 비전 모델은 있다. 무료 플랜 가용 여부는 **미확인** [M4 · 2026-11-20][M4] |
| **Cerebras** | 조직 단위. `qwen-3.8-27b` 300 RPM·150K uncached TPM(시간·일 토큰 상한 없음), `gpt-oss-120b` 5 RPM·1M TPD [C1 · 2026-11-20][C1] | "personal use or business purpose"로 쓸 수 있다. 일부 기능은 무료로 제공한다. API 키 매매·양도는 금지한다 [C2 · 2026-11-20][C2] | **사용하지 않는다.** Service Content로 학습·미세조정할 권리가 없다고 명시한다 [C2 · 2026-11-20][C2] | 추론 입력·출력을 보관하지 않는다. 다만 처리자 역할로 다루는 데이터는 이 방침의 범위 밖이라고 적혀 있다 [C3 · 2026-11-20][C3] | 된다. `qwen-3.8-27b` 요청당 2장·10MiB [C1 · 2026-11-20][C1] |
| **GitHub Models** | 해당 없음. 2026-07-30에 완전히 종료됐다 [GH1 · 2026-11-20][GH1] | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음. FreeLLMAPI 지원 문서에도 없다 [S32 · 2026-11-20][S32] |
| **Cloudflare Workers AI** | Free·Paid 플랜 모두 일 10,000 Neurons. 00:00 UTC에 리셋되고, 넘으면 리셋까지 오류가 난다 [CF1 · 2026-11-20][CF1] | Self-Serve Subscription Agreement를 적용한다 [CF2 · 2026-11-20][CF2]. 약관 원문은 **미확인** (FreeLLMAPI 검토: Ambiguous) | **사용하지 않는다.** Workers AI 고객 콘텐츠로 모델을 학습하지 않는다 [CF2 · 2026-11-20][CF2] | 요청 처리 후 보관하지 않는다. AI Gateway 로깅·캐시를 켜면 예외다. 운영 메타데이터는 보관할 수 있다 [CF2 · 2026-11-20][CF2] | 된다. `llava-1.5-7b-hf`, `llama-3.2-11b-vision-instruct` 등 [CF3 · 2026-11-20][CF3] |
| **NVIDIA NIM**(API Trial) | 공식 문서의 수치는 **미확인**. FreeLLMAPI 문서는 40 RPM이라고 적었다 [S35 · 2026-11-20][S35] | **운영 사용을 금지한다.** "limited trial purposes only", production 사용 불가(§1.2). 구독 없이는 내부 테스트·평가만 할 수 있다(§1.4) [N1 · 2026-11-20][N1] | **사용한다.** User Content·Generated Content를 NVIDIA 제품과 AI 모델 개선에 쓴다(§3.3). 보안·남용 모니터링 로그를 제3자와 공유한다 [N1 · 2026-11-20][N1] | **미확인** | **미확인** |
| **Cohere**(체험 키, 참고) | 월 1,000회. Chat(Vision 포함) 분당 20회 [CO1 · 2026-11-20][CO1] | 사업용 설계이며 개인·가정 용도를 금지한다. 허가 없이 Cohere 솔루션 자체를 상업적으로 활용("commercially exploit")하는 것은 금지한다(§14). 체험 키로 운영해도 되는지는 **미확인** [CO2 · 2026-11-20][CO2] (FreeLLMAPI 검토: Avoid) | 고객 데이터로 솔루션을 개선하고 제3자와 공유할 수 있는 라이선스가 있다(§4.1) [CO2 · 2026-11-20][CO2] | **미확인** | Chat Vision 모델이 있다 [CO1 · 2026-11-20][CO1] |
| **Z.ai**(참고) | **미확인** | **미확인** (FreeLLMAPI 검토: Caution, 트래픽 우회 금지 조항) | **미확인** | **미확인** | 무료 `GLM-4.6V-Flash` [Z1 · 2026-11-20][Z1] |
| **Hugging Face**(참고) | 공식 가격표상 무료 사용자의 월 크레딧은 "None"이고 PRO는 $2.00이다 [HF1 · 2026-11-20][HF1]. FreeLLMAPI 문서의 "$0.10/mo"와 **맞지 않는다** [S32 · 2026-11-20][S32] | **미확인** | **미확인** | **미확인** | **미확인** |
| **키 없는 제공업체**(Kilo·OVH·AI Horde, 참고) | OVH는 IP·모델당 분당 2회. AI Horde는 공용 큐 최하위 우선순위다. 모두 FreeLLMAPI 문서 기준이며 공식 출처는 **미확인**이다 [S35 · 2026-11-20][S35] | **미확인** | Kilo는 "prompts/outputs logged for training"(FreeLLMAPI 문서 기준) [S32 · 2026-11-20][S32] | **미확인** | **미확인** |

---

## 출처 목록 (모두 2026-11-20 확인)

**FreeLLMAPI 저장소·서비스**

[S1]: https://github.com/tashfeenahmed/freellmapi
[S2]: https://api.github.com/repos/tashfeenahmed/freellmapi
[S3]: https://github.com/tashfeenahmed/freellmapi/blob/main/README.md
[S4]: https://github.com/tashfeenahmed/freellmapi/blob/main/LICENSE
[S5]: https://api.github.com/repos/tashfeenahmed/freellmapi/commits?per_page=5
[S6]: https://api.github.com/repos/tashfeenahmed/freellmapi/contributors?per_page=100
[S6b]: https://api.github.com/repos/tashfeenahmed/freellmapi/contributors?per_page=100&page=2
[S7]: https://api.github.com/repos/tashfeenahmed/freellmapi/releases?per_page=3
[S8]: https://api.github.com/repos/tashfeenahmed/freellmapi/issues?state=open&per_page=60
[S9]: https://api.github.com/search/issues?q=repo:tashfeenahmed/freellmapi+type:issue+state:closed&per_page=1
[S10]: https://github.com/tashfeenahmed/freellmapi/issues/1210
[S11]: https://api.github.com/search/issues?q=repo:tashfeenahmed/freellmapi+type:issue+ban+OR+suspended+OR+terms&per_page=30
[S12]: https://github.com/tashfeenahmed/freellmapi/blob/main/SECURITY.md
[S13]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/routes/anthropic.ts
[S14]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/anthropic-map.ts
[S15]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/anthropic-web-search.ts
[S16]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/web-search-tool.ts
[S17]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/search-platforms.ts
[S18]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/structured-output.ts
[S19]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/crypto.ts
[S20]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/request-log.ts
[S21]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/request-retention.ts
[S22]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/routes/conversations.ts
[S23]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/cache.ts
[S24]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/catalog-sync.ts
[S25]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/routes/update.ts
[S26]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/keyless-defaults.ts
[S27]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/package.json
[S28]: https://github.com/tashfeenahmed/freellmapi/blob/main/package.json
[S29]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/db/node-sqlite.ts
[S30]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/fallback-loop.ts
[S31]: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/router.ts
[S32]: https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/providers/01-supported-platforms.md
[S33]: https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/providers/02-quotas-and-cooldowns.md
[S34]: https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/api/01-rest-api.md
[S35]: https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/architecture/00-high-level-index.md
[S36]: https://freellmapi.co/models

- S1 https://github.com/tashfeenahmed/freellmapi
- S2 https://api.github.com/repos/tashfeenahmed/freellmapi
- S3 https://github.com/tashfeenahmed/freellmapi/blob/main/README.md
- S4 https://github.com/tashfeenahmed/freellmapi/blob/main/LICENSE
- S5 https://api.github.com/repos/tashfeenahmed/freellmapi/commits?per_page=5
- S6 / S6b https://api.github.com/repos/tashfeenahmed/freellmapi/contributors?per_page=100 (page=1, page=2)
- S7 https://api.github.com/repos/tashfeenahmed/freellmapi/releases?per_page=3
- S8 https://api.github.com/repos/tashfeenahmed/freellmapi/issues?state=open&per_page=60
- S9 https://api.github.com/search/issues?q=repo:tashfeenahmed/freellmapi+type:issue+state:closed&per_page=1
- S10 https://github.com/tashfeenahmed/freellmapi/issues/1210
- S11 https://api.github.com/search/issues?q=repo:tashfeenahmed/freellmapi+type:issue+ban+OR+suspended+OR+terms&per_page=30
- S12 https://github.com/tashfeenahmed/freellmapi/blob/main/SECURITY.md
- S13 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/routes/anthropic.ts
- S14 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/anthropic-map.ts (Claude 모델명 라우팅만 담당한다. 변환 코드는 S13에 있다)
- S15 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/anthropic-web-search.ts
- S16 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/web-search-tool.ts
- S17 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/search-platforms.ts
- S18 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/structured-output.ts
- S19 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/crypto.ts
- S20 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/request-log.ts
- S21 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/request-retention.ts
- S22 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/routes/conversations.ts
- S23 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/cache.ts
- S24 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/catalog-sync.ts
- S25 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/routes/update.ts
- S26 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/keyless-defaults.ts
- S27 https://github.com/tashfeenahmed/freellmapi/blob/main/server/package.json
- S28 https://github.com/tashfeenahmed/freellmapi/blob/main/package.json
- S29 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/db/node-sqlite.ts
- S30 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/lib/fallback-loop.ts
- S31 https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/router.ts
- S32 https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/providers/01-supported-platforms.md
- S33 https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/providers/02-quotas-and-cooldowns.md
- S34 https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/api/01-rest-api.md
- S35 https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/architecture/00-high-level-index.md
- S36 https://freellmapi.co/models

> 소스 파일은 `raw.githubusercontent.com/tashfeenahmed/freellmapi/main/…` 원본으로 읽었다. 위 링크는 같은 파일의 GitHub 보기 주소다.

**WALF 소스(로컬, 대조용)**

[W1]: ../../server/src/ai.ts
[W2]: ../../server/src/cost.ts

- W1 `server/src/ai.ts`(168~245행: `claudeProvider`, `identify`, `search`)
- W2 `server/src/cost.ts`(10~17행: 모델명별 단가)

**제공업체 공식 페이지**

[G1]: https://aistudio.google.com/docs/pricing
[G2]: https://aistudio.google.com/docs/terms
[G3]: https://aistudio.google.com/docs/rate-limits
[G4]: https://aistudio.google.com/docs/logs-policy
[G5]: https://aistudio.google.com/docs/models
[Q1]: https://console.groq.com/docs/rate-limits
[Q2]: https://console.groq.com/docs/your-data
[Q3]: https://console.groq.com/docs/vision
[Q4]: https://console.groq.com/docs/legal/services-agreement
[O1]: https://openrouter.ai/docs/api-reference/limits
[O2]: https://openrouter.ai/docs/features/privacy-and-logging
[O3]: https://openrouter.ai/terms
[M1]: https://help.mistral.ai/en/articles/323757-do-you-use-my-user-data-to-train-your-artificial-intelligence-models
[M2]: https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training
[M3]: https://legal.mistral.ai/terms/commercial-terms-of-service
[M4]: https://docs.mistral.ai/capabilities/vision/
[C1]: https://inference-docs.cerebras.ai/support/rate-limits
[C2]: https://www.cerebras.ai/terms-of-service
[C3]: https://www.cerebras.ai/privacy-policy
[GH1]: https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models
[CF1]: https://developers.cloudflare.com/workers-ai/platform/pricing/
[CF2]: https://developers.cloudflare.com/workers-ai/platform/data-usage/
[CF3]: https://developers.cloudflare.com/workers-ai/models/
[N1]: https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf
[CO1]: https://docs.cohere.com/docs/rate-limits
[CO2]: https://cohere.com/terms-of-use
[Z1]: https://docs.z.ai/guides/overview/pricing
[HF1]: https://huggingface.co/docs/inference-providers/pricing

- G1 https://aistudio.google.com/docs/pricing (`ai.google.dev/gemini-api/docs/pricing`에서 301로 넘어옴)
- G2 https://aistudio.google.com/docs/terms ("Effective March 23, 2026")
- G3 https://aistudio.google.com/docs/rate-limits
- G4 https://aistudio.google.com/docs/logs-policy
- G5 https://aistudio.google.com/docs/models
- Q1 https://console.groq.com/docs/rate-limits
- Q2 https://console.groq.com/docs/your-data
- Q3 https://console.groq.com/docs/vision
- Q4 https://console.groq.com/docs/legal/services-agreement ("Last Modified: June 22, 2026")
- O1 https://openrouter.ai/docs/api-reference/limits
- O2 https://openrouter.ai/docs/features/privacy-and-logging
- O3 https://openrouter.ai/terms ("Last Updated: August 31, 2026")
- M1 https://help.mistral.ai/en/articles/323757-do-you-use-my-user-data-to-train-your-artificial-intelligence-models
- M2 https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training
- M3 https://legal.mistral.ai/terms/commercial-terms-of-service ("Effective: September 25, 2026")
- M4 https://docs.mistral.ai/capabilities/vision/
- C1 https://inference-docs.cerebras.ai/support/rate-limits
- C2 https://www.cerebras.ai/terms-of-service ("Effective August 27, 2024", 웹사이트 이용약관이며 API 포함)
- C3 https://www.cerebras.ai/privacy-policy
- GH1 https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models
- CF1 https://developers.cloudflare.com/workers-ai/platform/pricing/
- CF2 https://developers.cloudflare.com/workers-ai/platform/data-usage/
- CF3 https://developers.cloudflare.com/workers-ai/models/
- N1 https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf (문서 버전 "v. September 19, 2025")
- CO1 https://docs.cohere.com/docs/rate-limits
- CO2 https://cohere.com/terms-of-use ("Last updated: September 7, 2022")
- Z1 https://docs.z.ai/guides/overview/pricing
- HF1 https://huggingface.co/docs/inference-providers/pricing

**확인하지 못한 페이지**
- Mistral 무료(Experiment) 플랜 도움말(`help.mistral.ai/en/articles/450104…`, `…/455206…`)과 한도 문서(`docs.mistral.ai/deployment/laplateforme/tier/`)는 404였다.
- Gemini 모델별 무료 한도는 AI Studio 로그인 화면에만 있어 열지 않았다.
- OpenRouter 공개 모델 API(`openrouter.ai/api/v1/models`)는 예상과 다른 응답을 줘서 무료 비전 모델 목록을 확인하지 못했다.
