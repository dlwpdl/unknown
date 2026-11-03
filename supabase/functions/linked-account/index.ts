// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { linkedAccountIds, switchDenial } from '../_shared/linked-account.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'AUTH_REQUIRED' }, 401);
  const input = await request.json().catch(() => ({}));
  if (input?.action !== 'list' && input?.action !== 'switch') return json({ error: 'INVALID_ACTION' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'AUTH_REQUIRED' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Decide from the stored account and profile, never from metadata inside the caller's JWT.
  async function account(id: string) {
    const [stored, profile] = await Promise.all([
      admin.auth.admin.getUserById(id),
      admin.from('profiles').select('nickname,account_status').eq('id', id).maybeSingle(),
    ]);
    if (profile.error || (stored.error && stored.error.status !== 404)) throw new Error('LOOKUP_FAILED');
    return { user: stored.data?.user ?? null, profile: profile.data };
  }

  try {
    const caller = await account(user.id);
    if (!caller.user) return json({ error: 'AUTH_REQUIRED' }, 401);
    const callerStatus = caller.profile?.account_status ?? null;
    const linked = linkedAccountIds(caller.user);

    if (input.action === 'switch') {
      // Only ids the caller links to are looked up, so other ids reveal nothing.
      const target = linked.includes(input.target) ? await account(input.target) : { user: null, profile: null };
      const denial = switchDenial(caller.user, callerStatus, target.user, target.profile?.account_status ?? null);
      if (denial) return json({ error: denial }, 403);
      const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: target.user.email });
      const tokenHash = data?.properties?.hashed_token;
      if (error || typeof tokenHash !== 'string') return json({ error: 'LINK_FAILED' }, 500);
      return json({ token_hash: tokenHash });
    }

    const accounts = [];
    for (const id of linked) {
      const target = await account(id);
      if (switchDenial(caller.user, callerStatus, target.user, target.profile?.account_status ?? null)) continue;
      const fallback = target.user.user_metadata?.nickname;
      accounts.push({ id, nickname: target.profile?.nickname ?? (typeof fallback === 'string' ? fallback : '') });
    }
    return json({ accounts });
  } catch {
    return json({ error: 'LOOKUP_FAILED' }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
