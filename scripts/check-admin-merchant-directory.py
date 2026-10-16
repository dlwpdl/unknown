"""Run actual directory RPC assertions in a rolled-back shared Docker transaction."""
from pathlib import Path
import re
import runpy

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / 'scripts/check-admin-partnerships.py'))
sql = helpers['sql']
fixture = (ROOT / 'supabase/tests/admin_merchant_directory.test.sql').read_text()
migration = ROOT / 'supabase/migrations/20261015210000_admin_merchant_directory.sql'
signature = "public.get_admin_merchants(text,integer,jsonb)"
snapshot = "select md5(pg_get_functiondef('public.get_admin_merchants(text,integer)'::regprocedure)),to_regprocedure('" + signature + "');"
before = sql('postgres', snapshot).stdout
assert fixture.startswith('begin;') and fixture.rstrip().endswith('rollback;')
result = sql('postgres', 'begin;\n' + helpers['prerequisites']('postgres') + migration.read_text() + '\n' + fixture.removeprefix('begin;'))
output = result.stdout + result.stderr
assert not re.search(r'^\s*not ok \d+', output, re.MULTILINE), output
assert re.search(r'^1\.\.\d+$', output, re.MULTILINE), output
passed = len(re.findall(r'^\s*ok \d+', output, re.MULTILINE))
assert before == sql('postgres', snapshot).stdout, 'Shared function state changed'
assert sql('postgres', "select exists(select 1 from auth.users where id='d1500000-0000-0000-0000-000000000001');").stdout.strip() == 'f', 'Fixture was not rolled back'
print(f'{passed} actual pgTAP directory checks passed; legacy function and shared schema/fixtures unchanged.')
