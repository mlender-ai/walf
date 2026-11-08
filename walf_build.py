#!/usr/bin/env python3
"""WALF 핵심 화면 1차 시안 문서 빌더.
python3 walf_build.py            → WALF_Core_Screens.html (프로젝트 폴더, 개발용)
python3 walf_build.py --desktop  → + ~/Desktop/공유용/ 단일 독립형 HTML"""
import json, os, subprocess, sys
from walf_screens import SCREENS, APP_CSS, STM_STATES, stm_card, tag, avatar, tabbar, BRAND, NAME
from walf_shell import FONT_LINK, DOC_CSS, DOC_JS, LBX_HTML

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'WALF_Core_Screens.html')
TITLE = 'WALF 핵심 화면 — 첫 방문 · 의뢰 진행 · 매물 발견'


def phone(sid, s=0.86, cid='', t='', d='', scroll=0):
    sc = f' data-scroll="{scroll}"' if scroll else ''
    return (f'<figure class="ph" style="--s:{s}"{sc}><div class="pf"><div class="pi" inert aria-hidden="true">{SCREENS[sid]()}</div></div>'
            f'<figcaption class="pc"><em class="id">{cid}</em><b>{t}</b><span>{d}</span></figcaption></figure>')


def sec(sid, eb, a, b, lead, body, first=False):
    return (f'<section class="sec{" first" if first else ""}" id="{sid}"><div class="wrap">'
            f'<header class="sh"><p class="eb">{eb}</p><h2 class="h2">{a}<br><span class="g2">{b}</span></h2>'
            f'<p class="lead">{lead}</p></header>{body}</div></section>')


def sub(eb, h, lead='', body=''):
    ld = f'<p class="lead">{lead}</p>' if lead else ''
    return f'<div class="sub"><p class="eb">{eb}</p><h3 class="h3">{h}</h3>{ld}{body}</div>'


def anno(rows):
    return '<dl class="an">' + ''.join(f'<div><dt>{k}<small>{e}</small></dt><dd>{v}</dd></div>' for k, e, v in rows) + '</dl>'


def contract(role, act, state, rej):
    return ('<div class="dc">' + ''.join(f'<div><small>{k}</small><span>{v}</span></div>' for k, v in
                                         [('화면 역할', role), ('기본 액션', act), ('상태', state), ('거부한 패턴', rej)]) + '</div>')


def table(head, rows, cls=''):
    th = ''.join(f'<th scope="col">{h}</th>' for h in head)
    tr = ''.join('<tr' + (' class="hl"' if r and r[0].startswith('!') else '') + '>' +
                 ''.join((f'<th scope="row">{c.lstrip("!")}</th>' if i == 0 else f'<td>{c}</td>') for i, c in enumerate(r)) + '</tr>' for r in rows)
    return f'<table class="tb2 {cls}"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>'


# ── 표지 ───────────────────────────────────────────────────────
QUESTIONS = [
    ('왈프는 어떤 인상으로 기억되어야 하나?', 'brand'),
    ('라이코스에서 무엇을 가져오고, 무엇을 버리나?', 'brand'),
    ('색 없이 상태를 어떻게 구분하나?', 'system'),
    ('처음 온 사람은 3초 안에 무엇을 알아야 하나?', 's01'),
    ('의뢰가 진행 중일 때 홈은 무엇을 먼저 보여주나?', 's04'),
    ('왈프가 실제로 한 일은 어디서 증명하나?', 's04'),
    ('‘유력 후보’와 ‘구매 가능 매물’은 어떻게 다르게 보이나?', 's06'),
    ('출발 GIF는 언제, 어떤 조건에서 재생되나?', 'motion'),
    ('2차에서 무엇을 만들고, 무엇을 먼저 정해야 하나?', 'next'),
    ('PRD의 정책은 화면 어디에 반영됐나?', 'apx'),
]
SEC_NO = {'brand': '01', 'system': '02', 's01': '03', 's04': '04', 's06': '05', 'motion': '06', 'next': '07', 'apx': 'A'}


def cover():
    qs = ''.join(f'<a href="#{h}"><i>{i + 1:02d}</i><span>{q}</span><em>→ {SEC_NO[h]}</em></a>' for i, (q, h) in enumerate(QUESTIONS))
    return ('<section class="sec first cv" id="top"><div class="wrap"><div class="gr"><div>'
            '<p class="eb">WALF · VISUAL PROTOTYPE · 1차 검수</p>'
            '<h1>왈프 핵심 화면 3종<span>첫 방문 · 의뢰 진행 · 매물 발견</span></h1>'
            '<p class="meta"><b>브랜드 인상과 앱 UI 완성도</b><i></i>iOS · Android 앱 · 국내 탐색 MVP · 2026-11-08</p>'
            '<p class="lead">옷을 맡기면 왈프가 국내 판매처를 살피고, 없으면 동의를 받아 수배한다. 이 문서는 그 약속이 '
            '<b>처음 보는 순간, 기다리는 동안, 결과를 받는 순간</b>에 어떻게 보이는지를 정한다. '
            '<b>캐릭터는 중요한 순간에만 크게, 정보는 언제나 실제로 한 일만.</b></p></div>'
            '<div class="lock" role="img" aria-label="WALF 워드마크와 검은 래브라도 잠금 조합">'
            '<p class="lk-q">넌 그냥 올려.<span>왈프가 물어올게.</span></p><i class="lk-d im-stand"></i><b class="lk-w">WALF.</b></div></div>'
            f'<nav class="cvq" aria-label="이 문서가 답하는 질문"><p class="t">이 문서가 순서대로 답하는 질문</p>{qs}</nav>'
            '</div></section>')


