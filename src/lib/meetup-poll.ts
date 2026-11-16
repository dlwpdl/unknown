import type { SupabaseClient } from '@supabase/supabase-js';

// Server contract: supabase/migrations/20261116140000_meetup_poll.sql. Counts only: the server never returns who voted.
export type PollOption = { id: string; kind: 'date' | 'place'; startsAt: string | null; label: string | null; chosen: boolean; votes: number; mine: boolean };
export type MeetupPoll = { id: string; status: 'open' | 'decided'; canManage: boolean; closedAt: string | null; members: number; voters: number; options: PollOption[] };
export type PollDraft = { dates: string[]; places: string[] };

export const POLL_MAX_PER_KIND = 5;
export const POLL_PLACE_MAX = 60;

/** Same rules the server checks: each kind is either absent or has 2 to 5 distinct choices. */
export function pollDraftError(draft: PollDraft): string | null {
  const places = draft.places.map(place => place.trim());
  for (const count of [draft.dates.length, places.length]) if (count === 1 || count > POLL_MAX_PER_KIND) return '날짜도 장소도, 넣는다면 후보는 2~5개예요.';
  if (!draft.dates.length && !places.length) return '날짜나 장소 후보를 넣어 주세요.';
  if (new Set(draft.dates).size !== draft.dates.length || new Set(places.map(place => place.toLowerCase())).size !== places.length) return '같은 후보가 두 번 들어 있어요.';
  if (places.some(place => !place || [...place].length > POLL_PLACE_MAX)) return '장소는 1~60자로 적어 주세요.';
  if (draft.dates.some(date => !(Date.parse(date) > Date.now()))) return '지난 시각은 고를 수 없어요.';
  return null;
}

/** The option with the most votes in a kind, earliest listed first on a tie; what the host sees preselected. */
export function leadingOption(options: PollOption[], kind: PollOption['kind']): PollOption | null {
  return options.filter(option => option.kind === kind).reduce<PollOption | null>((best, option) => !best || option.votes > best.votes ? option : best, null);
}

const ERRORS: Record<string, string> = {
  HOST_REQUIRED: '호스트와 공동 호스트만 할 수 있어요.',
  POLL_ALREADY_OPEN: '이미 진행 중인 투표가 있어요. 채팅 맨 위에서 확인해 주세요.',
  POLL_NOT_OPEN: '이미 끝난 투표예요.',
  POLL_DATE_PASSED: '이미 지난 날짜예요. 투표를 끝내고 새로 열어 주세요.',
  SESSION_OVERLAP: '같은 시간에 이미 등록된 회차가 있어요. 다른 날짜를 골라 주세요.',
  INVALID_POLL: '날짜도 장소도, 넣는다면 후보는 2~5개예요.',
  POLL_PLACE_EVENT: '행사와 이어진 모임은 장소를 투표로 정할 수 없어요. 날짜만 열어 주세요.',
  INVALID_POLL_DATE: '지난 시각은 고를 수 없어요.',
  INVALID_POLL_PLACE: '장소는 1~60자로, 서로 다르게 적어 주세요.',
  POST_BODY_TOO_LONG: '모임 소개가 너무 길어서 장소를 바꾸지 못했어요. 소개를 줄인 뒤 다시 해 주세요.',
  CONTENT_NOT_ALLOWED: '보낼 수 없는 표현이 들어 있어요. 고쳐서 다시 보내 주세요.',
  MEETUP_CLOSED: '끝났거나 마감된 모임이에요.',
  MEETUP_EXPIRED: '끝났거나 마감된 모임이에요.',
  RATE_LIMITED: '잠깐 쉬었다가 다시 해 주세요.',
};
/** Korean copy (tr() key) for a server error code. */
export function pollError(failure: unknown, fallback = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.') {
  const message = failure instanceof Error ? failure.message : String(failure ?? '');
  const code = Object.keys(ERRORS).find(key => message.includes(key));
  return code ? ERRORS[code] : fallback;
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
export const loadMeetupPoll = (client: SupabaseClient, postId: string) => rpc<MeetupPoll | null>(client, 'get_meetup_poll', { p_post_id: postId });
export const createMeetupPoll = (client: SupabaseClient, postId: string, draft: PollDraft) =>
  rpc<string>(client, 'create_meetup_poll', { p_post_id: postId, p_dates: draft.dates, p_places: draft.places.map(place => place.trim()) });
export const voteMeetupPoll = (client: SupabaseClient, pollId: string, optionIds: string[]) => rpc<null>(client, 'vote_meetup_poll', { p_poll_id: pollId, p_option_ids: optionIds });
export const decideMeetupPoll = (client: SupabaseClient, pollId: string, dateOptionId: string | null, placeOptionId: string | null) =>
  rpc<null>(client, 'decide_meetup_poll', { p_poll_id: pollId, p_date_option: dateOptionId, p_place_option: placeOptionId });
