"""Account, credential, stale-slot and duplicate-write boundaries; no live writes."""
import json
import os
import tempfile
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit, parse_qs

import meta_api
from meta_api import MetaClient, MetaError, date, once, refresh_due, validate_intent, operation_receipt, due_threads, validate_source, main


class MetaChecks(unittest.TestCase):
    def test_shared_post_url_vectors_and_invalid_ids(self):
        first = '123e4567-e89b-42d3-a456-426614174000'
        actual = 'b20b2f28-5902-461d-8ffc-ffef3f23b2c0'
        self.assertEqual(meta_api.shared_post_url(first), 'https://gling-share-preview.vercel.app/s/Ej5FZ-ibQtOkVkJmFBdAAA')
        self.assertEqual(meta_api.shared_post_url(actual), 'https://gling-share-preview.vercel.app/s/sgsvKFkCRh2P_P_vPyOywA')
        self.assertEqual(meta_api.shared_post_url(actual.upper()), meta_api.shared_post_url(actual))
        for value in (None, 12, '', 'post-1', actual.replace('-', ''), '{' + actual + '}',
                      'urn:uuid:' + actual, actual + '\n', actual + '/extra'):
            with self.subTest(value=value), self.assertRaises(MetaError):
                meta_api.shared_post_url(value)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.now = datetime(2026, 10, 10, 20, tzinfo=timezone.utc)
        self.credentials = self.root / 'threads-api.json'
        self.credentials.write_text(json.dumps({
            'access_token': 'private-token', 'username': 'gling.app',
            'user_id': '39140519375592400', 'issued_at': self.now.isoformat(),
        }))
        self.credentials.chmod(0o600)
        self.approval = self.root / 'approval.json'
        self.approval.write_text('{"quote":"existing approval"}')

    def tearDown(self):
        self.tmp.cleanup()

    def test_approval_relative_batch_is_even_repeatable_and_has_no_fixed_clock_times(self):
        ids = ['draft-' + str(i) for i in range(8)]
        first = meta_api.approval_slots(self.now, ids)
        self.assertEqual(first, meta_api.approval_slots(self.now, ids))
        times = [date(row['scheduled_for']) for row in first]
        self.assertTrue(all(at.minute % 5 == 0 and at.second == 0 for at in times))
        self.assertTrue(all(self.now + timedelta(minutes=30) <= at < self.now + timedelta(hours=23) for at in times))
        self.assertTrue(all(timedelta(hours=2.5) <= b-a <= timedelta(hours=3.5) for a,b in zip(times,times[1:])))
        late = self.now + timedelta(hours=7)
        shifted = meta_api.approval_slots(late, ids)
        self.assertTrue(all(date(row['scheduled_for']) >= late + timedelta(minutes=30) for row in shifted))
        occupied = [times[0]]
        with self.assertRaisesRegex(MetaError, 'existing_reservation'):
            meta_api.approval_slots(self.now, ids, occupied)

    def test_relative_schedule_requires_exact_owner_approval_and_cannot_change_copy(self):
        intent = dict(self.intent(), schedule_mode='approval_relative', batch_id='morning-1',
                      scheduled_for=(self.now + timedelta(hours=1)).isoformat())
        with self.assertRaisesRegex(MetaError, 'morning_batch'):
            validate_intent(intent, self.now)
        approved = {k:intent[k] for k in ('platform','account','content_id','copy_sha256')}
        self.approval.write_text(json.dumps({'kind':'morning_batch', 'batch_id':'morning-1',
            'approved_at':self.now.isoformat(), 'owner_quote':'이 8개 올리자', 'items':[approved]}))
        validate_intent(intent, self.now)
        for change in ({'copy_sha256':'changed'}, {'account':'chalkakandupload'}, {'batch_id':'other'},
                       {'scheduled_for':(self.now + timedelta(hours=24)).isoformat()}):
            with self.subTest(change=change), self.assertRaises(MetaError):
                validate_intent(dict(intent, **change), self.now)

    def test_eighteen_approved_contents_keep_daily_pace_across_days(self):
        ids = ['reel-' + str(i) for i in range(18)]
        planned = meta_api.approval_slots(self.now, ids)
        self.assertEqual(planned, meta_api.approval_slots(self.now, ids))
        times = [date(row['scheduled_for']) for row in planned]
        self.assertEqual(len(times), 18)
        self.assertTrue(self.now + timedelta(hours=51) < times[-1] < self.now + timedelta(hours=53))
        self.assertTrue(all(timedelta(hours=2.5) <= b-a <= timedelta(hours=3.5)
                            for a, b in zip(times, times[1:])))
        with self.assertRaisesRegex(MetaError, 'existing_reservation'):
            meta_api.approval_slots(self.now, ids, [times[12]])

    def test_rolling_approval_binds_future_slot_without_relaxing_container_window(self):
        due = self.now + timedelta(hours=52)
        intent = dict(self.intent(), schedule_mode='approval_relative', batch_id='rolling-18',
                      scheduled_for=due.isoformat())
        items = [dict(intent, content_id='other-' + str(i)) for i in range(17)] + [intent]
        approval = {'kind':'morning_batch', 'batch_id':'rolling-18', 'approved_at':self.now.isoformat(),
                    'owner_quote':'이것들도 다 진행해 예약까지', 'items':items}
        self.approval.write_text(json.dumps(approval))
        with self.assertRaises(MetaError):
            validate_intent(intent, due - timedelta(hours=22))
        approval['schedule_policy'] = 'rolling_eight_per_day'
        self.approval.write_text(json.dumps(approval))
        validate_intent(intent, due - timedelta(hours=22))
        with self.assertRaisesRegex(MetaError, 'within_23_hours'):
            validate_intent(intent, self.now)
        with self.assertRaises(MetaError):
            validate_intent(dict(intent, scheduled_for=(due + timedelta(minutes=5)).isoformat()),
                            due - timedelta(hours=22))

    def test_twelve_per_day_uses_exact_two_hour_gaps_and_explicit_approval(self):
        ids = ['reel-' + str(i) for i in range(18)]
        planned = meta_api.approval_slots(self.now, ids, per_day=12)
        times = [date(row['scheduled_for']) for row in planned]
        self.assertTrue(all(b - a == timedelta(hours=2) for a, b in zip(times, times[1:])))
        self.assertEqual(len([at for at in times if times[0] <= at < times[0] + timedelta(days=1)]), 12)
        due = self.now + timedelta(hours=40)
        intent = dict(self.intent(), schedule_mode='approval_relative', batch_id='twelve', scheduled_for=due.isoformat())
        approval = {'kind':'morning_batch', 'batch_id':'twelve', 'approved_at':self.now.isoformat(),
                    'owner_quote':'24시간 기준으로 2시간에 1개씩', 'schedule_policy':'rolling_twelve_per_day',
                    'items':[dict(intent, content_id='other-' + str(i)) for i in range(17)] + [intent]}
        self.approval.write_text(json.dumps(approval))
        validate_intent(intent, due - timedelta(hours=22))
        with self.assertRaisesRegex(MetaError, 'within_23_hours'):
            validate_intent(intent, self.now)
        with self.assertRaises(MetaError):
            validate_intent(dict(intent, scheduled_for=(due + timedelta(minutes=5)).isoformat()), due - timedelta(hours=22))

    def test_authorized_schedule_overlay_preserves_create_and_rejects_content_change_or_publish_attempt(self):
        with patch('meta_api.OPERATIONS', self.root):
            due, ledger, intent, receipt = self.prepared_instagram_slot()
            record = json.loads(receipt.read_text()); before = receipt.read_bytes()
            changed = dict(intent, scheduled_for=(due + timedelta(hours=1)).isoformat())
            overlay = {'owner_quote':'24시간 기준으로 2시간에 1개씩',
                       'create_sha256':meta_api.digest(before), 'intent':changed}
            path = receipt.with_suffix('.reschedule.json')
            path.write_text(json.dumps(overlay))
            self.assertEqual(meta_api.publication_intent(receipt, record), changed)
            self.assertEqual(receipt.read_bytes(), before)
            for delta in ({'text':'different'}, {'video_sha256':'different'}, {'content_id':'other'}):
                path.write_text(json.dumps(dict(overlay, intent=dict(changed, **delta))))
                with self.assertRaises(MetaError):
                    meta_api.publication_intent(receipt, record)
            path.write_text(json.dumps(overlay)); receipt.with_suffix('.publish.json').write_text('{}')
            with self.assertRaises(MetaError):
                meta_api.publication_intent(receipt, record)

    def test_relative_due_uses_saved_minute_and_keeps_expired_and_unapproved_records_offline(self):
        now = datetime(2026, 10, 13, 17, 17, 20, tzinfo=timezone.utc)
        queue = self.root / 'queue.json'
        intent = dict(self.intent(), schedule_mode='approval_relative', batch_id='b1',
                      scheduled_for=now.replace(second=0).isoformat())
        row = {'content_id':intent['content_id'], 'scheduled_for':intent['scheduled_for'], 'status':'api_ready', 'api_intent':intent}
        queue.write_text(json.dumps({'entries':[row]}))
        with patch('meta_api.MetaClient', side_effect=AssertionError('unapproved must never send')):
            with self.assertRaisesRegex(MetaError, 'morning_batch'):
                due_threads(now, queue)
            self.assertEqual(due_threads(now + timedelta(minutes=5), queue)['status'], 'outside_slot')

    def test_batch_planner_is_offline_preserves_existing_queue_and_rejects_protected_records(self):
        queue = self.root / 'queue.json'
        approval = {'kind':'morning_batch', 'batch_id':'morning-1', 'approved_at':self.now.isoformat(),
            'owner_quote':'이 8개 올리자', 'items':[{'platform':'threads', 'account':'gling.app',
            'content_id':'GL-BT-test', 'copy_sha256':self.intent()['copy_sha256']}]}
        self.approval.write_text(json.dumps(approval))
        row = {'content_id':'GL-BT-test', 'status':'awaiting_owner', 'copy_sha256':self.intent()['copy_sha256']}
        queue.write_text(json.dumps({'entries':[row]})); before = queue.read_bytes()
        with patch('meta_api.MetaClient', side_effect=AssertionError('planning must be offline')):
            plan = meta_api.plan_approved_batch(self.approval, 'threads', 'gling.app', self.now, queue)
            self.assertEqual(len(plan['items']), 1)
            self.assertEqual(queue.read_bytes(), before)
            for key in ('held','uncertain','attempted_at','scheduled_for'):
                queue.write_text(json.dumps({'entries':[dict(row, **{key:True})]}))
                with self.subTest(key=key), self.assertRaises(MetaError):
                    meta_api.plan_approved_batch(self.approval, 'threads', 'gling.app', self.now, queue)

    def test_recurring_official_batch_follows_frozen_reservations(self):
        queue = self.root / 'queue.json'
        approval = {'kind': 'morning_batch', 'batch_id': 'mixed',
                    'approved_at': self.now.isoformat(), 'owner_quote': 'ㅇㅋ 좋아 진행해',
                    'approval_basis': 'scoped_recurring_owner_authorization',
                    'items': [{'platform': 'threads', 'account': 'gling.app',
                               'content_id': key, 'copy_sha256': self.intent()['copy_sha256']}
                              for key in ('next-general-1', 'next-general-2')]}
        rows = [{'content_id': item['content_id'], 'status': 'reviewed_scoped_recurring_pending_plan',
                 'copy_sha256': item['copy_sha256']} for item in approval['items']]
        frozen = {'content_id': 'existing-promotion', 'status': 'api_ready',
                  'scheduled_for': '2026-10-11T03:20:00+00:00'}
        queue.write_text(json.dumps({'account_handle': 'gling.app', 'entries': [frozen, *rows]}))
        before = queue.read_bytes()
        self.approval.write_text(json.dumps(approval))
        plan = meta_api.plan_approved_batch(self.approval, 'threads', 'gling.app', self.now, queue)
        times = [date(row['scheduled_for']) for row in plan['items']]
        self.assertTrue(all(at >= date('2026-10-11T03:50:00+00:00') for at in times))
        self.assertTrue(all(at < self.now + timedelta(hours=23) for at in times))
        self.assertEqual(plan['approved_at'], self.now.isoformat())
        self.assertEqual(queue.read_bytes(), before)
        approval.pop('approval_basis')
        self.approval.write_text(json.dumps(approval))
        exact_plan = meta_api.plan_approved_batch(self.approval, 'threads', 'gling.app', self.now, queue)
        self.assertLess(date(exact_plan['items'][0]['scheduled_for']), date(frozen['scheduled_for']))

    def intent(self):
        import hashlib
        text = '캐나다에서 같이 가볼 곳 있어?'
        return {'platform': 'threads', 'account': 'gling.app', 'action': 'post',
                'content_id': 'GL-BT-test', 'text': text,
                'copy_sha256': hashlib.sha256(text.encode()).hexdigest(),
                'status': 'api_ready', 'submission_kind': 'api_local_queue',
                'scheduled_for': self.now.isoformat(), 'approved_at': self.now.isoformat(),
                'approval_receipt': str(self.approval), 'source_record': '/existing/queue#GL-BT-test',
                'topic_tag': '캐나다일상', 'topic_observation': '/existing/observed-native-topic'}

    def test_date_supports_meta_basic_colon_and_z_offsets_with_fractions(self):
        for value, expected in [
            ('2026-10-11T18:08:54+0000', '2026-10-11T18:08:54+00:00'),
            ('2026-10-11T18:08:54+00:00', '2026-10-11T18:08:54+00:00'),
            ('2026-10-11T18:08:54Z', '2026-10-11T18:08:54+00:00'),
            ('2026-10-11T11:08:54-0700', '2026-10-11T11:08:54-07:00'),
            ('2026-10-11T11:08:54-07:00', '2026-10-11T11:08:54-07:00'),
            ('2026-10-11T23:38:54+0530', '2026-10-11T23:38:54+05:30'),
            ('2026-10-11T18:08:54.123456+0000', '2026-10-11T18:08:54.123456+00:00'),
            ('2026-10-11T11:08:54.123456-0700', '2026-10-11T11:08:54.123456-07:00'),
            ('2026-10-11T18:08:54.123456Z', '2026-10-11T18:08:54.123456+00:00'),
        ]:
            with self.subTest(value=value):
                self.assertEqual(date(value).isoformat(), expected)
        self.assertEqual(date('2026-10-11T11:08:54-0700'), date('2026-10-11T18:08:54Z'))

    def test_date_rejects_invalid_missing_and_timezone_naive_values(self):
        for value in (None, 42, {}, [], '', 'not-a-date', '2026-10-11',
                      '2026-10-11T18:08:54', '2026-10-11T18:08:54.123456',
                      '2026-02-30T18:08:54+0000', '2026-10-11T24:08:54Z',
                      '2026-10-11T18:08:54+2500', '2026-10-11T18:08:54+0060',
                      '2026-10-11T18:08:54+000', '2026-10-11T18:08:54+0000\n'):
            with self.subTest(value=value), self.assertRaisesRegex(MetaError, '^invalid_timestamp$'):
                date(value)

    def test_reply_guard_allows_one_top_level_reply_per_commenter_on_threads(self):
        client = MetaClient('threads', self.root)
        calls = []
        with patch.object(client, 'pages', side_effect=lambda path, params: calls.append((path, params)) or []):
            self.assertEqual(client.replies('1001'), [])
        self.assertIn('replied_to', calls[0][1]['fields'])
        root = {'id': '1001', 'username': 'gling.app'}
        first = {'id': '2001', 'username': 'alice', 'replied_to': {'id': '1001'}}
        second = {'id': '2002', 'username': 'alice', 'replied_to': {'id': '1001'}}
        owner_reply = {'id': '3001', 'username': 'gling.app', 'replied_to': {'id': '2001'}}
        nested = {'id': '2003', 'username': 'bob', 'replied_to': {'id': '2001'}}
        for rows, target, error in (
                ([root, first], '2001', None),
                ([root, first, owner_reply], '2001', 'first_reply_already_exists'),
                ([root, first, second, owner_reply], '2002', 'first_reply_already_exists'),
                ([root, first, nested], '2003', 'reply_target_not_top_level_comment'),
                ([root, first], '1001', 'reply_target_is_root_post'),
                ([root, {**first, 'username': ''}], '2001', 'reply_conversation_metadata_incomplete')):
            with self.subTest(target=target, error=error), \
                    patch.object(client, 'posts', return_value=[root]), \
                    patch.object(client, 'replies', return_value=rows):
                intent = {'parent_id': '1001', 'reply_to_id': target}
                if error is None:
                    client.owner_reply(intent)
                else:
                    with self.assertRaisesRegex(MetaError, '^' + error + '$'):
                        client.owner_reply(intent)

    def test_reply_guard_allows_one_top_level_reply_per_commenter_on_instagram(self):
        credential = self.root / 'instagram-api.json'
        credential.write_text(json.dumps({
            'access_token': 'private-token', 'username': 'gling.app', 'user_id': '39140519375592400'}))
        credential.chmod(0o600)
        client = MetaClient('instagram', self.root)
        root = {'id': '1001', 'username': 'gling.app'}
        first = {'id': '2001', 'username': 'alice'}
        second = {'id': '2002', 'username': 'alice'}
        owner_reply = {'id': '3001', 'username': 'gling.app', 'parent_id': '2001'}
        nested = {'id': '2003', 'username': 'bob', 'parent_id': '2001'}
        for rows, target, error in (
                ([root, first], '2001', None),
                ([root, first, owner_reply], '2001', 'first_reply_already_exists'),
                ([root, first, second, owner_reply], '2002', 'first_reply_already_exists'),
                ([root, first, nested], '2003', 'reply_target_not_top_level_comment'),
                ([root, first], '1001', 'reply_target_is_root_post')):
            with self.subTest(target=target, error=error), \
                    patch.object(client, 'posts', return_value=[root]), \
                    patch.object(client, 'replies', return_value=rows):
                intent = {'parent_id': '1001', 'reply_to_id': target}
                if error is None:
                    client.owner_reply(intent)
                else:
                    with self.assertRaisesRegex(MetaError, '^' + error + '$'):
                        client.owner_reply(intent)

    def test_vendor_completion_does_not_bypass_first_reply_guard(self):
        client = MetaClient('threads', self.root)
        root = {'id': '1001', 'username': 'gling.app'}
        first = {'id': '2001', 'username': 'alice', 'replied_to': {'id': '1001'}}
        owner_reply = {'id': '3001', 'username': 'gling.app', 'replied_to': {'id': '2001'}}
        with patch.object(client, 'posts', return_value=[root]), \
                patch.object(client, 'replies', return_value=[root, first, owner_reply]):
            with self.assertRaisesRegex(MetaError, '^first_reply_already_exists$'):
                client.owner_reply({'parent_id': '1001', 'reply_to_id': '2001',
                                    'content_id': 'BT-COMPLETE-test'})

    def test_reconcile_meta_timestamp_without_known_id_is_read_only_and_unambiguous(self):
        from io import BytesIO
        credential = self.root / 'instagram-api.json'
        credential.write_bytes(self.credentials.read_bytes()); credential.chmod(0o600)
        for platform in ('threads', 'instagram'):
            client = MetaClient(platform, self.root)
            field = 'text' if platform == 'threads' else 'caption'
            edge = 'threads' if platform == 'threads' else 'media'
            intent = dict(self.intent(), platform=platform, action='post' if platform == 'threads' else 'reel')
            receipt = self.root / (platform + '.create.json')
            receipt.write_text(json.dumps({'account_id': client.user_id, 'intent': intent}))
            publication = receipt.with_suffix('.publish.json')
            def post(stamp, public_id='8001'):
                return {'id': public_id, field: intent['text'], 'timestamp': stamp}
            for known, rows, status in [
                (False, [post('2026-10-11T18:08:54+0000')], 'public_readback_verified'),
                (False, [post('2026-10-11T11:08:54.123456-0700')], 'public_readback_verified'),
                (False, [post('2026-10-11T18:23:45+0000')], 'public_readback_verified'),
                (False, [post('2026-10-11T18:23:46+0000')], 'uncertain'),
                (False, [post('2026-10-11T18:08:44+0000')], 'uncertain'),
                (False, [post('2026-10-11T18:08:54+0000'), post('2026-10-11T18:08:55+0000', '8002')], 'uncertain'),
                (True, [post('2026-10-11T18:08:54+0000')], 'public_readback_verified'),
                (True, [post('not-a-date')], 'public_readback_verified'),
            ]:
                with self.subTest(platform=platform, known=known, rows=rows):
                    publication.write_text(json.dumps({'status': 'uncertain', 'attempted_at': '2026-10-11T18:08:45+00:00',
                                                       'response': {'id': '8001'} if known else {}}))
                    original = (receipt.read_bytes(), publication.read_bytes())
                    calls = []
                    def http(request, timeout):
                        calls.append(request.get_method())
                        self.assertEqual(request.get_method(), 'GET')
                        url = urlsplit(request.full_url)
                        self.assertEqual(url.hostname, urlsplit(client.host).hostname)
                        if url.path == '/' + client.version + '/me':
                            result = {'id' if platform == 'threads' else 'user_id': client.user_id, 'username': 'gling.app'}
                        else:
                            self.assertEqual(url.path, '/' + client.version + '/' + client.user_id + '/' + edge)
                            result = {'data': rows}
                        return BytesIO(json.dumps(result).encode())
                    with patch.object(client.opener, 'open', side_effect=http):
                        result = client.reconcile(receipt)
                    self.assertEqual(result['status'], status)
                    if status == 'public_readback_verified': self.assertEqual(result['public_id'], '8001')
                    else: self.assertFalse(result['resend_allowed'])
                    self.assertEqual(calls, ['GET', 'GET'])
                    self.assertEqual((receipt.read_bytes(), publication.read_bytes()), original)

    def test_foreign_account_and_wrong_numeric_identity_are_rejected(self):
        for result in [{'id': '39140519375592400', 'username': 'other'},
                       {'id': '1', 'username': 'gling.app'}]:
            client = MetaClient('threads', self.root)
            with patch.object(client, 'request', return_value=result):
                with self.assertRaises(MetaError):
                    client.identity()

    def test_world_readable_credentials_are_rejected(self):
        self.credentials.chmod(0o644)
        with self.assertRaises(MetaError):
            MetaClient('threads', self.root)

    def personal_client(self):
        path = self.root / 'threads-chalkakandupload-api.json'
        path.write_text(json.dumps({'access_token': 'personal-private-token',
            'username': 'chalkakandupload', 'user_id': '900123456789',
            'app_id': '929495573284257', 'issued_at': self.now.isoformat()}))
        path.chmod(0o600)
        return MetaClient('threads', self.root, account='chalkakandupload')

    def test_personal_selector_uses_separate_credential_and_actual_identity(self):
        client = self.personal_client()
        self.assertEqual(client.path.name, 'threads-chalkakandupload-api.json')
        self.assertNotEqual(client.path, self.credentials)
        with patch.object(client, 'request', return_value={'id': '900123456789', 'username': 'chalkakandupload'}):
            self.assertEqual(client.identity()['username'], 'chalkakandupload')
        for identity in ({'id': '39140519375592400', 'username': 'gling.app'},
                         {'id': '2', 'username': 'chalkakandupload'}):
            with self.subTest(identity=identity), patch.object(client, 'request', return_value=identity), self.assertRaises(MetaError):
                client.identity()

    def test_personal_publication_has_its_own_source_queue_and_receipt_namespace(self):
        intent = dict(self.intent(), account='chalkakandupload')
        queue = self.root / 'personal-queue.json'
        intent['source_record'] = str(queue) + '#' + intent['content_id']
        row = {'content_id': intent['content_id'], 'status': 'api_ready', 'api_intent': intent}
        queue.write_text(json.dumps({'account_handle': 'chalkakandupload', 'entries': [row]}))
        validate_intent(intent, self.now)
        validate_source(intent)
        with patch('meta_api.OPERATIONS', self.root):
            personal = operation_receipt(intent)
            official = operation_receipt(self.intent())
        self.assertNotEqual(personal, official)
        self.assertEqual(personal.parent.name, 'chalkakandupload')
        queue.write_text(json.dumps({'account_handle': 'gling.app', 'entries': [row]}))
        with self.assertRaisesRegex(MetaError, 'source_queue_belongs_to_another_account'):
            validate_source(intent)

    def test_personal_publication_still_rejects_instagram_and_held_records(self):
        for change in ({'platform': 'instagram', 'action': 'reel'}, {'hold': True}, {'uncertain': True}):
            with self.subTest(change=change), self.assertRaises(MetaError):
                validate_intent(dict(self.intent(), account='chalkakandupload', **change), self.now)

    def test_personal_prepare_and_publish_use_only_the_personal_token_and_user(self):
        from io import BytesIO
        client = self.personal_client(); intent = dict(self.intent(), account=client.account)
        queue = self.root / 'personal-queue.json'
        intent['source_record'] = str(queue) + '#' + intent['content_id']
        queue.write_text(json.dumps({'account_handle': client.account, 'entries': [
            {'content_id': intent['content_id'], 'status': 'api_ready', 'api_intent': intent}]}))
        calls = []
        def http(request, timeout):
            url = urlsplit(request.full_url); calls.append((request.get_method(), url.path))
            self.assertEqual(url.hostname, 'graph.threads.net')
            self.assertEqual(request.get_header('Authorization'), 'Bearer personal-private-token')
            if url.path == '/v1.0/me':
                result = {'id': client.user_id, 'username': client.account}
            elif url.path == '/v1.0/' + client.user_id + '/threads' and request.get_method() == 'POST':
                self.assertEqual(parse_qs(request.data.decode())['text'], [intent['text']])
                result = {'id': '7001'}
            elif url.path == '/v1.0/7001': result = {'status': 'FINISHED'}
            elif url.path == '/v1.0/' + client.user_id + '/threads_publish': result = {'id': '8001'}
            elif url.path == '/v1.0/' + client.user_id + '/threads':
                result = {'data': [{'id': '8001', 'text': intent['text'], 'timestamp': self.now.isoformat()}]}
            else: self.fail('Unexpected personal endpoint')
            return BytesIO(json.dumps(result).encode())
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=self.now), \
             patch.object(client.opener, 'open', side_effect=http):
            receipt = operation_receipt(intent)
            self.assertEqual(client.prepare(intent, receipt)['state'], 'FINISHED')
            self.assertEqual(client.publish(receipt)['public_id'], '8001')
        self.assertEqual(len([c for c in calls if c[0] == 'POST']), 2)
        self.assertEqual(json.loads(receipt.read_text())['account_id'], client.user_id)

    def test_personal_selector_never_falls_back_to_official_or_foreign_credentials(self):
        with self.assertRaisesRegex(MetaError, 'api_account_not_connected'):
            MetaClient('threads', self.root, account='chalkakandupload')
        client = self.personal_client();original = json.loads(client.path.read_text())
        for change in ({'username': 'gling.app'}, {'app_id': 'other-app'},
                       {'user_id': '39140519375592400'}, {'user_id': 'bad-id'}, {'user_id': None}):
            client.path.write_text(json.dumps(dict(original, **change)))
            with self.subTest(change=change), self.assertRaises(MetaError):
                MetaClient('threads', self.root, account='chalkakandupload')
        for platform, account in (('instagram', 'chalkakandupload'), ('threads', 'another-account')):
            with self.subTest(platform=platform, account=account), self.assertRaises(MetaError):
                MetaClient(platform, self.root, account=account)

    def test_personal_client_cannot_create_or_publish_official_intents(self):
        client = self.personal_client()
        receipt = operation_receipt(self.intent())
        with patch.object(client.opener, 'open', side_effect=AssertionError('cross-account request')):
            with self.assertRaises(MetaError):
                client.prepare(self.intent(), receipt)
            with self.assertRaises(MetaError):
                client.request(client.user_id + '/threads', {'text': 'wrong account'}, 'POST', intent=self.intent())
        self.assertFalse(receipt.exists())

    def test_personal_client_rejects_official_receipts_before_reconciliation(self):
        client = self.personal_client()
        receipt = self.root / 'official.create.json'
        receipt.write_text(json.dumps({'account_id': '39140519375592400', 'platform': 'threads',
                                      'intent': self.intent(), 'response': {'id': '7001'}}))
        with patch.object(client.opener, 'open', side_effect=AssertionError('cross-account request')):
            for command in ('container', 'publish', 'reconcile'):
                with self.subTest(command=command), self.assertRaisesRegex(MetaError, 'receipt_account_mismatch'):
                    getattr(client, command)(receipt)

    def test_personal_inspection_labels_actual_account_and_preserves_unknown_metrics(self):
        client = self.personal_client()
        with patch.object(client, 'identity', return_value={'id': client.user_id, 'username': 'chalkakandupload'}), \
             patch.object(client, 'posts', return_value=[]):
            result = client.inspect()
        self.assertEqual(result['account'], 'chalkakandupload')

    def test_personal_cli_identity_selects_only_the_personal_client(self):
        client = self.personal_client();output = self.root / 'personal-identity.json'
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.MetaClient', return_value=client) as factory, \
             patch.object(client, 'identity', return_value={'id': '900123456789', 'username': 'chalkakandupload'}), \
             patch('sys.argv', ['meta_api.py', 'identity', 'threads', '--account', 'chalkakandupload', '--out', str(output)]), \
             patch('builtins.print'):
            self.assertEqual(main(), 0)
        factory.assert_called_once_with('threads', account='chalkakandupload')
        self.assertEqual(json.loads(output.read_text()), {'id': '900123456789', 'username': 'chalkakandupload'})
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_personal_credential_mode_and_symlinks_cannot_bypass_private_binding(self):
        client = self.personal_client();client.path.chmod(0o644)
        with self.assertRaises(MetaError):
            MetaClient('threads', self.root, account='chalkakandupload')
        client.path.unlink();client.path.symlink_to(self.credentials)
        with self.assertRaises(MetaError):
            MetaClient('threads', self.root, account='chalkakandupload')

    def test_personal_due_cli_selects_explicit_personal_account(self):
        output = self.root / 'personal-due.json'
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.due_threads', return_value={'status': 'no_approved_record_due'}) as publisher, \
             patch('sys.argv', ['meta_api.py', 'due', 'threads', '--account', 'chalkakandupload', '--out', str(output)]), patch('builtins.print'):
            self.assertEqual(main(), 0)
        self.assertEqual(publisher.call_args.kwargs['account'], 'chalkakandupload')

    def test_personal_due_uses_own_slots_and_rejects_official_queue_before_network(self):
        path = self.root / 'personal.json'
        path.write_text(json.dumps({'account_handle': 'chalkakandupload', 'entries': []}))
        with patch('meta_api.MetaClient', side_effect=AssertionError('network for empty queue')):
            self.assertEqual(due_threads(self.now, path, account='chalkakandupload')['status'], 'no_approved_record_due')
            self.assertEqual(due_threads(self.now + timedelta(minutes=30), path, account='chalkakandupload')['status'], 'outside_slot')
            path.write_text(json.dumps({'account_handle': 'gling.app', 'entries': []}))
            with self.assertRaisesRegex(MetaError, 'wrong_due_account'):
                due_threads(self.now, path, account='chalkakandupload')

    def test_personal_due_publishes_once_and_uses_only_personal_identity(self):
        from io import BytesIO
        client = self.personal_client()
        path = self.root / 'personal.json'
        intent = dict(self.intent(), account=client.account, source_record=str(path) + '#GL-BT-test')
        path.write_text(json.dumps({'account_handle': client.account, 'entries': [
            {'content_id': intent['content_id'], 'status': 'api_ready', 'scheduled_for': intent['scheduled_for'], 'api_intent': intent}]}))
        calls = []
        def http(request, timeout):
            self.assertEqual(request.get_header('Authorization'), 'Bearer personal-private-token')
            call = (request.get_method(), urlsplit(request.full_url).path)
            calls.append(call)
            responses = {('GET', '/v1.0/me'): {'id': client.user_id, 'username': client.account},
                         ('POST', '/v1.0/' + client.user_id + '/threads'): {'id': '7001'},
                         ('GET', '/v1.0/7001'): {'status': 'FINISHED'},
                         ('POST', '/v1.0/' + client.user_id + '/threads_publish'): {'id': '8001'},
                         ('GET', '/v1.0/' + client.user_id + '/threads'): {'data': [{'id': '8001', 'text': intent['text']}]}}
            self.assertIn(call, responses)
            return BytesIO(json.dumps(responses[call]).encode())
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=self.now), \
             patch('meta_api.MetaClient', return_value=client), patch.object(client.opener, 'open', side_effect=http):
            first = due_threads(self.now, path, account=client.account)
            second = due_threads(self.now, path, account=client.account)
        self.assertEqual(first['public_id'], second['public_id'])
        self.assertEqual(second['status'], 'public_readback_verified')
        self.assertEqual(sum(method == 'POST' for method, _ in calls), 2)

    def test_uncertain_write_is_recorded_and_never_retried(self):
        receipt = self.root / 'attempt.json'
        calls = []
        def interrupted():
            calls.append(1)
            raise MetaError('network_unknown')
        with self.assertRaises(MetaError):
            once(receipt, {'action': 'publish'}, interrupted)
        self.assertEqual(json.loads(receipt.read_text())['status'], 'uncertain')
        with self.assertRaises(MetaError):
            once(receipt, {'action': 'publish'}, interrupted)
        self.assertEqual(calls, [1])
        self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)

    def test_concurrent_or_completed_attempt_cannot_send_again(self):
        receipt = self.root / 'attempt.json'
        self.assertEqual(once(receipt, {'action': 'publish'}, lambda: {'id': '7'}), {'id': '7'})
        with self.assertRaises(MetaError):
            once(receipt, {'action': 'publish'}, lambda: self.fail('duplicate call'))

    def test_holds_native_reservations_and_changed_copy_are_rejected(self):
        for seconds in (0, 20):
            for change in [{'held': True}, {'hold': True}, {'uncertain': True}, {'sending': True},
                           {'status': 'scheduled'}, {'submission_kind': 'native_future_schedule'},
                           {'copy_sha256': '0' * 64}, {'account': 'another-account'},
                           {'public_id': '123'}, {'native_receipt': 'existing'},
                           {'attempted_at': self.now.isoformat()}]:
                with self.subTest(seconds=seconds, change=change), self.assertRaises(MetaError):
                    validate_intent(dict(self.intent(), **change), self.now + timedelta(seconds=seconds))

    def test_missing_or_future_approval_is_rejected(self):
        for change in [{'approval_receipt': str(self.root / 'missing')},
                       {'approved_at': (self.now + timedelta(seconds=1)).isoformat()}]:
            with self.assertRaises(MetaError):
                validate_intent(dict(self.intent(), **change), self.now)

    def deletion_intent(self, client, media_id='1001', text='own post'):
        from meta_api import digest
        approval = self.root / (client.account + '-delete-approval.json')
        queue = self.root / (client.account + '-delete-queue.json')
        intent = {'platform': client.platform, 'account': client.account, 'action': 'delete',
                  'media_id': media_id, 'content_id': 'DEL-' + media_id, 'text': text,
                  'copy_sha256': digest(text.encode()), 'approved_at': self.now.isoformat(),
                  'approval_receipt': str(approval), 'status': 'api_ready',
                  'submission_kind': 'api_local_queue', 'source_record': str(queue) + '#DEL-' + media_id}
        approval.write_text(json.dumps({k: intent[k] for k in ('platform', 'account', 'action', 'media_id', 'copy_sha256', 'approved_at')} | {'approved': True}))
        queue.write_text(json.dumps({'account_handle': client.account, 'entries': [
            {'content_id': intent['content_id'], 'status': 'api_ready', 'api_intent': intent}]}))
        return intent

    def test_threads_delete_is_account_bound_once_only_and_has_read_only_preflight(self):
        for account in ('gling.app', 'chalkakandupload'):
            client = MetaClient('threads', self.root) if account == 'gling.app' else self.personal_client()
            intent = self.deletion_intent(client)
            grants = {'data': {'is_valid': True, 'user_id': client.user_id,
                              'scopes': ['threads_basic', 'threads_delete'],
                              'expires_at': (self.now + timedelta(hours=1)).timestamp()}}
            with self.subTest(account=account), patch('meta_api.OPERATIONS', self.root), \
                 patch('meta_api.now_utc', return_value=self.now), \
                 patch.object(client, 'identity', return_value={'id': client.user_id, 'username': account}), \
                 patch.object(client, 'posts', side_effect=[[{'id': '1001', 'text': 'own post'}], [{'id': '1001', 'text': 'own post'}], []]), \
                 patch.object(client, '_request', return_value=grants), \
                 patch.object(client, 'request', return_value={'success': True, 'deleted_id': '1001'}) as send:
                self.assertEqual(client.delete_post('1001')['status'], 'delete_preflight_ready')
                send.assert_not_called()
                result = client.delete_post('1001', execute=True, intent=intent)
                self.assertTrue(result['deleted_verified'])
                send.assert_called_once_with('1001', method='DELETE')
                with self.assertRaisesRegex(MetaError, 'attempt_exists_reconcile_without_resending'):
                    client.delete_post('1001', execute=True, intent=intent)
            path = self.root / 'meta-api/threads/deletions' / account / '1001.delete-attempt.json'
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_delete_rejects_missing_grant_foreign_post_and_missing_exact_approval(self):
        client = self.personal_client()
        intent = self.deletion_intent(client)
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=self.now), \
             patch.object(client, 'identity'), patch.object(client, 'request', side_effect=AssertionError('must not delete')):
            with self.assertRaisesRegex(MetaError, 'exact_delete_approval_required'):
                client.delete_post('1001', execute=True)
            with patch.object(client, 'posts', return_value=[]), self.assertRaisesRegex(MetaError, 'post_not_owned_or_not_present'):
                client.delete_post('1001', execute=True, intent=intent)
            for scopes in (['threads_basic'], None, {}, ['threads_basic', []]):
                with self.subTest(scopes=scopes), patch.object(client, 'posts', return_value=[{'id': '1001', 'text': 'own post'}]), \
                     patch.object(client, '_request', return_value={'data': {'is_valid': True, 'user_id': client.user_id,
                         'expires_at': (self.now + timedelta(hours=1)).timestamp(), 'scopes': scopes}}), \
                     self.assertRaisesRegex(MetaError, 'threads_delete_permission_missing_or_expired'):
                    client.delete_post('1001', execute=True, intent=intent)
        self.assertFalse(list(self.root.rglob('*.delete-attempt.json')))

    def test_native_reservation_ids_are_never_sent_to_published_post_deletion(self):
        client = self.personal_client()
        with patch.object(client.opener, 'open', side_effect=AssertionError('native reservation must not reach API')):
            with self.assertRaisesRegex(MetaError, 'native_schedule_cancellation_api_contract_unverified'):
                client.delete_post('1001', execute=True, intent={'submission_kind': 'native_future_schedule'})

    def test_delete_requires_approval_for_the_exact_account_post_and_current_copy(self):
        client = self.personal_client(); intent = self.deletion_intent(client)
        proof_path = Path(intent['approval_receipt']); proof = json.loads(proof_path.read_text())
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=self.now), \
             patch.object(client, 'request', side_effect=AssertionError('must not delete')):
            for change in ({'account': 'gling.app'}, {'media_id': '1002'}, {'approved': False}):
                proof_path.write_text(json.dumps(dict(proof, **change)))
                with self.subTest(change=change), self.assertRaisesRegex(MetaError, 'exact_delete_approval_required'):
                    client.delete_post('1001', execute=True, intent=intent)
            proof_path.write_text(json.dumps(proof))
            with patch.object(client, 'identity'), patch.object(client, 'posts', return_value=[{'id': '1001', 'text': 'changed post'}]), \
                 self.assertRaisesRegex(MetaError, 'approved_delete_target_copy_changed'):
                client.delete_post('1001', execute=True, intent=intent)
        self.assertFalse(list(self.root.rglob('*.delete-attempt.json')))

    def test_uncertain_deletion_is_never_resent_and_absence_does_not_forge_success(self):
        client = self.personal_client(); intent = self.deletion_intent(client)
        grants = {'data': {'is_valid': True, 'user_id': client.user_id, 'scopes': ['threads_basic', 'threads_delete'],
                          'expires_at': (self.now + timedelta(hours=1)).timestamp()}}
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=self.now), \
             patch.object(client, 'identity'), patch.object(client, 'posts', return_value=[{'id': '1001', 'text': 'own post'}]), \
             patch.object(client, '_request', return_value=grants), patch.object(client, 'request', return_value={'success': True}):
            with self.assertRaisesRegex(MetaError, 'delete_response_unknown_reconcile_without_resending'):
                client.delete_post('1001', execute=True, intent=intent)
            with self.assertRaisesRegex(MetaError, 'attempt_exists_reconcile_without_resending'):
                client.delete_post('1001', execute=True, intent=intent)
            with patch.object(client, 'posts', return_value=[]):
                result = client.delete_post('1001')
                self.assertFalse(result['deleted_verified'])
                self.assertFalse(result['resend_allowed'])

    def test_threads_dm_is_not_silently_routed_to_instagram(self):
        client = MetaClient('threads', self.root)
        with patch.object(client, 'request') as send:
            with self.assertRaises(MetaError):
                client.inbox()
            send.assert_not_called()

    def test_insights_are_batched_and_missing_metrics_stay_unknown(self):
        client = MetaClient('threads', self.root)
        with patch.object(client, 'identity', return_value={'username': 'gling.app'}), \
             patch.object(client, 'posts', return_value=[{'id': '123'}]), \
             patch.object(client, 'replies', return_value=[]), \
             patch.object(client, 'request', return_value={'data': [{'name': 'views', 'values': [{'value': 0}]}]}) as read:
            result = client.inspect()
        self.assertEqual(read.call_count, 1)
        self.assertIn(',', read.call_args.args[1]['metric'])
        self.assertEqual(result['posts'][0]['metrics']['views'], 0)
        self.assertIsNone(result['posts'][0]['metrics']['likes'])

    def test_future_container_is_allowed_but_early_or_late_publication_is_not(self):
        future = dict(self.intent(), scheduled_for=(self.now + timedelta(hours=1)).isoformat())
        validate_intent(future, self.now, publishing=False)
        with self.assertRaises(MetaError):
            validate_intent(future, self.now, publishing=True)
        late = dict(self.intent(), scheduled_for=(self.now - timedelta(minutes=2)).isoformat())
        with self.assertRaises(MetaError):
            validate_intent(late, self.now, publishing=True)

    def test_threads_preparation_uses_existing_sixty_second_grace_and_strict_future_bound(self):
        intent = self.intent()
        for seconds in (0, 20, 59.999999, 60):
            for publishing in (False, True):
                with self.subTest(seconds=seconds, publishing=publishing):
                    validate_intent(intent, self.now + timedelta(seconds=seconds), publishing=publishing)
        for seconds in (60.000001, 120):
            for publishing in (False, True):
                with self.subTest(seconds=seconds, publishing=publishing), self.assertRaises(MetaError):
                    validate_intent(intent, self.now + timedelta(seconds=seconds), publishing=publishing)
        validate_intent(dict(intent, scheduled_for=(self.now + timedelta(hours=23, microseconds=-1)).isoformat()), self.now)
        for hours in (23, 24):
            with self.subTest(hours=hours), self.assertRaisesRegex(MetaError, 'within_23_hours'):
                validate_intent(dict(intent, scheduled_for=(self.now + timedelta(hours=hours)).isoformat()), self.now)

    def test_instagram_preparation_remains_before_slot_with_original_publication_grace(self):
        reel = dict(self.intent(), platform='instagram', action='reel')
        for seconds in (20, 60, 900):
            with self.subTest(seconds=seconds), self.assertRaisesRegex(MetaError, 'within_23_hours'):
                validate_intent(reel, self.now + timedelta(seconds=seconds))
        with self.assertRaisesRegex(MetaError, 'missing_accepted_hyperframes'):
            validate_intent(reel, self.now + timedelta(seconds=900), publishing=True)
        with self.assertRaisesRegex(MetaError, 'outside_original_publication_slot'):
            validate_intent(reel, self.now + timedelta(seconds=900, microseconds=1), publishing=True)

    def test_due_publisher_prepares_requests_and_publishes_once_twenty_seconds_after_slot(self):
        from io import BytesIO
        client = MetaClient('threads', self.root)
        path = self.root / 'queue.json'
        due = self.now + timedelta(minutes=30)  # Existing Vancouver 13:30 slot.
        intent = dict(self.intent(), scheduled_for=due.isoformat(), source_record=str(path) + '#GL-BT-test')
        path.write_text(json.dumps({'account_handle': 'gling.app', 'entries': [
            {'content_id': intent['content_id'], 'status': 'api_ready',
             'scheduled_for': intent['scheduled_for'], 'api_intent': intent}]}))
        calls = []
        def http(request, timeout):
            url = urlsplit(request.full_url)
            self.assertEqual(url.hostname, 'graph.threads.net')
            call = (request.get_method(), url.path)
            calls.append(call)
            if call == ('GET', '/v1.0/me'):
                result = {'id': client.user_id, 'username': 'gling.app'}
            elif call == ('POST', '/v1.0/' + client.user_id + '/threads'):
                self.assertTrue(operation_receipt(intent).is_file())
                result = {'id': '7001'}
            elif call == ('GET', '/v1.0/7001'):
                result = {'status': 'FINISHED'}
            elif call == ('POST', '/v1.0/' + client.user_id + '/threads_publish'):
                self.assertTrue(operation_receipt(intent).with_suffix('.publish.json').is_file())
                result = {'id': '8001'}
            elif call == ('GET', '/v1.0/' + client.user_id + '/threads'):
                result = {'data': [{'id': '8001', 'text': intent['text']}]}
            else:
                self.fail('Unexpected offline Threads endpoint')
            return BytesIO(json.dumps(result).encode())
        now = due + timedelta(seconds=20)
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=now), \
             patch('meta_api.MetaClient', return_value=client), patch.object(client.opener, 'open', side_effect=http):
            first = due_threads(now, path)
            second = due_threads(now, path)
            receipt = operation_receipt(intent)
            self.assertEqual(first['public_id'], '8001')
            self.assertEqual(second['status'], 'public_readback_verified')
            self.assertEqual(second['public_id'], first['public_id'])
            self.assertEqual(json.loads(receipt.read_text())['status'], 'response_received')
            self.assertEqual(json.loads(receipt.with_suffix('.publish.json').read_text())['status'], 'response_received')
        self.assertEqual(sum(method == 'POST' for method, _ in calls), 2)

    def test_unpublished_probe_and_unaccepted_video_cannot_publish(self):
        with self.assertRaises(MetaError):
            validate_intent(dict(self.intent(), probe=True), self.now, publishing=True)
        reel = dict(self.intent(), platform='instagram', action='reel')
        with self.assertRaises(MetaError):
            validate_intent(reel, self.now)

    def test_refresh_obeys_24_hour_minimum_and_weekly_maintenance(self):
        data = json.loads(self.credentials.read_text())
        for age in [timedelta(hours=2), timedelta(hours=23), timedelta(days=2)]:
            data['issued_at'] = (self.now - age).isoformat()
            self.assertFalse(refresh_due(data, self.now))
        data['issued_at'] = (self.now - timedelta(days=7)).isoformat()
        self.assertTrue(refresh_due(data, self.now))
        data['expires_at'] = (self.now - timedelta(seconds=1)).isoformat()
        with self.assertRaises(MetaError):
            refresh_due(data, self.now)

    def test_wrong_platform_action_and_path_in_content_id_are_rejected(self):
        for change in [{'action': 'reel'}, {'content_id': '../other'}]:
            with self.assertRaises(MetaError):
                validate_intent(dict(self.intent(), **change), self.now)

    def test_create_receipt_is_stable_across_run_folders(self):
        client = MetaClient('threads', self.root)
        intent = self.intent()
        with patch.object(client, 'identity'), patch.object(client, 'request') as send:
            with self.assertRaises(MetaError):
                client.prepare(intent, self.root / 'different-run.json')
            send.assert_not_called()
        self.assertEqual(operation_receipt(intent), operation_receipt(dict(intent, run_id='another-run')))

    def test_due_publisher_preserves_native_reservation_without_network(self):
        path = self.root / 'queue.json'
        entry = dict(self.intent(), scheduled_for='2026-10-10T13:30:00-07:00', status='scheduled',
                     submission_kind='native_future_schedule')
        path.write_text(json.dumps({'entries': [entry]}))
        with patch('meta_api.MetaClient') as client:
            result = due_threads(datetime(2026, 10, 10, 20, 30, tzinfo=timezone.utc), path)
            self.assertEqual(result['status'], 'native_reservation_preserved')
            client.assert_not_called()

    def test_added_official_slots_reconcile_existing_native_reservations(self):
        path = self.root / 'queue.json'
        for stamp in ('2026-10-10T10:00:00-07:00', '2026-10-10T18:30:00-07:00'):
            with self.subTest(slot=stamp):
                path.write_text(json.dumps({'entries': [{
                    'content_id': 'GL-BT-test', 'scheduled_for': stamp,
                    'status': 'scheduled', 'submission_kind': 'native_future_schedule',
                }]}))
                result = due_threads(datetime.fromisoformat(stamp), path)
                self.assertEqual(result['status'], 'native_reservation_preserved')
                self.assertEqual(result['content_id'], 'GL-BT-test')

    def test_changed_authoritative_plan_stops_before_sending(self):
        path = self.root / 'queue.json'
        intent = self.intent()
        intent['source_record'] = str(path) + '#GL-BT-test'
        path.write_text(json.dumps({'entries': [{'content_id': 'GL-BT-test', 'status': 'api_ready', 'api_intent': intent}]}))
        validate_source(intent)
        changed = dict(intent, text='replacement')
        path.write_text(json.dumps({'entries': [{'content_id': 'GL-BT-test', 'status': 'api_ready', 'api_intent': changed}]}))
        with self.assertRaises(MetaError):
            validate_source(intent)

    def test_existing_case_and_event_keys_are_supported_without_new_records(self):
        for identity, collection in [('case_id', 'entries'), ('key', 'events')]:
            path = self.root / (identity + '.json')
            intent = self.intent()
            intent['source_record'] = str(path) + '#GL-BT-test'
            row = {identity: 'GL-BT-test', 'status': 'api_ready', 'api_intent': intent}
            path.write_text(json.dumps({collection: [row]}))
            validate_source(intent)

    def test_personal_source_queue_cannot_publish_as_official_account(self):
        path = self.root / 'queue.json'
        intent = self.intent()
        intent['source_record'] = str(path) + '#GL-BT-test'
        path.write_text(json.dumps({'account_handle': 'chalkakandupload', 'entries': [
            {'content_id': 'GL-BT-test', 'status': 'api_ready', 'api_intent': intent}]}))
        with self.assertRaises(MetaError):
            validate_source(intent)

    def test_native_sent_case_and_general_review_case_cannot_be_resent(self):
        path = self.root / 'cases.json'
        intent = dict(self.intent(), action='reply', source_record=str(path) + '#GL-BT-test')
        for status in ('sent', 'sending', 'uncertain', 'review_required'):
            path.write_text(json.dumps({'entries': [{'case_id': 'GL-BT-test', 'status': status, 'api_intent': intent}]}))
            with self.assertRaises(MetaError):
                validate_source(intent)

    def test_vendor_completion_requires_saved_materials_and_authenticated_view(self):
        queue = self.root / 'completion.json'
        render = self.root / 'render.json'
        screenshot = self.root / 'actual-preview.png'
        screenshot.write_bytes(b'\x89PNG\r\n\x1a\n' + b'actual screenshot fixture')
        post_id, merchant_id = '123e4567-e89b-42d3-a456-426614174000', 'merchant-1'
        body = '도자기와 테이블웨어를 판매해요. 밴쿠버에서 운영합니다.\nhttps://www.instagram.com/vendor/'
        intent = dict(self.intent(), action='reply', content_id='BT-COMPLETE-test',
                      source_record=str(queue) + '#BT-COMPLETE-test',
                      text='소개글 올렸어! https://gling.ej-entertainment.com/post?id=' + post_id)
        row = dict(content_id=intent['content_id'], status='api_ready', api_intent=intent,
                   post_id=post_id, merchant_id=merchant_id)
        proof = {'post': [{'id': post_id, 'city_id': 'vancouver', 'author_id':'normal-owner', 'title': '업체 소개',
                           'body': body, 'image_paths': ['posts/vendor/photo-1.jpg',
                               'posts/vendor/photo-2.jpg', 'posts/vendor/photo-3.jpg']}],
                 'merchant': {'merchant': {'id': merchant_id, 'city_id': 'vancouver',
                              'industry': '생활용품', 'services': '도자기·테이블웨어'},
                              'posts': [{'post_id': post_id}]},
                 'material_checks': {key: True for key in ('detailed_intro_and_services',
                     'location_in_body_verified', 'instagram_profile_verified',
                     'photo_sources_and_permission_verified', 'all_saved_photos_viewed')},
                 'render_receipt': str(render)}
        visible = dict(authenticated=True, post_id=post_id, body=body, visible_image_count=3,
                       all_image_elements_loaded=True, screenshot_path=str(screenshot),
                       observed_at=self.now.isoformat(), actual_identity={'normal_admin_subject':'normal-owner'})
        def save(p, v):
            queue.write_text(json.dumps({'entries': [row]}))
            self.approval.write_text(json.dumps({'proof': p}))
            render.write_text(json.dumps(v))
        save(proof, visible)
        validate_source(intent)
        for legacy_id in ('post-1', post_id):
            row['post_id'] = proof['post'][0]['id'] = visible['post_id'] = legacy_id
            proof['merchant']['posts'][0]['post_id'] = legacy_id
            intent['text'] = 'https://gling.ej-entertainment.com/post?id=' + legacy_id
            save(proof, visible)
            validate_source(intent)
        canonical = 'https://gling.ej-entertainment.com/post?id=' + post_id
        short = 'https://gling-share-preview.vercel.app/s/Ej5FZ-ibQtOkVkJmFBdAAA'
        for text in (canonical, canonical + '&shared=1', '비즈니스 소개를 올렸어요 💜 ' + short,
                     '소개 (' + short + ').', '📌 <' + short + '>'):
            with self.subTest(accepted=text):
                intent['text'] = text
                save(proof, visible)
                validate_source(intent)
        for text in ('소개글을 올렸어요.', short.replace('https:', 'http:'),
                     short.replace('gling-share-preview.vercel.app', 'evil.example'),
                     short.replace('.app/', '.app.evil.example/'), short + '/extra', short + '.evil',
                     short + '?next=1', short + '#part', short + '?', short + '#', short + 'A',
                     short[:-1] + 'B', short.replace('/s/', '/share/'), '/s/' + short.rsplit('/', 1)[1],
                     'https://evil.example/?next=' + short, '문자' + short,
                     'https://gling-share-preview.vercel.app/s/sgsvKFkCRh2P_P_vPyOywA'):
            with self.subTest(rejected=text):
                intent['text'] = text
                save(proof, visible)
                with self.assertRaisesRegex(MetaError, 'vendor_'):
                    validate_source(intent)
        for text in (canonical, short):
            intent['text'] = text
            for missing in ('proof', 'body', 'photos', 'one_photo', 'two_photos', 'duplicate_photos',
                            'services', 'instagram', 'permission',
                            'location', 'authenticated', 'visible_body', 'visible_photos', 'post_binding',
                            'screenshot', 'observed_at', 'future_observed_at', 'actual_identity', 'partial_photo_load'):
                with self.subTest(missing=missing):
                    p, v = deepcopy(proof), deepcopy(visible)
                    if missing == 'proof': p = {}
                    elif missing == 'body': p['post'][0]['body'] = p['post'][0]['title']
                    elif missing == 'photos': p['post'][0]['image_paths'] = []
                    elif missing == 'one_photo': p['post'][0]['image_paths'] = ['posts/vendor/photo-1.jpg']
                    elif missing == 'two_photos': p['post'][0]['image_paths'] = ['posts/vendor/photo-1.jpg', 'posts/vendor/photo-2.jpg']
                    elif missing == 'duplicate_photos': p['post'][0]['image_paths'][2] = p['post'][0]['image_paths'][0]
                    elif missing == 'services': p['merchant']['merchant']['services'] = ''
                    elif missing == 'instagram': p['post'][0]['body'] = '소개와 위치만 있음'
                    elif missing == 'permission': p['material_checks']['photo_sources_and_permission_verified'] = False
                    elif missing == 'location': p['material_checks']['location_in_body_verified'] = False
                    elif missing == 'authenticated': v['authenticated'] = False
                    elif missing == 'visible_body': v['body'] = '업체 소개 로그인 필요'
                    elif missing == 'visible_photos': v['visible_image_count'] = 0
                    elif missing == 'post_binding': p['post'][0]['id'] = 'different-post'
                    elif missing == 'screenshot': v['screenshot_path'] = str(self.root / 'missing.png')
                    elif missing == 'observed_at': v.pop('observed_at')
                    elif missing == 'future_observed_at': v['observed_at'] = (self.now + timedelta(microseconds=1)).isoformat()
                    elif missing == 'actual_identity': v['actual_identity'] = {'normal_admin_subject':'different-owner'}
                    elif missing == 'partial_photo_load': v['all_image_elements_loaded'] = False
                    save(p, v)
                    with patch('meta_api.now_utc', return_value=self.now), self.assertRaisesRegex(MetaError, 'vendor_'):
                        validate_source(intent)

    def test_vendor_material_gate_preserves_invitation_and_city_replies(self):
        path = self.root / 'reply.json'
        for content_id in ('BT-API-invitation', 'BT-CITY-test'):
            intent = dict(self.intent(), action='reply', content_id=content_id,
                          source_record=str(path) + '#' + content_id)
            path.write_text(json.dumps({'entries': [dict(content_id=content_id,
                            status='api_ready', api_intent=intent)]}))
            validate_source(intent)

    def test_failed_cli_run_replaces_stale_success_with_private_blocker(self):
        output = self.root / 'current.json'
        output.write_text('{"status":"old_success"}')
        with patch('meta_api.OPERATIONS', self.root), \
             patch('meta_api.MetaClient', side_effect=MetaError('live_account_identity_mismatch')), \
             patch('sys.argv', ['meta_api.py', 'identity', 'threads', '--out', str(output)]), patch('builtins.print'):
            self.assertEqual(main(), 2)
        self.assertEqual(json.loads(output.read_text())['reason'], 'live_account_identity_mismatch')
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_instagram_due_cli_accepts_empty_original_ledger_without_network(self):
        output = self.root / 'instagram-due.json'
        slot = datetime(2026, 10, 13, 2, 0, 20, tzinfo=timezone.utc)
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=slot), \
             patch.object(Path, 'read_text', return_value='{"events":[]}'), \
             patch('meta_api.MetaClient', side_effect=AssertionError('empty slot cannot contact Meta')), \
             patch('sys.argv', ['meta_api.py', 'due', 'instagram', '--out', str(output)]), patch('builtins.print'):
            self.assertEqual(main(), 0)
        self.assertEqual(json.loads(output.read_text())['status'], 'no_approved_record_due')

    def prepared_instagram_slot(self):
        from meta_api import private_json
        due = datetime(2026, 10, 13, 2, tzinfo=timezone.utc)
        ledger = self.root / 'festival-content-ledger.json'
        intent = dict(self.accepted_reel(), content_id='GL-P070-FINAL-test',
                      automation_id='978b9d5b-77f6-4839-bb85-23caeff3e0ea',
                      scheduled_for=due.isoformat(), source_record=str(ledger) + '#GL-P070')
        ledger.write_text(json.dumps({'events': [{'content_id': 'GL-P070',
            'channels': {'instagram': {'status': 'api_ready', 'api_intent': intent}}}]}))
        receipt = operation_receipt(intent)
        private_json(receipt, {'status': 'response_received', 'platform': 'instagram',
                              'account_id': '17841430674685962', 'intent': intent,
                              'response': {'id': '7001'}})
        return due, ledger, intent, receipt

    def test_instagram_due_publishes_prepared_master_once_and_reconciles_read_only(self):
        from io import BytesIO
        credential = self.root / 'instagram-api.json'
        credential.write_bytes(self.credentials.read_bytes()); credential.chmod(0o600)
        client = MetaClient('instagram', self.root)
        calls = []
        with patch('meta_api.OPERATIONS', self.root):
            due, ledger, intent, receipt = self.prepared_instagram_slot()
            original_ledger, original_create = ledger.read_bytes(), receipt.read_bytes()
            def http(request, timeout):
                call = (request.get_method(), urlsplit(request.full_url).path)
                self.assertEqual(urlsplit(request.full_url).hostname, 'graph.instagram.com')
                calls.append(call)
                if call == ('GET', '/v25.0/me'):
                    result = {'user_id': client.user_id, 'username': 'gling.app'}
                elif call == ('GET', '/v25.0/7001'):
                    result = {'status_code': 'FINISHED'}
                elif call == ('POST', '/v25.0/' + client.user_id + '/media_publish'):
                    self.assertTrue(receipt.with_suffix('.publish.json').is_file())
                    result = {'id': '8001'}
                elif call == ('GET', '/v25.0/' + client.user_id + '/media'):
                    result = {'data': [{'id': '8001', 'caption': intent['text'], 'timestamp': '2026-10-13T02:00:20+0000'}]}
                else:
                    self.fail('Due must consume the existing container, never stage/create a new one')
                return BytesIO(json.dumps(result).encode())
            now = due + timedelta(seconds=20)
            with patch('meta_api.now_utc', return_value=now), patch('meta_api.MetaClient', return_value=client), \
                 patch.object(client.opener, 'open', side_effect=http):
                first = meta_api.due_instagram(now, ledger)
                second = meta_api.due_instagram(now, ledger)
            self.assertEqual(first['public_id'], '8001')
            self.assertEqual(second['status'], 'public_readback_verified')
            self.assertEqual(sum(method == 'POST' for method, _ in calls), 1)
            self.assertEqual((ledger.read_bytes(), receipt.read_bytes()), (original_ledger, original_create))

    def test_instagram_due_never_creates_missing_or_uncertain_containers(self):
        with patch('meta_api.OPERATIONS', self.root):
            due, ledger, intent, receipt = self.prepared_instagram_slot()
            for state in ('missing', 'uncertain', 'wrong_intent'):
                if state == 'missing': receipt.unlink()
                else:
                    from meta_api import private_json
                    private_json(receipt, {'status': state, 'platform': 'instagram',
                        'account_id': '17841430674685962', 'intent': {} if state == 'wrong_intent' else intent,
                        'response': {'id': '7001'}})
                with self.subTest(state=state), patch('meta_api.MetaClient', side_effect=AssertionError('must not send')):
                    with self.assertRaises(MetaError):
                        meta_api.due_instagram(due + timedelta(seconds=20), ledger)

    def test_rescheduled_existing_container_publishes_once_without_rewriting_create(self):
        credential = self.root / 'instagram-api.json'
        credential.write_bytes(self.credentials.read_bytes()); credential.chmod(0o600)
        client = MetaClient('instagram', self.root)
        with patch('meta_api.OPERATIONS', self.root):
            due, ledger, intent, receipt = self.prepared_instagram_slot()
            original = receipt.read_bytes(); due += timedelta(hours=2)
            intent = dict(intent, scheduled_for=due.isoformat())
            data = json.loads(ledger.read_text()); data['events'][0]['channels']['instagram']['api_intent'] = intent
            ledger.write_text(json.dumps(data))
            receipt.with_suffix('.reschedule.json').write_text(json.dumps({
                'owner_quote':'24시간 기준으로 2시간에 1개씩', 'create_sha256':meta_api.digest(original), 'intent':intent}))
            with patch('meta_api.now_utc', return_value=due + timedelta(seconds=20)), \
                 patch('meta_api.MetaClient', return_value=client), patch.object(client, 'identity'), \
                 patch.object(client, 'container', return_value={'state':'FINISHED', 'container_id':'7001'}), \
                 patch.object(client, 'request', return_value={'id':'8001'}) as request, \
                 patch.object(client, 'posts', return_value=[{'id':'8001', 'caption':intent['text']} ]):
                self.assertEqual(meta_api.due_instagram(due + timedelta(seconds=20), ledger)['public_id'], '8001')
                self.assertEqual(meta_api.due_instagram(due + timedelta(seconds=20), ledger)['status'], 'public_readback_verified')
                self.assertEqual(request.call_count, 1)
            self.assertEqual(receipt.read_bytes(), original)
            self.assertEqual(json.loads(receipt.with_suffix('.publish.json').read_text())['intent'], intent)

    def test_instagram_due_honors_first_five_minutes_and_all_original_eight_slots(self):
        ledger = self.root / 'empty-ledger.json'; ledger.write_text('{"events":[]}')
        with patch('meta_api.MetaClient', side_effect=AssertionError('must not send')):
            for hour in (8, 10, 12, 14, 16, 17, 19, 21):
                slot = datetime(2026, 10, 12, hour, tzinfo=__import__('zoneinfo').ZoneInfo('America/Vancouver'))
                for seconds, status in ((-1, 'outside_slot'), (0, 'no_approved_record_due'),
                                        (299, 'no_approved_record_due'), (300, 'outside_slot')):
                    with self.subTest(hour=hour, seconds=seconds):
                        result = meta_api.due_instagram(slot + timedelta(seconds=seconds), ledger)
                        self.assertEqual(result['status'], status)

    def test_instagram_due_preserves_native_reservations_and_rejects_overlapping_slot(self):
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.MetaClient', side_effect=AssertionError('must not send')):
            due, ledger, intent, receipt = self.prepared_instagram_slot()
            native = {'content_id': 'GL-native', 'channels': {'instagram': {
                'status': 'scheduled', 'native_id': '9001', 'native_scheduled_saved': True,
                'scheduled_at': due.isoformat()}}}
            data = json.loads(ledger.read_text()); original = data['events'][0]
            ledger.write_text(json.dumps({'events': [native]}))
            self.assertEqual(meta_api.due_instagram(due, ledger)['status'], 'native_reservation_preserved')
            ledger.write_text(json.dumps({'events': [original, native]}))
            with self.assertRaisesRegex(MetaError, 'overlapping_original_slot'):
                meta_api.due_instagram(due, ledger)

    def test_instagram_due_keeps_account_hold_source_copy_and_acceptance_guards(self):
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.MetaClient', side_effect=AssertionError('must not send')):
            due, ledger, intent, receipt = self.prepared_instagram_slot()
            source = json.loads(ledger.read_text())
            for change in ({'account': 'other'}, {'platform': 'threads'}, {'action': 'reply'},
                           {'automation_id': 'other-job'}, {'hold': True}, {'uncertain': True},
                           {'text': 'changed'}, {'probe': True}):
                changed = dict(intent, **change)
                data = json.loads(json.dumps(source)); data['events'][0]['channels']['instagram']['api_intent'] = changed
                ledger.write_text(json.dumps(data))
                with self.subTest(change=change), self.assertRaises(MetaError):
                    meta_api.due_instagram(due, ledger)
            ledger.write_text(json.dumps(source))
            review = Path(intent['final_review_receipt']); data = json.loads(review.read_text()); data['accepted'] = False
            review.write_text(json.dumps(data))
            with self.assertRaisesRegex(MetaError, 'video_not_accepted'):
                meta_api.due_instagram(due, ledger)

    def test_instagram_due_uncertain_publication_is_get_only_and_never_retried(self):
        credential = self.root / 'instagram-api.json'
        credential.write_bytes(self.credentials.read_bytes()); credential.chmod(0o600)
        client = MetaClient('instagram', self.root)
        with patch('meta_api.OPERATIONS', self.root):
            due, ledger, intent, receipt = self.prepared_instagram_slot()
            from meta_api import private_json
            publication = receipt.with_suffix('.publish.json')
            private_json(publication, {'status': 'uncertain', 'attempted_at': due.isoformat()})
            original = publication.read_bytes()
            with patch('meta_api.MetaClient', return_value=client), \
                 patch.object(client, 'identity', return_value={'username': 'gling.app'}), patch.object(client, 'posts', return_value=[]), \
                 patch.object(client, 'publish', side_effect=AssertionError('must not resend')):
                result = meta_api.due_instagram(due + timedelta(seconds=20), ledger)
            self.assertEqual(result, {'status': 'uncertain', 'matches': 0, 'resend_allowed': False})
            self.assertEqual(publication.read_bytes(), original)

    def test_g9_transport_rechecks_first_five_minutes_at_actual_publish_validation(self):
        reel = self.accepted_reel()
        g9 = dict(reel, automation_id='978b9d5b-77f6-4839-bb85-23caeff3e0ea')
        validate_intent(g9, self.now + timedelta(seconds=299), publishing=True)
        with self.assertRaisesRegex(MetaError, 'outside_original_publication_slot'):
            validate_intent(g9, self.now + timedelta(seconds=300), publishing=True)
        validate_intent(reel, self.now + timedelta(seconds=900), publishing=True)

    def test_private_hyperframes_pilot_cannot_be_released_by_forged_acceptance(self):
        project = self.root / 'project'
        project.mkdir(); (project / 'index.html').write_text('<html></html>')
        manifest = project / 'source-manifest.json'
        manifest.write_text('{"private_preview_only":true,"public_release_ready":false}')
        video = self.root / 'video.mp4'; video.write_bytes(b'video')
        from meta_api import digest
        intent = dict(self.intent(), platform='instagram', action='reel', video_file=str(video),
                      video_sha256=digest(video.read_bytes()), hyperframes_project=str(project),
                      source_manifest_sha256=digest(manifest.read_bytes()), gling_post_id='existing-post',
                      cover_first_frame_verified=True, final_review_receipt=str(self.root / 'review.json'))
        review = {k: intent[k] for k in ('video_sha256', 'source_manifest_sha256', 'gling_post_id')}
        review.update(editor='HyperFrames', accepted=True, saved_reopened=True, gling_post_verified=True)
        Path(intent['final_review_receipt']).write_text(json.dumps(review))
        with self.assertRaises(MetaError):
            validate_intent(intent, self.now)

    def accepted_reel(self, category='전시', color='#E7A5C0'):
        from meta_api import digest
        project = self.root / 'accepted-project'; project.mkdir(exist_ok=True)
        index = project / 'index.html'
        index.write_text(f'<div style="--category-point:{color}"><div class="category">{category}</div></div>')
        manifest = project / 'source-manifest.json'
        manifest.write_text(json.dumps({'public_release_ready': True,
            'source_files': [{'path': 'index.html', 'sha256': digest(index.read_bytes())}]}))
        video = self.root / 'accepted-video.mp4'; video.write_bytes(b'accepted-video')
        intent = dict(self.intent(), platform='instagram', action='reel', video_file=str(video),
                      video_sha256=digest(video.read_bytes()), hyperframes_project=str(project),
                      source_manifest_sha256=digest(manifest.read_bytes()), gling_post_id='existing-post',
                      cover_first_frame_verified=True, final_review_receipt=str(self.root / 'accepted-review.json'))
        review = {k: intent[k] for k in ('video_sha256', 'source_manifest_sha256', 'gling_post_id')}
        review.update(editor='HyperFrames', accepted=True, saved_reopened=True, gling_post_verified=True)
        Path(intent['final_review_receipt']).write_text(json.dumps(review))
        return intent

    def test_accepted_reel_allows_each_matching_category_color(self):
        for category, color in [('페스티벌', '#CBB9FF'), ('전시', '#E7A5C0'), ('이벤트', '#5F7CF3')]:
            with self.subTest(category=category):
                validate_intent(self.accepted_reel(category, color), self.now)

    def test_accepted_reel_rejects_wrong_or_unknown_cover_category(self):
        for category, color in [('전시', '#CBB9FF'), ('이벤트', '#CBB9FF'),
                                ('페스티벌', '#E7A5C0'), ('행사', '#E9C15E')]:
            with self.subTest(category=category, color=color), self.assertRaisesRegex(MetaError, 'cover_category_color_contract_failed'):
                validate_intent(self.accepted_reel(category, color), self.now)

    def test_accepted_reel_rejects_index_changed_after_manifest_binding(self):
        intent = self.accepted_reel()
        index = Path(intent['hyperframes_project']) / 'index.html'
        index.write_text(index.read_text() + '<p>changed after acceptance</p>')
        with self.assertRaisesRegex(MetaError, 'changed_hyperframes_source'):
            validate_intent(intent, self.now)

    def staged_reel(self, tagged=False):
        intent = self.accepted_reel()
        intent['content_id'] += '-tagged' if tagged else '-untagged'
        intent['text'] = 'HANDSON Vancouver @handsonyvr'
        intent['copy_sha256'] = meta_api.digest(intent['text'].encode())
        if tagged:
            intent['user_tags'] = [{'username': 'handsonyvr'}]
            fields = ('platform', 'account', 'action', 'content_id', 'approved_at',
                      'copy_sha256', 'video_sha256', 'source_manifest_sha256', 'user_tags')
            self.approval.write_text(json.dumps({k: intent[k] for k in fields} |
                                               {'approved': True, 'owner_quote': 'API 계정태그+본문멘션'}))
        stage = self.root / 'staged.json'
        url = ('https://wjvahbdwmctzpkndqaxa.supabase.co/storage/v1/object/sign/'
               'sns-media/instagram/gling.app/' + intent['video_sha256'] + '.mp4?token=test-only')
        stage.write_text(json.dumps({'account': 'instagram:gling.app',
            'video': {'sha256': intent['video_sha256'], 'url': url},
            'signed_until': (self.now + timedelta(minutes=40)).isoformat()}))
        intent['staging_receipt'] = str(stage)
        source = self.root / 'tag-source.json'
        intent['source_record'] = str(source) + '#' + intent['content_id']
        source.write_text(json.dumps({'events': [{'content_id': intent['content_id'],
            'channels': {'instagram': {'status': 'api_ready', 'api_intent': intent}}}]}))
        credential = self.root / 'instagram-api.json'
        credential.write_bytes(self.credentials.read_bytes()); credential.chmod(0o600)
        return MetaClient('instagram', self.root), intent, url

    def test_reel_staged_body_preserves_default_and_encodes_exact_approved_user_tags(self):
        from io import BytesIO
        for tagged in (False, True):
            with self.subTest(tagged=tagged):
                client, intent, video_url = self.staged_reel(tagged)
                posts = []
                def http(request, timeout):
                    url = urlsplit(request.full_url)
                    self.assertEqual(url.hostname, 'graph.instagram.com')
                    self.assertEqual(request.get_header('Authorization'), 'Bearer private-token')
                    if url.path == '/v25.0/me':
                        result = {'user_id': client.user_id, 'username': 'gling.app'}
                    elif request.get_method() == 'POST':
                        self.assertEqual(url.path, '/v25.0/' + client.user_id + '/media')
                        body = parse_qs(request.data.decode())
                        expected = {'media_type': ['REELS'], 'caption': [intent['text']],
                                    'video_url': [video_url], 'thumb_offset': ['0']}
                        if tagged:
                            self.assertIn('user_tags', body)
                            self.assertEqual(json.loads(body['user_tags'][0]), [{'username': 'handsonyvr'}])
                            expected['user_tags'] = ['[{"username":"handsonyvr"}]']
                        self.assertEqual(body, expected)
                        posts.append(body)
                        result = {'id': '7001'}
                    else:
                        self.assertEqual(url.path, '/v25.0/7001')
                        result = {'status_code': 'FINISHED'}
                    return BytesIO(json.dumps(result).encode())
                with patch('meta_api.OPERATIONS', self.root), \
                     patch('meta_api.now_utc', return_value=self.now), \
                     patch.object(client.opener, 'open', side_effect=http):
                    receipt = operation_receipt(intent)
                    self.assertEqual(client.prepare(intent, receipt)['state'], 'FINISHED')
                    before = receipt.read_bytes()
                    with self.assertRaisesRegex(MetaError, 'attempt_exists'):
                        client.prepare(intent, receipt)
                    self.assertEqual(receipt.read_bytes(), before)
                self.assertEqual(len(posts), 1)

    def test_reel_user_tags_reject_malformed_or_inappropriate_intents_before_any_call(self):
        client, intent, _ = self.staged_reel(True)
        invalid = [None, [], 'handsonyvr', ['handsonyvr'], [{'username': None}],
                   [{'username': '@handsonyvr'}], [{'username': 'bad name'}],
                   [{'username': 'https://instagram.com/handsonyvr'}],
                   [{'username': '.'}], [{'username': 'a..b'}], [{'username': 'a' * 31}],
                   [{'username': 'handsonyvr', 'x': 0.5, 'y': 0.5}],
                   [{'username': 'handsonyvr'}] * 2,
                   [{'username': 'handsonyvr'}, {'username': 'HandsonYVR'}]]
        changes = [
            {'platform': 'threads', 'action': 'post'}, {'action': 'reply'}, {'probe': True},
            {'collaborators': ['handsonyvr']}, {'collaborators': []}]
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=self.now), \
             patch.object(client.opener, 'open', side_effect=AssertionError('invalid tag network call')):
            for tags in invalid:
                with self.subTest(tags=tags), self.assertRaisesRegex(MetaError, 'invalid_reel_user_tags'):
                    client.prepare(dict(intent, user_tags=tags), operation_receipt(intent))
            for change in changes:
                with self.subTest(change=change), self.assertRaisesRegex(MetaError, 'user_tags|collaborators'):
                    client.prepare(dict(intent, **change), operation_receipt(intent))
            self.assertFalse(operation_receipt(intent).exists())

    def test_reel_user_tags_require_exact_owner_approval_and_original_source(self):
        client, intent, _ = self.staged_reel(True)
        original = json.loads(self.approval.read_text())
        changes = [{'user_tags': [{'username': 'different'}]}, {'approved': False}, {'owner_quote': ''}]
        changes += [{key: 'changed'} for key in ('platform', 'account', 'action', 'content_id',
                    'approved_at', 'copy_sha256', 'video_sha256', 'source_manifest_sha256')]
        with patch('meta_api.OPERATIONS', self.root), patch('meta_api.now_utc', return_value=self.now), \
             patch.object(client.opener, 'open', side_effect=AssertionError('unapproved tag network call')):
            for change in changes:
                self.approval.write_text(json.dumps(dict(original, **change)))
                with self.subTest(change=change), self.assertRaisesRegex(MetaError, 'user_tags'):
                    client.prepare(intent, operation_receipt(intent))
            self.approval.write_text(json.dumps(original))
            changed = dict(intent, user_tags=[{'username': 'different'}])
            with self.assertRaisesRegex(MetaError, 'user_tags'):
                client.prepare(changed, operation_receipt(intent))
            self.approval.write_text(json.dumps(dict(original, user_tags=changed['user_tags'])))
            with self.assertRaisesRegex(MetaError, 'original_approved_plan_changed'):
                client.prepare(changed, operation_receipt(intent))
            self.assertFalse(operation_receipt(intent).exists())

    def test_reel_tag_request_cannot_override_approval_or_send_collaborators(self):
        client, intent, _ = self.staged_reel(True)
        endpoint = client.user_id + '/media'
        for path, params, approved in [
            (endpoint, {'media_type': 'REELS', 'user_tags': '[{"username":"different"}]'}, intent),
            (endpoint, {'media_type': 'REELS'}, intent),
            (endpoint, {'media_type': 'REELS', 'user_tags': '[{"username":"handsonyvr"}]'}, None),
            ('7001/comments', {'user_tags': '[{"username":"handsonyvr"}]'}, intent),
            (endpoint, {'collaborators': ['handsonyvr']}, None),
        ]:
            with self.subTest(params=params), patch('meta_api.now_utc', return_value=self.now), \
                 patch.object(client.opener, 'open', side_effect=AssertionError('unapproved tag request')), \
                 self.assertRaisesRegex(MetaError, 'user_tags|collaborators'):
                client.request(path, params, 'POST', intent=approved)


