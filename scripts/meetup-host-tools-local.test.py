"""Exercise real PostgreSQL in a schema-only disposable DB; never write shared data."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'supabase_db_gling'
POST = 'a1620000-0000-0000-0000-000000000001'
HOST = 'a1610000-0000-0000-0000-000000000001'
MEMBER = 'a1610000-0000-0000-0000-000000000002'


def auth(user):
    return "select set_config('request.jwt.claims','" + json.dumps({'sub': user, 'role': 'authenticated'}) + "',true); set local role authenticated;\n"


def command(args, source=None):
    return subprocess.run(['docker', 'exec', '-i', CONTAINER, *args], input=source,
                          text=True, capture_output=True)


def sql(database, source, check=True):
    result = command(['psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database,
                      '-v', 'ON_ERROR_STOP=1'], source)
    if check and result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result


def concurrent(database, user, statements):
    def run(statement):
        return sql(database, 'begin;\n' + auth(user) + statement + ';select pg_sleep(0.15);commit;', check=False)
    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(run, statements))


def blocked_recheck(database, mutation, user, operation, error):
    """Observe a real advisory-lock wait, commit revocation, then check the waiter."""
    blocker = subprocess.Popen(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt',
                                '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'],
                               text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    tag = 'host_tools_wait_' + uuid.uuid4().hex[:8]
    try:
        blocker.stdin.write("begin;select private.lock_relationships();select 'locked';\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != 'locked':
            assert blocker.poll() is None, 'blocking connection exited before acquiring the guard'
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, database, f"begin;set application_name='{tag}';\n" + auth(user) + operation + ';commit;', False)
            waiting = False
            for _ in range(80):
                waiting = sql(database, f"select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='{tag}' and wait_event='advisory');").stdout.strip() == 't'
                if waiting:
                    break
                time.sleep(0.03)
            assert waiting, 'operation never reached the shared relationship guard'
            blocker.stdin.write(mutation + ';commit;\n')
            blocker.stdin.close()
            blocker.wait(timeout=10)
            assert not blocker.returncode, blocker.stderr.read()
            result = future.result(timeout=10)
            assert result.returncode and error in result.stderr, result.stdout + result.stderr
    finally:
        if blocker.poll() is None:
            blocker.kill()
        blocker.wait(timeout=10)


def concurrency_checks(database, fixture):
    setup = fixture.split("select set_config('request.jwt.claims'", 1)[0].removeprefix('begin;').replace('select no_plan();', '')
    setup = '\n'.join(line for line in setup.splitlines() if not line.startswith('select is((private.membership_details'))
    sql(database, 'begin;\n' + setup + '\ncommit;')
    first = f"select public.confirm_meetup_occurrence('{POST}','2031-01-01T18:00:00Z','2031-01-01T19:00:00Z')"
    results = concurrent(database, HOST, [first, first])
    assert all(not r.returncode for r in results), [r.stderr for r in results]
    ids = [re.findall(r'^[0-9a-f-]{36}$', r.stdout, re.M)[0] for r in results]
    assert ids[0] == ids[1], ids
    assert sql(database, f"select count(*) from private.meetup_sessions where post_id='{POST}';").stdout.strip() == '1'
    sql(database, f"delete from private.action_rate_events where user_id='{HOST}' and action='meetup_session';")
    results = concurrent(database, HOST, [
        f"select public.confirm_meetup_occurrence('{POST}','2031-01-08T18:00:00Z','2031-01-08T19:00:00Z')",
        f"select public.confirm_meetup_occurrence('{POST}','2031-01-08T18:30:00Z','2031-01-08T19:30:00Z')",
    ])
    assert sum(not r.returncode for r in results) == 1, [r.stdout + r.stderr for r in results]
    assert any('SESSION_OVERLAP' in r.stderr for r in results), [r.stderr for r in results]
    waiter = 'a1610000-0000-0000-0000-000000000004'
    sql(database, 'begin;' + auth(waiter) + f"select public.set_meetup_waitlist('{POST}',true);commit;")
    invite = f"select public.invite_next_meetup_waitlist('{POST}')"
    results = concurrent(database, HOST, [invite, invite])
    assert all(not r.returncode for r in results), [r.stderr for r in results]
    assert sorted(re.findall(r'^[tf]$', ''.join(r.stdout for r in results), re.M)) == ['f', 't']
    assert sql(database, f"select count(*) from public.notifications where user_id='{waiter}' and target_id='{POST}';").stdout.strip() == '1'
    assert sql(database, f"select count(*) from public.meetup_requests where post_id='{POST}' and status='approved';").stdout.strip() == '1'

    sql(database, 'begin;' + auth(HOST) + f"select public.invite_meetup_cohost('{POST}','{MEMBER}');commit;")
    accept = f"select public.respond_meetup_cohost('{POST}',true)"
    results = concurrent(database, MEMBER, [accept, accept])
    assert all(not r.returncode for r in results), [r.stderr for r in results]
    assert sql(database, f"select count(*) from private.meetup_cohosts where post_id='{POST}' and status='accepted';").stdout.strip() == '1'
    blocked_recheck(database,
                    f"update public.meetup_requests set status='cancelled' where post_id='{POST}' and requester_id='{MEMBER}'",
                    MEMBER, f"select public.confirm_meetup_occurrence('{POST}','2031-02-01T18:00:00Z','2031-02-01T19:00:00Z')", 'HOST_REQUIRED')
    assert sql(database, f"select status from private.meetup_cohosts where post_id='{POST}' and user_id='{MEMBER}';").stdout.strip() == 'revoked'
    sql(database, f"update public.posts set room_preview=room_preview||'{{\"capacity\":2}}' where id='{POST}';")
    blocked_recheck(database,
                    f"update public.meetup_requests set status='approved' where post_id='{POST}' and requester_id='{MEMBER}'",
                    HOST, invite, 'MEETUP_FULL')
    blocked_recheck(database,
                    f"update private.membership_accounts set entitlements='[]' where user_id='{HOST}'",
                    HOST, f"select public.confirm_meetup_occurrence('{POST}','2031-03-01T18:00:00Z','2031-03-01T19:00:00Z')", 'PRO_REQUIRED')
    # Commit a valid short-lived synthetic event, then observe actual expiry in a new transaction.
    expired = 'a1620000-0000-0000-0000-000000000009'
    sql(database, f"""insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('{expired}','a1610000-0000-0000-0000-000000000003','host-tools-test',31999,'Local expiry','Synthetic event',current_date,
jsonb_build_object('eventKind','once','capacity',3,'startsAt',clock_timestamp()-interval '1 hour',
'endsAt',clock_timestamp()+interval '0.5 seconds','timezone','America/Vancouver'));""")
    time.sleep(0.7)
    result = sql(database, 'begin;' + auth(waiter) + f"select public.set_meetup_waitlist('{expired}',true);commit;", check=False)
    assert result.returncode and 'MEETUP_EXPIRED' in result.stderr, result.stdout + result.stderr
    crossing = 'a1620000-0000-0000-0000-000000000010'
    sql(database, f"""insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('{crossing}','a1610000-0000-0000-0000-000000000003','host-tools-test',31999,'Local lock expiry','Synthetic event',current_date,
jsonb_build_object('eventKind','once','capacity',3,'startsAt',clock_timestamp()-interval '1 hour',
'endsAt',clock_timestamp()+interval '2 minutes','timezone','America/Vancouver'));""")
    blocked_recheck(database,
                    f"update public.posts set room_preview=room_preview||jsonb_build_object('endsAt',clock_timestamp()+interval '0.05 seconds') where id='{crossing}';select pg_sleep(0.1)",
                    waiter, f"select public.set_meetup_waitlist('{crossing}',true)", 'MEETUP_EXPIRED')
    print('9 real concurrency/expiry probes passed: idempotency, overlap, invite-once/no-seat, acceptance, departure, capacity, downgrade, natural expiry, expiry during lock wait.')


def main():
    database = 'meetup_host_tools_' + uuid.uuid4().hex[:12]
    created = False
    try:
        dump = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                        '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron',
                        '--exclude-extension=pg_net', '--exclude-schema=cron', '--exclude-schema=net'])
        assert not dump.returncode, dump.stderr
        result = command(['createdb', '-U', 'supabase_admin', '--template=template0', database])
        assert not result.returncode, result.stderr
        created = True
        sql(database, dump.stdout)
        for signature, filename in [
            ('public.create_meetup_session(uuid,timestamptz,timestamptz)', '20261011082000_meetup_attendance.sql'),
        ]:
            if sql(database, f"select to_regprocedure('{signature}') is not null;").stdout.strip() != 't':
                sql(database, (ROOT / 'supabase/migrations' / filename).read_text())
        # The local shared snapshot predates the four-tier general/business split.
        # Load only the current, unmodified entitlement helpers into this disposable DB.
        membership = (ROOT / 'supabase/migrations/0149_membership_four_tiers.sql').read_text()
        for name in ['membership_entitlement', 'membership_details']:
            source = re.search(r'create (?:or replace )?function private\.' + name + r'\(.*?\$\$;', membership, re.S).group()
            sql(database, source.replace('create function', 'create or replace function', 1))
        migration = ROOT / 'supabase/migrations/20261019050100_meetup_host_tools.sql'
        if migration.exists():
            sql(database, migration.read_text())
        test_source = (ROOT / 'supabase/tests/meetup_host_tools.test.sql').read_text()
        result = sql(database, test_source)
        assert not re.search(r'^not ok\b', result.stdout, re.M), result.stdout
        print(result.stdout.strip())
        concurrency_checks(database, test_source)
        print(json.dumps({'database': database, 'schemaOnly': True, 'rollbackTests': True}))
    finally:
        if created:
            result = command(['dropdb', '-U', 'supabase_admin', '--force', database])
            assert not result.returncode, result.stderr
            print('Disposable database dropped; no shared fixtures or migration writes.')


if __name__ == '__main__':
    main()
