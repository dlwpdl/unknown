-- Owner-approved merchant admin and source clicks. Display counters remain explicitly distinct.
create table private.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 120),
  city_id text not null references public.cities(id),
  contact text not null default '' check(length(contact)<=1000),
  status text not null default 'lead' check(status in ('lead','trial','paid','paused')),
  consent text not null default 'pending' check(consent in ('pending','granted','revoked')),
  consent_note text not null default '' check(length(consent_note)<=3000),
  trial_ends_at date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(consent<>'granted' or length(btrim(consent_note))>0)
);
create unique index merchants_name_city_idx on private.merchants(city_id,lower(name));
create table private.merchant_posts (
  post_id uuid primary key references public.posts(id) on delete cascade,
  merchant_id uuid not null references private.merchants(id),
  original_url text not null,
  creation_request_id uuid unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index merchant_posts_merchant_idx on private.merchant_posts(merchant_id,created_at);
create table private.merchant_source_clicks (
  event_id uuid primary key, merchant_id uuid not null references private.merchants(id),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  session_id text not null check(session_id ~ '^[a-z0-9-]{20,80}$'),
  platform text not null check(platform in ('ios','android','web')),
  created_at timestamptz not null default now()
);
create index merchant_clicks_period_idx on private.merchant_source_clicks(merchant_id,created_at);
create index merchant_clicks_post_idx on private.merchant_source_clicks(post_id,created_at);
create index merchant_clicks_user_idx on private.merchant_source_clicks(user_id) where user_id is not null;
create index merchant_clicks_retention_idx on private.merchant_source_clicks(created_at);
create table private.merchant_reports (
  id uuid primary key, merchant_id uuid not null references private.merchants(id),
  merchant_name text not null, city_name text not null, timezone text not null,
  period_start date not null, period_end date not null,
  title text not null check(length(btrim(title)) between 1 and 160),
  summary text not null default '' check(length(summary)<=5000),
  next_step text not null default '' check(length(next_step)<=3000),
  proposal_period text not null check(proposal_period in ('two_weeks','month')),
  proposal_amount numeric(12,2) check(proposal_amount between 0 and 99999999),
  tax_note text not null default '' check(length(tax_note)<=300),
  metrics jsonb not null, posts jsonb not null,
  generated_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(period_end>=period_start and period_end-period_start<90)
);
create index merchant_reports_merchant_idx on private.merchant_reports(merchant_id,generated_at desc);
alter table private.merchants enable row level security;
alter table private.merchant_posts enable row level security;
alter table private.merchant_source_clicks enable row level security;
alter table private.merchant_reports enable row level security;
revoke all on private.merchants,private.merchant_posts,private.merchant_source_clicks,private.merchant_reports from public,anon,authenticated;

create function private.valid_merchant_original(p_url text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(length(p_url)<=2048 and p_url !~ '[[:space:]#]'
    and p_url ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{1,62}(/|\?|$)'
    and p_url !~* '^https://[^/?]+\.(local|internal|localhost)(/|\?|$)',false);
$$;
create function private.external_merchant_viewer(p_uid uuid,p_author uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_uid is distinct from p_author and exists(
    select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_uid
      and p.account_status<>'deleted' and not coalesce(u.email like '%@seed.gling.invalid',false)
      and not coalesce(u.raw_app_meta_data->>'role'='admin',false)
      and not coalesce(u.raw_app_meta_data->'review_access'='true'::jsonb,false));
$$;
revoke all on function private.valid_merchant_original(text),private.external_merchant_viewer(uuid,uuid) from public,anon,authenticated;

create function public.get_admin_merchants(p_search text default '',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_search is null or length(p_search)>120 then raise exception 'INVALID_MERCHANT_FILTER'; end if;
  perform public.log_admin_access('analytics');
  with matches as materialized (
    select m.*,c.name city_name,c.timezone,
      (select count(*) from private.merchant_posts mp where mp.merchant_id=m.id) post_count,
      (select count(*) from private.merchant_reports r where r.merchant_id=m.id) report_count
    from private.merchants m join public.cities c on c.id=m.city_id
    where p_search='' or position(lower(p_search) in lower(m.name||' '||m.contact))>0
  ) select jsonb_build_object('merchants',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id) from
    (select * from matches order by updated_at desc,id limit 50 offset p_offset)x),'[]'::jsonb),
    'more',(select count(*) from matches)>p_offset+50) into result;
  return result;
end;
$$;
create function public.save_admin_merchant(p_id uuid,p_name text,p_city_id text,p_contact text,
  p_status text,p_consent text,p_consent_note text,p_trial_ends_at date default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid:=coalesce(p_id,gen_random_uuid());
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if p_name is null or length(btrim(p_name)) not between 1 and 120
    or not exists(select 1 from public.cities where id=p_city_id)
    or p_contact is null or length(p_contact)>1000 or p_status is null or p_status not in ('lead','trial','paid','paused')
    or p_consent is null or p_consent not in ('pending','granted','revoked')
    or p_consent_note is null or length(p_consent_note)>3000 then raise exception 'INVALID_MERCHANT'; end if;
  if p_consent='granted' and length(btrim(p_consent_note))=0 then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if exists(select 1 from private.merchants m where m.id=mid and m.city_id<>p_city_id)
    and exists(select 1 from private.merchant_posts where merchant_id=mid) then raise exception 'MERCHANT_CITY_LOCKED'; end if;
  insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,trial_ends_at)
  values(mid,btrim(p_name),p_city_id,btrim(p_contact),p_status,p_consent,btrim(p_consent_note),p_trial_ends_at)
  on conflict(id) do update set name=excluded.name,city_id=excluded.city_id,contact=excluded.contact,
    status=excluded.status,consent=excluded.consent,consent_note=excluded.consent_note,
    trial_ends_at=excluded.trial_ends_at,updated_at=now();
  return mid;
end;
$$;
create function public.link_admin_merchant_post(p_merchant_id uuid,p_post_id uuid,p_original_url text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if not exists(select 1 from private.merchants where id=p_merchant_id and consent='granted') then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if not private.valid_merchant_original(p_original_url) then raise exception 'INVALID_ORIGINAL_URL'; end if;
  if not exists(select 1 from public.posts p join private.merchants m on m.id=p_merchant_id where p.id=p_post_id and p.city_id=m.city_id and p.status='published') then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
  insert into private.merchant_posts(merchant_id,post_id,original_url) values(p_merchant_id,p_post_id,p_original_url)
  on conflict(post_id) do update set original_url=excluded.original_url,updated_at=now()
    where private.merchant_posts.merchant_id=excluded.merchant_id;
  if not found then raise exception 'POST_ALREADY_LINKED'; end if;
  return p_post_id;
end;
$$;
create function public.create_admin_merchant_post(p_merchant_id uuid,p_title text,p_body text,
  p_tag_slug text,p_original_url text,p_kind text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare m private.merchants; tid smallint; pid uuid;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_request_id is null then raise exception 'INVALID_MERCHANT_POST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,117));
  select post_id into pid from private.merchant_posts where creation_request_id=p_request_id and merchant_id=p_merchant_id;
  if found then return pid; end if;
  select * into m from private.merchants where id=p_merchant_id;
  if not found or m.consent<>'granted' then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if not private.valid_merchant_original(p_original_url) then raise exception 'INVALID_ORIGINAL_URL'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 120 or p_body is null or length(btrim(p_body)) not between 1 and 4700
    or p_kind is null or p_kind not in ('story','listing') then raise exception 'INVALID_MERCHANT_POST'; end if;
  select id into tid from public.tags where slug=p_tag_slug and kind='post';
  if tid is null then raise exception 'INVALID_TAG'; end if;
  -- The normal publishing RPC keeps content validation, safety monitoring and author rules intact.
  pid:=public.create_post(p_city_id=>m.city_id,p_tag_id=>tid,p_title=>btrim(p_title),
    p_body=>m.name||E' 안내\n업체의 허락을 받아 글링에서 대신 게시한 안내입니다.\n\n'||btrim(p_body),p_kind=>p_kind);
  perform public.link_admin_merchant_post(p_merchant_id,pid,p_original_url);
  update private.merchant_posts set creation_request_id=p_request_id where post_id=pid;
  return pid;
end;
$$;

create function public.get_merchant_post_source(p_post_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('merchant_name',m.name,'original_url',mp.original_url)
  from private.merchant_posts mp join private.merchants m on m.id=mp.merchant_id join public.posts p on p.id=mp.post_id
  where p.id=p_post_id and p.status='published' and m.consent='granted' and m.status in ('trial','paid')
    and private.valid_merchant_original(mp.original_url)
    and (auth.uid() is null or not private.is_blocked_between(auth.uid(),p.author_id));
$$;
create function public.record_merchant_source_click(p_post_id uuid,p_platform text,p_session text,p_event_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); mid uuid; author uuid;
begin
  if p_event_id is null or p_platform is null or p_platform not in ('ios','android','web')
    or p_session is null or p_session !~ '^[a-z0-9-]{20,80}$' then raise exception 'INVALID_MERCHANT_CLICK'; end if;
  if public.get_merchant_post_source(p_post_id) is null then raise exception 'MERCHANT_SOURCE_UNAVAILABLE'; end if;
  select mp.merchant_id,p.author_id into mid,author from private.merchant_posts mp join public.posts p on p.id=mp.post_id where mp.post_id=p_post_id;
  if uid is not null then
    perform private.assert_active_account(uid);
    if not private.external_merchant_viewer(uid,author) then return; end if;
    perform private.enforce_rate_limit('merchant-source-click',60,interval '1 minute');
  else
    -- Same anonymous budget approach as existing behavior events; no IP/device identifier retained.
    perform pg_advisory_xact_lock(117001);
    if (select count(*) from private.merchant_source_clicks where user_id is null and created_at>now()-interval '1 minute')>=6000 then raise exception 'RATE_LIMITED'; end if;
  end if;
  insert into private.merchant_source_clicks(event_id,merchant_id,post_id,user_id,session_id,platform)
  values(p_event_id,mid,p_post_id,uid,p_session,p_platform) on conflict(event_id) do nothing;
end;
$$;

create function private.merchant_period_data(p_merchant_id uuid,p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare zone text; local_today date; since timestamptz; until_at timestamptz; result jsonb;
begin
  select c.timezone into zone from private.merchants m join public.cities c on c.id=m.city_id where m.id=p_merchant_id;
  if zone is null then raise exception 'MERCHANT_NOT_FOUND'; end if;
  local_today:=(now() at time zone zone)::date;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>=90 or p_start<local_today-89 or p_end>local_today then raise exception 'INVALID_MERCHANT_PERIOD'; end if;
  since:=p_start::timestamp at time zone zone; until_at:=(p_end+1)::timestamp at time zone zone;
  with linked as materialized (
    select mp.post_id,mp.original_url,mp.created_at linked_at,p.title,p.status,p.created_at,p.author_id,p.view_count
    from private.merchant_posts mp join public.posts p on p.id=mp.post_id where mp.merchant_id=p_merchant_id and mp.created_at<until_at
  ), reads as materialized (
    select v.* from public.post_views v join linked p on p.post_id=v.post_id
    where v.created_at>=greatest(since,p.linked_at) and v.created_at<until_at and private.external_merchant_viewer(v.user_id,p.author_id)
  ), clicks as materialized (
    select c.* from private.merchant_source_clicks c join linked p on p.post_id=c.post_id
    where c.merchant_id=p_merchant_id and c.created_at>=since and c.created_at<until_at
      and (c.user_id is null or private.external_merchant_viewer(c.user_id,p.author_id))
  ) select jsonb_build_object('metrics',jsonb_build_object(
      'linked_posts',(select count(*) from linked),'new_posts',(select count(*) from linked where created_at>=since and created_at<until_at),
      'displayed_views',(select coalesce(sum(view_count),0) from linked),
      'first_reads',(select count(*) from reads),'unique_readers',(select count(distinct user_id) from reads),
      'source_clicks',(select count(*) from clicks),'member_clickers',(select count(distinct user_id) from clicks),
      'anonymous_sessions',(select count(distinct session_id) from clicks where user_id is null)),
    'posts',coalesce((select jsonb_agg(jsonb_build_object('post_id',p.post_id,'title',p.title,'original_url',p.original_url,
      'displayed_views',p.view_count,'source_clicks',(select count(*) from clicks c where c.post_id=p.post_id),
      'status',p.status,'created_at',p.created_at) order by p.created_at desc,p.post_id) from linked p),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function private.merchant_period_data(uuid,date,date) from public,anon,authenticated;
create function public.get_admin_merchant(p_merchant_id uuid,p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb; m jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  d:=private.merchant_period_data(p_merchant_id,p_start,p_end);
  select to_jsonb(x) into m from (
    select m.*,c.name city_name,c.timezone,
      (select count(*) from private.merchant_posts where merchant_id=m.id)post_count,
      (select count(*) from private.merchant_reports where merchant_id=m.id)report_count
    from private.merchants m join public.cities c on c.id=m.city_id where m.id=p_merchant_id)x;
  return d||jsonb_build_object('merchant',m,'available_posts',coalesce((select jsonb_agg(to_jsonb(p)) from (
    select p.id,p.title from public.posts p where p.city_id=m->>'city_id' and p.status='published'
      and not exists(select 1 from private.merchant_posts mp where mp.post_id=p.id and mp.merchant_id<>p_merchant_id)
    order by p.created_at desc,p.id limit 50)p),'[]'::jsonb),'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.generated_at desc,r.id)
    from(select * from private.merchant_reports where merchant_id=p_merchant_id order by generated_at desc,id limit 30)r),'[]'::jsonb));
end;
$$;
create function public.save_admin_merchant_report(p_id uuid,p_merchant_id uuid,p_period_start date,p_period_end date,
  p_title text,p_summary text,p_next_step text,p_proposal_period text,p_proposal_amount numeric,p_tax_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.merchants; c public.cities; d jsonb; r private.merchant_reports;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if p_id is null or p_period_start is null or p_period_end is null or p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_summary is null or length(p_summary)>5000 or p_next_step is null or length(p_next_step)>3000
    or p_proposal_period is null or p_proposal_period not in ('two_weeks','month')
    or (p_proposal_amount is not null and p_proposal_amount not between 0 and 99999999)
    or p_tax_note is null or length(p_tax_note)>300 then raise exception 'INVALID_MERCHANT_REPORT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,117));
  select * into m from private.merchants where id=p_merchant_id;
  if not found then raise exception 'MERCHANT_NOT_FOUND'; end if;
  select * into c from public.cities where id=m.city_id;
  select * into r from private.merchant_reports where id=p_id for update;
  if found then
    if r.merchant_id<>p_merchant_id or r.period_start<>p_period_start or r.period_end<>p_period_end then raise exception 'REPORT_PERIOD_LOCKED'; end if;
    update private.merchant_reports set title=btrim(p_title),summary=p_summary,next_step=p_next_step,
      proposal_period=p_proposal_period,proposal_amount=p_proposal_amount,tax_note=p_tax_note,updated_at=now() where id=p_id returning * into r;
  else
    d:=private.merchant_period_data(p_merchant_id,p_period_start,p_period_end);
    insert into private.merchant_reports(id,merchant_id,merchant_name,city_name,timezone,period_start,period_end,
      title,summary,next_step,proposal_period,proposal_amount,tax_note,metrics,posts)
    values(p_id,m.id,m.name,c.name,c.timezone,p_period_start,p_period_end,btrim(p_title),p_summary,p_next_step,
      p_proposal_period,p_proposal_amount,p_tax_note,d->'metrics',d->'posts') returning * into r;
  end if;
  return to_jsonb(r);
end;
$$;
create function public.get_admin_merchant_report(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  select to_jsonb(report) into r from private.merchant_reports report where id=p_id;
  if r is null then raise exception 'MERCHANT_REPORT_NOT_FOUND'; end if;
  return r;
end;
$$;
revoke all on function public.get_admin_merchants(text,integer),public.save_admin_merchant(uuid,text,text,text,text,text,text,date),
  public.link_admin_merchant_post(uuid,uuid,text),public.create_admin_merchant_post(uuid,text,text,text,text,text,uuid),
  public.get_admin_merchant(uuid,date,date),public.get_admin_merchant_report(uuid),public.save_admin_merchant_report(uuid,uuid,date,date,text,text,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.get_admin_merchants(text,integer),public.save_admin_merchant(uuid,text,text,text,text,text,text,date),
  public.link_admin_merchant_post(uuid,uuid,text),public.create_admin_merchant_post(uuid,text,text,text,text,text,uuid),
  public.get_admin_merchant(uuid,date,date),public.get_admin_merchant_report(uuid),public.save_admin_merchant_report(uuid,uuid,date,date,text,text,text,text,numeric,text) to authenticated;
revoke all on function public.get_merchant_post_source(uuid),public.record_merchant_source_click(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.get_merchant_post_source(uuid),public.record_merchant_source_click(uuid,text,text,uuid) to anon,authenticated;

create function private.erase_deleted_merchant_clicks() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.account_status='deleted' then delete from private.merchant_source_clicks where user_id=new.id; end if;
  return new;
end;
$$;
revoke all on function private.erase_deleted_merchant_clicks() from public,anon,authenticated;
create trigger merchant_clicks_account_erasure after update of account_status on public.profiles
  for each row execute function private.erase_deleted_merchant_clicks();
-- Reuse the existing daily retention job, preserving its owner, schedule and original command.
do $$ declare j record; begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    for j in select jobid,command from cron.job where jobname='gling-behavior-retention' loop
      if position('private.merchant_source_clicks' in j.command)=0 then
        perform cron.alter_job(j.jobid,command:=j.command||E';\ndelete from private.merchant_source_clicks where created_at<now()-interval ''90 days''');
      end if;
    end loop;
  end if;
end $$;
notify pgrst,'reload schema';
