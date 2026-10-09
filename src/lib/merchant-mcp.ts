import type { SupabaseClient } from '@supabase/supabase-js';
import { attachMerchantProfileImages } from './merchant-profile.ts';

export type MerchantMcpAuthorization = { authorization_id: string; client_id: string; client_name: string; redirect_uri: string; scope: string; expires_at: string };
export type MerchantMcpConnection = { id: string; client_id: string; client_name: string; merchant_ids: string[]; allow_drafts: boolean; allow_publish: boolean; is_connected: boolean;
  businesses: { id: string; name: string }[]; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null };
export type MerchantMcpChange = { id: string; kind: 'profile' | 'edit_post' | 'delete_post'; post_id: string | null;
  before_value: Record<string, unknown>; changes: Record<string, unknown>; status: 'pending' | 'applied' | 'rejected'; created_at: string; expires_at: string };
export type MerchantMcpPhotoGroup = { label: string; uris: string[] };
type Grant = { merchantIds: string[]; allowDrafts: boolean; allowPublish: boolean };
type ReturnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const returnKey = 'gling:merchant-ai:return:v1';
export const validMerchantMcpAuthorizationId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value);
export function rememberMerchantMcpReturn(storage: ReturnStorage, id: string, now = Date.now()) {
  if (!validMerchantMcpAuthorizationId(id)) throw new Error('INVALID_MCP_INPUT');
  storage.setItem(returnKey, JSON.stringify({ id, at: now }));
}
export function merchantMcpReturnPath(storage: ReturnStorage, now = Date.now()): '/' | `/ai?authorization_id=${string}` {
  try {
    const saved = JSON.parse(storage.getItem(returnKey) ?? 'null'); storage.removeItem(returnKey);
    return saved && validMerchantMcpAuthorizationId(saved.id) && typeof saved.at === 'number' && now >= saved.at && now - saved.at < 600000
      ? `/ai?authorization_id=${encodeURIComponent(saved.id)}` : '/';
  } catch { return '/'; }
}
export function safeMerchantMcpRedirect(value: string, expected: string): string {
  try {
    const target = new URL(value), base = new URL(expected);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) || base.username || base.password || base.hash
      || target.origin !== base.origin || target.pathname !== base.pathname || target.username || target.password || target.hash) throw new Error();
    for (const [key, original] of base.searchParams) if (target.searchParams.get(key) !== original) throw new Error();
    return target.href;
  } catch { throw new Error('MCP_REDIRECT_INVALID'); }
}
async function call<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data == null) throw new Error('MCP_DATA_MISSING');
  return data as T;
}
async function expectAccount(client: SupabaseClient, userId: string) {
  const { data, error } = await client.auth.getSession();
  if (error || data.session?.user.id !== userId) throw new Error('ACCOUNT_CHANGED');
}
export const loadMerchantMcpConnections = (client: SupabaseClient) => call<MerchantMcpConnection[]>(client, 'get_my_merchant_mcp_connections');
export const loadMerchantMcpChanges = (client: SupabaseClient, merchantId: string) => call<MerchantMcpChange[]>(client, 'get_my_merchant_mcp_changes', { p_merchant_id: merchantId });
export const loadMerchantMcpAuthorization = (client: SupabaseClient, authorizationId: string) => call<MerchantMcpAuthorization>(client, 'get_merchant_mcp_authorization', { p_authorization_id: authorizationId });
export async function connectMerchantMcp(client: SupabaseClient, userId: string, authorization: MerchantMcpAuthorization, grant: Grant): Promise<string> {
  if (!validMerchantMcpAuthorizationId(authorization.authorization_id) || authorization.scope !== 'offline_access') throw new Error('MCP_SCOPE_NOT_ALLOWED');
  if (!grant.merchantIds.length || grant.merchantIds.length > 50 || new Set(grant.merchantIds).size !== grant.merchantIds.length) throw new Error('INVALID_MCP_INPUT');
  await expectAccount(client, userId);
  const connection = await call<{ id: string }>(client, 'save_merchant_mcp_connection', { p_expected_actor_id: userId, p_client_id: authorization.client_id, p_merchant_ids: grant.merchantIds,
    p_allow_drafts: grant.allowDrafts, p_allow_publish: grant.allowPublish });
  try {
    await expectAccount(client, userId);
    // Delay native auto-approval until the owner has reviewed the business grant.
    const details = await client.auth.oauth.getAuthorizationDetails(authorization.authorization_id);
    if (details.error || !details.data) throw new Error('MCP_CONNECT_FAILED');
    await expectAccount(client, userId);
    // A second server read also catches A -> B -> A during native auto-approval.
    await loadMerchantMcpAuthorization(client, authorization.authorization_id);
    await expectAccount(client, userId);
    if ('redirect_url' in details.data) return safeMerchantMcpRedirect(details.data.redirect_url, authorization.redirect_uri);
    if (details.data.user.id !== userId || details.data.client.id !== authorization.client_id || details.data.scope !== 'offline_access'
      || details.data.authorization_id !== authorization.authorization_id || details.data.redirect_uri !== authorization.redirect_uri) throw new Error('MCP_AUTHORIZATION_MISMATCH');
    await expectAccount(client, userId);
    const result = await client.auth.oauth.approveAuthorization(authorization.authorization_id, { skipBrowserRedirect: true });
    if (result.error || !result.data) throw new Error('MCP_CONNECT_FAILED');
    await expectAccount(client, userId);
    return safeMerchantMcpRedirect(result.data.redirect_url, authorization.redirect_uri);
  } catch (error) {
    const revoked = await client.rpc('revoke_merchant_mcp_connection', { p_connection_id: connection.id });
    if (revoked.error || revoked.data !== true) throw new Error('MCP_CONNECT_CLEANUP_PENDING');
    throw error;
  }
}
export async function denyMerchantMcp(client: SupabaseClient, userId: string, authorization: MerchantMcpAuthorization): Promise<string> {
  await expectAccount(client, userId);
  const details = await client.auth.oauth.getAuthorizationDetails(authorization.authorization_id);
  if (details.error || !details.data) throw new Error('MCP_AUTHORIZATION_EXPIRED');
  if ('redirect_url' in details.data) {
    // Discard an auto-approved code instead of sending it after the owner cancelled.
    const cancelled = new URL(safeMerchantMcpRedirect(details.data.redirect_url, authorization.redirect_uri));
    cancelled.searchParams.delete('code'); cancelled.searchParams.set('error', 'access_denied');
    return cancelled.href;
  }
  if (details.data.user.id !== userId || details.data.client.id !== authorization.client_id) throw new Error('MCP_AUTHORIZATION_MISMATCH');
  await expectAccount(client, userId);
  const result = await client.auth.oauth.denyAuthorization(authorization.authorization_id, { skipBrowserRedirect: true });
  if (result.error || !result.data) throw new Error('MCP_CONNECT_FAILED');
  return safeMerchantMcpRedirect(result.data.redirect_url, authorization.redirect_uri);
}
export async function revokeMerchantMcp(client: SupabaseClient, userId: string, connectionId: string): Promise<void> {
  await expectAccount(client, userId);
  if (await call<boolean>(client, 'revoke_merchant_mcp_connection', { p_connection_id: connectionId }) !== true) throw new Error('MCP_REVOKE_NOT_VERIFIED');
}
export async function reviewMerchantMcpChange(client: SupabaseClient, userId: string, requestId: string, apply: boolean) {
  await expectAccount(client, userId);
  return call<{ id: string; status: string }>(client, 'review_merchant_mcp_change', { p_request_id: requestId, p_apply: apply });
}
export async function loadMerchantMcpChangePhotos(client: SupabaseClient, change: MerchantMcpChange): Promise<MerchantMcpPhotoGroup[]> {
  if (change.kind === 'profile') {
    const fields = (['avatar_path', 'banner_path'] as const).filter(field => field in change.changes);
    if (!fields.length) return [];
    const profile = (values: Record<string, unknown>) => ({ avatar_path: typeof values.avatar_path === 'string' ? values.avatar_path : null,
      banner_path: typeof values.banner_path === 'string' ? values.banner_path : null });
    const [before, after] = await Promise.all([attachMerchantProfileImages(client, profile(change.before_value)),
      attachMerchantProfileImages(client, profile({ ...change.before_value, ...change.changes }))]);
    if (before.imageLoadFailed || after.imageLoadFailed) throw new Error('MCP_PHOTO_PREVIEW_FAILED');
    return fields.flatMap(field => {
      const label = field === 'avatar_path' ? '프로필 사진' : '커버 사진', key = field === 'avatar_path' ? 'avatarUri' : 'bannerUri';
      return [{ label: `현재 ${label}`, uris: before[key] ? [before[key]] : [] }, { label: `제안한 ${label}`, uris: after[key] ? [after[key]] : [] }];
    });
  }
  const paths = (value: unknown): string[] => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 10 || value.some(path => typeof path !== 'string' || !path)) throw new Error('MCP_PHOTO_PREVIEW_FAILED');
    return value;
  };
  const groups = [{ label: change.kind === 'delete_post' ? '삭제할 글의 사진' : '현재 사진', paths: paths(change.before_value.image_paths) }];
  if (change.kind === 'edit_post' && 'image_paths' in change.changes) groups.push({ label: '제안한 사진', paths: paths(change.changes.image_paths) });
  const unique = [...new Set(groups.flatMap(group => group.paths))];
  if (!unique.length) return groups.map(group => ({ label: group.label, uris: [] }));
  const result = await client.storage.from('post-images').createSignedUrls(unique, 60);
  const urls = new Map(result.data?.filter(row => row.path && row.signedUrl).map(row => [row.path!, row.signedUrl!]));
  if (result.error || unique.some(path => !urls.has(path))) throw new Error('MCP_PHOTO_PREVIEW_FAILED');
  return groups.map(group => ({ label: group.label, uris: group.paths.map(path => urls.get(path)!) }));
}
