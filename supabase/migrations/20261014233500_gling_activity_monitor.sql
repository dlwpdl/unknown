-- Metadata only; existing whole-source safety/MFA/audit paths are unchanged.
create table private.gling_activity_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('post','comment','message','conversation','meetup_request','monitor_probe')),
  target_id uuid not null,
  actor_id uuid,
  context_id uuid,
  action text not null check (action in ('insert','update','probe')),
  occurred_at timestamptz not null default clock_timestamp(),
  operated_actor boolean not null,
  attention boolean not null,
  delivered_at timestamptz,
  batch_id uuid,
  lease_until timestamptz,
  check (not operated_actor or not attention)
);
create index gling_activity_pending on private.gling_activity_events(id) where delivered_at is null;
create index gling_activity_batch on private.gling_activity_events(batch_id) where delivered_at is null;
create index gling_activity_retention on private.gling_activity_events(delivered_at,id) where delivered_at is not null;
-- Tombstones prevent a retried/late ACK UUID from ever owning a different delivery.
create table private.gling_activity_batches (
  batch_id uuid primary key,
  lease_until timestamptz not null,
  acknowledged_at timestamptz
);
create index gling_activity_live_batches on private.gling_activity_batches(lease_until) where acknowledged_at is null;
alter table private.gling_activity_events enable row level security;
alter table private.gling_activity_batches enable row level security;
revoke all on private.gling_activity_events, private.gling_activity_batches from public,anon,authenticated,service_role;
revoke all on sequence private.gling_activity_events_id_seq from public,anon,authenticated,service_role;

create function private.capture_gling_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := to_jsonb(new);
  ignored text[] := array['updated_at','like_count','save_count','comment_count','view_count','share_count','bump_count',
    'unread_epoch','last_read_at','last_read_message_id','unread_count'];
  actor uuid;
  context uuid;
  operated boolean;
  event_kind text;
begin
  if tg_op='UPDATE' and (row_data-ignored) is not distinct from (to_jsonb(old)-ignored) then
    return new;
  end if;
  event_kind := case tg_table_name when 'posts' then 'post' when 'comments' then 'comment'
    when 'messages' then 'message' when 'conversations' then 'conversation' else 'meetup_request' end;
  actor := coalesce(auth.uid(), (case tg_table_name when 'posts' then row_data->>'author_id'
    when 'comments' then row_data->>'author_id' when 'messages' then row_data->>'sender_id'
    else row_data->>'requester_id' end)::uuid);
  context := (case tg_table_name when 'messages' then row_data->>'conversation_id'
    when 'conversations' then coalesce(row_data->>'context_post_id',row_data->>'group_post_id',row_data->>'origin_post_id')
    when 'posts' then null else row_data->>'post_id' end)::uuid;
  select coalesce(u.email like '%@seed.gling.invalid'
    or u.raw_app_meta_data->'gling_persona'->>'kind'='gling_operated_character'
    or u.raw_app_meta_data->>'role' in ('admin','review','reviewer','test','tester')
    or u.raw_app_meta_data->'review_access'='true'::jsonb, false)
    into operated from auth.users u where u.id=actor;
  operated := coalesce(operated,false);
  insert into private.gling_activity_events(kind,target_id,actor_id,context_id,action,operated_actor,attention)
    values(event_kind,new.id,actor,context,lower(tg_op),operated,not operated);
  return new;
end;
$$;
create trigger posts_activity_monitor after insert or update on public.posts
  for each row execute function private.capture_gling_activity();
create trigger comments_activity_monitor after insert or update on public.comments
  for each row execute function private.capture_gling_activity();
create trigger messages_activity_monitor after insert or update on public.messages
  for each row execute function private.capture_gling_activity();
create trigger conversations_activity_monitor after insert or update on public.conversations
  for each row execute function private.capture_gling_activity();
create trigger meetup_requests_activity_monitor after insert or update on public.meetup_requests
  for each row execute function private.capture_gling_activity();

