"""Local rollback security checks; never connects to a hosted database."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import re
import runpy
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
helper = runpy.run_path(str(ROOT / 'scripts/check-admin-partnerships.py'))
sql = helper['sql']


def auth(number):
    claims = json.dumps({'sub': f'b1900000-0000-4000-8000-{number:012}', 'role': 'authenticated'})
    return f"select set_config('request.jwt.claims','{claims}',true); set local role authenticated;\n"


def concurrency(prerequisites, source):
    """Committed probes use only a disposable database with schema and synthetic rows."""
    database = 'gling_business_dm_check_' + uuid.uuid4().hex[:12]
    command = helper['command']
    created = False
    probes = []
    try:
        dump = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only',
                        '--no-publications', '--no-subscriptions', '--exclude-extension=pg_cron',
                        '--exclude-extension=pg_net', '--exclude-schema=cron', '--exclude-schema=net'])
        assert dump.returncode == 0, dump.stderr
        result = command(['createdb', '-U', 'supabase_admin', '--template=template0', database])
        assert result.returncode == 0, result.stderr
        created = True
        sql(database, dump.stdout)
        sql(database, 'begin;\n' + prerequisites + source + """
insert into public.cities(id,name,province,timezone,is_open) values('vancouver','Synthetic Vancouver','BC','America/Vancouver',true);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chat-images','chat-images',false,2097152,array['image/webp']);
""" + (ROOT / 'supabase/tests/business_dm_fixtures.sql').read_text() + '\ncommit;')
        business = 'b1910000-0000-4000-8000-000000000001'
        user = 'b1900000-0000-4000-8000-000000000003'
        operator = 'b1900000-0000-4000-8000-000000000002'

        def race(calls):
            with ThreadPoolExecutor(max_workers=2) as pool:
                return list(pool.map(lambda call: sql(database, 'begin;\n' + auth(call[0]) + call[1] + '; commit;', False), calls))

        results = race([(3, f"select public.start_business_conversation(null,'{business}',null)"),
                        (1, f"select public.start_business_conversation('{business}',null,'{user}')")])
        assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
        ids = [r.stdout.strip().splitlines()[-1] for r in results]
        assert ids[0] == ids[1], ids
        conversation = ids[0]
        assert sql(database, "select count(*) from public.conversations where kind='business';").stdout.strip() == '1'
        probes.append('simultaneous personal/business starts return one active room')
        send = f"select public.send_business_chat_message('{conversation}','{business}','b1970000-0000-4000-8000-000000000001',p_body=>'Concurrent synthetic message')"
        results = race([(1, send), (2, send)])
        assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
        ids = [r.stdout.strip().splitlines()[-1] for r in results]
        assert ids[0] == ids[1], ids
        message = ids[0]
        assert sql(database, f"select count(*) from public.messages where id='{message}';").stdout.strip() == '1'
        assert sql(database, f"select count(*) from public.safety_review_queue where target_type='message' and target_id='{message}';").stdout.strip() == '1'
        probes.append('two current business actors retry one token without duplicate message/safety entry')
        edit = f"select public.edit_business_chat_message('{message}','{business}','Concurrent edit')"
        results = race([(1, edit), (2, edit)])
        assert sum(r.returncode == 0 for r in results) == 1, [r.stdout + r.stderr for r in results]
        assert any('MESSAGE_CHANGED' in r.stderr for r in results if r.returncode)
        probes.append('concurrent stale edits preserve one winner and original author')

        wait_probe = helper['blocked_recheck']
        previous_auth = wait_probe.__globals__['AUTH']
        wait_probe.__globals__['AUTH'] = auth(2)
        try:
            merchant_lock = f"select 1 from private.merchants where id='{business}' for update"
            revoke = f"delete from private.merchant_operators where merchant_id='{business}' and user_id='{operator}'"
            restore = f"insert into private.merchant_operators(merchant_id,user_id) values('{business}','{operator}') on conflict do nothing"
            read = f"select public.get_business_chat_messages('{conversation}','{business}')"
            wait_probe(database, merchant_lock, revoke, read, 'CONVERSATION_ACCESS_DENIED')
            sql(database, restore)
            probes.append('read waits for actual connection row lock then rejects revoked role')
            wait_probe(database, merchant_lock, revoke, send.replace('b1970000-0000-4000-8000-000000000001', 'b1970000-0000-4000-8000-000000000002'), 'CONVERSATION_ACCESS_DENIED')
            sql(database, restore)
            probes.append('send waits for actual connection row lock then rejects revoked role')
            wait_probe(database, f"select 1 from auth.users where id='{operator}' for update",
                       f"update auth.users set raw_app_meta_data='{{}}' where id='{operator}'", read, 'CONVERSATION_ACCESS_DENIED')
            sql(database, f"update auth.users set raw_app_meta_data='{{\"merchant_enabled\":true}}' where id='{operator}'")
            probes.append('read rechecks current enabled account after auth-row lock wait')
            path = f'{business}/{conversation}_1792280000000-Concurrency.webp'
            sql(database, f"insert into storage.objects(bucket_id,name,owner_id) values('chat-images','{path}','{operator}');")
            download = f"""select set_config('storage.operation','storage.object.get_authenticated',true);
