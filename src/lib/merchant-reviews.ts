import type { SupabaseClient } from '@supabase/supabase-js';
import { estimatedBase64Bytes, MAX_IMAGE_BYTES } from './image-upload.ts';
import { merchantEventId } from './merchant-source.ts';

export type MerchantReviewKind = 'usage' | 'employment';

export type MerchantReview = {
  id: string;
  author_id: string;
  nickname: string;
  score: number;
  body: string | null;
  created_at: string;
  updated_at: string;
  receipt_status: 'none' | 'pending' | 'verified' | 'rejected';
  review_kind?: MerchantReviewKind;
};

export type MerchantReviewPage = {
  merchant_id: string;
  merchant_name: string;
  rating_average: number | null;
  review_count: number;
  my_review: (MerchantReview & { status: 'published' | 'removed'; receipt_path: string | null }) | null;
  can_review: boolean;
  reviews: MerchantReview[];
  has_more: boolean;
  review_kind?: MerchantReviewKind;
};

export async function loadMerchantReviews(client: SupabaseClient, postId: string, offset = 0, reviewKind: MerchantReviewKind = 'usage'): Promise<MerchantReviewPage | null> {
  if (reviewKind !== 'usage' && reviewKind !== 'employment') throw new Error('INVALID_REVIEW_KIND');
  const result = await client.rpc('get_merchant_reviews', { p_post_id: postId, p_offset: offset,
    ...(reviewKind === 'employment' ? { p_review_kind: reviewKind } : {}) });
  if (result.error) throw new Error(result.error.message);
  if (result.data && (result.data.review_kind ?? 'usage') !== reviewKind) throw new Error('MERCHANT_REVIEW_KIND_MISMATCH');
  return result.data as MerchantReviewPage | null;
}

export async function loadMyMerchantReviews(client: SupabaseClient, merchantId: string, offset = 0): Promise<{ reviews: MerchantReview[]; has_more: boolean }> {
  const result = await client.rpc('get_my_merchant_reviews', { p_merchant_id: merchantId, p_offset: offset });
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('MERCHANT_REVIEWS_MISSING');
  return result.data;
}

export async function uploadMerchantReviewReceipt(client: SupabaseClient, userId: string, image: { base64: string; mimeType: string }): Promise<string> {
  if (image.mimeType !== 'image/webp') throw new Error('IMAGE_UNSUPPORTED');
  if (estimatedBase64Bytes(image.base64) > MAX_IMAGE_BYTES + 2) throw new Error('IMAGE_TOO_LARGE');
  const bytes = Uint8Array.from(atob(image.base64), (character) => character.charCodeAt(0)).buffer;
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  const path = `${userId}/${merchantEventId()}.webp`;
  const result = await client.storage.from('merchant-review-receipts').upload(path, bytes, { contentType: 'image/webp', upsert: false });
  if (result.error) throw new Error(result.error.message);
  return path;
}

export async function writeMerchantReview(client: SupabaseClient, postId: string, score: number, body = '', receiptPath?: string | null, reviewKind: MerchantReviewKind = 'usage'): Promise<string> {
  if (reviewKind !== 'usage' && reviewKind !== 'employment') throw new Error('INVALID_REVIEW_KIND');
  if (!Number.isFinite(score) || score < 1 || score > 10 || !Number.isInteger(score * 2)) throw new Error('INVALID_MERCHANT_SCORE');
  const text = body.trim();
  if (text.length > 300) throw new Error('MERCHANT_REVIEW_TOO_LONG');
  const result = await client.rpc('write_merchant_review', { p_post_id: postId, p_score: score, p_body: text || null,
    ...(reviewKind === 'employment' ? { p_receipt_path: receiptPath ?? null, p_review_kind: reviewKind }
      : receiptPath === undefined ? {} : { p_receipt_path: receiptPath }) });
  if (result.error) throw new Error(result.error.message);
  if (typeof result.data !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result.data)) throw new Error('MERCHANT_REVIEW_SAVE_NOT_VERIFIED');
  return result.data;
}
