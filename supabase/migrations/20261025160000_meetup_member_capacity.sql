-- Personal membership controls seats, independently of hosted-meetup slot quotas.
create function private.meetup_capacity_limit(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case when private.is_active_account(p_user_id)
    and private.membership_details(p_user_id)->>'tier' in ('plus','pro','premium')
    then 5000 else 50 end;
$$;

-- Keep the existing schedule, actual-member floor and host/authentication checks.
do $$
declare definition text; anchor text:='capacity not between 2 and 50';
begin
  definition:=pg_get_functiondef('private.validate_chilling_event(uuid,jsonb)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'chilling capacity validation anchor missing'; end if;
  execute replace(definition,anchor,'capacity not between 2 and 5000');
end;
$$;

create function private.guard_meetup_capacity_setting() returns trigger
language plpgsql security definer set search_path='' as $$
declare capacity numeric; old_capacity numeric;
begin
  if new.room_preview is null or not (new.room_preview ? 'capacity') then return new; end if;
  if jsonb_typeof(new.room_preview->'capacity') is distinct from 'number' then raise exception 'INVALID_EVENT_CAPACITY'; end if;
  capacity:=(new.room_preview->>'capacity')::numeric;
  if capacity not between 2 and 5000 or capacity<>trunc(capacity) then raise exception 'INVALID_EVENT_CAPACITY'; end if;
  if tg_op='UPDATE' and new.author_id=old.author_id and jsonb_typeof(old.room_preview->'capacity')='number' then
    old_capacity:=(old.room_preview->>'capacity')::numeric;
    -- Expiry never evicts members or prevents ordinary edits/closing/leaving.
    -- A larger recorded capacity can stay or decrease; new seats are checked separately.
    if capacity=old_capacity then return new; end if;
  end if;
  if capacity<1+(select count(*) from public.meetup_requests where post_id=new.id and status='approved') then
    raise exception 'EVENT_CAPACITY_BELOW_MEMBERS';
  end if;
  if capacity<old_capacity then return new; end if;
  if capacity>private.meetup_capacity_limit(new.author_id) then raise exception 'INVALID_EVENT_CAPACITY'; end if;
  return new;
end;
$$;
create trigger posts_meetup_capacity_setting before insert or update of room_preview,author_id on public.posts
for each row execute function private.guard_meetup_capacity_setting();

-- Every request/approval/instant-join path writes this table. Pending requests reserve no seat.
create function private.guard_meetup_capacity_admission() returns trigger
language plpgsql security definer set search_path='' as $$
declare event public.posts; host_limit integer; recorded_capacity integer; occupied bigint;
begin
  if new.status not in ('pending','approved') then return new; end if;
  if tg_op='UPDATE' and old.post_id=new.post_id and (old.status='approved' or old.status=new.status) then return new; end if;
  -- Preserve the established advisory-lock -> post-row-lock order and count actual approvals.
  perform private.lock_relationships();
  select * into event from public.posts where id=new.post_id for update;
  if event.id is null then return new; end if; -- The existing FK/auth guards reject a missing event.
  host_limit:=private.meetup_capacity_limit(event.author_id);
  recorded_capacity:=coalesce((event.room_preview->>'capacity')::integer,8);
  select 1+count(*) into occupied from public.meetup_requests
    where post_id=new.post_id and status='approved' and id is distinct from new.id;
  if occupied>=least(recorded_capacity,host_limit) then
    if host_limit<recorded_capacity then raise exception 'MEETUP_HOST_CAPACITY_LIMIT'; end if;
    raise exception 'MEETUP_FULL';
  end if;
  return new;
end;
$$;
create trigger meetup_requests_z_capacity_admission before insert or update of status,post_id on public.meetup_requests
for each row execute function private.guard_meetup_capacity_admission();

-- Published clients eagerly download every legacy roster photo. Keep their bound50.
-- New clients load metadata5000 separately and fetch only visible private photos.
do $$
declare definition text; function_owner text; anchor text:='order by is_host desc,id limit 50';
  signature text:='FUNCTION public.get_chilling_roster(p_post_id uuid)';
begin
  select pg_get_functiondef(oid),pg_get_userbyid(proowner) into definition,function_owner
    from pg_proc where oid='public.get_chilling_roster(uuid)'::regprocedure;
  if strpos(definition,anchor)=0 or strpos(definition,signature)=0 then raise exception 'chilling roster capacity anchor missing'; end if;
  execute replace(replace(definition,signature,'FUNCTION public.get_chilling_roster_v2(p_post_id uuid)'),anchor,'order by is_host desc,id limit 5000');
  execute format('alter function public.get_chilling_roster_v2(uuid) owner to %I',function_owner);
end;
$$;
revoke all on function public.get_chilling_roster_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_chilling_roster_v2(uuid) to authenticated;

revoke all on function private.meetup_capacity_limit(uuid),private.guard_meetup_capacity_setting(),
  private.guard_meetup_capacity_admission() from public,anon,authenticated,service_role;
