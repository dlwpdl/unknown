import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as api from '../src/lib/admin-partnerships.ts';
import { safeMerchantSourceUrl } from '../src/lib/merchant-source.ts';

const id = '70000000-0000-4000-8000-000000000001', other = '70000000-0000-4000-8000-000000000002';
const revision = '2026-10-15T18:00:00.123456Z';
function editor(component, props, rpc) {
  const state = [], effects = [], calls = [], saved = [], busy = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect(fn, deps) { const slot = cursor++; if (!state[slot] || deps.some((v, i) => v !== state[slot][i])) { effects.push(fn); state[slot] = deps; fn(); } },
  };
  const exported = {};
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/admin-partnerships': api, '@/lib/merchant-source': { safeMerchantSourceUrl },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버' }] },
    '@/lib/supabase': { supabase: { rpc: async (name, args) => { calls.push({ name, args }); return rpc(name, args); } } },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-partnership-editors.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports: exported, require: name => imports[name] ?? {}, Date, Intl, window: { confirm: () => true } });
  const callbacks = { onSaved: value => saved.push(value), onCancel() {}, onDirty() {}, onBusy: value => busy.push(value) };
  return { calls, saved, busy, render() { cursor = 0; return exported[component]({ ...props, ...callbacks }); } };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const field = (tree, label) => nodes(nodes(tree).find(node => node.type === 'label' && text(node).startsWith(label))).find(node => ['input', 'select', 'textarea'].includes(node.type));
const submit = tree => nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('campaign editor saves cents and only mutable fields while preserving the exact server revision', async () => {
  const app = editor('PartnershipEditor', { state: { kind: 'campaign', revision, record: { id, merchant_id: other, merchant_name: '예시 카페', title: '협업', status: 'draft', support_amount_cents: 15000, selected_count: 12, updated_at: revision } } }, async () => ({ data: id, error: null }));
  let tree = app.render();
  assert.equal(field(tree, '지원 제안액').props.value, '150.00');
  field(tree, '지원 제안액').props.onChange({ target: { value: '150.50' } });
  tree = app.render(); submit(tree); await new Promise(setImmediate);
  assert.equal(app.calls[0].args.p_record.support_amount_cents, 15050);
  assert.equal(app.calls[0].args.p_expected_updated_at, revision);
  for (const key of ['merchant_name', 'selected_count', 'updated_at']) assert.equal(key in app.calls[0].args.p_record, false);
  assert.deepEqual(app.saved, [id]);
});

test('rejected creator edits retain the typed profile and give a recoverable conflict message', async () => {
  const app = editor('PartnershipEditor', { state: { kind: 'creator', revision, record: { id, display_name: '기존 이름', profile_url: 'https://example.com/creator' } } }, async () => ({ data: null, error: { message: 'PARTNERSHIP_CHANGED' } }));
  field(app.render(), '크리에이터 이름').props.onChange({ target: { value: '수정한 이름' } });
  submit(app.render()); await new Promise(setImmediate);
  const tree = app.render();
  assert.equal(field(tree, '크리에이터 이름').props.value, '수정한 이름');
  assert.match(text(tree), /최신 자료/); assert.equal(app.calls.length, 1); assert.deepEqual(app.saved, []);
});

test('keyboard or repeated submission cannot duplicate an in-flight save', async () => {
  let finish;
  const app = editor('PartnershipEditor', { state: { kind: 'creator', revision: null, record: { id, display_name: '새 크리에이터', profile_url: 'https://example.com/new' } } }, () => new Promise(resolve => { finish = resolve; }));
  const tree = app.render(); submit(tree); submit(tree);
  assert.equal(app.calls.length, 1); finish({ data: id, error: null }); await new Promise(setImmediate);
  assert.deepEqual(app.saved, [id]); assert.deepEqual(app.busy, [true, false]);
});

test('changing the coupon recipient invalidates the previous confirmation before issuance', async () => {
  const app = editor('CouponIssueForm', { requestId: id, benefit: { id: other, title: '방문 혜택', audience: 'creators', merchant_name: '예시 카페', terms: '25% 할인', expires_on: '2026-11-01' } }, async () => ({ data: id, error: null }));
  let tree = app.render(); nodes(tree).find(node => node.type?.name === 'EntityPicker').props.onPick(id, '첫 대상');
  tree = app.render(); nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  tree = app.render(); nodes(tree).find(node => node.type?.name === 'EntityPicker').props.onPick(other, '다른 대상');
  tree = app.render(); assert.equal(nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
  submit(tree); await new Promise(setImmediate); assert.equal(app.calls.length, 0);
});
