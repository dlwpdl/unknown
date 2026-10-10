import assert from 'node:assert/strict';
import test from 'node:test';
import * as links from '../supabase/functions/_shared/post-links.ts';
import { postMapBody } from '../src/lib/post-maps.ts';

test('Instagram identity is derived only from an official profile URL', () => {
  assert.equal(typeof links.instagramPostLink, 'function');
  const profile = links.instagramPostLink('https://instagram.com/GLING_APP/?igsh=tracking#extra');
  assert.deepEqual(profile, { url: 'https://www.instagram.com/gling_app/', handle: 'gling_app' });
  for (const input of ['https://instagram.com.evil.ca/gling', 'https://instagram.com@evil.ca/gling',
    'http://instagram.com/gling', 'https://instagram.com/accounts/login', 'https://instagram.com/%61ccounts/',
    'https://instagram.com/p/abc', 'https://instagram.com/reel/abc', 'https://instagram.com/stories/gling/',
    'https://instagram.com/explore/', 'https://instagram.com/login/', 'https://instagram.com/gling..app/',
    'https://instagram.com/.gling/', 'https://instagram.com/gling./', 'https://instagram.com/' + 'x'.repeat(31),
    'https://instagram.com/gling/extra', 'https://instagrаm.com/gling', 'https://127.0.0.1/gling']) {
    assert.equal(links.instagramPostLink(input), null, input);
  }
});

test('Attachments round trip through existing body storage without changing prose', () => {
  assert.equal(typeof links.withPostAttachments, 'function');
  const body = '첫 문장\nhttps://example.com/an-inline-line\n\n마지막 문장';
  const stored = links.withPostAttachments(body, ['https://instagram.com/gling.app/?igsh=x', 'https://example.com/menu?a=1#lunch']);
  assert.deepEqual(links.splitPostAttachments(stored), {
    body, urls: ['https://www.instagram.com/gling.app/', 'https://example.com/menu?a=1#lunch'],
  });
  assert.equal(links.withPostAttachments(stored, []), body);
  assert.equal(links.withPostAttachments(stored, links.splitPostAttachments(stored).urls), stored);
  assert.deepEqual(links.splitPostAttachments(links.withPostAttachments('', ['https://instagram.com/gling.app/']).trim()),
    { body: '', urls: ['https://www.instagram.com/gling.app/'] });
});

test('Duplicate profiles normalize once and invalid destinations never enter attachments', () => {
  assert.equal(typeof links.withPostAttachments, 'function');
  const stored = links.withPostAttachments('내용', ['https://instagram.com/gling.app', 'https://www.instagram.com/gling.app/?igsh=x']);
  assert.equal(links.splitPostAttachments(stored).urls.length, 1);
  for (const input of ['javascript:alert(1)', 'http://example.com', 'https://bit.ly/x', 'https://example.com@evil.ca']) {
    assert.throws(() => links.withPostAttachments('내용', [input]), /INVALID_POST_LINK/);
  }
  const malformed = '내용\n\n첨부 링크\nhttps://instagram.com.evil.ca/gling\n이 문장은 사라지면 안 돼요.';
  assert.deepEqual(links.splitPostAttachments(malformed), { body: malformed, urls: [] });
});

test('Map and photo-credit footers stay outside attachments and retain their order', () => {
  assert.equal(typeof links.withPostAttachments, 'function');
  const footer = '\n\nGoogle 지도: https://www.google.com/maps/place/Shop\n\n사진 출처·이용 조건\n사진: https://unsplash.com/photos/test';
  const body = '내용' + footer;
  const stored = links.withPostAttachments(body, ['https://instagram.com/gling.app/']);
  assert.equal(links.splitPostAttachments(stored).body, body);
  assert.ok(stored.indexOf('첨부 링크') < stored.indexOf('Google 지도:'));
  assert.ok(stored.endsWith(footer));
  const attachedMap = links.withPostAttachments('내용', ['https://www.google.com/maps/place/OtherShop', 'https://instagram.com/gling.app/']);
  assert.deepEqual(postMapBody(attachedMap), { body: attachedMap, url: null });
});

test('Body checks distinguish blocked formats from unverified HTTPS without a fake safe verdict', () => {
  assert.equal(typeof links.postLinkChecks, 'function');
  const result = links.postLinkChecks('내용 https://example.com/menu.\nhttps://instagram.com.evil.ca/gling\nhttps://bit.ly/x');
  assert.deepEqual(result.map(item => item.verdict), ['unverified', 'blocked', 'blocked']);
  assert.equal(result[0].url, 'https://example.com/menu');
  assert.equal(links.postLinkChecks('본문만 있어요.').length, 0);
  assert.deepEqual(links.postLinkChecks('https://example.com https://example.com@evil.ca [가짜](https://example.com)').map(item => item.verdict),
    ['unverified', 'blocked', 'blocked']);
});

test('Public HTML uses the same compact profile, escaped text and exact destination', () => {
  assert.equal(typeof links.withPostAttachments, 'function');
  const html = links.postLinksHtml(links.withPostAttachments('<script>bad()</script>', ['https://instagram.com/gling.app', 'https://example.com/menu?a=1&b=2']));
  assert.ok(html.includes('post-instagram-link'));
  assert.ok(html.includes('@gling.app'));
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('href="https://www.instagram.com/gling.app/"'));
  assert.ok(html.includes('href="https://example.com/menu?a=1&amp;b=2"'));
  assert.ok(html.includes('악성 여부 미확인'));
  assert.ok(html.includes('<details class="post-link-confirm">'));
  const inline = links.postLinksHtml('내용 https://example.com/menu');
  assert.ok(inline.includes('<details class="post-link-confirm">'));
  assert.ok(inline.includes('악성 여부 미확인'));
  assert.ok(!html.includes('<script>bad'));
  assert.ok(!html.includes('첨부 링크'));
});
