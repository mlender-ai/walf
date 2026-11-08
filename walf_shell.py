"""WALF 문서 셸 — 회의 공유본의 다크 에디토리얼 구조(상단 번호 탭·표지 질문·섹션·라이트박스)를 따르고,
WALF 색 원칙(포인트 컬러 없음)에 맞춰 강조색만 흑백으로 바꿨다. 앱 화면(.wa)과 역할이 다르다."""

FONT_LINK = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">'

DOC_CSS = r'''
:root{--k-bg:#0b0b0c;--k-bg2:#111113;--k-el:#18181b;--k-el2:#202024;--k-ln:#ffffff1a;--k-ln2:#ffffff30;--k-fg:#f4f4f5;--k-mu:#b6b6bd;--k-su:#8e8e96;
--k-ac:#ffffff;--k-ac2:#e9e6df;--k-hi:#9b9ba3;--k-w:1296px;--k-pad:48px;--k-ease:cubic-bezier(.2,.7,0,1);
--sil-head:url(assets/char/sil_head.png)}
.im-stand{background-image:url(assets/char/stand.webp)}
.im-off{background-image:url(assets/gen/official.webp)}
.im-lst{background-image:url(assets/gen/listing.webp)}
.im-dep{background-image:url(assets/char/depart.webp)}
.im-far{background-image:url(assets/char/far.webp)}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:76px;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--k-bg);color:var(--k-fg);font:16px/1.65 "Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;word-break:keep-all;overflow-wrap:break-word;-webkit-font-smoothing:antialiased;min-width:1180px}
a{color:inherit}
h1,h2,h3,h4,p,ul,ol,figure,dl,dd{margin:0}
ul,ol{padding:0;list-style:none}
:focus-visible{outline:2px solid var(--k-ac2);outline-offset:2px}
.wrap{max-width:var(--k-w);margin:0 auto;padding:0 var(--k-pad)}
.mono{font-family:ui-monospace,Menlo,"SF Mono",monospace}
.skip{position:absolute;left:-999px;top:8px;z-index:99;background:#fff;color:#111;padding:8px 12px;border-radius:8px}.skip:focus{left:12px}
/* 상단 바 */
.top{position:sticky;top:0;z-index:60;background:rgba(11,11,12,.86);backdrop-filter:saturate(1.4) blur(18px);-webkit-backdrop-filter:saturate(1.4) blur(18px);border-bottom:1px solid var(--k-ln)}
.top .in{max-width:var(--k-w);margin:auto;padding:0 var(--k-pad);height:60px;display:flex;align-items:center;gap:16px;position:relative}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;white-space:nowrap}
.brand b{font-size:21px;font-weight:900;letter-spacing:-.055em;color:#fff}
.brand small{font:600 12px ui-monospace,Menlo,monospace;color:var(--k-su);letter-spacing:.04em}
.tnav{display:flex;gap:2px;margin-left:auto}
.tnav a{text-decoration:none;font-size:13.5px;font-weight:600;color:var(--k-mu);padding:8px 12px;border-radius:999px;white-space:nowrap;transition:background .2s,color .2s}
.tnav a i{font:700 11.5px ui-monospace,Menlo,monospace;color:var(--k-su);margin-right:6px;font-style:normal}
.tnav a:hover{color:#fff;background:#ffffff0d}
.tnav a.on{color:#111;background:#fff}.tnav a.on i{color:#111}
.prog{position:absolute;left:0;bottom:-1px;height:2px;width:0;background:#fff}
/* 공통 타이포 */
.eb{font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--k-ac2)}
.h2{font-size:44px;line-height:1.22;letter-spacing:-.045em;font-weight:800;margin-top:18px;max-width:20em}
.h2 .g2,.g2{color:var(--k-hi)}
.h3{font-size:26px;line-height:1.32;letter-spacing:-.035em;font-weight:800}
.lead{color:var(--k-mu);font-size:18.5px;line-height:1.75;max-width:42em;margin-top:22px;letter-spacing:-.01em}
.lead b{color:var(--k-fg)}
.sm{font-size:14px;color:var(--k-mu);line-height:1.7}
.su{color:var(--k-su)}
.sec{padding:128px 0 40px;border-top:1px solid var(--k-ln);position:relative}
.sec.first{border-top:0;padding-top:0}
.sh{margin-bottom:56px}
.sub{margin-top:96px}
.sub>.eb{display:block;color:var(--k-su)}
.sub .h3{margin-top:12px;max-width:28em}
.sub .lead{font-size:16.5px;margin-top:12px}
/* 표지 */
.sec.first.cv{padding:72px 0 72px}
.cv .gr{display:grid;grid-template-columns:minmax(0,1fr) 540px;gap:56px;align-items:center}
.cv h1{font-size:62px;line-height:1.12;letter-spacing:-.05em;font-weight:800;margin-top:24px}
.cv h1 span{display:block;font-size:30px;letter-spacing:-.035em;color:var(--k-hi);margin-top:16px;font-weight:700}
.cv .meta{display:flex;gap:14px;align-items:center;margin-top:28px;font-size:14.5px;color:var(--k-mu)}
.cv .meta b{color:var(--k-fg)}.cv .meta i{width:1px;height:14px;background:var(--k-ln2)}
.lock{position:relative;height:600px;border-radius:28px;background:#fff;overflow:hidden;color:#111}
.lock .lk-q{position:absolute;left:36px;top:34px;font-size:17px;font-weight:700;letter-spacing:-.03em;line-height:1.5}
.lock .lk-q span{display:block;color:#767676;font-weight:500;font-size:14px}
.lock .lk-w{position:absolute;left:34px;bottom:40px;font-size:84px;font-weight:900;letter-spacing:-.06em;line-height:.8}
.lock .lk-d{position:absolute;right:-92px;bottom:-14px;width:470px;height:468px;background-size:contain;background-repeat:no-repeat;mix-blend-mode:multiply}
.cvq{margin-top:64px;display:grid;grid-template-columns:1fr 1fr;gap:0 40px;border-top:1px solid var(--k-ln)}
.cvq .t{grid-column:1/-1;font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;color:var(--k-su);padding:22px 0 8px}
.cvq a{display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--k-ln);text-decoration:none;font-size:16px;font-weight:600;letter-spacing:-.02em}
.cvq a i{font:700 12px ui-monospace,Menlo,monospace;color:var(--k-su);font-style:normal}
.cvq a em{font:700 11.5px ui-monospace,Menlo,monospace;color:var(--k-su);font-style:normal;letter-spacing:.06em}
.cvq a:hover{color:#fff}.cvq a:hover em{color:#fff}
/* 폰 표시 */
.ph{display:flex;flex-direction:column;align-items:center;gap:12px;flex:none;margin:0}
.pf{width:calc(360px*var(--s));height:calc(800px*var(--s));border-radius:calc(36px*var(--s));overflow:hidden;position:relative;background:#fff;box-shadow:0 0 0 1px #ffffff2a,0 30px 60px -26px #000c;flex:none;transition:box-shadow .2s}
.pf .pi{position:absolute;left:0;top:0;width:360px;height:800px;transform:scale(var(--s));transform-origin:0 0}
.ph.zm>.pf{cursor:zoom-in}
.ph.zm>.pf:after{content:'크게 보기';position:absolute;right:10px;bottom:10px;z-index:20;padding:6px 10px;border-radius:99px;background:#0b0b0cd9;color:#fff;font:700 12px/1 "Pretendard Variable",sans-serif;opacity:0;transition:opacity .15s;pointer-events:none}
.ph.zm>.pf:hover:after,.ph.zm>.pf:focus-visible:after{opacity:1}
.ph.zm>.pf:hover{box-shadow:0 0 0 2px #fff,0 30px 60px -26px #000c}
.pc{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;max-width:calc(360px*var(--s) + 20px)}
.pc .id{font:800 11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#111;background:#fff;border-radius:5px;padding:4px 7px;font-style:normal}
.pc b{font-size:14px;line-height:1.4;letter-spacing:-.02em}
.pc span{font-size:12.5px;color:var(--k-su);line-height:1.5}
/* 화면 + 주석 */
.sr{display:grid;grid-template-columns:auto minmax(0,1fr);gap:56px;align-items:start}
.phs{display:flex;gap:28px;align-items:flex-start}
.an{display:flex;flex-direction:column;border-top:1px solid var(--k-ln)}
.an>div{display:grid;grid-template-columns:132px minmax(0,1fr);gap:20px;padding:18px 0;border-bottom:1px solid var(--k-ln)}
.an dt{font-size:14px;font-weight:800;letter-spacing:-.02em;color:var(--k-fg)}
.an dt small{display:block;font:600 11px ui-monospace,Menlo,monospace;color:var(--k-su);letter-spacing:.06em;margin-top:4px}
.an dd{font-size:14.5px;line-height:1.72;color:var(--k-mu)}
.an dd b{color:var(--k-fg);font-weight:700}
.an dd ol{counter-reset:o;display:flex;flex-direction:column;gap:4px}
.an dd ol li{counter-increment:o;position:relative;padding-left:24px}
.an dd ol li:before{content:counter(o);position:absolute;left:0;top:3px;width:17px;height:17px;border-radius:50%;background:#fff;color:#111;font:800 10.5px/17px ui-monospace,Menlo,monospace;text-align:center}
.an dd q{color:var(--k-fg);font-weight:600;quotes:'“' '”'}
.dc{margin-top:22px;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--k-ln);border:1px solid var(--k-ln);border-radius:14px;overflow:hidden}
.dc>div{background:var(--k-bg2);padding:14px 16px}
.dc small{display:block;font:700 10.5px ui-monospace,Menlo,monospace;letter-spacing:.1em;color:var(--k-su);text-transform:uppercase}
.dc span{display:block;font-size:13.5px;line-height:1.55;margin-top:6px;color:var(--k-fg)}
.note{margin-top:18px;font-size:12.5px;color:var(--k-su);line-height:1.6}
/* 표 */
.tb2{width:100%;border-collapse:collapse;font-size:14px;line-height:1.6}
.tb2 th,.tb2 td{text-align:left;vertical-align:top;padding:13px 14px;border-bottom:1px solid var(--k-ln)}
.tb2 thead th{font:700 11.5px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:var(--k-su);text-transform:uppercase;border-bottom:1px solid var(--k-ln2)}
.tb2 tbody th{font-weight:800;color:var(--k-fg);white-space:nowrap}
.tb2 td{color:var(--k-mu)}.tb2 td b{color:var(--k-fg)}
.tb2 .k{font:700 12px ui-monospace,Menlo,monospace;color:var(--k-ac2);white-space:nowrap}
.tb2 tr.hl td,.tb2 tr.hl th{background:#ffffff08}
.pill{display:inline-block;font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:5px 7px;border-radius:5px;background:#ffffff14;color:var(--k-mu);white-space:nowrap}
.pill.w{background:#fff;color:#111}.pill.d{background:transparent;border:1px dashed #ffffff55}
/* 01 브랜드 */
.bs{display:grid;grid-template-columns:1.25fr 1fr;gap:20px}
.pan{border-radius:22px;background:var(--k-el);border:1px solid var(--k-ln);padding:28px;position:relative;overflow:hidden}
.pan.wh{background:#fff;color:#111;border-color:transparent}
.pan.bk{background:#111;border-color:#ffffff14}
.pan>.lb{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;color:var(--k-su);text-transform:uppercase}
.pan.wh>.lb{color:#767676}
.wl{height:300px;position:relative}
.wl .w{position:absolute;left:0;bottom:4px;font-size:92px;font-weight:900;letter-spacing:-.06em;line-height:.8}
.wl .d{position:absolute;right:-10px;bottom:-8px;width:330px;height:329px;background-size:contain;background-repeat:no-repeat;mix-blend-mode:multiply}
.wk{display:flex;flex-direction:column;gap:20px}
.wk .rowp{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.wkb{height:146px;display:flex;align-items:center;justify-content:center;font-size:60px;font-weight:900;letter-spacing:-.06em}
.sym{display:flex;gap:22px;align-items:flex-end;justify-content:center;height:146px;padding-bottom:6px}
.sym figure{display:flex;flex-direction:column;align-items:center;gap:8px}
.sym figcaption{font-size:11.5px;color:var(--k-su)}
.ai{width:84px;height:84px;border-radius:20px;background:#111;position:relative;box-shadow:0 0 0 1px #ffffff26;overflow:hidden}
.ai:after,.av2:after,.ni:after{content:'';position:absolute;background:#fff;-webkit-mask:var(--sil-head) center/contain no-repeat;mask:var(--sil-head) center/contain no-repeat}
.ai:after{left:17%;top:22%;width:78%;height:78%;-webkit-mask-position:left bottom;mask-position:left bottom}
.av2{width:44px;height:44px;border-radius:50%;background:#111;position:relative;box-shadow:0 0 0 1px #ffffff26}
.av2:after{left:8px;top:6px;width:34px;height:34px}
.ni{width:24px;height:24px;position:relative}.ni:after{inset:0}
.av3{width:44px;height:44px;border-radius:50%;background:#fff url(assets/char/stand.webp) -65px -20px/170px auto no-repeat;box-shadow:0 0 0 1px #ffffff26}
.spec{margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--k-ln);border-radius:14px;overflow:hidden;border:1px solid var(--k-ln)}
.spec>div{background:var(--k-bg2);padding:16px 18px}
.spec b{display:block;font-size:14.5px;letter-spacing:-.02em}
.spec span{display:block;font-size:13px;color:var(--k-mu);line-height:1.6;margin-top:4px}
.chr{display:grid;grid-template-columns:repeat(3,1fr) 1.15fr;gap:16px;margin-top:20px}
.fr{display:flex;flex-direction:column;gap:10px;margin:0}
.fr>div{border-radius:18px;background:#fff;position:relative;aspect-ratio:1/1;overflow:hidden}
.fr i{position:absolute;inset:0;background-image:url(assets/char/depart.webp);background-repeat:no-repeat;background-size:1200% 100%;mix-blend-mode:multiply}
.fr small{position:absolute;left:12px;top:12px;font:700 11px ui-monospace,Menlo,monospace;color:#767676;letter-spacing:.06em}
.fr figcaption{font-size:13.5px;font-weight:700;color:var(--k-fg);padding-left:2px}
.trait{padding:22px 24px;border-radius:18px;background:var(--k-el);border:1px solid var(--k-ln);display:flex;flex-direction:column;gap:12px}
.trait b{font-size:15px}.trait p{font-size:13.5px;color:var(--k-mu);line-height:1.65}
.trait q{display:block;font-size:17px;font-weight:700;color:var(--k-fg);line-height:1.5;letter-spacing:-.02em;quotes:none}
.ast{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:20px}
.ast>div{border-radius:18px;background:var(--k-el);border:1px solid var(--k-ln);overflow:hidden;display:flex;flex-direction:column}
.ast .vz{height:150px;background:#fff;position:relative;display:flex;align-items:center;justify-content:center;gap:12px}
.ast .vz .h1x{position:absolute;inset:-8px -30px -20px;background-size:contain;background-position:center bottom;background-repeat:no-repeat;mix-blend-mode:multiply}
.ast .vz .mo{width:150px;height:150px;background-image:url(assets/char/depart.webp);background-size:1800px 150px;background-repeat:no-repeat;mix-blend-mode:multiply;animation:aDep 2.04s steps(12,end) infinite}
@keyframes aDep{from{background-position:0 0}to{background-position:-1800px 0}}
.ast .vz .st{width:96px;height:96px;background-size:contain;background-repeat:no-repeat;mix-blend-mode:multiply;filter:grayscale(1)}
.ast .vz .sl{width:110px;height:110px;background:url(assets/char/sil_body.png) center/contain no-repeat;opacity:.18}
.ast .vz .slb{width:56px;height:56px;background:url(assets/char/sil_front.png) center/contain no-repeat;opacity:.9}
.ast .tx{padding:14px 16px 16px}
.ast .tx b{display:block;font-size:14.5px}.ast .tx small{display:block;font:700 10.5px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:var(--k-su);margin-bottom:4px}
.ast .tx span{display:block;font-size:12.5px;color:var(--k-mu);line-height:1.6;margin-top:4px}
.ast .tx .pill{display:inline-block;margin-top:10px;font-size:10.5px;color:var(--k-mu)}
.ast .tx .pill.w{color:#111}
.scale{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:20px}
.scale>div{padding:18px 20px;border-radius:16px;border:1px solid var(--k-ln);background:var(--k-bg2)}
.scale small{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.1em;color:var(--k-su)}
.scale b{display:block;font-size:17px;margin-top:6px;letter-spacing:-.02em}
.scale span{display:block;font-size:13px;color:var(--k-mu);line-height:1.6;margin-top:6px}
.scale .bar{height:6px;border-radius:3px;background:#ffffff14;margin-top:14px;overflow:hidden}.scale .bar i{display:block;height:100%;background:#fff;border-radius:3px}
/* 02 시스템 */
.sw{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}
.sw>div{border-radius:16px;overflow:hidden;border:1px solid var(--k-ln);background:var(--k-bg2)}
.sw i{display:block;height:96px}
.sw .tx{padding:12px 14px 14px}
.sw b{display:block;font-size:13.5px}.sw code{display:block;font:600 12px ui-monospace,Menlo,monospace;color:var(--k-mu);margin-top:2px}
.sw span{display:block;font-size:12px;color:var(--k-su);margin-top:6px;line-height:1.5}
.sys2{display:grid;grid-template-columns:1.1fr 1fr;gap:20px;margin-top:20px}
.ty{background:#fff;color:#111;border-radius:22px;padding:22px 28px}
.ty>div{display:grid;grid-template-columns:120px 1fr;align-items:baseline;gap:16px;padding:9px 0;border-bottom:1px solid #f1f1f1}
.ty>div:last-child{border-bottom:0}
.ty small{font:700 11px ui-monospace,Menlo,monospace;color:#767676;letter-spacing:.04em}
.ty p{letter-spacing:-.03em;line-height:1.25;font-weight:700}
.sp2{display:flex;flex-direction:column;gap:20px}
.sp2 .pan{padding:22px 24px}
.spx{display:flex;align-items:flex-end;gap:14px;margin-top:16px}
.spx div{display:flex;flex-direction:column;align-items:center;gap:6px}
.spx i{display:block;background:#fff;border-radius:2px}
.spx small{font:600 11px ui-monospace,Menlo,monospace;color:var(--k-mu)}
.rdx{display:flex;gap:16px;margin-top:16px}
.rdx div{display:flex;flex-direction:column;align-items:center;gap:6px}
.rdx i{width:56px;height:56px;border:1.5px solid #fff}
.rdx small{font:600 11px ui-monospace,Menlo,monospace;color:var(--k-mu)}
.cmpk{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:20px}
.cmpk>div{background:#fff;color:#111;border-radius:22px;padding:22px 24px;position:relative}
.cmpk .lb{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;color:#767676;text-transform:uppercase;margin-bottom:14px}
.cmpk .wa{position:relative;inset:auto;overflow:visible;background:transparent}
.cmpk .wa .tabb{position:relative;left:auto;right:auto;bottom:auto}
.cmpk .row{display:flex;flex-direction:column;gap:10px}
.cmpk .tgl{display:grid;grid-template-columns:auto 1fr;gap:10px 14px;align-items:center;font-size:12.5px;color:#4d4d4d}
.cmpk .cap{font-size:12px;color:#767676;line-height:1.55;margin-top:12px}
/* 상태 그리드 */
.stg{display:grid;grid-template-columns:repeat(3,360px);gap:28px 24px;justify-content:space-between;margin-top:28px}
.stg>div{display:flex;flex-direction:column;gap:10px}
.stg .sk{display:flex;gap:8px;align-items:baseline}
.stg .sk code{font:700 11.5px ui-monospace,Menlo,monospace;color:var(--k-ac2);letter-spacing:.04em}
.stg .sk span{font-size:12.5px;color:var(--k-su)}
.stg .wa.wa-in{min-height:0}
/* 05 비교·알림 */
.cmp2{display:grid;grid-template-columns:150px 1fr 1fr;border-top:1px solid var(--k-ln2);margin-top:8px}
.cmp2>*{padding:14px 16px;border-bottom:1px solid var(--k-ln);font-size:14px;line-height:1.6;color:var(--k-mu)}
.cmp2 .h{font:700 11.5px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:var(--k-su);text-transform:uppercase}
.cmp2 .r{font-weight:800;color:var(--k-fg)}
.cmp2 b{color:var(--k-fg)}
.nfs{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-top:20px}
.nf{display:grid;grid-template-columns:38px 1fr;gap:12px;padding:14px 16px;border-radius:20px;background:#f4f4f5;color:#111}
.nf .ni2{width:38px;height:38px;border-radius:10px;background:#111;position:relative}
.nf .ni2:after{content:'';position:absolute;left:7px;top:6px;width:26px;height:26px;background:#fff;-webkit-mask:var(--sil-head) center/contain no-repeat;mask:var(--sil-head) center/contain no-repeat}
.nf .hh{display:flex;justify-content:space-between;font-size:12px;color:#5c5c5c}
.nf .hh b{color:#111;font-weight:700;letter-spacing:.02em}
.nf p{font-size:14px;line-height:1.45;margin-top:2px}.nf p b{display:block}
.nfk{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:var(--k-su);margin:0 0 8px 4px}
.nfx{margin-top:20px;padding:18px 22px;border-radius:16px;border:1px dashed var(--k-ln2);font-size:14px;color:var(--k-mu);line-height:1.75}
.nfx b{color:var(--k-fg)}
/* 06 모션 */
.sbd{display:grid;grid-template-columns:repeat(12,1fr);gap:8px;margin-top:8px}
.sbd figure{display:flex;flex-direction:column;gap:6px}
.sbd .fx{aspect-ratio:1/1;border-radius:10px;background:#fff;position:relative;overflow:hidden}
.sbd .fx i{position:absolute;inset:0;background-image:url(assets/char/depart.webp);background-size:1200% 100%;background-repeat:no-repeat;mix-blend-mode:multiply}
.sbd figcaption{font:600 11px ui-monospace,Menlo,monospace;color:var(--k-su);text-align:center}
.ph5{display:grid;margin-top:10px;font-size:12.5px}
.ph5>div{border-top:2px solid #fff;padding-top:8px;color:var(--k-mu);line-height:1.5}
.ph5>div b{display:block;color:var(--k-fg);font-size:13.5px}
.ph5>div.q{border-top-style:dashed;border-top-color:var(--k-ln2)}
.dm{display:grid;grid-template-columns:auto minmax(0,1fr);gap:56px;align-items:start;margin-top:8px}
.dm .ctl{display:flex;flex-direction:column;gap:18px}
.stp{display:flex;flex-direction:column;border-top:1px solid var(--k-ln)}
.stp button{appearance:none;border:0;border-bottom:1px solid var(--k-ln);background:none;color:var(--k-mu);font:600 15px "Pretendard Variable",sans-serif;text-align:left;padding:12px 4px;display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:baseline;cursor:pointer;letter-spacing:-.02em}
.stp button i{font:700 12px ui-monospace,Menlo,monospace;font-style:normal;color:var(--k-su)}
.stp button em{font:600 11.5px ui-monospace,Menlo,monospace;font-style:normal;color:var(--k-su)}
.stp button:hover{color:#fff}
.stp button[aria-current="step"]{color:#111;background:#fff;border-radius:10px;padding-left:12px}
.stp button[aria-current="step"] i,.stp button[aria-current="step"] em{color:#111}
.dmn{padding:18px 20px;border-radius:16px;background:var(--k-el);border:1px solid var(--k-ln);font-size:14px;color:var(--k-mu);line-height:1.7;min-height:96px}
.dmn b{display:block;color:var(--k-fg);font-size:15px;margin-bottom:4px}
.dmo{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dmo button,.dmo label{appearance:none;border:1px solid var(--k-ln2);background:#ffffff0a;color:var(--k-fg);border-radius:10px;height:40px;padding:0 14px;font:700 13.5px "Pretendard Variable",sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.dmo button:hover,.dmo label:hover{background:#ffffff1a}
.dmo [hidden]{display:none}
.dmo input{accent-color:#fff;width:16px;height:16px;margin:0}
.rules{display:flex;flex-direction:column;gap:0;border-top:1px solid var(--k-ln)}
.rules li{display:grid;grid-template-columns:88px 1fr;gap:16px;padding:14px 0;border-bottom:1px solid var(--k-ln);font-size:14px;line-height:1.65;color:var(--k-mu)}
.rules li b{color:var(--k-fg)}
.rules li>b:first-child{font-size:13px;font-weight:800}
/* 07·결정 */
.dcz{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}
.dcz>div{padding:22px 24px;border-radius:18px;background:var(--k-el);border:1px solid var(--k-ln)}
.dcz small{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.1em;color:var(--k-su)}
.dcz b{display:block;font-size:17px;letter-spacing:-.025em;margin-top:6px;line-height:1.4}
.dcz p{font-size:14px;color:var(--k-mu);line-height:1.7;margin-top:8px}
.dcz p em{font-style:normal;color:var(--k-fg);font-weight:700}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}
.lst{display:flex;flex-direction:column;border-top:1px solid var(--k-ln)}
.lst li{padding:13px 0;border-bottom:1px solid var(--k-ln);font-size:14px;line-height:1.7;color:var(--k-mu)}
.lst li b{color:var(--k-fg)}
/* 부록 */
.apx{background:#070708;border-top:1px solid var(--k-ln);padding:110px 0 80px}
.apx .ah{font:700 12px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--k-su)}
.apx h2{font-size:34px;letter-spacing:-.04em;margin-top:14px}
.apx h3{font-size:19px;letter-spacing:-.025em;margin:64px 0 14px;display:flex;gap:12px;align-items:baseline}
.apx h3 i{font:700 12px ui-monospace,Menlo,monospace;color:var(--k-su);font-style:normal}
.foot2{margin-top:72px;padding-top:24px;border-top:1px solid var(--k-ln);display:flex;justify-content:space-between;font-size:12.5px;color:var(--k-su)}
.foot2 b{color:var(--k-fg);font-weight:900;letter-spacing:-.05em;font-size:16px}
/* 라이트박스 */
.lbx{position:fixed;inset:0;z-index:1000;background:#050506d9;backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center}
.lbx[hidden]{display:none}
.lbx>.lbx-in{display:flex;gap:40px;align-items:center;max-height:100vh}
.lbx-st{max-height:calc(100vh - 32px);overflow:auto;border-radius:30px;scrollbar-width:none}
.lbx-st.big{cursor:zoom-out}.lbx-st:not(.big){cursor:zoom-in}
.lbx-sd{width:270px;display:flex;flex-direction:column;gap:10px;color:var(--k-fg)}
.lbx-k{font:700 11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.1em;color:var(--k-su)}
.lbx-t{font-size:22px;letter-spacing:-.02em;line-height:1.35}.lbx-d{font-size:15px;line-height:1.6;color:var(--k-mu)}
.lbx-n{font:600 13px ui-monospace,Menlo,monospace;color:var(--k-su);margin-top:6px}
.lbx-bt{display:flex;gap:8px;margin-top:6px}
.lbx-bt>button,.lbx-x{appearance:none;border:1px solid var(--k-ln);background:#ffffff0d;color:var(--k-fg);border-radius:12px;height:44px;min-width:56px;padding:0 14px;font:700 15px "Pretendard Variable",sans-serif;cursor:pointer}
.lbx-bt>button:hover,.lbx-x:hover{background:#ffffff1f}
.lbx-x{position:absolute;right:24px;top:20px;min-width:44px;font-size:20px}
.lbx-h{font-size:12.5px;line-height:1.6;color:var(--k-su)}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*:before,*:after{animation-duration:.001ms!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:.001ms!important}
  .ast .vz .mo{animation:none;background-position:-450px 0}
  .wa.s03.anim .dep-stage{display:none}.wa.s03.anim .far{display:block}
  .wa.s03.anim .dep-res,.wa.s03.anim .cta-bar{opacity:1;transform:none}
}
'''

