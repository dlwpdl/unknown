import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as api from '../src/lib/admin-partnerships.ts';
import { safeMerchantSourceUrl } from '../src/lib/merchant-source.ts';

const id = '70000000-0000-4000-8000-000000000001', other = '70000000-0000-4000-8000-000000000002';
const revision = '2026-10-15T18:00:00.123456Z';
function editor(component, props, rpc, readback = async () => {}) {
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
  vm.runInNewContext(source, { exports: exported, require: name => imports[name] ?? {}, Date, Intl, Error, window: { confirm: () => true } });
  const callbacks = { onSaved: async value => { saved.push(value); await readback(value); }, onCancel() {}, onDirty() {}, onBusy: value => busy.push(value) };
  return { calls, saved, busy, render() { cursor = 0; return exported[component]({ ...props, ...callbacks }); } };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const field = (tree, label) => nodes(nodes(tree).find(node => node.type === 'label' && text(node).startsWith(label))).find(node => ['input', 'select', 'textarea'].includes(node.type));
const submit = tree => nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('creator details retain observed audience labels and select a secondary platform without dropping contact or revision', async () => {
  const profiles = [
    { platform: 'Instagram', url: 'https://instagram.com/creator/', followers: '1.4만', checked_on: '2026-10-15' },
    { platform: 'YouTube', url: 'https://youtube.com/@creator' },
  ];
  const app = editor('PartnershipEditor', { state: { kind: 'creator', revision, record: { id, display_name: '크리에이터', profile_url: 'https://www.instagram.com/Creator', platforms: profiles, contact_name: '담당자', contact: 'creator@example.test', content_summary: '맛집 영상', activity_regions: '밴쿠버 · 버나비', notes: '다음 제안 때 일정 확인' } } }, async () => ({ data: id, error: null }));
  let tree = app.render();
  assert.equal(nodes(tree).filter(node => node.type === 'input' && node.props.type === 'radio' && node.props.checked).length, 1);
  nodes(tree).filter(node => node.type === 'input' && node.props.type === 'radio')[1].props.onChange();
  submit(app.render()); await new Promise(setImmediate);
  assert.equal(app.calls.length, 1);
  const { p_record: record, p_expected_updated_at: expected } = app.calls[0].args;
  assert.equal(expected, revision); assert.equal(record.profile_url, profiles[1].url);
  assert.equal(record.platforms[0].followers, '1.4만'); assert.equal(record.platforms[0].checked_on, '2026-10-15');
  assert.equal(record.platforms[1].followers, ''); assert.equal(record.platforms[1].checked_on, null);
  for (const key of ['contact_name', 'contact', 'content_summary', 'activity_regions', 'notes']) assert.equal(record[key], { contact_name: '담당자', contact: 'creator@example.test', content_summary: '맛집 영상', activity_regions: '밴쿠버 · 버나비', notes: '다음 제안 때 일정 확인' }[key]);
});

test('a newly typed platform URL updates its inferred label while preserving custom labels', () => {
  const app = editor('PartnershipEditor', { state: { kind: 'creator', revision: null, record: { id } } }, async () => ({ data: id, error: null }));
  nodes(app.render()).find(node => node.type === 'button' && text(node) === '플랫폼 추가').props.onClick();
  field(app.render(), '프로필 링크').props.onChange({ target: { value: 'h' } });
  field(app.render(), '프로필 링크').props.onChange({ target: { value: 'https://youtube.com/@creator' } });
  assert.equal(field(app.render(), '플랫폼 이름').props.value, 'YouTube');
  field(app.render(), '플랫폼 이름').props.onChange({ target: { value: '메인 영상 채널' } });
  field(app.render(), '프로필 링크').props.onChange({ target: { value: 'https://youtube.com/@newcreator' } });
  assert.equal(field(app.render(), '플랫폼 이름').props.value, '메인 영상 채널');
});

test('editing a legacy representative preserves all twenty separately linked platforms', async () => {
  const profiles = Array.from({ length: 20 }, (_, i) => ({ platform: '웹사이트', url: `https://example.com/account-${i}`, followers: '', checked_on: null }));
  const app = editor('PartnershipEditor', { state: { kind: 'creator', revision, record: { id, display_name: '크리에이터', profile_url: 'https://example.com/primary', platforms: profiles } } }, async () => ({ data: id, error: null }));
  field(app.render(), '담당자 이름').props.onChange({ target: { value: '확인한 담당자' } });
  submit(app.render()); await new Promise(setImmediate);
  assert.equal(app.calls[0].args.p_record.platforms.length, 20);
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].args.p_record.platforms)), profiles);
  assert.equal(app.calls[0].args.p_record.profile_url, 'https://example.com/primary');
});

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

test('an acknowledged save retains the draft after failed readback and retries only the read', async () => {
  let available = false;
  const app = editor('PartnershipEditor', { state: { kind: 'creator', revision: null, record: { id, display_name: '작성한 이름', profile_url: 'https://example.com/new' } } }, async () => ({ data: id, error: null }), async () => { if (!available) throw new Error('offline'); });
  submit(app.render()); await new Promise(setImmediate);
  let tree = app.render();
  assert.equal(field(tree, '크리에이터 이름').props.value, '작성한 이름');
  assert.match(text(tree), /서버.*저장|저장.*완료/);
  assert.match(text(tree), /저장 내용 다시 확인/);
  assert.equal(nodes(tree).find(node => node.type === 'fieldset').props.disabled, true);
  assert.equal(app.calls.length, 1);
  available = true; submit(tree); await new Promise(setImmediate); tree = app.render();
  assert.equal(app.calls.length, 1, 'Readback retries must never replay the acknowledged mutation.');
  assert.deepEqual(app.saved, [id, id]);
  assert.equal(nodes(tree).filter(node => node.props?.role === 'alert').length, 0);
});

test('a coupon action acknowledged before a read failure cannot be submitted twice', async () => {
  let available = false;
  const app = editor('CouponActionForm', { coupon: { id, updated_at: revision, recipient_name: '수령인', benefit_title: '방문 혜택' }, action: 'redeem' }, async () => ({ data: id, error: null }), async () => { if (!available) throw new Error('offline'); });
  let tree = app.render(); field(tree, '확인 내용').props.onChange({ target: { value: '방문과 혜택 적용을 확인함' } });
  tree = app.render(); nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  submit(app.render()); await new Promise(setImmediate); tree = app.render();
  assert.equal(field(tree, '확인 내용').props.value, '방문과 혜택 적용을 확인함');
  assert.equal(field(tree, '확인 내용').props.disabled, true);
  assert.match(text(tree), /저장 내용 다시 확인/);
  available = true; submit(tree); await new Promise(setImmediate);
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].name, 'act_admin_benefit_coupon');
  assert.deepEqual(app.saved, [id, id]);
});

test('changing the coupon recipient invalidates the previous confirmation before issuance', async () => {
  const app = editor('CouponIssueForm', { requestId: id, benefit: { id: other, title: '방문 혜택', audience: 'creators', merchant_name: '예시 카페', terms: '25% 할인', expires_on: '2026-11-01' } }, async () => ({ data: id, error: null }));
  let tree = app.render(); nodes(tree).find(node => node.type?.name === 'EntityPicker').props.onPick(id, '첫 대상');
  tree = app.render(); nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  tree = app.render(); nodes(tree).find(node => node.type?.name === 'EntityPicker').props.onPick(other, '다른 대상');
  tree = app.render(); assert.equal(nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false);
  submit(tree); await new Promise(setImmediate); assert.equal(app.calls.length, 0);
});
