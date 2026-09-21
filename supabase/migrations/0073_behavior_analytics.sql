-- Fixed UI identifiers only. No arbitrary text/properties, URLs or input values.
create table private.behavior_targets (id text primary key);
revoke all on private.behavior_targets from public, anon, authenticated;
insert into private.behavior_targets(id) values
('app_meetup-create.pressable.1'),
('app_meetup-create.scrollview.1'),
('app_meetup-create.pressable.2'),
('app_meetup-create.pressable.3'),
('app_meetup-create.pressable.4'),
('app_meetup-join.scrollview.1'),
('app_meetup-join.pressable.1'),
('app_meetup-join.pressable.2'),
('app_meetup-join.pressable.3'),
('app_meetup-join.pressable.4'),
('app_meetup-join.pressable.5'),
('app_meetup-join.pressable.6'),
('app_meetup-join.pressable.7'),
('app_meetup-join.pressable.8'),
('app_meetup-join.pressable.9'),
('app_meetup-application.scrollview.1'),
('app_meetup-application.pressable.1'),
('app_meetup-application.pressable.2'),
('app_meetup-profile.scrollview.1'),
('app_meetup-profile.pressable.1'),
('app_meetup-profile.pressable.2'),
('app_meetup-profile.pressable.3'),
('app_meetup-profile.pressable.4'),
('app_post_[id].pressable.1'),
('app_auth_callback.pressable.1'),
('app_tabs_meetups.flatlist.1'),
('app_tabs_meetups.pressable.1'),
('app_tabs_meetups.pressable.2'),
('app_tabs_meetups.pressable.3'),
('app_tabs_meetups.pressable.4'),
('app_tabs_meetups.scrollview.1'),
('app_tabs_meetups.pressable.5'),
('app_tabs_meetups.pressable.6'),
('app_tabs_notifications.pressable.1'),
('app_tabs_notifications.flatlist.1'),
('app_tabs_notifications.pressable.2'),
('app_tabs_chat.flatlist.1'),
('app_tabs_chat.pressable.1'),
('app_tabs_chat.pressable.2'),
('app_tabs_chat.pressable.3'),
('app_tabs_chat.pressable.4'),
('app_tabs_chat.pressable.5'),
('app_tabs_chat.pressable.6'),
('app_tabs_chat.pressable.7'),
('app_profile_settings.scrollview.1'),
('app_profile_settings.pressable.1'),
('app_profile_settings.pressable.2'),
('app_profile_settings.pressable.3'),
('app_profile_settings.pressable.4'),
('app_profile_settings.pressable.5'),
('app_profile_settings.pressable.6'),
('app_profile_settings.pressable.7'),
('app_profile_settings.pressable.8'),
('app_profile_index.pressable.1'),
('app_profile_index.pressable.2'),
('app_profile_index.pressable.3'),
('app_profile_index.pressable.4'),
('app_profile_index.pressable.5'),
('app_profile_index.pressable.6'),
('app_profile_index.pressable.7'),
('app_profile_index.pressable.8'),
('app_profile_index.pressable.9'),
('app_profile_index.pressable.10'),
('app_profile_index.flatlist.1'),
('app_profile_index.pressable.11'),
('app_profile_guidelines.scrollview.1'),
('app_profile_membership.scrollview.1'),
('app_profile_membership.pressable.1'),
('app_profile_membership.pressable.2'),
('app_profile_membership.pressable.3'),
('app_profile_membership.pressable.4'),
('app_profile_membership.pressable.5'),
('app_profile_membership.pressable.6'),
('app_profile_membership.pressable.7'),
('app_profile_membership.pressable.8'),
('app_profile_membership.pressable.9'),
('app_profile_membership.pressable.10'),
('app_profile_membership.pressable.11'),
('app_profile_promotions.pressable.1'),
('app_profile_promotions.scrollview.1'),
('app_profile_promotions.pressable.2'),
('app_profile_promotions.pressable.3'),
('app_profile_notifications.pressable.1'),
('app_profile_notifications.scrollview.1'),
('app_profile_notifications.pressable.2'),
('app_profile_notifications.pressable.3'),
('app_profile_notifications.pressable.4'),
('app_profile__layout.pressable.1'),
('components_report-sheet.pressable.1'),
('components_report-sheet.pressable.2'),
('components_report-sheet.pressable.3'),
('components_report-sheet.pressable.4'),
('components_report-sheet.pressable.5'),
('components_profile-avatar-button.pressable.1'),
('components_personal-info-card.pressable.1'),
('components_personal-info-card.pressable.2'),
('components_personal-info-card.pressable.3'),
('components_personal-info-card.pressable.4'),
('components_personal-info-card.pressable.5'),
('components_error-boundary.pressable.1'),
('components_login-panel.scrollview.1'),
('components_login-panel.pressable.1'),
('components_login-panel.pressable.2'),
('components_login-panel.pressable.3'),
('components_login-panel.pressable.4'),
('components_login-panel.pressable.5'),
('components_login-panel.pressable.6'),
('components_personal-info-fields.pressable.1'),
('components_weekly-ranking.pressable.1'),
('components_weekly-ranking.pressable.2'),
('components_chat-members.pressable.1'),
('components_chat-members.pressable.2'),
('components_chat-members.pressable.3'),
('components_chat-members.pressable.4'),
('components_chat-members.flatlist.1'),
('components_feed-screen.flatlist.1'),
('components_feed-screen.pressable.1'),
('components_feed-screen.pressable.2'),
('components_feed-screen.scrollview.1'),
('components_feed-screen.pressable.3'),
('components_feed-screen.pressable.4'),
('components_feed-screen.pressable.5'),
('components_feed-screen.pressable.6'),
('components_feed-screen.pressable.7'),
('components_feed-screen.pressable.8'),
('components_feed-screen.pressable.9'),
('components_feed-screen.flatlist.2'),
('components_feed-screen.pressable.10'),
('components_feed-screen.pressable.11'),
('components_feed-screen.pressable.12'),
('components_feed-screen.pressable.13'),
('components_feed-screen.pressable.14'),
('components_feed-screen.pressable.15'),
('components_feed-screen.scrollview.2'),
('components_feed-screen.pressable.16'),
('components_feed-screen.pressable.17'),
('components_feed-screen.pressable.18'),
('components_feed-screen.pressable.19'),
('components_feed-screen.pressable.20'),
('components_feed-screen.pressable.21'),
('components_feed-screen.pressable.22'),
('components_feed-screen.pressable.23'),
('components_feed-screen.pressable.24'),
('components_feed-screen.pressable.25'),
('components_feed-screen.pressable.26'),
('components_feed-screen.scrollview.3'),
('components_feed-screen.pressable.27'),
('components_chilling-event.pressable.1'),
('components_chilling-event.pressable.2'),
('components_chilling-event.pressable.3'),
('components_chilling-event.pressable.4'),
('components_relationship-slot-card.pressable.1'),
('components_app-tabs.web.pressable.1'),
('components_profile-onboarding.scrollview.1'),
('components_profile-onboarding.pressable.1'),
('components_profile-onboarding.pressable.2'),
('components_profile-onboarding.pressable.3'),
('components_profile-onboarding.pressable.4'),
('components_profile-onboarding.pressable.5'),
('components_profile-onboarding.pressable.6'),
('components_profile-onboarding.pressable.7'),
('components_profile-onboarding.pressable.8'),
('components_profile-onboarding.pressable.9'),
('components_profile-onboarding.pressable.10'),
('components_profile-onboarding.pressable.11'),
('components_post-detail.pressable.1'),
('components_post-detail.pressable.2'),
('components_post-detail.pressable.3'),
('components_post-detail.pressable.4'),
('components_post-detail.pressable.5'),
('components_post-detail.pressable.6'),
('components_post-detail.pressable.7'),
('components_post-detail.pressable.8'),
('components_post-detail.pressable.9'),
('components_post-detail.pressable.10'),
('components_post-detail.pressable.11'),
('components_post-detail.flatlist.1'),
('components_post-detail.pressable.12'),
('components_post-detail.pressable.13'),
('components_post-detail.pressable.14'),
('components_post-detail.pressable.15'),
('components_post-detail.pressable.16'),
('components_post-detail.pressable.17'),
('components_post-detail.pressable.18'),
('components_post-detail.pressable.19'),
('components_post-detail.pressable.20'),
('components_push-invite.pressable.1'),
('components_push-invite.pressable.2'),
('components_push-invite.pressable.3'),
('components_chat-room.pressable.1'),
('components_chat-room.pressable.2'),
('components_chat-room.scrollview.1'),
('components_chat-room.flatlist.1'),
('components_chilling-host-profile.pressable.1'),
('components_post-card.pressable.1'),
('components_post-card.pressable.2'),
('components_post-card.pressable.3'),
('components_post-card.pressable.4'),
('components_post-card.pressable.5'),
('components_post-card.pressable.6'),
('components_post-card.pressable.7'),
('components_post-card.pressable.8'),
('components_post-card.pressable.9'),
('components_post-card.pressable.10'),
('components_city-picker.pressable.1'),
('components_city-picker.pressable.2'),
('components_city-picker.pressable.3'),
('components_city-picker.pressable.4'),
('components_city-picker.pressable.5'),
('components_city-picker.pressable.6'),
('components_user-sheet.pressable.1'),
('components_user-sheet.pressable.2'),
('components_user-sheet.pressable.3'),
('components_user-sheet.pressable.4'),
('components_user-sheet.pressable.5'),
('components_user-sheet.pressable.6'),
('components_nearby-city-card.pressable.1'),
('components_nearby-city-card.pressable.2'),
('components_nearby-city-card.pressable.3'),
('components_nearby-city-card.pressable.4'),
('components_nearby-city-card.pressable.5'),
('components_my-meetups.pressable.1'),
('components_my-meetups.scrollview.1'),
('components_my-meetups.pressable.2'),
('components_my-meetups.pressable.3'),
('components_my-meetups.pressable.4'),
('components_chilling-date-input.pressable.1'),
('components_meetup-cover-picker.pressable.1'),
('components_meetup-cover-picker.pressable.2'),
('components_ui_collapsible.pressable.1'),
('web_control_1'),
('web_control_2'),
('web_control_3'),
('web_control_4'),
('web_control_5'),
('web_control_6'),
('web_control_7'),
('web_control_8'),
('web_control_9'),
('web_control_10'),
('web_control_11'),
('web_control_12'),
('web_control_13'),
('web_control_14'),
('web_control_15'),
('web_control_16'),
('web_control_17'),
('web_control_18'),
('web_control_19'),
('web_control_20'),
('screen'),
('web_page'),
('signup_complete'),
('consent_complete'),
('meetup_request_complete');

