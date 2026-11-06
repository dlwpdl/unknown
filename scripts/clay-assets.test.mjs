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

test('the tab bar draws clay icons on iOS and keeps the system symbols where it cannot (owner 2026-11-06 푸터바 3D)', () => {
  const tabs = readFileSync('src/components/app-tabs.tsx', 'utf8');
  assert.match(tabs, /useClay\(\) && Platform\.OS === 'ios'/);
  assert.match(tabs, /renderingMode: 'original'/);
  for (const name of ['home', 'meetups', 'map', 'chat', 'bell']) assert.ok(tabs.includes(`art('${name}')`), name);
  for (const symbol of ['house.fill', 'person.2.fill', 'map.fill', 'bubble.left.and.bubble.right.fill', 'bell.fill']) assert.ok(tabs.includes(symbol), symbol);
});

test('clay follows the 2D·3D choice in both themes, is off on the web and the admin theme, and 9-slice boxes stay iOS only', () => {
  assert.match(clay, /useClay\(\) \{\s*const design = useDesign\(\), theme = useTheme\(\);\s*return design === '3d' && theme !== Colors\.admin && Platform\.OS !== 'web';/);
  assert.match(clay, /useClayBox\(\) \{\s*return useClay\(\) && Platform\.OS === 'ios';/);
  assert.match(clay, /if \(!pill\) return name \? <SymbolView/);
});

test('a dimmed pill fades as one piece on Android, so the slices do not show as two vertical lines', () => {
  assert.match(clay, /<View pointerEvents="none" renderToHardwareTextureAndroid style=\{\[styles\.pill,/);
});

test('every pill, box and photo dome has its dark drawing, and a dark icon only names a drawing the light set has', () => {
  for (const kind of ['on', 'white', 'cta', 'tray', 'line']) for (const end of ['l', 'm', 'r']) assert.ok(clay.includes(`pill_${kind}_d_${end}.png`), `${kind} ${end}`);
  for (const name of ['text_d', 'tile_d', 'photo_dome_d']) assert.ok(clay.includes(`${name}.png`), name);
  const lightPart = clay.slice(clay.indexOf('const ICONS = {'), clay.indexOf('const ICONS_DARK'));
  const darkPart = clay.slice(clay.indexOf('const ICONS_DARK'), clay.indexOf('// Three slices'));
  for (const [, name] of darkPart.matchAll(/(\w+): require\(/g)) assert.ok(lightPart.includes(`${name}: require(`), name);
});

test('every symbol that has a drawing points at a real one, and a missing drawing falls back to the system symbol', () => {
  const view = readFileSync('src/components/symbol-view.tsx', 'utf8');
  const lightPart = clay.slice(clay.indexOf('const ICONS = {'), clay.indexOf('const ICONS_DARK'));
  for (const [, name] of view.matchAll(/clay: '(\w+)'/g)) assert.ok(lightPart.includes(`${name}: require(`), name);
  assert.match(view, /if \(!art\) return <NativeSymbol/);
});
