import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { merchantAddressCity } from '../src/lib/admin-merchants.ts';

const merchants = ['first', 'second'].map((id, i) => ({ id, name: `업체 ${i + 1}`, city_id: 'vancouver', city_name: '밴쿠버', timezone: 'America/Vancouver', industry: '카페', services: '', address: '', contact: `contact${i + 1}@example.test`, status: 'trial', consent: 'pending', consent_note: '', trial_ends_at: null, post_count: i + 1, report_count: 0 }));

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
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
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
    if (name === '@/lib/admin-merchants') return { merchantMapsUrl: () => null, merchantAddressCity };
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
const button = (root, label) => nodes(root).find(n => n.type === 'button' && (text(n).trim() === label || n.props['aria-label'] === label));

test('the overview exposes every merchant contact and count before a detail is opened', () => {
  const view = app(), root = view.render();
  const table = nodes(root).find(n => n.type === 'table');
  assert.ok(table, 'Use a full-width table rather than the old card sidebar.');
  for (const merchant of merchants) {
    assert.ok(text(table).includes(merchant.name));
    assert.ok(text(table).includes(merchant.contact));
    assert.ok(button(table, `${merchant.name} 활동과 정보 보기`));
  }
  assert.ok(text(table).includes('연락처'));
  assert.equal(nodes(root).filter(n => n.type === 'dialog').length, 1);
});

test('벤더 목록은 주소 기반 소재지와 연결 계정을 구분하고 전체 주소는 상세에 둔다', () => {
  const view = app();
  const address = '77 Finch Ave W, Suite 202, North York, ON M2N 2H5';
  view.refreshMerchant({ ...merchants[0], address, owner_id: 'owned' });
  const table = nodes(view.render()).find(n => n.type === 'table');
  assert.ok(text(view.render()).includes('벤더 관리'));
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
  button(view.render(), '업체 2 활동과 정보 보기').props.onClick();
  assert.equal(view.prompts.length, 1);
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '저장 전 이름'));
  view.allow();
  button(view.render(), '업체 2 활동과 정보 보기').props.onClick();
  assert.ok(nodes(view.render()).some(n => n.type === 'input' && n.props.value === '업체 2'));
  assert.ok(view.feedback.includes('selection'));
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
