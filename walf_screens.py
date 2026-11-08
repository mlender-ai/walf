"""WALF 앱 화면(360×800 아트보드). 문서 셸과 역할이 다르다 — 앱 토큰은 여기서만 쓴다."""

# ── 예시 데이터(가상) ──────────────────────────────────────────
BRAND = 'LOWFIELD'
NAME = '울 집업 블루종 브라운'
COND = 'M · 브라운 · 25만원 이하 · 중고 OK'

# ── 아이콘(24 그리드, 선 1.7) ──────────────────────────────────
IC = {
    'home': '<path d="M4 10.4 12 4l8 6.4v9.1a1 1 0 0 1-1 1h-4.6v-5.8H9.6v5.8H5a1 1 0 0 1-1-1z"/>',
    'paw': '<circle cx="6.5" cy="10.3" r="1.9"/><circle cx="9.9" cy="6.3" r="1.9"/><circle cx="14.1" cy="6.3" r="1.9"/><circle cx="17.5" cy="10.3" r="1.9"/>'
           '<path d="M12 11.7c-2.7 0-5.1 2.7-5.1 5.2 0 1.7 1.2 2.6 2.6 2.6 1 0 1.6-.6 2.5-.6s1.5.6 2.5.6c1.4 0 2.6-.9 2.6-2.6 0-2.5-2.4-5.2-5.1-5.2z"/>',
    'bell': '<path d="M6.2 16.4v-5.2a5.8 5.8 0 1 1 11.6 0v5.2l1.6 2.1H4.6z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0"/>',
    'user': '<circle cx="12" cy="8.2" r="3.7"/><path d="M4.6 20.2c.9-3.7 3.9-5.7 7.4-5.7s6.5 2 7.4 5.7"/>',
    'back': '<path d="M19.5 12H5M11 5.5 4.5 12l6.5 6.5"/>',
    'close': '<path d="M6 6l12 12M18 6 6 18"/>',
    'more': '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
    'ext': '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10"/>',
    'check': '<path d="M5 12.6l4.3 4.3L19 7.2"/>',
    'chev': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    'minus': '<path d="M7 12h10"/>',
    'ring': '<circle cx="12" cy="12" r="6.5"/>',
}


def ic(name, cls='', w=24):
    return f'<svg class="ic {name} {cls}" viewBox="0 0 24 24" width="{w}" height="{w}" aria-hidden="true">{IC[name]}</svg>'


STATUS = ('<div class="sbar"><b>9:41</b><span class="sbi">'
          '<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>'
          '<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4 10.6 10.6 0 0 0 .5 3.4l1.2 1.3A9 9 0 0 1 8 2.2zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.1 7.1 0 0 0 8 4a7.1 7.1 0 0 0-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4zM8 9.4l1.9-2a2.8 2.8 0 0 0-3.8 0z"/></svg>'
          '<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="#111" stroke-opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.2"/><path d="M25 4.4v4.2c.8-.3 1.4-1.1 1.4-2.1s-.6-1.8-1.4-2.1z" fill-opacity=".45"/></svg>'
          '</span></div>')
HIND = '<i class="hind" aria-hidden="true"></i>'

TABS = [('HOME', 'home', '홈'), ('TRACKING', 'paw', '추적함'), ('ALERTS', 'bell', '알림'), ('MY', 'user', 'MY')]


def tabbar(active, dot='', go=None):
    go = go or {}
    out = []
    for key, icon, ko in TABS:
        on = key == active
        d = '<i class="tdot"></i>' if key == dot else ''
        g = f' data-go="{go[key]}"' if key in go else ''
        cur = ' aria-current="page"' if on else ''
        out.append(f'<button class="tb{" on" if on else ""}"{g} aria-label="{ko}"{cur}>'
                   f'<span class="tbi">{ic(icon, "f" if on else "")}{d}</span><span class="tbl">{key}</span></button>')
    return f'<nav class="tabb" aria-label="하단 탭">{"".join(out)}</nav>'


def avatar(cls=''):
    return f'<i class="av {cls}" aria-hidden="true"></i>'


def tag(kind, text):
    """증거 배지: v 확인됨(채움) · o 유력(테두리) · p 확인 중(점선) · x 불일치(회색)"""
    pre = ic('check', 'tk', 13) if kind == 'v' else ''
    return f'<span class="tg {kind}">{pre}{text}</span>'


def days(today, done=None):
    """7일 칸. done=탐색을 마친 날 수"""
    done = today if done is None else done
    cells = []
    for i in range(1, 8):
        c = 'dn' if i <= done else ''
        c += ' td' if i == today else ''
        cells.append(f'<i class="{c.strip()}"></i>')
    return f'<div class="d7" aria-label="7일 중 {today}일째">{"".join(cells)}</div>'


# ── S01 첫 방문 홈 ─────────────────────────────────────────────
def s01():
    return (f'<div class="wa s01">{STATUS}'
            '<header class="hd"><span class="wm">WALF.</span></header>'
            '<div class="s01-dog im-stand" role="img" aria-label="정면을 바라보고 선 검은 래브라도, 왈프"></div>'
            '<p class="s01-h"><span>넌 그냥<br>올려.</span><span>찾는 건<br>왈프가<br>할게.</span></p>'
            '<div class="s01-b"><p class="s01-p">사진이나 링크만 주세요.<br>7일 동안 국내 판매처와 중고 매물을 대신 살펴볼게요.</p>'
            '<button class="btn pri" data-go="s03">왈프에게 맡기기</button>'
            '<p class="s01-m"><span>무료 베타</span><span>한 번에 한 벌</span><span>하루 한 번 탐색</span></p></div>'
            f'{tabbar("HOME")}{HIND}</div>')


