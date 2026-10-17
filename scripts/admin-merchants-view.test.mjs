import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as merchantApi from '../src/lib/admin-merchants.ts';
import * as merchantSource from '../src/lib/merchant-source.ts';
const { merchantAddressCity } = merchantApi;

const merchants = ['first', 'second'].map((id, i) => ({ id, name: `업체 ${i + 1}`, city_id: 'vancouver', city_name: '밴쿠버', timezone: 'America/Vancouver', industry: '카페', services: '', address: '', contact: `contact${i + 1}@example.test`, status: 'trial', consent: 'pending', consent_note: '', trial_ends_at: null, post_count: i + 1, report_count: 0, updated_at: '2026-10-11T00:00:00Z' }));

test('vendor workspace groups the directory into seven columns without dropping location, account or actions', () => {
  const tree = app().render(), table = nodes(tree).find(n => n.type === 'table');
  const head = nodes(table).find(n => n.type === 'thead');
  assert.equal(nodes(head).filter(n => n.type === 'th').length, 7);
  assert.match(text(table), /미연결/); assert.match(text(table), /게시 지역/);
  assert.ok(button(tree, '업체 1 크리에이터 협업')); assert.ok(button(tree, '업체 1 삭제'));
});

function app({ failure = null } = {}) {
  const state = [], refs = [], effects = [], feedback = [], prompts = [], calls = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, allowReplace = false;
  state[5] = { key: `:0:0:0:0:${JSON.stringify(merchantApi.MERCHANT_DEFAULT_FILTERS)}`, rows: merchants, more: false, owners: { owned: '벤더 회원' } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-merchants.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, Date, Error, window: { confirm(message) { prompts.push(message); return allowReplace; } }, require(name) {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('.png')) return 'preview-logo';
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      useEffect(callback) { effects[effectIndex++] = callback; },
      useRef: initial => { const i = refIndex++; return refs[i] ??= { current: initial }; },
      useState: initial => { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    };
    if (name === 'expo-asset') return { Asset: { fromModule: uri => ({ uri }) } };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
    if (name === '@/lib/mock') return { CITIES: [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', timezone: 'America/Vancouver' }], TAGS: [] };
    if (name === '@/lib/merchant-source') return { ...merchantSource, merchantEventId: () => 'new-merchant' };
    if (name === '@/lib/admin-merchants') return { ...merchantApi, merchantMapsUrl: () => null };
    if (name === '@/lib/supabase') return { supabase: { rpc: async (name, args) => { calls.push({ name, args }); if (name === 'get_admin_merchants') return { data: { merchants: merchants.map(m => ({ ...m, updated_at: '2026-10-12T00:00:00Z' })), more: false }, error: null }; return failure ? { data: null, error: { message: failure } } : { data: args.p_merchants.length, error: null }; } } };
    if (name === './admin-ai-connection') return { AdminAiConnection: 'AdminAiConnection' };
    if (name === './admin-table-controls') return { AdminSelect: 'AdminSelect', AdminFilterBar: 'AdminFilterBar', AdminFilterReset: 'AdminFilterReset' };
    if (name === './admin-merchant-connections') return { AdminMerchantConnections: 'AdminMerchantConnections' };
    return {};
  } });
  const render = () => { stateIndex = refIndex = effectIndex = 0; return exports.AdminMerchantsView({ refreshSignal: 0 }); };
  return { render, feedback, prompts, calls, reloadList() { effects[1](); }, allow() { allowReplace = true; }, detail() {
    const merchant = state[5].rows[0], period = state[7];
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
const button = (root, label) => nodes(root).find(n => n.type === 'button' && (text(n).trim() === label || n.props['aria-label'] === label));

test('merchant contact links preserve text, recognize named platforms and reject unsafe targets', () => {
  assert.equal(typeof merchantSource.merchantContactLinks, 'function');
  const contact = '담당자 hello@example.test · Instagram @sample.cafe · 스레드 @sample.cafe · TikTok @sample_cafe · YouTube @sample-cafe · https://cafe.example.com/menu?x=1';
  const parts = merchantSource.merchantContactLinks(contact);
  assert.equal(parts.map(part => part.text).join(''), contact);
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), ['https://www.instagram.com/sample.cafe/', 'https://www.threads.com/@sample.cafe', 'https://www.tiktok.com/@sample_cafe', 'https://www.youtube.com/@sample-cafe', 'https://cafe.example.com/menu?x=1']);
  for (const contact of ['hello@example.test', '@ambiguous', 'javascript:alert(1)', 'https://localhost/a', 'https://127.0.0.1/a', 'https://user:pass@example.com/a', 'https://example.com/\n<script>']) {
    assert.equal(merchantSource.merchantContactLinks(contact).filter(part => part.href).length, 0, contact);
  }
  assert.equal(merchantSource.merchantPrimaryContactLink('https://example.com/menu · Instagram @cafe')?.text, '@cafe');
  assert.equal(merchantSource.merchantPrimaryContactLink('https://example.com/menu · https://threads.com/@cafe')?.href, 'https://example.com/menu');
  assert.equal(merchantSource.merchantPrimaryContactLink('https://instagram.com/p/123')?.text, 'Instagram');
  assert.equal(merchantSource.merchantPrimaryContactLink('email@example.test'), null);
  assert.equal(merchantSource.merchantPrimaryContactLink('https://instagram.com.evil.test/ · Instagram @cafe')?.href, 'https://www.instagram.com/cafe/');
});

test('merchant accounts open directly from the list and detail without opening the row editor', () => {
  const view = app();
  view.refreshMerchant({ ...merchants[0], contact: 'Instagram @sample.cafe · https://cafe.example.com/' });
  const table = nodes(view.render()).find(n => n.type === 'table');
  const links = nodes(table).filter(n => n.type === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, 'https://www.instagram.com/sample.cafe/');
  for (const link of links) { assert.equal(link.props.target, '_blank'); assert.equal(link.props.rel, 'noopener noreferrer'); link.props.onClick(); }
  const row = nodes(table).find(n => n.type === 'tr' && n.props.onClick);
  row.props.onClick({ target: { closest: selectors => selectors.split(',').includes('a') ? {} : null } });
  assert.equal(nodes(view.render()).find(n => n.type === 'h2' && n.props.id === 'merchant-detail-title')?.props.children, '등록 종류와 정보');
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick();
  const heading = nodes(view.render()).find(n => n.type === 'header' && n.props.className === 'merchant-detail-heading');
  assert.equal(nodes(heading).filter(n => n.type === 'a').length, 2);
  assert.ok(view.feedback.includes('selection'));
});

test('the overview keeps full contacts in detail while exposing merchant names and counts', () => {
  const view = app(), root = view.render();
  const table = nodes(root).find(n => n.type === 'table');
  assert.ok(table, 'Use a full-width table rather than the old card sidebar.');
  for (const merchant of merchants) {
    assert.ok(text(table).includes(merchant.name));
    assert.ok(!text(table).includes(merchant.contact));
    assert.ok(button(table, `${merchant.name} 활동과 정보 보기`));
  }
  assert.ok(text(table).includes('SNS'));
  assert.equal(nodes(root).filter(n => n.type === 'dialog').length, 1);
});

test('the directory prefers one Instagram link even when other links appear first', () => {
  const view = app();
  view.refreshMerchant({ ...merchants[0], contact: '담당자 긴 연락처 · https://example.com/menu · Threads @sample.cafe · Instagram @sample.cafe · https://instagram.com/other/' });
  const table = nodes(view.render()).find(n => n.type === 'table');
  const links = nodes(table).filter(n => n.type === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, 'https://www.instagram.com/sample.cafe/');
  assert.ok(!text(table).includes('긴 연락처'));
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick();
  const heading = nodes(view.render()).find(n => n.type === 'header' && n.props.className === 'merchant-detail-heading');
  assert.equal(nodes(heading).filter(n => n.type === 'a').length, 4);
  assert.ok(text(heading).includes('긴 연락처'));
});

test('registration date uses the merchant timezone and never substitutes the update date', () => {
  const view = app();
  view.refreshMerchant({ ...merchants[0], created_at: '2026-10-15T00:30:00Z' });
  const table = nodes(view.render()).find(n => n.type === 'table');
  assert.ok(text(table).includes('등록일'));
  const dates = nodes(table).filter(n => n.type === 'time');
  assert.equal(dates.length, 1);
  assert.equal(dates[0].props.dateTime, '2026-10-15T00:30:00Z');
  assert.match(text(dates[0]), /2026[-. ]+10[-. ]+14/);
});

test('sorting and filters invalidate old rows and bulk selection, then reload the first page on the server', async () => {
  const view = app();
  checkbox(view.render(), '업체 1 선택').props.onChange({ target: { checked: true } });
  nodes(view.render()).find(n => n.type === 'AdminSelect' && n.props.label === '정렬').props.onChange('name_desc');
  assert.ok(!nodes(view.render()).some(n => n.type === 'table'), 'Previous sort rows must not stay selectable.');
  assert.equal(button(view.render(), '선택 삭제').props.disabled, true);
  view.reloadList(); await settle();
  assert.equal(view.calls.at(-1).args.p_offset, 0);
  assert.equal(view.calls.at(-1).args.p_filters.sort, 'name_desc');
  nodes(view.render()).find(n => n.type === 'AdminSelect' && n.props.label === '운영 상태').props.onChange('paid');
  view.render(); view.reloadList(); await settle();
  assert.equal(view.calls.at(-1).args.p_filters.status, 'paid');
  assert.equal(nodes(view.render()).find(n => n.type === 'AdminFilterBar').props.applied, 1);
  nodes(view.render()).find(n => n.type === 'AdminFilterReset').props.onReset();
  view.render(); view.reloadList(); await settle();
  assert.deepEqual({ ...view.calls.at(-1).args.p_filters }, { ...merchantApi.MERCHANT_DEFAULT_FILTERS, sort: 'name_desc' });
});

test('벤더 목록은 주소 기반 소재지와 연결 계정을 구분하고 전체 주소는 상세에 둔다', () => {
  const view = app();
  const address = '77 Finch Ave W, Suite 202, North York, ON M2N 2H5';
  view.refreshMerchant({ ...merchants[0], address, owner_id: 'owned' });
  const table = nodes(view.render()).find(n => n.type === 'table');
  assert.ok(text(view.render()).includes('업체 관리'));
  assert.ok(text(table).includes('North York, ON'));
  assert.ok(text(table).includes('벤더 회원'));
  assert.ok(text(table).includes('미연결'));
  assert.ok(text(table).includes('주소 미확인'));
  const location = nodes(table).filter(n => n.type === 'td' && n.props.className === 'merchant-location')[1];
  assert.equal(text(nodes(location).find(n => n.type === 'span')), '주소 미확인');
  assert.match(text(location), /게시 지역:\s+밴쿠버/);
  assert.ok(!text(table).includes(address));
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick();
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === address));
});

