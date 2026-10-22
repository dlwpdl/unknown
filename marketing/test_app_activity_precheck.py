import importlib.util
import json
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zoneinfo import ZoneInfo


path = Path(__file__).with_name('app_activity_precheck.py')
monitor = None
if path.exists():
    spec = importlib.util.spec_from_file_location('app_activity_precheck', path)
    monitor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(monitor)

BATCH = '6c32259e-8f58-43b1-941e-a0476b590a08'
TARGET = '7c32259e-8f58-43b1-941e-a0476b590a08'


def result(events=None, busy=False):
    return [{'result': {'batch_id': BATCH, 'events': events or [],
                        'busy': busy, 'pending_count': len(events or [])}}]


def event():
    return {'id': 1, 'kind': 'comment', 'target_id': TARGET, 'actor_id': None,
            'context_id': None, 'action': 'insert', 'occurred_at': '2026-10-14T23:00:00Z',
            'operated_actor': False, 'attention': True}


class ActivityMonitorTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(monitor, 'The authorized event bridge is not implemented')
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'private'
        self.now = datetime(2026, 10, 14, 16, 7, tzinfo=ZoneInfo('America/Vancouver'))
        self.queries = []

    def check(self, payload=None, now=None, response_gate=None):
        def query(sql):
            self.queries.append(sql)
            return payload if payload is not None else result()
        return monitor.check(now=now or self.now, root=self.root, query=query,
                             response_gate=response_gate or (lambda events, root: {'ready': False}))

    def test_response_auth_recovery_wakes_without_a_new_source_event(self):
        out = self.check(response_gate=lambda events, root: {'ready': True, 'pending_count': 2})
        self.assertTrue(out['ai_continue'])
        self.assertEqual(out['persona_responses']['pending_count'], 2)

    def test_source_batch_is_staged_before_monitoring_ack(self):
        seen = []
        self.check(result([event()]), response_gate=lambda events, root:
                   seen.extend(events) or {'ready': False})
        self.assertEqual(seen, [event()])
        self.assertEqual(len(self.queries), 1)

    def test_response_gate_error_keeps_existing_monitor_ticket(self):
        def fail(events, root): raise OSError('PRIVATE SECRET')
        out = self.check(result([event()]), response_gate=fail)
        self.assertTrue(out['ai_continue'])
        self.assertTrue((self.root / 'batches' / (BATCH + '.json')).exists())
        self.assertNotIn('SECRET', json.dumps(out))

    def prepare(self):
        self.check(result([event()]))
        report = self.root / 'assessment.json'
        report.write_text(json.dumps({'batch_id': BATCH, 'handled_event_ids': [1],
                                      'outcome': 'reviewed'}))
        return report

    def test_idle_does_not_start_ai(self):
        self.assertFalse(self.check()['ai_continue'])
        self.assertFalse((self.root / 'pending.json').exists())

    def test_original_half_hour_supervision_still_runs(self):
        for minute in [0, 30]:
            self.assertTrue(self.check(now=self.now.replace(minute=minute))['ai_continue'])

    def test_event_creates_durable_private_ticket_without_ack(self):
        out = self.check(result([event()]))
        self.assertTrue(out['ai_continue'])
        ticket = self.root / 'batches' / (BATCH + '.json')
        self.assertEqual(json.loads(ticket.read_text())['events'], [event()])
        self.assertEqual(ticket.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o700)
        self.assertEqual(len(self.queries), 1)
        self.assertNotIn('ack_gling_activity', self.queries[0])

    def test_busy_check_never_overwrites_pending_ticket(self):
        self.prepare()
        before = (self.root / 'pending.json').read_bytes()
        self.assertFalse(self.check(result(busy=True))['ai_continue'])
        self.assertEqual((self.root / 'pending.json').read_bytes(), before)

    def test_network_failure_preserves_pending_and_redacts_error(self):
        self.prepare()
        before = (self.root / 'pending.json').read_bytes()
        def fail(sql):
            raise RuntimeError('Bearer secret and private body must never be printed')
        out = monitor.check(now=self.now, root=self.root, query=fail)
        self.assertFalse(out['ai_continue'])
        self.assertEqual(out['status'], 'monitor_check_failed')
        self.assertNotIn('secret', json.dumps(out))
        self.assertEqual((self.root / 'pending.json').read_bytes(), before)
        self.assertTrue(monitor.check(now=self.now.replace(minute=30), root=self.root, query=fail)['ai_continue'])

    def test_no_message_content_is_accepted_in_monitor_ticket(self):
        row = event(); row['body'] = 'PRIVATE MESSAGE'
        out = self.check(result([row]))
        self.assertEqual(out['status'], 'monitor_check_failed')
        self.assertNotIn('PRIVATE MESSAGE', (self.root / 'latest-check.json').read_text())
        self.assertFalse((self.root / 'pending.json').exists())

    def test_ack_requires_saved_report_and_exact_event_coverage(self):
        report = self.prepare()
        report.write_text(json.dumps({'batch_id': BATCH, 'handled_event_ids': [], 'outcome': 'reviewed'}))
        with self.assertRaises(ValueError):
            monitor.ack(BATCH, report, root=self.root, query=lambda sql: self.fail('Premature DB ACK'))
        with self.assertRaises(ValueError):
            monitor.ack(BATCH, report.with_name('missing.json'), root=self.root, query=lambda sql: self.fail('Missing report ACK'))

    def test_ack_validates_batch_before_any_sql(self):
        report = self.prepare()
        with self.assertRaises(ValueError):
            monitor.ack("');delete from public.posts;--", report, root=self.root, query=lambda sql: self.fail('Unsafe SQL'))

    def test_successful_ack_keeps_a_durable_assessment_receipt(self):
        report = self.prepare()
        queries = []
        def acknowledge(sql):
            queries.append(sql)
            return [{'acknowledged': 1}]
        out = monitor.ack(BATCH, report, root=self.root, query=acknowledge)
        self.assertEqual(out['acknowledged'], 1)
        receipt = json.loads((self.root / 'batches' / (BATCH + '.ack.json')).read_text())
        self.assertEqual(receipt['report_path'], str(report.resolve()))
        self.assertEqual(receipt['event_ids'], [1])
        self.assertEqual(len(queries), 1)

    def test_stale_ack_reports_zero_without_claiming_delivery(self):
        report = self.prepare()
        out = monitor.ack(BATCH, report, root=self.root, query=lambda sql: [{'acknowledged': 0}])
        self.assertEqual(out['acknowledged'], 0)

    def test_failed_ack_keeps_report_receipt_for_safe_retry(self):
        report = self.prepare()
        def fail(sql):
            raise OSError('network unavailable')
        with self.assertRaises(OSError):
            monitor.ack(BATCH, report, root=self.root, query=fail)
        self.assertTrue((self.root / 'batches' / (BATCH + '.assessment.json')).exists())
        self.assertFalse((self.root / 'batches' / (BATCH + '.ack.json')).exists())
        self.assertEqual(monitor.ack(BATCH, report, root=self.root,
                                    query=lambda sql: [{'acknowledged': 1}])['acknowledged'], 1)

    def test_another_batch_report_cannot_ack_this_batch(self):
        report = self.prepare()
        report.write_text(json.dumps({'batch_id': TARGET, 'handled_event_ids': [1], 'outcome': 'reviewed'}))
        with self.assertRaises(ValueError):
            monitor.ack(BATCH, report, root=self.root, query=lambda sql: self.fail('Cross-batch ACK'))


if __name__ == '__main__':
    unittest.main()
