#!/usr/bin/env python3
"""WALF 실사용 QA 체크리스트 빌더.
python3 qa_build.py            → WALF_QA_Checklist.html (프로젝트 폴더)
python3 qa_build.py --desktop  → + ~/Desktop/공유용/ 단일 독립형 HTML"""
import html, json, os, re, subprocess, sys
from walf_shell import FONT_LINK, DOC_CSS

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'WALF_QA_Checklist.html')
TITLE = 'WALF 실사용 QA 체크리스트'
PRODUCT = 'BADBLOOD Mystic Nylon Track Jacket Navy / M'
AUTO = json.load(open(os.path.join(ROOT, 'qa_results.json'), encoding='utf-8')) if os.path.exists(os.path.join(ROOT, 'qa_results.json')) else {}

# 문서 셸 CSS에서 시안용 이미지 참조만 뺀다(이 문서에는 이미지가 없다)
SHELL = '\n'.join(l for l in DOC_CSS.split('\n') if not re.search(r'url\(assets/', l) or l.startswith(':root'))
SHELL = re.sub(r'--sil-head:url\([^)]*\)', '--sil-head:none', SHELL)
CSS = SHELL + r'''
.sc{border-top:1px solid var(--k-ln);padding:26px 0}
.sc h3{font-size:21px;letter-spacing:-.03em;display:flex;gap:12px;align-items:baseline}
.sc h3 i{font:800 12px ui-monospace,Menlo,monospace;font-style:normal;color:#111;background:#fff;border-radius:5px;padding:4px 7px}
.sc .why{font-size:13.5px;color:var(--k-su);margin-top:6px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px}
.cols h4{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.1em;color:var(--k-su);text-transform:uppercase;margin-bottom:8px}
.steps{counter-reset:s;display:flex;flex-direction:column;gap:6px}
.steps li{counter-increment:s;position:relative;padding-left:26px;font-size:14.5px;line-height:1.65;color:var(--k-mu)}
.steps li:before{content:counter(s);position:absolute;left:0;top:3px;width:18px;height:18px;border-radius:50%;border:1px solid var(--k-ln2);font:700 10.5px/16px ui-monospace,Menlo,monospace;text-align:center;color:var(--k-fg)}
.steps li b,.ck b{color:var(--k-fg)}
.ck{display:flex;flex-direction:column;gap:2px}
.ck label{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;padding:8px 10px;border-radius:10px;cursor:pointer;font-size:14.5px;line-height:1.6;color:var(--k-mu)}
.ck label:hover{background:#ffffff08}
.ck input{width:18px;height:18px;margin:3px 0 0;accent-color:#fff}
.ck input:checked+span{color:var(--k-su);text-decoration:line-through;text-decoration-color:#ffffff40}
.who{display:inline-block;font:700 10.5px ui-monospace,Menlo,monospace;padding:2px 6px;border-radius:4px;margin-right:6px;background:#ffffff14;color:var(--k-fg)}
.who.a{background:#fff;color:#111}
code,.cmd{font:600 13px ui-monospace,Menlo,monospace;background:#ffffff10;border:1px solid var(--k-ln);border-radius:6px;padding:1px 6px;color:var(--k-fg)}
pre.cmd{display:block;padding:12px 14px;white-space:pre-wrap;line-height:1.7;margin-top:8px}
.prg{position:sticky;top:60px;z-index:50;background:rgba(11,11,12,.92);border-bottom:1px solid var(--k-ln);backdrop-filter:blur(12px)}
.prg .in{max-width:var(--k-w);margin:auto;padding:10px var(--k-pad);display:flex;gap:16px;align-items:center;font-size:13.5px;color:var(--k-mu)}
.prg .bar{flex:1;height:4px;border-radius:2px;background:#ffffff14;overflow:hidden}.prg .bar i{display:block;height:100%;width:0;background:#fff}
.prg button{appearance:none;border:1px solid var(--k-ln2);background:none;color:var(--k-mu);border-radius:8px;padding:6px 10px;font:600 12.5px inherit;font-family:inherit;cursor:pointer}
.res{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}
.res>div{padding:18px 20px;border-radius:16px;border:1px solid var(--k-ln);background:var(--k-bg2)}
.res b{display:block;font-size:26px;letter-spacing:-.03em}.res small{display:block;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:var(--k-su);margin-bottom:6px}
.res span{display:block;font-size:13px;color:var(--k-mu);margin-top:4px;line-height:1.55}
.form{white-space:pre-wrap;font:500 13.5px/1.8 ui-monospace,Menlo,monospace;padding:18px 20px;border-radius:14px;border:1px dashed var(--k-ln2);color:var(--k-mu);margin-top:14px}
'''

