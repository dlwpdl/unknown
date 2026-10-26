import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as partnerships from '../src/lib/admin-partnerships.ts';

const id = '70000000-0000-4000-8000-000000000001';
const rows = {
  creators: { id, display_name: '밴쿠버 식탁', city_name: '밴쿠버', category: '맛집', status: 'active', participation_count: 0 },
  campaigns: { id, title: '다이닝 협업', merchant_name: '예시 파스타', city_name: '밴쿠버', status: 'draft', selected_count: 0, applicant_count: 0, team_limit: 20, ends_on: null },
  benefits: { id, title: '크리에이터 다이닝 할인', merchant_name: '예시 파스타', status: 'draft', audience: 'creators', discount_percent: 25, issued_count: 0, redeemed_count: 0, expires_on: null },
};

function view(kind, load, readDeal) {
  const state = [], cleanups = [], requests = [], guard = [];
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanups[slot]?.(); state[slot] = deps; cleanups[slot] = fn(); } },
  };
  const exported = {};
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    '@/lib/admin-partnerships': { ...partnerships, loadCreatorDeal: async (_client, id) => readDeal(id), loadPartnerships: async (_client, ...args) => { requests.push(args); return load(...args); } },
    '@/lib/merchant-source': { merchantEventId: () => id, safeMerchantSourceUrl: value => value.startsWith('https://') ? value : null },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) }, '@/lib/supabase': { supabase: {} },
    './admin-partnership-editors': Object.fromEntries(['PartnershipEditor','CouponIssueForm','CouponActionForm','CreatorDealForm','CreatorDealMerchantForm'].map(name => [name, name])),
    './admin-table-controls': { AdminSearch: 'AdminSearch', AdminSelect: 'AdminSelect' },
    './admin-ui': Object.fromEntries(['AdminButton','AdminCard','AdminDock','AdminFacts','AdminInfo','AdminMoreMenu','AdminPill'].map(name => [name, name])),
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-partnerships.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exported, require: name => imports[name] ?? {}, Date, Intl, window: { confirm: () => true, addEventListener() {}, removeEventListener() {} } });
  const props = { kind, refreshSignal: 0, onUser() {}, onStateChange: value => guard.push(value) };
  return { requests, guard, props, render() { index = 0; return exported.AdminPartnershipsView(props); } };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const page = (kind, selected = null) => ({ kind, rows: [{ ...rows[kind], updated_at: '2026-10-15T18:00:00Z' }], record: selected, more: false, children_more: false, participations: [], coupons: [], events: [] });

for (const kind of ['creators','campaigns','benefits']) test(`${kind} lists human names and opens the exact persisted detail without exposing identifiers`, async () => {
  const screen = view(kind, async (_kind, _query, _offset, selected) => page(kind, selected ? { ...rows[kind], updated_at: '2026-10-15T18:00:00Z' } : null));
  screen.render(); await new Promise(setImmediate);
  let tree = screen.render();
  assert.equal(text(tree).includes(id), false);
  const row = nodes(tree).find(node => node.type === 'button' && node.props?.['data-record-id'] === id);
  assert.ok(row); row.props.onClick({ currentTarget: { focus() {} } });
  screen.render(); await new Promise(setImmediate); tree = screen.render();
  assert.equal(screen.requests.at(-1)[3], id);
  assert.match(text(tree), new RegExp(rows[kind].display_name ?? rows[kind].title));
});

test('a late previous section response cannot display another group’s private records', async () => {
  const pending = [];
  const screen = view('creators', kind => new Promise(resolve => pending.push({kind, resolve})));
  screen.render(); screen.props.kind = 'benefits'; screen.render();
  pending[0].resolve(page('creators')); await new Promise(setImmediate);
  assert.doesNotMatch(text(screen.render()), /밴쿠버 식탁/);
  pending[1].resolve(page('benefits')); await new Promise(setImmediate);
  assert.match(text(screen.render()), /크리에이터 다이닝 할인/);
});

test('protected read failure offers retry without fake empty data or leaked server messages', async () => {
  const screen = view('creators', async () => { throw new Error('private contact database detail'); });
  screen.render(); await new Promise(setImmediate); const tree = screen.render();
  assert.match(text(tree), /다시|확인/);
  assert.doesNotMatch(text(tree), /private contact|등록된.*없/);
  assert.ok(nodes(tree).some(node => node.type === 'button' && /다시/.test(text(node))));
});

