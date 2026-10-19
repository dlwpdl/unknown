-- Separate meetup identity; application and public-host snapshots keep immutable media paths.
create table private.chilling_host_profiles (
  post_id uuid primary key references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  profile jsonb not null,
  consent_version text not null,
  consented_at timestamptz not null default now()
);
create index chilling_host_profiles_author_idx on private.chilling_host_profiles(author_id);
alter table private.chilling_host_profiles enable row level security;
revoke all on private.chilling_host_profiles from public,anon,authenticated,service_role;
alter table private.chilling_host_profiles owner to postgres;

-- Preserve the previously public four-field text before an owner upgrades their private profile.
insert into private.chilling_host_profiles(post_id,author_id,profile,consent_version)
select p.id,p.author_id,cp.profile,'chilling-v1'
from public.posts p join private.chilling_profiles cp on cp.id=p.author_id
where p.room_preview is not null and not (cp.profile ? 'version');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('meetup-profiles','meetup-profiles',false,2097152,array['image/jpeg','image/png','image/webp']);

do $$ begin
  if to_regprocedure('storage.allow_only_operation(text)') is null
    or to_regprocedure('storage.allow_any_operation(text[])') is null then
    raise exception 'MEETUP_PROFILE_STORAGE_OPERATION_CONTRACT_REQUIRED';
  end if;
end $$;

create function private.chilling_photo_path_valid(p_path text,p_owner uuid) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(p_owner is not null and p_path ~ ('^'||p_owner::text||'/[0-9]{10,16}-[a-f0-9]{8,64}\.(jpg|png|webp)$'),false);
$$;
create function private.chilling_photo_metadata_valid(p_path text,p_metadata jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_metadata)='object'
    and p_metadata->>'size' ~ '^[0-9]{1,8}$'
    and case when p_metadata->>'size' ~ '^[0-9]{1,8}$' then (p_metadata->>'size')::bigint between 1 and 2097152 else false end
    and p_metadata->>'mimetype'=case when p_path like '%.jpg' then 'image/jpeg'
      when p_path like '%.png' then 'image/png' when p_path like '%.webp' then 'image/webp' end,false);
$$;

-- Every read checks the current relationship, publication and actual wall-clock expiry.
create function private.chilling_context_visible(p_post_id uuid,p_viewer uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(p_viewer=auth.uid() and private.is_active_account(p_viewer) and exists(
    select 1 from public.posts p where p.id=p_post_id and p.room_preview is not null
      and p.status='published' and coalesce(p.room_preview->>'closed','false')<>'true'
      and not coalesce(p.room_preview->>'eventKind'='once' and (p.room_preview->>'endsAt')::timestamptz<=clock_timestamp(),false)
      and private.is_active_account(p.author_id)
      and not private.is_blocked_between(p_viewer,p.author_id)
      and not private.has_reported(p_viewer,'post',p.id)
      and not private.has_reported(p_viewer,'user',p.author_id)
      and not private.has_reported(p.author_id,'user',p_viewer)
      and not exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=p_viewer
        and r.status in('cancelled','rejected'))),false);