W = '<span class="who">앱</span>'
A = '<span class="who a">어드민</span>'

SCEN = [
    ('A', '의뢰 등록과 출발 모션', 'PRD 2.3 · R01 · 스펙 S02·S03·M01', [
        f'{W}홈(첫 방문)에서 <b>왈프에게 맡기기</b>',
        f'{W}상품명 <b>BADBLOOD Mystic Nylon Track Jacket Navy</b>, 브랜드 BADBLOOD, 사이즈 M, 색상 네이비, 희망가 입력(선택), 사진 1장(선택)',
        f'{W}<b>이 옷 맡기기</b>',
    ], [
        '버튼을 누른 동안에는 “맡기는 중” 표시만 있고, 서버 접수가 끝난 뒤에 출발 모션이 시작된다',
        '모션: 정면 → 돌아서기 → 멀어지며 사라짐(약 2.5초) → “왈프가 출발했어요!”가 같은 자리에서 올라온다. 한 번만 재생',
        '접수 화면의 다음 단계 1번에 “확인이 끝나면 7일 탐색이 시작돼요”',
        '확인 → 홈: 상태 문장 “어떤 옷인지 확인하고 있어요”, 7일 칸은 비어 있고 “상품 확인 후 시작”',
        '홈에 새 의뢰 버튼이 없고, 맨 아래 “한 번에 한 벌만” 안내가 보인다',
        f'{A}대기열 “상품 확인 대기”에 의뢰가 올라온다. 사진을 넣었다면 상세에서 사진이 보인다',
    ]),
    ('B', '운영자 상품 확인 → 7일 시작', 'PRD 2.3(168시간) · R03 · R06', [
        f'{A}의뢰 상세 → 확인한 브랜드·상품명 확인 → <b>상품 확인 → 7일 탐색 시작</b>',
        f'{W}홈을 당겨서 새로고침(또는 20초 기다리기)',
    ], [
        '앱 상태 문장 “첫 탐색을 준비하고 있어요”, “7일 탐색 · ○월 ○일 ○시 종료” = 확인한 시각 + 7일',
        f'{A}상세 오른쪽 “사용자 앱에 지금 보이는 문장”이 앱과 글자 그대로 같다',
        '활동 일지: 나 · 의뢰 접수 → 왈프 팀 · 의뢰 시작',
        f'{A}“오늘 할 탐색”에 DAY 1이 생기고 마감 시각(24시간 뒤)이 보인다',
    ]),
    ('C', '첫 탐색 기록 → 수배 제안', 'PRD 2.4 · R04 · R07 · 06(탐색 미발견)', [
        f'{A}DAY 1 탐색 기록: 실제로 확인한 판매처만 “확인함”, 접속이 안 된 곳은 “접속 실패”, 메모 작성',
        f'{A}결과 “조건에 맞는 매물 없음 → 수배 제안”으로 저장',
    ], [
        '확인한 판매처가 0곳이면 저장이 거부된다',
        '앱 상태 문장 “수배지를 붙여볼까요?” + “N곳을 살폈지만…” + 버튼 수배지 미리보기',
        '앱 ALERTS에 “수배지를 붙여볼까요?” 알림(안 읽음 점), 하단 탭 ALERTS에 검은 점',
        '추적함 “확인한 판매처”에 판매처별 결과가 그대로 보이고, 접속 실패는 “접속하지 못함”으로 따로 표시',
    ]),
    ('D', '수배 동의 — 승인 ≠ 게시', 'PRD 2.4 · R08 · 스펙 S07 · 7.2', [
        f'{W}수배지 미리보기 → 공개 항목 켜고 끄기(사진·사이즈/색상·희망가) → 미리보기 반영 확인',
        f'{W}<b>수배 동의하기</b>',
    ], [
        '브랜드·모델은 끌 수 없고, 사진이 없는 의뢰는 사진 토글이 비활성',
        '동의 직후 상태 문장 “수배지 게시를 준비하고 있어요 · 아직 올라가지 않았어요” — 게시 완료로 보이지 않는다',
        f'{A}“수배 게시 대기”에 세 채널(번개장터·중고나라·후루츠패밀리)이 올라온다',
        f'{A}공개 승인 항목이 상세에 그대로 표시',
        '(대안) “비공개로 계속 찾기”를 고르면 추적함 공개 수배 “비공개로 찾고 있어요”',
    ]),
    ('E', '채널 게시 결과 기록', 'PRD 2.4 · R08 · R09', [
        f'{A}실제로 게시한 채널: 게시 완료 + 게시글 주소',
        f'{A}게시하지 못한 채널: 올리지 않음 + 사유(예: 구매 희망글을 받지 않는 채널)',
    ], [
        '주소 없이 “게시 완료”, 사유 없이 “올리지 않음”은 저장이 거부된다',
        '앱 상태 문장 “수배지를 붙이고 왔어요 · ○○에 게시했어요. ○○에는 올리지 않았어요.”',
        '추적함 공개 수배: 채널별 상태·시각, 게시글 열기 버튼(외부)',
        '활동 일지에 채널별 기록과 운영자 이름(어드민에서만)',
    ]),
    ('F', '정기 탐색(2일차 이후)', 'PRD 0(하루 1회) · R05', [
        f'{A}(실시간) 다음 날 같은 시각 이후 “오늘 할 탐색”에 DAY 2 생성 확인 — 또는 QA 도구 <b>일정 24시간 당기기</b>',
        f'{A}DAY 2 기록 → 결과 “새 소식 없음”',
    ], [
        '탐색 작업은 하루 하나, 최대 7개까지만 생긴다',
        '앱 “오늘 판매처 N곳을 살폈어요 · 다음 탐색은 내일 예정이에요”, 추적함 달력에 DAY 01·02 채운 점',
        'QA 도구를 쓴 경우 일지에 “운영 테스트: 일정 24시간 당김”이 모의 표시와 함께 남는다',
    ]),
    ('G', '유력 후보(확인 전)', 'PRD 2.5 · 스펙 S06 · M04', [
        f'{A}새 후보 등록: 출처 <b>판매자 제보</b>, 판매처·링크·사이즈 M·가격·배송비, 일치 등급 <b>동일 상품 유력</b>, 구매 가능 상태 <b>재고 미확인</b>, “아직 확인 중인 것” 입력, 공개',
        f'{W}홈·추적함·결과 화면 확인',
    ], [
        '홈 “새로운 단서를 물어왔어요” + 후보 줄(테두리 배지)',
        '결과 화면: 배지 테두리 “동일 상품 유력” + 점선 “재고 미확인”, 가격이 회색 + “아직 확인 전”, 검은 버튼 없음(“판매글 직접 보기” 테두리 버튼)',
        '판매자 제보는 이 단계에서 ALERTS 알림이 생기지 않는다(PRD: 검증된 제보만 알림)',
        '(비교) 출처를 “왈프 팀 탐색”으로 등록하면 “왈프가 단서를 물어왔어요” 알림이 1번 생긴다',
    ]),
    ('H', '구매 가능 확인 → 알림', 'PRD 2.5 · R06 · R11 · 스펙 S09 · M05', [
        f'{A}같은 후보 수정: <b>동일 상품 확인</b> + <b>구매 가능 확인</b>, 확인 시각 “지금으로”, 근거 3줄(“같은 옷이에요 | 케어라벨 품번이 …”)',
    ], [
        '확인 시각 없이 “구매 가능 확인”은 저장이 거부된다',
        '앱 ALERTS “왈프가 물어왔어요! … 총 ○원 · ○○에서 판매 중이에요(○시 확인)” — 1번만(다시 저장해도 늘지 않음)',
        '홈 “조건에 맞는 매물을 찾았어요” + 확인하기 버튼',
        '결과 화면: 채운 배지 2개, 검은 가격, 희망가와의 차이, 조건 4칸, 근거 목록, 확인 시각, 검은 “○○에서 보기” 버튼',
        '희망가보다 비싸게 바꾸면 “찾았지만 아직 예산보다 비싸요”로 바뀌고 구매 가능 알림이 생기지 않는다',
    ]),
    ('I', '외부 구매 → 구매 확인 → 완료', 'PRD 2.5(링크 클릭 ≠ 구매) · R12', [
        f'{W}결과 화면 <b>○○에서 보기</b> → 인앱 브라우저 → 닫기',
        f'{W}“구매하셨나요?” → <b>샀어요</b>',
    ], [
        '링크를 연 것만으로 완료되지 않고, 돌아온 뒤 묻는다(“아직이요”를 고르면 그대로 진행)',
        '홈이 첫 방문 화면 + “지난 의뢰 · 구매 완료” 줄로 바뀐다(새 의뢰 가능)',
        f'{A}“수배글 삭제 요청”에 게시했던 채널이 올라온다 → 삭제함으로 처리',
        '지난 의뢰 기록에서 남은 탐색 작업이 취소돼 있다',
    ]),
    ('J', '7일 종료', 'PRD 2.3 · R12 · 스펙 S10 · M06', [
        f'{W}새 의뢰 등록 → {A}상품 확인',
        f'{A}QA 도구 <b>지금 7일 종료 처리</b>(또는 실제로 168시간 경과)',
    ], [
        '앱 ALERTS “7일 탐색이 끝났어요 · 이번에는 빈 입으로 돌아왔어요…”',
        '홈은 첫 방문 + 지난 의뢰 줄, 지난 의뢰 기록 상단에 종료 상태',
        '종료 후 탐색 작업이 더 생기지 않는다(다음 날 확인)',
    ]),
    ('K', '탐색 실패 ≠ 매물 없음', '스펙 7.2 · PRD 08(실패 기록)', [
        f'{A}탐색 기록에서 한 곳을 “접속 실패”로 저장',
        f'{A}또는 DAY 작업을 마감까지 비워 두기(24시간 · QA 도구로 당겨 확인 가능)',
    ], [
        '“이번 탐색을 다 하지 못했어요 · 판매처 N곳에 접속하지 못했어요. 매물이 없다는 뜻은 아니에요.”',
        '마감된 작업은 “예정된 탐색을 하지 못했어요”, 달력에 점선 점, 일지 “○ 탐색을 하지 못했어요”',
    ]),
    ('L', '정보 보완 요청', 'PRD 2.3 · 06(정보 보완 필요)', [
        f'{A}확인 전 의뢰에서 보완 요청 보내기',
        f'{W}홈 “정보가 조금 더 필요해요” → 정보 보내기(설명·링크·사진)',
    ], [
        '보완 대기 중에는 7일이 흐르지 않는다(종료 시각 없음)',
        '답을 보내면 다시 “어떤 옷인지 확인하고 있어요”, 어드민 “상품 확인 대기”로 돌아온다',
    ]),
    ('M', '조건 수정 · 그만두기 · 데이터 삭제', 'PRD R02 · 06 · 10(계정 삭제)', [
        f'{W}추적함 구매 조건 <b>수정</b> → 사이즈 L → 저장',
        f'{W}추적함 맨 아래 <b>의뢰 그만두기</b>',
        f'{W}MY → 내 의뢰·알림 데이터 삭제',
    ], [
        '일지 “구매 조건 변경 · 사이즈 M → L · 다음 탐색부터 적용”',
        '그만두기는 확인 창을 거친 뒤 처리되고, 게시된 수배지는 삭제 요청으로 넘어간다',
        '데이터 삭제 후 앱이 새 사용자로 시작하고, 어드민에서 해당 의뢰가 사라진다',
    ]),
]

