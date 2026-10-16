import type { SupabaseClient } from '@supabase/supabase-js';

import { getCityPlaces } from './city-places.ts';
import { createCommunityPost } from './community-data.ts';
import { loadPublicFeed, type FeedCursor } from './feed-data.ts';
import { TAGS } from './mock.ts';
import { googlePinUrl, postMapBody, withPostMap } from './post-maps.ts';
import type { Post } from './types.ts';

export const PLACE_REVIEW_MAX_LENGTH = 1000;
export type PlaceReviewScope = { cityId: string; placeId: string; userId: string };
export type PlaceReviewPage = { posts: Post[]; cursor: FeedCursor | null; hasMore: boolean };
const referenceLine = /^장소 후기: (https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/([1-9]\d*))$/;

function catalogPlace(cityId: string, placeId: string) {
  const identity = /^osm:(node|way|relation):([1-9]\d*)$/.exec(placeId);
  if (!identity) throw new Error('PLACE_NOT_FOUND');
  let place;
  try { place = getCityPlaces(cityId).find(item => item.id === placeId && item.cityId === cityId); }
  catch { throw new Error('PLACE_NOT_FOUND'); }
  if (!place || place.sourceUrl !== `https://www.openstreetmap.org/${identity[1]}/${identity[2]}`) throw new Error('PLACE_NOT_FOUND');
  return place;
}

export function placeReviewReference(body: string): string | null {
  const lines = postMapBody(body).body.trim().split(/\r?\n/);
  const references = lines.filter(line => referenceLine.test(line));
  return references.length === 1 && references[0] === lines.at(-1) ? referenceLine.exec(references[0])![1] : null;
}

export function placeReviewBody(cityId: string, placeId: string, input: string): string {
  const place = catalogPlace(cityId, placeId);
  if (typeof input !== 'string' || !input.trim() || [...input.trim()].length > PLACE_REVIEW_MAX_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|장소\s*후기\s*:/.test(input)) throw new Error('INVALID_PLACE_REVIEW');
  return withPostMap(`${input.trim()}\n\n장소 후기: ${place.sourceUrl}`, googlePinUrl(place), [...place.name].slice(0, 100).join(''));
}

export function isPlaceReview(post: Post, cityId: string, placeId: string): boolean {
  return post.cityId === cityId && post.kind === 'story' && !post.room
    && placeReviewReference(post.body) === catalogPlace(cityId, placeId).sourceUrl;
}

async function requireReviewer(client: SupabaseClient, userId: string) {
  if (!userId) throw new Error('ACCOUNT_CHANGED');
  const { data, error } = await client.auth.getSession();
  if (error || data.session?.user.id !== userId) throw new Error('ACCOUNT_CHANGED');
}

export async function loadPlaceReviews(client: SupabaseClient, scope: PlaceReviewScope, cursor: FeedCursor | null = null): Promise<PlaceReviewPage> {
  const place = catalogPlace(scope.cityId, scope.placeId);
  await requireReviewer(client, scope.userId);
  const rows = await loadPublicFeed(client, scope.cityId, null, place.sourceUrl, cursor, { viewerScope: scope.userId });
  await requireReviewer(client, scope.userId);
  const last = rows.at(-1);
  if (last && (!last.createdAt || last.id === cursor?.id)) throw new Error('PLACE_REVIEWS_PAGE_STALLED');
  return {
    posts: rows.filter(post => isPlaceReview(post, scope.cityId, scope.placeId)),
    // Search can match unrelated URLs; only the unfiltered page defines the next cursor.
    cursor: last ? { id: last.id, createdAt: last.createdAt!, sortAt: last.sortAt } : null,
    hasMore: rows.length === 30,
  };
}

export async function writePlaceReview(client: SupabaseClient, scope: PlaceReviewScope, text: string, isCurrent: () => boolean = () => true) {
  const place = catalogPlace(scope.cityId, scope.placeId);
  const body = placeReviewBody(scope.cityId, scope.placeId, text);
  await requireReviewer(client, scope.userId);
  if (!isCurrent()) throw new Error('ACCOUNT_CHANGED');
  const result = await createCommunityPost(client, {
    userId: scope.userId, cityId: scope.cityId,
    tag: TAGS.find(tag => tag.slug === (place.category === 'places' ? 'life' : 'food'))!,
    title: [...place.name].slice(0, 60).join(''), body, hashtags: [], kind: 'story',
  });
  if (typeof result.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.id)) throw new Error('PLACE_REVIEW_SAVE_UNCONFIRMED');
  return result;
}
