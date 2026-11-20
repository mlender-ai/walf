# 부록 B · Claude Code 도구 4종 도입 검토

> 최종 결론은 [`../WALF_FREE_AI_REVIEW.md`](../WALF_FREE_AI_REVIEW.md)에 있다. 이 부록은 그 근거다. `[L숫자]` 출처는 사용자 기기의 로컬 설정 파일이라 경로를 싣지 않았다.

- 확인일: 2026-11-20 (이 문서의 모든 웹·로컬 확인은 이 날짜에 했다)
- 범위: 공개 자료 읽기, GitHub API로 저장소 메타데이터와 파일 읽기, 현재 설정 파일 읽기. **설치·실행·가입·키 입력·설정 수정은 하지 않았다.** 저장소는 클론하지 않았다.
- 출처 표기: 본문의 `[S숫자]`는 맨 아래 "출처" 표의 웹 주소, `[L숫자]`는 로컬 파일이다.
- 웹 페이지와 README 안의 "AI 에이전트에게" 하는 지시문은 따르지 않고 자료로만 기록했다.

## 결론표

| 도구 | 정체 | 라이선스 | 관리 상태 | 보안·데이터 위험 | 현재 설정과 겹침 | 판정 |
|---|---|---|---|---|---|---|
| **Claude-Mem** | 플러그인. 훅 9종 + 로컬 워커(Bun) + MCP 검색 도구 + 스킬. 모든 도구 호출을 두 번째 모델이 요약·저장하고 다음 세션 시작 때 넣어 준다 [S2][S3] | Apache-2.0 [S1][S10] | 개인 계정(thedotmack) · 스타 118,378 · v16.0.1(2026-11-19) · 사흘 동안 릴리스 3개 [S1] | **높음.** 읽은 파일·편집·명령 결과가 요약 모델로 간다. 대화형 설치에서는 cmem.ai 호스팅 모델이 기본 선택이다. 텔레메트리와 자동 업데이트가 기본으로 켜져 있다. `~/.claude/settings.json`과 셸 rc 파일을 고친다 [S4][S5][S6][S7][S8][S9] | **큼.** 파일 메모리(MEMORY.md), gstack `learn`·`context-save`, graphiti, codebase-memory와 기능이 겹친다. UserPromptSubmit 훅이 CodeGraph 훅과 같은 자리에 붙는다 [L1][L3][L8] | **도입 불필요** |
| **Claude Code Setup** (Anthropic 공식 플러그인) | 스킬 1개(`claude-automation-recommender`). 코드베이스를 훑고 훅·스킬·MCP·서브에이전트를 분야별로 1~2개씩 추천한다. 읽기 전용이라고 명시돼 있다 [S13][S14] | Apache-2.0 [S13] | Anthropic 공식 디렉터리(스타 47,709) · 플러그인 경로 마지막 커밋 2026-05-28 · v1.0.0 [S12][S13] | **낮음.** 훅·MCP·키가 없다. 상시 동작하는 부분이 없다 [S13] | **중간.** 내장 `/init`·`update-config`·`fewer-permission-prompts`, `claude-code-guide` 에이전트, `setup-claude` 스킬과 겹친다 | **조건부** (새 프로젝트를 시작할 때 한 번 점검하는 용도. 상시 설치는 불필요) |
| **EGM** (Elephant-Goldfish Model) | Google 플러그인. 스킬 8개와 리뷰어 서브에이전트 10개로 구성된다. 맥락을 가진 세션이 설계 문서를 쓰고, 대화 맥락 없는 새 서브에이전트가 검토한다. 문서와 코드를 대조하는 drift report도 있다 [S18][S19][S21] | Apache-2.0 [S17][S19] | Google LLC(공식 지원 제품은 아니라고 명시) · 스타 21,362 · v0.1.1(2026-11-06) · 마지막 커밋 2026-11-18 · 9월에 만든 초기 버전 [S17][S18] | **낮음~중간.** 훅·MCP·텔레메트리 코드가 없다. 리뷰어는 Read·Grep·Glob만 쓴다. 다만 결과 파일을 작업 폴더에 쓰고, 토큰을 많이 쓰며, 리뷰 보고서를 영어로 쓰게 돼 있다 [S20][S22] | **작음.** `plan-eng-review`·`review`·`/code-review`는 diff나 계획을 같은 맥락에서 본다. "맥락 없는 리뷰어가 설계 문서를 코드와 대조"하는 도구는 지금 없다 | **조건부 (가치 있음)** · WALF 설계-코드 대조에 한정해 시험 |
| **21st.dev MCP** (구 Magic MCP) | 원격 HTTP MCP(`https://21st.dev/api/mcp`). React·Tailwind 컴포넌트를 검색하고, 코드를 가져오고, AI로 UI를 생성한다. 옛 `@21st-dev/magic`은 중계 프록시로만 남았다 [S25][S27] | ISC(프록시 저장소). 서버 본체는 비공개 [S25] | 21st.dev(회사) · 스타 6,597 · v0.2.3(2026-09-09) [S25] | **중간.** API 키와 계정이 필수다. 검색어·프롬프트·코드가 21st 서버로 간다. 코드 가져오기와 생성은 유료다. design-sync 스킬은 디자인 토큰을 테마로 게시할 수 있다 [S25][S26][S27][S28][S29] | **큼.** `impeccable`·`design-*`·figma 플러그인·`yds-*`와 겹친다. WALF 앱은 Expo(React Native)라 웹 컴포넌트와 맞지 않는다 [L9] | **도입 불필요** |

**한 줄 요약:** 넷 중 지금 의미 있는 건 EGM 하나다. EGM도 전역 상시 설치가 아니라 "WALF 설계 문서와 코드 대조"를 한 번 시험하는 정도로 쓰고, 핵심 규칙은 테스트로 고정하는 방식(§4-3)을 함께 쓰는 게 낫다.

---

## 1. 공식 저장소를 어떻게 정했나

