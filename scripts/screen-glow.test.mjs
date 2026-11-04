import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (file, imports) => {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { if (name in imports) return imports[name]; throw new Error(`Unexpected import: ${name}`); } });
  return exports;
};
const { Colors } = read('constants/theme.ts', { '@/global.css': {}, 'react-native': { Platform: { select: values => values.default } } });

function load(theme) {
  const exports = {}, slots = [];
  let at = 0;
  const react = { useState: initial => { const i = at++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; } };
  Object.assign(exports, read('components/screen-glow.tsx', { react, '@/hooks/use-theme': { useTheme: () => theme } }));
  return { ...exports, render: enabled => { at = 0; return exports.useScreenGlow(enabled); } };
}
const alpha = color => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(color)[1]);
const rgb = color => color.startsWith('#') ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : /rgba\((\d+),(\d+),(\d+)/.exec(color).slice(1).map(Number);
const over = (base, color) => rgb(color).map((value, i) => base[i] + (value - base[i]) * alpha(color));
const mix = (a, b, share) => a.map((value, i) => value + (b[i] - value) * share);
const farthest = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
const luminance = channels => channels.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  .reduce((total, value, i) => total + value * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('the top light keeps the mockup geometry and a view offset by (x, y) gets the same light at its spot', () => {
  const { screenGlowImage } = load(Colors.light);
  const image = screenGlowImage(Colors.light, 400, 800);
  assert.match(image, /^radial-gradient\(520px 440px at 0px 0px, rgba\(110,74,162,0\.17\), transparent 62%\), radial-gradient\(400px 336px at 400px 40px, rgba\(52,80,107,0\.12\), transparent 60%\), /);
  assert.match(image, /radial-gradient\(480px 880px at 200px 0px, #F9F6FF, transparent\), radial-gradient\(480px 880px at 200px 800px, #F4F7FF, transparent\)$/);
  const shifted = screenGlowImage(Colors.light, 400, 800, 16, 177.24);
  assert.match(shifted, /at -16px -177\.2px,.* at 384px -137\.2px,.* at 184px -177\.2px,.* at 184px 622\.8px,/, 'same sizes, centres moved by the offset');
  const sizes = value => value.match(/radial-gradient\([\d.]+px [\d.]+px/g);
  assert.deepEqual(sizes(shifted), sizes(image), 'only the centres move');
});

test('both themes carry the light as tokens, and the body tint is a faint purple-to-blue shift next to the top light', () => {
  for (const scheme of ['light', 'dark', 'admin']) {
    const palette = Colors[scheme], base = rgb(palette.background);
    for (const key of ['glowA', 'glowB']) assert.match(palette[key], /^rgba\(\d+,\d+,\d+,0?\.\d+\)$/, `${scheme}.${key}`);
    for (const key of ['bodyGlowA', 'bodyGlowB']) {
      assert.match(palette[key], /^#[0-9A-F]{6}$/, `${scheme}.${key}`);
      const moved = farthest(rgb(palette[key]), base);
      assert.ok(moved > 0 && moved <= 5, `${scheme}.${key} moves the background by a few steps (${moved})`);
      assert.ok(rgb(palette[key])[2] > base[2], `${scheme}.${key} leans blue`);
    }
    assert.ok(rgb(palette.bodyGlowA)[0] > rgb(palette.bodyGlowB)[0], `${scheme} body tint runs purple (top) to blue-grey (bottom)`);
    assert.ok(farthest(over(base, palette.glowA), base) >= 15, `${scheme} top light is several times stronger`);
  }
});

test('nothing is drawn before the screen is measured or on screens that keep it off', () => {
  const glow = load(Colors.dark);
  assert.equal(glow.render(true).image(), undefined);
  glow.render(true).onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 440, height: 956 } } });
  assert.match(glow.render(true).image(0, 200), /^radial-gradient\(572px 525\.8px at 0px -200px, rgba\(203,185,255,0\.15\)/);
  assert.equal(glow.render(false).image(), undefined);
});

test('the body tint keeps the background brightness, so text, card and line contrast stay as they were', () => {
  for (const scheme of ['light', 'dark']) {
    const palette = Colors[scheme], base = rgb(palette.background);
    const [a, b] = [rgb(palette.bodyGlowA), rgb(palette.bodyGlowB)];
    // Every spot of the body is a blend of the background and the two tints; their ends and midpoints are the extremes.
    for (const spot of [a, b, mix(a, b, 0.5), mix(base, a, 0.5), mix(base, b, 0.5)]) {
      for (const role of ['text', 'textSecondary', 'accent', 'card', 'backgroundElement', 'line']) {
        const before = contrast(rgb(palette[role]), base), after = contrast(rgb(palette[role]), spot);
        assert.ok(Math.abs(after / before - 1) < 0.005, `${scheme} ${role}: ${before.toFixed(2)} -> ${after.toFixed(2)} at ${spot.map(Math.round)}`);
      }
    }
  }
});

test('meetups, chat and notifications carry the same light, the map and the shared tab base stay plain (owner 2026-11-04)', () => {
  const source = file => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  for (const [file, screens] of [['app/(tabs)/meetups.tsx', 2], ['app/(tabs)/chat.tsx', 1], ['app/(tabs)/notifications.tsx', 1]]) {
    const code = source(file);
    assert.equal(code.match(/glow = useScreenGlow\(\), screenGlow = glow\.image\(\);/g)?.length, screens, `${file}: one light per screen`);
    assert.equal(code.match(/<TabContent style=\{\[styles\.\w+, screenGlow != null && \{ backgroundImage: screenGlow \}\]\} onLayout=\{glow\.onLayout\}>/g)?.length, screens, `${file}: the light sits on the screen's own TabContent`);
    assert.doesNotMatch(code, /styles\.(head|headRow|header)\b[^\n]*backgroundColor: theme\.background/, `${file}: the title row lets the light through`);
    assert.doesNotMatch(code, /<SafeAreaView[^>]*backgroundColor: theme\.background/, `${file}: nothing opaque over the light`);
  }
  assert.doesNotMatch(source('components/tab-content.tsx'), /glow|backgroundImage/i, 'the base every tab shares is untouched');
  assert.doesNotMatch(source('app/map.tsx'), /useScreenGlow/, 'the map covers the screen, so it stays without the light');
});
