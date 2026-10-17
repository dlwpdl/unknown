import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as api from '../src/lib/admin-partnerships.ts';
const merchant = { id: '70000000-0000-4000-8000-000000000001', name: '지모코' };
const creator = { id: '70000000-0000-4000-8000-000000000002', display_name: '크리에이터' };
const deal = { id: '70000000-0000-4000-8000-000000000003', creator_id: creator.id, merchant_id: null, merchant_name: null, agreed_on: '2026-10-17', collaboration_on: '2026-10-24', currency: 'CAD', ad_fee_cents: 0, meal_support_cents: 15000, deliverables: '릴스 1개', notes: '방문 예정', updated_at: '2026-10-17T22:00:00Z' };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
function screen() {
  const state = [], cleanups = [], dirty = [], busy = [], reads = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!state[i] || deps.some((v, j) => v !== state[i][j])) { cleanups[i]?.(); state[i] = deps; cleanups[i] = fn(); } },
  };
  const exported = {}, linked = { ...deal, merchant_id: merchant.id, merchant_name: merchant.name, creator_name: creator.display_name, creator_profile_url: 'https://example.com/creator' };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    './admin-partnership-editors': { CreatorDealForm: 'CreatorDealForm', CreatorDealMerchantForm: 'CreatorDealMerchantForm', EntityPicker: 'EntityPicker' },
    '@/lib/admin-partnerships': { ...api, loadMerchantCreatorDeals: async () => ({ rows: [linked], more: false }), loadCreatorDeal: async (_client, id) => { reads.push(id); return linked; }, loadPartnerships: async () => ({ record: creator, deals: [deal, { ...deal, id: 'other', merchant_id: 'other-vendor', merchant_name: '다른 벤더' }], children_more: false }) },
    '@/lib/merchant-source': { merchantEventId: () => 'new-request' }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) }, '@/lib/supabase': { supabase: {} },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-merchant-creators.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exported, require: name => imports[name] ?? {}, window: { confirm: () => true } });
  return { dirty, busy, reads, render() { cursor = 0; return exported.AdminMerchantCreators({ merchant, onDirty: value => dirty.push(value), onBusy: value => busy.push(value) }); } };
}
test('vendor direction displays real costs and connects the same existing agreement without taking another vendor history', async () => {
  const app = screen(); app.render(); await new Promise(setImmediate);
  let tree = app.render(); assert.match(text(tree), /CAD.*0\.00/); assert.match(text(tree), /2026-10-24/);
  nodes(tree).find(n => n.type === 'button' && text(n) === '크리에이터 연결').props.onClick();
  nodes(app.render()).find(n => n.type === 'EntityPicker').props.onPick(creator.id, creator.display_name);
  app.render(); await new Promise(setImmediate); tree = app.render();
  assert.equal(nodes(tree).find(n => n.type === 'button' && text(n) === '다른 벤더와의 협업').props.disabled, true);
  nodes(tree).find(n => n.type === 'button' && text(n) === '이 이력에 연결').props.onClick();
  const form = nodes(app.render()).find(n => n.type === 'CreatorDealMerchantForm');
  assert.equal(form.props.deal.id, deal.id); assert.equal(form.props.initialMerchant.id, merchant.id);
  form.props.onDirty(true); form.props.onBusy(true); assert.deepEqual(app.dirty, [true]); assert.deepEqual(app.busy, [true]);
  await form.props.onSaved(deal.id);
  assert.deepEqual(app.reads, [deal.id]); assert.match(text(app.render()), /연결된 협업 이력을 확인/);
});
