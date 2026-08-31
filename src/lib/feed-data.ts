import type { SupabaseClient } from '@supabase/supabase-js';

import type { Post, PostComment, RoomPreview, TagSlug } from './types.ts';

export type PublicFeedRow = {
  id: string;
  city_id: string;
  title: string;
  body: string;
  hashtags: string[];
  image_paths: string[];
  room_preview: RoomPreview | null;
  created_at: string;
  like_count: number;
  view_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  author_id: string;
  author_nickname: string;
  author_neighborhood: string | null;
  author_verification_level: number;
  tag_id: number;
  tag_slug: TagSlug;
  tag_label: string;
  tag_kind: 'post' | 'meetup';
};

export type PublicCommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  like_count: number;
  liked_by_me: boolean;
  created_at: string;
  author_nickname: string;
  author_verification_level: number;
};

export type FeedCursor = { createdAt: string; id: string };

export async function loadPublicFeed(
  client: SupabaseClient,
  cityId = 'vancouver',
  tagId: number | null = null,
  query: string | null = null,
  cursor: FeedCursor | null = null,
): Promise<Post[]> {
  const feed = await client.rpc('get_public_feed_page', {
    p_city_id: cityId,
    p_tag_id: tagId,
    p_query: query,
    p_before_created: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 30,
  });
  if (feed.error) throw feed.error;
  const rows = (feed.data ?? []) as PublicFeedRow[];
  return attachSignedPostImages(client, mapPublicFeed(rows, []));
}

export async function loadPublicPost(client: SupabaseClient, postId: string): Promise<Post | null> {
  const feed = await client.rpc('get_public_post', { p_post_id: postId });
  if (feed.error) throw feed.error;
  const rows = (feed.data ?? []) as PublicFeedRow[];
  if (rows.length === 0) return null;
  const comments = await client.rpc('get_public_comments_page', {
    p_post_id: postId,
    p_before_created: null,
    p_before_id: null,
    p_limit: 30,
  });
  if (comments.error) throw comments.error;
  const [post] = await attachSignedPostImages(client, mapPublicFeed(rows, (comments.data ?? []) as PublicCommentRow[]));
  return post ?? null;
}

export function mapPublicFeed(
  rows: PublicFeedRow[],
  comments: PublicCommentRow[],
  now = Date.now(),
): Post[] {
  const commentsByPost = new Map<string, PostComment[]>();
  for (const comment of comments) {
    const list = commentsByPost.get(comment.post_id) ?? [];
    list.push({
      id: comment.id,
      authorId: comment.author_id,
      nickname: comment.author_nickname,
      body: comment.body,
      likes: comment.like_count,
      likedByMe: comment.liked_by_me,
      verified: comment.author_verification_level >= 2,
      trustLevel: comment.author_verification_level === 3 ? 3 : undefined,
      createdAt: comment.created_at,
    });
    commentsByPost.set(comment.post_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    cityId: row.city_id,
    author: {
      id: row.author_id,
      nickname: row.author_nickname,
      neighborhood: row.author_neighborhood ?? undefined,
      verified: row.author_verification_level >= 2,
      trustLevel: row.author_verification_level === 3 ? 3 : undefined,
    },
    tag: { id: row.tag_id, slug: row.tag_slug, label: row.tag_label, kind: row.tag_kind },
    title: row.title,
    body: row.body,
    hashtags: row.hashtags,
    createdAtLabel: relativeTime(row.created_at, now),
    createdAt: row.created_at,
    likes: row.like_count,
    views: row.view_count,
    comments: row.comment_count,
    commentList: commentsByPost.get(row.id),
    saves: row.save_count,
    shares: row.share_count,
    likedByMe: row.liked_by_me,
    savedByMe: row.saved_by_me,
    imagePaths: row.image_paths,
    room: row.room_preview ?? undefined,
  }));
}

export async function attachSignedPostImages(client: SupabaseClient, posts: Post[]) {
  const paths = [...new Set(posts.flatMap(({ imagePaths }) => imagePaths ?? []))];
  if (paths.length === 0) return posts;
  const signed = await client.storage.from('post-images').createSignedUrls(paths, 3600);
  if (signed.error || !signed.data) return posts;
  const urls = new Map(
    signed.data.flatMap(({ path, signedUrl }) => path && signedUrl ? [[path, signedUrl] as const] : []),
  );
  return posts.map((post) => ({
    ...post,
    imageUris: post.imagePaths?.flatMap((path) => urls.get(path) ?? []),
  }));
}

function relativeTime(value: string, now: number) {
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return '방금';
  if (elapsedMinutes < 60) return `${elapsedMinutes}분 전`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '어제' : `${days}일 전`;
}
