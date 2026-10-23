import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChillingSchedule } from './chilling.ts';

export type SharedLinkPreview = {
  id: string; title: string; teaser?: string | null; kind: 'post' | 'festival' | 'meetup'; city: string; label: string;
  schedule: ChillingSchedule | null; imagePath: string | null; imageUrl?: string; closed: boolean;
};
export async function loadSharedLinkPreview(client: SupabaseClient, postId: string): Promise<SharedLinkPreview | null> {
  const { data, error } = await client.rpc('get_shared_link_preview', { p_post_id: postId });
  if (error) throw error;
  if (!data) return null;
  const preview = data as SharedLinkPreview;
  if (preview.imagePath) {
    const result = await client.storage.from('post-images').createSignedUrl(preview.imagePath, 3600).catch(() => null);
    if (result?.data?.signedUrl) preview.imageUrl = result.data.signedUrl;
  }
  return preview;
}