UI = [
    ('긴 상품명', '60자 넘는 상품명으로 등록 — 홈 2줄, 후보 줄 1줄 말줄임, 결과 화면 3줄, 어드민 전체 표시'),
    ('사진 없음', '사진 없이 등록 — 홈 타일·추적함 썸네일에 “사진 없이 맡긴 옷” 자리 표시가 보이고 레이아웃이 무너지지 않는다'),
    ('이미지 표시(로컬)', '시뮬레이터에서 업로드 사진·판매자 사진이 보인다(http://localhost)'),
    ('이미지 표시(실기기·LAN)', '실기기에서 MY → 서버 주소를 맥 IP로 바꾼 뒤 같은 사진이 보인다(서버는 요청한 주소 기준으로 이미지 주소를 만든다)'),
    ('캐릭터 리소스', '첫 방문 강아지·상태 아바타·결과 머리말·출발 모션이 비행기 모드에서도 보인다(앱에 포함된 리소스)'),
    ('서버 연결 끊김', '서버를 끄고 앱 새로고침 — “연결이 원활하지 않아요” + 다시 시도, 등록 화면에서는 입력값이 남은 채 오류 문구'),
    ('빈 상태', '알림 0개 — “아직 소식이 없어요”, 의뢰 없을 때 추적함 — “진행 중인 의뢰가 없어요” + 맡기기 버튼'),
    ('글자 크게', '설정 → 손쉬운 사용 → 더 큰 텍스트 최대 — 문장은 줄바꿈되고 탭·배지·7일 칸은 깨지지 않는다'),
    ('VoiceOver', '탭(선택 상태), 버튼 이름, 배지, 후보 줄(배지+판매처+가격), 출발 완료 안내 낭독'),
    ('모션 줄이기', '설정 → 손쉬운 사용 → 동작 줄이기 켬 — 출발 모션 없이 멀리 있는 왈프 정지 이미지 + 결과 바로'),
    ('터치 영역', '아이콘 버튼·텍스트 버튼·탭이 44pt 이상으로 눌린다'),
    ('작은 화면', 'iPhone SE(3세대) 시뮬레이터 — 첫 방문 헤드라인과 강아지가 겹치지 않고 버튼이 탭바에 가리지 않는다'),
]

