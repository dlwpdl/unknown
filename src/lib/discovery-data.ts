import type { SupabaseClient } from '@supabase/supabase-js';
import { attachSignedPostImages, loadPublicFeed, mapPublicFeed, type FeedCursor, type PublicFeedRow } from './feed-data';
import { discoveryPost, type DiscoveryFilter } from './discovery';

export async function loadDiscoveryPosts(client: SupabaseClient, cityId: string, filter: DiscoveryFilter, query: string,
  cursor: FeedCursor | null, viewerScope: string, signal: AbortSignal) {
  const request = client.rpc('get_discovery_posts', {
    p_city_id: cityId, p_tag_id: filter === 'housing' ? 14 : filter === 'used' ? 19 : null,
    p_query: query.trim() || null, p_before_sort: cursor?.sortAt ?? null, p_before_id: cursor?.id ?? null, p_limit: 50,
  }).abortSignal(signal);
  const { data, error } = await request;
  // The approved map remains usable while the new read RPC is awaiting deployment.
  if (error?.code === 'PGRST202') {
    const posts = await loadPublicFeed(client, cityId, filter === 'housing' ? 14 : filter === 'used' ? 19 : null,
      query.trim() || null, cursor, { viewerScope, signal });
    const last = posts.at(-1);
    return { items: posts.map(post => discoveryPost(post)).filter(item => item !== null), hasMore: posts.length === 30 && !!last?.createdAt,
      cursor: last?.createdAt ? { createdAt: last.createdAt, sortAt: last.sortAt ?? last.createdAt, id: last.id } : null };
  }
  if (error) throw error;
  const rows = (data ?? []) as PublicFeedRow[];
  const posts = await attachSignedPostImages(client, mapPublicFeed(rows, []), viewerScope);
  const last = rows.at(-1);
  return { items: posts.map(post => discoveryPost(post)).filter(item => item !== null), hasMore: rows.length === 50,
    cursor: last ? { createdAt: last.created_at, sortAt: last.sort_at ?? last.created_at, id: last.id } : null };
}
