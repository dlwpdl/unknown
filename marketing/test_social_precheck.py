import json
import subprocess
import unittest
from datetime import datetime
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo

import social_precheck


class SocialPrecheckTests(unittest.TestCase):
    def test_city_queue_is_not_recreated_and_never_calls_social_api(self):
        at = datetime(2026, 10, 14, 2, 0, tzinfo=ZoneInfo('America/Vancouver'))
        with TemporaryDirectory() as directory, patch('social_precheck.Path.home', return_value=Path(directory)), \
                patch('social_precheck.subprocess.run', side_effect=AssertionError('city is independent')):
            self.assertTrue(social_precheck.check('city', at)['ai_preparation_continue'])
            queue = Path(directory) / 'Library/Application Support/gling/city-posts/payload/2026-10-14.json'
            queue.parent.mkdir(parents=True); queue.write_text('{}')
            self.assertFalse(social_precheck.check('city', at)['ai_preparation_continue'])
            queue.unlink()
            self.assertFalse(social_precheck.check('city', at.replace(hour=9))['ai_preparation_continue'])

    def test_only_preparation_checkpoints_start_ai_and_an_api_failure_does_not_stop_drafting(self):
        for role, minute in [('instagram', 20), ('brand', 5), ('personal', 10)]:
            at = datetime(2026, 10, 14, 3, minute, tzinfo=ZoneInfo('America/Vancouver'))
            with self.subTest(role=role), patch('social_precheck.subprocess.run', return_value=
                    subprocess.CompletedProcess([], 2, json.dumps({'status':'blocked'}), '')) as call:
                self.assertTrue(social_precheck.check(role, at)['ai_preparation_continue'])
                self.assertFalse(social_precheck.check(role, at.replace(minute=minute+1))['ai_preparation_continue'])
                self.assertEqual(call.call_args_list[0].kwargs['timeout'], 45)

    def test_personal_research_continues_during_day_without_starting_other_channel_writers(self):
        at = datetime(2026, 10, 14, 14, 10, tzinfo=ZoneInfo('America/Vancouver'))
        with patch('social_precheck.subprocess.run', return_value=subprocess.CompletedProcess([], 0, '{}', '')):
            self.assertTrue(social_precheck.check('personal', at)['ai_preparation_continue'])
            self.assertFalse(social_precheck.check('brand', at)['ai_preparation_continue'])
            self.assertFalse(social_precheck.check('instagram', at)['ai_preparation_continue'])

    def test_timeout_never_authorizes_ai_publish_or_retry(self):
        at = datetime(2026, 10, 14, 3, 20, tzinfo=ZoneInfo('America/Vancouver'))
        with patch('social_precheck.subprocess.run', side_effect=subprocess.TimeoutExpired('api', 45)):
            result = social_precheck.check('instagram', at)
        self.assertEqual(result['status'], 'bounded_api_step_blocked')
        self.assertFalse(result['ai_publish_or_retry_allowed'])
        self.assertTrue(result['ai_preparation_continue'])

    def test_instagram_precheck_also_runs_youtube_without_a_second_scheduled_job(self):
        at = datetime(2026, 10, 17, 12, 5, tzinfo=ZoneInfo('America/Vancouver'))
        responses = [subprocess.CompletedProcess([], 0, '{"status":"public_readback_saved"}', ''),
                     subprocess.CompletedProcess([], 0, '{"status":"scheduled_verified"}', '')]
        with patch('social_precheck.subprocess.run', side_effect=responses) as call:
            result = social_precheck.check('instagram', at)
        self.assertEqual(result['status'], 'public_readback_saved')
        self.assertEqual(result['youtube']['status'], 'scheduled_verified')
        self.assertIn('youtube_api.py', call.call_args_list[1].args[0][1])
        self.assertIn('due', call.call_args_list[1].args[0])
        self.assertFalse(result['ai_publish_or_retry_allowed'])

    def test_youtube_failure_does_not_erase_instagram_success(self):
        at = datetime(2026, 10, 17, 12, 5, tzinfo=ZoneInfo('America/Vancouver'))
        with patch('social_precheck.subprocess.run', side_effect=[
                subprocess.CompletedProcess([], 0, '{"status":"public_readback_saved"}', ''),
                subprocess.TimeoutExpired('youtube', 30)]):
            result = social_precheck.check('instagram', at)
        self.assertEqual(result['status'], 'public_readback_saved')
        self.assertEqual(result['youtube']['status'], 'bounded_youtube_step_blocked')

    def test_instagram_uses_its_original_budget_and_youtube_waits_if_less_than_eight_seconds_remain(self):
        at = datetime(2026, 10, 17, 12, 5, tzinfo=ZoneInfo('America/Vancouver'))
        with patch('social_precheck.time.monotonic', side_effect=[100, 145]), \
                patch('social_precheck.subprocess.run', return_value=
                    subprocess.CompletedProcess([], 0, '{"status":"public_readback_saved"}', '')) as call:
            result = social_precheck.check('instagram', at)
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args.kwargs['timeout'], 45)
        self.assertEqual(result['youtube']['status'], 'youtube_waits_for_next_original_tick')

    def test_other_roles_do_not_run_youtube(self):
        at = datetime(2026, 10, 17, 12, 5, tzinfo=ZoneInfo('America/Vancouver'))
        with patch('social_precheck.subprocess.run', return_value=
                subprocess.CompletedProcess([], 0, '{"status":"outside_slot"}', '')) as call:
            social_precheck.check('brand', at)
        self.assertEqual(call.call_count, 1)


if __name__ == '__main__':
    unittest.main()
