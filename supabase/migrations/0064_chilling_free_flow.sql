-- Private introductions and immutable, explicitly consented application snapshots.
-- Host access ends with rejection/cancellation/blocking; retained evidence is available
-- only to its owner, the existing safety worker, and the audited administrator RPC.
create table private.chilling_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  profile jsonb not null,
  updated_at timestamptz not null default now()
);
create table private.chilling_applications (
  id uuid primary key references public.meetup_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  profile jsonb not null,
  answer text not null,
  question text not null,
  consent_version text not null,
  consented_at timestamptz not null default now()
);
create index chilling_applications_author_idx on private.chilling_applications(author_id);
alter table private.chilling_profiles enable row level security;
alter table private.chilling_applications enable row level security;
revoke all on private.chilling_profiles, private.chilling_applications from public, anon, authenticated, service_role;

create function public.save_chilling_profile(p_profile jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); normalized jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if jsonb_typeof(p_profile) is distinct from 'object'
    or (p_profile-array['intro','interests','promptOne','promptTwo'])<>'{}'::jsonb
    or jsonb_typeof(p_profile->'intro') is distinct from 'string'
    or char_length(trim(p_profile->>'intro')) not between 1 and 160
    or jsonb_typeof(p_profile->'promptOne') is distinct from 'string'
    or char_length(trim(p_profile->>'promptOne')) not between 1 and 300
    or jsonb_typeof(p_profile->'promptTwo') is distinct from 'string'
    or char_length(trim(p_profile->>'promptTwo')) not between 1 and 300
    or jsonb_typeof(p_profile->'interests') is distinct from 'array' then
    raise exception 'INVALID_CHILLING_PROFILE';
  end if;
  if jsonb_array_length(p_profile->'interests') not between 1 and 8
    or exists(select 1 from jsonb_array_elements(p_profile->'interests') item
      where jsonb_typeof(item) is distinct from 'string' or char_length(trim(item#>>'{}')) not between 1 and 30) then
    raise exception 'INVALID_CHILLING_PROFILE';
  end if;
  normalized:=jsonb_build_object('intro',trim(p_profile->>'intro'),'promptOne',trim(p_profile->>'promptOne'),
    'promptTwo',trim(p_profile->>'promptTwo'),'interests',
    (select jsonb_agg(trim(item#>>'{}')) from jsonb_array_elements(p_profile->'interests') item));
  insert into private.chilling_profiles(id,profile) values(u,normalized)
  on conflict(id) do update set profile=excluded.profile,updated_at=now();
end;
$$;

create function public.get_my_chilling_profile() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  return (select profile from private.chilling_profiles where id=auth.uid());
end;
$$;

create function public.get_chilling_host_profile(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  return (select cp.profile from public.posts p join private.chilling_profiles cp on cp.id=p.author_id
    where p.id=p_post_id and p.status='published' and p.room_preview is not null
    and private.is_active_account(p.author_id)
    and not private.is_blocked_between(auth.uid(),p.author_id)
    and not private.has_reported(auth.uid(),'post',p.id)
    and not private.has_reported(auth.uid(),'user',p.author_id));
end;
$$;

create function public.create_chilling_event(p_city_id text,p_title text,p_body text,p_event jsonb,p_question text)
returns uuid language plpgsql security definer set search_path='' as $$
declare post_id uuid; meetup_tag smallint; category text:=coalesce(p_event->>'category','casual');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if not exists(select 1 from private.chilling_profiles where id=auth.uid()) then raise exception 'CHILLING_PROFILE_REQUIRED'; end if;
  if jsonb_typeof(p_event) is distinct from 'object'
    or (p_event-array['eventKind','startsAt','endsAt','timezone','cadence','capacity','category'])<>'{}'::jsonb then
    raise exception 'INVALID_CHILLING_EVENT';
  end if;
  if category not in ('casual','hobby','travel') then raise exception 'INVALID_EVENT_CATEGORY'; end if;
  if p_question is null or char_length(trim(p_question)) not between 1 and 300 then raise exception 'INVALID_APPLICATION_QUESTION'; end if;
  -- Preserve create_post's consent, moderation, membership, quota, cooldown and slot checks.
  select id into meetup_tag from public.tags where kind='meetup' order by id limit 1;
  post_id:=public.create_post(p_city_id,meetup_tag,p_title,p_body,p_room_preview=>'{}'::jsonb);
  perform private.validate_chilling_event(post_id,p_event);
  perform public.configure_chilling_event(post_id,p_event->>'eventKind',(p_event->>'startsAt')::timestamptz,
    (p_event->>'endsAt')::timestamptz,p_event->>'timezone',p_event->>'cadence',(p_event->>'capacity')::integer);
  update public.posts set room_preview=room_preview||jsonb_build_object('applicationQuestion',trim(p_question),'category',category)
    where id=post_id;
  return post_id;
end;
$$;

-- Keep the established request engine, including locks, expiry, rate and slot checks.
-- It is no longer directly callable; legacy clients can only request legacy groups.
do $$
declare definition text; anchor text:='  perform private.assert_active_account(u);';
begin
  definition:=pg_get_functiondef('public.configure_chilling_event(uuid,text,timestamptz,timestamptz,text,text,integer)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'configure profile guard anchor missing'; end if;
  execute replace(definition,anchor,anchor||E'\n  if not exists(select 1 from private.chilling_profiles where id=u) then raise exception ''CHILLING_PROFILE_REQUIRED''; end if;');
end;
$$;
alter function public.request_meetup_join(uuid,text) set schema private;
revoke all on function private.request_meetup_join(uuid,text) from public,anon,authenticated,service_role;
create function public.request_meetup_join(p_post_id uuid,p_message text default '') returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform private.lock_relationships();
  perform private.assert_chilling_open((select room_preview from public.posts where id=p_post_id));
  if exists(select 1 from public.posts where id=p_post_id and room_preview->>'eventKind' is not null) then
    raise exception 'CHILLING_CONSENT_REQUIRED';
  end if;
  return private.request_meetup_join(p_post_id,p_message);
end;
$$;

create function public.request_chilling_join(p_post_id uuid,p_answer text,p_consent_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); snapshot jsonb; request_id uuid; prior_status text; question text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  if p_consent_version is distinct from 'chilling-v1' then raise exception 'CHILLING_CONSENT_REQUIRED'; end if;
  if p_answer is null or char_length(trim(p_answer)) not between 1 and 300 then raise exception 'INVALID_REQUEST_MESSAGE'; end if;
  select profile into snapshot from private.chilling_profiles where id=u for share;
  if snapshot is null then raise exception 'CHILLING_PROFILE_REQUIRED'; end if;
  select room_preview->>'applicationQuestion' into question from public.posts where id=p_post_id for update;
  if private.has_reported(u,'post',p_post_id) or private.has_reported(u,'user',(select author_id from public.posts where id=p_post_id)) then
    raise exception 'MEETUP_NOT_FOUND';
  end if;
  select status into prior_status from public.meetup_requests where post_id=p_post_id and requester_id=u;
  -- Answers live only in the private snapshot, never legacy request JSON or notifications.
  request_id:=private.request_meetup_join(p_post_id,'');
  if prior_status in ('pending','approved') then return request_id; end if;
  insert into private.chilling_applications(id,author_id,profile,answer,question,consent_version)
    values(request_id,u,snapshot,trim(p_answer),coalesce(question,''),p_consent_version)
  on conflict(id) do update set profile=excluded.profile,answer=excluded.answer,question=excluded.question,
    consent_version=excluded.consent_version,consented_at=now();
  return request_id;
end;
$$;

create function public.get_chilling_application(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  return (select jsonb_build_object('postId',r.post_id,'requesterId',a.author_id,'profile',a.profile,'answer',a.answer,'question',a.question,
      'consentVersion',a.consent_version,'consentedAt',a.consented_at)
    from private.chilling_applications a join public.meetup_requests r on r.id=a.id join public.posts p on p.id=r.post_id
    where a.id=p_request_id and (a.author_id=auth.uid() or
      (r.host_id=auth.uid() and p.author_id=auth.uid() and r.status in ('pending','approved') and p.status='published'
       and coalesce(p.room_preview->>'closed','false')<>'true'
       and private.is_active_account(a.author_id)
       and not private.is_blocked_between(auth.uid(),a.author_id)
       and not private.has_reported(auth.uid(),'user',a.author_id)
       and not private.has_reported(auth.uid(),'post',p.id))));
end;
$$;

-- Reuse both asynchronous AI review and the existing no-cost keyword scanner.
alter table public.safety_review_queue drop constraint safety_review_queue_target_type_check;
alter table public.safety_review_queue add constraint safety_review_queue_target_type_check
  check(target_type in ('post','comment','message','chilling_profile','chilling_application'));
alter table public.safety_alerts drop constraint safety_alerts_target_type_check;
alter table public.safety_alerts add constraint safety_alerts_target_type_check
  check(target_type in ('post','comment','message','listing_review','chilling_profile','chilling_application'));
alter table public.notifications drop constraint notifications_target_type_check;
alter table public.notifications add constraint notifications_target_type_check
  check(target_type in ('post','comment','message','meetup_request','user','listing_review','chilling_profile','chilling_application'));

create function private.chilling_safety_content(p_target_type text,p_target_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case p_target_type
    when 'chilling_profile' then (select jsonb_build_object('authorId',id,'text',profile::text) from private.chilling_profiles where id=p_target_id)
    when 'chilling_application' then (select jsonb_build_object('authorId',author_id,'text',concat_ws(E'\n',profile::text,question,answer)) from private.chilling_applications where id=p_target_id)
    else null end;
$$;
create function public.get_chilling_safety_content(p_target_type text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  return private.chilling_safety_content(p_target_type,p_target_id);
end;
$$;
create function public.get_admin_chilling_content(p_target_type text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare content jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  content:=private.chilling_safety_content(p_target_type,p_target_id);
  perform public.log_admin_access('safety',(content->>'authorId')::uuid,p_target_id);
  return content;
end;
$$;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.enqueue_safety_review()'::regprocedure);
  anchor:='else ''message'' end';
  if strpos(definition,anchor)=0 then raise exception 'safety queue target anchor missing'; end if;
  definition:=replace(definition,anchor,'when ''chilling_profiles'' then ''chilling_profile'' when ''chilling_applications'' then ''chilling_application'' else ''message'' end');
  definition:=replace(definition,'(to_jsonb(new) -> ''hashtags'')::text)',
    '(to_jsonb(new) -> ''hashtags'')::text, to_jsonb(new)->''room_preview''->>''applicationQuestion'', to_jsonb(new)->''room_preview''->>''cadence'')');
  definition:=replace(definition,'else new.body','when ''chilling_profiles'' then private.chilling_safety_content(kind,new.id)->>''text'' when ''chilling_applications'' then private.chilling_safety_content(kind,new.id)->>''text'' else to_jsonb(new)->>''body''');
  -- PL/pgSQL resolves record fields per table, including branches: avoid new.body on private rows.
  definition:=replace(definition,'new.body','to_jsonb(new)->>''body''');
  execute definition;
  definition:=pg_get_functiondef('private.scan_watch_terms()'::regprocedure);
  definition:=replace(definition,'else ''message'' end','when ''chilling_profiles'' then ''chilling_profile'' when ''chilling_applications'' then ''chilling_application'' else ''message'' end');
  definition:=replace(definition,'concat_ws('' '', row_json->>''title'', new.body)',
    'concat_ws('' '', row_json->>''title'', row_json->>''body'', row_json->''room_preview''->>''applicationQuestion'', row_json->''room_preview''->>''cadence'', row_json->>''profile'',row_json->>''answer'',row_json->>''question'')');
  definition:=replace(definition,'(row_json->>''author_id'')::uuid)',
    '(row_json->>''author_id'')::uuid,case when tg_table_name=''chilling_profiles'' then new.id end)');
  execute definition;
  definition:=pg_get_functiondef('public.export_admin_safety_evidence(bigint)'::regprocedure);
  anchor:='else (select to_jsonb(m) from public.messages m where m.id = a.target_id) end';
  if strpos(definition,anchor)=0 then raise exception 'admin evidence anchor missing'; end if;
  execute replace(definition,anchor,'when ''chilling_profile'' then (select to_jsonb(c) from private.chilling_profiles c where c.id=a.target_id) when ''chilling_application'' then (select to_jsonb(c) from private.chilling_applications c where c.id=a.target_id) '||anchor);
end;
$$;
drop trigger posts_safety_review on public.posts;
create trigger posts_safety_review after insert or update of title,body,hashtags,room_preview on public.posts
  for each row execute function private.enqueue_safety_review();
create trigger posts_chilling_watch_terms after update of room_preview on public.posts
  for each row when (old.room_preview->>'applicationQuestion' is distinct from new.room_preview->>'applicationQuestion'
    or old.room_preview->>'cadence' is distinct from new.room_preview->>'cadence') execute function private.scan_watch_terms();
create trigger chilling_profiles_safety after insert or update of profile on private.chilling_profiles
  for each row execute function private.enqueue_safety_review();
create trigger chilling_applications_safety after insert or update on private.chilling_applications
  for each row execute function private.enqueue_safety_review();
create trigger chilling_profiles_watch_terms after insert or update of profile on private.chilling_profiles
  for each row execute function private.scan_watch_terms();
create trigger chilling_applications_watch_terms after insert or update on private.chilling_applications
  for each row execute function private.scan_watch_terms();

revoke all on function private.chilling_safety_content(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_chilling_profile(jsonb),public.get_my_chilling_profile(),public.get_chilling_host_profile(uuid),
  public.create_chilling_event(text,text,text,jsonb,text),public.request_meetup_join(uuid,text),
  public.request_chilling_join(uuid,text,text),public.get_chilling_application(uuid),public.get_admin_chilling_content(text,uuid),
  public.get_chilling_safety_content(text,uuid) from public,anon,authenticated;
grant execute on function public.save_chilling_profile(jsonb),public.get_my_chilling_profile(),public.get_chilling_host_profile(uuid),
  public.create_chilling_event(text,text,text,jsonb,text),public.request_meetup_join(uuid,text),
  public.request_chilling_join(uuid,text,text),public.get_chilling_application(uuid),public.get_admin_chilling_content(text,uuid) to authenticated;
grant execute on function public.get_chilling_safety_content(text,uuid) to service_role;
