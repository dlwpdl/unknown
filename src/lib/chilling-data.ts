import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeChillingEvent, type ChillingEventDraft } from './chilling.ts';
import { t } from '../i18n/ko.ts';
import { meetupRestrictionError } from './meetup-policy.ts';

export type ChillingProfile = { intro: string; interests: string[]; promptOne: string; promptTwo: string };
export type ChillingApplication = { postId: string; requesterId: string; profile: ChillingProfile; answer: string; question: string; consentVersion: string; consentedAt: string };
export const CHILLING_CONSENT_VERSION = 'chilling-v1';

export function normalizeChillingProfile(profile: ChillingProfile): ChillingProfile {
  const clean = { intro: profile.intro.trim(), interests: profile.interests.map(x => x.trim()),
    promptOne: profile.promptOne.trim(), promptTwo: profile.promptTwo.trim() };
  if (!clean.intro || clean.intro.length > 160 || clean.interests.length < 1 || clean.interests.length > 8
    || clean.interests.some(x => !x || x.length > 30) || !clean.promptOne || clean.promptOne.length > 300
    || !clean.promptTwo || clean.promptTwo.length > 300) throw new Error('INVALID_CHILLING_PROFILE');
  return clean;
}

export async function saveChillingProfile(client: SupabaseClient, profile: ChillingProfile) {
  const result = await client.rpc('save_chilling_profile', { p_profile: normalizeChillingProfile(profile) });
  if (result.error) throw result.error;
}
export async function loadChillingProfile(client: SupabaseClient): Promise<ChillingProfile | null> {
  const result = await client.rpc('get_my_chilling_profile');
  if (result.error) throw result.error;
  return result.data;
}
export async function loadChillingHostProfile(client: SupabaseClient, postId: string): Promise<ChillingProfile | null> {
  const result = await client.rpc('get_chilling_host_profile', { p_post_id: postId });
  if (result.error) throw result.error;
  return result.data;
}
export async function loadChillingApplication(client: SupabaseClient, requestId: string): Promise<ChillingApplication | null> {
  const result = await client.rpc('get_chilling_application', { p_request_id: requestId });
  if (result.error) throw result.error;
  return result.data;
}
export async function requestChillingJoin(client: SupabaseClient, postId: string, answer: string, consent: boolean) {
  if (!consent) throw new Error('CHILLING_CONSENT_REQUIRED');
  if (!answer.trim() || answer.trim().length > 300) throw new Error('INVALID_CHILLING_ANSWER');
  const result = await client.rpc('request_chilling_join', {
    p_post_id: postId, p_answer: answer.trim(), p_consent_version: CHILLING_CONSENT_VERSION,
  });
  if (result.error) throw result.error;
  return result.data as string;
}
export async function createChillingEvent(client: SupabaseClient, draft: {
  cityId: string; title: string; body: string; event: ChillingEventDraft; question: string;
}) {
  if (!draft.title.trim() || !draft.body.trim() || !draft.question.trim() || draft.question.trim().length > 300) throw new Error('INVALID_CHILLING_EVENT');
  const result = await client.rpc('create_chilling_event', {
    p_city_id: draft.cityId, p_title: draft.title.trim(), p_body: draft.body.trim(),
    p_event: normalizeChillingEvent(draft.event), p_question: draft.question.trim(),
  });
  if (result.error) throw result.error;
  return result.data as string;
}

export function getChillingError(error: unknown): string {
  const restriction = meetupRestrictionError(error);
  if (restriction) return restriction;
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const messages: Record<string, string> = {
    CHILLING_PROFILE_REQUIRED: '먼저 모임 프로필을 작성해 주세요.',
    INVALID_CHILLING_PROFILE: '소개·관심사·두 가지 답변을 모두 작성해 주세요.',
    CHILLING_CONSENT_REQUIRED: '프로필과 신청 답변 공유에 동의해 주세요.',
    INVALID_CHILLING_ANSWER: '신청 답변을 1~300자로 작성해 주세요.',
    INVALID_CHILLING_EVENT: '제목·소개·신청 질문을 확인해 주세요.',
    INVALID_APPLICATION_QUESTION: '신청 질문을 1~300자로 작성해 주세요.',
    INVALID_REQUEST_MESSAGE: '신청 답변을 1~300자로 작성해 주세요.',
    CONTENT_NOT_ALLOWED: '이 내용은 커뮤니티 기준에 맞지 않아 등록할 수 없어요.',
    MEETUP_EXPIRED: '이미 종료된 칠링이에요.', MEETUP_CLOSED: '모집이 마감됐어요.',
    MEETUP_FULL: '정원이 모두 찼어요.', MEETUP_NOT_FOUND: '이 모임을 찾을 수 없어요.',
    AUTH_REQUIRED: '로그인 후 다시 시도해 주세요.', ACCOUNT_LOCKED: '현재 계정으로 이용할 수 없어요.',
    RELATIONSHIP_LIMIT: '현재 이용 가능한 모임 자리를 모두 사용했어요.',
    INVALID_SCHEDULE: '시작·종료 시각과 시간대 오프셋을 확인해 주세요. 종료는 시작 이후여야 해요.',
    INVALID_EVENT_SCHEDULE: '시작·종료 시각을 확인해 주세요. 종료는 시작 이후여야 해요.',
    INVALID_TIMEZONE: '올바른 시간대를 입력해 주세요.', INVALID_EVENT_TIMEZONE: '올바른 시간대를 입력해 주세요.',
    INVALID_CAPACITY: '정원은 2~50명으로 설정해 주세요.', INVALID_EVENT_CAPACITY: '정원은 2~50명으로 설정해 주세요.',
    INVALID_CADENCE: '활동 주기를 1~80자로 입력해 주세요.', INVALID_EVENT_CADENCE: '활동 주기를 1~80자로 입력해 주세요.',
  };
  const common = Object.entries(t.actionErrors).find(([code]) => message.includes(code))?.[1];
  return common ? `${common.title}\n${common.body}` : Object.entries(messages).find(([code]) => message.includes(code))?.[1] ?? '처리하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
}
