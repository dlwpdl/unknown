import assert from 'node:assert/strict';
import test from 'node:test';
import { lensControlStyle } from '../src/lib/lens-control.ts';

const paint = new Set(['borderRadius', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'borderStartColor', 'borderEndColor', 'boxShadow', 'shadowOpacity', 'elevation']);

test('lens changes paint only: existing small, large, selected and disabled controls keep their geometry and content', () => {
  for (const original of [
    { minHeight: 44, minWidth: 44, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderBottomWidth: 3, backgroundColor: '#FFFFFF', borderColor: '#E5E3DB' },
    { minHeight: 52, width: '100%', maxWidth: 596, paddingHorizontal: 20, borderWidth: 1, backgroundColor: '#BE3B2A', opacity: 0.62 },
    { height: 32, padding: 4, borderBottomWidth: 2, backgroundColor: '#222231', borderBottomColor: '#CBB9FF', transform: [{ translateX: 8 }] },
  ]) for (const pressed of [false, true]) {
    const before = structuredClone(original), material = lensControlStyle(original, pressed), result = { ...original, ...material };
    assert.deepEqual(original, before, 'never mutate caller styles');
    assert.ok(Object.keys(material).every(key => paint.has(key)), 'material cannot set layout, opacity, type or transform');
    for (const [key, value] of Object.entries(original)) if (!paint.has(key)) assert.deepEqual(result[key], value, key);
    assert.equal(result.backgroundColor, original.backgroundColor);
    assert.equal(result.opacity, original.opacity);
  }
});

test('lens has a reflective rim, preserves the semantic edge color and changes shadow on press without adding motion', () => {
  const normal = lensControlStyle({ borderColor: '#CBB9FF' }, false), down = lensControlStyle({ borderColor: '#CBB9FF' }, true);
  assert.equal(normal.borderRadius, 999);
  assert.equal(normal.borderBottomColor, 'transparent');
  assert.ok(normal.boxShadow.some(shadow => shadow.inset && shadow.color === '#CBB9FF'));
  assert.notDeepEqual(normal.boxShadow, down.boxShadow);
  assert.equal(normal.transform, undefined);
  assert.equal(down.transform, undefined);
});
