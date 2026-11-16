-- Unanswered join requests (owner 2026-11-16): two days pending -> the host hears once more; seven days -> the request
-- closes (and the applicant is told); requests on meetups that are gone close silently. Hooked into the existing
-- gling-meetup-tidy job. Free for everyone; nothing here is tier-gated.
--
-- Compatibility: apps in the stores (1.5.2, 1.6.0) only know the request statuses pending/approved/rejected/cancelled
-- and throw on any other value, so a closed request is stored as status 'cancelled' with
--   expired_reason 'no_answer' | 'meetup_closed'   (set only by this job; responded_at stays null)
-- and reminded_at (host reminder sent). Old apps show it as a cancelled request; newer apps tell it apart by expired_reason.
-- responded_at stays null on purpose: old apps count the 24h re-apply wait from created_at then (long over), and
-- meetup_notice_visible (cancelled + responded_at >= notice) and the ended-chat read rule (ended_with_meetup) do not match it.
-- Pending requests never held a seat (capacity counts approved only); 'cancelled' already releases the waitlist entry
-- that invited it (close_meetup_tool_membership), and a host with waitlist promotion on gets the next person offered.

alter table public.meetup_requests
  add column expired_reason text,
  add column reminded_at timestamptz,
  add constraint meetup_requests_expired_reason_check check (expired_reason is null or (status='cancelled' and expired_reason in ('no_answer','meetup_closed')));

-- A request that comes back to pending (re-application) starts clean, so it is reminded and closed on its own clock.
create function private.reset_meetup_request_expiry() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='pending' and old.status<>'pending' then new.reminded_at:=null; new.expired_reason:=null; end if;
  return new;
end $$;
create trigger meetup_requests_reset_expiry before update of status on public.meetup_requests
  for each row execute function private.reset_meetup_request_expiry();

create function private.expire_meetup_requests(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare r record; changed integer:=0; closed integer; hours integer;
begin
  perform private.lock_relationships();
  -- 1. Meetup removed, closed or over: close quietly so the request stops counting anywhere.
  update public.meetup_requests q set status='cancelled',expired_reason='meetup_closed'
    from public.posts p where p.id=q.post_id and q.status='pending' and not private.meetup_is_open(p.status,p.room_preview);
  get diagnostics closed=row_count; changed:=closed;
  -- 2. Seven days without an answer: close it and tell the applicant (the notice opens that meetup, where they can apply again).
  for r in select q.id,q.post_id,q.requester_id,left(p.title,40) title from public.meetup_requests q join public.posts p on p.id=q.post_id
    where q.status='pending' and q.created_at<=p_now-interval '7 days' order by q.created_at limit 200 for update of q skip locked
  loop
    update public.meetup_requests set status='cancelled',expired_reason='no_answer' where id=r.id;
    changed:=changed+1;
    if private.is_active_account(r.requester_id) then
      perform private.create_notification(r.requester_id,'meetup_changed',null,'meetup_request',r.id,
        '「'||r.title||'」 호스트 답이 없어 신청이 닫혔어요.','/post/'||r.post_id::text);
    end if;
    select a.offer_hours into hours from private.meetup_automation a where a.post_id=r.post_id and a.promote_waitlist;
    if hours is not null then
      begin perform private.offer_meetup_waitlist(r.post_id,hours);
      exception when others then null; -- shortcut: a failed offer must not stop the sweep; the offer-expiry job retries.
      end;
    end if;
  end loop;
  -- 3. Two days without an answer: one reminder to the host (only the host can approve).
  for r in select q.id,q.host_id,q.requester_id,(select pr.nickname::text from public.profiles pr where pr.id=q.requester_id) nickname
    from public.meetup_requests q join public.posts p on p.id=q.post_id
    where q.status='pending' and q.reminded_at is null and q.created_at<=p_now-interval '2 days'
      and private.meetup_is_open(p.status,p.room_preview) and private.is_active_account(q.host_id)
      and not exists(select 1 from auth.users a where a.id=q.host_id
        and (a.email like '%@seed.gling.invalid' or a.raw_app_meta_data->'review_access'='true'::jsonb))
    order by q.created_at limit 200 for update of q skip locked
  loop
    update public.meetup_requests set reminded_at=p_now where id=r.id;
    perform private.create_notification(r.host_id,'meetup_request',r.requester_id,'meetup_request',r.id,
      coalesce(r.nickname,'신청자')||'님의 참여 신청이 이틀째 답을 기다려요. 한번 확인해 주세요.','/chat?requestId='||r.id::text);
    changed:=changed+1;
  end loop;
  return changed;
end $$;
revoke all on function private.reset_meetup_request_expiry(), private.expire_meetup_requests(timestamptz) from public, anon, authenticated, service_role;

-- The meetup stays visible to someone whose request closed unanswered (a rejected or cancelled requester no longer sees it).
do $$
declare definition text; anchor text:='r.status in(''cancelled'',''rejected'')';
begin
  definition:=pg_get_functiondef('private.chilling_context_visible(uuid,uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_EXPIRY_VISIBLE_ANCHOR_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' and r.expired_reason is null');
end $$;

-- Run with the existing ten-minute tidy job (appended, so another change to its command stays).
do $$
declare job record;
begin
  select jobid,command into job from cron.job where jobname='gling-meetup-tidy';
  if job.jobid is null then raise exception 'MEETUP_TIDY_JOB_MISSING'; end if;
  if position('private.expire_meetup_requests()' in job.command)=0 then
    perform cron.alter_job(job.jobid,command:=job.command||' select private.expire_meetup_requests(); ');
  end if;
end $$;
notify pgrst,'reload schema';