test('closing and reopening the same merchant keeps its unsaved profile; replacing it requires confirmation', () => {
  const view = app();
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick();
  button(view.render(), '업체 정보').props.onClick();
  nodes(view.render()).find(n => n.type === 'input' && n.props.value === '업체 1').props.onChange({ target: { value: '저장 전 이름' } });
  button(view.render(), '업체 상세 닫기').props.onClick();
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick();
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '저장 전 이름'));
  assert.equal(button(view.render(), '업체 정보').props['aria-pressed'], true, 'Reopening must keep the current tab and draft visible.');
  button(view.render(), '업체 2 활동과 정보 보기').props.onClick();
  assert.equal(view.prompts.length, 1);
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '저장 전 이름'));
  view.allow();
  button(view.render(), '업체 2 활동과 정보 보기').props.onClick();
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 2'));
  assert.ok(view.feedback.includes('selection'));
});

test('linked post management belongs to the profile tab and retains unsaved input across tabs', () => {
  const view = app();
  view.refreshMerchant({ ...merchants[0], consent: 'granted' });
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick(); view.detail();
  const linked = root => nodes(root).find(n => n.type === 'section' && text(n).startsWith('연결된 글'));
  const profile = root => nodes(root).find(n => n.type === 'div' && n.props.hidden === true && nodes(n).includes(linked(root)));
  assert.ok(profile(view.render()), 'linked posts must be mounted inside the hidden profile, not crowd the activity tab');
  button(view.render(), '업체 정보').props.onClick();
  const source = root => nodes(linked(root)).find(n => n.type === 'input' && n.props.type === 'url');
  source(view.render()).props.onChange({ target: { value: 'https://example.test/unsaved' } });
  button(view.render(), '활동 · 성과').props.onClick();
  assert.equal(source(view.render()).props.value, 'https://example.test/unsaved');
  button(view.render(), '업체 정보').props.onClick();
  assert.equal(source(view.render()).props.value, 'https://example.test/unsaved');
  button(view.render(), '업체 2 활동과 정보 보기').props.onClick();
  assert.equal(view.prompts.length, 1);
  assert.equal(source(view.render()).props.value, 'https://example.test/unsaved');
});

