-- Gender joins the existing optional personal-info block: same consent receipt,
-- same deletion path, never public. Old 4-argument clients keep working through
-- the unchanged signature, so already-released builds do not break.
alter table private.personal_info add column gender text;
alter table private.personal_info add constraint personal_info_gender_check check (gender is null or gender in ('male','female','other'));

create function public.save_my_personal_info(p_full_name text,p_date_of_birth date,p_version text,p_user_id uuid,p_gender text)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); status text; clean_name text:=regexp_replace(p_full_name,'^\s+|\s+$','','g');
  today date:=(now() at time zone 'utc')::date;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from u then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  if p_version is null or p_version not in ('2026-09-12','2026-09-19','2026-09-22') then raise exception 'PERSONAL_INFO_CONSENT_REQUIRED'; end if;
  -- Serialize saves/withdrawals with the profile's account-deletion transition.
  select account_status into status from public.profiles where id=u for update;
  if status is null then raise exception 'PROFILE_REQUIRED'; end if;
  if p_full_name is null and p_date_of_birth is null then
    delete from private.personal_info where user_id=u;
    return;
  end if;
  if status<>'active' then raise exception 'ACCOUNT_LOCKED'; end if;
  if clean_name is null or length(clean_name) not between 1 and 200 or clean_name ~ '[[:cntrl:]]'
    or p_date_of_birth is null or not(p_date_of_birth between (today-interval '120 years')::date and today)
    or (p_gender is not null and p_gender not in ('male','female','other'))
    then raise exception 'INVALID_PERSONAL_INFO'; end if;
  insert into private.personal_info(user_id,full_name,date_of_birth,gender,consent_version)
    values(u,clean_name,p_date_of_birth,p_gender,p_version)
    on conflict(user_id) do update set full_name=excluded.full_name,date_of_birth=excluded.date_of_birth,
      gender=excluded.gender,consent_version=excluded.consent_version,
      consented_at=clock_timestamp(),updated_at=clock_timestamp();
end;
$$;
revoke all on function public.save_my_personal_info(text,date,text,uuid,text) from public,anon,authenticated;
grant execute on function public.save_my_personal_info(text,date,text,uuid,text) to authenticated;

-- Released builds call this four-argument form; it keeps the previous behaviour with no gender.
create or replace function public.save_my_personal_info(p_full_name text,p_date_of_birth date,p_version text,p_user_id uuid)
returns void language sql security definer set search_path='' as $$
  select public.save_my_personal_info(p_full_name,p_date_of_birth,p_version,p_user_id,null);
$$;
revoke all on function public.save_my_personal_info(text,date,text,uuid) from public,anon,authenticated;
grant execute on function public.save_my_personal_info(text,date,text,uuid) to authenticated;

