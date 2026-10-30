import type { SupabaseClient } from '@supabase/supabase-js';

import type { CityPlace } from './city-places.ts';

// Meetup convenience features (owner 2026-10-29). The server decides tiers and rules; the app only shows them.
export const MEETUP_TITLE_MAX = 30;

export type MeetupRsvp = {
  available: boolean; startsAt: string | null; isHost: boolean; member: boolean; kind: 'once' | 'group';
  mine: 'going' | 'not_going' | null; canSeeCounts: boolean; counts: { going: number; notGoing: number; noAnswer: number } | null;
};
export type MeetupAutomation = {
  rank: number; canAutoApprove: boolean; canPromote: boolean; canNoShowRule: boolean; ageRange: boolean;
  approve: { sameCity: boolean; newcomer: boolean; age: boolean }; promote: boolean; offerHours: number; noShowThreshold: number | null;
};

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export const loadMeetupRsvp = (client: SupabaseClient, postId: string) => rpc<MeetupRsvp>(client, 'get_meetup_rsvp', { p_post_id: postId });
/** release = also give the seat back (one-time meetups only, the usual leave rules apply). */
export const setMeetupRsvp = (client: SupabaseClient, postId: string, going: boolean, release = false) =>
  rpc<MeetupRsvp>(client, 'set_meetup_rsvp', { p_post_id: postId, p_going: going, p_release: release });

export const loadMeetupAutomation = (client: SupabaseClient, postId: string) => rpc<MeetupAutomation>(client, 'get_meetup_automation', { p_post_id: postId });
export const setMeetupAutoApproval = (client: SupabaseClient, postId: string, rules: MeetupAutomation['approve']) =>
  rpc<null>(client, 'set_meetup_auto_approval', { p_post_id: postId, p_same_city: rules.sameCity, p_newcomer: rules.newcomer, p_age: rules.age });
export const setMeetupWaitlistPromotion = (client: SupabaseClient, postId: string, on: boolean, hours: number) =>
  rpc<null>(client, 'set_meetup_waitlist_promotion', { p_post_id: postId, p_on: on, p_hours: hours });
export const setMeetupNoShowRule = (client: SupabaseClient, threshold: number | null) => rpc<null>(client, 'set_meetup_no_show_rule', { p_threshold: threshold });

const PLACE_CATEGORY: Record<string, CityPlace['category']> = { casual: 'cafe', party: 'food', festival: 'places', sports: 'places', hobby: 'cafe', travel: 'places' };

/** Three map places for a meetup: same city, matching category and words in the title/topic first, then operator picks. */
export function pickMeetupPlaces(places: CityPlace[], meetupCategory: string, text: string, limit = 3): CityPlace[] {
  const wanted = PLACE_CATEGORY[meetupCategory] ?? 'cafe';
  const words = text.toLowerCase().split(/[\s,.!?·]+/).filter(word => word.length >= 2);
  const score = (place: CityPlace) => {
    const haystack = `${place.name} ${place.recommendation?.reason ?? ''} ${place.recommendation?.reasonEn ?? ''}`.toLowerCase();
    return (words.some(word => haystack.includes(word)) ? 4 : 0) + (place.category === wanted ? 2 : 0) + (place.recommendation ? 1 : 0) + (place.photo ? 0.5 : 0);
  };
  const seen = new Set<string>();
  return places.filter(place => !seen.has(place.id) && seen.add(place.id))
    .map((place, index) => ({ place, index, score: score(place) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit).map(row => row.place);
}

/** Read the edge function's error code from a functions.invoke failure. */
export async function functionErrorCode(cause: unknown): Promise<string | null> {
  const context = (cause as { context?: Response } | null)?.context;
  if (!context || typeof context.json !== 'function') return null;
  try { return ((await context.json()) as { error?: { code?: string } })?.error?.code ?? null; } catch { return null; }
}

export function newDraftKey() {
  return globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
