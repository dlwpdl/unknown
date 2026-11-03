import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPostChange, forgetHandedOffPost, handedOffPost, handOffPost } from '../src/lib/post-open.ts';

const post = (id, extra = {}) => ({ id, title: id, comments: 0, views: 0, ...extra });

test('a handed-off post is shown only to the same viewer and the same post, and is gone once taken', () => {
  handOffPost('me', post('a'));
  assert.equal(handedOffPost('other', 'a'), undefined, 'another account never sees my list copy');
  assert.equal(handedOffPost('me', 'b'), undefined);
  assert.equal(handedOffPost('me', 'a').id, 'a');
  forgetHandedOffPost('b');
  assert.equal(handedOffPost('me', 'a').id, 'a', 'forgetting another post keeps this one');
  forgetHandedOffPost('a');
  assert.equal(handedOffPost('me', 'a'), undefined, 'a later deep link to the same post loads fresh data');
});

test('detail changes reach the list the same way the old home sheet callbacks did', () => {
  const list = [post('a'), post('b')];
  assert.deepEqual(applyPostChange(list, { id: 'a', removed: true }).map(item => item.id), ['b']);
  assert.equal(applyPostChange(list, { id: 'a', comments: 3 })[0].comments, 3);
  assert.equal(applyPostChange(list, { id: 'a', views: 9 })[0].views, 9);
  assert.equal(applyPostChange(list, { id: 'a', views: 9 })[0].comments, 0, 'a count change keeps the other fields');
  assert.equal(applyPostChange(list, { id: 'b', post: post('b', { title: 'edited' }) })[1].title, 'edited');
  assert.equal(applyPostChange(list, { id: 'zzz', comments: 1 })[0], list[0], 'other posts are untouched');
});
