import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLanguagePreference, resolveLanguage } from '../src/i18n/language.ts';

test('content target follows supported device languages unless the user explicitly chooses one', () => {
  assert.equal(resolveLanguage('system', ['en-CA', 'ko-KR']), 'en');
  assert.equal(resolveLanguage('system', ['ko_KR', 'en-CA']), 'ko');
  assert.equal(resolveLanguage('system', ['fr-CA', 'en-CA']), 'en');
  assert.equal(resolveLanguage('system', ['fr-CA']), 'en');
  assert.equal(resolveLanguage('system', []), 'en');
  assert.equal(resolveLanguage('en', ['ko-KR']), 'en');
  assert.equal(resolveLanguage('ko', ['en-CA']), 'ko');
  assert.equal(parseLanguagePreference('obsolete'), 'system');
});
