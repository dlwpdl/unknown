import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlStyles, Typography, controlPresentation } from '../src/constants/design-system.ts';

const themes = [
  { accent: '#71529f', accentInk: '#fff', text: '#24212c', card: '#ede9e5', line: '#d3cdd7', backgroundSelected: '#e3d9ed' },
  { accent: '#cbb9ff', accentInk: '#171123', text: '#f6f3f0', card: '#171722', line: '#34343f', backgroundSelected: '#343443' },
];

test('control roles keep the same selection meaning in either theme', () => {
  for (const theme of themes) {
    const primary = controlPresentation(theme, { tone: 'primary' });
    const secondary = controlPresentation(theme, { tone: 'secondary' });
    const selected = controlPresentation(theme, { tone: 'secondary', selected: true });
    const icon = controlPresentation(theme, { tone: 'ghost', selected: true });
    assert.equal(primary.container.backgroundColor, theme.accent);
    assert.equal(primary.text.color, theme.accentInk);
    assert.equal(secondary.container.backgroundColor, theme.card);
    assert.equal(secondary.container.borderColor, theme.line);
    assert.equal(selected.container.backgroundColor, primary.container.backgroundColor);
    assert.equal(selected.text.color, primary.text.color);
    assert.equal(icon.container.backgroundColor, theme.backgroundSelected);
    assert.equal(icon.text.color, theme.accent);
  }
});

test('disabled and busy states take precedence over a stale pressed state', () => {
  for (const flag of ['disabled', 'busy']) {
    const resting = controlPresentation(themes[0], { [flag]: true });
    const pressed = controlPresentation(themes[0], { [flag]: true, pressed: true });
    assert.deepEqual(pressed, resting);
    assert.ok(resting.container.opacity < 1);
    assert.equal(resting.container.transform, undefined);
  }
});

test('reduced motion keeps a visible press response without scaling', () => {
  const normal = controlPresentation(themes[0], { pressed: true });
  const reduced = controlPresentation(themes[0], { pressed: true, reducedMotion: true });
  assert.equal(normal.container.transform, undefined);
  assert.equal(reduced.container.transform, undefined);
  assert.equal(normal.container.opacity, reduced.container.opacity);
  assert.ok(reduced.container.opacity < 1);
});

test('touch roles meet minimum target size and text roles leave line-height room', () => {
  for (const [name, style] of Object.entries(ControlStyles)) {
    assert.ok((style.minHeight ?? style.height) >= 44, `${name} touch target`);
  }
  for (const [name, style] of Object.entries(Typography)) {
    assert.ok(style.lineHeight > style.fontSize, `${name} line height`);
  }
});

test('presentation does not mutate the supplied theme or state', () => {
  const theme = Object.freeze({ ...themes[0] });
  const state = Object.freeze({ tone: 'secondary', selected: true, pressed: true });
  const before = JSON.stringify({ theme, state });
  controlPresentation(theme, state);
  assert.equal(JSON.stringify({ theme, state }), before);
});
