import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { translateUi } from '../src/i18n/index.ts';
import { NOTIFICATION_SETTING_GROUPS } from '../src/lib/notification-preferences.ts';
import { MANNER_QUESTIONS } from '../src/lib/meetup-reviews.ts';

const root = new URL('../', import.meta.url).pathname;
const korean = /[가-힣]/u;
const isTranslation = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['tr', 'translateUi'].includes(node.expression.text);
function tree(file) { return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function nodes(node) { return [node, ...node.getChildren().flatMap(nodes)]; }
function sources(dir = 'src') {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sources(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
function evaluate(node, language, scope = {}) {
  return vm.runInNewContext('(' + node.getText() + ')', { tr: (text, ...values) => translateUi(language, text, ...values), ...scope });
}
function meetupLabel() {
  const component = nodes(tree('src/app/meetup-create.tsx')).find(node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
    && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.text === 'analyticsId' && attr.initializer?.text === 'app_meetup-create.pressable.4'));
  return component.attributes.properties.find(attr => attr.name?.text === 'label').initializer.expression;
}

test('meetup action labels translate fixed Chilling and Meetup terms in both modes', () => {
  const label = meetupLabel();
  // The label names the result regardless of consent; consent stays an inline checkbox.
  for (const hostConsent of [false, true]) {
    const scope = { saving: false, pickingCover: false, kindChosen: true, hostConsent };
    for (const [language, once, group] of [['en', 'Open Chilling', 'Open Group'], ['ko', '칠링 열기', '정기모임 열기']]) {
      assert.equal(evaluate(label, language, { ...scope, event: { kind: 'once' } }), once);
      assert.equal(evaluate(label, language, { ...scope, event: { kind: 'group' } }), group);
    }
  }
  assert.equal(evaluate(label, 'ko', { saving: false, pickingCover: false, kindChosen: false, event: { kind: 'once' } }), '모임 열기');
});

test('the initial meetup question follows the selected language and user text stays verbatim', () => {
  const declaration = nodes(tree('src/app/meetup-create.tsx')).find(node => ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText() === 'question');
  const initial = evaluate(declaration.initializer.arguments[0], 'en');
  assert.equal(typeof initial === 'function' ? initial() : initial, 'What kind of vibe are you hoping for?');
  assert.ok(translateUi('en', '{0} 프로필', '칠링').includes('칠링'));
  assert.equal(translateUi('en', '회원이 작성한 원문'), '회원이 작성한 원문');
});

test('fixed Korean words in UI format arguments are translated before interpolation', () => {
  const failures = [];
  for (const file of sources().filter(file => !file.startsWith('src/i18n/') && !file.includes('/admin/') && !file.includes('/public-web/') && !file.startsWith('src/web/'))) {
    const source = tree(file);
    for (const call of nodes(source).filter(isTranslation)) {
      const offset = call.expression.text === 'translateUi' ? 1 : 0;
      const inspect = node => {
        if (isTranslation(node)) return;
        const text = ts.isStringLiteralLike(node) ? node.text : ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => span.literal.text).join('') : '';
        if (korean.test(text)) { failures.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text}`); return; }
        ts.forEachChild(node, inspect);
      };
      call.arguments.slice(offset + 1).forEach(inspect);
      const key = call.arguments[offset];
      if (key) {
        const inspectKey = node => {
          if (node !== key && ts.isCallExpression(node)) return;
          if (ts.isStringLiteralLike(node) && korean.test(node.text)) assert.notEqual(translateUi('en', node.text), node.text, `${file}: missing English for ${node.text}`);
          ts.forEachChild(node, inspectKey);
        };
        inspectKey(key);
      }
    }
  }
  assert.deepEqual(failures, []);
});


test('notification categories and manner questions render translated app-owned labels', () => {
  const element = nodes(tree('src/app/profile/notifications.tsx')).find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'CategoryRow');
  const attribute = name => element.attributes.properties.find(attr => attr.name?.text === name).initializer.expression;
  for (const row of NOTIFICATION_SETTING_GROUPS.flatMap(group => group.rows)) {
    assert.equal(korean.test(evaluate(attribute('label'), 'en', { row })), false, row.label);
    if (row.description) assert.equal(korean.test(translateUi('en', row.description)), false, row.description);
  }
  for (const file of ['src/components/manner-review.tsx', 'src/app/profile/meetup-reviews.tsx']) {
    const label = nodes(tree(file)).find(node => ts.isJsxExpression(node) && ['label', 'tr(label)'].includes(node.expression?.getText()));
    for (const item of MANNER_QUESTIONS) assert.equal(korean.test(evaluate(label.expression, 'en', item)), false, item.label);
  }
});


function renderedText(file, contains, scope, tag = 'ThemedText') {
  const element = nodes(tree(file)).find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === tag && contains.every(text => node.getText().includes(text)) && (tag !== 'View' || node.openingElement.getText().includes(contains[0])));
  assert.ok(element, file + ': rendered label exists');
  const code = ts.transpileModule('exports.view = (' + element.getText() + ');', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}, jsx = (_type, props) => props.children;
  vm.runInNewContext(code, { exports, View: 'View', ThemedText: 'Text', styles: {}, isAdmin: false, tr: (text, ...values) => translateUi('en', text, ...values), require: () => ({ jsx, jsxs: jsx }), ...scope });
  return [exports.view].flat(Infinity).filter(value => value != null && value !== false).join('');
}

test('meetup city, capacity and slot copy preserves word spacing and uses slot units', () => {
  assert.equal(renderedText('src/app/(tabs)/meetups.tsx', ['styles.cityText'], { city: { name: '밴쿠버' } }), 'In Vancouver');
  assert.equal(renderedText('src/app/meetup-create.tsx', ['styles.bodyText}>{tr(meetupCity?.name'], { meetupCity: { name: '밴쿠버' }, city: { name: '토론토' } }), 'Vancouver');
  assert.equal(renderedText('src/app/meetup-create.tsx', ['Where we’re going'], { meetupCity: { name: '밴쿠버' }, city: { name: '토론토' }, aiCopy: (_ko, en) => en }), 'Where we’re going · Vancouver');
  // Participant02 moved slot counts from discovery into My meetups.
  assert.equal(renderedText('src/components/my-meetups.tsx', ['slots.active', 'slots.limit'], { slots: { active: 0, limit: 3 } }), 'Meetup slots 0/3');
  assert.equal(renderedText('src/components/my-meetups.tsx', ['meetup.room.memberCount'], { CITIES: [{ id: 'toronto', name: '토론토' }], meetup: { cityId: 'toronto', room: { memberCount: 1, capacity: 8 } } }), 'Toronto · 1/8 people');
});


test('profile and business counters use contextual units rather than a shared reviews suffix', () => {
  assert.equal(renderedText('src/app/user/[id].tsx', ['styles.stats', 'publicProfile.storyCount'], { publicProfile: { storyCount: 3, listingCount: 2, completedCount: 1 }, count: String, theme: {} }, 'View'), '3Today2Listings1Marked complete');
  // The business metric now lives in the membership page's help list as one whole-sentence key.
  assert.equal(translateUi('en', '로그인 클릭 회원 {0}명 · 익명 클릭 세션 {1}개', 2, 4), 'Members who clicked: 2 · Anonymous sessions that clicked: 4');
});

test('the meetup slot summary shows the existing administrator exemption without finite counts', () => {
  const scope = { isAdmin: true, slots: { active: 3, limit: 3, available: 0 } };
  assert.equal(renderedText('src/components/my-meetups.tsx', ['slots.active', 'slots.limit'], scope), 'Admin account · unlimited');
});
