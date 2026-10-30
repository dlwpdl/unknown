import assert from 'node:assert/strict';
import test from 'node:test';

import { claimRememberedInvite, INVITE_CODE_KEY, inviteUrl, normalizeInviteCode, rememberInviteCode } from '../src/lib/invites.ts';

const memory = () => { const map = new Map(); return { map, getItem: async k => map.get(k) ?? null, setItem: async (k, v) => map.set(k, v), removeItem: async k => map.delete(k) }; };
const client = result => ({ calls: [], rpc(name, args) { this.calls.push([name, args]); return Promise.resolve(result); } });

test('invite codes come from a bare code or our own link only', () => {
  assert.equal(normalizeInviteCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(normalizeInviteCode(inviteUrl('HJKM2345')), 'HJKM2345');
  assert.equal(normalizeInviteCode('gling://invite?code=hjkm2345'), 'HJKM2345');
  assert.equal(normalizeInviteCode('ABCD234O'), null, 'O and 0 are never issued');
  assert.equal(normalizeInviteCode('ABC'), null);
  assert.equal(normalizeInviteCode(null), null);
});

test('a remembered code is linked once after sign-up and kept on network errors', async () => {
  const storage = memory();
  assert.equal(await rememberInviteCode(storage, 'bad'), null);
  assert.equal(storage.map.size, 0, 'a malformed code is never stored');
  await rememberInviteCode(storage, 'HJKM2345');
  const ok = client({ data: { linked: true }, error: null });
  assert.equal(await claimRememberedInvite(ok, storage), 'linked');
  assert.deepEqual(ok.calls, [['claim_invite_code', { p_code: 'HJKM2345' }]]);
  assert.equal(storage.map.has(INVITE_CODE_KEY), false);

  await rememberInviteCode(storage, 'HJKM2345');
  assert.equal(await claimRememberedInvite(client({ data: null, error: { message: 'INVITE_TOO_LATE' } }), storage), 'INVITE_TOO_LATE');
  assert.equal(storage.map.has(INVITE_CODE_KEY), false, 'a final answer drops the code');

  await rememberInviteCode(storage, 'HJKM2345');
  await assert.rejects(claimRememberedInvite(client({ data: null, error: { message: 'Failed to fetch' } }), storage));
  assert.equal(storage.map.get(INVITE_CODE_KEY), 'HJKM2345', 'a network error keeps the code for the next sign-in');
});
