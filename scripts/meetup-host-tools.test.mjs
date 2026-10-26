import assert from 'node:assert/strict';
import test from 'node:test';
import {
  templateDraft, applyMeetupTemplate, loadMeetupTemplates, saveMeetupTemplate, proposeMeetupDates,
  confirmMeetupOccurrence, setMeetupWaitlist, inviteNextMeetupWaitlist,
  loadMeetupHostAggregates, loadMeetupHostRoster, respondMeetupCohost, meetupFeeInput, meetupFeeAmount, meetupFeeDue,
  meetupFeeDueIso, meetupFeeDueOn, setMeetupFee, setMeetupFeePaid, loadMeetupFeePayments, loadMeetupFee,
} from '../src/lib/meetup-host-tools.ts';

const post = 'a1600000-0000-0000-0000-000000000001';

test('host management receives all v2 metadata and falls back only for an absent v2 RPC', async () => {
  for (const missing of [null, 'PGRST202', '42883']) {
    const calls = [], records = Array.from({ length: missing ? 50 : 5000 }, (_, n) => ({ userId: `member-${n}`, displayName: `Member ${n}`, photoPaths: [], isHost: n === 0 }));
    const client = { rpc: async (name, args) => {
      calls.push([name, args]);
      return missing && name.endsWith('_v2') ? { error: { code: missing, message: 'Function unavailable' } } : { data: records };
    } };
    assert.deepEqual(await loadMeetupHostRoster(client, post), records);
    assert.deepEqual(calls.map(call => call[0]), missing ? ['get_chilling_roster_v2', 'get_chilling_roster'] : ['get_chilling_roster_v2']);
    assert.ok(calls.every(call => call[1].p_post_id === post));
  }
  const calls = [];
  await assert.rejects(loadMeetupHostRoster({ rpc: async name => { calls.push(name); return { error: { code: '42501', message: 'Permission denied' } }; } }, post), /Permission denied/);
  assert.deepEqual(calls, ['get_chilling_roster_v2']);
});
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

test('meetup fee input mirrors the server bounds before any RPC', async () => {
  assert.deepEqual(meetupFeeInput(' 15,5 ', '  e-Transfer  ', '2031-11-01'), { amount: 15.5, note: 'e-Transfer', dueOn: '2031-11-01' });
  assert.deepEqual(meetupFeeInput('10000'), { amount: 10000 });
  assert.deepEqual(meetupFeeInput('0.29'), { amount: 0.29 });
  for (const bad of ['', '0', '0.00', '-1', '10000.01', '1.234', 'abc', '1e3']) assert.throws(() => meetupFeeInput(bad), /INVALID_MEETUP_FEE$/, bad);
  assert.throws(() => meetupFeeInput('5', '가'.repeat(201)), /INVALID_MEETUP_FEE_NOTE/);
  assert.equal(meetupFeeInput('5', '가'.repeat(200)).note.length, 200);
  const calls = [], client = { rpc: async (...args) => { calls.push(args); return { data: null }; } };
  await setMeetupFee(client, post, { amount: 15.5, note: '현금', dueOn: '2031-11-01' });
  await setMeetupFee(client, post, { amount: 20 });
  await setMeetupFee(client, post, null);
  await assert.rejects(setMeetupFee(client, post, { amount: 1.234 }), /INVALID_MEETUP_FEE/);
  assert.deepEqual(calls, [
    ['set_meetup_fee', { p_post_id: post, p_amount: 15.5, p_note: '현금', p_due_on: '2031-11-01' }],
    ['set_meetup_fee', { p_post_id: post, p_amount: 20, p_note: '', p_due_on: null }],
    ['set_meetup_fee', { p_post_id: post, p_amount: null }],
  ]);
});

test('fee payments send exact params, keep unknown reads empty and surface server errors', async () => {
  const calls = [], client = { rpc: async (...args) => { calls.push(args); return { data: null }; } };
  await setMeetupFeePaid(client, post, 'member', true);
  assert.deepEqual(await loadMeetupFeePayments(client, post), []);
  assert.deepEqual(calls, [['set_meetup_fee_paid', { p_post_id: post, p_user_id: 'member', p_paid: true }], ['get_meetup_fee_payments', { p_post_id: post }]]);
  for (const code of ['MEETUP_NOT_FOUND', 'REQUEST_NOT_FOUND']) await assert.rejects(setMeetupFeePaid({ rpc: async () => ({ error: { message: code } }) }, post, 'member', false), new RegExp(code));
  await assert.rejects(setMeetupFee({ rpc: async () => ({ error: { message: 'MEETUP_CLOSED' } }) }, post, { amount: 5 }), /MEETUP_CLOSED/);
  const rows = [{ user_id: 'member', paid_at: '2031-01-01T00:00:00Z' }];
  assert.deepEqual(await loadMeetupFeePayments({ rpc: async () => ({ data: rows }) }, post), rows);
});

test('the saved fee is read from the public meetup row and formatted in CAD', async () => {
  const query = fee => ({ from: table => ({ select: columns => ({ eq: (column, id) => ({ maybeSingle: async () => {
    assert.deepEqual([table, columns, column, id], ['posts', 'room_preview', 'id', post]); return { data: { room_preview: fee ? { fee } : {} } };
  } }) }) }) });
  assert.deepEqual(await loadMeetupFee(query({ amount: 15.5 }), post), { amount: 15.5 });
  assert.equal(await loadMeetupFee(query(null), post), null);
  assert.equal(meetupFeeAmount(15.5), '$15.50');
  assert.equal(meetupFeeAmount(10000), '$10000.00');
  assert.equal(meetupFeeDue('2031-11-01', 'ko-KR'), '11월 1일');
  assert.equal(meetupFeeDue('2031-11-01', 'en-CA'), 'November 1');
  assert.equal(meetupFeeDueOn(meetupFeeDueIso('2031-11-01')), '2031-11-01');
});