$$;
create function private.chilling_pair_visible(p_viewer uuid,p_subject uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(p_viewer=auth.uid() and private.is_active_account(p_subject)
    and not private.is_blocked_between(p_viewer,p_subject)
    and not private.has_reported(p_viewer,'user',p_subject)
    and not private.has_reported(p_subject,'user',p_viewer),false);
$$;

create or replace function public.save_chilling_profile(p_profile jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); normalized jsonb; prefs jsonb; photos jsonb; item jsonb; is_v2 boolean;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  is_v2:=p_profile->'version'='2'::jsonb;
  if jsonb_typeof(p_profile) is distinct from 'object'
    or (p_profile-array['intro','interests','promptOne','promptTwo','version','displayName','cityId','photoPaths','publicPhotoPath',
      'promptOneId','promptTwoId','shareWithMembers','preferences'])<>'{}'::jsonb
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
    or exists(select 1 from jsonb_array_elements(p_profile->'interests') x
      where jsonb_typeof(x) is distinct from 'string' or char_length(trim(x#>>'{}')) not between 1 and 30) then
    raise exception 'INVALID_CHILLING_PROFILE';
  end if;
  normalized:=jsonb_build_object('intro',trim(p_profile->>'intro'),'promptOne',trim(p_profile->>'promptOne'),
    'promptTwo',trim(p_profile->>'promptTwo'),'interests',
    (select jsonb_agg(trim(x#>>'{}')) from jsonb_array_elements(p_profile->'interests') x));
  if coalesce(is_v2,false) then
    if jsonb_typeof(p_profile->'displayName') is distinct from 'string'
      or char_length(trim(p_profile->>'displayName')) not between 1 and 30
      or jsonb_typeof(p_profile->'cityId') is distinct from 'string'
      or not exists(select 1 from public.cities where id=p_profile->>'cityId')
      or jsonb_typeof(p_profile->'promptOneId') is distinct from 'string'
      or p_profile->>'promptOneId' not in('meet','weekend','comfort')
      or jsonb_typeof(p_profile->'promptTwoId') is distinct from 'string'
      or p_profile->>'promptTwoId' not in('join','learn','ritual')
      or (p_profile ? 'shareWithMembers' and jsonb_typeof(p_profile->'shareWithMembers') is distinct from 'boolean') then
      raise exception 'INVALID_CHILLING_PROFILE';
    end if;
    photos:=coalesce(p_profile->'photoPaths','[]'::jsonb);
    if jsonb_typeof(photos) is distinct from 'array' then raise exception 'INVALID_CHILLING_PHOTO'; end if;
    if jsonb_array_length(photos)>3
      or (select count(*)<>count(distinct x) from jsonb_array_elements(photos) x) then raise exception 'INVALID_CHILLING_PHOTO'; end if;
    for item in select x from jsonb_array_elements(photos) x loop
      if jsonb_typeof(item) is distinct from 'string' or not private.chilling_photo_path_valid(item#>>'{}',u)
        or not exists(select 1 from storage.objects o where o.bucket_id='meetup-profiles' and o.name=item#>>'{}'
          and o.owner_id=u::text and private.chilling_photo_metadata_valid(o.name,o.metadata)) then
        raise exception 'INVALID_CHILLING_PHOTO';
      end if;
    end loop;
    if coalesce(p_profile->'publicPhotoPath','null'::jsonb)<>'null'::jsonb
      and (jsonb_typeof(p_profile->'publicPhotoPath') is distinct from 'string'
        or not (photos @> jsonb_build_array(p_profile->'publicPhotoPath'))) then raise exception 'INVALID_CHILLING_PHOTO'; end if;
    prefs:=coalesce(p_profile->'preferences','{}'::jsonb);
    if jsonb_typeof(prefs) is distinct from 'object' or (prefs-array['activities','availability','pace'])<>'{}'::jsonb
      or (prefs ? 'availability' and (jsonb_typeof(prefs->'availability') is distinct from 'string' or char_length(prefs->>'availability')>160))
      or (prefs ? 'pace' and (jsonb_typeof(prefs->'pace') is distinct from 'string' or prefs->>'pace' not in('any','relaxed','active')))
      or jsonb_typeof(coalesce(prefs->'activities','[]'::jsonb)) is distinct from 'array' then raise exception 'INVALID_CHILLING_PROFILE'; end if;
    if jsonb_array_length(coalesce(prefs->'activities','[]'::jsonb))>8 or exists(
      select 1 from jsonb_array_elements(coalesce(prefs->'activities','[]'::jsonb)) x where jsonb_typeof(x) is distinct from 'string'
        or char_length(trim(x#>>'{}')) not between 1 and 30) then raise exception 'INVALID_CHILLING_PROFILE'; end if;
    normalized:=normalized||jsonb_build_object('version',2,'displayName',trim(p_profile->>'displayName'),'cityId',p_profile->>'cityId',
      'photoPaths',photos,'publicPhotoPath',coalesce(p_profile->'publicPhotoPath','null'::jsonb),
      'promptOneId',p_profile->>'promptOneId','promptTwoId',p_profile->>'promptTwoId',
      'shareWithMembers',coalesce(p_profile->'shareWithMembers','false'::jsonb),
      'preferences',jsonb_build_object('activities',coalesce(prefs->'activities','[]'::jsonb),
        'availability',trim(coalesce(prefs->>'availability','')),'pace',coalesce(prefs->>'pace','any')));
  elsif (p_profile-array['intro','interests','promptOne','promptTwo'])<>'{}'::jsonb then
    raise exception 'INVALID_CHILLING_PROFILE';
  elsif exists(select 1 from private.chilling_profiles where id=u and profile->'version'='2'::jsonb) then
    -- Old clients can edit their original text without discarding the separate v2 identity.
    select profile||normalized||jsonb_build_object('promptOneId','meet','promptTwoId','join') into normalized
      from private.chilling_profiles where id=u;
  end if;
  insert into private.chilling_profiles(id,profile) values(u,normalized)
  on conflict(id) do update set profile=excluded.profile,updated_at=greatest(clock_timestamp(),private.chilling_profiles.updated_at+interval '1 microsecond');
end;
$$;

create function private.chilling_legacy_text(p_profile jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('intro',p_profile->'intro','interests',p_profile->'interests',
    'promptOne',p_profile->'promptOne','promptTwo',p_profile->'promptTwo');
$$;
create function private.chilling_host_public(p_profile jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select case when p_profile->'version'='2'::jsonb then jsonb_build_object('version',2,
    'displayName',p_profile->>'displayName','cityId',p_profile->>'cityId','intro',p_profile->>'intro',
    'interests',p_profile->'interests','publicPhotoPath',p_profile->'publicPhotoPath',
    'photoPaths',case when p_profile->>'publicPhotoPath' is null then '[]'::jsonb else jsonb_build_array(p_profile->'publicPhotoPath') end)
    else p_profile-array['preferences','photoPaths','publicPhotoPath'] end;
$$;

-- Patch only the existing six-argument implementation; its legacy wrapper and guards stay intact.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.create_chilling_event(text,text,text,jsonb,text,text[])'::regprocedure);
  anchor:='declare post_id uuid;';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_V2_CREATE_DECLARATION_CHANGED'; end if;
  definition:=replace(definition,anchor,'declare host_snapshot jsonb; host_revision text; post_id uuid;');
  anchor:='''recommendedAgeMax'']';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_V2_EVENT_ALLOWLIST_CHANGED'; end if;
  definition:=replace(definition,anchor,'''recommendedAgeMax'',''hostProfileConsentVersion'',''hostProfileRevision'']');
  anchor:='  -- Preserve create_post''s consent, moderation, membership, quota, cooldown and slot checks.';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_V2_CREATE_GUARD_CHANGED'; end if;
  definition:=replace(definition,anchor,$patch$
  select profile,updated_at::text into host_snapshot,host_revision from private.chilling_profiles where id=auth.uid() for share;
  if host_snapshot->'version'='2'::jsonb and not (p_event ? 'hostProfileConsentVersion') then
    host_snapshot:=private.chilling_legacy_text(host_snapshot);
  end if;
  if host_snapshot->'version'='2'::jsonb and p_event->>'hostProfileRevision' is distinct from host_revision then
    raise exception 'CHILLING_PROFILE_CHANGED';
  end if;
  if p_event ? 'hostProfileConsentVersion' and p_event->>'hostProfileConsentVersion' is distinct from 'chilling-v2' then
    raise exception 'CHILLING_HOST_CONSENT_REQUIRED';
  end if;
$patch$||anchor);
  anchor:='  return post_id;';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_V2_CREATE_RETURN_CHANGED'; end if;
  execute replace(definition,anchor,$patch$
  insert into private.chilling_host_profiles(post_id,author_id,profile,consent_version)
    values(post_id,auth.uid(),private.chilling_host_public(host_snapshot),
      case when host_snapshot->'version'='2'::jsonb then 'chilling-v2' else 'chilling-v1' end);
$patch$||anchor);
end $$;

create or replace function public.get_chilling_host_profile(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if not private.chilling_context_visible(p_post_id,auth.uid()) then return null; end if;
  return (select h.profile from private.chilling_host_profiles h where h.post_id=p_post_id);
end;
$$;

create or replace function public.request_chilling_join(p_post_id uuid,p_answer text,p_consent_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); snapshot jsonb; request_id uuid; prior_status text; question text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if p_consent_version is null or p_consent_version not in('chilling-v1','chilling-v2') then raise exception 'CHILLING_CONSENT_REQUIRED'; end if;
  if p_answer is null or char_length(trim(p_answer)) not between 1 and 300 then raise exception 'INVALID_REQUEST_MESSAGE'; end if;
  select profile into snapshot from private.chilling_profiles where id=u for share;
  if snapshot is null then raise exception 'CHILLING_PROFILE_REQUIRED'; end if;
  if p_consent_version='chilling-v1' then snapshot:=private.chilling_legacy_text(snapshot); end if;
  select room_preview->>'applicationQuestion' into question from public.posts where id=p_post_id for update;
  if private.has_reported(u,'post',p_post_id) or private.has_reported(u,'user',(select author_id from public.posts where id=p_post_id)) then
    raise exception 'MEETUP_NOT_FOUND';
  end if;
  select status into prior_status from public.meetup_requests where post_id=p_post_id and requester_id=u;
  request_id:=private.request_meetup_join(p_post_id,'');
  if prior_status in('pending','approved') then return request_id; end if;
  insert into private.chilling_applications(id,author_id,profile,answer,question,consent_version)
    values(request_id,u,snapshot-'preferences',trim(p_answer),coalesce(question,''),p_consent_version)
  on conflict(id) do update set profile=excluded.profile,answer=excluded.answer,question=excluded.question,
    consent_version=excluded.consent_version,consented_at=now();
  return request_id;
end;
$$;

create or replace function public.get_chilling_application(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  return (select jsonb_build_object('postId',r.post_id,'requesterId',a.author_id,'profile',a.profile-'preferences',
      'answer',a.answer,'question',a.question,'consentVersion',a.consent_version,'consentedAt',a.consented_at)
    from private.chilling_applications a join public.meetup_requests r on r.id=a.id join public.posts p on p.id=r.post_id
    where a.id=p_request_id and (a.author_id=auth.uid() or (r.host_id=auth.uid() and p.author_id=auth.uid()
      and r.status in('pending','approved') and private.chilling_context_visible(p.id,auth.uid())
      and private.chilling_pair_visible(auth.uid(),a.author_id) and not private.has_reported(a.author_id,'post',p.id))));
end;
$$;

create function private.chilling_member_projection(p_post_id uuid,p_subject uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); host uuid; snapshot jsonb; member_status text; shared boolean;
begin
  if not private.chilling_context_visible(p_post_id,u) or not private.chilling_pair_visible(u,p_subject) then return null; end if;
  select author_id into host from public.posts where id=p_post_id;
  if p_subject=host then
    select profile into snapshot from private.chilling_host_profiles where post_id=p_post_id;
  else
    select a.profile,r.status into snapshot,member_status from public.meetup_requests r
      left join private.chilling_applications a on a.id=r.id and a.author_id=r.requester_id
      where r.post_id=p_post_id and r.requester_id=p_subject;
    if member_status is null or member_status not in('pending','approved') then return null; end if;
    if private.is_blocked_between(p_subject,host) or private.has_reported(p_subject,'post',p_post_id)
      or private.has_reported(p_subject,'user',host) or private.has_reported(host,'user',p_subject) then return null; end if;
    if u not in(host,p_subject) and (member_status<>'approved' or not exists(select 1 from public.meetup_requests
      where post_id=p_post_id and requester_id=u and status='approved')) then return null; end if;
  end if;
  snapshot:=coalesce(snapshot,'{}'::jsonb);
  shared:=p_subject=host or u in(host,p_subject) or coalesce(snapshot->'shareWithMembers'='true'::jsonb,false);
  return jsonb_build_object('userId',p_subject,'displayName',coalesce(snapshot->>'displayName',''),'cityId',case when shared then snapshot->>'cityId' end,
    'photoPaths',case when shared then coalesce(snapshot->'photoPaths','[]'::jsonb) else '[]'::jsonb end,
    'intro',case when shared then coalesce(snapshot->>'intro','') else '' end,
    'interests',case when shared then coalesce(snapshot->'interests','[]'::jsonb) else '[]'::jsonb end,'isHost',p_subject=host);
end;
$$;
create function public.get_chilling_member_profile(p_post_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  return private.chilling_member_projection(p_post_id,p_user_id);
end;
$$;
create function public.get_chilling_roster(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if not private.chilling_context_visible(p_post_id,u) or not exists(select 1 from public.posts p where p.id=p_post_id
    and (p.author_id=u or exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=u and r.status='approved')))
    then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(item order by is_host desc,id),'[]'::jsonb) into result from(
    select m.id,m.is_host,private.chilling_member_projection(p_post_id,m.id) item from(
      select p.author_id id,true is_host from public.posts p where p.id=p_post_id
      union all select r.requester_id,false from public.meetup_requests r where r.post_id=p_post_id and r.status='approved'
      order by is_host desc,id limit 50) m) visible where item is not null;
  return result;
end;
$$;

-- Remove unrelated community identity from the existing meetup presentation RPCs.
create or replace function public.get_conversation_members(p_conversation_id uuid)
returns table(id uuid,nickname text,avatar_path text,is_host boolean)
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); post_id uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if not private.can_read_conversation(p_conversation_id,u) then raise exception 'CONVERSATION_ACCESS_DENIED'; end if;
  select group_post_id into post_id from public.conversations where conversations.id=p_conversation_id and kind='group';
  return query select (item->>'userId')::uuid,coalesce(item->>'displayName','')::text,(item->'photoPaths'->>0)::text,
    (item->>'isHost')::boolean from jsonb_array_elements(public.get_chilling_roster(post_id)) item;
end;
$$;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_meetup_sessions(uuid)'::regprocedure);
  anchor:='''nickname'',p.nickname';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_V2_SESSION_IDENTITY_CHANGED'; end if;
  definition:=replace(definition,anchor,'''nickname'',coalesce(private.chilling_member_projection(p_post_id,a.user_id)->>''displayName'','''')');
  definition:=replace(definition,'order by p.nickname','order by a.user_id');
  definition:=replace(definition,'STABLE','VOLATILE');
  execute definition;
  definition:=pg_get_functiondef('public.get_meetup_reviews(uuid,integer)'::regprocedure);
  anchor:='''nickname'',p.nickname';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_V2_REVIEW_IDENTITY_CHANGED'; end if;
  definition:=replace(definition,anchor,'''nickname'',coalesce(private.chilling_member_projection(p_post_id,r.author_id)->>''displayName'','''')');
  definition:=replace(definition,'STABLE','VOLATILE');
  execute definition;
end $$;

-- Keep earlier consent revisions and their media when the established request row is reused.
create table private.chilling_application_history (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.meetup_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  profile jsonb not null,
  answer text not null,
  question text not null,
  consent_version text not null,
  consented_at timestamptz not null
);
create index chilling_application_history_request_idx on private.chilling_application_history(request_id,id);
alter table private.chilling_application_history enable row level security;
revoke all on private.chilling_application_history from public,anon,authenticated,service_role;
alter table private.chilling_application_history owner to postgres;
create function private.retain_chilling_application_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.chilling_application_history(request_id,author_id,profile,answer,question,consent_version,consented_at)
    values(old.id,old.author_id,old.profile,old.answer,old.question,old.consent_version,old.consented_at);
  return new;
end;
$$;
create trigger chilling_application_revision before update on private.chilling_applications
for each row when(old is distinct from new) execute function private.retain_chilling_application_revision();
alter function private.retain_chilling_application_revision() owner to postgres;
revoke all on function private.retain_chilling_application_revision() from public,anon,authenticated,service_role;
create function private.chilling_photo_referenced(p_path text) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from private.chilling_profiles where profile->'photoPaths' ? p_path)
    or exists(select 1 from private.chilling_applications where profile->'photoPaths' ? p_path)
    or exists(select 1 from private.chilling_host_profiles where profile->'photoPaths' ? p_path)
    or exists(select 1 from private.chilling_application_history where profile->'photoPaths' ? p_path);
$$;

create function private.chilling_photo_access(p_path text,p_operation text) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); owner_id uuid; h record; a record;
begin
  if u is null or not private.is_active_account(u) then return false; end if;
  if p_path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9]{10,16}-[a-f0-9]{8,64}\.(jpg|png|webp)$' then return false; end if;
  owner_id:=split_part(p_path,'/',1)::uuid;
  perform private.lock_relationships();
  if not private.is_active_account(u) then return false; end if;
  -- Storage preflight has contentLength, not the final saved metadata.size. The bucket enforces stream limits.
  if p_operation='upload' then return u=owner_id; end if;
  if p_operation='delete' then return u=owner_id and not private.chilling_photo_referenced(p_path); end if;
  if p_operation<>'get' then return false; end if;
  if u=owner_id then return true; end if;
  if private.is_admin() and exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id'
      and s.user_id=u and (s.not_after is null or s.not_after>clock_timestamp()))
    and private.chilling_photo_referenced(p_path) then
    perform public.log_admin_access('safety',owner_id,(select o.id from storage.objects o where o.bucket_id='meetup-profiles' and o.name=p_path));
    return true;
  end if;
  for h in select post_id from private.chilling_host_profiles where author_id=owner_id and profile->'photoPaths' ? p_path loop
    if private.chilling_context_visible(h.post_id,u) then return true; end if;
  end loop;
  for a in select r.post_id,r.host_id,r.requester_id,r.status,ca.profile from private.chilling_applications ca
    join public.meetup_requests r on r.id=ca.id where ca.author_id=owner_id and ca.profile->'photoPaths' ? p_path
      and r.status in('pending','approved') loop
    if private.chilling_context_visible(a.post_id,u) and private.chilling_pair_visible(u,owner_id)
      and not private.is_blocked_between(owner_id,a.host_id) and not private.has_reported(owner_id,'post',a.post_id)
      and not private.has_reported(owner_id,'user',a.host_id) and not private.has_reported(a.host_id,'user',owner_id)
      and (u=a.host_id or (a.status='approved' and a.profile->'shareWithMembers'='true'::jsonb
        and exists(select 1 from public.meetup_requests viewer where viewer.post_id=a.post_id and viewer.requester_id=u and viewer.status='approved')))
      then return true; end if;
  end loop;
  return false;
end;
$$;

create policy "owners upload immutable meetup profile photos" on storage.objects for insert to authenticated
with check(bucket_id='meetup-profiles' and owner_id=(select auth.uid())::text
  and storage.allow_only_operation('storage.object.upload') and private.chilling_photo_access(name,'upload'));
create policy "authorized context reads meetup profile photos" on storage.objects for select to authenticated
using(bucket_id='meetup-profiles' and private.chilling_photo_access(name,'get'));
create policy "owners remove only unreferenced meetup drafts" on storage.objects for delete to authenticated
using(bucket_id='meetup-profiles' and owner_id=(select auth.uid())::text and private.chilling_photo_access(name,'delete'));
-- Restrictive boundaries also protect this bucket from present or future broad uploader policies.
create policy "meetup profile reads require authenticated download" on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'meetup-profiles' or (storage.allow_only_operation('storage.object.get_authenticated') and private.chilling_photo_access(name,'get'))
  or (storage.allow_any_operation(array['storage.object.delete','storage.object.delete_many'])
    and owner_id=(select auth.uid())::text and private.chilling_photo_access(name,'delete')));
create policy "meetup profile uploads stay owner scoped" on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'meetup-profiles' or (owner_id=(select auth.uid())::text
  and storage.allow_only_operation('storage.object.upload') and private.chilling_photo_access(name,'upload')));
create policy "meetup profile objects cannot be overwritten" on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'meetup-profiles') with check(bucket_id<>'meetup-profiles');
create policy "meetup profile evidence cannot be deleted" on storage.objects as restrictive for delete to anon,authenticated
using(bucket_id<>'meetup-profiles' or (owner_id=(select auth.uid())::text and private.chilling_photo_access(name,'delete')));

-- Keep helpers private except the exact predicates called by storage RLS.
revoke all on function private.chilling_photo_path_valid(text,uuid),private.chilling_photo_metadata_valid(text,jsonb),
  private.chilling_context_visible(uuid,uuid),private.chilling_pair_visible(uuid,uuid),private.chilling_legacy_text(jsonb),private.chilling_host_public(jsonb),
  private.chilling_member_projection(uuid,uuid),private.chilling_photo_referenced(text),private.chilling_photo_access(text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.chilling_photo_access(text,text) to authenticated;
revoke all on function public.get_chilling_member_profile(uuid,uuid),public.get_chilling_roster(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_chilling_member_profile(uuid,uuid),public.get_chilling_roster(uuid) to authenticated;

do $$
declare signature text;
begin
  foreach signature in array array['public.save_chilling_profile(jsonb)','public.get_chilling_host_profile(uuid)',
    'public.request_chilling_join(uuid,text,text)','public.get_chilling_application(uuid)',
    'public.get_chilling_member_profile(uuid,uuid)','public.get_chilling_roster(uuid)','public.get_conversation_members(uuid)',
    'private.chilling_photo_path_valid(text,uuid)','private.chilling_photo_metadata_valid(text,jsonb)',
    'private.chilling_context_visible(uuid,uuid)','private.chilling_pair_visible(uuid,uuid)','private.chilling_legacy_text(jsonb)','private.chilling_host_public(jsonb)',
    'private.chilling_member_projection(uuid,uuid)','private.chilling_photo_referenced(text)','private.chilling_photo_access(text,text)'] loop
    execute 'alter function '||signature||' owner to postgres';
  end loop;
end $$;

create function public.get_pending_chilling_requests(p_before_created timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if num_nonnulls(p_before_created,p_before_id)=1 or (p_before_created is not null and not isfinite(p_before_created)) then
    raise exception 'INVALID_CURSOR';
  end if;
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb) into result from(
    select r.id,r.created_at,jsonb_build_object('id',r.id,'post_id',r.post_id,'requester_id',r.requester_id,
      'message',case when p.room_preview->>'eventKind' is null then r.message else '' end,'status',r.status,'created_at',r.created_at,
      'requester',jsonb_build_object('nickname',coalesce(a.profile->>'displayName',''),'verification_level',0),
      'post',jsonb_build_object('title',p.title,'room',p.room_preview)) item
    from public.meetup_requests r join public.posts p on p.id=r.post_id
    left join private.chilling_applications a on a.id=r.id and a.author_id=r.requester_id
    where r.host_id=u and p.author_id=u and r.status='pending'
      and (p_before_created is null or (r.created_at,r.id)<(p_before_created,p_before_id))
      and private.chilling_context_visible(p.id,u) and private.chilling_pair_visible(u,r.requester_id)
      and not private.has_reported(r.requester_id,'post',p.id)
    order by r.created_at desc,r.id desc limit 50) requests;
  return result;
end;
$$;
alter function public.get_pending_chilling_requests(timestamptz,uuid) owner to postgres;
revoke all on function public.get_pending_chilling_requests(timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_pending_chilling_requests(timestamptz,uuid) to authenticated;

-- Only the explicitly published name enters public metadata; media remains private.
create function private.publish_chilling_host_name() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.posts set room_preview=room_preview||jsonb_build_object('hostDisplayName',coalesce(new.profile->>'displayName',''))
    where id=new.post_id;
  return new;
end;
$$;
create trigger chilling_host_public_name after insert on private.chilling_host_profiles
for each row execute function private.publish_chilling_host_name();
alter function private.publish_chilling_host_name() owner to postgres;
revoke all on function private.publish_chilling_host_name() from public,anon,authenticated,service_role;

-- Keep the existing visibility/cursor/business branches behind an exact-column projection.
do $identity$
declare proc record; definition text; base text; args text; columns text; item record; expression text; header text;
begin
  for proc in select * from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
    'get_public_feed','get_public_feed_page','get_public_feed_page_v2','get_public_post',
    'get_public_author_posts','get_public_popular_feed_page','get_discovery_posts']) loop
    if not proc.proretset or not ('author_nickname'=any(proc.proargnames)) or not ('room_preview'=any(proc.proargnames)) then
      raise exception 'CHILLING_FEED_DTO_CHANGED: %',proc.proname;
    end if;
    definition:=pg_get_functiondef(proc.oid);
    base:=replace(definition,'FUNCTION public.'||proc.proname||'(','FUNCTION private.chilling_base_'||proc.proname||'(');
    execute base;
    execute format('alter function private.chilling_base_%I(%s) owner to postgres',proc.proname,pg_get_function_identity_arguments(proc.oid));
    execute format('revoke all on function private.chilling_base_%I(%s) from public,anon,authenticated,service_role',proc.proname,pg_get_function_identity_arguments(proc.oid));
    select string_agg(format('%I',proc.proargnames[n]),',' order by n) into args from generate_series(1,proc.pronargs)n;
    columns:='';
    for item in select proc.proargnames[n] name from generate_subscripts(proc.proallargtypes,1)n where proc.proargmodes[n]='t' loop
      expression:=case item.name
        when 'author_nickname' then 'case when r.room_preview is not null then coalesce(h.profile->>''displayName'','''') else r.author_nickname end::text'
        when 'author_neighborhood' then 'case when r.room_preview is not null then null::text else r.author_neighborhood end'
        when 'author_verification_level' then 'case when r.room_preview is not null then 0::smallint else r.author_verification_level end'
        else format('r.%I',item.name) end;
      columns:=columns||case when columns='' then '' else ',' end||expression;
    end loop;
    header:=replace(split_part(definition,'AS $function$',1),'LANGUAGE sql','LANGUAGE plpgsql');
    if header=definition then raise exception 'CHILLING_FEED_BODY_CHANGED: %',proc.proname; end if;
    execute header||format('AS $function$ begin return query select %s from private.chilling_base_%I(%s) r left join private.chilling_host_profiles h on h.post_id=r.id; end $function$;',columns,proc.proname,coalesce(args,''));
  end loop;
  definition:=pg_get_functiondef('private.request_meetup_join(uuid,text)'::regprocedure);
  expression:='(select nickname::text from public.profiles where id = current_user_id) || ''님이 모임 참여를 요청했어요.''';
  if strpos(definition,expression)=0 then raise exception 'CHILLING_REQUEST_NOTIFICATION_IDENTITY_CHANGED'; end if;
  execute replace(definition,expression,'''모임 참여 요청이 도착했어요.''');
end $identity$;

-- Fixed control IDs contain no profile, answer or photo content.
insert into private.behavior_targets(id) values
  ('meetup.requests.more'),
  ('meetup-create.host-consent'),
  ('meetup-create.profile-edit'),
  ('meetup-profile.cancel'),
  ('meetup-profile.remove-photo'),
  ('meetup-profile.prompt'),
  ('meetup-profile.pace'),
  ('meetup-profile.preview-audience'),
  ('meetup-profile.share-members'),
  ('meetup-profile.public-photo-none'),
  ('meetup-profile.public-photo'),
  ('profile.meetup-profile'),
  ('meetup.member-profile'),
  ('meetup.message-profile'),
  ('meetup.ai-preview.apply'),
  ('meetup.ai-preview.dismiss'),
  ('meetup_host_tools.control.1'),
  ('meetup_host_tools.control.2'),
  ('meetup_host_tools.control.3'),
  ('meetup_host_tools.control.4'),
  ('meetup_host_tools.control.5'),
  ('meetup_host_tools.control.6'),
  ('meetup_host_tools.control.7'),
  ('meetup_host_tools.control.8'),
  ('meetup_host_tools.control.9'),
  ('meetup_host_tools.control.10'),
  ('meetup_host_tools.control.11'),
  ('meetup_template_picker.control.1'),
  ('meetup_template_picker.control.2'),
  ('meetup_template_picker.control.3'),
  ('meetup_template_picker.control.4'),
  ('meetup_template_picker.control.5')
on conflict (id) do nothing;
notify pgrst,'reload schema';

-- Group inbox previews also use the frozen meetup name; direct/business rooms keep their own DTO.
do $$
declare proc pg_proc; definition text; base text; args text; columns text:=''; item record; expression text; header text;
begin
  select * into proc from pg_proc where oid='public.get_conversation_previews(integer,timestamptz,uuid)'::regprocedure;
  definition:=pg_get_functiondef(proc.oid);
  base:=replace(definition,'FUNCTION public.get_conversation_previews(','FUNCTION private.chilling_base_get_conversation_previews(');
  execute base;
  alter function private.chilling_base_get_conversation_previews(integer,timestamptz,uuid) owner to postgres;
  revoke all on function private.chilling_base_get_conversation_previews(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
  select string_agg(format('%I',proc.proargnames[n]),',' order by n) into args from generate_series(1,proc.pronargs)n;
  for item in select proc.proargnames[n] name from generate_subscripts(proc.proallargtypes,1)n where proc.proargmodes[n]='t' loop
    expression:=case item.name
      when 'other_nickname' then 'case when r.kind=''group'' then coalesce(h.profile->>''displayName'','''') else r.other_nickname end::text'
      when 'other_verification_level' then 'case when r.kind=''group'' then 0::smallint else r.other_verification_level end'
      else format('r.%I',item.name) end;
    columns:=columns||case when columns='' then '' else ',' end||expression;
  end loop;
  header:=replace(split_part(definition,'AS $function$',1),'LANGUAGE sql','LANGUAGE plpgsql');
  if header=definition then raise exception 'CHILLING_CONVERSATION_PREVIEW_BODY_CHANGED'; end if;
  execute header||format('AS $function$ begin return query select %s from private.chilling_base_get_conversation_previews(%s) r left join private.chilling_host_profiles h on h.post_id=r.group_post_id; end $function$;',columns,args);
end $$;

-- Remove account-name search linkage in the underlying page functions, before their limits.
do $$
declare proc record; definition text; updated text; patched_author boolean:=false; patched_search boolean:=false;
begin
  for proc in select p.oid,p.proname from pg_proc p where p.pronamespace='private'::regnamespace
    and p.proname=any(array['chilling_base_get_public_author_posts','business_base_get_public_author_posts',
      'chilling_base_get_public_feed_page','business_base_get_public_feed_page',
      'chilling_base_get_public_feed_page_v2','business_base_get_public_feed_page_v2']) loop
    definition:=pg_get_functiondef(proc.oid); updated:=definition;
    if proc.proname like '%get_public_author_posts' and updated ~ 'post\.author_id\s*=\s*p_author_id' then
      updated:=regexp_replace(updated,'post\.author_id\s*=\s*p_author_id','post.room_preview is null and post.author_id=p_author_id','g');
      patched_author:=true;
    elsif updated like '%post.author_id in (select matched.id%' then
      updated:=replace(updated,'post.author_id in (select matched.id','post.room_preview is null and post.author_id in (select matched.id');
      patched_search:=true;
    end if;
    if updated<>definition then execute updated; end if;
  end loop;
  if not patched_author or not patched_search then raise exception 'CHILLING_ACCOUNT_SEARCH_CONTRACT_CHANGED'; end if;
end $$;

-- Existing service-worker and audited AAL2 admin entrypoints also retain earlier consent evidence.
create or replace function private.chilling_safety_content(p_target_type text,p_target_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case p_target_type
    when 'chilling_profile' then (select jsonb_build_object('authorId',id,'text',profile::text) from private.chilling_profiles where id=p_target_id)
    when 'chilling_application' then (select jsonb_build_object('authorId',author_id,'text',concat_ws(E'\n',profile::text,question,answer),
      'revisions',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from private.chilling_application_history h where h.request_id=p_target_id),'[]'::jsonb))
      from private.chilling_applications where id=p_target_id)
    else null end;
$$;

-- The revision is owner-only metadata, never part of a published or application snapshot.
create or replace function public.get_my_chilling_profile() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  return (select profile||jsonb_build_object('revision',updated_at::text) from private.chilling_profiles where id=auth.uid());
end;
$$;
-- Legacy callers consent only to their original four text fields, including after a v2 upgrade.
alter function public.request_chilling_join(uuid,text,text) set schema private;
revoke all on function private.request_chilling_join(uuid,text,text) from public,anon,authenticated,service_role;
create function public.request_chilling_join(p_post_id uuid,p_answer text,p_consent_version text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if p_consent_version='chilling-v2' then raise exception 'CHILLING_PROFILE_CHANGED'; end if;
  return private.request_chilling_join(p_post_id,p_answer,p_consent_version);
end;
$$;
alter function public.request_chilling_join(uuid,text,text) owner to postgres;
revoke all on function public.request_chilling_join(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_chilling_join(uuid,text,text) to authenticated;
create function public.request_chilling_join_v2(p_post_id uuid,p_answer text,p_consent_version text,p_profile_revision text) returns uuid
language plpgsql security definer set search_path='' as $$
declare revision text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  select updated_at::text into revision from private.chilling_profiles where id=auth.uid() for share;
  if revision is null then raise exception 'CHILLING_PROFILE_REQUIRED'; end if;
  if p_profile_revision is distinct from revision then raise exception 'CHILLING_PROFILE_CHANGED'; end if;
  return private.request_chilling_join(p_post_id,p_answer,p_consent_version);
end;
$$;
alter function public.request_chilling_join_v2(uuid,text,text,text) owner to postgres;
revoke all on function public.request_chilling_join_v2(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_chilling_join_v2(uuid,text,text,text) to authenticated;

-- Explicit account deletion follows the existing personal-data purge, separate from meetup departure.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  anchor:='  delete from public.meetup_requests where id = any(meetup_request_ids);';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_PROFILE_ACCOUNT_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,$purge$
  delete from public.safety_review_queue where (target_type='chilling_profile' and target_id=current_user_id)
    or (target_type='chilling_application' and target_id=any(meetup_request_ids));
  delete from private.chilling_profiles where id=current_user_id;
$purge$||anchor);
  -- Parent post/request deletion already cascades public-host and application revision rows.
  definition:=pg_get_functiondef('public.account_image_cleanup_paths(uuid,text,text[])'::regprocedure);
  anchor:='''merchant-profile-images'')';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_PROFILE_ACCOUNT_MEDIA_ALLOWLIST_CHANGED'; end if;
  definition:=replace(definition,anchor,'''merchant-profile-images'',''meetup-profiles'')');
  anchor:='  foreach path in array p_paths loop';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_PROFILE_ACCOUNT_MEDIA_LOOP_CHANGED'; end if;
  execute replace(definition,anchor,$cleanup$
  if p_bucket='meetup-profiles' then
    perform private.lock_relationships();
    if exists(select 1 from unnest(p_paths) x where not private.chilling_photo_path_valid(x,p_user_id))
      or exists(select 1 from public.profiles p where p.id=p_user_id and p.account_status<>'deleted') then
      raise exception 'INVALID_ACCOUNT_IMAGE_CLEANUP';
    end if;
  end if;
$cleanup$||anchor);
end $$;

-- Opt-in OS message previews must use meetup aliases; business/direct preview branches are retained.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.claim_push_notifications(text,integer)'::regprocedure);
  anchor:='sender.nickname::text';
  if strpos(definition,anchor)=0 then raise exception 'CHILLING_MESSAGE_PUSH_IDENTITY_CHANGED'; end if;
  execute replace(definition,anchor,$name$
    (case when exists(select 1 from public.conversations c where c.id=m.conversation_id and c.kind='group') then
      coalesce((select h.profile->>'displayName' from private.chilling_host_profiles h join public.conversations c on c.group_post_id=h.post_id
        where c.id=m.conversation_id and h.author_id=m.sender_id),
        (select a.profile->>'displayName' from private.chilling_applications a join public.meetup_requests r on r.id=a.id
          join public.conversations c on c.group_post_id=r.post_id where c.id=m.conversation_id and r.requester_id=m.sender_id),'모임 멤버')
      else sender.nickname::text end)
$name$);
end $$;

-- Fixed control IDs contain no profile, answer or photo content.
insert into private.behavior_targets(id) values
  ('meetup.requests.more'),
  ('meetup-create.host-consent'),
  ('meetup-create.profile-edit'),
  ('meetup-profile.cancel'),
  ('meetup-profile.remove-photo'),
  ('meetup-profile.prompt'),
  ('meetup-profile.pace'),
  ('meetup-profile.preview-audience'),
  ('meetup-profile.share-members'),
  ('meetup-profile.public-photo-none'),
  ('meetup-profile.public-photo'),
  ('profile.meetup-profile'),
  ('meetup.member-profile'),
  ('meetup.message-profile'),
  ('meetup.ai-preview.apply'),
  ('meetup.ai-preview.dismiss'),
  ('meetup_host_tools.control.1'),
  ('meetup_host_tools.control.2'),
  ('meetup_host_tools.control.3'),
  ('meetup_host_tools.control.4'),
  ('meetup_host_tools.control.5'),
  ('meetup_host_tools.control.6'),
  ('meetup_host_tools.control.7'),
  ('meetup_host_tools.control.8'),
  ('meetup_host_tools.control.9'),
  ('meetup_host_tools.control.10'),
  ('meetup_host_tools.control.11'),
  ('meetup_template_picker.control.1'),
  ('meetup_template_picker.control.2'),
  ('meetup_template_picker.control.3'),
  ('meetup_template_picker.control.4'),
  ('meetup_template_picker.control.5')
on conflict (id) do nothing;
notify pgrst,'reload schema';
