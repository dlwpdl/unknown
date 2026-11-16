import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { pillSlices } from '../src/constants/design-system.ts';

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

// Yoga's pixel rounding (PixelGrid.cpp): a view's offset in its parent is rounded alone, its width from the rounded absolute edges.
const gridPx = (value, scale) => {
  const scaled = value * scale, near = (a, b) => Math.abs(a - b) < 0.0001;
  let fraction = scaled % 1; if (fraction < 0) fraction += 1;
  return Math.round(near(fraction, 0) ? scaled - fraction : near(fraction, 1) ? scaled - fraction + 1 : scaled - fraction + (fraction > 0.5 || near(fraction, 0.5) ? 1 : 0));
};
const place = (parent, rel, width, scale) => {
  const abs = parent.abs + rel, left = parent.left + gridPx(rel, scale);
  return { abs, left, right: left + gridPx(abs + width, scale) - gridPx(abs, scale) };
};
const clip = (node, box) => ({ left: Math.max(node.left, box.left), right: Math.min(node.right, box.right) });

test('3D pill slices meet on one device pixel at any density and offset, with no gap or overlap (QA D24-1)', () => {
  let oldGaps = 0, cases = 0;
  for (const scale of [1.5, 2, 2.625, 2.75, 3, 3.5]) for (let offset = 0; offset < 2; offset += 0.037) for (const width of [40.2, 44, 61.7, 100.45, 187.2, 333.33]) for (const height of [46.6, 50.8, 55.2]) for (const ratio of [0.7366, 0.7446, 0.7202, 0.7312, 0.6978]) {
    const fit = pillSlices(width, height, ratio, scale), control = { abs: offset, left: 0 };
    const slices = place(place(control, 0, width, scale), 0, fit.width, scale);
    const middle = place(slices, fit.end, Math.max(0, fit.width - 2 * fit.end), scale);
    const leftHalf = place(slices, 0, fit.half, scale), rightHalf = place(slices, fit.half, fit.width - fit.half, scale);
    const leftEnd = clip(place(leftHalf, 0, fit.end, scale), leftHalf), rightEnd = clip(place(rightHalf, fit.width - fit.half - fit.end, fit.end, scale), rightHalf);
    const where = `scale ${scale} offset ${offset.toFixed(3)} width ${width} height ${height}`;
    assert.equal(leftEnd.left, slices.left, where);
    assert.equal(rightEnd.right, slices.right, where);
    if (2 * fit.end <= fit.width) {
      assert.equal(leftEnd.right, middle.left, where);
      assert.equal(middle.right, rightEnd.left, where);
    } else assert.equal(leftEnd.right, rightEnd.left, where);
    // The ratio layout this replaces: the middle starts at a fractional offset and misses the end's edge.
    const old = place(control, 0, width, scale);
    if (place(old, 0, height * ratio, scale).right !== place(old, height * ratio, 1, scale).left) oldGaps++;
    cases++;
  }
  assert.ok(oldGaps > cases / 10, 'the check sees the 1px seam the old layout left');
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
