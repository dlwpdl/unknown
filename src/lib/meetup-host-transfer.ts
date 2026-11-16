import type { SupabaseClient } from '@supabase/supabase-js';

/** One read for both sides (get_meetup_host_transfer): the host sees who can take over and any open offer; the receiver sees the offer. */
export type MeetupHostTransferState = {
  isHost: boolean; available?: boolean;
  candidates?: { userId: string; blocker: string | null }[];
  pending?: { toUserId: string; expiresAt: string } | null;
  offer?: { hostName: string; expiresAt: string; blocker: string | null; capacity: number | null; seatLimit: number } | null;
};

// Shown in the same words on both screens; keys are the server error codes.
export const hostTransferErrors: Record<string, string> = {
  TRANSFER_CAPACITY_EXCEEDED: '이 모임 정원이 받는 분의 정원 한도보다 커서 넘길 수 없어요.',
  TRANSFER_RECEIVER_RESTRICTED: '받는 분이 지금은 모임을 열 수 없는 상태예요.',
  TRANSFER_NOT_AVAILABLE: '이 모임은 호스트를 넘길 수 없어요.',
  TRANSFER_ALREADY_PENDING: '이미 답을 기다리는 제안이 있어요.',
  TRANSFER_NOT_FOUND: '이 제안은 이미 끝났어요.',
  TRANSFER_EXPIRED: '제안 기간이 끝났어요. 호스트에게 다시 보내 달라고 해 주세요.',
  APPROVED_MEMBER_REQUIRED: '승인된 멤버에게만 넘길 수 있어요.',
  HOST_REQUIRED: '호스트만 할 수 있어요.',
  MEETUP_NOT_FOUND: '이 모임을 찾을 수 없어요.',
  MEETUP_CLOSED: '마감됐거나 끝난 모임이에요.',
  MEETUP_EXPIRED: '마감됐거나 끝난 모임이에요.',
  CHILLING_PROFILE_REQUIRED: '먼저 모임 프로필을 작성해 주세요.',
  CHILLING_PROFILE_CHANGED: '모임 프로필이 바뀌었어요. 새 내용을 확인한 뒤 다시 동의해 주세요.',
  CHILLING_HOST_CONSENT_REQUIRED: '공개할 호스트 소개를 미리 보고 동의해 주세요.',
  MEETUP_JOIN_RESTRICTED: '지금은 모임 참여가 제한돼 있어서 호스트를 넘길 수 없어요.',
  RATE_LIMITED: '잠시 뒤에 다시 시도해 주세요.',
};
export const hostTransferErrorText = (error: unknown): string | null => {
  const message = error instanceof Error ? error.message : '';
  const code = Object.keys(hostTransferErrors).filter(key => message.includes(key)).sort((a, b) => b.length - a.length)[0];
  return code ? hostTransferErrors[code] : null;
};

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export const loadMeetupHostTransfer = (client: SupabaseClient, postId: string) => rpc<MeetupHostTransferState>(client, 'get_meetup_host_transfer', { p_post_id: postId });
export const offerMeetupHostTransfer = (client: SupabaseClient, postId: string, userId: string) => rpc<string>(client, 'offer_meetup_host_transfer', { p_post_id: postId, p_user_id: userId });
export const cancelMeetupHostTransfer = (client: SupabaseClient, postId: string) => rpc<null>(client, 'cancel_meetup_host_transfer', { p_post_id: postId });
/** Accepting publishes the receiver's meetup profile as the host introduction, so it carries the same consent version and profile revision as creating a meetup. */
export const respondMeetupHostTransfer = (client: SupabaseClient, postId: string, accept: boolean, consent?: { consentVersion: string; profileRevision: string | null }) =>
  rpc<null>(client, 'respond_meetup_host_transfer', { p_post_id: postId, p_accept: accept, p_consent_version: accept ? consent?.consentVersion ?? null : null, p_profile_revision: accept ? consent?.profileRevision ?? null : null });

/** Days left, rounded up; the offer card says "n일 안에" and the last day says "오늘 안에". */
export function transferDaysLeft(expiresAt: string, now = Date.now()) {
  const left = Date.parse(expiresAt) - now;
  return Number.isFinite(left) ? Math.max(0, Math.ceil(left / 86400000)) : 0;
}
