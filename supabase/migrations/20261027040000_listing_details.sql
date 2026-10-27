-- Category fields for 부동산·구인구직·중고거래 listings (owner-approved mockup 2026-10-27).
-- Additive and nullable. Price and trade status keep using posts.price / posts.listing_status.
-- Location is never stored here: the app saves a neighborhood id, and the body's map line points at that
-- neighborhood's centre. The body also starts with a one-line lead carrying the same facts, so installed
-- 1.4.4/1.4.5 apps, which never read this column, keep showing everything. No existing RPC signature changes.

alter table public.posts add column listing_details jsonb
  constraint posts_listing_details_shape check (
    listing_details is null
    or (jsonb_typeof(listing_details) = 'object' and pg_column_size(listing_details) <= 2048 and kind = 'listing')
  );

-- Authors set it right after create_post through the existing "users update own posts" policy.
grant update (listing_details) on public.posts to authenticated;

-- Same visibility as get_public_post: published and not blocked between viewer and author.
create function public.get_public_post_listing_details(p_post_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids) > 50 or array_position(p_post_ids, null) is not null then
    raise exception 'INVALID_LISTING_DETAILS_PAGE';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id', post.id, 'details', post.listing_details) order by post.id), '[]'::jsonb)
  into result
  from public.posts as post
  where post.id = any(p_post_ids)
    and post.listing_details is not null
    and post.status = 'published'
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id));
  return result;
end $$;
revoke all on function public.get_public_post_listing_details(uuid[]) from public;
grant execute on function public.get_public_post_listing_details(uuid[]) to anon, authenticated;

-- New listing controls; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('listing.card.housing'),('listing.card.jobs'),('listing.card.used'),('listing.card.tile'),
 ('listing.segment.list'),('listing.segment.map'),('listing.segment.grid'),
 ('listing.filters'),('listing.filters.reset'),('listing.filter.option'),('listing.filter.clear'),
 ('listing.filter.rooms'),('listing.filter.price'),('listing.filter.moveIn'),('listing.filter.deal'),('listing.filter.condition'),
 ('listing.map.close'),('listing.map.search-here'),('listing.map.sheet'),('listing.map.sheet-close'),('listing.map.legacy'),('listing.map.to-list'),
 ('listing.fields.area'),('listing.fields.chip'),
 ('listing.area.open'),('listing.area.close'),('listing.area.list'),('listing.area.confirm')
on conflict do nothing;
