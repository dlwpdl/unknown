import type { SupabaseClient } from '@supabase/supabase-js';
import { estimatedBase64Bytes, MAX_IMAGE_BYTES } from './image-upload.ts';
import { attachMerchantProfileImages, type MerchantProfile } from './merchant-profile.ts';
import { merchantEventId } from './merchant-source.ts';

export type MyMerchantProfile = MerchantProfile & { updated_at: string; can_edit: boolean };

export async function loadMyMerchantProfile(client: SupabaseClient, merchantId: string): Promise<MyMerchantProfile> {
  const result = await client.rpc('get_my_merchant_profile', { p_merchant_id: merchantId });
  if (result.error) throw new Error(result.error.message);
  if (result.data?.id !== merchantId || typeof result.data.can_edit !== 'boolean' || !result.data.updated_at) throw new Error('MERCHANT_PROFILE_READ_FAILED');
  return attachMerchantProfileImages(client, result.data as MyMerchantProfile);
}

export async function uploadMerchantProfileImage(client: SupabaseClient, userId: string, merchantId: string, image: { base64: string; mimeType: string }): Promise<string> {
  if (image.mimeType !== 'image/webp') throw new Error('IMAGE_UNSUPPORTED');
  if (estimatedBase64Bytes(image.base64) > MAX_IMAGE_BYTES + 2) throw new Error('IMAGE_TOO_LARGE');
  const bytes = Uint8Array.from(atob(image.base64), (character) => character.charCodeAt(0)).buffer;
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  const path = `${userId}/${merchantId}_${merchantEventId()}.webp`;
  const result = await client.storage.from('merchant-profile-images').upload(path, bytes, { contentType: 'image/webp', upsert: false });
  if (result.error) throw new Error(result.error.message);
  return path;
}

export async function saveMyMerchantProfile(client: SupabaseClient, merchantId: string, patch: { avatarPath: string | null; bannerPath: string | null; updatedAt: string }): Promise<MyMerchantProfile> {
  const result = await client.rpc('save_my_merchant_profile', { p_merchant_id: merchantId, p_avatar_path: patch.avatarPath, p_banner_path: patch.bannerPath, p_expected_updated_at: patch.updatedAt });
  if (result.error) throw new Error(result.error.message);
  if (result.data?.id !== merchantId || result.data.avatar_path !== patch.avatarPath || result.data.banner_path !== patch.bannerPath
    || typeof result.data.can_edit !== 'boolean' || !result.data.updated_at) throw new Error('MERCHANT_PROFILE_SAVE_NOT_VERIFIED');
  return attachMerchantProfileImages(client, result.data as MyMerchantProfile);
}
