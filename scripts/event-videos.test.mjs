import assert from 'node:assert/strict';
import test from 'node:test';

import { eventIntro, eventPhoto, eventVideo } from '../src/lib/event-videos.ts';

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

test('drops the category stand-in photo but keeps an event’s own art', () => {
  assert.equal(eventPhoto({ image: 'https://s1.ticketm.net/dam/c/8cf/a6653880_RETINA_PORTRAIT_16_9.jpg' }), null);
  assert.equal(eventPhoto({ image: 'https://s1.ticketm.net/dam/a/1d1/47cc9b10_RETINA_PORTRAIT_16_9.jpg' }), 'https://s1.ticketm.net/dam/a/1d1/47cc9b10_RETINA_PORTRAIT_16_9.jpg');
  assert.equal(eventPhoto({ image: null }), null);
  assert.equal(eventPhoto({}), null);
});
