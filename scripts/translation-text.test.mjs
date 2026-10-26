import assert from 'node:assert/strict';
import test from 'node:test';
import { protectTranslationSource, restoreTranslationSource } from '../supabase/functions/_shared/translation-text.ts';

test('links, emails, mentions and hashtags are hidden from the model and restored exactly', () => {
  const original = { title: '모임 3명', body: '@sam 연락 a@b.co\nhttps://x.com/a?q=1 #Toronto CA$25' };
  const protectedSource = protectTranslationSource(original);
  const sent = JSON.stringify(protectedSource.source);
  for (const value of ['@sam', 'a@b.co', 'https://', '#Toronto']) assert.equal(sent.includes(value), false, value);
  assert.ok(sent.includes('3명') && sent.includes('CA$25'), 'numbers stay visible so grammar can follow them');
  const [mention, email, url, tag] = protectedSource.values.map((_, i) => '⟦' + protectedSource.prefix + i + '⟧');
  const output = { title: 'Meetup for 3', body: `${mention} reach me at ${email}\n${url} ${tag} CA$25` };
  assert.deepEqual(restoreTranslationSource(output, protectedSource), { title: 'Meetup for 3', body: '@sam reach me at a@b.co\nhttps://x.com/a?q=1 #Toronto CA$25' });
});

test('dropped tokens or injected links are rejected', () => {
  const protectedSource = protectTranslationSource({ title: null, body: '여기 https://x.com 봐요' });
  assert.throws(() => restoreTranslationSource({ title: null, body: 'Look here' }, protectedSource), /INVALID_TRANSLATION/);
  const token = '⟦' + protectedSource.prefix + '0⟧';
  assert.throws(() => restoreTranslationSource({ title: null, body: `Look ${token} https://evil.example` }, protectedSource), /INVALID_TRANSLATION/);
  assert.throws(() => restoreTranslationSource({ title: 'Added', body: `Look ${token}` }, protectedSource), /INVALID_TRANSLATION/);
});
