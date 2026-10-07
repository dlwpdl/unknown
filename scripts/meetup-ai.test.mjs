import assert from 'node:assert/strict';
import test from 'node:test';

import { splitEventMeetupBody, visibleMeetupBody } from '../src/lib/meetup-ai.ts';

test('AI edits only the invitation while saved event details stay intact', () => {
  const details = '\n\n장소: Fortune Sound Club, Vancouver\n행사 ID: rZ7HnEZ1AfG3e7\n티켓·최신 일정: https://ticketmaster.evyy.net/example';
  const source = `함께 갈 분을 찾아요.${details}`;
  const parts = splitEventMeetupBody(source);
  assert.equal(parts.intro, '함께 갈 분을 찾아요.');
  assert.equal(parts.details, details);
  assert.equal(`새 소개예요.${parts.details}`, `새 소개예요.${details}`);
  assert.deepEqual(splitEventMeetupBody('일반 모임 소개'), { intro: '일반 모임 소개', details: '' });
});

test('event meetup descriptions hide saved references while keeping old and new links', () => {
  const intro = '페스티벌에 함께 가요.';
  const current = `${intro}\n\n행사 ID: G5vYZabc`;
  const legacy = `${intro}\n\n장소: Toronto\n출처: Ticketmaster\n행사 ID: G5vYZabc\n티켓·최신 일정: https://ticketmaster.ca/example`;
  assert.deepEqual(splitEventMeetupBody(current), { intro, details: '\n\n행사 ID: G5vYZabc' });
  assert.equal(visibleMeetupBody(current), intro);
  assert.equal(visibleMeetupBody(legacy), intro);
  assert.equal(visibleMeetupBody('일반 모임 소개'), '일반 모임 소개');
});
