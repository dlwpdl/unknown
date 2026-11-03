import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('admin_merchant_gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)

class GatewayTests(unittest.TestCase):
    def test_bridge_requires_same_origin_and_bounded_json(self):
        self.assertTrue(gateway.same_origin('http://127.0.0.1:54321', '127.0.0.1:54321'))
        self.assertTrue(gateway.same_origin('https://admin-dashboard.example.ts.net', 'admin-dashboard.example.ts.net'))
        for origin in ['https://evil.example', 'null', '', 'http://127.0.0.1:54321.evil.example', 'http://user@127.0.0.1:54321']:
            self.assertFalse(gateway.same_origin(origin, '127.0.0.1:54321'))

    def test_expired_delegation_cannot_refresh_or_call_api(self):
        with patch.object(gateway, 'keychain_read', return_value={'expires_at': 10}), patch.object(gateway.time, 'time', return_value=11), patch.object(gateway, 'request') as request:
            with self.assertRaisesRegex(ValueError, 'AI_CONNECTION_REQUIRED'): gateway.active_session()
            request.assert_not_called()

    def test_connection_verifies_server_mfa_before_storing(self):
        with patch.object(gateway, 'request', side_effect=ValueError('ADMIN_REQUIRED')), patch.object(gateway, 'keychain_write') as store:
            with self.assertRaisesRegex(ValueError, 'ADMIN_REQUIRED'): gateway.connect({'access_token': 'test'})
            store.assert_not_called()

    def test_only_merchant_rpcs_can_be_called(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_MERCHANT_OPERATION'): gateway.rpc('delete_account', {})

    def test_automations_only_register_link_and_read(self):
        with patch.dict(gateway.os.environ, {}, clear=True):
            for name in ['set_admin_merchant_workspace_owner', 'create_admin_merchant_post', 'get_admin_creator_directory']:
                with self.assertRaisesRegex(ValueError, 'OWNER_SESSION_REQUIRED'): gateway.rpc(name, {'p_merchant_id': 'm'})
            for status in ['paid', 'paused', None]:
                with self.assertRaisesRegex(ValueError, 'OWNER_SESSION_REQUIRED'): gateway.rpc('save_admin_merchant', {'p_id': None, 'p_status': status})
            with patch.object(gateway, 'direct_sql', return_value=[{'status': 'paid', 'trial_ends_at': None, 'consent': 'granted', 'owner_id': None}]):
                with self.assertRaisesRegex(ValueError, 'OWNER_SESSION_REQUIRED'): gateway.rpc('save_admin_merchant_record', {'p_id': 'm', 'p_status': 'trial'})
            with self.assertRaisesRegex(ValueError, 'OWNER_SESSION_REQUIRED'):
                gateway.rpc('save_admin_merchant', {'p_id': None, 'p_status': 'trial', 'p_trial_ends_at': '2099-12-31'})
            with patch.object(gateway, 'direct_sql', return_value=[{'status': 'trial', 'trial_ends_at': '2026-12-01', 'consent': 'granted', 'owner_id': None}]):
                with self.assertRaisesRegex(ValueError, 'OWNER_SESSION_REQUIRED'): gateway.rpc('save_admin_merchant', {'p_id': 'm', 'p_status': 'trial'})
            for row in [{'status': 'trial', 'trial_ends_at': None, 'consent': 'granted', 'owner_id': 'owner'},
                        {'status': 'lead', 'trial_ends_at': None, 'consent': 'revoked', 'owner_id': None}]:
                with patch.object(gateway, 'direct_sql', return_value=[row]):
                    with self.assertRaisesRegex(ValueError, 'OWNER_SESSION_REQUIRED'):
                        gateway.check_automation_scope('save_admin_merchant', {'p_id': 'm', 'p_status': 'lead', 'p_consent': 'granted'})
            with patch.object(gateway, 'direct_sql', return_value=[{'status': 'lead', 'trial_ends_at': None, 'consent': 'revoked', 'owner_id': None}]):
                gateway.check_automation_scope('save_admin_merchant', {'p_id': 'm', 'p_status': 'lead', 'p_consent': 'revoked'})
            with patch.object(gateway, 'direct_sql', return_value=[{'status': 'lead', 'trial_ends_at': None, 'consent': 'pending', 'owner_id': None}]):
                gateway.check_automation_scope('save_admin_merchant', {'p_id': 'm', 'p_status': 'trial'})
            gateway.check_automation_scope('save_admin_merchant_record', {'p_id': None, 'p_status': 'lead'})
            gateway.check_automation_scope('link_admin_merchant_post', {'p_merchant_id': 'm'})
        with patch.dict(gateway.os.environ, {'GLING_ADMIN_FULL': '1'}):
            gateway.check_automation_scope('set_admin_merchant_workspace_owner', {})
            gateway.check_automation_scope('save_admin_merchant', {'p_id': 'm', 'p_status': 'paid'})

    def test_creator_vendor_operations_run_as_the_admin_account(self):
        for name in ['get_admin_creator_directory', 'get_admin_creator_deal', 'link_admin_creator_deal_merchant', 'get_admin_merchant_creator_deals']:
            with patch.dict(gateway.os.environ, {'GLING_ADMIN_FULL': '1'}), patch.object(gateway, 'direct_sql', return_value=[{'args': 'p_id uuid, p_offset integer'}]), \
                    patch.object(gateway, 'as_admin', return_value=[{'result': {'rows': []}}]) as admin, patch.object(gateway, 'request') as request:
                self.assertEqual(gateway.rpc(name, {'p_id': 'record'}), {'rows': []})
                admin.assert_called_once_with(f'select to_jsonb(public.{name}(p_id => $g$record$g$::uuid)) as result')
                request.assert_not_called()

    def test_rpc_values_are_quoted_and_typed(self):
        self.assertEqual(gateway.sql_value(['a"b', 'c'], 'uuid[]'), '$g${"a\\"b","c"}$g$::uuid[]')
        self.assertEqual(gateway.sql_value(None, 'text'), 'null::text')
        self.assertEqual(gateway.sql_value({'a': 1}, 'jsonb'), '$g${"a": 1}$g$::jsonb')
        with self.assertRaisesRegex(ValueError, 'INVALID_ARGUMENT'): gateway.lit('x$g$; drop table posts; --')

    def test_status_never_exposes_tokens(self):
        with patch.object(gateway, 'keychain_read', return_value={'expires_at': 200, 'access_token': 'SECRET', 'refresh_token': 'SECRET'}), patch.object(gateway.time, 'time', return_value=100):
            status = gateway.connection_status()
            self.assertEqual(status, {'connected': True, 'expires_at': 200})
            self.assertNotIn('SECRET', json.dumps(status))

    def test_disconnect_does_not_report_success_when_keychain_refuses_deletion(self):
        with patch.object(gateway.subprocess, 'run', return_value=CompletedProcess([], 1)):
            with self.assertRaisesRegex(ValueError, 'KEYCHAIN_DELETE_FAILED'): gateway.disconnect()
        with patch.object(gateway.subprocess, 'run', return_value=CompletedProcess([], 44)):
            gateway.disconnect()  # macOS errSecItemNotFound: already disconnected.

if __name__ == '__main__': unittest.main()
