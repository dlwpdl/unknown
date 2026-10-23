"""Profile identity checks in a temporary schema-only local DB; never hosted SQL."""
from pathlib import Path
import json
import runpy
import re
from concurrent.futures import ThreadPoolExecutor
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
helper = runpy.run_path(str(ROOT / 'scripts/check-admin-partnerships.py'))
command, sql = helper['command'], helper['sql']
MIGRATION = ROOT / 'supabase/migrations/20261019050000_meetup_profile_identity.sql'
SHARED_STATE = """select jsonb_build_object(
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||p.proowner::text||coalesce(p.proacl::text,''),E'\\n' order by p.oid))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f'),
 'classes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','storage','realtime')),
 'users',(select count(*) from auth.users),'objects',(select count(*) from storage.objects));"""
POLICY_STATE = """select md5(pg_get_functiondef('private.membership_details(uuid)'::regprocedure)
 ||pg_get_functiondef('public.respond_meetup_request(uuid,text)'::regprocedure)
 ||pg_get_functiondef('private.lock_relationships()'::regprocedure));"""



def auth(number):
    claims = json.dumps({'sub': f'51910000-0000-4000-8000-{number:012}', 'role': 'authenticated'})
    return f"select set_config('request.jwt.claims','{claims}',true); set local role authenticated;\n"


def concurrency(database):
    sql(database, """
insert into auth.users(id,email) select ('51910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'meetup-race-'||n||'@example.invalid' from generate_series(1,3) n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'Profile race '||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '51910000-%';
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'meetup-profiles',id::text||'/1792380000000-aabbccdd.webp',id::text,'{"size":1024,"mimetype":"image/webp"}'::jsonb
from public.profiles where id::text like '51910000-%';
""")
    for number in range(1, 4):
        owner = f'51910000-0000-4000-8000-{number:012}'
        profile = json.dumps({'version': 2, 'displayName': f'Meetup race {number}', 'cityId': 'vancouver',
                              'photoPaths': [f'{owner}/1792380000000-aabbccdd.webp'], 'publicPhotoPath': None,
                              'intro': 'Synthetic profile', 'interests': ['walk'], 'promptOne': 'Private one',
                              'promptTwo': 'Private two', 'promptOneId': 'meet', 'promptTwoId': 'join'})
        sql(database, f"begin; {auth(number)} select public.save_chilling_profile('{profile}'); commit;")
    post = sql(database, "begin; " + auth(1) + """select public.create_chilling_event('vancouver','Profile concurrency','Synthetic meetup',
'{"eventKind":"group","cadence":"weekly","capacity":2,"hostProfileConsentVersion":"chilling-v2"}'::jsonb||jsonb_build_object('hostProfileRevision',public.get_my_chilling_profile()->>'revision'),'Question?'); commit;""").stdout.strip().splitlines()[-1]

    def race(calls):
        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(lambda call: sql(database, 'begin; ' + auth(call[0]) + call[1] + '; commit;', False), calls))

    calls = [(2, f"select public.request_chilling_join_v2('{post}','Concurrent answer {letter}','chilling-v2',public.get_my_chilling_profile()->>'revision')") for letter in ['A', 'B']]
    results = race(calls)
    assert all(result.returncode == 0 for result in results), [r.stdout + r.stderr for r in results]
    ids = [r.stdout.strip().splitlines()[-1] for r in results]
    assert ids[0] == ids[1], ids
    request = ids[0]
    assert sql(database, f"select count(*),min(answer) in('Concurrent answer A','Concurrent answer B') from private.chilling_applications where id='{request}';").stdout.strip() == '1|t'
    assert sql(database, f"select count(*) from private.chilling_application_history where request_id='{request}';").stdout.strip() == '0'
    other = sql(database, 'begin; ' + auth(3) + f"select public.request_chilling_join_v2('{post}','Other answer','chilling-v2',public.get_my_chilling_profile()->>'revision'); commit;").stdout.strip().splitlines()[-1]
    results = race([(1, f"select public.respond_meetup_request('{rid}','approved')") for rid in [request, other]])
    assert sum(result.returncode == 0 for result in results) == 1, [r.stdout + r.stderr for r in results]
    assert any('MEETUP_FULL' in result.stderr for result in results if result.returncode)
    assert sql(database, f"select count(*) from public.meetup_requests where post_id='{post}' and status='approved';").stdout.strip() == '1'
    assert sql(database, f"select room_preview->>'memberCount' from public.posts where id='{post}';").stdout.strip() == '2'

    approved = sql(database, f"select id,requester_id from public.meetup_requests where post_id='{post}' and status='approved';").stdout.strip().split('|')
    path = approved[1] + '/1792380000000-aabbccdd.webp'
    download = f"""select set_config('storage.operation','storage.object.get_authenticated',true);
do $$ begin if exists(select 1 from storage.objects where bucket_id='meetup-profiles' and name='{path}') then
raise exception 'REVOKED_MEETUP_PHOTO_READ'; end if; end $$"""
    probe = helper['blocked_recheck']
    original_auth = probe.__globals__['AUTH']
    probe.__globals__['AUTH'] = auth(1)
    try:
        probe(database, "do $$ begin perform private.lock_relationships(); end $$; select 1",
              f"update public.meetup_requests set status='cancelled',responded_at=clock_timestamp() where id='{approved[0]}'",
              download, None)
    finally:
        probe.__globals__['AUTH'] = original_auth
    # A preview revision is evaluated before the wait, then checked against the locked row.
    revision = sql(database, "select updated_at::text from private.chilling_profiles where id='51910000-0000-4000-8000-000000000002';").stdout.strip()
    snapshot_before = sql(database, f"select profile::text from private.chilling_applications where id='{request}';").stdout
    probe.__globals__['AUTH'] = auth(2)
    try:
        probe(database, "do $$ begin perform private.lock_relationships(); end $$; select 1",
              "update private.chilling_profiles set profile=profile||'{\"intro\":\"Another device edit\"}',updated_at=clock_timestamp() where id='51910000-0000-4000-8000-000000000002'",
              f"select public.request_chilling_join_v2('{post}','Stale concurrent answer','chilling-v2','{revision}')", 'CHILLING_PROFILE_CHANGED')
    finally:
        probe.__globals__['AUTH'] = original_auth
    assert sql(database, f"select profile::text from private.chilling_applications where id='{request}';").stdout == snapshot_before
    print('PASS: duplicate application keeps one snapshot; last-place approval commits one winner; observed lock waits reject cancelled photo reads and stale profile revision.')


