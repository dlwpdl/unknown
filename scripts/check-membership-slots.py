"""Run against the disposable local Gling DB: python3 scripts/check-membership-slots.py.
Proves paid-tier slot capacity and every meetup/conversation cooldown rule on real code paths.
The whole script runs in one transaction and rolls back, so it leaves no data behind.
"""
import subprocess

USERS = {
    "free": "7a000000-0000-0000-0000-000000000001",
    "premium": "7a000000-0000-0000-0000-000000000002",
    "leaver": "7a000000-0000-0000-0000-000000000003",
    "plus": "7a000000-0000-0000-0000-000000000004",
    "peer": "7a000000-0000-0000-0000-000000000005",
    "admin": "7a000000-0000-0000-0000-000000000006",
}

SQL = """
begin;
insert into auth.users(id,email) values
 ('{free}','slot-free@example.test'),
 ('{premium}','slot-premium@example.test'),
 ('{leaver}','slot-leaver@example.test'),
 ('{plus}','slot-plus@example.test'),
 ('{peer}','slot-peer@example.test'),
 ('{admin}','slot-admin@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'슬롯검증'||right(id::text,2),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '7a000000-%';
update auth.users set raw_app_meta_data='{"role":"admin"}'::jsonb where id='{admin}';
insert into auth.sessions(id,user_id,aal) values
('7a060000-0000-0000-0000-000000000006','{admin}','aal2');

do $$
declare r record;
begin
  for r in select * from (values
      ('{premium}'::uuid,'premium'::text),('{plus}'::uuid,'plus'::text),('{peer}'::uuid,'premium'::text)) v(uid,tier)
  loop
    perform public.apply_membership_snapshot(r.uid, jsonb_build_array(jsonb_build_object(
      'tier',r.tier,'expires_at',now()+interval '30 days','product_id',r.tier,'store','app_store','will_renew',true)), now());
  end loop;
end $$;

-- 1. Each tier gets its own capacity.
do $$
declare r record;
begin
  for r in select * from (values
      ('{free}'::uuid,2,'free'::text),('{plus}'::uuid,4,'plus'::text),('{premium}'::uuid,7,'premium'::text)) v(uid,expected,tier)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub',r.uid,'role','authenticated')::text, true);
    if (public.get_membership()->>'meetupLimit')::int <> r.expected or (public.get_membership()->>'conversationLimit')::int <> r.expected then
      raise exception 'FAIL % capacity meetup=% conversation=%', r.tier, public.get_membership()->>'meetupLimit', public.get_membership()->>'conversationLimit'; end if;
    raise notice 'PASS tier % holds % meetups and % conversations', r.tier, r.expected, r.expected;
  end loop;
end $$;

-- 2. The cap holds for each tier.
do $$
declare r record; i int;
begin
  for r in select * from (values
      ('{free}'::uuid,2,'free'::text,'7b000000-0000-0000-0001-'::text),
      ('{plus}'::uuid,4,'plus'::text,'7b000000-0000-0000-0002-'::text),
      ('{premium}'::uuid,7,'premium'::text,'7b000000-0000-0000-0003-'::text)) v(uid,lim,tier,prefix)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub',r.uid,'role','authenticated')::text, true);
    for i in 1..r.lim loop
      insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
        values ((r.prefix||lpad(i::text,12,'0'))::uuid,r.uid,'vancouver',5,'한도 모임 '||i,'검증용 모임입니다.',current_date,'{"capacity":8}'::jsonb);
    end loop;
    if (public.get_membership()->>'meetupsUsed')::int <> r.lim then
      raise exception 'FAIL % used % expected %', r.tier, public.get_membership()->>'meetupsUsed', r.lim; end if;
    begin
      insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
        values ((r.prefix||lpad('99',12,'0'))::uuid,r.uid,'vancouver',5,'한도 초과 시도','검증용 모임입니다.',current_date,'{"capacity":8}'::jsonb);
      raise exception 'FAIL % opened a meetup beyond the cap', r.tier;
    exception when others then
      if sqlerrm like '%MEETUP_LIMIT_REACHED%' then raise notice 'PASS % held % meetups, next rejected', r.tier, r.lim;
      else raise; end if;
    end;
  end loop;
end $$;

-- 3. Host closing returns the slot at once.
do $$
declare used int; avail int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','{free}','role','authenticated')::text, true);
  update public.posts set room_preview = room_preview || '{"closed":true}'::jsonb where id='7b000000-0000-0000-0001-000000000001';
  used := (public.get_membership()->>'meetupsUsed')::int; avail := (public.get_membership()->>'meetupSlotsAvailable')::int;
  if used <> 1 or avail <> 1 then raise exception 'FAIL host close used=% avail=%', used, avail; end if;
  raise notice 'PASS host closing a meetup returned the slot at once';
end $$;

-- 4. Approval consumes one slot; leaving frees it immediately with no group lock.
do $$
declare req uuid; used int; avail int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','{leaver}','role','authenticated')::text, true);
  req := public.request_meetup_join('7b000000-0000-0000-0001-000000000002','검증 참여');
  perform set_config('request.jwt.claims', json_build_object('sub','{free}','role','authenticated')::text, true);
  perform public.respond_meetup_request(req,'approved');
  perform set_config('request.jwt.claims', json_build_object('sub','{leaver}','role','authenticated')::text, true);
  used := (public.get_membership()->>'meetupsUsed')::int;
  if used <> 1 then raise exception 'FAIL approved participant used=%', used; end if;
  perform public.leave_meetup('7b000000-0000-0000-0001-000000000002');
  used := (public.get_membership()->>'meetupsUsed')::int; avail := (public.get_membership()->>'meetupSlotsAvailable')::int;
  if used <> 0 or avail <> 2 then raise exception 'FAIL leave used=% avail=%', used, avail; end if;
  if (public.get_membership()->>'meetupSlotsLocked')::int <> 0 then raise exception 'FAIL leaving locked a group slot'; end if;
  raise notice 'PASS approval used one slot and leaving freed it at once with no 24h group lock';
end $$;

-- 5. Three leaves in 24h block new joins for 12h without eating slot capacity.
do $$
declare pid uuid; req uuid;
begin
  foreach pid in array array['7b000000-0000-0000-0002-000000000001'::uuid,'7b000000-0000-0000-0002-000000000002'::uuid] loop
    delete from private.action_rate_events where user_id='{leaver}';
    perform set_config('request.jwt.claims', json_build_object('sub','{leaver}','role','authenticated')::text, true);
    req := public.request_meetup_join(pid,'검증 참여');
    perform set_config('request.jwt.claims', json_build_object('sub','{plus}','role','authenticated')::text, true);
    perform public.respond_meetup_request(req,'approved');
    perform set_config('request.jwt.claims', json_build_object('sub','{leaver}','role','authenticated')::text, true);
    perform public.leave_meetup(pid);
  end loop;
  if (public.get_membership()->>'meetupsUsed')::int <> 0 then raise exception 'FAIL repeated leaves left used=%', public.get_membership()->>'meetupsUsed'; end if;
  if (public.get_membership()->>'meetupSlotsLocked')::int <> 0 or (public.get_membership()->>'meetupSlotsAvailable')::int <> 2 then
    raise exception 'FAIL the join block consumed slot capacity'; end if;
  if not exists (select 1 from private.meetup_activity where user_id='{leaver}'
      and blocked_until between now()+interval '11 hours' and now()+interval '13 hours') then
    raise exception 'FAIL join block window is not about 12 hours'; end if;
  delete from private.action_rate_events where user_id='{leaver}';
  begin
    perform public.request_meetup_join('7b000000-0000-0000-0002-000000000003','네 번째 신청');
    raise exception 'FAIL a fourth join was accepted during the block';
  exception when others then
    if sqlerrm like '%MEETUP_JOIN_RESTRICTED%' then raise notice 'PASS 3 leaves in 24h blocked new joins for 12h while slot capacity stayed intact';
    else raise; end if;
  end;
end $$;

-- 6. A one-off that simply ends frees its slot with no early-close penalty.
do $$
declare used int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','{peer}','role','authenticated')::text, true);
  insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
    values ('7c000000-0000-0000-0000-000000000001','{peer}','vancouver',5,'곧 끝나는 칠링','검증용 칠링입니다.',current_date,
      jsonb_build_object('capacity',4,'eventKind','once','startsAt',now()+interval '1 hour','endsAt',now()+interval '2 hours','timezone','America/Vancouver'));
  if (public.get_membership()->>'meetupsUsed')::int <> 1 then raise exception 'FAIL one-off setup used=%', public.get_membership()->>'meetupsUsed'; end if;
  -- now() stays fixed for the whole transaction, so the schedule is shifted with the validator paused.
  perform set_config('request.jwt.claims','{}',true);
  alter table public.posts disable trigger posts_chilling_event_details;
  update public.posts set room_preview = room_preview || jsonb_build_object('endsAt',now()-interval '1 minute')
    where id='7c000000-0000-0000-0000-000000000001';
  alter table public.posts enable trigger posts_chilling_event_details;
  perform private.expire_chilling_events();
  perform set_config('request.jwt.claims', json_build_object('sub','{peer}','role','authenticated')::text, true);
  used := (public.get_membership()->>'meetupsUsed')::int;
  if used <> 0 then raise exception 'FAIL expiry left used=%', used; end if;
  if (public.get_meetup_policy()->>'closures7d')::int <> 0 then raise exception 'FAIL natural expiry counted as an early close'; end if;
  if (public.get_membership()->>'meetupSlotsAvailable')::int <> 7 then raise exception 'FAIL premium slots not restored after expiry'; end if;
  raise notice 'PASS natural end freed the slot without an early-close penalty';
end $$;

-- 7. One-off hosting is capped at 3 per 24 hours for every tier.
do $$
declare i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','{peer}','role','authenticated')::text, true);
  for i in 2..3 loop
    insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
      values (('7c000000-0000-0000-0000-00000000000'||i)::uuid,'{peer}','vancouver',5,'칠링 '||i,'검증용 칠링입니다.',current_date,
        jsonb_build_object('capacity',4,'eventKind','once','startsAt',now()+i*interval '1 day','endsAt',now()+i*interval '1 day'+interval '2 hours','timezone','America/Vancouver'));
  end loop;
  if (public.get_meetup_policy()->>'creates24h')::int <> 3 then raise exception 'FAIL creates24h=%', public.get_meetup_policy()->>'creates24h'; end if;
  begin
    insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
      values ('7c000000-0000-0000-0000-000000000004','{peer}','vancouver',5,'네 번째 칠링','검증용 칠링입니다.',current_date,
        jsonb_build_object('capacity',4,'eventKind','once','startsAt',now()+interval '4 days','endsAt',now()+interval '4 days'+interval '2 hours','timezone','America/Vancouver'));
    raise exception 'FAIL a fourth one-off in 24h was accepted';
  exception when others then
    if sqlerrm like '%CHILLING_CREATE_LIMIT%' then raise notice 'PASS one-off hosting capped at 3 per 24 hours';
    else raise; end if;
  end;
end $$;

-- 8. Two early closures with approved members block new hosting for 24h.
do $$
declare pid uuid; req uuid;
begin
  foreach pid in array array['7b000000-0000-0000-0002-000000000003'::uuid,'7b000000-0000-0000-0002-000000000004'::uuid] loop
    delete from private.action_rate_events where user_id='{peer}';
    perform set_config('request.jwt.claims', json_build_object('sub','{peer}','role','authenticated')::text, true);
    req := public.request_meetup_join(pid,'조기 해산 검증');
    perform set_config('request.jwt.claims', json_build_object('sub','{plus}','role','authenticated')::text, true);
    perform public.respond_meetup_request(req,'approved');
    perform public.leave_meetup(pid);
  end loop;
  begin
    insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
      values ('7d000000-0000-0000-0000-000000000001','{plus}','vancouver',5,'조기 해산 후 새 모임','검증용 모임입니다.',current_date,'{"capacity":8}'::jsonb);
    raise exception 'FAIL hosting was allowed after two early closures';
  exception when others then
    if sqlerrm like '%MEETUP_HOST_RESTRICTED%' then raise notice 'PASS two early closures blocked new hosting for 24h';
    else raise; end if;
  end;
end $$;

-- 9. The 24h conversation lock stays on the requester only and still reports its release time.
do $$
declare cid uuid; locked int; avail int; unlocks int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','{plus}','role','authenticated')::text, true);
  cid := public.start_conversation('{premium}');
  perform set_config('request.jwt.claims', json_build_object('sub','{premium}','role','authenticated')::text, true);
  perform public.respond_direct_conversation(cid,'accepted');
  perform set_config('request.jwt.claims', json_build_object('sub','{plus}','role','authenticated')::text, true);
  perform public.end_conversation(cid);
  locked := (public.get_membership()->>'conversationSlotsLocked')::int;
  avail := (public.get_membership()->>'conversationSlotsAvailable')::int;
  unlocks := jsonb_array_length(public.get_membership()->'conversationUnlocksAt');
  if locked <> 1 or avail <> 3 or unlocks <> 1 then raise exception 'FAIL requester lock locked=% avail=% unlocks=%', locked, avail, unlocks; end if;
  raise notice 'PASS the requester slot stayed locked for 24h with its release time reported';
  perform set_config('request.jwt.claims', json_build_object('sub','{premium}','role','authenticated')::text, true);
  if (public.get_membership()->>'conversationSlotsLocked')::int <> 0 or (public.get_membership()->>'conversationSlotsAvailable')::int <> 7 then
    raise exception 'FAIL the other side lost a slot'; end if;
  raise notice 'PASS the other side kept all of its conversation slots';
  update private.relationship_cooldowns set unlocks_at = now() - interval '1 second' where user_id='{plus}' and pool='direct';
  perform set_config('request.jwt.claims', json_build_object('sub','{plus}','role','authenticated')::text, true);
  if (public.get_membership()->>'conversationSlotsAvailable')::int <> 4 then raise exception 'FAIL the cooldown did not release'; end if;
  raise notice 'PASS the conversation lock released the slot after 24h';
end $$;

-- 10. Meetup requests are paced to one per 60 seconds and capped at 5 per rolling 24 hours.
do $$
declare i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','{plus}','role','authenticated')::text, true);
  perform public.request_meetup_join('7b000000-0000-0000-0003-000000000001','페이싱 검증');
  begin
    perform public.request_meetup_join('7b000000-0000-0000-0003-000000000002','페이싱 검증');
    raise exception 'FAIL a second meetup request was accepted within 60 seconds';
  exception when others then
    if sqlerrm like '%RATE_LIMITED%' then raise notice 'PASS meetup requests are paced to one per 60 seconds';
    else raise; end if;
  end;
  for i in 2..6 loop
    -- Age the recorded requests past the 60s cooldown but keep them inside the 24h window.
    update private.action_rate_events set created_at = created_at - interval '5 minutes' where user_id='{plus}' and action='meetup_request';
    begin
      perform public.request_meetup_join(('7b000000-0000-0000-0003-'||lpad((i+1)::text,12,'0'))::uuid,'페이싱 검증');
      if i > 5 then raise exception 'FAIL more than five meetup requests were accepted in one day'; end if;
    exception when others then
      if sqlerrm like '%RATE_LIMITED%' then
        if i <= 5 then raise exception 'FAIL the daily allowance blocked request % of 5', i; end if;
        raise notice 'PASS meetup requests are capped at 5 per rolling 24 hours';
      else raise; end if;
    end;
  end loop;
end $$;

-- 11. Admin accounts skip the meetup pacing rules (owner decision 2026-09-22).
do $$
declare admin_claims text := json_build_object('sub','{admin}','role','authenticated','aal','aal2','session_id','7a060000-0000-0000-0000-000000000006','app_metadata',jsonb_build_object('role','admin'))::text;
        i int; pid uuid;
begin
  for i in 4..6 loop
    perform set_config('request.jwt.claims', admin_claims, true);
    pid := ('7b000000-0000-0000-0003-'||lpad(i::text,12,'0'))::uuid;
    perform public.request_meetup_join(pid,'어드민 검증');
    perform set_config('request.jwt.claims', json_build_object('sub','{premium}','role','authenticated')::text, true);
    perform public.respond_meetup_request((select id from public.meetup_requests where post_id=pid and requester_id='{admin}'),'approved');
    perform set_config('request.jwt.claims', admin_claims, true);
    perform public.leave_meetup(pid);
  end loop;
  begin
    perform public.request_meetup_join('7b000000-0000-0000-0003-000000000007','어드민 네 번째 신청');
  exception when others then
    raise exception 'FAIL admin join was throttled: %', sqlerrm;
  end;
  raise notice 'PASS admin joins skip the 60s pacing and the 12h leave block';

  begin
    for i in 1..4 loop
      insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
        values (('7e000000-0000-0000-0000-00000000000'||i)::uuid,'{admin}','vancouver',5,'어드민 칠링 '||i,'검증용 칠링입니다.',current_date,
          jsonb_build_object('capacity',4,'eventKind','once','startsAt',now()+i*interval '1 day','endsAt',now()+i*interval '1 day'+interval '2 hours','timezone','America/Vancouver'));
    end loop;
  exception when others then
    raise exception 'FAIL admin one-off cap still applied: %', sqlerrm;
  end;
  raise notice 'PASS admin is not limited to 3 one-offs per 24 hours';

  begin
    for i in 1..2 loop
      insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
        values (('7e000000-0000-0000-0001-00000000000'||i)::uuid,'{admin}','vancouver',5,'어드민 모임 '||i,'검증용 모임입니다.',current_date,'{"capacity":8}'::jsonb);
    end loop;
    for i in 1..2 loop
      pid := ('7e000000-0000-0000-0001-00000000000'||i)::uuid;
      delete from private.action_rate_events where user_id='{peer}';
      perform set_config('request.jwt.claims', json_build_object('sub','{peer}','role','authenticated')::text, true);
      perform public.request_meetup_join(pid,'조기 해산 검증');
      perform set_config('request.jwt.claims', admin_claims, true);
      perform public.respond_meetup_request((select id from public.meetup_requests where post_id=pid and requester_id='{peer}'),'approved');
      perform public.leave_meetup(pid);
    end loop;
    insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
      values ('7e000000-0000-0000-0001-000000000003','{admin}','vancouver',5,'어드민 조기 해산 후 새 모임','검증용 모임입니다.',current_date,'{"capacity":8}'::jsonb);
  exception when others then
    raise exception 'FAIL admin hosting was blocked: %', sqlerrm;
  end;
  raise notice 'PASS admin hosting is not blocked by two early closures';
end $$;

-- 12. The admin account is unlimited on a free tier: posts, listings, conversations, messages and AI drafts.
do $$
declare admin_claims text := json_build_object('sub','{admin}','role','authenticated','aal','aal2','session_id','7a060000-0000-0000-0000-000000000006','app_metadata',jsonb_build_object('role','admin'))::text;
        i int; cid uuid; peers uuid[] := array['{premium}','{plus}','{peer}','{leaver}']::uuid[];
begin
  perform set_config('request.jwt.claims', admin_claims, true);
  begin
    for i in 1..3 loop
      perform public.create_post('vancouver',1::smallint,'어드민 글 '||i,'오늘의 동네 이야기입니다.','{검증}'::text[],'{}'::text[],null,'story',null);
    end loop;
    for i in 1..6 loop
      perform public.create_post('vancouver',1::smallint,'어드민 구해요 '||i,'검증용 구해요 글입니다.','{검증}'::text[],'{}'::text[],null,'listing',null);
    end loop;
  exception when others then
    raise exception 'FAIL admin hit a post or listing quota: %', sqlerrm;
  end;
  raise notice 'PASS admin posts and listings skip the daily and live quotas';

  begin
    for i in 1..4 loop
      cid := public.start_conversation(peers[i]);
      perform set_config('request.jwt.claims', json_build_object('sub',peers[i],'role','authenticated')::text, true);
      perform public.respond_direct_conversation(cid,'accepted');
      perform set_config('request.jwt.claims', admin_claims, true);
    end loop;
    perform public.send_message(cid,'어드민 연속 발송 1');
    perform public.send_message(cid,'어드민 연속 발송 2');
  exception when others then
    raise exception 'FAIL admin hit a conversation limit: %', sqlerrm;
  end;
  if (public.get_membership()->>'conversationsUsed')::int <> 4 then
    raise exception 'FAIL admin conversation count=%', public.get_membership()->>'conversationsUsed'; end if;
  raise notice 'PASS admin held four conversations and sent messages without pacing on a free tier';

  begin
    for i in 1..6 loop
      perform public.reserve_ai_draft();
    end loop;
  exception when others then
    raise exception 'FAIL admin AI draft cap still applied: %', sqlerrm;
  end;
  raise notice 'PASS admin AI drafts are not capped at five a day';
end $$;

select 'ALL CHECKS PASSED' as result;
rollback;
"""