insert into private.behavior_targets(id) values
('components_city-picker.sectionlist.1'),
('app_profile_notifications.switch.1.on'),
('app_profile_notifications.switch.1.off'),
('app_profile_settings.switch.1.on'),
('app_profile_settings.switch.1.off'),
('app_profile_settings.switch.2.on'),
('app_profile_settings.switch.2.off');

create table private.behavior_events (
  session_id text not null,
  seq integer not null,
  user_id uuid references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios','android','web')),
  screen text not null,
  kind text not null check (kind in ('view','press','scroll','dwell','success')),
  target text not null references private.behavior_targets(id),
  value integer not null,
  created_at timestamptz not null default now(),
  primary key (session_id, seq)
);
create index behavior_events_time_idx on private.behavior_events(created_at);
create index behavior_events_user_idx on private.behavior_events(user_id,created_at);
revoke all on private.behavior_events from public, anon, authenticated;

create function public.record_behavior_events(p_session text,p_platform text,p_events jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare e jsonb; uid uuid; n integer;
begin
  if p_session is null or p_session !~ '^[a-z0-9-]{20,80}$'
    or p_platform is null or p_platform not in ('ios','android','web')
    or p_events is null or jsonb_typeof(p_events)<>'array' or octet_length(p_events::text)>16000 then
    raise exception 'INVALID_BEHAVIOR';
  end if;
  n := jsonb_array_length(p_events);
  if n<1 or n>25 then raise exception 'INVALID_BEHAVIOR'; end if;
  select id into uid from public.profiles where id=auth.uid();
  if uid is not null then
    perform private.assert_active_account(uid);
    if private.is_admin() then return; end if;
    perform private.enforce_rate_limit('behavior',30,interval '1 minute');
  else
    -- ponytail: shared anonymous budget, replace with edge per-IP throttling if traffic grows.
    -- No IP is stored. Serialize the count/insert so parallel calls cannot exceed this cap.
    perform pg_advisory_xact_lock(7373001);
    if (select count(*) from private.behavior_events where user_id is null and created_at>now()-interval '1 minute')+n>6000 then
      raise exception 'RATE_LIMITED';
    end if;
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e)<>'object' or not (e ?& array['seq','screen','kind','target','value'])
      or (e - array['seq','screen','kind','target','value'])<>'{}'::jsonb
      or jsonb_typeof(e->'seq')<>'number' or (e->>'seq') !~ '^[0-9]{1,7}$'
      or (e->>'seq')::int not between 1 and 1000000
      or jsonb_typeof(e->'value')<>'number' or (e->>'value') !~ '^[0-9]{1,5}$'
      or coalesce(e->>'screen','') not in ('feed','meetups','write','chat','notifications','profile','membership','settings','post',
        'meetup-create','meetup-join','meetup-profile','meetup-application','inbox','notification-settings','promotions','guidelines','app-invitation')
      or coalesce(e->>'kind','') not in ('view','press','scroll','dwell','success')
      or not exists(select 1 from private.behavior_targets where id=e->>'target') then raise exception 'INVALID_BEHAVIOR'; end if;
    if (e->>'kind' in ('view','press','success') and (e->>'value')::int<>1)
      or (e->>'kind'='scroll' and (e->>'value')::int not in (25,50,75,100))
      or (e->>'kind'='dwell' and (e->>'value')::int not between 0 and 60000)
      or (e->>'kind' in ('view','dwell') and e->>'target'<>'screen')
      or (e->>'kind'='success' and e->>'target' not in ('signup_complete','consent_complete','meetup_request_complete')) then
      raise exception 'INVALID_BEHAVIOR';
    end if;
    insert into private.behavior_events(session_id,seq,user_id,platform,screen,kind,target,value)
    values(p_session,(e->>'seq')::int,uid,p_platform,e->>'screen',e->>'kind',e->>'target',(e->>'value')::int)
    on conflict(session_id,seq) do nothing;
  end loop;