def business_baseline(database):
    """Replay the repository's existing business feed prerequisites in this isolated DB."""
    sql(database, (ROOT / 'supabase/migrations/0146_unlimited_direct_chat.sql').read_text())
    sql(database, helper['prerequisites'](database))
    for table, name in [('merchant_mcp_connections', '0142_merchant_customer_mcp.sql'),
                        ('merchant_operators', '0143_merchant_account_connections.sql')]:
        if not sql(database, f"select to_regclass('private.{table}');").stdout.strip():
            sql(database, (ROOT / 'supabase/migrations' / name).read_text())
    for signature, name in [
        ('public.get_public_user_profile(uuid)', '20261011084000_public_user_activity.sql'),
        ('public.get_shared_link_preview(uuid)', '20261011193000_shared_link_previews.sql'),
        ('public.get_post_poll(uuid)', '20261012180715_post_opinion_polls.sql'),
        ('public.get_discovery_posts(text,smallint,text,timestamptz,uuid,integer)', '20261015212000_unified_discovery_map.sql'),
        ('public.get_public_popular_feed_page(text,smallint,bigint,timestamptz,uuid,timestamptz,integer)', '20261015203000_popular_feed_views.sql')]:
        if not sql(database, f"select to_regprocedure('{signature}');").stdout.strip():
            source = (ROOT / 'supabase/migrations' / name).read_text()
            if name.startswith('20261015212000'):
                source = source.split('insert into private.behavior_targets', 1)[0]
            if name.startswith('20261012180715'):
                source = source.split('create function public.create_post_with_poll', 1)[0]
            sql(database, source)
    if 'auth.uid() is null' not in sql(database, "select lower(pg_get_functiondef('public.get_public_post(uuid)'::regprocedure));").stdout:
        sql(database, (ROOT / 'supabase/migrations/20261011194000_login_required_post_content.sql').read_text())
    for name in ['20261018031000_admin_user_business_connections.sql', '20261018032000_business_post_identity.sql',
                 '20261018033000_business_display_language.sql', '20261018035000_business_public_privacy.sql',
                 '20261018036000_business_publication_readiness.sql', '20261018037000_business_profile_without_posts.sql']:
        sql(database, (ROOT / 'supabase/migrations' / name).read_text())
    # The existing DM checker uses these exact source prerequisites for current tombstones/retention.
    sql(database, (ROOT / 'supabase/migrations/0149_membership_four_tiers.sql').read_text().split('create or replace function private.listing_limit', 1)[0])
    sql(database, 'alter function private.membership_entitlement(uuid,text) owner to postgres;')
    sql(database, (ROOT / 'supabase/migrations/20261011085000_message_safety_context.sql').read_text())
    sql(database, (ROOT / 'supabase/migrations/20261011081500_chat_suggestions.sql').read_text().split('create table', 1)[0])
    for name in ['20261013233000_chat_photo_albums.sql', '0144_message_preview.sql']:
        sql(database, (ROOT / 'supabase/migrations' / name).read_text())
    sql(database, (ROOT / 'supabase/migrations/0138_frequent_city_recommendations.sql').read_text().split('create function', 1)[0])
    sql(database, (ROOT / 'supabase/migrations/20261013234000_selected_city_notifications.sql').read_text().split('do $city$', 1)[0])
    sql(database, """do $$ begin
      execute format('create table realtime.meetup_profile_check_messages partition of realtime.messages for values from (%L) to (%L)',
        date_trunc('day',now()),date_trunc('day',now())+interval '1 day');
    end $$;""")
    for name in ['20261018041000_business_identity_conversations.sql', '20261018042000_business_chat_profiles.sql']:
        sql(database, (ROOT / 'supabase/migrations' / name).read_text())


