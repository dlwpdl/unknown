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