# ── S03 출발·접수(모션 연결용) ─────────────────────────────────
def s03(static=True):
    cls = 'wa s03' + (' st' if static else ' anim')
    return (f'<div class="{cls}">{STATUS}'
            f'<header class="hd"><button class="hb" aria-label="닫기" data-go="s04p">{ic("close")}</button></header>'
            '<div class="dep-stage" aria-hidden="true"><div class="dep im-dep"></div></div>'
            '<div class="dep-res">'
            '<i class="far im-far" role="img" aria-label="멀리 달려가는 왈프"></i>'
            '<p class="dh">왈프가 출발했어요!</p><p class="dd">이제 귀찮게 돌아다니지 않아도 돼요.</p>'
            f'<div class="rq"><i class="th im im-off"></i><div><small>{BRAND}</small><b>{NAME}</b><span>{COND}</span></div></div>'
            '<ol class="nx">'
            '<li><b>왈프 팀이 어떤 옷인지 확인해요</b><span>확인이 끝나면 7일 탐색이 시작돼요. 그 전에는 기간이 흐르지 않아요.</span></li>'
            '<li><b>7일 동안 하루 한 번 국내 판매처를 살펴요</b><span>조건에 맞는 매물이 없으면 수배할지 물어볼게요.</span></li>'
            '<li><b>소식이 있을 때만 알려드려요</b><span>매일 의미 없는 알림은 보내지 않아요.</span></li></ol></div>'
            '<div class="cta-bar"><button class="btn pri" data-go="s04p">확인</button></div>'
            f'{HIND}</div>')


# ── S04 의뢰 진행 홈 ───────────────────────────────────────────
HOME_STATES = {
    # key: (eyebrow, title, desc, extra, day, done, last, next, acts)
    'pend': ('의뢰 접수 · 7일 시작 전', '어떤 옷인지 확인하고 있어요',
             '왈프 팀이 상품을 확인하면 7일 탐색이 시작돼요. 확인 전에는 기간이 흐르지 않아요.', '', 0, 0,
             ('아직 탐색 전', '상품 확인 후 시작'), ('첫 탐색', '확인이 끝나면 바로'),
             [('09:41', '의뢰 접수', '사진 1장 · 링크 1개를 받았어요', '나')]),
    'lead': ('DAY 03 · 오늘 오전 10:40', '새로운 단서를 물어왔어요',
             '수배글을 본 판매자가 알려왔어요. 같은 옷인지, 지금 살 수 있는지 왈프 팀이 확인하고 있어요.', 'lead', 3, 3,
             ('오늘 오전 9:12', '판매처 6곳 확인'), ('내일(월) 오전', '하루 한 번'),
             [('10:40', '판매자 제보 접수', '번개장터 수배글 · M 사이즈 매물', '왈프 팀'),
              ('09:12', '정기 탐색', '6곳 확인 · 새 매물 없음', '왈프'),
              ('어제', '수배지 게시', '번개장터 · 중고나라', '왈프 팀')]),
}


def lead_row(go='s06l'):
    return (f'<button class="lrow" data-go="{go}"><i class="th im im-lst"></i>'
            f'<span class="lr-b">{tag("o", "동일 상품 유력")}<b>번개장터 · M · 228,000원</b><small>판매자 제보 · 왈프 팀 확인 중</small></span>'
            f'{ic("chev", "chv", 20)}</button>')


def s04(state='lead'):
    eb, t, d, extra, day, done, last, nxt, acts = HOME_STATES[state]
    ex = lead_row() if extra == 'lead' else ''
    if day:
        sched = (f'<div class="sch"><div class="sch-h"><b>7일 탐색</b><span>11월 13일(금) 오전 10시 종료</span></div>{days(day, done)}'
                 f'<dl class="kv"><div><dt>마지막 탐색</dt><dd>{last[0]}<small>{last[1]}</small></dd></div><div><dt>다음 탐색</dt><dd>{nxt[0]}<small>{nxt[1]}</small></dd></div></dl></div>')
    else:
        sched = ('<div class="sch"><div class="sch-h"><b>7일 탐색</b><span>시작 전</span></div>' + days(0, 0) +
                 f'<dl class="kv"><div><dt>마지막 탐색</dt><dd>{last[0]}<small>{last[1]}</small></dd></div><div><dt>다음 탐색</dt><dd>{nxt[0]}<small>{nxt[1]}</small></dd></div></dl></div>')
    rows = ''.join(f'<li><time>{a}</time><span><b>{b}</b><small>{c}</small></span><em>{w}</em></li>' for a, b, c, w in acts)
    return (f'<div class="wa s04">{STATUS}'
            '<header class="hd"><span class="wm">WALF.</span></header>'
            '<div class="sb"><div class="in">'
            f'<div class="tile im im-off" role="img" aria-label="의뢰한 옷: {NAME}"></div>'
            f'<div class="pn"><small>{BRAND}</small><b>{NAME}</b><span>{COND}</span></div>'
            f'<div class="stm"><div class="stm-e">{avatar()}<span>{eb}</span></div><p class="stm-t">{t}</p><p class="stm-d">{d}</p>{ex}</div>'
            f'{sched}'
            f'<div class="act"><div class="act-h"><b>최근 활동</b><button data-go="s05">전체 보기</button></div><ol>{rows}</ol></div>'
            '<button class="btn sec" data-go="s05">추적함에서 자세히 보기</button>'
            '<p class="pol">지금은 한 번에 한 벌만 맡길 수 있어요. 이 의뢰가 끝나면 새 옷을 맡길 수 있어요.</p>'
            '</div></div>'
            f'{tabbar("HOME", dot="ALERTS", go={"TRACKING": "s05"})}{HIND}</div>')