# ── 01 브랜드 ──────────────────────────────────────────────────
def brand():
    frames = ''.join(
        f'<figure class="fr"><div><i style="background-position:{p}% 0"></i><small>{t}</small></div><figcaption>{n}</figcaption></figure>'
        for p, t, n in [(0, '0.00s', '정면 — 의뢰를 받는다'), (2 / 11 * 100, '0.34s', '고개를 돌린다'), (5 / 11 * 100, '0.85s', '출발한다')])
    assets = [
        ('HERO', 'Hero Character', '첫 방문 · 브랜드 소개', '<i class="h1x im-stand"></i>', '<span class="pill w">보유 · GIF 1프레임</span>'),
        ('MOTION', 'Motion Character', '출발 · 탐색 · 발견', '<i class="mo"></i>', '<span class="pill w">M01 보유</span> <span class="pill d">M02~M06 제작</span>'),
        ('STATIC', 'Static Character', '빈 상태 · 7일 종료', '<i class="st im-stand"></i>', '<span class="pill d">앉은 자세 제작</span>'),
        ('SYMBOL', 'Symbol', '아바타 · 앱 아이콘 · 알림', '<i class="av3"></i><i class="ai" style="width:64px;height:64px;border-radius:15px"></i>', '<span class="pill w">시안 · 프레임에서 추출</span>'),
        ('SILHOUETTE', 'Silhouette', '로딩 대체 · 좁은 공간', '<i class="sl"></i><i class="slb"></i>', '<span class="pill w">시안 · 실루엣 추출</span>'),
    ]
    ast = ''.join(f'<div><div class="vz">{v}</div><div class="tx"><small>{k}</small><b>{n}</b><span>{u}</span>{st}</div></div>'
                  for k, n, u, v, st in assets)
    refs = table(['레퍼런스', '가져온 것', '가져오지 않은 것'], [
        ['LYCOS', '검은 <b>실물</b> 강아지를 브랜드 얼굴로 쓴다 · 굵은 대문자 워드마크 · “찾아온다”는 행동이 곧 브랜드', '로고 형태·강아지 포즈 복제 · 초기 웹의 장식적 그래픽'],
        ['KREAM', '흰 바탕 + 강한 검정 타이포 · 상품 사진과 가격을 가장 크게 · 떠 있는 하단 탭', '거래·입찰 중심 구조 · 홈 상단 카테고리 탭 · 빨간 알림 점'],
        ['FRUITSFAMILY', '중고 매물의 실제 사진을 그대로 보여주는 정직함 · 장식 없는 리스트', '탐색 피드·셔플 · 채팅 중심 흐름'],
        ['29CM', '여백으로 이미지를 세우는 에디토리얼 구도 · 큰 제목과 짧은 문장', '긴 매거진형 콘텐츠 · 브랜드 스토리 피드'],
    ])
    scale = ''.join(f'<div><small>{k}</small><b>{t}</b><span>{d}</span><div class="bar"><i style="width:{w}%"></i></div></div>' for k, t, d, w in [
        ('크게', '첫 방문 · 출발 모션', '화면 높이의 절반까지. 캐릭터가 주인공인 유일한 순간.', 100),
        ('중간', '발견 순간의 머리말', '헤드라인 옆에 84px. 상품 사진보다 작게, 첫 시선만 받는다.', 45),
        ('작게', '상태 문장의 아바타', '28px 원 안의 얼굴 사진. 상태를 “말하는 사람”만 표시.', 18),
        ('없음', '상품 정보 · 목록 · 일지', '사진·가격·근거가 있는 곳에는 넣지 않는다.', 0),
    ])
    body = (
        '<div class="bs"><div class="pan wh"><p class="lb">Brand scene · 잠금 조합</p><div class="wl"><i class="d im-stand"></i><b class="w">WALF.</b></div></div>'
        '<div class="wk"><div class="pan bk"><p class="lb">On dark</p><div class="wkb">WALF.</div></div>'
        '<div class="pan"><p class="lb">Symbol · 시안</p><div class="sym"><figure><i class="ai"></i><figcaption>앱 아이콘</figcaption></figure>'
        '<figure><i class="av3"></i><figcaption>상태 아바타</figcaption></figure><figure><i class="ni"></i><figcaption>알림 아이콘</figcaption></figure></div></div></div></div>'
        '<div class="spec"><div><b>굵은 대문자 + 마침표</b><span>무거운 그로테스크 대문자, 자간 −5.5%. 마침표는 “끝까지 물어온다”는 끝맺음이자 상표의 고정 요소.</span></div>'
        '<div><b>쓰는 크기</b><span>앱 상단 23px(높이 17pt 내외) · 브랜드 장면 64px 이상. 한글 ‘왈프’는 본문 글꼴로 쓰고 워드마크로 만들지 않는다.</span></div>'
        '<div><b>지금은 방향 시안</b><span>Pretendard Black으로 짠 임시 워드마크. W의 각도·마침표 크기를 다듬은 전용 레터링은 2차에서 만든다.</span></div></div>'
        + sub('CHARACTER · WALF 하운드', '말이 아니라 행동으로 감정을 전한다',
              '실제 개의 비율, 짧고 윤기 있는 검은 털, 아래로 처진 귀. 옷이나 소품을 입히지 않는다. 평소에는 조용하고, 소식을 물어올 때만 크게 나온다.',
              f'<div class="chr">{frames}<div class="trait"><b>성격</b><p>충직함 · 집요함 · 꼼꼼함 · 성실함, 가끔 엉뚱한 유머</p>'
              '<q>“침은 안 묻혔습니다.”</q><p>유머는 결과가 확정된 순간에 한 줄만. 확인 전·실패·오류에는 농담하지 않는다.</p></div></div>'
              f'<div class="ast">{ast}</div>'
              '<p class="note">앱 아이콘·알림 아이콘은 출발 GIF 3프레임의 옆얼굴 윤곽, 상태 아바타는 1프레임의 얼굴 사진에서 뽑은 시안이다. 같은 개에서 나와 실사 캐릭터와 외형(처진 귀, 긴 주둥이)이 일치한다.</p>')
        + sub('CHARACTER SCALE · 등장 크기', '캐릭터가 커지는 순간을 미리 정해둔다', '',
              f'<div class="scale">{scale}</div>')
        + sub('REFERENCE · 참고와 거리두기', '브랜드는 라이코스, 인터페이스는 현대 패션 플랫폼', '', refs)
    )
    return sec('brand', '01 · BRAND · 브랜드 방향', '브랜드는 라이코스처럼,', '화면은 패션 플랫폼처럼',
               '검은 실물 강아지와 굵은 대문자 워드마크로 기억에 남기고, 상품과 상태 정보는 흰 바탕·검은 글자의 조용한 화면으로 보여준다. '
               '둘이 섞이지 않도록 <b>캐릭터가 크게 나오는 순간을 미리 정해둔다.</b>', body)


