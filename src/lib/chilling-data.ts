import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeChillingEvent, type ChillingEventDraft } from './chilling.ts';
import { t } from '../i18n/index.ts';
import { meetupRestrictionError } from './meetup-policy.ts';
import { removePostImages, uploadPostImage, type PostDraftImage } from './community-data.ts';
import { loadMeetupProfilePhoto } from './chilling-profile-media.ts';

export const CHILLING_PROMPTS = {
  meet: '나랑 만나면 주로…', weekend: '내가 좋아하는 주말은', comfort: '내가 편해지는 순간은',
  join: '이런 모임이면 바로 신청해요', learn: '함께 배워보고 싶은 것은', ritual: '같이 해보고 싶은 작은 습관은',
} as const;
export type ChillingProfile = {
  intro: string; interests: string[]; promptOne: string; promptTwo: string;
  version?: 2; revision?: string; displayName?: string; cityId?: string; photoPaths?: string[]; publicPhotoPath?: string | null;
  promptOneId?: 'meet' | 'weekend' | 'comfort'; promptTwoId?: 'join' | 'learn' | 'ritual'; shareWithMembers?: boolean;
  preferences?: { activities: string[]; availability: string; pace: 'any' | 'relaxed' | 'active' };
  photoUris?: (string | null)[];
};
export type MeetupParticipation = { id: string; post_id: string; host_id: string; requester_id: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; created_at: string; responded_at: string | null };
export type ChillingApplication = { postId: string; requesterId: string; profile: ChillingProfile; answer: string; question: string; consentVersion: string; consentedAt: string;
  request: (MeetupParticipation & { requester: { nickname: string; city_id: string; avatar_path: string | null; photoUri?: string } | null; post: { title: string } | null }) | null };
export const CHILLING_CONSENT_VERSION = 'chilling-v2';

