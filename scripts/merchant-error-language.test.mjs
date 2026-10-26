import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { tr, setActiveLanguage } from '../src/i18n/index.ts';

const source = ts.createSourceFile('merchant-workspace.tsx', readFileSync(new URL('../src/components/merchant-workspace.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let normalize;
let errorCodes;
const alerts = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'errorText') {
    normalize = node.parent.parent.getText(source);
    errorCodes = [...normalize.matchAll(/\b([A-Z_]{4,}):/g)].map(match => match[1]).concat('UNKNOWN');
  }
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'ThemedText'
    && node.children.some(child => ts.isJsxExpression(child) && /^(?:error|tr\(error\))$/.test(child.expression?.getText(source) ?? ''))) alerts.push(node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

test('every merchant error surface translates owned recovery copy while leaving draft text unchanged', () => {
  assert.ok(alerts.length >= 3);
  const exports = {};
  vm.runInNewContext(compile(normalize + '\nexports.errorText = errorText;'), { exports, Error, MAX_POST_IMAGES: 20 });
  const error = exports.errorText(new Error('DRAFT_FAILED'));
  setActiveLanguage('en');
  try {
    for (const markup of alerts) {
      const surface = {};
      vm.runInNewContext(compile('exports.render = () => (' + markup + ');'), { exports: surface, error, tr, ThemedText: 'Text', require: () => ({ jsx: (_type, props) => props }) });
      assert.equal(surface.render().children, 'Couldn’t create the draft. Your input is still here. Try again in a moment.');
    }
    for (const code of errorCodes) {
      const ownedMessage = exports.errorText(new Error(code));
      assert.doesNotMatch(tr(ownedMessage), /[가-힣]/, code);
    }
    assert.equal(tr('회원이 직접 쓴 원고'), '회원이 직접 쓴 원고');
  } finally { setActiveLanguage('ko'); }
});