# ── 02 시스템 ──────────────────────────────────────────────────
def system():
    sw = ''.join(f'<div><i style="background:{c};{b}"></i><div class="tx"><b>{n}</b><code>{c}</code><span>{u}</span></div></div>' for n, c, u, b in [
        ('Black', '#111111', '주요 텍스트 · 버튼 · 로고 · 확인 배지', ''),
        ('White', '#FFFFFF', '기본 배경', ''),
        ('Canvas', '#F7F7F7', '상품 사진 바탕 · 정보 묶음', ''),
        ('Surface', '#F1F1F1', '구분 띠 · 선택된 탭 · 불일치 배지', ''),
        ('Gray 500', '#767676', '보조 설명 · 시각 · 비활성 탭', ''),
        ('Gray 300', '#D9D9D9', '테두리 · 아직 오지 않은 날', ''),
        ('Dark Surface', '#202020', '브랜드 장면 · 어두운 카드', 'box-shadow:inset 0 0 0 1px #ffffff1a'),
    ])
    ty = ''.join(f'<div><small>{k} · {s}</small><p style="font-size:{s}px;font-weight:{w}">{t}</p></div>' for k, s, w, t in [
        ('Display', 35, 800, '넌 그냥 올려.'), ('Page Title', 26, 800, '추적함'), ('Moment', 24, 800, '왈프가 물어왔어요!'),
        ('Status', 21, 800, '새로운 단서를 물어왔어요'), ('Product', 17, 600, '울 집업 블루종 브라운'),
        ('Body', 15, 400, '7일 동안 국내 판매처를 살펴요'), ('Supporting', 13, 400, '오늘 오전 9:12 · 판매처 6곳'), ('Label', 11, 700, 'DAY 03 · LOWFIELD')])
    spx = ''.join(f'<div><i style="width:{v}px;height:{v}px"></i><small>{v}</small></div>' for v in [4, 8, 12, 16, 20, 24, 32])
    rdx = ''.join(f'<div><i style="border-radius:{r}px"></i><small>{n}</small></div>' for r, n in [(4, '4 · 배지'), (8, '8 · 썸네일'), (12, '12 · 카드·버튼'), (28, '999 · 탭바')])
    tags = ''.join(f'{tag(k, t)}<span>{d}</span>' for k, t, d in [
        ('v', '구매 가능 확인', '채움 — 왈프 팀이 확인을 끝냄'), ('o', '동일 상품 유력', '테두리 — 가능성이 높지만 확정 아님'),
        ('p', '재고 미확인', '점선 — 판매글은 있지만 아직 확인 전'), ('x', '옵션 불일치', '회색 — 같은 옷이지만 조건이 다름')])
    comp = (
        '<div class="cmpk">'
        f'<div><p class="lb">Evidence tag · 증거 배지</p><div class="wa"><div class="tgl">{tags}</div></div>'
        '<p class="cap">상태는 색이 아니라 <b>채움 → 테두리 → 점선 → 회색</b>의 형태 차이로 읽힌다. 문구는 PRD 2.5의 일치 등급·구매 가능 상태 용어를 그대로 쓴다.</p></div>'
        '<div><p class="lb">Button · 버튼</p><div class="wa" inert><div class="row"><button class="btn pri">왈프에게 맡기기</button><button class="btn sec">추적함에서 자세히 보기</button><button class="lnk" style="padding:4px 0">이 매물은 넘기고 계속 찾기</button></div></div>'
        '<p class="cap">검은 버튼은 한 화면에 하나. 확인이 끝난 구매 연결에만 검은 버튼을 쓰고, 확인 전 매물은 테두리 버튼으로 낮춘다.</p></div>'
        f'<div><p class="lb">Tab bar · 하단 탭</p><div class="wa" inert aria-hidden="true">{tabbar("HOME", dot="ALERTS")}</div>'
        '<p class="cap">HOME · TRACKING · ALERTS · MY. 추적함 아이콘은 발자국. 새 알림은 빨간 점 대신 검은 점. 결과 화면처럼 한 단계 들어간 화면에서는 숨긴다.</p></div>'
        '</div>')
    body = (f'<div class="sw">{sw}</div>'
            f'<div class="sys2"><div class="ty">{ty}</div><div class="sp2"><div class="pan"><p class="lb">Spacing · 4pt 단위 · 좌우 여백 20</p><div class="spx">{spx}</div></div>'
            f'<div class="pan"><p class="lb">Radius · 카드와 입력은 같은 12</p><div class="rdx">{rdx}</div></div>'
            '<div class="pan"><p class="lb">Type · Pretendard</p><p class="sm" style="margin-top:10px">한글 가독성을 위해 Pretendard 하나로 통일한다. 가격·시각은 고정폭 숫자(tabular)로 정렬한다. '
            '시스템 글자 크기 확대 시 상태 문장은 줄바꿈되고, 숫자 칸(7일 칸·가격)은 줄어들지 않는다.</p></div></div></div>'
            + comp)
    return sec('system', '02 · SYSTEM · UI 토큰과 부품', '색은 빼고,', '형태와 명도로 상태를 말한다',
               'MVP는 포인트 컬러 없이 흑백 일곱 단계로 만든다. <b>화면에서 가장 색이 강한 것은 언제나 상품 사진</b>이다. '
               '‘확인됨 · 유력 · 확인 중 · 불일치’는 채움·테두리·점선·회색 같은 형태 차이로 구분하고, 의미 색(오류·위험)은 따로 검토한다.', body)


# ── 03 첫 방문 ─────────────────────────────────────────────────
def first_visit():
    rows = [
        ('정보 위계', 'HIERARCHY', '<ol><li><b>검은 하운드</b> — 시선이 가장 먼저 닿는 곳</li><li><b>헤드라인</b> “넌 그냥 올려. 찾는 건 왈프가 할게.”</li>'
                                    '<li><b>보조 문구</b> — 무엇을(국내 판매처·중고 매물), 얼마나(7일)</li><li><b>CTA</b> “왈프에게 맡기기”</li>'
                                    '<li><b>이용 조건 한 줄</b> — 무료 베타 · 한 번에 한 벌 · 하루 한 번 탐색</li></ol>'),
        ('상품 이미지 비중', 'IMAGE WEIGHT', '<b>0%</b>. 아직 맡긴 옷이 없으므로 추천 상품이나 피드로 빈자리를 채우지 않는다. 대신 캐릭터가 화면 높이의 약 <b>47%</b>(375px)를 차지하는, 캐릭터가 주인공인 유일한 화면이다.'),
        ('캐릭터 위치', 'CHARACTER', '오른쪽에 정면으로 선 왈프(출발 GIF 첫 프레임). 헤드라인은 왼쪽 아래, <b>강아지 발끝과 같은 바닥선</b>에 맞췄다 — 라이코스 광고의 “글자 옆에 선 개” 구도를 세로 화면으로 옮긴 것. 글자 열은 150px 이하로 두어 강아지 몸과 겹치지 않는다.'),
        ('내비게이션', 'NAVIGATION', '하단 탭 <b>HOME · TRACKING · ALERTS · MY</b>를 첫 방문부터 보여 앱 구조를 미리 알린다. 상단에는 워드마크만 두고 검색·장바구니는 없다 — 사용자가 직접 찾는 앱이 아니기 때문.'),
        ('CTA', 'ACTION', '검은 버튼 하나, 높이 54px, 엄지가 닿는 아래쪽. 누르면 사진·링크·상품명 중 하나를 고르는 의뢰 등록(S02)으로 간다. 두 번째 버튼(둘러보기·로그인)은 두지 않는다.'),
        ('UX 라이팅', 'WRITING', '헤드라인만 반말 — 친구가 “내가 해줄게” 하는 브랜드 목소리. 보조 문구부터는 해요체. <q>검색해 드려요</q> 대신 <q>살펴볼게요</q> — 사용자의 일이 아니라 왈프의 일로 쓴다. 무료·한 벌·하루 한 번은 숨기지 않고 첫 화면에서 말한다.'),
    ]
    body = (f'<div class="sr"><div class="phs">{phone("s01", 0.9, "S01", "첫 방문 홈", "의뢰가 없는 상태 · 탭 HOME")}</div>'
            f'<div>{anno(rows)}{contract("서비스 약속을 한 장면으로 전달", "옷 맡기기(사진·링크·상품명)", "의뢰 없음 — 첫 방문, 의뢰 종료 후 재방문", "상품 피드, 기능 소개 카드 3장, 온보딩 슬라이드")}'
            '<p class="note">의뢰가 끝난 뒤 다시 들어오면 같은 화면 아래에 “지난 의뢰 결과 보기” 한 줄이 붙는다(2차). 사진 출처는 출발 GIF — 고해상도 원본이 필요하다(07 참고).</p></div></div>')
    return sec('s01', '03 · FIRST VISIT · 첫 방문 홈', '넌 그냥 올려.', '찾는 건 왈프가 할게.',
               '처음 온 사람이 3초 안에 알아야 할 것은 두 가지다. <b>왈프가 대신 찾아준다는 것, 사진이나 링크 하나면 시작된다는 것.</b> '
               '피드·추천·기능 설명은 넣지 않고, 캐릭터를 가장 크게 쓰는 화면으로 둔다.', body)


