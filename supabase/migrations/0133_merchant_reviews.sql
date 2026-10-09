-- One review per account and canonical merchant. Only human-verified receipts
-- contribute to public reviews. The receipt image itself remains private.
create table private.merchant_reviews (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references private.merchants(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  score numeric not null check (score between 1 and 10 and mod(score,0.5)=0),
  body text check (body is null or (char_length(body) between 1 and 300 and char_length(btrim(body))>0)),
  status text not null default 'published' check (status in ('published','removed')),
  receipt_path text,
  receipt_status text not null default 'none' check (receipt_status in ('none','pending','verified','rejected')),
  receipt_reviewed_at timestamptz,
  receipt_reviewed_by uuid,
  receipt_review_note text check (char_length(receipt_review_note)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id,author_id),
  check (receipt_path is null or (split_part(receipt_path,'/',1)=author_id::text
    and receipt_path ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')),
  check ((receipt_status='none' and receipt_path is null) or (receipt_status<>'none' and receipt_path is not null)),
  check ((receipt_status in ('none','pending') and receipt_reviewed_at is null and receipt_reviewed_by is null and receipt_review_note is null)
    or (receipt_status in ('verified','rejected') and receipt_reviewed_at is not null and receipt_reviewed_by is not null))
);
create index merchant_reviews_page_idx on private.merchant_reviews(merchant_id,created_at desc,id desc) where status='published';
create index merchant_reviews_pending_idx on private.merchant_reviews(updated_at,id) where status='published' and receipt_status='pending';
create index merchant_reviews_receipt_idx on private.merchant_reviews(receipt_path) where receipt_path is not null;
create index merchant_reviews_author_idx on private.merchant_reviews(author_id);
alter table private.merchant_reviews enable row level security;
revoke all on private.merchant_reviews from public,anon,authenticated,service_role;
-- Existing safety and report definers use the trusted database owner.
alter table private.merchant_reviews owner to postgres;
create trigger merchant_reviews_updated_at before update on private.merchant_reviews
  for each row execute function private.set_updated_at();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('merchant-review-receipts','merchant-review-receipts',false,2097152,array['image/webp']);

create function private.merchant_review_merchant(p_post_id uuid,p_viewer uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select mp.merchant_id from private.merchant_posts mp
  join private.merchants m on m.id=mp.merchant_id join public.posts p on p.id=mp.post_id
  where p.id=p_post_id and p.status='published' and m.consent='granted' and m.status in ('trial','paid')
    and private.is_active_account(p.author_id) and not private.is_blocked_between(p_viewer,p.author_id)
    and not private.has_reported(p_viewer,'post',p.id) and not private.has_reported(p_viewer,'user',p.author_id);
$$;
create function private.merchant_review_safety_content(p_target_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'authorId',r.author_id,'nickname',p.nickname,
    'text',concat_ws(E'\n','업체 후기 · '||m.name,'점수 '||r.score::text||'/10',r.body),
    'merchantId',r.merchant_id,'merchantName',m.name,'score',r.score,'body',r.body,'status',r.status,
    'createdAt',r.created_at,'updatedAt',r.updated_at,'receiptPath',r.receipt_path,'receiptStatus',r.receipt_status,
    'receiptReviewedAt',r.receipt_reviewed_at,'receiptReviewedBy',r.receipt_reviewed_by,'receiptReviewNote',r.receipt_review_note)
  from private.merchant_reviews r join private.merchants m on m.id=r.merchant_id join public.profiles p on p.id=r.author_id
  where r.id=p_target_id;
$$;
create function private.assert_merchant_review_receipt(p_path text,p_author uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_path is null or split_part(p_path,'/',1)<>p_author::text
    or p_path !~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    then raise exception 'INVALID_REVIEW_RECEIPT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_path,1311));
  perform 1 from storage.objects o where o.bucket_id='merchant-review-receipts' and o.name=p_path
    and (o.owner_id=p_author::text or o.owner=p_author)
    and o.metadata->>'mimetype'='image/webp'
    and case when o.metadata->>'size' ~ '^[0-9]{1,10}$' then (o.metadata->>'size')::bigint between 1 and 2097152 else false end
    for share;
  if not found then raise exception 'INVALID_REVIEW_RECEIPT'; end if;
end;
$$;
-- Storage authorization also records private receipt reads by actual MFA admins.
-- Business owners receive feedback text, never customers' receipt images.
create function private.can_read_merchant_review_receipt(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.merchant_reviews; uid uuid:=auth.uid();
begin
  if uid is null or not private.is_active_account(uid) then return false; end if;
  if split_part(p_path,'/',1)=uid::text then return true; end if;
  if not private.is_admin() then return false; end if;
  select * into r from private.merchant_reviews where receipt_path=p_path limit 1;
  if r.id is null then return false; end if;
  perform public.log_admin_access('evidence',r.author_id,r.id);
  return true;
end;
$$;
create function private.can_delete_merchant_review_receipt(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_active_account(auth.uid()) or split_part(p_path,'/',1)<>auth.uid()::text then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_path,1311));
  return not exists(select 1 from private.merchant_reviews where receipt_path=p_path);
end;
$$;
revoke all on function private.merchant_review_merchant(uuid,uuid),private.merchant_review_safety_content(uuid),
  private.assert_merchant_review_receipt(text,uuid),private.can_read_merchant_review_receipt(text),private.can_delete_merchant_review_receipt(text)
  from public,anon,authenticated,service_role;
grant execute on function private.can_read_merchant_review_receipt(text),private.can_delete_merchant_review_receipt(text) to authenticated;
-- The established queue trigger runs as the trusted postgres database owner,
-- including when a maintenance role applies this migration.
grant execute on function private.merchant_review_safety_content(uuid),private.merchant_review_merchant(uuid,uuid) to postgres;
create policy "authors upload immutable review receipts" on storage.objects for insert to authenticated
  with check(bucket_id='merchant-review-receipts' and private.is_active_account((select auth.uid()))
    and split_part(name,'/',1)=(select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$');
create policy "authors and audited admins read private receipts" on storage.objects for select to authenticated
  using(case when bucket_id='merchant-review-receipts' then private.can_read_merchant_review_receipt(name) else false end);
-- No UPDATE policy: an already verified image cannot be overwritten.
create policy "authors remove only unlinked review receipts" on storage.objects for delete to authenticated
  using(case when bucket_id='merchant-review-receipts' then private.can_delete_merchant_review_receipt(name) else false end);

create function public.get_merchant_reviews(p_post_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mid uuid; uid uuid:=auth.uid(); mine private.merchant_reviews; result jsonb;
begin
  if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_REVIEW_OFFSET'; end if;
  mid:=private.merchant_review_merchant(p_post_id,uid);
  if mid is null then return null; end if;
  select * into mine from private.merchant_reviews where merchant_id=mid and author_id=uid;
  with visible as materialized (
    select r.* from private.merchant_reviews r where r.merchant_id=mid and r.status='published' and r.receipt_status='verified'
      and private.is_active_account(r.author_id) and not private.is_blocked_between(uid,r.author_id)
      and not private.has_reported(uid,'merchant_review',r.id) and not private.has_reported(uid,'user',r.author_id)
  ) select jsonb_build_object('merchant_id',mid,'merchant_name',(select name from private.merchants where id=mid),
    'rating_average',(select avg(score) from visible),'review_count',(select count(*) from visible),
    'can_review',uid is not null and private.is_active_account(uid) and (mine.id is null or mine.status='published'),
    'my_review',case when mine.id is null then null else jsonb_build_object('id',mine.id,'author_id',mine.author_id,
      'nickname',(select nickname from public.profiles where id=uid),'score',mine.score,'body',mine.body,'status',mine.status,
      'receipt_path',mine.receipt_path,'receipt_status',mine.receipt_status,'receipt_review_note',mine.receipt_review_note,
      'created_at',mine.created_at,'updated_at',mine.updated_at) end,
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'author_id',r.author_id,
      'nickname',(select nickname from public.profiles where id=r.author_id),'score',r.score,'body',r.body,
      'receipt_status',r.receipt_status,'created_at',r.created_at,'updated_at',r.updated_at) order by r.created_at desc,r.id desc)
      from (select * from visible order by created_at desc,id desc limit 20 offset p_offset)r),'[]'::jsonb),
    'has_more',(select count(*) from visible)>p_offset+20) into result;
  return result;
end;
$$;
create function public.write_merchant_review(p_post_id uuid,p_score numeric,p_body text default null,p_receipt_path text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); mid uuid; mine private.merchant_reviews; body_text text:=nullif(btrim(p_body),''); next_path text; receipt_changed boolean;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':merchant_review',131));
  -- Lock the actual public relationship before checking its current visibility.
  perform 1 from private.merchant_posts mp join private.merchants m on m.id=mp.merchant_id
    join public.posts p on p.id=mp.post_id join public.profiles author on author.id=p.author_id
    where p.id=p_post_id for share of mp,m,p,author;
  mid:=private.merchant_review_merchant(p_post_id,uid);
  if mid is null then raise exception 'MERCHANT_REVIEW_UNAVAILABLE'; end if;
  if p_score is null or p_score not between 1 and 10 or mod(p_score,0.5)<>0 then raise exception 'INVALID_REVIEW_SCORE'; end if;
  if char_length(body_text)>300 then raise exception 'INVALID_REVIEW_BODY'; end if;
  select * into mine from private.merchant_reviews where merchant_id=mid and author_id=uid for update;
  if mine.status='removed' then raise exception 'MERCHANT_REVIEW_REMOVED'; end if;
  next_path:=case when p_receipt_path is null then mine.receipt_path else nullif(p_receipt_path,'') end;
  if next_path is not null then perform private.assert_merchant_review_receipt(next_path,uid); end if;
  receipt_changed:=mine.receipt_path is distinct from next_path;
  if mine.id is not null and mine.score=p_score and mine.body is not distinct from body_text and not receipt_changed then return mine.id; end if;
  perform private.assert_content_allowed(coalesce(body_text,''));
  if mine.id is null then perform private.enforce_rate_limit('merchant_review_new',20,interval '1 day');
  else perform private.enforce_rate_limit('merchant_review_edit',10,interval '1 hour'); end if;
  insert into private.merchant_reviews(merchant_id,author_id,score,body,receipt_path,receipt_status)
    values(mid,uid,p_score,body_text,next_path,case when next_path is null then 'none' else 'pending' end)
  on conflict(merchant_id,author_id) do update set score=excluded.score,body=excluded.body,receipt_path=excluded.receipt_path,
    receipt_status=case when receipt_changed then excluded.receipt_status else private.merchant_reviews.receipt_status end,
    receipt_reviewed_at=case when receipt_changed then null else private.merchant_reviews.receipt_reviewed_at end,
    receipt_reviewed_by=case when receipt_changed then null else private.merchant_reviews.receipt_reviewed_by end,
    receipt_review_note=case when receipt_changed then null else private.merchant_reviews.receipt_review_note end
  returning id into mid;
  return mid;
end;
$$;
create function public.get_my_merchant_reviews(p_merchant_id uuid,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; uid uuid:=auth.uid(); result jsonb;
begin
  if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_REVIEW_OFFSET'; end if;
  m:=private.assert_merchant_workspace(p_merchant_id,false);
  if m.owner_id is distinct from uid then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if not exists(select 1 from auth.users where id=uid and raw_app_meta_data->'merchant_enabled'='true'::jsonb) then raise exception 'MERCHANT_ACCOUNT_REQUIRED'; end if;
  with visible as materialized (
    select r.* from private.merchant_reviews r where r.merchant_id=m.id and r.status='published' and private.is_active_account(r.author_id)
      and not private.is_blocked_between(uid,r.author_id) and not private.has_reported(uid,'merchant_review',r.id) and not private.has_reported(uid,'user',r.author_id)
  ) select jsonb_build_object('reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'author_id',r.author_id,
      'nickname',(select nickname from public.profiles where id=r.author_id),'score',r.score,'body',r.body,
      'status',r.status,'receipt_status',r.receipt_status,'created_at',r.created_at,'updated_at',r.updated_at) order by r.created_at desc,r.id desc)
      from (select * from visible order by created_at desc,id desc limit 20 offset p_offset)r),'[]'::jsonb),
    'has_more',(select count(*) from visible)>p_offset+20) into result;
  return result;
