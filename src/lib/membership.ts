export type MembershipTier = 'free' | 'plus' | 'premium';

export const MEMBERSHIP_LIMITS = {
  free: { posts: 1, meetups: 3, conversations: 3 },
  plus: { posts: 2, meetups: 5, conversations: 5 },
  premium: { posts: 5, meetups: 10, conversations: 10 },
} as const;

export type MembershipSnapshot = {
  tier: MembershipTier;
  expiresAt: string | null;
  store: string | null;
  willRenew: boolean | null;
  productId: string | null;
  postLimit: number;
  meetupLimit: number;
  conversationLimit: number;
  postsUsed: number;
  meetupsUsed: number;
  conversationsUsed: number;
  conversationPeriod: 'day' | 'active';
  meetupSlotsLocked: number;
  meetupSlotsAvailable: number;
  meetupUnlocksAt: string[];
  conversationSlotsLocked: number;
  conversationSlotsAvailable: number;
  conversationUnlocksAt: string[];
};

export type MembershipOffer = {
  id: string;
  tier: 'plus' | 'premium';
  period: 'month' | 'year';
  price: string;
  productId: string;
};

export function membershipOffer(item: { identifier: string; product: { identifier: string; priceString: string; subscriptionPeriod: string | null } }): MembershipOffer | null {
  const match = /^(plus|premium)_(monthly|yearly)$/.exec(item.identifier);
  if (!match || !item.product.priceString || item.product.subscriptionPeriod !== (match[2] === 'monthly' ? 'P1M' : 'P1Y')) return null;
  return { id: item.identifier, tier: match[1] as 'plus' | 'premium', period: match[2] === 'monthly' ? 'month' : 'year', price: item.product.priceString, productId: item.product.identifier };
}

// 출시 기념가 표시용 정가. 스토어 가격 문자열을 그대로 배율(플러스 1.5배, 프리미엄 4/3배)로 올려 같은 통화·서식으로 돌려준다.
// CA$9.99 → CA$14.99, CA$14.99 → CA$19.99, ₩11,000 → ₩16,500. 나중에 실제 정가로 올릴 계획이 있어 "정가"로 표시한다.
// ponytail: 통화별 표는 두지 않는다. 배율이 바뀌면 여기 숫자만 고친다.
export function referencePrice(offer: { tier: 'plus' | 'premium'; price: string }): string | null {
  const match = /(\d[\d.,]*\d|\d)/.exec(offer.price);
  if (!match) return null;
  const raw = match[1];
  const decimalSep = /[.,]\d{2}$/.test(raw) ? raw[raw.length - 3] : null;
  const thousandsSep = raw.replace(decimalSep ? new RegExp(`\\${decimalSep}\\d{2}$`) : /$/, '').match(/[.,]/)?.[0] ?? null;
  const value = Number(raw.replace(/[.,]/g, (ch) => (ch === decimalSep ? '.' : '')));
  if (!Number.isFinite(value) || value <= 0) return null;
  const ratio = offer.tier === 'plus' ? 1.5 : 4 / 3;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(value * ratio)) - 2); // 소수 없는 통화는 유효숫자 3자리로
  const scaled = decimalSep ? Math.ceil(value * ratio) - 0.01 : Math.round((value * ratio) / step) * step;
  const [whole, fraction] = scaled.toFixed(decimalSep ? 2 : 0).split('.');
  const grouped = thousandsSep ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep) : whole;
  return offer.price.replace(raw, fraction ? `${grouped}${decimalSep}${fraction}` : grouped);
}
