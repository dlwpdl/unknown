import assert from 'node:assert/strict';
import test from 'node:test';

import { requiresAppUpdate } from '../src/lib/app-update.ts';

test('only an older installed native build is blocked', () => {
  assert.equal(requiresAppUpdate('49', 50), true);
  assert.equal(requiresAppUpdate('50', 50), false);
  assert.equal(requiresAppUpdate('51', 50), false);
  assert.equal(requiresAppUpdate(null, 50), false);
  assert.equal(requiresAppUpdate('preview', 50), false);
  assert.equal(requiresAppUpdate('49', null), false);
});
