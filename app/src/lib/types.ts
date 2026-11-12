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
  styleWords: string[]; productId: number | null; canHunt: boolean; isMock: boolean };

export type WatchDisplay = { key: string; label: string; title: string; desc: string; eyebrow?: string; notice?: string; isMock: boolean };
export type PricePoint = { at: number; label: string; ok: boolean; error: string | null; price: number | null; shipping: number | null; shippingKnown: boolean; total: number | null;
  stock: string | null; option: string | null; source: string; isMock: boolean; meets: boolean };
export type WatchView = {
  id: number; status: 'needs_info' | 'active' | 'paused' | 'renew_due' | 'ended'; isMock: boolean; display: WatchDisplay;
  product: { title: string; brand: string | null; url: string | null; photoUrl: string | null; pageTitle: string | null; seller: string | null; productId: number | null };
  conditions: { size: string | null; color: string | null; targetPrice: number; condition: 'new' | 'any'; label: string };
  source: { id: string; label: string; status: string; reason: string } | null;
  latest: PricePoint | null; history: PricePoint[];
  events: { id: number; at: number; label: string; clock: string; actor: string; kind: string; title: string; detail: string | null; isMock: boolean }[];
  schedule: { lastCheckedLabel: string | null; nextCheckLabel: string | null; renewLabel: string | null; startedLabel: string };
  actions: { pause: boolean; resume: boolean; renew: boolean; end: boolean; edit: boolean };
  requestId: number | null; createdAt: number;
};
export type Alert = { id: number; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: number; isMock: boolean; push: string };
