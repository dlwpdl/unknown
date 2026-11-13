import assert from 'node:assert/strict';
import test from 'node:test';
import { toQR } from 'toqr';
import { payoutBlockers, questCheckCandidates } from '../src/lib/admin-host-quests.ts';
import { parseCheckInLink } from '../src/lib/app-links.ts';
import { inviteDollars, normalizeQuestCode, qrRuns, questError, questPhotoPath } from '../src/lib/host-quests.ts';

const session = 'ac200000-0000-4000-8000-000000000001', code = 'a1b2c3d4e5f6a1b2c3d4e5f6';

test('quest codes accept spaces and dashes, never look-alike letters', () => {
  assert.equal(normalizeQuestCode(' gl7k-2m9q '), 'GL7K2M9Q');
  for (const bad of ['GL7K2M9', 'GL7K2M9QX', 'GL7K2M0Q', 'GL7K2MIQ', '', null]) assert.equal(normalizeQuestCode(bad), null);
});

test('invitees pay nothing until 3, then a dollar each up to 10', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10, 12].map(inviteDollars), [0, 0, 0, 3, 4, 10, 10]);
});

test('check-in links need a session id and a 24-hex one-time code', () => {
  assert.deepEqual(parseCheckInLink({ s: session.toUpperCase(), c: code }), { sessionId: session, code });
  for (const params of [{ s: session }, { s: 'x', c: code }, { s: session, c: code.slice(1) }, { s: [session], c: code }]) assert.equal(parseCheckInLink(params), null);
});

test('server error codes are found inside the Supabase message', () => {
  assert.equal(questError(new Error('QR_EXPIRED'), ['QR_EXPIRED', 'CHECK_IN_CLOSED']), 'QR_EXPIRED');
  assert.equal(questError({ message: 'P0001: QUEST_PAUSED' }, ['QUEST_PAUSED']), 'QUEST_PAUSED');
  assert.equal(questError(new Error('network down'), ['QR_EXPIRED']), null);
});

test('QR runs redraw exactly the encoder modules', () => {
  const url = `https://gling.ej-entertainment.com/checkin?s=${session}&c=${code}`;
  const { size, rows } = qrRuns(url);
  const cells = toQR(Uint8Array.from(url, char => char.charCodeAt(0)));
  assert.equal(size * size, cells.length);
  const drawn = new Uint8Array(cells.length);
  rows.forEach((row, y) => row.forEach(([x, width]) => { for (let i = 0; i < width; i++) drawn[y * size + x + i] = 1; }));
  assert.deepEqual([...drawn], [...cells].map(cell => cell ? 1 : 0));
  // Finder pattern: the top-left 7x7 has a dark border.
  assert.deepEqual(rows[0][0], [0, 7]);
});

test('photo paths match the storage policy shape', () => {
  assert.match(questPhotoPath(session, session, session), /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/);
});

test('the payout waits until the photo shows everyone counted plus the host', () => {
  const quest = { status: 'active', totals: { confirmed: 5000 }, code: { recipientName: 'Kim' }, checks: [{ answer: 'yes' }, { answer: 'yes' }],
    payout: { status: 'requested', email: 'a@b.c', legalName: 'Kim', photoPeople: 3, photoNeeded: 4, nameMatches: true } };
  assert.deepEqual(payoutBlockers(quest, true, 'A1B2'), ['사진 속 사람이 센 사람보다 적어요']);
  assert.deepEqual(payoutBlockers({ ...quest, payout: { ...quest.payout, photoPeople: 4 } }, true, 'A1B2'), []);
});

test('attendees to ask come least suspicious first', () => {
  const person = (id, joinedAt, otherHostMeetups) => ({ id, nickname: id, reason: null, qr: true, confirmed: true, joinedAt, otherHostMeetups, otherQuestHosts: 0 });
  const quest = { startedAt: '2026-10-01T00:00:00+00:00', steps: [{ step: 2, status: 'confirmed', personIds: ['new', 'old', 'busy'] }],
    sessions: [{ people: [person('new', '2026-10-05T00:00:00+00:00', 9), person('old', '2025-01-01T00:00:00+00:00', 0), person('busy', '2025-06-01T00:00:00+00:00', 4)] }] };
  const list = questCheckCandidates(quest);
  assert.deepEqual(list.map(item => item.id), ['busy', 'old', 'new']);
  assert.equal(list.at(-1).joinedAfterStart, true);
});
