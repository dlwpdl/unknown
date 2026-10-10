// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cafeStateHash, parseCafeBoardUrl, encryptCafeTokens, decryptCafeTokens, cafeMultipart, submitCafeArticle } from '../_shared/naver-cafe.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERRORS = new Set(['AUTH_REQUIRED', 'MERCHANT_ACCESS_REQUIRED', 'MERCHANT_OWNER_VERIFICATION_REQUIRED', 'MERCHANT_OPERATIONS_PAUSED',
  'MERCHANT_CONSENT_REQUIRED', 'MERCHANT_DRAFT_CHANGED', 'MERCHANT_DRAFT_APPROVAL_REQUIRED', 'MERCHANT_DRAFT_NOT_FOUND',
  'MERCHANT_REQUEST_CONFLICT', 'INVALID_NAVER_BOARD_URL', 'INVALID_NAVER_STATE', 'NAVER_NOT_CONFIGURED', 'NAVER_RECONNECT_REQUIRED',
  'NAVER_INVALID_PHOTO', 'NAVER_PHOTOS_CHANGED', 'INVALID_IMAGE_PATH', 'NAVER_CONTENT_REVIEW_REQUIRED', 'CONTENT_NOT_ALLOWED', 'RATE_LIMITED']);
const env = (key: string) => Deno.env.get(key);
function settings() {
  const url = env('SUPABASE_URL');
  const clientId = env('NAVER_CAFE_CLIENT_ID'); const clientSecret = env('NAVER_CAFE_CLIENT_SECRET'); const key = env('NAVER_CAFE_TOKEN_KEY');
  const returnUrl = env('NAVER_CAFE_RETURN_URL');
  let origin = '';
  try {
    const parsed = new URL(returnUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) throw new Error();
    origin = parsed.origin;
  } catch { return null; }
  try { if (atob(key).length !== 32) return null; } catch { return null; }
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !clientId || !clientSecret || !key) return null;
  return { url, clientId, clientSecret, key, returnUrl, origin, callback: `${url}/functions/v1/naver-cafe/callback` };
}
const headers = (origin: string | null) => ({
  ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
});
function json(value: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers(origin), 'Content-Type': 'application/json' } });
}
async function rpc(client, name: string, args = {}) {
  const response = await client.rpc(name, args);
  if (response.error) {
    const code = [...SAFE_ERRORS].find(code => response.error.message?.includes(code));
    throw new Error(code ?? 'NAVER_REQUEST_FAILED');
  }
  return response.data;
}
function clients(authorization: string) {
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    user: createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { ...options, global: { headers: { Authorization: authorization } } }),
    service: createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), options),
  };
}
const publicRequest = row => ({ id: row.id, draft_id: row.draft_id, draft_revision: row.draft_revision, board_url: row.board_url,
  status: row.status, article_url: row.article_url, error_code: row.error_code, created_at: row.created_at, completed_at: row.completed_at });

