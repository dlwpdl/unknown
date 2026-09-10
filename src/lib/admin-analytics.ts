import type { SupabaseClient } from '@supabase/supabase-js';

export type AnalyticsFilters = { days: 7 | 30 | 90; city: string | null; tier: 'all' | 'free' | 'plus' | 'premium'; includeInternal: boolean; offset: number };
export type Breakdown = { key: string; count: number };
export type AdminAnalytics = {
  generatedAt: string;
  periodStart: string;
  collectionStartedAt: string;
  counts: { members: number; newMembers: number; posts: number; activeUsers: number; screenViews: number; visits: number; uniquePostViews: number };
  daily: { day: string; activeUsers: number; screenViews: number; posts: number; newMembers: number }[];
  memberships: Breakdown[];
  cities: Breakdown[];
  ages: Breakdown[];
  members: { id: string; nickname: string; city: string | null; tier: string; createdAt: string; lastSignIn: string | null; status: string; internal: boolean }[];
  visits: { userId: string; nickname: string; platform: string; appVersion: string; screen: string; firstAt: string; lastAt: string; views: number }[];
  auditSummary: Breakdown[];
  audit: { id: number; actorId: string; scope: string; createdAt: string }[];
  errors: { id: number; status: string; attempts: number; createdAt: string }[];
  purchases: { currency: string; amount: number; purchases: number; buyers: number }[];
  buyers: { userId: string; nickname: string; currency: string; amount: number; purchases: number }[];
  paymentEvents: { id: string; type: string; productId: string; environment: string; occurredAt: string }[];
  promotions: { connected: false };
};

export async function loadAdminAnalytics(client: SupabaseClient, filters: AnalyticsFilters): Promise<AdminAnalytics> {
  const { data, error } = await client.rpc('get_admin_analytics', {
    p_days: filters.days, p_city: filters.city, p_tier: filters.tier,
    p_include_internal: filters.includeInternal, p_offset: filters.offset,
  });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data as AdminAnalytics;
}
