import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const clay = readFileSync('src/components/clay.tsx', 'utf8');
const dir = 'assets/images/ui-3d/';

test('every clay drawing the app asks for is on disk, and nothing unused ships', () => {
  const asked = [...clay.matchAll(/require\('@\/assets\/images\/ui-3d\/([^']+)\.png'\)/g)].map(match => match[1]);
  assert.ok(asked.length > 40);
  // Metro resolves name.png to name@3x.png; asking for the @3x path directly fails to bundle.
  for (const name of asked) {
    assert.ok(!name.includes('@'), name);
    assert.ok(existsSync(`${dir}${name}.png`) || existsSync(`${dir}${name}@3x.png`), name);
  }
  const unused = readdirSync(dir).map(file => file.replace(/(@3x)?\.png$/, '')).filter(name => !asked.includes(name));
  assert.deepEqual(unused, []);
});

test('the tab bar stays flat system symbols (owner 2026-11-06 칸별 답: 탭 바 평면 그대로)', () => {
  const tabs = readFileSync('src/components/app-tabs.tsx', 'utf8');
  assert.ok(!tabs.includes('components/clay'));
  for (const symbol of ['house.fill', 'person.2.fill', 'map.fill', 'bubble.left.and.bubble.right.fill', 'bell.fill']) assert.ok(tabs.includes(symbol), symbol);
});

test('clay stays off in the dark theme and on the web, and 9-slice boxes stay iOS only', () => {
  assert.match(clay, /useClay\(\) \{\s*return useTheme\(\) === Colors\.light && Platform\.OS !== 'web';/);
  assert.match(clay, /useClayBox\(\) \{\s*return useTheme\(\) === Colors\.light && Platform\.OS === 'ios';/);
  assert.match(clay, /if \(!useClay\(\)\) return name \? <SymbolView/);
});
