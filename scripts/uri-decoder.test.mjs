import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const query = createRequire(require.resolve('expo-router/package.json'))('query-string');
const patch = new URL('./fix-uri-decoder.mjs', import.meta.url);

test('malformed percent-encoded router queries complete without CPU exhaustion', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const query = require('node:module').createRequire(require.resolve('expo-router/package.json'))('query-string');
    const {getStateFromPath} = require('expo-router/build/react-navigation/core/getStateFromPath');
    const malformed = '%F0%9F%98'.repeat(512);
    assert.equal(query.parse('probe=' + malformed).probe, malformed);
    assert.equal(query.parse(malformed + '=safe')[malformed], 'safe');
    assert.equal(getStateFromPath('/posts/test?probe=' + malformed, {screens: {Post: 'posts/:slug'}}).routes[0].params.probe, malformed);
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.error?.code || result.stderr);
});

test('router queries retain Korean, callback state, arrays and tolerant decoding', () => {
  for (const [input, expected] of [
    ['title=%EA%B8%80%EB%A7%81+%F0%9F%8E%89', { title: '글링 🎉' }],
    ['code=test-code&state=a%2Bb%2Fc%3D&redirect_to=gling%3A%2F%2Fauth%2Fcallback', { code: 'test-code', state: 'a+b/c=', redirect_to: 'gling://auth/callback' }],
    ['tag=one&tag=two&flag&empty=', { tag: ['one', 'two'], flag: null, empty: '' }],
    ['space=a+b&plus=%2B&encoded=%2525', { space: 'a b', plus: '+', encoded: '%25' }],
    ['bad=%E0%A4%A&bom=%FE%FF&truncated=%C2', { bad: '%E0%A4%A', bom: '\uFFFD\uFFFD', truncated: '\uFFFD' }],
  ]) assert.deepEqual({ ...query.parse(input) }, expected);
  assert.equal(query.stringify({ title: '글링', tag: ['one', 'two'] }, { sort: false }), 'title=%EA%B8%80%EB%A7%81&tag=one&tag=two');
  const longValue = 'a'.repeat(12000) + ' 글링 🎉';
  assert.equal(query.parse('value=' + encodeURIComponent(longValue)).value, longValue);
});

test('Expo deep links preserve decoded path and callback parameters', () => {
  const { getStateFromPath } = require('expo-router/build/react-navigation/core/getStateFromPath');
  const state = getStateFromPath('/posts/%EA%B8%80%EB%A7%81?title=%EA%B8%80%EB%A7%81+%F0%9F%8E%89&state=a%2Bb%2Fc%3D', { screens: { Post: 'posts/:slug' } });
  assert.deepEqual(state.routes[0].params, { slug: '글링', title: '글링 🎉', state: 'a+b/c=' });
});

test('install patch preserves a callable CommonJS decoder and is idempotent', (t) => {
  assert.ok(existsSync(patch), 'The reviewed install compatibility patch must exist');
  const folder = mkdtempSync(join(tmpdir(), 'gling-uri-decoder-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const name of ['scripts', 'node_modules/expo-router', 'node_modules/query-string', 'node_modules/decode-uri-component']) mkdirSync(join(folder, name), { recursive: true });
  const file = join(folder, 'node_modules/query-string/index.js');
  copyFileSync(patch, join(folder, 'scripts/fix-uri-decoder.mjs'));
  writeFileSync(join(folder, 'node_modules/expo-router/package.json'), '{"name":"expo-router"}');
  writeFileSync(join(folder, 'node_modules/query-string/package.json'), '{"name":"query-string","main":"index.js"}');
  writeFileSync(join(folder, 'node_modules/decode-uri-component/package.json'), '{"name":"decode-uri-component","type":"module","exports":"./index.js"}');
  writeFileSync(join(folder, 'node_modules/decode-uri-component/index.js'), 'export default decodeURIComponent;');
  writeFileSync(file, "const decodeComponent = require('decode-uri-component');\nexports.parse = decodeComponent;\n");
  const run = () => spawnSync(process.execPath, ['scripts/fix-uri-decoder.mjs'], { cwd: folder, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const patched = readFileSync(file, 'utf8');
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(file, 'utf8'), patched);
  const decoded = spawnSync(process.execPath, ['-e', "process.stdout.write(require('query-string').parse('%EA%B8%80%EB%A7%81'))"], { cwd: folder, encoding: 'utf8' });
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.equal(decoded.stdout, '글링');
  writeFileSync(file, 'exports.parse = () => ({});\n');
  const changed = run();
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /Unexpected query-string decoder import/);
  assert.equal(readFileSync(file, 'utf8'), 'exports.parse = () => ({});\n');
});
