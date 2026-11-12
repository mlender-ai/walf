# WALF — MVP 세로형 구현 (Vertical Slice)

기준: `WALF_MVP_Product_Definition_v0.3` · `WALF_Core_Screens.html`(1차 시안, 승인됨)

```
WALF/
├─ server/   API · SQLite · 스케줄러(7일·하루 1회·만료) · 운영자 어드민 웹
├─ app/      Expo SDK 58 앱 (iOS·Android, Expo Router)
├─ WALF_Core_Screens.html, walf_*.py   1차 시안 문서(디자인 기준)
└─ assets/   시안용 캐릭터 프레임·예시 이미지
```

## 1. 서버 + 어드민

Node 24 이상(내장 SQLite·TypeScript 실행 사용, 별도 빌드 없음).

```bash
cd server
npm install
cp .env.example .env      # WALF_ADMIN_PASSWORD 를 바꾸고 포트·QA 도구 설정
npm start                 # http://localhost:4300 , 어드민 http://localhost:4300/admin
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `WALF_PORT` | 4300 | |
| `WALF_ADMIN_PASSWORD` | (필수) | 어드민 비밀번호. 운영 이름은 로그인할 때 적고 일지에 남는다 |
| `WALF_DB` | `data/walf.db` | SQLite 파일 |
| `WALF_QA_TOOLS` | 0 | 1이면 어드민에 “일정 24시간 당기기 · 지금 7일 종료” 버튼(실행 기록은 “모의”로 남음) |
| `WALF_PUSH_DISABLED` | 0 | 1이면 Expo 푸시 발송 시도 안 함 |
| `WALF_TICK_MS` | 30000 | 스케줄러 주기(탐색 작업 생성 · 창 마감 · 7일 만료) |
| `ANTHROPIC_API_KEY` | (없음) | 있으면 AI 보조가 켜진다(1-1). 없으면 운영자가 직접 확인 |
| `WALF_AI_MODEL` | `claude-opus-5-5` | AI 보조 모델 |
| `WALF_AI_EFFORT` | `high` | `low`·`medium`·`high`·`xhigh`·`max` — 낮출수록 싸고 빠르다 |
| `WALF_AI_PROVIDER` | (자동) | `off`: 키가 있어도 끔 · `mock`: 모의 AI(QA·E2E 전용, 실제 분석 없음) |
| `WALF_AI_POLL_MS` | 5000 | AI 작업 대기열 확인 주기 |

테스트:

```bash
npm test        # 상태 규칙 · AI 작업 순서 · Claude 요청 형식(로컬 가짜 API) · V2(찾아줘·기다려줘·비용·가격 소스·마이그레이션) 단위 테스트 75개
npm run e2e     # ① BADBLOOD 7일 수배 HTTP 전 구간 ② V2 찾아줘→기다려줘(테스트 가격 220,000→190,000→145,000)·서버 재시작 — 모두 임시 DB·모의
```

## 1-1. AI 보조 — AI가 먼저 찾고, 왈프 팀이 검수한다

PRD v0.3 “AI 보조 + 운영자 검수”(R03 AI 후보 제시 → 운영자 모델 확인, Flow A 국내 첫 탐색 → 운영자 검수)를 따른다.

```
접수(사진·링크·이름) ─▶ AI 식별: 사진을 보고 공식몰·국내 판매처를 검색해 상품 후보 1~3개(근거·확인한 페이지·신뢰도)
                      ─▶ 운영자: 후보를 고쳐 쓰거나 그대로 “확정” → 7일 시작   (틀렸으면 직접 확인 · 보완 요청)
DAY n 탐색 작업 생성 ─▶ AI 탐색: 무신사·29CM·W컨셉·번개장터·중고나라·후루츠패밀리 도메인만 검색(해외 제외)
                      ─▶ 운영자: AI가 찾은 매물을 열어 보고 후보로 등록하거나 제외 → 판매처별 결과(AI가 미리 골라 둠)를 확인해 저장
