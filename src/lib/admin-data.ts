import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdminSection, ReportStatus } from '@/lib/admin';
import { MOCK_POSTS } from '@/lib/mock';

export const ADMIN_PAGE_SIZE = 50;

export type AdminProfile = {
  id: string;
  nickname: string;
  city_id: string | null;
  neighborhood: string | null;
  bio: string | null;
  verification_level: number;
  account_status: 'active' | 'suspended' | 'deleted' | 'reactivation_pending';
  account_status_note: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type AdminPost = {
  id: string;
  author_id: string;
  city_id: string;
  title: string;
  body: string;
  status: 'published' | 'removed';
  created_at: string;
};

export type AdminComment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  deleted_at: string | null;
  created_at: string;
};

export type AdminConversation = {
  id: string;
  user_low_id: string;
  user_high_id: string;
  created_at: string;
};

export type AdminMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type AdminReport = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  target_type: 'user' | 'post' | 'comment' | 'message';
  target_id: string;
  reason_code: string;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
};

export type AdminModerationAction = {
  id: string;
  report_id: string;
  actor_id: string;
  action: 'dismissed' | 'warned' | 'blocked';
  note: string | null;
  created_at: string;
};

export type AdminSafetyReview = {
  id: number;
  target_type: 'post' | 'comment' | 'message';
  target_id: string;
  status: 'pending' | 'processing' | 'reviewed' | 'failed';
  risk_score: number | null;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | null;
  risk_reasons: string[];
  attempts: number;
  last_error: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type AdminCounts = {
  reports: number;
  openReports: number;
  profiles: number;
  posts: number;
  messages: number;
  safetyPending: number;
  safetyHigh: number;
};

export type AdminDashboardData = {
  counts: AdminCounts;
  profiles: AdminProfile[];
  posts: AdminPost[];
  conversations: AdminConversation[];
  messages: AdminMessage[];
  reports: AdminReport[];
  moderationActions: AdminModerationAction[];
  safetyReviews: AdminSafetyReview[];
};

export type AdminUserActivity = {
  profile: AdminProfile;
  posts: AdminPost[];
  comments: AdminComment[];
  conversations: AdminConversation[];
  messages: AdminMessage[];
  reports: AdminReport[];
};

export type AdminSectionPage =
  | { section: 'safety'; rows: AdminSafetyReview[] }
  | { section: 'reports'; rows: AdminReport[] }
  | { section: 'users'; rows: AdminProfile[] }
  | { section: 'posts'; rows: AdminPost[] }
  | { section: 'conversations'; rows: AdminMessage[] };

export function getLocalAdminDashboard(): AdminDashboardData {
  const profiles = [...new Map(MOCK_POSTS.map(({ author }) => [author.id, author])).values()].map(
    (author, index): AdminProfile => ({
      id: author.id,
      nickname: author.nickname,
      city_id: 'vancouver',
      neighborhood: author.neighborhood ?? null,
      bio: null,
      verification_level: author.trustLevel ?? (author.verified ? 2 : 1),
      account_status: 'active',
      account_status_note: null,
      deleted_at: null,
      created_at: new Date(Date.UTC(2026, 7, 26, 16, index)).toISOString(),
    }),
  );
  const posts = MOCK_POSTS.map(
    (post, index): AdminPost => ({
      id: post.id,
      author_id: post.author.id,
      city_id: post.cityId,
      title: post.title,
      body: post.body,
      status: 'published',
      created_at: new Date(Date.UTC(2026, 7, 26, 18 - index)).toISOString(),
    }),
  );

  return {
    counts: { reports: 0, openReports: 0, profiles: profiles.length, posts: posts.length, messages: 0, safetyPending: 0, safetyHigh: 0 },
    profiles,
    posts,
    conversations: [],
    messages: [],
    reports: [],
    moderationActions: [],
    safetyReviews: [],
  };
}

export function getLocalAdminUserActivity(data: AdminDashboardData, userId: string): AdminUserActivity | null {
  const profile = data.profiles.find(({ id }) => id === userId);
  if (!profile) return null;
  const conversations = data.conversations.filter(
    ({ user_low_id, user_high_id }) => user_low_id === userId || user_high_id === userId,
  );
  const conversationIds = new Set(conversations.map(({ id }) => id));
  return {
    profile,
    posts: data.posts.filter(({ author_id }) => author_id === userId),
    comments: [],
    conversations,
    messages: data.messages.filter(({ conversation_id }) => conversationIds.has(conversation_id)),
    reports: data.reports.filter(({ reported_user_id }) => reported_user_id === userId),
  };
}

function dataOrThrow<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error('ADMIN_DATA_MISSING');
  return result.data;
}

export async function logAdminAccess(
  client: SupabaseClient,
  scope: string,
  subjectUserId: string | null = null,
  resourceId: string | null = null,
) {
  const { error } = await client.rpc('log_admin_access', {
    scope,
    subject_user_id: subjectUserId,
    resource_id: resourceId,
  });
  if (error) throw new Error(error.message);
}

