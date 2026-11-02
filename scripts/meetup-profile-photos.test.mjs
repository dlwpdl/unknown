import assert from 'node:assert/strict';
import test from 'node:test';
import { dragOffset, dropIndex, movePhoto } from '../src/lib/meetup-profile-photos.ts';

test('a dragged row lands on the nearest slot and never past the ends', () => {
  assert.equal(dropIndex(0, 39, 80, 3), 0);
  assert.equal(dropIndex(0, 41, 80, 3), 1);
  assert.equal(dropIndex(0, 500, 80, 3), 2);
  assert.equal(dropIndex(2, -500, 80, 3), 0);
  assert.equal(dropIndex(1, 500, 0, 3), 1, 'An unmeasured row stays put.');
});

test('only rows between the start and the target step aside, toward the start', () => {
  assert.deepEqual([0, 1, 2].map(index => dragOffset(index, 0, 2)), [0, -1, -1]);
  assert.deepEqual([0, 1, 2].map(index => dragOffset(index, 2, 0)), [1, 1, 0]);
  assert.deepEqual([0, 1, 2].map(index => dragOffset(index, 1, 1)), [0, 0, 0]);
});

test('the public photo choice follows its picture through every move', () => {
  const photos = ['a', 'b', 'c'];
  for (const from of [0, 1, 2]) for (const to of [0, 1, 2]) for (const picked of [0, 1, 2]) {
    const moved = movePhoto(photos, picked, from, to);
    assert.equal(moved.photos[moved.publicIndex], photos[picked]);
    assert.deepEqual([...moved.photos].sort(), photos, 'A move never loses or duplicates a photo.');
  }
  assert.deepEqual(movePhoto(photos, null, 0, 2), { photos: ['b', 'c', 'a'], publicIndex: null });
  assert.deepEqual(movePhoto(photos, 1, 0, 9), { photos, publicIndex: 1 }, 'An impossible target changes nothing.');
  assert.deepEqual(movePhoto(photos, 1, 9, 0), { photos, publicIndex: 1 });
});
