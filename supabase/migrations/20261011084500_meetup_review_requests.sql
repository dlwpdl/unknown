-- Reuse the existing reminder job; this migration creates no schedule or timer.
create table private.meetup_review_deliveries (
  session_id uuid not null references private.meetup_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(session_id,user_id)
);
create index meetup_review_deliveries_user_idx on private.meetup_review_deliveries(user_id);
alter table private.meetup_review_deliveries enable row level security;
revoke all on private.meetup_review_deliveries from public,anon,authenticated,service_role;
alter table private.meetup_review_deliveries owner to postgres;
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null then raise exception 'REVIEW_NOTIFICATION_CONSTRAINT_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check ((%s) or kind=''meetup_review_request'')',substring(definition from 8 for char_length(definition)-8));
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  if strpos(definition,'case p_kind')=0 then raise exception 'REVIEW_NOTIFICATION_CATEGORY_CHANGED'; end if;
  execute replace(definition,'case p_kind','case p_kind when ''meetup_review_request'' then ''meetups''');
end;
$$;
create function private.send_meetup_review_requests(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare item record; claimed uuid; total integer:=0;
begin
  perform private.lock_relationships();
  for item in select s.id,a.user_id from private.meetup_sessions s join private.meetup_attendance a on a.session_id=s.id
    where s.ends_at+interval '12 hours'<=p_now and s.ends_at+interval '12 hours'>p_now-interval '1 minute'
      and private.is_active_account(a.user_id)
      and (a.checked_in_at is not null or a.claim_status='pending' or a.user_id=s.host_id)
  loop
    claimed:=null;
    insert into private.meetup_review_deliveries(session_id,user_id) values(item.id,item.user_id)
      on conflict do nothing returning session_id into claimed;
    if claimed is null then continue; end if;
    insert into public.notifications(user_id,kind,target_type,target_id,body,route)
      values(item.user_id,'meetup_review_request','meetup_session',item.id,
        '모임은 어땠나요? 참석 확인 후 경험과 매너 평가를 남겨주세요.','/profile/meetup-reviews');
    total:=total+1;
  end loop;
  return total;
end;
$$;
revoke all on function private.send_meetup_review_requests(timestamptz) from public,anon,authenticated,service_role;
alter function private.send_meetup_review_requests(timestamptz) owner to postgres;
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('private.send_meetup_reminders(timestamptz)'::regprocedure);
  if strpos(definition,'return total;')=0 then raise exception 'REVIEW_REMINDER_SENDER_CHANGED'; end if;
  execute replace(definition,'return total;','return total+private.send_meetup_review_requests(p_now);');
end;
$$;
notify pgrst,'reload schema';
