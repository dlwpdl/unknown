import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalyticsFilters } from './admin-analytics';
import type { AcquisitionSource } from './product-analytics';

export type PerformancePlatform = 'all' | 'ios' | 'android' | 'web';
export type RetentionRow = { days: number; eligible: number; returned: number; pending: number; rate: number | null };
export type AdminPerformance = {
  generatedAt: string; periodStart: string; collectionStartedAt: string; trackingAvailableAt: string;
  activity: { dau: number; wau: number; mau: number; activeUsers: number; visits: number; visitsPerUser: number | null;
    daily: { day: string; users: number | null; visits: number | null; signups: number }[];
    platforms: { platform: string; users: number; visits: number }[] };
  growth: { newMembers: number; activatedMembers: number; activationRate: number | null; sourceStartedAt: string | null;
    sources: { source: AcquisitionSource; sessions: number; signupSessions: number; signupRate: number | null }[];
    onboarding: { target: string; sessions: number; members: number }[] };
  retention: RetentionRow[];
  cohorts: { day: string; joined: number; retention: RetentionRow[] }[];
  community: { posts: number; authors: number; comments: number; commenters: number; meetupRequests: number;
    approvedRequests: number; mutualConversations: number; savedPosts: number; sharedPosts: number };
  discovery: { startedAt: string | null; legacyEventViews: number | null;
    rows: { kind: string; cityId: string; targetId: string; title: string; views: number; directions: number; websites: number }[];
    eventSaves: null; eventShares: null; placeSaves: null; placeShares: null };
  notifications: { clickStartedAt: string | null; deliverySince: string; generated: number; providerAccepted: number;
    failed: number; pushOpens: number | null; inboxOpens: number | null; clickRate: number | null;
    activeAfterOpen: number | null; optedInMembers: number; preferenceMembers: number;
    rows: { kind: string; generated: number; providerAccepted: number; failed: number; pushOpens: number | null;
      inboxOpens: number | null; clickRate: number | null }[] };
  revenue: { paidMembers: number; paidConversion: number | null; renewals: number; cancellations: number;
    refunds: number | null; settlement: null;
    currencies: { currency: string; amount: number; purchases: number; buyers: number; renewals: number }[] };
  quality: { errorStartedAt: string | null; versions: { platform: string; version: string; members: number; visits: number }[];
    errorGroups: { platform: string; version: string; groups: number; lifetimeReports: number }[];
    failures: { kind: string; members: number }[];
    openReports: number; resolvedReports: number; averageResolutionHours: number | null };
};

export async function loadAdminPerformance(client: SupabaseClient, filters: AnalyticsFilters, platform: PerformancePlatform = 'all'): Promise<AdminPerformance> {
  const { data, error } = await client.rpc('get_admin_performance', {
    p_days: filters.days, p_city: filters.city, p_tier: filters.tier,
    p_include_internal: filters.includeInternal, p_platform: platform,
  });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data as AdminPerformance;
}