# ── S05 추적함(활성 의뢰 상세) ─────────────────────────────────
def s05():
    sellers = [('무신사', 'M 품절', 'x'), ('29CM', '판매 종료', 'x'), ('W컨셉', '검색 결과 없음', 'n'),
               ('번개장터', '동일 상품 1건 · 사이즈 L', 'x'), ('중고나라', '새 매물 없음', 'n'), ('후루츠패밀리', '동일 상품 1건 · 희망가 초과', 'x')]
    srows = ''.join(f'<li><b>{a}</b><span>{b}</span></li>' for a, b, _ in sellers)
    log = [
        ('DAY 03 · 11월 8일(일)', [('10:40', '판매자 제보 접수', '번개장터 수배글을 보고 M 사이즈 매물을 알려왔어요', '왈프 팀'),
                                  ('09:12', '정기 탐색', '6곳 확인 · 새 매물 없음', '왈프')]),
        ('DAY 02 · 11월 7일(토)', [('14:05', '정기 탐색', '6곳 확인 · 새 매물 없음', '왈프'),
                                  ('11:24', '수배지 게시', '중고나라', '왈프 팀'),
                                  ('11:20', '수배지 게시', '번개장터', '왈프 팀'),
                                  ('11:02', '게시하지 않음', '후루츠패밀리 · 구매 희망글을 받지 않는 채널', '왈프 팀')]),
        ('DAY 01 · 11월 6일(금)', [('15:02', '수배 승인', '공개할 정보와 채널을 확인했어요', '나'),
                                  ('14:30', '첫 탐색', '6곳 확인 · 동일 상품 2건, 조건 불일치', '왈프'),
                                  ('10:00', '의뢰 시작', '상품 확인 완료 · 7일 탐색 시작', '왈프 팀')]),
    ]
    lg = ''.join(f'<li class="lg-d">{d}</li>' + ''.join(
        f'<li><time>{a}</time><span><b>{b}</b><small>{c}</small></span><em>{w}</em></li>' for a, b, c, w in items) for d, items in log)
    cal = ''.join(f'<li class="{c}"><small>{n:02d}</small><b>{dt}</b><i></i></li>' for n, dt, c in
                  [(1, '6', 'dn'), (2, '7', 'dn'), (3, '8', 'dn td'), (4, '9', ''), (5, '10', ''), (6, '11', ''), (7, '12', '')])
    return (f'<div class="wa s05">{STATUS}'
            f'<header class="hd"><span class="pt">추적함</span><button class="hb r" aria-label="의뢰 메뉴">{ic("more")}</button></header>'
            '<div class="sb"><div class="in">'
            f'<div class="dh5"><i class="th im im-off"></i><div><small>{BRAND}</small><b>{NAME}</b><span>11월 6일 시작 · 11월 13일(금) 오전 10시 종료</span></div></div>'
            f'<ol class="cal" aria-label="7일 탐색 일정">{cal}</ol>'
            '<p class="cal-c"><i class="lg1"></i>탐색 완료<i class="lg2"></i>예정<span>하루 한 번, 국내 판매처 6곳</span></p>'
            '</div><hr class="gap">'
            '<div class="in blk"><div class="bh"><b>발견한 매물</b><span>1</span></div>'
            f'{lead_row()}'
            '<details class="mis" open><summary>확인했지만 조건이 맞지 않았어요 <span>2</span></summary><ul>'
            f'<li><b>후루츠패밀리 · M · 340,000원</b>{tag("x", "희망가 초과")}<small>동일 상품 확인 · 희망가보다 90,000원 높아요</small></li>'
            f'<li><b>번개장터 · L · 260,000원</b>{tag("x", "옵션 불일치")}<small>동일 상품 확인 · 원하는 사이즈가 아니에요</small></li>'
            '</ul></details></div><hr class="gap">'
            '<div class="in blk"><div class="bh"><b>구매 조건</b><button>수정</button></div>'
            '<dl class="kv2"><div><dt>사이즈</dt><dd>M</dd></div><div><dt>색상</dt><dd>브라운</dd></div>'
            '<div><dt>희망가</dt><dd>250,000원 이하 · 배송비 포함</dd></div><div><dt>중고</dt><dd>괜찮아요</dd></div></dl>'
            '<p class="fn">조건을 바꾸면 다음 탐색부터 적용돼요.</p></div><hr class="gap">'
            '<div class="in blk"><div class="bh"><b>공개 수배</b><button>수배지 보기</button></div>'
            '<p class="ws">11월 7일부터 수배 중 · 제보 1건 확인 중</p>'
            '<ul class="ch">'
            f'<li><b>번개장터</b><span>게시 · 11월 7일 오전 11:20</span><button aria-label="번개장터 게시글 열기">{ic("ext", "", 18)}</button></li>'
            f'<li><b>중고나라</b><span>게시 · 11월 7일 오전 11:24</span><button aria-label="중고나라 게시글 열기">{ic("ext", "", 18)}</button></li>'
            '<li class="no"><b>후루츠패밀리</b><span>올리지 않았어요 · 구매 희망글을 받지 않는 채널</span></li></ul>'
            '<button class="lnk">수배 내리기</button></div><hr class="gap">'
            '<div class="in blk"><div class="bh"><b>확인한 판매처</b><span>오늘 오전 9:12 기준</span></div>'
            f'<ul class="sl">{srows}</ul>'
            '<p class="fn">가격과 재고를 직접 확인할 수 있는 곳만 보여드려요.</p></div><hr class="gap">'
            '<div class="in blk"><div class="bh"><b>활동 일지</b><span>실제 기록만 남겨요</span></div>'
            f'<ol class="lg">{lg}</ol></div>'
            '<div class="in end"><button class="lnk">의뢰 그만두기</button><p>그만두면 탐색을 멈추고, 올린 수배지 삭제를 요청해요.</p>'
            '<button class="lnk g">지난 의뢰 0건</button></div>'
            '</div>'
            f'{tabbar("TRACKING", dot="ALERTS", go={"HOME": "s04"})}{HIND}</div>')


