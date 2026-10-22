import json
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import youtube_api
from meta_api import MetaError, digest


class YouTubeTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.now = datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc)
        self.ledger = self.root / 'ledger.json'
        self.video = self.root / 'master.mp4'
        self.video.write_bytes(b'accepted-video')
        self.review = self.root / 'review.json'
        self.review.write_text(json.dumps({'youtube_rights_verified': True}))
        self.approval = self.root / 'approval.json'
        self.intent = {
            'platform': 'youtube', 'account': youtube_api.CHANNEL,
            'automation_id': youtube_api.INSTAGRAM_AUTOMATION, 'content_id': 'GL-P-YT-1',
            'status': 'api_ready', 'submission_kind': 'api_local_queue',
            'approved_at': (self.now - timedelta(hours=1)).isoformat(), 'approval_receipt': str(self.approval),
            'scheduled_for': self.now.isoformat(),
            'source_record': str(self.ledger) + '#GL-P-YT-1',
            'video_file': str(self.video), 'video_sha256': digest(self.video.read_bytes()),
            'hyperframes_project': str(self.root / 'project'),
            'source_manifest_sha256': 'a' * 64, 'gling_post_id': 'post-1',
            'final_review_receipt': str(self.review), 'final_review_sha256': digest(self.review.read_bytes()),
            'title': 'Example Café | 캐나다 몬트리올에서 가야 하는 카페!',
            'description': '카페 소개\n글링 다운로드는 채널 프로필의 첫 번째 링크에서 확인해 주세요.',
            'made_for_kids': False, 'contains_synthetic_media': False,
        }
        self.intent['metadata_sha256'] = youtube_api.metadata_hash(self.intent)
        self.approve()
        self.save_source()
        self.addCleanup(patch.stopall)
        patch('youtube_api.ROOT', self.root / 'youtube').start()
        patch('youtube_api.now_utc', return_value=self.now).start()
        patch('youtube_api.validate_reel_master').start()
        patch('youtube_api.probe_short').start()

    def approve(self):
        self.approval.write_text(json.dumps({'kind': 'morning_batch', 'owner_quote': '완성본 두 채널 게시해',
            'approved_at': self.intent['approved_at'], 'items': [self.intent]}))

    def save_source(self):
        self.ledger.write_text(json.dumps({'events': [{'content_id': self.intent['content_id'],
            'channels': {'instagram': {'status': 'published', 'public_id': 'keep-instagram'},
                         'youtube': {'status': 'api_ready', 'api_intent': self.intent}}}]}))

    def client(self):
        client = Mock()
        client.upload.return_value = {'id': 'abcdefghijk'}
        client.video.return_value = {'id': 'abcdefghijk',
            'snippet': {'channelId': youtube_api.CHANNEL, 'title': self.intent['title'],
                        'description': self.intent['description']},
            'status': {'privacyStatus': 'public', 'uploadStatus': 'processed'},
            'processingDetails': {'processingStatus': 'succeeded'}}
        return client

    def test_exact_youtube_approval_is_separate_from_instagram(self):
        youtube_api.validate_intent(self.intent, self.now)
        proof = json.loads(self.approval.read_text())
        proof['items'][0]['platform'] = 'instagram'
        self.approval.write_text(json.dumps(proof))
        with self.assertRaisesRegex(MetaError, 'exact_youtube_approval'):
            youtube_api.validate_intent(self.intent, self.now)

    def test_shorts_copy_rejects_links_and_missing_city_category_or_profile_cta(self):
        changes = [
            {'description': self.intent['description'] + '\nhttps://example.com/place'},
            {'description': self.intent['description'] + '\nwww.example.ca'},
            {'description': self.intent['description'] + '\ngling.ej-entertainment.com/post'},
            {'description': '글링을 다운로드해 주세요.'},
            {'title': '몬트리올 예쁜 카페 #Shorts'},
        ]
        for change in changes:
            with self.subTest(change=change):
                item = dict(self.intent, **change)
                item['metadata_sha256'] = youtube_api.metadata_hash(item)
                with self.assertRaisesRegex(MetaError, 'youtube_shorts_copy_policy'):
                    youtube_api.validate_intent(item, self.now)

    def replacement_intent(self):
        old = youtube_api.receipt_path(self.intent)
        youtube_api.private_json(old, {'status': 'response_received', 'intent': dict(self.intent),
                                      'response': {'id': 'oldvideo123'}})
        self.intent.update(upload_attempt='reset20261018', replaces_video_id='oldvideo123')
        self.approve(); self.save_source()
        return old

    def test_reupload_keeps_old_receipt_and_requires_live_absence_before_inserting(self):
        old = self.replacement_intent()
        previous = old.read_bytes()
        client = self.client()
        client.request.return_value = {'items': [{'id': 'oldvideo123'}]}
        with self.assertRaisesRegex(MetaError, 'previous_video_still_present'):
            youtube_api.advance(self.intent, self.now, client)
        client.upload.assert_not_called()
        self.assertEqual(old.read_bytes(), previous)
        client.request.return_value = {'items': []}
        youtube_api.advance(self.intent, self.now, client)
        youtube_api.advance(self.intent, self.now, client)
        self.assertEqual(client.upload.call_count, 1)
        self.assertNotEqual(old, youtube_api.receipt_path(self.intent))
        self.assertEqual(old.read_bytes(), previous)

    def test_reupload_of_protected_first_videos_or_uncertain_upload_is_rejected(self):
        old = self.replacement_intent()
        proof = json.loads(self.approval.read_text())
        proof['protected_video_ids'] = ['oldvideo123']
        self.approval.write_text(json.dumps(proof))
        with self.assertRaisesRegex(MetaError, 'protected_youtube_video'):
            youtube_api.advance(self.intent, self.now, self.client())
        self.approve()
        record = json.loads(old.read_text()); record['status'] = 'uncertain'
        youtube_api.private_json(old, record)
        with self.assertRaisesRegex(MetaError, 'previous_upload_reconcile'):
            youtube_api.advance(self.intent, self.now, self.client())

    def test_thumbnail_uses_approved_cover_once_and_unknown_response_does_not_retry(self):
        cover = self.root / 'cover.png'; cover.write_bytes(b'\x89PNG\r\n\x1a\ncover')
        item = dict(self.intent, cover_file=str(cover), cover_sha256=digest(cover.read_bytes()),
                    cover_first_frame_verified=True)
        self.intent = item
        self.approve(); self.save_source()
        client = youtube_api.YouTubeClient.__new__(youtube_api.YouTubeClient)
        client.request = Mock(return_value={'items': [{'high': {'url': 'https://i.ytimg.com/cover.jpg'}}]})
        youtube_api.YouTubeClient.set_thumbnail(client, item, 'abcdefghijk')
        youtube_api.YouTubeClient.set_thumbnail(client, item, 'abcdefghijk')
        self.assertEqual(client.request.call_count, 1)
        self.assertEqual(client.request.call_args.kwargs['params']['videoId'], 'abcdefghijk')
        self.assertEqual(client.request.call_args.kwargs['data'], cover.read_bytes())
        receipt = youtube_api.receipt_path(item).with_suffix('.thumbnail.json')
        receipt.unlink()
        client.request.side_effect = MetaError('youtube_response_unknown')
        with self.assertRaises(MetaError):
            youtube_api.YouTubeClient.set_thumbnail(client, item, 'abcdefghijk')
        with self.assertRaisesRegex(MetaError, 'thumbnail_uncertain'):
            youtube_api.YouTubeClient.set_thumbnail(client, item, 'abcdefghijk')
        self.assertEqual(client.request.call_count, 2)

    def test_hold_during_video_readback_prevents_thumbnail_post(self):
        cover = self.root / 'cover.png'; cover.write_bytes(b'\x89PNG\r\n\x1a\ncover')
        self.intent.update(cover_file=str(cover), cover_sha256=digest(cover.read_bytes()),
                           cover_first_frame_verified=True, thumbnail_policy='first_cover_api')
        self.approve(); self.save_source()
        self.saved_upload(self.intent, status='public_verified', public_verified=True)
        client = self.client()
        video = client.video.return_value
        def held_during_readback(_):
            data = json.loads(self.ledger.read_text())
            data['events'][0]['channels']['youtube']['status'] = 'held'
            self.ledger.write_text(json.dumps(data))
            return video
        client.video.side_effect = held_during_readback
        client.request.return_value = {'items': [{'high': {'url': 'https://i.ytimg.com/cover.jpg'}}]}
        client.set_thumbnail.side_effect = lambda item, video_id: youtube_api.YouTubeClient.set_thumbnail(client, item, video_id)
        with self.assertRaisesRegex(MetaError, 'protected_source'):
            youtube_api.advance(self.intent, self.now, client)
        client.request.assert_not_called()
        client.upload.assert_not_called()

    def test_thumbnail_pending_does_not_reinsert_public_video(self):
        self.intent['thumbnail_policy'] = 'first_cover_api'
        self.approve(); self.save_source()
        self.saved_upload(self.intent, status='public_verified', public_verified=True)
        client = self.client()
        client.set_thumbnail.return_value = {'status': 'api_accepted'}
        with patch('youtube_api.YouTubeClient', return_value=client):
            result = youtube_api.due(self.now, self.ledger)
        self.assertTrue(result['public_verified'])
        self.assertEqual(result['thumbnail']['status'], 'api_accepted')
        client.upload.assert_not_called()

    def test_metadata_and_rights_cannot_change_after_owner_approval(self):
        changed = dict(self.intent, title='different title')
        with self.assertRaisesRegex(MetaError, 'metadata_changed'):
            youtube_api.validate_intent(changed, self.now)
        self.review.write_text(json.dumps({'youtube_rights_verified': False}))
        self.intent['final_review_sha256'] = digest(self.review.read_bytes())
        self.approve()
        with self.assertRaisesRegex(MetaError, 'youtube_rights'):
            youtube_api.validate_intent(self.intent, self.now)

    def test_wrong_channel_held_source_and_private_master_are_rejected(self):
        with self.assertRaisesRegex(MetaError, 'wrong_youtube_account'):
            youtube_api.validate_intent(dict(self.intent, account='other-channel'), self.now)
        row = json.loads(self.ledger.read_text())
        row['events'][0]['held'] = True
        self.ledger.write_text(json.dumps(row))
        with self.assertRaisesRegex(MetaError, 'protected_source'):
            youtube_api.validate_source(self.intent)
        with patch('youtube_api.validate_reel_master', side_effect=MetaError('private_or_held_hyperframes_source')):
            with self.assertRaisesRegex(MetaError, 'private_or_held'):
                youtube_api.validate_intent(self.intent, self.now)

    def test_attempt_is_saved_before_upload_and_success_is_never_inserted_twice(self):
        client = self.client()
        def upload(intent):
            receipt = json.loads(youtube_api.receipt_path(intent).read_text())
            self.assertEqual(receipt['status'], 'attempted')
            return {'id': 'abcdefghijk'}
        client.upload.side_effect = upload
        first = youtube_api.advance(self.intent, self.now, client)
        second = youtube_api.advance(self.intent, self.now, client)
        self.assertEqual(first['status'], 'public_verified')
        self.assertEqual(second['video_id'], 'abcdefghijk')
        self.assertEqual(client.upload.call_count, 1)
        self.assertEqual(youtube_api.receipt_path(self.intent).stat().st_mode & 0o777, 0o600)

    def test_uncertain_upload_and_missed_slot_do_not_automatically_resend(self):
        client = self.client()
        client.upload.side_effect = MetaError('youtube_response_unknown')
        with self.assertRaises(MetaError):
            youtube_api.advance(self.intent, self.now, client)
        with self.assertRaisesRegex(MetaError, 'uncertain.*reconcile'):
            youtube_api.advance(self.intent, self.now, client)
        self.assertEqual(client.upload.call_count, 1)
        youtube_api.receipt_path(self.intent).unlink()
        with self.assertRaisesRegex(MetaError, 'original_upload_slot'):
            youtube_api.advance(self.intent, self.now + timedelta(hours=2), client)
        self.assertEqual(client.upload.call_count, 1)

    def test_private_upload_is_not_reported_as_public_and_wrong_readback_is_rejected(self):
        client = self.client()
        client.video.return_value['status']['privacyStatus'] = 'private'
        result = youtube_api.advance(self.intent, self.now, client)
        self.assertEqual(result['status'], 'uploaded_visibility_unconfirmed')
        self.assertFalse(result['public_verified'])
        client.video.return_value['snippet']['channelId'] = 'wrong-channel'
        with self.assertRaisesRegex(MetaError, 'readback_mismatch'):
            youtube_api.advance(self.intent, self.now, client)

    def add_intent(self, content_id='GL-P-YT-2', **changes):
        other = dict(self.intent, content_id=content_id,
                     source_record=str(self.ledger) + '#' + content_id, **changes)
        other['metadata_sha256'] = youtube_api.metadata_hash(other)
        proof = json.loads(self.approval.read_text())
        proof['items'].append(other)
        self.approval.write_text(json.dumps(proof))
        data = json.loads(self.ledger.read_text())
        data['events'].append({'content_id': content_id, 'channels': {'youtube':
            {'status': 'api_ready', 'api_intent': other}}})
        self.ledger.write_text(json.dumps(data))
        return other

    def saved_upload(self, intent, **proof):
        receipt = youtube_api.receipt_path(intent)
        youtube_api.private_json(receipt, {'status': 'response_received', 'intent': intent,
                                          'response': {'id': 'abcdefghijk'}})
        youtube_api.private_json(receipt.with_suffix('.readback.json'), proof)

    def test_future_queue_does_not_construct_oauth_client(self):
        self.intent['scheduled_for'] = (self.now + timedelta(hours=1)).isoformat()
        self.approve(); self.save_source()
        with patch('youtube_api.YouTubeClient', side_effect=AssertionError('No OAuth')):
            self.assertEqual(youtube_api.due(self.now, self.ledger)['status'], 'no_youtube_action_due')
        self.assertFalse(youtube_api.receipt_path(self.intent).exists())

    def test_future_source_hold_or_cancel_is_not_hidden_by_waiting(self):
        self.intent['scheduled_for'] = (self.now + timedelta(hours=1)).isoformat()
        self.approve(); self.save_source()
        for state in ('held', 'cancelled'):
            data = json.loads(self.ledger.read_text())
            data['events'][0]['channels']['youtube']['status'] = state
            self.ledger.write_text(json.dumps(data))
            with patch('youtube_api.YouTubeClient', side_effect=AssertionError('No OAuth')):
                for tick in (self.now, self.now + timedelta(hours=1)):
                    result = youtube_api.due(tick, self.ledger)
                    self.assertEqual(result['protected_attempts'], 1)
            self.assertFalse(youtube_api.receipt_path(self.intent).exists())

    def test_cancelled_or_invalid_item_does_not_starve_due_item(self):
        second = self.add_intent()
        for state in ('cancelled', 'invalid_title'):
            self.save_source()
            data = json.loads(self.ledger.read_text())
            data['events'].append({'content_id': second['content_id'], 'channels': {'youtube':
                {'status': 'api_ready', 'api_intent': second}}})
            if state == 'cancelled':
                data['events'][0]['channels']['youtube']['status'] = state
            else:
                data['events'][0]['channels']['youtube']['api_intent']['title'] = ' '
            self.ledger.write_text(json.dumps(data))
            with patch('youtube_api.YouTubeClient', return_value=self.client()), \
                    patch('youtube_api.advance', return_value={'status': 'selected'}) as advance:
                youtube_api.due(self.now, self.ledger)
            self.assertEqual(advance.call_args.args[0]['content_id'], second['content_id'])

    def test_failed_readback_does_not_starve_pending_readback_and_keeps_evidence(self):
        second = self.add_intent()
        self.saved_upload(self.intent, status='upload_failed_or_rejected', observed_at=self.now.isoformat())
        self.saved_upload(second, status='uploaded_visibility_unconfirmed', observed_at=self.now.isoformat())
        old = youtube_api.receipt_path(self.intent).with_suffix('.readback.json').read_bytes()
        with patch('youtube_api.YouTubeClient', return_value=self.client()), \
                patch('youtube_api.advance', return_value={'status': 'selected'}) as advance:
            youtube_api.due(self.now, self.ledger)
        self.assertEqual(advance.call_args.args[0]['content_id'], second['content_id'])
        self.assertEqual(youtube_api.receipt_path(self.intent).with_suffix('.readback.json').read_bytes(), old)

    def test_pending_readbacks_rotate_by_last_observation_and_new_due_uploads_win(self):
        second = self.add_intent()
        for item in (self.intent, second):
            self.saved_upload(item, status='uploaded_visibility_unconfirmed',
                              observed_at=(self.now - timedelta(minutes=2)).isoformat())
        client = self.client()
        client.video.return_value['status']['uploadStatus'] = 'uploaded'
        client.video.return_value['processingDetails']['processingStatus'] = 'processing'
        with patch('youtube_api.YouTubeClient', return_value=client):
            self.assertEqual(youtube_api.due(self.now, self.ledger)['content_id'], self.intent['content_id'])
            self.assertEqual(youtube_api.due(self.now, self.ledger)['content_id'], second['content_id'])
            third = self.add_intent('GL-P-YT-3')
            self.assertEqual(youtube_api.due(self.now, self.ledger)['content_id'], third['content_id'])
        self.assertEqual(client.upload.call_count, 1)

    def test_invalid_readback_cannot_starve_another_known_upload(self):
        second = self.add_intent()
        for item in (self.intent, second):
            self.saved_upload(item, status='uploaded_visibility_unconfirmed', observed_at=self.now.isoformat())
        client = self.client()
        wrong = self.client().video.return_value
        wrong['snippet']['title'] = 'unapproved remote title'
        client.video.side_effect = [wrong, self.client().video.return_value]
        with patch('youtube_api.YouTubeClient', return_value=client) as constructor:
            result = youtube_api.due(self.now, self.ledger)
        self.assertEqual(result['content_id'], second['content_id'])
        self.assertIn('readback_mismatch', result['held_items'][0]['error'])
        self.assertEqual(constructor.call_count, 1)
        client.upload.assert_not_called()

    def test_malformed_remote_readback_does_not_starve_another_known_upload(self):
        second = self.add_intent()
        for item in (self.intent, second):
            self.saved_upload(item, status='uploaded_visibility_unconfirmed', observed_at=self.now.isoformat())
        client = self.client()
        client.video.side_effect = [[], self.client().video.return_value]
        with patch('youtube_api.YouTubeClient', return_value=client):
            result = youtube_api.due(self.now, self.ledger)
        self.assertEqual(result['content_id'], second['content_id'])
        self.assertEqual(result['held_items'][0]['error'], 'AttributeError')
        client.upload.assert_not_called()

    def test_malformed_intent_does_not_starve_due_item(self):
        second = self.add_intent()
        data = json.loads(self.ledger.read_text())
        data['events'][0]['channels']['youtube']['api_intent'] = 'malformed'
        self.ledger.write_text(json.dumps(data))
        with patch('youtube_api.YouTubeClient', return_value=self.client()):
            result = youtube_api.due(self.now, self.ledger)
        self.assertEqual(result['content_id'], second['content_id'])
        self.assertEqual(result['protected_attempts'], 1)

    def test_due_selection_consumes_the_original_monotonic_client_budget(self):
        clock = [100.0]
        validate = youtube_api.validate_intent
        def validate_slowly(*args):
            clock[0] += 4
            return validate(*args)
        with patch('youtube_api.time.monotonic', side_effect=lambda: clock[0]), \
                patch('youtube_api.validate_intent', side_effect=validate_slowly), \
                patch('youtube_api.YouTubeClient', return_value=self.client()) as constructor:
            youtube_api.due(self.now, self.ledger, budget=30)
        self.assertEqual(constructor.call_args.args[0], 26)

    def test_raw_101_character_title_is_rejected_without_trimming(self):
        self.intent['title'] = ' ' + 'a' * 99 + ' '
        self.intent['metadata_sha256'] = youtube_api.metadata_hash(self.intent)
        self.approve()
        with self.assertRaisesRegex(MetaError, 'invalid_youtube_metadata'):
            youtube_api.validate_intent(self.intent, self.now)

    def test_public_processing_is_not_verified_until_processed(self):
        client = self.client()
        client.video.return_value['status']['uploadStatus'] = 'uploaded'
        client.video.return_value['processingDetails']['processingStatus'] = 'processing'
        result = youtube_api.advance(self.intent, self.now, client)
        self.assertFalse(result['public_verified'])
        self.assertEqual(result['status'], 'uploaded_visibility_unconfirmed')

    def test_legacy_remote_schedule_is_surfaced_and_never_reinserted(self):
        self.saved_upload(self.intent, status='scheduled_verified',
                          observed_at=self.now.isoformat())
        client = self.client()
        client.video.return_value['status'].update(privacyStatus='private', publishAt=self.intent['scheduled_for'])
        result = youtube_api.advance(self.intent, self.now, client)
        self.assertEqual(result['status'], 'legacy_remote_schedule_requires_reconciliation')
        client.upload.assert_not_called()

    def test_future_plan_is_pinned_to_the_separate_approved_slot(self):
        self.intent['scheduled_for'] = (self.now + timedelta(hours=2)).isoformat()
        self.approve(); self.save_source()
        youtube_api.plan(self.approval, self.now, self.ledger)
        changed = dict(self.intent, scheduled_for=(self.now + timedelta(hours=3)).isoformat())
        self.assertEqual(youtube_api.metadata_hash(changed), self.intent['metadata_sha256'])
        with self.assertRaisesRegex(MetaError, 'exact_youtube_approval'):
            youtube_api.validate_intent(changed, self.now)
        self.assertEqual(youtube_api.metadata(self.intent)['status']['privacyStatus'], 'public')
        self.assertNotIn('publishAt', youtube_api.metadata(self.intent)['status'])

    def test_source_holds_are_seen_before_terminal_and_legacy_receipts_are_skipped(self):
        for status in ('public_verified', 'upload_failed_or_rejected', 'scheduled_verified'):
            self.saved_upload(self.intent, status=status, public_verified=status == 'public_verified',
                              observed_at=self.now.isoformat())
            data = json.loads(self.ledger.read_text())
            data['events'][0]['held'] = True
            self.ledger.write_text(json.dumps(data))
            with patch('youtube_api.YouTubeClient', side_effect=AssertionError('No OAuth')):
                result = youtube_api.due(self.now, self.ledger)
            self.assertEqual(result['protected_attempts'], 1)
            self.assertIn('protected_source', result['held_items'][0]['error'])

    def test_unexpected_remote_schedule_is_surfaced_even_if_privacy_is_public(self):
        self.saved_upload(self.intent, status='uploaded_visibility_unconfirmed')
        client = self.client()
        client.video.return_value['status']['publishAt'] = self.intent['scheduled_for']
        result = youtube_api.advance(self.intent, self.now, client)
        self.assertEqual(result['status'], 'legacy_remote_schedule_requires_reconciliation')
        self.assertFalse(result['public_verified'])
        client.upload.assert_not_called()

    def test_clock_or_hold_during_identity_and_preparation_prevents_post(self):
        original_slot = self.intent['scheduled_for']
        for phase, seconds in (('identity', 301), ('identity', 280), ('preparation', 301),
                               ('preparation', 280), ('hold', 0)):
            with self.subTest(phase=phase, seconds=seconds):
                receipt = youtube_api.receipt_path(self.intent)
                if receipt.exists(): receipt.unlink()
                self.save_source()
                clock = [self.now, 100.0]
                client = youtube_api.YouTubeClient.__new__(youtube_api.YouTubeClient)
                client.deadline = 130.0
                client.session = Mock()
                def expire(*args, **kwargs):
                    clock[0] += timedelta(seconds=seconds)
                    clock[1] += min(seconds, 2)
                    if phase == 'hold':
                        data = json.loads(self.ledger.read_text())
                        data['events'][0]['held'] = True
                        self.ledger.write_text(json.dumps(data))
                    return Mock(hex='test-boundary')
                def request(method, url, **kwargs):
                    if phase == 'identity': expire()
                    response = Mock(status_code=200)
                    response.json.return_value = {'items': [{'id': youtube_api.CHANNEL, 'snippet': {'title': 'gling'}}]}
                    return response
                client.session.request.side_effect = request
                with patch('youtube_api.now_utc', side_effect=lambda: clock[0]), \
                        patch('youtube_api.time.monotonic', side_effect=lambda: clock[1]), \
                        patch('youtube_api.uuid.uuid4', side_effect=expire if phase != 'identity' else None):
                    with self.assertRaisesRegex(MetaError, 'original_upload_slot|protected_source'):
                        youtube_api.advance(self.intent, self.now, client)
                self.assertEqual(client.session.request.call_count, 1)
                self.assertEqual(client.session.request.call_args.args[:2], ('GET', youtube_api.API + 'channels'))
                if phase != 'identity':
                    self.assertTrue(receipt.exists())
                    self.assertEqual(json.loads(receipt.read_text())['status'], 'uncertain')
                self.assertEqual(self.intent['scheduled_for'], original_slot)
                if phase == 'identity': self.assertFalse(receipt.exists())

    def test_plan_preserves_instagram_and_is_idempotent_without_transferring_old_approvals(self):
        data = json.loads(self.ledger.read_text())
        del data['events'][0]['channels']['youtube']
        self.ledger.write_text(json.dumps(data))
        youtube_api.plan(self.approval, self.now, self.ledger)
        first = self.ledger.read_bytes()
        youtube_api.plan(self.approval, self.now, self.ledger)
        self.assertEqual(first, self.ledger.read_bytes())
        data = json.loads(first)
        self.assertEqual(data['events'][0]['channels']['instagram']['public_id'], 'keep-instagram')
        data['events'][0]['channels']['youtube']['held'] = True
        self.ledger.write_text(json.dumps(data))
        with self.assertRaisesRegex(MetaError, 'protected_source'):
            youtube_api.plan(self.approval, self.now, self.ledger)

    def test_no_youtube_approvals_means_no_oauth_or_upload(self):
        self.ledger.write_text(json.dumps({'events': [{'content_id':'legacy-ig',
            'channels': {'instagram': {'status':'published'}}}]}))
        with patch('youtube_api.YouTubeClient', side_effect=AssertionError('No network needed')):
            self.assertEqual(youtube_api.due(self.now, self.ledger)['status'], 'no_approved_youtube_record')

    def test_cancelled_destination_is_not_reactivated_by_an_old_intent(self):
        data = json.loads(self.ledger.read_text())
        data['events'][0]['channels']['youtube']['status'] = 'cancelled'
        self.ledger.write_text(json.dumps(data))
        client = self.client()
        with self.assertRaisesRegex(MetaError, 'protected_source'):
            youtube_api.advance(self.intent, self.now, client)
        client.upload.assert_not_called()

    def test_failed_processing_is_not_claimed_as_a_verified_schedule(self):
        client = self.client()
        client.video.return_value['status']['uploadStatus'] = 'rejected'
        result = youtube_api.advance(self.intent, self.now, client)
        self.assertEqual(result['status'], 'upload_failed_or_rejected')
        self.assertFalse(result['public_verified'])


class YouTubeClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.now = datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc)
        self.token = {'token':'test-access', 'refresh_token':'test-refresh', 'client_id':'test-client',
            'client_secret':'test-secret', 'token_uri':youtube_api.TOKEN_URL, 'scopes':list(youtube_api.SCOPES),
            'expiry':(self.now + timedelta(hours=1)).isoformat()}
        config = {'installed':{'project_id':'gling-5ab6a', 'client_id':'test-client', 'client_secret':'test-secret'}}
        for name, data in [('token.json', self.token), ('client-secret.json', config)]:
            file = self.root / name; file.write_text(json.dumps(data)); file.chmod(0o600)
        self.addCleanup(patch.stopall)
        patch('youtube_api.ROOT', self.root).start()
        patch('youtube_api.now_utc', return_value=self.now).start()
        self.session = Mock(headers={})
        patch('youtube_api.requests.Session', return_value=self.session).start()

    def reply(self, data, code=200):
        response = Mock(status_code=code)
        response.json.return_value = data
        return response

    def test_refresh_keeps_refresh_token_private_and_verifies_exact_live_channel(self):
        self.token['expiry'] = self.now.isoformat()
        (self.root / 'token.json').write_text(json.dumps(self.token))
        self.session.request.side_effect = [self.reply({'access_token':'new-test-token', 'expires_in':3600}),
            self.reply({'items':[{'id':youtube_api.CHANNEL, 'snippet':{'title':'gling'}}]})]
        client = youtube_api.YouTubeClient()
        self.assertEqual(client.identity()['channel_id'], youtube_api.CHANNEL)
        saved = json.loads((self.root / 'token.json').read_text())
        self.assertEqual(saved['refresh_token'], 'test-refresh')
        self.assertEqual(saved['token'], 'new-test-token')
        self.assertEqual((self.root / 'token.json').stat().st_mode & 0o777, 0o600)
        self.assertFalse(self.session.trust_env)
        self.session.request.return_value = self.reply({'items':[{'id':'other-channel'}]})
        self.session.request.side_effect = None
        with self.assertRaisesRegex(MetaError, 'identity_mismatch'):
            client.identity()

    def test_wrong_oauth_project_or_unsafe_token_is_rejected_before_any_request(self):
        self.token['client_id'] = 'other-project'
        (self.root / 'token.json').write_text(json.dumps(self.token))
        with self.assertRaisesRegex(MetaError, 'oauth_project_or_scopes'):
            youtube_api.YouTubeClient()
        self.session.request.assert_not_called()
        (self.root / 'token.json').chmod(0o644)
        with self.assertRaisesRegex(MetaError, 'unsafe_youtube_private_file'):
            youtube_api.YouTubeClient()

    def test_multipart_contains_exact_public_metadata_and_video_bytes(self):
        client = youtube_api.YouTubeClient()
        self.session.request.return_value = self.reply({'id':'abcdefghijk'})
        video = self.root / 'short.mp4'; video.write_bytes(b'exact-master-bytes')
        intent = {'video_file':str(video), 'video_sha256':digest(video.read_bytes()),
            'title':'한글 제목', 'description':'첫 줄\n둘째 줄', 'made_for_kids':False,
            'contains_synthetic_media':False, 'scheduled_for':self.now.isoformat(),
            'content_id':'test-upload', 'source_record':str(self.root / 'ledger.json') + '#test-upload'}
        (self.root / 'ledger.json').write_text(json.dumps({'events':[{'content_id':'test-upload',
            'channels':{'youtube':{'api_intent':intent}}}]}))
        client.upload(intent)
        call = self.session.request.call_args
        self.assertEqual(call.args[:2], ('POST', youtube_api.UPLOAD))
        self.assertEqual(call.kwargs['params']['uploadType'], 'multipart')
        parts = call.kwargs['data'].split(b'\r\n\r\n', 1)[1]
        body = json.loads(parts.split(b'\r\n--', 1)[0])
        self.assertEqual(body, {'snippet': {'title': '한글 제목', 'description': '첫 줄\n둘째 줄',
            'categoryId': '22', 'defaultLanguage': 'ko'}, 'status': {'privacyStatus': 'public',
            'selfDeclaredMadeForKids': False, 'containsSyntheticMedia': False}})
        self.assertNotIn(b'publishAt', call.kwargs['data'])
        self.assertIn(video.read_bytes(), call.kwargs['data'])
        self.assertFalse(call.kwargs['allow_redirects'])

    def test_probe_rejects_horizontal_or_overlong_video(self):
        for width, height, seconds in [(1920,1080,30),(1080,1920,181)]:
            output = json.dumps({'streams':[{'width':width,'height':height,'r_frame_rate':'30/1'}],
                                 'format':{'duration':str(seconds)}})
            with patch('youtube_api.subprocess.run', return_value=subprocess.CompletedProcess([],0,output,'')):
                with self.assertRaisesRegex(MetaError, 'short_requires'):
                    youtube_api.probe_short('local.mp4')


if __name__ == '__main__':
    unittest.main()
