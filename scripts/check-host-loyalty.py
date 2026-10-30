"""Host loyalty checks (follow, encore, notices, roster, staff, auto next, badges) in a temporary
schema-only copy of the local supabase_db_gling database; never hosted SQL, never the postgres database."""
from pathlib import Path
import json
import runpy
import uuid

ROOT = Path(__file__).resolve().parents[1]
helper = runpy.run_path(str(ROOT / 'scripts/check-admin-partnerships.py'))
command, sql = helper['command'], helper['sql']
MIGRATION = ROOT / 'supabase/migrations/20261029130000_host_loyalty.sql'
H, A, B, C, D = (f'71910000-0000-4000-8000-{n:012}' for n in range(1, 6))
OLD, NEW, GROUP = (f'71920000-0000-4000-8000-{n:012}' for n in range(1, 4))
ROOM, S_LIVE, S_DONE = (f'71930000-0000-4000-8000-{n:012}' for n in range(1, 4))


def auth(user):
    claims = json.dumps({'sub': user, 'role': 'authenticated'})
    return f"set_config('request.jwt.claims','{claims}',true)"


def as_user(database, user, statement, check=True):
    # Rate limits are existing behaviour; clear them so back-to-back fixture calls are not throttled.
    return sql(database, f"begin; delete from private.action_rate_events; select {auth(user)}; set local role authenticated;\n{statement};\ncommit;", check)


def value(database, statement):
    return sql(database, statement).stdout.strip()


def fails(database, user, statement, code):
    result = as_user(database, user, statement, check=False)
    assert result.returncode and code in result.stderr, (statement, result.stdout + result.stderr)


def setup(database):
    migration = MIGRATION.read_text()
    # The schema-only dump has no pg_cron; the schedules are checked as text below.
    head, cron = migration.split("select cron.unschedule", 1)
    assert "gling-meetup-announcements" in cron and "'* * * * *'" in cron and "gling-meetup-next-session" in cron
    tail = cron.split("$job$);", 2)[-1]
    sql(database, """
-- Fixture stand-ins for things this local snapshot predates or that depend on store receipts.
create table if not exists private.test_tiers(id uuid primary key, tier text);
create or replace function private.meetup_tool_tier(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
  select coalesce((select tier from private.test_tiers where id=p_user_id),'free'); $$;
do $$ begin
  if to_regprocedure('private.newcomer_ends_at(uuid)') is null then
    execute 'create function private.newcomer_ends_at(p_user uuid) returns timestamptz language sql stable set search_path='''' as $f$ select null::timestamptz $f$';
  end if;
end $$;
""" + head + tail)
    users = ','.join(f"('{u}','loyalty-{i}@example.invalid')" for i, u in enumerate((H, A, B, C, D)))
    sql(database, f"""
insert into auth.users(id,email) values {users};
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'멤버'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '71910000-%';
update public.profiles set nickname='호스트' where id='{H}';
-- Past fixtures would fail the live schedule guard; only these fixture rows skip triggers.
begin; set local session_replication_role=replica;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,created_at,room_preview) values
 ('{OLD}','{H}','vancouver',5,'지난 등산','본문',current_date,now()-interval '10 days',
  jsonb_build_object('eventKind','once','startsAt',now()-interval '3 days','endsAt',now()-interval '3 days'+interval '2 hours','closed',true,'capacity',8,'memberCount',3)),
 ('{GROUP}','{H}','vancouver',5,'목요 러닝','본문',current_date,now()-interval '30 days',
  jsonb_build_object('eventKind','group','timezone','America/Vancouver','cadence','매주 목요일','capacity',20,'memberCount',3));
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at) values
 ('{OLD}','{H}','{A}','approved',now()-interval '9 days'),('{GROUP}','{H}','{A}','approved',now()-interval '20 days'),
 ('{GROUP}','{H}','{B}','approved',now()-interval '20 days'),('{GROUP}','{H}','{D}','pending',null);
commit;
insert into public.conversations(id,kind,group_post_id) values('{ROOM}','group','{GROUP}');
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at) values
 ('{S_DONE}','{GROUP}','{H}',now()-interval '8 days',now()-interval '8 days'+interval '2 hours'),
 ('{S_LIVE}','{GROUP}','{H}',now()-interval '30 minutes',now()+interval '90 minutes');
insert into private.meetup_attendance(session_id,user_id,checked_in_at) values
 ('{S_DONE}','{H}',now()-interval '8 days'),('{S_DONE}','{A}',now()-interval '8 days'),('{S_DONE}','{B}',null),
 ('{S_LIVE}','{H}',null),('{S_LIVE}','{A}',null),('{S_LIVE}','{B}',null);
""")


