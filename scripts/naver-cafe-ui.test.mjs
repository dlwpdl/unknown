import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseCafeBoardUrl } from '../supabase/functions/_shared/naver-cafe.ts';

const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/merchant-naver-cafe.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText + '\nexports.__Workspace = CafeWorkspace;';
const request = { requestId: 'request-1', draftId: 'draft-1', expectedUpdatedAt: '2026-10-09T00:00:00Z', boardUrl: 'https://cafe.naver.com/f-e/cafes/123/menus/4', imagePaths: [], confirmed: true };
const receipt = status => ({ id: request.requestId, draft_id: request.draftId, draft_revision: request.expectedUpdatedAt, board_url: request.boardUrl, status, article_url: status === 'succeeded' ? 'https://cafe.naver.com/test/17' : null, error_code: null });
const currentDraft = { id: request.draftId, title: '승인 원고', body: '사진 없는 검토 원고', image_paths: [], approved_at: request.expectedUpdatedAt, archived_at: null, external_url: null, updated_at: request.expectedUpdatedAt };
function fixture(statusName, drafts = [], outcome = null) {
  const exports = {}, slots = [], effects = [], calls = [], storage = new Map([['gling:merchant-naver:owner:merchant', JSON.stringify(request)]]);
  let cursor = 0;
  const state = { configured: true, connection: { connected_at: request.expectedUpdatedAt, expires_at: '2030-01-01T00:00:00Z' }, requests: statusName ? [receipt(statusName)] : [] };
  const imports = {
    react: {
      useState(value) { const id = cursor++; if (!(id in slots)) slots[id] = typeof value === 'function' ? value() : value; return [slots[id], next => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }]; },
      useRef(value) { const id = cursor++; if (!(id in slots)) slots[id] = { current: value }; return slots[id]; },
      useEffect(fn, deps) { const id = cursor++; if (!slots[id] || deps.some((value, index) => value !== slots[id][index])) { slots[id] = deps; effects.push(fn); } },
      useLayoutEffect(fn, deps) { const id = cursor++; if (!slots[id] || deps.some((value, index) => value !== slots[id][index])) { slots[id] = deps; fn(); } },
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', TextInput: 'Input', Alert: {}, Linking: { openURL: async value => calls.push(['open', value]) }, Platform: { OS: 'web' }, StyleSheet: { create: value => value, hairlineWidth: 1 } },
    'expo-image': { Image: 'Image' }, '@react-native-async-storage/async-storage': { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value), removeItem: async key => { calls.push(['remove', key]); storage.delete(key); } },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/auth': { useAuth: () => ({ me: { id: 'owner' } }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => calls.push(['feedback', value]) }) },
    '@/lib/merchant-source': { merchantEventId: () => 'new-request' }, '@/lib/supabase': { supabase: {} },
    '@/lib/naver-cafe': { parseCafeBoardUrl,
      loadMerchantNaverCafe: async () => structuredClone(state),
      cancelMerchantNaverPreparation: async () => { calls.push(['cancel', request.requestId]); state.requests[0] = { ...receipt('failed'), error_code: 'NAVER_PREPARATION_CANCELLED' }; return { request: state.requests[0] }; },
      publishMerchantNaverCafe: async () => { calls.push(['publish']); const result = outcome ?? receipt('succeeded'); state.requests = [{ ...result, ...(result.status === 'uncertain' ? { article_url: null } : {}) }]; return { request: result }; },
    },
  };
  vm.runInNewContext(source, { exports, require: name => { if (!(name in imports)) throw new Error(name); return imports[name]; }, URL, window: { confirm: () => true } });
  return { state, storage, calls, render() { cursor = 0; return exports.__Workspace({ merchantId: 'merchant', userId: 'owner', drafts }); }, async settle() { const pending = effects.splice(0); pending.forEach(fn => fn()); await new Promise(resolve => setTimeout(resolve, 0)); } };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const find = (screen, label) => nodes(screen.render()).find(node => node.props?.label === label);

test('재진입은 실제 완료·거절 readback을 확인하면 오래된 로컬 요청을 정리한다', async () => {
  for (const status of ['succeeded', 'failed']) {
    const f = fixture(status); f.render(); await f.settle();
    assert.equal(f.storage.has('gling:merchant-naver:owner:merchant'), false);
    assert.equal(nodes(f.render()).find(node => node.type === 'Input').props.editable, true);
    assert.equal(f.calls.filter(([type]) => type === 'publish').length, 0);
  }
});
test('상태 새로고침도 실제 종료 readback에만 pending을 해제한다', async () => {
  const f = fixture('in_flight', [currentDraft]); f.render(); await f.settle();
  assert.equal(nodes(f.render()).find(node => node.type === 'Input').props.editable, false);
  f.state.requests[0] = receipt('succeeded');
  find(f, '상태 다시 확인').props.onPress(); await f.settle();
  assert.equal(f.storage.has('gling:merchant-naver:owner:merchant'), false);
  assert.equal(nodes(f.render()).find(node => node.type === 'Input').props.editable, true);
});
test('미확인·발행 중·불확실 요청은 재진입에서도 보호하고 자동 POST를 하지 않는다', async () => {
  for (const status of [null, 'in_flight', 'uncertain']) {
    const f = fixture(status, [currentDraft]); f.render(); await f.settle();
    assert.equal(f.storage.has('gling:merchant-naver:owner:merchant'), true);
    assert.equal(nodes(f.render()).find(node => node.type === 'Input').props.editable, false);
    assert.equal(f.calls.filter(([type]) => type === 'publish').length, 0);
  }
});
test('바뀐 원고의 이전 prepared 요청은 원자 취소 확인 후 입력을 다시 연다', async () => {
  const f = fixture('prepared', [{ ...currentDraft, updated_at: '2026-10-09T00:01:00Z' }]); f.render(); await f.settle();
  const cancel = find(f, '이전 발행 준비 취소');
  assert.ok(cancel, 'prepared 요청을 명시적으로 취소할 수 있다');
  cancel.props.onPress(); await f.settle();
  assert.equal(f.storage.has('gling:merchant-naver:owner:merchant'), false);
  assert.equal(nodes(f.render()).find(node => node.type === 'Input').props.editable, true);
  assert.equal(f.calls.filter(([type]) => type === 'cancel').length, 1);
  assert.equal(f.calls.filter(([type]) => type === 'publish').length, 0);
});
test('서버 영수증 저장이 불확실하면 네이버가 반환한 실제 링크를 로컬에 보관한다', async () => {
  const actualUrl = 'https://cafe.naver.com/test/17';
  const f = fixture('prepared', [currentDraft], { ...receipt('uncertain'), article_url: actualUrl, error_code: 'NAVER_RECEIPT_SAVE_UNCERTAIN' });
  f.render(); await f.settle();
  find(f, '원고 확인 후 카페에 발행').props.onPress(); await f.settle();
  assert.equal(JSON.parse(f.storage.get('gling:merchant-naver:owner:merchant')).observedArticleUrl, actualUrl);
  assert.ok(find(f, '반환된 카페 링크 확인'));
  assert.equal(f.calls.filter(([type]) => type === 'publish').length, 1);
  const restored = fixture('in_flight', [currentDraft]);
  restored.storage.set('gling:merchant-naver:owner:merchant', f.storage.get('gling:merchant-naver:owner:merchant'));
  restored.render(); await restored.settle();
  assert.ok(find(restored, '반환된 카페 링크 확인'));
  assert.equal(restored.calls.filter(([type]) => type === 'publish').length, 0);
});
