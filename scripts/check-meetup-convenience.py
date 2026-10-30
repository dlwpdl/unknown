"""Meetup convenience pgTAP in a disposable, network-less container; the local source DB is only read (schema dump)."""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-meetup-convenience-check-' + uuid.uuid4().hex[:12]
DATABASE = 'meetup_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATION = '20261029110000_meetup_convenience.sql'


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=300)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                    '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], source, check)


def source_sql(query):
    return command(['docker', 'exec', SOURCE, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-c', query]).stdout


try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    applied = set(source_sql('select version from supabase_migrations.schema_migrations').split())
    roles = source_sql("select rolname from pg_roles where rolname !~ '^pg_';").splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=meetup-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(160):
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
        "create or replace function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid=id returning true $$;"
        "create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;")
    # The local DB can lag behind the repo; catch it up first. Unrelated failures are reported, not fatal.
    skipped = []
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] in applied or path.name >= MIGRATION:
            continue
        if sql(path.read_text(), False).returncode:
            skipped.append(path.name)
    sql((ROOT / 'supabase/migrations' / MIGRATION).read_text())
    # Production applies migrations as postgres; objects created here by supabase_admin would otherwise
    # hit privilege errors that production never sees.
    sql("""do $$ declare r record; begin
      for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where nspname in ('public','private') and c.relowner='supabase_admin'::regrole and c.relkind in ('r','v','m','p') loop
        execute format('alter table %s owner to postgres', r.t); end loop;
      for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where nspname in ('public','private') and p.proowner='supabase_admin'::regrole and p.prokind='f' loop
        execute format('alter function %s owner to postgres', r.f); end loop; end $$;""")
    jobs = sql("select string_agg(jobname, ',' order by jobname) from cron.job where jobname like 'gling-meetup-%';").stdout.strip()
    assert 'gling-meetup-convenience' in jobs and 'gling-meetup-tidy' in jobs, jobs
    result = sql((ROOT / 'supabase/tests/meetup_convenience.test.sql').read_text(), False)
    output = result.stdout + result.stderr
    assert result.returncode == 0, output[-10000:]
    assert not re.search(r'^\s*not ok \d+', output, re.M), output
    assert re.search(r'^1\.\.\d+$', output, re.M), output
    assert sql("select count(*) from public.profiles where id::text like 'c0000000-%';").stdout.strip() == '0', 'fixture did not roll back'
    print(json.dumps({'pgTapPassed': len(re.findall(r'^\s*ok \d+', output, re.M)), 'rollbackVerified': True,
                      'catchUpMigrationsSkipped': skipped, 'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