def notices(database, user):
    return value(database, f"select coalesce(string_agg(body,' || ' order by created_at),'') from public.notifications where user_id='{user}' and kind='meetup_changed'")


def scenario(database):
    # Private tables stay closed to app roles.
    for table in ('host_follows', 'meetup_member_notes', 'meetup_announcements', 'meetup_checkin_staff'):
        fails(database, A, f'select * from private.{table}', 'permission denied')

    # Badges: A attended one ended session; B never checked in; H hosted one session someone attended.
    badges = json.loads(value(database, f"begin; select {auth(C)}; set local role authenticated; select public.get_meetup_badges(array['{A}','{B}','{H}']::uuid[]); commit;").splitlines()[-1])
    assert badges[A] == {'attended': 1, 'hosted': 0} and badges[B] == {'attended': 0, 'hosted': 0} and badges[H]['hosted'] == 1, badges

    # Follow (free) and encore (free, only for a participant of an ended meetup).
    as_user(database, C, f"select public.set_meetup_host_follow('{OLD}',true)")
    fails(database, H, f"select public.set_meetup_host_follow('{OLD}',true)", 'CANNOT_FOLLOW_SELF')
    fails(database, C, f"select public.set_meetup_encore('{OLD}',true)", 'PARTICIPANT_REQUIRED')
    fails(database, A, f"select public.set_meetup_encore('{GROUP}',true)", 'ENCORE_NOT_AVAILABLE')
    as_user(database, A, f"select public.set_meetup_encore('{OLD}',true)")
    state = json.loads(value(database, f"begin; select {auth(H)}; set local role authenticated; select public.get_meetup_loyalty('{OLD}'); commit;").splitlines()[-1])
    assert state['followerCount'] == 1 and state['encoreCount'] == 1 and state['isHost'], state

    # A new meetup tells the follower and the encore requester once; a later edit does not repeat it.
    sql(database, f"""insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
      ('{NEW}','{H}','vancouver',5,'다시 등산','본문',current_date,'{{}}'::jsonb);
      update public.posts set room_preview=jsonb_build_object('eventKind','once','startsAt',now()+interval '3 days','endsAt',now()+interval '3 days 2 hours','timezone','America/Vancouver','capacity',8,'memberCount',1) where id='{NEW}';
      update public.posts set room_preview=room_preview||'{{"memberCount":2}}' where id='{NEW}';""")
    assert notices(database, C) == '호스트님이 새 모임을 열었어요. 다시 등산', notices(database, C)
    assert notices(database, A) == '또 열어 달라고 했던 호스트님이 새 모임을 열었어요. 다시 등산', notices(database, A)
    assert value(database, f"select notified_post_id from private.meetup_encores where user_id='{A}'") == NEW

    # Notices: member-wide now is free and lands in the room without a second push; targeting/scheduling is plus.
    as_user(database, H, f"select public.post_meetup_announcement('{GROUP}','내일은 7시에 모여요')")
    assert value(database, f"select body from public.messages where conversation_id='{ROOM}'") == '[공지] 내일은 7시에 모여요'
    assert '「목요 러닝」 공지: 내일은 7시에 모여요' in notices(database, B)
    assert value(database, f"""select count(*) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
      where n.kind='message' and n.target_id=(select id from public.messages where conversation_id='{ROOM}')""") == '0'
    pinned = json.loads(value(database, f"begin; select {auth(B)}; set local role authenticated; select public.get_meetup_loyalty('{GROUP}'); commit;").splitlines()[-1])
    assert pinned['pinned']['body'] == '내일은 7시에 모여요' and 'scheduled' not in pinned and 'followerCount' not in pinned, pinned
    fails(database, H, f"select public.post_meetup_announcement('{GROUP}','대기자분들께','pending')", 'PLUS_REQUIRED')
    fails(database, H, f"select public.post_meetup_announcement('{GROUP}','예약 공지','members',now()+interval '1 day')", 'PLUS_REQUIRED')
    fails(database, A, f"select public.post_meetup_announcement('{GROUP}','멤버가 보내는 공지')", 'HOST_REQUIRED')
    sql(database, f"insert into private.test_tiers values('{H}','plus')")
    # ADR-0001: a targeted notice is queued for the shared safety review and goes out only after a clean result.
    as_user(database, H, f"select public.post_meetup_announcement('{GROUP}','신청하신 분들 확인 중이에요','pending')")
    held = "(select id from private.meetup_announcements where body='신청하신 분들 확인 중이에요')"
    assert value(database, f"select status from public.safety_review_queue where target_type='meetup_announcement' and target_id={held}") == 'pending'
    assert value(database, 'select private.send_due_meetup_announcements()') == '0'
    assert '신청하신 분들' not in notices(database, D)
    content = json.loads(value(database, f"begin; select set_config('request.jwt.claims','{{\"role\":\"service_role\"}}',true); select public.get_meetup_announcement_safety_content({held}); commit;").splitlines()[-1])
    assert content['authorId'] == H and '신청 대기자' in content['text'] and '신청하신 분들' in content['text'], content
    held_id = value(database, f"select {held}")
    fails(database, H, f"select public.get_meetup_announcement_safety_content('{held_id}')", 'permission denied')
    fails(database, H, f"select public.get_admin_meetup_announcement_content('{held_id}')", 'ADMIN_REQUIRED')
    sql(database, f"update public.safety_review_queue set status='reviewed',risk_level='low',risk_score=0.1,reviewed_at=now() where target_type='meetup_announcement' and target_id={held}")
    assert value(database, 'select private.send_due_meetup_announcements()') == '1'
    assert '신청하신 분들' in notices(database, D) and '신청하신 분들' not in notices(database, A)
    # A high-risk review cancels it unsent (cancelled notices do not count toward the daily 3).
    as_user(database, H, f"select public.post_meetup_announcement('{GROUP}','위험 판정 공지','pending')")
    risky = "(select id from private.meetup_announcements where body='위험 판정 공지')"
    sql(database, f"update public.safety_review_queue set status='reviewed',risk_level='high',risk_score=0.9,reviewed_at=now() where target_type='meetup_announcement' and target_id={risky}")
    assert value(database, 'select private.send_due_meetup_announcements()') == '1'
    assert value(database, f"select failed_reason from private.meetup_announcements where id={risky}") == 'SAFETY_BLOCKED'
    assert '위험 판정 공지' not in notices(database, D)
    # A watch-term hit raises the admin alert at insert and blocks delivery even after a clean AI result.
    sql(database, "insert into private.watch_terms(term,category,severity) values('감시테스트어','violence','high') on conflict do nothing")
    as_user(database, H, f"select public.post_meetup_announcement('{GROUP}','감시테스트어 들어간 공지','waitlist')")
    flagged = "(select id from private.meetup_announcements where body='감시테스트어 들어간 공지')"
    assert value(database, f"select author_id from public.safety_alerts where target_type='meetup_announcement' and target_id={flagged}") == H
    sql(database, f"update public.safety_review_queue set status='reviewed',risk_level='low',risk_score=0.1,reviewed_at=now() where target_type='meetup_announcement' and target_id={flagged}")
    sql(database, "select private.send_due_meetup_announcements()")
    assert value(database, f"select failed_reason from private.meetup_announcements where id={flagged}") == 'SAFETY_BLOCKED'
    # Members-only notices stay on the room-message path, not the notice queue.
    assert value(database, "select count(*) from public.safety_review_queue q join private.meetup_announcements a on a.id=q.target_id where q.target_type='meetup_announcement' and a.audience='members'") == '0'
    as_user(database, H, f"select public.post_meetup_announcement('{GROUP}','다음 주 장소 바뀌어요','members',now()+interval '2 hours')")
    fails(database, H, f"select public.post_meetup_announcement('{GROUP}','네 번째')", 'ANNOUNCEMENT_DAILY_LIMIT')
    sql(database, "update private.meetup_announcements set send_at=now()-interval '1 minute' where body='다음 주 장소 바뀌어요'")
    assert value(database, 'select private.send_due_meetup_announcements()') == '1'
    assert '다음 주 장소 바뀌어요' in notices(database, A)
    assert value(database, "select count(*) from public.messages where body='[공지] 다음 주 장소 바뀌어요'") == '1'

    # Roster and staff are pro; notes stay with the host.
    fails(database, H, f"select public.get_meetup_roster('{GROUP}')", 'PRO_REQUIRED')
    sql(database, f"update private.test_tiers set tier='pro' where id='{H}'")
    as_user(database, H, f"select public.set_meetup_member_note('{GROUP}','{A}','늘 일찍 와서 도와줌',true)")
    roster = json.loads(value(database, f"begin; select {auth(H)}; set local role authenticated; select public.get_meetup_roster('{GROUP}'); commit;").splitlines()[-1])
    row = next(item for item in roster if item['userId'] == A)
    assert row['attended'] == 1 and row['note'] == '늘 일찍 와서 도와줌' and row['regular'] is True, roster
    fails(database, A, f"select public.get_meetup_roster('{GROUP}')", 'HOST_REQUIRED')
    fails(database, A, f"select public.set_meetup_member_note('{GROUP}','{B}','메모',false)", 'HOST_REQUIRED')
    assert '늘 일찍' not in value(database, f"begin; select {auth(A)}; set local role authenticated; select public.get_meetup_loyalty('{GROUP}'); commit;")

    fails(database, B, f"select public.staff_check_in_meetup('{S_LIVE}','{A}')", 'STAFF_REQUIRED')
    as_user(database, H, f"select public.set_meetup_checkin_staff('{GROUP}','{A}',true)")
    as_user(database, A, f"select public.staff_check_in_meetup('{S_LIVE}','{B}')")
    assert value(database, f"select checked_in_at is not null from private.meetup_attendance where session_id='{S_LIVE}' and user_id='{B}'") == 't'
    fails(database, A, f"select public.staff_check_in_meetup('{S_LIVE}','{C}')", 'INVALID_ATTENDEE')
    sql(database, f"update public.meetup_requests set status='cancelled' where post_id='{GROUP}' and requester_id='{A}'")
    assert value(database, f"select count(*) from private.meetup_checkin_staff where post_id='{GROUP}'") == '0'
    sql(database, f"update public.meetup_requests set status='approved' where post_id='{GROUP}' and requester_id='{A}'")

    # Auto next: once the latest session ends, the next one opens a week later and members/followers hear once.
    as_user(database, H, f"select public.set_meetup_auto_next('{GROUP}',true,'weekly')")
    sql(database, f"update private.meetup_sessions set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour' where id='{S_LIVE}'")
    sql(database, "delete from private.host_follow_alerts")
    assert value(database, 'select private.open_next_meetup_sessions()') == '1'
    assert value(database, 'select private.open_next_meetup_sessions()') == '0'
    assert value(database, f"select count(*) from private.meetup_sessions where post_id='{GROUP}' and starts_at>now()+interval '6 days'") == '1'
    assert '「목요 러닝」 다음 모임 날짜가 잡혔어요' in notices(database, B) and '다음 모임 날짜' in notices(database, C)

    # Account deletion purge reaches every new table through the existing host-tools hook.
    sql(database, f"select private.purge_meetup_tool_account_data('{A}')")
    assert value(database, f"""select (select count(*) from private.meetup_encores where user_id='{A}')
      +(select count(*) from private.meetup_member_notes where member_id='{A}')""") == '0'


def main():
    database = 'host_loyalty_' + uuid.uuid4().hex[:10]
    created = False
    try:
        dump = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                        '--no-publications', '--no-subscriptions',
                        '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                        '--exclude-schema=cron', '--exclude-schema=net'])
        assert dump.returncode == 0, dump.stderr
        create = command(['createdb', '-U', 'supabase_admin', '--template=template0', database])
        assert create.returncode == 0, create.stderr
        created = True
        sql(database, dump.stdout)
        reference = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '-t', 'public.cities', '-t', 'public.tags'])
        assert reference.returncode == 0, reference.stderr
        sql(database, reference.stdout)
        setup(database)
        scenario(database)
        print('host loyalty checks passed')
    finally:
        if created:
            command(['dropdb', '-U', 'supabase_admin', '--if-exists', database])


if __name__ == '__main__':
    main()