do $$ begin if exists(select 1 from storage.objects where bucket_id='chat-images' and name='{path}') then
raise exception 'REVOKED_UPLOADER_BYPASS'; end if; end $$"""
            wait_probe(database, merchant_lock, revoke, download, None)
            sql(database, restore)
            probes.append('authenticated storage request waits for role revoke and rejects real uploader bypass')
            wait_probe.__globals__['AUTH'] = auth(1)
            sql(database, "delete from private.action_rate_events where user_id='b1900000-0000-4000-8000-000000000001';")
            withdrawal = f"update private.merchants set updated_at=clock_timestamp() where id='{business}'; " + revoke
            wait_probe(database, f"select 1 from auth.users where id='{operator}' for update", withdrawal,
                       send.replace('b1970000-0000-4000-8000-000000000001', 'b1970000-0000-4000-8000-000000000003'), None)
            sql(database, restore)
            probes.append('operator self-disconnect and owner notification fanout share account-before-merchant lock order')
        finally:
            wait_probe.__globals__['AUTH'] = previous_auth
        retained = """select jsonb_build_object('message',(select jsonb_agg(to_jsonb(m) order by id) from public.messages m),
          'history',(select jsonb_agg(to_jsonb(h) order by id) from private.message_history h),
          'safety',(select jsonb_agg(to_jsonb(q) order by id) from public.safety_review_queue q));"""
        before_stop = sql(database, retained).stdout
        sql(database, (ROOT / 'supabase/tests/business_dm_rollback.sql').read_text())
        assert sql(database, retained).stdout == before_stop, 'stop rollback changed retained evidence'
        assert sql(database, "select has_function_privilege('authenticated','public.start_business_conversation(uuid,uuid,uuid,uuid)','execute');").stdout.strip() == 'f'
        stopped = sql(database, 'begin;\n' + auth(3) + f"select public.get_merchant_profile('{business}')->>'can_business_message'; rollback;")
        assert stopped.stdout.strip().splitlines()[-1] == 'false', stopped.stdout
        probes.append('stop rollback disables entry points and preserves messages, history and safety queue')
        print(f'{len(probes)} isolated concurrency checks passed: ' + '; '.join(probes), flush=True)
    finally:
        if created:
            dropped = command(['dropdb', '-U', 'supabase_admin', '--force', database])
            assert dropped.returncode == 0, dropped.stderr


def main():
    original = sys.argv
    try:
        sys.argv = ['check-business-identity.py', '--profiles']
        prerequisites = runpy.run_path(str(ROOT / 'scripts/check-business-identity.py'))['source']
    finally:
        sys.argv = original
    # Preserve the real migration order: privacy adds the old-client post guard.
    prerequisites = (ROOT / 'supabase/migrations/0146_unlimited_direct_chat.sql').read_text() + '\n' + prerequisites
    prerequisites += (ROOT / 'supabase/migrations/0149_membership_four_tiers.sql').read_text().split('create or replace function private.listing_limit', 1)[0]
    prerequisites += 'alter function private.membership_entitlement(uuid,text) owner to postgres;\n'
    prerequisites += (ROOT / 'supabase/migrations/20261011085000_message_safety_context.sql').read_text()
    prerequisites += (ROOT / 'supabase/migrations/20261011081500_chat_suggestions.sql').read_text().split('create table', 1)[0]
    for name in ['20261013233000_chat_photo_albums.sql', '0144_message_preview.sql']:
        prerequisites += (ROOT / 'supabase/migrations' / name).read_text() + '\n'
    prerequisites += (ROOT / 'supabase/migrations/0138_frequent_city_recommendations.sql').read_text().split('create function', 1)[0]
    prerequisites += (ROOT / 'supabase/migrations/20261013234000_selected_city_notifications.sql').read_text().split('do $city$', 1)[0]
    # The stopped local Realtime container has no current-day partition.
    prerequisites += """do $$ begin
      execute format('create table realtime.business_dm_check_messages partition of realtime.messages for values from (%L) to (%L)',
        date_trunc('day',now()),date_trunc('day',now())+interval '1 day');
    end $$;
    """
    migration = ROOT / 'supabase/migrations/20261018041000_business_identity_conversations.sql'
    source = migration.read_text() if migration.exists() else ''
    snapshot = """select jsonb_build_object(
      'functions',(select md5(string_agg(pg_get_functiondef(p.oid),E'\\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
      'classes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','realtime','storage')),
      'users',(select count(*) from auth.users),
      'fixtures',(select count(*) from auth.users where id::text like 'b1900000-%'));"""
    before = sql('postgres', snapshot).stdout
    count = 0
    failures = []
    paths = sorted((ROOT / 'supabase/tests').glob('business_dm*.test.sql'))
    paths += [ROOT / 'supabase/tests' / name for name in [
        'free_direct_chat.test.sql', 'chat_inbox_pages.test.sql', 'chat_read_attachments.test.sql',
        'chat_message_controls.test.sql', 'chat_photo_album.test.sql', 'chat_message_evidence.test.sql',
        'message_safety_context.test.sql', 'admin_conversations.test.sql']]
    for path in paths:
        test = path.read_text().replace('-- business dm fixtures', (ROOT / 'supabase/tests/business_dm_fixtures.sql').read_text())
        result = sql('postgres', 'begin;\n' + prerequisites + source + test.removeprefix('begin;'))
        output = result.stdout + result.stderr
        if re.search(r'^\s*not ok \d+', output, re.MULTILINE):
            failures.append(path.name + '\n' + output)
        assert re.search(r'^1\.\.\d+$', output, re.MULTILINE), output
        assert 'WarnSendingBroadcastMessage' not in output, output
        assert before == sql('postgres', snapshot).stdout, 'shared local schema or fixture state changed'
        passed = len(re.findall(r'^ok ', output, re.MULTILINE))
        count += passed
        failed = len(re.findall(r'^not ok ', output, re.MULTILINE))
        print(f'{path.name}: {passed} passed, {failed} failed; rolled back.', flush=True)
        if failed:
            print('\n'.join(line for line in output.splitlines() if line.startswith(('not ok ', '#'))), flush=True)
    print(f'{count} business DM and personal/safety regression checks passed; rolled back.')
    concurrency(prerequisites, source)
    assert not failures, '\n'.join(failures)


if __name__ == '__main__':
    main()
