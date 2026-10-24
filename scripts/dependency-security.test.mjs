import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const xcode = require('xcode');
const project = () => {
  const value = xcode.project('unused.pbxproj');
  value.hash = { project: { objects: { PBXGroup: {} } } };
  return value;
};

test('native project identifiers retain unique uppercase 24-digit IDs', () => {
  const value = project();
  const ids = Array.from({ length: 32 }, () => value.generateUuid());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-F0-9]{24}$/);
});

test('native project identifier generation retries an existing ID', t => {
  const value = project();
  value.hash.project.objects.PBXGroup['000000000000400080000000'] = {};
  let calls = 0;
  t.mock.method(crypto, 'randomUUID', () => `${calls++ ? '11111111' : '00000000'}-0000-4000-8000-000000000000`);
  assert.equal(value.generateUuid(), '111111110000400080000000');
  assert.equal(calls, 2);
});
