-- 공개 모임 멤버 보기와 초대용 모임 (owner 2026-11-08, docs/AUTOMATION_POLICY.md 6-17).
-- room_preview.access: 'public' | 'invite', chosen at creation by new apps and fixed afterwards.
-- room_preview.membersVisible: applicants see the host and approved members (name, intro, interests; never photos, area or answers).
-- Meetups that already exist are switched on only by 20261108120100, which also sends the one-time notice.

-- 1) Invite links (one live token per meetup; a new token replaces the old one) and who was let in.
create table private.meetup_invite_links (
  post_id uuid primary key references public.posts(id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create table private.meetup_invitees (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  via text not null check (via in ('link','friend')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (post_id,user_id)
);
create index meetup_invitees_user on private.meetup_invitees(user_id);
do $$ declare t text; begin
 foreach t in array array['meetup_invite_links','meetup_invitees'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Host, invited people and anyone who already applied or joined.
create function private.meetup_invite_allowed(p_post_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_viewer is not null and (
    exists(select 1 from public.posts p where p.id=p_post_id and p.author_id=p_viewer)
    or exists(select 1 from private.meetup_invitees i where i.post_id=p_post_id and i.user_id=p_viewer)
    or exists(select 1 from public.meetup_requests r where r.post_id=p_post_id and r.requester_id=p_viewer and r.status in('pending','approved')));
$$;

-- Fellow members and applicants see intro and interests only of people who agreed to the v3 text
-- or who were approved before the one-time notice switched an existing meetup on.
create function private.meetup_profile_text_shared(p_preview jsonb, p_consent text, p_approved_at timestamptz) returns boolean
language sql stable set search_path='' as $$
  select coalesce(p_consent='chilling-v3' or p_approved_at<=(p_preview->>'membersVisibleAt')::timestamptz,false);
$$;

-- 2) What members agreed to never changes underneath them.
create function private.guard_meetup_access() returns trigger
language plpgsql set search_path='' as $$
begin
  if (old.room_preview ? 'access' and new.room_preview->'access' is distinct from old.room_preview->'access')
    or (new.room_preview is not null and old.room_preview->>'membersVisible'='true'
      and new.room_preview->'membersVisible' is distinct from old.room_preview->'membersVisible')
    or (new.room_preview->>'access'='invite' and new.room_preview->>'membersVisible'='true') then
    raise exception 'MEETUP_ACCESS_FIXED';
  end if;
  return new;
end $$;
create trigger posts_meetup_access before update of room_preview on public.posts
for each row execute function private.guard_meetup_access();

-- 3) Lists never show invite meetups: feeds, popular, discovery, author lists, saved posts, weekly ranking and share previews
-- all read private.business_public_posts. The detail read keeps them for the host, invited people, members and admins.
do $$
declare d text:=rtrim(rtrim(pg_get_viewdef('private.business_public_posts'::regclass)),';');
  anchor constant text:='FROM posts p';
  fn text:=pg_get_functiondef('private.business_base_get_public_post(uuid)'::regprocedure);
  source constant text:='from private.business_public_posts as post';
begin
  if array_length(string_to_array(d,anchor),1)<>2 or d not like '%WHERE ((business_author_id IS NULL) OR (private.public_post_business_id(id) IS NOT NULL))'
    or array_length(string_to_array(fn,source),1)<>2 then raise exception 'MEETUP_INVITE_VIEW_ANCHORS_MISSING'; end if;
  execute 'create view private.meetup_detail_posts as '||d
    ||' and (coalesce(room_preview->>''access'','''')<>''invite'' or private.is_admin() or private.meetup_invite_allowed(id,auth.uid()))';
  execute 'create or replace view private.business_public_posts as '||d||' and coalesce(room_preview->>''access'','''')<>''invite''';
  execute replace(fn,source,'from private.meetup_detail_posts as post');
end $$;
revoke all on private.meetup_detail_posts from public,anon,authenticated,service_role;

-- Direct table reads (chat rooms, my meetups, translations) follow the same rule.
create policy "invite meetups stay with their people" on public.posts as restrictive for select to authenticated
using (coalesce(room_preview->>'access','')<>'invite' or author_id=(select auth.uid()) or (select private.is_admin())
  or private.meetup_invite_allowed(id,(select auth.uid())));

-- Search, trending hashtags, newcomer picks, profile meetup count and every post notification (new-meetup alerts,
-- nearby, trending) read public.posts directly.
do $$
declare patch record; definition text;
begin
  for patch in select * from (values
    ('public.search_public_directory(text,text,text,integer,jsonb)',
     'where p_kind in(''all'',''post'',''meetup'') and p.status=''published''',
     'where p_kind in(''all'',''post'',''meetup'') and p.status=''published'' and coalesce(p.room_preview->>''access'','''')<>''invite'''),
    ('public.get_trending_hashtags(text,smallint,integer,integer)',
     'where post.status = ''published''',
     'where post.status = ''published'' and coalesce(post.room_preview->>''access'','''')<>''invite'''),
    ('private.newcomer_meetup_candidates(uuid)',
     'and private.notification_target_visible(p_user,''post'',p.id)',
     'and coalesce(p.room_preview->>''access'','''')<>''invite'' and private.notification_target_visible(p_user,''post'',p.id)'),
    ('public.get_profile_overview(uuid)',
     'and (own or not private.has_reported(uid,''post'',x.id))',
     'and (own or (not private.has_reported(uid,''post'',x.id) and coalesce(x.room_preview->>''access'','''')<>''invite''))'),
    ('private.notification_target_visible(uuid,text,uuid)',
     'and private.is_active_account(p.author_id) and not private.is_blocked_between(p_user_id, p.author_id))',
     'and private.is_active_account(p.author_id) and not private.is_blocked_between(p_user_id, p.author_id)
        and (coalesce(p.room_preview->>''access'','''')<>''invite'' or private.meetup_invite_allowed(p.id,p_user_id)))'),
    -- The one-time notice about existing meetups is in-app only.
    ('private.enqueue_push_notification()',
     'if new.kind in (''meetup_morning'',''admin_signup'',''admin_meetup_request'') then return new; end if;',
     'if new.kind in (''meetup_morning'',''admin_signup'',''admin_meetup_request'',''meetup_visibility'') then return new; end if;'),
    -- Invited people are only reachable through the host's own request.
    ('private.request_meetup_join(uuid,text)',
     'if meetup is null then raise exception ''MEETUP_NOT_FOUND''; end if;',
     'if meetup is null or (meetup.room_preview->>''access''=''invite'' and not private.meetup_invite_allowed(p_post_id,current_user_id)) then raise exception ''MEETUP_NOT_FOUND''; end if;')
  ) as p(signature,anchor,replacement) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    if array_length(string_to_array(definition,patch.anchor),1)<>2 then raise exception 'MEETUP_INVITE_ANCHOR_MISSING %',patch.signature; end if;
    execute replace(definition,patch.anchor,patch.replacement);
  end loop;
end $$;

-- 4) Context: an invite meetup is only visible to its people.
create or replace function private.chilling_context_visible(p_post_id uuid, p_viewer uuid) returns boolean
language sql security definer set search_path='' as $$
  select coalesce(p_viewer=auth.uid() and private.is_active_account(p_viewer) and exists(
    select 1 from public.posts p where p.id=p_post_id and p.room_preview is not null
      and p.status='published' and coalesce(p.room_preview->>'closed','false')<>'true'
      and not coalesce(p.room_preview->>'eventKind'='once' and (p.room_preview->>'endsAt')::timestamptz<=clock_timestamp(),false)
      and private.is_active_account(p.author_id)
      and not private.is_blocked_between(p_viewer,p.author_id)
      and not private.has_reported(p_viewer,'post',p.id)
      and not private.has_reported(p_viewer,'user',p.author_id)
      and not private.has_reported(p.author_id,'user',p_viewer)
      and (coalesce(p.room_preview->>'access','')<>'invite' or private.meetup_invite_allowed(p.id,p_viewer))
      and not exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=p_viewer
        and r.status in('cancelled','rejected'))),false);
$$;

-- 5) Members: the profile switch now decides photos only; intro and interests follow the consent above.
create or replace function private.chilling_member_projection(p_post_id uuid, p_subject uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); host uuid; preview jsonb; snapshot jsonb; member_status text; consent text; approved_at timestamptz;
  own boolean; photos boolean; profile_text boolean;
begin
  if not private.chilling_context_visible(p_post_id,u) or not private.chilling_pair_visible(u,p_subject) then return null; end if;
  select author_id,room_preview into host,preview from public.posts where id=p_post_id;
  if p_subject=host then
    select profile into snapshot from private.chilling_host_profiles where post_id=p_post_id;
  else
    select a.profile,r.status,a.consent_version,r.responded_at into snapshot,member_status,consent,approved_at from public.meetup_requests r
      left join private.chilling_applications a on a.id=r.id and a.author_id=r.requester_id
      where r.post_id=p_post_id and r.requester_id=p_subject;
    if member_status is null or member_status not in('pending','approved') then return null; end if;
    if private.is_blocked_between(p_subject,host) or private.has_reported(p_subject,'post',p_post_id)
      or private.has_reported(p_subject,'user',host) or private.has_reported(host,'user',p_subject) then return null; end if;
    if u not in(host,p_subject) and (member_status<>'approved' or not exists(select 1 from public.meetup_requests
      where post_id=p_post_id and requester_id=u and status='approved')) then return null; end if;
  end if;
  snapshot:=coalesce(snapshot,'{}'::jsonb);
  own:=p_subject=host or u in(host,p_subject);
  photos:=own or coalesce(snapshot->'shareWithMembers'='true'::jsonb,false);
  profile_text:=photos or (member_status='approved' and private.meetup_profile_text_shared(preview,consent,approved_at));
  return jsonb_build_object('userId',p_subject,'displayName',coalesce(snapshot->>'displayName',''),'cityId',case when own then snapshot->>'cityId' end,
    'photoPaths',case when photos then coalesce(snapshot->'photoPaths','[]'::jsonb) else '[]'::jsonb end,
    'intro',case when profile_text then coalesce(snapshot->>'intro','') else '' end,
    'interests',case when profile_text then coalesce(snapshot->'interests','[]'::jsonb) else '[]'::jsonb end,'isHost',p_subject=host);
end;
$$;

-- 6) '누가 와요': host and approved members for signed-in people who could apply. No photos, area or answers.
create function public.get_meetup_public_roster(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); meetup public.posts; result jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  select * into meetup from public.posts where id=p_post_id;
  if meetup.id is null or meetup.room_preview->>'membersVisible' is distinct from 'true'
    or coalesce(meetup.room_preview->>'access','')='invite' or not private.chilling_context_visible(p_post_id,u) then return null; end if;
  select coalesce(jsonb_agg(m.item order by m.is_host desc,m.approved_at,m.id),'[]'::jsonb) into result from (
    select x.id,x.is_host,x.approved_at,jsonb_build_object('userId',x.id,'displayName',coalesce(x.snapshot->>'displayName',''),
      'intro',coalesce(x.snapshot->>'intro',''),'interests',coalesce(x.snapshot->'interests','[]'::jsonb),'isHost',x.is_host) item
    from (
      select meetup.author_id id,true is_host,null::timestamptz approved_at,h.profile snapshot
        from private.chilling_host_profiles h where h.post_id=p_post_id
      union all
      select r.requester_id,false,r.responded_at,a.profile from public.meetup_requests r
        left join private.chilling_applications a on a.id=r.id and a.author_id=r.requester_id
        where r.post_id=p_post_id and r.status='approved' and coalesce(a.profile->>'displayName','')<>''
          and private.meetup_profile_text_shared(meetup.room_preview,a.consent_version,r.responded_at)
          and not private.is_blocked_between(r.requester_id,meetup.author_id) and not private.has_reported(r.requester_id,'post',p_post_id)
          and not private.has_reported(r.requester_id,'user',meetup.author_id) and not private.has_reported(meetup.author_id,'user',r.requester_id)
      order by is_host desc,approved_at limit 5000) x
    where private.chilling_pair_visible(u,x.id)) m;
  return result;
end;
$$;

-- 7) Consent v3 says applicants see approved members' name, intro and interests. Older apps keep sending
-- v1/v2 and keep working: meetup_profile_text_shared leaves them out of '누가 와요', as their text promised.
-- Invite meetups are refused to outsiders by the request_meetup_join patch above.
create or replace function private.request_chilling_join(p_post_id uuid, p_answer text, p_consent_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); snapshot jsonb; request_id uuid; prior_status text; question text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if p_consent_version is null or p_consent_version not in('chilling-v1','chilling-v2','chilling-v3') then raise exception 'CHILLING_CONSENT_REQUIRED'; end if;
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
create or replace function public.request_chilling_join(p_post_id uuid, p_answer text, p_consent_version text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if p_consent_version in('chilling-v2','chilling-v3') then raise exception 'CHILLING_PROFILE_CHANGED'; end if;
  return private.request_chilling_join(p_post_id,p_answer,p_consent_version);
end;
$$;

-- 8) Creating: new apps send access. Public ones show members straight away; invite ones take back the
-- follower alert that fired on insert, before access was known.
create or replace function public.create_chilling_event(p_city_id text, p_title text, p_body text, p_event jsonb, p_question text, p_image_paths text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare host_snapshot jsonb; host_revision text; new_post uuid; meetup_tag smallint; category text:=coalesce(p_event->>'category','casual');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if coalesce(cardinality(p_image_paths),0)>1 then raise exception 'TOO_MANY_IMAGES'; end if;
  if exists(select 1 from unnest(p_image_paths) path where path is null) then raise exception 'INVALID_IMAGE_PATH'; end if;
  if not exists(select 1 from private.chilling_profiles where id=auth.uid()) then raise exception 'CHILLING_PROFILE_REQUIRED'; end if;
  if jsonb_typeof(p_event) is distinct from 'object'
    or (p_event-array['eventKind','startsAt','endsAt','timezone','cadence','capacity','category','recommendedAgeMin','recommendedAgeMax','hostProfileConsentVersion','hostProfileRevision','languageExchange','access'])<>'{}'::jsonb
    or (p_event ? 'access' and (jsonb_typeof(p_event->'access') is distinct from 'string' or p_event->>'access' not in('public','invite'))) then
    raise exception 'INVALID_CHILLING_EVENT';
  end if;
  if category not in ('casual','hobby','travel','party','festival','sports') then raise exception 'INVALID_EVENT_CATEGORY'; end if;
  if p_question is null or char_length(trim(p_question)) not between 1 and 300 then raise exception 'INVALID_APPLICATION_QUESTION'; end if;
  perform private.lock_relationships();
  perform private.assert_meetup_hosting(auth.uid(),p_event->>'eventKind'='once');

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
  if p_event ? 'languageExchange' then
    if category<>'casual' then raise exception 'INVALID_EVENT_CATEGORY'; end if;
    perform private.meetup_language_exchange(p_event->'languageExchange',
      case when jsonb_typeof(p_event->'capacity')='number' then least(floor((p_event->>'capacity')::numeric),100000)::integer end);
  end if;
  -- Preserve create_post's consent, moderation, membership, quota, cooldown and slot checks.
  select id into meetup_tag from public.tags where kind='meetup' order by id limit 1;
  new_post:=public.create_post(p_city_id,meetup_tag,p_title,p_body,p_image_paths=>p_image_paths,p_room_preview=>'{}'::jsonb);
  perform private.validate_chilling_event(new_post,p_event);
  perform public.configure_chilling_event(new_post,p_event->>'eventKind',(p_event->>'startsAt')::timestamptz,
    (p_event->>'endsAt')::timestamptz,p_event->>'timezone',p_event->>'cadence',(p_event->>'capacity')::integer);
  update public.posts set room_preview=room_preview||jsonb_build_object('applicationQuestion',trim(p_question),'category',category,'recommendedAgeMin',p_event->'recommendedAgeMin','recommendedAgeMax',p_event->'recommendedAgeMax')
    ||case when p_event ? 'access' then jsonb_build_object('access',p_event->>'access','membersVisible',p_event->>'access'='public') else '{}'::jsonb end
    where id=new_post;
  if p_event->>'access'='invite' then
    delete from public.notifications n where n.target_type='post' and n.target_id=new_post and not private.meetup_invite_allowed(new_post,n.user_id);
    delete from private.host_follow_alerts a where a.post_id=new_post;
    update private.meetup_encores e set notified_post_id=null where e.notified_post_id=new_post;
    update private.host_meetup_broadcasts b set recipients=0 where b.post_id=new_post;
  end if;

  insert into private.chilling_host_profiles(post_id,author_id,profile,consent_version)
    values(new_post,auth.uid(),private.chilling_host_public(host_snapshot),
      case when host_snapshot->'version'='2'::jsonb then 'chilling-v2' else 'chilling-v1' end);
  if p_event ? 'languageExchange' then
    update public.posts set room_preview=room_preview||jsonb_build_object('languageExchange',
      private.meetup_language_exchange(p_event->'languageExchange',(p_event->>'capacity')::integer)) where id=new_post;
  end if;
  return new_post;
end;
$$;

-- 9) Invites. A link is reused until the host asks for a new one; a new one blocks the old link and
-- drops people who only opened it and never applied.
create function public.get_meetup_invite_link(p_post_id uuid, p_renew boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); current_token text;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  if not exists(select 1 from public.posts p where p.id=p_post_id and p.author_id=u and p.room_preview->>'access'='invite'
    and private.meetup_is_open(p.status,p.room_preview)) then raise exception 'MEETUP_NOT_FOUND'; end if;
  select token into current_token from private.meetup_invite_links where post_id=p_post_id for update;
  if current_token is not null and not coalesce(p_renew,false) then return current_token; end if;
  perform private.enforce_rate_limit('meetup_invite_link',20,interval '1 day');
  current_token:=replace(gen_random_uuid()::text,'-','');
  insert into private.meetup_invite_links(post_id,token,created_by) values(p_post_id,current_token,u)
  on conflict(post_id) do update set token=excluded.token,created_by=excluded.created_by,created_at=clock_timestamp();
  delete from private.meetup_invitees i where i.post_id=p_post_id and i.via='link'
    and not exists(select 1 from public.meetup_requests r where r.post_id=i.post_id and r.requester_id=i.user_id and r.status in('pending','approved'));
  return current_token;
end;
$$;

create function public.open_meetup_invite(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  select l.post_id into target from private.meetup_invite_links l join public.posts p on p.id=l.post_id
    where p_token ~ '^[0-9a-f]{32}$' and l.token=p_token and p.room_preview->>'access'='invite';
  if target is null then raise exception 'MEETUP_INVITE_INVALID'; end if;
  insert into private.meetup_invitees(post_id,user_id,via,invited_by)
    select target,u,'link',p.author_id from public.posts p where p.id=target and p.author_id<>u
  on conflict do nothing;
  -- Closed, ended, blocked or reported pairs see nothing, exactly like a public meetup.
  if not private.chilling_context_visible(target,u) then raise exception 'MEETUP_INVITE_INVALID'; end if;
  return target;
end;
$$;

create function public.invite_meetup_friends(p_post_id uuid, p_user_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); meetup public.posts; host_name text; friend uuid; sent integer:=0;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  if coalesce(cardinality(p_user_ids),0) not between 1 and 50 or array_position(p_user_ids,null) is not null then raise exception 'MEETUP_INVITE_INVALID'; end if;
  select * into meetup from public.posts where id=p_post_id and author_id=u and room_preview->>'access'='invite' for update;
  if meetup.id is null or not private.meetup_is_open(meetup.status,meetup.room_preview) then raise exception 'MEETUP_NOT_FOUND'; end if;
  -- Only mutual friends who can still see each other; one bad pick rejects the whole send.
  if exists(select 1 from unnest(p_user_ids) x(id) where x.id=u or not private.are_friends(u,x.id) or not private.is_active_account(x.id)
    or private.is_operated_character(x.id) or private.is_blocked_between(u,x.id)
    or private.has_reported(u,'user',x.id) or private.has_reported(x.id,'user',u) or private.has_reported(x.id,'post',p_post_id)) then
    raise exception 'MEETUP_INVITE_NOT_FRIEND';
  end if;
  perform private.enforce_rate_limit('meetup_friend_invite',30,interval '1 day');
  select coalesce(nullif(h.profile->>'displayName',''),'호스트') into host_name from private.chilling_host_profiles h where h.post_id=p_post_id;
  for friend in select distinct x.id from unnest(p_user_ids) x(id) loop
    -- Already applied or joined: nothing to send.
    continue when exists(select 1 from public.meetup_requests r where r.post_id=p_post_id and r.requester_id=friend and r.status in('pending','approved'));
    insert into private.meetup_invitees(post_id,user_id,via,invited_by) values(p_post_id,friend,'friend',u) on conflict do nothing;
    continue when not found;
    if private.create_notification(friend,'meetup_invite',u,'post',p_post_id,
      coalesce(host_name,'호스트')||'님이 「'||left(meetup.title,80)||'」 모임에 초대했어요.','/post/'||p_post_id::text) is not null then
      sent:=sent+1;
    end if;
  end loop;
  return sent;
end;
$$;

-- Invite alerts sit with the other meetup alerts in the bell and in notification settings.
do $$
declare definition text; anchor constant text:='when ''message_reaction'' then ''messages''';
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
   where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' or definition like '%meetup_invite%' then raise exception 'MEETUP_INVITE_KIND_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check '||
    replace(definition,'CHECK (','CHECK (kind = ''meetup_invite'' or kind = ''meetup_visibility'' or ');
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_INVITE_CATEGORY_CHANGED'; end if;
  -- meetup_visibility stays 'system' (the default branch): everyone affected gets the notice once.
  execute replace(definition,anchor,'when ''meetup_invite'' then ''meetups'' '||anchor);
end $$;

do $$ declare signature text; begin
 foreach signature in array array['private.meetup_invite_allowed(uuid,uuid)','private.meetup_profile_text_shared(jsonb,text,timestamp with time zone)',
  'private.guard_meetup_access()','public.get_meetup_public_roster(uuid)','public.get_meetup_invite_link(uuid,boolean)',
  'public.open_meetup_invite(text)','public.invite_meetup_friends(uuid,uuid[])'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
-- The posts policy runs as the reader, like private.has_reported in "reporter hides posts".
grant execute on function private.meetup_invite_allowed(uuid,uuid) to authenticated;
grant execute on function public.get_meetup_public_roster(uuid),public.get_meetup_invite_link(uuid,boolean),
  public.open_meetup_invite(text),public.invite_meetup_friends(uuid,uuid[]) to authenticated;

-- New controls: an unknown target would reject the whole analytics batch.
insert into private.behavior_targets(id) values
 ('meetup.create.access'),('meetup.join.who'),('meetup.who.sheet'),('meetup.who.retry'),('meetup.who.all'),
 ('meetup.invite.share'),('meetup.invite.friends'),('meetup.invite.renew'),('meetup.invite.friends.sheet'),
 ('meetup.invite.friends.retry'),('meetup.invite.friends.pick'),('meetup.invite.friends.send'),
 ('meetup-invite.login'),('meetup-invite.retry'),('meetup-invite.home')
 on conflict do nothing;
