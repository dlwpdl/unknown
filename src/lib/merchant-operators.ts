import type { SupabaseClient } from '@supabase/supabase-js';

export type MerchantOperatorLinks = { limit: number; operators: number; links: { id: string; created_at: string; expires_at: string }[] };
export type MerchantOperatorPreview = { merchant_name: string; city_name: string; expires_at: string };

const INVITE_PARAM = 'operator_invite';
const tokenPattern = /^[A-Za-z0-9_-]{32}$/;

async function call<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data == null) throw new Error('MERCHANT_INVITATION_NOT_AVAILABLE');
  return data as T;
}

export const loadMerchantOperatorLinks = (client: SupabaseClient, merchantId: string) => call<MerchantOperatorLinks>(client, 'get_merchant_operator_links', { p_merchant_id: merchantId });
export const createMerchantOperatorLink = (client: SupabaseClient, merchantId: string) => call<{ id: string; token: string; expires_at: string }>(client, 'create_merchant_operator_link', { p_merchant_id: merchantId });
export const revokeMerchantOperatorLink = (client: SupabaseClient, linkId: string) => call<boolean>(client, 'revoke_merchant_operator_link', { p_link_id: linkId });
export const previewMerchantOperatorLink = (client: SupabaseClient, token: string) => call<MerchantOperatorPreview>(client, 'preview_merchant_operator_link', { p_token: token });
export const acceptMerchantOperatorLink = (client: SupabaseClient, token: string) => call<string>(client, 'accept_merchant_operator_link', { p_token: token });

export const merchantOperatorInviteUrl = (token: string, base = 'https://gling.ej-entertainment.com/merchant/') => `${base}?${INVITE_PARAM}=${token}`;

// Reads the one-time token from the business web URL; anything malformed is ignored rather than sent to the server.
export function readMerchantOperatorInvite(search: string): string | null {
  const token = new URLSearchParams(search).get(INVITE_PARAM);
  return token && tokenPattern.test(token) ? token : null;
}
export const MERCHANT_OPERATOR_INVITE_PARAM = INVITE_PARAM;
