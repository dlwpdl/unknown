"""Exercise business identity RPCs on the existing local Postgres, then roll back."""
from pathlib import Path
import re
import runpy
import sys

root = Path(__file__).resolve().parents[1]
helper = runpy.run_path(str(root / 'scripts/check-admin-partnerships.py'))
sql = helper['sql']
source = helper['prerequisites']('postgres')
for table, migration in [('merchant_mcp_connections', '0142_merchant_customer_mcp.sql'),
                         ('merchant_operators', '0143_merchant_account_connections.sql')]:
    if not sql('postgres', f"select to_regclass('private.{table}');").stdout.strip():
        source += (root / 'supabase/migrations' / migration).read_text() + '\n'
identity_source = ''
for name in ['20261018031000_admin_user_business_connections.sql',
             '20261018032000_business_post_identity.sql',
             '20261018033000_business_display_language.sql']:
    identity_source += (root / 'supabase/migrations' / name).read_text() + '\n'
fixture = (root / 'supabase/tests/business_post_identity.test.sql').read_text()
privacy = sys.argv[1:] == ['--privacy']
assert not sys.argv[1:] or privacy, 'usage: check-business-identity.py [--privacy]'
if privacy:
    # Load the exact dependency DDL/functions needed by public activity on older local snapshots.
    if not sql('postgres', "select to_regprocedure('public.get_manner_summary(uuid)');").stdout.strip():
        attendance = (root / 'supabase/migrations/20261011082000_meetup_attendance.sql').read_text()
        reviews = (root / 'supabase/migrations/20261011083000_meetup_reviews.sql').read_text()
        if not sql('postgres', "select to_regclass('private.meetup_sessions');").stdout.strip():
            source += attendance.split('create function', 1)[0]
        if not sql('postgres', "select to_regclass('private.trust_reviews');").stdout.strip():
            source += reviews.split('create function', 1)[0]
        for function in ['private.trust_review_released', 'public.get_manner_summary']:
            source += 'create function ' + function + reviews.split('create function ' + function, 1)[1].split('$$;', 1)[0] + '$$;\n'
    for signature, name in [
        ('public.get_public_user_profile(uuid)', '20261011084000_public_user_activity.sql'),
        ('public.get_shared_link_preview(uuid)', '20261011193000_shared_link_previews.sql'),
        ('public.get_post_poll(uuid)', '20261012180715_post_opinion_polls.sql'),
        ('public.get_discovery_posts(text,smallint,text,timestamptz,uuid,integer)', '20261015212000_unified_discovery_map.sql'),
        ('public.get_public_popular_feed_page(text,smallint,bigint,timestamptz,uuid,timestamptz,integer)', '20261015203000_popular_feed_views.sql')]:
        if not sql('postgres', f"select to_regprocedure('{signature}');").stdout.strip():
            prerequisite = (root / 'supabase/migrations' / name).read_text()
            if name.startswith('20261015212000'):
                prerequisite = prerequisite.split('insert into private.behavior_targets', 1)[0]
            if name.startswith('20261012180715'):
                prerequisite = prerequisite.split('create function public.create_post_with_poll', 1)[0]
            source += prerequisite + '\n'
    if 'auth.uid() is null' not in sql('postgres', "select lower(pg_get_functiondef('public.get_public_post(uuid)'::regprocedure));").stdout:
        source += (root / 'supabase/migrations/20261011194000_login_required_post_content.sql').read_text()
    source += identity_source
    source += (root / 'supabase/migrations/20261018035000_business_public_privacy.sql').read_text() + '\n'
    marker = "select set_config('request.jwt.claims','{\"role\":\"anon\"}'"
    seed = fixture.split(marker, 1)[0].removeprefix('begin;').replace('select no_plan();', '')
    fixture = (root / 'supabase/tests/business_public_privacy.test.sql').read_text().replace(
        '-- The isolated checker injects business_post_identity.test.sql\'s seed prefix here.', seed)
else:
    source += identity_source
assert fixture.startswith('begin;') and fixture.rstrip().endswith('rollback;')
before = sql('postgres', "select to_regprocedure('public.get_public_post_businesses(uuid[])');").stdout
result = sql('postgres', 'begin;\n' + source + fixture.removeprefix('begin;'))
output = result.stdout + result.stderr
assert not re.search(r'^\s*not ok \d+', output, re.MULTILINE), output
assert before == sql('postgres', "select to_regprocedure('public.get_public_post_businesses(uuid[])');").stdout
assert sql('postgres', "select exists(select 1 from auth.users where id='b1800000-0000-4000-8000-000000000001');").stdout.strip() == 'f'
count = len(re.findall(r'^ok \d+', output, re.MULTILINE))
print(f'{count} business identity pgTAP checks passed; shared schema and fixtures rolled back.')
