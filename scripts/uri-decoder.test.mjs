import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { getStateFromPath } = require('expo-router/build/fork/getStateFromPath');
const { stringifySearchParams } = require('expo-router/build/utils/queryParams');
const params = query => {
  const { slug: _slug, ...values } = getStateFromPath(`/posts/test?${query}`, { screens: { Post: 'posts/:slug' } }).routes[0].params;
  return values;
};

test('malformed percent-encoded router queries complete without CPU exhaustion', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { getStateFromPath } = require('expo-router/build/fork/getStateFromPath');
    const malformed = '%F0%9F%98'.repeat(512);
    const parse = query => getStateFromPath('/posts/test?' + query, { screens: { Post: 'posts/:slug' } }).routes[0].params;
    assert.equal(parse('probe=' + malformed).probe, '\\uFFFD'.repeat(512));
    assert.equal(parse(malformed + '=safe')['\\uFFFD'.repeat(512)], 'safe');
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.error?.code || result.stderr);
});

test('router queries retain Korean, callback state, arrays and standard tolerant decoding', () => {
  for (const [input, expected] of [
    ['title=%EA%B8%80%EB%A7%81+%F0%9F%8E%89', { title: '글링 🎉' }],
    ['code=test-code&state=a%2Bb%2Fc%3D&redirect_to=gling%3A%2F%2Fauth%2Fcallback', { code: 'test-code', state: 'a+b/c=', redirect_to: 'gling://auth/callback' }],
    ['tag=one&tag=two&flag&empty=', { tag: ['one', 'two'], flag: '', empty: '' }],
    ['space=a+b&plus=%2B&encoded=%2525', { space: 'a b', plus: '+', encoded: '%25' }],
    ['bad=%E0%A4%A&bom=%FE%FF&truncated=%C2', { bad: '\uFFFD%A', bom: '\uFFFD\uFFFD', truncated: '\uFFFD' }],
  ]) assert.deepEqual(params(input), expected);
  assert.equal(stringifySearchParams({ title: '글링', tag: ['one', 'two'] }), 'title=%EA%B8%80%EB%A7%81&tag=one&tag=two');
  const longValue = 'a'.repeat(12000) + ' 글링 🎉';
  assert.equal(params('value=' + encodeURIComponent(longValue)).value, longValue);
});

test('Expo deep links preserve decoded path and callback parameters', () => {
  const state = getStateFromPath('/posts/%EA%B8%80%EB%A7%81?title=%EA%B8%80%EB%A7%81+%F0%9F%8E%89&state=a%2Bb%2Fc%3D', { screens: { Post: 'posts/:slug' } });
  assert.deepEqual(state.routes[0].params, { slug: '글링', title: '글링 🎉', state: 'a+b/c=' });
});
