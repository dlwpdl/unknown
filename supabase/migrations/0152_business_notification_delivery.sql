-- Business producers use the existing notification inbox, queue and delivery budgets.
create function public.set_saved_merchant_notifications(p_merchant_id uuid,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if p_merchant_id is null or p_enabled is null then raise exception 'INVALID_SAVED_MERCHANT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_merchant_id::text,145));
  perform 1 from private.merchants where id=p_merchant_id for share;
  if public.get_merchant_profile(p_merchant_id) is null then raise exception 'MERCHANT_UNAVAILABLE'; end if;
  update private.saved_merchants set notifications_enabled=p_enabled where user_id=auth.uid() and merchant_id=p_merchant_id;
  if not found then raise exception 'SAVED_MERCHANT_REQUIRED'; end if;
  return p_enabled;
end;
$$;
revoke all on function public.set_saved_merchant_notifications(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_saved_merchant_notifications(uuid,boolean) to authenticated;

create function private.business_notification_owner(p_merchant_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select m.owner_id from private.merchants m join auth.users u on u.id=m.owner_id
  where m.id=p_merchant_id and m.owner_verified_at is not null and m.consent='granted' and m.status in ('trial','paid')
    and private.is_active_account(m.owner_id) and u.raw_app_meta_data->'merchant_enabled'='true'::jsonb;
$$;
create function private.saved_merchant_post_visible(p_user_id uuid,p_post_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.saved_merchants s join private.merchant_posts mp on mp.merchant_id=s.merchant_id
    where s.user_id=p_user_id and s.notifications_enabled and mp.post_id=p_post_id
      and private.is_active_account(p_user_id) and private.merchant_review_merchant(mp.post_id,p_user_id)=s.merchant_id
      and private.business_notification_owner(s.merchant_id) is not null
      and not private.is_blocked_between(p_user_id,private.business_notification_owner(s.merchant_id))
      and not private.has_reported(p_user_id,'user',private.business_notification_owner(s.merchant_id)));
$$;
create function private.merchant_review_owner_visible(p_user_id uuid,p_review_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.merchant_reviews r where r.id=p_review_id and r.review_kind='usage'
    and private.business_notification_owner(r.merchant_id)=p_user_id and private.merchant_review_visible_to(r.id,p_user_id));
$$;

create table private.merchant_operation_events(
  id uuid primary key default gen_random_uuid(), merchant_id uuid not null references private.merchants(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_id uuid not null, event_kind text not null check(event_kind in ('publish_failed','publish_uncertain','connection_unusable')),
  created_at timestamptz not null default clock_timestamp(), unique(source_id,event_kind)
);
alter table private.merchant_operation_events enable row level security;
revoke all on private.merchant_operation_events from public,anon,authenticated,service_role;
create index merchant_operation_owner_idx on private.merchant_operation_events(owner_id,merchant_id);
alter table private.merchant_naver_connections add column unusable_at timestamptz;
create unique index notifications_business_once_idx on public.notifications(user_id,kind,target_id)
  where kind in ('saved_merchant_post','merchant_review_received','merchant_operation');

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
  anchor:='''saved'',private.is_active_account(auth.uid()) and exists(select 1 from private.saved_merchants s where s.user_id=auth.uid() and s.merchant_id=m.id),';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'SAVED_MERCHANT_DTO_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n    ''notifications_enabled'',coalesce((select s.notifications_enabled from private.saved_merchants s where s.user_id=auth.uid() and s.merchant_id=m.id),false),');
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_target_type_check';
  if definition is null or left(definition,6)<>'CHECK ' then raise exception 'BUSINESS_TARGET_CHECK_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_target_type_check;
  execute 'alter table public.notifications add constraint notifications_target_type_check check(target_type=''merchant_operation'' or '||substring(definition from 7)||')';
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  anchor:='case p_kind';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_CATEGORY_MAP_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''saved_merchant_post'' then ''merchant_updates'' when ''merchant_review_received'' then ''merchant_reviews'' when ''merchant_operation'' then ''merchant_operations''');
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  anchor:='case p_target_type';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_TARGET_VISIBILITY_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||$gate$
    when 'merchant_operation' then exists(select 1 from private.merchant_operation_events e where e.id=p_target_id
      and e.owner_id=p_user_id and private.business_notification_owner(e.merchant_id)=p_user_id)$gate$);
  anchor:='when ''merchant_review'' then private.merchant_review_visible_to';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_REVIEW_VISIBILITY_CHANGED'; end if;
  execute replace(definition,anchor,'when ''merchant_review'' then private.merchant_review_owner_visible(p_user_id,p_target_id) or private.merchant_review_visible_to');
  definition:=pg_get_functiondef('private.can_read_notification(uuid,text,uuid,text,uuid)'::regprocedure);
  anchor:='and private.can_receive_notification';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_INBOX_GATE_CHANGED'; end if;
  execute replace(definition,anchor,$gate$and (p_category<>'merchant_updates' or private.saved_merchant_post_visible(p_user_id,p_target_id))
    and (not exists(select 1 from public.notifications n where n.user_id=p_user_id and n.target_id=p_target_id
      and n.target_type=p_target_type and n.kind='merchant_review_received') or private.merchant_review_owner_visible(p_user_id,p_target_id)) $gate$||anchor);
  definition:=pg_get_functiondef('private.push_notification_eligible(uuid,uuid)'::regprocedure);
  anchor:='and n.read_at is null';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_PUSH_GATE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$gate$
    and (n.kind<>'saved_merchant_post' or private.saved_merchant_post_visible(n.user_id,n.target_id))
    and (n.kind<>'merchant_review_received' or private.merchant_review_owner_visible(n.user_id,n.target_id))$gate$);
  definition:=pg_get_functiondef('public.get_merchant_naver_tokens(uuid,uuid)'::regprocedure);
  anchor:='where merchant_id=p_merchant_id and user_id=p_user_id';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NAVER_TOKEN_LOOKUP_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' and unusable_at is null');
  definition:=pg_get_functiondef('public.refresh_merchant_naver_tokens(uuid,uuid,uuid,text,timestamptz)'::regprocedure);
  anchor:='and generation=p_generation';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NAVER_REFRESH_GENERATION_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' and unusable_at is null');
  definition:=pg_get_functiondef('public.complete_merchant_naver_oauth(text,text,timestamptz)'::regprocedure);
  anchor:='do update set';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'NAVER_CONNECTION_UPSERT_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' unusable_at=null,');
