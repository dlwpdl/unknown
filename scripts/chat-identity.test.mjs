import assert from 'node:assert/strict';
import test from 'node:test';
import { chatBusinessIdentity, resetChatIdentity, selectChatBusiness, subscribeChatIdentity } from '../src/lib/chat-identity.ts';

const user = 'c1810000-0000-4000-8000-000000000001';
const other = 'c1810000-0000-4000-8000-000000000002';
const business = { id: 'c1820000-0000-4000-8000-000000000001', name: 'Example Business' };

test('business selection belongs to the current personal session and never leaks to a different account', () => {
  resetChatIdentity();
  assert.equal(chatBusinessIdentity(user), null);
  selectChatBusiness(user, business);
  assert.deepEqual(chatBusinessIdentity(user), business);
  assert.equal(chatBusinessIdentity(other), null);
  assert.equal(chatBusinessIdentity(null), null);
  selectChatBusiness(user, null);
  assert.equal(chatBusinessIdentity(user), null);
});

test('sign-out discards the business mode even if the same user later signs in', () => {
  selectChatBusiness(user, business);
  resetChatIdentity();
  assert.equal(chatBusinessIdentity(user), null);
});

test('profile subscribers receive scope changes, and unsubscribing stops updates', () => {
  resetChatIdentity();
  const updates = [];
  const unsubscribe = subscribeChatIdentity(() => updates.push(chatBusinessIdentity(user)));
  selectChatBusiness(user, business);
  selectChatBusiness(user, null);
  unsubscribe();
  selectChatBusiness(user, business);
  assert.deepEqual(updates, [business, null]);
  resetChatIdentity();
});

test('selection copies only the public business ID and name and rejects malformed selections', () => {
  const candidate = { ...business, owner_id: other };
  selectChatBusiness(user, candidate);
  candidate.name = 'Changed outside the store';
  assert.deepEqual(chatBusinessIdentity(user), business);
  assert.throws(() => selectChatBusiness('', business), /INVALID_CHAT_IDENTITY/);
  assert.throws(() => selectChatBusiness(user, { id: '', name: 'Example' }), /INVALID_CHAT_IDENTITY/);
  resetChatIdentity();
});
