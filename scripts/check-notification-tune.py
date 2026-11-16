"""Notification tune pgTAP in a disposable, network-less container; the local source DB is only read (schema dump).

Migrations the local DB has not applied are replayed in the container first (a few older ones that no longer replay on a
newer schema are listed in `skippedOlderMigrations`), then an unknown-kind probe runs, the tune migration is applied,
the probe runs again and must give the same answer, and the pgTAP files run.
Usage: python3 scripts/check-notification-tune.py
"""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-notification-tune-check-' + uuid.uuid4().hex[:12]
DATABASE = 'notification_tune_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
TUNE = ROOT / 'supabase/migrations/20261117000000_notification_tune.sql'
TESTS = ['notification_tune', 'newcomer_welcome', 'notification_overhaul', 'push_notifications', 'account_security_notifications',
         'notification_patina', 'meetup_reminders', 'meetup_notification_extensions', 'live_bubbles', 'weekly_ranking_notifications',
         'festival_notification_concise', 'meetup_convenience', 'message_preview']

# Kinds another branch adds later. Before and after the tune migration they must behave the same: a row, the default
# category and an immediate push (the kind check is dropped inside the rolled-back probe because those kinds are not allowed yet).
PROBE = """begin;
insert into auth.users(id,email) values ('ed000000-0000-4000-8000-000000000001','probe@example.invalid');
insert into public.profiles(id,nickname,city_id) values ('ed000000-0000-4000-8000-000000000001','탐침','vancouver');
insert into auth.sessions(id,user_id,aal) values ('ed100000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001',null);
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at)
  values ('ed000000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ExpoPushToken[probe00000000000]','America/Vancouver',now());
insert into public.notification_preferences(user_id,push_enabled) values ('ed000000-0000-4000-8000-000000000001',true);
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on) values
  ('ed200000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000001','vancouver',1,'탐침 글','본문',current_date);
alter table public.notifications drop constraint notifications_kind_check;
select count(private.create_notification('ed000000-0000-4000-8000-000000000001',k,null,'post','ed200000-0000-4000-8000-000000000001','x','/post/ed200000-0000-4000-8000-000000000001'))
from unnest(array['meetup_poll','meetup_poll_vote','meetup_waiting','meetup_host_transfer','meetup_closed']) k;
select k||'|'||coalesce((select n.category from public.notifications n where n.kind=k),'none')||'|'
  ||(select count(*) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind=k and q.next_attempt_at<=now()+interval '1 second')
from unnest(array['meetup_poll','meetup_poll_vote','meetup_waiting','meetup_host_transfer','meetup_closed']) k;
rollback;
"""


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


OWNERS = """do $$ declare r record; begin
  for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where nspname in ('public','private') and c.relowner='supabase_admin'::regrole and c.relkind in ('r','v','m','p') loop
    execute format('alter table %s owner to postgres', r.t); end loop;
  for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where nspname in ('public','private') and p.proowner='supabase_admin'::regrole and p.prokind='f' loop
    execute format('alter function %s owner to postgres', r.f); end loop; end $$;"""

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
             'POSTGRES_PASSWORD=notification-tune-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
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
    skipped = []
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] in applied or path == TUNE or path.name > TUNE.name:
            continue
        if sql(path.read_text(), False).returncode:
            skipped.append(path.name)
    sql(OWNERS)
    before = sql(PROBE).stdout.strip()
    assert len(before.splitlines()) == 6 and before.splitlines()[0] == '5', before
    sql(TUNE.read_text())
    sql((ROOT / 'supabase/migrations/20261117010000_notification_bc_clock.sql').read_text())
    sql(OWNERS)
    after = sql(PROBE).stdout.strip()
    assert before == after, f'unknown kinds changed:\n{before}\n--- after ---\n{after}'

    report = {'skippedOlderMigrations': skipped, 'unknownKindProbe': before.splitlines(), 'tests': {}}
    for name in TESTS:
        result = sql((ROOT / f'supabase/tests/{name}.test.sql').read_text(), False)
        output = result.stdout + result.stderr
        assert result.returncode == 0, name + '\n' + output[-10000:]
        assert not re.search(r'^\s*not ok \d+', output, re.M), name + '\n' + output[-10000:]
        assert re.search(r'^1\.\.\d+$', output, re.M), name
        assert not re.search(r'^\s*ok \d+ # SKIP', output, re.M), name
        report['tests'][name] = len(re.findall(r'^\s*ok \d+\b', output, re.M))
    assert sql("select count(*) from auth.users where id::text like 'ec000000-%' or id::text like 'ed000000-%' or id::text like 'e0000000-%';").stdout.strip() == '0', 'fixtures did not roll back'
    report['pgTapPassed'] = sum(report['tests'].values())
    report['disposableContainer'] = CONTAINER
    report['sharedDatabaseWrites'] = False
    print(json.dumps(report, ensure_ascii=False, indent=1))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
