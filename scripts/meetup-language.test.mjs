import assert from 'node:assert/strict';
import test from 'node:test';
import { languageSeats, meetupCategoryOf, normalizeLanguageExchange, parseLanguageExchange, sideOpen } from '../src/lib/meetup-language.ts';
import { normalizeChillingEvent } from '../src/lib/chilling.ts';
import { matchesChilling } from '../src/lib/chilling-discovery.ts';

const exchange = (share, languages = ['ko', 'en']) => ({ languages, share });

test('seat split matches private.meetup_language_seats (host excluded, half up, one seat each side)', () => {
  // Same cases as supabase/tests/meetup_language_exchange.test.sql.
  assert.deepEqual(languageSeats(exchange(50), 10), [5, 4]);
  assert.deepEqual(languageSeats(exchange(67), 10), [6, 3]);
  assert.deepEqual(languageSeats(exchange(33), 10), [3, 6]);
  assert.deepEqual(languageSeats(exchange(67), 4), [2, 1]);
  assert.deepEqual(languageSeats(exchange(90, ['ko', 'fr']), 3), [1, 1]);
  assert.equal(languageSeats(exchange(50), 2), null, 'capacity edited below three removes side limits');
});

test('exchange validation mirrors the server', () => {
  assert.deepEqual(normalizeLanguageExchange(exchange(33, ['en', 'fr']), 6), exchange(33, ['en', 'fr']));
  for (const bad of [exchange(50, ['ko', 'ko']), exchange(50, ['ko', 'ja']), exchange(95), exchange(50.5)]) {
    assert.throws(() => normalizeLanguageExchange(bad, 6), /INVALID_LANGUAGE_EXCHANGE/);
  }
  assert.throws(() => normalizeLanguageExchange(exchange(50), 2), /LANGUAGE_EXCHANGE_CAPACITY/);
  assert.equal(parseLanguageExchange({ languageExchange: { languages: ['ko'], share: 50 } }), null);
});

test('an exchange is saved as category casual so published apps show 가볍게', () => {
  const base = { kind: 'group', startsAt: '', endsAt: '', timezone: '', cadence: '매주 토요일', capacity: 6 };
  const event = normalizeChillingEvent({ ...base, category: 'party', languageExchange: exchange(50) });
  assert.equal(event.category, 'casual');
  assert.deepEqual(event.languageExchange, exchange(50));
  // v1.4.6 labels exactly these six; anything else reaches String.replace on undefined there.
  assert.ok(['casual', 'party', 'festival', 'sports', 'hobby', 'travel'].includes(event.category));
  assert.equal('languageExchange' in normalizeChillingEvent({ ...base, category: 'hobby' }), false, 'ordinary meetups are unchanged');
  assert.throws(() => normalizeChillingEvent({ ...base, capacity: 2, languageExchange: exchange(50) }), /LANGUAGE_EXCHANGE_CAPACITY/);
});

test('the new app reads the exchange as its own category and filter', () => {
  const room = { memberCount: 1, verifiedOnly: false, eventKind: 'group', category: 'casual', languageExchange: exchange(50) };
  assert.equal(meetupCategoryOf(room), 'language');
  assert.equal(meetupCategoryOf({ ...room, languageExchange: undefined }), 'casual');
  assert.equal(matchesChilling({ room }, 'all', 'language'), true);
  assert.equal(matchesChilling({ room }, 'all', 'casual'), false);
  assert.equal(matchesChilling({ room: { ...room, languageExchange: undefined } }, 'all', 'casual'), true);
});

test('a side is open until its approvals reach its seats', () => {
  const state = { sides: [{ language: 'ko', seats: 2, approved: 2, pending: null, waiting: null }, { language: 'en', seats: null, approved: 4, pending: null, waiting: null }],
    mine: null, requests: null, unknown: null };
  assert.equal(sideOpen(state, 'ko'), false);
  assert.equal(sideOpen(state, 'en'), true, 'no seat limit when capacity is below three');
  assert.equal(sideOpen(null, 'ko'), true, 'unreadable counts leave the server to decide');
});
