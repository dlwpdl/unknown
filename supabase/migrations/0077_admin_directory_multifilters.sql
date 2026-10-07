-- User-directory facets share one server-side result set for counts, sorting and pages.
create or replace function public.search_admin_users(p_query text,p_offset integer,p_filters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result jsonb; facet text;
  account_types text[]; cities text[]; statuses text[]; selected_providers text[];
  joined_days text; sort_order text;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_query is null or length(p_query)>200 or p_offset is null or p_offset<0
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'INVALID_ADMIN_FILTER'; end if;
  foreach facet in array array['account_types','cities','statuses','providers'] loop
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
  joined_days := coalesce(p_filters->>'joined_days','all');
  sort_order := coalesce(p_filters->>'sort','newest');
  if not account_types <@ array['example','member','admin','review']
    or not statuses <@ array['active','suspended','deleted','reactivation_pending']
    or not selected_providers <@ array['google','apple','kakao','email']
    or joined_days not in ('all','7','30','90')
    or sort_order not in ('newest','oldest','nickname','last_seen') then raise exception 'INVALID_ADMIN_FILTER'; end if;
  perform public.log_admin_access('users');
  with matched as (
    select * from private.admin_user_directory d
    where (cardinality(account_types)=0 or d.account_type=any(account_types))
      and (cardinality(cities)=0 or d.city_id=any(cities))
      and (cardinality(statuses)=0 or d.account_status=any(statuses))
      and (cardinality(selected_providers)=0 or d.providers && selected_providers)
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