test('creator directory has no selection checkboxes without batch actions, and a new search restarts at the first page', async () => {
  const screen = view('creators', async () => ({ ...page('creators'), more: true }));
  screen.render(); await new Promise(setImmediate);
  let tree = screen.render();
  assert.equal(nodes(tree).some(node => node.type === 'input' && node.props.type === 'checkbox'), false);
  nodes(tree).find(node => node.type === 'button' && text(node) === '다음').props.onClick();
  screen.render(); await new Promise(setImmediate); tree = screen.render();
  assert.equal(screen.requests.at(-1)[2], 50);
  nodes(tree).find(node => node.type === 'AdminSearch').props.onChange('토론토');
  tree = screen.render(); nodes(tree).find(node => node.type === 'AdminSearch').props.onSubmit();
  screen.render(); await new Promise(setImmediate);
  assert.equal(screen.requests.at(-1)[1], '토론토'); assert.equal(screen.requests.at(-1)[2], 0);
});

test('a successful mutation keeps its editor until a matching saved record is read back', async () => {
  let available = false;
  const screen = view('campaigns', async (_kind, _query, _offset, selected) => page('campaigns', selected && available ? { ...rows.campaigns, updated_at: '2026-10-15T18:01:00Z' } : null));
  screen.render(); await new Promise(setImmediate);
  let tree = screen.render(); nodes(tree).find(node => node.type === 'button' && text(node).replace(/\s+/g, ' ').trim() === '캠페인 등록').props.onClick({ currentTarget: { focus() {} } });
  tree = screen.render(); let form = nodes(tree).find(node => node.type === 'PartnershipEditor');
  form.props.onDirty(true); await assert.rejects(Promise.resolve().then(() => form.props.onSaved(id)), /PARTNERSHIP_READBACK_REQUIRED/);
  tree = screen.render(); assert.ok(nodes(tree).find(node => node.type === 'PartnershipEditor'));
  assert.doesNotMatch(text(tree), /저장한 내용을 확인했습니다/);
  assert.equal(screen.guard.at(-1).dirty, true);
  available = true; form = nodes(tree).find(node => node.type === 'PartnershipEditor'); await form.props.onSaved(id);
  tree = screen.render(); assert.equal(nodes(tree).some(node => node.type === 'PartnershipEditor'), false);
  assert.match(text(tree), /저장한 내용을 확인했습니다/);
  assert.match(text(nodes(tree).find(node => node.type === 'dialog')), /저장한 내용을 확인했습니다/, 'The live notice must remain inside the active modal.');
  assert.equal(screen.requests.at(-1)[3], id);
});

test('creator directory shows agreed costs and restarts at the first page when the server sort or currency changes', async () => {
  const deal = { id: '70000000-0000-4000-8000-000000000009', creator_id: id, merchant_id: null, merchant_name: null, agreed_on: '2026-10-17', currency: 'CAD', ad_fee_cents: 0, meal_support_cents: 15000, deliverables: '릴스 1개', source_url: '', notes: '합의 근거', created_at: '2026-10-17T22:00:00Z' };
  const screen = view('creators', async () => ({ ...page('creators'), rows: [{ ...rows.creators, latest_deal: deal, deal_count: 1 }], deals: [] }));
  screen.render(); await new Promise(setImmediate);
  let tree = screen.render(), table = nodes(tree).find(node => node.type === 'table');
  assert.match(text(table), /광고비/); assert.match(text(table), /식사 지원 한도/);
  assert.match(text(table), /CAD.*0\.00/); assert.match(text(table), /CAD.*150\.00/); assert.match(text(table), /릴스 1개/);
  nodes(tree).find(node => node.type === 'AdminSelect' && node.props.label === '정렬').props.onChange('fee_desc');
  screen.render(); await new Promise(setImmediate); tree = screen.render();
  assert.equal(screen.requests.at(-1)[2], 0);
  assert.deepEqual({ ...screen.requests.at(-1)[5] }, { sort: 'fee_desc', currency: 'CAD' });
  nodes(tree).find(node => node.type === 'AdminSelect' && node.props.label === '통화').props.onChange('USD');
  screen.render(); await new Promise(setImmediate); screen.render();
  assert.deepEqual({ ...screen.requests.at(-1)[5] }, { sort: 'fee_desc', currency: 'USD' });
});

