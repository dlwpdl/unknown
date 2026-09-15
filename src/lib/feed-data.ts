import type { SupabaseClient } from '@supabase/supabase-js';

import type { ListingStatus, Post, PostComment, PostKind, RoomPreview, TagSlug } from './types.ts';

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
  kind?: PostKind;
  listing_status?: ListingStatus | null;
  price?: number | string | null;
  expires_at?: string | null;
  bumped_at?: string | null;
  sort_at?: string;
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

export type FeedCursor = { createdAt: string; id: string; sortAt?: string };

type SignedImage = { url: string; expiresAt: number };
const signedImagesByClient = new WeakMap<object, Map<string, SignedImage>>();
const viewersBySignedUrl = new Map<string, Set<string>>();

export function appendUniquePosts<T extends { id: string }>(current: readonly T[], next: readonly T[]) {
  const ids = new Set(current.map(({ id }) => id));
  const added = next.filter(({ id }) => {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  return [...current, ...added];
}

export function getPostImageSource(
  post: Pick<Post, 'id' | 'imagePaths' | 'imageUris'>,
  viewerScope: string,
) {
  const uri = post.imageUris?.[0];
  if (!uri) return undefined;
  const allowedViewers = viewersBySignedUrl.get(uri);
  if (allowedViewers && !allowedViewers.has(viewerScope)) return undefined;
  return { uri, cacheKey: `post-image:${viewerScope}:${post.imagePaths?.[0] ?? uri}` };
}

export function groupJournalPosts(posts: readonly Post[]) {
  // 첫 페이지 안에서만 소개한다. 페이지 추가가 읽던 글을 위로 옮기지 않게 한다.
  const firstPage = posts.slice(0, 30);
  const featured = firstPage.find((post) => post.imageUris?.[0] && !post.room);
  const meetups = firstPage.filter((post) => post.room && !post.room.closed).slice(0, 2);
  const highlighted = new Set([featured?.id, ...meetups.map((post) => post.id)]);
  return { featured, meetups, remaining: posts.filter((post) => !highlighted.has(post.id)) };
}

export async function loadPublicFeed(
  client: SupabaseClient,
  cityId = 'vancouver',
  tagId: number | null = null,
  query: string | null = null,
  cursor: FeedCursor | null = null,
  options?: { viewerScope?: string; signal?: AbortSignal },
): Promise<Post[]> {
  // v2 orders by sort_at (bumped listings float) and hides closed/expired listings.
  const request = client.rpc('get_public_feed_page_v2', {
    p_city_id: cityId,
    p_tag_id: tagId,
    p_query: query,
    p_before_sort: cursor?.sortAt ?? cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: 30,
  });
  const feed = await (options?.signal ? request.abortSignal(options.signal) : request);
  if (feed.error) throw feed.error;
  const rows = (feed.data ?? []) as PublicFeedRow[];
  return attachSignedPostImages(client, mapPublicFeed(rows, []), options?.viewerScope);
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
    kind: row.kind ?? 'story',
    listingStatus: row.listing_status ?? undefined,
    price: row.price == null ? null : Number(row.price),
    expiresAt: row.expires_at ?? null,
    bumpedAt: row.bumped_at ?? null,
    sortAt: row.sort_at ?? row.created_at,
  }));
}

export async function attachSignedPostImages(client: SupabaseClient, posts: Post[], viewerScope?: string) {
  const paths = [...new Set(posts.flatMap(({ imagePaths }) => imagePaths ?? []))];
  if (paths.length === 0) return posts;
  const scope = viewerScope ?? await client.auth.getSession()
    .then(({ data }) => data.session?.user.id ?? 'guest')
    .catch(() => undefined);
  const now = Date.now();
  const cache = scope
    ? signedImagesByClient.get(client) ?? new Map<string, SignedImage>()
    : null;
  if (cache && !signedImagesByClient.has(client)) signedImagesByClient.set(client, cache);
  const cacheKey = (path: string) => `${scope}:${path}`;
  const urls = new Map(paths.flatMap((path) => {
    const cached = cache?.get(cacheKey(path));
    if (cached && cached.expiresAt > now) return [[path, cached.url] as const];
    if (cached) {
      cache?.delete(cacheKey(path));
      const viewers = viewersBySignedUrl.get(cached.url);
      if (scope) viewers?.delete(scope);
      if (viewers?.size === 0) viewersBySignedUrl.delete(cached.url);
    }
    return [];
  }));
  const missing = paths.filter((path) => !urls.has(path));
  if (missing.length > 0) {
    const signed = await client.storage.from('post-images').createSignedUrls(missing, 3600);
    if (!signed.error && signed.data) {
      for (const { path, signedUrl } of signed.data) {
        if (!path || !signedUrl) continue;
        urls.set(path, signedUrl);
        cache?.set(cacheKey(path), { url: signedUrl, expiresAt: now + 55 * 60_000 });
        if (scope) {
          const viewers = viewersBySignedUrl.get(signedUrl) ?? new Set<string>();
          viewers.add(scope);
          viewersBySignedUrl.set(signedUrl, viewers);
        }
      }
    }
  }
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
