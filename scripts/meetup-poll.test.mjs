import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeetupPoll, decideMeetupPoll, leadingOption, pollDraftError, pollError, voteMeetupPoll } from '../src/lib/meetup-poll.ts';

const future = days => new Date(Date.now() + days * 86400000).toISOString();
const option = (id, kind, votes) => ({ id, kind, startsAt: null, label: id, chosen: false, votes, mine: false });

test('a draft needs 2 to 5 distinct choices of each kind it uses', () => {
  assert.equal(pollDraftError({ dates: [future(2), future(3)], places: [] }), null);
  assert.equal(pollDraftError({ dates: [], places: ['공원', '카페'] }), null);
  assert.equal(pollDraftError({ dates: [future(2), future(3)], places: ['공원', '카페', '도서관', '시장', '해변'] }), null);
  assert.ok(pollDraftError({ dates: [], places: [] }));
  assert.ok(pollDraftError({ dates: [future(2)], places: [] }), 'one date is not a vote');
  assert.ok(pollDraftError({ dates: [future(2), future(3)], places: ['공원'] }), 'one place beside dates is not a vote');
  assert.ok(pollDraftError({ dates: [], places: ['a', 'b', 'c', 'd', 'e', 'f'] }), 'six is too many');
  assert.ok(pollDraftError({ dates: [future(2), future(2)], places: [] }), 'duplicate dates');
  assert.ok(pollDraftError({ dates: [], places: ['공원', ' 공원 '] }), 'duplicate places ignore spacing');
  assert.ok(pollDraftError({ dates: [], places: ['공원', ''] }), 'blank place');
  assert.ok(pollDraftError({ dates: [], places: ['공원', '가'.repeat(61)] }), 'long place');
  assert.ok(pollDraftError({ dates: [future(-1), future(2)], places: [] }), 'past date');
});

test('the most-voted option leads, the first listed wins a tie', () => {
  const options = [option('a', 'date', 1), option('b', 'date', 3), option('c', 'date', 3), option('p', 'place', 0)];
  assert.equal(leadingOption(options, 'date')?.id, 'b');
  assert.equal(leadingOption(options, 'place')?.id, 'p');
  assert.equal(leadingOption([], 'date'), null);
});

test('server codes map to Korean copy and unknown ones fall back', () => {
  assert.match(pollError(new Error('POLL_ALREADY_OPEN')), /진행 중인 투표/);
  assert.match(pollError(new Error('HOST_REQUIRED')), /호스트/);
  assert.match(pollError(new Error('boom')), /저장하지 못했어요/);
});

test('RPC wrappers send the contract the migration expects', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: 'x', error: null }; } };
  await createMeetupPoll(client, 'post', { dates: ['2030-01-01T00:00:00.000Z'], places: [' 공원 '] });
  await voteMeetupPoll(client, 'poll', ['o1']);
  await decideMeetupPoll(client, 'poll', 'o1', null);
  assert.deepEqual(calls, [
    ['create_meetup_poll', { p_post_id: 'post', p_dates: ['2030-01-01T00:00:00.000Z'], p_places: ['공원'] }],
    ['vote_meetup_poll', { p_poll_id: 'poll', p_option_ids: ['o1'] }],
    ['decide_meetup_poll', { p_poll_id: 'poll', p_date_option: 'o1', p_place_option: null }],
  ]);
  await assert.rejects(voteMeetupPoll({ rpc: async () => ({ data: null, error: { message: 'POLL_NOT_OPEN' } }) }, 'poll', []), /POLL_NOT_OPEN/);
});
