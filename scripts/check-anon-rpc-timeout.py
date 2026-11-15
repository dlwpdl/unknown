"""Anon RPC speed-up pgTAP in a disposable, network-less container. Stubs stand in for the tables and helper functions the two
public functions read; the real before-definitions (migration 20261111210000 and the production get_merchant_profile) are run first,
their answers are saved, then migration 20261116000000 is applied and the answers must be identical."""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'gling-anon-rpc-check-' + uuid.uuid4().hex[:12]
DATABASE = 'anon_rpc_check'
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
MIGRATION = ROOT / 'supabase/migrations/20261116000000_anon_rpc_timeout.sql'
PLACE_BEFORE = re.search(r'create function private\.post_catalog_place.*?\n\$\$;',
                         (ROOT / 'supabase/migrations/20261111210000_shared_preview_post_place.sql').read_text(), re.S).group(0)
MERCHANT_BEFORE = (ROOT / 'supabase/tests/fixtures/get_merchant_profile_before_20261116.sql').read_text()


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', DATABASE,
                    '-v', 'ON_ERROR_STOP=1'], source, check)


try:
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=anon-rpc-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(240):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', DATABASE])
    sql((ROOT / 'supabase/tests/anon_rpc_timeout_stubs.sql').read_text())
    sql(PLACE_BEFORE + "\nrevoke all on function private.post_catalog_place(text,text) from public,anon,authenticated,service_role;\n"
        "alter function private.post_catalog_place(text,text) owner to postgres;")
    sql(MERCHANT_BEFORE)
    sql((ROOT / 'supabase/tests/anon_rpc_timeout_before.sql').read_text())
    sql(MIGRATION.read_text())
    result = sql((ROOT / 'supabase/tests/anon_rpc_timeout.test.sql').read_text().replace('@MIGRATION@', MIGRATION.read_text()), False)
    output = result.stdout + result.stderr
    assert result.returncode == 0, output[-10000:]
    assert not re.search(r'^\s*not ok \d+', output, re.M), output
    assert re.search(r'^1\.\.\d+$', output, re.M), output
    print(json.dumps({'pgTapPassed': len(re.findall(r'^\s*ok \d+', output, re.M)), 'disposableContainer': CONTAINER,
                      'sharedDatabaseWrites': False}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
