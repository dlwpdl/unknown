import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appPathForLink } from '../src/lib/app-links.ts';

const site = 'https://gling.ej-entertainment.com';
const id = 'B20B2F28-5902-461D-8FFC-FFEF3F23B2C0', lower = id.toLowerCase();

test('public site links open the matching app screen', () => {
  for (const [link, route] of [
    [`${site}/posts/${id}`, `/post/${lower}`],
    [`${site}/posts/${id}/`, `/post/${lower}`],
    [`${site}/post?id=${id}`, `/post/${lower}`],
    [`${site}/post?id=${id}&invite=1`, `/post/${lower}?invite=1`],
    [`${site}/company?id=${id}`, `/company/${lower}`],
    [`${site}/company/${id}`, `/company/${lower}`],
    [`${site}/company`, '/businesses'],
    [`${site}/company?id=nope`, '/businesses'],
    [`${site}/meetups?city=vancouver`, '/meetups'],
    [`${site}/invite?code=abcd-efgh`, '/invite?code=ABCDEFGH'],
    [`${site}/meetup-join?postId=${id}`, `/meetup-join?postId=${lower}`],
  ]) assert.equal(appPathForLink(link), route, link);
});

test('unknown or malformed site links land on home without throwing', () => {
  for (const link of [`${site}/`, `${site}/merchant/x`, `${site}/admin`, `${site}/terms`, `${site}/posts/not-a-uuid`, `${site}/post?id=${id}&id=${id}`,
    `${site}/invite?code=bad`, `${site}/meetup-join?postId=x`, `${site}/%E0%A4%A`]) assert.equal(appPathForLink(link), '/', link);
});

test('scheme links, other hosts and in-app paths pass through unchanged', () => {
  for (const link of ['gling://invite?code=ABCDEFGH', 'gling://auth/callback?code=x', 'https://example.com/posts/x', 'http://gling.ej-entertainment.com/posts/x',
    '/notifications', '/post/abc', 'com.googleusercontent.apps.x:/oauth']) assert.equal(appPathForLink(link), link, link);
});

test('association files claim only paths the app maps, for the release identities', () => {
  const aasa = JSON.parse(readFileSync(new URL('../public/.well-known/apple-app-site-association', import.meta.url), 'utf8'));
  const [detail] = aasa.applinks.details;
  assert.deepEqual(detail.appIDs, ['P3X3452TDZ.com.dlwpdl.gling']);
  for (const { '/': path } of detail.components) assert.ok(!/merchant|admin|business|terms|privacy/.test(path), path);
  const [link] = JSON.parse(readFileSync(new URL('../public/.well-known/assetlinks.json', import.meta.url), 'utf8'));
  assert.equal(link.target.package_name, 'com.dlwpdl.gling');
  for (const fingerprint of link.target.sha256_cert_fingerprints) assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  // iOS entitlement waits until Associated Domains is enabled on the App ID; a manual-signing build fails without it.
  if (app.ios.associatedDomains) assert.deepEqual(app.ios.associatedDomains, ['applinks:gling.ej-entertainment.com']);
  const filter = app.android.intentFilters.find(item => item.autoVerify);
  assert.ok(filter.data.every(entry => entry.scheme === 'https' && entry.host === 'gling.ej-entertainment.com'));
  // Native mapping must agree with the URLs both platforms claim.
  for (const entry of filter.data) {
    const sample = `${site}${entry.path ? `${entry.path}?id=${id}&code=ABCDEFGH&postId=${id}` : `${entry.pathPrefix}${id}`}`;
    assert.notEqual(appPathForLink(sample), '/', sample);
  }
});
