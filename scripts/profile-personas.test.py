import importlib.util
from pathlib import Path
import unittest
import hashlib
import json
import os
import subprocess
import uuid
import tempfile

spec = importlib.util.spec_from_file_location('personas', Path(__file__).with_name('profile-personas.py'))
personas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(personas)


class PersonaTests(unittest.TestCase):
    def setUp(self):
        self.profile = {'id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nickname': '테스트산책', 'city_id': 'vancouver'}
        self.old = {'nickname': '테스트산책', 'city_id': 'vancouver', 'age': 29, 'gender': '여', 'archetype': 4,
                    'initiative': 1, 'directness': 2, 'verbosity': 1, 'focus': 2, 'humor': 1, 'social': 0,
                    'post_window': 2, 'main_tag': 'transport'}

    def test_fills_all_details_and_preserves_existing_character(self):
        p = personas.enrich(self.profile, self.old)
        for key in self.old:
            self.assertEqual(p[key], self.old[key], key)
        for key in ['living', 'background', 'values', 'personality', 'interests', 'writing_purpose', 'voice', 'continuity']:
            self.assertTrue(p[key], key)
        self.assertEqual(p['profile_id'], self.profile['id'])
        self.assertEqual(p['version'], 4)
        self.assertIn('글링 운영 캐릭터', p['bio'])
        self.assertLessEqual(len(p['bio']), 160)

    def test_random_assignment_is_fixed_on_rerun_and_distinct_between_profiles(self):
        self.assertEqual(personas.enrich(self.profile, self.old), personas.enrich(self.profile, self.old))
        other = {**self.profile, 'id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
        a, b = personas.enrich(self.profile, self.old), personas.enrich(other, self.old)
        self.assertNotEqual(a['living'], b['living'])

    def test_future_profile_gets_complete_coherent_persona(self):
        p = personas.enrich(self.profile)
        self.assertGreaterEqual(p['age'], 19)
        self.assertLess(p['living']['residency_years'], p['age'])
        self.assertEqual(len(p['interests']['primary']), 3)
        self.assertEqual(len(p['interests']['occasional']), 2)
        self.assertEqual(len(p['background']), 3)
        self.assertTrue(p['continuity']['fixed_facts'])

    def test_assigned_persona_is_not_randomized_again(self):
        p = personas.enrich(self.profile, self.old)
        p['living']['occupation'] = '사용자가 정한 직업'
        self.assertEqual(personas.enrich(self.profile, assigned=p), p)

    def test_place_language_is_fixed_per_author_and_existing_setting_wins(self):
        a = personas.enrich(self.profile, self.old)
        b = personas.enrich({**self.profile, 'id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}, self.old)
        self.assertEqual(a['voice'].get('place_name_language'), 'ko')
        self.assertEqual(b['voice'].get('place_name_language'), 'en')
        a['voice']['place_name_language'] = 'en'
        self.assertEqual(personas.enrich(self.profile, assigned=a), a)

    def test_backfills_only_the_missing_place_language_without_mutating_persona(self):
        p = personas.enrich(self.profile, self.old)
        p['voice'].pop('place_name_language', None)
        before = json.loads(json.dumps(p))
        enriched = personas.enrich(self.profile, assigned=p)
        self.assertIn(enriched['voice'].get('place_name_language'), ['ko', 'en'])
        stripped = json.loads(json.dumps(enriched))
        stripped['voice'].pop('place_name_language')
        self.assertEqual(stripped, before)
        self.assertEqual(p, before)

    def test_wrong_profile_city_or_incomplete_assignment_is_rejected(self):
        p = personas.enrich(self.profile, self.old)
        for broken in [{**p, 'profile_id': 'different-id'}, {**p, 'city_id': 'toronto'}, {**p, 'voice': None}]:
            with self.assertRaises(ValueError):
                personas.enrich(self.profile, assigned=broken)


    @unittest.skipUnless(os.environ.get('GLING_DB_TEST') == '1', 'use the existing local database explicitly')
    def test_atomic_sync_and_human_scope_guard(self):
        for email, succeeds in [('persona@seed.gling.invalid', True), ('persona-real@example.test', False)]:
            profile = {**self.profile, 'id': str(uuid.uuid4())}
            persona = personas.enrich(profile, self.old)
            row = {'id': profile['id'], 'nickname': profile['nickname'], 'city_id': profile['city_id'],
                   'metadata_md5': hashlib.md5(b'{}').hexdigest(), 'bio_md5': hashlib.md5(b'').hexdigest(), 'persona': persona}
            fixture = "begin;set local role postgres;insert into auth.users(id,email) values('%s','%s');" % (profile['id'], email)
            fixture += "insert into public.profiles(id,nickname,city_id) values('%s','%s','vancouver');" % (profile['id'], profile['nickname'])
            sql = fixture + personas.build_sql([row], commit=False).removeprefix('begin;')
            result = subprocess.run(['docker','exec','-i','supabase_db_gling','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
                                    input=sql,text=True,capture_output=True,timeout=40)
            if succeeds:
                self.assertEqual(result.returncode, 0, result.stderr)
                verification = json.loads(result.stdout.strip().splitlines()[-1])
                self.assertEqual(verification['profiles_verified'], 1)
                self.assertEqual(verification['metadata_updated'], 1)
                self.assertEqual(verification['bios_updated'], 1)
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('SEED_PERSONA_SCOPE_OR_BASELINE_CHANGED', result.stderr)


    @unittest.skipUnless(os.environ.get('GLING_DB_TEST') == '1', 'use the existing local database explicitly')
    def test_existing_publisher_rejects_a_missing_persona(self):
        for ready, account_flag in [(False, None), (True, None), (True, "admin"), (True, "review_access")]:
            ident = str(uuid.uuid4())
            nickname = '페르소나검사' + ident[:8]
            persona = personas.enrich({**self.profile, 'id': ident, 'nickname': nickname}, self.old)
            metadata_value = {'gling_persona': persona} if ready else {}
            if account_flag:
                metadata_value['role' if account_flag == 'admin' else account_flag] = 'admin' if account_flag == 'admin' else True
            metadata = json.dumps(metadata_value, ensure_ascii=False).replace("'", "''")
            fixture = "begin;set local role postgres;insert into auth.users(id,email,raw_app_meta_data) values('%s','publisher@seed.gling.invalid','%s'::jsonb);" % (ident, metadata)
            fixture += "insert into public.profiles(id,nickname,city_id,bio) values('%s','%s','vancouver','%s');" % (ident, nickname, persona['bio'].replace("'", "''"))
            with tempfile.TemporaryDirectory() as folder:
                source = Path(folder) / 'posts.json'
                source.write_text(json.dumps({'posts': [{'ord': 1, 'city_id': 'vancouver', 'author_nickname': nickname,
                    'tag_slug': 'life', 'title': '게시 검사 ' + ident[:8], 'body': '프로필에 페르소나가 연결됐는지 검사해요.', 'source': 'https://example.test'}]}, ensure_ascii=False))
                dry = subprocess.run([str(Path(__file__).with_name('seed-city-posts.sh')), '2026-10-12'],
                    env={**os.environ, 'DRY_RUN': '1', 'POSTS_FILE': str(source), 'GROW': '0'},text=True,capture_output=True,check=True).stdout
            sql = fixture + dry[dry.index('begin;'):].removeprefix('begin;').replace('commit;', 'rollback;')
            result = subprocess.run(['docker','exec','-i','supabase_db_gling','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
                input=sql,text=True,capture_output=True,timeout=40)
            if ready and not account_flag:
                self.assertEqual(result.returncode, 0, result.stderr)
            else:
                self.assertNotEqual(result.returncode, 0, 'publisher accepted an ineligible author')
                self.assertIn('SEED_AUTHOR_NOT_FOUND' if account_flag else 'SEED_PERSONA_NOT_FOUND', result.stderr)


if __name__ == '__main__':
    unittest.main()
