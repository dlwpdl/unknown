"""Apply only the conversation investigation migration and fixtures, then roll back."""
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
migrations = [root / 'supabase/migrations' / name for name in (
    '20261012183500_admin_conversation_investigation.sql',
    '20261012194500_admin_conversation_message_compatibility.sql',
)]
tests = (root / 'supabase/tests/admin_conversations.test.sql').read_text()
assert tests.startswith('begin;') and tests.rstrip().endswith('rollback;')
source = '\n'.join(migration.read_text() for migration in migrations)
result = subprocess.run(
    ['docker', 'exec', '-i', 'supabase_db_gling', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    input='begin;\n' + source + '\n' + tests.removeprefix('begin;'), text=True, capture_output=True, timeout=60,
)
output = result.stdout + result.stderr
if result.returncode or re.search(r'^\s*not ok \d+', output, re.MULTILINE) or 'ROLLBACK' not in output:
    print(output)
    raise SystemExit(1)
passed = len(re.findall(r'^\s*ok \d+', output, re.MULTILINE))
print(f'{passed} conversation database checks passed; transaction rolled back.')