def check_tap(database, source, label):
    result = sql(database, source, False)
    if result.returncode or re.search(r'^not ok ', result.stdout, re.MULTILINE):
        details = [line for line in result.stdout.splitlines() if line.startswith(('not ok ', '#'))]
        raise AssertionError('\n'.join(details) + '\n' + result.stderr)
    count = len(re.findall(r'^ok ', result.stdout, re.MULTILINE))
    assert re.search(r'^1\.\.\d+$', result.stdout, re.MULTILINE), result.stdout
    print(f'PASS: {count} {label} pgTAP checks; isolated schema-only DB.')

def main():
    database = 'gling_meetup_profile_' + uuid.uuid4().hex[:12]
    created = False
    before = sql('postgres', SHARED_STATE).stdout
    try:
        dump = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                        '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron',
                        '--exclude-extension=pg_net', '--exclude-schema=cron', '--exclude-schema=net'])
        assert dump.returncode == 0, dump.stderr
        result = command(['createdb', '-U', 'supabase_admin', '--template=template0', database])
        assert result.returncode == 0, result.stderr
        created = True
        sql(database, dump.stdout)
        assert sql(database, 'select count(*) from auth.users;').stdout.strip() == '0'
        for table, name in [('meetup_sessions', '20261011082000_meetup_attendance.sql'),
                            ('trust_reviews', '20261011083000_meetup_reviews.sql')]:
            if not sql(database, f"select to_regclass('private.{table}');").stdout.strip():
                sql(database, (ROOT / 'supabase/migrations' / name).read_text())
        business_baseline(database)
        if not sql(database, "select to_regprocedure('private.flush_account_security_logins(timestamptz)');").stdout.strip():
            sql(database, (ROOT / 'supabase/migrations/0153_account_security_notifications.sql').read_text())
        if not sql(database, "select to_regprocedure('private.next_recommendation_slot(timestamptz,text)');").stdout.strip():
            sql(database, 'alter table private.push_delivery_queue add column if not exists first_attempt_at timestamptz;')
            cadence = (ROOT / 'supabase/migrations/20261015093000_recommendation_cadence_timezones.sql').read_text()
            sql(database, cadence.split('-- Saved business recommendations', 1)[0])
        if not sql(database, "select to_regprocedure('private.cached_ticketmaster_event(text,text)');").stdout.strip():
            festivals = (ROOT / 'supabase/migrations/20261011233000_festival_daily.sql').read_text()
            cached = re.search(r'create function private.cached_ticketmaster_event\(.*?\$\$;', festivals, re.S).group()
            sql(database, cached + '\nalter function private.cached_ticketmaster_event(text,text) owner to postgres; revoke all on function private.cached_ticketmaster_event(text,text) from public,anon,authenticated,service_role;')
        # Current production already includes 20261012133000's conversational copy.
        sql(database, (ROOT / 'supabase/tests/fixtures/request_meetup_join_patina.sql').read_text())
        if not sql(database, "select to_regprocedure('private.event_recommendation_key(text,uuid)');").stdout.strip():
            quality = (ROOT / 'supabase/migrations/20261018020000_notification_quality.sql').read_text()
            sql(database, quality.split('create function private.event_recommendation_body', 1)[0])
        sql(database, (ROOT / 'supabase/migrations/20261018203000_notification_patina_copy.sql').read_text())
        # Match 20261013235000's expanded claim return shape and service-only grants.
        sql(database, 'drop function public.claim_push_notifications(text,integer);')
        sql(database, (ROOT / 'supabase/tests/fixtures/claim_push_notifications_patina.sql').read_text())
        sql(database, 'alter function public.claim_push_notifications(text,integer) owner to postgres; revoke all on function public.claim_push_notifications(text,integer) from public,anon,authenticated,service_role; grant execute on function public.claim_push_notifications(text,integer) to service_role;')
        sql(database, "insert into public.cities(id,name,province,timezone,is_open) values('vancouver','Synthetic Vancouver','BC','America/Vancouver',true); insert into public.tags(id,kind,slug,label) values(1,'post','life','일상'),(2,'meetup','meetup','모임'); insert into storage.buckets(id,name,public) values('post-images','post-images',false),('merchant-profile-images','merchant-profile-images',false),('avatars','avatars',false);")
        policies = sql(database, POLICY_STATE).stdout
        request_before = sql(database, "select pg_get_functiondef('private.request_meetup_join(uuid,text)'::regprocedure);").stdout
        suffix = '님이 모임 참여를 신청했어요. 한번 확인해 주세요.'
        notice = '모임 참여 요청이 도착했어요. 한번 확인해 주세요.'
        identity = "(select nickname::text from public.profiles where id = current_user_id) || '" + suffix + "'"
        assert request_before.count(identity) == 1, 'notification baseline differs from the reviewed identity contract'
        if '--red' not in sys.argv:
            sql(database, 'begin;\n' + MIGRATION.read_text() + '\ncommit;')
            request_after = sql(database, "select pg_get_functiondef('private.request_meetup_join(uuid,text)'::regprocedure);").stdout
            assert request_after == request_before.replace(identity, "'" + notice + "'"), 'request checks, routing or Patina copy changed beyond identity removal'
        if '--host-tools' in sys.argv:
            sql(database, (ROOT / 'supabase/migrations/20261019050100_meetup_host_tools.sql').read_text())
        assert policies == sql(database, POLICY_STATE).stdout, 'membership, approval or relationship lock policy changed'
        tests = (ROOT / 'supabase/tests/meetup_profile_identity.test.sql').read_text()
        if '--red' in sys.argv:
            tests = tests.split("select is(public.get_my_chilling_profile()->>'displayName'", 1)[0] + 'select * from finish(); rollback;'
        check_tap(database, tests, 'profile identity')
        if '--business' in sys.argv:
            fixture = (ROOT / 'supabase/tests/business_post_identity.test.sql').read_text()
            seed = fixture.split("select set_config('request.jwt.claims','{\"role\":\"anon\"}'", 1)[0].removeprefix('begin;').replace('select no_plan();', '')
            test = (ROOT / 'supabase/tests/business_public_privacy.test.sql').read_text().replace(
                "-- The isolated checker injects business_post_identity.test.sql's seed prefix here.", seed)
            check_tap(database, test, 'existing business privacy')
            retention = (ROOT / 'supabase/tests/business_dm_retention.test.sql').read_text().replace(
                '-- business dm fixtures', (ROOT / 'supabase/tests/business_dm_fixtures.sql').read_text())
            check_tap(database, retention, 'existing business evidence retention')
        concurrency(database)
        if '--host-tools' in sys.argv:
            host_tests = (ROOT / 'supabase/tests/meetup_host_tools.test.sql').read_text()
            check_tap(database, host_tests, 'combined host tools')
            runpy.run_path(str(ROOT / 'scripts/meetup-host-tools-local.test.py'))['concurrency_checks'](database, host_tests)

    finally:
        if created:
            result = command(['dropdb', '-U', 'supabase_admin', '--force', database])
            assert result.returncode == 0, result.stderr
        assert before == sql('postgres', SHARED_STATE).stdout
        print('Temporary database dropped; shared schema and user count unchanged.')


if __name__ == '__main__':
    main()
