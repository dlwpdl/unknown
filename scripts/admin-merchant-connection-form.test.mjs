import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as adminMerchants from '../src/lib/admin-merchants.ts';

const merchants = ['first', 'second'].map((id, i) => ({ id, name: `업체 ${i + 1}`, city_id: 'vancouver', city_name: '밴쿠버', timezone: 'America/Vancouver', industry: '카페', services: '', address: '', contact: `contact${i + 1}@example.test`, status: 'trial', consent: 'pending', consent_note: '', trial_ends_at: null, post_count: i + 1, report_count: 0, updated_at: '2026-10-09T00:00:00Z' }));

function app() {
  const state = [], refs = [], feedback = [], prompts = [];
  let stateIndex = 0, refIndex = 0, allowReplace = false;
  state[5] = { key: ':0:0:0', rows: merchants, more: false, owners: { owned: '벤더 회원' } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-merchants.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, Date, window: { confirm(message) { prompts.push(message); return allowReplace; } }, require(name) {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('.png')) return 'preview-logo';
    if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    if (name === 'react') return {
      useEffect() {},
      useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial }; },
      useState: initial => { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    };
    if (name === 'expo-asset') return { Asset: { fromModule: uri => ({ uri }) } };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
    if (name === '@/lib/mock') return { CITIES: [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', timezone: 'America/Vancouver' }], TAGS: [] };
    if (name === '@/lib/merchant-source') return { merchantEventId: () => 'new-merchant' };
    if (name === '@/lib/admin-merchants') return adminMerchants;
    if (name === './admin-ai-connection') return { AdminAiConnection: 'AdminAiConnection' };
    if (name === './admin-merchant-connections') return { AdminMerchantConnections: 'AdminMerchantConnections' };
    return {};
  } });
  const render = () => { stateIndex = refIndex = 0; return exports.AdminMerchantsView({ refreshSignal: 0 }); };
  return { render, feedback, prompts, allow() { allowReplace = true; }, detail() {
    const merchant = merchants[0], period = state[7];
    state[8] = { key: `${merchant.id}:${period.start}:${period.end}:0:0`, data: { merchant, posts: [], reports: [], available_posts: [], metrics: { linked_posts: 0, new_posts: 0, displayed_views: 0, first_reads: 0, unique_readers: 0, source_clicks: 0, member_clickers: 0, anonymous_sessions: 0 } } };
  }, refreshMerchant(next) {
    state[5] = { ...state[5], rows: state[5].rows.map(merchant => merchant.id === next.id ? next : merchant) };
  } };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return [node?.props?.children].flat(Infinity).map(text).join(' ');
}


const merchantButton = (view, name) => nodes(view.render()).find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && text(n).trim().startsWith(name));
const connectionForm = view => nodes(view.render()).find(n => n.type === 'AdminMerchantConnections');

test('period and directory refresh keep the reviewed connection form mounted with its existing revision', () => {
  const view = app(); merchantButton(view, '업체 1').props.onClick(); view.detail();
  const original = connectionForm(view); original.props.onDirty(true);
  nodes(nodes(view.render()).find(n => n.type === 'form' && n.props.className === 'merchant-period')).find(n => n.type === 'input' && n.props.type === 'date').props.onChange({ target: { value: '2026-10-01' } });
  assert.equal(connectionForm(view)?.key, original.key);
  assert.equal(connectionForm(view)?.props.merchant, original.props.merchant);
  nodes(view.render()).find(n => n.type === 'form' && n.props.className === 'merchant-search').props.onSubmit({ preventDefault() {} });
  assert.equal(connectionForm(view)?.key, original.key);
  assert.equal(connectionForm(view)?.props.merchant, original.props.merchant);
  assert.equal(view.prompts.length, 0);
});

test('an unsaved connection blocks business replacement and profile save until discard is confirmed', () => {
  const view = app(); merchantButton(view, '업체 1').props.onClick(); view.detail();
  const original = connectionForm(view); original.props.onDirty(true);
  merchantButton(view, '업체 2').props.onClick();
  assert.equal(view.prompts.length, 1); assert.equal(connectionForm(view)?.key, original.key);
  nodes(view.render()).find(n => n.type === 'form' && n.props.className === 'merchant-section').props.onSubmit({ preventDefault() {} });
  assert.equal(view.prompts.length, 2); assert.equal(connectionForm(view)?.key, original.key);
  view.allow(); merchantButton(view, '업체 2').props.onClick();
  assert.equal(connectionForm(view), undefined);
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 2'));
});
