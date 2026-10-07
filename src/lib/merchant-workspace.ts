import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantMetrics, MerchantPost, MerchantReport } from './admin-merchants.ts';

export type MerchantChannel = 'gling' | 'casmo' | 'hellovancouver';
export type BusinessMerchant = {
  id: string; name: string; city_id: string; city_name: string; contact: string;
  status: 'lead' | 'trial' | 'paid' | 'paused'; owner_id: string | null;
  owner_verified_at: string | null; trial_ends_at: string | null;
  workspace_until: string | null; today: string; plan: 'basic' | 'trial' | 'pro';
};
export type MerchantItem = {
  id: string; name: string; unit: string; unit_cost: number; quantity: number; low_stock: number; updated_at: string;
};
export type MerchantDraft = {
  id: string; channel: MerchantChannel; title: string; body: string; original_url: string | null;
  tag_slug: string; kind: 'story' | 'listing'; approved_at: string | null;
  post_id: string | null; published_at: string | null; external_url: string | null; archived_at: string | null; updated_at: string;
};
export type MerchantWorkspace = {
  merchant: BusinessMerchant; items: MerchantItem[]; drafts: MerchantDraft[];
  movements: { id: string; item_id: string; item_name: string; delta: number; note: string; created_at: string }[];
  metrics: MerchantMetrics; posts: MerchantPost[]; reports: MerchantReport[];
};
export const MERCHANT_CHANNELS = { gling: '글링', casmo: '캐스모', hellovancouver: '헬로밴쿠버' } as const;

export function calculateMerchantCost(input: { batchCost: number; yield: number; packaging: number; other: number; price: number; feePercent: number }) {
  if (Object.values(input).some((n) => !Number.isFinite(n) || n < 0 || n > 99999999) || input.yield <= 0 || input.feePercent >= 100) throw new Error('INVALID_COST_INPUT');
  const unitCost = Math.round((input.batchCost / input.yield + input.packaging + input.other + input.price * input.feePercent / 100) * 100) / 100;
  const contribution = Math.round((input.price - unitCost) * 100) / 100;
  const result = { unitCost, contribution, costPercent: input.price ? unitCost / input.price * 100 : null, marginPercent: input.price ? contribution / input.price * 100 : null };
  if (Object.values(result).some((value) => value !== null && !Number.isFinite(value))) throw new Error('INVALID_COST_INPUT');
  return result;
}
export function merchantPlan(value: Pick<BusinessMerchant, 'status' | 'trial_ends_at'> & { workspace_until?: string | null }, today: string): BusinessMerchant['plan'] {
  if (value.status === 'paid' && value.workspace_until && value.workspace_until >= today) return 'pro';
  return value.status === 'trial' && value.trial_ends_at && value.trial_ends_at >= today ? 'trial' : 'basic';
}
export const merchantDraftCopy = (draft: Pick<MerchantDraft, 'title' | 'body' | 'original_url'>) => `${draft.title}\n\n${draft.body}${draft.original_url ? `\n\n${draft.original_url}` : ''}`;

async function call<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error || data == null) throw new Error(error?.message ?? 'MERCHANT_DATA_MISSING');
  return data as T;
}
export const loadMyMerchants = (client: SupabaseClient) => call<BusinessMerchant[]>(client, 'get_my_merchants');
export const loadMerchantWorkspace = (client: SupabaseClient, id: string) => call<MerchantWorkspace>(client, 'get_merchant_workspace', { p_merchant_id: id });
export const registerMyMerchant = (client: SupabaseClient, value: { id: string; name: string; city_id: string; contact: string }) => call<string>(client, 'register_my_merchant', Object.fromEntries(Object.entries(value).map(([k, v]) => [`p_${k}`, v])));
export const saveMerchantItem = (client: SupabaseClient, id: string, item: Pick<MerchantItem, 'id' | 'name' | 'unit' | 'unit_cost' | 'low_stock'>) => call<string>(client, 'save_merchant_workspace_item', { p_merchant_id: id, p_id: item.id, p_name: item.name, p_unit: item.unit, p_unit_cost: item.unit_cost, p_low_stock: item.low_stock });
export const adjustMerchantInventory = (client: SupabaseClient, id: string, requestId: string, changes: { item_id: string; delta: number; note: string }[]) => call<{ applied: number }>(client, 'adjust_merchant_inventory', { p_merchant_id: id, p_request_id: requestId, p_changes: changes });
export const saveMerchantDraft = (client: SupabaseClient, id: string, draft: Pick<MerchantDraft, 'id' | 'channel' | 'title' | 'body' | 'original_url' | 'tag_slug' | 'kind'>) => call<string>(client, 'save_merchant_workspace_draft', { p_merchant_id: id, p_id: draft.id, p_channel: draft.channel, p_title: draft.title, p_body: draft.body, p_original_url: draft.original_url, p_tag_slug: draft.tag_slug, p_kind: draft.kind });
export const approveMerchantDrafts = (client: SupabaseClient, id: string, draftIds: string[], approve: boolean, expectedUpdatedAt: Record<string, string>) => call<{ approved: number }>(client, 'approve_merchant_workspace_drafts', { p_merchant_id: id, p_ids: draftIds, p_approve: approve, p_expected_updated_at: expectedUpdatedAt });
export const publishMerchantDraft = (client: SupabaseClient, id: string, draftId: string, expectedUpdatedAt: string) => call<string>(client, 'publish_merchant_workspace_draft', { p_merchant_id: id, p_draft_id: draftId, p_expected_updated_at: expectedUpdatedAt });
export const recordMerchantExternalPost = (client: SupabaseClient, id: string, draftId: string, url: string, expectedUpdatedAt: string) => call<string>(client, 'record_merchant_external_post', { p_merchant_id: id, p_draft_id: draftId, p_url: url, p_expected_updated_at: expectedUpdatedAt });
export const archiveMerchantDrafts = (client: SupabaseClient, id: string, draftIds: string[], archive: boolean) => call<{ archived: number }>(client, 'archive_merchant_workspace_drafts', { p_merchant_id: id, p_ids: draftIds, p_archive: archive });
export const setAdminMerchantOwner = (client: SupabaseClient, id: string, ownerId: string, verified: boolean, until: string | null) => call<string>(client, 'set_admin_merchant_workspace_owner', { p_merchant_id: id, p_owner_id: ownerId, p_verified: verified, p_workspace_until: until });
