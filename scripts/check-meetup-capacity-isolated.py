"""Real application-schema checks in one disposable, offline PostgreSQL container.

Inputs come from the release owner: a private schema-only dump and password/config-free
role metadata. This script never reads or starts the original Supabase container.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import signal
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
ROLE_FLAGS = {
    'rolsuper': 'SUPERUSER', 'rolinherit': 'INHERIT', 'rolcreaterole': 'CREATEROLE',
    'rolcreatedb': 'CREATEDB', 'rolcanlogin': 'LOGIN', 'rolreplication': 'REPLICATION',
    'rolbypassrls': 'BYPASSRLS',
}


def private_file(value):
    path = Path(value).resolve(strict=True)
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Input must be a regular owner-only file (0600).')
    return path


def role_sql(path):
    metadata = json.loads(path.read_text())
    assert set(metadata) == {'roles', 'memberships'}, 'Only allowlisted role metadata is accepted.'
    assert 0 < len(metadata['roles']) <= 100 and len(metadata['memberships']) <= 500
    identifier = lambda name: '"' + name + '"' if isinstance(name, str) and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', name) else None
    statements = []
    admin = next((role for role in metadata['roles'] if role.get('rolname') == 'supabase_admin'), None)
    assert admin and admin.get('rolsuper') is True, 'The existing local test administrator must retain its actual superuser attribute.'
    for role in metadata['roles']:
        assert set(role) == {'rolname', *ROLE_FLAGS}, 'Password, role configuration and other fields are forbidden.'
        name = identifier(role['rolname'])
        assert name and all(type(role[field]) is bool for field in ROLE_FLAGS)
        flags = ' '.join(('' if role[field] else 'NO') + flag for field, flag in ROLE_FLAGS.items())
        if role['rolname'] != 'supabase_admin':
            statements.append(f'create role {name};')
        statements.append(f'alter role {name} {flags};')
    for edge in metadata['memberships']:
        assert set(edge) == {'role', 'member', 'admin_option', 'inherit_option', 'set_option'}
        role, member = identifier(edge['role']), identifier(edge['member'])
        assert role and member and all(type(edge[field]) is bool for field in ['admin_option', 'inherit_option', 'set_option'])
        flags = ', '.join(f'{option.upper()} {str(edge[option + "_option"]).upper()}' for option in ['admin', 'inherit', 'set'])
        statements.append(f'grant {role} to {member} with {flags};')
    return '\n'.join(statements)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--schema', required=True, type=private_file)
    parser.add_argument('--roles', required=True, type=private_file)
    args = parser.parse_args()
    roles = role_sql(args.roles)
    schema = args.schema.read_text()
    assert 'PostgreSQL database dump' in schema[:1000] and '-- Data for Name:' not in schema, 'A plain schema-only pg_dump file is required.'
    assert re.search(r'^ALTER FUNCTION private\.lock_relationships\(\) OWNER TO ', schema, re.M), 'Schema dump must preserve function owners; --no-owner changes definer permissions.'
    name = 'gling-capacity-' + uuid.uuid4().hex[:12]
    deadline = time.monotonic() + 240

    def docker(arguments, source=None, check=True):
        result = subprocess.run(['docker', *arguments], input=source, text=True, capture_output=True,
                                timeout=max(1, min(60, deadline - time.monotonic())))
        if check and result.returncode:
            # Never echo the private schema or role input through an exception.
            errors = [line for line in result.stderr.splitlines() if 'ERROR:' in line or 'FATAL:' in line]
            raise AssertionError('\n'.join(errors[-3:]) or 'Isolated PostgreSQL command failed.')
        return result

    image = docker(['image', 'inspect', IMAGE, '--format', '{{json .Config.Volumes}}'])  # Cached only; never pull.
    # Override any image-declared anonymous data volume with disposable tmpfs too.
    volumes = json.loads(image.stdout) or {}
    volume_args = [argument for path in volumes for argument in ['--tmpfs', path + ':rw,nosuid,size=16m']]
    boot = r'''
set -eu
export PATH="$(pg_config --bindir):$PATH"
test -x "$(pg_config --bindir)/postgres" || { echo 'Cached image has no PostgreSQL server binary'; exit 2; }
test -f "$(pg_config --sharedir)/extension/pgtap.control" || { echo 'Cached image has no pgTAP control file'; exit 2; }
mkdir -p /tmp/gling-pg /tmp/gling-socket
initdb -D /tmp/gling-pg -U supabase_admin --no-locale --encoding=UTF8 --auth-local=trust --auth-host=reject >/tmp/gling-init.log
exec postgres -D /tmp/gling-pg -k /tmp/gling-socket -c listen_addresses='' -c shared_preload_libraries=''
'''
    def timeout(_signal, _frame):
        raise TimeoutError('Isolated capacity test exceeded240seconds.')
    previous_alarm = signal.signal(signal.SIGALRM, timeout)
    signal.alarm(240)
    postgres_log = args.schema.parent / (name + '.postgres.log')
    output = os.fdopen(os.open(postgres_log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w')
    process = None
    try:
        print(json.dumps({'container': name, 'image': IMAGE, 'phase': 'starting', 'postgresLog': str(postgres_log)}), flush=True)
        process = subprocess.Popen(['docker', 'run', '--rm', '--pull=never', '--name', name, '--network', 'none',
                '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=768m,mode=1777', *volume_args, '--user', 'postgres',
                '--env', 'PGHOST=/tmp/gling-socket', '--env', 'PGPORT=5432', '--entrypoint', '/bin/bash', IMAGE, '-c', boot],
                stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT)
        ready_until = time.monotonic() + 25
        while time.monotonic() < ready_until:
            assert process.poll() is None, 'Disposable PostgreSQL exited before readiness; see the private boot log.'
            ready = docker(['exec', name, 'pg_isready', '-U', 'supabase_admin'], check=False)
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise AssertionError('Disposable PostgreSQL was not ready within25seconds.')

        def sql(source):
            return docker(['exec', '-i', name, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], source)

        sql(roles)
        sql(schema)
        sql('create schema if not exists extensions; create extension if not exists pgtap with schema extensions;')
        assert sql('select count(*) from auth.users;').stdout.strip() == '0', 'Schema input unexpectedly contains user rows.'

        # Reuse the real application's prerequisite replay and lock/race checks.
        # Only its transport target changes in this process; no source RPC is stubbed.
        checker = runpy.run_path(str(ROOT / 'scripts/check-meetup-profile.py'))
        checker['command'].__globals__['CONTAINER'] = name
        def isolated_command(arguments, **kwargs):
            assert set(kwargs) <= {'input'}, 'Unexpected test transport option.'
            return docker(['exec', '-i', name, *arguments], kwargs.get('input'), check=False)
        checker['command'].__globals__['command'] = isolated_command
        checker['main'].__globals__['command'] = isolated_command
        original_check = checker['check_tap']

        def check_capacity(database, source, label):
            original_check(database, source, label)
            if label == 'profile identity':
                legacy_state = "select md5(pg_get_functiondef(oid)),proowner,proacl,prosecdef,proconfig from pg_proc where oid='public.get_chilling_roster(uuid)'::regprocedure;"
                before_roster = checker['sql'](database, legacy_state).stdout
                checker['sql'](database, (ROOT / 'supabase/migrations/20261025160000_meetup_member_capacity.sql').read_text())
                assert checker['sql'](database, legacy_state).stdout == before_roster, 'Legacy roster definition, owner, ACL or security attributes changed.'
                print('PASS: legacy roster definition, owner, ACL, security definer and fixed search path are unchanged.')
                original_check(database, (ROOT / 'supabase/tests/meetup_member_capacity.test.sql').read_text(), 'meetup member capacity')

        checker['main'].__globals__['check_tap'] = check_capacity
        checker['main']()
        print(json.dumps({'container': name, 'image': IMAGE, 'schemaSha256': hashlib.sha256(args.schema.read_bytes()).hexdigest(),
                          'network': 'none', 'publishedPorts': [], 'syntheticRowsOnly': True, 'rpcStubs': False}))
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_alarm)
        subprocess.run(['docker', 'rm', '--force', name], capture_output=True, text=True, timeout=25)
        if process:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        output.close()
        absent = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True, timeout=10)
        removed = absent.returncode != 0 and ('no such object' in absent.stderr.lower() or 'no such container' in absent.stderr.lower())
        print(json.dumps({'container': name, 'removed': removed, 'postgresLog': str(postgres_log),
                          'postgresLogSha256': hashlib.sha256(postgres_log.read_bytes()).hexdigest()}), flush=True)
        assert removed, 'Disposable container removal was not verified.'


if __name__ == '__main__':
    main()
