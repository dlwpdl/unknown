import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const requireFromXcode = createRequire(require.resolve('xcode/package.json'));
const { v3, v4 } = requireFromXcode('uuid');

test('native project UUID generation rejects a short output buffer before writing', () => {
  const buffer = new Uint8Array(8);
  assert.throws(() => v3('gling-qa', v3.DNS, buffer), RangeError);
  assert.deepEqual(buffer, new Uint8Array(8));
});

test('patched UUID retains the CommonJS API used for Xcode project identifiers', () => {
  assert.match(v4().replaceAll('-', '').slice(0, 24).toUpperCase(), /^[A-F0-9]{24}$/);
});
