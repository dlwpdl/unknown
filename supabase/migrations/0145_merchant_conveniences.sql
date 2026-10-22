-- Explicit business contact is independent of private registration notes.
alter table private.merchants
  add column public_phone text not null default '' check(char_length(public_phone)<=40 and (public_phone='' or
    (public_phone ~ '^\+?[0-9() .-]+$' and char_length(regexp_replace(public_phone,'[^0-9]','','g')) between 7 and 15))),
  add column business_hours text not null default '' check(char_length(business_hours)<=500);
create table private.saved_merchants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  merchant_id uuid not null references private.merchants(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(), primary key(user_id,merchant_id)
);
create index saved_merchants_page_idx on private.saved_merchants(user_id,created_at desc,merchant_id desc);
create index saved_merchants_merchant_idx on private.saved_merchants(merchant_id);
-- A reply has its own safety/report target, attributed to the business actor.
-- Its id is the review id, so clients need no private account or second target id.
create table private.merchant_review_replies (
  id uuid primary key references private.merchant_reviews(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text check(body is null or char_length(btrim(body)) between 1 and 300),
  status text not null default 'published' check(status in ('published','removed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(status='removed' or body is not null)
);
create index merchant_review_replies_author_idx on private.merchant_review_replies(author_id);
alter table private.saved_merchants enable row level security;
alter table private.merchant_review_replies enable row level security;
revoke all on private.saved_merchants,private.merchant_review_replies from public,anon,authenticated,service_role;
alter table private.saved_merchants owner to postgres;
alter table private.merchant_review_replies owner to postgres;

create function private.merchant_message_owner(p_merchant_id uuid,p_viewer uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select m.owner_id from private.merchants m join public.profiles p on p.id=m.owner_id join auth.users u on u.id=p.id
  where m.id=p_merchant_id and m.consent='granted' and m.status in ('trial','paid') and m.owner_verified_at is not null
    and p.account_status='active' and u.raw_app_meta_data->'merchant_enabled'='true'::jsonb
    and (p_viewer is null or (p_viewer<>m.owner_id and private.is_active_account(p_viewer)))
    and not private.is_blocked_between(p_viewer,m.owner_id) and not private.has_reported(p_viewer,'user',m.owner_id);
$$;

-- Extend the installed DTOs without reverting public source links or company access.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
  anchor:='''industry'',m.industry,''services'',m.services,''address'',m.address,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_PROFILE_FIELDS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$fields$
    'public_phone',m.public_phone,'business_hours',m.business_hours,
    'can_message',private.merchant_message_owner(m.id,auth.uid()) is not null,
    'saved',private.is_active_account(auth.uid()) and exists(select 1 from private.saved_merchants s where s.user_id=auth.uid() and s.merchant_id=m.id),$fields$);
  definition:=pg_get_functiondef('public.get_my_merchant_profile(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MY_MERCHANT_PROFILE_FIELDS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$fields$
    'public_phone',m.public_phone,'business_hours',m.business_hours,
    'can_message',coalesce((public.get_merchant_profile(m.id)->>'can_message')::boolean,false),
    'saved',exists(select 1 from private.saved_merchants s where s.user_id=auth.uid() and s.merchant_id=m.id),$fields$);
end;
$$;

create function public.start_merchant_conversation(p_merchant_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); recipient uuid; m private.merchants;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Conversation and account erasure already use this lock before profile rows.
  perform private.lock_relationships();
  perform private.assert_active_account(uid);
  select owner_id into recipient from private.merchants where id=p_merchant_id;
  perform 1 from public.profiles where id in(uid,recipient) order by id for share;
  perform 1 from auth.users where id in(uid,recipient) order by id for share;
  select * into m from private.merchants where id=p_merchant_id for share;
  perform 1 from private.merchant_posts mp join public.posts p on p.id=mp.post_id
    join public.profiles author on author.id=p.author_id where mp.merchant_id=m.id for share of mp,p,author;
  if m.owner_id is distinct from recipient or public.get_merchant_profile(m.id) is null
    or private.merchant_message_owner(m.id,uid) is null then raise exception 'MERCHANT_CONTACT_UNAVAILABLE'; end if;
  return public.start_conversation(recipient,null);
end;
$$;
create function public.set_saved_merchant(p_merchant_id uuid,p_saved boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=uid and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  if p_merchant_id is null or p_saved is null then raise exception 'INVALID_SAVED_MERCHANT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text||':'||p_merchant_id::text,145));
  if not p_saved then delete from private.saved_merchants where user_id=uid and merchant_id=p_merchant_id; return false; end if;
  perform 1 from private.merchants where id=p_merchant_id for share;
  perform 1 from private.merchant_posts mp join public.posts p on p.id=mp.post_id
    join public.profiles author on author.id=p.author_id where mp.merchant_id=p_merchant_id for share of mp,p,author;
  if public.get_merchant_profile(p_merchant_id) is null then raise exception 'MERCHANT_UNAVAILABLE'; end if;
  insert into private.saved_merchants(user_id,merchant_id) values(uid,p_merchant_id) on conflict do nothing;
  return true;
end;
$$;
create function public.get_saved_merchants(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'INVALID_MERCHANT_OFFSET'; end if;
  with visible as materialized (
    select s.created_at,s.merchant_id,p.profile from private.saved_merchants s
    cross join lateral (select public.get_merchant_profile(s.merchant_id) profile)p
    where s.user_id=auth.uid() and p.profile is not null
    order by s.created_at desc,s.merchant_id desc limit 21 offset p_offset
  ) select jsonb_build_object('merchants',coalesce((select jsonb_agg(profile order by created_at desc,merchant_id desc)
    from (select * from visible order by created_at desc,merchant_id desc limit 20)page),'[]'::jsonb),
    'has_more',(select count(*) from visible)>20) into result;
  return result;
end;
$$;
create function public.save_merchant_contact(p_merchant_id uuid,p_public_phone text,p_business_hours text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
  trim_chars text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  phone text:=btrim(p_public_phone,trim_chars); hours text:=btrim(p_business_hours,trim_chars);
begin
  m:=private.lock_merchant_profile_owner(p_merchant_id,true);
  if phone is null or hours is null or char_length(phone)>40 or char_length(hours)>500 or (phone<>'' and
    (phone !~ '^\+?[0-9() .-]+$' or char_length(regexp_replace(phone,'[^0-9]','','g')) not between 7 and 15))
    then raise exception 'INVALID_MERCHANT_CONTACT'; end if;
  if m.public_phone=phone and m.business_hours=hours then return public.get_my_merchant_profile(m.id); end if;
  if p_expected_updated_at is distinct from m.updated_at then raise exception 'MERCHANT_PROFILE_CHANGED'; end if;
  update private.merchants set public_phone=phone,business_hours=hours,updated_at=clock_timestamp() where id=m.id;
  return public.get_my_merchant_profile(m.id);
end;
$$;

-- Private usage text is visible to its author and current verified company readers;
-- everyone else still requires a verified proof and an actual public introduction.
create function private.merchant_review_visible_to(p_review_id uuid,p_viewer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.merchant_reviews r join private.merchants m on m.id=r.merchant_id
    where r.id=p_review_id and r.status='published' and private.is_active_account(r.author_id)
      and not private.is_blocked_between(p_viewer,r.author_id)
      and not private.has_reported(p_viewer,'merchant_review',r.id) and not private.has_reported(p_viewer,'user',r.author_id)
      and ((r.author_id=p_viewer and private.is_active_account(p_viewer))
        or (r.receipt_status='verified' and exists(select 1 from private.merchant_posts mp where mp.merchant_id=m.id
          and private.merchant_review_merchant(mp.post_id,p_viewer)=m.id))
        or (r.review_kind='usage' and m.owner_verified_at is not null and private.is_active_account(p_viewer)
          and exists(select 1 from auth.users u where u.id=p_viewer and u.raw_app_meta_data->'merchant_enabled'='true'::jsonb)
          and (m.owner_id=p_viewer or exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=p_viewer)))));
$$;
create function private.merchant_review_reply_visible(p_review_id uuid,p_viewer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.merchant_review_replies reply join private.merchant_reviews r on r.id=reply.id
    join private.merchants m on m.id=r.merchant_id
    where reply.id=p_review_id and reply.status='published' and r.review_kind='usage'
      and private.merchant_review_visible_to(r.id,p_viewer) and private.is_active_account(reply.author_id)
      and m.owner_verified_at is not null and private.is_active_account(m.owner_id)
      and not private.is_blocked_between(p_viewer,reply.author_id) and not private.is_blocked_between(r.author_id,m.owner_id)
      and not private.is_blocked_between(r.author_id,reply.author_id)
      and not private.has_reported(p_viewer,'merchant_review_reply',reply.id) and not private.has_reported(p_viewer,'user',reply.author_id));
$$;
create function private.merchant_review_reply_json(p_review_id uuid,p_viewer uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('body',r.body,'created_at',r.created_at,'updated_at',r.updated_at)
    from private.merchant_review_replies r where r.id=p_review_id and private.merchant_review_reply_visible(r.id,p_viewer);
$$;
create function public.reply_to_merchant_review(p_merchant_id uuid,p_review_id uuid,p_body text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; r private.merchant_reviews; reply private.merchant_review_replies;
  body_text text:=btrim(p_body,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\2028\2029\202F\205F\3000\FEFF');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Keep deletion, moderation and reply writes in the existing lock order.
  perform private.lock_relationships();
  perform 1 from public.profiles where id=auth.uid() or id=(select author_id from private.merchant_reviews where id=p_review_id)
    or id=(select owner_id from private.merchants where id=p_merchant_id) order by id for share;
  m:=private.lock_merchant_profile_owner(p_merchant_id,true);
  select * into r from private.merchant_reviews where id=p_review_id and merchant_id=m.id for update;
  if r.id is null or r.review_kind<>'usage' or not private.merchant_review_visible_to(r.id,auth.uid())
    or m.owner_verified_at is null or not private.is_active_account(m.owner_id)
    or private.is_blocked_between(r.author_id,m.owner_id) or private.is_blocked_between(r.author_id,auth.uid())
    or private.has_reported(r.author_id,'user',auth.uid()) or private.has_reported(r.author_id,'user',m.owner_id)
    then raise exception 'MERCHANT_REVIEW_REPLY_UNAVAILABLE'; end if;
  if body_text is null or char_length(body_text) not between 1 and 300 then raise exception 'INVALID_MERCHANT_REVIEW_REPLY'; end if;
  select * into reply from private.merchant_review_replies where id=r.id for update;
  if reply.status='removed' then raise exception 'MERCHANT_REVIEW_REPLY_UNAVAILABLE'; end if;
  if reply.body is not distinct from body_text then
    return jsonb_build_object('body',reply.body,'created_at',reply.created_at,'updated_at',reply.updated_at);
  end if;
  if p_expected_updated_at is distinct from reply.updated_at then raise exception 'MERCHANT_REVIEW_REPLY_CHANGED'; end if;
  perform private.assert_content_allowed(body_text);
  if reply.id is null then perform private.enforce_rate_limit('merchant_review_reply_new',20,interval '1 day');
  else perform private.enforce_rate_limit('merchant_review_reply_edit',10,interval '1 hour'); end if;
  insert into private.merchant_review_replies(id,author_id,body) values(r.id,auth.uid(),body_text)
    on conflict(id) do update set author_id=excluded.author_id,body=excluded.body,updated_at=clock_timestamp()
    returning * into reply;
  return jsonb_build_object('body',reply.body,'created_at',reply.created_at,'updated_at',reply.updated_at);
end;
$$;

create function private.merchant_review_reply_safety_content(p_target_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',reply.id,'reviewId',r.id,'authorId',reply.author_id,'nickname',p.nickname,
    'text',concat_ws(E'\n','업체 이용 후기 답변 · '||m.name,reply.body),'merchantId',m.id,'merchantName',m.name,
    'body',reply.body,'status',reply.status,'createdAt',reply.created_at,'updatedAt',reply.updated_at)
  from private.merchant_review_replies reply join private.merchant_reviews r on r.id=reply.id
    join private.merchants m on m.id=r.merchant_id join public.profiles p on p.id=reply.author_id where reply.id=p_target_id;
$$;
create function public.get_merchant_review_reply_safety_content(p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  return private.merchant_review_reply_safety_content(p_target_id);
end;
$$;
create function public.get_admin_merchant_review_reply_content(p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare content jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  content:=private.merchant_review_reply_safety_content(p_target_id);
  perform public.log_admin_access('safety',(content->>'authorId')::uuid,p_target_id);
  return content;
end;
$$;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_merchant_reviews(uuid,integer,text)'::regprocedure);
  anchor:='''created_at'',mine.created_at';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MY_MERCHANT_REVIEW_FIELDS_CHANGED'; end if;
  definition:=replace(definition,anchor,'''reply'',private.merchant_review_reply_json(mine.id,uid),'||anchor);
  anchor:='''created_at'',r.created_at';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REVIEW_FIELDS_CHANGED'; end if;
  execute replace(definition,anchor,'''reply'',private.merchant_review_reply_json(r.id,uid),'||anchor);
  definition:=pg_get_functiondef('public.get_my_merchant_reviews(uuid,integer)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MY_MERCHANT_INBOX_FIELDS_CHANGED'; end if;
  definition:=replace(definition,anchor,'''reply'',private.merchant_review_reply_json(r.id,uid),'||anchor);
  anchor:=$guard$m:=private.assert_merchant_workspace(p_merchant_id,false);
  if m.owner_id is distinct from uid then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  if not exists(select 1 from auth.users where id=uid and raw_app_meta_data->'merchant_enabled'='true'::jsonb) then raise exception 'MERCHANT_ACCOUNT_REQUIRED'; end if;$guard$;
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_INBOX_ACCESS_CHANGED'; end if;
  execute replace(definition,anchor,'m:=private.lock_merchant_profile_owner(p_merchant_id);');
  definition:=pg_get_functiondef('private.merchant_review_safety_content(uuid)'::regprocedure);
  anchor:='''receiptReviewedAt'',r.receipt_reviewed_at';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_SAFETY_FIELDS_CHANGED'; end if;
  execute replace(definition,anchor,'''reply'',private.merchant_review_reply_safety_content(r.id),'||anchor);
end;
$$;

-- Extend live safety, moderation and notification constraints; preserve every old target.
do $$
declare table_name text; definition text;
begin
  foreach table_name in array array['reports','safety_review_queue','safety_alerts','notifications'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint
      where conrelid=('public.'||table_name)::regclass and conname=table_name||'_target_type_check';
    if definition is null or left(definition,6)<>'CHECK ' then raise exception 'MERCHANT_REPLY_TARGETS_CHANGED'; end if;
    execute format('alter table public.%I drop constraint %I',table_name,table_name||'_target_type_check');
    execute format('alter table public.%I add constraint %I check(target_type=''merchant_review_reply'' or %s)',
      table_name,table_name||'_target_type_check',substring(definition from 7));
  end loop;
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null then raise exception 'MERCHANT_NOTIFICATION_KINDS_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check check(kind in (''merchant_review_verified'',''merchant_review_rejected'',''merchant_review_reply'') or '
    ||substring(definition from 7)||')';
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_category_check';
  if definition is null then raise exception 'MERCHANT_NOTIFICATION_CATEGORIES_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_category_check;
  execute 'alter table public.notifications add constraint notifications_category_check check(category=''merchant_reviews'' or '||substring(definition from 7)||')';
end;
$$;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.enqueue_safety_review()'::regprocedure);
  anchor:='when ''merchant_reviews'' then ''merchant_review''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REPLY_QUEUE_TARGET_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||' when ''merchant_review_replies'' then ''merchant_review_reply''');
  anchor:='when ''merchant_reviews'' then private.merchant_review_safety_content(new.id)->>''text''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REPLY_QUEUE_CONTENT_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''merchant_review_replies'' then private.merchant_review_reply_safety_content(new.id)->>''text''');
  definition:=pg_get_functiondef('private.scan_watch_terms()'::regprocedure);
  anchor:='when ''merchant_reviews'' then ''merchant_review''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REPLY_KEYWORD_TARGET_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''merchant_review_replies'' then ''merchant_review_reply''');
  definition:=pg_get_functiondef('public.create_report(text,uuid,text,text)'::regprocedure);
  anchor:='else raise exception ''INVALID_TARGET_TYPE'';';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REPLY_REPORT_CHANGED'; end if;
  execute replace(definition,anchor,$branch$
    when 'merchant_review_reply' then select r.author_id into target_user_id from private.merchant_review_replies r
      where r.id=target_id and (private.is_admin() or private.merchant_review_reply_visible(r.id,current_user_id));
    $branch$||anchor);
  definition:=pg_get_functiondef('private.capture_report_evidence()'::regprocedure);
  anchor:='case new.target_type';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REPLY_REPORT_EVIDENCE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$
    when 'merchant_review_reply' then select to_jsonb(reply)||jsonb_build_object('merchant_id',r.merchant_id,'merchant_name',m.name) into new.evidence
      from private.merchant_review_replies reply join private.merchant_reviews r on r.id=reply.id
        join private.merchants m on m.id=r.merchant_id where reply.id=new.target_id;
    $branch$);
  definition:=pg_get_functiondef('public.moderate_report(uuid,text,text)'::regprocedure);
  anchor:='case report.target_type';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REPLY_MODERATION_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''merchant_review_reply'' then update private.merchant_review_replies set status=''removed'',updated_at=clock_timestamp() where id=report.target_id;');
  definition:=pg_get_functiondef('public.export_admin_safety_evidence(bigint)'::regprocedure);
  anchor:='content := case a.target_type';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_REPLY_SAFETY_EXPORT_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$ when 'merchant_review_reply' then
    (select to_jsonb(reply)||jsonb_build_object('merchant_id',r.merchant_id,'merchant_name',m.name) from private.merchant_review_replies reply
      join private.merchant_reviews r on r.id=reply.id join private.merchants m on m.id=r.merchant_id where reply.id=a.target_id) $branch$);
end;
$$;
create trigger merchant_review_replies_safety_review after insert or update of body on private.merchant_review_replies
  for each row when(new.status='published') execute function private.enqueue_safety_review();
create trigger merchant_review_replies_watch_terms after insert or update of body on private.merchant_review_replies
  for each row when(new.status='published') execute function private.scan_watch_terms();

alter table public.notification_preferences add column merchant_reviews boolean not null default true;
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_notification_preferences()'::regprocedure);
  anchor:='"push_enabled":false';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_NOTIFICATION_DEFAULTS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||',"merchant_reviews":true');
  definition:=pg_get_functiondef('public.update_notification_preferences(jsonb)'::regprocedure);
  anchor:='''weekly_ranking'',''push_enabled''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_NOTIFICATION_ALLOWLIST_CHANGED'; end if;
  definition:=replace(definition,anchor,'''weekly_ranking'',''merchant_reviews'',''push_enabled''');
  anchor:='weekly_ranking = coalesce((p_preferences->>''weekly_ranking'')::boolean, p.weekly_ranking),';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_NOTIFICATION_UPDATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n    merchant_reviews = coalesce((p_preferences->>''merchant_reviews'')::boolean, p.merchant_reviews),');
  definition:=pg_get_functiondef('private.can_receive_notification(uuid,text,uuid)'::regprocedure);
  anchor:='p_category in (';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_NOTIFICATION_GATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'''merchant_reviews'',');
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  anchor:='case p_kind';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_NOTIFICATION_KIND_MAP_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''merchant_review_verified'' then ''merchant_reviews'' when ''merchant_review_rejected'' then ''merchant_reviews'' when ''merchant_review_reply'' then ''merchant_reviews''');
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  anchor:='case p_target_type';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_NOTIFICATION_VISIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$targets$
    when 'merchant_review' then private.merchant_review_visible_to(p_target_id,p_user_id) and exists(
      select 1 from private.merchant_reviews r join private.merchant_posts mp on mp.merchant_id=r.merchant_id
      where r.id=p_target_id and private.merchant_review_merchant(mp.post_id,p_user_id)=r.merchant_id)
    when 'merchant_review_reply' then private.merchant_review_reply_visible(p_target_id,p_user_id) and exists(
      select 1 from private.merchant_reviews r join private.merchant_posts mp on mp.merchant_id=r.merchant_id
      where r.id=p_target_id and private.merchant_review_merchant(mp.post_id,p_user_id)=r.merchant_id)$targets$);
end;
$$;
create function private.notify_merchant_review_result() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='published' and new.receipt_status in ('verified','rejected') and old.receipt_status is distinct from new.receipt_status then
    perform private.create_notification(new.author_id,'merchant_review_'||case when new.receipt_status='verified' then 'verified' else 'rejected' end,
      null,'merchant_review',new.id,case when new.receipt_status='verified' then '후기 증빙 인증이 승인되었습니다.'
        else '후기 증빙 인증이 반려되었습니다. 본인 후기에서 사유를 확인해 주세요.' end,
      '/company/'||new.merchant_id::text||'?review='||new.review_kind);
  end if;
  return new;
end;
$$;
create trigger merchant_reviews_notify_result after update of receipt_status on private.merchant_reviews
  for each row execute function private.notify_merchant_review_result();
create function private.notify_merchant_review_reply() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.merchant_reviews;
begin
  select * into r from private.merchant_reviews where id=new.id;
  perform private.create_notification(r.author_id,'merchant_review_reply',null,'merchant_review_reply',new.id,
    '이용 후기에 업체 답변이 도착했습니다.','/company/'||r.merchant_id::text||'?review=usage');
  return new;
end;
$$;
create trigger merchant_review_replies_notify after insert on private.merchant_review_replies
  for each row execute function private.notify_merchant_review_reply();

create function private.erase_deleted_merchant_conveniences() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from private.saved_merchants where user_id=new.id;
  update private.merchant_review_replies reply set body=null,status='removed',updated_at=clock_timestamp()
    where reply.author_id=new.id or exists(select 1 from private.merchant_reviews r where r.id=reply.id and r.author_id=new.id);
  return new;
end;
$$;
create trigger profiles_erase_merchant_conveniences after update of account_status on public.profiles
  for each row when(new.account_status='deleted' and old.account_status is distinct from new.account_status)
  execute function private.erase_deleted_merchant_conveniences();

revoke all on function private.merchant_message_owner(uuid,uuid),private.merchant_review_visible_to(uuid,uuid),
  private.merchant_review_reply_visible(uuid,uuid),private.merchant_review_reply_json(uuid,uuid),private.merchant_review_reply_safety_content(uuid),
  private.notify_merchant_review_result(),private.notify_merchant_review_reply(),private.erase_deleted_merchant_conveniences()
  from public,anon,authenticated,service_role;
-- Older installations may own this shared helper with the maintenance role.
grant execute on function private.lock_merchant_profile_owner(uuid,boolean) to postgres;
revoke all on function public.start_merchant_conversation(uuid),public.set_saved_merchant(uuid,boolean),public.get_saved_merchants(integer),
  public.save_merchant_contact(uuid,text,text,timestamptz),public.reply_to_merchant_review(uuid,uuid,text,timestamptz),
  public.get_merchant_review_reply_safety_content(uuid),public.get_admin_merchant_review_reply_content(uuid) from public,anon,authenticated,service_role;
grant execute on function public.start_merchant_conversation(uuid),public.set_saved_merchant(uuid,boolean),public.get_saved_merchants(integer),
  public.save_merchant_contact(uuid,text,text,timestamptz),public.reply_to_merchant_review(uuid,uuid,text,timestamptz),
  public.get_admin_merchant_review_reply_content(uuid) to authenticated;
grant execute on function public.get_merchant_review_reply_safety_content(uuid) to service_role;
do $$
declare signature text;
begin
  foreach signature in array array[
    'private.merchant_message_owner(uuid,uuid)','private.merchant_review_visible_to(uuid,uuid)',
    'private.merchant_review_reply_visible(uuid,uuid)','private.merchant_review_reply_json(uuid,uuid)','private.merchant_review_reply_safety_content(uuid)',
    'private.notify_merchant_review_result()','private.notify_merchant_review_reply()','private.erase_deleted_merchant_conveniences()',
    'public.start_merchant_conversation(uuid)','public.set_saved_merchant(uuid,boolean)','public.get_saved_merchants(integer)',
    'public.save_merchant_contact(uuid,text,text,timestamp with time zone)','public.reply_to_merchant_review(uuid,uuid,text,timestamp with time zone)',
    'public.get_merchant_review_reply_safety_content(uuid)','public.get_admin_merchant_review_reply_content(uuid)'
  ] loop execute 'alter function '||signature||' owner to postgres'; end loop;
end;
$$;
notify pgrst,'reload schema';