test('vendor and collaboration day appear beside each dated agreement, with an editor for the existing record', async () => {
  const deal = { id: '70000000-0000-4000-8000-000000000009', creator_id: id, merchant_id: id, merchant_name: '지모코', collaboration_on: '2026-10-24', agreed_on: '2026-10-17', currency: 'CAD', ad_fee_cents: 0, meal_support_cents: 15000, deliverables: '릴스 1개', notes: '방문 예정', created_at: '2026-10-17T22:00:00Z' };
  const screen = view('creators', async (_kind, _query, _offset, selected) => ({ ...page('creators', selected ? rows.creators : null), rows: [{ ...rows.creators, latest_deal: deal, deal_count: 1 }], deals: selected ? [deal] : [] }));
  screen.render(); await new Promise(setImmediate);
  let tree = screen.render(), table = nodes(tree).find(node => node.type === 'table');
  assert.match(text(table), /지모코/); assert.match(text(table), /2026-10-24/);
  nodes(tree).find(node => node.type === 'button' && node.props?.['data-record-id'] === id).props.onClick({ currentTarget: { focus() {} } });
  screen.render(); await new Promise(setImmediate); tree = screen.render();
  nodes(tree).find(node => node.type === 'AdminMoreMenu').props.items.find(item => /비즈니스·협업일/.test(item.label)).onPress();
  const form = nodes(screen.render()).find(node => node.type === 'CreatorDealMerchantForm');
  assert.equal(form.props.deal.id, deal.id);
});

test('a backdated agreement outside the visible history page still requires its exact saved readback', async () => {
  const savedId = '70000000-0000-4000-8000-000000000009', reads = [];
  const screen = view('creators', async (_kind, _query, _offset, selected) => ({ ...page('creators', selected ? rows.creators : null), deals: [] }), async saved => { reads.push(saved); return { id: saved, creator_id: id }; });
  screen.render(); await new Promise(setImmediate);
  let tree = screen.render(); nodes(tree).find(node => node.type === 'button' && node.props?.['data-record-id'] === id).props.onClick({ currentTarget: { focus() {} } });
  screen.render(); await new Promise(setImmediate); tree = screen.render();
  nodes(tree).find(node => node.type === 'AdminButton' && node.props.accessibilityLabel === '합의 조건 기록').props.onPress();
  tree = screen.render(); const form = nodes(tree).find(node => node.type === 'CreatorDealForm');
  assert.equal(form.props.creator.id, id);
  await form.props.onSaved(savedId);
  assert.deepEqual(reads, [savedId]);
  assert.match(text(screen.render()), /저장한 내용을 확인했습니다/);
});

test('creator workspace keeps six scan columns and separates collaboration history from the full profile', async () => {
  const screen = view('creators', async (_kind, _query, _offset, selected) => page('creators', selected ? rows.creators : null));
  screen.render(); await new Promise(setImmediate); let tree = screen.render();
  const table = nodes(tree).find(n => n.type === 'table');
  assert.equal(nodes(table).filter(n => n.type === 'th').length, 6);
  nodes(tree).find(n => n.type === 'button' && n.props?.['data-record-id'] === id).props.onClick({ currentTarget: { focus() {} } });
  screen.render(); await new Promise(setImmediate); tree = screen.render();
  assert.equal(nodes(tree).find(n => n.props?.className === 'creator-detail-profile').props.hidden, true);
  nodes(tree).find(n => n.type === 'button' && text(n) === '프로필·연락처').props.onClick();
  assert.equal(nodes(screen.render()).find(n => n.props?.className === 'creator-detail-profile').props.hidden, false);
});

test('creator navigation stays outside the scrolling detail content', async () => {
  const screen = view('creators', async (_kind, _query, _offset, selected) => page('creators', selected ? rows.creators : null));
  screen.render(); await new Promise(setImmediate);
  nodes(screen.render()).find(n => n.type === 'button' && n.props?.['data-record-id'] === id).props.onClick({ currentTarget: { focus() {} } });
  screen.render(); await new Promise(setImmediate);
  const tree = screen.render(), body = nodes(tree).find(n => n.props?.className === 'partnership-dialog-body');
  const nav = nodes(tree).find(n => n.type === 'nav' && n.props['aria-label'] === '크리에이터 상세 화면');
  const chrome = nodes(tree).find(n => n.props?.className === 'partnership-detail-chrome');
  assert.ok(nav && chrome); assert.ok(nodes(chrome).includes(nav)); assert.ok(!nodes(body).includes(nav));
  assert.ok(nodes(chrome).some(n => n.type === 'button' && n.props['aria-label'] === '상세 닫기'));
});

for (const kind of ['campaigns', 'benefits']) test(`${kind} uses the shared workspace and labels every directory field on narrow screens`, async () => {
  const screen = view(kind, async () => page(kind));
  screen.render(); await new Promise(setImmediate); const tree = screen.render();
  assert.match(tree.props.className, /partner-workspace/);
  const table = nodes(tree).find(n => n.type === 'table'), cells = nodes(table).filter(n => n.type === 'td');
  assert.deepEqual(cells.map(n => n.props['data-label']), [kind === 'campaigns' ? '캠페인' : '혜택', '비즈니스', '상태', kind === 'campaigns' ? '선정 팀' : '발급·사용']);
});
