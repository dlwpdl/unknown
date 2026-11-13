import type { SupabaseClient } from '@supabase/supabase-js';
import { toQR } from 'toqr';
import { newDraftKey } from './meetup-convenience.ts';

// Host quests. The server decides every step, amount and payout; the app only shows them and sends the host's input.
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
export const QUEST_PHOTO_BUCKET = 'meetup-quest-photos';
/** Dollars per step; step 4 is the most it can reach (10 people). */
export const QUEST_STEP_AMOUNTS = [1, 5, 5, 10, 10, 4, 15] as const;

/** Step names and conditions shown in the app (Korean source strings; screens pass them through tr). The server rules are the source of truth. */
export const QUEST_STEPS = [
  { name: '첫 모임 열기', home: '날짜·장소가 있는 모임 글', checks: ['날짜·장소가 있는 모임 글을 올려요', '그 모임에서 2단계를 깨면 $1도 같이 쌓여요'] },
  { name: '첫 모임 진행', home: '나 말고 3명 이상 참석 확인', checks: ['모임 시간에 나 말고 3명 이상이 QR로 체크인해요', '모임이 끝나면 나랑 서로 참석을 확인해요', '나랑 이메일·전화번호·기기가 겹치지 않는 사람만 쳐요'] },
  { name: '모임 인증샷', home: '모임 시간 안에 앱 카메라로 1장', checks: ['모임 시간 안에 앱 카메라로 단체 사진 1장을 찍어요', '갤러리 사진은 안 돼요', '운영팀이 보고 나면 $5가 쌓여요'] },
  { name: '친구 초대', home: '내 코드로 온 사람', checks: ['내 초대 코드로 가입했어요', '다른 모임장이 연 글링 모임에 와서 QR로 체크인하고 참석 확인까지 됐어요. 내가 연 모임은 안 쳐요', '나랑 이메일·전화번호·기기가 겹치지 않아요'] },
  { name: '두 번째 모임', home: '첫 모임 7일 뒤부터 · 4명 이상', checks: ['첫 모임 7일 뒤부터 열어요', '4명 이상 참석 확인돼요', '그중 1명 이상은 첫 모임에도 온 사람이에요'] },
  { name: '모임 후기 2개', home: '참석 확인된 사람의 모임 후기', checks: ['참석 확인된 사람 2명이 모임 후기를 남겨요'] },
  { name: '세 번째 모임', home: '시작 30일 안에 · 4명 이상', checks: ['퀘스트를 시작하고 30일 안에 열어요', '4명 이상 참석 확인돼요'] },
] as const;

export type QuestStepStatus = 'todo' | 'pending' | 'held' | 'confirmed';
export const QUEST_STEP_TAGS: Record<QuestStepStatus, string> = { todo: '', pending: '확인 중', held: '운영팀 확인 중', confirmed: '확정' };
/** Why a person did not count, in one line (null: counted). */
export const QUEST_PERSON_REASONS: Record<string, string> = {
  inactive: '탈퇴했거나 쉬고 있는 계정이라 안 셌어요',
  operated: '운영팀 계정이라 안 셌어요',
  not_qr: 'QR로 체크인하지 않아서 안 셌어요',
  not_confirmed: '나랑 서로 참석 확인이 안 돼서 안 셌어요',
  no_show: '노쇼로 표시돼서 안 셌어요',
  same_person: '나랑 이메일·전화번호·기기가 겹쳐서 안 셌어요',
  same_device: '다른 참석자와 이메일·전화번호·기기가 겹쳐서 안 셌어요',
  helper_limit: '최근 30일 안에 이미 다른 퀘스트 모임장 2명의 모임에서 센 사람이라 안 셌어요',
  waiting: '가입은 했고 아직 모임 전이에요',
  duplicate: '다른 초대로 가입한 사람과 같은 사람이라 안 셌어요',
  over_limit: '10명이 다 차서 더 안 셌어요',
};
export type QuestPersonReason = null | 'inactive' | 'operated' | 'not_qr' | 'not_confirmed' | 'no_show' | 'same_person' | 'same_device' | 'helper_limit';
export type QuestInviteeState = 'confirmed' | 'pending' | 'waiting' | 'inactive' | 'operated' | 'same_person' | 'duplicate' | 'over_limit';
export type QuestSessionProblem = null | 'missing' | 'too_long' | 'invite_only' | 'late_notice' | 'outside_quest' | 'before_quest';
export type QuestSession = { id: string; title: string; startsAt: string; endsAt: string; problem: QuestSessionProblem; people: { nickname: string; reason: QuestPersonReason }[] };
export type QuestPayout = { status: 'requested' | 'sent' | 'held'; requestedAt: string; email: string | null; legalName: string | null; sentAt: string | null; transferLast4: string | null };
export type HostQuest =
  | { status: 'none'; accepting: boolean }
  | {
    status: 'active' | 'paid' | 'converted' | 'ended'; startedAt: string; endsAt: string; convertedDays: number;
    confirmed: number; pending: number; steps: { step: number; status: QuestStepStatus; confirmAfter: string | null }[];
    invitees: { nickname: string; state: QuestInviteeState }[]; sessions: QuestSession[];
    photo: { status: 'pending' | 'approved' | 'rejected'; sessionId: string; uploadedAt: string } | null;
    payout: QuestPayout | null; canRequestPayout: boolean;
  };
