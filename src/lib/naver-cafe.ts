import type { SupabaseClient } from '@supabase/supabase-js';
export { parseCafeBoardUrl } from '../../supabase/functions/_shared/naver-cafe.ts';

export type MerchantNaverRequest = {
  id: string; draft_id: string; draft_revision: string; board_url: string;
  status: 'prepared' | 'in_flight' | 'succeeded' | 'failed' | 'uncertain';
  article_url: string | null; error_code: string | null; created_at: string; completed_at: string | null;
};
export type MerchantNaverStatus = {
  configured: boolean; connection: { connected_at: string; expires_at: string } | null;
  requests: MerchantNaverRequest[]; photoCompatibility: 'unverified';
};
export type MerchantNaverPublish = {
  requestId: string; draftId: string; expectedUpdatedAt: string; boardUrl: string; imagePaths: string[]; confirmed: true;
};
async function invoke<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('naver-cafe', { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(typeof detail?.error === 'string' ? detail.error : 'NAVER_STATUS_UNAVAILABLE');
  }
  if (data?.error || data == null) throw new Error(data?.error ?? 'NAVER_STATUS_UNAVAILABLE');
  return data as T;
}
export const loadMerchantNaverCafe = (client: SupabaseClient, merchantId: string) => invoke<MerchantNaverStatus>(client, { action: 'status', merchantId });
export const startMerchantNaverCafe = (client: SupabaseClient, merchantId: string) => invoke<{ authorizationUrl: string }>(client, { action: 'start', merchantId });
export const completeMerchantNaverCafe = (client: SupabaseClient, state: string, code: string) => invoke<{ connected: true; merchantId: string }>(client, { action: 'complete', state, code });
export const disconnectMerchantNaverCafe = (client: SupabaseClient, merchantId: string) => invoke<{ disconnected: true; providerRevoked: boolean }>(client, { action: 'disconnect', merchantId });
export const publishMerchantNaverCafe = (client: SupabaseClient, merchantId: string, input: MerchantNaverPublish) => invoke<{ request: MerchantNaverRequest }>(client, {
  action: 'publish', merchantId, requestId: input.requestId, draftId: input.draftId, expectedUpdatedAt: input.expectedUpdatedAt,
  boardUrl: input.boardUrl, imagePaths: input.imagePaths, confirmed: input.confirmed,
});
export const cancelMerchantNaverPreparation = (client: SupabaseClient, merchantId: string, requestId: string) => invoke<{ request: MerchantNaverRequest }>(client, { action: 'cancel', merchantId, requestId });
