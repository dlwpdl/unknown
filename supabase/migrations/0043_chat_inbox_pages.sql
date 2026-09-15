-- Existing store builds keep their original RPC. New clients page by filtered inbox
-- and can resolve a deep link without downloading every archived conversation.
create function public.get_conversation_inbox(
  p_filter text default 'all', p_limit integer default 30, p_before_status text default null,
  p_before_created timestamptz default null, p_before_id uuid default null, p_conversation_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); result jsonb; page_size integer := greatest(1,least(coalesce(p_limit,30),50));
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_filter is null or p_filter not in ('all','direct','group','requests') then raise exception 'INVALID_INBOX_FILTER'; end if;
  if (p_before_status is not null or p_before_created is not null or p_before_id is not null)
    and (p_before_status is null or p_before_status not in ('active','pending','ended') or p_before_created is null or p_before_id is null)
    then raise exception 'INVALID_INBOX_CURSOR'; end if;

  with candidate_ids as materialized (
    select c.id from public.conversations c where c.user_low_id=u
    union select c.id from public.conversations c where c.user_high_id=u
    union select c.id from public.conversations c join public.posts p on p.id=c.group_post_id where p.author_id=u
    union select c.id from public.conversations c join public.meetup_requests r on r.post_id=c.group_post_id
      where r.requester_id=u and r.status='approved'
  ), visible as materialized (
    select c.* from public.conversations c join candidate_ids i on i.id=c.id
    where private.can_read_conversation(c.id,u) and c.status in ('active','pending','ended')
      and (c.status<>'pending' or c.created_at>now()-interval '7 days')
  ), previews as materialized (
    select c.id, other_p.id other_user_id, other_p.nickname::text other_nickname,
      other_p.verification_level other_verification_level, latest.body latest_body,
      coalesce(latest.created_at,c.created_at) latest_at, c.kind,c.status,c.requester_id,c.group_post_id,
      coalesce(p.title,other_p.nickname::text) title,coalesce(p.author_id=u,false) is_group_host
    from visible c left join public.posts p on p.id=c.group_post_id
    left join public.profiles other_p on other_p.id=case when c.kind='group' then p.author_id
      when c.user_low_id=u then c.user_high_id else c.user_low_id end
    left join lateral (
      select m.body,m.created_at from public.messages m where m.conversation_id=c.id
        and private.can_read_message(c.id,u,m.sender_id,m.created_at)
      order by m.created_at desc,m.id desc limit 1
    ) latest on true
    where c.id=p_conversation_id or (
      (case when p_filter='requests' then c.status='pending' else c.status in ('active','ended') end)
      and (p_filter in ('all','requests') or c.kind=p_filter)
    )
  ), page as materialized (
    select r.*,case when r.status='active' then 0 else 1 end rank from previews r
    where (case when p_filter='requests' then r.status='pending' else r.status in ('active','ended') end)
      and (p_filter in ('all','requests') or r.kind=p_filter)
      and (p_before_created is null
        or case when r.status='active' then 0 else 1 end > case when p_before_status='active' then 0 else 1 end
        or (case when r.status='active' then 0 else 1 end = case when p_before_status='active' then 0 else 1 end
          and (r.latest_at,r.id)<(p_before_created,p_before_id)))
    order by rank,r.latest_at desc,r.id desc limit page_size+1
  ), displayed as materialized (
    select * from page order by rank,latest_at desc,id desc limit page_size
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(d)-'rank' order by rank,latest_at desc,id desc) from displayed d),'[]'::jsonb),
    'pending_count',(select count(*) from visible where status='pending'),
    'selected',(select to_jsonb(r) from previews r where r.id=p_conversation_id),
    'cursor',case when (select count(*) from page)>page_size then (
      select jsonb_build_object('status',status,'createdAt',latest_at,'id',id)
      from displayed order by rank desc,latest_at,id limit 1
    ) else null end
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_conversation_inbox(text,integer,text,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_conversation_inbox(text,integer,text,timestamptz,uuid,uuid) to authenticated;
