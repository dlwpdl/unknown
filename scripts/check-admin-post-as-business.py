"""Admin post-as-business pgTAP checks on the existing local Postgres, inside one transaction that rolls back."""
from pathlib import Path
import re
import runpy

root = Path(__file__).resolve().parents[1]
sql = runpy.run_path(str(root / 'scripts/check-admin-partnerships.py'))['sql']
migrations = root / 'supabase/migrations'
source = ''
# Older local snapshots predate the admin cap exemption the new migration guards on.
if 'managed:=auth.uid() is distinct from m.owner_id' not in sql('postgres', "select pg_get_functiondef('private.consume_business_usage(uuid,text,uuid,text)'::regprocedure);").stdout:
    for name in ['20261026065000_admin_unlimited_business_posts.sql', '20261026070100_admin_no_business_limits.sql']:
        source += (migrations / name).read_text() + '\n'
source += (migrations / '20261030150000_admin_post_as_business.sql').read_text() + '\n'
fixture = (root / 'supabase/tests/admin_post_as_business.test.sql').read_text()
assert fixture.startswith('begin;') and fixture.rstrip().endswith('rollback;')
before = sql('postgres', "select md5(pg_get_functiondef('public.link_admin_merchant_post(uuid,uuid,text)'::regprocedure));").stdout
result = sql('postgres', 'begin;\n' + source + fixture.removeprefix('begin;'))
output = result.stdout + result.stderr
assert not re.search(r'^\s*not ok \d+', output, re.MULTILINE), output
assert re.search(r'^ok \d+', output, re.MULTILINE), output
assert before == sql('postgres', "select md5(pg_get_functiondef('public.link_admin_merchant_post(uuid,uuid,text)'::regprocedure));").stdout
assert sql('postgres', "select exists(select 1 from auth.users where id='b1d00000-0000-4000-8000-000000000001');").stdout.strip() == 'f'
count = len(re.findall(r'^ok \d+', output, re.MULTILINE))
print(f"{count} admin post-as-business pgTAP checks passed; schema and fixtures rolled back.")
