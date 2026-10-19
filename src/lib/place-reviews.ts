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
export type PlaceRatingSummary = { cityId: string; placeId: string; average: number | null; count: number };
export type PlaceRatingState = PlaceRatingSummary & {
  scores: Record<string, number>;
  myReview: { id: string; score: number | null; body: string; status: 'published' | 'removed' } | null;
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const validScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  && value >= 1 && value <= 10 && Number.isInteger(value * 2);
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

export function placeReviewText(body: string): string {
  return postMapBody(body).body.replace(/^글링 평점: \d+(?:\.\d+)?\/10\r?\n\r?\n/, '')
    .replace(/\r?\n\r?\n장소 후기: https:\/\/www\.openstreetmap\.org\/(?:node|way|relation)\/[1-9]\d*$/, '').trim();
}

function ratingSummary(value: unknown, cityId: string, placeId: string): PlaceRatingSummary {
  const row = value as PlaceRatingSummary | null;
  if (!row || row.cityId !== cityId || row.placeId !== placeId || !Number.isSafeInteger(row.count) || row.count < 0
    || (row.count === 0 ? row.average !== null : typeof row.average !== 'number' || !Number.isFinite(row.average) || row.average < 1 || row.average > 10)) {
    throw new Error('INVALID_PLACE_RATINGS');
  }
  return { cityId, placeId, average: row.average, count: row.count };
}

export async function loadPlaceRatingSummaries(client: SupabaseClient, cityId: string, placeIds: string[]): Promise<Record<string, PlaceRatingSummary>> {
  const ids = [...new Set(placeIds)];
  if (ids.length > 25) throw new Error('INVALID_PLACE_RATINGS');
  ids.forEach(id => catalogPlace(cityId, id));
  if (!ids.length) return {};
  const { data, error } = await client.rpc('get_place_rating_summaries', { p_city_id: cityId, p_place_ids: ids });
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== ids.length) throw new Error('INVALID_PLACE_RATINGS');
  const result: Record<string, PlaceRatingSummary> = {};
  for (const row of data) {
    if (!ids.includes(row?.placeId) || result[row.placeId]) throw new Error('INVALID_PLACE_RATINGS');
    result[row.placeId] = ratingSummary(row, cityId, row.placeId);
  }
  return result;
}

export async function loadPlaceRatingState(client: SupabaseClient, scope: PlaceReviewScope, postIds: string[] = []): Promise<PlaceRatingState> {
  catalogPlace(scope.cityId, scope.placeId);
  const ids = [...new Set(postIds)];
  if (ids.length > 30 || ids.some(id => !uuid.test(id))) throw new Error('INVALID_PLACE_RATINGS');
  await requireReviewer(client, scope.userId);
  const { data, error } = await client.rpc('get_place_rating_state', { p_city_id: scope.cityId, p_place_id: scope.placeId, p_post_ids: ids });
  if (error) throw error;
  await requireReviewer(client, scope.userId);
  const summary = ratingSummary(data, scope.cityId, scope.placeId);
  if (!data.scores || typeof data.scores !== 'object' || Array.isArray(data.scores)
    || Object.entries(data.scores).some(([id, score]) => !ids.includes(id) || !validScore(score))) throw new Error('INVALID_PLACE_RATINGS');
  const mine = data.myReview;
  if (mine !== null && (!mine || !uuid.test(mine.id) || mine.score !== null && !validScore(mine.score)
    || typeof mine.body !== 'string' || mine.body.length > 4000 || !['published', 'removed'].includes(mine.status))) throw new Error('INVALID_PLACE_RATINGS');
  return { ...summary, scores: data.scores, myReview: mine };
}

export async function writeRatedPlaceReview(client: SupabaseClient, scope: PlaceReviewScope, text: string, score: number, isCurrent: () => boolean = () => true) {
  if (!validScore(score)) throw new Error('INVALID_PLACE_SCORE');
  const place = catalogPlace(scope.cityId, scope.placeId);
  const body = `글링 평점: ${score.toFixed(1)}/10\n\n${placeReviewBody(scope.cityId, scope.placeId, text)}`;
  await requireReviewer(client, scope.userId);
  if (!isCurrent()) throw new Error('ACCOUNT_CHANGED');
  const { data, error } = await client.rpc('write_place_rating', {
    p_city_id: scope.cityId, p_place_id: scope.placeId, p_score: score,
    p_title: [...place.name].slice(0, 60).join(''), p_body: body,
    p_tag_id: TAGS.find(tag => tag.slug === (place.category === 'places' ? 'life' : 'food'))!.id,
  });
  if (error) throw error;
  if (!data || typeof data.id !== 'string' || !uuid.test(data.id) || data.score !== score) throw new Error('PLACE_REVIEW_SAVE_UNCONFIRMED');
  return { id: data.id as string };
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
