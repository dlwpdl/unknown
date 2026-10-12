-- One existing queue item advances one bounded segment per normal worker claim.
create table private.message_safety_progress (
  queue_id bigint primary key references public.safety_review_queue(id) on delete cascade,
  history_id bigint not null default 0,
  current_hash text,
  current_text text,
  current_offset integer not null default 0 check (current_offset>=0)
);
revoke all on private.message_safety_progress from public,anon,authenticated,service_role;
alter table private.message_history add constraint message_history_body_length
  check (char_length(btrim(original->>'body')) between 1 and 2000);

-- Immutable history IDs bind the queue to every retained version without building an unbounded body.
create or replace function private.message_safety_content(p_message_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('authorId',m.sender_id,'text',concat_ws(E'\n',m.body,
    'retained-version:'||coalesce((select max(id) from private.message_history where message_id=m.id),0)))
  from public.messages m where m.id=p_message_id;
$$;

create function public.claim_safety_reviews_v2(p_limit integer default 20)
returns table(id bigint,target_type text,target_id uuid,content_hash text,claimed_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare item record;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  -- Reclaim abandoned message leases in the same scheduled run; stale completions cannot advance them.
  update public.safety_review_queue q set status='failed',next_attempt_at=now(),last_error='REVIEW_LEASE_EXPIRED'
    where q.target_type='message' and q.status='processing' and q.updated_at<now()-interval '5 minutes';
  for item in select * from public.claim_safety_reviews(p_limit) loop
    return query update public.safety_review_queue q set updated_at=clock_timestamp() where q.id=item.id
      returning q.id,q.target_type,q.target_id,q.content_hash,q.updated_at;
  end loop;
end;
$$;

drop function public.get_message_safety_content(uuid);
create function public.get_message_safety_content(p_message_id uuid,p_queue_id bigint,p_content_hash text,p_claimed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.safety_review_queue; m public.messages; progress private.message_safety_progress;
  version private.message_history; context jsonb; body text; position integer; version_id bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select * into q from public.safety_review_queue where id=p_queue_id for update;
  if q.id is null or q.target_type<>'message' or q.target_id<>p_message_id or q.status<>'processing'
    or q.content_hash is distinct from p_content_hash or q.updated_at is distinct from p_claimed_at then raise exception 'REVIEW_CHANGED'; end if;
  select * into m from public.messages where id=p_message_id;
  if m.id is null then return null; end if;
  insert into private.message_safety_progress(queue_id) values(q.id) on conflict do nothing;
  select * into progress from private.message_safety_progress where queue_id=q.id for update;
  if progress.current_hash is distinct from q.content_hash then
    update private.message_safety_progress set current_hash=q.content_hash,current_text=null,current_offset=0
      where queue_id=q.id returning * into progress;
  end if;
  select * into version from private.message_history where message_id=m.id and id>progress.history_id order by id limit 1;
  if version.id is not null then
    body:=btrim(version.original->>'body'); position:=0; version_id:=version.id;
  else
    -- Recheck the consent-filtered context before every delayed segment.
    if to_regprocedure('public.get_message_safety_context(uuid)') is not null then
      execute 'select public.get_message_safety_context($1)' into context using m.id;
    end if;
    body:=concat_ws(E'\n',m.body,context->>'text');
    if progress.current_text is distinct from body then
      update private.message_safety_progress set current_text=body,current_offset=0
        where queue_id=q.id returning * into progress;
    end if;
    body:=progress.current_text; position:=progress.current_offset; version_id:=0;
  end if;
  return jsonb_build_object('authorId',m.sender_id,
    'text',case when version_id=0 then '' else '수정·삭제 전 메시지:'||E'\n' end||substring(body from position+1 for 5000),
    'scan',jsonb_build_object('historyId',version_id,'offset',position));
end;
$$;

create function public.complete_message_safety_review(p_queue_id bigint,p_content_hash text,p_claimed_at timestamptz,
  p_history_id bigint,p_offset integer,p_risk_score numeric,p_risk_level text,p_risk_reasons jsonb,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.safety_review_queue; progress private.message_safety_progress; version private.message_history;
  finished boolean:=false; previous_rank integer; next_rank integer; level text; reasons jsonb; body_length integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select * into q from public.safety_review_queue where id=p_queue_id for update;
  if q.id is null or q.target_type<>'message' or q.status<>'processing' or q.content_hash is distinct from p_content_hash
    or q.updated_at is distinct from p_claimed_at then return jsonb_build_object('accepted',false,'finished',false); end if;
  if p_error is not null then
    update public.safety_review_queue set status='failed',last_error=left(p_error,1000),
      next_attempt_at=case when attempts>=5 then null else now()+make_interval(mins=>(2^attempts)::integer) end,
      reviewed_at=null,updated_at=clock_timestamp() where id=q.id;
    return jsonb_build_object('accepted',true,'finished',false,'alert',false);
  end if;
  if p_risk_score is null or p_risk_score not between 0 and 1 or p_risk_level is null
    or p_risk_level not in ('low','medium','high','critical') or jsonb_typeof(p_risk_reasons) is distinct from 'array'
    or jsonb_array_length(p_risk_reasons) not between 1 and 4 then raise exception 'INVALID_REVIEW_RESULT'; end if;
  select * into progress from private.message_safety_progress where queue_id=q.id for update;
  select * into version from private.message_history where message_id=q.target_id and id>progress.history_id order by id limit 1;
  if progress.queue_id is null or p_history_id is null or p_offset is null
    or p_history_id<>coalesce(version.id,0) or p_offset<>(case when version.id is null then progress.current_offset else 0 end) then raise exception 'REVIEW_CHANGED'; end if;
  if version.id is not null then
    update private.message_safety_progress set history_id=version.id where queue_id=q.id;
  else
    body_length:=char_length(progress.current_text);
    if body_length is null then raise exception 'REVIEW_CHANGED'; end if;
    finished:=p_offset+5000>=body_length;
    update private.message_safety_progress set current_offset=case when finished then body_length else p_offset+4800 end where queue_id=q.id;
  end if;
  previous_rank:=coalesce(array_position(array['low','medium','high','critical'],q.risk_level),0);
  next_rank:=array_position(array['low','medium','high','critical'],p_risk_level);
  level:=case when next_rank>previous_rank then p_risk_level else q.risk_level end;
  select coalesce(jsonb_agg(distinct reason) filter(where reason<>'none'),'["none"]'::jsonb) into reasons
    from jsonb_array_elements_text(q.risk_reasons||p_risk_reasons) as r(reason);
  update public.safety_review_queue set status=case when finished then 'reviewed' else 'pending' end,
    risk_score=greatest(coalesce(q.risk_score,0),p_risk_score),risk_level=level,risk_reasons=reasons,
    attempts=0,last_error=null,next_attempt_at=null,reviewed_at=case when finished then now() else null end,
    updated_at=clock_timestamp() where id=q.id;
  return jsonb_build_object('accepted',true,'finished',finished,'riskLevel',level,'alert',next_rank>=3 and next_rank>previous_rank);
end;
$$;
revoke all on function public.claim_safety_reviews_v2(integer),
  public.get_message_safety_content(uuid,bigint,text,timestamptz),
  public.complete_message_safety_review(bigint,text,timestamptz,bigint,integer,numeric,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_safety_reviews_v2(integer),
  public.get_message_safety_content(uuid,bigint,text,timestamptz),
  public.complete_message_safety_review(bigint,text,timestamptz,bigint,integer,numeric,text,jsonb,text) to service_role;

-- New edits append evidence; they must not erase the risk already found in earlier versions.
do $$ declare definition text; anchor text; replacement text;
begin
  definition:=pg_get_functiondef('private.enqueue_safety_review()'::regprocedure);
  foreach anchor in array array['risk_score = null','risk_level = null','risk_reasons = ''[]''::jsonb'] loop
    if strpos(definition,anchor)=0 then raise exception 'safety aggregate anchor missing'; end if;
    replacement:=split_part(anchor,' = ',1)||' = case when kind=''message'' then public.safety_review_queue.'||split_part(anchor,' = ',1)||' else '||split_part(anchor,' = ',2)||' end';
    definition:=replace(definition,anchor,replacement);
  end loop;
  execute definition;
  definition:=pg_get_functiondef('public.raise_safety_alert(bigint)'::regprocedure);
  anchor:='review.status <> ''reviewed''';
  if strpos(definition,anchor)=0 then raise exception 'safety alert status anchor missing'; end if;
  definition:=replace(definition,anchor,'(review.status <> ''reviewed'' and not (review.target_type=''message'' and review.status in (''pending'',''processing'',''failed'')))');
  anchor:='review.risk_level not in (''high'', ''critical'')';
  if strpos(definition,anchor)=0 then raise exception 'safety alert risk anchor missing'; end if;
  execute replace(definition,anchor,'(review.risk_level is null or review.risk_level not in (''high'', ''critical''))');
  definition:=pg_get_functiondef('private.admin_conversation_signals(uuid)'::regprocedure);
  anchor:='and q.status=''reviewed''';
  if strpos(definition,anchor)=0 then raise exception 'admin signal status anchor missing'; end if;
  execute replace(definition,anchor,'and (q.status=''reviewed'' or q.risk_level in (''high'',''critical''))');
end $$;

create index message_history_image_path_idx on private.message_history((original->>'image_path')) where original->>'image_path' is not null;
create function private.can_read_retained_chat_image(p_bucket text,p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare message_id uuid; sender_id uuid;
begin
  if p_bucket is distinct from 'chat-images' or not private.is_admin() then return false; end if;
  select h.message_id,(h.original->>'sender_id')::uuid into message_id,sender_id
    from private.message_history h where h.original->>'image_path'=p_path order by h.id limit 1;
  if message_id is null then return false; end if;
  perform public.log_admin_access('messages',sender_id,message_id);
  return true;
end;
$$;
revoke all on function private.can_read_retained_chat_image(text,text) from public,anon,service_role;
grant execute on function private.can_read_retained_chat_image(text,text) to authenticated;
create policy "admins read retained chat photos" on storage.objects for select to authenticated
  using (private.can_read_retained_chat_image(bucket_id,name));
notify pgrst,'reload schema';
