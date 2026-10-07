import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Run against an open Orca public-web tab: node scripts/check-web-scroll.mjs <page-id>
const page = process.argv[2];
assert.ok(page, 'Pass the Orca browser page ID to check.');
function browser(...args) {
  const response = JSON.parse(execFileSync('orca', [...args, '--worktree', 'all', '--page', page, '--json'], { encoding: 'utf8' }));
  assert.ok(response.ok, JSON.stringify(response.error));
  return response.result;
}
function position() {
  return JSON.parse(browser('eval', '--expression', `(() => {
    const surface = document.querySelector('.reader, .legal-page');
    const footer = surface.querySelector('footer');
    return {
      y: window.scrollY, height: innerHeight, content: document.documentElement.scrollHeight,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      htmlOverflow: getComputedStyle(document.documentElement).overflowY,
      pageBottom: surface.getBoundingClientRect().bottom + scrollY,
      footerBottom: footer.getBoundingClientRect().bottom + scrollY,
      pageBackground: getComputedStyle(surface).backgroundColor,
      canvasBackground: getComputedStyle(document.documentElement).backgroundColor
    };
  })()`).result);
}
const before = position();
assert.ok(!['hidden', 'clip'].includes(before.bodyOverflow), 'Body blocks user scrolling');
assert.ok(!['hidden', 'clip'].includes(before.htmlOverflow), 'HTML blocks user scrolling');
assert.ok(before.content > before.height, 'Use a page with content taller than the viewport');
assert.ok(before.pageBottom >= before.footerBottom - 1, 'Page background stops before the footer');
assert.equal(before.canvasBackground, before.pageBackground, 'Browser canvas must match the page background');
const direction = before.y > 100 ? 'up' : 'down';
browser('scroll', '--direction', direction, '--amount', '600');
browser('wait', '--fn', `window.scrollY ${direction === 'down' ? '>' : '<'} ${before.y}`, '--timeout', '3000');
const after = position();
assert.ok(direction === 'down' ? after.y > before.y : after.y < before.y, 'Browser scroll did not move the page');
console.log(JSON.stringify({ direction, before, after }));
