// With Metro on 8091: node scripts/check-feed-navigation.mjs GLING_ORCA_PAGE_ID
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const page = process.argv[2];
assert(page, 'Pass an existing Gling Orca page ID');
const orca = (...args) => {
  const result = JSON.parse(execFileSync('orca', [...args, '--page', page, '--json'], {
    cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }));
  assert(result.ok, `Orca ${args[0]} failed`);
  return result.result;
};
const evaluate = (expression) => {
  const value = orca('eval', '--expression', expression).result;
  try { return JSON.parse(value); } catch { return value; }
};
orca('goto', '--url', 'http://localhost:8091/meetups');
for (let attempt = 0; attempt < 40; attempt++) {
  if (evaluate('document.querySelector("[aria-label^=공감]") !== null')) break;
  await new Promise((done) => setTimeout(done, 250));
}
for (const width of [320, 375, 768, 1024, 1440]) {
  orca('viewport', '--width', String(width), '--height', '812');
  const state = evaluate(String.raw`(() => {
    const rect = (e) => ({ x: e.getBoundingClientRect().left, width: e.getBoundingClientRect().width });
    const metrics = [...document.querySelectorAll('[aria-label^="조회 "]')];
    return {
      tabs: [...document.querySelectorAll('a')].filter(e => ['/','/meetups','/compose','/chat','/notifications'].includes(e.getAttribute('href'))).map(e => e.getAttribute('href')),
      search: rect(document.querySelector('[aria-label="제목·내용·해시태그 검색"]')),
      profile: rect(document.querySelector('[aria-label="나"]')),
      groups: metrics.map(e => ({ role: e.getAttribute('role'), labels: [...e.parentElement.children].map(n => n.getAttribute('aria-label')), positions: [...e.parentElement.children].map(rect) })),
      likes: document.querySelectorAll('[aria-label^="공감 "]').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      markers: /\[예시\]|·예시/.test(document.body.innerText)
    };
  })()`);
  assert.deepEqual(state.tabs, ['/', '/meetups', '/compose', '/chat', '/notifications']);
  assert(state.profile.x > state.search.x, 'Profile follows Search');
  assert.equal(state.overflow, false, `No overflow at ${width}px`);
  assert.equal(state.markers, false);
  assert(state.groups.length > 0);
  assert.equal(state.groups.length, state.likes, 'One view count per post');
  for (const group of state.groups) {
    assert.notEqual(group.role, 'button', 'Views are not interactive');
    assert.deepEqual(group.labels.map(label => label.split(' ')[0]), ['공감', '댓글', '저장', '공유', '조회']);
    assert(group.positions[0].x >= 16);
    for (let i = 1; i < group.positions.length; i++) {
      const previous = group.positions[i - 1];
      assert(Math.abs(group.positions[i].x - previous.x - previous.width - 8) < 1, 'Metrics use an 8px gap');
    }
  }
}
orca('viewport', '--width', '375', '--height', '812', '--mobile');
console.log('PASS: five destinations; profile follows Search; metrics cluster left with one read-only view count; 320–1440px without overflow.');
