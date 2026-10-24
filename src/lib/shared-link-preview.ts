import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChillingSchedule } from './chilling.ts';
import { mapPublicFeed, type PublicFeedRow } from './feed-data.ts';
import { PUBLIC_SOURCE } from './public-seo.ts';
import type { Post } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sharedPostId(value: string) {
  if (!UUID.test(value)) throw new Error('INVALID_SHARED_POST');
  return value.toLowerCase();
}
function previewImage(id: string) {
  return `${PUBLIC_SOURCE}?${new URLSearchParams({ format: 'preview-image', id })}`;
}

export type SharedLinkPreview = {
  id: string; title: string; teaser?: string | null; kind: 'post' | 'festival' | 'meetup'; city: string; label: string;
  schedule: ChillingSchedule | null; imagePath: string | null; imageUrl?: string; closed: boolean;
};
export async function loadSharedLinkPreview(client: SupabaseClient, postId: string): Promise<SharedLinkPreview | null> {
  const id = sharedPostId(postId);
  const { data, error } = await client.rpc('get_shared_link_preview', { p_post_id: id });
  if (error) throw error;
  if (!data) return null;
  const preview = data as SharedLinkPreview;
  if (preview.id?.toLowerCase() !== id) throw new Error('INVALID_SHARED_POST_PREVIEW');
  return { ...preview, imageUrl: preview.imagePath ? previewImage(id) : undefined };
}

export async function loadSharedLinkPost(client: SupabaseClient, postId: string): Promise<Post | null> {
  const id = sharedPostId(postId);
  const { data, error } = await client.rpc('get_public_post', { p_post_id: id });
  if (error) throw error;
  if (data == null) return null;
  if (!Array.isArray(data)) throw new Error('INVALID_SHARED_POST');
  if (data.length === 0) return null;
  if (data.length !== 1 || data[0]?.id?.toLowerCase() !== id) throw new Error('INVALID_SHARED_POST');
  const row = data[0] as PublicFeedRow;
  const room = row.room_preview;
  const [post] = mapPublicFeed([{ ...row, image_paths: row.image_paths?.slice(0, 1) ?? [],
    // Meetup destinations, contacts and application details stay in the app.
    ...(room ? { body: '', room_preview: {
      id: room.id, title: room.title, memberCount: room.memberCount, verifiedOnly: room.verifiedOnly,
      capacity: room.capacity, closed: room.closed, eventKind: room.eventKind,
      startsAt: room.startsAt, endsAt: room.endsAt, timezone: room.timezone, cadence: room.cadence,
    } } : {}),
  }], []);
  const images = post.imagePaths?.[0] ? [previewImage(id)] : [];
  return { ...post, imageUris: images, imageThumbs: images, commentList: [] };
}
