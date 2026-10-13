import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo


path = Path(__file__).with_name('city-post-schedule.py')
schedule = None
if path.exists():
    spec = importlib.util.spec_from_file_location('city_schedule', path)
    schedule = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(schedule)


def drafts():
    return {'posts': [
        {'ord': n * 5 + i + 1, 'city_id': city, 'author_nickname': 'existing seed',
         'tag_slug': 'life', 'title': f'{city} {i}', 'body': 'Kitsilano 산책',
         'source': 'https://example.com/official'}
        for n, city in enumerate(['vancouver', 'toronto', 'montreal', 'edmonton', 'calgary'])
        for i in range(5)
    ]}


def story_drafts():
    data = drafts()
    for n, city in enumerate(schedule.CITIES):
        data['posts'].append({
            'ord': 26 + n, 'city_id': city, 'author_nickname': 'existing seed',
            'tag_slug': 'life', 'content_kind': 'community_story', 'title': city + ' story',
            'body': '장기 숙박 부탁을 거절하기 어려운 이야기.\n\n해외생활 사연을 참고해 재구성한 이야기예요.',
            'source': 'https://www.teamblind.com/kr/post/7ic6zonq',
            'source_review': {'access': 'public_full_body_read', 'original_conflict': '친구의 장기 숙박과 집 규칙',
                              'fictional_changes': ['도시와 화자의 생활 조건을 변경']},
        })
    return data


class CityScheduleTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(schedule, '실제 분산 게시 큐가 아직 구현되지 않았다')

    def test_korean_display_name_keeps_the_same_canonical_maps_search_and_schedule(self):
        data = drafts()
        data['posts'][0].update(place_name='Kitsilano', place_display_name='킷실라노', body='킷실라노 산책')
        try:
            queued = schedule.prepare(data, '2026-10-12')
        except ValueError as error:
            self.fail(f'한국어 표기와 공식 지도 검색어를 연결하지 못함: {error}')
        first = queued['posts'][0]
        self.assertTrue(first['body'].startswith('킷실라노 산책'))
        self.assertEqual(parse_qs(urlparse(first['body'].split('Google 지도: ')[1]).query)['query'], ['Kitsilano, Vancouver, Canada'])
        original = drafts()
        original['posts'][0].update(place_name='Kitsilano')
        self.assertEqual([p['publish_at'] for p in queued['posts']], [p['publish_at'] for p in schedule.prepare(original, '2026-10-12')['posts']])
        data['posts'][0]['place_display_name'] = '다른 장소'
        with self.assertRaises(ValueError): schedule.prepare(data, '2026-10-12')

    def test_random_times_spread_each_city_day_and_do_not_change_on_retry(self):
        zones = {'vancouver': 'America/Vancouver', 'toronto': 'America/Toronto',
                 'montreal': 'America/Toronto', 'edmonton': 'America/Edmonton', 'calgary': 'America/Edmonton'}
        for day in ['2026-10-12', '2026-11-01', '2027-03-14']:
            queued = schedule.prepare(drafts(), day)
            self.assertEqual(queued, schedule.prepare(drafts(), day))
            times = sorted(datetime.fromisoformat(p['publish_at']) for p in queued['posts'])
            self.assertEqual(len(set(times)), 25)
            self.assertTrue(all((b - a).total_seconds() >= 600 for a, b in zip(times, times[1:])))
            for city, zone in zones.items():
                local = [datetime.fromisoformat(p['publish_at']).astimezone(ZoneInfo(zone))
                         for p in queued['posts'] if p['city_id'] == city]
                self.assertEqual(len(local), 5)
                self.assertTrue(all(str(t.date()) == day and 9 <= t.hour < 21 for t in local))
                self.assertEqual(sorted((t.hour * 60 + t.minute - 540) // 144 for t in local), [0, 1, 2, 3, 4])
        self.assertNotEqual(schedule.prepare(drafts(), '2026-10-12')['posts'][0]['publish_at'],
                            schedule.prepare(drafts(), '2026-10-13')['posts'][0]['publish_at'])

    def test_nothing_before_due_and_sleep_recovery_returns_only_one_post(self):
        queued = schedule.prepare(drafts(), '2026-10-12')
        first = min(datetime.fromisoformat(p['publish_at']) for p in queued['posts'])
        self.assertIsNone(schedule.due(queued, '2026-10-12', {}, first - timedelta(seconds=1)))
        picked = schedule.due(queued, '2026-10-12', {}, first)
        self.assertEqual(datetime.fromisoformat(picked['publish_at']), first)
        self.assertIsInstance(schedule.due(queued, '2026-10-12', {}, datetime(2026, 10, 12, 21, tzinfo=timezone.utc)), dict)

    def test_sleep_recovery_does_not_publish_outside_the_city_local_day_window(self):
        queued = schedule.prepare(drafts(), '2026-10-12')
        # Vancouver20:00이고 Toronto23:00이면 Toronto의 밀린 글은 보내지 않는다.
        at = datetime(2026, 10, 13, 3, tzinfo=timezone.utc)
        picked = schedule.due(queued, '2026-10-12', {}, at)
        self.assertEqual(picked['city_id'], 'vancouver')
        self.assertIsNone(schedule.due(queued, '2026-10-12', {}, at + timedelta(hours=1)))

    def test_attempted_or_confirmed_post_cannot_be_blindly_submitted_again(self):
        queued = schedule.prepare(drafts(), '2026-10-12')
        at = datetime(2026, 10, 12, 21, tzinfo=timezone.utc)
        first = schedule.due(queued, '2026-10-12', {}, at)
        receipt = {schedule.key(first): {'status': 'attempted'}}
        second = schedule.due(queued, '2026-10-12', receipt, at)
        self.assertNotEqual(schedule.key(first), schedule.key(second))
        receipt = {schedule.key(p): {'status': 'confirmed'} for p in queued['posts']}
        self.assertIsNone(schedule.due(queued, '2026-10-12', receipt, at))

    def test_repeated_trigger_cannot_publish_a_backlog_in_a_burst(self):
        queued = schedule.prepare(drafts(), '2026-10-12')
        at = datetime(2026, 10, 12, 21, tzinfo=timezone.utc)
        first = schedule.due(queued, '2026-10-12', {}, at)
        receipt = {schedule.key(first): {'status': 'attempted', 'attempted_at': at.isoformat()}}
        self.assertIsNone(schedule.due(queued, '2026-10-12', receipt, at + timedelta(seconds=299)))
        next_post = schedule.due(queued, '2026-10-12', receipt, at + timedelta(minutes=5))
        self.assertNotEqual(schedule.key(first), schedule.key(next_post))

    def test_old_payload_and_previous_day_are_not_replayed(self):
        self.assertIsNone(schedule.due(drafts(), '2026-10-12', {}, datetime(2026, 10, 12, 20, tzinfo=timezone.utc)))
        queued = schedule.prepare(drafts(), '2026-10-12')
        self.assertIsNone(schedule.due(queued, '2026-10-12', {}, datetime(2026, 10, 13, 8, tzinfo=timezone.utc)))

    def test_verified_roman_place_name_and_address_reach_maps_query(self):
        data = drafts()
        data['posts'][0].update(place_name='Kitsilano', place_address='Vancouver, BC')
        post = schedule.prepare(data, '2026-10-12')['posts'][0]
        url = post['body'].split('Google 지도: ')[1]
        self.assertEqual(urlparse(url).netloc, 'www.google.com')
        self.assertEqual(parse_qs(urlparse(url).query), {'api': ['1'], 'query': ['Kitsilano, Vancouver, BC, Vancouver, Canada']})
        self.assertEqual(post['body'].split('\n\nGoogle 지도:')[0], 'Kitsilano 산책')
        data['posts'][0].update(place_name='Musée des beaux-arts de Montréal', place_address='1380 Rue Sherbrooke Ouest')
        data['posts'][0]['body'] = 'Musée des beaux-arts de Montréal 전시 안내'
        self.assertIn('Google 지도: ', schedule.prepare(data, '2026-10-12')['posts'][0]['body'])

    def test_unknown_names_invalid_city_counts_and_sql_delimiters_are_rejected(self):
        for name in ['킷실라노', 'Fake Place']:
            data = drafts(); data['posts'][0]['place_name'] = name
            with self.assertRaises(ValueError): schedule.prepare(data, '2026-10-12')
        data = drafts(); data['posts'].pop()
        with self.assertRaises(ValueError): schedule.prepare(data, '2026-10-12')
        data = drafts(); data['posts'][0]['body'] = '$GLING$; drop table public.posts;'
        with self.assertRaises(ValueError): schedule.prepare(data, '2026-10-12')

    def test_staging_is_atomic_and_does_not_replace_an_existing_different_queue(self):
        with TemporaryDirectory() as directory:
            source, dest = Path(directory) / 'source.json', Path(directory) / 'queue.json'
            source.write_text(json.dumps(drafts()))
            schedule.stage(source, dest, '2026-10-12')
            before = dest.read_bytes()
            schedule.stage(source, dest, '2026-10-12')
            self.assertEqual(dest.read_bytes(), before)
            data = drafts(); data['posts'][0]['title'] = '다른 글'
            source.write_text(json.dumps(data))
            with self.assertRaises(ValueError): schedule.stage(source, dest, '2026-10-12')
            self.assertEqual(dest.read_bytes(), before)

    def test_confirmation_requires_the_requested_author_not_a_similar_user_post(self):
        post = schedule.prepare(drafts(), '2026-10-12')['posts'][0]
        with TemporaryDirectory() as directory:
            receipt = Path(directory) / 'receipt.json'
            argv = [sys.executable, str(path), 'confirm', str(receipt), json.dumps([post])]
            schedule.save(receipt, {schedule.key(post): {'status': 'attempted'}})
            result = [{'id': '11111111-1111-4111-8111-111111111111', 'city_id': 'vancouver', 'title': 'vancouver 0', 'created_at': '2026-10-12T14:00:00+00:00', 'author_nickname': 'other user'}]
            run = subprocess.run(argv, input=json.dumps(result), capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(json.loads(receipt.read_text())[schedule.key(post)]['status'], 'attempted')
            result[0]['author_nickname'] = 'existing seed'
            run = subprocess.run(argv, input=json.dumps(result), capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(json.loads(receipt.read_text())[schedule.key(post)]['status'], 'confirmed')

    def test_five_regular_and_one_story_per_city_have_six_random_separate_bands(self):
        for day in ['2026-10-13', '2026-11-01', '2027-03-14']:
            queued = schedule.prepare(story_drafts(), day)
            self.assertEqual(queued['queue_version'], 2)
            self.assertEqual(queued, schedule.prepare(story_drafts(), day))
            times = sorted(datetime.fromisoformat(p['publish_at']) for p in queued['posts'])
            self.assertEqual(len(set(times)), 30)
            self.assertTrue(all((b-a).total_seconds() >= 600 for a,b in zip(times,times[1:])))
            for city, (_, zone) in schedule.CITIES.items():
                posts = [p for p in queued['posts'] if p['city_id'] == city]
                self.assertEqual(len(posts), 6)
                self.assertEqual(sum(p.get('content_kind') == 'community_story' for p in posts), 1)
                local = [datetime.fromisoformat(p['publish_at']).astimezone(ZoneInfo(zone)) for p in posts]
                self.assertTrue(all(str(t.date()) == day and 9 <= t.hour < 21 for t in local))
                self.assertEqual(sorted((t.hour*60+t.minute-540)//120 for t in local), list(range(6)))
            first = times[0]
            picked = schedule.due(queued, day, {}, first)
            self.assertEqual(datetime.fromisoformat(picked['publish_at']), first)
            self.assertIsNone(schedule.due(queued, day, {schedule.key(picked): {'attempted_at': first.isoformat()}}, first+timedelta(seconds=299)))

    def test_story_requires_read_original_source_and_disclosure(self):
        for field, value in [('source', ''), ('source', 'javascript:alert(1)'),
                             ('source_review', {'access': 'search_snippet_only'}),
                             ('body', '각색임을 밝히지 않은 경험담')]:
            data = story_drafts(); data['posts'][-1][field] = value
            with self.assertRaises(ValueError): schedule.prepare(data, '2026-10-13')

    def test_thirty_regular_posts_and_two_stories_in_one_city_are_rejected(self):
        data = story_drafts()
        for post in data['posts']: post.pop('content_kind', None)
        with self.assertRaises(ValueError): schedule.prepare(data, '2026-10-13')
        data = story_drafts(); data['posts'][0].update(data['posts'][-5], ord=1, title='second story')
        with self.assertRaises(ValueError): schedule.prepare(data, '2026-10-13')

    def test_old_five_post_queue_keeps_version_and_is_not_replaced_with_new_stories(self):
        old = schedule.prepare(drafts(), '2026-10-13')
        self.assertEqual(old['queue_version'], 1)
        with TemporaryDirectory() as directory:
            dest, source = Path(directory)/'old-queue.json', Path(directory)/'source.json'
            schedule.save(dest, old); before = dest.read_bytes()
            source.write_text(json.dumps(story_drafts()))
            with self.assertRaises(ValueError): schedule.stage(source, dest, '2026-10-13')
            self.assertEqual(dest.read_bytes(), before)
        first = min(datetime.fromisoformat(p['publish_at']) for p in old['posts'])
        self.assertIsNotNone(schedule.due(old, '2026-10-13', {}, first))

    def test_existing_shell_stages_new_story_queue_without_publication(self):
        with TemporaryDirectory() as directory:
            source = Path(directory)/'source.json'
            source.write_text(json.dumps(story_drafts()))
            script = path.with_name('seed-city-posts.sh')
            env = {**os.environ, 'POSTS_FILE': str(source), 'CITY_POSTS_DIR': directory,
                   'STAGE': '1', 'SCHEDULED': '1', 'DRY_RUN': '1'}
            run = subprocess.run(['bash', str(script), '2026-10-13'], env=env, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            queued = json.loads((Path(directory)/'payload/2026-10-13.json').read_text())
            self.assertEqual(queued['queue_version'], 2)
            self.assertEqual(len(queued['posts']), 30)
            self.assertEqual([p['source_review'] for p in queued['posts'] if p.get('content_kind') == 'community_story'],
                             [p['source_review'] for p in story_drafts()['posts'] if p.get('content_kind') == 'community_story'])
            self.assertFalse((Path(directory)/'receipts').exists())


if __name__ == '__main__':
    unittest.main()
