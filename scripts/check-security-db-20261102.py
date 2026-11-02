"""Security audit 2026-11-02 DB items, pgTAP in a disposable, network-less container; the local source DB is only read (schema dump).

Covers business comment actors, admin-hidden comments, blocked profiles/avatars, account status notes and consent-free
profile inserts. Older suites already fail here for unrelated reasons (admin MFA, chained fixtures), so each regression
suite runs before and after the migrations in the same container: nothing that passed before may fail after.
"""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-security-db-check-' + uuid.uuid4().hex[:12]
DATABASE = 'security_db_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATIONS = sorted(path.name for path in (ROOT / 'supabase/migrations').glob('2026110214*.sql'))
# Production fingerprints read 2026-11-02 (catalog only); the migrations are written against this starting point.
# Re-run BASE_FUNCTIONS/BASE_POLICIES/BASE_GRANTS on production before applying: a mismatch means a function or policy moved on.
BASE_FUNCTIONS = ("select string_agg(p.oid::regprocedure::text||'='||md5(p.prosrc),' ' order by p.oid::regprocedure::text) from pg_proc p"
                  " where p.oid in ('private.mask_business_notification()'::regprocedure,'public.get_public_comments(uuid[])'::regprocedure,"
                  "'private.can_view_comment(uuid)'::regprocedure,'private.is_blocked_between(uuid,uuid)'::regprocedure,"
                  "'private.public_comment_business_id_for(uuid,uuid)'::regprocedure,'private.capture_report_evidence()'::regprocedure,"
                  "'public.create_profile_with_consent(text,text,text,text)'::regprocedure,'private.notify_comment()'::regprocedure)")
BASE_POLICIES = ("select md5(string_agg(schemaname||tablename||policyname||permissive||cmd||array_to_string(roles,',')||"
                 "replace(coalesce(qual,'')||coalesce(with_check,''),'auth.uid()','uid()'),'|' order by schemaname,tablename,policyname))"
                 " from pg_policies where (schemaname='public' and tablename in ('comments','comment_likes','profiles','reports'))"
                 # A production-only sns-media deny (not in this repo, unrelated to avatars) is left out.
                 " or (schemaname='storage' and tablename='objects' and policyname<>'deny app account access to sns media')")
BASE_GRANTS = ("select string_agg(grantee||'.'||privilege_type||'.'||column_name,',' order by grantee,privilege_type,column_name)"
               " from information_schema.column_privileges where table_schema='public' and table_name='profiles'"
               " and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE')")
PRODUCTION = {'functions': 'create_profile_with_consent(text,text,text,text)=e4073976bb562233443101a83b67f2b2'
              ' get_public_comments(uuid[])=4949498295d098a9e864fa95cbfcba5d private.can_view_comment(uuid)=b4177d9000a9845f4ee3eaf66badba1f'
              ' private.capture_report_evidence()=801064b89a1fd33ae89de4a14b816d84 private.is_blocked_between(uuid,uuid)=48d4c1ad7a75b504ea2e6122f9a6bafa'
              ' private.mask_business_notification()=f120b6490586e26b6fb45da2ccabee43 private.notify_comment()=6085869d9c77c53361e086b5964ae23f'
              ' private.public_comment_business_id_for(uuid,uuid)=3d59897e1eac17b5cd0e7eb7b5b7a3af', 'policies': 'c042275631077c4c48c165ee9fc67abe',
              'grants': 'authenticated.INSERT.avatar_path,authenticated.INSERT.bio,authenticated.INSERT.city_id,authenticated.INSERT.id,'
                        'authenticated.INSERT.neighborhood,authenticated.INSERT.nickname,authenticated.UPDATE.avatar_path,authenticated.UPDATE.bio,'
                        'authenticated.UPDATE.city_id,authenticated.UPDATE.neighborhood,authenticated.UPDATE.nickname'}
# Every suite that touches the changed tables, minus those needing an injected fixture or running outside a transaction.
REGRESSION = sorted(path.name[:-len('.test.sql')] for path in (ROOT / 'supabase/tests').glob('*.test.sql')
                    if re.search(r'public\.(comments|profiles|blocks|reports|notifications|comment_likes)|storage\.objects|create_thread_comment|create_report', path.read_text())
                    and not re.search(r"current_setting\('test\.|isolated checker injects", path.read_text())
                    and re.search(r'^begin;', path.read_text(), re.M) and path.name != 'security_db_20261102.test.sql')


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
    assert result.returncode == 0, f'{name}\n' + output[-10000:]
    assert not re.search(r'^\s*not ok \d+', output, re.M), output
    assert re.search(r'^1\.\.\d+$', output, re.M), output
    return len(re.findall(r'^\s*ok \d+', output, re.M))


