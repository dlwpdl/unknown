import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_COPY, eventDate, eventHandle, eventTime, reelChoices } from '../src/components/public-web/event-copy.ts';

const { en, ko } = EVENT_COPY;

test('the follow notice is the approved text word for word', () => {
  assert.equal(en.done.join(' '), "Got your entry! We'll check on draw day that you're following @gling.app. If you're not, your entry won't count.");
  assert.equal(ko.done.join(' '), '신청받았어요! 추첨하는 날 @gling.app 팔로우를 한 번 확인해요. 그날 팔로우가 안 되어 있으면 추첨에서 빠져요.');
});

// Values from the reviewed galbi copy.json (2026-11-02): the frames must reproduce them from campaign data.
test('campaign values fill the reviewed sentences exactly', () => {
  assert.equal(en.host('(restaurant account)'), 'Hosted by @gling.app with (restaurant account)');
  assert.equal(ko.host('(가게 계정)'), '주최 @gling.app · (가게 계정)');
  assert.deepEqual(['meal', 'drinks', 'alcohol', 'parking', 'fee'].map(key => en.cover[key](2)), ['Meal for 2', 'Soft drinks', 'Alcohol', 'Parking', 'Creator fee']);
  assert.deepEqual(['meal', 'drinks', 'alcohol', 'parking', 'fee'].map(key => ko.cover[key](2)), ['식사 (2인)', '음료', '주류', '주차', '원고료']);
  assert.equal(en.do(7), 'Within 7 days of your visit, post one Reel tagging @gling.app and the restaurant');
  assert.equal(ko.do(7), '다녀온 뒤 7일 안에 @gling.app과 가게를 태그해서 릴스 1개 올리기');
  assert.equal(en.l_reel(7), 'How soon after your visit can you post the Reel? (7 days max)');
  assert.equal(ko.l_reel(7), '다녀와서 며칠 안에 릴스를 올릴 수 있어요? (최대 7일)');
  assert.deepEqual([3, 5, 7].map(en.reel), ['Within 3 days', 'Within 5 days', 'Within 7 days']);
  assert.deepEqual([3, 5, 7].map(ko.reel), ['3일 안', '5일 안', '7일 안']);
  assert.equal(en.party_max(2), 'Up to 2');
  assert.equal(ko.party_max(2), '최대 2명');
  assert.deepEqual(['2026-11-23', '2026-12-01'].map(day => eventDate(day, 'en')), ['Mon, Nov 23', 'Tue, Dec 1']);
  assert.deepEqual(['2026-11-23', '2026-12-01'].map(day => eventDate(day, 'ko')), ['11월 23일 (월)', '12월 1일 (화)']);
  assert.deepEqual(['12:00', '13:00', '17:30', '19:00'].map(time => eventTime(time, 'en')), ['12:00 pm', '1:00 pm', '5:30 pm', '7:00 pm']);
  assert.deepEqual(['12:00', '13:00', '17:30', '19:00'].map(time => eventTime(time, 'ko')), ['낮 12시', '낮 1시', '저녁 5시 30분', '저녁 7시']);
});

test('every key of one language exists in the other', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
});

test('Reel choices are 3, 5 and 7 days up to the campaign limit of at most 7', () => {
  assert.deepEqual([7, 6, 5, 4, 3, 2, 1].map(reelChoices), [[3, 5, 7], [3, 5], [3, 5], [3], [3], [1, 2], [1]]);
});

test('handles follow the database rule', () => {
  assert.equal(eventHandle(' @Gling.Tester '), 'gling.tester');
  for (const bad of ['', '@', 'bad handle', '.dot', 'dot.', 'two..dots', '<script>', 'a'.repeat(31)]) assert.equal(eventHandle(bad), null, bad);
});
