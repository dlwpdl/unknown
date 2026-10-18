"""Commit nickname and connection race probes only in a temporary schema-only DB."""
from pathlib import Path
import runpy
import uuid

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / 'scripts/check-admin-partnerships.py'))
command, sql = helpers['command'], helpers['sql']
race, blocked_recheck = helpers['race'], helpers['blocked_recheck']
ADMIN, SESSION = helpers['ADMIN'], helpers['SESSION']
TARGET = 'a1800000-0000-4000-8000-000000000002'
CITY = 'nickname-race-test'
MIGRATION = ROOT / 'supabase/migrations/20261018030000_profile_nickname.sql'


def shared_state():
    return sql('postgres', f"""
select coalesce(md5(pg_get_functiondef(to_regprocedure('public.change_profile_nickname(uuid,text,text)'))),'missing'),
  (select count(*) from auth.users where id in ('{ADMIN}','{TARGET}')),
  (select count(*) from public.cities where id='{CITY}'),
  coalesce(md5(pg_get_functiondef(to_regprocedure('public.connect_admin_merchant_account(uuid,uuid,text,text,boolean,text,timestamptz,text,text)'))),'missing');
""").stdout


def main():
    before = shared_state()
    database = 'gling_nickname_race_' + uuid.uuid4().hex[:12]
    created = False
    probes = []
    try:
        dump = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                        '--no-publications', '--no-subscriptions',
                        '--exclude-extension=pg_cron', '--exclude-extension=pg_net',
                        '--exclude-schema=cron', '--exclude-schema=net'])
        assert dump.returncode == 0, dump.stderr
        result = command(['createdb', '-U', 'supabase_admin', '--template=template0', database])
        assert result.returncode == 0, result.stderr
        created = True
        sql(database, dump.stdout)
        assert sql(database, 'select count(*) from auth.users;').stdout.strip() == '0', 'live users copied'
        sql(database, 'begin;\n' + MIGRATION.read_text() + f"""
insert into public.cities(id,name,province,timezone,is_open)
  values('{CITY}','Nickname race test','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
  ('{ADMIN}','nickname-race-admin@example.invalid','{{"role":"admin"}}'),
  ('{TARGET}','nickname-race-member@example.invalid','{{}}');
insert into public.profiles(id,nickname,city_id) values
  ('{ADMIN}','Nick Race Admin','{CITY}'),('{TARGET}','Race Original','{CITY}');
insert into auth.sessions(id,user_id,aal) values('{SESSION}','{ADMIN}','aal2');
commit;
""")
        edits = [f"select public.change_profile_nickname('{TARGET}','Race Winner {letter}','Race Original')" for letter in ('A', 'B')]
        race(database, edits, 'NICKNAME_CHANGED')
        current = sql(database, f"select nickname from public.profiles where id='{TARGET}';").stdout.strip()
        assert current in ('Race Winner A', 'Race Winner B'), current
        assert sql(database, f"select count(*) from public.admin_access_logs where actor_id='{ADMIN}' and subject_user_id='{TARGET}';").stdout.strip() == '1'
        probes.append('simultaneous exact-old edits commit one winner and reject the loser as NICKNAME_CHANGED')

        # The helper observes pg_stat_activity.wait_event_type=Lock before release.
        sql(database, f"update auth.sessions set not_after=clock_timestamp()+interval '3 seconds' where id='{SESSION}';")
        blocked_recheck(database,
                        f"select 1 from public.profiles where id='{TARGET}' for update",
                        'select pg_sleep(3.1)',
                        f"select public.change_profile_nickname('{TARGET}','Expired Admin Edit','{current}')",
                        'AUTH_REQUIRED')
        assert sql(database, f"select nickname from public.profiles where id='{TARGET}';").stdout.strip() == current
        assert sql(database, f"select count(*) from public.admin_access_logs where actor_id='{ADMIN}' and subject_user_id='{TARGET}';").stdout.strip() == '1'
        probes.append('observed target-profile lock wait rechecks wall-clock session expiry and commits no edit or audit')
        sql(database, f"update auth.sessions set not_after=null where id='{SESSION}';")

        # This is the legacy connection LOCK SEQUENCE, not its full mutation RPC.
        legacy_profiles = f"""set local lock_timeout='5s'; set local statement_timeout='8s';
do $$begin
  perform 1 from public.profiles where id in ('{ADMIN}','{TARGET}') order by id for share;
end;$$;
select 1"""
        legacy_auth = f"""select 1 from auth.users where id in ('{ADMIN}','{TARGET}') order by id for update;
select pg_sleep(0.1)"""
        blocked_recheck(database, legacy_profiles, legacy_auth,
                        f"select public.change_profile_nickname('{TARGET}','Lock Order Edit','{current}')", None)
        assert sql(database, f"select nickname from public.profiles where id='{TARGET}';").stdout.strip() == 'Lock Order Edit'
        assert sql(database, f"select count(*) from public.admin_access_logs where actor_id='{ADMIN}' and subject_user_id='{TARGET}';").stdout.strip() == '2'
        probes.append('nickname RPC and synthetic connection-style profile-share then auth-update locks complete without deadlock')
        source = helpers['prerequisites'](database)
        for table, name in [('merchant_mcp_connections', '0142_merchant_customer_mcp.sql'),
                            ('merchant_operators', '0143_merchant_account_connections.sql')]:
            if not sql(database, f"select to_regclass('private.{table}');").stdout.strip():
                source += (ROOT / 'supabase/migrations' / name).read_text() + '\n'
        source += (ROOT / 'supabase/migrations/20261018031000_admin_user_business_connections.sql').read_text()
        merchant = 'a1810000-0000-4000-8000-000000000001'
        sql(database, 'begin;\n' + source + f"""
insert into private.merchants(id,name,city_id,record_kind,status,consent,consent_note)
  values('{merchant}','Synthetic linked business','{CITY}','business','lead','pending','');
commit;
""")
        revision = sql(database, f"select updated_at from private.merchants where id='{merchant}';").stdout.strip()
        connection_state = f"""select jsonb_build_object(
  'owner',(select owner_id from private.merchants where id='{merchant}'),
  'verified',(select owner_verified_at from private.merchants where id='{merchant}'),
  'revision',(select updated_at from private.merchants where id='{merchant}'),
  'metadata',(select raw_app_meta_data from auth.users where id='{TARGET}'),
  'connection_audit',(select count(*) from private.merchant_connection_audit),
  'access_audit',(select count(*) from public.admin_access_logs where actor_id='{ADMIN}'));"""
        connection_before = sql(database, connection_state).stdout
        sql(database, f"update auth.sessions set not_after=clock_timestamp()+interval '3 seconds' where id='{SESSION}';")
        blocked_recheck(database,
                        f"select 1 from private.merchants where id='{merchant}' for update",
                        'select pg_sleep(3.1)',
                        f"select public.connect_admin_merchant_account('{merchant}','{TARGET}','owner','direct',true,'Synthetic verified owner connection','{revision}','Lock Order Edit','nickname-race-member@example.invalid')",
                        'ADMIN_REQUIRED')
        assert sql(database, connection_state).stdout == connection_before, 'expired connection changed owner, access, revision or audit'
        probes.append('actual owner-connection RPC rejects AAL2 session expiry after observed merchant-lock wait without owner, capability or audit changes')
        print(f'{len(probes)} committed nickname/connection concurrency probes passed in isolated schema-only database.', flush=True)
        for probe in probes:
            print('  PASS ' + probe, flush=True)
    finally:
        if created:
            dropped = command(['dropdb', '-U', 'supabase_admin', '--force', database])
            assert dropped.returncode == 0, dropped.stderr
            assert sql('postgres', f"select count(*) from pg_database where datname='{database}';").stdout.strip() == '0'
            print('Temporary database dropped.', flush=True)
        assert shared_state() == before, 'shared nickname schema or synthetic fixture state changed'
        print('Shared postgres schema and synthetic fixture state unchanged; no live rows copied or mutated.', flush=True)


if __name__ == '__main__':
    main()
