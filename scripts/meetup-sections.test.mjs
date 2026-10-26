import assert from 'node:assert/strict';
import test from 'node:test';
import { joinMeetupSections, parseMeetupSections } from '../src/lib/meetup-sections.ts';

const body = '심심한데 같이 걸어요.\n\n모임 목적\n가볍게 대화할 동행 찾기\n\n함께할 활동\n1. 인사\n2. 트레킹\n\n이런 분과 맞아요\n처음이어도 괜찮은 분\n\n준비할 것\n• 운동화\n• 물';

test('글 속 제목을 섹션으로 나누고 같은 글로 되돌린다', () => {
  const sections = parseMeetupSections(body);
  assert.deepEqual(sections, { language: 'ko', intro: '심심한데 같이 걸어요.', purpose: '가볍게 대화할 동행 찾기', activities: ['인사', '트레킹'], fit: '처음이어도 괜찮은 분', preparation: ['운동화', '물'] });
  assert.equal(joinMeetupSections(sections), body);
});

test('빈 항목은 빼고 저장하며 영어 제목도 읽는다', () => {
  const sections = parseMeetupSections('Hi.\n\nPurpose\nWalk\n\nActivities\n1. Meet');
  assert.equal(sections.language, 'en');
  assert.equal(joinMeetupSections({ ...sections, activities: ['Meet', ' ', 'Walk'], purpose: '' }), 'Hi.\n\nActivities\n1. Meet\n2. Walk');
});

test('제목이 하나뿐이거나 순서가 다르면 글 그대로 둔다', () => {
  assert.equal(parseMeetupSections('그냥 글이에요.\n준비할 것\n없음'), null);
  assert.equal(parseMeetupSections('함께할 활동\n1. 산책\n모임 목적\n친구'), null);
});
