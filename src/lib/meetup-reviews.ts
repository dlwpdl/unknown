import type { SupabaseClient } from '@supabase/supabase-js';

export type MannerSignals = { punctual: boolean | null; respectful: boolean | null; boundaries: boolean | null };
export type MannerContext = { sessionId?: string; conversationId?: string };
export type TrustTarget = 'meetup_review' | 'manner_review' | 'meetup_attendance';
export type TrustContent = { authorId: string; text: string; updatedAt: string; status: string; subjectId?: string; signals?: MannerSignals };
export type MeetupSession = {
  id: string; startsAt: string; endsAt: string; checkedIn: boolean; verified: boolean; claimStatus: string;
  canReview: boolean; reviewStatus: string | null;
  members: { id: string; nickname: string; checkedIn: boolean; verified: boolean; confirmedByMe: boolean }[];
};
export type MeetupSessions = { isHost: boolean; member: boolean; kind: 'once' | 'group'; sessions: MeetupSession[] };
export type MeetupReviewPage = { score: number | null; participants: number; reviews: {
  id: string; authorId: string; nickname: string; score: number; body: string | null; createdAt: string; sessionDate: string;
}[] };
export type MyMannerFeedback = { id: string; context: 'chat' | 'meeting'; score: number | null; signals: MannerSignals; status: string; createdAt: string; appealed: boolean };
export const MANNER_QUESTIONS: { key: keyof MannerSignals; label: string }[] = [
  { key: 'punctual', label: '약속 시간을 지켰어요' }, { key: 'respectful', label: '서로 존중하며 대화했어요' },
  { key: 'boundaries', label: '동의와 경계를 존중했어요' },
];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
export const loadMeetupSessions = (client: SupabaseClient, postId: string) => rpc<MeetupSessions>(client, 'get_meetup_sessions', { p_post_id: postId });
export const loadMeetupUpcomingSessions = (client: SupabaseClient, postId: string) => rpc<MeetupSessions>(client, 'get_meetup_upcoming_sessions', { p_post_id: postId });
export const loadMeetupReviews = (client: SupabaseClient, postId: string, offset = 0) => rpc<MeetupReviewPage>(client, 'get_meetup_reviews', { p_post_id: postId, p_offset: offset });
export const loadMyMeetupReviewInbox = (client: SupabaseClient) => rpc<{ postId: string; title: string; kind: 'once' | 'group' }[]>(client, 'get_my_meetup_review_inbox');
export const createMeetupSession = (client: SupabaseClient, postId: string, startsAt?: string, endsAt?: string) => rpc<string>(client, 'create_meetup_session', { p_post_id: postId, p_starts_at: startsAt ?? null, p_ends_at: endsAt ?? null });
export const checkInMeetup = (client: SupabaseClient, sessionId: string) => rpc<null>(client, 'check_in_meetup', { p_session_id: sessionId });
export const confirmMeetupAttendance = (client: SupabaseClient, sessionId: string, attendeeId: string) => rpc<null>(client, 'confirm_meetup_attendance', { p_session_id: sessionId, p_attendee_id: attendeeId });
export const claimMeetupAttendance = (client: SupabaseClient, sessionId: string, body: string) => rpc<string>(client, 'claim_meetup_attendance', { p_session_id: sessionId, p_body: body.trim() });
export async function writeMeetupReview(client: SupabaseClient, sessionId: string, score: number, body: string) {
  if (!uuid.test(sessionId) || !Number.isFinite(score) || score < 1 || score > 10 || !Number.isInteger(score * 2)
    || body.trim().length > 300 || (score <= 5 && body.trim().length < 10)) throw new Error('INVALID_REVIEW');
  const id = await rpc<string>(client, 'write_meetup_review', { p_session_id: sessionId, p_score: score, p_body: body.trim() || null });
  if (!id || !uuid.test(id)) throw new Error('REVIEW_SAVE_NOT_VERIFIED');
  return id;
}
export const loadMannerReviewState = (client: SupabaseClient, subjectId: string, context: MannerContext) => rpc<{ eligible: boolean; submitted: boolean; status: string | null }>(client, 'get_manner_review_state', { p_subject_id: subjectId, p_session_id: context.sessionId ?? null, p_conversation_id: context.conversationId ?? null });
export async function writeMannerReview(client: SupabaseClient, subjectId: string, context: MannerContext, signals: MannerSignals, score: number, body: string) {
  if (!uuid.test(subjectId) || Boolean(context.sessionId) === Boolean(context.conversationId)
    || !uuid.test(context.sessionId ?? context.conversationId ?? '')
    || Object.keys(signals).length !== 3 || MANNER_QUESTIONS.some(({ key }) => signals[key] !== null && typeof signals[key] !== 'boolean')
    || !Object.values(signals).some(value => typeof value === 'boolean') || (context.conversationId && signals.punctual !== null)
    || !Number.isFinite(score) || score < 1 || score > 10 || !Number.isInteger(score * 2)
    || body.trim().length > 300) throw new Error('INVALID_REVIEW');
  if ((score <= 5 || Object.values(signals).includes(false)) && body.trim().length < 10) throw new Error('REVIEW_REASON_REQUIRED');
  const id = await rpc<string>(client, 'write_user_review', { p_session_id: context.sessionId ?? null, p_conversation_id: context.conversationId ?? null, p_subject_id: subjectId, p_signals: signals, p_score: score, p_body: body.trim() || null });
  if (!id || !uuid.test(id)) throw new Error('REVIEW_SAVE_NOT_VERIFIED');
  return id;
}
export const loadMyMannerFeedback = (client: SupabaseClient) => rpc<MyMannerFeedback[]>(client, 'get_my_manner_feedback');
export const appealMannerReview = (client: SupabaseClient, reviewId: string, body: string) => rpc<null>(client, 'appeal_manner_review', { p_review_id: reviewId, p_body: body.trim() });
