"""Event link pgTAP in a disposable, network-less container; the local source DB is only read (schema dump).

Runs twice: without and with the admin event board's outreach_stage column (admin checkout 20261101230000),
because production may have either when this migration lands.
"""
from pathlib import Path
import json
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'supabase_db_gling'
CONTAINER = 'gling-event-link-check-' + uuid.uuid4().hex[:12]
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
# Same column definition as the admin board migration, nothing else from it.
BOARD = """alter table private.partnership_participations
  add column outreach_stage text not null default 'candidate'
    check(outreach_stage in ('candidate','proposed','replied','confirmed','posted','hold','dropped')),
  add column contacted boolean not null default false;"""


def command(args, source=None, check=True):
    result = subprocess.run(args, input=source, text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise AssertionError(result.stdout[-2000:] + result.stderr[-6000:])
    return result


def sql(database, source, check=True):
    return command(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin',
                    '-d', database, '-v', 'ON_ERROR_STOP=1'], source, check)


try:
    dump = command(['docker', 'exec', SOURCE, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                    '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                    '--exclude-schema=cron', '--exclude-schema=net']).stdout
    assert not re.search(r'^COPY .* FROM stdin;$', dump, re.M), 'schema-only dump expected'
    assert 'outreach_stage' not in dump, 'source DB already has the board column; the "without" pass would not test anything'
    roles = command(['docker', 'exec', SOURCE, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres',
                     '-c', "select rolname from pg_roles where rolname !~ '^pg_';"]).stdout.splitlines()
    command(['docker', 'run', '--pull', 'never', '--rm', '-d', '--name', CONTAINER, '--network', 'none', '-e',
             'POSTGRES_PASSWORD=event-link-local-only', IMAGE, 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
    for _ in range(120):
        logs = command(['docker', 'logs', CONTAINER], check=False)
        if 'init process complete' in logs.stdout + logs.stderr and command(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'supabase_admin'], check=False).returncode == 0:
            break
        time.sleep(0.25)
    for role in roles:
        name, literal = role.replace('"', '""'), role.replace("'", "''")
        sql('postgres', f'''do $$ begin if not exists(select 1 from pg_roles where rolname='{literal}') then create role "{name}" nologin; end if; end $$;''')
    passes = {}
    for label, before in [('without_board_column', ''), ('with_board_column', BOARD)]:
        database = 'event_link_' + label
        command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', database])
        sql(database, dump)
        if before:
            sql(database, before)
        # Everything this migration builds on is already in the local source DB; newer unrelated migrations are not replayed.
        sql(database, (ROOT / 'supabase/migrations/20261102120000_event_links.sql').read_text())
        result = sql(database, (ROOT / 'supabase/tests/event_links.test.sql').read_text(), False)
        output = result.stdout + result.stderr
        assert result.returncode == 0, output[-10000:]
        assert not re.search(r'^\s*not ok \d+', output, re.M), output
        assert re.search(r'^1\.\.\d+$', output, re.M), output
        assert sql(database, "select count(*) from private.partnership_campaign_links;").stdout.strip() == '0', 'fixture did not roll back'
        passes[label] = len(re.findall(r'^\s*ok \d+', output, re.M))
    print(json.dumps({'pgTapPassed': passes, 'rollbackVerified': True, 'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
