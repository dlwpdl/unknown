import assert from 'node:assert/strict';
import test from 'node:test';
import { merchantOperatorInviteUrl, readMerchantOperatorInvite } from '../src/lib/merchant-operators.ts';

test('invite links carry exactly one well-formed token and ignore anything else', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz012-_A';
  assert.equal(merchantOperatorInviteUrl(token), `https://gling.ej-entertainment.com/merchant/?operator_invite=${token}`);
  assert.equal(readMerchantOperatorInvite(`?operator_invite=${token}`), token);
  for (const bad of ['', '?operator_invite=short', `?operator_invite=${token}x`, `?operator_invite=${token.slice(0, 31)}%3C`, '?other=1']) assert.equal(readMerchantOperatorInvite(bad), null, bad);
});