class CorrectiveDeleteChecks(unittest.TestCase):
    def setUp(self):
        from meta_api import digest
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.now = datetime(2026, 10, 11, 6, tzinfo=timezone.utc)
        self.batch = self.root / 'gling-cover-approved-2026-10-10'
        self.batch.mkdir()
        self.queue = self.batch / 'approved-replacement-queue.json'
        self.project = self.root / 'hyperframes'
        self.project.mkdir()
        (self.project / 'index.html').write_text('<html></html>')
        (self.project / 'source-manifest.json').write_text('{}')
        self.video = self.root / 'video.mp4'; self.video.write_bytes(b'accepted-video')
        self.cover = self.root / 'cover.png'; self.cover.write_bytes(b'accepted-cover')
        self.approval = self.root / 'approval.json'; self.approval.write_text('{"accepted":true}')
        self.review = self.root / 'final-review.json'
        intent = {'platform': 'instagram', 'account': 'gling.app', 'action': 'reel',
                  'content_id': 'GL-RPL-1001-20261010', 'text': 'accepted replacement',
                  'copy_sha256': digest(b'accepted replacement'),
                  'approval_receipt': str(self.approval), 'approved_at': self.now.isoformat(),
                  'source_record': str(self.queue) + '#GL-RPL-1001-20261010',
                  'video_file': str(self.video), 'video_sha256': digest(self.video.read_bytes()),
                  'cover_file': str(self.cover), 'cover_sha256': digest(self.cover.read_bytes()),
                  'hyperframes_project': str(self.project),
                  'source_manifest_sha256': digest(b'{}'), 'gling_post_id': 'existing-gling-post',
                  'final_review_receipt': str(self.review)}
        review = {k: intent[k] for k in ('video_sha256', 'cover_sha256', 'source_manifest_sha256', 'gling_post_id')}
        review.update(editor='HyperFrames', accepted=True, saved_reopened=True, gling_post_verified=True,
                      owner_acceptance_receipt=str(self.approval), owner_acceptance_sha256=digest(self.approval.read_bytes()))
        self.review.write_text(json.dumps(review))
        self.manifest = self.root / 'review-manifest.json'
        self.manifest.write_text(json.dumps({'owner_acceptance': str(self.approval),
            'owner_acceptance_sha256': digest(self.approval.read_bytes()),
            'videos': [{'group': 'original-public-28', 'original_public_id': str(1001 + n),
                        'video_sha256': digest(self.video.read_bytes())} for n in range(28)]}))
        entry = {'content_id': intent['content_id'], 'original_public_id': '1001', 'status': 'new_reel_public_verified_old_deletion_pending',
                 'api_intent': intent, 'channels': {'instagram': {'status': 'published', 'public_id': '2001', 'api_intent': intent}},
                 'publication_result': {'public_id': '2001'}}
        self.data = {'account_handle': 'gling.app', 'original_deadline': None,
                     'accepted_review_manifest': str(self.manifest),
                     'accepted_review_manifest_sha256': digest(self.manifest.read_bytes()),
                     'entries': [entry] + [{'original_public_id': str(1001+n), 'channels': {'instagram': {'public_id': str(2001+n)}}} for n in range(1,28)]}
        self.queue.write_text(json.dumps(self.data))
        self.pin = patch('meta_api.CORRECTIVE_QUEUE_SHA256', digest(self.queue.read_bytes()), create=True)
        self.pin.start(); self.addCleanup(self.pin.stop)
        self.ops = patch('meta_api.OPERATIONS', self.root); self.ops.start(); self.addCleanup(self.ops.stop)
        self.clock = patch('meta_api.now_utc', return_value=self.now); self.time_mock = self.clock.start(); self.addCleanup(self.clock.stop)
        credential = self.root / 'instagram-api.json'
        credential.write_text(json.dumps({'access_token': 'test-instagram-token', 'username': 'gling.app'})); credential.chmod(0o600)
        self.binding = self.root / 'previous-binding.json'
        self.binding.write_text(json.dumps({'results': [{'endpoint': 'me', 'status': 200, 'response': {'id': '3001'}}]}))
        self.facebook = self.root / 'facebook-login-pending.json'
        self.fb_data = {'access_token': 'test-facebook-user-token', 'meta_app_id': '1696778162062283',
                        'expected_instagram_username': 'gling.app', 'expected_instagram_user_id': '17841430674685962',
                        'expected_facebook_page_id': '1362245160303253',
                        'verification_report': str(self.binding), 'expires_at': (self.now+timedelta(hours=1)).isoformat()}
        self.facebook.write_text(json.dumps(self.fb_data)); self.facebook.chmod(0o600)
        self.client = MetaClient('instagram', self.root)
        self.calls = []; self.deleted = False; self.after_delete_error = False
        self.expected_delete_attempt = self.batch / '1001.delete-attempt.json'
        self.expected_delete_id = '1001'
        self.current = [{'id': '1001', 'caption': 'original', 'media_type': 'VIDEO', 'media_product_type': 'REELS'},
                        {'id': '2001', 'caption': 'accepted replacement', 'media_type': 'VIDEO', 'media_product_type': 'REELS'}]
        self.grants = ['instagram_basic', 'instagram_manage_contents', 'pages_show_list', 'pages_read_engagement']
        self.page_ig = {'id': '17841430674685962', 'username': 'gling.app'}
        self.transport = patch.object(self.client.opener, 'open', side_effect=self.http)
        self.transport.start(); self.addCleanup(self.transport.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def http(self, request, timeout):
        from io import BytesIO
        url = urlsplit(request.full_url); path = url.path
        self.calls.append((request.get_method(), url.hostname, path, parse_qs(url.query), request.get_header('Authorization')))
        if url.hostname == 'graph.instagram.com':
            if path == '/v25.0/me': data = {'user_id': '17841430674685962', 'username': 'gling.app'}
            elif path == '/v25.0/17841430674685962/media':
                if self.deleted and self.after_delete_error: raise MetaError('readback_unavailable')
                data = {'data': [r for r in self.current if not (self.deleted and r['id'] == self.expected_delete_id)]}
            else: self.fail('Unexpected Instagram endpoint')
        else:
            self.assertEqual(url.hostname, 'graph.facebook.com')
            self.assertEqual(request.get_header('Authorization'), 'Bearer test-facebook-user-token')
            if request.get_method() == 'DELETE':
                self.assertEqual(path, '/v25.0/' + self.expected_delete_id)
                self.assertTrue(self.expected_delete_attempt.exists())
                self.deleted = True; data = {'success': True, 'deleted_id': self.expected_delete_id}
            elif path == '/v25.0/me': data = {'id': '3001'}
            elif path == '/v25.0/me/permissions': data = {'data': [{'permission': p, 'status': 'granted'} for p in self.grants]}
            elif path == '/v25.0/me/accounts': data = {'data': [{'id': '1362245160303253', 'tasks': ['MANAGE'], 'instagram_business_account': self.page_ig}]}
            elif path == '/v25.0/17841430674685962': data = self.page_ig
            elif path == '/v25.0/' + self.expected_delete_id: data = {'id': self.expected_delete_id, 'media_type': 'VIDEO'}
            else: self.fail('Unexpected Facebook endpoint')
        return BytesIO(json.dumps(data).encode())

    def test_generic_instagram_deletion_uses_verified_facebook_login_and_exact_approval(self):
        self.expected_delete_id = '4001'
        self.expected_delete_attempt = self.root / 'meta-api/instagram/deletions/gling.app/4001.delete-attempt.json'
        self.current.append({'id': '4001', 'caption': 'own post'})
        intent = MetaChecks.deletion_intent(self, self.client, media_id='4001')
        self.assertEqual(self.client.delete_post('4001')['status'], 'delete_preflight_ready')
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))
        result = self.client.delete_post('4001', execute=True, intent=intent)
        self.assertTrue(result['deleted_verified'])
        calls = [c for c in self.calls if c[0] == 'DELETE']
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1:3], ('graph.facebook.com', '/v25.0/4001'))
        self.assertEqual(calls[0][4], 'Bearer test-facebook-user-token')

    def test_generic_instagram_deletion_keeps_page_binding_required(self):
        self.current.append({'id': '4001', 'caption': 'own post'})
        intent = MetaChecks.deletion_intent(self, self.client, media_id='4001')
        self.page_ig = {'id': self.client.user_id, 'username': 'other-account'}
        with self.assertRaisesRegex(MetaError, 'facebook_current_page_to_instagram_binding_missing'):
            self.client.delete_post('4001', execute=True, intent=intent)
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))

    def test_generic_deletion_cannot_bypass_original_corrective_or_unknown_attempt_guards(self):
        with patch.object(self.client, 'delete_media', return_value={'status': 'original_guard'}) as legacy:
            self.assertEqual(self.client.delete_post('1001'), {'status': 'original_guard'})
        legacy.assert_called_once_with('1001', execute=False)
        (self.batch / '4001.delete-attempt.json').write_text('{"status":"uncertain"}')
        with self.assertRaisesRegex(MetaError, 'legacy_delete_attempt_requires_read_only_reconciliation'):
            self.client.delete_post('4001', execute=True)
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))

    def repin(self):
        from meta_api import digest
        self.queue.write_text(json.dumps(self.data))
        self.pin.stop(); self.pin = patch('meta_api.CORRECTIVE_QUEUE_SHA256', digest(self.queue.read_bytes()), create=True)
        self.pin.start(); self.addCleanup(self.pin.stop)

    def test_read_only_preflight_uses_facebook_user_route_and_preserves_instagram_login(self):
        self.assertTrue(callable(getattr(self.client, 'delete_media', None)), 'Missing guarded corrective media deletion entry')
        result = self.client.delete_media('1001')
        self.assertEqual(result['status'], 'delete_preflight_ready')
        self.assertEqual(result['new_public_id'], '2001')
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))
        self.assertFalse((self.batch/'1001.delete-attempt.json').exists())
        self.assertEqual(self.client.host, 'https://graph.instagram.com')
        self.assertEqual(self.client.token, 'test-instagram-token')
        self.assertTrue(all('access_token' not in c[3] for c in self.calls))

    def test_expired_facebook_token_blocks_before_network_and_without_attempt(self):
        self.fb_data['expires_at'] = self.now.isoformat(); self.facebook.write_text(json.dumps(self.fb_data))
        with self.assertRaisesRegex(MetaError, 'facebook_token_expired'):
            self.client.delete_media('1001', execute=True)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.batch/'1001.delete-attempt.json').exists())

    def test_old_whitelist_rejects_replacement_future_private_and_outside_ids(self):
        for media_id in ['2001', '9001', '9002', '../1001']:
            with self.subTest(media_id=media_id), self.assertRaises(MetaError):
                self.client.delete_media(media_id, execute=True)
        self.assertEqual(self.calls, [])

    def test_existing_uncertain_attempt_is_never_retried(self):
        attempt = self.batch/'1001.delete-attempt.json'; attempt.write_text('{"status":"uncertain"}')
        with self.assertRaisesRegex(MetaError, 'attempt_exists'):
            self.client.delete_media('1001', execute=True)
        self.assertEqual(self.calls, [])
        self.assertEqual(json.loads(attempt.read_text())['status'], 'uncertain')

    def test_changed_approved_queue_held_private_and_future_source_are_rejected(self):
        self.queue.write_text(self.queue.read_text()+' ')
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertEqual(self.calls, [])
        for protection in [{'held': True}, {'uncertain': True}, {'submission_kind': 'native_future_schedule'}, {'status': 'scheduled'}]:
            entry = self.data['entries'][0]; original = dict(entry); entry.update(protection); self.repin()
            with self.subTest(protection=protection), self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
            self.data['entries'][0] = original
        self.assertEqual(self.calls, [])
        self.repin(); (self.project/'source-manifest.json').write_text('{"private_preview_only":true}')
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertEqual(self.calls, [])

    def test_wrong_grants_page_binding_and_changed_new_copy_cannot_delete(self):
        self.grants.remove('instagram_manage_contents')
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.grants.append('instagram_manage_contents'); self.page_ig = {'id': '1', 'username': 'other'}
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.page_ig = {'id': '17841430674685962', 'username': 'gling.app'}
        self.current[1]['caption'] = 'changed'
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))
        self.assertFalse((self.batch/'1001.delete-attempt.json').exists())

    def test_explicit_execute_sends_once_and_verifies_original_absent(self):
        result = self.client.delete_media('1001', execute=True)
        self.assertEqual(result['status'], 'deleted_public_absence_verified')
        self.assertTrue(result['deleted_verified']); self.assertFalse(result['original_still_present'])
        self.assertEqual(sum(c[0] == 'DELETE' for c in self.calls), 1)
        attempt = self.batch/'1001.delete-attempt.json'
        self.assertEqual(json.loads(attempt.read_text())['status'], 'response_received')
        self.assertEqual(attempt.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertEqual(sum(c[0] == 'DELETE' for c in self.calls), 1)

    def test_missing_post_delete_readback_cannot_be_reported_as_success_or_resent(self):
        self.after_delete_error = True
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        readback = json.loads((self.batch/'1001.delete-readback.json').read_text())
        self.assertFalse(readback['deleted_verified'])
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertEqual(sum(c[0] == 'DELETE' for c in self.calls), 1)

    def test_credentials_or_expiry_changing_during_preflight_prevent_a_delete_attempt(self):
        for change in ('file_changed', 'expired'):
            self.time_mock.return_value = self.now
            self.facebook.write_text(json.dumps(self.fb_data))
            def changing_http(request, timeout):
                response = self.http(request, timeout)
                if request.get_method() == 'GET' and urlsplit(request.full_url).path == '/v25.0/1001':
                    if change == 'file_changed': self.facebook.write_text(self.facebook.read_text()+' ')
                    else: self.time_mock.return_value = self.now + timedelta(hours=2)
                return response
            with self.subTest(change=change), patch.object(self.client.opener, 'open', side_effect=changing_http):
                with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
            self.assertFalse((self.batch/'1001.delete-attempt.json').exists())
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))

    def test_cli_defaults_to_private_read_only_preflight(self):
        output = self.root/'delete-preflight.json'
        with patch('meta_api.MetaClient', return_value=self.client), patch('sys.argv',
                ['meta_api.py', 'delete-media', 'instagram', '--media-id', '1001', '--out', str(output)]), patch('builtins.print'):
            self.assertEqual(main(), 0)
        self.assertEqual(json.loads(output.read_text())['status'], 'delete_preflight_ready')
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))

    def test_unaccepted_counterpart_expired_deadline_and_wrong_facebook_user_are_blocked(self):
        review = json.loads(self.review.read_text()); review['accepted'] = False; self.review.write_text(json.dumps(review))
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        review['accepted'] = True; self.review.write_text(json.dumps(review))
        self.data['original_deadline'] = (self.now - timedelta(seconds=1)).isoformat(); self.repin()
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertEqual(self.calls, [])
        self.data['original_deadline'] = None; self.repin()
        self.binding.write_text('{"results":[{"endpoint":"me","status":200,"response":{"id":"wrong-user"}}]}')
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))
        self.assertFalse((self.batch/'1001.delete-attempt.json').exists())

    def test_malformed_facebook_grants_are_a_private_blocker(self):
        from io import BytesIO
        def malformed_http(request, timeout):
            response = self.http(request, timeout)
            if urlsplit(request.full_url).path == '/v25.0/me/permissions':
                return BytesIO(b'{"data":"malformed"}')
            return response
        with patch.object(self.client.opener, 'open', side_effect=malformed_http):
            with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertFalse(any(c[0] == 'DELETE' for c in self.calls))
        self.assertFalse((self.batch/'1001.delete-attempt.json').exists())

    def test_unknown_delete_response_is_uncertain_and_never_automatically_retried(self):
        from io import BytesIO
        def incomplete_http(request, timeout):
            response = self.http(request, timeout)
            return BytesIO(b'{"success":true}') if request.get_method() == 'DELETE' else response
        with patch.object(self.client.opener, 'open', side_effect=incomplete_http):
            with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertEqual(json.loads((self.batch/'1001.delete-attempt.json').read_text())['status'], 'uncertain')
        with self.assertRaises(MetaError): self.client.delete_media('1001', execute=True)
        self.assertEqual(sum(c[0] == 'DELETE' for c in self.calls), 1)


if __name__ == '__main__':
    unittest.main()
