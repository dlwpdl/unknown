-- 모임 투표 저절로 닫기 (owner 2026-11-16: 모임 하루 전에 저절로 끝나고, 표를 가장 많이 받은 후보로 정한다).
-- 닫는 때: 날짜 후보가 있으면 가장 이른 후보 날짜 24시간 전, 장소만 있으면 그 모임의 다음 회차 시작 24시간 전(회차가 없으면 닫지 않는다).
-- 투표를 연 지 한 시간은 지켜서, 모임 하루 안쪽으로 연 투표가 열자마자 닫히지 않게 한다.
-- 정하는 일은 호스트가 '투표 끝내기'를 눌렀을 때와 같은 public.decide_meetup_poll이 한다(회차 만들기, 장소 줄, 알림까지 같은 길).
-- 모든 종류에서 1등이 하나이고 표가 있을 때만 정한다. 동점이거나 표가 없으면 투표만 닫고 호스트에게 한 번 알린다.
-- 기존 gling-meetup-tidy(10분)에 붙인다. 새 알림 종류나 경로는 없다: 옛 앱(1.5.2, 1.6.0)도 meetup_changed와 /chat?conversationId=로 연다.
set local lock_timeout = '5s';

-- When this open poll closes by itself, or null when it never will.
create function private.meetup_poll_deadline(p_poll uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
  select case when b.at is null then null else greatest(b.created_at+interval '1 hour',b.at-interval '24 hours') end
  from (
    select pl.created_at,
      case when exists(select 1 from private.meetup_poll_options o where o.poll_id=pl.id and o.kind='date')
        then (select min(o.starts_at) from private.meetup_poll_options o where o.poll_id=pl.id and o.kind='date')
        else (select min(s.at) from (
          select (p.room_preview->>'startsAt')::timestamptz at where p.room_preview->>'eventKind'='once'
          union all select ms.starts_at from private.meetup_sessions ms where ms.post_id=p.id) s where s.at>now()) end at
    from private.meetup_polls pl join public.posts p on p.id=pl.post_id where pl.id=p_poll and pl.status='open') b;
$$;

create function private.close_meetup_polls(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare r record; changed integer:=0; date_id uuid; place_id uuid; kinds integer; picked integer; decided boolean;
  claims text:=coalesce(current_setting('request.jwt.claims',true),''); body text;
begin
  for r in select pl.id,pl.post_id,p.author_id,left(p.title,60) title,private.meetup_is_open(p.status,p.room_preview) is_open,
      (select c.id from public.conversations c where c.group_post_id=pl.post_id) room
    from private.meetup_polls pl join public.posts p on p.id=pl.post_id
    where pl.status='open' and (not private.meetup_is_open(p.status,p.room_preview) or private.meetup_poll_deadline(pl.id)<=p_now)
    order by pl.created_at limit 100 for update of pl skip locked
  loop
   begin -- one poll failing must not roll back the rest of the tidy job (it is one transaction)
    changed:=changed+1;
    if not r.is_open then -- the meetup is gone or over: close quietly
      update private.meetup_polls set status='closed',closed_at=clock_timestamp() where id=r.id;
      continue;
    end if;
    -- Votes count the way get_meetup_poll counts them: the host and approved members only.
    with c as(select o.id,o.kind,(select count(*) from private.meetup_poll_votes v where v.option_id=o.id
        and (v.user_id=r.author_id or exists(select 1 from public.meetup_requests q where q.post_id=r.post_id and q.requester_id=v.user_id and q.status='approved'))) votes
      from private.meetup_poll_options o where o.poll_id=r.id),
    t as(select kind,max(votes) top from c group by kind),
    w as(select c.kind,count(*) n,(array_agg(c.id))[1] id from c join t on t.kind=c.kind and c.votes=t.top where t.top>0 group by c.kind)
    select (select id from w where kind='date' and n=1),(select id from w where kind='place' and n=1),
      (select count(*) from t),(select count(*) from w where n=1)
    into date_id,place_id,kinds,picked;
    decided:=false;
    if kinds=picked then
      -- Same call as the host's 'end poll', made as the meetup's host.
      perform set_config('request.jwt.claims',jsonb_build_object('sub',r.author_id,'role','authenticated')::text,true);
      begin
        perform public.decide_meetup_poll(r.id,date_id,place_id);
        decided:=true;
      exception when others then decided:=false; -- shortcut: any failure (date passed, overlap) falls back to closing; the host picks by hand.
      end;
      perform set_config('request.jwt.claims',claims,true);
    end if;
    if not decided then
      update private.meetup_polls set status='closed',closed_at=clock_timestamp() where id=r.id and status='open';
    end if;
    if private.is_active_account(r.author_id) then
      body:=case when decided then '「'||r.title||'」 투표가 닫혀서 표가 가장 많은 후보로 정해졌어요.'
        else '「'||r.title||'」 투표가 닫혔어요. 동점이거나 표가 없는 항목이 있어서 아무것도 정하지 않았어요. 직접 골라 주세요.' end;
      perform private.create_notification(r.author_id,'meetup_changed',null,'post',r.post_id,body,
        case when r.room is null then '/post/'||r.post_id::text else '/chat?conversationId='||r.room::text end);
    end if;
   exception when others then
    changed:=changed-1; raise warning 'close_meetup_polls % skipped: %',r.id,sqlerrm; -- shortcut: the poll stays open and is tried again in ten minutes.
   end;
  end loop;
  return changed;
end $$;
alter function private.meetup_poll_deadline(uuid) owner to postgres;
alter function private.close_meetup_polls(timestamptz) owner to postgres;
revoke all on function private.meetup_poll_deadline(uuid),private.close_meetup_polls(timestamptz) from public,anon,authenticated,service_role;

-- The card can say when it closes: add autoCloseAt (null = never) to the existing answer. Old apps ignore the extra field.
do $$
declare definition text; anchor text:='''closedAt'',poll.closed_at,';
begin
  definition:=pg_get_functiondef('public.get_meetup_poll(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_POLL_GET_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'''autoCloseAt'',private.meetup_poll_deadline(poll.id),');
end $$;

-- Run with the existing ten-minute tidy job (appended, so another change to its command stays).
do $$
declare job record;
begin
  select jobid,command into job from cron.job where jobname='gling-meetup-tidy';
  if job.jobid is null then raise exception 'MEETUP_TIDY_JOB_MISSING'; end if;
  if position('private.close_meetup_polls()' in job.command)=0 then
    perform cron.alter_job(job.jobid,command:=job.command||' select private.close_meetup_polls(); ');
  end if;
end $$;
notify pgrst,'reload schema';