test('reopening a clean merchant uses the latest saved name and contact from the refreshed directory', () => {
  const view = app();
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick();
  button(view.render(), '업체 상세 닫기').props.onClick();
  view.refreshMerchant({ ...merchants[0], name: '새 서버 이름', contact: 'latest@example.test' });
  button(view.render(), '새 서버 이름 활동과 정보 보기').props.onClick();
  const inputs = nodes(view.render()).filter(n => n.type === 'input');
  assert.ok(inputs.some(n => n.props.value === '새 서버 이름'));
  assert.ok(inputs.some(n => n.props.value === 'latest@example.test'));
  assert.equal(view.prompts.length, 0, 'Refreshing clean fields must not ask to discard edits.');
});

test('unsaved account ownership edits also protect a merchant switch', () => {
  const view = app();
  button(view.render(), '업체 1 활동과 정보 보기').props.onClick();
  view.detail();
  const form = nodes(view.render()).find(n => n.type === 'AdminMerchantConnections');
  form.props.onDirty(true);
  button(view.render(), '업체 상세 닫기').props.onClick();
  button(view.render(), '업체 2 활동과 정보 보기').props.onClick();
  assert.equal(view.prompts.length, 1, 'Account form edits must not disappear silently.');
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 1'));
});


test('unknown promotions default to a source record and choosing a business gives immediate feedback', () => {
  const view=app();button(view.render(),'업체 등록').props.onClick();
  let root=view.render();let select=nodes(root).find(n=>n.type==='select'&&n.props['aria-label']==='등록 종류');
  assert.ok(select);assert.equal(select.props.value,'source');
  assert.ok(text(root).includes('공개 회사 프로필과 업체 리뷰를 만들지 않습니다'));
  const feedback=view.feedback.length;select.props.onChange({target:{value:'business'}});
  root=view.render();select=nodes(root).find(n=>n.type==='select'&&n.props['aria-label']==='등록 종류');
  assert.equal(select.props.value,'business');assert.ok(view.feedback.length>feedback);
});

