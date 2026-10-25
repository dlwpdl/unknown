import assert from 'node:assert/strict';
import test from 'node:test';
import * as details from '../src/lib/chat-details.ts';

const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function fixture() {
  const calls = [];
  const queue = details.createChatMemberPhotoQueue(path => new Promise((resolve, reject) => calls.push({ path, resolve, reject })));
  return { queue, calls };
}

test('private avatar downloads stay at four even while cancelled requests are still in flight', async () => {
  const { queue, calls } = fixture();
  const changed = [];
  const handles = Array.from({ length: 20 }, (_, n) => queue.subscribe('viewer:room', `photo-${n}`, () => changed.push(n)));
  await settle();
  assert.equal(calls.length, 4);
  handles.forEach(handle => handle.cancel());
  const replacement = queue.subscribe('other-viewer:other-room', 'current-photo', () => changed.push('current'));
  await settle();
  assert.equal(calls.length, 4, 'cancelled network reads continue occupying their slots');
  calls[0].resolve('old-photo');
  await settle();
  assert.equal(calls.length, 5);
  assert.equal(calls[4].path, 'current-photo');
  assert.deepEqual(changed, [], 'cancelled results never write into the new view');
  calls.slice(1, 4).forEach(call => call.resolve('old-photo'));
  calls[4].resolve('current-photo-bytes');
  await settle();
  assert.deepEqual(changed, ['current']);
  assert.equal(replacement.read(), 'current-photo-bytes');
  assert.ok(handles.every(handle => handle.read() === undefined));
  replacement.cancel();
  assert.equal(replacement.read(), undefined);
});

test('only simultaneous visible subscribers share bytes; leaving drops them and reauthorizes the next read', async () => {
  const { queue, calls } = fixture();
  let changes = 0;
  const one = queue.subscribe('viewer:room', 'same-photo', () => changes++);
  const two = queue.subscribe('viewer:room', 'same-photo', () => changes++);
  await settle();
  assert.equal(calls.length, 1);
  calls[0].resolve('authorized-bytes');
  await settle();
  assert.equal(changes, 2);
  assert.equal(one.read(), 'authorized-bytes');
  assert.equal(queue.read('viewer:room', 'same-photo'), 'authorized-bytes');
  assert.equal(queue.read('other-viewer:room', 'same-photo'), undefined);
  one.cancel();
  assert.equal(two.read(), 'authorized-bytes');
  two.cancel();
  assert.equal(two.read(), undefined);
  assert.equal(queue.read('viewer:room', 'same-photo'), undefined);
  const next = queue.subscribe('viewer:room', 'same-photo', () => changes++);
  await settle();
  assert.equal(calls.length, 2, 'there is no persistent base64 cache');
  assert.equal(next.read(), undefined);
  calls[1].reject(new Error('permission revoked'));
  await settle();
  assert.equal(next.read(), undefined);
  next.cancel();
});

test('queued invisible avatars are removed before their loaders run', async () => {
  const { queue, calls } = fixture();
  const first = Array.from({ length: 4 }, (_, n) => queue.subscribe('viewer:room', `visible-${n}`, () => {}));
  const hidden = queue.subscribe('viewer:room', 'scrolled-away', () => assert.fail('stale callback'));
  hidden.cancel();
  await settle();
  calls.forEach(call => call.resolve('bytes'));
  await settle();
  assert.equal(calls.length, 4);
  first.forEach(handle => handle.cancel());
});