# ── 04 의뢰 진행 ───────────────────────────────────────────────
def active():
    rows = [
        ('정보 위계', 'HIERARCHY', '<b>홈</b><ol><li><b>맡긴 옷</b> — 사진·브랜드·이름·내 조건</li><li><b>상태 문장</b> — 지금 왈프가 하고 있는 일 한 문장</li>'
                                    '<li><b>새 결과</b> — 있을 때만 상태 문장 아래에 붙는다</li><li><b>7일 칸 · 마지막/다음 탐색</b></li><li><b>최근 활동 3줄</b> → 추적함</li></ol>'
                                    '<b>추적함</b> — 7일 일정 → 발견한 매물 → 구매 조건 → 공개 수배 → 확인한 판매처 → 활동 일지 순. 결과에 가까운 것이 위.'),
        ('상품 이미지 비중', 'IMAGE WEIGHT', '홈 상단 타일 320×256 — 첫 화면의 약 <b>32%</b>. 상태 문장보다 먼저 보이지만 화면을 독차지하지 않는다. 추적함에서는 64px 썸네일로 줄이고 기록을 앞세운다.'),
        ('캐릭터 위치', 'CHARACTER', '<b>28px 얼굴 아바타 하나</b>(GIF 첫 프레임의 얼굴)가 상태 문장 앞에 붙어 “누가 한 일인지”만 알린다. 반복 애니메이션(냄새 맡기)은 쓰지 않는다 — 백그라운드 탐색 중에는 마지막·다음 탐색 시각이 더 정직한 신호다.'),
        ('내비게이션', 'NAVIGATION', '홈과 추적함 모두 <b>탭 루트</b>. 홈의 “추적함에서 자세히 보기”와 “전체 보기”는 TRACKING 탭으로 전환한다. 활성 의뢰가 1건이므로 추적함은 목록 없이 바로 그 의뢰를 열고, 지난 의뢰는 맨 아래 한 줄로 둔다.'),
        ('CTA', 'ACTION', '진행 중에는 <b>새 의뢰 버튼이 없다</b>(1인 1벌). 대신 홈 맨 아래에 이유를 한 줄로 설명한다. 주 행동은 새 결과 확인(유력 후보 줄)이고, 조건 수정·수배 내리기·의뢰 그만두기는 추적함 안의 텍스트 버튼으로 낮춘다.'),
        ('UX 라이팅', 'WRITING', '상태 문장은 <b>실제 작업 기록에서만</b> 만든다: <q>새로운 단서를 물어왔어요</q>(제보 접수), <q>오늘 판매처 6곳을 살폈어요</q>(탐색 완료). '
                                 '활동 일지는 행위자를 <b>왈프(자동 탐색) · 왈프 팀(운영자) · 나</b>로 나눠 적는다. “열심히 찾는 중” 같은 빈 문장은 쓰지 않는다.'),
    ]
    stm = ''.join(f'<div><div class="sk"><code>{s[0]}</code><span>{ko}</span></div><div inert>{stm_card(s)}</div></div>' for s, ko in zip(STM_STATES, [
        '상품 확인 중', '첫 탐색 준비', '탐색 중 · 새 소식 없음', '수배 동의 대기', '수배 게시 대기', '수배 게시 완료',
        '유력 후보', '구매 가능 확인', '가격 초과 관찰', '7일 종료', '일부 실패', '구매 완료']))
    body = ('<div class="phs" style="justify-content:space-between">'
            + phone('s04', 0.86, 'S04', '의뢰 진행 홈', 'DAY 03 · 제보 1건 확인 중')
            + phone('s05', 0.86, 'S05', '추적함 · 위', '7일 일정 · 발견한 매물 · 구매 조건')
            + phone('s05', 0.86, 'S05', '추적함 · 아래', '수배 채널 · 확인한 판매처 · 활동 일지', scroll=900)
            + '</div><div style="margin-top:48px">' + anno(rows)
            + contract('지금 상태와 맡긴 옷을 한 묶음으로', '새 결과 확인 → 추적함', '탐색 중 · 수배 · 유력 후보 등 12가지(아래)', '가짜 진행률, 빙글빙글 도는 캐릭터, “찾는 중…” 빈 문장')
            + '</div>'
            + sub('STATUS MODULE · 같은 자리, 다른 문장', '홈 한가운데 상태 문장 — 12가지 상태',
                  '상태 문장은 홈의 같은 자리에 들어간다. 아바타 + 시각(언제 일어난 일인지) + 한 문장 + 필요한 경우에만 버튼. '
                  '<b>“매물 없음”과 “확인 실패”, “수배 승인”과 “게시 완료”를 다른 문장으로 나눴다.</b>',
                  f'<div class="stg">{stm}</div>'))
    return sec('s04', '04 · ACTIVE HUNT · 의뢰 진행 홈 · 추적함', '기다리는 동안에도,', '왈프가 한 일이 보인다',
               '진행 중 홈은 <b>맡긴 옷과 지금 상태를 한 묶음</b>으로 보여준다. 상태 문장은 실제 작업 기록에서만 만들고, '
               '캐릭터는 작은 아바타로 “누가 했는지”만 알린다. 증거(확인한 판매처·게시 채널·일지)는 추적함에 모은다.', body)