end;
$$;

create function private.notify_saved_merchant_post(p_post_id uuid,p_publication boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare recipient record; cfg private.trending_config; p_now timestamptz:=clock_timestamp(); local_time timestamp;
begin
  select * into cfg from private.trending_config where id;
  if not found or not cfg.enabled then return; end if;
  -- Draft publish binds its request; same-transaction publication also qualifies. Late imports of old posts do not replay.
  for recipient in select s.user_id,c.timezone from private.saved_merchants s join public.profiles r on r.id=s.user_id
    join public.cities c on c.id=r.city_id join private.merchant_posts mp on mp.merchant_id=s.merchant_id
    join public.posts p on p.id=mp.post_id where p.id=p_post_id and s.notifications_enabled and (p_publication or mp.creation_request_id is not null or p.created_at>=transaction_timestamp())
      and (p_publication or s.created_at<=p.created_at) and private.saved_merchant_post_visible(s.user_id,p.id)
      and not exists(select 1 from auth.users u where u.id=p.author_id and (u.email like '%@seed.gling.invalid' or u.raw_app_meta_data->'review_access'='true'::jsonb)) loop
    perform pg_advisory_xact_lock(hashtextextended('recommendation:'||recipient.user_id::text,0));
    local_time:=p_now at time zone recipient.timezone;
    if (case when cfg.quiet_start_hour=cfg.quiet_end_hour then false
      when cfg.quiet_start_hour<cfg.quiet_end_hour then extract(hour from local_time)>=cfg.quiet_start_hour and extract(hour from local_time)<cfg.quiet_end_hour
      else extract(hour from local_time)>=cfg.quiet_start_hour or extract(hour from local_time)<cfg.quiet_end_hour end)
      or (select count(*) from public.notifications n where n.user_id=recipient.user_id
        and (n.category in ('trending','city_food','city_places','merchant_updates') or n.kind='trending_meetup')
        and (n.created_at at time zone recipient.timezone)::date=local_time::date)>=6
      or exists(select 1 from public.notifications n where n.user_id=recipient.user_id
        and (n.category in ('trending','city_food','city_places','merchant_updates') or n.kind='trending_meetup')
        and n.created_at>p_now-interval '30 minutes' and n.created_at<=p_now)
      or exists(select 1 from public.notifications n where n.user_id=recipient.user_id and n.target_type='post' and n.target_id=p_post_id
        and n.category in ('trending','city_food','city_places','merchant_updates','meetups','interests','nearby')
        and n.created_at>p_now-interval '7 days') then continue; end if;
    perform private.create_notification(recipient.user_id,'saved_merchant_post',null,'post',p_post_id,
      '저장한 업체에 새 소식이 올라왔습니다.','/post/'||p_post_id::text);
  end loop;
end;
$$;
create function private.notify_business_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_schema='private' then perform private.notify_saved_merchant_post(new.post_id);
  elsif new.status='published' and old.status is distinct from new.status then perform private.notify_saved_merchant_post(new.id,true); end if;
  return new;
end;
$$;
create trigger merchant_posts_notify_saved after insert on private.merchant_posts for each row execute function private.notify_business_publication();
create trigger posts_notify_saved_merchant after update of status on public.posts for each row execute function private.notify_business_publication();
create function private.notify_merchant_review_received() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  if new.status='published' and new.review_kind='usage' and (tg_op='INSERT' or old.status is distinct from new.status) then
    owner_id:=private.business_notification_owner(new.merchant_id);
    if private.merchant_review_owner_visible(owner_id,new.id) then
      perform private.create_notification(owner_id,'merchant_review_received',null,'merchant_review',new.id,
        '업체에 새 이용 후기가 도착했습니다.','/profile/merchant?merchant='||new.merchant_id::text);
    end if;
  end if;
  return new;
end;
$$;
create trigger merchant_reviews_notify_owner after insert or update of status on private.merchant_reviews for each row execute function private.notify_merchant_review_received();
create function private.create_merchant_operation_event(p_merchant_id uuid,p_source_id uuid,p_event_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; event_id uuid;
begin
  owner_id:=private.business_notification_owner(p_merchant_id);
  if owner_id is null then return; end if;
  insert into private.merchant_operation_events(merchant_id,owner_id,source_id,event_kind) values(p_merchant_id,owner_id,p_source_id,p_event_kind)
    on conflict do nothing returning id into event_id;
  if event_id is not null then perform private.create_notification(owner_id,'merchant_operation',null,'merchant_operation',event_id,
    case p_event_kind when 'connection_unusable' then '외부 서비스 연결을 다시 확인해 주세요.'
      when 'publish_uncertain' then '게시 결과를 확인해야 합니다. 다시 게시하기 전에 확인해 주세요.' else '게시를 완료하지 못했습니다. 업체 작업에서 확인해 주세요.' end,
    '/profile/merchant?merchant='||p_merchant_id::text); end if;
end;
$$;
create function private.notify_merchant_publish_problem() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='in_flight' and new.status in ('failed','uncertain') and new.error_code is distinct from 'NAVER_PREPARATION_CANCELLED' then
    perform private.create_merchant_operation_event(new.merchant_id,new.id,'publish_'||new.status);
  end if;
  return new;
end;
$$;
create trigger merchant_naver_notify_problem after update of status on private.merchant_naver_requests for each row execute function private.notify_merchant_publish_problem();
create function public.mark_merchant_naver_connection_unusable(p_merchant_id uuid,p_user_id uuid,p_generation uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  perform private.assert_naver_merchant(p_merchant_id,p_user_id);
  update private.merchant_naver_connections set unusable_at=clock_timestamp(),expires_at=least(expires_at,clock_timestamp())
    where merchant_id=p_merchant_id and user_id=p_user_id and generation=p_generation and unusable_at is null;
  if not found then return false; end if;
  perform private.create_merchant_operation_event(p_merchant_id,p_generation,'connection_unusable');
  return true;
end;
$$;
revoke all on function public.mark_merchant_naver_connection_unusable(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.mark_merchant_naver_connection_unusable(uuid,uuid,uuid) to service_role;
revoke all on function private.business_notification_owner(uuid),private.saved_merchant_post_visible(uuid,uuid),private.merchant_review_owner_visible(uuid,uuid),
 private.notify_saved_merchant_post(uuid,boolean),private.notify_business_publication(),private.notify_merchant_review_received(),
 private.create_merchant_operation_event(uuid,uuid,text),private.notify_merchant_publish_problem() from public,anon,authenticated,service_role;
alter table private.merchant_operation_events owner to postgres;
do $$
declare signature text;
begin
  foreach signature in array array['public.set_saved_merchant_notifications(uuid,boolean)',
    'private.business_notification_owner(uuid)','private.saved_merchant_post_visible(uuid,uuid)','private.merchant_review_owner_visible(uuid,uuid)',
    'private.notify_saved_merchant_post(uuid,boolean)','private.notify_business_publication()','private.notify_merchant_review_received()',
    'private.create_merchant_operation_event(uuid,uuid,text)','private.notify_merchant_publish_problem()',
    'public.mark_merchant_naver_connection_unusable(uuid,uuid,uuid)',
    'public.get_merchant_profile(uuid)','private.notification_category(text,text)',
    'private.notification_target_visible(uuid,text,uuid)','private.can_read_notification(uuid,text,uuid,text,uuid)',
    'private.push_notification_eligible(uuid,uuid)','public.get_merchant_naver_tokens(uuid,uuid)',
    'public.refresh_merchant_naver_tokens(uuid,uuid,uuid,text,timestamptz)','public.complete_merchant_naver_oauth(text,text,timestamptz)'] loop
    execute 'alter function '||signature||' owner to postgres';
  end loop;
end;
$$;
notify pgrst,'reload schema';
