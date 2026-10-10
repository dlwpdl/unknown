import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const merchant = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const profile = { id: merchant, name: '가게', can_edit: true, updated_at: '2026-10-09T18:00:00Z', public_phone: '+1 604 555 0101', business_hours: '월–금 09:00–18:00', avatar_path: 'saved-logo', banner_path: null, avatarUri: 'saved-logo-url', bannerUri: null, services: '', address: '' };
const settle = () => new Promise(setImmediate);
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const action = (root, label) => nodes(root).find(node => node.props?.label === label);
const input = (root, label) => nodes(root).find(node => node.type === 'TextInput' && node.props.accessibilityLabel === label);

function editor({ fail = false, sessionUser = user } = {}) {
  const state = [], cleanup = new Map(), calls = [], feedback = [], dirty = [];
  let index = 0;
  const imports = {
    react: {
      useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
      useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
      useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanup.get(slot)?.(); state[slot] = deps; const end = fn(); if (end) cleanup.set(slot, end); } },
    },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', TextInput: 'TextInput', Platform: { OS: 'ios' }, StyleSheet: { create: value => value } },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: {}, launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'picked', mimeType: 'image/jpeg' }] }) },
    'expo-router': { useRouter: () => ({ push() {} }) }, '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' }, '@/components/merchant-profile-header': { MerchantProfileHeader: 'ProfileHeader' },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: user } }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/post-image-picker': { isSupportedImage: () => true, preparePostImage: async () => ({ uri: 'prepared-photo' }) },
    '@/lib/merchant-profile-editor': { loadMyMerchantProfile: async () => profile },
    '@/lib/merchant-conveniences': { saveMerchantContact: async (_client, ...args) => { calls.push(args); if (fail) throw Error('MERCHANT_PROFILE_CHANGED'); return { ...profile, public_phone: args[1], business_hours: args[2], updated_at: '2026-10-09T18:01:00Z' }; } },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: sessionUser } } } }) } } },
  };
  const exports = {}, source = readFileSync(new URL('../src/components/merchant-profile-editor.tsx', import.meta.url), 'utf8') + '\nexports.Editor=ScopedProfileEditor;';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => imports[name] ?? {}, Error });
  const onDirty = value => dirty.push(value);
  return { calls, feedback, dirty, render() { index = 0; return exports.Editor({ merchantId: merchant, onDirty }); } };
}

test('contact save preserves a separately edited logo and uses current server revision', async () => {
  const view = editor(); view.render(); await settle();
  let root = view.render();
  assert.equal(input(root, '업체 공개 전화번호')?.props.value, profile.public_phone);
  action(root, '로고 교체').props.onPress(); await settle(); root = view.render();
  input(root, '업체 공개 전화번호').props.onChangeText('+1 604 555 0202');
  input(view.render(), '업체 영업시간').props.onChangeText('월–토 10:00–18:00');
  action(view.render(), '연락 정보 저장').props.onPress(); await settle(); root = view.render();
  assert.deepEqual(view.calls, [[merchant, '+1 604 555 0202', '월–토 10:00–18:00', profile.updated_at]]);
  assert.equal(nodes(root).find(node => node.type === 'ProfileHeader').props.profile.avatarUri, 'prepared-photo');
  assert.ok(view.feedback.includes('success'));
});

test('contact conflict preserves entered phone/hours and signals an unsaved profile', async () => {
  const view = editor({ fail: true }); view.render(); await settle();
  assert.ok(input(view.render(), '업체 공개 전화번호'));
  input(view.render(), '업체 공개 전화번호').props.onChangeText('+1 604 555 0202');
  action(view.render(), '연락 정보 저장').props.onPress(); await settle();
  const root = view.render();
  assert.equal(input(root, '업체 공개 전화번호').props.value, '+1 604 555 0202');
  assert.ok(view.feedback.includes('warning'));
  assert.equal(view.dirty.at(-1), true);
});

test('contact editor rejects an account switch before sending a write', async () => {
  const view = editor({ sessionUser: 'other' }); view.render(); await settle();
  assert.ok(input(view.render(), '업체 공개 전화번호'));
  input(view.render(), '업체 공개 전화번호').props.onChangeText('+1 604 555 0202');
  action(view.render(), '연락 정보 저장').props.onPress(); await settle();
  assert.equal(view.calls.length, 0);
  assert.equal(input(view.render(), '업체 공개 전화번호').props.value, '+1 604 555 0202');
});
