-- Category fields for 부동산·구인구직·중고거래 listings (owner-approved mockup 2026-10-27).
-- Additive and nullable. Price and trade status keep using posts.price / posts.listing_status.
-- Location is never stored here: the app saves a neighborhood id, and the body's map line points at that
-- neighborhood's centre. The body also starts with a one-line lead carrying the same facts, so installed
-- 1.4.4/1.4.5 apps, which never read this column, keep showing everything. No existing RPC signature changes.

alter table public.posts add column listing_details jsonb
  constraint posts_listing_details_shape check (
    listing_details is null
    or (jsonb_typeof(listing_details) = 'object' and pg_column_size(listing_details) <= 4096 and kind = 'listing')
  );

-- Authors set it right after create_post through the existing "users update own posts" policy.
grant update (listing_details) on public.posts to authenticated;

-- Safety monitoring reads title and body only, so the column may hold no text of its own: every key is an
-- allow-listed value or format, and free text (lead, hours, duties) must already be in the checked body.
-- Runs after posts_content_filter (BEFORE triggers fire by name), so it sees the body that passed the filter.
create function private.guard_listing_details() returns trigger
language plpgsql set search_path = '' as $$
declare
  details jsonb := new.listing_details;
  item record;
  allowed text[];
  deals text[];
  in_body boolean := true;
begin
  if details is null then return new; end if;
  case details->>'type'
    when 'housing' then allowed := array['type','deal','rooms','moveIn','area','includes','lead']; deals := array['rent_offer','rent_wanted','sale','buy'];
    when 'jobs' then allowed := array['type','deal','payUnit','pay','jobTypes','area','hours','duties','apply','lead']; deals := array['hiring','seeking'];
    when 'used' then allowed := array['type','deal','offers','condition','area','lead']; deals := array['sell','buy'];
    else raise exception 'INVALID_LISTING_DETAILS';
  end case;
  if not details ? 'deal' then raise exception 'INVALID_LISTING_DETAILS'; end if;
  for item in select key, value, jsonb_typeof(value) as kind, value #>> '{}' as text from jsonb_each(details) loop
    if not (item.key = any(allowed)) or not (case item.key
      when 'type' then true
      when 'deal' then item.kind = 'string' and item.text = any(deals)
      when 'rooms' then item.kind = 'string' and item.text = any(array['room','studio','1b','1b_den','2b','2b2b','3b','basement'])
      when 'payUnit' then item.kind = 'string' and item.text = any(array['hour','month','year','negotiable'])
      when 'condition' then item.kind = 'string' and item.text = any(array['new','like_new','used','parts'])
      when 'includes' then private.listing_enum_list(item.value, array['furnished','utilities','parking','pets'])
      when 'jobTypes' then private.listing_enum_list(item.value, array['full','part','weekend','contract'])
      when 'apply' then private.listing_enum_list(item.value, array['chat','email','phone','visit'])
      when 'area' then item.kind = 'string' and item.text ~ '^[a-z0-9-]{1,40}$'
      when 'moveIn' then item.kind = 'string' and (item.text = 'now' or item.text ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$')
      when 'pay' then case when item.kind = 'number' then (item.value)::numeric >= 0 and (item.value)::numeric < 100000000 else false end
      when 'offers' then item.kind = 'boolean'
      else item.kind = 'string' and length(btrim(item.text)) > 0 and length(item.text) <= (case item.key when 'lead' then 600 when 'hours' then 40 else 200 end)
    end) then raise exception 'INVALID_LISTING_DETAILS'; end if;
    if item.key = 'lead' then in_body := in_body and left(coalesce(new.body, ''), length(item.text)) = item.text;
    elsif item.key in ('hours','duties') then in_body := in_body and strpos(coalesce(new.body, ''), item.text) > 0;
    end if;
  end loop;
  if not in_body then
    -- A body edit that drops the lead keeps the edit and shows the post as plain text, as before this column.
    if tg_op = 'UPDATE' and old.listing_details is not distinct from details then new.listing_details := null; return new; end if;
    raise exception 'LISTING_DETAILS_NOT_IN_BODY';
  end if;
  return new;
end $$;

create function private.listing_enum_list(value jsonb, allowed text[]) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'array' and jsonb_array_length(value) <= cardinality(allowed)
    and not exists (select 1 from jsonb_array_elements(value) as element where jsonb_typeof(element) <> 'string' or not ((element #>> '{}') = any(allowed)))
$$;
revoke all on function private.guard_listing_details() from public;
revoke all on function private.listing_enum_list(jsonb, text[]) from public;

create trigger posts_listing_details_guard before insert or update of listing_details, body on public.posts
for each row execute function private.guard_listing_details();

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
