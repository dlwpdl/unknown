-- 모임 안 날짜·장소 투표 (owner 2026-11-15/16: 날짜는 채팅에서 합의하던 걸 모임 안에서 투표로, 모든 등급 무료).
-- 모임마다 열린 투표는 하나. 호스트와 공동호스트가 열고 닫고, 승인된 멤버와 호스트가 여러 개를 골라 표를 바꿀 수 있다.
-- 투표자 이름은 저장하되 누구에게도 돌려주지 않는다: 화면에는 후보별 표 수와 내가 고른 것만 나온다.
-- 날짜를 고르면 한 번 하는 모임은 기존 일정(room_preview)을 바꿔 일정 변경 알림·리마인더가 그대로 돌고,
-- 정기 모임은 다음 회차 하나를 만든다. 장소를 고르면 본문의 장소 줄을 바꾼다(기존 변경 알림 대상).
set local lock_timeout = '5s';

create table private.meetup_polls(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'open' check(status in('open','decided','closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index meetup_polls_one_open on private.meetup_polls(post_id) where status='open';
create index meetup_polls_post_idx on private.meetup_polls(post_id,created_at desc);
create index meetup_polls_creator_idx on private.meetup_polls(created_by);

create table private.meetup_poll_options(
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references private.meetup_polls(id) on delete cascade,
  kind text not null check(kind in('date','place')),
  starts_at timestamptz,
  label text check(char_length(label) between 1 and 60),
  position smallint not null,
  chosen boolean not null default false,
  unique(poll_id,position),
  check((kind='date' and starts_at is not null and label is null) or (kind='place' and label is not null and starts_at is null))
);

create table private.meetup_poll_votes(
  option_id uuid not null references private.meetup_poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(option_id,user_id)
);
create index meetup_poll_votes_user_idx on private.meetup_poll_votes(user_id);

alter table private.meetup_polls enable row level security;
alter table private.meetup_poll_options enable row level security;
alter table private.meetup_poll_votes enable row level security;
revoke all on private.meetup_polls,private.meetup_poll_options,private.meetup_poll_votes from public,anon,authenticated,service_role;
alter table private.meetup_polls owner to postgres;
alter table private.meetup_poll_options owner to postgres;
alter table private.meetup_poll_votes owner to postgres;

-- host / cohost / member of this meetup, or null. Blocks and reports are the same ones the other host tools use.
create function private.meetup_poll_role(p_post uuid,p_user uuid) returns text
language sql stable security definer set search_path='' as $$
  select case
    when exists(select 1 from public.posts p where p.id=p_post and p.author_id=p_user) then 'host'
    when private.meetup_tool_cohost(p_post,p_user) then 'cohost'
    when private.meetup_tool_member(p_post,p_user) then 'member' end;
$$;

-- Everyone who belongs to the meetup now (host plus approved members), except the one who acted.
create function private.notify_meetup_poll(p_post uuid,p_actor uuid,p_body text) returns void
language plpgsql security definer set search_path='' as $$
declare event public.posts; room uuid; recipient uuid;
begin
  select * into event from public.posts where id=p_post;
  select id into room from public.conversations where group_post_id=p_post;
  for recipient in select event.author_id union select r.requester_id from public.meetup_requests r where r.post_id=p_post and r.status='approved' loop
    continue when recipient=p_actor or not private.host_loyalty_pair_ok(p_actor,recipient);
    -- Same kind, category and push as the other meetup notices, so released apps open it without a new kind.
    perform private.create_notification(recipient,'meetup_changed',p_actor,'post',p_post,p_body,
      case when room is null then '/post/'||p_post::text else '/chat?conversationId='||room::text end);
  end loop;
end $$;

create function public.create_meetup_poll(p_post_id uuid,p_dates timestamptz[] default '{}',p_places text[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; poll uuid; place text; clean text[]:='{}'; at timestamptz; n smallint:=0; what text;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if private.meetup_poll_role(event.id,u) not in('host','cohost') then raise exception 'HOST_REQUIRED'; end if;
  p_dates:=coalesce(p_dates,'{}'); p_places:=coalesce(p_places,'{}');
  if array_position(p_dates,null) is not null or array_position(p_places,null) is not null then raise exception 'INVALID_POLL'; end if;
  -- Each kind that is asked needs at least two choices; five of each at most.
  if cardinality(p_dates) not in(0,2,3,4,5) or cardinality(p_places) not in(0,2,3,4,5) or cardinality(p_dates)+cardinality(p_places)=0 then raise exception 'INVALID_POLL'; end if;
  if (select count(distinct d) from unnest(p_dates) d)<>cardinality(p_dates) then raise exception 'INVALID_POLL'; end if;
  foreach at in array p_dates loop
    if not isfinite(at) or at<=clock_timestamp() or at>clock_timestamp()+interval '1 year' then raise exception 'INVALID_POLL_DATE'; end if;
  end loop;
  foreach place in array p_places loop
    place:=btrim(place);
    if char_length(place) not between 1 and 60 or place ~ '[[:cntrl:]]' then raise exception 'INVALID_POLL_PLACE'; end if;
    perform private.assert_content_allowed(place);
    clean:=clean||place;
  end loop;
  if (select count(distinct lower(c)) from unnest(clean) c)<>cardinality(clean) then raise exception 'INVALID_POLL_PLACE'; end if;
  if exists(select 1 from private.meetup_polls where post_id=event.id and status='open') then raise exception 'POLL_ALREADY_OPEN'; end if;
  perform private.enforce_rate_limit('meetup_poll',6,interval '1 day');
  insert into private.meetup_polls(post_id,created_by) values(event.id,u) returning id into poll;
  foreach at in array p_dates loop
    n:=n+1; insert into private.meetup_poll_options(poll_id,kind,starts_at,position) values(poll,'date',at,n);
  end loop;
  foreach place in array clean loop
    n:=n+1; insert into private.meetup_poll_options(poll_id,kind,label,position) values(poll,'place',place,n);
  end loop;
  what:=case when cardinality(p_dates)>0 and cardinality(p_places)>0 then '날짜와 장소 투표가 열렸어요. 되는 날과 가고 싶은 곳을 골라 주세요.'
    when cardinality(p_dates)>0 then '날짜 투표가 열렸어요. 되는 날을 골라 주세요.' else '장소 투표가 열렸어요. 가고 싶은 곳을 골라 주세요.' end;
  perform private.notify_meetup_poll(event.id,u,'「'||left(event.title,60)||'」 '||what);
  return poll;
end $$;

-- The caller's whole choice for this poll. An empty list takes the vote back.
create function public.vote_meetup_poll(p_poll_id uuid,p_option_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); poll private.meetup_polls; event public.posts;
begin
  select * into poll from private.meetup_polls where id=p_poll_id;
  if poll.id is null then raise exception 'POLL_NOT_FOUND'; end if;
  event:=private.meetup_tool_context(poll.post_id,u);
  if private.meetup_poll_role(event.id,u) is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if poll.status<>'open' then raise exception 'POLL_NOT_OPEN'; end if;
  if p_option_ids is null or cardinality(p_option_ids)>10 or array_position(p_option_ids,null) is not null
    or exists(select 1 from unnest(p_option_ids) x where not exists(select 1 from private.meetup_poll_options o where o.id=x and o.poll_id=poll.id))
    then raise exception 'INVALID_POLL_VOTE'; end if;
  perform private.enforce_rate_limit('meetup_poll_vote',120,interval '1 hour');
  delete from private.meetup_poll_votes v using private.meetup_poll_options o
    where v.user_id=u and o.id=v.option_id and o.poll_id=poll.id and not (o.id=any(p_option_ids));
  insert into private.meetup_poll_votes(option_id,user_id) select distinct x,u from unnest(p_option_ids) x on conflict do nothing;
end $$;

-- No winner picked = close the poll as it is. A picked date or place is applied to the meetup in the same transaction.
create function public.decide_meetup_poll(p_poll_id uuid,p_date_option uuid default null,p_place_option uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); poll private.meetup_polls; event public.posts; date_opt private.meetup_poll_options; place_opt private.meetup_poll_options;
  preview jsonb; new_body text; start_at timestamptz; end_at timestamptz; zone text; parts text[]:='{}';
begin
  perform private.lock_relationships();
  select * into poll from private.meetup_polls where id=p_poll_id for update;
  if poll.id is null then raise exception 'POLL_NOT_FOUND'; end if;
  event:=private.meetup_tool_context(poll.post_id,u);
  if private.meetup_poll_role(event.id,u) not in('host','cohost') then raise exception 'HOST_REQUIRED'; end if;
  if poll.status<>'open' then raise exception 'POLL_NOT_OPEN'; end if;
  if p_date_option is null and p_place_option is null then
    update private.meetup_polls set status='closed',closed_at=clock_timestamp() where id=poll.id;
    return;
  end if;
  if p_date_option is not null then
    select * into date_opt from private.meetup_poll_options where id=p_date_option and poll_id=poll.id and kind='date';
    if date_opt.id is null then raise exception 'POLL_OPTION_NOT_FOUND'; end if;
    if date_opt.starts_at<=clock_timestamp() then raise exception 'POLL_DATE_PASSED'; end if;
  end if;
  if p_place_option is not null then
    select * into place_opt from private.meetup_poll_options where id=p_place_option and poll_id=poll.id and kind='place';
    if place_opt.id is null then raise exception 'POLL_OPTION_NOT_FOUND'; end if;
  end if;
  select * into event from public.posts where id=event.id for update;
  preview:=event.room_preview; new_body:=event.body;
  zone:=coalesce(preview->>'timezone',preview->'recurrence'->>'timezone',(select c.timezone from public.cities c where c.id=event.city_id),'America/Vancouver');
  if date_opt.id is not null then
    start_at:=date_opt.starts_at;
    if preview->>'eventKind'='once' then
      -- Keeps the meetup's length; the schedule-change notice and reminders follow from the new start.
      end_at:=start_at+((preview->>'endsAt')::timestamptz-(preview->>'startsAt')::timestamptz);
      preview:=preview||jsonb_build_object('startsAt',start_at,'endsAt',end_at);
    else
      -- A recurring group: the winner becomes its next session (two hours, like the add-session default).
      end_at:=start_at+interval '2 hours';
      if not exists(select 1 from private.meetup_sessions where post_id=event.id and starts_at=start_at) then
        if exists(select 1 from private.meetup_sessions where post_id=event.id and starts_at<end_at and ends_at>start_at) then raise exception 'SESSION_OVERLAP'; end if;
        with created as(insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at) values(event.id,event.author_id,start_at,end_at) returning id)
        insert into private.meetup_attendance(session_id,user_id)
          select c.id,event.author_id from created c union select c.id,r.requester_id from created c cross join public.meetup_requests r
            where r.post_id=event.id and r.status='approved' and coalesce(r.responded_at,r.created_at)<=end_at;
      end if;
    end if;
    parts:=parts||to_char(start_at at time zone private.meetup_clock_zone(zone,start_at),'MM/DD HH24:MI');
  end if;
  if place_opt.id is not null then
    -- Replaces the place footer and a stale map link; the rest of the text stays.
    new_body:=regexp_replace(new_body,E'\n\n장소: [^\n]*(\n장소 정보: https://www\\.openstreetmap\\.org/[a-z]+/[0-9]+)?$','');
    new_body:=regexp_replace(new_body,E'\n\nGoogle 지도: [^\n]*(\n위치: [^\n]*)?','');
    new_body:=rtrim(new_body)||E'\n\n장소: '||place_opt.label;
    parts:=parts||place_opt.label;
  end if;
  update public.posts set room_preview=preview,body=new_body where id=event.id and (room_preview is distinct from preview or body is distinct from new_body);
  update private.meetup_poll_options set chosen=true where id in(date_opt.id,place_opt.id);
  update private.meetup_polls set status='decided',closed_at=clock_timestamp() where id=poll.id;
  -- A changed once-meetup schedule or place already sent the standard change notice from the posts trigger; tell everyone only when it did not.
  if private.meetup_notice_snapshot(event.room_preview,event.body)=private.meetup_notice_snapshot(preview,new_body) then
    perform private.notify_meetup_poll(event.id,u,'「'||left(event.title,60)||'」 투표 결과가 나왔어요. '||array_to_string(parts,' · '));
  end if;
end $$;

-- The open poll, or the last decided one for three days so members see what was picked. Counts only: no voter is ever returned.
create function public.get_meetup_poll(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; role text; poll private.meetup_polls;
begin
  if u is null or not private.is_active_account(u) then return null; end if;
  select * into event from public.posts where id=p_post_id and status='published' and room_preview is not null;
  if event.id is null or coalesce(event.room_preview->>'closed','false')='true' then return null; end if;
  role:=private.meetup_poll_role(event.id,u);
  if role is null then return null; end if;
  select * into poll from private.meetup_polls where post_id=event.id and (status='open' or (status='decided' and closed_at>now()-interval '3 days'))
    order by (status='open') desc,created_at desc limit 1;
  if poll.id is null then return null; end if;
  return jsonb_build_object('id',poll.id,'status',poll.status,'canManage',role in('host','cohost'),'closedAt',poll.closed_at,
    'members',1+(select count(*) from public.meetup_requests r where r.post_id=event.id and r.status='approved'),
    'voters',(select count(distinct v.user_id) from private.meetup_poll_votes v join private.meetup_poll_options o on o.id=v.option_id
      where o.poll_id=poll.id and (v.user_id=event.author_id or exists(select 1 from public.meetup_requests r where r.post_id=event.id and r.requester_id=v.user_id and r.status='approved'))),
    'options',(select jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'startsAt',o.starts_at,'label',o.label,'chosen',o.chosen,
      'votes',(select count(*) from private.meetup_poll_votes v where v.option_id=o.id
        and (v.user_id=event.author_id or exists(select 1 from public.meetup_requests r where r.post_id=event.id and r.requester_id=v.user_id and r.status='approved'))),
      'mine',exists(select 1 from private.meetup_poll_votes v where v.option_id=o.id and v.user_id=u)) order by o.kind,o.position)
      from private.meetup_poll_options o where o.poll_id=poll.id));
end $$;

-- Account deletion: the votes of this person and the polls of this person's meetups. Same hook the other meetup tools use.
create function private.purge_meetup_poll_account_data(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from private.meetup_poll_votes where user_id=p_user_id;
  delete from private.meetup_polls where created_by=p_user_id or post_id in(select id from public.posts where author_id=p_user_id);
end $$;
do $$
declare definition text; anchor text:='  delete from private.meetup_templates where owner_id=p_user_id;';
begin
  definition:=pg_get_functiondef('private.purge_meetup_tool_account_data(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_POLL_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n  perform private.purge_meetup_poll_account_data(p_user_id);');
end $$;

alter function private.meetup_poll_role(uuid,uuid) owner to postgres;
alter function private.notify_meetup_poll(uuid,uuid,text) owner to postgres;
alter function private.purge_meetup_poll_account_data(uuid) owner to postgres;
alter function public.create_meetup_poll(uuid,timestamptz[],text[]) owner to postgres;
alter function public.vote_meetup_poll(uuid,uuid[]) owner to postgres;
alter function public.decide_meetup_poll(uuid,uuid,uuid) owner to postgres;
alter function public.get_meetup_poll(uuid) owner to postgres;
revoke all on function private.meetup_poll_role(uuid,uuid),private.notify_meetup_poll(uuid,uuid,text),private.purge_meetup_poll_account_data(uuid),
  public.create_meetup_poll(uuid,timestamptz[],text[]),public.vote_meetup_poll(uuid,uuid[]),public.decide_meetup_poll(uuid,uuid,uuid),public.get_meetup_poll(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_meetup_poll(uuid,timestamptz[],text[]),public.vote_meetup_poll(uuid,uuid[]),
  public.decide_meetup_poll(uuid,uuid,uuid),public.get_meetup_poll(uuid) to authenticated;

-- New controls: an unknown target would reject the whole analytics batch.
insert into private.behavior_targets(id) values
  ('meetup.poll.create'),('meetup.poll.submit'),('meetup.poll.add-date'),('meetup.poll.add-place'),('meetup.poll.remove'),
  ('meetup.poll.vote'),('meetup.poll.decide'),('meetup.poll.close'),('meetup.poll.pick')
on conflict do nothing;
notify pgrst,'reload schema';
