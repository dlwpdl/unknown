-- 검색 안내와 실제 범위를 맞춘다: 제목·본문·해시태그뿐 아니라 작성자 닉네임·동네도 검색.
create or replace function public.get_public_feed_page(
  p_city_id text,
  p_tag_id smallint default null,
  p_query text default null,
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'save'),
    profile.id, profile.nickname::text, profile.neighborhood, profile.verification_level,
    tag.id, tag.slug, tag.label, tag.kind
  from public.posts as post
  join public.profiles as profile on profile.id = post.author_id and profile.account_status = 'active'
  join public.tags as tag on tag.id = post.tag_id
  where post.status = 'published'
    and post.city_id = p_city_id
    and (p_tag_id is null or post.tag_id = p_tag_id)
    and (
      nullif(trim(coalesce(p_query, '')), '') is null
      or (post.title || ' ' || post.body) ilike '%' || trim(p_query) || '%'
      or profile.nickname ilike '%' || trim(p_query) || '%'
      or coalesce(profile.neighborhood, '') ilike '%' || trim(p_query) || '%'
      or exists (select 1 from unnest(post.hashtags) as hashtag where hashtag ilike '%' || trim(p_query) || '%')
    )
    and (p_before_created is null or (post.created_at, post.id) < (p_before_created, p_before_id))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;