const checkbox = (root, label) => nodes(root).find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === label);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('row editing opens the existing information form directly', () => {
  const view = app();
  const edit = button(view.render(), '업체 1 수정');
  assert.ok(edit, 'A vendor must have a direct edit action.');
  edit.props.onClick();
  const profileTab = button(view.render(), '업체 정보');
  assert.equal(profileTab.props['aria-pressed'], true);
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 1'));
});

test('checkbox selection shows the exact count without opening vendor details', () => {
  const view = app();
  const first = checkbox(view.render(), '업체 1 선택');
  assert.ok(first, 'Each visible vendor needs a selection checkbox.');
  first.props.onChange({ target: { checked: true } });
  const root = view.render();
  assert.equal(checkbox(root, '업체 1 선택').props.checked, true);
  assert.match(text(root), /1\s*개 선택/);
  assert.ok(!nodes(root).some(n => n.type === 'input' && n.props.value === '업체 1'));
  const row = nodes(root).find(n => n.type === 'tr' && n.props['data-selected'] !== undefined);
  row.props.onClick({ target: { closest: selector => selector.includes('input') ? {} : null } });
  assert.ok(!nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 1'));
});

test('cancelled bulk deletion preserves checked rows and sends no mutation', async () => {
  const view = app();
  const all = checkbox(view.render(), '현재 페이지 전체 선택');
  assert.ok(all);
  all.props.onChange({ target: { checked: true } });
  assert.match(text(view.render()), /2\s*개 선택/);
  button(view.render(), '선택 삭제').props.onClick();
  await settle();
  assert.equal(view.calls.length, 0);
  assert.ok(view.prompts[0].includes('업체 1') && view.prompts[0].includes('업체 2'));
  assert.equal(checkbox(view.render(), '업체 2 선택').props.checked, true);
});

test('confirmed bulk deletion sends only reviewed IDs and timestamps once', async () => {
  const view = app(); view.allow();
  checkbox(view.render(), '현재 페이지 전체 선택').props.onChange({ target: { checked: true } });
  const remove = button(view.render(), '선택 삭제');
  remove.props.onClick(); remove.props.onClick();
  await settle();
  assert.deepEqual(view.calls, [{ name: 'delete_admin_merchants', args: { p_merchants: [
    { id: 'first', updated_at: '2026-10-11T00:00:00Z' },
    { id: 'second', updated_at: '2026-10-11T00:00:00Z' },
  ] } }]);
  assert.match(text(view.render()), /2개.*삭제/);
});

test('failed deletion preserves selection and exposes a recoverable error', async () => {
  const view = app({ failure: 'MERCHANT_SELECTION_CHANGED' }); view.allow();
  checkbox(view.render(), '현재 페이지 전체 선택').props.onChange({ target: { checked: true } });
  button(view.render(), '선택 삭제').props.onClick();
  await settle();
  assert.equal(checkbox(view.render(), '업체 1 선택').props.checked, true);
  assert.equal(checkbox(view.render(), '업체 2 선택').props.checked, true);
  assert.ok(nodes(view.render()).some(n => n.props?.role === 'alert' && /변경|새로/.test(text(n))));
});

test('deleting another vendor preserves an unsaved information draft', async () => {
  const view = app(); view.allow();
  button(view.render(), '업체 1 수정').props.onClick();
  nodes(view.render()).find(n => n.type === 'input' && n.props.value === '업체 1').props.onChange({ target: { value: '저장 전 이름' } });
  button(view.render(), '업체 상세 닫기').props.onClick();
  button(view.render(), '업체 2 삭제').props.onClick();
  await settle();
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '저장 전 이름'));
  assert.equal(view.prompts.length, 1);
});

