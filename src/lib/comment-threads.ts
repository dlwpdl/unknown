import type { SupabaseClient } from '@supabase/supabase-js';

import type { PublicCommentRow } from './feed-data.ts';
import type { PostComment } from './types.ts';

export type CommentCursor = { createdAt: string; id: string };
type ThreadCommentRow = PublicCommentRow & {
  parent_id: string | null;
  reply_to_id: string | null;
  reply_to_nickname: string | null;
  reply_count: number;
};

function mapThreadComment(comment: ThreadCommentRow): PostComment {
  return {
    id: comment.id,
    authorId: comment.author_id,
    nickname: comment.author_nickname,
    body: comment.body,
    likes: comment.like_count,
    likedByMe: comment.liked_by_me,
    verified: comment.author_verification_level >= 2,
    trustLevel: comment.author_verification_level === 3 ? 3 : undefined,
    createdAt: comment.created_at,
    parentId: comment.parent_id ?? undefined,
    replyToId: comment.reply_to_id ?? undefined,
    replyToNickname: comment.reply_to_nickname ?? undefined,
    replyCount: comment.reply_count,
  };
}

export async function loadCommentThreadContext(client: SupabaseClient, postId: string, commentId: string): Promise<PostComment[]> {
  const result = await client.rpc('get_comment_thread_context', { p_post_id: postId, p_comment_id: commentId });
  if (result.error) throw result.error;
  return ((result.data ?? []) as ThreadCommentRow[]).map(mapThreadComment);
}

export async function loadCommentThreadPage(
  client: SupabaseClient,
  postId: string,
  parentId: string | null = null,
  cursor: CommentCursor | null = null,
): Promise<{ comments: PostComment[]; cursor: CommentCursor | null }> {
  // One lookahead row keeps root pagination independent of the total reply count.
  const result = await client.rpc('get_comment_thread_page', {
    p_post_id: postId,
    p_parent_id: parentId,
    p_before_created: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 31,
  });
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as ThreadCommentRow[];
  const comments = rows.slice(0, 30).map(mapThreadComment);
  const last = rows[29];
  return { comments, cursor: rows.length > 30 && last ? { createdAt: last.created_at, id: last.id } : null };
}

export async function createThreadComment(
  client: SupabaseClient,
  postId: string,
  body: string,
  replyToId: string | null = null,
): Promise<string> {
  const result = await client.rpc('create_thread_comment', {
    p_post_id: postId, p_body: body.trim(), p_reply_to_id: replyToId,
  });
  if (result.error) throw result.error;
  return result.data as string;
}