Deno.serve(async (request) => {
  const config = settings();
  const requestedOrigin = request.headers.get('origin');
  // Development origins are explicit configuration, never inferred from caller input.
  const configuredOrigins = (env('NAVER_CAFE_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const allowedOrigins = [config?.origin, 'https://gling.ej-entertainment.com', ...configuredOrigins];
  const origin = requestedOrigin && allowedOrigins.includes(requestedOrigin) ? requestedOrigin : null;
  if (requestedOrigin && !origin) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(origin) });
  const callback = new URL(request.url).pathname.endsWith('/callback');
  if (callback) {
    if (request.method !== 'GET' || !config) return json({ error: 'NAVER_NOT_CONFIGURED' }, 503);
    try {
      const query = new URL(request.url).searchParams;
      const state = query.get('state'); const code = query.get('code');
      if (!state || !/^[a-f0-9]{64}$/.test(state) || query.getAll('state').length !== 1) throw new Error('INVALID_NAVER_STATE');
      if (!code || query.get('error') || code.length > 2048 || query.getAll('code').length !== 1) throw new Error('NAVER_AUTH_DENIED');
      // The authenticated merchant web page completes OAuth, binding the actual browser account.
      const next = new URL(config.returnUrl);
      next.search = new URLSearchParams({ naver_cafe: 'finish', state, code }).toString();
      return new Response(null, { status: 303, headers: { ...headers(null), Location: next.href } });
    } catch {
      // Callback parameters/provider errors never appear in returned pages or logs.
      return new Response(null, { status: 303, headers: { ...headers(null), Location: `${config.returnUrl}?naver_cafe=failed` } });
    }
  }
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, origin);
  if (Number(request.headers.get('content-length')) > 32_000) return json({ error: 'INVALID_INPUT' }, 400, origin);
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED');
    const { user, service } = clients(authorization);
    const authenticated = await user.auth.getUser();
    if (authenticated.error || !authenticated.data?.user) throw new Error('AUTH_REQUIRED');
    const actor = authenticated.data.user.id;
    const raw = await request.text();
    if (raw.length > 32_000) return json({ error: 'INVALID_INPUT' }, 400, origin);
    const input = JSON.parse(raw);
    if (!input || typeof input.action !== 'string') return json({ error: 'INVALID_INPUT' }, 400, origin);
    if (await rpc(user, 'get_my_merchant_access') !== true) throw new Error('MERCHANT_ACCESS_REQUIRED');
    if (input.action === 'complete') {
      if (!config) throw new Error('NAVER_NOT_CONFIGURED');
      if (typeof input.state !== 'string' || !/^[a-f0-9]{64}$/.test(input.state) || typeof input.code !== 'string' || !input.code || input.code.length > 2048) throw new Error('INVALID_NAVER_STATE');
      const stateHash = await cafeStateHash(input.state);
      const binding = await rpc(service, 'consume_merchant_naver_oauth', { p_state_hash: stateHash, p_user_id: actor });
      const tokens = await naverTokens(config, { grant_type: 'authorization_code', code: input.code, state: input.state, redirect_uri: config.callback });
      const encrypted = await encryptCafeTokens({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }, config.key, `${binding.merchant_id}:${actor}`);
      await rpc(service, 'complete_merchant_naver_oauth', { p_state_hash: stateHash, p_encrypted_tokens: encrypted, p_expires_at: tokens.expires_at });
      return json({ connected: true, merchantId: binding.merchant_id }, 200, origin);
    }
    if (!UUID.test(input.merchantId)) return json({ error: 'INVALID_INPUT' }, 400, origin);
    const workspace = await rpc(user, 'get_merchant_workspace', { p_merchant_id: input.merchantId });
    if (workspace?.merchant?.owner_id !== actor) throw new Error('MERCHANT_ACCESS_REQUIRED');
    if (!workspace.merchant.owner_verified_at) throw new Error('MERCHANT_OWNER_VERIFICATION_REQUIRED');
    if (workspace.merchant.status === 'paused') throw new Error('MERCHANT_OPERATIONS_PAUSED');
    const status = await rpc(user, 'get_merchant_naver_cafe', { p_merchant_id: input.merchantId });
    if (input.action === 'status') return json({ configured: !!config, ...status, photoCompatibility: 'unverified' }, 200, origin);
    if (input.action === 'cancel') {
      if (!UUID.test(input.requestId)) return json({ error: 'INVALID_INPUT' }, 400, origin);
      const cancelled = await rpc(user, 'cancel_merchant_naver_preparation', { p_merchant_id: input.merchantId, p_request_id: input.requestId });
      return json({ request: publicRequest(cancelled) }, 200, origin);
    }
    if (!config) throw new Error('NAVER_NOT_CONFIGURED');
    if (input.action === 'start') {
      const state = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      await rpc(user, 'begin_merchant_naver_oauth', { p_merchant_id: input.merchantId, p_state_hash: await cafeStateHash(state) });
      const url = new URL('https://nid.naver.com/oauth2.0/authorize');
      url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.callback, state }).toString();
      return json({ authorizationUrl: url.href }, 200, origin);
    }
    if (input.action === 'disconnect') {
      const connection = await rpc(service, 'get_merchant_naver_tokens', { p_merchant_id: input.merchantId, p_user_id: actor });
      await rpc(user, 'disconnect_merchant_naver_cafe', { p_merchant_id: input.merchantId });
      let revoked = !connection;
      if (connection) {
        try {
          const tokens = await decryptCafeTokens(connection.encrypted_tokens, config.key, `${input.merchantId}:${actor}`);
          const response = await fetch('https://nid.naver.com/oauth2.0/revoke', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
              token: tokens.refresh_token, token_type_hint: 'refresh_token' }), redirect: 'error', signal: AbortSignal.timeout(10_000),
          });
          revoked = response.status === 200;
        } catch { revoked = false; }
      }
      return json({ disconnected: true, providerRevoked: revoked }, 200, origin);
    }
    if (input.action !== 'publish' || input.confirmed !== true || !UUID.test(input.requestId) || !UUID.test(input.draftId)
      || typeof input.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdatedAt))
      || !Array.isArray(input.imagePaths) || input.imagePaths.length > 6 || input.imagePaths.some(path => typeof path !== 'string')) return json({ error: 'INVALID_INPUT' }, 400, origin);
    const board = parseCafeBoardUrl(input.boardUrl);
    const connection = await rpc(service, 'get_merchant_naver_tokens', { p_merchant_id: input.merchantId, p_user_id: actor });
    if (!connection) throw new Error('NAVER_RECONNECT_REQUIRED');
    let tokens = await decryptCafeTokens(connection.encrypted_tokens, config.key, `${input.merchantId}:${actor}`);
    if (Date.parse(connection.expires_at) <= Date.now() + 30_000) {
      let fresh;
      try { fresh = await naverTokens(config, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }); }
      catch (error) {
        if (error?.message === 'NAVER_CONNECTION_UNUSABLE') {
          await rpc(service, 'mark_merchant_naver_connection_unusable', { p_merchant_id: input.merchantId, p_user_id: actor, p_generation: connection.generation });
          throw new Error('NAVER_RECONNECT_REQUIRED');
        }
        throw error;
      }
      tokens = { access_token: fresh.access_token, refresh_token: fresh.refresh_token || tokens.refresh_token };
      await rpc(service, 'refresh_merchant_naver_tokens', { p_merchant_id: input.merchantId, p_user_id: actor, p_generation: connection.generation,
        p_encrypted_tokens: await encryptCafeTokens(tokens, config.key, `${input.merchantId}:${actor}`), p_expires_at: fresh.expires_at });
    }
    const reservation = await rpc(user, 'reserve_merchant_naver_publish', { p_merchant_id: input.merchantId, p_draft_id: input.draftId,
      p_expected_updated_at: input.expectedUpdatedAt, p_request_id: input.requestId, p_club_id: board.clubId, p_menu_id: board.menuId, p_image_paths: input.imagePaths });
    if (reservation.status !== 'prepared') return json({ request: publicRequest(reservation) }, 200, origin);
    if (reservation.connection_generation !== connection.generation) throw new Error('NAVER_RECONNECT_REQUIRED');
    const photos: Blob[] = [];
    for (const path of reservation.snapshot.image_paths) {
      if (!new RegExp(`^${actor}/[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp)$`).test(path)) throw new Error('INVALID_IMAGE_PATH');
      // Fixed project storage + authenticated RLS; no arbitrary image URL or service-role download.
      const image = await user.storage.from('post-images').download(path);
      if (image.error || !image.data) throw new Error('NAVER_INVALID_PHOTO');
      photos.push(image.data);
    }
    await cafeMultipart(reservation.snapshot, photos);
    const claimed = await rpc(user, 'claim_merchant_naver_publish', { p_request_id: reservation.id });
    if (!claimed.should_send) return json({ request: publicRequest(claimed.request) }, 200, origin);
    const outcome = await submitCafeArticle(board, claimed.request.snapshot, photos, tokens.access_token);
    try {
      const completed = await rpc(service, 'complete_merchant_naver_publish', { p_request_id: reservation.id,
        p_status: outcome.status, p_article_url: outcome.articleUrl, p_error_code: outcome.errorCode });
      return json({ request: publicRequest(completed) }, 200, origin);
    } catch {
      // Keep the durable in-flight row: a provider success plus a failed receipt write must not repost.
      return json({ request: { ...publicRequest(claimed.request), status: 'uncertain', error_code: 'NAVER_RECEIPT_SAVE_UNCERTAIN', article_url: outcome.articleUrl } }, 200, origin);
    }
  } catch (error) {
    const code = SAFE_ERRORS.has(error?.message) ? error.message : 'NAVER_REQUEST_FAILED';
    return json({ error: code }, code === 'AUTH_REQUIRED' ? 401 : code === 'NAVER_NOT_CONFIGURED' ? 503 : 400, origin);
  }
});

async function naverTokens(config, parameters: Record<string, string>) {
  const response = await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }),
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json().catch(() => null);
  if (parameters.grant_type === 'refresh_token' && ['invalid_grant', 'invalid_token'].includes(value?.error)) {
    throw new Error('NAVER_CONNECTION_UNUSABLE');
  }
  const expiry = Number(value?.expires_in);
  if (!response.ok || typeof value?.access_token !== 'string' || !value.access_token || !Number.isFinite(expiry) || expiry < 60 || expiry > 172800
    || (parameters.grant_type === 'authorization_code' && (typeof value.refresh_token !== 'string' || !value.refresh_token))) throw new Error('NAVER_RECONNECT_REQUIRED');
  return { access_token: value.access_token, refresh_token: value.refresh_token ?? parameters.refresh_token,
    expires_at: new Date(Date.now() + expiry * 1000).toISOString() };
}
