-- Reuse the durable notification/push queue; no AI worker, polling job or approval action.
create function private.admin_meetup_alert_visible(p_admin uuid,p_request uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.meetup_requests r
  join public.posts p on p.id=r.post_id and p.author_id=r.host_id
  join public.profiles host on host.id=r.host_id
  join auth.users host_auth on host_auth.id=host.id
  join public.profiles requester on requester.id=r.requester_id
  join auth.users requester_auth on requester_auth.id=requester.id
  join public.profiles admin on admin.id=p_admin
  join auth.users admin_auth on admin_auth.id=admin.id
  where r.id=p_request and r.status='pending' and r.created_at<=p_created_at
   and admin_auth.raw_app_meta_data->>'role'='admin' and admin.account_status='active' and admin.deleted_at is null
   and admin.id<>r.host_id and p.status='published' and p.deleted_at is null and p.room_preview is not null
   and (p.expires_at is null or p.expires_at>now()) and coalesce(p.room_preview->>'closed','false')<>'true'
   and (p.room_preview->>'eventKind' is distinct from 'once' or (p.room_preview->>'endsAt')::timestamptz>now())
   and host.account_status='active' and host.deleted_at is null
   and (host_auth.raw_app_meta_data->>'role'='admin' or (
    coalesce(host_auth.raw_app_meta_data->>'role','member') not in ('admin','review','reviewer','bot','seed','test','tester','system')
    and coalesce(host_auth.raw_app_meta_data->'review_access','false'::jsonb)<>'true'::jsonb
    and host_auth.raw_app_meta_data->'gling_persona'->>'kind'='gling_operated_character'
    and host_auth.raw_app_meta_data->'gling_persona'->>'version'='4'
    and host_auth.raw_app_meta_data->'gling_persona'->>'profile_id'=host.id::text
    and host_auth.raw_app_meta_data->'gling_persona'->>'city_id'=host.city_id
    and (host_auth.raw_app_meta_data->'gling_persona') ?& array['living','background','values','personality','interests','writing_purpose','voice','continuity']
    and not exists(select 1 from jsonb_each(case when jsonb_typeof(host_auth.raw_app_meta_data->'gling_persona')='object'
      then host_auth.raw_app_meta_data->'gling_persona' else '{}'::jsonb end) d
      where d.key=any(array['living','background','values','personality','interests','writing_purpose','voice','continuity'])
       and d.value in ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb))))
   and requester.account_status='active' and requester.deleted_at is null and not coalesce(requester_auth.is_anonymous,false)
   and coalesce(requester_auth.email,'') not like '%@seed.gling.invalid'
   and coalesce(requester_auth.raw_app_meta_data->>'role','member') not in ('admin','review','reviewer','bot','seed','test','tester','system')
   and coalesce(requester_auth.raw_app_meta_data->'review_access','false'::jsonb)<>'true'::jsonb
   and requester_auth.raw_app_meta_data->'gling_persona' is null
   and not private.is_blocked_between(r.host_id,r.requester_id)
 );
$$;
revoke all on function private.admin_meetup_alert_visible(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
create function private.can_read_admin_meetup_alert(p_admin uuid,p_request uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select (p_admin=auth.uid() or private.is_admin())
  and private.admin_meetup_alert_visible(p_admin,p_request,p_created_at);
$$;
revoke all on function private.can_read_admin_meetup_alert(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.can_read_admin_meetup_alert(uuid,uuid,timestamptz) to authenticated;

do $$
declare definition text; anchor text;
begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
 if definition is null or definition not like 'CHECK (%' then raise exception 'ADMIN_MEETUP_KIND_CHANGED'; end if;
 alter table public.notifications drop constraint notifications_kind_check;
 execute 'alter table public.notifications add constraint notifications_kind_check '||
  replace(definition,'CHECK (','CHECK (kind = ''admin_meetup_request'' or ');

 definition:=pg_get_functiondef('private.filter_notification()'::regprocedure);
 anchor:='new.category := private.notification_category(new.kind, new.target_type);';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'ADMIN_MEETUP_FILTER_CHANGED'; end if;
 execute replace(definition,anchor,anchor||E'\n  if new.kind=''admin_meetup_request'' and (new.target_type<>''meetup_request'' or not private.admin_meetup_alert_visible(new.user_id,new.target_id,new.created_at)) then return null; end if;');

 definition:=pg_get_functiondef('private.push_notification_eligible(uuid,uuid)'::regprocedure);
 anchor:='and n.read_at is null';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'ADMIN_MEETUP_PUSH_CHANGED'; end if;
 execute replace(definition,anchor,anchor||E'\n      and (n.kind<>''admin_meetup_request'' or (n.target_type=''meetup_request'' and private.admin_meetup_alert_visible(n.user_id,n.target_id,n.created_at)))');
end;
$$;

-- The personal security-invoker inbox and raw table both recheck role/source at read time.
create policy admin_meetup_alert_current on public.notifications as restrictive for select to authenticated
 using(kind<>'admin_meetup_request' or (target_type='meetup_request' and private.can_read_admin_meetup_alert(user_id,target_id,created_at)));

create function private.notify_admin_meetup_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.status='pending' then return new; end if;
 insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at)
 select admin.id,'admin_meetup_request','meetup_request',new.id,
  left(requester.nickname::text||'님이 운영 모임 「'||left(p.title,120)||'」에 참여를 신청했어요.',300),
  '/admin?section=posts',clock_timestamp()
 from public.profiles admin join auth.users u on u.id=admin.id
 join public.posts p on p.id=new.post_id
 join public.profiles requester on requester.id=new.requester_id
 where u.raw_app_meta_data->>'role'='admin' and admin.account_status='active' and admin.deleted_at is null
  and admin.id<>new.host_id;
 return new;
end;
$$;
revoke all on function private.notify_admin_meetup_request() from public,anon,authenticated,service_role;
create trigger meetup_requests_notify_admin after insert or update of status on public.meetup_requests
 for each row when(new.status='pending') execute function private.notify_admin_meetup_request();
notify pgrst,'reload schema';
