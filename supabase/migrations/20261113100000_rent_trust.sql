-- 렌트 신뢰 (owner 2026-11-13): '허위 매물·사기' 신고 사유, 세 사람이 신고한 부동산·구인구직·중고거래 글은 일단 숨김,
-- 운영팀 확정, 사기로 세 번 확정된 계정은 부동산 글 금지, 렌트 내놓음 글의 '사진 확인' 표시.
--
-- Hold: three different reporters within 7 days, counting only accounts signed up 7 or more days ago, take a listing
-- down for everyone (status 'removed', held_at set). Every feed, detail and search path already shows only 'published'
-- posts, so no read path changes. An admin then restores it or confirms the removal, optionally as fraud. The existing
-- report notification still tells admins about each report; nothing new is scheduled or pushed.
--
-- 확인 사진 (privacy): the author photographs a note with their nickname and the date inside the room. The photo goes to
-- the private 'listing-checks' bucket under the author's own folder, is linked to the post in private.listing_photo_checks,
-- and only the author and an MFA admin (every read audited) can open it. It is never attached to the post or returned
-- by any public function; the public post only learns the review date ('photo_checked_at'). The row goes with the post
-- (cascade) and the file with the account (delete-account lists this bucket). It is kept until then as review evidence.

-- 1. Reason. Old apps keep sending the six reasons they know; those reports count toward the hold as well.
alter table public.reports drop constraint reports_reason_code_check;
alter table public.reports add constraint reports_reason_code_check
  check (reason_code in ('spam','harassment','hate','sexual','privacy','other','scam'));
do $$
declare definition text; anchor text := '(''spam'', ''harassment'', ''hate'', ''sexual'', ''privacy'', ''other'')';
begin
  definition := pg_get_functiondef('public.create_report(text,uuid,text,text)'::regprocedure);
  if array_length(string_to_array(definition, anchor), 1) <> 2 then raise exception 'RENT_TRUST_REPORT_REASONS_CHANGED'; end if;
  execute replace(definition, anchor, '(''spam'', ''harassment'', ''hate'', ''sexual'', ''privacy'', ''other'', ''scam'')');
end $$;

-- 2. Hold. Neither column is granted to app users: only the trigger and the admin functions below write them.
alter table public.posts add column held_at timestamptz, add column fraud_confirmed_at timestamptz;
create index posts_held_idx on public.posts (held_at) where held_at is not null;
create index posts_fraud_author_idx on public.posts (author_id) where fraud_confirmed_at is not null;

create function private.hold_reported_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Reports for the same post queue here, so the third of three simultaneous reports still sees the other two.
  perform pg_advisory_xact_lock(hashtextextended('listing-hold:' || new.target_id::text, 0));
  if exists (select 1 from public.posts p join public.tags t on t.id = p.tag_id
      where p.id = new.target_id and p.status = 'published' and t.slug in ('housing','jobs','used'))
    and (select count(distinct r.reporter_id) from public.reports r join auth.users u on u.id = r.reporter_id
      where r.target_type = 'post' and r.target_id = new.target_id and r.source = 'report' and r.status = 'open'
        and r.created_at > now() - interval '7 days' and u.created_at <= now() - interval '7 days') >= 3 then
    update public.posts set status = 'removed', held_at = now() where id = new.target_id and status = 'published';
  end if;
  return new;
end $$;
create trigger reports_hold_listing after insert on public.reports
  for each row when (new.target_type = 'post' and new.source = 'report') execute function private.hold_reported_listing();

-- An account with three listings confirmed as fraud cannot post in 부동산.
create function private.guard_rent_posting() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tags t where t.id = new.tag_id and t.slug = 'housing')
    and (select count(*) from public.posts f where f.author_id = new.author_id and f.fraud_confirmed_at is not null) >= 3 then
    raise exception 'RENT_POSTING_BLOCKED';
  end if;
  return new;
end $$;
create trigger posts_guard_rent_posting before insert on public.posts
  for each row execute function private.guard_rent_posting();

