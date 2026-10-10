import type { SupabaseClient } from '@supabase/supabase-js';
import { attachMerchantProfileImages, mapMerchantProfile, type MerchantProfile } from './merchant-profile.ts';
import type { MyMerchantProfile } from './merchant-profile-editor.ts';
import { merchantPhoneUrl } from './merchant-source.ts';
export { merchantMapsUrl, merchantPhoneUrl } from './merchant-source.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function startMerchantConversation(client: SupabaseClient, merchantId: string): Promise<string> {
  if (!UUID.test(merchantId)) throw new Error('INVALID_MERCHANT');
  const result = await client.rpc('start_merchant_conversation', { p_merchant_id: merchantId });
  if (result.error) throw new Error(result.error.message);
  if (typeof result.data !== 'string' || !UUID.test(result.data)) throw new Error('MERCHANT_CONVERSATION_READ_FAILED');
  return result.data;
}

export async function setSavedMerchant(client: SupabaseClient, merchantId: string, saved: boolean): Promise<boolean> {
  if (!UUID.test(merchantId) || typeof saved !== 'boolean') throw new Error('INVALID_MERCHANT_SAVE');
  const result = await client.rpc('set_saved_merchant', { p_merchant_id: merchantId, p_saved: saved });
  if (result.error) throw new Error(result.error.message);
  if (result.data !== saved) throw new Error('MERCHANT_SAVE_NOT_VERIFIED');
  return result.data;
}

export async function setSavedMerchantNotifications(client: SupabaseClient, merchantId: string, enabled: boolean): Promise<boolean> {
  if (!UUID.test(merchantId) || typeof enabled !== 'boolean') throw new Error('INVALID_MERCHANT_NOTIFICATIONS');
  const result = await client.rpc('set_saved_merchant_notifications', { p_merchant_id: merchantId, p_enabled: enabled });
  if (result.error) throw new Error(result.error.message);
  if (result.data !== enabled) throw new Error('MERCHANT_NOTIFICATIONS_NOT_VERIFIED');
  return result.data;
}

export type SavedMerchantPage = { merchants: MerchantProfile[]; has_more: boolean; nextOffset: number };
export async function loadSavedMerchants(client: SupabaseClient, offset = 0): Promise<SavedMerchantPage> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('INVALID_MERCHANT_PAGE');
  const result = await client.rpc('get_saved_merchants', { p_offset: offset });
  if (result.error) throw new Error(result.error.message);
  if (!result.data || !Array.isArray(result.data.merchants) || result.data.merchants.length > 20 || typeof result.data.has_more !== 'boolean') throw new Error('MERCHANT_SAVED_READ_FAILED');
  let profiles;
  try { profiles = result.data.merchants.map(mapMerchantProfile); }
  catch { throw new Error('MERCHANT_SAVED_READ_FAILED'); }
  const merchants = await Promise.all(profiles.map((profile: ReturnType<typeof mapMerchantProfile>) => attachMerchantProfileImages(client, profile)));
  return { merchants, has_more: result.data.has_more && merchants.length > 0, nextOffset: offset + profiles.length };
}

export async function saveMerchantContact(client: SupabaseClient, merchantId: string, publicPhone: string, businessHours: string, expectedUpdatedAt: string): Promise<MyMerchantProfile> {
  if (!UUID.test(merchantId) || typeof publicPhone !== 'string' || typeof businessHours !== 'string' || (publicPhone.trim() && !merchantPhoneUrl(publicPhone))
    || /[\x00-\x1f\x7f]/.test(publicPhone) || publicPhone.trim().length > 40 || [...businessHours.trim()].length > 500 || typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error('INVALID_MERCHANT_CONTACT');
  const phone = publicPhone.trim(), hours = businessHours.trim();
  const result = await client.rpc('save_merchant_contact', { p_merchant_id: merchantId, p_public_phone: phone, p_business_hours: hours, p_expected_updated_at: expectedUpdatedAt });
  if (result.error) throw new Error(result.error.message);
  const row = result.data;
  if (row?.id !== merchantId || row.public_phone !== phone || row.business_hours !== hours || typeof row.can_edit !== 'boolean'
    || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('MERCHANT_CONTACT_SAVE_NOT_VERIFIED');
  let profile;
  try { profile = mapMerchantProfile(row); }
  catch { throw new Error('MERCHANT_CONTACT_SAVE_NOT_VERIFIED'); }
  return attachMerchantProfileImages(client, { ...profile, updated_at: row.updated_at, can_edit: row.can_edit });
}
