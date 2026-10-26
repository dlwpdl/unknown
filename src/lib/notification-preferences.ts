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
export function notificationRoute(value: unknown, notification?: { kind?: unknown; category?: unknown; body?: unknown }): string | null {
  if (typeof value !== 'string') return null;
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

type Translate = (text: string, ...values: unknown[]) => string;
const monthDay = (month: string, day: string, time?: [string, string]) => new Intl.DateTimeFormat('en-CA', time
  ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' })
  .format(new Date(2000, Number(month) - 1, Number(day), Number(time?.[0] ?? 0), Number(time?.[1] ?? 0)));
const clock = (hour: string, minute: string) => new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, Number(hour), Number(minute)));
// Event kinds written by private.festival_notification_body.
const EVENT_KINDS: Record<string, string> = {
  '록 공연': 'a rock concert', '팝 공연': 'a pop concert', '재즈 공연': 'a jazz show', '힙합 공연': 'a hip-hop show', '전자음악 공연': 'an electronic music show',
  '클래식 공연': 'a classical concert', '컨트리 공연': 'a country concert', '메탈 공연': 'a metal show', '포크 공연': 'a folk show', '레게 공연': 'a reggae show', '음악 공연': 'a concert',
  '농구 경기': 'a basketball game', '아이스하키 경기': 'a hockey game', '야구 경기': 'a baseball game', '축구 경기': 'a soccer game', '미식축구 경기': 'a football game',
  '테니스 경기': 'a tennis match', '스포츠 경기': 'a sports game', '코미디 공연': 'a comedy show', '연극 공연': 'a play', '무용 공연': 'a dance performance', '공연': 'a show',
  '영화 상영 행사': 'a film screening', '할로윈 행사': 'a Halloween event', '영상 소개 행사': 'a video screening', '행사': 'an event',
};
type Pattern = [RegExp, (match: string[], translate: Translate) => string | null];
const eventPattern: Pattern = [/^(?:(\d{1,2})월 (\d{1,2})일, )?(?:(.+)에서 )?(?:(\d{1,2})월 (\d{1,2})일에 )?(.+?)[이가] (?:열려요|열릴 예정이에요)\.$/, (m, translate) => {
  const what = EVENT_KINDS[m[6]];
  if (!what) return null;
  const month = m[1] ?? m[4], day = m[2] ?? m[5];
  // The server falls back to the Korean city name when a venue is missing or too long.
  const place = m[3] && (translate(m[3]) !== m[3] ? ` in ${translate(m[3])}` : ` at ${m[3]}`);
  return `There’s ${what}${place ?? ''}${month ? ` on ${monthDay(month, day)}` : place ? '' : ' coming up'}.`;
}];
// shortcut: these mirror the final server copy (migrations); a server copy edit falls back to tr(body) until updated here.
const NOTIFICATION_PATTERNS: Record<string, Pattern[]> = {
  comment: [[/^(.+)님이 내 글에 댓글을 남겼어요\.$/, m => `${m[1]} commented on your post.`]],
  reply: [[/^(.+)님이 내 댓글에 답글을 남겼어요\.$/, m => `${m[1]} replied to your comment.`]],
  comment_like: [[/^(.+)님이 내 댓글에 공감했어요\.$/, m => `${m[1]} liked your comment.`]],
  post_like: [[/^(.+)님이 내 글에 공감했어요\.$/, m => `${m[1]} liked your post.`]],
  meetup_reminder: [
    [/^(.+) 모임이 24시간 뒤에 시작해요\. \((\d{2})\/(\d{2}) (\d{2}):(\d{2}) · 모임 장소 기준\)$/, m => `“${m[1]}” starts in 24 hours (${monthDay(m[2], m[3], [m[4], m[5]])}, local time).`],
    [/^(.+) 모임이 1시간 뒤에 시작해요\.$/, m => `“${m[1]}” starts in an hour.`],
  ],
  meetup_morning: [[/^(.+) 모임은 오늘 (\d{2}):(\d{2})에 시작해요\. \(모임 장소 기준\)$/, m => `“${m[1]}” starts today at ${clock(m[2], m[3])} local time.`]],
  meetup_cancelled: [[/^(.+) 모임이 마감되거나 취소됐어요\. 모임 글에서 확인해 주세요\.$/, m => `“${m[1]}” was closed or cancelled. Check the meetup post for details.`]],
  meetup_changed: [[/^(.+) 모임의 시간이나 장소가 바뀌었어요\. 바뀐 내용을 확인해 주세요\.$/, m => `The time or place for “${m[1]}” changed. Check the updated details.`]],
  trending_post: [[/^오늘 (.+?) 소식, 같이 읽어볼까요\? (.+)$/, (m, translate) => `Today in ${translate(m[1])}: ${m[2]}`], eventPattern],
  city_places: [eventPattern],
  trending_hashtag: [[/^(?:요즘 관심이 모이는 주제예요\.?|요즘 뜨는 해시태그 ·)\s*(#[\p{L}\p{M}\p{N}_-]{1,64})$/u, m => `Trending near you: ${m[1]}`]],
  admin_meetup_request: [[/^(.+)님이 운영 모임 「(.+)」에 참여를 신청했어요\.$/, m => `${m[1]} asked to join the Gling-run meetup “${m[2]}”.`]],
  admin_signup: [[/^(.+?)님이 (.+)에 새로 가입했어요\.$/, (m, translate) => `${m[1]} just joined in ${translate(m[2])}.`]],
  admin_multiacct: [[/^같은 IP로 (\d+)개 계정이 접속했어요\. 관리자 화면에서 확인해 주세요\.$/, m => `${m[1]} accounts signed in from the same IP. Check the admin dashboard.`]],
  admin_security: [[/^최근 10분 동안 요청이 (\d+)건 들어왔어요\. 관리자 화면에서 확인해 주세요\.$/, m => `${m[1]} requests from one account in the last 10 minutes. Check the admin dashboard.`]],
};

// English inbox copy for server-written Korean bodies; stored rows (and routing above) keep the Korean text.
export function englishNotificationBody(item: { kind: string; body: string }, translate: Translate, actorName?: string) {
  if (item.kind === 'message_reaction' && actorName) return `${actorName} loved your message.`;
  for (const [pattern, render] of NOTIFICATION_PATTERNS[item.kind] ?? []) {
    const match = pattern.exec(item.body);
    const text = match && render(match, translate);
    if (text) return text;
  }
  return translate(item.body);
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
