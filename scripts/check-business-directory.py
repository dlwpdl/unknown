"""Directory pgTAP in a disposable, portless container; source DB is read-only."""
from pathlib import Path
import json
import re
import runpy
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-directory-check-' + uuid.uuid4().hex[:12]
DATABASE = 'directory_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=90)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(_database, source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                    '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], source, check)


try:
    # Read only schema and role names; no user records, credentials or shared DB writes.
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres',
                    '--schema-only', '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron',
                    '--exclude-extension=pg_net', '--exclude-schema=cron', '--exclude-schema=net']).stdout
    roles = command(['docker', 'exec', SOURCE, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres',
                     '-c', "select rolname from pg_roles where rolname !~ '^pg_';"]).stdout.splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=directory-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(60):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', DATABASE])
    for role in roles:
        name = role.replace('"', '""')
        literal = role.replace("'", "''")
        sql(DATABASE, f'''do $$ begin if not exists(select 1 from pg_roles where rolname='{literal}') then create role "{name}" nologin; end if; end $$;''')
    sql(DATABASE, dump)
    # Reuse the existing prerequisite collector, redirected entirely to this container.
    helper = runpy.run_path(str(ROOT / 'scripts/check-admin-partnerships.py'))
    helper['sql'].__globals__['CONTAINER'] = CONTAINER
    helper['sql'].__globals__['sql'] = sql
    helper['sql'] = sql
    collector = ROOT / 'scripts/check-business-identity.py'
    prefix = collector.read_text().split('before = sql(', 1)[0]
    prefix = prefix.replace("helper = runpy.run_path(str(root / 'scripts/check-admin-partnerships.py'))", 'helper = isolated_helper')
    namespace = {'__file__': str(collector), 'isolated_helper': helper}
    previous = sys.argv
    sys.argv = [str(collector), '--profiles']
    try:
        exec(compile(prefix, str(collector), 'exec'), namespace)
    finally:
        sys.argv = previous
    migrations = ROOT / 'supabase/migrations'
    preparation = ''
    if not sql(DATABASE, "select to_regclass('private.behavior_targets');").stdout.strip():
        preparation += (migrations / '0073_behavior_analytics.sql').read_text().split('insert into private.behavior_targets', 1)[0]
    preparation += (migrations / '0118_admin_mfa.sql').read_text() + '\n'
    identity = namespace['source']
    if not sql(DATABASE, "select to_regclass('private.saved_merchants');").stdout.strip():
        marker = namespace['identity_source']
        assert identity.count(marker) == 1, 'business identity prerequisite boundary changed'
        identity = identity.replace(marker, (migrations / '0145_merchant_conveniences.sql').read_text() + '\n' + marker, 1)
    preparation += identity
    preparation += '\n' + (migrations / '20261015190000_admin_partnerships.sql').read_text()
    preparation += '\n' + (migrations / '20261023180000_webshops.sql').read_text()
    preparation += '\n' + (migrations / '20261023210000_merchant_profile_lookup_performance.sql').read_text()
    # Use the latest checked-in public profile wrapper and its exact helper bodies.
    conversations = (migrations / '20261018041000_business_identity_conversations.sql').read_text()
    for function in ['create function private.business_chat_business_ready(',
                     'create function private.business_chat_can_use(',
                     'create or replace function public.get_merchant_profile(']:
        preparation += '\n' + function + conversations.split(function, 1)[1].split('$$;', 1)[0] + '$$;\n'
    sql(DATABASE, 'begin;\n' + preparation + '\ncommit;')
    sql(DATABASE, (migrations / '20261024002000_business_directory.sql').read_text())
    result = sql(DATABASE, (ROOT / 'supabase/tests/business_directory.test.sql').read_text(), False)
    output = result.stdout + result.stderr
    log = Path('/tmp/gling-business-directory-sql-output.txt')
    log.write_text(output)
    assert result.returncode == 0, output[-10000:]
    assert not re.search(r'^\s*not ok \d+', output, re.M), output
    assert re.search(r'^1\.\.\d+$', output, re.M), output
    assert sql(DATABASE, 'select count(*) from private.merchants;').stdout.strip() == '0', 'fixture did not roll back'
    print(json.dumps({'pgTapPassed': len(re.findall(r'^\s*ok \d+', output, re.M)), 'rollbackVerified': True,
                      'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False, 'output': str(log)}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
