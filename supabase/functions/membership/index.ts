// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseRevenueCatMembership, webhookUserIds } from '../_shared/membership.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'AUTH_REQUIRED' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    ...options, global: { headers: { Authorization: authorization } },
  });
  const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const isWebhook = !!webhookSecret && authorization === `Bearer ${webhookSecret}`;
  let userIds: string[];
  let webhookEvent: Record<string, unknown> | undefined;
  if (isWebhook) {
    const body = await request.text();
    if (body.length > 65_536) return json({ error: 'INVALID_WEBHOOK' }, 400);
    try {
      const parsed = JSON.parse(body);
      userIds = webhookUserIds(parsed);
      webhookEvent = parsed.event;
    }
    catch { return json({ error: 'INVALID_WEBHOOK' }, 400); }
  } else {
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: 'AUTH_REQUIRED' }, 401);
    // Never accept a user ID, tier, receipt status or expiry from the app.
    userIds = [user.id];
    const limit = await userClient.rpc('begin_membership_sync');
    if (limit.error) return json({ error: 'SYNC_RATE_LIMITED' }, 429);
  }
  if (!userIds.length) return json({ received: true });
  const apiKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
  if (!apiKey) return json({ error: 'MEMBERSHIP_NOT_CONFIGURED' }, 503);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
  const sandboxUsers = new Set((Deno.env.get('REVENUECAT_SANDBOX_USER_IDS') ?? '').split(',').map((id) => id.trim()));
  try {
    if (webhookEvent) {
      const recorded = await admin.rpc('record_payment_event', { p_event: webhookEvent });
      if (recorded.error) throw recorded.error;
    }
    // Re-read authoritative state for every delivery, including retries and transfers.
    // Repeated snapshots never increment allowances; older snapshots cannot replace newer ones.
    await Promise.all(userIds.map(async (userId) => {
      const profile = await admin.from('profiles').select('account_status').eq('id', userId).maybeSingle();
      if (profile.error) throw profile.error;
      if (!profile.data || profile.data.account_status !== 'active') return;
      const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('REVENUECAT_UNAVAILABLE');
      const snapshot = parseRevenueCatMembership(await response.json(), { allowSandbox: sandboxUsers.has(userId) });
      const updated = await admin.rpc('apply_membership_snapshot', {
        p_user_id: userId, p_entitlements: snapshot.entitlements, p_observed_at: snapshot.observedAt,
      });
      if (updated.error) throw updated.error;
    }));
    if (isWebhook) return json({ received: true });
    const membership = await userClient.rpc('get_membership');
    if (membership.error) throw membership.error;
    return json({ membership: membership.data });
  } catch {
    // Return a failure so RevenueCat retries; do not turn provider failures into free membership.
    return json({ error: 'MEMBERSHIP_SYNC_FAILED' }, 502);
  }
});
