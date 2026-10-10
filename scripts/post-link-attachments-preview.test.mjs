import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../output/design/gling-link-attachments-2026-10-09.html', import.meta.url), 'utf8');
const model = { URL };
vm.createContext(model);
for (const id of ['url-policy', 'link-model']) {
  const script = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(script, `${id} is embedded for file-path previews`);
  vm.runInContext(script[1], model);
}

test('Instagram profile identity and destination come from the same official URL', () => {
  const result = model.instagramAttachment('https://www.instagram.com/gling.app/?igsh=tracking#extra');
  assert.equal(result.url, 'https://www.instagram.com/gling.app/');
  assert.equal(result.label, '@gling.app');
  assert.equal(result.host, 'instagram.com');
  assert.equal(result.kind, 'instagram');
  assert.equal(model.instagramAttachment('https://instagram.com/GLING_APP').label, '@gling_app');
});

test('Fake hosts, login/redirect routes, posts and invalid handles never become profile cards', () => {
  for (const url of [
    'https://instagram.com.evil.ca/gling.app', 'https://instagram.com@evil.ca/gling.app',
    'https://instagrаm.com/gling.app', 'https://xn--instagrm-7kb.com/gling.app',
    'http://instagram.com/gling.app', 'https://l.instagram.com/?u=https://evil.ca',
    'https://www.instagram.com/accounts/login', 'https://www.instagram.com/%61ccounts/',
    'https://instagram.com/p/abc', 'https://instagram.com/reel/abc',
    'https://instagram.com/stories/gling.app/', 'https://instagram.com/explore/',
    'https://instagram.com/login/', 'https://instagram.com/gling..app/',
    'https://instagram.com/.gling/', 'https://instagram.com/gling./',
    'https://instagram.com/' + 'x'.repeat(31), 'https://instagram.com/gling.app/extra',
    'javascript:alert(1)', 'https://127.0.0.1/gling.app',
  ]) assert.equal(model.instagramAttachment(url), null, url);
});

test('Website format checks never claim a malware database clearance', () => {
  const result = model.websiteAttachment('https://example.com/menu?a=1#lunch');
  assert.equal(result.url, 'https://example.com/menu?a=1#lunch');
  assert.equal(result.verdict, 'unverified');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'https://bit.ly/x', 'https://localhost', 'https://example.com:8443/']) {
    assert.equal(model.websiteAttachment(url), null, url);
  }
});

test('Body checks retain invalid URLs as blocked and ordinary HTTPS as unverified', () => {
  const results = model.bodyLinkChecks('내용 https://example.com/menu.\nhttps://instagram.com.evil.ca/name\nhttps://bit.ly/x');
  assert.equal(results.length, 3);
  assert.equal(results[0].url, 'https://example.com/menu');
  assert.equal(results[0].verdict, 'unverified');
  assert.equal(results[1].verdict, 'blocked');
  assert.equal(results[2].verdict, 'blocked');
  assert.equal(model.bodyLinkChecks('일반 본문').length, 0);
});
