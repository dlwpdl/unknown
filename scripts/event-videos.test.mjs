import assert from 'node:assert/strict';
import test from 'node:test';

import { eventIntro, eventVideo } from '../src/lib/event-videos.ts';

test('shows only videos linked in the event data and leaves other events on their poster', () => {
  assert.equal(eventVideo({ id: '1AoZkfNGkeJ_MYK' }), null);
  assert.deepEqual(eventVideo({ id: 'event-2', videoYoutubeId: 'abcdefghijk' }), { youtubeId: 'abcdefghijk', label: '행사 관련 영상' });
  assert.equal(eventVideo({ id: 'rZ7HnEZ1AfG3e7' }), null);
  assert.equal(eventVideo({ id: 'other-event' }), null);
});

test('QA C22-2: a seller purchase notice is not shown as the event introduction', () => {
  assert.equal(eventIntro('Thank you for your purchase. Your contact information and ticket sales data will be shared by the Vancouver Canucks with the NHL.'), null);
  for (const notice of ['All sales are final.', 'Ticket limits are strictly enforced.', 'By purchasing tickets you agree to the venue policy.', 'No refunds or exchanges.']) assert.equal(eventIntro(notice), null, notice);
  assert.equal(eventIntro('  Cirque du Soleil returns with LUZIA, a waking dream of Mexico.  '), 'Cirque du Soleil returns with LUZIA, a waking dream of Mexico.');
  assert.equal(eventIntro(''), null);
  assert.equal(eventIntro(undefined), null);
});