```

- **AI 결과는 언제나 “AI 제안 · 검수 전”**이다. 사용자 앱에는 “왈프가 먼저 살펴봤어요 · 왈프 팀이 확인하고 있어요” 일지만 남고, 후보·매물 내용은 운영자가 후보로 등록·공개하기 전까지 보이지 않는다.
- AI가 찾은 매물을 검수(등록·제외)하기 전에는 그날 탐색 기록을 저장할 수 없다. “구매 가능 확인”은 지금처럼 운영자가 확인 시각·가격을 넣어야만 된다.
- 판매처 도메인이 아닌 주소(해외·다른 사이트)는 버리고, 검색 결과에 없던 주소는 “⚠ 검색 결과에 없던 주소”로 표시한다.
- AI가 실패하면(키 오류·거절·요청 한도 등) 어드민에 사유만 남고 성공처럼 보이지 않는다. “AI 다시 살펴보기/찾아보기”로 다시 실행한다.
- 사진은 긴 변 1568px JPEG로 줄여 Anthropic API로 보낸다. **사용자 사진이 외부 AI로 전송되므로 개인정보 처리방침·사진 권한 안내 문구에 반영해야 한다.**
- Claude API 웹 검색은 **조직 Console 설정에서 웹 검색이 켜져 있어야** 한다. 판매처 사이트가 Anthropic 검색 크롤러를 막으면 그 판매처만 빼고 다시 시도하고 “AI 검색 불가”로 표시한다.
- 비용은 모델·검색 횟수에 따라 달라진다(식별 1회 웹 검색 최대 6회, 하루 탐색 1회 최대 12회 + 페이지 열람 8회). 실제 키로 몇 건 돌려 어드민의 “검색 n회 · 토큰”을 보고 `WALF_AI_EFFORT`를 정한다.

## 1-2. V2 — 찾아줘(FIND) · 기다려줘(WATCH)

- **찾아줘**: 사진·링크로 맡기면 AI가 먼저 식별하고, 왈프 팀이 MATCH(같은 옷 확인)·LIKELY(유력 후보)·DISCOVER(비슷한 스타일, 같은 상품 아님)로 골라 공개해요. 사용자가 “이 옷이 맞아요”를 누르면 7일 매물 찾기(기존 수배) · 원하는 가격 기다리기 · 저장 중에서 골라요.
- **기다려줘**: 아는 옷의 상품 링크·이름과 원하는 가격·사이즈를 등록하면 하루 한 번 상품 페이지의 가격·옵션 재고를 확인해요(AI 호출 없음). 같은 상품·사이즈·재고·가격이 모두 확인될 때만 알려요. 사용자당 3벌, 30일마다 계속할지 물어요.
- 공식몰(카페24·schema.org) 상품 페이지는 가입 없이 동작해요. 번개장터·무신사 등 약관이 자동 수집을 금지한 곳은 열지 않아요(`server/src/sources.ts`).
- 비용 가드레일: `WALF_AI_MONTHLY_BUDGET_USD`(기본 10) · `WALF_AI_MAX_CALLS_PER_REQUEST`(기본 10). 넘으면 작업이 멈추고 어드민 **비용** 화면에서 확인해요. 기다려줘 설정: `WALF_WATCH_*`(`server/.env.example`).
- 문서: [구조](docs/WALF_V2_ARCHITECTURE.md) · [진행 보고](docs/WALF_V2_PROGRESS.md) · [비용 모델](docs/WALF_V2_COST_MODEL.md) · [주말 설정 체크리스트](docs/WEEKEND_SETUP_CHECKLIST.md)

## 2. 앱

```bash
cd app
npm install
cp .env.example .env            # EXPO_PUBLIC_API_URL (시뮬레이터는 http://localhost:4300)
npx expo run:ios                # iOS 시뮬레이터 개발 빌드
npx expo start                  # 이후 JS만 바꿀 때
npx tsc --noEmit                # 타입 검사
```

실기기에서 맥의 서버에 붙을 때는 앱 **MY → 테스트 빌드 설정 → 서버 주소**에 같은 Wi-Fi 주소(`http://192.168.x.x:4300`)를 넣는다.

## 3. 내 iPhone에 설치 (Apple 개발자 계정 없이)

