// 서버 src/domain.ts 의 requestView · candidateView 와 같은 모양
export type Display = { key: string; label: string; eyebrow: string; title: string; desc: string; action?: { label: string; target: string; primary?: boolean }; muted?: boolean; notice?: string; isMock?: boolean };
export type TagT = { kind: 'v' | 'o' | 'p' | 'x'; text: string };

export type Candidate = {
  id: number; kind: 'offer' | 'price_watch' | 'lead' | 'mismatch' | 'similar' | 'unknown'; source: 'search' | 'report'; sourceLabel: string;
  seller: string; url: string | null; title: string | null; photoUrl: string | null; size: string | null; condition: string; conditionLabel: string;
  price: number | null; shipping: number; total: number | null; priceLabel: string; totalLabel: string; budgetLabel: string;
  tags: TagT[]; reasons: string[]; evidence: string[]; pending: string[]; checks: { label: string; value: string; ok: boolean }[];
  checkedAt: number | null; checkedLabel: string | null; publishedLabel: string | null; headline: string; sub: string; ctaLabel: string | null;
  dismissed: boolean; isMock: boolean;
};

export type Activity = { id: number; at: number; clock: string; group: string; actor: string; kind: string; title: string; detail: string | null; isMock: boolean };
export type Post = { id: number; channel: string; status: string; url: string | null; postedLabel: string | null; reason: string | null; isMock: boolean };

export type RequestView = {
  id: number; status: 'submitted' | 'needs_info' | 'active' | 'completed' | 'expired' | 'cancelled'; isMock: boolean; display: Display;
  product: { name: string | null; brand: string | null; url: string | null; note: string | null; photoUrl: string | null; identifiedName: string | null; identifiedBrand: string | null; title: string; brandLabel: string | null };
  conditions: { size: string | null; color: string | null; maxPrice: number | null; usedOk: boolean; label: string };
  infoRequest: string | null;
  schedule: {
    day: number; days: { day: number; date: number; state: 'done' | 'missed' | 'pending' | 'upcoming' | 'cancelled'; today: boolean }[];
    activatedAt: number | null; expiresAt: number | null; endsLabel: string | null; startedLabel: string | null;
    lastRun: { at: number; label: string; checked: number; isMock: boolean } | null; nextRunLabel: string | null;
  };
  candidates: { offers: Candidate[]; leads: Candidate[]; priceWatch: Candidate[]; mismatches: Candidate[] };
  wanted: { status: 'proposed' | 'approved' | 'declined' | 'withdrawn'; publicFields: Record<string, boolean>; posts: Post[] } | null;
  sellers: { day: number; label: string; isMock: boolean; items: { name: string; status: string; text: string }[] } | null;
  activity: Activity[];
  createdLabel: string; endedLabel: string | null; endReason: string | null;
};

export type PastItem = { id: number; status: string; title: string; brand: string | null; isMock: boolean; display: Display; endedAt: number | null; photoUrl: string | null };

// ── V2 · 서버 src/watch.ts myItems · watchView, src/find.ts findView 와 같은 모양 ──
/** 내가 찾는 옷 — 찾아줘 의뢰와 기다려줘를 한 목록으로 */
export type Item = { kind: 'find' | 'watch'; id: number; title: string; brand: string | null; photoUrl: string | null; stateKey: string; stateLabel: string; sub: string; isMock: boolean; updatedAt: number; ended: boolean; target?: string };
export type Me = { user: { id: number; pushToken: boolean; pushPermission: string | null }; active: RequestView | null; past: PastItem[]; unread: number; pushConfigured: boolean;
  items: Item[]; watchLimit: { max: number; used: number } };

export type Attr = { label: string; text: string };
export type FindItem = { id: number; tier: 'match' | 'likely' | 'discover'; brand: string | null; name: string; modelCode: string | null; season: string | null; color: string | null; category: string | null;
  matched: Attr[]; uncertain: Attr[]; evidence: { url: string; host: string }[]; note: string | null; confirmed: boolean; isMock: boolean };
export type FindView = { requestId: number; status: string; state: 'pending' | 'ready' | 'confirmed'; publishedLabel: string | null; match: FindItem | null; likely: FindItem[]; discover: FindItem[];
  styleWords: string[]; productId: number | null; canHunt: boolean; isMock: boolean;
  /** DISCOVER 는 브랜드 단위 추천. 판매 중인 비슷한 “상품”은 alternatives(실제 추천 엔진은 연결 전 — PENDING_INTEGRATION) */
  discoverKind: 'brand'; similarProducts: { status: string; items: OfferCard[] };
  /** 식별 결과와 따로: 같은 상품을 파는 곳(운영자가 공개한 것만) */
  sale: OfferPart & { exact: OfferCard[]; possible: OfferCard[]; searchedSources: string[]; notSearchedCount: number; note: string;
    /** 어디서 찾아봤는지 — 실제 판매처가 몇 곳뿐인지·테스트 판매처뿐인지 */ coverage: Coverage | null; dataKind: DataKind };
  /** 비슷한 디자인의 실제 판매 상품(같은 상품 아님) */
  alternatives: OfferPart & { items: OfferCard[]; dataKind: DataKind };
  priority: string | null; priorities: PriorityOption[] };
