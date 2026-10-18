"""Run actual nickname RPC checks and roll back schema and synthetic users."""
from pathlib import Path
import re
import runpy
root = Path(__file__).resolve().parents[1]
sql = runpy.run_path(str(root / 'scripts/check-admin-partnerships.py'))['sql']
fixture = (root / 'supabase/tests/profile_nickname.test.sql').read_text()
assert fixture.startswith('begin;') and fixture.rstrip().endswith('rollback;')
before = sql('postgres', "select to_regprocedure('public.change_profile_nickname(uuid,text,text)');").stdout
result = sql('postgres', 'begin;\n' + (root / 'supabase/migrations/20261018030000_profile_nickname.sql').read_text() + '\n' + fixture.removeprefix('begin;'))
output = result.stdout + result.stderr
assert not re.search(r'^\s*not ok \d+', output, re.MULTILINE), output
assert before == sql('postgres', "select to_regprocedure('public.change_profile_nickname(uuid,text,text)');").stdout
assert sql('postgres', "select exists(select 1 from auth.users where id='a1800000-0000-4000-8000-000000000001');").stdout.strip() == 'f'
count = len(re.findall(r'^ok \d+', output, re.MULTILINE))
print(f"{count} nickname pgTAP checks passed; shared schema and fixtures rolled back.")
