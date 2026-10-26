import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const text = readFileSync(new URL('../src/app/(tabs)/meetups.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('meetups.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let button, styles;
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'analyticsId' && attribute.initializer?.text === 'app_tabs_meetups.pressable.3')) button = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'styles') styles = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(button && styles, 'load the actual create control and its production styles');
const expression = name => button.attributes.properties.find(attribute => attribute.name?.getText(source) === name).initializer.expression.getText(source);

function control() {
  const calls = [], module = { exports: {} };
  const context = { module, styles: {}, Spacing: new Proxy({}, { get: () => 8 }), Typography: new Proxy({}, { get: () => ({}) }), Radius: new Proxy({}, { get: () => 8 }), StyleSheet: { hairlineWidth: 1 },
    createDisabled: false, theme: { accent: '#abc', accentInk: '#123' }, play: kind => calls.push(kind), action: route => calls.push(route) };
  vm.runInNewContext(`styles = (${styles.getText(source)}); module.exports = { style: (${expression('style')}), press: (${expression('onPress')}) };`, context);
  return { style: Object.assign({}, ...module.exports.style({ pressed: false })), press: module.exports.press, calls };
}

test('meetup create sits in the header inside the left/right safe area instead of floating over a Duo reserved region', () => {
  const header = text.indexOf('styles.headFixed'), safeArea = text.lastIndexOf("<SafeAreaView edges={['top', 'left', 'right']}", header);
  assert.ok(safeArea >= 0 && button.pos > header, 'the header and its create button inherit the right safe-area edge');
  const { style } = control();
  assert.notEqual(style.position, 'absolute', 'no floating placement that ignores the reserved trailing region');
  assert.ok(style.width >= 44 && style.height >= 44, 'keep the accessible touch target');
});

test('header create keeps its feedback and destination', () => {
  const { press, calls } = control();
  press();
  assert.deepEqual(calls, ['selection', '/meetup-create']);
});
