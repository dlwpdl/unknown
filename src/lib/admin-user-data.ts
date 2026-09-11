import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminProfile } from '@/lib/admin-data';

export const ACTIVITY_KINDS = {
  all: '전체', account: '계정', post: '게시글', comment: '댓글', message: '보낸 메시지',
  conversation: '관련 대화', report: '신고', moderation: '관리자 조치', meetup: '모임 신청',
  reaction: '공감·저장', view: '글 조회', block: '차단', visit: '접속 집계', payment: '결제', safety: '안전 검토',
} as const;
export type ActivityKind = keyof typeof ACTIVITY_KINDS;
export type AdminDirectoryProfile = AdminProfile & {
  email: string | null; login_name: string | null; email_confirmed_at: string | null;
  session_ip: string | null; session_created_at: string | null; session_updated_at: string | null;
  last_sign_in_at: string | null; auth_role: string; providers: string[];
  account_type: 'example' | 'admin' | 'review' | 'member';
};
export const ACCOUNT_TYPES = { example: '예시 계정', admin: '관리자', review: '심사 계정', member: '회원' };
export type AdminUserDirectory = {
  rows: AdminDirectoryProfile[]; total: number; viewer: { id: string; email: string | null; role: string };
};
export type AdminUserOverview = {
  profile: AdminDirectoryProfile; identity_verified: false; date_of_birth: null; age: null; generatedAt: string;
  identities: { provider: string; provider_id: string; created_at: string; last_sign_in_at: string | null }[];
  counts: { kind: Exclude<ActivityKind, 'all'>; count: number }[];
};
export type AdminActivityRow = {
  event_key: string; kind: Exclude<ActivityKind, 'all'>; occurred_at: string; actor_id: string | null;
  title: string; body: string | null; context_id: string | null; state: string | null;
};
export type ActivityCursor = { at: string; key: string };
export type AdminActivityPage = { rows: AdminActivityRow[]; total: number; nextCursor: ActivityCursor | null; generatedAt: string };
export type ActivityFilters = { kind: ActivityKind; from: string; until: string; query: string; conversationId: string | null };
export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = { kind: 'all', from: '', until: '', query: '', conversationId: null };

export function activityParams(userId: string, filters: ActivityFilters, cursor: ActivityCursor | null = null) {
  const day = (value: string, next = false) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
      || date.getFullYear() !== Number(value.slice(0, 4)) || date.getMonth() + 1 !== Number(value.slice(5, 7))
      || date.getDate() !== Number(value.slice(8, 10))) throw new Error('날짜를 YYYY-MM-DD 형식으로 확인해주세요.');
    if (next) date.setDate(date.getDate() + 1);
    return date.toISOString();
  };
  const from = day(filters.from), until = day(filters.until, true);
  if (from && until && from >= until) throw new Error('조회 기간의 시작일과 종료일을 확인해주세요.');
  return {
    p_user_id: userId, p_kind: filters.kind, p_from: from, p_until: until, p_query: filters.query.trim(),
    p_before: cursor?.at ?? null, p_before_key: cursor?.key ?? null, p_conversation_id: filters.conversationId,
  };
}

export function mergeActivityRows<T extends { event_key: string }>(current: T[], next: T[]): T[] {
  return [...new Map([...current, ...next].map((row) => [row.event_key, row])).values()];
}

export async function searchAdminUsers(client: SupabaseClient, query = '', offset = 0): Promise<AdminUserDirectory> {
  const { data, error } = await client.rpc('search_admin_users', { p_query: query.trim(), p_offset: offset });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data;
}

export async function loadAdminUserOverview(client: SupabaseClient, userId: string): Promise<AdminUserOverview> {
  const { data, error } = await client.rpc('get_admin_user_overview', { p_user_id: userId });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data;
}

export async function loadAdminUserActivityPage(client: SupabaseClient, userId: string, filters: ActivityFilters, cursor: ActivityCursor | null = null): Promise<AdminActivityPage> {
  const { data, error } = await client.rpc('get_admin_user_activity', activityParams(userId, filters, cursor));
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data;
}
