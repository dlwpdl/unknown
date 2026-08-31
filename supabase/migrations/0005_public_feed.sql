-- 공개 피드는 게시 중인 글과 공개 프로필 필드만 반환한다.
-- 원본 테이블의 anon 접근은 계속 차단한다.

create function public.get_public_feed(
  p_city_id text default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  city_id text,
  title text,
  body text,
  hashtags text[],
  room_preview jsonb,
  created_at timestamptz,
  like_count integer,
  view_count integer,
  comment_count integer,
  save_count integer,
  author_id uuid,
  author_nickname text,
  author_neighborhood text,
  author_verification_level smallint,
  tag_id smallint,
  tag_slug text,
  tag_label text,
  tag_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id,
    post.city_id,
    post.title,
    post.body,
    post.hashtags,
    post.room_preview,
    post.created_at,
    post.like_count,
    post.view_count,
    post.comment_count,
    post.save_count,
    profile.id,
    profile.nickname::text,
    profile.neighborhood,
    profile.verification_level,
    tag.id,
    tag.slug,
    tag.label,
    tag.kind
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id
  join public.tags as tag on tag.id = post.tag_id
  where post.status = 'published'
    and (p_city_id is null or post.city_id = p_city_id)
    and (
      auth.uid() is null
      or not private.is_blocked_between(auth.uid(), post.author_id)
    )
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create function public.get_public_comments(p_post_ids uuid[])
returns table (
  id uuid,
  post_id uuid,
  body text,
  like_count integer,
  created_at timestamptz,
  author_nickname text,
  author_verification_level smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    comment.id,
    comment.post_id,
    comment.body,
    comment.like_count,
    comment.created_at,
    profile.nickname::text,
    profile.verification_level
  from public.comments as comment
  join public.posts as post on post.id = comment.post_id
  join public.profiles as profile on profile.id = comment.author_id
  where coalesce(cardinality(p_post_ids), 0) between 1 and 100
    and comment.post_id = any(p_post_ids)
    and comment.deleted_at is null
    and post.status = 'published'
    and (
      auth.uid() is null
      or not private.is_blocked_between(auth.uid(), comment.author_id)
    )
  order by comment.created_at, comment.id;
$$;

revoke all on function public.get_public_feed(text, integer) from public;
revoke all on function public.get_public_comments(uuid[]) from public;
grant execute on function public.get_public_feed(text, integer) to anon, authenticated;
grant execute on function public.get_public_comments(uuid[]) to anon, authenticated;