# ── S06 매물 발견 결과 ─────────────────────────────────────────
def s06(verified=True):
    if verified:
        mh = ('<div class="mh"><div><p class="mh-t">왈프가 물어왔어요!</p><p class="mh-d">침은 안 묻혔습니다.</p></div>'
              '<i class="mh-dog im-stand" role="img" aria-label="돌아와 선 왈프"></i></div>')
        tags = tag('v', '동일 상품 확인') + tag('v', '구매 가능 확인')
        price = ('<div class="pr"><p class="pr-n">228,000<small>원</small></p>'
                 '<p class="pr-s">배송비 4,000원 · 총 232,000원</p>'
                 f'<p class="pr-c">{ic("check", "", 16)}희망가 250,000원보다 18,000원 낮아요</p></div>')
        cond = ('<ul class="cm">' + ''.join(f'<li>{ic("check", "", 16)}<span>{a}</span><b>{b}</b></li>' for a, b in
                                            [('사이즈', 'M'), ('색상', '브라운'), ('가격', '희망가 이하'), ('상태', '중고 · 사용감 적음')]) + '</ul>')
        ev = ('<div class="ev"><p class="ev-h">왈프 팀이 이렇게 확인했어요</p><ul>'
              '<li><b>같은 옷이에요</b><span>판매자가 보낸 케어라벨 품번이 공식 상품과 같아요.</span></li>'
              '<li><b>M 사이즈예요</b><span>사이즈 택과 어깨 실측 50cm가 공식 정보와 맞아요.</span></li>'
              '<li><b>지금 팔고 있어요</b><span>판매자에게 판매 중인 것을 확인했어요.</span></li></ul>'
              '<dl class="kv3"><div><dt>판매처</dt><dd>번개장터 · 개인 판매</dd></div><div><dt>찾은 경로</dt><dd>수배글을 본 판매자 제보</dd></div>'
              '<div><dt>확인 시각</dt><dd>11월 8일(일) 오후 3:10</dd></div></dl></div>')
        note = ('<p class="nt">구매는 번개장터에서 진행돼요. 왈프는 결제·배송에 관여하지 않아요. '
                '상태와 정품 여부는 판매자와 한 번 더 확인하고, 안전결제를 이용해 주세요.</p>'
                '<button class="lnk c">이 매물은 넘기고 계속 찾기</button>')
        bar = (f'<div class="cta-bar"><p class="cb-n">중고 매물은 먼저 팔릴 수 있어요 · 오후 3:10 확인</p>'
               f'<button class="btn pri">번개장터에서 보기{ic("ext", "", 18)}</button></div>')
    else:
        mh = ('<div class="mh"><div><p class="mh-t">새로운 단서를 물어왔어요</p><p class="mh-d">같은 옷일 가능성이 높아요. 확인이 끝나면 바로 알려드릴게요.</p></div>'
              '<i class="mh-dog im-stand" role="img" aria-label="돌아와 선 왈프"></i></div>')
        tags = tag('o', '동일 상품 유력') + tag('p', '재고 미확인')
        price = ('<div class="pr"><p class="pr-n q">228,000<small>원</small></p>'
                 '<p class="pr-s">판매자가 적은 가격 · 배송비 4,000원 · 아직 확인 전</p></div>')
        cond = ''
        ev = ('<div class="ev"><p class="ev-h">지금까지 확인한 것</p><ul>'
              '<li><b>사진 속 형태가 같아요</b><span>스탠드 칼라, 비스듬한 주머니, 립 밑단이 공식 상품과 같아요.</span></li></ul>'
              '<p class="ev-h">아직 확인 중인 것</p><ul class="pd">'
              '<li><b>사이즈</b><span>M 사이즈 택 사진을 판매자에게 요청했어요.</span></li>'
              '<li><b>지금 살 수 있는지</b><span>판매 중인지 판매자에게 묻고 있어요.</span></li></ul>'
              '<dl class="kv3"><div><dt>판매처</dt><dd>번개장터 · 개인 판매</dd></div><div><dt>찾은 경로</dt><dd>수배글을 본 판매자 제보</dd></div>'
              '<div><dt>접수 시각</dt><dd>11월 8일(일) 오전 10:40</dd></div></dl></div>')
        note = '<p class="nt">확인 전 매물이에요. 직접 보러 간다면 사이즈와 판매 여부를 꼭 확인하세요.</p>'
        bar = (f'<div class="cta-bar"><p class="cb-n">확인이 끝나면 알림으로 알려드려요</p>'
               f'<button class="btn sec">판매글 직접 보기{ic("ext", "", 18)}</button></div>')
    return (f'<div class="wa s06{" v" if verified else " l"}">{STATUS}'
            f'<header class="hd"><button class="hb" aria-label="뒤로" data-go="back">{ic("back")}</button>'
            '<span class="t">발견한 매물</span></header>'
            f'<div class="sb"><div class="in">{mh}'
            '<div class="ph6 im im-lst" role="img" aria-label="판매자가 올린 블루종 사진"><span>판매자 사진</span></div>'
            f'<div class="tgs">{tags}</div>'
            f'<div class="pn"><small>{BRAND}</small><b>{NAME}</b><span>M · 브라운 · 중고</span></div>'
            f'{price}{cond}{ev}{note}'
            '</div></div>'
            f'{bar}{HIND}</div>')


