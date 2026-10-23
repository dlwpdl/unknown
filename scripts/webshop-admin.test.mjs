import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  parseWebshopConfig, parseWebshopReport, loadAdminWebshops, saveAdminWebshop,
  importAdminWebshopOrders, webshopMoney, webshopError,
} from '../src/lib/admin-webshops.ts';

const merchantId = '70000000-0000-4000-8000-000000000001';
const reportId = '70000000-0000-4000-8000-000000000002';
const config = () => ({ cityId: 'vancouver', enabled: true, provider: 'uber', url: 'https://www.order.store/ca/store/jimoco/ZFgz2GjZSAuhlUYeO1fupA', placeKeys: ['partner:jimoco-coquitlam'], comparisons: [{ id: 'pasta', name: 'Pasta', uberCents: 2400, webCents: 1900 }], verifiedAt: '2026-10-22T10:00:00Z', promoCode: null, checkoutComparison: null, commissionBps: 2500, commissionBasisConfirmed: false, commissionScope: null, updatedAt: null });
const order = () => ({ externalOrderId: 'provider-123', orderedAt: '2026-10-22T12:00:00Z', currency: 'CAD', foodSubtotalCents: 2400, refundCents: 0, status: 'completed', attribution: 'provider_report' });
const report = () => ({ reportId, periodStart: '2026-10-22T00:00:00Z', periodEnd: '2026-10-23T00:00:00Z', evidence: 'Merchant export report ref #123 (no customer data)', orders: [order()] });
const parseConfig = value => parseWebshopConfig(JSON.stringify(value));
const parseReport = value => parseWebshopReport(JSON.stringify(value));

test('configuration keeps branch keys, revision, unknown commission basis and missing checkout distinct', () => {
  assert.deepEqual(parseConfig(config()), config());
  const unlinked = { ...config(), enabled: false, url: null, comparisons: [], verifiedAt: null };
  assert.equal(parseConfig(unlinked).placeKeys[0], 'partner:jimoco-coquitlam');
  for (const url of ['http://www.order.store/ca/store/a/b', 'https://www.order.store.evil.test/ca/store/a/b', 'https://user@www.order.store/ca/store/a/b', 'https://www.order.store/ca/store/a/b?redirect=evil', 'https://www.order.store/ca/store/a/b#private']) {
    assert.throws(() => parseConfig({ ...config(), url }));
  }
  for (const comparison of [{ ...config().comparisons[0], webCents: 19.5 }, { ...config().comparisons[0], uberCents: 0 }, { ...config().comparisons[0], address: 'private' }]) {
    assert.throws(() => parseConfig({ ...config(), comparisons: [comparison] }));
  }
  assert.throws(() => parseConfig({ ...config(), placeKeys: ['Jimoco'] }));
  assert.throws(() => parseConfig({ ...config(), comparisons: [config().comparisons[0], config().comparisons[0]] }));
});

test('checkout quotes require explicit components, matching totals and same conditions', () => {
  const quote = { itemsCents: 5800, deliveryCents: 0, serviceCents: 0, discountCents: 0, taxCents: 290, tipCents: 0, totalCents: 6090 };
  const checkoutComparison = { verifiedAt: config().verifiedAt, fulfillment: 'pickup', basketLabel: 'Same three menus', sameConditionsConfirmed: true, uber: quote, webshop: quote };
  assert.equal(parseConfig({ ...config(), checkoutComparison }).checkoutComparison.webshop.totalCents, 6090);
  assert.throws(() => parseConfig({ ...config(), checkoutComparison: { ...checkoutComparison, sameConditionsConfirmed: false } }));
  assert.throws(() => parseConfig({ ...config(), checkoutComparison: { ...checkoutComparison, webshop: { ...quote, totalCents: 0 } } }));
  const { deliveryCents, ...incomplete } = quote;
  assert.throws(() => parseConfig({ ...config(), checkoutComparison: { ...checkoutComparison, webshop: incomplete } }));
});

test('report import rejects unsafe money, unsupported currencies, PII columns and inconsistent refunds', () => {
  assert.equal(parseReport(report()).orders[0].foodSubtotalCents, 2400);
  const refunds = [{ status: 'refunded', refundCents: 2400 }, { status: 'partial_refund', refundCents: 200 }, { status: 'cancelled', refundCents: 0 }];
  for (const refund of refunds) assert.equal(parseReport({ ...report(), orders: [{ ...order(), ...refund }] }).orders[0].status, refund.status);
  for (const invalid of [{ currency: 'USD' }, { foodSubtotalCents: -1 }, { foodSubtotalCents: '2400' }, { foodSubtotalCents: 999999999 }, { refundCents: 2401 }, { refundCents: 1 }, { status: 'refunded', refundCents: 1 }, { status: 'partial_refund', refundCents: 0 }, { customerEmail: 'private@example.test' }, { orderedAt: '2026-10-24T12:00:00Z' }]) {
    assert.throws(() => parseReport({ ...report(), orders: [{ ...order(), ...invalid }] }));
  }
  assert.throws(() => parseReport({ ...report(), evidence: '' }));
  assert.throws(() => parseReport({ ...report(), orders: [order(), order()] }));
  assert.throws(() => parseReport({ ...report(), periodStart: report().periodEnd }));
  assert.equal(parseReport({ ...report(), orders: [] }).orders.length, 0, 'An evidence-backed zero-order report is distinct from no report.');
  assert.throws(() => parseWebshopReport('{bad json'), /JSON/);
});