export type CheckInQr = { url: string; expiresAt: string; checkedIn: number; questProblem: QuestSessionProblem; questActive: boolean };

/** Accepts the 8-character code with spaces or dashes; anything else is null and never sent. */
export function normalizeQuestCode(input: string | null | undefined) {
  const code = (input ?? '').replace(/[\s-]/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}

/** The server's error code inside a Supabase error message, if it is one of ours. */
export function questError(error: unknown, codes: readonly string[]) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : '';
  return codes.find(code => message.includes(code)) ?? null;
}

/** How many invitees count toward money: nothing below 3, then one dollar each up to 10. */
export const inviteDollars = (counted: number) => counted >= 3 ? Math.min(counted, 10) : 0;

/** Reads the session and one-time code from a scanned check-in link (https or gling://). */
/** QR modules as horizontal runs per row, so the code draws with plain Views (no SVG or camera module). */
export function qrRuns(text: string) {
  // The link is ASCII; bytes keep the encoder in byte mode.
  const cells = toQR(Uint8Array.from(text, char => char.charCodeAt(0)));
  const size = Math.round(Math.sqrt(cells.length));
  const rows: [number, number][][] = [];
  for (let y = 0; y < size; y++) {
    const row: [number, number][] = [];
    for (let x = 0; x < size; x++) {
      if (!cells[y * size + x]) continue;
      const last = row[row.length - 1];
      if (last && last[0] + last[1] === x) last[1]++;
      else row.push([x, 1]);
    }
    rows.push(row);
  }
  return { size, rows };
}

export const dollars = (cents: number) => `$${Math.floor(cents / 100)}`;
export const daysLeft = (endsAt: string, now: number) => Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 86400000));

export const questPhotoPath = (userId: string, sessionId: string, id: string) => `${userId}/${sessionId}/${id}.webp`;

const call = async <T>(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data as T;
};
export const loadMyHostQuest = (client: SupabaseClient) => call<HostQuest>(client.rpc('get_my_host_quest'));
export const startHostQuest = (client: SupabaseClient, code: string) => call(client.rpc('start_host_quest', { p_code: code, p_agreed: true }));
export const requestQuestPayout = (client: SupabaseClient, email: string, legalName: string) =>
  call(client.rpc('request_host_quest_payout', { p_email: email.trim(), p_legal_name: legalName.trim() }));
export const loadCheckInQr = (client: SupabaseClient, sessionId: string) => call<CheckInQr>(client.rpc('get_meetup_check_in_qr', { p_session_id: sessionId }));
/** Returns the meetup post id so the attendee can open it. */
export const checkInWithQr = (client: SupabaseClient, sessionId: string, code: string) =>
  call<string>(client.rpc('check_in_meetup_qr', { p_session_id: sessionId, p_code: code }));

/** Uploads the in-app camera photo to the private bucket, then hands its path to the server, which checks time and duplicates. */
export async function sendQuestPhoto(client: SupabaseClient, userId: string, sessionId: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const path = questPhotoPath(userId, sessionId, newDraftKey());
  const { error } = await client.storage.from(QUEST_PHOTO_BUCKET).upload(path, bytes.buffer, { contentType: 'image/webp', upsert: false });
  if (error) throw new Error(error.message);
  return call<string>(client.rpc('submit_host_quest_photo', { p_session_id: sessionId, p_path: path }));
}
