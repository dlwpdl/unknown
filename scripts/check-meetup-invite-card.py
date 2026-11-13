"""Meetup invite card, shop QR landing and the invite reward path: pgTAP in a disposable, network-less container.

The local source DB is only read (schema dump); newer repo migrations are replayed in the container before this one.
"""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-meetup-invite-check-' + uuid.uuid4().hex[:12]
DATABASE = 'meetup_invite_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATION = '20261113120000_meetup_invite_card.sql'
PGTAP = ['meetup_invite_card', 'meetup_invite_reward_flow']


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
             'POSTGRES_PASSWORD=meetup-invite-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
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
        if path.name.split('_')[0] in applied or path.name >= MIGRATION:
            continue
        if sql(path.read_text(), False).returncode:
            skipped.append(path.name)
    # Production migrations run as postgres; replayed here as supabase_admin, new objects would get an owner the existing
    # security definer functions cannot use (e.g. private.admin_persona_contact_visible inside the notification trigger).
    sql("""do $$ declare item record; begin
      for item in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and pg_get_userbyid(p.proowner)='supabase_admin' and p.prokind in ('f','p') loop
        execute 'alter routine '||item.sig||' owner to postgres'; end loop;
      for item in select c.oid::regclass rel from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','private') and pg_get_userbyid(c.relowner)='supabase_admin' and c.relkind in ('r','v','m','p') loop
        execute 'alter table '||item.rel||' owner to postgres'; end loop;
    end $$;""")
    # The schema dump has no rows: the meetup tag and the open cities the fixtures use.
    sql("insert into public.cities(id,name,province,timezone,is_open) values('vancouver','밴쿠버','BC','America/Vancouver',true);"
        "insert into public.tags(id,kind,slug,label) values(1,'post','life','일상'),(2,'meetup','meetup','모임'),(3,'post','festival','페스티벌');")
    sql((ROOT / 'supabase/migrations' / MIGRATION).read_text())
    passed = {}
    for name in PGTAP:
        ok, count, output = pgtap(name)
        assert ok, output[-10000:]
        passed[name] = count
    assert sql("select count(*) from public.posts where id::text like '9e100000-%' or id::text like '9f100000-%';").stdout.strip() == '0', 'fixtures did not roll back'
    print(json.dumps({'pgTapPassed': passed, 'catchUpMigrationsSkipped': skipped, 'disposableContainer': CONTAINER,
                      'sharedDatabaseWrites': False}, ensure_ascii=False))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
