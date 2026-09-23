import type {
  AdminConversation,
  AdminMessage,
  AdminModerationAction,
  AdminPost,
  AdminProfile,
  AdminReport,
  AdminSafetyAlert,
} from '@/lib/admin-data';

// 운영 콘솔은 사람을 ID로 보여주지 않는다. 목록·필터·상세가 전부 이 규칙을 쓴다.
// 프로필을 못 찾는 경우는 최신 50건 창 밖이거나 실제로 사라진 계정이므로 ID를 보조 정보로 남긴다.

export const UNKNOWN_NAME = '—';

export function shortId(value: string) {
  return value.slice(0, 8);
}

type ProfileName = Pick<AdminProfile, 'nickname'> & Partial<Pick<AdminProfile, 'account_status' | 'deleted_at'>>;

export function isGone(profile: ProfileName | undefined) {
  return !!profile && (!!profile.deleted_at || profile.account_status === 'deleted');
}

export function displayName(profile: ProfileName | undefined, id: string | null | undefined) {
  if (!id) return UNKNOWN_NAME;
  if (!profile) return `이름 미확인 · ${shortId(id)}`;
  if (isGone(profile)) return `탈퇴한 회원 · ${shortId(id)}`;
  const nickname = profile.nickname?.trim();
  return nickname || `이름 없음 · ${shortId(id)}`;
}

export function displaySubtitle(profile: ProfileName | undefined, id: string | null | undefined) {
  if (!id) return '';
  if (isGone(profile)) return `탈퇴 · ${shortId(id)}`;
  return shortId(id);
}

export function conversationLabel(
  conversation: Pick<AdminConversation, 'id' | 'user_low_id' | 'user_high_id' | 'group_post_id'>,
  profiles: Map<string, AdminProfile>,
  posts: AdminPost[] = [],
): { primary: string; secondary: string } {
  const lowId = conversation.user_low_id;
  const highId = conversation.user_high_id;
  const low = lowId ? displayName(profiles.get(lowId), lowId) : null;
  const high = highId ? displayName(profiles.get(highId), highId) : null;
  const post = conversation.group_post_id ? posts.find((row) => row.id === conversation.group_post_id) : undefined;

  if (post) return { primary: `모임 · ${post.title}`, secondary: `모임 대화 · ${shortId(conversation.id)}` };
  if (conversation.group_post_id) return { primary: '모임 대화', secondary: shortId(conversation.id) };
  if (low && high) return { primary: `${low} ↔ ${high}`, secondary: `1:1 · ${shortId(conversation.id)}` };
  if (low || high) return { primary: (low ?? high) as string, secondary: `1:1 · ${shortId(conversation.id)}` };
  return { primary: `대화 ${shortId(conversation.id)}`, secondary: '참여자 기록 없음' };
}

// 앱 UA는 HTTP 헤더 규칙 때문에 한글 앱 이름을 퍼센트 인코딩해 보낸다(예: %EA%B8%80%EB%A7%81심사).
// 저장값은 그대로 두고 화면에서만 되돌린다.
export function decodeUserAgent(value: string | null | undefined) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%[0-9A-Fa-f]{2}/g, (token) => {
      try { return decodeURIComponent(token); } catch { return token; }
    });
  }
}

// 목록에 실제로 뜬 사람의 이름을 찾기 위한 조회 대상. 대시보드가 프로필을 최신 50건만 들고 오기 때문에,
// 그 창 밖의 작성자는 닉네임을 못 찾아 ID로 보인다. 표시하는 행의 ID만 따로 받아온다.
export function referencedUserIds(data: {
  reports?: Pick<AdminReport, 'reporter_id' | 'reported_user_id'>[];
  posts?: Pick<AdminPost, 'author_id'>[];
  messages?: Pick<AdminMessage, 'sender_id'>[];
  conversations?: Pick<AdminConversation, 'user_low_id' | 'user_high_id'>[];
  alerts?: Pick<AdminSafetyAlert, 'author_id' | 'reviewed_by'>[];
  actions?: Pick<AdminModerationAction, 'actor_id'>[];
}) {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => { if (id) ids.add(id); };
  for (const report of data.reports ?? []) { add(report.reporter_id); add(report.reported_user_id); }
  for (const post of data.posts ?? []) add(post.author_id);
  for (const message of data.messages ?? []) add(message.sender_id);
  for (const conversation of data.conversations ?? []) { add(conversation.user_low_id); add(conversation.user_high_id); }
  for (const alert of data.alerts ?? []) { add(alert.author_id); add(alert.reviewed_by); }
  for (const action of data.actions ?? []) add(action.actor_id);
  return [...ids];
}
