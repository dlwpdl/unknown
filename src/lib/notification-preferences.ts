import type { SupabaseClient } from '@supabase/supabase-js';

export const NOTIFICATION_PREFERENCES_CHANGED = 'notificationPreferencesChanged';

export const NOTIFICATION_CATEGORIES = [
  { key: 'post_likes', label: '내 글 좋아요' },
  { key: 'comment_likes', label: '댓글·답글 좋아요' },
  { key: 'replies', label: '내 글 댓글·내 댓글 답글' },
  { key: 'direct_requests', label: '1:1 대화 요청·수락' },
  { key: 'messages', label: '새 메시지' },
  { key: 'meetups', label: '모임 가입 요청·승인' },
  { key: 'interests', label: '관심 태그의 새 글' },
  { key: 'nearby', label: '내 지역의 새로운 모임' },
  { key: 'trending', label: '내 도시에서 지금 뜨는 글' },
] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]['key'];
export type NotificationPreferences = Record<NotificationCategory, boolean> & {
  push_enabled: boolean;
  interest_tag_ids: number[];
  interest_hashtags: string[];
};

export async function loadNotificationPreferences(client: SupabaseClient): Promise<NotificationPreferences> {
  const { data, error } = await client.rpc('get_notification_preferences');
  if (error) throw error;
  return data;
}

export async function saveNotificationPreferences(client: SupabaseClient, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const { data, error } = await client.rpc('update_notification_preferences', { p_preferences: patch });
  if (error) throw error;
  return data;
}

// Notifications can navigate only to the app's known content destinations.
export function notificationRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (new RegExp(`^/chat\\?requestId=${uuid}$`, 'i').test(value)) return '/chat?view=requests';
  return new RegExp(`^(?:/post/${uuid}(?:\\?commentId=${uuid})?|/chat(?:\\?(?:conversationId=${uuid}(?:&view=requests)?|view=requests))?|/profile/(?:guidelines|settings)|/notifications)$`, 'i').test(value) ? value : null;
}

// 푸시 권한 창은 iOS 에서 평생 한 번뿐이다. 거절당하면 앱에서 다시 물을 수 없으므로
// 띄울지 말지를 한곳에서 판단한다. 하나라도 걸리면 묻지 않는다.
export function shouldInvitePush(state: {
  authed: boolean;
  configured: boolean;      // EAS projectId 가 있어야 기기 등록이 가능하다
  alreadyAsked: boolean;    // 이 기기에서 이미 물어봤다
  permissionGranted: boolean;
  pushEnabled: boolean;     // 서버 설정이 이미 켜져 있다
}) {
  return state.authed && state.configured && !state.alreadyAsked
    && !state.permissionGranted && !state.pushEnabled;
}
