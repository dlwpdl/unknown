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
MIGRATIONS = ['20261102120000_event_links.sql', '20261102130000_event_board_phase2.sql', '20261102150000_event_store_uses.sql']
TESTS = ['event_links.test.sql', 'event_board_phase2.test.sql']
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


# Two real sessions on committed rows (pgTAP runs in one transaction and cannot show this): while one sender's claim is still
# open, a second sender gets the other rows at once instead of waiting or taking the same ones, and after both commit the
# lease keeps every claimed row from being handed out again.
RACE_FIXTURE = """
insert into public.cities values('dm-race','DM 경쟁 검사 도시','BC','America/Vancouver',true);
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind)
  values('e2520000-0000-0000-0000-000000000001','DM 경쟁 검사 가게','dm-race','trial','granted','동의 확인','business');
insert into private.partnership_campaigns(id,merchant_id,title,status) values('e2530000-0000-0000-0000-000000000001','e2520000-0000-0000-0000-000000000001','Race event','open');
insert into private.partnership_dm_templates(campaign_id,dm_group,language,body,approved_sha256,approved_at)
  values('e2530000-0000-0000-0000-000000000001','sorry','en','Thanks for applying',encode(sha256(convert_to('Thanks for applying','UTF8')),'hex'),now());
insert into private.partnership_creators(id,display_name,city_id,profile_url)
  select ('e2510000-0000-0000-0000-00000000000'||n)::uuid,'race.'||n,'dm-race','https://www.instagram.com/race.'||n||'/' from generate_series(1,6) n;
insert into private.partnership_participations(id,campaign_id,creator_id,dm_group,dm_channel,dm_status)
  select gen_random_uuid(),'e2530000-0000-0000-0000-000000000001',id,'sorry','instagram','queued' from private.partnership_creators where city_id='dm-race';
"""
CLAIM = "select coalesce(string_agg(e->>'participation_id',',' order by e->>'participation_id'),'') from jsonb_array_elements(public.claim_event_dms({})) e;\n"


def claim_race(database):
    sql(database, RACE_FIXTURE)
    first = subprocess.Popen(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        first.stdin.write('set role service_role;\nbegin;\n' + CLAIM.format(2))
        first.stdin.flush()
        held = set(filter(None, first.stdout.readline().strip().split(',')))
        # lock_timeout: waiting on the first sender's rows would fail this instead of hanging.
        other = set(filter(None, sql(database, "set role service_role;\nset lock_timeout='2s';\n" + CLAIM.format(20)).stdout.strip().split(',')))
        first.stdin.write('commit;\n')
        first.stdin.close()
        assert first.wait(timeout=30) == 0, first.stderr.read()
    finally:
        if first.poll() is None:
            first.kill()
    again = sql(database, 'set role service_role;\n' + CLAIM.format(20)).stdout.strip()
    tries = sql(database, "select string_agg(distinct dm_attempts::text,',') from private.partnership_participations where dm_status='queued';").stdout.strip()
    assert len(held) == 2 and len(other) == 4 and not held & other, (held, other)
    assert again == '' and tries == '1', (again, tries)
    return {'firstSender': len(held), 'secondSenderWhileFirstOpen': len(other), 'overlap': 0, 'reclaimedAfterCommit': 0}


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
    passes, claims = {}, {}
    for label, before in [('without_board_column', ''), ('with_board_column', BOARD)]:
        database = 'event_link_' + label
        command(['docker', 'exec', CONTAINER, 'createdb', '-U', 'supabase_admin', '--template=template0', database])
        sql(database, dump)
        if before:
            sql(database, before)
        # Everything these migrations build on is already in the local source DB; newer unrelated migrations are not replayed.
        for migration in MIGRATIONS:
            sql(database, (ROOT / 'supabase/migrations' / migration).read_text())
        passes[label] = {}
        for test in TESTS:
            result = sql(database, (ROOT / 'supabase/tests' / test).read_text(), False)
            output = result.stdout + result.stderr
            assert result.returncode == 0, output[-10000:]
            assert not re.search(r'^\s*not ok \d+', output, re.M), output
            assert re.search(r'^1\.\.\d+$', output, re.M), output
            assert sql(database, "select count(*) from private.partnership_campaign_links;").stdout.strip() == '0', 'fixture did not roll back'
            passes[label][test] = len(re.findall(r'^\s*ok \d+', output, re.M))
        claims[label] = claim_race(database)
    print(json.dumps({'pgTapPassed': passes, 'claimRace': claims, 'rollbackVerified': True, 'disposableContainer': CONTAINER, 'sharedDatabaseWrites': False}))
finally:
    command(['docker', 'rm', '-f', CONTAINER], check=False)
