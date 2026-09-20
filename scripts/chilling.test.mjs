import assert from 'node:assert/strict';
import test from 'node:test';
import { chillingKind, chillingSchedule, configureChillingEvent } from '../src/lib/chilling.ts';

test('legacy rooms stay persistent; explicit one-off events have their own category', () => {
  assert.equal(chillingKind({}), 'group');
  assert.equal(chillingKind({ eventKind: 'once' }), 'once');
});

test('one-off time is formatted in the event timezone and persistent cadence stays distinct', () => {
  assert.match(chillingSchedule({ eventKind: 'once', startsAt: '2026-09-26T17:00:00Z', timezone: 'America/Vancouver' }), /9월 26일.*10:00/);
  assert.equal(chillingSchedule({ eventKind: 'group', cadence: '매주 토요일' }), '매주 토요일');
  assert.equal(chillingSchedule({}), '지속 모임');
  assert.equal(chillingSchedule({ eventKind: 'once', startsAt: 'invalid', timezone: 'bad' }), '일정 확인 필요');
  assert.match(chillingSchedule({ eventKind: 'once', startsAt: '2026-09-26T17:00:00Z', endsAt: '2026-09-27T19:00:00Z', timezone: 'America/Vancouver' }), /9월 26일.*10:00.*9월 27일.*12:00/);
});

const once = { kind: 'once', startsAt: '2099-09-26T17:00:00Z', endsAt: '2099-09-26T19:00:00Z', timezone: 'America/Vancouver', cadence: '', capacity: 6 };
test('event configuration sends only public schedule fields and does not gate free hosting', async () => {
  let sent;
  await configureChillingEvent({ rpc: async (name, args) => { sent = { name, args }; return { error: null }; } }, 'post-1', once);
  assert.deepEqual(sent, { name: 'configure_chilling_event', args: {
    p_post_id: 'post-1', p_kind: 'once', p_starts_at: '2099-09-26T17:00:00.000Z', p_ends_at: '2099-09-26T19:00:00.000Z',
    p_timezone: 'America/Vancouver', p_cadence: null, p_capacity: 6,
  } });
});

test('switching a draft to a persistent group clears its old one-off schedule', async () => {
  let sent;
  await configureChillingEvent({ rpc: async (_name, args) => { sent = args; return { error: null }; } }, 'post-2', { ...once, kind: 'group', cadence: '  매주 토요일  ' });
  assert.deepEqual(sent, { p_post_id: 'post-2', p_kind: 'group', p_starts_at: null, p_ends_at: null, p_timezone: null, p_cadence: '매주 토요일', p_capacity: 6 });
});

test('invalid schedule and capacity never reach the server; server denial is preserved', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { error: new Error('NOT_OWNER') }; } };
  for (const patch of [{ endsAt: once.startsAt }, { timezone: 'not-a-timezone' }, { capacity: 1 }, { capacity: 3.5 }, { capacity: 51 }, { kind: 'group', cadence: '  ' }]) {
    await assert.rejects(configureChillingEvent(client, 'post-1', { ...once, ...patch }));
  }
  assert.equal(calls, 0);
  await assert.rejects(configureChillingEvent(client, 'post-1', once), /NOT_OWNER/);
});

test('recommended ages validate whole inclusive bounds and never imply an admission gate', async () => {
  const { normalizeChillingEvent, recommendedAgeLabel, recommendedAgeMessage } = await import('../src/lib/chilling.ts');
  const room = { recommendedAgeMin: 20, recommendedAgeMax: 39 };
  assert.equal(recommendedAgeLabel(room), '권장 만 20~39세');
  assert.equal(recommendedAgeLabel({}), '연령대 무관');
  assert.equal(normalizeChillingEvent({ ...once, ...room }).recommendedAgeMax, 39);
  let sent;
  const client = { rpc: async (_name, args) => { sent = args; return { error: null }; } };
  await configureChillingEvent(client, 'post-1', { ...once, recommendedAgeMin: 0, recommendedAgeMax: 120 });
  assert.equal(sent.p_recommended_age_min, 0);
  assert.equal(sent.p_recommended_age_max, 120);
  await configureChillingEvent(client, 'post-1', { ...once, recommendedAgeMin: null, recommendedAgeMax: null });
  assert.equal(sent.p_recommended_age_min, null);
  assert.equal(sent.p_recommended_age_max, null);
  for (const patch of [{ recommendedAgeMin: 20 }, { recommendedAgeMin: 40, recommendedAgeMax: 39 }, { recommendedAgeMin: -1, recommendedAgeMax: 39 }, { recommendedAgeMin: 20, recommendedAgeMax: 121 }, { recommendedAgeMin: 20.5, recommendedAgeMax: 39 }]) {
    assert.throws(() => normalizeChillingEvent({ ...once, ...patch }), /INVALID_RECOMMENDED_AGE/);
  }
  assert.match(recommendedAgeMessage(room, 20), /권장 연령대에 해당/);
  assert.match(recommendedAgeMessage(room, 39), /권장 연령대에 해당/);
  assert.match(recommendedAgeMessage(room, 40), /달라도 신청/);
  assert.match(recommendedAgeMessage(room, null), /없어도 신청/);
});