DATA = [
    '어드민에서 “모의 데이터”를 체크한 후보·탐색·게시는 앱에 “모의 데이터” 표시가 붙는다(결과 화면 상단 배너, 후보 줄, 판매처 목록, 알림)',
    '“모의”를 체크하지 않은 운영자 기록은 표시 없이 나온다 — 실제로 확인한 것만 체크 해제로 입력한다',
    'QA 도구(일정 당김·즉시 종료) 실행 기록은 항상 모의 표시와 함께 일지에 남는다',
    '판매처 자동 조회·외부 채널 자동 게시는 없다 — 어떤 화면도 사람이 기록하지 않은 탐색·게시를 완료로 보여주지 않는다',
]

GAPS = [
    ('원격 푸시', '서버 발송·앱 토큰 등록 코드는 있지만 이 빌드는 Expo 프로젝트 ID가 없어 토큰을 받지 못한다. 알림은 ALERTS 탭(앱 안)에서만 확인. 어드민 알림 기록에 “푸시: no_token”으로 그대로 남는다.', 'Expo 계정으로 eas init → app.json extra.eas.projectId · Apple 푸시 키'),
    ('실기기 설치 빌드', '시뮬레이터 빌드만 로컬에서 만들었다.', 'Apple 개발자 계정 서명(Xcode 또는 EAS) → TestFlight'),
    ('Android', '코드는 공용이지만 이 맥에 Android SDK가 없어 빌드·실행 확인을 못 했다.', 'Android Studio/SDK 또는 EAS Build'),
    ('서버 배포', '맥에서 로컬 실행. 실기기 QA는 같은 Wi-Fi에서 맥 IP로 접속.', '호스팅·HTTPS·DB 백업·운영 비밀번호 결정'),
    ('사용자 인증', '기기마다 만든 무작위 ID로 구분(베타용). 앱 삭제·재설치 시 기존 의뢰에 다시 접근할 수 없다.', '로그인 방식 결정(애플·카카오 등)'),
    ('2차 디자인 화면', '수배 동의·정보 보완·조건 수정·MY는 1차 시안의 부품만으로 만든 기능 화면이다(새 컨셉 없음). 디자인 검수 대상.', '2차 화면 시안'),
]