def fingerprint():
    return {key: sql(query).stdout.strip() for key, query in
            (('functions', BASE_FUNCTIONS), ('policies', BASE_POLICIES), ('grants', BASE_GRANTS))}


def tap_result(name):
    """Passing assertion names (numbers shift when a suite stops early) and the first error, for before/after comparison."""
    output = (lambda r: r.stdout + r.stderr)(sql((ROOT / f'supabase/tests/{name}.test.sql').read_text(), False))
    passed = re.findall(r'^\s*ok \d+ - (.*)$', output, re.M)
    failed = re.findall(r'^\s*not ok \d+ - (.*)$', output, re.M)
    error = (re.findall(r'ERROR:\s+(.*)$', output, re.M) or [None])[0]
    return {'passed': passed, 'failed': failed, 'error': error}


try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    applied = set(source_sql('select version from supabase_migrations.schema_migrations').split())
    roles = source_sql("select rolname from pg_roles where rolname !~ '^pg_';").splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=security-db-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
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
    # Reference rows only (tags, cities); no member data leaves the local DB.
    sql(command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only',
                 '-t', 'public.tags', '-t', 'public.cities']).stdout)
    sql("create schema if not exists cron; create table if not exists cron.job(jobid bigserial primary key, jobname text, schedule text, command text);"
        "create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values (n,s,c) returning jobid $$;"
        "create or replace function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid=id returning true $$;"
        "create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;")
    # The local DB can lag behind the repo; catch it up first. Unrelated failures are reported, not fatal.
    skipped = []
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] in applied or path.name in MIGRATIONS:
            continue
        if sql(path.read_text(), False).returncode:
            skipped.append(path.name)
    # Production applies migrations as postgres.
    sql("""do $$ declare r record; begin
      for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where nspname in ('public','private') and c.relowner='supabase_admin'::regrole and c.relkind in ('r','v','m','p') loop
        execute format('alter table %s owner to postgres', r.t); end loop;
      for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where nspname in ('public','private') and p.proowner='supabase_admin'::regrole and p.prokind='f' loop
        execute format('alter function %s owner to postgres', r.f); end loop; end $$;""")
    # Schema-only: the shared rows the suites use.
    sql("insert into private.behavior_targets(id) values('screen') on conflict do nothing;")
    start = fingerprint()
    assert start == PRODUCTION, start
    before = {name: tap_result(name) for name in REGRESSION}
    for name in MIGRATIONS:
        sql((ROOT / 'supabase/migrations' / name).read_text())
    # Re-running is safe.
    for name in MIGRATIONS:
        sql((ROOT / 'supabase/migrations' / name).read_text())
    passed = {'security_db_20261102': pgtap('security_db_20261102')}
    regression = {}
    for name in REGRESSION:
        after = tap_result(name)
        lost = [item for item in before[name]['passed'] if item not in after['passed']]
        assert not lost and after['error'] in (None, before[name]['error']), (name, lost, before[name]['error'], after['error'], after['failed'])
        regression[name] = {'passed': len(after['passed']), 'preExistingFailures': len(after['failed']) + bool(after['error'])}
    assert sql("select count(*) from public.profiles where id::text like '5ec5%';").stdout.strip() == '0', 'fixture did not roll back'
    # The rollback file returns the schema to the production starting point.
    sql((ROOT / 'supabase/tests/security_db_20261102_rollback.sql').read_text())
    assert fingerprint() == PRODUCTION, fingerprint()
    assert sql("select to_regprocedure('private.can_read_avatar(text)') is null and to_regprocedure('private.guard_comment_restore()') is null"
               " and not exists(select 1 from pg_trigger where tgname='comments_guard_restore');").stdout.strip() == 't'
    print(json.dumps({'pgTapPassed': passed, 'rollbackRestoresProduction': True, 'regression': regression, 'migrations': MIGRATIONS,
                      'catchUpMigrationsSkipped': skipped, 'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False},
                     ensure_ascii=False, indent=1))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
