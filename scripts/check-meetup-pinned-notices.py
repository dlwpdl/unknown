"""Several pinned meetup notices (20261030230000) on top of the host-loyalty fixture, in a temporary
schema-only copy of the local supabase_db_gling database that is dropped afterwards; never hosted SQL."""
from pathlib import Path
import json
import runpy
import uuid

ROOT = Path(__file__).resolve().parents[1]
base = runpy.run_path(str(ROOT / 'scripts/check-host-loyalty.py'))
command, sql, value, fails, as_user, auth = (base[name] for name in ('command', 'sql', 'value', 'fails', 'as_user', 'auth'))
H, A, B, C = (base[name] for name in ('H', 'A', 'B', 'C'))
GROUP, ROOM = base['GROUP'], base['ROOM']
MIGRATION = ROOT / 'supabase/migrations/20261030230000_meetup_pinned_notices.sql'


def state(database, user):
    return json.loads(value(database, f"begin; select {auth(user)}; set local role authenticated; select public.get_meetup_loyalty('{GROUP}'); commit;").splitlines()[-1])


def bodies(database, user):
    return [item['body'] for item in state(database, user)['pinnedNotices']]


def scenario(database):
    sql(database, MIGRATION.read_text())
    # The patched function keeps its security definer, fixed search_path and grants.
    assert value(database, "select prosecdef and 'search_path=\"\"'=any(proconfig) from pg_proc where oid='public.get_meetup_loyalty(uuid)'::regprocedure") == 't'
    assert value(database, "select has_function_privilege('anon','public.get_meetup_loyalty(uuid)','execute')") == 'f'
    assert value(database, "select has_function_privilege('authenticated','public.get_meetup_loyalty(uuid)','execute')") == 't'
    # Applying it again must refuse: the guard sees a changed definition instead of patching twice.
    again = sql(database, MIGRATION.read_text(), check=False)
    assert again.returncode and 'MEETUP_LOYALTY_PINNED_CHANGED' in again.stderr, again.stderr

    assert state(database, A)['pinnedNotices'] == [] and state(database, A)['pinned'] is None
    # B is an acting co-host (plus host: 1 co-host seat).
    sql(database, f"""insert into private.test_tiers values('{H}','plus');
      insert into private.meetup_cohosts(post_id,user_id,status,accepted_at) values('{GROUP}','{B}','accepted',now());""")
    assert value(database, f"select private.meetup_tool_cohost('{GROUP}','{B}')") == 't'

    # Several member-wide notices stay pinned together, newest first; 'pinned' is still the newest for older apps.
    for index in range(3):
        as_user(database, H, f"select public.post_meetup_announcement('{GROUP}','공지 {index + 1}')")
    member = state(database, A)
    assert [item['body'] for item in member['pinnedNotices']] == ['공지 3', '공지 2', '공지 1'], member
    assert member['pinned']['id'] == member['pinnedNotices'][0]['id'] and set(member['pinnedNotices'][0]) == {'id', 'body', 'sentAt'}
    assert bodies(database, B) == bodies(database, H) == ['공지 3', '공지 2', '공지 1']

    # Not part of the room: outsiders see nothing; targeted and scheduled notices are not pinned.
    assert state(database, C)['pinnedNotices'] == [] and state(database, C)['pinned'] is None
    as_user(database, H, f"select public.post_meetup_announcement('{GROUP}','내일 예약 공지','members',now()+interval '2 days')")
    assert '내일 예약 공지' not in bodies(database, A)

    # Cap: at most 5 newest within 14 days (older sends moved back so the daily limit of 3 is untouched).
    sql(database, f"""insert into private.meetup_announcements(post_id,host_id,body,audience,send_at,sent_at)
      select '{GROUP}','{H}','지난 공지 '||n,'members',now()-make_interval(days=>n),now()-make_interval(days=>n) from generate_series(1,4)n;
      insert into private.meetup_announcements(post_id,host_id,body,audience,send_at,sent_at)
      values('{GROUP}','{H}','대기 명단 공지','waitlist',now()-interval '1 minute',now()-interval '1 minute'),
            ('{GROUP}','{H}','3주 전 공지','members',now()-interval '21 days',now()-interval '21 days');""")
    assert bodies(database, A) == ['공지 3', '공지 2', '공지 1', '지난 공지 1', '지난 공지 2'], bodies(database, A)

    # Unpin: host only, one at a time; the next newest moves up into the 5.
    newest = state(database, H)['pinnedNotices'][0]['id']
    fails(database, A, f"select public.update_meetup_announcement('{newest}','unpin')", 'ANNOUNCEMENT_NOT_FOUND')
    fails(database, B, f"select public.update_meetup_announcement('{newest}','unpin')", 'ANNOUNCEMENT_NOT_FOUND')
    fails(database, C, f"select public.update_meetup_announcement('{newest}','unpin')", 'ANNOUNCEMENT_NOT_FOUND')
    assert bodies(database, A)[0] == '공지 3'
    as_user(database, H, f"select public.update_meetup_announcement('{newest}','unpin')")
    assert bodies(database, A) == ['공지 2', '공지 1', '지난 공지 1', '지난 공지 2', '지난 공지 3'], bodies(database, A)
    assert state(database, A)['pinned']['body'] == '공지 2'
    # There is no way to pin again or pin someone else's notice; co-hosts and members cannot write notices.
    fails(database, H, f"select public.update_meetup_announcement('{newest}','pin')", 'INVALID_ACTION')
    fails(database, B, f"select public.post_meetup_announcement('{GROUP}','공동 호스트 공지')", 'HOST_REQUIRED')
    fails(database, A, f"select public.post_meetup_announcement('{GROUP}','멤버 공지')", 'HOST_REQUIRED')
    # Members never read the host-only fields through the new list.
    assert 'scheduled' not in state(database, B) and 'scheduled' not in state(database, A)
    # The room still gets each notice as a message.
    assert value(database, f"select count(*) from public.messages where conversation_id='{ROOM}' and body like '[공지] 공지 %'") == '3'


def main():
    database = 'pinned_notices_' + uuid.uuid4().hex[:10]
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
        base['setup'](database)
        scenario(database)
        print('meetup pinned notices checks passed')
    finally:
        if created:
            command(['dropdb', '-U', 'supabase_admin', '--if-exists', database])


if __name__ == '__main__':
    main()
