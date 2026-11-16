import assert from 'node:assert/strict';
import test from 'node:test';

import { uiEnglish } from '../src/i18n/ui-en.ts';
import { MEETUP_TITLE_MAX } from '../src/lib/meetup-convenience.ts';
import { infoCellsTail, splitMeetupInfoCells } from '../src/lib/meetup-info-cells.ts';
import { quickEnd, quickIntro, quickStart } from '../src/lib/meetup-quick.ts';
import { MEETUP_TOPICS, isUntouched, topicCells } from '../src/lib/meetup-topics.ts';
import { meetupInfoCells, visibleMeetupBody } from './test-meetup-source-imports.mjs';

test('정보 칸은 소개 끝에 붙고 그대로 다시 읽힌다', () => {
  const tail = infoCellsTail([{ label: '수준', value: '누구나' }, { label: '준비물', value: '  ' }, { label: '1인 비용', value: '없어요' }]);
  assert.equal(tail, '\n\n모임 정보\n수준: 누구나\n1인 비용: 없어요');
  assert.deepEqual(splitMeetupInfoCells(`같이 뛰어요.${tail}`), { body: '같이 뛰어요.', cells: [{ label: '수준', value: '누구나' }, { label: '1인 비용', value: '없어요' }] });
  assert.equal(infoCellsTail([{ label: '수준', value: '' }]), '');
});

test('정보 칸 모양이 아닌 글은 소개 그대로 둔다', () => {
  for (const text of ['모임 정보\n수준: 누구나', '소개\n\n모임 정보\n그냥 문장이에요', '소개\n\n모임 정보\n수준: 누구나\n준비물\n\n뒤에 글']) assert.deepEqual(splitMeetupInfoCells(text), { body: text, cells: [] });
});

test('정보 칸은 화면용 소개에서 빠지고, 글 수정 때는 그대로 남는다', () => {
  const tail = infoCellsTail([{ label: '수준', value: '처음' }]), body = `소개예요.${tail}`;
  assert.equal(visibleMeetupBody(body), '소개예요.');
  assert.equal(visibleMeetupBody(body, true), body);
  assert.deepEqual(meetupInfoCells(body), [{ label: '수준', value: '처음' }]);
  assert.deepEqual(meetupInfoCells('칸 없는 소개'), []);
});

test('주제 틀은 제목 길이 안이고 영어 문구가 모두 있다', () => {
  assert.equal(MEETUP_TOPICS.length, 7);
  for (const topic of MEETUP_TOPICS) {
    assert.equal(topic.cells.length, 3, topic.id);
    assert.ok(topic.title.length <= MEETUP_TITLE_MAX, topic.title);
    const texts = [topic.label, topic.title, topic.intro, ...topic.cells.flatMap(cell => [cell.label, cell.hint, ...(cell.options ?? [])])].filter(Boolean);
    for (const text of texts) assert.ok(uiEnglish[text], `영어 문구 없음: ${text}`);
    assert.ok(uiEnglish[topic.title].length <= MEETUP_TITLE_MAX, uiEnglish[topic.title]);
    assert.equal(topicCells(topic).length, 3);
  }
});

test('카테고리는 딱 맞는 주제에만 정한다', () => {
  assert.deepEqual(Object.fromEntries(MEETUP_TOPICS.map(topic => [topic.id, topic.category])), { sports: 'sports', food: null, show: 'festival', trip: 'travel', study: null, hobby: 'hobby', new: null });
});

test('틀은 비었거나 틀 그대로인 칸에만 들어간다', () => {
  assert.ok(isUntouched('', '') && isUntouched('  ', 'x') && isUntouched('틀 글', '틀 글'));
  assert.ok(!isUntouched('내가 쓴 글', '틀 글'));
});

test('번개 기본값은 내일 저녁 7시, 2시간이고 지난 시각은 고르지 못한다', () => {
  const zone = 'America/Vancouver', now = Date.parse('2026-11-17T03:30:00Z');
  assert.equal(quickStart('tomorrow', zone, now), '2026-11-18T02:00:00.000Z');
  assert.equal(quickStart('tonight', zone, now), null);
  assert.equal(quickStart('tonight', zone, Date.parse('2026-11-16T18:00:00Z')), '2026-11-17T02:00:00.000Z');
  assert.equal(quickStart('weekend', zone, now), '2026-11-21T21:00:00.000Z');
  assert.equal(quickEnd('2026-11-18T02:00:00.000Z'), '2026-11-18T04:00:00.000Z');
});

test('번개 소개는 제목과 시간으로 한 줄을 만든다', () => {
  const start = '2026-11-18T02:00:00.000Z';
  assert.equal(quickIntro('퇴근하고 노을 보러 갈래요?', 'tomorrow', start, 'America/Vancouver', 'ko'), '퇴근하고 노을 보러 갈래요? 내일 저녁 7시에 만나요. 같이 하실 분은 신청해 주세요.');
  assert.equal(quickIntro('', 'tonight', start, 'America/Vancouver', 'ko'), '오늘 저녁 7시에 만나요. 같이 하실 분은 신청해 주세요.');
  assert.match(quickIntro('산책', 'pick', start, 'America/Vancouver', 'ko'), /^산책\. 11월 17일 \(?화\)? (오후|PM) 7:00에 만나요\./);
});

test('정보 칸 뒤에 확정된 장소 줄이 붙어도 칸을 읽고 장소 줄은 소개에 남긴다', () => {
  const plain = '같이 걸어요.\n\n모임 정보\n수준: 초급\n\n장소: 강가 공원';
  assert.deepEqual(splitMeetupInfoCells(plain), { body: '같이 걸어요.\n\n장소: 강가 공원', cells: [{ label: '수준', value: '초급' }] });
  const osm = '같이 걸어요.\n\n모임 정보\n수준: 초급\n준비물: 물\n\n장소: 강가 공원\n장소 정보: https://www.openstreetmap.org/node/123';
  assert.deepEqual(splitMeetupInfoCells(osm), { body: '같이 걸어요.\n\n장소: 강가 공원\n장소 정보: https://www.openstreetmap.org/node/123', cells: [{ label: '수준', value: '초급' }, { label: '준비물', value: '물' }] });
  assert.deepEqual(meetupInfoCells(plain), [{ label: '수준', value: '초급' }]);
  assert.equal(visibleMeetupBody(plain), '같이 걸어요.\n\n장소: 강가 공원');
});
