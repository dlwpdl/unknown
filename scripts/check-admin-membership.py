"""Admin membership grants pgTAP in a disposable, network-less container; the local source DB is only read (schema dump)."""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-admin-membership-check-' + uuid.uuid4().hex[:12]
DATABASE = 'admin_membership_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                    '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], source, check)


try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    roles = command(['docker', 'exec', SOURCE, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres',
                     '-c', "select rolname from pg_roles where rolname !~ '^pg_';"]).stdout.splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=admin-membership-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(120):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', DATABASE])
    for role in roles:
        name, literal = role.replace('"', '""'), role.replace("'", "''")
        sql(f'''do $$ begin if not exists(select 1 from pg_roles where rolname='{literal}') then create role "{name}" nologin; end if; end $$;''')
    sql(dump)
    # pg_cron is excluded from the dump; a stub records the schedule call instead.
    sql("create schema if not exists cron; create table if not exists cron.job(jobid bigserial primary key, jobname text, schedule text, command text);"
        "create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) returning jobid $$;"
        "create or replace function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid=id returning true $$;")
    # The local source DB already carries the business-membership bodies this builds on (its history table lags);
    # only invite rewards and this migration are replayed, as in check-invite-rewards.py.
    replayed = ['20261029120000_invite_rewards.sql', '20261030100000_admin_membership_grants.sql']
    for name in replayed:
        sql((ROOT / 'supabase/migrations' / name).read_text())
    passed = {}
    # The invite reward suite is rerun on top: the new entitlement source must not change its outcomes.
    for test, prefix in (('admin_membership_grants', 'd9700000-'), ('invite_rewards', 'e1000000-')):
        result = sql((ROOT / f'supabase/tests/{test}.test.sql').read_text(), False)
        output = result.stdout + result.stderr
        assert result.returncode == 0, output[-10000:]
        assert not re.search(r'^\s*not ok \d+', output, re.M), output
        assert re.search(r'^1\.\.\d+$', output, re.M), output
        assert sql(f"select count(*) from public.profiles where id::text like '{prefix}%';").stdout.strip() == '0', 'fixture did not roll back'
        passed[test] = len(re.findall(r'^\s*ok \d+', output, re.M))
    print(json.dumps({'pgTapPassed': passed, 'rollbackVerified': True,
                      'replayedMigrations': len(replayed), 'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
