"""Run only this feature's migration and security fixtures; always roll them back."""
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
source = '\n'.join((root / file).read_text() for file in (
    'supabase/migrations/0142_merchant_customer_mcp.sql',
    'supabase/migrations/0148_merchant_mcp_expected_actor.sql',
))
tests = (root / 'supabase/tests/merchant_customer_mcp.test.sql').read_text()
assert tests.startswith('begin;') and tests.rstrip().endswith('rollback;')
result = subprocess.run(
    ['docker', 'exec', '-i', 'supabase_db_gling', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    input='begin;\n' + source + '\n' + tests.removeprefix('begin;'), text=True, capture_output=True,
)
output = result.stdout + result.stderr
if result.returncode or re.search(r'^\s*not ok \d+', output, re.MULTILINE) or 'ROLLBACK' not in output:
    print(output)
    raise SystemExit(1)
passed = len(re.findall(r'^\s*ok \d+', output, re.MULTILINE))
print(f"{passed} business MCP security checks passed; transaction rolled back.")
