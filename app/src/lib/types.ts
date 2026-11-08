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
export type Me = { user: { id: number; pushToken: boolean; pushPermission: string | null }; active: RequestView | null; past: PastItem[]; unread: number; pushConfigured: boolean };
export type Alert = { id: number; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: number; isMock: boolean; push: string };
