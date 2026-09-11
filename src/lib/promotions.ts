import type { SupabaseClient } from '@supabase/supabase-js';

// Development opt-in only. Release builds never expose unfinished credit/promotion flows.
export const PROMOTIONS_PREVIEW_ENABLED = typeof __DEV__ !== 'undefined' && __DEV__
  && process.env.EXPO_PUBLIC_PROMOTIONS_PREVIEW === '1';

export type PromotionWallet = {
  balance: number; testBalance: number; configured: boolean;
  slotAvailable: number | null; slotLimit: number | null; slotStatus: 'ready' | 'not_ready';
  purchases: { id: string; transactionId: string; credits: number; refunded: boolean; createdAt: string; environment: string }[];
  campaigns: { id: string; postId: string; title: string; budget: number; delivered: number;
    status: 'active' | 'paused' | 'completed' | 'refunded'; environment: string; createdAt: string }[];
};
export type PromotionOffer = { id: string; credits: number; price: string; productId: string };

export function promotionOffer(item: { identifier: string; product: { identifier: string; priceString: string; subscriptionPeriod: string | null } }): PromotionOffer | null {
  const match = /^credits_(900|1700)$/.exec(item.identifier);
  if (!match || item.product.subscriptionPeriod !== null || !item.product.priceString
    || ![`com.dlwpdl.gling.credits.${match[1]}`, `gling_credits_${match[1]}`].includes(item.product.identifier)) return null;
  return { id: item.identifier, credits: Number(match[1]), price: item.product.priceString, productId: item.product.identifier };
}

export async function loadPromotionWallet(client: SupabaseClient): Promise<PromotionWallet> {
  const result = await client.rpc('get_promotion_wallet');
  if (result.error) throw result.error;
  return result.data;
}

export async function loadPromotablePosts(client: SupabaseClient, userId: string): Promise<{ id: string; title: string }[]> {
  const result = await client.from('posts').select('id,title').eq('author_id', userId).eq('status', 'published')
    .order('created_at', { ascending: false }).limit(50);
  if (result.error) throw result.error;
  return result.data ?? [];
}

export async function startPromotion(client: SupabaseClient, input: { postId: string; budget: number; requestId: string; allowNoSlots: boolean }): Promise<string> {
  const result = await client.rpc('start_promotion', {
    p_post_id: input.postId, p_budget: input.budget, p_request_id: input.requestId, p_allow_no_slots: input.allowNoSlots,
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function pausePromotion(client: SupabaseClient, id: string): Promise<void> {
  const result = await client.rpc('pause_promotion', { p_campaign_id: id });
  if (result.error) throw result.error;
}
