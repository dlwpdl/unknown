import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('app language follows device preferences and supports an independent saved override', async (context) => {
  const path = new URL('../src/i18n/language.ts', import.meta.url);
  assert.ok(existsSync(path), 'App language selection has not been implemented');
  const { resolveLanguage, parseLanguagePreference } = await import(path.href);
  await context.test('device defaults and unsupported languages', () => {
    assert.equal(resolveLanguage('system', ['ko-KR']), 'ko');
    assert.equal(resolveLanguage('system', ['en-CA']), 'en');
    assert.equal(resolveLanguage('system', ['fr-CA']), 'en');
    assert.equal(resolveLanguage('system', ['ja-JP', 'ko_KR']), 'ko');
    assert.equal(resolveLanguage('system', []), 'en');
  });
  await context.test('manual override wins and returning to system works', () => {
    assert.equal(resolveLanguage('ko', ['en-CA']), 'ko');
    assert.equal(resolveLanguage('en', ['ko-KR']), 'en');
    assert.equal(resolveLanguage('system', ['ko-KR']), 'ko');
  });
  await context.test('stored values are validated without reading any account data', () => {
    for (const value of ['system', 'ko', 'en']) assert.equal(parseLanguagePreference(value), value);
    for (const value of [null, '', 'fr', 'en-US', '{}']) assert.equal(parseLanguagePreference(value), 'system');
  });
});


test('English covers the shared dictionary and language changes preserve user text', async () => {
  const { t: ko } = await import('../src/i18n/ko.ts');
  const { en } = await import('../src/i18n/en.ts');
  function keys(value, path = '') {
    return Object.entries(value).flatMap(([key, item]) => typeof item === 'object' && item !== null
      ? keys(item, path + key + '.') : [path + key]);
  }
  assert.deepEqual(keys(en).sort(), keys(ko).sort());
  const { uiEnglish } = await import('../src/i18n/ui-en.ts');
  const placeholders = text => [...new Set([...text.matchAll(/\{\d+\}/g)].map(match => match[0]))].sort();
  for (const [original, translated] of Object.entries(uiEnglish)) {
    assert.deepEqual(placeholders(translated), placeholders(original), original);
  }
  const bridge = new URL('../src/i18n/index.ts', import.meta.url);
  assert.ok(existsSync(bridge), 'Reactive language bridge is missing');
  const { t, setActiveLanguage, tr } = await import(bridge.href);
  try {
    setActiveLanguage('en');
    assert.equal(t.tabs.chat, 'Chats');
    assert.equal(tr('설정'), 'Settings');
    assert.equal(tr('멤버 {0}명', 3), 'Members: 3');
    assert.equal(tr('{0} 프로필 사진', '원문'), '원문’s profile photo');
    assert.equal(tr('이건 회원이 작성한 글입니다'), '이건 회원이 작성한 글입니다');
    assert.equal(t.search.none('원문'), 'No results for “원문”');
    setActiveLanguage('ko');
    assert.equal(t.tabs.chat, '채팅');
    assert.equal(tr('설정'), '설정');
  } finally { setActiveLanguage('ko'); }
});


test('dates and relative times use the selected language without altering event time zones', async () => {
  const { setActiveLanguage } = await import('../src/i18n/index.ts');
  const { relativeTime } = await import('../src/lib/feed-data.ts');
  const { chillingSchedule, recommendedAgeLabel, chillingCountdown } = await import('../src/lib/chilling.ts');
  const now = Date.parse('2026-10-15T18:30:00Z');
  try {
    setActiveLanguage('en');
    assert.equal(relativeTime(new Date(now - 5 * 60000).toISOString(), now), '5 minutes ago');
    assert.equal(relativeTime(new Date(now - 86400000).toISOString(), now), 'Yesterday');
    assert.equal(recommendedAgeLabel({ recommendedAgeMin: 20, recommendedAgeMax: 39 }), 'Recommended ages 20–39');
    assert.equal(chillingCountdown({ eventKind: 'once', startsAt: new Date(now + 60000).toISOString() }, now), 'Today');
    assert.match(chillingSchedule({ eventKind: 'once', startsAt: '2026-10-15T18:30:00Z', timezone: 'America/Vancouver' }), /11:30/);
    setActiveLanguage('ko');
    assert.equal(relativeTime(new Date(now - 5 * 60000).toISOString(), now), '5분 전');
  } finally { setActiveLanguage('ko'); }
});


test('native device defaults read actual iOS and Android locale fields', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const { default: ts } = await import('typescript');
  const source = ts.transpileModule(readFileSync(new URL('../src/hooks/use-language.tsx', import.meta.url), 'utf8') + '\nexports.deviceLanguages = deviceLanguages;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const platform = { OS: 'ios' };
  let apple = ['ko-KR', 'en-CA'];
  const exports = {};
  vm.runInNewContext(source, { exports, Intl, require: (name) => name === 'react' ? { createContext: () => ({}) }
    : name === 'react-native' ? { Platform: platform, Settings: { get: key => { assert.equal(key, 'AppleLanguages'); return apple; } }, I18nManager: { getConstants: () => ({ localeIdentifier: 'en_CA' }) } } : {} });
  assert.deepEqual(Array.from(exports.deviceLanguages()), ['ko-KR', 'en-CA']);
  apple = ['en-CA'];
  assert.deepEqual(Array.from(exports.deviceLanguages()), ['en-CA']);
  platform.OS = 'android';
  assert.deepEqual(Array.from(exports.deviceLanguages()), ['en_CA']);
});
