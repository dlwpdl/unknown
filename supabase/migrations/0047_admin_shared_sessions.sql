-- Owner request (2026-09-15): surface accounts that share an IP or an IP+device within the
-- retention window so multi-account comment brigading or business promotion can be reviewed.
-- Reads only the session IP/user agent GoTrue already stores (same source as 0036); no new tracking.
-- A shared IP is a signal (households, offices, carrier NAT), not proof — the UI says so.
create function public.get_admin_shared_sessions(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)));
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('users'); -- existing audited scope; this is a user-directory query
  with sessions as (
    select s.user_id, host(s.ip) as ip, left(coalesce(s.user_agent,''), 120) as user_agent,
      coalesce(s.refreshed_at, s.updated_at, s.created_at) as seen_at
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.ip is not null and coalesce(s.refreshed_at, s.updated_at, s.created_at) >= since
      and u.email not like '%@seed.gling.invalid'
  ), per_user as (
    select ip, user_agent, user_id, max(seen_at) as last_seen, min(seen_at) as first_seen
    from sessions group by ip, user_agent, user_id
  ), groups as (
    select ip, user_agent, count(*) as user_count, min(first_seen) as first_seen, max(last_seen) as last_seen
    from per_user group by ip, user_agent having count(*) >= 2
    union all
    select ip, null as user_agent, count(distinct user_id), min(first_seen), max(last_seen)
    from per_user pu group by ip having count(distinct user_id) >= 2
      -- only when the IP joins more accounts than any single device on it already shows
      and count(distinct user_id) > (select max(c) from (select count(*) c from per_user x where x.ip = pu.ip group by x.user_agent) t)
  )
  select jsonb_build_object('days', extract(day from now() - since)::int, 'groups', coalesce((select jsonb_agg(g order by g.same_device desc, g.last_seen desc) from (
    select gr.ip, gr.user_agent, gr.user_agent is not null as same_device, gr.user_count, gr.first_seen, gr.last_seen,
      (select jsonb_agg(jsonb_build_object(
          'id', d.id, 'nickname', d.nickname, 'account_type', d.account_type, 'last_seen', pu.last_seen,
          'comments', (select count(*) from public.comments c where c.author_id = d.id and c.created_at >= since),
          'posts', (select count(*) from public.posts p where p.author_id = d.id and p.created_at >= since)
        ) order by pu.last_seen desc)
       from (select distinct user_id, max(last_seen) last_seen from per_user
             where per_user.ip = gr.ip and (gr.user_agent is null or per_user.user_agent = gr.user_agent) group by user_id) pu
       join private.admin_user_directory d on d.id = pu.user_id) as users
    from groups gr) g), '[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.get_admin_shared_sessions(integer) from public, anon, authenticated;
grant execute on function public.get_admin_shared_sessions(integer) to authenticated;