test('confirmed deletion of the open vendor clears its abandoned editor', async () => {
  const view = app(); view.allow();
  button(view.render(), '업체 1 수정').props.onClick();
  button(view.render(), '업체 상세 닫기').props.onClick();
  button(view.render(), '업체 1 삭제').props.onClick();
  await settle();
  assert.ok(!nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 1'));
});

test('reloading vendor data clears selection so a changed record must be reviewed again', async () => {
  const view = app();
  checkbox(view.render(), '업체 1 선택').props.onChange({ target: { checked: true } });
  assert.equal(checkbox(view.render(), '업체 1 선택').props.checked, true);
  view.reloadList();
  await settle();
  assert.equal(checkbox(view.render(), '업체 1 선택').props.checked, false);
  assert.equal(button(view.render(), '선택 삭제').props.disabled, true);
});

test('deleting another vendor keeps a locally edited owner form mounted', async () => {
  const view = app(); view.allow();
  view.refreshMerchant({ ...merchants[0], owner_id: 'owned' });
  button(view.render(), '업체 1 수정').props.onClick();
  view.detail();
  const ownerForm = root => nodes(root).find(n => typeof n.type === 'function' && n.type.name === 'MerchantOwnerForm');
  const before = ownerForm(view.render());
  assert.ok(before);
  before.props.onDirty();
  button(view.render(), '업체 상세 닫기').props.onClick();
  button(view.render(), '업체 2 삭제').props.onClick();
  await settle();
  const after = ownerForm(view.render());
  assert.ok(after, 'Deleting a different vendor must not unmount local owner inputs.');
  assert.equal(after.props.merchant.updated_at, before.props.merchant.updated_at);
});
