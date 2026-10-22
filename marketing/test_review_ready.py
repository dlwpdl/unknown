import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from review_ready import review_candidates


class ReviewReadyTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ledger = self.root / 'festival-content-ledger.json'
        self.now = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)
        self.request = {
            'state': 'ready_for_review', 'account': 'gling.app',
            'content_id': 'GL-TEST', 'producer_run_id': 'producer-1',
            'scheduled_for': '2026-10-13T19:00:00Z', 'gling_post_id': 'saved-post',
            'review_receipt': str(self.root / 'reports' / 'revision-1.json'),
        }
        for field, hash_field in [('video_file', 'video_sha256'),
                                  ('source_manifest', 'source_manifest_sha256'),
                                  ('caption_file', 'copy_sha256'),
                                  ('cover_file', 'cover_sha256')]:
            path = self.root / field
            path.write_bytes(field.encode())
            self.request[field] = str(path)
            self.request[hash_field] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.row = {'content_id': 'GL-TEST', 'channels': {'instagram': {
            'status': 'local-text-prepared', 'planned_slot': self.request['scheduled_for'],
            'review_request': self.request}}}

    def check(self):
        self.ledger.write_text(json.dumps({'events': [self.row]}))
        before = self.ledger.read_bytes()
        result = review_candidates(self.ledger, self.now)
        self.assertEqual(before, self.ledger.read_bytes())
        return result

    def test_complete_future_revision_starts_review_without_editing_ledger(self):
        result = self.check()
        self.assertEqual(result['status'], 'review_ready')
        self.assertEqual([r['content_id'] for r in result['ready']], ['GL-TEST'])

    def test_morning_draft_can_be_reviewed_before_owner_approval_or_publication(self):
        self.request.update(mode='morning_draft')
        self.request.pop('scheduled_for'); self.request.pop('gling_post_id')
        self.row['channels']['instagram'].pop('planned_slot')
        draft = self.root / 'app-draft.json'; draft.write_text('{"body":"검토할 글"}')
        self.request.update(app_draft_file=str(draft), app_draft_sha256=hashlib.sha256(draft.read_bytes()).hexdigest())
        self.assertEqual(self.check()['status'], 'review_ready')
        self.row['channels']['instagram']['planned_slot'] = '2026-10-13T19:00:00Z'
        self.assertEqual(self.check()['ready'], [])
        self.row['channels']['instagram'].pop('planned_slot')
        draft.write_text('changed')
        self.assertEqual(self.check()['ready'], [])

    def test_draft_or_missing_handoff_does_not_start_reviewer(self):
        for state in [None, 'producing']:
            with self.subTest(state=state):
                self.request['state'] = state
                self.assertEqual(self.check()['ready'], [])

    def test_modified_video_cannot_reuse_frozen_handoff(self):
        Path(self.request['video_file']).write_bytes(b'producer edited this')
        result = self.check()
        self.assertEqual(result['ready'], [])
        self.assertIn('hash_mismatch', result['skipped'][0]['reason'])

    def test_same_review_is_not_started_again(self):
        ready = self.check()['ready'][0]
        receipt = Path(self.request['review_receipt'])
        receipt.parent.mkdir()
        for decision in ['accepted', 'changes_required', 'blocked']:
            with self.subTest(decision=decision):
                receipt.write_text(json.dumps({'request_sha256': ready['request_sha256'],
                                               'decision': decision}))
                self.assertEqual(self.check()['skipped'][0]['reason'], 'already_reviewed')

    def test_expired_slot_wrong_account_or_terminal_record_is_not_requeued(self):
        variants = [('scheduled_for', '2026-10-13T11:00:00Z'),
                    ('account', 'chalkakandupload'), ('content_id', 'OTHER')]
        for key, value in variants:
            with self.subTest(key=key):
                previous = self.request[key]
                self.request[key] = value
                self.assertEqual(self.check()['ready'], [])
                self.request[key] = previous
        self.row['channels']['instagram']['status'] = 'published'
        self.assertEqual(self.check()['ready'], [])

    def test_changed_revision_needs_a_new_receipt_and_review(self):
        old = self.check()['ready'][0]
        receipt = Path(self.request['review_receipt'])
        receipt.parent.mkdir()
        receipt.write_text(json.dumps({'request_sha256': old['request_sha256'],
                                       'decision': 'accepted'}))
        video = Path(self.request['video_file'])
        video.write_bytes(b'new completed revision')
        self.request['video_sha256'] = hashlib.sha256(video.read_bytes()).hexdigest()
        self.assertEqual(self.check()['skipped'][0]['reason'], 'receipt_path_in_use')
        self.request['review_receipt'] = str(receipt.with_name('revision-2.json'))
        result = self.check()['ready'][0]
        self.assertNotEqual(old['request_sha256'], result['request_sha256'])

    def test_handoff_cannot_silently_move_the_original_publication_slot(self):
        self.request['scheduled_for'] = '2026-10-14T19:00:00Z'
        self.assertEqual(self.check()['ready'], [])

    def test_invalid_artifact_or_receipt_destination_is_held(self):
        Path(self.request['source_manifest']).unlink()
        self.assertEqual(self.check()['ready'], [])
        self.request['review_receipt'] = str(self.root / 'outside-reports.json')
        self.assertEqual(self.check()['ready'], [])


if __name__ == '__main__':
    unittest.main()
