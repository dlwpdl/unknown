import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { translateUi } from '../src/i18n/index.ts';

const source = ts.createSourceFile('map.tsx', readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let match;
  const visit = node => { if (!match && predicate(node)) match = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(match, 'the actual map handler or error surface must exist'); return match;
}
const locate = find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'locate').initializer.getText(source);
const submit = find(node => ts.isJsxAttribute(node) && node.name.getText(source) === 'onPress' && node.initializer?.expression?.getText(source).includes('setDateError(')).initializer.expression.getText(source);
function feedback(state) {
  return find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'ThemedText'
    && node.children.some(child => ts.isJsxExpression(child) && [state, `tr(${state})`].includes(child.expression?.getText(source)))).getText(source);
}
function mount() {
  let language = 'en', permissionCalls = 0;
  const context = {
    exports: {}, Error, Promise, Date, setTimeout, clearTimeout, styles: {}, ThemedText: 'Text',
    AppState: { currentState: 'active' }, locating: false, locationRevision: { current: 0 },
    locationError: '', dateError: '', dateDraft: 'invalid', city: { id: 'vancouver' },
    play() {}, setLocating() {},
    setLocationError: value => { context.locationError = value; }, setDateError: value => { context.dateError = value; },
    Location: { requestForegroundPermissionsAsync: async () => { permissionCalls++; return { granted: false }; } },
    discoveryDays() { throw new Error('INVALID_MAP_DATE'); },
    tr: (text, ...values) => translateUi(language, text, ...values),
    require: () => ({ jsx: (_type, props) => props.children }),
  };
  const run = text => vm.runInNewContext('(function () {' + ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText + '})();', context);
  run(`exports.locate = ${locate}; exports.submit = ${submit};`);
  return { context, setLanguage: value => { language = value; }, permissionCalls: () => permissionCalls,
    render: state => { run(`exports.rendered = (${feedback(state)});`); return context.exports.rendered; } };
}

test('map permission feedback switches language on the same view without another GPS request', async () => {
  const view = mount();
  await view.context.exports.locate();
  assert.equal(view.render('locationError'), 'Location access is off. You can still browse the selected city.');
  view.setLanguage('ko');
  assert.equal(view.render('locationError'), '위치 권한이 꺼져 있어요. 선택한 도시의 지도는 계속 볼 수 있어요.');
  view.setLanguage('en');
  assert.equal(view.render('locationError'), 'Location access is off. You can still browse the selected city.');
  assert.equal(view.permissionCalls(), 1);
});

test('invalid map date feedback switches language while preserving the entered draft', () => {
  const view = mount();
  view.context.exports.submit();
  assert.equal(view.render('dateError'), 'Enter a date within the next year in YYYY-MM-DD format.');
  view.setLanguage('ko');
  assert.equal(view.render('dateError'), '오늘부터 1년 안의 날짜를 YYYY-MM-DD로 입력해 주세요.');
  view.setLanguage('en');
  assert.equal(view.render('dateError'), 'Enter a date within the next year in YYYY-MM-DD format.');
  assert.equal(view.context.dateDraft, 'invalid');
});
