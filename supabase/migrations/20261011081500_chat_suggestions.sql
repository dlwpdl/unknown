-- Preserve transaction-review origins while tracking the latest valid conversation topic.
alter table public.conversations add column context_post_id uuid references public.posts(id) on delete set null;
create index conversations_context_post_idx on public.conversations(context_post_id) where context_post_id is not null;
do $$
declare definition text; anchor text:='return c.id;';
begin
  definition:=pg_get_functiondef('public.start_conversation(uuid,uuid)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'conversation context return anchor missing'; end if;
  execute replace(definition,anchor,$patch$
    update public.conversations set context_post_id=p_post_id where id=c.id and exists(
      select 1 from public.posts p where p.id=p_post_id and p.author_id=other_user_id and p.status='published'
        and (p.kind='listing' or p.room_preview is not null));
    return c.id;
  $patch$);
end;
$$;

create function public.get_chat_suggestion_context(p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c public.conversations; result jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into c from public.conversations where id=p_conversation_id;
  if c.id is null or not private.can_read_conversation(c.id,u)
    or (c.kind='direct' and u not in(c.user_low_id,c.user_high_id))
    or (c.kind='group' and not exists(select 1 from public.posts p where p.id=c.group_post_id and (p.author_id=u
      or exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=u and r.status='approved'))))
    then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  select jsonb_build_object('postId',p.id,'title',p.title,'authorId',p.author_id,'listingStatus',p.listing_status,
    'category',case when p.room_preview is not null then 'meetup' when t.slug='used' then 'used'
      when t.slug='housing' and p.title ~* '(테넌트|세입자|입주자|tenant|roommate|렌트합니다|렌트해요)' then 'housing_offer'
      when t.slug='housing' and p.title ~* '((집|방|렌트|룸|원룸|하우스|아파트|콘도).{0,12}(구해|찾아|찾고|구합니다)|looking for.{0,16}(rent|room|home|house|apartment))' then 'housing_wanted'
      when t.slug='housing' then 'housing' else 'generic' end) into result
  from public.posts p join public.tags t on t.id=p.tag_id
  where p.id=case when c.kind='group' then c.group_post_id else coalesce(c.context_post_id,c.origin_post_id) end
    and p.status='published' and private.is_active_account(p.author_id)
    and (c.kind='group' or p.author_id in(c.user_low_id,c.user_high_id))
    and not private.is_blocked_between(u,p.author_id) and not private.has_reported(u,'post',p.id)
    and not private.has_reported(u,'user',p.author_id);
  return result;
end;
$$;
revoke all on function public.get_chat_suggestion_context(uuid) from public,anon,authenticated;
grant execute on function public.get_chat_suggestion_context(uuid) to authenticated;

-- Atomic idempotency covers double taps and a lost success response; no new message path bypasses the existing send gate.
create table private.chat_suggested_sends (
  sender_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body_sha bytea not null,
  message_id uuid references public.messages(id) on delete cascade,
  primary key(sender_id,client_id)
);
create index chat_suggested_sends_conversation_idx on private.chat_suggested_sends(conversation_id);
create index chat_suggested_sends_message_idx on private.chat_suggested_sends(message_id);
alter table private.chat_suggested_sends enable row level security;
revoke all on private.chat_suggested_sends from public,anon,authenticated,service_role;
alter table private.chat_suggested_sends owner to postgres;
create function public.send_suggested_message(p_conversation_id uuid,p_body text,p_client_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c public.conversations; receipt private.chat_suggested_sends; body text:=btrim(p_body); sent uuid; hash bytea;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_client_id is null then raise exception 'INVALID_SEND_ID'; end if;
  if body is null or char_length(body) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
  select * into c from public.conversations where id=p_conversation_id;
  if c.id is null or (c.kind='direct' and u not in(c.user_low_id,c.user_high_id)) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if c.status<>'active' then raise exception 'CONVERSATION_NOT_ACTIVE'; end if;
  if not private.can_read_conversation(c.id,u) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  hash:=extensions.digest(body,'sha256');
  insert into private.chat_suggested_sends(sender_id,client_id,conversation_id,body_sha)
    values(u,p_client_id,c.id,hash) on conflict(sender_id,client_id) do nothing;
  select * into receipt from private.chat_suggested_sends where sender_id=u and client_id=p_client_id for update;
  if receipt.conversation_id<>c.id or receipt.body_sha<>hash then raise exception 'SEND_ID_CONFLICT'; end if;
  if receipt.message_id is not null then return receipt.message_id; end if;
  sent:=public.send_message(c.id,body);
  update private.chat_suggested_sends set message_id=sent where sender_id=u and client_id=p_client_id;
  return sent;
end;
$$;
revoke all on function public.send_suggested_message(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.send_suggested_message(uuid,text,uuid) to authenticated;
