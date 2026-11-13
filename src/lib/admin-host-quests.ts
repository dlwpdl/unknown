import type { SupabaseClient } from '@supabase/supabase-js';

import { QUEST_PHOTO_BUCKET } from './host-quests.ts';

// Operator side of host quests. Every call is checked and logged by the server (admin_access_logs scope 'host_quests').
type Totals = { confirmed: number; pending: number; invitees: number };
export type AdminQuestRow = { id: string; hostId: string; nickname: string; status: string; startedAt: string; endsAt: string; totals: Totals; payoutStatus: string | null; photoPending: boolean; held: number };
export type AdminQuestProgram = {
  accepting: boolean; codeLimit: number; codesMade: number; remaining: number;
  codes: { code: string; recipientName: string | null; note: string | null; createdAt: string; usedAt: string | null; questId: string | null; nickname: string | null }[];
  quests: AdminQuestRow[];
};
export type AdminQuestPerson = { id: string; nickname: string; reason: string | null; qr: boolean; confirmed: boolean; joinedAt: string; otherHostMeetups: number; otherQuestHosts: number };
export type AdminQuest = {
  id: string; status: string; startedAt: string; endsAt: string; finishedAt: string | null; endNote: string | null; convertedDays: number; totals: Totals;
  host: { id: string; nickname: string; joinedAt: string }; code: { code: string; recipientName: string | null; note: string | null };
  steps: { id: number; step: number; amount: number; status: string; heldReason: string | null; cancelReason: string | null; earnedAt: string; confirmAfter: string; sessionIds: string[]; personIds: string[]; personId: string | null; photoId: string | null; note: string | null }[];
  sessions: { id: string; title: string; startsAt: string; endsAt: string; problem: string | null; people: AdminQuestPerson[]; reports: number; noShows: number }[];
  invitees: { id: string; nickname: string; joinedAt: string; sessionId: string | null; reason: string | null }[];
  photos: { id: string; path: string | null; status: string; sessionId: string; uploadedAt: string; reviewedAt: string | null; deleteAfter: string; deletedAt: string | null; sameFileElsewhere: number }[];
  reports: number;
  payout: null | { status: string; email: string | null; legalName: string | null; requestedAt: string; photoPeople: number | null; photoNeeded: number | null; sentAt: string | null; transferLast4: string | null; heldAt: string | null; heldNote: string | null; erasedAt: string | null; nameMatches: boolean; sameNameElsewhere: number };
  checks: { personId: string; nickname: string | null; sessionId: string; conversationId: string; askedAt: string; answer: 'yes' | 'no' | 'none' | null; answeredAt: string | null }[];
};

const call = async <T>(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data as T;
};
export const loadAdminQuestProgram = (client: SupabaseClient) => call<AdminQuestProgram>(client.rpc('get_admin_host_quests'));
export const loadAdminQuest = (client: SupabaseClient, questId: string) => call<AdminQuest>(client.rpc('get_admin_host_quest', { p_quest_id: questId }));
export const createAdminQuestCodes = (client: SupabaseClient, count: number, recipientName: string) =>
  call<string[]>(client.rpc('create_admin_host_quest_codes', { p_count: count, p_recipient_name: recipientName.trim() || null }));
export const setAdminQuestCode = (client: SupabaseClient, code: string, recipientName: string, note: string) =>
  call(client.rpc('set_admin_host_quest_code', { p_code: code, p_recipient_name: recipientName.trim(), p_note: note.trim() || null }));
export const setAdminQuestAccepting = (client: SupabaseClient, accepting: boolean) => call(client.rpc('set_admin_host_quest_accepting', { p_accepting: accepting }));
export const reviewAdminQuestPhoto = (client: SupabaseClient, photoId: string, approve: boolean, note: string) =>
  call(client.rpc('review_admin_host_quest_photo', { p_photo_id: photoId, p_approve: approve, p_note: note.trim() || null }));
export const decideAdminQuestStep = (client: SupabaseClient, stepId: number, confirm: boolean, note: string) =>
  call(client.rpc('decide_admin_host_quest_step', { p_step_id: stepId, p_confirm: confirm, p_note: note.trim() || null }));
