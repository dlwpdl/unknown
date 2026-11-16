import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { englishNotificationBody } from '../src/lib/notification-preferences.ts';
import { cancelMeetupHostTransfer, hostTransferErrorText, hostTransferErrors, loadMeetupHostTransfer, offerMeetupHostTransfer, respondMeetupHostTransfer, transferDaysLeft } from '../src/lib/meetup-host-transfer.ts';

const postId = 'a1620000-0000-0000-0000-000000000001', userId = 'a1610000-0000-0000-0000-000000000002';
const client = (error) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); return error ? { data: null, error: { message: error } } : { data: null, error: null }; } }; };
const translate = (text) => text;

test('each action calls its own RPC with the arguments the server expects', async () => {
  const c = client();
  await offerMeetupHostTransfer(c, postId, userId);
  await cancelMeetupHostTransfer(c, postId);
  await loadMeetupHostTransfer(c, postId);
  await respondMeetupHostTransfer(c, postId, true, { consentVersion: 'chilling-v2', profileRevision: 'r1' });
  await respondMeetupHostTransfer(c, postId, false, { consentVersion: 'chilling-v2', profileRevision: 'r1' });
  assert.deepEqual(c.calls, [
    ['offer_meetup_host_transfer', { p_post_id: postId, p_user_id: userId }],
    ['cancel_meetup_host_transfer', { p_post_id: postId }],
    ['get_meetup_host_transfer', { p_post_id: postId }],
    ['respond_meetup_host_transfer', { p_post_id: postId, p_accept: true, p_consent_version: 'chilling-v2', p_profile_revision: 'r1' }],
    // A refusal never sends the receiver's profile consent.
    ['respond_meetup_host_transfer', { p_post_id: postId, p_accept: false, p_consent_version: null, p_profile_revision: null }],
  ]);
});

test('server errors surface as their code and map to a clear message', async () => {
  await assert.rejects(offerMeetupHostTransfer(client('TRANSFER_CAPACITY_EXCEEDED'), postId, userId), /TRANSFER_CAPACITY_EXCEEDED/);
  assert.equal(hostTransferErrorText(new Error('TRANSFER_CAPACITY_EXCEEDED')), hostTransferErrors.TRANSFER_CAPACITY_EXCEEDED);
  assert.equal(hostTransferErrorText(new Error('P0001: TRANSFER_NOT_FOUND')), hostTransferErrors.TRANSFER_NOT_FOUND);
  assert.equal(hostTransferErrorText(new Error('something else')), null);
  assert.equal(hostTransferErrorText('not an error'), null);
});

test('days left rounds up and never goes negative', () => {
  const now = Date.parse('2030-01-01T12:00:00Z');
  assert.equal(transferDaysLeft('2030-01-08T12:00:00Z', now), 7);
  assert.equal(transferDaysLeft('2030-01-01T18:00:00Z', now), 1);
  assert.equal(transferDaysLeft('2029-12-31T00:00:00Z', now), 0);
  assert.equal(transferDaysLeft('not a date', now), 0);
});

test('the four server notices read naturally in English', () => {
  const en = (body) => englishNotificationBody({ kind: 'meetup_changed', body }, translate);
  assert.equal(en('민지님이 「주말 산책」 모임의 호스트를 넘기고 싶어 해요. 수락하면 이 모임을 이어서 맡아요.'), '민지 wants to hand over hosting of “주말 산책”. Accept to take the meetup over.');
  assert.equal(en('수아님이 「주말 산책」 호스트를 맡지 않기로 했어요. 모임은 그대로 열려 있어요.'), '수아 chose not to take over hosting “주말 산책”. The meetup stays open.');
  assert.equal(en('수아님이 「주말 산책」 호스트를 이어받았어요. 이제 멤버로 함께해요.'), '수아 took over hosting “주말 산책”. You’re a member now.');
  assert.equal(en('「주말 산책」 모임의 호스트가 수아님으로 바뀌었어요. 일정과 장소는 그대로예요.'), 'The host of “주말 산책” is now 수아. The time and place haven’t changed.');
});

test('the migration keeps its safety contract', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261116130000_meetup_host_transfer.sql', import.meta.url), 'utf8');
  for (const fn of ['offer_meetup_host_transfer', 'cancel_meetup_host_transfer', 'respond_meetup_host_transfer', 'get_meetup_host_transfer']) {
    assert.match(sql, new RegExp(`function public\\.${fn}\\([^)]*\\)[^$]*security definer set search_path=''`), fn);
  }
  assert.match(sql, /create unique index meetup_host_transfers_one_pending[^;]*where status='pending'/);
  assert.match(sql, /revoke all on private\.meetup_host_transfers from public,anon,authenticated,service_role/);
});
