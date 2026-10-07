import assert from 'node:assert/strict';
import test from 'node:test';

import { eventVideo } from '../src/lib/event-videos.ts';

test('shows only videos linked in the event data and leaves other events on their poster', () => {
  assert.equal(eventVideo({ id: '1AoZkfNGkeJ_MYK' }), null);
  assert.deepEqual(eventVideo({ id: 'event-2', videoYoutubeId: 'abcdefghijk' }), { youtubeId: 'abcdefghijk', label: '행사 관련 영상' });
  assert.equal(eventVideo({ id: 'rZ7HnEZ1AfG3e7' }), null);
  assert.equal(eventVideo({ id: 'other-event' }), null);
});
