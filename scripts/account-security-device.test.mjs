import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerSecurityDevice } from '../src/lib/account-security-device.ts';

const user = '15300000-0000-4000-8000-000000000001';
const device = '15300000-0000-4000-8000-000000000010';
test('an installation reuses its identifier and binds registration to the expected account', async () => {
  let saved;
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'register_security_device');
    assert.deepEqual(args, { p_device_id: device, p_expected_user_id: user });
    return { data: device, error: null };
  } };
  await registerSecurityDevice(client, user, { getItem: async () => device, setItem: async (...args) => { saved = args; } });
  assert.deepEqual(saved, ['gling.security.device.v1', device]);
});
test('a missing or invalid identifier requests cryptographic generation from the server', async () => {
  for (const stored of [null, 'invalid', 'https://attacker.invalid']) {
    const client = { rpc: async (_, args) => { assert.equal(args.p_device_id, null); return { data: device, error: null }; } };
    let saved;
    await registerSecurityDevice(client, user, { getItem: async () => stored, setItem: async (_, value) => { saved = value; } });
    assert.equal(saved, device);
  }
});
test('a rejected stale account request never persists a device response', async () => {
  let writes = 0;
  const error = new Error('AUTH_CONTEXT_CHANGED');
  await assert.rejects(registerSecurityDevice({ rpc: async () => ({ data: device, error }) }, user,
    { getItem: async () => null, setItem: async () => { writes++; } }), error);
  assert.equal(writes, 0);
});
test('malformed server responses never become persistent device identifiers', async () => {
  let writes = 0;
  await assert.rejects(registerSecurityDevice({ rpc: async () => ({ data: 'not-a-uuid', error: null }) }, user,
    { getItem: async () => null, setItem: async () => { writes++; } }), /INVALID_SECURITY_DEVICE/);
  assert.equal(writes, 0);
});