# ── 상태 모듈(홈 가운데 한 문장) — 상태 시스템 그리드용 ─────────
STM_STATES = [
    ('Identification Pending', '의뢰 접수 · 7일 시작 전', '어떤 옷인지 확인하고 있어요', '확인이 끝나면 7일 탐색이 시작돼요. 그 전에는 기간이 흐르지 않아요.', ''),
    ('First Search Pending', 'DAY 01 · 오전 10:00 시작', '첫 탐색을 준비하고 있어요', '오늘 안에 국내 판매처를 살펴보고 결과를 정리해 둘게요.', ''),
    ('Searching', 'DAY 04 · 오늘 오전 9:05', '오늘 판매처 6곳을 살폈어요', '조건에 맞는 매물은 아직 없어요. 내일 오전에 다시 볼게요.', ''),
    ('Awaiting Consent', 'DAY 01 · 첫 탐색 결과', '수배지를 붙여볼까요?', '6곳을 살폈지만 조건에 맞는 매물이 없었어요. 공개 여부는 직접 정해요.', 'btn:수배지 미리보기'),
    ('Wanted Queued', 'DAY 02 · 승인 완료', '수배지 게시를 준비하고 있어요', '게시가 끝나면 채널과 시각을 알려드릴게요. 아직 올라가지 않았어요.', ''),
    ('Wanted Published', 'DAY 02 · 오전 11:24', '수배지를 붙이고 왔어요', '번개장터 · 중고나라에 게시했어요. 후루츠패밀리는 정책상 올리지 않았어요.', ''),
    ('Lead Found', 'DAY 03 · 오전 10:40', '새로운 단서를 물어왔어요', '같은 옷일 가능성이 높아요. 왈프 팀이 사이즈와 재고를 확인하고 있어요.', 'tag:o:동일 상품 유력'),
    ('Offer Verified', 'DAY 03 · 오후 3:10 확인', '조건에 맞는 매물을 찾았어요', '번개장터 · M · 총 232,000원. 중고 매물은 먼저 팔릴 수 있어요.', 'btn:확인하기'),
    ('Price Watch', 'DAY 02 · 오전 9:30', '찾았지만 아직 예산보다 비싸요', '후루츠패밀리 M 340,000원. 희망가 이하로 내려오는지 계속 볼게요.', ''),
    ('Expired', '7일 종료 · 11월 13일', '이번에는 빈 입으로 돌아왔어요', '7일 동안 확인한 내용을 정리해뒀어요. 탐색은 멈췄어요.', 'btn2:결과 보고서 보기'),
    ('Paused / Failed', 'DAY 05 · 오전 9:00', '오늘 탐색을 다 하지 못했어요', '판매처 2곳에 접속하지 못했어요. 매물이 없다는 뜻은 아니에요. 내일 다시 시도해요.', ''),
    ('Completed', '11월 8일 · 구매 확인', '찾던 옷을 구했어요', '탐색과 수배를 멈췄어요. 올린 수배지는 내리도록 요청했어요.', ''),
]


def stm_card(state):
    key, eb, t, d, extra = state
    ex = ''
    if extra.startswith('btn:'):
        ex = f'<button class="btn pri sml">{extra[4:]}</button>'
    elif extra.startswith('btn2:'):
        ex = f'<button class="btn sec sml">{extra[5:]}</button>'
    elif extra.startswith('tag:'):
        _, k, txt = extra.split(':')
        ex = f'<div class="tgs">{tag(k, txt)}</div>'
    av = avatar('q' if key in ('Expired', 'Paused / Failed', 'Completed') else '')
    return f'<div class="wa wa-in"><div class="stm"><div class="stm-e">{av}<span>{eb}</span></div><p class="stm-t">{t}</p><p class="stm-d">{d}</p>{ex}</div></div>'


SCREENS = {
    's01': s01, 's03': lambda: s03(True), 's03a': lambda: s03(False),
    's04': lambda: s04('lead'), 's04p': lambda: s04('pend'), 's05': s05,
    's06v': lambda: s06(True), 's06l': lambda: s06(False),
}