/** test: 카드가 모두 테스트 데이터 · real: 모두 실제 판매 페이지 · mixed: 섞임 */
export type DataKind = 'test' | 'real' | 'mixed' | null;
export type Coverage = { kind: 'real' | 'test' | 'none'; real: string[]; pending: string[]; searched: boolean; note: string };
/** 색상·사이즈·상태 한 칸 — ok: 원하는 조건과 맞음 · no: 다름 · unknown: 확인 못 함 · info: 조건이 없어 페이지 값만 */
export type OptionFact = { kind: 'color' | 'size' | 'condition'; state: 'ok' | 'no' | 'unknown' | 'info'; text: string };
export type OfferPart = { state: 'not_started' | 'searching' | 'reviewing' | 'ready' | 'none' | 'failed'; searchedLabel: string | null };
/** 판매처 후보·대체 상품 카드 — 가격·재고는 basisLabel 시각 기준이고 바뀔 수 있다(“구매 가능” 확정 아님) */
export type OfferCard = {
  id: number; tier: 'exact' | 'possible' | 'alternative'; seller: string; brand: string | null; name: string | null; imageUrl: string | null; url: string | null; isMock: boolean;
  price: number | null; salePrice: number | null; shipping: number | null; total: number | null; condition: 'new' | 'used' | 'unknown';
  sizeLabel: string | null; basisLabel: string; confirmed: string[]; unconfirmed: string[]; similarPoints: string[]; diffPoints: string[]; teamNote: string | null;
  facts?: OptionFact[];
  /** 내 평가(비슷한 디자인만): like | not_quite | not_interested | null */
  feedback?: string | null };
/** 무엇이 중요한지(선택) — 대체 상품 정렬에 반영 */
export type PriorityOption = { id: 'silhouette' | 'material_detail' | 'brand_archive' | 'vibe'; label: string; selected: boolean };

export type WatchDisplay = { key: string; label: string; title: string; desc: string; eyebrow?: string; notice?: string; isMock: boolean };
export type PricePoint = { at: number; label: string; ok: boolean; error: string | null; price: number | null; shipping: number | null; shippingKnown: boolean; total: number | null;
  stock: string | null; option: string | null; source: string; isMock: boolean; meets: boolean };
export type WatchView = {
  id: number; status: 'needs_info' | 'active' | 'paused' | 'renew_due' | 'ended'; isMock: boolean; display: WatchDisplay;
  product: { title: string; brand: string | null; url: string | null; photoUrl: string | null; pageTitle: string | null; seller: string | null; productId: number | null };
  conditions: { size: string | null; color: string | null; targetPrice: number; condition: 'new' | 'any'; priceBasis: 'total' | 'item'; label: string };
  /** 이 상품 페이지가 등록한 옷인지 — ok 일 때만 조건 충족 알림이 갈 수 있다 */
  page: { identity: string; ok: boolean; note: string | null };
  source: { id: string; label: string; status: string; reason: string } | null;
  latest: PricePoint | null; history: PricePoint[];
  events: { id: number; at: number; label: string; clock: string; actor: string; kind: string; title: string; detail: string | null; isMock: boolean }[];
  schedule: { lastCheckedLabel: string | null; nextCheckLabel: string | null; renewLabel: string | null; startedLabel: string };
  actions: { pause: boolean; resume: boolean; renew: boolean; end: boolean; edit: boolean };
  requestId: number | null; createdAt: number;
  /** 새 판매처 찾기(Listing Discovery) — 상품 페이지 가격 감시와 따로. 왈프 팀이 확인한 것만 */
  discovery?: { enabled: boolean; state: 'off' | 'unavailable' | 'not_started' | 'searching' | 'reviewing' | 'ready' | 'none' | 'failed';
    items: (OfferCard & { isNew: boolean; meetsTarget: boolean; targetNote: string | null })[]; lastLabel: string | null; nextLabel: string | null; searchedSources: string[]; coverageNote?: string;
    sources: { id: string; label: string; status: string; usable: boolean; selected: boolean; reason: string; paid: boolean; note: string }[]; note: string };
  /** 기다리는 동안 볼 비슷한 디자인(같은 상품 아님) — 저장해도 기다려줘는 계속 */
  alternatives?: { available: boolean; state: string; items: (OfferCard & { saved: boolean })[]; note: string; priority: string | null; priorities: PriorityOption[] };
};
export type Alert = { id: number; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: number; isMock: boolean; push: string };
