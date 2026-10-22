-- 프로필을 누르면 그 사람이 지금까지 쓴 글을 볼 수 있게 한다.
-- 피드와 같은 열 구성을 돌려줘서 앱이 이미 쓰는 카드 형식으로 바로 그린다.
create or replace function public.get_public_author_posts(
  p_author_id uuid,
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text,
  kind text, listing_status text, price numeric, expires_at timestamptz, bumped_at timestamptz, sort_at timestamptz
)
language plpgsql stable security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
#variable_conflict use_column
declare page_size integer := greatest(1, least(coalesce(p_limit, 30), 50));
begin
  return query
  select
    post.id, post.city_id, post.title, post.body, post.hashtags, post.image_paths,
    post.room_preview, post.created_at, post.like_count, post.view_count,
    post.comment_count, post.save_count, post.share_count,
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'like'),
    exists (select 1 from public.post_reactions where post_id = post.id and user_id = auth.uid() and kind = 'save'),
    profile.id, profile.nickname::text, profile.neighborhood, profile.verification_level,
    tag.id, tag.slug, tag.label, tag.kind,
    post.kind, post.listing_status, post.price, post.expires_at, post.bumped_at, post.sort_at
  from public.posts post
  join public.profiles profile on profile.id = post.author_id
  join public.tags tag on tag.id = post.tag_id
  where post.status = 'published'
    and post.author_id = p_author_id
    and profile.account_status = 'active'
    and (p_before_created is null or (post.created_at, post.id) < (p_before_created, p_before_id))
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id))
  order by post.created_at desc, post.id desc
  limit page_size;
end;
$$;

grant execute on function public.get_public_author_posts(uuid, timestamptz, uuid, integer) to anon, authenticated;