# ── 앱 CSS ─────────────────────────────────────────────────────
APP_CSS = r'''
.wa{--b:#111;--w:#fff;--cv:#F7F7F7;--sf:#F1F1F1;--g5:#767676;--g3:#D9D9D9;--dk:#202020;
position:absolute;inset:0;background:#fff;color:var(--b);font:400 15px/1.5 "Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",sans-serif;letter-spacing:-.012em;overflow:hidden;word-break:keep-all;text-align:left;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 0}
.wa *{box-sizing:border-box}
.wa p,.wa ol,.wa ul,.wa dl,.wa dd{margin:0;padding:0;list-style:none}
.wa b{font-weight:700}
.wa small{font-size:inherit}
.wa button{appearance:none;border:0;background:none;font:inherit;color:inherit;padding:0;margin:0;cursor:pointer;text-align:inherit;letter-spacing:inherit}
.wa .ic{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.wa .ic.f{fill:currentColor}
.wa .ic.more circle{fill:currentColor;stroke:none}
.wa .im{background-position:center;background-size:cover;background-repeat:no-repeat}
.wa .sbar{position:absolute;left:0;right:0;top:0;height:44px;padding:2px 22px 0 32px;display:flex;align-items:center;justify-content:space-between;z-index:8;background:#fff}
.wa .sbar b{font-size:15.5px;font-weight:600;letter-spacing:-.01em}
.wa .sbi{display:flex;gap:6px;align-items:center}.wa .sbi svg{fill:#111}
.wa .hind{position:absolute;left:50%;bottom:8px;width:134px;height:5px;margin-left:-67px;border-radius:3px;background:#111;z-index:9}
.wa .hd{position:absolute;left:0;right:0;top:44px;height:52px;padding:0 20px;display:flex;align-items:center;z-index:7;background:#fff}
.wa .wm{font-size:23px;font-weight:900;letter-spacing:-.055em;line-height:1}
.wa .hd .t{position:absolute;left:60px;right:60px;text-align:center;font-size:16px;font-weight:700;pointer-events:none}
.wa .hd .pt{font-size:26px;font-weight:800;letter-spacing:-.04em}
.wa .hb{width:44px;height:44px;margin-left:-12px;display:grid;place-items:center;border-radius:12px}
.wa .hb.r{margin:0 -12px 0 auto}
.wa .sb{position:absolute;left:0;right:0;top:96px;bottom:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;overscroll-behavior:contain}
.wa .sb::-webkit-scrollbar{display:none}
.wa .in{padding:0 20px}
.wa .th{display:block;flex:none;border-radius:8px;background-color:var(--cv)}
.wa .im-off{background-color:var(--cv);background-blend-mode:multiply}
/* 버튼 */
.wa .btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:54px;border-radius:12px;font-size:16px;font-weight:700;letter-spacing:-.02em}
.wa .btn.pri{background:#111;color:#fff}
.wa .btn.sec{background:#fff;color:#111;box-shadow:inset 0 0 0 1px var(--g3)}
.wa .btn.sml{height:44px;font-size:14px;border-radius:10px;width:auto;padding:0 16px;margin-top:14px}
.wa .lnk{font-size:13.5px;font-weight:600;color:var(--g5);text-decoration:underline;text-underline-offset:3px;padding:12px 0;display:block}
.wa .lnk.c{margin:0 auto}
/* 탭바 */
.wa .tabb{position:absolute;left:16px;right:16px;bottom:24px;height:62px;border-radius:31px;background:rgba(255,255,255,.94);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 0 0 1px rgba(17,17,17,.07),0 10px 28px -10px rgba(17,17,17,.22);display:grid;grid-template-columns:repeat(4,1fr);padding:5px;z-index:8}
.wa .tb{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:26px;color:var(--g5)}
.wa .tb.on{background:var(--sf);color:#111}
.wa .tbi{position:relative;display:block;height:24px}
.wa .tbl{font-size:11px;font-weight:600;letter-spacing:.02em;line-height:1.2}
.wa .tb.on .tbl{font-weight:800}
.wa .tdot{position:absolute;right:-3px;top:0;width:6px;height:6px;border-radius:50%;background:#111;box-shadow:0 0 0 2px #fff}
/* 증거 배지 */
.wa .tg{display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 7px;border-radius:4px;font-size:11.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;line-height:1}
.wa .tg.v{background:#111;color:#fff}.wa .tg.v .tk{stroke-width:2.4;margin-left:-2px}
.wa .tg.o{box-shadow:inset 0 0 0 1.2px #111;color:#111}
.wa .tg.p{border:1.2px dashed var(--g5);color:#4d4d4d}
.wa .tg.x{background:var(--sf);color:#111}
.wa .tgs{display:flex;gap:6px;flex-wrap:wrap}
/* 캐릭터 아바타·실루엣 */
.wa .av{display:inline-block;width:28px;height:28px;border-radius:50%;flex:none;background:#fff url(assets/char/stand.webp) -41px -12px/107px auto no-repeat;box-shadow:inset 0 0 0 1px rgba(17,17,17,.1)}
.wa .av.q{filter:grayscale(1);opacity:.45}
/* S01 */
.wa.s01 .s01-dog{position:absolute;left:-10px;top:112px;width:430px;height:429px;background-size:contain;background-repeat:no-repeat;mix-blend-mode:multiply}
.wa.s01 .s01-h{position:absolute;left:20px;bottom:282px;font-size:35px;line-height:1.16;font-weight:800;letter-spacing:-.05em;display:flex;flex-direction:column;gap:14px}
.wa.s01 .s01-b{position:absolute;left:20px;right:20px;top:542px}
.wa.s01 .s01-p{font-size:14.5px;line-height:1.55;color:#111;margin-bottom:18px}
.wa.s01 .s01-m{display:flex;justify-content:center;gap:0;margin-top:12px;font-size:12px;color:var(--g5);font-weight:500}
.wa.s01 .s01-m span+span:before{content:'';display:inline-block;width:2px;height:2px;border-radius:50%;background:var(--g5);vertical-align:middle;margin:0 8px 2px}
/* S03 */
.wa.s03 .dep-stage{position:absolute;left:0;right:0;top:96px;height:360px;display:none}
.wa.s03 .dep{width:360px;height:359px;background-repeat:no-repeat;background-size:4320px 359px;background-position:0 0;mix-blend-mode:multiply}
.wa.s03 .dep-res{position:absolute;left:20px;right:20px;top:112px}
.wa.s03 .far{display:block;width:72px;height:72px;margin:0 0 6px -8px;background-size:240px 239px;background-position:-82px -96px;background-repeat:no-repeat;mix-blend-mode:multiply}
.wa.s03 .dh{font-size:28px;font-weight:800;letter-spacing:-.045em;line-height:1.25}
.wa.s03 .dd{font-size:15px;color:var(--g5);margin-top:6px}
.wa.s03 .rq{display:flex;gap:14px;align-items:center;margin-top:26px;padding:14px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--g3)}
.wa.s03 .rq .th{width:64px;height:64px}
.wa.s03 .rq small,.wa .pn small,.wa .dh5 small{display:block;font-size:11.5px;font-weight:800;letter-spacing:.04em}
.wa.s03 .rq b{display:block;font-size:15px;font-weight:600;margin-top:2px}
.wa.s03 .rq span{display:block;font-size:12.5px;color:var(--g5);margin-top:3px}
.wa.s03 .nx{margin-top:28px;counter-reset:n;display:flex;flex-direction:column;gap:16px}
.wa.s03 .nx li{position:relative;padding-left:34px;counter-increment:n}
.wa.s03 .nx li:before{content:counter(n);position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 1.2px #111;font-size:12px;font-weight:800;display:grid;place-items:center}
.wa.s03 .nx b{display:block;font-size:15px;font-weight:700;line-height:1.45}
.wa.s03 .nx span{display:block;font-size:13px;color:var(--g5);margin-top:2px;line-height:1.5}
.wa .cta-bar{position:absolute;left:0;right:0;bottom:0;padding:10px 20px 34px;background:#fff;box-shadow:0 -1px 0 var(--sf);z-index:8}
.wa .cb-n{font-size:12px;color:var(--g5);text-align:center;margin:0 0 8px;font-weight:500}
.wa.s03.anim .dep-stage{display:block}
.wa.s03.anim .far{display:none}
.wa.s03.anim .dep-res,.wa.s03.anim .cta-bar{opacity:0;transform:translateY(14px)}
.wa.s03.anim.go .dep{animation:wDep 2.04s steps(12,end) .35s forwards}
.wa.s03.anim.go .dep-res,.wa.s03.anim.go .cta-bar{animation:wRise .42s cubic-bezier(.2,.7,0,1) 2.5s forwards}
.wa.s03.anim.go .cta-bar{animation-delay:2.62s}
@keyframes wDep{from{background-position:0 0}to{background-position:-4320px 0}}
@keyframes wRise{to{opacity:1;transform:none}}
.wa.s03.anim.rm .dep-stage{display:none}.wa.s03.anim.rm .far{display:block}
.wa.s03.anim.rm .dep-res,.wa.s03.anim.rm .cta-bar{opacity:1;transform:none;animation:none}
/* S04 */
.wa .tile{height:256px;border-radius:12px;margin-top:4px;background-size:330px;background-position:center 46%}
.wa .pn{margin-top:14px}
.wa .pn b{display:block;font-size:17px;font-weight:600;letter-spacing:-.025em;margin-top:3px}
.wa .pn span{display:block;font-size:13px;color:var(--g5);margin-top:3px}
.wa .stm{margin-top:24px;padding-top:22px;box-shadow:0 -1px 0 var(--sf)}
.wa .stm-e{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--g5)}
.wa .stm-t{font-size:21px;font-weight:800;letter-spacing:-.04em;line-height:1.3;margin-top:10px}
.wa .stm-d{font-size:14px;line-height:1.55;color:#111;margin-top:6px}
.wa .lrow{display:flex;align-items:center;gap:12px;width:100%;margin-top:16px;padding:12px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--g3)}
.wa .lrow .th{width:56px;height:56px;border-radius:8px}
.wa .lr-b{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px}
.wa .lr-b b{font-size:14.5px;font-weight:700;margin-top:3px}
.wa .lr-b small{font-size:12px;color:var(--g5)}
.wa .lrow .chv{color:var(--g5)}
.wa .sch{margin-top:28px}
.wa .sch-h{display:flex;justify-content:space-between;align-items:baseline}
.wa .sch-h b{font-size:15px}.wa .sch-h span{font-size:12.5px;color:var(--g5)}
.wa .d7{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:10px}
.wa .d7 i{height:4px;border-radius:2px;background:var(--g3)}
.wa .d7 i.dn{background:#111}
.wa .kv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
.wa .kv div{padding:12px 14px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px var(--g3)}
.wa .kv dt{font-size:11.5px;color:var(--g5);font-weight:600}
.wa .kv dd{font-size:14px;font-weight:700;margin-top:3px;line-height:1.4}.wa .kv dd small{display:block;font-size:12px;font-weight:500;color:var(--g5);margin-top:1px}
.wa .act{margin-top:32px}
.wa .act-h,.wa .bh{display:flex;justify-content:space-between;align-items:baseline}
.wa .act-h b,.wa .bh b{font-size:17px;font-weight:800;letter-spacing:-.03em}
.wa .act-h button,.wa .bh button{font-size:13px;font-weight:600;color:var(--g5);padding:12px 0 12px 16px;margin:-12px 0;min-width:44px;text-align:right}
.wa .bh span{font-size:12.5px;color:var(--g5);font-weight:500}
.wa .act ol,.wa .lg{margin-top:6px}
.wa .act li,.wa .lg li{display:grid;grid-template-columns:44px 1fr auto;gap:10px;padding:12px 0;box-shadow:0 1px 0 var(--sf);align-items:start}
.wa .act li:last-child{box-shadow:none}
.wa .act time,.wa .lg time{font-size:12.5px;color:var(--g5);font-weight:600;font-variant-numeric:tabular-nums;padding-top:1px}
.wa .act li b,.wa .lg li b{display:block;font-size:14px;font-weight:700}
.wa .act li small,.wa .lg li small{display:block;font-size:12.5px;color:var(--g5);margin-top:2px;line-height:1.45}
.wa .act li em,.wa .lg li em{font-style:normal;font-size:11px;font-weight:700;color:var(--g5);padding:3px 6px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--g3);white-space:nowrap}
.wa .s04 .btn.sec,.wa.s04 .btn.sec{margin-top:20px}
.wa .pol{font-size:12px;color:var(--g5);line-height:1.5;margin:16px 0 0;padding-bottom:128px;text-align:center}
/* S05 */
.wa .dh5{display:flex;gap:14px;align-items:center;margin-top:6px}
.wa .dh5 .th{width:64px;height:76px;background-size:cover}
.wa .dh5 b{display:block;font-size:16px;font-weight:600;margin-top:2px;letter-spacing:-.02em}
.wa .dh5 span{display:block;font-size:12.5px;color:var(--g5);margin-top:4px}
.wa .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:20px}
.wa .cal li{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0 10px;border-radius:10px}
.wa .cal small{font-size:11px;font-weight:700;color:var(--g5);letter-spacing:.02em}
.wa .cal b{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.wa .cal i{width:7px;height:7px;border-radius:50%;box-shadow:inset 0 0 0 1.2px var(--g3);margin-top:2px}
.wa .cal li.dn i{background:#111;box-shadow:none}
.wa .cal li.td{background:#111;color:#fff}.wa .cal li.td small{color:#bdbdbd}.wa .cal li.td i{background:#fff}
.wa .cal li:not(.dn) b{color:var(--g5);font-weight:500}
.wa .cal-c{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--g5);margin:10px 0 24px;font-weight:500}
.wa .cal-c i{width:7px;height:7px;border-radius:50%;display:inline-block}.wa .cal-c .lg1{background:#111}.wa .cal-c .lg2{box-shadow:inset 0 0 0 1.2px var(--g3);margin-left:6px}
.wa .cal-c span{margin-left:auto}
.wa hr.gap{border:0;height:8px;background:var(--sf);margin:0}
.wa .blk{padding-top:22px;padding-bottom:22px}
.wa .blk .lrow{margin-top:12px}
.wa .mis{margin-top:16px}
.wa .mis summary{list-style:none;font-size:13.5px;font-weight:700;padding:12px 0;margin:-6px 0;cursor:pointer}
.wa .mis summary::-webkit-details-marker{display:none}
.wa .mis summary span{color:var(--g5);margin-left:2px}
.wa .mis li{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:12px 0;box-shadow:0 1px 0 var(--sf)}
.wa .mis li:last-child{box-shadow:none}
.wa .mis li b{font-size:14px;font-weight:600}
.wa .mis li small{grid-column:1/-1;font-size:12.5px;color:var(--g5)}
.wa .kv2{margin-top:10px}
.wa .kv2 div{display:grid;grid-template-columns:64px 1fr;padding:9px 0;font-size:14px}
.wa .kv2 dt{color:var(--g5)}.wa .kv2 dd{font-weight:600}
.wa .fn{font-size:12px;color:var(--g5);margin-top:10px;line-height:1.5}
.wa .ws{font-size:13.5px;font-weight:600;margin-top:8px}
.wa .ch{margin-top:10px}
.wa .ch li{display:grid;grid-template-columns:86px 1fr 44px;align-items:center;padding:3px 0;min-height:46px;box-shadow:0 1px 0 var(--sf);font-size:13.5px}
.wa .ch li b{font-weight:700}
.wa .ch li span{font-size:12.5px;color:#111}
.wa .ch li button{width:44px;height:44px;margin-right:-10px;justify-self:end;display:grid;place-items:center;color:#111}
.wa .ch li.no span{color:var(--g5)}.wa .ch li.no b{color:var(--g5)}
.wa .ch li.no{grid-template-columns:86px 1fr;padding:12px 0}
.wa .sl{margin-top:8px}
.wa .sl li{display:grid;grid-template-columns:96px 1fr;padding:10px 0;box-shadow:0 1px 0 var(--sf);font-size:13.5px}
.wa .sl li b{font-weight:600}.wa .sl li span{color:var(--g5);font-size:13px}
.wa .lg li.lg-d{display:block;padding:18px 0 4px;font-size:12px;font-weight:800;letter-spacing:.02em;box-shadow:none}
.wa .lg li.lg-d:first-child{padding-top:8px}
.wa .end{padding-top:18px;padding-bottom:132px;text-align:center}
.wa .end .lnk{margin:0 auto}.wa .end p{font-size:12px;color:var(--g5);margin-top:-4px}
.wa .end .lnk.g{margin-top:18px;text-decoration:none;color:#111;font-weight:700}
/* S06 */
.wa .mh{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;height:96px;padding-bottom:12px;margin-top:-4px}
.wa .mh-t{font-size:24px;font-weight:800;letter-spacing:-.045em;line-height:1.25}
.wa .mh-d{font-size:13.5px;color:var(--g5);margin-top:4px;line-height:1.45}
.wa .mh-dog{width:84px;height:96px;flex:none;background-size:230px 229px;background-position:-76px -8px;background-repeat:no-repeat;mix-blend-mode:multiply;-webkit-mask:linear-gradient(#000 72%,transparent);mask:linear-gradient(#000 72%,transparent);margin-bottom:-12px}
.wa.s06.l .mh-t{font-size:22px}
.wa .ph6{position:relative;height:320px;border-radius:12px;margin-top:0}
.wa .ph6 span{position:absolute;left:10px;bottom:10px;font-size:11px;font-weight:700;color:#fff;background:rgba(17,17,17,.62);padding:4px 7px;border-radius:4px}
.wa .s06 .tgs,.wa.s06 .tgs{margin-top:14px}
.wa.s06 .pn{margin-top:12px}
.wa .pr{margin-top:16px}
.wa .pr-n{font-size:28px;font-weight:800;letter-spacing:-.04em;line-height:1.1;font-variant-numeric:tabular-nums}
.wa .pr-n small{font-size:20px;font-weight:700;margin-left:1px}
.wa .pr-n.q{color:var(--g5)}
.wa .pr-s{font-size:13px;color:var(--g5);margin-top:6px}
.wa .pr-c{display:flex;align-items:center;gap:4px;font-size:13.5px;font-weight:700;margin-top:8px}
.wa .cm{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:20px}
.wa .cm li{display:grid;grid-template-columns:16px 1fr;gap:2px 6px;padding:12px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px var(--g3);align-items:center}
.wa .cm li span{font-size:11.5px;color:var(--g5);font-weight:600}
.wa .cm li b{grid-column:2;font-size:13.5px;font-weight:700}
.wa .ev{margin-top:28px}
.wa .ev-h{font-size:16px;font-weight:800;letter-spacing:-.03em;margin-bottom:4px}
.wa .ev ul+.ev-h{margin-top:20px}
.wa .ev li{position:relative;padding:10px 0 10px 26px}
.wa .ev li:before{content:'';position:absolute;left:2px;top:13px;width:14px;height:14px;border-radius:50%;background:#111 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.6l4.3 4.3L19 7.2'/%3E%3C/svg%3E") center/10px no-repeat}
.wa .ev ul.pd li:before{background:none;border:1.2px dashed var(--g5);box-sizing:border-box}
.wa .ev li b{display:block;font-size:14px;font-weight:700}
.wa .ev li span{display:block;font-size:13px;color:var(--g5);margin-top:2px;line-height:1.5}
.wa .kv3{margin-top:14px;padding-top:6px;box-shadow:0 -1px 0 var(--sf)}
.wa .kv3 div{display:grid;grid-template-columns:72px 1fr;padding:8px 0;font-size:13px}
.wa .kv3 dt{color:var(--g5)}.wa .kv3 dd{font-weight:600}
.wa .nt{margin-top:22px;padding:14px;border-radius:12px;background:var(--cv);font-size:12.5px;line-height:1.6;color:#111}
.wa.s06 .sb .in{padding-bottom:150px}
.wa.s06 .lnk.c{margin-top:6px}
/* 상태 모듈 단독 카드 */
.wa.wa-in{position:relative;inset:auto;padding:20px;border-radius:18px;height:100%}
.wa.wa-in .stm{margin:0;padding:0;box-shadow:none}
.wa.wa-in .btn.sml{display:inline-flex}
.wa.wa-in .tgs{margin-top:12px}
'''
