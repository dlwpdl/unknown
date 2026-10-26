-- Members keep a read-only chat after the host ends a meetup, and hosts can track a simple meetup fee.
-- Additive only: released clients keep their RPCs.

-- 1. Ending a meetup no longer takes the chat away from its approved members. Sending stays blocked by send_message's closed check.
alter table public.meetup_requests add column ended_with_meetup boolean not null default false;
grant select(ended_with_meetup) on public.meetup_requests to authenticated;

do $$
declare definition text; anchor text:='update public.meetup_requests set status=''cancelled'',responded_at=now() where post_id=p.id and status in (''pending'',''approved'');';
begin
  definition:=pg_get_functiondef('public.leave_meetup(uuid)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'MEETUP_END_ANCHOR_CHANGED'; end if;
  -- Approved members keep their approval time so their readable window is unchanged.
  execute replace(definition,anchor,'update public.meetup_requests set status=''cancelled'',ended_with_meetup=(status=''approved''),
      responded_at=case when status=''approved'' then coalesce(responded_at,created_at) else now() end
      where post_id=p.id and status in (''pending'',''approved'');');
end $$;

do $$
declare definition text; anchor text:='r.requester_id=p_user_id and r.status=''approved''';
begin
  definition:=pg_get_functiondef('private.can_read_conversation(uuid,uuid)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'ENDED_CHAT_ANCHOR_CHANGED'; end if;
  execute replace(definition,anchor,'r.requester_id=p_user_id and (r.status=''approved''
        or (r.status=''cancelled'' and r.ended_with_meetup and coalesce(p.room_preview->>''closed'',''false'')=''true''))');
end $$;

do $$
declare definition text; anchor text:='and r.status=''approved'' and (r.share_history';
begin
  definition:=pg_get_functiondef('private.can_read_message(uuid,uuid,uuid,timestamptz,boolean)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'ENDED_MESSAGE_ANCHOR_CHANGED'; end if;
  execute replace(definition,anchor,'and (r.status=''approved''
              or (r.status=''cancelled'' and r.ended_with_meetup and coalesce(p.room_preview->>''closed'',''false'')=''true'')) and (r.share_history');
end $$;

-- 2. Fee: the amount lives on the public meetup so applicants see it before joining; payments are host-marked.
create table private.meetup_fee_payments (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  marked_by uuid not null references auth.users(id) on delete cascade,
  paid_at timestamptz not null default now(),
  primary key (post_id,user_id)
);
revoke all on private.meetup_fee_payments from public, anon, authenticated;

create function public.set_meetup_fee(p_post_id uuid, p_amount numeric, p_note text default '', p_due_on date default null)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); meetup public.posts;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  perform private.lock_relationships();
  select * into meetup from public.posts where id=p_post_id and author_id=u and status='published' and room_preview is not null for update;
  if meetup.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if not private.meetup_is_open(meetup.status,meetup.room_preview) then raise exception 'MEETUP_CLOSED'; end if;
  if p_amount is null then
    update public.posts set room_preview=room_preview-'fee' where id=p_post_id;
    return;
  end if;
  if p_amount<=0 or p_amount>10000 or p_amount<>round(p_amount,2) then raise exception 'INVALID_MEETUP_FEE'; end if;
  if char_length(trim(coalesce(p_note,'')))>200 then raise exception 'INVALID_MEETUP_FEE_NOTE'; end if;
  update public.posts set room_preview=room_preview||jsonb_build_object('fee',jsonb_strip_nulls(jsonb_build_object(
    'amount',p_amount,'note',nullif(trim(coalesce(p_note,'')),''),'dueOn',p_due_on))) where id=p_post_id;
end $$;

create function public.set_meetup_fee_paid(p_post_id uuid, p_user_id uuid, p_paid boolean)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_paid is null then raise exception 'INVALID_RESPONSE'; end if;
  perform 1 from public.posts where id=p_post_id and author_id=u and room_preview ? 'fee' for update;
  if not found then raise exception 'MEETUP_NOT_FOUND'; end if;
  if not exists(select 1 from public.meetup_requests where post_id=p_post_id and requester_id=p_user_id and status='approved')
    then raise exception 'REQUEST_NOT_FOUND'; end if;
  if p_paid then
    insert into private.meetup_fee_payments(post_id,user_id,marked_by) values(p_post_id,p_user_id,u) on conflict do nothing;
  else
    delete from private.meetup_fee_payments where post_id=p_post_id and user_id=p_user_id;
  end if;
end $$;

-- The host sees every member's mark; a member sees only their own.
create function public.get_meetup_fee_payments(p_post_id uuid)
returns table(user_id uuid, paid_at timestamptz) language sql stable security definer set search_path='' as $$
  select f.user_id,f.paid_at from private.meetup_fee_payments f join public.posts p on p.id=f.post_id
  where f.post_id=p_post_id and (p.author_id=auth.uid() or f.user_id=auth.uid());
$$;

revoke all on function public.set_meetup_fee(uuid,numeric,text,date), public.set_meetup_fee_paid(uuid,uuid,boolean),
  public.get_meetup_fee_payments(uuid) from public, anon;
grant execute on function public.set_meetup_fee(uuid,numeric,text,date), public.set_meetup_fee_paid(uuid,uuid,boolean),
  public.get_meetup_fee_payments(uuid) to authenticated;

insert into private.behavior_targets(id) values
 ('meetup.fee.save'),('meetup.fee.clear'),('meetup.fee.paid'),('meetup.fee.due')
on conflict do nothing;