create function private.claim_gling_activity(p_batch uuid,p_limit integer default 100,p_lease_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  at_time timestamptz := clock_timestamp();
  expires timestamptz;
  events jsonb;
  pending bigint;
begin
  if p_batch is null or p_limit is null or p_limit not between 1 and 200
    or p_lease_seconds is null or p_lease_seconds not between 60 and 900 then
    raise exception 'INVALID_ACTIVITY_CLAIM' using errcode='22023';
  end if;
  if not pg_try_advisory_xact_lock(7142026,1014) then
    return jsonb_build_object('batch_id',p_batch,'events','[]'::jsonb,'busy',true,
      'pending_count',(select count(*) from private.gling_activity_events where delivered_at is null));
  end if;
  -- Bound maintenance; pending or recently delivered rows are never pruned.
  delete from private.gling_activity_events where id in (
    select id from private.gling_activity_events where delivered_at < at_time-interval '30 days'
    order by delivered_at,id limit 1000);
  select count(*) into pending from private.gling_activity_events where delivered_at is null;
  if exists(select 1 from private.gling_activity_batches where acknowledged_at is null and lease_until>at_time and batch_id<>p_batch) then
    return jsonb_build_object('batch_id',p_batch,'events','[]'::jsonb,'busy',true,'pending_count',pending);
  end if;
  if exists(select 1 from private.gling_activity_batches where batch_id=p_batch) then
    select lease_until into expires from private.gling_activity_batches where batch_id=p_batch and acknowledged_at is null;
  else
    expires := at_time+make_interval(secs=>p_lease_seconds);
    -- Operated events stay observed, but do not require an AI turn or an ACK.
    update private.gling_activity_events set delivered_at=at_time where id in (
      select id from private.gling_activity_events where delivered_at is null and not attention
      and (lease_until is null or lease_until<=at_time) order by id limit 1000);
    select count(*) into pending from private.gling_activity_events where delivered_at is null;
    if not exists(select 1 from private.gling_activity_events where delivered_at is null and attention
      and (lease_until is null or lease_until<=at_time)) then
      return jsonb_build_object('batch_id',p_batch,'events','[]'::jsonb,'busy',false,'pending_count',pending);
    end if;
    insert into private.gling_activity_batches(batch_id,lease_until) values(p_batch,expires);
    update private.gling_activity_events set batch_id=p_batch,lease_until=expires where id in (
      select id from private.gling_activity_events where delivered_at is null and attention
      and (lease_until is null or lease_until<=at_time) order by id limit p_limit);
    if not exists(select 1 from private.gling_activity_events where batch_id=p_batch and delivered_at is null) then
      update private.gling_activity_batches set acknowledged_at=at_time where batch_id=p_batch;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'target_id',target_id,'actor_id',actor_id,
    'context_id',context_id,'action',action,'occurred_at',occurred_at,'operated_actor',operated_actor,'attention',attention) order by id),'[]'::jsonb)
    into events from private.gling_activity_events where batch_id=p_batch and delivered_at is null and lease_until>at_time and expires>at_time;
  return jsonb_build_object('batch_id',p_batch,'events',events,'busy',false,'pending_count',pending);
end;
$$;
create function private.ack_gling_activity(p_batch uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare at_time timestamptz := clock_timestamp(); affected integer;
begin
  if p_batch is null then raise exception 'INVALID_ACTIVITY_BATCH' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(7142026,1014);
  at_time := clock_timestamp();
  update private.gling_activity_events e set delivered_at=at_time
    where e.batch_id=p_batch and e.delivered_at is null and e.lease_until>at_time
    and exists(select 1 from private.gling_activity_batches b where b.batch_id=p_batch and b.acknowledged_at is null and b.lease_until>at_time);
  get diagnostics affected=row_count;
  update private.gling_activity_batches set acknowledged_at=at_time where batch_id=p_batch and acknowledged_at is null;
  return affected;
end;
$$;
revoke all on function private.capture_gling_activity(),private.claim_gling_activity(uuid,integer,integer),private.ack_gling_activity(uuid)
  from public,anon,authenticated,service_role;
