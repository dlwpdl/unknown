import type { SupabaseClient } from '@supabase/supabase-js';
import { hydratePublicPosts, mapPublicFeed, type FeedCursor, type PublicFeedRow } from './feed-data.ts';
import type { Post, PostKind } from './types.ts';

export type MannerPart = { participants: number; score: number | null; rating?: { participants: number; score: number | null } };
export type MannerSummary = { meeting: MannerPart; chat: MannerPart };
export type PublicUserProfile = { id: string; nickname: string; neighborhood: string | null; cityId: string;
  memberSince: string; verificationLevel: number; storyCount: number; listingCount: number; completedCount: number; manner: MannerSummary };

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
export function mannerLabel(part: MannerPart) {
  const { participants, score } = part.rating ?? { participants: 0, score: null };
  return participants < 5 || score == null ? `리뷰가 쌓이는 중 · ${participants}명` : `${score.toFixed(1)} / 10 · ${participants}명`;
}
export const loadMannerSummary = (client: SupabaseClient, userId: string) => rpc<MannerSummary>(client, 'get_manner_summary', { p_user_id: userId });
export const loadPublicUserProfile = (client: SupabaseClient, userId: string) => rpc<PublicUserProfile | null>(client, 'get_public_user_profile', { p_user_id: userId });
export async function loadPublicUserActivity(client: SupabaseClient, userId: string, kind: PostKind, cursor: FeedCursor | null, viewerScope: string): Promise<Post[]> {
  if (kind !== 'story' && kind !== 'listing') throw new Error('INVALID_POST_KIND');
  const rows = await rpc<PublicFeedRow[]>(client, 'get_public_user_activity', { p_user_id: userId, p_kind: kind, p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null });
  return hydratePublicPosts(client, mapPublicFeed(rows ?? [], []), viewerScope);
}
