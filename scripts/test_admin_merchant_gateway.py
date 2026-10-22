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
        self.assertTrue(gateway.same_origin('https://cayden-macbookpro.tailb6648f.ts.net', 'cayden-macbookpro.tailb6648f.ts.net'))
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