# ── 05 매물 발견 ───────────────────────────────────────────────
def found():
    cmp = [('헤드라인', '“새로운 단서를 물어왔어요”', '“왈프가 물어왔어요!” + “침은 안 묻혔습니다.”'),
           ('배지', '테두리 <b>동일 상품 유력</b> · 점선 <b>재고 미확인</b>', '채움 <b>동일 상품 확인</b> · 채움 <b>구매 가능 확인</b>'),
           ('가격', '회색 숫자 + “판매자가 적은 가격 · 아직 확인 전”', '검은 숫자 + 배송비 포함 총액 + 희망가와의 차이'),
           ('근거', '“지금까지 확인한 것” / “아직 확인 중인 것”을 나눠 적음', '같은 옷 · 사이즈 · 판매 중 — 세 가지 확인 근거와 확인 시각'),
           ('주 버튼', '테두리 버튼 “판매글 직접 보기” — 검은 버튼 없음', '검은 버튼 “번개장터에서 보기” — 외부 앱·웹으로 이동'),
           ('캐릭터', '같은 크기의 왈프(머리말) — 발견 모션 M04 자리', '같은 크기의 왈프(머리말) — 귀환 모션 M05 자리'),
           ('알림', '제보로 들어온 후보는 <b>보내지 않음</b>(앱 안에만 표시) · 탐색으로 찾은 유효 후보만 “단서를 물어왔어요”', '“왈프가 물어왔어요!” — 가격·사이즈·확인 시각을 함께 알림')]
    cm = '<div class="cmp2"><span class="h"></span><span class="h">유력 후보 · Lead Found</span><span class="h">구매 가능 확인 · Offer Verified</span>' + ''.join(
        f'<span class="r">{a}</span><span>{b}</span><span>{c}</span>' for a, b, c in cmp) + '</div>'
    rows = [
        ('정보 위계', 'HIERARCHY', '<ol><li><b>머리말</b> — 무엇이 일어났는지(물어왔다 / 단서다)</li><li><b>판매자 사진</b> — 실제로 팔리는 그 옷</li>'
                                    '<li><b>배지 2개</b> — 같은 옷인가 · 지금 살 수 있나를 따로</li><li><b>가격</b> — 배송비 포함 총액, 희망가와 차이</li>'
                                    '<li><b>조건 4칸 → 확인 근거 → 판매처·확인 시각 → 유의사항</b></li></ol>'),
        ('상품 이미지 비중', 'IMAGE WEIGHT', '판매자 사진 320×320 — 첫 화면의 <b>40%</b>로 세 화면 중 가장 크다. 공식 상품 사진이 아니라 <b>실제 매물 사진</b>을 보여주고 “판매자 사진” 표시를 붙인다. 공식 사진과의 비교는 근거 문장으로 대신한다.'),
        ('캐릭터 위치', 'CHARACTER', '머리말 오른쪽 84px, 아래쪽이 흐려지며 사진 바로 위에 선다. 발견 모션(M04/M05)이 끝나면 이 자리에 멈춘다 — <b>모션이 끝나는 곳이 곧 시선이 상품으로 내려가는 출발점</b>. 사진·가격 영역에는 캐릭터를 넣지 않는다.'),
        ('내비게이션', 'NAVIGATION', '알림·홈·추적함에서 들어오는 <b>한 단계 아래 화면</b>. 뒤로 버튼, 하단 탭 대신 고정 CTA 바. 구매는 외부(번개장터)에서 일어나므로 돌아왔을 때 “구매하셨나요?”를 묻는다(2차).'),
        ('CTA', 'ACTION', '확인된 매물만 <b>검은 버튼</b> “번개장터에서 보기 ↗”. 바로 위에 “중고 매물은 먼저 팔릴 수 있어요 · 오후 3:10 확인”을 붙여 확인 시점을 잊지 않게 한다. 넘기고 계속 찾기는 본문 끝 텍스트 버튼.'),
        ('UX 라이팅', 'WRITING', '농담 “침은 안 묻혔습니다”는 <b>확인이 끝난 경우에만</b>. 유력 후보에서는 “같은 옷일 가능성이 높아요”로 단정하지 않는다. 결제·정품·안전결제 유의사항은 꾸미지 않은 회색 상자 한 개로.'),
    ]
    nf = ''.join(f'<div><p class="nfk">{k}</p><div class="nf"><i class="ni2"></i><div><p class="hh"><b>WALF</b><span>{tm}</span></p><p><b>{t}</b>{d}</p></div></div></div>' for k, tm, t, d in [
        ('LEAD · 탐색으로 찾은 유효 후보', '오전 9:14', '왈프가 단서를 물어왔어요', '찾던 블루종과 같은 옷일 수 있어요. 사이즈와 재고를 확인하고 있어요.'),
        ('OFFER VERIFIED · 구매 가능 확인 · 검증된 제보', '오후 3:11', '왈프가 물어왔어요!', '블루종 M · 총 232,000원 · 번개장터에서 판매 중이에요(오후 3:10 확인).'),
        ('PRICE MET · 희망가 충족', '오전 9:20', '희망가 이하로 나왔어요', '후루츠패밀리 M 240,000원 · 왈프 팀이 사이즈와 판매 여부를 확인했어요.'),
        ('EXPIRED · 7일 종료', '오전 10:00', '7일 탐색이 끝났어요', '이번에는 빈 입으로 돌아왔어요. 확인한 내용을 정리해뒀어요.')])
    body = ('<div class="phs" style="justify-content:space-between">'
            + phone('s06v', 0.86, 'S06', '매물 발견 · 구매 가능 확인', '운영자 확인 후 · 첫 화면')
            + phone('s06v', 0.86, 'S06', '매물 발견 · 근거', '조건 · 확인 근거 · 유의사항', scroll=520)
            + phone('s06l', 0.86, 'S06', '같은 매물 · 유력 후보', '운영자 확인 전 · 오전 10:40 제보')
            + '</div>'
            + sub('SAME LISTING · 같은 매물, 다른 확신', '확인 전과 후는 배지 · 가격 · 버튼 무게가 다르다', '', cm)
            + '<div style="margin-top:56px">' + anno(rows)
            + contract('구매 판단에 필요한 근거를 한 화면에', '외부 판매처로 이동(확인된 매물만)', '유력 후보 · 구매 가능 확인 · (2차) 판매 완료됨', '축하 폭죽·전체 화면 성공 연출, 확인 전 매물의 “구매하기” 버튼')
            + '</div>'
            + sub('NOTIFICATION · 알림 문구', '유력 후보와 구매 가능 매물은 다른 문장으로 알린다', '',
                  f'<div class="nfs">{nf}</div><p class="nfx"><b>보내지 않는 알림</b> — 매일 “오늘도 찾는 중이에요” 같은 정기 푸시 · <b>운영자 확인 전의 판매자 제보</b>(PRD: 검증된 제보만 알림 — 앱 안 상태 문장으로만 보여준다) · 확인 전의 “구매 가능” · 수배 게시 완료(앱 안 일지로) · 해외 탐색을 암시하는 문장.</p>'))
    return sec('s06', '05 · FOUND · 매물 발견 결과', '왈프가 물어왔어요!', '침은 안 묻혔습니다.',
               '발견 화면은 축하보다 판단을 돕는다. 같은 매물이라도 <b>운영자가 확인하기 전(유력 후보)과 후(구매 가능 확인)</b>는 배지·가격 표기·버튼 무게가 다르다. '
               '검은 구매 버튼은 확인이 끝난 매물에만 나온다.', body)


# ── 06 모션 ────────────────────────────────────────────────────
DM_NOTES = {
    's01': ('① 첫 방문 홈', '“왈프에게 맡기기”를 눌러 보세요. 실제 앱에서는 의뢰 등록(S02, 2차)을 거친 뒤 서버가 접수를 확인하면 출발 모션이 재생됩니다.'),
    's03a': ('② 출발 · 접수 확인', '정면 0.35초 → 고개·몸 돌림 → 멀어지며 사라짐(2.04초) → 같은 자리에서 접수 결과가 올라옵니다. 한 번만 재생됩니다.'),
    's04p': ('③ 접수 직후 홈', '아직 7일이 시작되지 않은 상태. 왈프 팀이 상품을 확인해야 기간이 흐릅니다. 오른쪽 ④를 눌러 이틀 뒤로 가 보세요.'),
    's04': ('④ DAY 03 홈', '수배글을 본 판매자가 제보했습니다. 상태 문장 아래 “유력 후보” 줄을 눌러 보세요. 탭의 TRACKING은 추적함으로 갑니다.'),
    's05': ('⑤ 추적함', '7일 일정, 확인한 판매처, 게시 채널, 활동 일지 — 왈프가 실제로 한 일이 모두 여기에 있습니다.'),
    's06l': ('⑥ 유력 후보', '확인 전이라 검은 버튼이 없습니다. 오른쪽 ⑦은 같은 매물이 운영자 확인을 마친 뒤의 모습입니다.'),
    's06v': ('⑦ 구매 가능 확인', '배지가 채워지고, 가격이 검게 바뀌고, 검은 구매 버튼이 생깁니다. 뒤로 버튼은 이전 화면으로 돌아갑니다.'),
}