create function public.get_admin_held_listings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('reports');
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'body', left(p.body, 600), 'category', t.slug, 'cityId', p.city_id, 'price', p.price,
      'authorId', p.author_id, 'nickname', a.nickname, 'heldAt', p.held_at,
      'authorFraudCount', (select count(*) from public.posts f where f.author_id = p.author_id and f.fraud_confirmed_at is not null),
      'reports', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason_code, 'details', r.details, 'createdAt', r.created_at)
        order by r.created_at), '[]'::jsonb) from public.reports r where r.target_type = 'post' and r.target_id = p.id and r.status = 'open')
    ) order by p.held_at), '[]'::jsonb) into result
  from (select * from public.posts where held_at is not null and status = 'removed' order by held_at limit 50) p
  join public.tags t on t.id = p.tag_id join public.profiles a on a.id = p.author_id;
  return result;
end $$;

-- restore: back for everyone, its open reports dismissed. remove: stays down. fraud: stays down and counts toward the 부동산 limit.
create function public.resolve_held_listing(p_post_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.posts;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_action is null or p_action not in ('restore','remove','fraud') then raise exception 'INVALID_HELD_ACTION'; end if;
  select * into p from public.posts where id = p_post_id for update;
  if p.id is null or p.held_at is null then raise exception 'HELD_LISTING_NOT_FOUND'; end if;
  perform public.log_admin_access('reports', p.author_id, p.id);
  update public.posts set held_at = null,
    status = case when p_action = 'restore' then 'published' else 'removed' end,
    fraud_confirmed_at = case when p_action = 'fraud' then now() end
  where id = p.id;
  update public.reports set status = case when p_action = 'restore' then 'dismissed' else 'actioned' end,
    resolved_at = now(), resolved_by = auth.uid()
  where target_type = 'post' and target_id = p.id and status = 'open';
end $$;

-- 3. 사진 확인.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('listing-checks', 'listing-checks', false, 2097152, array['image/webp']);

create table private.listing_photo_checks (
  post_id uuid primary key references public.posts(id) on delete cascade,
  author_id uuid not null,
  photo_path text not null unique check (split_part(photo_path, '/', 1) = author_id::text
    and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'),
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  check ((status = 'pending') = (reviewed_at is null))
);
create index listing_photo_checks_pending_idx on private.listing_photo_checks (submitted_at) where status = 'pending';
revoke all on private.listing_photo_checks from public, anon, authenticated;

-- Right after create_post, from the composer. Only the author, only a 부동산 listing, only a file they uploaded to their folder.
create function public.submit_listing_photo_check(p_post_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if not exists (select 1 from public.posts p join public.tags t on t.id = p.tag_id
      where p.id = p_post_id and p.author_id = uid and p.status = 'published' and t.slug = 'housing') then
    raise exception 'PHOTO_CHECK_UNAVAILABLE';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> uid::text
    or p_path !~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    or not exists (select 1 from storage.objects o where o.bucket_id = 'listing-checks' and o.name = p_path
      and (o.owner_id = uid::text or o.owner = uid) and o.metadata->>'mimetype' = 'image/webp'
      and case when o.metadata->>'size' ~ '^[0-9]{1,10}$' then (o.metadata->>'size')::bigint between 1 and 2097152 else false end) then
    raise exception 'INVALID_PHOTO_CHECK';
  end if;
  perform private.enforce_rate_limit('listing_photo_check', 10, interval '1 day');
  insert into private.listing_photo_checks (post_id, author_id, photo_path) values (p_post_id, uid, p_path);
end $$;

create function private.can_read_listing_check(p_path text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c private.listing_photo_checks; uid uuid := auth.uid();
begin
  if uid is null or not private.is_active_account(uid) then return false; end if;
  if split_part(p_path, '/', 1) = uid::text then return true; end if;
  if not private.is_admin() then return false; end if;
  select * into c from private.listing_photo_checks where photo_path = p_path;
  if c.post_id is null then return false; end if;
  perform public.log_admin_access('evidence', c.author_id, c.post_id);
  return true;
end $$;
-- A file the composer uploaded but could not link may be removed by its author; a linked one stays as review evidence.
create function private.can_delete_listing_check(p_path text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or split_part(p_path, '/', 1) <> auth.uid()::text then return false; end if;
  return not exists (select 1 from private.listing_photo_checks where photo_path = p_path);
end $$;
revoke all on function private.can_read_listing_check(text), private.can_delete_listing_check(text) from public, anon;
grant execute on function private.can_read_listing_check(text), private.can_delete_listing_check(text) to authenticated;

create policy "authors upload listing check photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-checks' and private.is_active_account((select auth.uid()))
    and split_part(name, '/', 1) = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$');
create policy "authors and audited admins read listing check photos" on storage.objects for select to authenticated
  using (case when bucket_id = 'listing-checks' then private.can_read_listing_check(name) else false end);
-- No UPDATE policy: a submitted photo cannot be swapped after the fact.
create policy "authors remove unlinked listing check photos" on storage.objects for delete to authenticated
  using (case when bucket_id = 'listing-checks' then private.can_delete_listing_check(name) else false end);

create function public.get_admin_listing_photo_checks() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('safety');
  select coalesce(jsonb_agg(jsonb_build_object(
      'postId', p.id, 'title', p.title, 'cityId', p.city_id, 'price', p.price, 'details', p.listing_details,
      'authorId', c.author_id, 'nickname', a.nickname, 'photoPath', c.photo_path, 'submittedAt', c.submitted_at
    ) order by c.submitted_at), '[]'::jsonb) into result
  from (select * from private.listing_photo_checks where status = 'pending' order by submitted_at limit 50) c
  join public.posts p on p.id = c.post_id join public.profiles a on a.id = c.author_id
  where p.status = 'published';
  return result;
end $$;

create function public.review_listing_photo_check(p_post_id uuid, p_verified boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c private.listing_photo_checks;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_verified is null then raise exception 'INVALID_PHOTO_CHECK_REVIEW'; end if;
  select * into c from private.listing_photo_checks where post_id = p_post_id for update;
  if c.post_id is null or c.status <> 'pending' then raise exception 'PHOTO_CHECK_NOT_PENDING'; end if;
  perform public.log_admin_access('safety', c.author_id, c.post_id);
  update private.listing_photo_checks set status = case when p_verified then 'verified' else 'rejected' end,
    reviewed_at = now(), reviewed_by = auth.uid() where post_id = c.post_id;
end $$;

-- The public post learns only the review date. Same visibility as before; old apps ignore the extra key.
create or replace function public.get_public_post_listing_details(p_post_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids) > 50 or array_position(p_post_ids, null) is not null then
    raise exception 'INVALID_LISTING_DETAILS_PAGE';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id', post.id, 'details', post.listing_details,
      'photo_checked_at', (select c.reviewed_at from private.listing_photo_checks c where c.post_id = post.id and c.status = 'verified'))
    order by post.id), '[]'::jsonb)
  into result
  from public.posts as post
  where post.id = any(p_post_ids)
    and post.listing_details is not null
    and post.status = 'published'
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(), post.author_id));
  return result;
end $$;

revoke all on function private.hold_reported_listing(), private.guard_rent_posting() from public, anon, authenticated;
revoke all on function public.get_admin_held_listings(), public.resolve_held_listing(uuid, text), public.submit_listing_photo_check(uuid, text),
  public.get_admin_listing_photo_checks(), public.review_listing_photo_check(uuid, boolean) from public, anon;
grant execute on function public.get_admin_held_listings(), public.resolve_held_listing(uuid, text), public.submit_listing_photo_check(uuid, text),
  public.get_admin_listing_photo_checks(), public.review_listing_photo_check(uuid, boolean) to authenticated;

-- Account deletion already lists the owner's folder in each bucket; this one joins the allow-list.
do $$
declare definition text; anchor text := '''meetup-profiles'')';
begin
  definition := pg_get_functiondef('public.account_image_cleanup_paths(uuid,text,text[])'::regprocedure);
  if array_length(string_to_array(definition, anchor), 1) <> 2 then raise exception 'RENT_TRUST_ACCOUNT_MEDIA_ALLOWLIST_CHANGED'; end if;
  execute replace(definition, anchor, '''meetup-profiles'',''listing-checks'')');
end $$;

-- New app controls; unregistered targets make the server reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('compose.rent-check-photo'),('compose.rent-check-photo.remove'),
 ('today.newcomer.arrival'),('today.newcomer.step'),('today.newcomer.step-link'),
 ('today.newcomer.arrival-change'),('today.newcomer.list'),('today.newcomer.list-hide')
on conflict do nothing;
