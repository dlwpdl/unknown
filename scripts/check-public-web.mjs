import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2] ?? 'dist';
assert.ok(existsSync(join(directory, 'index.html')), 'Public web export is missing');
const childSafety = readFileSync(join(directory, 'child-safety.html'), 'utf8');
assert.ok(childSafety.includes('--bg:') && childSafety.includes('--text:'), 'Legal page must define readable background/text colors');
for (const text of ['아동 안전 표준', 'CSAE', 'CSAM', 'gling@ej-entertainment.com', 'Cybertip.ca']) {
  assert.ok(childSafety.includes(text), `Child safety policy is missing: ${text}`);
}
for (const file of readdirSync(directory, { recursive: true })) {
  assert.ok(!/(^|\/)(admin|chat|compose|profile|notifications|meetup-create|meetup-join|meetup-application|meetup-profile)(?:[./]|$)/.test(file), `App-only route in public export: ${file}`);
  if (!/\.(html|js)$/.test(file)) continue;
  const content = readFileSync(join(directory, file), 'utf8');
  for (const marker of ['get_admin_analytics', 'GLING / INSIGHTS', 'send_message', 'send_direct_message', 'REVIEW_ACCESS_DENIED', 'create_meetup_with_post', 'get_my_conversations']) {
    assert.ok(!content.includes(marker), `App-only code (${marker}) in public export: ${file}`);
  }
}
console.log('Public web export contains no app-only routes, chat mutations or admin dashboard code.');