def motion():
    sbd = ''.join(f'<figure><div class="fx"><i style="background-position:{i / 11 * 100:.3f}% 0"></i></div><figcaption>{i * 0.17:.2f}s</figcaption></figure>' for i in range(12))
    ph5 = ('<div class="ph5" style="grid-template-columns:2fr 1fr 2fr 7fr .9fr">'
           '<div><b>바라보기</b>사용자와 눈을 맞춘다</div><div><b>고개</b>방향을 정한다</div><div><b>돌아서기</b>출발 자세</div>'
           '<div><b>달려 나가기</b>멀어질수록 작아짐 · 원근</div><div class="q"><b>결과</b>2.5s~</div></div>')
    stp = ''.join(f'<button type="button" data-id="{k}"><i>{n}</i><span>{t}</span><em>{c}</em></button>' for k, n, t, c in [
        ('s01', '01', '첫 방문 홈', 'S01'), ('s03a', '02', '출발 · 접수 확인', 'M01'), ('s04p', '03', '접수 직후 — 7일 시작 전', 'S04'),
        ('s04', '04', 'DAY 03 — 제보 도착', 'S04'), ('s05', '05', '추적함', 'S05'), ('s06l', '06', '유력 후보', 'S06'), ('s06v', '07', '구매 가능 확인', 'S06')])
    rules = ''.join(f'<li><b>{k}</b><span>{v}</span></li>' for k, v in [
        ('재생 조건', '서버가 <b>의뢰 접수를 확인한 뒤</b> 한 번. 버튼을 누른 순간 재생해 로딩을 가리지 않는다. 접수 실패 시 재생하지 않고 오류를 보여준다.'),
        ('순서', '정면 응시를 0.35초 붙잡은 뒤 출발 → 왈프가 사라진 자리에서 결과가 아래에서 위로(14px, 0.42초) 올라온다 → 버튼이 0.12초 늦게.'),
        ('문구', '“왈프가 출발했어요!”는 <b>접수</b>를 뜻한다. 7일은 운영자 확인 후 시작되므로 다음 단계 1번에 “확인이 끝나면 7일이 시작돼요”를 적었다.'),
        ('다시 보기', '같은 의뢰에서는 다시 재생하지 않는다. 홈으로 돌아와도 출발 장면은 반복되지 않는다.'),
        ('모션 줄이기', 'iOS 동작 줄이기 · Android 애니메이션 제거가 켜져 있으면 달리는 장면 없이 <b>멀리 있는 왈프 정지 이미지 + 결과</b>를 바로 보여준다.'),
        ('접근성', '스크린 리더에는 “왈프가 출발했어요. 의뢰가 접수됐어요.”를 한 번 읽어준다. 모션만으로 상태를 전달하지 않는다.')])
    mtab = table(['모션', '재생하는 때', '재생하지 않는 때', '길이 · 반복', '리소스', '모션 줄이기'], [
        ['!M01 출발', '의뢰 접수 확인 직후', '접수 실패 · 같은 의뢰 재방문', '약 2.5초 · 1회', '<b>보유</b>(GIF 358px · 5.9fps) → 고해상도 재제작', '멀리 있는 정지 이미지'],
        ['M02 냄새 맡기', '앱을 연 채로 첫 탐색이 실제 실행 중일 때만', '백그라운드 정기 탐색 · 결과 대기', '반복 · 최대 10초 후 정지', '제작 필요', '아바타 + 시각 문구'],
        ['M03 수배지', '채널 게시가 <b>실제로 완료된</b> 뒤', '승인만 하고 게시 전 · 게시 거절', '약 1.8초 · 1회', '제작 필요(수배지를 문 자세)', '게시 채널 목록만'],
        ['M04 단서', '유력 후보가 접수되어 결과 화면을 처음 열 때', '확인 전 매물을 다시 열 때', '약 1.5초 · 1회', '제작 필요(작은 택을 문 자세)', '머리말 정지 이미지'],
        ['M05 귀환', '운영자가 구매 가능을 확인한 결과를 처음 열 때', '판매 완료로 바뀐 뒤', '약 2초 · 1회', '제작 필요(정면으로 달려와 택을 내려놓음)', '머리말 정지 이미지'],
        ['M06 빈 입', '7일 종료 보고서를 처음 열 때', '사용자가 그만둔 의뢰', '약 1.5초 · 1회', '제작 필요(빈 입으로 와서 앉음)', '앉은 정지 이미지'],
        ['M07 해외', '— (MVP 제외)', '항상', '—', '만들지 않음', '—'],
    ])
    tune = ''.join(f'<li><b>{k}</b> — {v}</li>' for k, v in [
        ('프레임', '지금 GIF는 프레임당 0.17초(약 6fps)라 달리기가 끊겨 보인다. 실제 리소스는 24~30fps.'),
        ('해상도', '358px → 최소 1080px. 첫 방문 홈에서 2배 이상 확대해 쓰기 때문에 지금 원본으로는 흐리다.'),
        ('가속', '돌아선 뒤 처음 두 걸음은 느리게, 이후 가속 — 지금은 같은 속도로 작아진다.'),
        ('그림자', '바닥 그림자가 몸과 함께 작아지며 사라지게. 마지막 프레임에 잔상이 남지 않게.'),
        ('역재생 금지', 'M05 귀환을 출발 GIF 역재생으로 만들면 뒷모습으로 뒷걸음질쳐 다가온다. 정면으로 달려오는 장면을 따로 만든다.'),
        ('형식', 'iOS는 알파 HEVC 또는 이미지 시퀀스, Android는 WebP 애니메이션 또는 Lottie(이미지 시퀀스). 흰 바탕 고정이면 알파 없이도 된다.')])
    notes = json.dumps(DM_NOTES, ensure_ascii=False)
    body = (sub('STORYBOARD · 출발 GIF 12프레임', '2.04초 동안 일어나는 일', '', f'<div class="sbd">{sbd}</div>{ph5}')
            + sub('CONNECT · 직접 눌러 보기', '모션이 끝나는 자리에서 화면이 이어진다',
                  '폰 안의 버튼을 누르거나 오른쪽 단계를 고르세요. 2단계에서 출발 모션이 재생됩니다. 화면 속 상품·사진·가격·판매처 이름은 시안용 예시입니다.',
                  '<div class="dm"><figure class="ph" style="--s:.86"><div class="pf"><div class="pi"></div></div></figure>'
                  f'<div class="ctl"><div class="stp" role="group" aria-label="시연 단계">{stp}</div><div class="dmn" aria-live="polite"></div>'
                  '<div class="dmo"><button type="button" class="rp" hidden>출발 다시 재생</button><label><input type="checkbox" id="rm">모션 줄이기로 보기</label></div>'
                  f'<ul class="rules">{rules}</ul></div></div><script type="application/json" id="dm-notes">{notes}</script>')
            + sub('FROM GIF TO ASSET · 레퍼런스에서 리소스로', '지금 GIF를 실제 앱 리소스로 바꿀 때 고칠 것', '', f'<ul class="lst">{tune}</ul>')
            + sub('MOTION PLAN · M01~M07', '모든 모션은 실제로 일어난 일 뒤에만 재생한다', '', mtab))
    return sec('motion', '06 · MOTION · 출발 GIF와 화면 연결', '버튼을 누른 순간이 아니라,', '접수가 확인된 뒤에 달린다',
               '출발 모션(M01)은 로딩을 가리는 장치가 아니다. 서버가 의뢰 접수를 확인한 순간 한 번만 재생하고, '
               '<b>왈프가 화면 깊숙이 사라진 자리에서 접수 결과가 올라온다.</b> 다른 모션도 같은 원칙 — 실제로 한 일 뒤에만.', body)


