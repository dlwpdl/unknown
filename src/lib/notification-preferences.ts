import type { SupabaseClient } from '@supabase/supabase-js';
import { EVENT_CITIES } from '../../supabase/functions/_shared/ticketmaster.ts';

export const NOTIFICATION_PREFERENCES_CHANGED = 'notificationPreferencesChanged';

export const NOTIFICATION_CATEGORIES = [
  { key: 'post_likes', label: '내 글 좋아요' },
  { key: 'comment_likes', label: '댓글·답글 좋아요' },
  { key: 'replies', label: '내 글 댓글·내 댓글 답글' },
  { key: 'direct_requests', label: '과거 1:1 요청 알림' },
  { key: 'messages', label: '새 메시지' },
  { key: 'meetups', label: '모임 신청·승인·일정' },
  { key: 'merchant_reviews', label: '비즈니스 후기·인증·답변' },
  { key: 'interests', label: '관심 태그의 새 글' },
  { key: 'nearby', label: '내 지역의 새로운 모임' },
  { key: 'city_food', label: '내 도시의 맛집·레스토랑' },
  { key: 'city_places', label: '내 도시의 가볼 만한 곳·행사' },
  { key: 'trending', label: '내 도시에서 지금 뜨는 글' },
  { key: 'weekly_ranking', label: '주간 인기 글 순위' },
  { key: 'merchant_updates', label: '저장한 비즈니스 새 소식' },
  { key: 'merchant_operations', label: '비즈니스 게시·연결 문제' },
  { key: 'account_security', label: '계정 보안' },
] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]['key'];
export type NotificationPreferences = Record<NotificationCategory, boolean> & {
  push_enabled: boolean;
  message_preview: boolean;
  interest_tag_ids: number[];
  interest_hashtags: string[];
};

export const isAdminNotificationKind = (kind: string) => kind === 'safety_alert' || kind.startsWith('admin_');

function preferenceReadback(data: unknown): NotificationPreferences {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('NOTIFICATION_PREFERENCES_READ_FAILED');
  const row = data as NotificationPreferences;
  if (['merchant_updates', 'merchant_operations', 'account_security'].some(key => row[key as NotificationCategory] != null && typeof row[key as NotificationCategory] !== 'boolean')) throw new Error('NOTIFICATION_PREFERENCES_READ_FAILED');
  return { ...row, merchant_updates: row.merchant_updates ?? true, merchant_operations: row.merchant_operations ?? true, account_security: row.account_security ?? true };
}

export async function loadNotificationPreferences(client: SupabaseClient): Promise<NotificationPreferences> {
  const { data, error } = await client.rpc('get_notification_preferences');
  if (error) throw error;
  return preferenceReadback(data);
}

export async function saveNotificationPreferences(client: SupabaseClient, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const { data, error } = await client.rpc('update_notification_preferences', { p_preferences: patch });
  if (error) throw error;
  return preferenceReadback(data);
}

// Notifications can navigate only to the app's known content destinations.
export function notificationRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const event = /^\/events\/([A-Za-z0-9_-]{1,100})\?cityId=([a-z]+)$/.exec(value);
  if (event && Object.hasOwn(EVENT_CITIES, event[2])) return value;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (new RegExp(`^/chat\\?requestId=${uuid}$`, 'i').test(value)) return '/chat?view=requests';
  if (new RegExp(`^/company/${uuid}\\?review=(?:usage|employment)$`, 'i').test(value)) return value;
  if (new RegExp(`^/profile/merchant\\?merchant=${uuid}$`, 'i').test(value)) return value;
  // 관리자 알림 경로는 외부 대시보드 URL로 바꾸기 전에 검증한다.
  if (new RegExp(`^/admin(?:\\?(?:section=(?:alerts|analytics|errors|overview|posts|reports|safety|trending|users)|(?:safety|alert)=(?:${uuid}|[1-9][0-9]*)))?$`, 'i').test(value)) return value;
  return new RegExp(`^(?:/post/${uuid}(?:\\?commentId=${uuid})?|/chat(?:\\?(?:conversationId=${uuid}(?:&view=requests)?|view=requests))?|/profile/(?:guidelines|settings)|/notifications)$`, 'i').test(value) ? value : null;
}

export function adminDashboardUrl(value: unknown, isAdmin: boolean): string | null {
  if (!isAdmin) return null;
  const route = notificationRoute(value);
  if (!route?.startsWith('/admin')) return null;
  return `https://cayden-macbookpro.tailb6648f.ts.net/${route.slice('/admin'.length)}`;
}

// 푸시 권한 창은 iOS 에서 평생 한 번뿐이다. 거절당하면 앱에서 다시 물을 수 없으므로
// 띄울지 말지를 한곳에서 판단한다. 하나라도 걸리면 묻지 않는다.
export function shouldInvitePush(state: {
  authed: boolean;
  configured: boolean;      // EAS projectId 가 있어야 기기 등록이 가능하다
  alreadyAsked: boolean;    // 이 기기에서 이미 물어봤다
  permissionGranted: boolean;
}) {
  return state.authed && state.configured && !state.alreadyAsked
    && !state.permissionGranted;
}
