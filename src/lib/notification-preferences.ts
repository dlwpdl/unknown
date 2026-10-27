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
  /** Categories whose push is off while the in-app row stays. Older servers omit it (= none muted). */
  push_muted: string[];
  message_preview: boolean;
  interest_tag_ids: number[];
  interest_hashtags: string[];
};

export const isAdminNotificationKind = (kind: string) => kind === 'safety_alert' || kind.startsWith('admin_');

function preferenceReadback(data: unknown): NotificationPreferences {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('NOTIFICATION_PREFERENCES_READ_FAILED');
  const row = data as NotificationPreferences;
  if (['merchant_updates', 'merchant_operations', 'account_security'].some(key => row[key as NotificationCategory] != null && typeof row[key as NotificationCategory] !== 'boolean')) throw new Error('NOTIFICATION_PREFERENCES_READ_FAILED');
  const muted = (row as { push_muted?: unknown }).push_muted;
  return { ...row, merchant_updates: row.merchant_updates ?? true, merchant_operations: row.merchant_operations ?? true, account_security: row.account_security ?? true,
    push_muted: Array.isArray(muted) ? muted.filter((key): key is string => typeof key === 'string') : [] };
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
export function notificationRoute(value: unknown, notification?: { kind?: unknown; category?: unknown; body?: unknown }): string | null {
  if (typeof value !== 'string') return null;
  // The retired weekly ranking screen now lives on Today.
  if (/^\/ranking(?:\?city=[a-z]+)?$/.test(value)) return '/';
  if (value === '/notifications' && (notification?.kind === 'trending_hashtag' || notification?.category === 'trending') && typeof notification.body === 'string') {
    const topic = /^(?:요즘 뜨는 해시태그 ·|요즘 관심이 모이는 주제예요\.?)\s*#([\p{L}\p{M}\p{N}_-]{1,64})$/u.exec(notification.body);
    if (topic) return `/?hashtag=${encodeURIComponent(topic[1])}`;
  }
  const topic = /^\/\?hashtag=([^&?#]+)$/.exec(value);
  if (topic) {
    try {
      const hashtag = decodeURIComponent(topic[1]);
      if (/^[\p{L}\p{M}\p{N}_-]{1,64}$/u.test(hashtag)) return `/?hashtag=${encodeURIComponent(hashtag)}`;
    } catch { /* Malformed topic links stay in the inbox. */ }
    return null;
  }
  const event = /^\/events\/([A-Za-z0-9_-]{1,100})\?cityId=([a-z]+)$/.exec(value);
  if (event && Object.hasOwn(EVENT_CITIES, event[2])) return value;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (new RegExp(`^/chat\\?conversationId=${uuid}&businessId=${uuid}$`, 'i').test(value)) return value;
  if (new RegExp(`^/chat\\?requestId=${uuid}$`, 'i').test(value)) return '/chat?view=requests';
  if (new RegExp(`^/company/${uuid}\\?review=(?:usage|employment)$`, 'i').test(value)) return value;
  if (new RegExp(`^/profile/merchant\\?merchant=${uuid}$`, 'i').test(value)) return value;
  // 관리자 알림 경로는 외부 대시보드 URL로 바꾸기 전에 검증한다.
  if (new RegExp(`^/admin(?:\\?(?:section=(?:alerts|analytics|conversations|errors|overview|posts|reports|safety|trending|users)|(?:safety|alert)=(?:${uuid}|[1-9][0-9]*)))?$`, 'i').test(value)) return value;
  return new RegExp(`^(?:/post/${uuid}(?:\\?commentId=${uuid})?|/chat(?:\\?(?:conversationId=${uuid}(?:&view=requests)?|view=requests))?|/profile/(?:guidelines|settings|meetup-reviews)|/notifications)$`, 'i').test(value) ? value : null;
}

export { englishNotificationBody } from './notification-copy.ts';

export function adminDashboardUrl(value: unknown, isAdmin: boolean, origin: string | null): string | null {
  if (!isAdmin || !origin) return null;
  const route = notificationRoute(value);
  if (!route?.startsWith('/admin')) return null;
  return `${origin}/${route.slice('/admin'.length)}`;
}

// The private dashboard host stays on the server; admins read it once per session.
const dashboardOrigins = new Map<string, Promise<string | null>>();
export function loadAdminDashboardOrigin(client: Pick<SupabaseClient, 'rpc'>, userId: string): Promise<string | null> {
  let origin = dashboardOrigins.get(userId);
  if (!origin) {
    origin = Promise.resolve(client.rpc('get_admin_dashboard_origin')).then(({ data, error }) => {
      if (error) throw error;
      return typeof data === 'string' && /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(data) ? data : null;
    });
    dashboardOrigins.set(userId, origin);
    origin.catch(() => dashboardOrigins.delete(userId));
  }
  return origin.catch(() => null);
}

/**
 * The one navigation path for bell rows and push taps. Returns false when the row has nowhere valid to go.
 * Admin routes open the private dashboard for admins, else the in-app /admin screen; non-admins never open them.
 */
export function openNotificationTarget({ route: value, notification, adminAccount, navigate, dashboardOrigin, openURL }: {
  route: unknown; notification?: { kind?: unknown; category?: unknown; body?: unknown }; adminAccount: boolean;
  navigate: (route: string) => void; dashboardOrigin: () => Promise<string | null>; openURL: (url: string) => Promise<unknown>;
}): boolean {
  const route = notificationRoute(value, notification);
  if (!route) return false;
  if (!route.startsWith('/admin')) { navigate(route); return true; }
  if (!adminAccount) return false;
  void dashboardOrigin().then(origin => {
    const url = adminDashboardUrl(route, true, origin);
    if (!url) { navigate(route); return; }
    return openURL(url).catch(() => navigate(route));
  });
  return true;
}

export type SettingRow = { id: string; label: string; description?: string; keys: NotificationCategory[]; locked?: boolean };
// Settings rows by group; each category appears once (direct_requests stays server-side only).
export const NOTIFICATION_SETTING_GROUPS: { id: 'mine' | 'city' | 'account'; rows: SettingRow[] }[] = [
  { id: 'mine', rows: [
    { id: 'replies', label: '댓글·답글', description: '내 글과 내 댓글에 달린 것', keys: ['replies'] },
    { id: 'likes', label: '좋아요', description: '한 글에 몇 명이 눌러도 한 번에 묶어서', keys: ['post_likes', 'comment_likes'] },
    { id: 'messages', label: '메시지', description: '단톡방은 1분 안에 온 건 하나로', keys: ['messages'] },
    { id: 'meetups', label: '모임', description: '신청·수락·일정 변경·하루 전 안내', keys: ['meetups'] },
    { id: 'business', label: '비즈니스', description: '후기·답변·게시 문제', keys: ['merchant_reviews', 'merchant_operations'] },
    { id: 'merchant_updates', label: '저장한 비즈니스 새 소식', description: '새 소식 받기를 켠 비즈니스만', keys: ['merchant_updates'] },
  ] },
  { id: 'city', rows: [
    { id: 'city_food', label: '맛집', keys: ['city_food'] },
    { id: 'city_places', label: '가볼 만한 곳·행사', keys: ['city_places'] },
    { id: 'trending', label: '지금 뜨는 글', keys: ['trending'] },
    { id: 'interests', label: '관심 태그 새 글', keys: ['interests'] },
    { id: 'nearby', label: '근처 새 모임', keys: ['nearby'] },
    { id: 'weekly_ranking', label: '이번 주 인기 글', description: '월요일에 한 번', keys: ['weekly_ranking'] },
  ] },
  { id: 'account', rows: [
    { id: 'account_security', label: '계정 보안', description: '새 기기 로그인·비밀번호 변경. 끌 수 없어요', keys: ['account_security'], locked: true },
  ] },
];

export function settingState(preferences: Pick<NotificationPreferences, NotificationCategory | 'push_enabled' | 'push_muted'>, row: SettingRow) {
  const app = !!row.locked || row.keys.every(key => preferences[key] !== false);
  const push = app && (!!row.locked || row.keys.every(key => !preferences.push_muted.includes(key)));
  return { app, push, pushDisabled: !!row.locked || !app || !preferences.push_enabled };
}

/** The exact patch a pill writes: app pills write the category booleans, push pills write only push_muted. */
export function settingPatch(preferences: Pick<NotificationPreferences, 'push_muted'>, row: SettingRow, channel: 'app' | 'push', value: boolean): Partial<NotificationPreferences> {
  if (row.locked) return {};
  if (channel === 'app') return Object.fromEntries(row.keys.map(key => [key, value])) as Partial<NotificationPreferences>;
  const others = preferences.push_muted.filter(key => !(row.keys as string[]).includes(key));
  return { push_muted: value ? others : [...others, ...row.keys] };
}

export const PUSH_PROMPT_EVENT = 'pushPromptRequested';
export type PushPromptReason = 'comment' | 'post' | 'meetup_request' | 'meetup_create';
export const PUSH_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
/** Whether a contextual push sheet may open: not snoozed by "나중에", this reason not asked before, and the OS can still ask. */
export function pushPromptAllowed(state: { authed: boolean; configured: boolean; snoozedAt: string | null; askedReasons: string[]; reason: PushPromptReason; permissionGranted: boolean; canAsk: boolean; now: number }) {
  const snoozed = !!state.snoozedAt && state.now - Date.parse(state.snoozedAt) < PUSH_PROMPT_SNOOZE_MS;
  return shouldInvitePush({ authed: state.authed, configured: state.configured, alreadyAsked: snoozed || state.askedReasons.includes(state.reason), permissionGranted: state.permissionGranted })
    && state.canAsk;
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
