"""Test place ratings only in the explicitly owned disposable PostgreSQL container."""
import json
import pathlib
import re
import subprocess
import sys

if len(sys.argv) != 2 or not sys.argv[1].startswith('gling-place-ratings-test-'):
    raise SystemExit('Usage: python3 scripts/check-place-ratings.py gling-place-ratings-test-<suffix>')
name = sys.argv[1]
label = subprocess.check_output(['docker', 'inspect', '--format', '{{index .Config.Labels "com.gling.task"}}', name], text=True).strip()
if label != 'place-ratings-20261018':
    raise SystemExit('Refusing a database without this task ownership label.')
root = pathlib.Path(__file__).resolve().parent.parent
sql = (root / 'supabase/tests/place_ratings.test.sql').read_text()
assert sql.startswith('begin;') and sql.rstrip().endswith('rollback;')
result = subprocess.run(['docker', 'exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                        input=sql, text=True, capture_output=True, timeout=90)
output = result.stdout + result.stderr
if result.returncode or re.search(r'^\s*not ok \d+', output, re.MULTILINE) or 'ROLLBACK' not in output:
    print(output)
    raise SystemExit(1)
passed = len(re.findall(r'^\s*ok \d+', output, re.MULTILINE))
if passed < 24:
    raise SystemExit(f'Expected the full place-rating SQL suite; saw {passed} passing assertions.')
print(json.dumps({'checks': passed, 'failed': 0, 'rolledBack': True, 'container': name, 'productionWrites': 0}))
