// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

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
  if (input.confirmation !== '탈퇴합니다') return json({ error: 'CONFIRMATION_REQUIRED' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'AUTH_REQUIRED' }, 401);

  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers
    : [user.app_metadata?.provider];
  if (providers.includes('apple')) {
    if (typeof input.appleAuthorizationCode !== 'string' || !input.appleAuthorizationCode) {
      return json({ error: 'APPLE_REAUTH_REQUIRED' }, 400);
    }
    const revoked = await revokeAppleAuthorization(input.appleAuthorizationCode);
    if (!revoked) return json({ error: 'APPLE_REVOCATION_FAILED' }, 502);
  }

  const purge = await userClient.rpc('delete_my_account', { p_confirmation: '탈퇴합니다' });
  if (purge.error) return json({ error: 'ACCOUNT_PURGE_FAILED' }, 500);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const deleted = await admin.auth.admin.deleteUser(user.id, false);
  if (deleted.error) return json({ error: 'AUTH_DELETE_FAILED' }, 500);

  return json({ deleted: true });
});

async function revokeAppleAuthorization(code: string) {
  const clientId = Deno.env.get('APPLE_CLIENT_ID') ?? 'com.dlwpdl.gling';
  const clientSecret = Deno.env.get('APPLE_CLIENT_SECRET');
  if (!clientSecret) return false;

  const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) return false;
  const tokens = await tokenResponse.json();
  const token = tokens.refresh_token ?? tokens.access_token;
  if (typeof token !== 'string') return false;

  const revokeResponse = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
    }),
  });
  return revokeResponse.ok;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
