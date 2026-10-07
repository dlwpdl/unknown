import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('native admin screens do not render browser elements', () => {
  for (const name of ['admin-section', 'admin-table-controls']) {
    const source = readFileSync(new URL(`../src/components/admin/${name}.native.tsx`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<(?:div|span|button|details|summary|table|input|select|form|fieldset|label|textarea)\b/i);
  }
});