| 도구 | 공식으로 본 저장소 | 근거 | 이름이 겹치는 다른 프로젝트 |
|---|---|---|---|
| Claude-Mem | `github.com/thedotmack/claude-mem` | 플러그인 매니페스트의 `repository`가 이 저장소를 가리킨다. README에 작성자 Alex Newman(@thedotmack)이 적혀 있다. 홈페이지는 claude-mem.ai, 문서는 docs.claude-mem.ai다 [S1][S2] | gitee 미러(masx200·jack-tiny·fzyai, 검색 결과에서 이름만 확인). "Cowork Memory"는 claude-mem에서 착안했다고 밝힌 별개 플러그인이다(`msapps-mobile/claude-plugins`) [S15] |
| Claude Code Setup | `github.com/anthropics/claude-plugins-official` 안의 `plugins/claude-code-setup` | 저장소 설명이 "Official, Anthropic-managed directory"다. `plugin.json` 작성자는 Anthropic이다. 로컬 플러그인 디렉터리 캐시에서 이 이름은 이 경로로 등록돼 있고, 검토 상태가 "done by anthropic"이다 [S12][S13][S15] | `philoserf/claude-code-setup`(지금은 `claude-code-config`로 이름이 바뀐 개인 설정 모음, MIT, 스타 14) · `b33eep/claude-code-setup`(보관됨, 마크다운 메모리 시스템, 스타 58) [S16] · `s220284`·`invertednz`·`petekp` 저장소(검색 결과에서 이름만 확인, 내용 미확인). **사용자가 이들 중 하나를 뜻했다면 판정이 달라질 수 있다.** |
| EGM | `github.com/google/elephant-goldfish-model` | Google LLC 조직 저장소다. `plugin.json` 작성자가 Google LLC다. Google Open Source 블로그 발표글(2026-10-22)이 이 저장소를 가리킨다 [S17][S19][S23] | `vshvedov/elephant-goldfish`: 같은 패턴을 바탕으로 만든 개인 워크플로(MIT, 스타 101). 공식이 아니다 [S24] |
| 21st.dev MCP | `github.com/21st-dev/magic-mcp` | 21st-dev 조직 저장소다. npm `@21st-dev/magic`의 `repository`가 이 저장소를 가리킨다. 로컬 플러그인 디렉터리 캐시의 "21st" 항목도 이 저장소를 가리킨다(검토 상태 "none"). Claude Code 묶음판은 같은 조직의 `21st-dev/claude-code-plugin`이다 [S25][S26][S15] | `oyasimi1209/magic-mcp`·`twmmason/magic-mcp`(검색 결과에서 이름만 확인, 내용 미확인) |

참고: 2차 자료와 1차 자료가 다른 곳이 있었다. 검색 결과 요약에는 claude-mem이 AGPL-3.0, 21st Magic MCP가 MIT로 나왔다(2차 자료 원문은 열지 않았다). 현재 저장소의 LICENSE 파일은 각각 Apache-2.0과 ISC다 [S1][S10][S25]. 이 문서는 1차 자료를 따랐다.

---

## 2. 도구별 근거

### 2-1. Claude-Mem

**정체·동작**
- Claude Code 플러그인과 npx 설치기(`npx claude-mem install`)로 구성된다. 훅이 각 도구 호출(읽은 파일, 편집, 실행 명령)을 로컬 워커에 넘긴다. 두 번째 에이전트(observer)가 이를 짧은 기록(observation)으로 요약하고, 세션이 끝나면 요약문을 쓴다. 다음 세션 시작 때 기록의 색인을 넣어 준다 [S2].
- 등록하는 훅: Setup, SessionStart(3개), UserPromptSubmit, PreToolUse(`Read|Bash|Grep|Glob|…`), PostToolUse(`*`), PostToolUseFailure(`*`), Stop, SubagentStop, SessionEnd [S2][S3].
- 저장소: SQLite(`~/.claude-mem/claude-mem.db`)와 Chroma 벡터 검색. 워커는 Bun으로 도는 로컬 HTTP 서비스다(뷰어 `http://localhost:37777`). Bun과 uv가 없으면 자동으로 설치한다 [S2][S4].
- MCP 도구는 `search`·`timeline`·`get_observations`와 `mem-search` 스킬이다 [S2].

