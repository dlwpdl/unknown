-- Owner 2026-10-25: a real user's personal contact with an operated persona alerts every active admin.
-- Same shape as admin_meetup_request: durable notification + existing push queue, rechecked at insert, read and push.
-- The production-only persona inbox helpers are not in this repo, so the server-owned metadata checks are repeated here.
create function private.admin_persona_contact_operated(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_user and p.account_status='active' and p.deleted_at is null
   and coalesce(u.raw_app_meta_data->>'role','member') not in ('admin','review','reviewer','bot','seed','test','tester','system')
   and coalesce(u.raw_app_meta_data->'review_access','false'::jsonb)<>'true'::jsonb
   and u.raw_app_meta_data->'gling_persona'->>'kind'='gling_operated_character'
   and u.raw_app_meta_data->'gling_persona'->>'version'='4'
   and u.raw_app_meta_data->'gling_persona'->>'profile_id'=p.id::text
   and u.raw_app_meta_data->'gling_persona'->>'city_id'=p.city_id
   and (u.raw_app_meta_data->'gling_persona') ?& array['living','background','values','personality','interests','writing_purpose','voice','continuity']
   and not exists(select 1 from jsonb_each(case when jsonb_typeof(u.raw_app_meta_data->'gling_persona')='object'
     then u.raw_app_meta_data->'gling_persona' else '{}'::jsonb end) d
     where d.key=any(array['living','background','values','personality','interests','writing_purpose','voice','continuity'])
      and d.value in ('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb)));
$$;
create function private.admin_persona_contact_real(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
  where p.id=p_user and p.account_status='active' and p.deleted_at is null and not coalesce(u.is_anonymous,false)
   and coalesce(u.email,'') not like '%@seed.gling.invalid'
   and coalesce(u.raw_app_meta_data->>'role','member') not in ('admin','review','reviewer','bot','seed','test','tester','system')
   and coalesce(u.raw_app_meta_data->'review_access','false'::jsonb)<>'true'::jsonb
   and u.raw_app_meta_data->'gling_persona' is null);
$$;

-- One row per live source: who was contacted, by whom, and since when.
-- 'user' targets are invitations addressed to that persona (co-host or waitlist offer).
create function private.admin_persona_contact_source(p_target_type text,p_target_id uuid)
returns table(persona_id uuid,sender_id uuid,source_at timestamptz)
language sql stable security definer set search_path='' as $$
 select case when c.user_low_id=m.sender_id then c.user_high_id else c.user_low_id end,m.sender_id,m.created_at
 from public.messages m join public.conversations c on c.id=m.conversation_id
 where p_target_type='message' and m.id=p_target_id and c.kind='direct' and c.status='active'
  and m.hidden_at is null and m.deleted_at is null and m.sender_id in (c.user_low_id,c.user_high_id)
 union all
 select case when private.admin_persona_contact_operated(parent.author_id) then parent.author_id else p.author_id end,x.author_id,x.created_at
 from public.comments x join public.posts p on p.id=x.post_id
 left join public.comments parent on parent.id=x.reply_to_id and parent.deleted_at is null
 where p_target_type='comment' and x.id=p_target_id and x.deleted_at is null and p.status='published' and p.deleted_at is null
 union all
 select h.user_id,p.author_id,h.invited_at from private.meetup_cohosts h join public.posts p on p.id=h.post_id
 where p_target_type='user' and h.user_id=p_target_id and h.status='pending' and p.status='published' and p.deleted_at is null
 union all
 select w.user_id,p.author_id,w.invited_at from private.meetup_waitlist w join public.posts p on p.id=w.post_id
 where p_target_type='user' and w.user_id=p_target_id and w.invited_at is not null and w.cancelled_at is null
  and p.status='published' and p.deleted_at is null;
$$;

create function private.admin_persona_contact_visible(p_admin uuid,p_target_type text,p_target_id uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.admin_persona_contact_source(p_target_type,p_target_id) s
  join public.profiles admin on admin.id=p_admin join auth.users admin_auth on admin_auth.id=admin.id
  where s.source_at<=p_created_at and admin.id<>s.persona_id
   and admin_auth.raw_app_meta_data->>'role'='admin' and admin.account_status='active' and admin.deleted_at is null
   and private.admin_persona_contact_operated(s.persona_id) and private.admin_persona_contact_real(s.sender_id)
   and not private.is_blocked_between(s.persona_id,s.sender_id));
$$;
create function private.can_read_admin_persona_contact(p_admin uuid,p_target_type text,p_target_id uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select (p_admin=auth.uid() or private.is_admin())
  and private.admin_persona_contact_visible(p_admin,p_target_type,p_target_id,p_created_at);
$$;
revoke all on function private.admin_persona_contact_operated(uuid),private.admin_persona_contact_real(uuid),
 private.admin_persona_contact_source(text,uuid),private.admin_persona_contact_visible(uuid,text,uuid,timestamptz),
 private.can_read_admin_persona_contact(uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.can_read_admin_persona_contact(uuid,text,uuid,timestamptz) to authenticated;

do $$
declare definition text; anchor text;
begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
 if definition is null or definition not like 'CHECK (%' or definition not like '%admin_meetup_request%' then raise exception 'ADMIN_PERSONA_CONTACT_KIND_CHANGED'; end if;
 alter table public.notifications drop constraint notifications_kind_check;
 execute 'alter table public.notifications add constraint notifications_kind_check '||
  replace(definition,'CHECK (','CHECK (kind = ''admin_persona_contact'' or ');

 definition:=pg_get_functiondef('private.filter_notification()'::regprocedure);
 anchor:='new.category := private.notification_category(new.kind, new.target_type);';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'ADMIN_PERSONA_CONTACT_FILTER_CHANGED'; end if;
 execute replace(definition,anchor,anchor||E'\n  if new.kind=''admin_persona_contact'' and not private.admin_persona_contact_visible(new.user_id,new.target_type,new.target_id,new.created_at) then return null; end if;');

 definition:=pg_get_functiondef('private.push_notification_eligible(uuid,uuid)'::regprocedure);
 anchor:='and n.read_at is null';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'ADMIN_PERSONA_CONTACT_PUSH_CHANGED'; end if;
 execute replace(definition,anchor,anchor||E'\n      and (n.kind<>''admin_persona_contact'' or private.admin_persona_contact_visible(n.user_id,n.target_type,n.target_id,n.created_at))');
end;
$$;

-- A demoted admin or a withdrawn/hidden source no longer shows in the inbox or the raw table.
create policy admin_persona_contact_current on public.notifications as restrictive for select to authenticated
 using(kind<>'admin_persona_contact' or private.can_read_admin_persona_contact(user_id,target_type,target_id,created_at));

-- Body carries only the two nicknames (and a meetup title for invites), never the message or comment text.
create function private.notify_admin_persona_contact() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_type text; v_target uuid; v_thread uuid; v_persona uuid; v_sender uuid; v_route text; v_title text; v_action text;
begin
 if tg_table_name='messages' then
  v_type:='message'; v_target:=new.id; v_thread:=new.conversation_id; v_route:='/admin?section=conversations';
  v_action:='에게 1:1 메시지를 보냈어요.';
 elsif tg_table_name='comments' then
  v_type:='comment'; v_target:=new.id; v_thread:=new.post_id; v_route:='/post/'||new.post_id::text||'?commentId='||new.id::text;
  v_action:=case when exists(select 1 from public.comments c where c.id=new.reply_to_id and c.deleted_at is null
   and private.admin_persona_contact_operated(c.author_id)) then '의 댓글에 답글을 남겼어요.' else '의 글에 댓글을 남겼어요.' end;
 else
  -- Invitations: the persona is the invitee and the meetup author is the sender.
  v_type:='user'; v_target:=new.user_id; v_thread:=new.user_id; v_persona:=new.user_id; v_route:='/post/'||new.post_id::text;
  select p.author_id,left(p.title,120) into v_sender,v_title from public.posts p where p.id=new.post_id;
  v_action:=case when tg_table_name='meetup_cohosts' then '을 모임 「'||v_title||'」 공동 호스트로 초대했어요.'
   else '에게 모임 「'||v_title||'」 참여를 제안했어요.' end;
 end if;
 if v_type<>'user' then
  select s.persona_id,s.sender_id into v_persona,v_sender from private.admin_persona_contact_source(v_type,v_target) s;
 end if;
 if v_persona is null or not private.admin_persona_contact_operated(v_persona) or not private.admin_persona_contact_real(v_sender) then return new; end if;

 -- One alert per admin per thread (DM room, post, or invited persona) every 30 minutes.
 perform pg_advisory_xact_lock(hashtextextended('admin-persona-contact:'||v_thread::text,0));
 insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at)
 select admin.id,'admin_persona_contact',v_type,v_target,
  left(sender.nickname::text||'님이 운영 캐릭터 '||persona.nickname::text||'님'||v_action,300),v_route,clock_timestamp()
 from public.profiles admin join auth.users u on u.id=admin.id
 join public.profiles sender on sender.id=v_sender join public.profiles persona on persona.id=v_persona
 where u.raw_app_meta_data->>'role'='admin' and admin.account_status='active' and admin.deleted_at is null and admin.id<>v_persona
  and not exists(select 1 from public.notifications n
   left join public.messages m on n.target_type='message' and m.id=n.target_id
   left join public.comments c on n.target_type='comment' and c.id=n.target_id
   where n.user_id=admin.id and n.kind='admin_persona_contact' and n.created_at>clock_timestamp()-interval '30 minutes'
    and coalesce(m.conversation_id,c.post_id,n.target_id)=v_thread);
 return new;
-- An alert failure must never block the member's message, comment or invite.
exception when others then
 raise warning 'ADMIN_PERSONA_CONTACT_ALERT_SKIPPED %', sqlstate;
 return new;
end;
$$;
revoke all on function private.notify_admin_persona_contact() from public,anon,authenticated,service_role;
create trigger messages_notify_admin_persona_contact after insert on public.messages
 for each row when(new.hidden_at is null and new.deleted_at is null) execute function private.notify_admin_persona_contact();
create trigger comments_notify_admin_persona_contact after insert on public.comments
 for each row when(new.deleted_at is null) execute function private.notify_admin_persona_contact();
create trigger meetup_cohosts_notify_admin_persona_contact after insert or update of status on private.meetup_cohosts
 for each row when(new.status='pending') execute function private.notify_admin_persona_contact();
create trigger meetup_waitlist_notify_admin_persona_contact after update of invited_at on private.meetup_waitlist
 for each row when(new.invited_at is not null and new.invited_at is distinct from old.invited_at) execute function private.notify_admin_persona_contact();
notify pgrst,'reload schema';