test('RPC writes keep exact idempotency identifiers and optimistic revision; errors do not become zero data', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'get_admin_webshops' ? { stores: [], totals: {}, daily: [], breakdown: [], orders: [] } : name === 'save_admin_webshop' ? args.p_config : { reportId, imported: 1, duplicates: 0 }, error: null }; } };
  await loadAdminWebshops(client, 7, merchantId);
  assert.deepEqual(calls.at(-1), { name: 'get_admin_webshops', args: { p_days: 7, p_merchant_id: merchantId } });
  const revision = '2026-10-22T12:00:00Z';
  await saveAdminWebshop(client, merchantId, { ...config(), updatedAt: revision });
  assert.equal(calls.at(-1).args.p_config.updatedAt, revision);
  await importAdminWebshopOrders(client, merchantId, report());
  assert.deepEqual(calls.at(-1), { name: 'import_admin_webshop_orders', args: { p_merchant_id: merchantId, p_report_id: reportId, p_period_start: report().periodStart, p_period_end: report().periodEnd, p_evidence: report().evidence, p_orders: report().orders } });
  await assert.rejects(loadAdminWebshops({ rpc: async () => ({ data: null, error: { message: 'AAL2_REQUIRED' } }) }, 30), /AAL2/);
  assert.match(webshopError(new Error('MFA_REQUIRED')), /인증/);
  assert.doesNotMatch(webshopError(new Error('secret table stack')), /secret/);
  assert.equal(webshopMoney(null), '확인 불가');
  assert.match(webshopMoney(0), /0\.00/);
  assert.match(webshopMoney(120, 'USD'), /지원하지 않는 통화/);
});

test('admin registration has one standalone panel and preserves existing login/MFA', () => {
  const admin = readFileSync(new URL('../src/lib/admin.ts', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../src/components/admin/admin-screen.tsx', import.meta.url), 'utf8');
  assert.match(admin, /id: 'webshops', label: '웹샵 성과'/);
  assert.match(screen, /AdminWebshopsView/);
  assert.match(screen, /<LoginPanel/);
});

const webshops = await import('../src/lib/admin-webshops.ts');
const { default: ts } = await import('typescript');
const { default: vm } = await import('node:vm');
const fixtureStore = { ...config(), updatedAt: '2026-10-22T10:00:00Z', merchantId, name: '테스트 비즈니스' };
const fixtureData = () => ({ generatedAt: '2026-10-23T00:00:00Z', stores: [fixtureStore], totals: { sheetViews: 3, clicks: 2, sessions: 1, orderDataAvailable: false, verifiedOrders: null, netRevenueCents: null, estimatedCommissionCents: null, currency: null, attributedVerifiedOrders: null, attributedNetRevenueCents: null }, daily: [], breakdown: [], orders: [] });
const treeNodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(treeNodes) : treeNodes(value))];
const treeText = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(treeText).join(' ') : treeText(tree.props?.children);
const tick = () => new Promise(setImmediate);
function webshopView(load, services = {}) {
  const root = { state: [], cleanups: [] };
  let frame = root, index = 0;
  const hooks = {
    useState(initial) { const target = frame, slot = index++; if (!(slot in target.state)) target.state[slot] = typeof initial === 'function' ? initial() : initial; return [target.state[slot], next => { target.state[slot] = typeof next === 'function' ? next(target.state[slot]) : next; }]; },
    useRef(initial) { const slot = index++; if (!(slot in frame.state)) frame.state[slot] = { current: initial }; return frame.state[slot]; },
    useEffect(fn, deps) { const slot = index++; if (!frame.state[slot] || deps.some((value, i) => value !== frame.state[slot][i])) { frame.cleanups[slot]?.(); frame.state[slot] = deps; frame.cleanups[slot] = fn(); } },
  };
  const exported = {}, guard = [], imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { Platform: { OS: 'web' }, View: 'View' }, '@/constants/theme': { Spacing: { four: 16 } }, '@/constants/design-system': { Typography: { screenTitle: { lineHeight: 36 }, section: { lineHeight: 26 } } },
    '@/lib/admin-webshops': { ...webshops, loadAdminWebshops: (_client, ...args) => load(...args), ...services },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) }, '@/lib/supabase': { supabase: {} }, './admin-table-controls': { AdminSelect: 'AdminSelect' },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-webshops.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exported, require: name => imports[name] ?? {}, Date, Intl, Set, crypto: globalThis.crypto, window: { confirm: () => true, addEventListener() {}, removeEventListener() {} } });
  const props = { localPreview: false, refreshSignal: 0, onStateChange: state => guard.push(state) };
  return { props, guard, render() { frame = root; index = 0; return exported.AdminWebshopsView(props); }, mount(node) { const child = { state: [], cleanups: [] }; return { render() { frame = child; index = 0; return node.type(node.props); } }; } };
}

