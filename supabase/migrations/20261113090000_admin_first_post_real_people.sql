-- Owner 2026-11-13: a real member's first post within 7 days of signup reaches every active admin at once
-- (no twice-daily digest), and the overview gets "real people" numbers that leave out operated characters,
-- the official editor and staff/review/test accounts. No new table, schedule or stored copy.

-- One definition of a real member for the alert and the numbers.
create function private.is_real_member(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user and p.account_status<>'deleted' and p.deleted_at is null
      and not coalesce(u.is_anonymous,false)
      and not private.is_operated_character(u.id)
      and coalesce(u.email,'') not like '%@official.gling.invalid'
      and coalesce(u.raw_app_meta_data->>'role','member') not in ('admin','review','reviewer','bot','seed','test','tester','system')
      and coalesce(u.raw_app_meta_data->'review_access','false'::jsonb)<>'true'::jsonb
      and coalesce(u.raw_app_meta_data->'analytics_internal','false'::jsonb)<>'true'::jsonb);
$$;
revoke all on function private.is_real_member(uuid) from public,anon,authenticated,service_role;

-- Preserve every existing notification kind, including kinds added by other migrations.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' then raise exception 'ADMIN_FIRST_POST_KIND_CHANGED'; end if;
  if strpos(definition,'''admin_first_post''')=0 then
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check '||
      replace(definition,'CHECK (','CHECK (kind = ''admin_first_post'' or ');
  end if;
end;
$$;

-- First post = the author's only non-meetup post, removed ones included (same rule as the app's first-post cheer).
-- Body carries nickname, city and days since signup only: the title and text never reach a lock screen.
create function private.notify_admin_first_post() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_nickname text; v_joined timestamptz; v_city text; v_days integer;
begin
  select p.nickname::text,p.created_at into v_nickname,v_joined from public.profiles p where p.id=new.author_id;
  if v_joined is null or new.created_at>=v_joined+interval '7 days' or not private.is_real_member(new.author_id) then return new; end if;
  -- Two posts at once from the same newcomer still alert once.
  perform pg_advisory_xact_lock(hashtextextended('admin-first-post:'||new.author_id::text,0));
  if exists(select 1 from public.posts o where o.author_id=new.author_id and o.id<>new.id and o.room_preview is null) then return new; end if;
  select c.name into v_city from public.cities c where c.id=new.city_id;
  v_days:=(new.created_at at time zone 'America/Vancouver')::date-(v_joined at time zone 'America/Vancouver')::date;
  perform private.notify_admins('admin_first_post','post',new.id,
    v_nickname||'님이 '||case when v_days<=0 then '가입한 날' when v_days=1 then '가입하고 하루 만에' else '가입하고 '||v_days||'일 만에' end
      ||' '||coalesce(v_city,'글링')||'에서 첫 글을 올렸어요.','/post/'||new.id::text);
  return new;
-- An alert failure must never block the member's post.
exception when others then
  raise warning 'ADMIN_FIRST_POST_ALERT_SKIPPED %', sqlstate;
  return new;
end;
$$;
revoke all on function private.notify_admin_first_post() from public,anon,authenticated,service_role;
create trigger posts_notify_admin_first_post after insert on public.posts
  for each row when (new.status='published' and new.deleted_at is null and new.room_preview is null)
  execute function private.notify_admin_first_post();

-- Numbers only (no names, emails or text), admin + second factor, logged like the other analytics reads.
-- Days are Vancouver days. Visits are kept 90 days, so "week 4" looks at signups from the last 12 weeks.
create function public.get_admin_real_people() returns jsonb
language plpgsql security definer set search_path='' as $$
declare started timestamptz; this_week timestamp:=date_trunc('week',now() at time zone 'America/Vancouver'); result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  select c.started_at into started from private.analytics_config c;
  with members as materialized (
    select p.id,p.created_at from public.profiles p where private.is_real_member(p.id)
  ), days as (
    select v.user_id,count(distinct (v.first_at at time zone 'America/Vancouver')::date) n
    from private.analytics_visits v join members m on m.id=v.user_id
    where v.first_at>=now()-interval '30 days' group by v.user_id
  ), week4 as (
    select exists(select 1 from private.analytics_visits v where v.user_id=m.id
      and v.first_at>=m.created_at+interval '21 days' and v.first_at<m.created_at+interval '28 days') back
    from members m where m.created_at<=now()-interval '28 days' and m.created_at>=greatest(started,now()-interval '84 days')
  ), posts as materialized (
    -- First reply: someone other than the author; operated characters do not count.
    select date_trunc('week',p.created_at at time zone 'America/Vancouver') week,p.created_at,
      (select min(c.created_at) from public.comments c where c.post_id=p.id and c.deleted_at is null
        and c.author_id<>p.author_id and not private.is_operated_character(c.author_id)) first_reply
    from public.posts p join members m on m.id=p.author_id
    where p.status='published' and p.deleted_at is null and p.room_preview is null
      and p.created_at>=(this_week-interval '7 weeks') at time zone 'America/Vancouver'
  )
  select jsonb_build_object(
    'generatedAt',now(),
    'members',(select count(*) from members),
    'visitDays',(select jsonb_build_object(
      'none',(select count(*) from members)-count(*),
      'one',count(*) filter(where n=1),'twoToThree',count(*) filter(where n between 2 and 3),
      'fourToSeven',count(*) filter(where n between 4 and 7),'eightToFourteen',count(*) filter(where n between 8 and 14),
      'fifteenPlus',count(*) filter(where n>=15)) from days),
    'weekFour',(select jsonb_build_object('eligible',count(*),'returned',count(*) filter(where back)) from week4),
    'signups',(select jsonb_build_object('total',count(*),'onTheirOwn',count(*) filter(where not exists(
      select 1 from private.invite_redemptions r where r.invitee_id=m.id))) from members m where m.created_at>=now()-interval '30 days'),
    'replyWeeks',(select jsonb_agg(to_jsonb(x) order by x.week desc) from (
      select w.week::date week,count(p.created_at) posts,count(p.first_reply) replied,
        round((percentile_cont(0.5) within group(order by extract(epoch from p.first_reply-p.created_at)/60)
          filter(where p.first_reply is not null))::numeric) "medianMinutes",
        count(*) filter(where p.created_at<=now()-interval '24 hours') due,
        count(*) filter(where p.created_at<=now()-interval '24 hours'
          and (p.first_reply is null or p.first_reply>=p.created_at+interval '24 hours')) unanswered
      from generate_series(this_week-interval '7 weeks',this_week,interval '1 week') w(week)
      left join posts p on p.week=w.week group by w.week) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_real_people() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_real_people() to authenticated;

notify pgrst,'reload schema';
