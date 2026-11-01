"""Must-read meetup notices (20261031090000) on top of the pinned-notice migration, in a temporary
schema-only copy of the local supabase_db_gling database that is dropped afterwards; never hosted SQL."""
from pathlib import Path
import json
import runpy
import uuid

ROOT = Path(__file__).resolve().parents[1]
base = runpy.run_path(str(ROOT / 'scripts/check-host-loyalty.py'))
command, sql, value, fails, as_user, auth = (base[name] for name in ('command', 'sql', 'value', 'fails', 'as_user', 'auth'))
H, A, B, C = (base[name] for name in ('H', 'A', 'B', 'C'))
GROUP = base['GROUP']
PINNED = ROOT / 'supabase/migrations/20261030230000_meetup_pinned_notices.sql'
BOARD = ROOT / 'supabase/migrations/20261031090000_meetup_notice_board.sql'


def state(database, user):
    return json.loads(value(database, f"begin; select {auth(user)}; set local role authenticated; select public.get_meetup_loyalty('{GROUP}'); commit;").splitlines()[-1])


def bodies(database, user):
    return [item['body'] for item in state(database, user)['pinnedNotices']]


def scenario(database):
    sql(database, PINNED.read_text())
    sql(database, BOARD.read_text())
    assert value(database, "select prosecdef and 'search_path=\"\"'=any(proconfig) from pg_proc where oid='public.get_meetup_loyalty(uuid)'::regprocedure") == 't'
    assert value(database, "select prosecdef and 'search_path=\"\"'=any(proconfig) from pg_proc where oid='public.update_meetup_announcement(uuid,text)'::regprocedure") == 't'
    assert value(database, "select has_function_privilege('anon','public.update_meetup_announcement(uuid,text)','execute')") == 'f'
    assert value(database, "select count(*) from private.behavior_targets where id in ('sheet.close','meetup.home.primary','meetup.notice.compose-must-read.on','meetup.notice.compose-must-read.off')") == '4'
    assert state(database, A)['noticeBoard'] is True and state(database, A)['pinnedNotices'] == []

    sql(database, f"""insert into private.meetup_announcements(post_id,host_id,body,audience,send_at,sent_at)
      select '{GROUP}','{H}','공지 '||n,'members',now()-make_interval(days=>n),now()-make_interval(days=>n) from generate_series(1,6)n;
      insert into private.meetup_announcements(post_id,host_id,body,audience,send_at,sent_at)
      values('{GROUP}','{H}','3주 전 공지','members',now()-interval '21 days',now()-interval '21 days'),
            ('{GROUP}','{H}','대기 명단 공지','waitlist',now()-interval '1 hour',now()-interval '1 hour');""")
    ids = dict(line.split('|') for line in value(database, f"select body||'|'||id from private.meetup_announcements where post_id='{GROUP}'").splitlines())
    update = lambda user, name, action: f"select public.update_meetup_announcement('{ids[name]}','{action}')"

    # Newest five ordinary notices, nothing older than 14 days; new items say mustRead, old fields stay.
    assert bodies(database, A) == ['공지 1', '공지 2', '공지 3', '공지 4', '공지 5']
    assert set(state(database, A)['pinnedNotices'][0]) == {'id', 'body', 'sentAt', 'mustRead'}

    # Must-read rises to the top, and 'pinned' (what older apps read) follows it.
    as_user(database, H, update(H, '공지 3', 'must_read'))
    assert bodies(database, A)[0] == '공지 3' and state(database, A)['pinned']['body'] == '공지 3'
    assert state(database, A)['pinnedNotices'][0]['mustRead'] is True and state(database, A)['pinnedNotices'][1]['mustRead'] is False

    # Only the host: members, other accounts and waitlist-only notices cannot be raised.
    for user in (A, B, C):
        fails(database, user, update(user, '공지 1', 'must_read'), 'ANNOUNCEMENT_NOT_FOUND')
    fails(database, H, update(H, '대기 명단 공지', 'must_read'), 'ANNOUNCEMENT_NOT_FOUND')
    fails(database, H, update(H, '공지 1', 'nonsense'), 'INVALID_ACTION')

    # At most three, so an ordinary notice always has room. A must-read older than 14 days stays.
    as_user(database, H, update(H, '3주 전 공지', 'must_read'))
    as_user(database, H, update(H, '공지 6', 'must_read'))
    fails(database, H, update(H, '공지 1', 'must_read'), 'MUST_READ_LIMIT')
    assert bodies(database, A) == ['공지 3', '공지 6', '3주 전 공지', '공지 1', '공지 2']

    # Turning it off lets the 14-day rule apply again; taking one down clears it and frees the seat.
    as_user(database, H, update(H, '3주 전 공지', 'must_read_off'))
    assert '3주 전 공지' not in bodies(database, A)
    as_user(database, H, update(H, '공지 6', 'unpin'))
    assert value(database, f"select must_read from private.meetup_announcements where id='{ids['공지 6']}'") == 'f'
    as_user(database, H, update(H, '공지 1', 'must_read'))
    assert bodies(database, A)[:2] == ['공지 1', '공지 3']

    # A person outside the meetup sees none of it.
    assert state(database, C)['pinnedNotices'] == []


def main():
    database = 'notice_board_' + uuid.uuid4().hex[:10]
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
        print('meetup notice board checks passed')
    finally:
        if created:
            command(['dropdb', '-U', 'supabase_admin', '--if-exists', database])


if __name__ == '__main__':
    main()