end;
$$;
revoke all on function public.record_behavior_events(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_behavior_events(text,text,jsonb) to anon,authenticated;

create function public.get_admin_behavior(p_days integer default 30,p_city text default null,
  p_tier text default 'all',p_include_internal boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_days is null or p_days not in (7,30,90) or p_tier is null or p_tier not in ('all','free','plus','premium')
    or p_include_internal is null or (p_city is not null and not exists(select 1 from public.cities where id=p_city)) then
    raise exception 'INVALID_ANALYTICS_FILTER'; end if;
  perform public.log_admin_access('analytics');
  with events as materialized (
    select e.* from private.behavior_events e
    left join public.profiles p on p.id=e.user_id left join auth.users u on u.id=e.user_id
    where e.created_at >= ((date_trunc('day',now() at time zone 'UTC')-(p_days-1)*interval '1 day') at time zone 'UTC')
      and (p_city is null or p.city_id=p_city)
      and (p_tier='all' or private.membership_details(p.id)->>'tier'=p_tier)
      and (p_include_internal or (not coalesce(u.email like '%@seed.gling.invalid',false)
        and not coalesce(u.raw_app_meta_data->>'role'='admin',false)
        and not coalesce(u.raw_app_meta_data->'review_access'='true'::jsonb,false)))
  ) select jsonb_build_object(
    'screens',coalesce((select jsonb_agg(to_jsonb(s) order by s.views desc) from (
      select platform,screen,count(*) filter(where kind='view') views,
        count(distinct session_id) sessions,coalesce(sum(value) filter(where kind='dwell'),0) "dwellMs",
        count(*) filter(where kind='press') presses,
        count(*) filter(where kind='scroll' and value=100) "bottoms"
      from events group by platform,screen) s),'[]'::jsonb),
    'steps',coalesce((select jsonb_agg(to_jsonb(a)) from (
      select platform,screen,kind,target,value,count(*) count,count(distinct session_id) sessions
      from events where kind='success' group by platform,screen,kind,target,value) a),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(to_jsonb(a) order by a.count desc) from (
      select platform,screen,kind,target,value,count(*) count,count(distinct session_id) sessions
      from events where kind in ('press','scroll','success') group by platform,screen,kind,target,value
      order by count(*) desc limit 300) a),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r."createdAt" desc,r.seq desc) from (
      select session_id "sessionId",seq,platform,screen,kind,target,value,created_at "createdAt",user_id is null anonymous
      from events order by created_at desc,session_id,seq desc limit 100) r),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_behavior(integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.get_admin_behavior(integer,text,text,boolean) to authenticated;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('gling-behavior-retention','29 8 * * *',
      $job$delete from private.behavior_events where created_at<now()-interval '90 days'$job$);
  end if;
end $$;

create function private.purge_deleted_behavior()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from private.behavior_events where user_id=new.id;
  delete from private.analytics_visits where user_id=new.id;
  return new;
end;
$$;
revoke all on function private.purge_deleted_behavior() from public,anon,authenticated;
create trigger purge_deleted_behavior after update of account_status on public.profiles
for each row when (new.account_status='deleted' and old.account_status is distinct from new.account_status)
execute function private.purge_deleted_behavior();
