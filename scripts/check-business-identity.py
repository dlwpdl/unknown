"""Exercise business identity RPCs on the existing local Postgres, then roll back."""
from pathlib import Path
import re
import runpy

root = Path(__file__).resolve().parents[1]
helper = runpy.run_path(str(root / 'scripts/check-admin-partnerships.py'))
sql = helper['sql']
source = helper['prerequisites']('postgres')
for table, migration in [('merchant_mcp_connections', '0142_merchant_customer_mcp.sql'),
                         ('merchant_operators', '0143_merchant_account_connections.sql')]:
    if not sql('postgres', f"select to_regclass('private.{table}');").stdout.strip():
        source += (root / 'supabase/migrations' / migration).read_text() + '\n'
for name in ['20261018031000_admin_user_business_connections.sql',
             '20261018032000_business_post_identity.sql',
             '20261018033000_business_display_language.sql']:
    source += (root / 'supabase/migrations' / name).read_text() + '\n'
fixture = (root / 'supabase/tests/business_post_identity.test.sql').read_text()
assert fixture.startswith('begin;') and fixture.rstrip().endswith('rollback;')
before = sql('postgres', "select to_regprocedure('public.get_public_post_businesses(uuid[])');").stdout
result = sql('postgres', 'begin;\n' + source + fixture.removeprefix('begin;'))
output = result.stdout + result.stderr
assert not re.search(r'^\s*not ok \d+', output, re.MULTILINE), output
assert before == sql('postgres', "select to_regprocedure('public.get_public_post_businesses(uuid[])');").stdout
assert sql('postgres', "select exists(select 1 from auth.users where id='b1800000-0000-4000-8000-000000000001');").stdout.strip() == 'f'
count = len(re.findall(r'^ok \d+', output, re.MULTILINE))
print(f'{count} business identity pgTAP checks passed; shared schema and fixtures rolled back.')
