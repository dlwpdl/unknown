import assert from 'node:assert/strict';
import test from 'node:test';
import { reservationAction, reservationLink } from '../src/lib/reservation.ts';

test('only known booking sites count as a reservation link', () => {
  assert.equal(reservationLink(['https://www.opentable.ca/r/bao-bei-vancouver']), 'https://www.opentable.ca/r/bao-bei-vancouver');
  assert.equal(reservationLink(['https://example.com', 'https://www.exploretock.com/dachi']), 'https://www.exploretock.com/dachi');
  assert.equal(reservationLink(['https://resy.com/cities/mtl/venues/x#top']), 'https://resy.com/cities/mtl/venues/x');
  for (const url of ['https://bao-bei.ca/reservations', 'https://opentable.com.evil.example/r/x', 'https://notopentable.com/r/x',
    'http://www.opentable.com/r/x', 'javascript:alert(1)', 'https://user@www.opentable.com/r/x', 42, null]) assert.equal(reservationLink([url]), null, String(url));
});

test('the button goes to a booking site, then the phone, then a Gling message, and hides when none exist', () => {
  assert.deepEqual(reservationAction({ links: ['https://www.opentable.com/r/x'], phone: '604-555-0100', canMessage: true }), { kind: 'link', url: 'https://www.opentable.com/r/x' });
  assert.deepEqual(reservationAction({ links: ['https://bao-bei.ca'], phone: '(604) 555-0100', canMessage: true }), { kind: 'phone', url: 'tel:6045550100' });
  assert.deepEqual(reservationAction({ phone: 'call us', canMessage: true }), { kind: 'message' });
  assert.equal(reservationAction({ links: ['https://bao-bei.ca'], phone: '' }), null);
  assert.equal(reservationAction({}), null);
});
