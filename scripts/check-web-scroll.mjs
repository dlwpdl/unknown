import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Run against an open Orca public-web tab: node scripts/check-web-scroll.mjs <page-id>
const page = process.argv[2];
assert.ok(page, 'Pass the Orca browser page ID to check.');
function browser(...args) {
  const response = JSON.parse(execFileSync('orca', [...args, '--page', page, '--json'], { encoding: 'utf8' }));
  assert.ok(response.ok, JSON.stringify(response.error));
  return response.result;
}
function position() {
  return JSON.parse(browser('eval', '--expression', `({
    y: window.scrollY, height: innerHeight, content: document.documentElement.scrollHeight,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    htmlOverflow: getComputedStyle(document.documentElement).overflowY
  })`).result);
}
const before = position();
assert.ok(!['hidden', 'clip'].includes(before.bodyOverflow), 'Body blocks user scrolling');
assert.ok(!['hidden', 'clip'].includes(before.htmlOverflow), 'HTML blocks user scrolling');
assert.ok(before.content > before.height, 'Use a page with content taller than the viewport');
const direction = before.y > 100 ? 'up' : 'down';
browser('scroll', '--direction', direction, '--amount', '600');
const after = position();
assert.ok(direction === 'down' ? after.y > before.y : after.y < before.y, 'Browser scroll did not move the page');
console.log(JSON.stringify({ direction, before, after }));