export async function loadAdminDashboard(client: SupabaseClient): Promise<AdminDashboardData> {
  await logAdminAccess(client, 'dashboard');

  const [reports, profiles, posts, conversations, messages, actions, safety, reportCount, openCount, profileCount, postCount, messageCount, safetyPending, safetyHigh] =
    await Promise.all([
      client.from('reports').select('*').order('created_at', { ascending: false }).limit(ADMIN_PAGE_SIZE),
      client.from('profiles').select('*').order('created_at', { ascending: false }).limit(ADMIN_PAGE_SIZE),
      client.from('posts').select('*').order('created_at', { ascending: false }).limit(ADMIN_PAGE_SIZE),
      client.from('conversations').select('*').order('created_at', { ascending: false }).limit(ADMIN_PAGE_SIZE),
      client.from('messages').select('*').order('created_at', { ascending: false }).limit(ADMIN_PAGE_SIZE),
      client.from('moderation_actions').select('*').order('created_at', { ascending: false }).limit(ADMIN_PAGE_SIZE),
      client.from('safety_review_queue').select('*').order('created_at', { ascending: false }).limit(ADMIN_PAGE_SIZE),
      client.from('reports').select('*', { count: 'exact', head: true }),
      client.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      client.from('profiles').select('*', { count: 'exact', head: true }),
      client.from('posts').select('*', { count: 'exact', head: true }),
      client.from('messages').select('*', { count: 'exact', head: true }),
      client.from('safety_review_queue').select('*', { count: 'exact', head: true }).in('status', ['pending', 'processing', 'failed']),
      client.from('safety_review_queue').select('*', { count: 'exact', head: true }).in('risk_level', ['high', 'critical']),
    ]);

  return {
    counts: {
      reports: reportCount.count ?? 0,
      openReports: openCount.count ?? 0,
      profiles: profileCount.count ?? 0,
      posts: postCount.count ?? 0,
      messages: messageCount.count ?? 0,
      safetyPending: safetyPending.count ?? 0,
      safetyHigh: safetyHigh.count ?? 0,
    },
    reports: dataOrThrow<AdminReport[]>(reports),
    profiles: dataOrThrow<AdminProfile[]>(profiles),
    posts: dataOrThrow<AdminPost[]>(posts),
    conversations: dataOrThrow<AdminConversation[]>(conversations),
    messages: dataOrThrow<AdminMessage[]>(messages),
    moderationActions: dataOrThrow<AdminModerationAction[]>(actions),
    safetyReviews: dataOrThrow<AdminSafetyReview[]>(safety),
  };
}

export async function loadAdminUserActivity(client: SupabaseClient, userId: string): Promise<AdminUserActivity> {
  await logAdminAccess(client, 'user_detail', userId);

  const [profile, posts, comments, conversations, reports] = await Promise.all([
    client.from('profiles').select('*').eq('id', userId).single(),
    client.from('posts').select('*').eq('author_id', userId).order('created_at', { ascending: false }).limit(100),
    client.from('comments').select('*').eq('author_id', userId).order('created_at', { ascending: false }).limit(100),
    client
      .from('conversations')
      .select('*')
      .or(`user_low_id.eq.${userId},user_high_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(100),
    client.from('reports').select('*').eq('reported_user_id', userId).order('created_at', { ascending: false }).limit(100),
  ]);
  const conversationRows = dataOrThrow<AdminConversation[]>(conversations);
  const conversationIds = conversationRows.map(({ id }) => id);
  const messages = conversationIds.length
    ? await client
        .from('messages')
        .select('*')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })
        .limit(500)
    : { data: [] as AdminMessage[], error: null };

  return {
    profile: dataOrThrow<AdminProfile>(profile),
    posts: dataOrThrow<AdminPost[]>(posts),
    comments: dataOrThrow<AdminComment[]>(comments),
    conversations: conversationRows,
    messages: dataOrThrow<AdminMessage[]>(messages),
    reports: dataOrThrow<AdminReport[]>(reports),
  };
}

export async function loadMoreAdminData(
  client: SupabaseClient,
  section: Exclude<AdminSection, 'overview'>,
  offset: number,
): Promise<AdminSectionPage> {
  await logAdminAccess(client, section === 'conversations' ? 'messages' : section);
  const last = offset + ADMIN_PAGE_SIZE - 1;

  if (section === 'safety') {
    const result = await client.from('safety_review_queue').select('*').order('created_at', { ascending: false }).range(offset, last);
    return { section, rows: dataOrThrow<AdminSafetyReview[]>(result) };
  }

  if (section === 'reports') {
    const result = await client.from('reports').select('*').order('created_at', { ascending: false }).range(offset, last);
    return { section, rows: dataOrThrow<AdminReport[]>(result) };
  }
  if (section === 'users') {
    const result = await client.from('profiles').select('*').order('created_at', { ascending: false }).range(offset, last);
    return { section, rows: dataOrThrow<AdminProfile[]>(result) };
  }
  if (section === 'posts') {
    const result = await client.from('posts').select('*').order('created_at', { ascending: false }).range(offset, last);
    return { section, rows: dataOrThrow<AdminPost[]>(result) };
  }

  const result = await client.from('messages').select('*').order('created_at', { ascending: false }).range(offset, last);
  return { section, rows: dataOrThrow<AdminMessage[]>(result) };
}

export async function moderateAdminReport(
  client: SupabaseClient,
  reportId: string,
  action: 'dismissed' | 'warned' | 'blocked',
  note: string,
) {
  const { error } = await client.rpc('moderate_report', {
    p_report_id: reportId,
    p_action: action,
    p_note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function setAdminAccountStatus(
  client: SupabaseClient,
  userId: string,
  status: 'active' | 'suspended' | 'reactivation_pending',
  note = '',
) {
  const { error } = await client.rpc('set_account_status', {
    p_user_id: userId,
    p_status: status,
    p_note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
}
