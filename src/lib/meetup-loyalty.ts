import type { SupabaseClient } from '@supabase/supabase-js';
import type { MembershipTier } from './membership.ts';

// Server contract: supabase/migrations/20261029140000_host_loyalty.sql. Badge counts arrive as levels (0/1/5/10/25).
export type BadgeLevels = { attended: number; hosted: number };
export type AnnouncementAudience = 'members' | 'pending' | 'waitlist';
export type MeetupLoyalty = {
  isHost: boolean; hostTier: MembershipTier; kind: 'once' | 'group'; ended: boolean;
  following: boolean; canEncore: boolean; encored: boolean; isStaff: boolean;
  hostBadges: { hosted: number };
  pinned: { id: string; body: string; sentAt: string } | null;
  // Host only.
  followerCount?: number; encoreCount?: number; sentToday?: number;
  scheduled?: { id: string; body: string; audience: AnnouncementAudience; sendAt: string }[];
  autoNext?: { enabled: boolean; cadence: 'weekly' | 'fortnightly' } | null;
};
export type RosterMember = { userId: string; nickname: string; attended: number; lastAttendedAt: string | null; note: string; regular: boolean; staff: boolean };

export const ANNOUNCEMENT_MAX = 500;
export const ANNOUNCEMENTS_PER_DAY = 3;
// 단골 = 3+ attended sessions with this host (roster badge, host-only).
export const REGULAR_ATTENDANCE = 3;

const TIER_RANK: Record<MembershipTier, number> = { free: 0, plus: 1, pro: 2, premium: 3, admin: 4 };
/** Same ranking as private.require_meetup_tool_tier; the server still decides. */
export const tierAtLeast = (tier: MembershipTier | undefined, minimum: 'plus' | 'pro') => TIER_RANK[tier ?? 'free'] >= TIER_RANK[minimum];

const ATTENDED: Record<number, string> = { 1: '첫 모임 참석', 5: '모임 5번 참석', 10: '모임 10번 참석', 25: '모임 25번 참석' };
const HOSTED: Record<number, string> = { 1: '첫 모임 호스트', 5: '모임 5번 연 호스트', 10: '모임 10번 연 호스트', 25: '모임 25번 연 호스트' };
/** Korean source labels (tr() keys) for the highest level of each badge; hosting first. */
export function badgeLabels(levels: Partial<BadgeLevels> | undefined): string[] {
  return [HOSTED[levels?.hosted ?? 0], ATTENDED[levels?.attended ?? 0]].filter((label): label is string => !!label);
}

const ERRORS: Record<string, string> = {
  PLUS_REQUIRED: '플러스 멤버십부터 쓸 수 있어요.',
  PRO_REQUIRED: '프로 멤버십부터 쓸 수 있어요.',
  ANNOUNCEMENT_DAILY_LIMIT: '공지는 하루에 3번까지 보낼 수 있어요.',
  ANNOUNCEMENT_SCHEDULE_LIMIT: '예약 공지는 5개까지 걸어 둘 수 있어요.',
  INVALID_ANNOUNCEMENT_TIME: '예약은 5분 뒤부터 30일 안, 모임이 끝나기 전으로 잡아 주세요.',
  INVALID_ANNOUNCEMENT: '공지는 1~500자로 써 주세요.',
  CONTENT_NOT_ALLOWED: '보낼 수 없는 표현이 들어 있어요. 고쳐서 다시 보내 주세요.',
  MEETUP_CLOSED: '끝났거나 마감된 모임이에요.',
  MEETUP_EXPIRED: '끝났거나 마감된 모임이에요.',
  STAFF_LIMIT: '체크인 담당은 3명까지 정할 수 있어요.',
  FOLLOW_LIMIT: '호스트는 500명까지 팔로우할 수 있어요.',
  RATE_LIMITED: '잠깐 쉬었다가 다시 해 주세요.',
  CHECK_IN_CLOSED: '모임 시간에만 체크인할 수 있어요.',
};
/** Korean copy (tr() key) for a server error code. */
export function loyaltyError(failure: unknown, fallback = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.') {
  const message = failure instanceof Error ? failure.message : String(failure ?? '');
  const code = Object.keys(ERRORS).find(key => message.includes(key));
  return code ? ERRORS[code] : fallback;
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
export const loadMeetupLoyalty = (client: SupabaseClient, postId: string) => rpc<MeetupLoyalty>(client, 'get_meetup_loyalty', { p_post_id: postId });
export const loadMeetupBadges = (client: SupabaseClient, input: { userIds?: string[]; postId?: string }) =>
  rpc<Record<string, BadgeLevels>>(client, 'get_meetup_badges', { p_user_ids: input.userIds ?? null, p_post_id: input.postId ?? null });
export const setHostFollow = (client: SupabaseClient, postId: string, follow: boolean) => rpc<boolean>(client, 'set_meetup_host_follow', { p_post_id: postId, p_follow: follow });
export const setMeetupEncore = (client: SupabaseClient, postId: string, encore: boolean) => rpc<boolean>(client, 'set_meetup_encore', { p_post_id: postId, p_encore: encore });
export const postMeetupAnnouncement = (client: SupabaseClient, postId: string, body: string, audience: AnnouncementAudience, sendAt: string | null) =>
  rpc<string>(client, 'post_meetup_announcement', { p_post_id: postId, p_body: body.trim(), p_audience: audience, p_send_at: sendAt });
export const updateMeetupAnnouncement = (client: SupabaseClient, id: string, action: 'cancel' | 'unpin') => rpc<null>(client, 'update_meetup_announcement', { p_announcement_id: id, p_action: action });
export const loadMeetupRoster = (client: SupabaseClient, postId: string) => rpc<RosterMember[]>(client, 'get_meetup_roster', { p_post_id: postId });
export const saveMemberNote = (client: SupabaseClient, postId: string, memberId: string, note: string, regular: boolean) =>
  rpc<null>(client, 'set_meetup_member_note', { p_post_id: postId, p_member_id: memberId, p_note: note.trim(), p_regular: regular });
export const setCheckinStaff = (client: SupabaseClient, postId: string, userId: string, staff: boolean) => rpc<null>(client, 'set_meetup_checkin_staff', { p_post_id: postId, p_user_id: userId, p_staff: staff });
export const staffCheckIn = (client: SupabaseClient, sessionId: string, attendeeId: string) => rpc<null>(client, 'staff_check_in_meetup', { p_session_id: sessionId, p_attendee_id: attendeeId });
export const setMeetupAutoNext = (client: SupabaseClient, postId: string, enabled: boolean, cadence: 'weekly' | 'fortnightly') =>
  rpc<null>(client, 'set_meetup_auto_next', { p_post_id: postId, p_enabled: enabled, p_cadence: cadence });
