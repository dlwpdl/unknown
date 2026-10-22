"""Private staging cannot become a general storage or customer-data API."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from meta_api import MetaError, digest
from meta_media import MediaStore


class MediaChecks(unittest.TestCase):
    def test_other_buckets_and_traversal_are_rejected_before_using_credentials(self):
        store = MediaStore.__new__(MediaStore)
        for path in ['/object/post-images/customer.jpg', '/object/../sns-media/secret', '/bucket/sns-media-other']:
            with self.subTest(path=path), self.assertRaises(MetaError):
                store.request(path)

    def test_cleanup_cannot_delete_customer_files_or_another_bucket(self):
        store = MediaStore.__new__(MediaStore)
        for body in [{'prefixes': ['../post-images/private']}, {'prefixes': ['instagram/other/file.mp4']}, {'prefixes': []}]:
            with self.assertRaises(MetaError):
                store.request('/object/sns-media', body, 'DELETE')

    def test_server_helper_cannot_make_bucket_public_or_issue_unbounded_links(self):
        store = MediaStore.__new__(MediaStore)
        with self.assertRaises(MetaError):
            store.request('/bucket/sns-media', {'public': True}, 'PUT')
        with self.assertRaises(MetaError):
            store.request('/object/sign/sns-media/instagram/gling.app/' + 'a' * 64 + '.mp4', {'expiresIn': 999999}, 'POST')

    def test_changed_video_never_uploads(self):
        store = MediaStore.__new__(MediaStore)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'video.mp4'
            file.write_bytes(b'changed')
            with patch.object(store, 'request') as send:
                with self.assertRaises(MetaError):
                    store.asset(file, '0' * 64, 'video/mp4')
                send.assert_not_called()

    def test_signed_url_must_reference_the_exact_private_object(self):
        store = MediaStore.__new__(MediaStore)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'video.mp4'
            file.write_bytes(b'approved')
            with patch.object(store, 'request', side_effect=[b'approved', {'signedURL': '/object/sign/avatars/secret?token=x'}]):
                with self.assertRaises(MetaError):
                    store.asset(file, digest(b'approved'), 'video/mp4')


if __name__ == '__main__':
    unittest.main()
