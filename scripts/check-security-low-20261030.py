"""Security audit 2026-10-30 low items, pgTAP in a disposable, network-less container; the local source DB is only read (schema dump).

Covers the per-session anonymous behavior limit, business co-manager seat suspension, and dropping the 2026-10-27
draft admin business membership grants (both the committed and the hand-applied draft starting points, and the
refusal when the draft table holds a grant).
"""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-security-low-check-' + uuid.uuid4().hex[:12]
DATABASE = 'security_low_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATIONS = ['20261030210000_anon_behavior_session_limit.sql', '20261030210100_business_operator_seat_suspension.sql',
              '20261030210200_drop_draft_merchant_membership_grants.sql']
DRAFT_BASE_MD5 = 'dba06b0684ceaae36533345a075a53e4'
# Existing suites over the same functions; they must keep passing on top of these migrations.
REGRESSION = ['business_free_tier_operator_links', 'business_account_scope', 'admin_membership_grants']


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
             'POSTGRES_PASSWORD=security-low-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
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
    # The local DB can lag behind the repo; catch it up first. Unrelated failures are reported, not fatal.
    skipped = []
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] in applied or path.name >= MIGRATIONS[0]:
            continue
        if sql(path.read_text(), False).returncode:
            skipped.append(path.name)
    # The local DB carries the hand-applied 2026-10-27 draft; the catch-up rewrote its base body, so put it back to
    # exercise the worst starting point production could be in.
    draft_present = sql("select to_regclass('private.merchant_membership_grants') is not null;").stdout.strip() == 't'
    if source_sql("select md5(prosrc) from pg_proc where oid='private.business_membership_details_base(uuid)'::regprocedure;").strip() == DRAFT_BASE_MD5:
        sql(source_sql("select pg_get_functiondef('private.business_membership_details_base(uuid)'::regprocedure);") + ';')
    # Production applies migrations as postgres.
    sql("""do $$ declare r record; begin
      for r in select c.oid::regclass t from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where nspname in ('public','private') and c.relowner='supabase_admin'::regrole and c.relkind in ('r','v','m','p') loop
        execute format('alter table %s owner to postgres', r.t); end loop;
      for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where nspname in ('public','private') and p.proowner='supabase_admin'::regrole and p.prokind='f' loop
        execute format('alter function %s owner to postgres', r.f); end loop; end $$;""")
    # Schema-only: the shared rows the suites use.
    sql("insert into public.cities values('vancouver','밴쿠버','BC','America/Vancouver',true) on conflict do nothing;"
        "insert into private.behavior_targets(id) values('screen') on conflict do nothing;")
    for name in MIGRATIONS[:2]:
        sql((ROOT / 'supabase/migrations' / name).read_text())
    drop = (ROOT / 'supabase/migrations' / MIGRATIONS[2]).read_text()
    refused = None
    if draft_present:
        result = sql("begin;\ninsert into auth.users(id,email) values('5ec30000-0000-4000-8000-000000000001','draft-grant@example.test');"
                     "insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)"
                     " values('5ec30000-0000-4000-8000-000000000001','초안검사','vancouver',now(),now(),now(),'test');"
                     "insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,record_kind)"
                     " values('5ec30000-0000-4000-8000-000000000002','Draft grant','vancouver','c','lead','granted','Synthetic rollback-only test',"
                     "'5ec30000-0000-4000-8000-000000000001',now(),'business');"
                     "insert into private.merchant_membership_grants(merchant_id,tier,expires_on,granted_by)"
                     " values('5ec30000-0000-4000-8000-000000000002','pro',current_date+30,'5ec30000-0000-4000-8000-000000000001');\n"
                     + drop + "\nrollback;", False)
        refused = 'DRAFT_MEMBERSHIP_GRANTS_PRESENT' in result.stderr
        assert refused, result.stdout[-2000:] + result.stderr[-4000:]
        assert sql("select to_regclass('private.merchant_membership_grants') is not null;").stdout.strip() == 't'
    sql(drop)
    bodies = sql("select md5(prosrc) from pg_proc where oid in('private.business_membership_details_base(uuid)'::regprocedure,"
                 "'private.business_membership_details(uuid)'::regprocedure) order by proname;").stdout.split()
    assert bodies == ['49904a82fe1b19d37c4aecda5190526d', '7c022c71262a241cfb71229f53657691'], bodies
    # Re-running is safe on a database that never had the draft.
    sql(drop)
    passed = {'security_low_20261030': pgtap('security_low_20261030')}
    for name in REGRESSION:
        passed[name] = pgtap(name)
    assert sql("select count(*) from public.profiles where id::text like '5ec%';").stdout.strip() == '0', 'fixture did not roll back'
    print(json.dumps({'pgTapPassed': passed, 'rollbackVerified': True, 'draftStartingPoint': draft_present,
                      'draftWithGrantRefused': refused, 'catchUpMigrationsSkipped': skipped,
                      'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}, ensure_ascii=False))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
