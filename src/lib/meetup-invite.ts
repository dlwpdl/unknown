import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeInviteCode } from './invites.ts';

// The meetup web invitation and the shop QR landing (20261113120000). Both read narrow, link-only server cards: never
// the exact place, the rest of the body, members or contacts.
export type MeetupInviteCard = {
  id: string; memberCount: number | null; capacity: number | null; fee: number | null;
  intro: string; area: string | null; inviter: string | null;
};
export type BusinessInviteLanding = { merchantId: string; name: string; cityId: string; meetups: string[] };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const words = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export function parseMeetupInviteCard(value: unknown, postId: string): MeetupInviteCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const card = value as Record<string, unknown>;
  if (card.id !== postId) return null;
  return {
    id: postId, memberCount: count(card.memberCount), capacity: count(card.capacity),
    fee: typeof card.fee === 'number' && Number.isFinite(card.fee) && card.fee > 0 ? card.fee : null,
    intro: words(card.intro, 200) ?? '', area: typeof card.area === 'string' && /^[a-z-]{2,40}$/.test(card.area) ? card.area : null,
    inviter: words(card.inviter, 40),
  };
}

export function parseBusinessInviteLanding(value: unknown): BusinessInviteLanding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const landing = value as Record<string, unknown>, name = words(landing.name, 80);
  if (typeof landing.merchantId !== 'string' || !UUID.test(landing.merchantId) || !name || typeof landing.cityId !== 'string') return null;
  const meetups = Array.isArray(landing.meetups) ? landing.meetups.filter((id): id is string => typeof id === 'string' && UUID.test(id)).slice(0, 5) : [];
  return { merchantId: landing.merchantId, name, cityId: landing.cityId, meetups };
}

export async function loadMeetupInviteCard(client: SupabaseClient, postId: string, code?: string | null) {
  const valid = normalizeInviteCode(code);
  const { data, error } = await client.rpc('get_meetup_invite_card', { p_post_id: postId, ...(valid ? { p_code: valid } : {}) });
  if (error) throw new Error(error.message);
  return parseMeetupInviteCard(data, postId);
}

export async function loadBusinessInviteLanding(client: SupabaseClient, code: string | null | undefined) {
  const valid = normalizeInviteCode(code);
  if (!valid) return null;
  const { data, error } = await client.rpc('get_business_invite_landing', { p_code: valid });
  if (error) throw new Error(error.message);
  return parseBusinessInviteLanding(data);
}

export const seatsLeft = (card: Pick<MeetupInviteCard, 'capacity' | 'memberCount'> | null | undefined) =>
  card?.capacity != null && card.memberCount != null ? Math.max(0, card.capacity - card.memberCount) : null;
