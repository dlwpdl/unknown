import type { SupabaseClient } from '@supabase/supabase-js';

import { attachSignedPostImages, loadPublicPost, mapPublicFeed, type FeedCursor, type PublicCommentRow, type PublicFeedRow } from './feed-data.ts';
import type { DailyQuota, Post, PostComment, Tag } from './types.ts';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const POST_QUOTA_CHANGED_EVENT = 'postQuotaChanged';

export type PostDraftImage = { base64: string; mimeType: string };
export type ReportTarget = 'user' | 'post' | 'comment' | 'message';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'sexual' | 'privacy' | 'other';

export type ConversationPreview = {
  id: string;
  otherUser: { id: string; nickname: string; verificationLevel: number };
  latestBody: string | null;
  latestAt: string;
};

export type ChatMessageRecord = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type AppNotification = {
  id: string;
  kind: string;
  body: string;
  route: string | null;
  read_at: string | null;
  created_at: string;
};

export type MeetupRequest = {
  id: string;
  post_id: string;
  requester_id: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
  requester: { nickname: string; verification_level: number } | null;
  post: { title: string } | null;
};

export type ProfileSummary = {
  cityId: string;
  neighborhood: string | null;
  posts: number;
  likes: number;
  meetups: number;
};

export function buildPostImagePath(userId: string, mimeType: string, stamp = Date.now()) {
  const extension = IMAGE_EXTENSIONS[mimeType];
  if (!extension) throw new Error('UNSUPPORTED_IMAGE_TYPE');
  return `${userId}/${stamp}.${extension}`;
}

export async function createCommunityPost(
  client: SupabaseClient,
  input: {
    userId: string;
    cityId: string;
    tag: Tag;
    title: string;
    body: string;
    hashtags: string[];
    image?: PostDraftImage;
  },
): Promise<Post> {
  let imagePath: string | null = null;
  if (input.image) {
    imagePath = buildPostImagePath(input.userId, input.image.mimeType);
    const upload = await client.storage.from('post-images').upload(
      imagePath,
      decodeBase64(input.image.base64),
      { contentType: input.image.mimeType, upsert: false },
    );
    if (upload.error) throw upload.error;
  }

  const created = await client.rpc('create_post', {
    p_city_id: input.cityId,
    p_tag_id: input.tag.id,
    p_title: input.title,
    p_body: input.body,
    p_hashtags: input.hashtags,
    p_image_paths: imagePath ? [imagePath] : [],
    p_room_preview: null,
  });
  if (created.error) {
    if (imagePath) await client.storage.from('post-images').remove([imagePath]);
    throw created.error;
  }

  const post = await loadPublicPost(client, created.data as string);
  if (!post) throw new Error('CREATED_POST_NOT_FOUND');
  return post;
}

export async function loadDailyQuota(client: SupabaseClient): Promise<DailyQuota> {
  const result = await client.rpc('get_post_quota');
  if (result.error) throw result.error;
  const row = (result.data as { used_count: number; max_count: number }[] | null)?.[0];
  if (!row) throw new Error('POST_QUOTA_NOT_FOUND');
  return { used: row.used_count, max: row.max_count };
}

export async function togglePostReaction(
  client: SupabaseClient,
  postId: string,
  userId: string,
  kind: 'like' | 'save',
  isOn: boolean,
) {
  const result = isOn
    ? await client.from('post_reactions').delete().match({ post_id: postId, user_id: userId, kind })
    : await client.from('post_reactions').insert({ post_id: postId, user_id: userId, kind });
  if (result.error) throw result.error;
  return !isOn;
}

export async function addPostComment(client: SupabaseClient, postId: string, userId: string, body: string) {
  void userId;
  const result = await client.rpc('create_comment', { p_post_id: postId, p_body: body.trim() });
  if (result.error) throw result.error;
  return { id: result.data as string, created_at: new Date().toISOString() };
}

export async function toggleCommentReaction(
  client: SupabaseClient,
  commentId: string,
  userId: string,
  isOn: boolean,
) {
  const result = isOn
    ? await client.from('comment_likes').delete().match({ comment_id: commentId, user_id: userId })
    : await client.from('comment_likes').insert({ comment_id: commentId, user_id: userId });
  if (result.error) throw result.error;
  return !isOn;
}

export async function recordPostView(client: SupabaseClient, postId: string) {
  const result = await client.rpc('record_post_view', { post_id: postId });
  if (result.error) throw result.error;
}

export async function recordPostShare(client: SupabaseClient, postId: string) {
  const result = await client.rpc('record_post_share', { p_post_id: postId });
  if (result.error) throw result.error;
  return result.data as number;
}

export async function reportContent(
  client: SupabaseClient,
  targetType: ReportTarget,
  targetId: string,
  reason: ReportReason,
  details: string,
) {
  const result = await client.rpc('create_report', {
    target_type: targetType,
    target_id: targetId,
    reason_code: reason,
    details: details.trim() || null,
  });
  if (result.error) throw result.error;
  return result.data as string;
}

