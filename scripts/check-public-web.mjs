import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2] ?? 'dist';
assert.ok(existsSync(join(directory, 'index.html')), 'Public web export is missing');
for (const file of readdirSync(directory, { recursive: true })) {
  assert.ok(!/(^|\/)admin(?:[./]|$)/.test(file), `Private admin route in public export: ${file}`);
  if (!/\.(html|js)$/.test(file)) continue;
  const content = readFileSync(join(directory, file), 'utf8');
  assert.ok(!content.includes('get_admin_analytics') && !content.includes('GLING / INSIGHTS'), `Private admin code in public export: ${file}`);
}
console.log('Public web export contains no admin route or dashboard code.');