create function public.create_profile_with_personal_info(p_nickname text,p_city_id text,p_avatar_path text,p_version text,
  p_full_name text,p_date_of_birth date,p_personal_info_version text,p_user_id uuid,p_gender text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'AUTH_CONTEXT_CHANGED'; end if;
  perform public.create_profile_with_consent(p_nickname,p_city_id,p_avatar_path,p_version);
  if p_full_name is not null or p_date_of_birth is not null or p_personal_info_version is not null then
    perform public.save_my_personal_info(p_full_name,p_date_of_birth,p_personal_info_version,p_user_id,p_gender);
  end if;
end;
$$;
revoke all on function public.create_profile_with_personal_info(text,text,text,text,text,date,text,uuid,text) from public,anon,authenticated;
grant execute on function public.create_profile_with_personal_info(text,text,text,text,text,date,text,uuid,text) to authenticated;

create or replace function public.get_my_personal_info()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select jsonb_build_object('full_name',i.full_name,'date_of_birth',i.date_of_birth,'gender',i.gender,
    'age',extract(year from age((now() at time zone 'utc')::date,i.date_of_birth))::int,
    'consent_version',i.consent_version,'consented_at',i.consented_at,'updated_at',i.updated_at)
  into result from private.personal_info i where i.user_id=auth.uid();
  return coalesce(result,jsonb_build_object('full_name',null,'date_of_birth',null,'gender',null,'age',null,'consent_version',null,'consented_at',null,'updated_at',null));
end;
$$;

create or replace view private.admin_user_directory as
select p.*, u.email, u.email_confirmed_at, u.last_sign_in_at,
  coalesce(u.raw_app_meta_data->>'role','member') as auth_role,
  case when u.email like '%@seed.gling.invalid' then 'example'
    when u.raw_app_meta_data->>'role'='admin' then 'admin'
    when u.raw_app_meta_data->'review_access'='true'::jsonb then 'review' else 'member' end as account_type,
  left(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name','')),200) as login_name,
  coalesce((select array_agg(distinct i.provider order by i.provider) from auth.identities i where i.user_id=p.id),'{}'::text[]) as providers,
  host(s.ip) as session_ip,s.created_at as session_created_at,s.updated_at as session_updated_at,
  info.full_name,info.date_of_birth,extract(year from age((now() at time zone 'utc')::date,info.date_of_birth))::int as age,
  info.updated_at as personal_info_updated_at,info.gender
from public.profiles p join auth.users u on u.id=p.id
left join lateral (select x.ip,x.created_at,x.updated_at from auth.sessions x where x.user_id=p.id
  order by coalesce(x.updated_at,x.created_at) desc,x.id desc limit 1) s on true
left join private.personal_info info on info.user_id=p.id;

create or replace function public.search_admin_users(p_query text,p_offset integer,p_filters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result jsonb; facet text;
  account_types text[]; cities text[]; statuses text[]; selected_providers text[]; ages text[]; genders text[];
  joined_days text; sort_order text;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_query is null or length(p_query)>200 or p_offset is null or p_offset<0
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'INVALID_ADMIN_FILTER'; end if;
  foreach facet in array array['account_types','cities','statuses','providers','ages','genders'] loop
    if p_filters ? facet then
      if jsonb_typeof(p_filters->facet)<>'array' then raise exception 'INVALID_ADMIN_FILTER'; end if;
      if jsonb_array_length(p_filters->facet)>50 or exists (
        select 1 from jsonb_array_elements(p_filters->facet) x where jsonb_typeof(x)<>'string' or length(x::text)>102
      ) then raise exception 'INVALID_ADMIN_FILTER'; end if;
    end if;
  end loop;
  account_types := array(select jsonb_array_elements_text(coalesce(p_filters->'account_types','[]')));
  cities := array(select jsonb_array_elements_text(coalesce(p_filters->'cities','[]')));
  statuses := array(select jsonb_array_elements_text(coalesce(p_filters->'statuses','[]')));
  selected_providers := array(select jsonb_array_elements_text(coalesce(p_filters->'providers','[]')));
  ages := array(select jsonb_array_elements_text(coalesce(p_filters->'ages','[]')));
  genders := array(select jsonb_array_elements_text(coalesce(p_filters->'genders','[]')));
  joined_days := coalesce(p_filters->>'joined_days','all');
  sort_order := coalesce(p_filters->>'sort','newest');
  if not account_types <@ array['example','member','admin','review']
    or not statuses <@ array['active','suspended','deleted','reactivation_pending']
    or not selected_providers <@ array['google','apple','kakao','email']
    or not ages <@ array['under18','18-24','25-29','30-39','40-49','50plus','unknown']
    or not genders <@ array['male','female','other','unknown']
    or joined_days not in ('all','7','30','90')
    or sort_order not in ('newest','oldest','nickname','last_seen') then raise exception 'INVALID_ADMIN_FILTER'; end if;
  perform public.log_admin_access('users');
  with matched as (
    select * from private.admin_user_directory d
    where (cardinality(account_types)=0 or d.account_type=any(account_types))
      and (cardinality(cities)=0 or d.city_id=any(cities))
      and (cardinality(statuses)=0 or d.account_status=any(statuses))
      and (cardinality(selected_providers)=0 or d.providers && selected_providers)
      and (cardinality(ages)=0 or (case
        when d.age is null then 'unknown'
        when d.age<18 then 'under18'
        when d.age<25 then '18-24'
        when d.age<30 then '25-29'
        when d.age<40 then '30-39'
        when d.age<50 then '40-49'
        else '50plus' end)=any(ages))
      and (cardinality(genders)=0 or coalesce(d.gender,'unknown')=any(genders))
      and (joined_days='all' or d.created_at >= now()-make_interval(days=>nullif(joined_days,'all')::integer))
      and strpos(lower(concat_ws(' ',d.id::text,d.nickname::text,d.email,d.login_name,d.full_name)),lower(trim(p_query)))>0
  ) select jsonb_build_object('total',(select count(*) from matched),
    'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
      select * from matched order by
        case when sort_order='oldest' then created_at end asc,
        case when sort_order='nickname' then nickname end asc,
        case when sort_order='last_seen' then last_sign_in_at end desc nulls last,
        case when sort_order<>'oldest' then created_at end desc, id desc
      limit 50 offset p_offset
    ) x),
    'viewer',(select jsonb_build_object('id',u.id,'email',u.email,'role',u.raw_app_meta_data->>'role') from auth.users u where u.id=auth.uid())) into result;
  return result;
end;
$$;
revoke all on function public.search_admin_users(text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.search_admin_users(text,integer,jsonb) to authenticated;

notify pgrst,'reload schema';
