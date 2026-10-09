-- Existing rows and default RPCs stay usage reviews. Each account can keep one
-- separate employment review; publication still requires manual proof approval.
alter table private.merchant_reviews add column review_kind text not null default 'usage'
  check(review_kind in ('usage','employment'));
alter table private.merchant_reviews drop constraint merchant_reviews_merchant_id_author_id_key;
alter table private.merchant_reviews add constraint merchant_reviews_company_author_kind_key unique(merchant_id,author_id,review_kind);
drop index private.merchant_reviews_page_idx;
create index merchant_reviews_page_idx on private.merchant_reviews(merchant_id,review_kind,created_at desc,id desc) where status='published';

create function public.get_merchant_reviews(p_post_id uuid,p_offset integer,p_review_kind text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mid uuid; uid uuid:=auth.uid(); mine private.merchant_reviews; result jsonb;
begin
  if p_review_kind is null or p_review_kind not in ('usage','employment') then raise exception 'INVALID_REVIEW_KIND'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_REVIEW_OFFSET'; end if;
  mid:=private.merchant_review_merchant(p_post_id,uid);
  if mid is null then return null; end if;
  select * into mine from private.merchant_reviews where merchant_id=mid and author_id=uid and review_kind=p_review_kind;
  with visible as materialized (
    select r.* from private.merchant_reviews r where r.merchant_id=mid and r.review_kind=p_review_kind
      and r.status='published' and r.receipt_status='verified'
      and private.is_active_account(r.author_id) and not private.is_blocked_between(uid,r.author_id)
      and not private.has_reported(uid,'merchant_review',r.id) and not private.has_reported(uid,'user',r.author_id)
  ) select jsonb_build_object('merchant_id',mid,'merchant_name',(select name from private.merchants where id=mid),'review_kind',p_review_kind,
    'rating_average',(select avg(score) from visible),'review_count',(select count(*) from visible),
    'can_review',uid is not null and private.is_active_account(uid) and (mine.id is null or mine.status='published')
      and not exists(select 1 from private.merchants where id=mid and owner_id=uid),
    'my_review',case when mine.id is null then null else jsonb_build_object('id',mine.id,'author_id',mine.author_id,
      'nickname',(select nickname from public.profiles where id=uid),'score',mine.score,'body',mine.body,'status',mine.status,
      'review_kind',mine.review_kind,'receipt_path',mine.receipt_path,'receipt_status',mine.receipt_status,'receipt_review_note',mine.receipt_review_note,
      'created_at',mine.created_at,'updated_at',mine.updated_at) end,
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'author_id',r.author_id,
      'nickname',(select nickname from public.profiles where id=r.author_id),'score',r.score,'body',r.body,'review_kind',r.review_kind,
      'receipt_status',r.receipt_status,'created_at',r.created_at,'updated_at',r.updated_at) order by r.created_at desc,r.id desc)
      from (select * from visible order by created_at desc,id desc limit 20 offset p_offset)r),'[]'::jsonb),
    'has_more',(select count(*) from visible)>p_offset+20) into result;
  return result;
end;
$$;
create function public.write_merchant_review(p_post_id uuid,p_score numeric,p_body text,p_receipt_path text,p_review_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); mid uuid; mine private.merchant_reviews; body_text text:=nullif(btrim(p_body),''); next_path text; receipt_changed boolean;
begin
  if p_review_kind is null or p_review_kind not in ('usage','employment') then raise exception 'INVALID_REVIEW_KIND'; end if;
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':merchant_review',131));
  perform 1 from private.merchant_posts mp join private.merchants m on m.id=mp.merchant_id
    join public.posts p on p.id=mp.post_id join public.profiles author on author.id=p.author_id
    where p.id=p_post_id for share of mp,m,p,author;
  mid:=private.merchant_review_merchant(p_post_id,uid);
  if mid is null then raise exception 'MERCHANT_REVIEW_UNAVAILABLE'; end if;
  if exists(select 1 from private.merchants where id=mid and owner_id=uid) then raise exception 'MERCHANT_OWNER_REVIEW_FORBIDDEN'; end if;
  if p_score is null or p_score not between 1 and 10 or mod(p_score,0.5)<>0 then raise exception 'INVALID_REVIEW_SCORE'; end if;
  if char_length(body_text)>300 then raise exception 'INVALID_REVIEW_BODY'; end if;
  select * into mine from private.merchant_reviews where merchant_id=mid and author_id=uid and review_kind=p_review_kind for update;
  if mine.status='removed' then raise exception 'MERCHANT_REVIEW_REMOVED'; end if;
  next_path:=case when p_receipt_path is null then mine.receipt_path else nullif(p_receipt_path,'') end;
  if next_path is not null then perform private.assert_merchant_review_receipt(next_path,uid); end if;
  receipt_changed:=mine.receipt_path is distinct from next_path;
  if mine.id is not null and mine.score=p_score and mine.body is not distinct from body_text and not receipt_changed then return mine.id; end if;
  perform private.assert_content_allowed(coalesce(body_text,''));
  if mine.id is null then perform private.enforce_rate_limit('merchant_review_new',20,interval '1 day');
  else perform private.enforce_rate_limit('merchant_review_edit',10,interval '1 hour'); end if;
  insert into private.merchant_reviews(merchant_id,author_id,review_kind,score,body,receipt_path,receipt_status)
    values(mid,uid,p_review_kind,p_score,body_text,next_path,case when next_path is null then 'none' else 'pending' end)
  on conflict(merchant_id,author_id,review_kind) do update set score=excluded.score,body=excluded.body,receipt_path=excluded.receipt_path,
    receipt_status=case when receipt_changed then excluded.receipt_status else private.merchant_reviews.receipt_status end,
    receipt_reviewed_at=case when receipt_changed then null else private.merchant_reviews.receipt_reviewed_at end,
    receipt_reviewed_by=case when receipt_changed then null else private.merchant_reviews.receipt_reviewed_by end,
    receipt_review_note=case when receipt_changed then null else private.merchant_reviews.receipt_review_note end
  returning id into mid;
  return mid;
