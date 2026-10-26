import { membershipProductIds } from '../../supabase/functions/_shared/membership.ts';

// 'admin' is granted by the server to the operator account only; it is never sold.
export type MembershipTier = 'free' | 'plus' | 'pro' | 'premium' | 'admin';
export type MembershipKind = 'general' | 'business';

// seats/cohosts mirror private meetup scale (20261026040000); listings = live buy/sell posts.
export const MEMBERSHIP_LIMITS = {
  free: { meetups: 3, conversations: null, seats: 10, cohosts: 0, listings: 5 },
  plus: { meetups: 5, conversations: null, seats: 30, cohosts: 1, listings: 10 },
  pro: { meetups: 10, conversations: null, seats: 100, cohosts: 3, listings: 20 },
  premium: { meetups: 20, conversations: null, seats: 500, cohosts: 5, listings: 20 },
} as const;

export const GENERAL_BUMP_HOURS = { free: 48, plus: 36, pro: 30, premium: 24, admin: 0 } as const;
// Mirrors private.business_membership_details_base: one bump per interval across all of a business's posts; paid tiers have no monthly bump cap.
// managers mirrors private.business_operator_limit.
export const BUSINESS_LIMITS = {
  free: { posts: 1, bumps: 2, bumpCooldownHours: 120, managers: 0, managedPosts: 0, managedBumps: 0, reports: 0 },
  plus: { posts: 2, bumps: null, bumpCooldownHours: 48, managers: 1, managedPosts: 0, managedBumps: 0, reports: 0 },
  pro: { posts: 5, bumps: null, bumpCooldownHours: 24, managers: 3, managedPosts: 0, managedBumps: 0, reports: 0 },
  premium: { posts: 10, bumps: null, bumpCooldownHours: 12, managers: 5, managedPosts: 0, managedBumps: 0, reports: 0 },
} as const;

export type BusinessMembershipSnapshot = {
  merchantId: string; tier: MembershipTier; expiresAt: string | null; productId: string | null;
  store: string | null; willRenew: boolean | null; canPurchase: boolean;
  postLimit: number | null; bumpLimit: number | null; bumpCooldownHours?: number; postsUsed: number; bumpsUsed: number;
  managedPostLimit: number; managedBumpLimit: number; managedPostsUsed: number; managedBumpsUsed: number;
  reportLimit: number; reportsUsed: number; resetsAt: string; nextBumpAt: string | null;
};

export type MembershipSnapshot = {
  tier: MembershipTier;
  expiresAt: string | null;
  store: string | null;
  willRenew: boolean | null;
  productId: string | null;
  planVersion?: number;
  bumpCooldownHours?: number;
  nextBumpAt?: string | null;
  billingPolicyVersion?: number;
  businessSubscription?: Pick<MembershipSnapshot, 'tier' | 'expiresAt' | 'productId' | 'store' | 'willRenew'> & { merchantId: string | null };
  postLimit: number;
  meetupLimit: number;
  conversationLimit: number | null;
  postsUsed: number;
  meetupsUsed: number;
  conversationsUsed: number;
  conversationPeriod: 'day' | 'active';
  meetupSlotsLocked: number;
  meetupSlotsAvailable: number;
  meetupUnlocksAt: string[];
  conversationSlotsLocked: number;
  conversationSlotsAvailable: number | null;
  conversationUnlocksAt: string[];
};

export type MembershipOffer = {
  id: string;
  tier: 'plus' | 'pro' | 'premium';
  kind?: MembershipKind;
  planVersion?: 2;
  period: 'month' | 'year';
  price: string;
  productId: string;
};

export function membershipOffer(item: { identifier: string; product: { identifier: string; priceString: string; subscriptionPeriod: string | null } }): MembershipOffer | null {
  const current = /^(general|business)_(plus|pro|premium)_(monthly|yearly)$/.exec(item.identifier);
  if (current) {
    const kind = current[1] as MembershipKind, tier = current[2] as MembershipOffer['tier'], yearly = current[3] === 'yearly';
    if (!membershipProductIds(kind, tier).includes(item.product.identifier) || !item.product.identifier.includes(yearly ? 'yearly' : 'monthly')
      || !item.product.priceString || item.product.subscriptionPeriod !== (yearly ? 'P1Y' : 'P1M')) return null;
    return { id: item.identifier, kind, planVersion: 2, tier, period: yearly ? 'year' : 'month', price: item.product.priceString, productId: item.product.identifier };
  }
  const match = /^(plus|premium)_(monthly|yearly)$/.exec(item.identifier);
  if (!match || !item.product.priceString || item.product.subscriptionPeriod !== (match[2] === 'monthly' ? 'P1M' : 'P1Y')) return null;
  if (/\.v2$|_v2:/.test(item.product.identifier)) return null;
  return { id: item.identifier, tier: match[1] as 'plus' | 'premium', period: match[2] === 'monthly' ? 'month' : 'year', price: item.product.priceString, productId: item.product.identifier };
}

// 연간 상품 옆 취소선 가격(월 가격 × 12). 스토어 가격 문자열의 통화·서식을 그대로 쓴다: CA$9.99 → CA$119.88, ₩11,000 → ₩132,000, 9,99 € → 119,88 €.
export function yearlyListPrice(monthlyPrice: string): string | null {
  const match = /(\d[\d.,]*\d|\d)/.exec(monthlyPrice);
  if (!match) return null;
  const raw = match[1];
  const decimalSep = /[.,]\d{2}$/.test(raw) ? raw[raw.length - 3] : null;
  const thousandsSep = raw.replace(decimalSep ? new RegExp(`\\${decimalSep}\\d{2}$`) : /$/, '').match(/[.,]/)?.[0] ?? null;
  const value = Number(raw.replace(/[.,]/g, (ch) => (ch === decimalSep ? '.' : '')));
  if (!Number.isFinite(value) || value <= 0) return null;
  const [whole, fraction] = (value * 12).toFixed(decimalSep ? 2 : 0).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep ?? ',');
  return monthlyPrice.replace(raw, fraction ? `${grouped}${decimalSep}${fraction}` : grouped);
}