export const endAdminQuest = (client: SupabaseClient, questId: string, convert: boolean, note: string) =>
  call<number>(client.rpc('end_admin_host_quest', { p_quest_id: questId, p_convert: convert, p_note: note.trim() }));
export const setAdminQuestPhotoPeople = (client: SupabaseClient, questId: string, count: number) =>
  call(client.rpc('set_admin_host_quest_photo_people', { p_quest_id: questId, p_count: count }));
export const askAdminQuestAttendee = (client: SupabaseClient, questId: string, personId: string) =>
  call<string>(client.rpc('ask_admin_host_quest_attendee', { p_quest_id: questId, p_person_id: personId }));
export const recordAdminQuestCheck = (client: SupabaseClient, questId: string, personId: string, answer: 'yes' | 'no' | 'none') =>
  call(client.rpc('record_admin_host_quest_check', { p_quest_id: questId, p_person_id: personId, p_answer: answer }));
export const settleAdminQuestPayout = (client: SupabaseClient, questId: string, action: 'sent' | 'held', last4: string, bankNameMatched: boolean, note: string) =>
  call(client.rpc('settle_admin_host_quest_payout', { p_quest_id: questId, p_action: action, p_transfer_last4: last4.trim() || null, p_bank_name_matched: bankNameMatched, p_note: note.trim() || null }));
/** Short-lived link to a private quest photo; reading it is logged by the storage policy. */
export async function adminQuestPhotoUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(QUEST_PHOTO_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'QUEST_PHOTO_UNAVAILABLE');
  return data.signedUrl;
}

/** People the operator can ask "were you there?": counted attendees of the meetups behind steps 2, 5 and 7,
 * least suspicious first (joined before the quest, then most meetups with other hosts). */
export function questCheckCandidates(quest: Pick<AdminQuest, 'steps' | 'sessions' | 'startedAt'>) {
  const people = new Map(quest.sessions.flatMap(session => session.people.map(person => [person.id, person] as const)));
  const ids = [...new Set(quest.steps.filter(step => [2, 5, 7].includes(step.step) && step.status !== 'cancelled').flatMap(step => step.personIds))];
  return ids.map(id => {
    const person = people.get(id);
    return { id, nickname: person?.nickname ?? id.slice(0, 8), joinedAt: person?.joinedAt ?? null, otherHostMeetups: person?.otherHostMeetups ?? 0,
      joinedAfterStart: !person || Date.parse(person.joinedAt) >= Date.parse(quest.startedAt) };
  }).sort((a, b) => Number(a.joinedAfterStart) - Number(b.joinedAfterStart) || b.otherHostMeetups - a.otherHostMeetups);
}

/** What still blocks "보냄", in the server's order, so the button explains itself before it is pressed. */
export function payoutBlockers(quest: Pick<AdminQuest, 'status' | 'totals' | 'payout' | 'checks' | 'code'>, bankNameMatched: boolean, last4: string) {
  const pay = quest.payout, out: string[] = [];
  if (!pay || pay.status === 'sent') return pay ? ['이미 보냈어요'] : ['송금 요청이 없어요'];
  if (quest.status !== 'active') out.push('끝난 퀘스트예요');
  if (quest.totals.confirmed < 5000) out.push('$50이 다 확정되지 않았어요');
  if (!pay.email || !pay.legalName) out.push('송금 정보가 지워졌어요');
  if (pay.photoPeople == null) out.push('사진 속 사람 수를 적어 주세요');
  else if (pay.photoNeeded == null || pay.photoPeople < pay.photoNeeded) out.push('사진 속 사람이 센 사람보다 적어요');
  if (quest.checks.filter(check => check.answer === 'yes').length < 2) out.push('참석자 2명에게 다녀왔다는 답을 받아 주세요');
  if (!quest.code.recipientName?.trim()) out.push('코드 받은 사람 이름을 적어 주세요');
  else if (!pay.nameMatches) out.push('코드 받은 사람 이름과 은행 이름이 달라요');
  if (!bankNameMatched) out.push('은행 화면의 받는 사람 이름을 확인해 주세요');
  if (!/^[A-Za-z0-9]{4}$/.test(last4.trim())) out.push('이체 번호 끝 4자리를 적어 주세요');
  return out;
}
