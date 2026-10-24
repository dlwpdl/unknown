import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { ControlStyles, controlPresentation } from '../src/constants/design-system.ts';

const source = ts.createSourceFile('meetups.tsx', readFileSync(new URL('../src/app/(tabs)/meetups.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let button, fab;
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'analyticsId' && attribute.initializer?.text === 'app_tabs_meetups.pressable.3')) button = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'styles') fab = node.initializer.arguments[0].properties.find(property => property.name.getText(source) === 'fab').initializer;
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(button && fab, 'load the actual floating create control and its production style');
const expression = name => button.attributes.properties.find(attribute => attribute.name?.getText(source) === name).initializer.expression.getText(source);

function control(insets) {
  const calls = [], module = { exports: {} };
  const context = { module, insets, ControlStyles, controlPresentation, styles: {}, Spacing: { three: 16 }, TabBarHeight: 49,
    createDisabled: false, theme: { accent: '#abc', accentInk: '#123' }, play: kind => calls.push(kind), action: route => calls.push(route) };
  // Evaluate the actual production expressions; this fixture does not implement placement.
  vm.runInNewContext(`styles.fab = (${fab.getText(source)}); module.exports = { style: (${expression('style')}), press: (${expression('onPress')}) };`, context);
  return { style: JSON.parse(JSON.stringify(Object.assign({}, ...module.exports.style({ pressed: false })))), press: module.exports.press, calls };
}

test('floating meetup create stays inside current scene right safe area across pose changes', () => {
  const baseline = control({ top: 0, left: 0, right: 0, bottom: 34 }).style;
  assert.equal(baseline.right, 22, 'ordinary phone keeps its existing trailing spacing');
  for (const scene of [
    { width: 390, left: 0, right: 86 }, // closed scene with a reserved trailing region
    { width: 748, left: 0, right: 64 }, // open scene
    { width: 748, left: 28, right: 72 },
    { width: 390, left: 0, right: 0 }, // return to ordinary geometry
  ]) {
    const current = control({ top: 0, bottom: 34, ...scene }).style;
    const buttonWidth = 148, rightEdge = scene.width - current.right;
    assert.ok(rightEdge <= scene.width - scene.right - 22, 'button must retain its gap before the reserved right region');
    assert.ok(rightEdge - buttonWidth >= scene.left, 'control remains within available horizontal bounds');
    assert.equal(current.bottom, baseline.bottom, 'horizontal correction must preserve existing bottom placement');
    assert.ok(current.minHeight >= 44, 'keep the existing accessible touch target');
  }
  assert.deepEqual(control({ top: 0, left: 0, right: 0, bottom: 34 }).style, baseline);
});

test('safe-area placement preserves create feedback and destination', () => {
  const { press, calls } = control({ top: 0, left: 0, right: 86, bottom: 34 });
  press();
  assert.deepEqual(calls, ['selection', '/meetup-create']);
});
