create table private.ai_draft_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_count smallint not null check (request_count between 1 and 5),
  primary key (user_id, usage_date)
);

revoke all on private.ai_draft_usage from public, anon, authenticated;

create function public.reserve_ai_draft()
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  profile_timezone text;
  usage_day date;
  next_count smallint;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select city.timezone into profile_timezone
  from public.profiles as profile
  join public.cities as city on city.id = profile.city_id
  where profile.id = current_user_id;

  usage_day := (now() at time zone coalesce(profile_timezone, 'UTC'))::date;

  insert into private.ai_draft_usage (user_id, usage_date, request_count)
  values (current_user_id, usage_day, 1)
  on conflict (user_id, usage_date) do update
    set request_count = private.ai_draft_usage.request_count + 1
    where private.ai_draft_usage.request_count < 5
  returning request_count into next_count;

  if next_count is null then
    raise exception 'AI_DRAFT_LIMIT_REACHED';
  end if;

  return next_count;
end;
$$;

revoke all on function public.reserve_ai_draft() from public;
grant execute on function public.reserve_ai_draft() to authenticated;
