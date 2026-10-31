"""Meetup partner benefit, check-in source and experiment metrics: pgTAP in a disposable, network-less container.

The local supabase_db_gling database is only read (schema dump); nothing is written to it or to any hosted database.
The container catches up the repo migrations the local DB lacks, applies this one, and runs the suite inside one
transaction that rolls back.
"""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-meetup-partner-check-' + uuid.uuid4().hex[:12]
DATABASE = 'meetup_partner_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATION = '20261030235900_meetup_partner_benefit.sql'
# Existing suites over meetup attendance; they must keep passing on top of this migration.
REGRESSION = ['meetup_attendance']


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=600)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                    '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], source, check)


def source_sql(query):
    return command(['docker', 'exec', SOURCE, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-c', query]).stdout


def pgtap(name):
    result = sql((ROOT / f'supabase/tests/{name}.test.sql').read_text(), False)
    output = result.stdout + result.stderr
    assert result.returncode == 0, output[-10000:]
    assert not re.search(r'^\s*not ok \d+', output, re.M), output
    assert re.search(r'^1\.\.\d+$', output, re.M), output
    return len(re.findall(r'^\s*ok \d+', output, re.M))


try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    applied = set(source_sql('select version from supabase_migrations.schema_migrations').split())
    roles = source_sql("select rolname from pg_roles where rolname !~ '^pg_';").splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=meetup-partner-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(200):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', DATABASE])
    for role in roles:
        name, literal = role.replace('"', '""'), role.replace("'", "''")
        sql(f'''do $$ begin if not exists(select 1 from pg_roles where rolname='{literal}') then create role "{name}" nologin; end if; end $$;''')
    sql(dump)
    sql("create schema if not exists cron; create table if not exists cron.job(jobid bigserial primary key, jobname text, schedule text, command text);"
        "create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) returning jobid $$;"
        "create or replace function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid=id returning true $$;"
        "create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;")
    # Production applies migrations as postgres.
    owners = """do $$ declare r record; begin
      for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where nspname in ('public','private') and c.relowner='supabase_admin'::regrole and c.relkind in ('r','v','m','p') loop
        execute format('alter table %s owner to postgres', r.t); end loop;
      for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where nspname in ('public','private') and p.proowner='supabase_admin'::regrole and p.prokind='f' loop
        execute format('alter function %s owner to postgres', r.f); end loop; end $$;"""
    # The local DB can lag behind the repo; catch it up first. Unrelated failures are reported, not fatal.
    skipped = []
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] in applied or path.name >= MIGRATION:
            continue
        if sql(path.read_text(), False).returncode:
            skipped.append(path.name)
    sql(owners)
    for needed in ('private.is_operated_character(uuid)', 'private.invite_marks(uuid)', 'public.staff_check_in_meetup(uuid,uuid)'):
        assert sql(f"select to_regprocedure('{needed}') is not null;").stdout.strip() == 't', (needed, skipped)
    sql((ROOT / 'supabase/migrations' / MIGRATION).read_text())
    # Schema-only: the reference cities/tags the regression suites use (no member data).
    reference = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--on-conflict-do-nothing',
                         '--inserts', '-t', 'public.cities', '-t', 'public.tags']).stdout
    sql(reference)
    passed = {'meetup_partner_benefit': pgtap('meetup_partner_benefit')}
    for name in REGRESSION:
        passed[name] = pgtap(name)
    assert sql("select count(*) from public.profiles where id::text like 'a9e00000-%';").stdout.strip() == '0', 'fixture did not roll back'
    print(json.dumps({'pgTapPassed': passed, 'rollbackVerified': True, 'catchUpMigrationsSkipped': skipped,
                      'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}, ensure_ascii=False))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