LBX_HTML = ('<div class="lbx" hidden role="dialog" aria-modal="true" aria-label="화면 크게 보기"><button class="lbx-x" aria-label="닫기">✕</button>'
            '<div class="lbx-in"><div class="lbx-st"></div><div class="lbx-sd">'
            '<small class="lbx-k"></small><b class="lbx-t"></b><span class="lbx-d"></span><span class="lbx-n"></span>'
            '<div class="lbx-bt"><button data-d="-1" aria-label="이전 화면">←</button><button data-d="1" aria-label="다음 화면">→</button></div>'
            '<p class="lbx-h">← → 키로 넘기기 · 화면을 누르면 1.6배 · 화면 안은 스크롤 · Esc 닫기</p></div></div></div>')

DOC_JS = r'''
(() => {
  /* 상단 탭 위치·진행바 */
  const links = [...document.querySelectorAll('.tnav a')], prog = document.querySelector('.prog');
  const secs = links.map(a => document.querySelector(a.getAttribute('href')));
  const onScroll = () => {
    const y = scrollY + 120; let k = -1;
    secs.forEach((s, i) => { if (s && s.offsetTop <= y) k = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === k));
    const h = document.documentElement.scrollHeight - innerHeight; prog.style.width = (h > 0 ? scrollY / h * 100 : 0) + '%';
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* 썸네일 스크롤 위치 */
  const setScroll = (root, v) => { const sb = root.querySelector('.sb'); if (sb && v) sb.scrollTop = +v; };
  document.querySelectorAll('.ph[data-scroll]').forEach(ph => setScroll(ph, ph.dataset.scroll));

  /* 라이트박스 */
  const box = document.querySelector('.lbx'), st = box.querySelector('.lbx-st'), q = c => box.querySelector(c);
  const items = [];
  document.querySelectorAll('main .ph').forEach(el => {
    if (el.closest('.dm')) return;
    const sec = el.closest('section'), k = sec ? (sec.querySelector('.eb') || {}).textContent || '' : '';
    const pc = el.querySelector('.pc'), pf = el.querySelector('.pf');
    el.classList.add('zm'); pf.tabIndex = 0; pf.setAttribute('role', 'button');
    const t = pc ? [pc.querySelector('.id'), pc.querySelector('b')].filter(Boolean).map(x => x.textContent).join(' · ') : '';
    pf.setAttribute('aria-label', (t || '화면') + ' 크게 보기');
    items.push({ el, pf, k, t, d: pc ? (pc.querySelector('span') || {}).textContent || '' : '', scroll: el.dataset.scroll || 0 });
  });
  let cur = -1, big = false, opener = null;
  const fit = () => Math.min(1.1, (innerHeight - 40) / 800);
  const show = i => {
    cur = (i + items.length) % items.length; const it = items[cur], s = big ? 1.6 : fit();
    st.classList.toggle('big', big);
    st.innerHTML = `<div class="ph" style="--s:${s.toFixed(3)}"><div class="pf"><div class="pi"></div></div></div>`;
    const src = it.el.querySelector('.pi').firstElementChild.cloneNode(true);
    st.querySelector('.pi').appendChild(src); setScroll(st, it.scroll);
    q('.lbx-k').textContent = it.k; q('.lbx-t').textContent = it.t; q('.lbx-d').textContent = it.d; q('.lbx-n').textContent = `${cur + 1} / ${items.length}`;
  };
  const open = i => { opener = items[i].pf; big = false; box.hidden = false; document.documentElement.style.overflow = 'hidden'; show(i); q('.lbx-x').focus(); };
  const close = () => { box.hidden = true; document.documentElement.style.overflow = ''; st.innerHTML = ''; if (opener) opener.focus(); };
  items.forEach((it, i) => {
    it.pf.addEventListener('click', e => { e.preventDefault(); open(i); });
    it.pf.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
  });
  st.addEventListener('click', e => { if (e.target.closest('.sb') && e.detail === 0) return; big = !big; const sb = st.querySelector('.sb'); const y = sb ? sb.scrollTop : 0; show(cur); const nb = st.querySelector('.sb'); if (nb) nb.scrollTop = y; });
  box.addEventListener('click', e => { if (e.target === box || e.target.classList.contains('lbx-in')) close(); });
  q('.lbx-x').addEventListener('click', close);
  box.querySelectorAll('.lbx-bt>button').forEach(b => b.addEventListener('click', () => show(cur + +b.dataset.d)));
  document.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') show(cur + 1); else if (e.key === 'ArrowLeft') show(cur - 1);
    else if (e.key === 'Tab') { const f = [...box.querySelectorAll('button')]; const a = f.indexOf(document.activeElement);
      e.preventDefault(); f[(a + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
  });

  /* 직접 눌러 보기 */
  const dm = document.querySelector('.dm');
  if (dm) {
    const pi = dm.querySelector('.pi'), note = dm.querySelector('.dmn'), steps = [...dm.querySelectorAll('.stp button')];
    const rmBox = dm.querySelector('#rm'), replay = dm.querySelector('.rp');
    const NOTE = JSON.parse(document.getElementById('dm-notes').textContent);
    const hist = []; let curId = 's01';
    const go = (id, push = true) => {
      if (id === 's03') id = 's03a';
      const t = document.getElementById('t-' + id); if (!t) return;
      if (push && curId) hist.push(curId); curId = id;
      pi.innerHTML = ''; const n = t.content.firstElementChild.cloneNode(true); pi.appendChild(n);
      n.querySelectorAll('.sb').forEach(s => { s.tabIndex = 0; s.setAttribute('aria-label', '화면 내용'); });
      if (id === 's03a') { if (rmBox.checked) n.classList.add('rm'); requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('go'))); }
      steps.forEach(b => { if (b.dataset.id === id) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      const nt = NOTE[id] || ['', '']; note.innerHTML = `<b>${nt[0]}</b>${nt[1]}`;
      replay.hidden = id !== 's03a';
    };
    pi.addEventListener('click', e => {
      const g = e.target.closest('[data-go]'); if (!g) return; e.preventDefault();
      let id = g.dataset.go; if (id === 'back') { id = hist.pop() || 's04'; go(id, false); return; } go(id);
    });
    steps.forEach(b => b.addEventListener('click', () => go(b.dataset.id)));
    replay.addEventListener('click', () => go('s03a', false));
    rmBox.addEventListener('change', () => { if (curId === 's03a') go('s03a', false); });
    go('s01', false);
  }
})();
'''
