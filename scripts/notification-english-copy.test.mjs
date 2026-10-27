import assert from 'node:assert/strict';
import test from 'node:test';
import { englishNotificationBody, notificationRoute } from '../src/lib/notification-preferences.ts';

const cities = { 밴쿠버: 'Vancouver' };
const translate = (text, ...values) => (cities[text] ?? text).replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)]));
const en = (kind, body, actor) => englishNotificationBody({ kind, body }, translate, actor);

test('server notification bodies with embedded values render natural English', () => {
  assert.equal(en('comment', '민지님이 내 글에 댓글을 남겼어요.'), '민지 commented on your post.');
  assert.equal(en('reply', 'Sam님이 내 댓글에 답글을 남겼어요.'), 'Sam replied to your comment.');
  assert.equal(en('comment_like', '민지님이 내 댓글에 공감했어요.'), '민지 liked your comment.');
  assert.equal(en('post_like', '민지님이 내 글에 공감했어요.'), '민지 liked your post.');
  assert.equal(en('message_reaction', '보낸 메시지에 하트를 눌렀어요', 'Sam'), 'Sam loved your message.');
  assert.equal(en('meetup_reminder', '주말 등산 모임 모임이 24시간 뒤에 시작해요. (10/26 19:30 · 모임 장소 기준)'), '“주말 등산 모임” starts in 24 hours (Oct 26, 7:30 p.m., local time).');
  assert.equal(en('meetup_reminder', 'Board games 모임이 1시간 뒤에 시작해요.'), '“Board games” starts in an hour.');
  assert.equal(en('meetup_morning', 'Board games 모임은 오늘 09:05에 시작해요. (모임 장소 기준)'), '“Board games” starts today at 9:05 a.m. local time.');
  assert.equal(en('meetup_cancelled', 'Board games 모임이 마감되거나 취소됐어요. 모임 글에서 확인해 주세요.'), '“Board games” was closed or cancelled. Check the meetup post for details.');
  assert.equal(en('meetup_changed', 'Board games 모임의 시간이나 장소가 바뀌었어요. 바뀐 내용을 확인해 주세요.'), 'The time or place for “Board games” changed. Check the updated details.');
  assert.equal(en('trending_post', '오늘 밴쿠버 소식, 같이 읽어볼까요? 키츠 비치 노을 명소'), 'Today in Vancouver: 키츠 비치 노을 명소');
  assert.equal(en('trending_hashtag', '요즘 관심이 모이는 주제예요. #밴쿠버맛집'), 'Trending near you: #밴쿠버맛집');
  assert.equal(en('admin_signup', '민지님이 밴쿠버에 새로 가입했어요.'), '민지 just joined in Vancouver.');
  assert.equal(en('admin_multiacct', '같은 IP로 4개 계정이 접속했어요. 관리자 화면에서 확인해 주세요.'), '4 accounts signed in from the same IP. Check the admin dashboard.');
});

test('every festival body variant renders, and unknown descriptions fall back', () => {
  for (const kind of ['trending_post', 'city_places']) {
    assert.equal(en(kind, '10월 25일, Rogers Arena에서 아이스하키 경기가 열려요.'), 'There’s a hockey game at Rogers Arena on Oct 25.');
    assert.equal(en(kind, 'Rogers Arena에서 10월 25일에 아이스하키 경기가 열려요.'), 'There’s a hockey game at Rogers Arena on Oct 25.');
    assert.equal(en(kind, '10월 25일, Commodore Ballroom에서 록 공연이 열릴 예정이에요.'), 'There’s a rock concert at Commodore Ballroom on Oct 25.');
    assert.equal(en(kind, 'Commodore Ballroom에서 10월 5일에 공연이 열릴 예정이에요.'), 'There’s a show at Commodore Ballroom on Oct 5.');
    assert.equal(en(kind, '10월 31일, 밴쿠버에서 할로윈 행사가 열려요.'), 'There’s a Halloween event in Vancouver on Oct 31.');
    assert.equal(en(kind, '10월 31일, 행사가 열려요.'), 'There’s an event on Oct 31.');
    assert.equal(en(kind, '행사가 열려요.'), 'There’s an event coming up.');
    assert.equal(en(kind, '두 그룹의 공연과 잼 세션이 열려요.'), '두 그룹의 공연과 잼 세션이 열려요.');
  }
});

test('patterns apply only to their own kind, and unmatched copy falls back to tr(body)', () => {
  assert.equal(en('trending_post', '민지님이 내 글에 공감했어요.'), '민지님이 내 글에 공감했어요.', 'a post title is content, not chrome');
  assert.equal(en('message_reaction', '보낸 메시지에 하트를 눌렀어요'), '보낸 메시지에 하트를 눌렀어요');
  assert.equal(en('comment', '새 문구'), '새 문구');
  assert.equal(en('unknown_kind', '메시지가 도착했어요.'), '메시지가 도착했어요.');
});

test('hashtag routing reads the stored Korean body, not the English display text', () => {
  const item = { kind: 'trending_hashtag', body: '요즘 관심이 모이는 주제예요. #밴쿠버' };
  assert.equal(notificationRoute('/notifications', item), '/?hashtag=' + encodeURIComponent('밴쿠버'));
  assert.equal(en(item.kind, item.body), 'Trending near you: #밴쿠버');
});

test('overhaul kinds render English, and the shared module works without a translator', async () => {
  const { englishNotificationBody: shared } = await import('../src/lib/notification-copy.ts');
  assert.equal(shared, englishNotificationBody, 'notification-preferences re-exports the shared copy');
  assert.equal(en('like_summary', '민지님 외 3명이 내 글을 좋아해요.'), '민지 and 3 others liked your post.');
  assert.equal(en('like_summary', '민지님 외 1명이 내 댓글을 좋아해요.'), '민지 and 1 other liked your comment.');
  assert.equal(en('like_summary', '민지님이 내 글을 좋아해요.'), '민지 liked your post.');
  assert.equal(en('message_reaction', '민지님이 내 메시지에 공감했어요.'), '민지 loved your message.');
  assert.equal(en('message', 'Sam: 사진을 보냈어요.'), 'Sam: Sent a photo.');
  assert.equal(en('admin_digest', '새로 가입한 사람 3명, 운영 모임 참여 신청 1건이 있어요.'), '3 new members and 1 request to join Gling-run meetups.');
  assert.equal(shared({ kind: 'post_like', body: '민지님이 내 글에 공감했어요.' }), '민지 liked your post.');
  assert.equal(shared({ kind: 'unknown', body: '그대로' }), '그대로');
});