def ck(id_, text):
    return f'<label><input type="checkbox" data-k="{id_}"><span>{text}</span></label>'


def build():
    scen = ''.join(
        f'<div class="sc" id="sc-{k}"><h3><i>{k}</i>{t}</h3><p class="why">근거 · {why}</p><div class="cols"><div><h4>하는 일</h4><ol class="steps">{"".join(f"<li>{s}</li>" for s in steps)}</ol></div>'
        f'<div><h4>확인할 것</h4><div class="ck">{"".join(ck(f"{k}{i}", e) for i, e in enumerate(exp))}</div></div></div></div>'
        for k, t, why, steps, exp in SCEN)
    ui = '<div class="ck">' + ''.join(ck(f'U{i}', f'<b>{a}</b> — {b}') for i, (a, b) in enumerate(UI)) + '</div>'
    data = '<div class="ck">' + ''.join(ck(f'D{i}', x) for i, x in enumerate(DATA)) + '</div>'
    gaps = '<table class="tb2"><thead><tr><th scope="col">항목</th><th scope="col">지금 상태</th><th scope="col">연결에 필요한 것</th></tr></thead><tbody>' + ''.join(
        f'<tr><th scope="row">{a}</th><td>{b}</td><td>{c}</td></tr>' for a, b, c in GAPS) + '</tbody></table>'
    res = ''.join(f'<div><small>{k}</small><b>{v}</b><span>{d}</span></div>' for k, v, d in AUTO.get('cards', []))
    auto_rows = ''.join(f'<li>{x}</li>' for x in AUTO.get('notes', []))
    total = sum(len(s[4]) for s in SCEN) + len(UI) + len(DATA)
    nav = ''.join(f'<a href="#{h}"><i>{n}</i>{t}</a>' for h, n, t in [('setup', '01', '준비'), ('auto', '02', '자동 검증'), ('flow', '03', '시나리오'), ('ui', '04', '화면·접근성'), ('data', '05', '실제·모의'), ('gaps', '06', '미연결'), ('bug', '07', '버그 기록')])
    body = f'''
<section class="sec first cv" id="top"><div class="wrap">
<p class="eb">WALF · MVP VERTICAL SLICE · 실사용 QA</p>
<h1>실사용 QA 체크리스트<span>첫 테스트 상품 — {PRODUCT}</span></h1>
<p class="meta"><b>등록 → 운영자 검수 → 추적 → 수배 승인 → 결과 알림 → 종료</b><i></i>iOS 시뮬레이터 빌드 · 로컬 서버 · {AUTO.get("date", "")}</p>
<p class="lead">이 문서는 실제 기기와 실제 운영자 입력으로 한 바퀴를 돌며 확인할 항목이다. 체크 표시는 <b>이 브라우저에만</b> 저장된다. 판매처 탐색과 채널 게시는 자동이 아니라 <b>운영자가 실제로 확인한 뒤 어드민에 기록</b>하는 방식이다.</p>
</div></section>
<section class="sec" id="setup"><div class="wrap"><header class="sh"><p class="eb">01 · SETUP · 준비</p><h2 class="h2">서버를 켜고,<br><span class="g2">앱을 붙인다</span></h2></header>
<div class="two"><div><h3 class="h3" style="font-size:18px">서버 · 어드민</h3><pre class="cmd">cd ~/Desktop/WALF/server
npm start
# 어드민  http://localhost:4300/admin
# 비밀번호  server/.env 의 WALF_ADMIN_PASSWORD
# 운영자 이름은 로그인 때 적은 이름이 일지에 남는다</pre></div>
<div><h3 class="h3" style="font-size:18px">앱</h3><pre class="cmd"># 시뮬레이터 (Xcode 필요)
cd ~/Desktop/WALF/app
npx expo run:ios
# 이미 설치된 빌드를 쓸 때
xcrun simctl install booted {AUTO.get("app_path", "WALF.app")}
# 실기기(같은 Wi-Fi): MY → 서버 주소 → http://&lt;맥 IP&gt;:4300</pre></div></div>
<p class="note">첫 QA는 빈 DB(server/data/walf.db)에서 시작한다. 자동 검증에 쓴 데이터는 별도 임시 DB에서 돌고 지워졌다.</p></div></section>
<section class="sec" id="auto"><div class="wrap"><header class="sh"><p class="eb">02 · AUTOMATED · 자동 검증</p><h2 class="h2">사람이 보기 전에<br><span class="g2">기계로 먼저 돈 것</span></h2></header>
<div class="res">{res}</div><ul class="lst" style="margin-top:18px">{auto_rows}</ul></div></section>
<section class="sec" id="flow"><div class="wrap"><header class="sh"><p class="eb">03 · SCENARIOS · 세로형 흐름</p><h2 class="h2">BADBLOOD 한 벌로<br><span class="g2">처음부터 끝까지</span></h2>
<p class="lead">A→I가 한 의뢰의 한 바퀴, J→M은 별도 의뢰로 확인하는 분기다. <span class="who">앱</span> <span class="who a">어드민</span>은 어느 쪽에서 하는 일인지 표시한다.</p></header>{scen}</div></section>
<section class="sec" id="ui"><div class="wrap"><header class="sh"><p class="eb">04 · UI · 화면과 접근성</p><h2 class="h2">긴 이름, 빈 칸, 끊긴 연결,<br><span class="g2">큰 글자에서도</span></h2></header>{ui}</div></section>
<section class="sec" id="data"><div class="wrap"><header class="sh"><p class="eb">05 · DATA · 실제와 모의</p><h2 class="h2">테스트 데이터는<br><span class="g2">항상 표시가 붙는다</span></h2></header>{data}</div></section>
<section class="sec" id="gaps"><div class="wrap"><header class="sh"><p class="eb">06 · NOT CONNECTED · 아직 연결되지 않은 것</p><h2 class="h2">성공으로 처리하지 않고<br><span class="g2">미연결로 남긴 것</span></h2></header>{gaps}</div></section>
<section class="sec" id="bug"><div class="wrap"><header class="sh"><p class="eb">07 · BUG REPORT · 버그 기록 양식</p><h2 class="h2">발견한 문제는<br><span class="g2">이 형식으로</span></h2></header>
<div class="form">[시나리오] 예: G-2
[기기·OS] 예: iPhone 15 · iOS 26.5 / 시뮬레이터 iPhone 17 Pro
[의뢰 번호] 어드민 #번호 · 모의 여부
[한 일] 1) … 2) …
[기대] 체크리스트 문장
[실제] 화면에 보인 것(스크린샷)
[어드민 상태 문장] 의뢰 상세 오른쪽 “사용자 앱에 지금 보이는 문장”</div>
<div class="foot2"><b>WALF.</b><span>기준: MVP Product Definition v0.3 · WALF_Core_Screens(1차 시안 승인본)</span></div></div></section>'''
    js = f'''(() => {{
  const K = 'walf.qa.v1', total = {total};
  let st = {{}}; try {{ st = JSON.parse(localStorage.getItem(K) || '{{}}'); }} catch (e) {{}}
  const boxes = [...document.querySelectorAll('.ck input')];
  const upd = () => {{ const n = boxes.filter(b => b.checked).length; document.querySelector('.prg b').textContent = n + ' / ' + total; document.querySelector('.prg .bar i').style.width = (n / total * 100) + '%'; }};
  boxes.forEach(b => {{ b.checked = !!st[b.dataset.k]; b.addEventListener('change', () => {{ st[b.dataset.k] = b.checked; try {{ localStorage.setItem(K, JSON.stringify(st)); }} catch (e) {{}} upd(); }}); }});
  document.querySelector('.prg button').addEventListener('click', () => {{ if (!confirm('체크 표시를 모두 지울까요?')) return; st = {{}}; try {{ localStorage.removeItem(K); }} catch (e) {{}} boxes.forEach(b => b.checked = false); upd(); }});
  upd();
  const links = [...document.querySelectorAll('.tnav a')], secs = links.map(a => document.querySelector(a.getAttribute('href')));
  const on = () => {{ const y = scrollY + 140; let k = -1; secs.forEach((s, i) => {{ if (s && s.offsetTop <= y) k = i; }}); links.forEach((a, i) => a.classList.toggle('on', i === k)); }};
  addEventListener('scroll', on, {{ passive: true }}); on();
}})();'''
    page = (f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{TITLE}</title>{FONT_LINK}<style>{CSS}</style></head><body>'
            '<a class="skip" href="#main">본문으로 건너뛰기</a>'
            f'<header class="top"><div class="in"><a class="brand" href="#top"><b>WALF.</b><small>실사용 QA</small></a><nav class="tnav" aria-label="문서 섹션">{nav}</nav></div></header>'
            '<div class="prg" role="status"><div class="in"><span>확인</span><b>0</b><div class="bar"><i></i></div><button type="button">체크 지우기</button></div></div>'
            f'<main id="main">{body}</main><script>{js}</script></body></html>')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(page)
    print('wrote', OUT, f'{len(page) / 1024:.0f}KB', 'checks', total)
    if '--desktop' in sys.argv:
        subprocess.run([os.path.expanduser('~/html-standalone/bin/share'), OUT], check=False)


if __name__ == '__main__':
    build()
