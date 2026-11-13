"""Meetup host quest pgTAP + concurrency checks in a disposable, network-less container.

The local `supabase_db_gling` database is only read (schema dump); migrations it has not applied yet are replayed in
the container, then the quest tests run. Usage: python3 scripts/check-host-quests.py [extra.test.sql ...]
Extra test files run after the repo tests; their `# ...` diag lines are printed under "notes".
"""
from pathlib import Path
import json
import re
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-host-quest-check-' + uuid.uuid4().hex[:12]
DATABASE = 'host_quest_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
TESTS = ['supabase/tests/invite_rewards.test.sql', 'supabase/tests/host_quests.test.sql', 'supabase/tests/host_quests_guards.test.sql']
EXTRA = [Path(path).resolve() for path in sys.argv[1:]]


def command(args, source=None, check=True, timeout=300):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                    '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], source, check)


def source_query(query):
    return command(['docker', 'exec', SOURCE, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-c', query]).stdout


def as_admin_call(call, sleep=1.0):
    """One committed transaction as the fixture admin that holds its row locks for `sleep` seconds."""
    return sql(f"""begin;
select set_config('request.jwt.claims','{{"sub":"ac000000-0000-4000-8000-000000000009","role":"authenticated","session_id":"ac900000-0000-4000-8000-000000000009","aal":"aal2","app_metadata":{{"role":"admin"}}}}',true);
set local role authenticated;
{call}
select pg_sleep({sleep});
commit;""", False)


def as_member_call(member, call, sleep=1.0):
    return sql(f"""begin;
select set_config('request.jwt.claims','{{"sub":"ac000000-0000-4000-8000-00000000000{member}","role":"authenticated","session_id":"ac900000-0000-4000-8000-00000000000{member}"}}',true);
set local role authenticated;
{call}
select pg_sleep({sleep});
commit;""", False)


def race(first, second):
    """Run two calls so that the second starts while the first still holds its locks."""
    results = {}
    a = threading.Thread(target=lambda: results.__setitem__('a', first()))
    b = threading.Thread(target=lambda: results.__setitem__('b', second()))
    a.start(); time.sleep(0.3); b.start(); a.join(); b.join()
    return results['a'], results['b']


# Committed fixture for the races: one admin, a quest host at $50 with every gate filled, a live meetup with a QR code.
RACE_FIXTURE = r"""
insert into auth.users(id,email,raw_app_meta_data,created_at) select ('ac000000-0000-4000-8000-00000000000'||n)::uuid,
  'race-'||n||'@example.invalid',case when n=9 then '{"role":"admin"}'::jsonb else '{}'::jsonb end,now()-interval '100 days' from generate_series(1,9) n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
  select ('ac000000-0000-4000-8000-00000000000'||n)::uuid,'경합'||n,'vancouver',now(),now(),now(),'test',now()-interval '100 days' from generate_series(1,9) n;
insert into auth.sessions(id,user_id,aal) select ('ac900000-0000-4000-8000-00000000000'||n)::uuid,('ac000000-0000-4000-8000-00000000000'||n)::uuid,
  (case when n=9 then 'aal2' else 'aal1' end)::auth.aal_level from generate_series(1,9) n;
update private.account_security_sessions set device_hash=encode(extensions.digest(session_id::text,'sha256'),'hex') where session_id::text like 'ac900000-%';
insert into private.host_quest_codes(code,recipient_name) values ('RACEAAAA','Race Host'),('RACEBBBB',null);
insert into private.host_quests(id,user_id,code,started_at,ends_at) values
  ('ac300000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001','RACEAAAA',now()-interval '40 days',now()+interval '20 days');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview,created_at) values
  ('ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001','vancouver',1,'경합 시험 모임','시험용 모임 글이에요',current_date,
   '{"eventKind":"group","cadence":"매주","capacity":8}',now()-interval '5 days');
insert into public.meetup_requests(post_id,host_id,requester_id,status) select 'ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001',
  ('ac000000-0000-4000-8000-00000000000'||n)::uuid,'approved' from generate_series(2,4) n;
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at,created_at) values
  ('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001',now()-interval '1 hour',now()+interval '3 hours',now()-interval '2 days');
insert into private.meetup_qr_codes(code,session_id,issued_at) values ('aaaaaaaaaaaaaaaaaaaaaaaa','ac200000-0000-4000-8000-000000000001',now());
insert into private.host_quest_steps(quest_id,step,amount_cents,status,session_ids,person_ids,person_id)
  select 'ac300000-0000-4000-8000-000000000001',x.step,x.amount,'confirmed',array['ac200000-0000-4000-8000-000000000001'::uuid],'{}',null
  from (values (1,100),(2,500),(3,500),(5,1000),(6,400),(7,1500)) x(step,amount);
insert into private.host_quest_steps(quest_id,step,amount_cents,status,person_id)
  select 'ac300000-0000-4000-8000-000000000001',4,100,'confirmed',gen_random_uuid() from generate_series(1,10);
insert into private.host_quest_payouts(quest_id,email,legal_name,email_mark,photo_people) values
  ('ac300000-0000-4000-8000-000000000001','race@example.invalid','Race Host',repeat('e',64),4);
insert into private.host_quest_payout_checks(quest_id,person_id,session_id,answer) values
  ('ac300000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','ac200000-0000-4000-8000-000000000001','yes'),
  ('ac300000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','ac200000-0000-4000-8000-000000000001','yes');
"""

try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    reference = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only',
                         '-t', 'public.tags', '-t', 'public.cities']).stdout
    applied = set(source_query('select version from supabase_migrations.schema_migrations').split())
    roles = source_query("select rolname from pg_roles where rolname !~ '^pg_';").splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=host-quest-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(240):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', DATABASE])
    for role in roles:
        name, literal = role.replace('"', '""'), role.replace("'", "''")
        sql(f'''do $$ begin if not exists(select 1 from pg_roles where rolname='{literal}') then create role "{name}" nologin; end if; end $$;''')
    sql(dump)
    sql(reference)
    # pg_cron and pg_net are excluded from the dump; stubs record schedule calls and never send anything.
    sql("create schema if not exists cron; create table if not exists cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text);"
        "create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) on conflict(jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $$;"
        "create or replace function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid=id returning true $$;"
        "create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;"
        "create table if not exists cron.job_run_details(start_time timestamptz);"
        "create schema if not exists net; create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;")
    # Catch up on migrations the local DB has not applied. Older ones that no longer replay on a newer schema are reported, not hidden.
    skipped = []
    quest = ROOT / 'supabase/migrations/20261113190000_meetup_host_quests.sql'
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] in applied or path == quest:
            continue
        result = sql(path.read_text(), False)
        if result.returncode:
            skipped.append(path.name)
    sql(quest.read_text())
    sql("""do $$ declare r record; begin
      for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where nspname in ('public','private') and c.relowner='supabase_admin'::regrole and c.relkind in ('r','v','m','p') loop
        execute format('alter table %s owner to postgres', r.t); end loop;
      for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where nspname in ('public','private') and p.proowner='supabase_admin'::regrole and p.prokind='f' loop
        execute format('alter function %s owner to postgres', r.f); end loop; end $$;""")
    assert sql("select count(*) from cron.job where jobname in ('host-quests-settle','host-quest-photo-cleanup');").stdout.strip() == '2', 'cron jobs missing'

    report = {'skippedOlderMigrations': skipped, 'tests': {}}
    for test in [ROOT / test for test in TESTS] + EXTRA:
        result = sql(test.read_text(), False)
        test = str(test.relative_to(ROOT)) if test.is_relative_to(ROOT) else str(test)
        output = result.stdout + result.stderr
        assert result.returncode == 0, output[-10000:]
        assert not re.search(r'^\s*not ok \d+', output, re.M), output
        assert re.search(r'^1\.\.\d+$', output, re.M), output
        assert not re.search(r'^\s*ok \d+ # SKIP', output, re.M), output
        report['tests'][test] = len(re.findall(r'^\s*ok \d+\b', output, re.M))
        if test not in TESTS:
            report.setdefault('notes', {})[test] = re.findall(r'^# (.+)$', output, re.M)
    assert sql("select count(*) from auth.users where id::text like 'eb000000-%' or id::text like 'ab000000-%';").stdout.strip() == '0', 'fixtures did not roll back'

    # Races: two admins press "sent" together; two attendees scan one QR code together; two members start with one code together.
    sql(RACE_FIXTURE)
    sent = race(lambda: as_admin_call("select public.settle_admin_host_quest_payout('ac300000-0000-4000-8000-000000000001','sent','1111',true);"),
                lambda: as_admin_call("select public.settle_admin_host_quest_payout('ac300000-0000-4000-8000-000000000001','sent','2222',true);", 0))
    assert sent[0].returncode == 0, sent[0].stderr
    assert 'PAYOUT_ALREADY_SENT' in sent[1].stderr, sent[1].stdout + sent[1].stderr
    assert sql("select count(*)||':'||max(transfer_last4) from private.host_quest_payouts where quest_id='ac300000-0000-4000-8000-000000000001' and status='sent';").stdout.strip() == '1:1111'
    scans = race(lambda: as_member_call(2, "select public.check_in_meetup_qr('ac200000-0000-4000-8000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaa');"),
                 lambda: as_member_call(3, "select public.check_in_meetup_qr('ac200000-0000-4000-8000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaa');", 0))
    assert scans[0].returncode == 0, scans[0].stderr
    assert 'QR_EXPIRED' in scans[1].stderr, scans[1].stdout + scans[1].stderr
    starts = race(lambda: as_member_call(5, "select public.start_host_quest('RACEBBBB',true);"),
                  lambda: as_member_call(6, "select public.start_host_quest('RACEBBBB',true);", 0))
    assert starts[0].returncode == 0, starts[0].stderr
    assert 'QUEST_CODE_NOT_FOUND' in starts[1].stderr, starts[1].stdout + starts[1].stderr
    report['races'] = {'doublePayoutPress': 'one sent, second PAYOUT_ALREADY_SENT', 'sameQrTwoScans': 'one check-in, second QR_EXPIRED',
                       'sameCodeTwoStarts': 'one quest, second QUEST_CODE_NOT_FOUND'}
    report['disposableContainer'] = CONTAINER
    report['sharedDatabaseWrites'] = False
    print(json.dumps(report, ensure_ascii=False, indent=1))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