end;
$$;
create or replace function public.get_merchant_reviews(p_post_id uuid,p_offset integer default 0) returns jsonb
language sql stable security definer set search_path='' as $$
  select public.get_merchant_reviews(p_post_id,p_offset,'usage');
$$;
create or replace function public.write_merchant_review(p_post_id uuid,p_score numeric,p_body text default null,p_receipt_path text default null) returns uuid
language sql security definer set search_path='' as $$
  select public.write_merchant_review(p_post_id,p_score,p_body,p_receipt_path,'usage');
$$;
revoke all on function public.get_merchant_reviews(uuid,integer,text),public.write_merchant_review(uuid,numeric,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_reviews(uuid,integer,text) to anon,authenticated;
grant execute on function public.write_merchant_review(uuid,numeric,text,text,text) to authenticated;

create or replace function private.merchant_review_safety_content(p_target_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'authorId',r.author_id,'nickname',p.nickname,'reviewKind',r.review_kind,
    'text',concat_ws(E'\n',(case when r.review_kind='employment' then '근무 후기 · ' else '업체 후기 · ' end)||m.name,'점수 '||r.score::text||'/10',r.body),
    'merchantId',r.merchant_id,'merchantName',m.name,'score',r.score,'body',r.body,'status',r.status,
    'createdAt',r.created_at,'updatedAt',r.updated_at,'receiptPath',r.receipt_path,'receiptStatus',r.receipt_status,
    'receiptReviewedAt',r.receipt_reviewed_at,'receiptReviewedBy',r.receipt_reviewed_by,'receiptReviewNote',r.receipt_review_note)
  from private.merchant_reviews r join private.merchants m on m.id=r.merchant_id join public.profiles p on p.id=r.author_id
  where r.id=p_target_id;
$$;
create or replace function public.set_admin_merchant_review_receipt(p_target_id uuid,p_receipt_path text,p_updated_at timestamptz,p_verified boolean,p_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.merchant_reviews; review_note text:=btrim(coalesce(p_note,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_verified is null or char_length(review_note) not between 5 and 1000 then raise exception 'INVALID_RECEIPT_REVIEW'; end if;
  select * into r from private.merchant_reviews where id=p_target_id for update;
  if r.id is null or r.status<>'published' or r.receipt_path is null then raise exception 'RECEIPT_REVIEW_UNAVAILABLE'; end if;
  if p_receipt_path is distinct from r.receipt_path or p_updated_at is distinct from r.updated_at then raise exception 'MERCHANT_REVIEW_CHANGED'; end if;
  perform private.assert_merchant_review_receipt(r.receipt_path,r.author_id);
  update private.merchant_reviews set receipt_status=case when p_verified then 'verified' else 'rejected' end,
    receipt_reviewed_at=now(),receipt_reviewed_by=auth.uid(),receipt_review_note=review_note where id=r.id;
  perform public.log_admin_access('evidence',r.author_id,r.id);
  return private.merchant_review_safety_content(r.id);
end;
$$;

-- Preserve other live report and workspace behavior; drift fails closed.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_my_merchant_reviews(uuid,integer)'::regprocedure);
  anchor:='where r.merchant_id=m.id and r.status=''published''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'merchant review inbox visibility anchor changed'; end if;
  definition:=replace(definition,anchor,anchor||' and (r.review_kind=''usage'' or r.receipt_status=''verified'')');
  anchor:='''status'',r.status,''receipt_status'',r.receipt_status';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'merchant review inbox fields anchor changed'; end if;
  execute replace(definition,anchor,'''status'',r.status,''review_kind'',r.review_kind,''receipt_status'',r.receipt_status');
  definition:=pg_get_functiondef('public.create_report(text,uuid,text,text)'::regprocedure);
  anchor:='where m.id=r.merchant_id and m.owner_id=current_user_id and m.owner_verified_at is not null';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'merchant review owner report anchor changed'; end if;
  execute replace(definition,anchor,'where r.review_kind=''usage'' and m.id=r.merchant_id and m.owner_id=current_user_id and m.owner_verified_at is not null');
end;
$$;

notify pgrst,'reload schema';