# ── 07 다음 단계 ───────────────────────────────────────────────
def nxt():
    plan = table(['화면', '담을 것', '이번 시안에서 이어받는 것', '새로 정할 것'], [
        ['S02 의뢰 등록', '사진 · 링크 붙여넣기 · 상품명 / 공유 시트 진입(P1)', 'CTA 문구 “이 옷 맡기기”, 검은 버튼 1개', '클립보드 링크 자동 감지 · 사진 여러 장 · 등록 중단 시 임시 저장'],
        ['S02 상품 식별 · 보완', 'AI 후보 · “이 옷이 맞나요?” · 정보 보완 요청', '증거 배지(유력 / 확인 중)', '후보가 여러 개일 때 고르는 방식 · 식별 불가 문구'],
        ['S02 구매 조건', '사이즈 · 색상 · 희망가(배송비 포함) · 중고 허용', '조건 4칸, “다음 탐색부터 적용”', '“나중에 입력” 시 알림 정확도 안내'],
        ['S03 출발 · 접수', '출발 모션 · 접수 요약 · 다음 단계 3개', '이번 모션 연결 시안 그대로', '푸시 권한 요청 시점(이 화면이 가장 자연스러움)'],
        ['S07 수배 동의', '첫 탐색 결과 · 수배지 미리보기 · 공개 정보 · 채널', '상태 문장 “수배지를 붙여볼까요?”', '공개 항목 켜고 끄기 · 비공개 추적 유지 선택'],
        ['S08 수배 진행', '게시 채널 · 링크 · 시각 · 제보 · 수배 내리기', '추적함의 채널 목록', '게시 거절 · 삭제됨 표기, 철회 처리 상태'],
        ['S09 알림 목록', '새 매물 · 희망가 · 제보 · 확인 요청 · 종료 보고', '알림 문구 4종, 검은 점', '읽음 처리 · 결과가 사라진 알림(판매 완료)'],
        ['S10 7일 종료', '탐색 일수 · 확인한 판매처 · 후보 · 수배 · 피드백', '“빈 입으로 돌아왔어요”', '보고서 구성 · VOC 질문 배치 · 새 의뢰 연결'],
        ['빈 · 오류 상태', '탐색 일부 실패 · 링크 만료 · 판매 완료 · 권한 거부', '“확인 실패 ≠ 매물 없음” 문장 원칙', '재시도 안내 · 운영자 지연 시 문구'],
    ])
    impl = ''.join(f'<li><b>{k}</b> — {v}</li>' for k, v in [
        ('하단 탭', '떠 있는 알약형 탭은 iOS 26 탭바 모양과 맞고, Android는 같은 아이콘·라벨의 Navigation bar로 바꿔도 구조가 같다. 커스텀 구현 시 Safe Area 하단 여백을 지킨다.'),
        ('외부 구매 이동', '번개장터·중고나라 앱이 있으면 앱으로, 없으면 인앱 브라우저(SFSafariViewController · Custom Tabs). 앱으로 돌아오면 “구매하셨나요?” 시트를 띄운다.'),
        ('출발 모션', '이미지 시퀀스 또는 동영상 한 개로 충분하다. 1080px · 24fps · 2.5초 기준 1MB 안팎을 목표로 하고, 앱에 포함해 첫 재생 지연을 없앤다.'),
        ('글자 확대', 'Dynamic Type · 글꼴 크기 설정에서 상태 문장·일지는 줄바꿈으로 늘어나고, 7일 칸·탭·가격 숫자는 고정 높이를 유지한다.'),
        ('푸시', 'APNs · FCM. 알림 4종은 각각 다른 딥링크(결과 화면 · 추적함 · 보고서)로 연다. 권한 거부 시 홈 상태 문장 아래에 한 줄로 안내.'),
        ('사진', '판매자 사진은 링크 미리보기로 쓰는지, 저장해 보여주는지에 따라 권리 처리가 다르다(결정할 것 ⑤).')])
    dcz = ''.join(f'<div><small>{n}</small><b>{t}</b><p>{d}</p></div>' for n, t, d in [
        ('①', '워드마크를 전용 레터링으로 다시 그릴까?', '지금은 Pretendard Black 임시안. <em>제안: 1차 검수에서 방향만 확정하고 2차에서 W·마침표를 다듬는다.</em>'),
        ('②', '캐릭터 원본을 어떻게 확보할까?', '현재 GIF는 358px · 6fps. 첫 방문 홈과 브랜드 장면에는 1080px 이상 정지 컷과 24fps 이상 동작이 필요하다. 촬영인지 생성인지에 따라 M02~M06 일정이 달라진다.'),
        ('③', '탭 이름은 영문인가 한글인가?', '스펙의 HOME · TRACKING · ALERTS · MY를 따랐다. 한글(홈 · 추적함 · 알림 · MY)은 더 쉽지만 브랜드 톤이 약해진다. <em>제안: 영문 유지, 화면 제목은 한글(추적함).</em>'),
        ('④', '구매 완료는 어떻게 확인할까?', '외부 구매라 앱이 알 수 없다. 돌아왔을 때 묻기 · 다음 날 한 번 묻기 · 7일 보고서에서 묻기 중 어디까지 할지.'),
        ('⑤', '판매자 사진을 결과 화면에 그대로 보여줘도 될까?', '정보 가치가 가장 크지만 사진 권리가 판매자에게 있다. 링크 미리보기 수준(원본 링크 함께 표시)으로 제한할지 정해야 한다.'),
        ('⑥', '확인 전 후보도 푸시로 알릴까?', 'PRD는 “유효 후보 · 검증된 제보”만 알리고, 디자인 스펙은 유력 후보용 알림 문구를 따로 두라고 한다. 시안은 <em>탐색으로 찾은 유효 후보는 알림, 판매자 제보는 확인 후 알림</em>으로 나눴다. 확인 시각은 운영자가 판매자에게 확인한 시각으로 표기했다.'),
        ('⑦', '조건을 바꾸면 결과는 어떻게 되나?', '시안은 “다음 탐색부터 적용”. 이미 찾은 매물을 새 조건으로 다시 판정할지(PRD 미정) 정해야 화면 문구가 확정된다.'),
        ('⑧', '오류·위험에 의미 색을 쓸까?', '흑백만으로 구분했지만 사기 의심 제보·판매 완료 같은 경고는 색이 필요할 수 있다. 쓰면 빨강 한 가지로 제한하는 안을 제안한다.')])
    body = (sub('PHASE B · 2차 화면', '검수 후 같은 규칙으로 넓힐 화면', '', plan)
            + sub('BUILD NOTES · 구현 가능성', 'iOS · Android에서 그대로 만들 수 있게', '', f'<ul class="lst">{impl}</ul>')
            + sub('DECIDE · 결정할 것', '2차로 넘어가기 전에 정할 여덟 가지', '', f'<div class="dcz">{dcz}</div>'))
    return sec('next', '07 · NEXT · 2차 계획과 결정할 것', '세 화면이 정해지면,', '같은 규칙으로 나머지를 만든다',
               '이번 시안에서 정한 것 — 증거 배지, 상태 문장, 캐릭터 등장 크기, 출발 모션 연결 — 을 2차 화면에 그대로 이어 쓴다. '
               '<b>검수 전에는 전체 화면이나 개발을 시작하지 않는다.</b>', body)


