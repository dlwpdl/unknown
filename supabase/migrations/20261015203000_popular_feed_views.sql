-- Include views so posts with no reactions still have a meaningful popularity rank.
create or replace function public.get_public_popular_feed_page(
  p_city_id text,
  p_tag_id smallint default null,
  p_before_score bigint default null,
  p_before_created timestamptz default null,
  p_before_id uuid default null,
  p_as_of timestamptz default null,
  p_limit integer default 30
)
returns table (
  id uuid, city_id text, title text, body text, hashtags text[], image_paths text[],
  room_preview jsonb, created_at timestamptz, like_count integer, view_count integer,
  comment_count integer, save_count integer, share_count integer, liked_by_me boolean,
  saved_by_me boolean, author_id uuid, author_nickname text, author_neighborhood text,
  author_verification_level smallint, tag_id smallint, tag_slug text, tag_label text, tag_kind text,
  kind text, listing_status text, price numeric, expires_at timestamptz, bumped_at timestamptz, sort_at timestamptz,
  popularity_score bigint, ranking_as_of timestamptz
)
language plpgsql stable security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
#variable_conflict use_column
declare
  page_size integer := greatest(1,least(coalesce(p_limit,30),50));
  cutoff timestamptz := coalesce(p_as_of,now());
begin
  if cutoff > now() or p_before_score < 0
    or num_nonnulls(p_before_score,p_before_created,p_before_id) not in (0,3)
    or (p_before_score is not null and p_as_of is null) then
    raise exception 'INVALID_FEED_CURSOR';
  end if;

  return query
  with ranked as (
    select post.id,post.created_at,
      post.view_count::bigint + post.like_count::bigint + post.comment_count::bigint * 2 + post.save_count::bigint * 3 as score
    from public.posts post
    join public.profiles profile on profile.id=post.author_id and profile.account_status='active'
    where post.status='published' and private.listing_alive(post.kind,post.status,post.listing_status,post.expires_at)
      and post.city_id=p_city_id and (p_tag_id is null or post.tag_id=p_tag_id)
      and post.created_at >= cutoff-interval '7 days' and post.created_at <= cutoff
      and (auth.uid() is null or (not private.is_blocked_between(auth.uid(),post.author_id)
        and not private.has_reported(auth.uid(),'post',post.id)))
  ), page as (
    select ranked.* from ranked
    where p_before_score is null or (score,ranked.created_at,ranked.id) < (p_before_score,p_before_created,p_before_id)
    order by score desc,ranked.created_at desc,ranked.id desc
    limit page_size
  )
  select
    post.id,post.city_id,post.title,
    case when auth.uid() is null then '' else post.body end,
    post.hashtags,
    case when auth.uid() is null then
      case when public.is_public_post_image(post.image_paths[1]) then post.image_paths[1:1] else '{}'::text[] end
      else post.image_paths end,
    case when auth.uid() is null and post.room_preview is not null then
      (select coalesce(jsonb_object_agg(field.key,field.value),'{}'::jsonb) from jsonb_each(post.room_preview) field
        where field.key=any(array['memberCount','capacity','verifiedOnly','closed','eventKind','category','startsAt','endsAt','timezone','cadence','recommendedAgeMin','recommendedAgeMax']))
      else post.room_preview end,
    post.created_at,post.like_count,post.view_count,post.comment_count,post.save_count,post.share_count,
    exists(select 1 from public.post_reactions where post_id=post.id and user_id=auth.uid() and kind='like'),
    exists(select 1 from public.post_reactions where post_id=post.id and user_id=auth.uid() and kind='save'),
    profile.id,profile.nickname::text,profile.neighborhood,profile.verification_level,
    tag.id,tag.slug,tag.label,tag.kind,
    post.kind,post.listing_status,post.price,post.expires_at,post.bumped_at,post.sort_at,
    page.score,cutoff
  from public.posts post
  join page on page.id=post.id
  join public.profiles profile on profile.id=post.author_id
  join public.tags tag on tag.id=post.tag_id
  order by page.score desc,post.created_at desc,post.id desc;
end;
$$;
revoke all on function public.get_public_popular_feed_page(text,smallint,bigint,timestamptz,uuid,timestamptz,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_public_popular_feed_page(text,smallint,bigint,timestamptz,uuid,timestamptz,integer) to anon,authenticated;
notify pgrst,'reload schema';