test('mounted panel separates real traffic from unavailable financials and hides failed private reads', async () => {
  const view = webshopView(async () => fixtureData());
  assert.match(treeText(view.render()), /불러오는 중/);
  await tick(); const tree = view.render();
  assert.match(treeText(tree), /보고서 대기/);
  assert.doesNotMatch(treeText(tree), /CA\$0\.00/);
  assert.ok(treeNodes(tree).some(node => node.type === 'strong' && node.props.children === '3'));
  const failed = webshopView(async () => { throw new Error('private schema credential failure'); });
  failed.render(); await tick();
  assert.match(treeText(failed.render()), /다시 시도/);
  assert.doesNotMatch(treeText(failed.render()), /private schema|credential/);
});

test('a slower previous business response cannot replace the current filter', async () => {
  const pending = [];
  const view = webshopView((days, selected) => new Promise(resolve => pending.push({ days, selected, resolve })));
  view.render();
  const select = treeNodes(view.render()).find(node => node.type === 'AdminSelect' && node.props.label === '비즈니스');
  select.props.onChange(merchantId); view.render();
  pending[0].resolve(fixtureData()); await tick();
  assert.match(treeText(view.render()), /불러오는 중/);
  pending[1].resolve(fixtureData()); await tick();
  assert.match(treeText(view.render()), /보고서 대기/);
  assert.equal(pending[1].selected, merchantId);
});

test('config form saves the exact branch revision and preserves absent checkout data', async () => {
  const writes = [];
  const view = webshopView(async () => fixtureData(), { saveAdminWebshop: async (_client, id, config) => { writes.push({ id, config }); return { ...fixtureStore, ...config, updatedAt: '2026-10-23T01:00:00Z' }; } });
  view.render(); await tick();
  let tree = view.render();
  const edit = treeNodes(tree).find(node => node.type === 'button' && treeText(node) === '연결 관리');
  edit.props.onClick({ currentTarget: { focus() {} } }); tree = view.render();
  const editor = treeNodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'ConfigEditor');
  const child = view.mount(editor);
  const form = child.render();
  form.props.onSubmit({ preventDefault() {} }); await tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, merchantId);
  assert.equal(writes[0].config.updatedAt, fixtureStore.updatedAt);
  assert.equal(writes[0].config.checkoutComparison, null);
});

test('report form requires preflight and explicit evidence confirmation and keeps its UUID on failed retry', async () => {
  const writes = [];
  const view = webshopView(async () => fixtureData(), { importAdminWebshopOrders: async (_client, id, input) => { writes.push({ id, input }); throw new Error('temporary private database failure'); } });
  view.render(); await tick();
  let tree = view.render();
  treeNodes(tree).find(node => node.type === 'button' && treeText(node) === '보고서 가져오기').props.onClick({ currentTarget: { focus() {} } });
  tree = view.render();
  const editor = treeNodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'ReportEditor');
  const child = view.mount(editor);
  let form = child.render();
  assert.equal(treeNodes(form).find(node => node.type === 'button' && node.props?.type === 'submit').props.disabled, true);
  treeNodes(form).find(node => node.type === 'textarea').props.onChange({ target: { value: JSON.stringify(report()) } });
  form = child.render(); treeNodes(form).find(node => node.type === 'button' && treeText(node) === '보고서 검증').props.onClick();
  form = child.render(); treeNodes(form).find(node => node.type === 'input' && node.props?.type === 'checkbox').props.onChange({ target: { checked: true } });
  form = child.render(); form.props.onSubmit({ preventDefault() {} }); await tick();
  form = child.render(); assert.doesNotMatch(treeText(form), /private database/);
  form.props.onSubmit({ preventDefault() {} }); await tick();
  assert.equal(writes.length, 2);
  assert.equal(writes[0].input.reportId, reportId);
  assert.equal(writes[1].input.reportId, reportId);
});

