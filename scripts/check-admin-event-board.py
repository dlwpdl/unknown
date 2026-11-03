"""Event board pgTAP (steps 1 and 2) in a disposable, network-less container; the local source DB is only read (schema dump).

Usage: python3 scripts/check-admin-event-board.py [mobile supabase/migrations dir]
Step 2 builds on the event-link migrations (PR #84), read from this checkout by default; until #84 is merged,
pass a migrations directory that has them.
"""
from pathlib import Path
import json
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
MOBILE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'supabase/migrations'
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-admin-event-board-check-' + uuid.uuid4().hex[:12]
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
# Production order: board and its undo fix, then the event links and step 2 data, then the step 2 board functions,
# then the store link use records and the board's use count, then the link's first-entry rule, the live campaign dashboard,
# the board's check reasons and the campaign report.
MIGRATIONS = [ROOT / 'supabase/migrations/20261101230000_admin_event_board.sql',
              ROOT / 'supabase/migrations/20261102010000_admin_event_board_restore.sql',
              MOBILE / '20261102120000_event_links.sql',
              MOBILE / '20261102130000_event_board_phase2.sql',
              ROOT / 'supabase/migrations/20261102135000_admin_event_board_phase2.sql',
              MOBILE / '20261102150000_event_store_uses.sql',
              ROOT / 'supabase/migrations/20261102151000_admin_event_board_store_uses.sql',
              MOBILE / '20261103010000_event_apply_first_entry_stays.sql',
              ROOT / 'supabase/migrations/20261103020000_campaign_live_dashboard.sql',
              ROOT / 'supabase/migrations/20261103030000_admin_event_board_check_reason.sql',
              ROOT / 'supabase/migrations/20261103040000_campaign_report.sql']
# The report migration also replaces the link lookup, so the apply and store link tests run on top of it too.
TESTS = ['admin_event_board.test.sql', 'admin_event_board_phase2.test.sql', 'campaign_live_dashboard.test.sql',
         'admin_event_board_check_reason.test.sql', 'campaign_report.test.sql', 'event_links.test.sql', 'event_board_phase2.test.sql']


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=180)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                    '-d', 'board_check', '-v', 'ON_ERROR_STOP=1'], source, check)


try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    roles = command(['docker', 'exec', SOURCE, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres',
                     '-c', "select rolname from pg_roles where rolname !~ '^pg_';"]).stdout.splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=board-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(240):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    for role in roles:
        name, literal = role.replace('"', '""'), role.replace("'", "''")
        command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                f'''do $$ begin if not exists(select 1 from pg_roles where rolname='{literal}') then create role "{name}" nologin; end if; end $$;''')
    command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', 'board_check'])
    sql(dump)
    for migration in MIGRATIONS:
        sql(migration.read_text())
    passed = {}
    for test in TESTS:
        result = sql((ROOT / 'supabase/tests' / test).read_text(), False)
        output = result.stdout + result.stderr
        assert result.returncode == 0, output[-10000:]
        assert not re.search(r'^\s*not ok \d+', output, re.M), output
        assert re.search(r'^1\.\.\d+$', output, re.M), output
        passed[test] = len(re.findall(r'^\s*ok \d+', output, re.M))
    print(json.dumps({'pgTapPassed': passed, 'mobileMigrations': str(MOBILE), 'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