**관리 상태** (GitHub API, 확인 2026-11-20) [S1]
- 라이선스 Apache-2.0(LICENSE·README·`plugin.json`). open-core 구조라서 호스팅 클라우드·팀 동기화 등은 오픈소스 범위 밖으로 남겨 두었다 [S10].
- 관리 주체: 개인 계정 thedotmack(Alex Newman).
- 스타 118,378, 포크 10,299. 열린 이슈 56, 열린 PR 29.
- 최신 릴리스 v16.0.1(2026-11-19). 바로 앞은 v16.0.0(11-18)과 v15.21.0(11-17)이다. 마지막 커밋은 2026-11-19다.
- 보안 이력: 2025-12-16 명령어 주입 취약점(CRITICAL, Issue #354)을 고쳤다고 SECURITY.md에 적혀 있다 [S11].
- 신뢰 판단에 참고할 점이 두 가지 있다.
  - README 끝에 제작자가 "공식적으로 지지한다"는 제3자 암호화폐 토큰(CMEM) 안내와 컨트랙트 주소가 있다 [S2].
  - README와 설치 문서에 "AI 에이전트가 설치해 줄 때" 쓰라는 지시문이 있다(`npx claude-mem install --setup browser …`). 이번 조사에서는 따르지 않았다 [S2][S5].

**보안·데이터**
- 필요한 권한: 모든 도구 호출의 입력과 결과를 훅이 받는다. 이 범위는 Claude Code 권한 설정과 무관하게 훅으로 동작한다 [S3].
- 외부 전송: 요약 모델(observer)을 무엇으로 고르느냐에 따라 달라진다 [S5][S6].
  - **Anthropic 요금제(`--provider claude`)**: 사용자의 Claude 요금제 사용량을 함께 쓴다. 이때 cmem.ai에는 사용자가 원할 때만 이메일을 보내고, 로그인 링크를 만들 때 숫자뿐인 사용량 요약을 보낸다고 문서에 적혀 있다.
  - **CMEM Pro(claude-mem observer)**: 대화형 설치에서 **미리 선택된 기본값**이다. 요약 추론이 `https://cmem.ai/api/inference/v1`에서 돈다. 도구 활동이 제3자 서버로 간다는 뜻이다. 30일 무료 체험에도 결제 수단 입력이 필요하다.
  - OpenRouter·Gemini를 고르면 해당 업체로 간다.
- 텔레메트리: PostHog 익명 사용 분석이 **기본으로 켜져 있다(opt-out)**. `npx claude-mem telemetry disable` 또는 `DO_NOT_TRACK`으로 끈다. 보내는 항목은 허용 목록으로 제한된다(버전, OS, 토큰 수, 관찰 대상 모델, 요금제 종류 등). 서버에서 IP를 대략적인 위치로 바꾼 뒤 IP는 버린다고 적혀 있다 [S4].
- 클라우드 동기화는 opt-in이다. 도구 스크린샷은 기본으로 `~/.claude-mem/media-v1/`에 보관한다 [S2].
- API 키·유료 계정: 필수는 아니다(Anthropic 요금제로 쓸 수 있음). CMEM Pro는 체험 후 유료다 [S2][S5].
- 전역 설정 변경(설치기 코드 확인) [S7][S8]:
  - `~/.claude/settings.json`의 `enabledPlugins`에 `claude-mem@thedotmack`을 추가한다.
  - `~/.claude/plugins/known_marketplaces.json`과 `installed_plugins.json`에 기록한다.
  - 셸 rc 파일(`~/.zshrc` 등)에 `~/.local/bin` PATH 줄을 더할 수 있다.
  - 사용자가 "auto-memory 끄기"를 고르면 `settings.json`의 `env`에 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`을 쓴다. 기본값은 "켜 둔 채 유지"다.
  - `~/.claude-mem/settings.json`을 만든다.
  - 설치기 코드(`install.ts`)에서 `CLAUDE.md`를 쓰는 부분은 찾지 못했다. 다른 경로에서 쓰는지는 미확인이다.
- 자동 업데이트: **기본으로 켜져 있다.** 하루 한 번, 관리자가 지정(promote)한 릴리스를 사용자가 자리를 비운 사이에 설치한다 [S9]. 릴리스가 잦아서 공급망 관점의 변화 폭이 크다.

**현재 설정과의 겹침·충돌**
- 메모리 시스템이 4중으로 겹친다.
  - 지금 쓰는 파일 메모리(프로젝트 메모리 폴더, 진행 기록 약 14KB) [L8]
  - gstack `learn`·`context-save`·`context-restore` 스킬 [L5]
  - graphiti MCP(이번 세션에서는 연결 실패) [L3]
  - codebase-memory MCP [L3]
- 훅이 겹친다. 전역 UserPromptSubmit에 이미 `codegraph prompt-hook`이 있다 [L1]. 여기에 claude-mem `session-init`이 더해지면 프롬프트마다 훅 2개가 돈다.
- PreToolUse(Read·Bash·Grep·Glob)에서 파일 맥락을 넣는다. "grep 전에 CodeGraph를 쓰라"는 전역 CLAUDE.md 지시와 맥락 창을 두고 경쟁한다 [L4]. headroom(맥락 압축 MCP)과 어떻게 상호작용하는지는 미확인이다.
- Anthropic 요금제를 요약 모델로 쓰면 사용자의 사용량 한도를 함께 쓴다 [S4][S5].

**판정: 도입 불필요**
- 이미 파일 메모리가 잘 돌고 있다. "한 번 지시한 규칙은 메모리나 스킬에 기록"이라는 전역 규칙과도 맞는다.
- 반면 claude-mem은 다음 부담이 크다: 모든 도구 활동을 관찰한다, 기본값이 외부 호스팅 모델이다, 텔레메트리와 자동 업데이트가 기본으로 켜져 있다, 전역 설정과 셸 파일을 고친다.
- 다시 검토할 조건: Codex 등 여러 에이전트가 같은 기억을 공유해야 할 때. 그때도 별도 사용자 프로필에서 `--provider claude`, 텔레메트리 끔, 자동 업데이트 끔으로 시험한다.

### 2-2. Claude Code Setup (Anthropic 공식 플러그인)

**정체·동작**
- 스킬 1개(`claude-automation-recommender`)와 참조 문서 5개(훅 패턴·MCP 서버·플러그인·스킬·서브에이전트 템플릿)로 구성된다 [S13].
- 스킬은 `Read, Glob, Grep, Bash` 도구로 `package.json`, `.claude/`, `CLAUDE.md`, 폴더 구조를 훑는다. 그리고 훅·서브에이전트·스킬·플러그인·MCP를 분야별로 1~2개 추천한다 [S14].
- "This skill is read-only… does NOT create or modify any files"라고 명시돼 있다. 다만 웹 검색으로 추천을 보강하라고 지시한다 [S14].

**관리 상태**
- 라이선스 Apache-2.0(플러그인 폴더 LICENSE) [S13].
- 관리 주체: Anthropic. README 작성자는 Anthropic 직원이다 [S13].
- 저장소 전체 기준 스타 47,709, 열린 이슈+PR 1,314. 플러그인 버전 1.0.0, 이 경로의 마지막 커밋은 2026-05-28(Convex 추천 추가)이다 [S12][S13].
- 로컬 플러그인 디렉터리 캐시(2026-11-19 갱신)에서 검토 상태는 "done by anthropic"이다 [S15].

**보안·데이터**
- 훅·MCP·설치 스크립트가 없다. API 키나 유료 계정도 필요 없다 [S13].
- 외부 전송: Claude Code 기본 경로 외에는 웹 검색어(프레임워크 이름 등)뿐이다 [S14].
- 전역 설정: 플러그인 자체는 설정을 고치지 않는다. 설치하면 Claude Code가 플러그인 활성화 항목을 기록한다. 이는 Claude Code의 표준 동작이며, 이번에 공식 문서로 다시 확인하지는 않았다.

**현재 설정과의 겹침**
- 내장 `/init`, `update-config`, `fewer-permission-prompts`, `claude-code-guide` 에이전트와 겹친다.
- Claude 앱의 `setup-claude` 스킬(역할별 플러그인·커넥터 안내)과도 일부 겹친다 [L6].
- 사용자 환경에는 이미 MCP 4개, 스킬 55개, 전역 훅 1개가 있다 [L1][L3][L5]. 추천 목록의 기본값(context7, Playwright, 자동 포맷 훅 등)으로 얻을 것이 적다.

**판정: 조건부 (낮은 우선순위)**
- 위험은 거의 없지만 효익도 작다. 새 프로젝트를 시작할 때 한 번 추천을 받아 보는 용도로만 쓴다. 상시 설치할 필요는 없다.
- 설치하지 않고 "이 프로젝트에 맞는 훅·스킬을 추천해 줘"라고 요청해도 비슷한 결과를 얻을 수 있다.

### 2-3. EGM (Elephant-Goldfish Model)

**정체·동작**
- 플러그인이다 [S18][S19].
  - 스킬 8개: brainstorm, draft, review, review-loop, resolve, bootstrap, lite, drift-report
  - 서브에이전트 10개: 리뷰어 페르소나, synthesizer, bootstrap orchestrator
- 훅과 MCP는 없다. 저장소의 실행 스크립트는 패키징·릴리스·테스트·웹사이트용뿐이다 [S17].
- 역할 구분 [S18]:
  - Elephant: 프로젝트 맥락을 가진 메인 세션. 설계 문서를 쓴다.
  - Goldfish: 대화 맥락 없이 문서와 참조 자료만 보는 새 서브에이전트. 문서를 검토한다.
  - 사람: 트레이드오프를 정하고 승인한다.
- `/egm:egm-review <문서>`는 기존 설계 문서를 실제 코드와 대조해 검토한다. `/egm:egm-drift-report <폴더>`는 폴더 안 문서마다 현재 코드와 어긋난 곳만 보고한다 [S18][S21].
- Claude Code에서 리뷰어 어댑터 설정 [S20]:
  - `tools: [Read, Grep, Glob]`, `omitClaudeMd: true`(CLAUDE.md를 넣지 않음). 셸을 쓸 수 없다.
  - synthesizer는 `Agent, Read, Grep, Glob, Write`를 쓴다.
  - bootstrap orchestrator는 Bash·Write·Edit까지 쓴다.

**관리 상태** [S17][S23]
- 라이선스 Apache-2.0. Google LLC 저장소지만 "not an officially supported Google product"라고 명시돼 있다 [S18].
- 스타 21,362, 포크 1,584. 열린 이슈 76, 열린 PR 52.
- 릴리스 v0.1.1(2026-11-06), v0.1.0(2026-10-27). 마지막 커밋 2026-11-18.
- 저장소는 2026-09-13에 만들어졌다. 발표는 2026-10-22 Google Open Source 블로그에서 했다. 초기 버전이라 바뀔 여지가 크다.

**보안·데이터**
- 권한: 리뷰어는 읽기 전용이다. 다만 "파일시스템 격리가 아니라 맥락·도구 격리"라서, 접근할 수 있는 파일은 읽을 수 있다 [S20].
- 권한 승인 훅은 설치하지 않는다. 플러그인 캐시 폴더 읽기는 일반 권한 프롬프트로 승인한다. headless로 돌릴 때만 Read 규칙을 따로 넣으라고 안내한다 [S20].
- 외부 전송: 플러그인 자체의 네트워크 코드·텔레메트리는 저장소 파일 목록에서 보이지 않는다. 리뷰어는 일반 Claude Code 서브에이전트라 Anthropic 외 추가 전송처가 없다 [S17][S20].
- API 키·유료: 필요 없다. 다만 "goldfish마다 별도 세션"이라 토큰을 많이 쓴다(리뷰 한 번에 5단계, 단계마다 여러 리뷰어) [S22]. 실제 토큰 양은 미확인이다.
- 전역 설정: 설치 명령은 `claude plugin marketplace add google/elephant-goldfish-model` → `claude plugin install egm@egm`이다 [S18]. `CLAUDE.md`를 고치지 않는다. 대신 `CLAUDE.md`나 프롬프트에 `EGM artifact directory: <경로>` 줄이 있으면 결과물을 그 폴더에 쓴다 [S20].
- 주의할 점 세 가지:
  1. **결과 파일을 작업 폴더에 쓴다** [S20][S21][S22]. 예: `consolidated_review_report.md`, `zoom_out_report.md`, `{날짜}_DRIFT_REPORT.md`. WALF 저장소에 섞이지 않게 프롬프트에 결과 폴더를 지정해야 한다.
  2. **`egm-review`는 "Plain-English Standard"로 영어 작성을 강제한다** [S22]. 리뷰어는 `omitClaudeMd`라 전역 "한국어 보고" 규칙도 보지 못한다. 실행 지시에 한국어 출력을 명시하거나 메인 세션이 한국어로 옮겨야 한다. 지시를 우선 적용하는지는 미검증이다.
  3. Claude Code 2.1.271 이상이 필요하다 [S20]. 로컬 Claude 앱의 claude-code 폴더에서 2.1.308을 확인했다 [L11]. CLI는 셸 PATH에 없어 버전 명령으로는 확인하지 못했다.

**현재 설정과의 겹침**
- gstack `plan-eng-review`·`autoplan`은 계획 검토, `review`·내장 `/code-review`는 diff 기준 검토, `codex`는 다른 모델의 의견이다 [L5].
- 이들 중 "설계 문서 ↔ 현재 코드 대조"를 "맥락 없는 리뷰어"로 하는 도구는 없다.
- 훅이 없으니 기존 CodeGraph 훅과 충돌하지 않는다.

**판정: 조건부 (가치 있음)**
- 위험이 낮고, WALF처럼 Gate 문서가 많은 프로젝트의 문서-코드 어긋남 점검에 맞는다.
- 조건은 네 가지다.
  1. 결과 폴더를 저장소 밖으로 지정한다.
  2. 한국어 출력을 지시한다.
  3. 검토할 문서를 "현재 유효한 명세"로 추린다(§4-1).
  4. 리뷰 결과를 테스트로 고정한다(§4-3).
- `egm-bootstrap`은 코드베이스 곳곳에 README를 만들거나 고치므로 WALF에서는 돌리지 않는다 [S18].

### 2-4. 21st.dev MCP (구 Magic MCP)

**정체·동작**
- 원격 HTTP MCP 서버(`https://21st.dev/api/mcp`)다 [S25][S27].
  - 21st.dev의 React·Tailwind(shadcn 계열) 컴포넌트·테마·템플릿을 검색한다(`search`, 무료·메타데이터만).
  - 코드를 가져온다(`get_component`, 유료).
  - 로고를 검색한다(`search_logo`, 무료).
  - 프로젝트 Design Context로 재정렬한 영감을 준다(`get_inspiration`).
  - AI로 UI를 생성한다(`generate`, 무료 등급에서 유료).
- `@21st-dev/magic` 패키지는 v0.2.0부터 21st MCP로 메시지를 넘기는 stdio 프록시일 뿐이다. 예전 Magic 키는 모두 초기화됐다 [S25].
- Claude Code 묶음판(`21st-dev/claude-code-plugin`)은 MCP와 스킬 7개를 넣는다 [S26].
  - 스킬: `21st-cli-use`, `21st-ai`, `21st-registry`, `21st-design-sync`, 그리고 UI 구축·탐색·검토 워크플로 3개
  - 이 중 `21st-design-sync`는 "프로젝트 디자인 토큰을 테마로 게시"한다.

**관리 상태**
- 라이선스: `magic-mcp`는 ISC(LICENSE·`package.json`·`plugin.json`) [S25]. `claude-code-plugin`은 Apache-2.0이다 [S26]. npm `@21st-dev/cli`는 MIT, 1.18.0(2026-10-06 갱신)이다 [S31].
  - GitHub의 `21st-dev/cli` 저장소는 라이선스 표시가 없고 마지막 push가 2026-01-27이다. npm 최신판의 소스인지는 미확인이다 [S32].
- 서버 본체 코드는 공개돼 있지 않다. 저장소에는 프록시와 매니페스트만 있다 [S25].
- 관리 주체: 21st.dev(회사).
- `magic-mcp`: 스타 6,597, 열린 이슈 5, PR 3. 마지막 커밋·릴리스는 2026-09-09(v0.2.3)다 [S25].
- `claude-code-plugin`: 스타 24, v0.4.1(2026-09-09) [S26].

**보안·데이터**
- API 키와 계정이 필수다(`x-api-key` 헤더, `API_KEY_21ST` 환경변수). OAuth 2.1 방식도 있다 [S25][S26][S30].
- 요금 [S28]:
  - 무료(Hobby): 하루 복사 2회, AI 크레딧 없음
  - Builder: 월 $6(연간)·$8(분기), MCP 컴포넌트 가져오기 무제한
  - Builder+AI: 월 500크레딧 $15(연간)부터
- 외부 전송: 원격 서버라 검색어·생성 프롬프트와 에이전트가 넣는 코드 맥락이 21st.dev로 간다 [S27].
  - 개인정보처리방침상 "업로드한 콘텐츠(프롬프트·코드)"를 수집한다. 명시 동의 없이 자체 모델 학습에는 쓰지 않는다고 적혀 있다. 처리자로 Anthropic·OpenAI·Sentry·Langfuse 등이 있고, 로그는 최대 12개월 보관한다 [S29].
  - MCP 호출에 이 방침이 어떻게 적용되는지는 문서에 명시돼 있지 않다(미확인) [S29][S30].
- 전역 설정 변경: `npx @21st-dev/cli@latest init --client claude`는 `--write`가 있을 때 클라이언트 설정에 기록한다. 정확한 파일 경로는 미확인이다 [S27]. 플러그인 방식은 `.mcp.json`으로 MCP를 등록하고, 셸 환경변수에 키를 넣어야 한다 [S26].
- `21st-design-sync`를 YAFIT·YDS 프로젝트에서 쓰면 사내 디자인 토큰이 외부 레지스트리에 올라갈 수 있다 [S26].

**현재 설정과의 겹침**
- UI 품질 도구가 이미 있다: `impeccable`, `design-taste-frontend`, `design-html`, `design-shotgun`, figma 플러그인, 사내 YDS 스킬(`yds-*`, `yafit-doc-tone`) [L5].
- WALF 앱은 Expo SDK 58·React Native 0.88(Tailwind 없음), 어드민은 서버 렌더링이다. 웹 React+Tailwind 컴포넌트를 그대로 쓸 곳이 없다 [L9].

**판정: 도입 불필요**
- 스택이 맞지 않는다. 키·결제가 필요하고 외부로 데이터가 간다. 사내 디자인 시스템과 방향이 겹친다.
- 웹 React+Tailwind 프로젝트를 새로 시작하면 그때 다시 본다.

---

## 3. 현재 설정 요약

사용자 기기의 Claude Code 설정(전역 설정·권한 규칙·MCP 목록·스킬 목록·메모리 경로)을 읽어 겹침을 판단했다. 개인 환경 정보라 이 저장소에는 싣지 않는다. 판단에 쓴 사실만 요약한다.
- 전역 훅은 CodeGraph의 프롬프트 훅 하나다.
- MCP는 codegraph·codebase-memory·headroom·graphiti 4개가 등록돼 있다.
- 파일 기반 메모리와 gstack 세션 기록 스킬을 이미 쓰고 있다.
- CLI로 설치한 플러그인은 없다.
- 이 저장소에는 `CLAUDE.md`·`AGENTS.md`·`.codegraph/`가 없다. CI(`.github/workflows/ci.yml`)는 server `npm ci → npm test → npm run e2e`, app `npx tsc --noEmit`를 돈다.

---

## 4. EGM으로 WALF 설계-코드 일치를 검토하는 방안

### 4-0. EGM이 이 용도에 맞는가

**부분적으로 맞다.**

맞는 점
- `egm-drift-report`는 이 일을 하라고 만든 스킬이다. 문서 폴더를 받아 문서마다 언급된 파일·심볼을 찾아 현재 코드를 읽는다. 그리고 다음 네 가지만 보고한다 [S21].
  - 빠진 기능
  - 모델에 빠진 필드
  - 하드코딩 지름길
  - 다른 구조
- `egm-review`의 리뷰어는 대화 맥락 없이 문서와 코드만 보고 "코드와의 정합성"까지 본다 [S18][S22].

한계
1. **drift-report 자체는 goldfish가 아니다.** 스킬 본문에는 서브에이전트 분리 없이 실행 중인 에이전트가 직접 읽고 판단한다 [S21]. "맥락 없는 눈"이 필요하면 새 세션에서 돌려야 한다. 그래도 자동 메모리(MEMORY.md)가 새 세션에 들어가는지 여부의 영향은 미확인이다.
2. **WALF 문서는 층층이 쌓인 이력이다.** `WALF_V2_ARCHITECTURE.md`(11-13 작성) 위에 Gate A~D·Gate 0·3·4·5 문서가 덧붙어 있다. 본문 일부는 이후 Gate에서 바뀌었다. 가볍게만 확인해도 아래 불일치가 보인다.
   - ARCHITECTURE §4 "가격 소스" 표의 설명과 실제 코드가 다르다 [L9: `docs/WALF_V2_ARCHITECTURE.md` 91~101행, `server/src/sources.ts` 17~28행].

     | 항목 | ARCHITECTURE §4 | `sources.ts` |
     |---|---|---|
     | SUPPORTED 범위 | "약관 차단 목록 밖"(차단 목록 방식) | `상품 페이지(허용 목록)` |
     | 29CM | PENDING_INTEGRATION | `UNSUPPORTED`·`partner_required` |
     | 후루츠패밀리 | PENDING_INTEGRATION | `UNSUPPORTED`·`link_only` |

     바뀐 이유는 `WALF_DISCOVERY_GATE34.md` §1에 기록돼 있다.
   - ARCHITECTURE §3은 등급(MATCH·LIKELY·DISCOVER) 기준으로만 설명한다. 결과 세 갈래(`outcome: exact·likely·not_found`, `find.ts` 138행)는 `WALF_DISCOVERY_GATE5.md`에만 있다.

   이 상태로 `docs/`를 통째로 drift-report에 넣으면 "옛 문서 대 현재 코드" 불일치가 대량으로 나와 진짜 결함이 묻힌다. 또 스킬은 "문서에 언급되지 않은 로직도 drift로 보고하라"고 해서 잡음이 더 커진다 [S21].
3. 리뷰 보고서가 영어로 나온다(§2-3). LLM 판단이라 증명은 아니다. EGM도 "리뷰는 테스트를 대체하지 않는다"고 적었다 [S18].

결론: **EGM은 "어긋난 곳 후보 찾기"에 쓰고, 확정과 재발 방지는 테스트로 한다.** EGM을 설치하지 않아도 같은 일을 기존 도구로 할 수 있다(§4-3).

### 4-1. 준비: 검토 기준이 될 "현재 명세" 두 장 만들기

EGM을 쓰든 안 쓰든 먼저 필요하다.
- `찾아줘` 명세와 `기다려줘` 명세를 각각 한 파일로 모은다.
  - 재료: ARCHITECTURE §3·§4, GATE34 §1, GATE5 §1·§2, REPORT §2-2, REVIEW_FOLLOWUP의 바뀐 규칙
- 규칙마다 ID를 달고, 코드 심볼과 기존 테스트 이름을 함께 적는다. drift-report도 "문서에 파일·심볼 링크를 달면 다음 검사가 싸진다"고 권한다 [S21].
- 위치는 처음에는 저장소 밖(scratchpad)에 둔다. 저장소에 넣을지는 사용자가 정한다.

아래는 설계 문서에서 뽑은 **검토 대상 규칙 초안**이다. 코드 위치는 함수 정의를 grep으로 찾은 것이다. **일치 여부는 아직 검토하지 않았다.**

**찾아줘** (사진 → 식별 → 판매처 탐색 → 검수 → 결과 세 갈래)

| ID | 설계 규칙(요지) | 코드 위치 | 기존 테스트 단서 |
|---|---|---|---|
| FIND-01 | AI 식별은 제안일 뿐이다. 운영자 공개 전에는 사용자에게 보이지 않는다. 응답에서 실제로 보지 않은 근거 주소는 버린다 | `ai.ts`(`cleanIdentify`), `aijobs.ts` | `ai.test.ts`, `claude.test.ts` |
| FIND-02 | 식별과 판매처 탐색을 분리한다. 확정 전에는 후보를 최대 3개까지 탐색한다(`target_rank`). 같은 검색 키는 20시간 동안 재사용한다 | `findsearch.ts` `runFindSearch`(318행) | `v21-findsearch.test.ts` |
| FIND-03 | 허용된 소스만 자동으로 탐색한다 | `sources.ts` `SOURCES`, `searchsources.ts` | `[허용 목록]` 3건 |
| FIND-04 | 같은 상품 판정: 품번이 정확히 같고 브랜드가 충돌하지 않을 때만 `same_code`다. 이름만 같으면 `likely`다 | `sameproduct.ts` `compareProduct`(65행) | `v21-review.test.ts` |
| FIND-05 | 공개 때 서버 판정이 상한이다. MATCH로 올리거나 이름을 고치면 확인 페이지 주소와 사유(10자 이상)가 필요하다 | `find.ts` `publishFind`(53행), `offerreview.ts` | `[리뷰 4]` |
| FIND-06 | 결과 세 갈래: `exact`(MATCH 또는 사용자 확정) · `likely` · `not_found`. `understood.unknown`은 not_found일 때만 채운다. `match.image`는 exact에만 붙인다 | `find.ts` `findView`(123·138행) | `discovery-gate5` `[결과]` 3건 |
| FIND-07 | "계속 찾아 주세요"는 기다려줘 등록으로 이어지고 맡긴 사진을 넘긴다. 링크가 없으면 `needs_info`다 | `watch.ts` `createWatch`(55행) | `[계속 찾기]` |
| FIND-08 | 결과 화면에 "실제 판매처 N곳뿐"을 보여 준다 | `findsearch.ts` `coverageOf`(407행) | 미확인 |
| FIND-09 | 대체 추천은 "같은 상품 아님"으로 분리하고, 가장 최근 추천만 보여 준다 | `curation.ts`, `currentSimilar` | `v21-curation.test.ts` |

**기다려줘** (가격·재고 감시, 새 매물, 판매 예정, 알림 조건)

| ID | 설계 규칙(요지) | 코드 위치 | 기존 테스트 단서 |
|---|---|---|---|
| WATCH-01 | 활성은 사용자당 3개다. 확인은 하루 1회, 30일마다 계속할지 묻고, 연속 3회 실패하면 "확인 불가"다 | `watch.ts` `createWatch`, 환경변수 정책 | `v2-watch.test.ts` |
| WATCH-02 | 허용 목록 밖 링크는 `needs_info`다. 이미 감시 중이면 멈추고(`parkWatch`) 대기열 조회도 열지 않는다 | `sources.ts` `sourceFor`(62행)·`loadPageHosts`(51행), `watch.ts` `parkWatch` | `[허용 목록]` |
| WATCH-03 | 같은 페이지는 (페이지, 시간 창)마다 한 번만 읽는다. 임대 2분, 일시 오류는 3회 재시도하고, robots·404는 바로 실패로 둔다 | `tickWatches`(247행), `createChecker`(289행) | `[QA] 서로 다른 사용자`, `[QA] 조회가 실패하면` |
| WATCH-04 | `met`은 같은 상품 페이지 · 사이즈 · 색 · 재고 · 목표가 이하(기본은 배송비 포함 총액) · 원화가 모두 확인될 때만이다 | `watch.ts` `evaluate`(382행) | `[리뷰 1]`·`[리뷰 2]`, `[통화]` |
| WATCH-05 | 페이지 동일성: `page_defined`·`matched`·`operator_confirmed`일 때만 알린다 | `watch.ts`, `sameproduct.ts` | `[리뷰 3]` 7건 |
| WATCH-06 | 같은 조건이 이어지는 동안 다시 알리지 않는다(`alert_episode`+`dedupe_key`) | `watch.ts` | `v2-watch.test.ts` |
| WATCH-07 | 새 매물은 운영자 확인 뒤, `fitOf`로 모든 조건이 확인될 때만 알린다. 할인가만 맞으면 unknown이다. possible은 별도 알림이다. 가격 감시와 서로의 상태를 바꾸지 않는다 | `findsearch.ts` `queueDiscovery`(513행)·`ensureDiscoveries`(577행), `discovery.ts`, `offers.ts` `fitOf`(94행) | `v21-discovery.test.ts` |
| WATCH-08 | 판매 예정: 공식 발표 근거가 있어야 한다. 시작 시각에 허용된 페이지만 1회 확인한다. 재고 알림은 따로 보낸다 | `release.ts`, `watch.ts` `tickWatches` | `discovery-gate34` |
| WATCH-09 | 환율: 3일 이내 환율만 쓴다. 원화가 아니거나 통화를 모르면 비교하지 않는다 | `fx.ts`, `offers.ts` | `[환율]`, `[통화]` |
| WATCH-10 | 상품 상태 5분류, "새 상품만" 만족 조건 | `catalog.ts` `conditionOf`(58행) | `[상품 상태]` |

### 4-2. EGM으로 하는 순서 (사용자가 설치를 결정한 경우)

1. **설치와 범위**
   - 사용자가 직접 `claude plugin marketplace add google/elephant-goldfish-model` → `claude plugin install egm@egm`을 실행한다 [S18].
   - 끝나면 `claude plugin disable egm@egm`으로 꺼 둘 수 있다. 이 명령의 존재는 `enable`만 문서에서 확인했다 [S20].
2. **결과 폴더 지정**
   - 프롬프트 첫 줄에 `EGM artifact directory: <scratchpad 안 폴더>`를 넣는다. 그러면 `CLAUDE.md`를 고치지 않고도 결과가 저장소 밖에 쌓인다 [S20].
   - 경로가 작업 폴더 밖이면 EGM이 확인을 묻는다.
3. **drift report**
   - 새 세션에서 `/egm:egm-drift-report <§4-1 명세 2장만 든 폴더>`를 돌린다.
   - `docs/` 전체를 넣지 않는다(이력 문서 잡음 때문).
   - 결과는 `{날짜}_DRIFT_REPORT.md`에 "문서별 어긋난 점만" 쌓인다 [S21].
4. **goldfish 리뷰**
   - `/egm:egm-review <찾아줘 명세>`, `/egm:egm-review <기다려줘 명세>`를 각각 돌린다.
   - 단계는 "Feature spec only"(5→6→7→8) 또는 구현 준비도만(9)으로 고른다 [S22].
   - 실행 지시에 "보고서와 대화는 한국어로"를 넣는다. 영어로 나오면 메인 세션이 한국어로 요약한다.
5. **분류**: 나온 항목마다 셋 중 하나로 나눈다.
   - (a) 코드 결함 → 고치고 회귀 테스트를 추가한다
   - (b) 문서가 낡음 → 명세를 고친다
   - (c) 의도된 차이 → 명세에 이유를 적는다
   - 어느 쪽을 고칠지는 사용자가 결정한다. EGM도 "문서를 고칠지 코드를 고칠지는 사용자가 정한다"고 한다 [S18].
6. **비용 관리**: 리뷰어 수만큼 별도 세션이 돈다. 한 기능씩, 단계를 줄여서 시작한다.

### 4-3. EGM 없이 기존 도구로 같은 검토를 하는 방법 (권장 병행안)

1. **테스트로 설계 규칙 고정**(가장 확실하다)
   - WALF 테스트는 이미 `[리뷰 1]`, `[허용 목록]`, `[통화]`, `[결과]`처럼 규칙 꼬리표를 쓴다 [L9: `server/test/*.ts`]. 여기에 §4-1의 규칙 ID(`[FIND-06]`, `[WATCH-04]` 등)를 붙인다.
   - 작은 검사 스크립트(예: `server/tools/spec-coverage.ts`)를 `npm run verify`에 더한다. 명세에 적힌 규칙 ID가 테스트 이름에 하나 이상 있는지 확인하는 스크립트다.
   - 그러면 CI(`npm test`)가 "명세 규칙에 테스트가 없음"을 잡는다. 규칙을 바꾸면 테스트가 먼저 깨진다.
2. **맥락 없는 리뷰어를 Agent 도구로 직접 띄우기**(EGM goldfish와 같은 원리)
   - 새 서브에이전트에게 명세 파일 경로, `server/src` 경로, 출력 형식만 준다.
   - 출력 형식: 규칙 ID별로 "일치·불일치·판단 불가 + 근거 파일:행", 한국어.
   - 대화 이력은 넘기지 않는다. 일반 서브에이전트는 부모 대화 이력을 받지 않는다 [S20]. CLAUDE.md는 받으므로 한국어 규칙도 지켜진다.
   - 규칙 묶음별로 2개를 나눠 돌리면 비용도 EGM 전체 리뷰보다 작다.
3. **CodeGraph**(색인은 사용자 결정)
   - WALF에는 `.codegraph/`가 없다 [L10]. 사용자가 `codegraph init`으로 색인하면 `codegraph_explore`로 호출 경로를 한 번에 확인할 수 있다.
   - 예: "`runFindSearch` → `compareProduct` → `offerreview` 공개 → `findView`", "`tickWatches` → `createChecker` → `evaluate` → 알림"이 설계 순서와 같은지.
   - codebase-memory의 WALF 색인도 사실상 비어 있어 재색인이 필요하다(사용자 결정).
4. **기존 리뷰 스킬은 역할을 나눠 쓴다**
   - 내장 `/code-review`와 gstack `/review`는 diff 기준이다. PR #3 같은 변경분이 명세 규칙을 깨는지 볼 때 쓴다. 이때 명세 파일을 함께 주고 "이 규칙 ID들과 어긋나는지"를 묻는다.
   - gstack `/plan-eng-review`는 명세 자체의 빈틈(경계 조건·실패 처리)을 볼 때 쓴다.
   - gstack `/codex`(다른 모델의 의견)도 쓸 수 있다. 다만 코드가 OpenAI로 가므로 데이터 경로가 하나 늘어난다.
5. **E2E를 실행 가능한 명세로 쓴다**
   - `npm run e2e`(20·19·21단계)의 단계 이름을 명세 규칙 ID와 연결하면, 흐름 수준의 일치도 CI에서 매번 확인된다.

**권장 순서:** §4-1 명세 2장 → §4-3-2 맥락 없는 리뷰어(무설치) → 불일치 분류 → §4-3-1 테스트 고정. EGM은 그다음에 "같은 결과가 나오는지" 비교하는 시험으로 한 번 돌려 보고, 효익이 있으면 계속 쓴다.

---

## 5. 미확인 목록

- claude-mem: `/plugin` 마켓플레이스 설치만 했을 때의 기본 요약 모델. 문서에는 대화형 GUI에서 고른다고만 돼 있다 [S5].
- claude-mem: 설치기 외 경로에서 `CLAUDE.md`를 쓰는지 여부.
- claude-mem: headroom MCP와의 상호작용.
- Claude Code Setup: `/plugin` 설치 시 Claude Code가 기록하는 정확한 항목(이번에 공식 문서로 재확인하지 않음).
- EGM: 실제 토큰 사용량, 한국어 출력 지시를 우선 적용하는지 여부.
- EGM: drift-report를 새 세션에서 돌릴 때 자동 메모리가 판단에 주는 영향.
- EGM: `claude plugin disable` 명령. 문서에는 `enable`만 있다.
- 21st: `init --write`가 쓰는 정확한 파일 경로.
- 21st: MCP 호출 데이터에 개인정보처리방침이 어떻게 적용되는지.
- 21st: `21st-dev/cli` GitHub 저장소가 npm 최신판의 소스인지.
- Claude Code CLI 버전: 셸 PATH에 `claude`가 없어 명령으로는 확인하지 못했다. 앱 내부 폴더 기준으로 2.1.308이다.
- "Claude Code Setup"을 Anthropic 플러그인이 아닌 다른 저장소로 뜻했을 가능성.

---

## 출처 (모두 확인일 2026-11-20)

| ID | 출처 | 비고 |
|---|---|---|
| S1 | https://github.com/thedotmack/claude-mem | GitHub API: 저장소·릴리스·커밋·이슈/PR 수 |
| S2 | https://github.com/thedotmack/claude-mem/blob/main/README.md | |
| S3 | https://github.com/thedotmack/claude-mem/blob/main/plugin/hooks/hooks.json | |
| S4 | https://github.com/thedotmack/claude-mem/blob/main/docs/public/telemetry.mdx | |
| S5 | https://github.com/thedotmack/claude-mem/blob/main/docs/public/installation.mdx | |
| S6 | https://github.com/thedotmack/claude-mem/blob/main/docs/public/cmem-pro-headless.mdx | |
| S7 | https://github.com/thedotmack/claude-mem/blob/main/src/npx-cli/commands/install.ts | `registerMarketplace`·`registerPlugin`·`enablePluginInClaudeSettings`·`disableClaudeAutoMemory` |
| S8 | https://github.com/thedotmack/claude-mem/blob/main/src/launcher/install-launcher.ts | 셸 rc 경로 |
| S9 | https://github.com/thedotmack/claude-mem/blob/main/docs/public/auto-update.mdx | |
| S10 | https://github.com/thedotmack/claude-mem/blob/main/docs/license.md · https://github.com/thedotmack/claude-mem/blob/main/docs/ip-boundary.md | |
| S11 | https://github.com/thedotmack/claude-mem/blob/main/.github/SECURITY.md | |
| S12 | https://github.com/anthropics/claude-plugins-official | GitHub API |
| S13 | https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup | README·`plugin.json`·LICENSE·경로 커밋 기록 |
| S14 | https://github.com/anthropics/claude-plugins-official/blob/main/plugins/claude-code-setup/skills/claude-automation-recommender/SKILL.md | |
| S15 | 로컬 `~/.claude/plugins/plugin-directory-cache-v2.json` | claude.ai 플러그인 디렉터리 캐시, fetchedAt 2026-11-19T12:19Z |
| S16 | https://github.com/philoserf/claude-code-setup · https://github.com/b33eep/claude-code-setup | GitHub API |
| S17 | https://github.com/google/elephant-goldfish-model | GitHub API: 저장소·릴리스·커밋·이슈/PR 수·파일 목록 |
| S18 | https://github.com/google/elephant-goldfish-model/blob/main/README.md | |
| S19 | https://github.com/google/elephant-goldfish-model/blob/main/.claude-plugin/plugin.json · …/.claude-plugin/marketplace.json | |
| S20 | https://github.com/google/elephant-goldfish-model/blob/main/docs/claude.md | |
| S21 | https://github.com/google/elephant-goldfish-model/blob/main/skills/egm-drift-report/SKILL.md | |
| S22 | https://github.com/google/elephant-goldfish-model/blob/main/skills/egm-review/SKILL.md | |
| S23 | https://opensource.googleblog.com/2026/10/introducing-elephant-goldfish-model-plugin.html | 2026-10-22 게시 |
| S24 | https://github.com/vshvedov/elephant-goldfish | GitHub API |
| S25 | https://github.com/21st-dev/magic-mcp | GitHub API·README·LICENSE·`.mcp.json`·`package.json`·`.claude-plugin/plugin.json` |
| S26 | https://github.com/21st-dev/claude-code-plugin | GitHub API·README·파일 목록 |
| S27 | https://21st.dev/mcp | |
| S28 | https://21st.dev/pricing | |
| S29 | https://21st.dev/privacy | 2026-04-26 갱신본 |
| S30 | https://21st.dev/llms.txt | |
| S31 | https://www.npmjs.com/package/@21st-dev/cli | `npm view` 메타데이터 |
| S32 | https://github.com/21st-dev/cli | GitHub API |
| L1 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L2 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L3 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L4 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L5 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L6 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L7 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L8 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L9 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
| L10 | codebase-memory MCP `list_projects` 결과, `.codegraph/` 존재 여부 | |
| L11 | 사용자 기기의 로컬 설정 파일 | 경로 생략 |
