import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as hashtags from '../src/lib/hashtags.ts';

test('only an explicit AD or advertising hashtag marks a post as an ad', () => {
  assert.equal(typeof hashtags.hasAdLabel, 'function');
  for (const tags of [undefined, [], ['adventure'], ['Canada'], ['TOP25'], ['restaurant']]) assert.equal(hashtags.hasAdLabel(tags), false);
  for (const tags of [['AD'], ['ad'], ['#Ad'], ['ＡＤ'], ['광고'], ['cafe', 'AD']]) assert.equal(hashtags.hasAdLabel(tags), true);
});

test('manual AD selection preserves other hashtags and never silently drops a full selection', () => {
  assert.equal(typeof hashtags.toggleAdLabel, 'function');
  assert.equal(hashtags.toggleAdLabel('카페 디저트'), '카페 디저트 AD');
  assert.equal(hashtags.toggleAdLabel('카페 #ad 디저트 광고'), '카페 디저트');
  assert.equal(hashtags.toggleAdLabel('one two three four five'), 'one two three four five');
  assert.equal(hashtags.toggleAdLabel('one two three four AD'), 'one two three four');
});

test('the real AI draft update preserves a manual AD disclosure within the hashtag limit', () => {
  const ast = ts.createSourceFile('feed-screen.tsx', readFileSync(new URL('../src/components/feed-screen.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let update;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'setHashtagInput' && node.arguments[0]?.getText(ast).includes('draft.hashtags')) update = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(update);
  const exports = {}, draft = { hashtags: ['맛집', '카페', '디저트', '산책', '밴쿠버'] };
  vm.runInNewContext(ts.transpileModule(`exports.update = ${update.getText(ast)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, draft, hasAdLabel: hashtags.hasAdLabel, parseHashtags: hashtags.parseHashtags });
  assert.equal(hashtags.hasAdLabel(hashtags.parseHashtags(exports.update('카페 AD'))), true);
  assert.equal(hashtags.parseHashtags(exports.update('카페 AD')).length, 5);
  assert.equal(hashtags.hasAdLabel(hashtags.parseHashtags(exports.update('카페'))), false);
});

test('the real writer AD control updates the existing hashtag input and plays feedback', () => {
  const ast = ts.createSourceFile('feed-screen.tsx', readFileSync(new URL('../src/components/feed-screen.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let button;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.text === 'analyticsId' && prop.initializer?.text === 'post.ad_label')) button = node;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(button, 'the writer needs the approved manual AD control');
  let input = '카페', feedback = [];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`exports.button = (${button.getText(ast)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Pressable: 'Pressable', ThemedText: 'Text', styles: {}, theme: {}, submitting: false, creatingDraft: false,
    selectedHashtags: ['카페'], MAX_HASHTAGS: 5, hasAdLabel: hashtags.hasAdLabel, toggleAdLabel: hashtags.toggleAdLabel,
    play: kind => feedback.push(kind), setHashtagInput: update => { input = update(input); }, tr: text => text,
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
  });
  assert.equal(exports.button.props.accessibilityRole, 'checkbox');
  exports.button.props.onPress();
  assert.equal(input, '카페 AD'); assert.deepEqual(feedback, ['selection']);
});
