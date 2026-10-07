-- Filter before counting and paging; keep the existing two-argument RPC compatible.
create function public.search_admin_users(p_query text,p_offset integer,p_account_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_query is null or length(p_query)>200 or p_offset is null or p_offset<0
    or p_account_type is null or p_account_type not in ('all','example','member') then
    raise exception 'INVALID_ADMIN_FILTER';
  end if;
  perform public.log_admin_access('users');
  with matched as (
    select * from private.admin_user_directory d
    where (p_account_type='all' or d.account_type=p_account_type)
      and strpos(lower(concat_ws(' ',d.id::text,d.nickname::text,d.email,d.login_name,d.full_name)),lower(trim(p_query)))>0
  ) select jsonb_build_object('total',(select count(*) from matched),
    'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from matched order by created_at desc,id desc limit 50 offset p_offset) x),
    'viewer',(select jsonb_build_object('id',u.id,'email',u.email,'role',u.raw_app_meta_data->>'role') from auth.users u where u.id=auth.uid())) into result;
  return result;
end;
$$;
revoke all on function public.search_admin_users(text,integer,text) from public,anon,authenticated;
grant execute on function public.search_admin_users(text,integer,text) to authenticated;

create or replace function public.search_admin_users(p_query text default '',p_offset integer default 0)
returns jsonb language sql security definer set search_path='' as $$
  select public.search_admin_users(p_query,p_offset,'all');
$$;
