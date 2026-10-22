import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


path = Path(__file__).with_name('persona_response.py')
persona = None
if path.exists():
    spec = importlib.util.spec_from_file_location('persona_response', path)
    persona = importlib.util.module_from_spec(spec); spec.loader.exec_module(persona)

TARGET = '7c32259e-8f58-43b1-941e-a0476b590a08'
AUTHOR = '8c32259e-8f58-43b1-941e-a0476b590a08'
KEY = '9c32259e-8f58-43b1-941e-a0476b590a08'
CASE = 'comment:' + TARGET


class PersonaResponseTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(persona, 'Persona response runtime is missing')
        self.temp = TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        persona.stage([{'kind': 'comment', 'target_id': TARGET}], root=self.root)

    def plan(self):
        persona.context(CASE, root=self.root, rpc=lambda name, args: {
            'eligible': True, 'status': 'ready', 'persona_id': AUTHOR,
            'revision': 'fresh-revision', 'source': {'body': 'PRIVATE_SOURCE'}})
        return {'case_id': CASE, 'persona_id': AUTHOR, 'revision': 'fresh-revision',
                'action': 'comment_reply', 'body': '페르소나의 답변', 'idempotency_key': KEY,
                'checks': {'persona': True, 'meaning': True, 'patina': True}}

    def test_stage_dedupes_and_ignores_unmanaged_kinds(self):
        persona.stage([{'kind': 'comment', 'target_id': TARGET},
                       {'kind': 'post', 'target_id': TARGET}], root=self.root)
        self.assertEqual(len(persona.cases(root=self.root)), 1)
        self.assertEqual((self.root / 'cases' / ('comment-' + TARGET + '.json')).stat().st_mode & 0o777, 0o600)

    def test_context_uses_only_protected_rpc_and_hides_body_from_status(self):
        calls = []
        result = persona.context(CASE, root=self.root, rpc=lambda name, args:
            calls.append((name, args)) or {'eligible': True, 'status': 'ready', 'persona_id': AUTHOR,
                                         'revision': 'r1', 'source': {'body': 'PRIVATE_SOURCE'}})
        self.assertEqual(calls, [('get_admin_persona_case', {'p_kind': 'comment', 'p_target_id': TARGET})])
        self.assertNotIn('PRIVATE_SOURCE', json.dumps(result))
        self.assertNotIn('PRIVATE_SOURCE', json.dumps(persona.cases(root=self.root)))
        self.assertIn('PRIVATE_SOURCE', Path(result['context_path']).read_text())

    def test_auth_failure_keeps_case_pending_without_secret_output(self):
        def denied(name, args): raise ValueError('AI_CONNECTION_REQUIRED')
        result = persona.context(CASE, root=self.root, rpc=denied)
        self.assertEqual(result['state'], 'auth_required')
        self.assertEqual(persona.cases(root=self.root)[0]['state'], 'auth_required')
        self.assertFalse(persona.wakeup(root=self.root, connected=lambda: False, now=100)['ready'])
        self.assertTrue(persona.wakeup(root=self.root, connected=lambda: True, now=100)['ready'])
        self.assertFalse(persona.wakeup(root=self.root, connected=lambda: True, now=101)['ready'])

    def test_untrusted_case_id_never_reaches_rpc_or_filesystem(self):
        for value in ['../../outside', 'post:' + TARGET, 'comment:not-a-uuid']:
            with self.assertRaises(ValueError):
                persona.context(value, root=self.root, rpc=lambda *args: self.fail('invalid ID reached server'))

    def test_execute_persists_attempt_before_write_and_never_repeats_success(self):
        plan = self.plan(); calls = []
        def write(name, args):
            self.assertTrue(list((self.root / 'attempts').glob('*.json')))
            calls.append((name, args)); return {'status': 'performed', 'result_id': TARGET}
        result = persona.execute(plan, root=self.root, rpc=write)
        self.assertEqual(result['state'], 'completed')
        persona.execute(plan, root=self.root, rpc=lambda *args: self.fail('duplicate write'))
        self.assertEqual(calls[0][0], 'act_admin_persona_case')
        self.assertEqual(calls[0][1]['p_persona_id'], AUTHOR)
        self.assertNotIn('페르소나의 답변', json.dumps(result))

    def test_uncertain_write_retries_exact_original_payload_only(self):
        plan = self.plan()
        def fail(*args): raise OSError('Bearer SECRET with private text')
        result = persona.execute(plan, root=self.root, rpc=fail)
        self.assertEqual(result['state'], 'uncertain')
        self.assertNotIn('SECRET', json.dumps(result))
        changed = dict(plan, body='다른 답변', idempotency_key=TARGET)
        with self.assertRaises(ValueError): persona.execute(changed, root=self.root, rpc=lambda *args: self.fail('changed retry'))
        out = persona.execute(plan, root=self.root, rpc=lambda name, args: {'status': 'performed', 'result_id': TARGET})
        self.assertEqual(out['state'], 'completed')

    def test_uncertain_attempt_cannot_be_hidden_by_context_refresh(self):
        plan = self.plan()
        def fail(*args): raise OSError('lost response')
        persona.execute(plan, root=self.root, rpc=fail)
        out = persona.context(CASE, root=self.root, rpc=lambda *args: self.fail('replay original attempt first'))
        self.assertEqual(out['state'], 'uncertain')
        self.assertTrue(persona.wakeup(root=self.root, connected=lambda: True, now=100)['ready'])

    def test_definite_stale_rejection_allows_fresh_review_and_preserves_attempt(self):
        plan = self.plan()
        def stale(*args): raise ValueError('STALE_SOURCE')
        self.assertEqual(persona.execute(plan, root=self.root, rpc=stale)['state'], 'refresh_required')
        persona.context(CASE, root=self.root, rpc=lambda *args: {
            'eligible': True, 'status': 'ready', 'persona_id': AUTHOR, 'revision': 'r2'})
        fresh = dict(plan, revision='r2', idempotency_key=TARGET)
        self.assertEqual(persona.execute(fresh, root=self.root, rpc=lambda *args: {'status': 'performed'})['state'], 'completed')
        old = list((self.root / 'rejections').glob('*.json'))
        self.assertEqual(len(old), 1)
        self.assertEqual(json.loads(old[0].read_text())['plan'], plan)

    def test_definite_api_rejection_stops_retries_without_claiming_a_reply(self):
        plan = self.plan()
        def rejected(*args): raise ValueError('GLING_API_400')
        out = persona.execute(plan, root=self.root, rpc=rejected)
        self.assertEqual(out['state'], 'review_required')
        self.assertFalse(persona.wakeup(root=self.root, connected=lambda: self.fail('no automatic retry'), now=100)['ready'])
        self.assertFalse((self.root / 'receipts').exists())

    def test_missing_persona_or_editorial_check_is_rejected_before_write(self):
        plan = self.plan()
        for bad in [dict(plan, persona_id=TARGET), dict(plan, revision='stale'),
                    dict(plan, checks={}), dict(plan, action='approve_meetup'), dict(plan, body='')]:
            with self.assertRaises(ValueError): persona.execute(bad, root=self.root, rpc=lambda *args: self.fail('invalid plan'))

    def test_staging_never_reopens_completed_case(self):
        persona.execute(self.plan(), root=self.root, rpc=lambda *args: {'status': 'performed', 'result_id': TARGET})
        persona.stage([{'kind': 'comment', 'target_id': TARGET}], root=self.root)
        self.assertEqual(persona.cases(root=self.root)[0]['state'], 'completed')
        self.assertFalse(persona.wakeup(root=self.root, connected=lambda: self.fail('no auth check needed'), now=100)['ready'])

    def test_meetup_hold_has_no_public_body_or_approval_and_retains_owner_review(self):
        case_id = 'meetup_request:' + TARGET
        persona.stage([{'kind': 'meetup_request', 'target_id': TARGET}], root=self.root)
        persona.context(case_id, root=self.root, rpc=lambda *args: {
            'eligible': True, 'status': 'host_verification_required', 'persona_id': AUTHOR, 'revision': 'r1'})
        plan = dict(self.plan(), case_id=case_id, revision='r1', action='hold_meetup', body='')
        self.assertEqual(persona.execute(plan, root=self.root, rpc=lambda name, args:
                         {'status': 'held', 'result_id': TARGET})['state'], 'owner_review')

    def test_reconcile_uses_audited_inbox_and_keeps_existing_cases(self):
        calls = []
        out = persona.reconcile(root=self.root, rpc=lambda name, args:
            calls.append((name, args)) or [{'kind': 'meetup_request', 'target_id': AUTHOR}])
        self.assertEqual(calls[0][0], 'get_admin_persona_pending')
        self.assertEqual(len(persona.cases(root=self.root)), 2)
        self.assertEqual(out['state'], 'reconciled')


if __name__ == '__main__': unittest.main()
