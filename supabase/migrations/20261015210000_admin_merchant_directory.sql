-- Keep the two-argument RPC for existing tools; directory controls use this explicit overload.
create function public.get_admin_merchants(p_search text,p_offset integer,p_filters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; sorting text:=coalesce(p_filters->>'sort','name_asc');
  city text:=coalesce(p_filters->>'city_id',''); state text:=coalesce(p_filters->>'status','');
  permission text:=coalesce(p_filters->>'consent',''); kind text:=coalesce(p_filters->>'record_kind','');
  account text:=coalesce(p_filters->>'account','');
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_search is null or length(p_search)>120
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'INVALID_MERCHANT_FILTER'; end if;
  if exists(select 1 from jsonb_each(p_filters) f where jsonb_typeof(f.value)<>'string'
      or f.key not in ('sort','city_id','status','consent','record_kind','account'))
    or sorting not in ('name_asc','name_desc','created_desc','created_asc')
    or state not in ('','lead','trial','paid','paused') or permission not in ('','pending','granted','revoked')
    or kind not in ('','business','source') or account not in ('','connected','unconnected')
    or (city<>'' and not exists(select 1 from public.cities where id=city)) then raise exception 'INVALID_MERCHANT_FILTER'; end if;
  perform public.log_admin_access('analytics');
  with matches as materialized (
    select m.*,c.name city_name,c.timezone from private.merchants m join public.cities c on c.id=m.city_id
    where m.deleted_at is null and (p_search='' or position(lower(p_search) in lower(m.name||' '||m.contact))>0)
      and (city='' or m.city_id=city) and (state='' or m.status=state) and (permission='' or m.consent=permission)
      and (kind='' or m.record_kind=kind)
      and (account='' or account='connected' and m.owner_id is not null or account='unconnected' and m.owner_id is null)
  ), ranked as (
    select *,row_number() over(order by
      case when sorting='name_asc' then lower(name) end asc,
      case when sorting='name_desc' then lower(name) end desc,
      case when sorting='created_desc' then created_at end desc,
      case when sorting='created_asc' then created_at end asc,id) sort_position from matches
  ), page as (
    select * from ranked order by sort_position limit 50 offset p_offset
  ) select jsonb_build_object('merchants',coalesce((select jsonb_agg(to_jsonb(x)-'sort_position' order by x.sort_position) from (
      select page.*,
        (select count(*) from private.merchant_posts mp where mp.merchant_id=page.id) post_count,
        (select count(*) from private.merchant_reports r where r.merchant_id=page.id) report_count
      from page)x),'[]'::jsonb),
    'total',(select count(*) from matches),'more',(select count(*) from matches)>p_offset+50) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_merchants(text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_merchants(text,integer,jsonb) to authenticated;
