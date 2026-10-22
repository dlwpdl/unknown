import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import UUID

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('merchant_tools', Path(__file__).with_name('admin_merchant_mcp.py'))
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


class MerchantProfileToolsTests(unittest.IsolatedAsyncioTestCase):
    values = dict(id=UUID('12620000-0000-0000-0000-000000000001'), name='카페', city_id='vancouver',
                  contact='', status='lead', consent='pending', consent_note='')

    def test_legacy_tool_call_keeps_details_unset(self):
        with patch.object(tools, 'rpc', return_value=str(self.values['id'])) as rpc:
            tools.save_merchant(**self.values)
            self.assertEqual(rpc.call_args.args[0], 'save_admin_merchant')
            for key in ('industry', 'services', 'address'):
                self.assertIsNone(rpc.call_args.args[1]['p_' + key])

    def test_new_details_and_explicit_clear_reach_same_rpc(self):
        with patch.object(tools, 'rpc', return_value=str(self.values['id'])) as rpc:
            tools.save_merchant(**self.values, industry='카페', services='커피', address='')
            self.assertEqual(rpc.call_args.args[1]['p_industry'], '카페')
            self.assertEqual(rpc.call_args.args[1]['p_services'], '커피')
            self.assertEqual(rpc.call_args.args[1]['p_address'], '')

    async def test_registered_tool_rejects_oversized_details_before_rpc(self):
        for field, limit in [('industry', 80), ('services', 1500), ('address', 300)]:
            values = {**self.values, 'id': str(self.values['id']), field: '가' * (limit + 1)}
            with patch.object(tools, 'rpc') as rpc, self.assertRaisesRegex(Exception, str(limit)):
                await tools.mcp.call_tool('save_merchant', values)
            rpc.assert_not_called()

    def test_account_search_returns_only_reviewable_identity_fields(self):
        with patch.object(tools, 'rpc', return_value={'rows': [{'id': 'user-a', 'nickname': '지윤', 'email': 'test@example.invalid', 'account_status': 'active', 'private_details': 'hidden'}], 'total': 1}) as rpc:
            result = tools.find_business_account('지윤')
            self.assertEqual(rpc.call_args.args[0], 'search_admin_users')
            self.assertNotIn('private_details', result['rows'][0])
            self.assertEqual(result['rows'][0]['email'], 'test@example.invalid')

    def test_direct_connection_preserves_reviewed_account_business_and_revision(self):
        user_id = UUID('12620000-0000-0000-0000-000000000002')
        with patch.object(tools, 'rpc', return_value='business-a') as rpc:
            tools.connect_business_account(merchant_id=self.values['id'], user_id=user_id, role='owner', method='direct', verified=True,
                                           note='사업장 소유 직접 확인', expected_updated_at='2026-10-09T00:00:00Z', expected_nickname='지윤', expected_email='test@example.invalid')
            name, args = rpc.call_args.args
            self.assertEqual(name, 'connect_admin_merchant_account')
            self.assertEqual(args['p_merchant_id'], str(self.values['id']))
            self.assertEqual(args['p_user_id'], str(user_id))
            self.assertEqual(args['p_method'], 'direct')
            self.assertTrue(args['p_verified'])
            self.assertEqual(args['p_expected_updated_at'], '2026-10-09T00:00:00Z')
            self.assertEqual(args['p_expected_nickname'], '지윤')
            self.assertEqual(args['p_expected_email'], 'test@example.invalid')

    async def test_registered_connection_rejects_unreviewed_note_and_unknown_method(self):
        values = dict(merchant_id=str(self.values['id']), user_id=str(self.values['id']), role='owner', method='direct', verified=True,
                      note='사업장 소유 직접 확인', expected_updated_at='2026-10-09T00:00:00Z', expected_nickname='지윤')
        for invalid in ({'note': '확인'}, {'method': 'guess'}):
            with patch.object(tools, 'rpc') as rpc, self.assertRaises(Exception):
                await tools.mcp.call_tool('connect_business_account', {**values, **invalid})
            rpc.assert_not_called()


if __name__ == '__main__':
    unittest.main()
