import type { SupabaseClient } from '@supabase/supabase-js';

export type MeetupTemplateDraft = { title: string; body: string; applicationQuestion: string; category?: string };
export type MeetupTemplate = { id: string; name: string; draft: MeetupTemplateDraft; updatedAt: string };
export type MeetupOccurrence = { startsAt: string; endsAt: string };
export type MeetupHostAggregates = { applications: number; approvals: number; confirmedAttendance: number; repeatParticipants: number };
export type MeetupHostIdentity = { userId: string; displayName: string; photoPaths: string[]; isHost: boolean };
export type MeetupHostToolsState = {
  tier: 'free' | 'plus' | 'pro' | 'premium'; isHost: boolean; isCohost: boolean; canManageSessions: boolean;
  canInvite: boolean; kind: 'once' | 'group'; available: boolean; canJoinWaitlist: boolean;
  waitlist: { joinedAt: string; invitedAt: string | null; position: number } | null;
  waitlistCount: number | null; cohosts: { userId: string; status: 'pending' | 'accepted' }[];
  candidates: string[];
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/** Logistics are deliberately excluded: applying a template cannot set a booking fact. */
export function templateDraft(value: Partial<MeetupTemplateDraft>): MeetupTemplateDraft {
  const result: MeetupTemplateDraft = { title: '', body: '', applicationQuestion: '' };
  for (const [key, max] of [['title', 60], ['body', 5000], ['applicationQuestion', 300], ['category', 40]] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('INVALID_TEMPLATE');
    if (typeof value[key] === 'string') {
      const text = value[key].trim();
      if ([...text].length > max) throw new Error('INVALID_TEMPLATE');
      result[key] = text;
    }
  }
  if (result.category && !['casual', 'party', 'festival', 'sports', 'hobby', 'travel'].includes(result.category)) throw new Error('INVALID_TEMPLATE');
  return result;
}

export function applyMeetupTemplate(current: MeetupTemplateDraft, saved: MeetupTemplateDraft): MeetupTemplateDraft {
  const template = templateDraft(saved);
  return { title: template.title || current.title, body: template.body || current.body,
    applicationQuestion: template.applicationQuestion || current.applicationQuestion,
    ...(template.category || current.category ? { category: template.category || current.category } : {}) };
}

export const loadMeetupTemplates = (client: SupabaseClient) => rpc<{ canUse: boolean; templates: MeetupTemplate[] }>(client, 'get_meetup_templates');
export async function saveMeetupTemplate(client: SupabaseClient, name: string, draft: Partial<MeetupTemplateDraft>, templateId: string | null = null) {
  const content = templateDraft(draft);
  if (!name.trim() || [...name.trim()].length > 60 || !Object.values(content).some(value => value.length)) throw new Error('INVALID_TEMPLATE');
  const id = await rpc<string>(client, 'save_meetup_template', { p_name: name.trim(), p_draft: content, p_template_id: templateId });
  if (!id || !uuid.test(id)) throw new Error('SAVE_NOT_VERIFIED');
  return id;
}
export const deleteMeetupTemplate = (client: SupabaseClient, templateId: string) => rpc<null>(client, 'delete_meetup_template', { p_template_id: templateId });
export const loadMeetupHostTools = (client: SupabaseClient, postId: string) => rpc<MeetupHostToolsState>(client, 'get_meetup_host_tools', { p_post_id: postId });
export async function loadMeetupHostRoster(client: SupabaseClient, postId: string): Promise<MeetupHostIdentity[]> {
  let result = await client.rpc('get_chilling_roster_v2', { p_post_id: postId });
  // New clients can still open rooms on servers that have not deployed v2 yet.
  if (result.error && ['PGRST202', '42883'].includes(result.error.code)) {
    result = await client.rpc('get_chilling_roster', { p_post_id: postId });
  }
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as MeetupHostIdentity[];
}

function validateTimes(startsAt: string, endsAt: string) {
  const start = Date.parse(startsAt), end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 7 * 86400000) throw new Error('INVALID_SESSION_TIME');
}
export async function proposeMeetupDates(client: SupabaseClient, postId: string, startsAt: string, endsAt: string, cadence: 'weekly' | 'fortnightly', count = 4, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  validateTimes(startsAt, endsAt);
  if (!['weekly', 'fortnightly'].includes(cadence) || !Number.isInteger(count) || count < 1 || count > 12) throw new Error('INVALID_RECURRENCE');
  return rpc<MeetupOccurrence[]>(client, 'propose_meetup_dates', { p_post_id: postId, p_starts_at: startsAt, p_ends_at: endsAt, p_cadence: cadence, p_count: count, p_timezone: timezone });
}
export async function confirmMeetupOccurrence(client: SupabaseClient, postId: string, occurrence: MeetupOccurrence) {
  validateTimes(occurrence.startsAt, occurrence.endsAt);
  const id = await rpc<string>(client, 'confirm_meetup_occurrence', { p_post_id: postId, p_starts_at: occurrence.startsAt, p_ends_at: occurrence.endsAt });
  if (!id || !uuid.test(id)) throw new Error('SAVE_NOT_VERIFIED');
  return id;
}
export const setMeetupWaitlist = (client: SupabaseClient, postId: string, optIn: boolean) => rpc<null>(client, 'set_meetup_waitlist', { p_post_id: postId, p_opt_in: optIn });
export async function inviteNextMeetupWaitlist(client: SupabaseClient, postId: string) {
  const invited = await rpc<boolean>(client, 'invite_next_meetup_waitlist', { p_post_id: postId });
  if (typeof invited !== 'boolean') throw new Error('INVITATION_NOT_VERIFIED');
  return invited;
}
export const inviteMeetupCohost = (client: SupabaseClient, postId: string, userId: string) => rpc<null>(client, 'invite_meetup_cohost', { p_post_id: postId, p_user_id: userId });
export const respondMeetupCohost = (client: SupabaseClient, postId: string, accept: boolean) => rpc<null>(client, 'respond_meetup_cohost', { p_post_id: postId, p_accept: accept });
export const removeMeetupCohost = (client: SupabaseClient, postId: string, userId: string) => rpc<null>(client, 'remove_meetup_cohost', { p_post_id: postId, p_user_id: userId });
export const loadMeetupHostAggregates = (client: SupabaseClient, postId: string) => rpc<MeetupHostAggregates | null>(client, 'get_meetup_host_aggregates', { p_post_id: postId });
