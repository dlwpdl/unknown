import assert from 'node:assert/strict';
import test from 'node:test';
import { postInfoParts, postLinkLabel } from '../src/lib/post-info.ts';

test('맛집 글 끝의 📍 주소와 인스타 링크는 정보 카드로, 나머지는 문단으로 나뉜다', () => {
  const body = '가을을 통째로 먹고 온 기분이에요.\n첫 챕터는 작은 요리 다섯 가지예요.\n📍 847 Denman St, Vancouver\n같이 갈 사람은 글링에서 찾아보세요.\n\nhttps://www.instagram.com/handsonyvr/';
  assert.deepEqual(postInfoParts(body), {
    paragraphs: ['가을을 통째로 먹고 온 기분이에요.', '첫 챕터는 작은 요리 다섯 가지예요.', '같이 갈 사람은 글링에서 찾아보세요.'],
    place: '847 Denman St, Vancouver',
    links: ['https://www.instagram.com/handsonyvr/'],
    credits: [],
  });
});

test('출처 줄은 접힌 출처로 빠지고 문장 속 주소와 URL은 본문에 남는다', () => {
  const body = '주소는 860 Richards Street예요. 자세한 건 https://kafkascoffee.ca 에서 보세요.\n\n공간·사진 출처: https://dialogdesign.ca/news-events/kafkas/\n참고 릴스: https://www.instagram.com/reel/DQ4lEx9j3t8/\n사진: Cody Briggs / DIALOG';
  const parts = postInfoParts(body);
  assert.deepEqual(parts.paragraphs, ['주소는 860 Richards Street예요. 자세한 건 https://kafkascoffee.ca 에서 보세요.']);
  assert.equal(parts.credits.length, 3);
  assert.equal(parts.place, null);
});

test('안전하지 않은 링크는 본문에 그대로 두고 같은 링크는 한 번만 보인다', () => {
  const parts = postInfoParts('http://example.com\nhttps://bit.ly/x\nhttps://instagram.com/handsonyvr\nhttps://www.instagram.com/handsonyvr/');
  assert.deepEqual(parts.paragraphs, ['http://example.com', 'https://bit.ly/x']);
  assert.deepEqual(parts.links, ['https://www.instagram.com/handsonyvr/']);
});

test('링크 이름은 짧게 보인다', () => {
  assert.equal(postLinkLabel('https://www.instagram.com/handsonyvr/'), '@handsonyvr');
  assert.equal(postLinkLabel('https://www.handsonyvr.com/menu/fall'), 'handsonyvr.com/menu');
  assert.equal(postLinkLabel('https://www.instagram.com/reel/DQ4lEx9j3t8/'), 'instagram.com/reel');
});
