// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteRevenueCatCustomer } from '../_shared/membership.ts';

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
  if (input?.confirmation !== '탈퇴합니다') return json({ error: 'CONFIRMATION_REQUIRED' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'AUTH_REQUIRED' }, 401);
  const billingKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
  if (!billingKey) return json({ error: 'BILLING_DELETE_NOT_CONFIGURED' }, 503);

  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers
    : [user.app_metadata?.provider];
  const kakaoId = user.identities?.find((identity) => identity.provider === 'kakao')?.identity_data?.sub;
  const kakaoAdminKey = Deno.env.get('KAKAO_ADMIN_KEY');
  if (providers.includes('kakao') && (!kakaoAdminKey || typeof kakaoId !== 'string' || !/^[1-9]\d*$/.test(kakaoId))) {
    return json({ error: 'KAKAO_UNLINK_NOT_CONFIGURED' }, 503);
  }
  if (providers.includes('apple')) {
    if (typeof input.appleAuthorizationCode !== 'string' || !input.appleAuthorizationCode) {
      return json({ error: 'APPLE_REAUTH_REQUIRED' }, 400);
    }
    const appleId = user.identities?.find((identity) => identity.provider === 'apple')?.identity_data?.sub;
    const revoked = await revokeAppleAuthorization(input.appleAuthorizationCode, appleId).catch(() => false);
    if (!revoked) return json({ error: 'APPLE_REVOCATION_FAILED' }, 502);
  }

  if (providers.includes('kakao')) {
    const unlinked = await unlinkKakao(kakaoId, kakaoAdminKey).catch(() => false);
    if (!unlinked) return json({ error: 'KAKAO_UNLINK_FAILED' }, 502);
  }

  // A customer-data deletion does not cancel a store subscription; the app explains this before confirmation.
  try { await deleteRevenueCatCustomer(user.id, billingKey); }
  catch { return json({ error: 'BILLING_DELETE_FAILED' }, 502); }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Keep images intact when provider verification or revocation fails.
  for (const bucket of ['avatars', 'post-images']) {
    while (true) {
      const listed = await admin.storage.from(bucket).list(user.id, { limit: 100 });
      if (listed.error) return json({ error: 'STORAGE_LIST_FAILED' }, 500);
      if (!listed.data.length) break;
      const removed = await admin.storage.from(bucket).remove(
        listed.data.map(({ name }) => `${user.id}/${name}`),
      );
      if (removed.error) return json({ error: 'STORAGE_DELETE_FAILED' }, 500);
    }
  }

  const purge = await userClient.rpc('delete_my_account', { p_confirmation: '탈퇴합니다' });
  if (purge.error) return json({ error: 'ACCOUNT_PURGE_FAILED' }, 500);

  const deleted = await admin.auth.admin.deleteUser(user.id, false);
  if (deleted.error) return json({ error: 'AUTH_DELETE_FAILED' }, 500);

  return json({ deleted: true });
});

async function revokeAppleAuthorization(code: string, appleId: unknown) {
  const clientId = Deno.env.get('APPLE_CLIENT_ID') ?? 'com.dlwpdl.gling';
  const clientSecret = Deno.env.get('APPLE_CLIENT_SECRET');
  if (!clientSecret || typeof appleId !== 'string' || !appleId) return false;

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
  // The token comes directly from Apple's HTTPS endpoint, not from request input.
  const claims = JSON.parse(atob(tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (claims.sub !== appleId) return false;
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

async function unlinkKakao(userId: string, adminKey: string) {
  const response = await fetch('https://kapi.kakao.com/v1/user/unlink', {
    method: 'POST',
    headers: {
      Authorization: `KakaoAK ${adminKey}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ target_id_type: 'user_id', target_id: userId }),
  });
  const result = await response.json();
  // Kakao -101 means this account is already disconnected; allow deletion retries.
  return (response.ok && String(result.id) === userId) || (response.status === 400 && result.code === -101);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