export async function loadMeetupParticipation(client: SupabaseClient, postId: string, userId: string): Promise<MeetupParticipation | null> {
  const result = await client.from('meetup_requests').select('id,post_id,host_id,requester_id,status,created_at,responded_at')
    .eq('post_id', postId).eq('requester_id', userId).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export async function loadMeetupRequestStatus(client: SupabaseClient, requestId: string, viewerId: string): Promise<MeetupParticipation | null> {
  const result = await client.from('meetup_requests').select('id,post_id,host_id,requester_id,status,created_at,responded_at')
    .eq('id', requestId).maybeSingle();
  if (result.error) throw result.error;
  return result.data && (result.data.requester_id === viewerId || result.data.host_id === viewerId) ? result.data : null;
}

export function normalizeChillingProfile(profile: ChillingProfile): ChillingProfile {
  if (!profile || typeof profile.intro !== 'string' || !Array.isArray(profile.interests) || profile.interests.some(x => typeof x !== 'string')
    || typeof profile.promptOne !== 'string' || typeof profile.promptTwo !== 'string') throw new Error('INVALID_CHILLING_PROFILE');
  const clean = { intro: profile.intro.trim(), interests: profile.interests.map(x => x.trim()),
    promptOne: profile.promptOne.trim(), promptTwo: profile.promptTwo.trim() };
  if (!clean.intro || clean.intro.length > 160 || clean.interests.length < 1 || clean.interests.length > 8
    || clean.interests.some(x => !x || x.length > 30) || !clean.promptOne || clean.promptOne.length > 300
    || !clean.promptTwo || clean.promptTwo.length > 300) throw new Error('INVALID_CHILLING_PROFILE');
  if (profile.version === undefined) return clean;
  const paths = profile.photoPaths;
  const preferences = profile.preferences;
  if (profile.version !== 2 || typeof profile.displayName !== 'string' || !profile.displayName.trim() || profile.displayName.trim().length > 30
    || typeof profile.cityId !== 'string' || !/^[a-z][a-z0-9-]{0,59}$/.test(profile.cityId)
    || !Array.isArray(paths) || paths.length > 3 || new Set(paths).size !== paths.length
    || paths.some(path => typeof path !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[a-z0-9-]+\.(?:jpg|png|webp)$/i.test(path))
    || (profile.publicPhotoPath !== null && !paths.includes(profile.publicPhotoPath ?? ''))
    || !['meet', 'weekend', 'comfort'].includes(profile.promptOneId ?? '') || !['join', 'learn', 'ritual'].includes(profile.promptTwoId ?? '')
    || typeof profile.shareWithMembers !== 'boolean' || !preferences || !Array.isArray(preferences.activities) || preferences.activities.length > 8
    || preferences.activities.some(x => typeof x !== 'string' || !x.trim() || x.trim().length > 30)
    || typeof preferences.availability !== 'string' || preferences.availability.trim().length > 160 || !['any', 'relaxed', 'active'].includes(preferences.pace)) throw new Error('INVALID_CHILLING_PROFILE');
  return { ...clean, version: 2, displayName: profile.displayName.trim(), cityId: profile.cityId,
    photoPaths: [...paths], publicPhotoPath: profile.publicPhotoPath ?? null, promptOneId: profile.promptOneId, promptTwoId: profile.promptTwoId,
    shareWithMembers: profile.shareWithMembers, preferences: { activities: preferences.activities.map(x => x.trim()), availability: preferences.availability.trim(), pace: preferences.pace } };
}

export function chillingProfilePreview(profile: ChillingProfile, audience: 'host' | 'members' | 'public'): ChillingProfile {
  const share = audience !== 'members' || profile.shareWithMembers === true;
  const prompts = audience === 'host' || (audience === 'public' && profile.version !== 2);
  const paths = share ? audience === 'public' ? profile.publicPhotoPath ? [profile.publicPhotoPath] : [] : profile.photoPaths ?? [] : [];
  return { version: profile.version, displayName: profile.displayName, cityId: share ? profile.cityId : undefined,
    intro: share ? profile.intro : '', interests: share ? [...profile.interests] : [],
    promptOne: prompts ? profile.promptOne : '', promptTwo: prompts ? profile.promptTwo : '',
    promptOneId: prompts ? profile.promptOneId : undefined, promptTwoId: prompts ? profile.promptTwoId : undefined,
    photoPaths: paths, photoUris: paths.map(path => profile.photoUris?.[(profile.photoPaths ?? []).indexOf(path)] ?? null) };
}

async function withChillingPhotos(client: SupabaseClient, profile: ChillingProfile | null): Promise<ChillingProfile | null> {
  if (!profile) return null;
  const photoUris = await Promise.all((profile.photoPaths ?? []).map(path => loadMeetupProfilePhoto(client, path).catch(() => null)));
  return { ...profile, intro: profile.intro ?? '', interests: profile.interests ?? [], promptOne: profile.promptOne ?? '', promptTwo: profile.promptTwo ?? '', photoUris };
}

export async function saveChillingProfile(client: SupabaseClient, profile: ChillingProfile) {
  const result = await client.rpc('save_chilling_profile', { p_profile: normalizeChillingProfile(profile) });
  if (result.error) throw result.error;
}
export async function loadChillingProfile(client: SupabaseClient, preview?: 'application' | 'hosting'): Promise<ChillingProfile | null> {
  const result = await client.rpc('get_my_chilling_profile');
  if (result.error) throw result.error;
  const profile = await withChillingPhotos(client, result.data);
  if (preview && profile) {
    const required = preview === 'hosting' ? profile.publicPhotoPath ? [profile.publicPhotoPath] : [] : profile.photoPaths ?? [];
    if (required.some(path => !profile.photoUris?.[(profile.photoPaths ?? []).indexOf(path)])) throw new Error('CHILLING_PROFILE_PHOTOS_UNAVAILABLE');
  }
  return profile;
}
export async function loadChillingHostProfile(client: SupabaseClient, postId: string): Promise<ChillingProfile | null> {
  const result = await client.rpc('get_chilling_host_profile', { p_post_id: postId });
  if (result.error) throw result.error;
  return withChillingPhotos(client, result.data);
}
export async function loadChillingMemberProfile(client: SupabaseClient, postId: string, userId: string): Promise<ChillingProfile | null> {
  const result = await client.rpc('get_chilling_member_profile', { p_post_id: postId, p_user_id: userId });
  if (result.error) throw result.error;
  return withChillingPhotos(client, result.data);
}
export async function loadChillingApplication(client: SupabaseClient, requestId: string, viewerId: string): Promise<ChillingApplication | null> {
  const result = await client.rpc('get_chilling_application', { p_request_id: requestId });
  if (result.error) throw result.error;
  if (!result.data) return null;
  const metadata = await client.from('meetup_requests')
    .select('id,post_id,host_id,requester_id,status,created_at,responded_at,post:posts!meetup_requests_post_id_fkey(title)')
    .eq('id', requestId).maybeSingle();
  if (metadata.error) throw metadata.error;
  const request = metadata.data as unknown as ChillingApplication['request'];
  // Cancellation can land between the guarded snapshot and the metadata response.
  if (result.data.requesterId !== viewerId && (!request || request.host_id !== viewerId || (request.status !== 'pending' && request.status !== 'approved'))) return null;
  const profile = await withChillingPhotos(client, result.data.profile);
  if (request) {
    request.requester = { nickname: profile?.displayName || '모임 멤버', city_id: profile?.cityId ?? '', avatar_path: null,
      ...(profile?.photoUris?.[0] ? { photoUri: profile.photoUris[0] } : {}) };
  }
  return { ...result.data, profile, request };
}
export async function requestChillingJoin(client: SupabaseClient, postId: string, answer: string, consent: boolean, profileRevision: string) {
  if (!consent) throw new Error('CHILLING_CONSENT_REQUIRED');
  if (!answer.trim() || answer.trim().length > 300) throw new Error('INVALID_CHILLING_ANSWER');
  if (typeof profileRevision !== 'string' || !profileRevision.trim() || profileRevision.length > 80) throw new Error('CHILLING_PROFILE_CHANGED');
  const result = await client.rpc('request_chilling_join_v2', {
    p_post_id: postId, p_answer: answer.trim(), p_consent_version: CHILLING_CONSENT_VERSION, p_profile_revision: profileRevision,
  });
  if (result.error) throw result.error;
  return result.data as string;
}
export async function createChillingEvent(client: SupabaseClient, draft: {
  cityId: string; title: string; body: string; event: ChillingEventDraft; question: string; userId?: string; image?: PostDraftImage; hostProfileRevision?: string;
}) {
  if (!draft.title.trim() || !draft.body.trim() || !draft.question.trim() || draft.question.trim().length > 300) throw new Error('INVALID_CHILLING_EVENT');
  const event = normalizeChillingEvent(draft.event);
  if (draft.image && !draft.userId) throw new Error('AUTH_REQUIRED');
  const imagePath = draft.image ? await uploadPostImage(client, draft.userId!, draft.image) : null;
  const result = await client.rpc('create_chilling_event', {
    p_city_id: draft.cityId, p_title: draft.title.trim(), p_body: draft.body.trim(),
    p_event: { ...event, ...(draft.hostProfileRevision ? { hostProfileConsentVersion: CHILLING_CONSENT_VERSION, hostProfileRevision: draft.hostProfileRevision } : {}) }, p_question: draft.question.trim(),
    ...(imagePath ? { p_image_paths: [imagePath] } : {}),
  });
  if (result.error) {
    if (imagePath) await removePostImages(client, [imagePath]);
    throw result.error;
  }
  return result.data as string;
}

const chillingErrors: Record<string, string> = {
    INVALID_RECOMMENDED_AGE: '권장 연령은 만 0~120세 안에서 최소·최대 나이를 함께 입력해주세요.',
    IMAGE_TOO_LARGE: '사진은 2MB 이하로 선택해 주세요.',
    UNSUPPORTED_IMAGE_TYPE: 'JPG, PNG 또는 WebP 사진을 선택해 주세요.',
    CHILLING_PROFILE_REQUIRED: '먼저 모임 프로필을 작성해 주세요.',
    CHILLING_PROFILE_VERSION_REQUIRED: '모임 프로필을 새 형식으로 저장한 뒤 다시 시도해 주세요.',
    CHILLING_PROFILE_CHANGED: '모임 프로필이 바뀌었어요. 새 내용을 확인한 뒤 다시 동의해 주세요.',
    CHILLING_PROFILE_PHOTOS_UNAVAILABLE: '공유할 사진을 불러오지 못했어요. 다시 불러오거나 모임 프로필에서 사진을 바꿔 주세요.',
    INVALID_CHILLING_PHOTO: '사진 파일을 확인하고 다시 선택해 주세요.',
    CHILLING_HOST_CONSENT_REQUIRED: '공개할 호스트 소개를 미리 보고 동의해 주세요.',
    INVALID_MEETUP_PHOTO: '사진 파일을 확인하고 다시 선택해 주세요.',
    INVALID_CHILLING_PROFILE: '소개·관심사·두 가지 답변을 모두 작성해 주세요.',
    CHILLING_CONSENT_REQUIRED: '프로필과 신청 답변 공유에 동의해 주세요.',
    INVALID_CHILLING_ANSWER: '신청 답변을 1~300자로 작성해 주세요.',
    INVALID_CHILLING_EVENT: '제목·소개·신청 질문을 확인해 주세요.',
    INVALID_APPLICATION_QUESTION: '신청 질문을 1~300자로 작성해 주세요.',
    INVALID_REQUEST_MESSAGE: '신청 답변을 1~300자로 작성해 주세요.',
    CONTENT_NOT_ALLOWED: '이 내용은 커뮤니티 기준에 맞지 않아 등록할 수 없어요.',
    MEETUP_EXPIRED: '이미 종료된 모임이에요. 새 참여 신청이나 승인을 할 수 없어요.', MEETUP_CLOSED: '모집이 마감됐어요. 새 참여 신청이나 승인을 할 수 없어요.',
    MEETUP_FULL: '정원이 모두 찼어요.', MEETUP_NOT_FOUND: '이 모임을 찾을 수 없어요.',
    REQUEST_COOLDOWN: '이 모임의 이전 신청이 거절되거나 취소된 뒤 24시간이 지나야 다시 신청할 수 있어요.',
    REQUEST_ALREADY_RESOLVED: '이 참여 신청은 이미 처리됐어요. 현재 상태를 다시 확인해 주세요.',
    REQUEST_NOT_FOUND: '이 참여 신청을 찾을 수 없어요.',
    AUTH_REQUIRED: '로그인 후 다시 시도해 주세요.', ACCOUNT_LOCKED: '현재 계정으로 이용할 수 없어요.',
    RELATIONSHIP_LIMIT: '현재 이용 가능한 모임 자리를 모두 사용했어요.',
    INVALID_SCHEDULE: '시작·종료 시각과 시간대 오프셋을 확인해 주세요. 종료는 시작 이후여야 해요.',
    INVALID_EVENT_SCHEDULE: '시작·종료 시각을 확인해 주세요. 종료는 시작 이후여야 해요.',
    INVALID_TIMEZONE: '올바른 시간대를 입력해 주세요.', INVALID_EVENT_TIMEZONE: '올바른 시간대를 입력해 주세요.',
    INVALID_CAPACITY: '정원은 2명 이상으로 설정해 주세요. 무료는 최대 50명, 유료 멤버십은 최대 5,000명이에요.',
    INVALID_EVENT_CAPACITY: '정원은 2명 이상으로 설정해 주세요. 무료는 최대 50명, 유료 멤버십은 최대 5,000명이에요.',
    INVALID_CADENCE: '활동 주기를 1~80자로 입력해 주세요.', INVALID_EVENT_CADENCE: '활동 주기를 1~80자로 입력해 주세요.',
};

export function getChillingErrorCode(error: unknown): string | null {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  return [...Object.keys(chillingErrors), ...Object.keys(t.actionErrors)].find(code => message.includes(code)) ?? null;
}

export function getChillingError(error: unknown): string {
  const restriction = meetupRestrictionError(error);
  if (restriction) return restriction;
  const code = getChillingErrorCode(error);
  if (code && chillingErrors[code]) return chillingErrors[code];
  const common = code ? t.actionErrors[code as keyof typeof t.actionErrors] : null;
  return common ? `${common.title}\n${common.body}` : '처리하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
}
