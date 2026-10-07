// @ts-nocheck -- Deno edge runtime (same deployment pattern as membership).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRevenueRequest, loadImpactRevenue, revenuePeriod } from '../_shared/impact-revenue.ts';

// ponytail: per-isolate five-minute cache; shared cache only if admin traffic warrants it.
const cache = new Map();
const inFlight = new Map();
function userClient(authorization) {
  return createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } },
  });
}

Deno.serve((request) => handleRevenueRequest(request, {
  getUser: async (authorization) => {
    const { data, error } = await userClient(authorization).auth.getUser();
    return error ? null : data.user;
  },
  audit: async (authorization) => {
    const { error } = await userClient(authorization).rpc('log_admin_access', { scope: 'analytics' });
    if (error) throw new Error('AUDIT_UNAVAILABLE');
  },
  load: async (month) => {
    const now = new Date();
    revenuePeriod(month, now);
    const config = {
      accountSid: Deno.env.get('IMPACT_ACCOUNT_SID') ?? '',
      authToken: Deno.env.get('IMPACT_AUTH_TOKEN') ?? '',
      campaignIds: (Deno.env.get('IMPACT_TICKETMASTER_CAMPAIGN_IDS') ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    };
    if (!config.accountSid || !config.authToken || !config.campaignIds.length) return { connected: false, month, generatedAt: null, totals: [] };
    for (const [key, entry] of cache) if (entry.expires <= now.getTime()) cache.delete(key);
    if (cache.has(month)) return cache.get(month).data;
    if (inFlight.has(month)) return inFlight.get(month);
    const request = loadImpactRevenue(config, month, now).then((data) => {
      cache.set(month, { data, expires: Date.now() + 5 * 60_000 });
      return data;
    }).finally(() => inFlight.delete(month));
    inFlight.set(month, request);
    return request;
  },
}));
