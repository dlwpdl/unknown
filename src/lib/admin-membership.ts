import type { SupabaseClient } from '@supabase/supabase-js';

export type GrantTier = 'plus' | 'pro' | 'premium';
export type MembershipSource = 'free' | 'store' | 'reward' | 'admin' | 'operator';
export type AdminGrant = { tier: GrantTier; expires_at: string; active: boolean; note: string | null; created_at: string; created_by: string | null };
export type AdminMembershipState = { tier: string; source: MembershipSource; expires_at: string | null; will_renew: boolean | null; grant: AdminGrant | null };
export type AdminBusinessMembership = AdminMembershipState & { merchant_id: string; name: string; city_name: string; owner_verified: boolean; bound_elsewhere: boolean };
export type AdminMembershipHistory = { id: number; kind: 'general' | 'business'; merchant_name: string | null; tier: GrantTier | null; expires_at: string | null; note: string | null; created_at: string; created_by: string | null };
export type AdminMembership = { user_id: string; personal: AdminMembershipState; businesses: AdminBusinessMembership[]; history: AdminMembershipHistory[] };

export const GRANT_TIERS: GrantTier[] = ['plus', 'pro', 'premium'];
export const MEMBERSHIP_TIER_LABELS: Record<string, string> = { free: '무료', plus: '플러스', pro: '프로', premium: '프리미엄', admin: '운영자(제한 없음)' };
export const MEMBERSHIP_SOURCE_LABELS: Record<MembershipSource, string> = {
  free: '무료', store: '스토어 결제', reward: '초대 이용권', admin: '관리자 지급', operator: '운영자 계정',
};
export const MEMBERSHIP_ERRORS: Record<string, string> = {
  ADMIN_REQUIRED: '관리자 2단계 인증을 다시 확인해 주세요.',
  INVALID_MEMBERSHIP_TIER: '플러스·프로·프리미엄 중에서 골라 주세요.',
  INVALID_MEMBERSHIP_EXPIRY: '끝나는 날은 오늘부터 3년 안에서 골라 주세요.',
  INVALID_MEMBERSHIP_NOTE: '메모는 500자까지 쓸 수 있어요.',
  USER_NOT_FOUND: '이용 중인 회원에게만 지급할 수 있어요.',
  MERCHANT_NOT_FOUND: '이 회원이 소유한 비즈니스를 찾지 못했어요. 새로 확인해 주세요.',
  MERCHANT_OWNER_VERIFICATION_REQUIRED: '비즈니스 소유 확인을 먼저 해 주세요.',
  BUSINESS_SUBSCRIPTION_BOUND: '이 회원의 다른 비즈니스에 비즈니스 멤버십이 이미 묶여 있어 지급할 수 없어요.',
};

const isTier = (value: unknown): value is GrantTier => GRANT_TIERS.includes(value as GrantTier);
const isSource = (value: unknown): value is MembershipSource => typeof value === 'string' && value in MEMBERSHIP_SOURCE_LABELS;
function state(value: unknown): value is AdminMembershipState {
  const row = value as AdminMembershipState | null;
  return !!row && typeof row.tier === 'string' && isSource(row.source)
    && (row.grant === null || (isTier(row.grant?.tier) && typeof row.grant.expires_at === 'string' && typeof row.grant.active === 'boolean'));
}

export function parseAdminMembership(value: unknown, userId: string): AdminMembership {
  const data = value as AdminMembership | null;
  if (!data || data.user_id !== userId || !state(data.personal) || !Array.isArray(data.businesses) || !Array.isArray(data.history)
    || !data.businesses.every(row => state(row) && typeof row.merchant_id === 'string' && typeof row.name === 'string')) throw new Error('MEMBERSHIP_READ_FAILED');
  return data;
}

/** Local YYYY-MM-DD `days` from now; the server ends the grant at the end of that day in the member's city. */
export function membershipEndDate(days: number, now = new Date(), timeZone = 'America/Vancouver') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() + days * 86400000));
}

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>, userId: string) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return parseAdminMembership(data, userId);
}
export const loadAdminMembership = (client: SupabaseClient, userId: string) => rpc(client, 'get_admin_membership', { p_user_id: userId }, userId);
export const setAdminMembership = (client: SupabaseClient, userId: string, merchantId: string | null, tier: GrantTier, endsOn: string, note: string) =>
  rpc(client, 'set_admin_membership', { p_user_id: userId, p_merchant_id: merchantId, p_tier: tier, p_expires_on: endsOn, p_note: note }, userId);
export const clearAdminMembership = (client: SupabaseClient, userId: string, merchantId: string | null, note: string) =>
  rpc(client, 'clear_admin_membership', { p_user_id: userId, p_merchant_id: merchantId, p_note: note }, userId);