end;
$$;
create function public.get_merchant_review_safety_content(p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  return private.merchant_review_safety_content(p_target_id);
end;
$$;
create function public.get_admin_merchant_review_content(p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare content jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  content:=private.merchant_review_safety_content(p_target_id);
  perform public.log_admin_access('safety',(content->>'authorId')::uuid,p_target_id);
  return content;
end;
$$;
create function public.get_admin_merchant_receipt_reviews(p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_REVIEW_OFFSET'; end if;
  perform public.log_admin_access('safety');
  with pending as materialized (select id,updated_at from private.merchant_reviews where receipt_status='pending' and status='published')
  select jsonb_build_object('reviews',coalesce((select jsonb_agg(private.merchant_review_safety_content(r.id) order by r.updated_at,r.id)
    from (select * from pending order by updated_at,id limit 20 offset p_offset)r),'[]'::jsonb),
    'has_more',(select count(*) from pending)>p_offset+20) into result;
  return result;
end;
$$;
create function public.set_admin_merchant_review_receipt(p_target_id uuid,p_receipt_path text,p_updated_at timestamptz,p_verified boolean,p_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.merchant_reviews;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_verified is null or char_length(coalesce(p_note,''))>1000 then raise exception 'INVALID_RECEIPT_REVIEW'; end if;
  select * into r from private.merchant_reviews where id=p_target_id for update;
  if r.id is null or r.status<>'published' or r.receipt_path is null then raise exception 'RECEIPT_REVIEW_UNAVAILABLE'; end if;
  if p_receipt_path is distinct from r.receipt_path or p_updated_at is distinct from r.updated_at then raise exception 'MERCHANT_REVIEW_CHANGED'; end if;
  perform private.assert_merchant_review_receipt(r.receipt_path,r.author_id);
  update private.merchant_reviews set receipt_status=case when p_verified then 'verified' else 'rejected' end,
    receipt_reviewed_at=now(),receipt_reviewed_by=auth.uid(),receipt_review_note=nullif(btrim(p_note),'') where id=r.id;
  perform public.log_admin_access('evidence',r.author_id,r.id);
  return private.merchant_review_safety_content(r.id);
end;
$$;
revoke all on function public.get_merchant_reviews(uuid,integer),public.write_merchant_review(uuid,numeric,text,text),
  public.get_my_merchant_reviews(uuid,integer),public.get_merchant_review_safety_content(uuid),public.get_admin_merchant_review_content(uuid),
  public.get_admin_merchant_receipt_reviews(integer),public.set_admin_merchant_review_receipt(uuid,text,timestamptz,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_reviews(uuid,integer) to anon,authenticated;
grant execute on function public.write_merchant_review(uuid,numeric,text,text),public.get_my_merchant_reviews(uuid,integer),
  public.get_admin_merchant_review_content(uuid),public.get_admin_merchant_receipt_reviews(integer),
  public.set_admin_merchant_review_receipt(uuid,text,timestamptz,boolean,text) to authenticated;
grant execute on function public.get_merchant_review_safety_content(uuid) to service_role;

-- Add a target to live definitions rather than copying/reverting unrelated
-- relationship, rate, MFA, moderation or audit changes.
do $$
declare table_name text; definition text; anchor text;
begin
  foreach table_name in array array['reports','safety_review_queue','safety_alerts','notifications'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint
      where conrelid=('public.'||table_name)::regclass and conname=table_name||'_target_type_check';
    if definition is null or strpos(definition,'])))')=0 then raise exception 'merchant review target constraint anchor missing: %',table_name; end if;
    execute format('alter table public.%I drop constraint %I',table_name,table_name||'_target_type_check');
    execute format('alter table public.%I add constraint %I %s',table_name,table_name||'_target_type_check',replace(definition,'])))',', ''merchant_review''::text])))'));
  end loop;
  definition:=pg_get_functiondef('private.enqueue_safety_review()'::regprocedure);
  anchor:='when ''comments'' then ''comment''';
  if strpos(definition,anchor)=0 then raise exception 'merchant review queue target anchor missing'; end if;
  definition:=replace(definition,anchor,anchor||' when ''merchant_reviews'' then ''merchant_review''');
  anchor:='when ''posts'' then concat_ws';
  if strpos(definition,anchor)=0 then raise exception 'merchant review queue content anchor missing'; end if;
  execute replace(definition,anchor,'when ''merchant_reviews'' then private.merchant_review_safety_content(new.id)->>''text'' '||anchor);
  definition:=pg_get_functiondef('private.scan_watch_terms()'::regprocedure);
  anchor:='when ''listing_reviews'' then ''listing_review''';
  if strpos(definition,anchor)=0 then raise exception 'merchant review watch term anchor missing'; end if;
  execute replace(definition,anchor,anchor||' when ''merchant_reviews'' then ''merchant_review''');
  definition:=pg_get_functiondef('public.create_report(text,uuid,text,text)'::regprocedure);
  anchor:='else raise exception ''INVALID_TARGET_TYPE'';';
  if strpos(definition,anchor)=0 then raise exception 'merchant review report target anchor missing'; end if;
  execute replace(definition,anchor,$branch$
    when 'merchant_review' then select r.author_id into target_user_id from private.merchant_reviews r
      where r.id=target_id and (private.is_admin() or (r.status='published'
        and private.is_active_account(r.author_id) and not private.is_blocked_between(current_user_id,r.author_id)
        and ((r.receipt_status='verified' and exists(select 1 from private.merchant_posts mp where mp.merchant_id=r.merchant_id
          and private.merchant_review_merchant(mp.post_id,current_user_id)=r.merchant_id))
          or exists(select 1 from private.merchants m join public.profiles owner_profile on owner_profile.id=m.owner_id
            join auth.users owner_user on owner_user.id=m.owner_id
            where m.id=r.merchant_id and m.owner_id=current_user_id and m.owner_verified_at is not null
              and owner_profile.account_status='active' and owner_user.raw_app_meta_data->'merchant_enabled'='true'::jsonb
              and (owner_user.raw_app_meta_data->>'role' is distinct from 'admin' or private.is_admin())
              and not private.has_reported(current_user_id,'merchant_review',r.id)
              and not private.has_reported(current_user_id,'user',r.author_id)))));
    $branch$||anchor);
  definition:=pg_get_functiondef('private.capture_report_evidence()'::regprocedure);
  anchor:='case new.target_type';
  if strpos(definition,anchor)=0 then raise exception 'merchant review report evidence anchor missing'; end if;
  execute replace(definition,anchor,anchor||$branch$
    when 'merchant_review' then select (to_jsonb(r)-'receipt_path'-'receipt_reviewed_at'-'receipt_reviewed_by'-'receipt_review_note')
      ||jsonb_build_object('merchant_name',m.name) into new.evidence
      from private.merchant_reviews r join private.merchants m on m.id=r.merchant_id where r.id=new.target_id;
  $branch$);
  definition:=pg_get_functiondef('public.moderate_report(uuid,text,text)'::regprocedure);
  anchor:='case report.target_type';
  if strpos(definition,anchor)=0 then raise exception 'merchant review moderation anchor missing'; end if;
  execute replace(definition,anchor,anchor||' when ''merchant_review'' then update private.merchant_reviews set status=''removed'' where id=report.target_id;');
  definition:=pg_get_functiondef('public.export_admin_safety_evidence(bigint)'::regprocedure);
  anchor:='content := case a.target_type';
  if strpos(definition,anchor)=0 then raise exception 'merchant review safety evidence anchor missing'; end if;
  execute replace(definition,anchor,anchor||$branch$ when 'merchant_review' then
    (select to_jsonb(r)||jsonb_build_object('merchant_name',m.name) from private.merchant_reviews r
      join private.merchants m on m.id=r.merchant_id where r.id=a.target_id) $branch$);
end;
$$;
create trigger merchant_reviews_safety_review after insert or update of score,body on private.merchant_reviews
  for each row when(new.status='published') execute function private.enqueue_safety_review();
create trigger merchant_reviews_watch_terms after insert or update of score,body on private.merchant_reviews
  for each row when(new.status='published') execute function private.scan_watch_terms();

-- Existing account cleanup deletes storage bytes. Private feedback and receipt
-- references are erased here; report evidence follows the safety retention rule.
create function private.erase_deleted_merchant_reviews() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.merchant_reviews set body=null,status='removed',receipt_path=null,receipt_status='none',
    receipt_reviewed_at=null,receipt_reviewed_by=null,receipt_review_note=null where author_id=new.id;
  return new;
end;
$$;
revoke all on function private.erase_deleted_merchant_reviews() from public,anon,authenticated,service_role;
create trigger profiles_erase_merchant_reviews after update of account_status on public.profiles
  for each row when(new.account_status='deleted' and old.account_status is distinct from new.account_status)
  execute function private.erase_deleted_merchant_reviews();

notify pgrst,'reload schema';