무료 Apple ID(Xcode의 Personal Team)로 케이블 연결한 iPhone에 직접 설치한다. **7일마다 다시 설치**해야 하고, 무료 팀은 푸시 권한을 못 쓰므로 **원격 푸시는 오지 않는다**(알림은 앱 안 ALERTS 탭). App Store의 Expo Go는 SDK 54까지만 지원해서 이 앱(SDK 58)에는 쓸 수 없다.

처음 한 번(본인이 직접): Xcode → Settings → Accounts에 Apple ID 추가 → iPhone 케이블 연결·“이 컴퓨터 신뢰” → iPhone 설정 → 개인정보 보호 및 보안 → 개발자 모드 켬.

```bash
cd ~/Desktop/WALF/server && npm start      # 서버(같은 Wi-Fi에서 접속)
cd ~/Desktop/WALF/app && npm run iphone    # 빌드 → 서명 → 설치 → 실행 (첫 빌드 약 10분)
```

- `WALF_FREE_SIGNING=1`일 때만 `app.config.js`가 번들 ID를 `app.walf.local`, 이름을 “WALF (테스트)”로 바꾸고 푸시 권한을 뺀다. TestFlight용 설정(`app.walf.beta`)은 그대로다.
- 첫 설치 후 iPhone에서 앱 아이콘을 한 번 누르고 → 설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → 신뢰. 처음 열 때 “로컬 네트워크” 질문은 **허용**.
- 서버 주소는 설치할 때의 맥 Wi-Fi IP로 들어간다. IP가 바뀌면 앱 MY → 서버 주소에서 고치거나 다시 설치한다.
- 팀 ID가 다르면 `WALF_APPLE_TEAM_ID=<팀ID> npm run iphone`.

## 4. TestFlight · 푸시 빌드 (Expo Build) — 유료 Apple 개발자 계정 필요

준비된 설정: `app/eas.json`(production 프로필 · 빌드 번호 자동 증가 · `production` 환경변수), `app/.easignore`(로컬 `.env`와 `ios/`는 올리지 않음 → 클라우드에서 app.json 기준으로 새로 생성), app.json의 개인정보 매니페스트·로컬 네트워크 안내 문구·`ITSAppUsesNonExemptEncryption=false`.

이 폴더는 Git 저장소가 아니라서 Expo 명령에 `EAS_NO_VCS=1`을 붙인다.

**현재 연결 상태(2026-11-08)** — Expo 프로젝트 `@henrychoi/walf`(projectId `8efa5aaf-cc3f-4f75-ba20-c0d824d161c7`, app.json에 기록됨) · `EXPO_PUBLIC_API_URL` = production `http://192.168.219.103:4300`, development `http://localhost:4300`. 1~3번은 끝났다. 4번은 유료 Apple 개발자 계정(연 $99)이 있어야 진행할 수 있다.

| 순서 | 명령 (`cd ~/Desktop/WALF/app`) | 누가 · 무엇을 입력 |
|---|---|---|
| 1 | `npx eas-cli@latest login` | 본인 · 브라우저에서 Expo 로그인 |
| 2 | `EAS_NO_VCS=1 npx eas-cli@latest init --force` | Expo 프로젝트 생성 → app.json `extra.eas.projectId` 기록 |
| 3 | `EAS_NO_VCS=1 npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_API_URL --value <서버 주소> --visibility plaintext` | 앱이 처음 접속할 서버 주소(아래 참고) |
| 4 | `EAS_NO_VCS=1 npx eas-cli@latest build -p ios --profile production --auto-submit` | 본인 · Apple ID 로그인(2단계 인증), 인증서·프로비저닝 생성 **Yes**, “Set up Push Notifications” **Yes**, “Generate a new Apple Push Notifications service key” **Yes** |
| 5 | 빌드 15~30분 + App Store Connect 처리 10~15분 | App Store Connect → TestFlight → 내부 테스터 추가 |