test('business-detail entry opens the shared dashboard filtered to that business', async () => {
  const requests = [];
  const view = webshopView(async (_days, selected) => { requests.push(selected); return fixtureData(); });
  view.props.initialMerchantId = merchantId;
  view.render(); await tick();
  assert.deepEqual(requests, [merchantId]);
  const merchant = readFileSync(new URL('../src/components/admin/admin-merchants.tsx', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../src/components/admin/admin-screen.tsx', import.meta.url), 'utf8');
  assert.match(merchant, /onClick={openWebshop}>웹샵 성과/);
  assert.match(merchant, /play\('selection'\); onWebshop\(selected\)/);
  assert.match(screen, /onWebshop={\(merchantId\) => \{ chooseSection\('webshops'\); setWebshopMerchantId\(merchantId\); \}\}/);
  assert.match(screen, /initialMerchantId={webshopMerchantId}/);
});


test('unconnected business profiles never appear as enrolled restaurants or filter options', async () => {
  const unconnected = { ...fixtureStore, merchantId: '70000000-0000-4000-8000-000000000003', name: '꽃집 프로필', updatedAt: null, url: null, enabled: false };
  const view = webshopView(async () => ({ ...fixtureData(), stores: [fixtureStore, unconnected] }));
  view.render(); await tick(); const tree = view.render();
  assert.ok(treeText(tree).includes(fixtureStore.name));
  assert.ok(!treeText(tree).includes(unconnected.name));
  const select = treeNodes(tree).find(node => node.type === 'AdminSelect' && node.props.label === '비즈니스');
  assert.deepEqual(Array.from(select.props.options, option => option.value), ['', merchantId]);
  assert.equal(treeNodes(tree).filter(node => node.type === 'article' && node.props.className === 'webshop-metric').length, 4);
});

test('performance, connection prices and reports are separate views with retained explicit controls', async () => {
  const view = webshopView(async () => fixtureData()); view.render(); await tick(); let tree = view.render();
  const choose = label => { treeNodes(tree).find(node => node.type === 'button' && node.props?.role === 'tab' && treeText(node) === label).props.onClick(); tree = view.render(); };
  assert.ok(!treeNodes(tree).some(node => node.props?.caption === '검증된 주문 보고서 행'));
  choose('연결·가격');
  assert.ok(treeNodes(tree).some(node => node.props?.caption === `${fixtureStore.name} 메뉴 가격 비교`));
  assert.ok(!treeNodes(tree).some(node => node.props?.caption === '검증된 주문 보고서 행'));
  choose('주문 보고서');
  assert.ok(treeNodes(tree).some(node => node.props?.caption === '검증된 주문 보고서 행'));
  assert.ok(!treeNodes(tree).some(node => node.props?.caption === `${fixtureStore.name} 메뉴 가격 비교`));
});

test('an explicitly selected unconnected profile requires restaurant/Uber confirmation and never auto-saves', async () => {
  const writes=[]; const candidate={ ...fixtureStore, updatedAt:null, enabled:false, url:null, comparisons:[] };
  const view=webshopView(async()=>({...fixtureData(),stores:[candidate]}),{saveAdminWebshop:async(...args)=>writes.push(args)});
  view.props.initialMerchantId=merchantId; view.render(); await tick(); let tree=view.render();
  let connect=treeNodes(tree).find(node=>node.type==='button'&&treeText(node)==='이 음식점 웹샵 연결');
  assert.equal(connect.props.disabled,true); assert.equal(writes.length,0);
  treeNodes(tree).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}}); tree=view.render();
  connect=treeNodes(tree).find(node=>node.type==='button'&&treeText(node)==='이 음식점 웹샵 연결'); assert.equal(connect.props.disabled,false);
  connect.props.onClick({currentTarget:{focus(){}}}); tree=view.render();
  assert.ok(treeNodes(tree).some(node=>typeof node.type==='function'&&node.type.name==='ConfigEditor')); assert.equal(writes.length,0);
});


test('tab controls support arrow navigation and retain one keyboard entry point', async () => {
  const view=webshopView(async()=>fixtureData()); view.render(); await tick(); let tree=view.render(); const calls=[];
  treeNodes(tree).find(node=>node.props?.role==='tablist').props.onKeyDown({key:'ArrowRight',preventDefault(){calls.push('prevent')},currentTarget:{querySelector:selector=>({focus(){calls.push(selector)}})}});
  tree=view.render(); const tabs=treeNodes(tree).filter(node=>node.props?.role==='tab');
  assert.equal(tabs.filter(node=>node.props.tabIndex===0).length,1);
  assert.equal(tabs.find(node=>node.props['aria-selected']).props.children,'연결·가격');
  assert.deepEqual(calls,['prevent','#webshop-tab-connections']);
});
