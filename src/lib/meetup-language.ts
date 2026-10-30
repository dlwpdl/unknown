import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoomPreview } from './types.ts';

// Language exchange meetups (20261030221000 migration). room.category stays 'casual' so published apps show 가볍게.
export const MEETUP_LANGUAGES = ['ko', 'en', 'fr'] as const;
export type MeetupLanguage = typeof MEETUP_LANGUAGES[number];
// Each language is written in itself, the way people look for it, in both app languages.
export const MEETUP_LANGUAGE_NAMES: Record<MeetupLanguage, string> = { ko: '한국어', en: 'English', fr: 'Français' };
export type LanguageExchange = { languages: [MeetupLanguage, MeetupLanguage]; share: number };
export type LanguageChoice = { speaks: MeetupLanguage; learns: MeetupLanguage };
// Share of member seats for the first language: half each, 2:1, 1:2.
export const LANGUAGE_SHARES = [50, 67, 33] as const;
export const DEFAULT_LANGUAGE_EXCHANGE: LanguageExchange = { languages: ['ko', 'en'], share: 50 };

const isLanguage = (value: unknown): value is MeetupLanguage => MEETUP_LANGUAGES.includes(value as MeetupLanguage);

export function parseLanguageExchange(room?: Pick<RoomPreview, 'languageExchange'> | null): LanguageExchange | null {
  const value = room?.languageExchange;
  if (!value || !Array.isArray(value.languages) || value.languages.length !== 2) return null;
  const [first, second] = value.languages;
  if (!isLanguage(first) || !isLanguage(second) || first === second || !Number.isInteger(value.share) || value.share < 10 || value.share > 90) return null;
  return { languages: [first, second], share: value.share };
}

export function normalizeLanguageExchange(value: LanguageExchange, capacity: number): LanguageExchange {
  const exchange = parseLanguageExchange({ languageExchange: value });
  if (!exchange) throw new Error('INVALID_LANGUAGE_EXCHANGE');
  if (!Number.isInteger(capacity) || capacity < 3) throw new Error('LANGUAGE_EXCHANGE_CAPACITY');
  return exchange;
}

export const meetupCategoryOf = (room?: Pick<RoomPreview, 'category' | 'languageExchange'> | null) =>
  parseLanguageExchange(room) ? 'language' as const : room?.category;

export const languagePairLabel = ({ languages: [first, second] }: LanguageExchange) =>
  `${MEETUP_LANGUAGE_NAMES[first]} ↔ ${MEETUP_LANGUAGE_NAMES[second]}`;

// Mirrors private.meetup_language_seats: member seats exclude the host, round half up, and each side keeps one seat.
export function languageSeats(exchange: LanguageExchange, capacity: number): [number, number] | null {
  const seats = capacity - 1;
  if (!Number.isInteger(seats) || seats < 2) return null;
  const first = Math.max(1, Math.min(seats - 1, Math.floor((seats * exchange.share + 50) / 100)));
  return [first, seats - first];
}

export const otherLanguage = (exchange: LanguageExchange, language: MeetupLanguage) =>
  exchange.languages[0] === language ? exchange.languages[1] : exchange.languages[0];

export type LanguageSide = { language: MeetupLanguage; seats: number | null; approved: number; pending: number | null; waiting: number | null };
export type MeetupLanguages = {
  sides: LanguageSide[]; mine: LanguageChoice | null;
  // Host only: the side of each pending/approved request, and requests sent from apps without the language step.
  requests: Record<string, LanguageChoice> | null; unknown: { approved: number; pending: number } | null;
};

export function sideOpen(state: MeetupLanguages | null, language: MeetupLanguage) {
  const side = state?.sides.find(item => item.language === language);
  return !side || side.seats == null || side.approved < side.seats;
}

export async function loadMeetupLanguages(client: SupabaseClient, postId: string): Promise<MeetupLanguages | null> {
  const result = await client.rpc('get_meetup_languages', { p_post_id: postId });
  if (result.error) throw result.error;
  const data = result.data as MeetupLanguages | null;
  return data ? { sides: data.sides ?? [], mine: data.mine ?? null, requests: data.requests ?? null, unknown: data.unknown ?? null } : null;
}

export async function setLanguageExchangeWaitlist(client: SupabaseClient, postId: string, choice: LanguageChoice) {
  const result = await client.rpc('set_language_exchange_waitlist', { p_post_id: postId, p_speaks: choice.speaks, p_learns: choice.learns });
  if (result.error) throw result.error;
}
