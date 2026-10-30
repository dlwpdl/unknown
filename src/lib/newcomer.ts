import type { SupabaseClient } from '@supabase/supabase-js';

import { mapPublicFeed, type PublicFeedRow } from './feed-data.ts';
import type { Post, RoomPreview } from './types.ts';

// Newcomer welcome (owner 2026-10-29). The period length is the server's private.newcomer_config.
export const NEW_MEETUP_MS = 48 * 3600000;

export type MeetupLabel = 'new' | 'welcome' | 'newcomersOnly';
export const MEETUP_LABEL_TEXT: Record<MeetupLabel, string> = { new: '새 모임', welcome: '처음 와도 돼요', newcomersOnly: '새 멤버만' };

/** "새 모임" is automatic for 48 hours; a newcomer-only meetup shows "새 멤버만" instead of "처음 와도 돼요". */
export function meetupLabels(post: Pick<Post, 'createdAt' | 'room'>, now = Date.now()): MeetupLabel[] {
  if (!post.room) return [];
  const created = Date.parse(post.createdAt ?? '');
  const labels: MeetupLabel[] = Number.isFinite(created) && now - created >= 0 && now - created < NEW_MEETUP_MS ? ['new'] : [];
  if (post.room.newcomerOnly) labels.push('newcomersOnly');
  else if (post.room.newcomerWelcome) labels.push('welcome');
  return labels;
}

export type NewcomerStatus = { newcomer: boolean; periodDays: number; endsAt: string | null; requested: boolean; attended: boolean };

/** Whole days left, counting today; 0 once the period is over. */
export function newcomerDaysLeft(status: Pick<NewcomerStatus, 'newcomer' | 'endsAt'>, now = Date.now()) {
  const ends = Date.parse(status.endsAt ?? '');
  return status.newcomer && Number.isFinite(ends) ? Math.max(0, Math.ceil((ends - now) / 86400000)) : 0;
}

/** The server enforces this too (MEETUP_NEWCOMERS_ONLY); the app only swaps the button for a note. */
export function newcomerLocked(room: Pick<RoomPreview, 'newcomerOnly'> | undefined, status: Pick<NewcomerStatus, 'newcomer'> | null) {
  return room?.newcomerOnly === true && status?.newcomer !== true;
}

let statusRequest: { userId: string; promise: Promise<NewcomerStatus> } | null = null;
export function loadNewcomerStatus(client: SupabaseClient, userId: string, refresh = false): Promise<NewcomerStatus> {
  if (!refresh && statusRequest?.userId === userId) return statusRequest.promise;
  const promise = Promise.resolve(client.rpc('get_my_newcomer_status')).then(({ data, error }) => {
    if (error) throw error;
    const value = (data ?? {}) as Partial<NewcomerStatus>;
    return { newcomer: value.newcomer === true, periodDays: Number(value.periodDays) || 60, endsAt: typeof value.endsAt === 'string' ? value.endsAt : null,
      requested: value.requested === true, attended: value.attended === true };
  });
  statusRequest = { userId, promise };
  promise.catch(() => { if (statusRequest?.promise === promise) statusRequest = null; });
  return promise;
}

export type WelcomeMeetups = { mode: 'welcome' | 'fresh' | 'none'; posts: Post[] };
export async function loadWelcomeMeetups(client: SupabaseClient): Promise<WelcomeMeetups> {
  const { data, error } = await client.rpc('get_newcomer_welcome_meetups');
  if (error) throw error;
  const value = (data ?? {}) as { mode?: string; ids?: unknown };
  const ids = Array.isArray(value.ids) ? value.ids.filter((id): id is string => typeof id === 'string').slice(0, 3) : [];
  const rows = (await Promise.all(ids.map(async id => {
    const result = await client.rpc('get_public_post', { p_post_id: id });
    return result.error ? [] : (result.data ?? []) as PublicFeedRow[];
  }))).flat();
  const posts = mapPublicFeed(rows, []).filter(post => post.room);
  const mode = value.mode === 'welcome' || value.mode === 'fresh' ? value.mode : 'none';
  return { mode: posts.length ? mode : 'none', posts };
}

export async function setMeetupNewcomer(client: SupabaseClient, postId: string, welcome: boolean, only: boolean) {
  const result = await client.rpc('set_meetup_newcomer', { p_post_id: postId, p_welcome: welcome, p_only: welcome && only });
  if (result.error) throw result.error;
}
