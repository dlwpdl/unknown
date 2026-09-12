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
