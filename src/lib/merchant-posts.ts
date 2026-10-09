import type { SupabaseClient } from '@supabase/supabase-js';
import { editPost, removePostImages, uploadPostImages, type PostDraftImage } from './community-data.ts';
import { MAX_POST_IMAGES } from './image-upload.ts';
import { saveMerchantDraft, type MerchantDraft } from './merchant-workspace.ts';

export const editMerchantPost = (client: SupabaseClient, merchantId: string, postId: string, patch: { title: string; body: string }, replacement?: Parameters<typeof editPost>[3]) => editPost(client, postId, patch, replacement, merchantId);
export async function removeMerchantPost(client: SupabaseClient, merchantId: string, postId: string) {
  const { data, error } = await client.rpc('remove_merchant_post', { p_merchant_id: merchantId, p_post_id: postId });
  if (error) throw error;
  if (data !== postId) throw new Error('POST_DELETE_NOT_VERIFIED');
}

export async function saveMerchantDraftImages(client: SupabaseClient, merchantId: string, userId: string,
  draft: Pick<MerchantDraft, 'id' | 'channel' | 'title' | 'body' | 'original_url' | 'tag_slug' | 'kind' | 'image_paths'>, images: (PostDraftImage | { path: string })[]) {
  if (images.length > MAX_POST_IMAGES) throw new Error('TOO_MANY_IMAGES');
  if (images.some(image => 'path' in image && ((!image.path.startsWith(`${userId}/`) && !draft.image_paths?.includes(image.path)) || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(webp|jpe?g|png)$/.test(image.path)))) throw new Error('INVALID_IMAGE_PATH');
  const media = await uploadPostImages(client, userId, images.filter(image => !('path' in image)) as PostDraftImage[]);
  let added = 0;
  const paths = images.map(image => 'path' in image ? image.path : media[added++].path);
  try {
    if (await saveMerchantDraft(client, merchantId, { ...draft, image_paths: paths }) !== draft.id) throw new Error('MERCHANT_DRAFT_SAVE_NOT_VERIFIED');
    return paths;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (media.length && code && !code.startsWith('PGRST')) await removePostImages(client, media.map(image => image.path));
    throw error;
  }
}
