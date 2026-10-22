import assert from 'node:assert/strict';
import test from 'node:test';
import {
  templateDraft, applyMeetupTemplate, loadMeetupTemplates, saveMeetupTemplate, proposeMeetupDates,
  confirmMeetupOccurrence, setMeetupWaitlist, inviteNextMeetupWaitlist,
  loadMeetupHostAggregates, respondMeetupCohost,
} from '../src/lib/meetup-host-tools.ts';

const post = 'a1600000-0000-0000-0000-000000000001';
const draft = { title: '산책', body: '함께 걸어요', applicationQuestion: '어떤 산책을 좋아하세요?' };

test('templates copy content only, preserving explicit empty fields without copying logistics', () => {
  assert.deepEqual(templateDraft({ ...draft, startsAt: '2030-01-01', venue: 'invented', capacity: 50, payment: 'free' }), draft);
  assert.deepEqual(templateDraft({ applicationQuestion: '  처음 오시나요?  ' }), { title: '', body: '', applicationQuestion: '처음 오시나요?' });
  assert.throws(() => templateDraft({ body: 'x'.repeat(5001) }), /INVALID_TEMPLATE/);
  assert.throws(() => templateDraft({ title: 'x'.repeat(61) }), /INVALID_TEMPLATE/);
  assert.throws(() => templateDraft({ title: 42 }), /INVALID_TEMPLATE/);
});

test('template bounds and categories match the current meetup form', () => {
  for (const category of ['casual', 'hobby', 'travel', 'party', 'festival', 'sports']) {
    assert.equal(templateDraft({ title: 'x'.repeat(60), body: 'x'.repeat(5000), category }).body.length, 5000);
  }
  assert.throws(() => templateDraft({ category: 'not-a-category' }), /INVALID_TEMPLATE/);
});

test('saving templates sends only owner content and requires verified save', async () => {
  let call;
  const client = { rpc: async (...args) => { call = args; return { data: post }; } };
  assert.equal(await saveMeetupTemplate(client, '  주말 산책  ', { ...draft, venue: 'not copied' }), post);
  assert.deepEqual(call, ['save_meetup_template', { p_name: '주말 산책', p_draft: draft, p_template_id: null }]);
  await assert.rejects(saveMeetupTemplate({ rpc: async () => ({ data: null }) }, '산책', draft), /SAVE_NOT_VERIFIED/);
});

test('a reusable question leaves the current title and body intact', () => {
  assert.deepEqual(applyMeetupTemplate(draft, templateDraft({ applicationQuestion: '처음 오시나요?' })),
    { ...draft, applicationQuestion: '처음 오시나요?' });
  assert.deepEqual(applyMeetupTemplate({ ...draft, venue: 'keep in parent only' }, draft), draft);
  const formatted = { ...draft, body: '  작성 중인 서식\n' };
  assert.equal(applyMeetupTemplate(formatted, templateDraft({ applicationQuestion: '새 질문' })).body, formatted.body);
});

test('recurrence proposes without creation and rejects invalid times before the RPC', async () => {
  const calls = [];
  const dates = [{ startsAt: '2030-01-01T18:00:00Z', endsAt: '2030-01-01T19:00:00Z' }];
  const client = { rpc: async (...args) => { calls.push(args); return { data: dates }; } };
  assert.deepEqual(await proposeMeetupDates(client, post, dates[0].startsAt, dates[0].endsAt, 'weekly', 4), dates);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'propose_meetup_dates');
  await assert.rejects(proposeMeetupDates(client, post, dates[0].endsAt, dates[0].startsAt, 'weekly', 4), /INVALID_SESSION_TIME/);
  await assert.rejects(proposeMeetupDates(client, post, dates[0].startsAt, dates[0].endsAt, 'daily', 4), /INVALID_RECURRENCE/);
  assert.equal(calls.length, 1);
  await confirmMeetupOccurrence({ rpc: async (...args) => { calls.push(args); return { data: post }; } }, post, dates[0]);
  assert.equal(calls[1][0], 'confirm_meetup_occurrence');
});

test('waitlist invitation and opting out never call request approval', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: args[0] === 'invite_next_meetup_waitlist' ? false : null }; } };
  await setMeetupWaitlist(client, post, false);
  assert.equal(await inviteNextMeetupWaitlist(client, post), false);
  assert.deepEqual(calls, [
    ['set_meetup_waitlist', { p_post_id: post, p_opt_in: false }],
    ['invite_next_meetup_waitlist', { p_post_id: post }],
  ]);
});

test('unknown creation and invitation responses cannot claim success', async () => {
  const client = { rpc: async () => ({ data: null, error: null }) };
  await assert.rejects(confirmMeetupOccurrence(client, post, { startsAt: '2030-01-01T18:00:00Z', endsAt: '2030-01-01T19:00:00Z' }), /SAVE_NOT_VERIFIED/);
  await assert.rejects(inviteNextMeetupWaitlist(client, post), /INVITATION_NOT_VERIFIED/);
});

test('unavailable aggregate metrics stay unknown and server denials propagate', async () => {
  assert.equal(await loadMeetupHostAggregates({ rpc: async () => ({ data: null }) }, post), null);
  await assert.rejects(loadMeetupTemplates({ rpc: async () => ({ error: { message: 'ACCOUNT_INACTIVE' } }) }), /ACCOUNT_INACTIVE/);
  await assert.rejects(respondMeetupCohost({ rpc: async () => ({ error: { message: 'PRO_REQUIRED' } }) }, post, true), /PRO_REQUIRED/);
});
