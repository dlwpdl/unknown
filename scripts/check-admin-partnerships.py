"""Real pgTAP rollback checks plus isolated, committed Postgres concurrency probes.

Uses only the running supabase_db_gling container; never resets or commits to its
postgres database. The temporary database contains schema and synthetic fixtures.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'supabase_db_gling'
MIGRATION = ROOT / 'supabase/migrations/20261015190000_admin_partnerships.sql'
TEST = ROOT / 'supabase/tests/admin_partnerships.test.sql'
DETAIL_MIGRATION = ROOT / 'supabase/migrations/20261016043500_creator_profile_details.sql'
DETAIL_TEST = ROOT / 'supabase/tests/creator_profile_details.test.sql'
DEAL_MIGRATION = ROOT / 'supabase/migrations/20261017233000_creator_deal_history.sql'
DEAL_TEST = ROOT / 'supabase/tests/creator_deal_history.test.sql'
ADMIN = 'a1500000-0000-0000-0000-000000000001'
SESSION = 'a1560000-0000-0000-0000-000000000001'
MERCHANT = 'a1520000-0000-0000-0000-000000000001'
CAMPAIGN = 'a1530000-0000-0000-0000-000000000001'
BENEFIT = 'a1550000-0000-0000-0000-000000000001'
CREATOR = 'a1510000-0000-0000-0000-000000000001'
CLAIMS = json.dumps({'sub': ADMIN, 'role': 'authenticated', 'aal': 'aal2',
                     'session_id': SESSION, 'app_metadata': {'role': 'admin'}})
AUTH = f"select set_config('request.jwt.claims','{CLAIMS}',true); set local role authenticated;\n"


def command(args, **kwargs):
    return subprocess.run(['docker', 'exec', '-i', CONTAINER, *args],
                          text=True, capture_output=True, timeout=60, **kwargs)


def psql_args(database):
    return ['psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database,
            '-v', 'ON_ERROR_STOP=1', '-f', '-']


def sql(database, source, check=True):
    result = command(psql_args(database), input=source)
    if check and result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result


def prerequisites(database):
    columns = sql(database, "select attname from pg_attribute where attrelid='private.merchants'::regclass and not attisdropped and attnum>0;").stdout.splitlines()
    source = ''
    # Only the existing prerequisites' table/index DDL is needed. Legacy function
    # patch anchors differ on this local snapshot; never rewrite unrelated RPCs.
    for column, name in (
        ('record_kind', '20261011235500_merchant_record_kind_and_real_estate.sql'),
        ('deleted_at', '20261012010500_admin_merchant_deletion.sql'),
    ):
        if column not in columns:
            source += (ROOT / 'supabase/migrations' / name).read_text().split('create function', 1)[0]
    return source


def race(database, statements, loser):
    def run(statement):
        return sql(database, 'begin;\n' + AUTH + statement + ';\nselect pg_sleep(0.2); commit;', check=False)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, statements))
    assert sum(result.returncode == 0 for result in results) == 1, [r.stdout + r.stderr for r in results]
    assert any(loser in result.stderr for result in results if result.returncode), [r.stderr for r in results]


def blocked_recheck(database, lock, mutation, operation, expected):
    """Observe an actual row-lock wait, mutate in its owner, then release it."""
    process = subprocess.Popen(['docker', 'exec', '-i', CONTAINER, *psql_args(database)],
                               text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    tag = 'partnership_wait_' + uuid.uuid4().hex[:10]
    try:
        process.stdin.write('begin;\n' + lock + ";\n\\echo LOCK_HELD\n")
        process.stdin.flush()
        assert process.stdout.readline().strip() == '1'
        assert process.stdout.readline().strip() == 'LOCK_HELD'
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, database,
                                 f"set application_name='{tag}'; begin;\n" + AUTH + operation + '; commit;', False)
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                waiting = sql(database, f"select exists(select 1 from pg_stat_activity where datname='{database}' and application_name='{tag}' and wait_event_type='Lock');").stdout.strip()
                if waiting == 't':
                    break
                if future.done():
                    raise AssertionError('caller did not wait: ' + future.result().stderr)
                time.sleep(0.04)
            else:
                raise AssertionError('expected actual Postgres row-lock wait')
            process.stdin.write(mutation + ';\ncommit;\n')
            process.stdin.close()
            process.stdin = None
            _, err = process.communicate(timeout=10)
            assert process.returncode == 0, err
            result = future.result(timeout=10)
            if expected is None:
                assert result.returncode == 0, result.stdout + result.stderr
            else:
                assert result.returncode and expected in result.stderr, result.stdout + result.stderr
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def main():
    fixture = TEST.read_text()
    assert fixture.startswith('begin;') and fixture.rstrip().endswith('rollback;')
    migration = MIGRATION.read_text() + '\n' + DETAIL_MIGRATION.read_text() + '\n' + DEAL_MIGRATION.read_text()
    before = sql('postgres', "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'partnership_%';").stdout
    passed = 0
    for test in (fixture, DETAIL_TEST.read_text(), DEAL_TEST.read_text()):
        assert test.startswith('begin;') and test.rstrip().endswith('rollback;')
        result = sql('postgres', 'begin;\n' + prerequisites('postgres') + migration + '\n' + test.removeprefix('begin;'))
        output = result.stdout + result.stderr
        assert not re.search(r'^\s*not ok \d+', output, re.MULTILINE), output
        assert re.search(r'^1\.\.\d+$', output, re.MULTILINE), output
        passed += len(re.findall(r'^\s*ok \d+', output, re.MULTILINE))
    after = sql('postgres', "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'partnership_%';").stdout
    assert before == after, 'rollback changed shared schema'
    assert sql('postgres', f"select exists(select 1 from auth.users where id='{ADMIN}');").stdout.strip() == 'f', 'rollback left fixture data'
    print(f'{passed} pgTAP checks passed; shared database transaction rolled back.', flush=True)

    database = 'gling_partnership_check_' + uuid.uuid4().hex[:12]
    created = False
    probes = []
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
        sql(database, 'begin;\n' + prerequisites(database) + migration + '\ncommit;')
        # No live user, merchant or session data is copied into the schema-only DB.
        setup = fixture.split("select set_config('request.jwt.claims'", 1)[0].removeprefix('begin;').replace('select no_plan();', '')
        sql(database, 'begin;\n' + setup + f"""
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind)
values('{MERCHANT}','Race test business','partnership-test','trial','granted','Fixture consent','business');
""" + AUTH + f"""
select public.save_admin_partnership('creator','{{"id":"{CREATOR}","display_name":"Race Creator One","city_id":"partnership-test","profile_url":"https://example.com/race-one"}}');
select public.save_admin_partnership('creator','{{"id":"a1510000-0000-0000-0000-000000000002","display_name":"Race Creator Two","city_id":"partnership-test","profile_url":"https://example.com/race-two"}}');
select public.save_admin_partnership('campaign',jsonb_build_object('id','{CAMPAIGN}','merchant_id','{MERCHANT}','title','Race campaign','status','open','terms','Visit','terms_confirmed',true,'ends_on',current_date+10,'team_limit',1));
select public.save_admin_partnership('participation','{{"id":"a1540000-0000-0000-0000-000000000001","campaign_id":"{CAMPAIGN}","creator_id":"{CREATOR}"}}');
select public.save_admin_partnership('participation','{{"id":"a1540000-0000-0000-0000-000000000002","campaign_id":"{CAMPAIGN}","creator_id":"a1510000-0000-0000-0000-000000000002"}}');
select public.save_admin_partnership('benefit',jsonb_build_object('id','{BENEFIT}','merchant_id','{MERCHANT}','title','Race benefit','audience','members','status','active','terms','Once','terms_confirmed',true,'expires_on',current_date+10,'issue_limit',1));
commit;
""")
        participations = sql(database, 'select id,updated_at from private.partnership_participations order by id;').stdout.splitlines()
        select_calls = [f"select public.save_admin_partnership('participation','{{\"id\":\"{rid}\",\"stage\":\"selected\"}}','{stamp}')" for rid, stamp in (line.split('|') for line in participations)]
        race(database, select_calls, 'PARTNERSHIP_CAPACITY')
        assert sql(database, "select count(*) from private.partnership_participations where stage='selected';").stdout.strip() == '1'
        probes.append('concurrent last-team selection')
        issue_calls = [f"select public.issue_admin_benefit_coupon('a1570000-0000-0000-0000-00000000000{i}','{BENEFIT}',null,'a1500000-0000-0000-0000-00000000000{i+1}')" for i in (1, 2)]
        race(database, issue_calls, 'PARTNERSHIP_CAPACITY')
        assert sql(database, 'select count(*) from private.partnership_coupons;').stdout.strip() == '1'
        probes.append('concurrent last-coupon issuance')
        coupon, stamp = sql(database, 'select id,updated_at from private.partnership_coupons;').stdout.strip().split('|')
        redeem = f"select public.act_admin_benefit_coupon('{coupon}','{stamp}','redeem','Race verified')"
        race(database, [redeem, redeem], 'PARTNERSHIP_CHANGED')
        assert sql(database, "select count(*) from private.partnership_events where action='coupon_redeemed';").stdout.strip() == '1'
        probes.append('concurrent double redemption')
        revision = sql(database, f"select updated_at from private.partnership_creators where id='{CREATOR}';").stdout.strip()
        save = f"select public.save_admin_partnership('creator','{{\"id\":\"{CREATOR}\",\"notes\":\"Race edit\"}}','{revision}')"
        race(database, [save, save], 'PARTNERSHIP_CHANGED')
        probes.append('concurrent stale editor revision')
        deal_id = 'a1580000-0000-0000-0000-000000000001'
        deal = json.dumps({'id': deal_id, 'creator_id': CREATOR, 'merchant_id': MERCHANT, 'agreed_on': '2026-10-01', 'currency': 'CAD', 'ad_fee_cents': 0, 'meal_support_cents': 15000, 'deliverables': 'One Reel', 'source_url': '', 'notes': 'Confirmed fixture agreement'})
        append_deal = f"select public.record_admin_creator_deal('{deal}'::jsonb)"
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: sql(database, 'begin;\n' + AUTH + append_deal + '; commit;', False), range(2)))
        assert all(result.returncode == 0 for result in results), [result.stderr for result in results]
        assert sql(database, f"select count(*) from private.creator_deals where id='{deal_id}';").stdout.strip() == '1'
        assert sql(database, f"select count(*) from private.partnership_events where resource_id='{deal_id}' and action='creator_deal_recorded';").stdout.strip() == '1'
        probes.append('concurrent identical agreement retry creates one row and audit event')
        # The auth cascade must finish while an inactive recipient's revoke waits.
        recipient = 'a1500000-0000-0000-0000-000000000004'
        erasure_benefit = 'a1550000-0000-0000-0000-000000000002'
        erasure_coupon = 'a1570000-0000-0000-0000-000000000004'
        sql(database, f"""begin;