export async function blockUser(client: SupabaseClient, userId: string, blockedUserId: string) {
  const result = await client.from('blocks').upsert(
    { blocker_id: userId, blocked_id: blockedUserId },
    { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
  );
  if (result.error) throw result.error;
}

export async function startDirectConversation(
  client: SupabaseClient,
  otherUserId: string,
  initialMessage?: string,
) {
  const conversation = await client.rpc('start_conversation', { other_user_id: otherUserId });
  if (conversation.error) throw conversation.error;
  const conversationId = conversation.data as string;
  if (initialMessage?.trim()) await sendDirectMessage(client, conversationId, initialMessage);
  return conversationId;
}

export async function sendDirectMessage(client: SupabaseClient, conversationId: string, body: string) {
  const result = await client.rpc('send_message', {
    conversation_id: conversationId,
    message_body: body.trim(),
  });
  if (result.error) throw result.error;
  return result.data as string;
}

export async function loadConversations(client: SupabaseClient, userId: string): Promise<ConversationPreview[]> {
  void userId;
  const result = await client.rpc('get_conversation_previews', {
    p_limit: 30,
    p_before_created: null,
    p_before_id: null,
  });
  if (result.error) throw result.error;
  return ((result.data ?? []) as {
    id: string;
    other_user_id: string;
    other_nickname: string;
    other_verification_level: number;
    latest_body: string | null;
    latest_at: string;
  }[]).map((row) => ({
    id: row.id,
    otherUser: { id: row.other_user_id, nickname: row.other_nickname, verificationLevel: row.other_verification_level },
    latestBody: row.latest_body,
    latestAt: row.latest_at,
  }));
}

export async function loadConversationMessages(client: SupabaseClient, conversationId: string, before?: string) {
  let query = client
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (before) query = query.lt('created_at', before);
  const result = await query;
  if (result.error) throw result.error;
  return ((result.data ?? []) as ChatMessageRecord[]).reverse();
}

export async function loadSavedPosts(client: SupabaseClient, cursor: FeedCursor | null = null) {
  const saved = await client.rpc('get_saved_posts', {
    p_before_created: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 30,
  });
  if (saved.error) throw saved.error;
  return attachSignedPostImages(client, mapPublicFeed((saved.data ?? []) as PublicFeedRow[], []));
}

export async function loadPostCommentsPage(
  client: SupabaseClient,
  postId: string,
  cursor: FeedCursor | null = null,
): Promise<PostComment[]> {
  const result = await client.rpc('get_public_comments_page', {
    p_post_id: postId,
    p_before_created: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 30,
  });
  if (result.error) throw result.error;
  return ((result.data ?? []) as PublicCommentRow[]).map((comment) => ({
    id: comment.id,
    authorId: comment.author_id,
    nickname: comment.author_nickname,
    body: comment.body,
    likes: comment.like_count,
    likedByMe: comment.liked_by_me,
    verified: comment.author_verification_level >= 2,
    trustLevel: comment.author_verification_level === 3 ? 3 : undefined,
    createdAt: comment.created_at,
  }));
}

export async function requestMeetupJoin(client: SupabaseClient, postId: string, message: string) {
  const result = await client.rpc('request_meetup_join', { p_post_id: postId, p_message: message.trim() });
  if (result.error) throw result.error;
  return result.data as string;
}

export async function loadPendingMeetupRequests(client: SupabaseClient, hostId: string) {
  const result = await client
    .from('meetup_requests')
    .select('id,post_id,requester_id,message,status,created_at,requester:profiles!meetup_requests_requester_id_fkey(nickname,verification_level),post:posts!meetup_requests_post_id_fkey(title)')
    .eq('host_id', hostId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (result.error) throw result.error;
  return (result.data ?? []) as unknown as MeetupRequest[];
}

export async function respondMeetupRequest(
  client: SupabaseClient,
  requestId: string,
  response: 'approved' | 'rejected',
) {
  const result = await client.rpc('respond_meetup_request', {
    p_request_id: requestId,
    p_response: response,
  });
  if (result.error) throw result.error;
  return result.data as string | null;
}

export async function loadNotifications(client: SupabaseClient, userId: string) {
  const result = await client
    .from('notifications')
    .select('id,kind,body,route,read_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (result.error) throw result.error;
  return (result.data ?? []) as AppNotification[];
}

export async function loadUnreadNotificationCount(client: SupabaseClient, userId: string) {
  const result = await client.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
  if (result.error) throw result.error;
  return result.count ?? 0;
}

export async function loadTrendingHashtags(client: SupabaseClient, cityId: string, tagId: number | null) {
  const result = await client.rpc('get_trending_hashtags', {
    p_city_id: cityId,
    p_tag_id: tagId,
    p_window_days: 7,
    p_limit: 10,
  });
  if (result.error) throw result.error;
  return ((result.data ?? []) as { hashtag: string }[]).map(({ hashtag }) => hashtag);
}

export async function markNotificationsRead(client: SupabaseClient, ids?: string[]) {
  const result = await client.rpc('mark_notifications_read', { p_ids: ids ?? null });
  if (result.error) throw result.error;
  return result.data as number;
}

export async function deleteMyAccount(client: SupabaseClient, userId: string) {
  for (const bucket of ['avatars', 'post-images']) {
    while (true) {
      const listed = await client.storage.from(bucket).list(userId, { limit: 100 });
      if (listed.error) throw listed.error;
      if (!listed.data.length) break;
      const removed = await client.storage.from(bucket).remove(
        listed.data.map(({ name }) => `${userId}/${name}`),
      );
      if (removed.error) throw removed.error;
    }
  }

  const result = await client.rpc('delete_my_account', { p_confirmation: '탈퇴합니다' });
  if (result.error) throw result.error;
}

export async function loadProfileSummary(client: SupabaseClient, userId: string): Promise<ProfileSummary> {
  const [profile, posts] = await Promise.all([
    client.from('profiles').select('city_id,neighborhood').eq('id', userId).single(),
    client.from('posts').select('like_count,tag_id').eq('author_id', userId),
  ]);
  if (profile.error) throw profile.error;
  if (posts.error) throw posts.error;
  const rows = posts.data ?? [];
  return {
    cityId: profile.data.city_id,
    neighborhood: profile.data.neighborhood,
    posts: rows.length,
    likes: rows.reduce((sum, post) => sum + post.like_count, 0),
    meetups: rows.filter(({ tag_id }) => tag_id === 5).length,
  };
}

function decodeBase64(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0)).buffer;
}
