import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadMyMerchantConnections, loadMerchantAccountConnections,
  acceptMerchantAccountInvitation, disconnectMerchantAccount, cancelMerchantAccountInvitation,
} from '../src/lib/merchant-connections.ts';
import { connectAdminMerchantAccount } from '../src/lib/admin-merchants.ts';

const merchant = { id: 'company-a', updated_at: '2026-10-09T10:00:00Z', name: '회사 A' };
const account = { id: 'person-a', nickname: '회원 A', email: 'person-a@example.invalid', auth_role: 'authenticated' };

test('direct admin connection binds the reviewed company, account identity, role and revision', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: merchant.id, error: null }; } };
  await connectAdminMerchantAccount(client, merchant, account, { role: 'operator', method: 'direct', verified: true, note: '  업체 담당자와 직접 확인  ' });
  assert.deepEqual(calls, [['connect_admin_merchant_account', {
    p_merchant_id: merchant.id, p_user_id: account.id, p_role: 'operator', p_method: 'direct', p_verified: true,
    p_note: '업체 담당자와 직접 확인', p_expected_updated_at: merchant.updated_at,
    p_expected_nickname: account.nickname, p_expected_email: account.email,
  }]]);
  assert.equal(account.auth_role, 'authenticated');
  assert.equal(merchant.updated_at, '2026-10-09T10:00:00Z');
});

test('missing explicit verification cannot submit an account connection', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: merchant.id, error: null }; } };
  for (const input of [{ verified: false, note: '업체 담당자와 확인' }, { verified: true, note: '' }]) {
    await assert.rejects(connectAdminMerchantAccount(client, merchant, account, { role: 'owner', method: 'direct', ...input }), /MERCHANT_CONNECTION_CONFIRMATION_REQUIRED/);
  }
  assert.equal(calls, 0);
});

test('switch entries and invitations fail closed for another user or malformed permissions', async () => {
  const data = { user_id: account.id, merchants: [{ id: merchant.id, name: merchant.name, city_name: '밴쿠버', role: 'owner' }], invitations: [] };
  assert.deepEqual(await loadMyMerchantConnections({ rpc: async () => ({ data, error: null }) }, account.id), data);
  for (const invalid of [null, { ...data, user_id: 'other' }, { ...data, merchants: {} }, { ...data, merchants: [{ ...data.merchants[0], role: 'superuser' }] },
    { ...data, invitations: [{ id: 'invite', merchant_id: merchant.id, role: 'owner', can_accept: 'true' }] }]) {
    await assert.rejects(loadMyMerchantConnections({ rpc: async () => ({ data: invalid, error: null }) }, account.id), /MERCHANT_CONNECTION_READ_FAILED/);
  }
  await assert.rejects(loadMyMerchantConnections({ rpc: async () => ({ data, error: { message: 'ACCOUNT_LOCKED' } }) }, account.id), /ACCOUNT_LOCKED/);
});

test('account connections cannot reuse another company response', async () => {
  await assert.rejects(loadMerchantAccountConnections({ rpc: async () => ({ data: { merchant_id: 'other', owner: null, operators: [], invitations: [] }, error: null }) }, merchant.id), /MERCHANT_CONNECTION_READ_FAILED/);
});

test('invitation and revocation send only the selected scope and preserve server errors', async () => {
  const calls = []; const invitation = { id: 'invite-a', merchant_id: merchant.id };
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: merchant.id, error: null }; } };
  await acceptMerchantAccountInvitation(client, invitation);
  await cancelMerchantAccountInvitation(client, invitation.id);
  await disconnectMerchantAccount(client, merchant.id, { user_id: account.id, role: 'owner' }, merchant.updated_at, '소유자 연결을 해제합니다');
  assert.deepEqual(calls, [
    ['accept_merchant_account_invitation', { p_invitation_id: invitation.id }],
    ['cancel_merchant_account_invitation', { p_invitation_id: invitation.id }],
    ['disconnect_merchant_account', { p_merchant_id: merchant.id, p_user_id: account.id, p_role: 'owner', p_expected_updated_at: merchant.updated_at, p_note: '소유자 연결을 해제합니다' }],
  ]);
  await assert.rejects(acceptMerchantAccountInvitation({ rpc: async () => ({ data: 'other-company', error: null }) }, invitation), /MERCHANT_CONNECTION_SAVE_FAILED/);
  await assert.rejects(disconnectMerchantAccount({ rpc: async () => ({ data: null, error: { message: 'MERCHANT_CONNECTION_CHANGED' } }) }, merchant.id, { user_id: account.id, role: 'owner' }, merchant.updated_at, '소유자 연결 해제'), /MERCHANT_CONNECTION_CHANGED/);
});
