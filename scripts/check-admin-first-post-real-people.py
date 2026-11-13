"""First-post admin alert + real-people numbers: pgTAP in a disposable, network-less container; the local source DB is only read (schema dump).

Proves the new suite fails before the migration, then passes once it is applied, alongside the existing admin alert suites.
"""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-first-post-check-' + uuid.uuid4().hex[:12]
DATABASE = 'first_post_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATION = '20261113090000_admin_first_post_real_people.sql'
NEW = 'admin_first_post_real_people'
# admin_persona_contact_alerts and admin_operated_meetup_alerts already stop at OPERATED_CHARACTER_REAL_MEETUP on the
# base branch (their fixtures predate the persona red lines), so only the admin alert suites that pass there run here.
PGTAP = [NEW, 'admin_signup_alerts', 'admin_security_alerts']

# Production applies migrations as postgres.
OWN_AS_POSTGRES = """do $$ declare r record; begin
      for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where nspname in ('public','private') and c.relowner='supabase_admin'::regrole and c.relkind in ('r','v','m','p') loop
        execute format('alter table %s owner to postgres', r.t); end loop;
      for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where nspname in ('public','private') and p.proowner='supabase_admin'::regrole and p.prokind='f' loop
        execute format('alter function %s owner to postgres', r.f); end loop; end $$;"""


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
    ok = result.returncode == 0 and not re.search(r'^\s*not ok \d+', output, re.M) and re.search(r'^1\.\.\d+$', output, re.M)
    return bool(ok), len(re.findall(r'^\s*ok \d+', output, re.M)), output


try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    applied = set(source_sql('select version from supabase_migrations.schema_migrations').split())
    roles = source_sql("select rolname from pg_roles where rolname !~ '^pg_';").splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=first-post-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
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
    # Schema-only dump has no rows: restore the reference rows the triggers and fixtures read.
    for table in ['public.cities', 'public.tags', 'private.analytics_config']:
        rows = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--table', table]).stdout
        sql(rows)
    # The local DB can lag behind the repo; catch it up first. Unrelated failures are reported, not fatal.
    skipped = []
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] in applied or path.name >= MIGRATION:
            continue
        if sql(path.read_text(), False).returncode:
            skipped.append(path.name)
    sql(OWN_AS_POSTGRES)
    before_ok, _, _ = pgtap(NEW)
    assert not before_ok, 'new suite must fail before the migration'
    sql((ROOT / 'supabase/migrations' / MIGRATION).read_text())
    sql(OWN_AS_POSTGRES)
    passed = {}
    for name in PGTAP:
        ok, count, output = pgtap(name)
        assert ok, name + '\n' + output[-10000:]
        passed[name] = count
    assert sql("select count(*) from public.notifications where kind='admin_first_post';").stdout.strip() == '0', 'fixtures did not roll back'
    print(json.dumps({'newSuiteFailedBefore': True, 'pgTapPassed': passed, 'catchUpMigrationsSkipped': skipped,
                      'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}, ensure_ascii=False))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
