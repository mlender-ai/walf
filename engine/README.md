# WALF 오픈소스 탐색 엔진 (7일 실험 · `experiment/opensource-hunt-7d`)

유료 Claude·OpenAI API 없이 **AI 식별 · 국내 매물 탐색**을 맡는 실험 엔진이에요. 사용자 앱·운영자 어드민·7일 의뢰 정책은 그대로 두고, 서버의 AI 공급자 자리만 바꿔 끼워요. 기본은 꺼져 있어요(`WALF_AI_PROVIDER=oss` 일 때만 켜짐).

```
의뢰 접수 ─▶ 사진 분석(로컬 Ollama · Qwen3-VL 8B instruct) ─▶ 상품 후보 ─▶ 운영자 확정 → 7일 시작
DAY n    ─▶ SearXNG 판매처별 site: 검색 ─▶ Crawl4AI 상품 페이지 확인(robots.txt 허용한 곳만) ─▶ 규칙 판정 ─▶ 운영자 검수 ─▶ 앱
```

| 부분 | 쓰는 것 | 어디서 |
|---|---|---|
| 사진 분석·사진 비교 | Ollama `qwen3-vl:8b-instruct` | 이 맥(사진이 밖으로 나가지 않음) |
| 검색 | SearXNG(Docker) — 네이버·빙·브레이브 | 이 맥 `127.0.0.1:8888` |
| 페이지 정보 | Crawl4AI(헤드리스 크롬) — JSON-LD·메타 우선 | 이 맥 |
| 판정 | `rules.py`(색·사이즈·구매글·판매 완료·같은 상품) | 이 맥 |

## 설치 · 실행

```bash
./engine/start.sh                         # Ollama(brew 서비스)·모델·SearXNG(Docker)·Python 가상환경(~/.walf-oss)
```

서버(실험용, 운영 서버와 다른 포트·DB):

```bash
cd server
cp .env.example .env    # WALF_PORT=4301, WALF_AI_PROVIDER=oss, WALF_QA_TOOLS=0, WALF_PUSH_DISABLED=1
caffeinate -is npm start  # 잠자기 막기(뚜껑을 닫으면 잠들 수 있음)
```

엔진만 따로 돌려 보기:

```bash
echo '{"brand":"BADBLOOD","name":"Mystic Nylon Track Jacket","color":"네이비","size":"M","usedOk":true,"day":0,"note":"품번 W-JKT26-055","sellers":[{"name":"번개장터","domain":"bunjang.co.kr"}],"known":[]}' \
  | ~/.walf-oss/venv/bin/python engine/hunt.py search > out.json    # 진행 기록은 stderr
python3 -m unittest discover -s engine/tests                          # 판정 규칙 테스트(의존 없음)
```

## 하루 1회 · 기록

- 일정은 기존 WALF 스케줄러가 만든다(활성화 시각부터 24시간마다 DAY 1~7). 작업은 한 번에 하나, 작업당 25분 제한, 서버가 두 번 끊긴 작업은 다시 하지 않는다.
- 맥이 꺼져 24시간 창을 넘기면 그날은 **하지 못함**으로 남는다(성공으로 세지 않음).
- 원본 로그: `server/data/hunt-logs/*.log`(작업마다 하나). 지표: 어드민 **7일 실험 리포트**(`/admin/report`).

## 지키는 것

- 유료 API 호출 0. 무료 한도·요청 제한에 걸리면 그 판매처 검색을 멈추고 기록한다(자동 유료 전환·재시도 반복 없음).
- 판매처 robots.txt 의 일반 수집기(`*`) 규칙을 따른다. 무신사·W컨셉은 `Disallow: /` 라서 페이지를 열지 않고 검색 결과만 쓴다. robots.txt 요청이 보안 장치에 막히면(무신사·29CM) 사람이 확인한 저장본(`engine/robots/`, 2026-11-09)을 따르고, 그것도 없으면 열지 않는다.
- 로그인·차단 회피(Crawl4AI `magic`·`simulate_user`·`override_navigator`)는 쓰지 않는다. CAPTCHA·접근 거부를 낸 검색 엔진(구글·덕덕고)은 우회하지 않고 뺐다.
- 검색 결과·페이지 문구는 판정 재료일 뿐 지시로 취급하지 않는다.
- 같은 상품 확정·구매 가능 확인은 운영자만 한다. 엔진은 “같은 상품으로 보임 · 검수 전”까지만.

## 알아 둘 것

- SearXNG 는 검색 엔진의 결과 화면을 대신 받아 오는 방식이라, 각 검색 엔진 약관상 자동 조회 허용 여부가 분명하지 않다. 하루 18~20회로 적게 쓰지만, 운영 채택 전에는 공식 API(네이버 검색 API·Brave Search API, 무료 한도 있음)로 바꾸는 것을 검토한다.