# ── 부록 ───────────────────────────────────────────────────────
def appendix():
    a1 = table(['PRD · 스펙의 정책', '화면에 반영한 곳'], [
        ['사용자당 활성 의뢰 1건', '진행 중 홈에 새 의뢰 버튼 없음 + 맨 아래 이유 한 줄 · 추적함은 목록 없이 그 의뢰를 바로 연다'],
        ['7일 탐색 · 활성화부터 168시간', '7일 칸(홈) · 날짜 달력(추적함) · “11월 13일(금) 오전 10시 종료” · 확인 전에는 “7일 시작 전”'],
        ['국내 하루 1회 탐색', '“마지막 탐색 / 다음 탐색” 두 칸 · 달력의 탐색 완료 점 · 출발 화면 다음 단계 2번'],
        ['운영자 결과 검수', '증거 배지 4종 · 결과 화면의 “왈프 팀이 이렇게 확인했어요”와 확인 시각 · 일지의 행위자 “왈프 팀”'],
        ['사용자 승인 후 공개 수배', '상태 문장 “수배지를 붙여볼까요?” · 승인·게시 대기·게시 완료를 다른 문장으로 · 게시 안 한 채널은 사유와 함께'],
        ['해외 탐색 제외', '모든 문장에 “국내” 명시 · 해외를 암시하는 문구 금지 · M07은 만들지 않음'],
        ['확인하지 않은 매물을 구매 가능하다고 표현하지 않음', '유력 후보에는 검은 버튼 없음 · 회색 가격 + “아직 확인 전” · 알림 문구 분리'],
        ['캐릭터를 과하게 쓰지 않음', '등장 크기 4단계(크게 · 중간 · 작게 · 없음) · 상품 정보 영역에는 캐릭터 없음'],
        ['알림은 유효 후보 · 조건 충족 · 검증된 제보 · 7일 종료만', '알림 4종 · 제보는 운영자 확인 후에만 · “보내지 않는 알림” 목록 · 출발 화면 다음 단계 3번'],
        ['외부 링크 클릭 ≠ 구매 완료', '돌아왔을 때 “구매하셨나요?”로 따로 확인(결정할 것 ④)'],
    ])
    a2 = table(['상태(스펙 7.1)', '사용자 표현', '홈 상태 문장', '주 행동', '알림', '캐릭터'], [
        ['Draft', '의뢰 작성 중', '— (첫 방문 홈 유지)', '이어서 맡기기', '없음', '없음'],
        ['Submitted', '왈프에게 맡겼어요', '출발 화면', '확인', '없음', '<b>M01 출발</b>'],
        ['Identification Pending', '어떤 옷인지 확인 중이에요', '어떤 옷인지 확인하고 있어요', '—', '정보 보완 요청 시만', '아바타'],
        ['First Search Pending', '첫 탐색을 준비 중이에요', '첫 탐색을 준비하고 있어요', '—', '없음', '아바타'],
        ['Searching', '탐색 중이에요', '오늘 판매처 6곳을 살폈어요', '추적함 보기', '없음', '아바타'],
        ['Awaiting Consent', '수배지를 붙여볼까요?', '수배지를 붙여볼까요?', '<b>수배지 미리보기</b>', '있음', '아바타'],
        ['Wanted Queued', '수배지 게시 준비 중', '수배지 게시를 준비하고 있어요', '—', '없음', '아바타'],
        ['Wanted Published', '수배지를 붙이고 왔어요', '수배지를 붙이고 왔어요', '게시글 보기', '없음(앱 안에서만)', '<b>M03</b>'],
        ['Lead Found', '새로운 단서를 물어왔어요', '새로운 단서를 물어왔어요', '유력 후보 보기', '탐색 후보만 · 제보는 확인 후', '<b>M04</b>'],
        ['Offer Verified', '조건에 맞는 매물을 찾았어요', '조건에 맞는 매물을 찾았어요', '<b>확인하기</b>', '있음 · 검증된 제보 포함', '<b>M05</b>'],
        ['(추가) Price Watch', '상품은 찾았지만 아직 비싸요', '찾았지만 아직 예산보다 비싸요', '희망가 수정', '희망가 충족 시', '아바타'],
        ['Completed', '의뢰 완료', '찾던 옷을 구했어요', '새 옷 맡기기', '없음', '정지'],
        ['Expired', '7일 탐색 종료', '이번에는 빈 입으로 돌아왔어요', '결과 보고서', '있음', '<b>M06</b>'],
        ['Paused / Failed', '확인이 필요해요', '오늘 탐색을 다 하지 못했어요', '—', '탐색을 못 한 날 상태 안내', '아바타(회색)'],
    ])
    a3 = table(['순간', '화면', '크기', '리소스'], [
        ['첫 방문', 'S01 첫 방문 홈', '크게 · 화면 높이 47%', 'GIF 1프레임(정면)'],
        ['의뢰 접수', 'S03 출발', '크게 · 폭 100%', 'M01 출발 GIF'],
        ['탐색 진행', 'S04 홈 상태 문장', '작게 · 28px 아바타', 'GIF 1프레임 얼굴'],
        ['유력 후보 · 구매 가능', 'S06 머리말', '중간 · 84px', 'GIF 1프레임 → M04/M05로 교체'],
        ['상품 사진 · 가격 · 근거 · 일지', 'S04 · S05 · S06 본문', '없음', '—'],
        ['7일 종료', 'S10 보고서(2차)', '중간', 'M06 · 앉은 정지 컷(제작)'],
    ])
    return ('<section class="apx" id="apx"><div class="wrap"><p class="ah">APPENDIX · 부록</p><h2>정합성과 상태 정의</h2>'
            f'<h3><i>A-1</i>PRD · 스펙 정책 → 화면 반영</h3><p class="note" style="margin:-4px 0 14px">화면 번호는 디자인 스펙 v0.1(S01~S10) 기준이다. PRD v0.3의 프로토타입 번호(S01~S12)와 다르다.</p>{a1}'
            f'<h3><i>A-2</i>상태 정의 — 스펙 7.1을 화면 요소로</h3>{a2}'
            f'<h3><i>A-3</i>캐릭터 등장 지점</h3>{a3}'
            '<h3><i>A-4</i>화면 규격 점검</h3><div id="qa-a4">' + QA_A4 + '</div>'
            f'<div class="foot2"><b>WALF.</b><span>핵심 화면 1차 시안 · 기준 문서: MVP Product Definition v0.3 · Brand, UI &amp; Interaction Design Specification v0.1</span></div>'
            '</div></section>')


QA_A4 = ''  # 빌드 후 실측값을 qa_a4.html에서 읽어 넣는다
_qa = os.path.join(ROOT, 'qa_a4.html')
if os.path.exists(_qa):
    QA_A4 = open(_qa, encoding='utf-8').read()


def bank():
    return ''.join(f'<template id="t-{k}">{SCREENS[k]()}</template>' for k in ['s01', 's03a', 's04p', 's04', 's05', 's06l', 's06v'])


def build():
    nav = ''.join(f'<a href="#{h}"><i>{n}</i>{t}</a>' for h, n, t in [
        ('brand', '01', 'BRAND'), ('system', '02', 'SYSTEM'), ('s01', '03', 'FIRST VISIT'), ('s04', '04', 'ACTIVE HUNT'),
        ('s06', '05', 'FOUND'), ('motion', '06', 'MOTION'), ('next', '07', 'NEXT'), ('apx', 'A', '부록')])
    html = ('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{TITLE}</title>{FONT_LINK}<style>{DOC_CSS}{APP_CSS}</style></head><body>'
            '<a class="skip" href="#main">본문으로 건너뛰기</a>'
            '<header class="top"><div class="in"><a class="brand" href="#top"><b>WALF.</b><small>핵심 화면 · 1차 시안</small></a>'
            f'<nav class="tnav" aria-label="문서 섹션">{nav}</nav><i class="prog"></i></div></header>'
            f'<main id="main">{cover()}{brand()}{system()}{first_visit()}{active()}{found()}{motion()}{nxt()}{appendix()}</main>'
            f'{LBX_HTML}{bank()}<script>{DOC_JS}</script></body></html>')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', OUT, f'{len(html) / 1024:.0f}KB')
    if '--desktop' in sys.argv:
        subprocess.run([os.path.expanduser('~/html-standalone/bin/share'), OUT], check=False)


if __name__ == '__main__':
    build()
