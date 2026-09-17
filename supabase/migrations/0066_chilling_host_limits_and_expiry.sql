create function private.meetup_is_open(p_status text,p_preview jsonb) returns boolean
language sql stable set search_path='' as $$
  select p_status='published' and p_preview is not null and coalesce(p_preview->>'closed','false')<>'true'
    and not coalesce(p_preview->>'eventKind'='once' and (p_preview->>'endsAt')::timestamptz<=now(),false);
$$;
create or replace function private.membership_meetup_count(p_user_id uuid)
returns integer language sql security definer set search_path='' as $$
  select count(*)::int from public.posts p where private.meetup_is_open(p.status,p.room_preview)
    and (p.author_id=p_user_id or exists(select 1 from public.meetup_requests r
      where r.post_id=p.id and r.requester_id=p_user_id and r.status='approved'));
$$;

create function private.assert_meetup_hosting(p_user_id uuid,p_once boolean) returns void
language plpgsql security definer set search_path='' as $$
declare policy jsonb:=private.meetup_policy(p_user_id);
begin
  if policy->>'hostBlockedUntil' is not null then
    raise exception 'MEETUP_HOST_RESTRICTED' using detail=greatest((policy->>'hostBlockedUntil')::timestamptz,
      case when p_once then (policy->>'createBlockedUntil')::timestamptz end)::text;
  end if;
  if p_once and policy->>'createBlockedUntil' is not null then
    raise exception 'CHILLING_CREATE_LIMIT' using detail=policy->>'createBlockedUntil';
  end if;
end;
$$;

create function private.guard_meetup_host_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.room_preview is not null then
    -- An expired one-off cannot be extended or converted to evade its scheduled end.
    if old.room_preview->>'eventKind'='once' and (old.room_preview->>'endsAt')::timestamptz<=now()
      and (new.room_preview->>'eventKind',new.room_preview->>'endsAt') is distinct from
          (old.room_preview->>'eventKind',old.room_preview->>'endsAt') then raise exception 'MEETUP_EXPIRED'; end if;
    if private.meetup_is_open(old.status,old.room_preview) and auth.uid()=old.author_id
      and exists(select 1 from public.meetup_requests where post_id=old.id and status='approved')
      and (not private.meetup_is_open(new.status,new.room_preview)
        or (old.room_preview->>'eventKind'='once' and
          (new.room_preview->>'eventKind' is distinct from 'once'
            or (new.room_preview->>'endsAt')::timestamptz<(old.room_preview->>'endsAt')::timestamptz))) then
      perform private.record_meetup_activity(old.author_id,old.id,'close');
    end if;
  end if;
  if not private.meetup_is_open(new.status,new.room_preview) then return new; end if;
  if tg_op='INSERT' then
    perform private.assert_meetup_hosting(new.author_id,new.room_preview->>'eventKind'='once');
  elsif old.room_preview is null then
    perform private.assert_meetup_hosting(new.author_id,new.room_preview->>'eventKind'='once');
  end if;
  if new.room_preview->>'eventKind'='once' and not exists(select 1 from private.meetup_activity
    where user_id=new.author_id and post_id=new.id and action='create') then
    perform private.assert_meetup_hosting(new.author_id,true);
    perform private.record_meetup_activity(new.author_id,new.id,'create');
  end if;
  return new;
end;
$$;
create trigger posts_meetup_abuse before insert or update of status,room_preview on public.posts
for each row execute function private.guard_meetup_host_activity();

-- No retroactive departure/closure penalties. Count existing recent one-off creations.
insert into private.meetup_activity(user_id,post_id,action,occurred_at)
select author_id,id,'create',created_at from public.posts where room_preview->>'eventKind'='once'
  and created_at>now()-interval '7 days' on conflict do nothing;

create or replace function private.sync_meetup_conversation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.meetup_is_open(new.status,new.room_preview) then
    insert into public.conversations(kind,group_post_id,status,accepted_at)
      values('group',new.id,'active',now()) on conflict(group_post_id) do update set status='active',ended_at=null;
  elsif tg_op='UPDATE' and old.room_preview is not null then
    update public.conversations set status='ended',ended_at=now() where group_post_id=new.id and status='active';
  end if;
  return new;
