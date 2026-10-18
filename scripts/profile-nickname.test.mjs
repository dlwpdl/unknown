import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNickname, changeProfileNickname, nicknameError } from '../src/lib/nickname.ts';

const userId = 'a0000000-0000-4000-8000-000000000001';
test('nickname uses the database character limit and keeps names on one line', () => {
  assert.equal(normalizeNickname('  지모코 이웃  '), '지모코 이웃');
  assert.equal(normalizeNickname('😀'.repeat(20)), '😀'.repeat(20));
  for (const value of ['', ' ', '가', 'a'.repeat(21), '이웃\n이름', '이웃\u0000']) assert.throws(() => normalizeNickname(value), /INVALID_NICKNAME/);
});
test('nickname mutation carries the reviewed target and old name and verifies exact readback', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: { id: userId, nickname: '새 이름' }, error: null }; } };
  assert.equal(await changeProfileNickname(client, userId, ' 새 이름 ', '옛 이름'), '새 이름');
  assert.deepEqual(calls, [['change_profile_nickname', { p_user_id: userId, p_nickname: '새 이름', p_expected_nickname: '옛 이름' }]]);
  client.rpc = async () => ({ data: { id: 'other', nickname: '새 이름' }, error: null });
  await assert.rejects(changeProfileNickname(client, userId, '새 이름', '옛 이름'), /NICKNAME_READBACK_REQUIRED/);
});
test('invalid nicknames never call the server and conflicts are not retried as overwrites', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: null, error: { message: 'NICKNAME_CHANGED' } }; } };
  await assert.rejects(changeProfileNickname(client, userId, 'a', '옛 이름'), /INVALID_NICKNAME/); assert.equal(calls, 0);
  await assert.rejects(changeProfileNickname(client, userId, '새 이름', '옛 이름'), /NICKNAME_CHANGED/); assert.equal(calls, 1);
  assert.match(nicknameError(new Error('NICKNAME_TAKEN')), /사용 중/);
  assert.match(nicknameError(new Error('NICKNAME_CHANGED')), /바뀌/);
});