insert into auth.users(id,email) values('{recipient}','race-erasure@example.test');
insert into public.profiles(id,nickname,city_id) values('{recipient}','Race Erasure','partnership-test');
""" + AUTH + f"""
select public.save_admin_partnership('benefit',jsonb_build_object('id','{erasure_benefit}','merchant_id','{MERCHANT}','title','Erasure race','audience','members','status','active','terms','Once','terms_confirmed',true,'expires_on',current_date+10));
select public.issue_admin_benefit_coupon('{erasure_coupon}','{erasure_benefit}',null,'{recipient}');
commit;
""")
        sql(database, f"update public.profiles set account_status='deleted' where id='{recipient}';")
        erasure_revision = sql(database, f"select updated_at from private.partnership_coupons where id='{erasure_coupon}';").stdout.strip()
        blocked_recheck(database, f"select 1 from auth.users where id='{recipient}' for update",
                        f"delete from auth.users where id='{recipient}'",
                        f"select public.act_admin_benefit_coupon('{erasure_coupon}','{erasure_revision}','revoke','Inactive recipient erased')", None)
        assert sql(database, f"select count(*) from auth.users where id='{recipient}';").stdout.strip() == '0'
        assert sql(database, f"select count(*) from public.profiles where id='{recipient}';").stdout.strip() == '0'
        assert sql(database, f"select status from private.partnership_coupons where id='{erasure_coupon}';").stdout.strip() == 'revoked'
        assert sql(database, f"select count(*) from private.partnership_events where resource_id='{erasure_coupon}' and action='coupon_revoked';").stdout.strip() == '1'
        probes.append('hard auth-user deletion versus inactive-recipient coupon revocation')
        # Block on the first actor lock, then revoke each authorization source.
        actor_lock = f"select 1 from auth.users where id='{ADMIN}' for update"
        read = "select public.get_admin_partnerships('creators')"
        for name, mutation, restore in (
            ('role revocation during lock wait', f"update auth.users set raw_app_meta_data='{{}}' where id='{ADMIN}'", f"update auth.users set raw_app_meta_data='{{\"role\":\"admin\"}}' where id='{ADMIN}'"),
            ('profile deactivation during lock wait', f"update public.profiles set account_status='deleted' where id='{ADMIN}'", f"update public.profiles set account_status='active' where id='{ADMIN}'"),
            ('session deletion during lock wait', f"delete from auth.sessions where id='{SESSION}'", f"insert into auth.sessions(id,user_id,aal) values('{SESSION}','{ADMIN}','aal2')"),
        ):
            blocked_recheck(database, actor_lock, mutation, read, 'ADMIN_REQUIRED')
            sql(database, restore)
            probes.append(name)
        rid, revision = sql(database, "select id,updated_at from private.partnership_participations where stage='applied';").stdout.strip().split('|')
        select_call = f"select public.save_admin_partnership('participation','{{\"id\":\"{rid}\",\"stage\":\"selected\"}}','{revision}')"
        blocked_recheck(database, f"select 1 from private.merchants where id='{MERCHANT}' for update",
                        f"update private.merchants set consent='revoked' where id='{MERCHANT}'", select_call, 'PARTNERSHIP_INACTIVE')
        sql(database, f"update private.merchants set consent='granted' where id='{MERCHANT}';")
        probes.append('merchant consent revocation during lock wait')
        # Wall-clock expiration must still win when now() was fixed before the wait.
        sql(database, f"update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='{SESSION}';")
        blocked_recheck(database, f"select 1 from private.partnership_campaigns where id='{CAMPAIGN}' for update",
                        "select pg_sleep(2.1)", select_call, 'ADMIN_REQUIRED')
        probes.append('session wall-clock expiry during resource lock wait')
        sql(database, f"update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='{SESSION}';")
        blocked_recheck(database, f"select 1 from private.partnership_creators where id='{CREATOR}' for update",
                        "select pg_sleep(2.1)", append_deal, 'ADMIN_REQUIRED')
        probes.append('agreement retry rechecks session expiry after creator lock wait')
        print(f'{len(probes)} committed concurrency/recheck probes passed in isolated schema-only database.', flush=True)
        for probe in probes:
            print('  PASS ' + probe)
    finally:
        if created:
            dropped = command(['dropdb', '-U', 'supabase_admin', '--force', database])
            assert dropped.returncode == 0, dropped.stderr
            print('Temporary database dropped; shared schema and fixture rows rolled back.', flush=True)


if __name__ == '__main__':
    main()