- 4번에서 App Store Connect 앱이 없으면 자동으로 만든다. 앱 이름 `WALF`가 이미 쓰이고 있으면 실패하니, 그때는 `eas.json`의 `submit.production.ios.appName`에 다른 이름(예: `WALF 왈프`)을 넣고 `npx eas-cli@latest submit -p ios --latest`로 다시 제출한다.
- 번들 ID는 `app.walf.beta`. 첫 빌드 전에만 바꾸기 쉽다(app.json `ios.bundleIdentifier`).
- 빌드 번호는 Expo 서버가 관리한다(`appVersionSource: remote`). 사용자에게 보이는 버전은 app.json `version`(0.1.0).

### 서버 주소 (3번)

TestFlight 앱은 시뮬레이터와 달리 `localhost`로 맥에 닿지 않는다.

- **지금 바로(같은 Wi-Fi 테스터)**: 맥 IP `http://192.168.219.103:4300`. `NSAllowsLocalNetworking`으로 http 접속이 허용되고, 첫 실행 때 iOS가 로컬 네트워크 권한을 묻는다. 맥 IP가 바뀌면 앱 **MY → 서버 주소**에서 고친다.
- **다른 곳의 테스터까지**: HTTPS로 배포한 서버 주소가 필요하다(배포처 미정).
- 주소는 빌드 때 앱에 들어간다. 나중에 바꾸려면 `env:update` 후 다시 빌드하거나, 각 기기에서 MY로 바꾼다.

### 푸시 확인

1. TestFlight 앱 설치 → 의뢰 등록 → 출발 화면 **확인**을 누르면 알림 권한을 묻는다(처음 한 번). 허용하면 기기 토큰이 서버에 등록된다.
2. 어드민 의뢰 상세 상단 **기기 알림**이 “푸시 토큰 등록됨”인지 본다.
3. QA 도구 **이 기기로 테스트 푸시 보내기** → 알림 발송 기록의 푸시 상태가 `sent`, 기기에 “테스트 알림”이 오면 연결 완료.
4. 모의 데이터로 만든 알림은 원칙대로 푸시하지 않는다(`skipped_mock`). 실제 푸시 흐름은 “모의” 체크 없이 운영자가 실제로 확인한 기록으로 본다.
5. 서버가 Expo 푸시 서비스(exp.host)에 나갈 수 있어야 한다. 앱이 지워져 토큰이 무효가 되면 서버가 그 토큰을 지운다.

## 5. 데이터 구분 — 실제 vs 모의

- 앱에서 등록한 의뢰와 운영자가 어드민에 입력한 기록은 **실제 데이터**다.
- 어드민 입력 폼의 “모의 데이터” 체크, QA 도구 실행 기록, `npm run e2e`의 데이터는 **모의**로 저장되고 앱·어드민에 “모의 데이터” 표시가 붙는다.
- AI 보조(1-1)는 웹 검색으로 판매처를 **찾아볼 뿐**이고, 그 결과는 운영자 검수 전까지 제안으로만 남는다. `WALF_AI_PROVIDER=mock` 결과는 모두 **모의**로 저장·표시된다.
- 판매처 API 연동·외부 채널 자동 게시는 **구현하지 않았다**. 매물 확인과 게시 결과는 운영자가 실제로 확인한 뒤 어드민에 기록한다(PRD: 운영자 검수, 접근 허용 범위 안에서만).

## 6. 아직 연결되지 않은 것

| 항목 | 상태 | 필요한 것 |
|---|---|---|
| 원격 푸시 · TestFlight | Expo 프로젝트 연결·서버 주소 등록 완료(4장). 무료 iPhone 설치본(3장)은 푸시 없음 | 유료 Apple 개발자 계정 → 4장 4번 |
| Android 빌드 | 코드는 공용. 이 맥에 Android SDK 없음. 로컬 http 접속은 `expo-build-properties`의 `usesCleartextTraffic` 필요 | FCM 키 · EAS Build |
| 서버 배포 | 로컬 실행만 | 호스팅·HTTPS·백업 결정 |
| AI 보조 실제 호출 | 코드·요청 형식은 로컬 가짜 API로 검증. 실제 키로는 아직 한 번도 돌리지 않음 | `server/.env`에 `ANTHROPIC_API_KEY` · Console에서 웹 검색 허용 |