end;
$$;
create function private.expire_chilling_events() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_relationships();
  update public.posts set room_preview=jsonb_set(room_preview,'{closed}','true')
    where room_preview->>'eventKind'='once' and coalesce(room_preview->>'closed','false')<>'true'
      and (room_preview->>'endsAt')::timestamptz<=now();
end;
$$;
select cron.schedule('gling-chilling-expiry','* * * * *','select private.expire_chilling_events()');

-- Extend established RPCs without bypassing consent, moderation, identity or image checks.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.create_post(text,smallint,text,text,text[],text[],jsonb,text,numeric)'::regprocedure);
  anchor:=E'  else\n    select count(*) into used_count';
  if strpos(definition,anchor)=0 then raise exception 'create quota anchor missing'; end if;
  definition:=replace(definition,anchor,E'  elsif tag_kind<>''meetup'' then\n    select count(*) into used_count');
  definition:=replace(definition,'and kind = ''story'';','and kind = ''story'' and room_preview is null;');
  anchor:=E'    if exists (\n      select 1 from public.posts as existing_post\n      where existing_post.author_id = current_user_id\n        and existing_post.room_preview is not null\n        and existing_post.status = ''published''\n        and existing_post.created_at > now() - interval ''6 hours''\n    ) then raise exception ''MEETUP_COOLDOWN''; end if;';
  if strpos(definition,anchor)=0 then raise exception 'old meetup cooldown anchor missing'; end if;
  execute replace(definition,anchor,'    perform private.assert_meetup_hosting(current_user_id,false);');

  definition:=pg_get_functiondef('public.create_chilling_event(text,text,text,jsonb,text)'::regprocedure);
  anchor:='  -- Preserve create_post''s consent, moderation, membership, quota, cooldown and slot checks.';
  if strpos(definition,anchor)=0 then raise exception 'chilling creation guard anchor missing'; end if;
  execute replace(definition,anchor,E'  perform private.lock_relationships();\n  perform private.assert_meetup_hosting(auth.uid(),p_event->>''eventKind''=''once'');\n'||anchor);

  definition:=pg_get_functiondef('public.get_membership()'::regprocedure);
  definition:=replace(definition,'and kind=''story''','and kind=''story'' and room_preview is null');
  anchor:='''meetupUnlocksAt'',coalesce((select jsonb_agg(unlocks_at order by unlocks_at) from private.relationship_cooldowns where user_id=u and pool=''group'' and unlocks_at>now()),''[]''::jsonb)';
  if strpos(definition,anchor)=0 then raise exception 'membership cooldown anchor missing'; end if;
  execute replace(definition,anchor,'''meetupUnlocksAt'',''[]''::jsonb');

  definition:=pg_get_functiondef('public.get_conversation_previews(integer,timestamptz,uuid)'::regprocedure);
  anchor:='and c.status in (''active'',''pending'',''ended'')';
  if strpos(definition,anchor)=0 then raise exception 'previews active anchor missing'; end if;
  execute replace(definition,anchor,anchor||' and (c.kind<>''group'' or private.meetup_is_open(p.status,p.room_preview))');

  definition:=pg_get_functiondef('public.send_message(uuid,text)'::regprocedure);
  anchor:='  if c.status<>''active'' then raise exception ''CONVERSATION_NOT_ACTIVE''; end if;';
  if strpos(definition,anchor)=0 then raise exception 'message active anchor missing'; end if;
  execute replace(definition,anchor,anchor||E'\n  if c.kind=''group'' then perform private.assert_chilling_open((select room_preview from public.posts where id=c.group_post_id)); end if;');

  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  anchor:='  delete from private.relationship_cooldowns where user_id=current_user_id;';
  if strpos(definition,anchor)=0 then raise exception 'account cleanup anchor missing'; end if;
  execute replace(definition,anchor,anchor||E'\n  delete from private.meetup_activity where user_id=current_user_id;');
end;
$$;
revoke all on function private.meetup_is_open(text,jsonb),private.assert_meetup_hosting(uuid,boolean),
  private.guard_meetup_host_activity(),private.expire_chilling_events() from public,anon,authenticated,service_role;