for name, value in USERS.items():
    SQL = SQL.replace("{" + name + "}", value)

EXPECTED = [
    "PASS tier free holds 2 meetups and 2 conversations",
    "PASS tier plus holds 4 meetups and 4 conversations",
    "PASS tier premium holds 7 meetups and 7 conversations",
    "PASS free held 2 meetups, next rejected",
    "PASS plus held 4 meetups, next rejected",
    "PASS premium held 7 meetups, next rejected",
    "PASS host closing a meetup returned the slot at once",
    "PASS approval used one slot and leaving freed it at once with no 24h group lock",
    "PASS 3 leaves in 24h blocked new joins for 12h while slot capacity stayed intact",
    "PASS natural end freed the slot without an early-close penalty",
    "PASS one-off hosting capped at 3 per 24 hours",
    "PASS two early closures blocked new hosting for 24h",
    "PASS the requester slot stayed locked for 24h with its release time reported",
    "PASS the other side kept all of its conversation slots",
    "PASS the conversation lock released the slot after 24h",
    "PASS meetup requests are paced to one per 60 seconds",
    "PASS meetup requests are capped at 5 per rolling 24 hours",
    "PASS admin joins skip the 60s pacing and the 12h leave block",
    "PASS admin is not limited to 3 one-offs per 24 hours",
    "PASS admin hosting is not blocked by two early closures",
    "PASS admin posts and listings skip the daily and live quotas",
    "PASS admin held four conversations and sent messages without pacing on a free tier",
    "PASS admin AI drafts are not capped at five a day",
    "ALL CHECKS PASSED",
]

result = subprocess.run(
    ["docker", "exec", "-i", "supabase_db_gling", "psql", "-X", "-q", "-U", "postgres", "-d", "postgres",
     "-v", "ON_ERROR_STOP=1", "-A", "-t"],
    input=SQL, text=True, capture_output=True,
)
# psql sends NOTICE lines to stderr, so read both streams.
output = result.stdout + "\n" + result.stderr
lines = [line.removeprefix("NOTICE:  ").strip() for line in output.splitlines()
         if line.startswith("PASS") or "NOTICE:  PASS" in line or line.strip() == "ALL CHECKS PASSED"]
missing = [line for line in EXPECTED if not any(line == found for found in lines)]
if missing or result.returncode != 0:
    raise SystemExit(f"FAILED\nmissing: {missing}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}")
print("\n".join(lines))
