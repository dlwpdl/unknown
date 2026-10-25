import { withLanguageImports } from './test-language-imports.mjs';
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

function editor({ fail = false, sessionUser = user, initialProfile = profile, photoFail = false } = {}) {
  const state = [], cleanup = new Map(), calls = [], photoCalls = [], removed = [], feedback = [], dirty = [];
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
    'expo-image': { Image: 'Image' },
    'expo-router': { useRouter: () => ({ push() {} }) }, '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' }, '@/components/merchant-profile-header': { MerchantProfileHeader: 'ProfileHeader' },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: user } }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/post-image-picker': { isSupportedImage: () => true, preparePostImage: async () => ({ uri: 'prepared-photo' }) },
    '@/lib/merchant-profile-editor': { loadMyMerchantProfile: async () => initialProfile,
      uploadMerchantProfileImage: async (_client, userId, merchantId, image) => { photoCalls.push(['upload', userId, merchantId, image]); return 'new-map-path'; },
      saveMyMerchantProfilePhotos: async (_client, merchantId, patch) => { photoCalls.push(['save', merchantId, patch]); if (photoFail) throw Error('MERCHANT_PROFILE_CHANGED'); return { ...initialProfile, map_photo_path: patch.mapPhotoPath, mapPhotoUri: patch.mapPhotoPath ? 'saved-map-url' : null, updated_at: '2026-10-24T20:00:00Z' }; } },
    '@/lib/merchant-conveniences': { saveMerchantContact: async (_client, ...args) => { calls.push(args); if (fail) throw Error('MERCHANT_PROFILE_CHANGED'); return { ...profile, public_phone: args[1], business_hours: args[2], updated_at: '2026-10-09T18:01:00Z' }; } },
    '@/lib/supabase': { supabase: { storage: { from: () => ({ remove: async paths => { removed.push(...paths); } }) }, auth: { getSession: async () => ({ data: { session: { user: { id: sessionUser } } } }) } } },
  };
  const exports = {}, source = readFileSync(new URL('../src/components/merchant-profile-editor.tsx', import.meta.url), 'utf8') + '\nexports.Editor=ScopedProfileEditor;';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: withLanguageImports(name => imports[name] ?? {}), Error });
  const onDirty = value => dirty.push(value);
  return { calls, photoCalls, removed, feedback, dirty, render() { index = 0; return exports.Editor({ merchantId: merchant, onDirty }); } };
}

test('contact save preserves a separately edited logo and uses current server revision', async () => {
  const view = editor(); view.render(); await settle();
  let root = view.render();
  assert.equal(input(root, '비즈니스 공개 전화번호')?.props.value, profile.public_phone);
  action(root, '로고 교체').props.onPress(); await settle(); root = view.render();
  input(root, '비즈니스 공개 전화번호').props.onChangeText('+1 604 555 0202');
  input(view.render(), '비즈니스 영업시간').props.onChangeText('월–토 10:00–18:00');
  action(view.render(), '연락 정보 저장').props.onPress(); await settle(); root = view.render();
  assert.deepEqual(view.calls, [[merchant, '+1 604 555 0202', '월–토 10:00–18:00', profile.updated_at]]);
  assert.equal(nodes(root).find(node => node.type === 'ProfileHeader').props.profile.avatarUri, 'prepared-photo');
  assert.ok(view.feedback.includes('success'));
});

test('contact conflict preserves entered phone/hours and signals an unsaved profile', async () => {
  const view = editor({ fail: true }); view.render(); await settle();
  assert.ok(input(view.render(), '비즈니스 공개 전화번호'));
  input(view.render(), '비즈니스 공개 전화번호').props.onChangeText('+1 604 555 0202');
  action(view.render(), '연락 정보 저장').props.onPress(); await settle();
  const root = view.render();
  assert.equal(input(root, '비즈니스 공개 전화번호').props.value, '+1 604 555 0202');
  assert.ok(view.feedback.includes('warning'));
  assert.equal(view.dirty.at(-1), true);
});

test('contact editor rejects an account switch before sending a write', async () => {
  const view = editor({ sessionUser: 'other' }); view.render(); await settle();
  assert.ok(input(view.render(), '비즈니스 공개 전화번호'));
  input(view.render(), '비즈니스 공개 전화번호').props.onChangeText('+1 604 555 0202');
  action(view.render(), '연락 정보 저장').props.onPress(); await settle();
  assert.equal(view.calls.length, 0);
  assert.equal(input(view.render(), '비즈니스 공개 전화번호').props.value, '+1 604 555 0202');
});

test('map photo selection reuses picker/upload, preserves logo and banner, and can be removed', async () => {
  const view = editor(); view.render(); await settle();
  action(view.render(), '지도 사진 선택').props.onPress(); await settle();
  assert.equal(action(view.render(), '프로필 사진 저장').props.disabled, false);
  action(view.render(), '프로필 사진 저장').props.onPress(); await settle();
  assert.equal(view.photoCalls[0][0], 'upload');
  assert.deepEqual(view.photoCalls[1].slice(0, 2), ['save', merchant]);
  assert.deepEqual(JSON.parse(JSON.stringify(view.photoCalls[1][2])), { avatarPath: profile.avatar_path, bannerPath: null, mapPhotoPath: 'new-map-path', updatedAt: profile.updated_at });
  assert.ok(view.feedback.includes('success'));
  const oldPreview = nodes(view.render()).find(node => node.type === 'Image');
  action(view.render(), '지도 사진 제거').props.onPress();
  action(view.render(), '프로필 사진 저장').props.onPress(); await settle();
  assert.equal(view.photoCalls.at(-1)[2].mapPhotoPath, null);
  assert.equal(view.photoCalls.at(-1)[2].updatedAt, '2026-10-24T20:00:00Z');
  oldPreview.props.onError();
  assert.equal(action(view.render(), '프로필 사진 저장').props.disabled, true, 'late preview failure cannot restore the previous saved revision');
});

test('failed map photo save retains uploaded draft for retry and map preview failure retains its saved path', async () => {
  const view = editor({ photoFail: true }); view.render(); await settle();
  action(view.render(), '지도 사진 선택').props.onPress(); await settle();
  nodes(view.render()).find(node => node.type === 'Image').props.onError();
  assert.ok(action(view.render(), '지도 사진 제거'), 'a failed local preview can still be removed');
  action(view.render(), '프로필 사진 저장').props.onPress(); await settle();
  assert.equal(view.dirty.at(-1), true);
  assert.ok(action(view.render(), '지도 사진 제거'));
  action(view.render(), '프로필 사진 저장').props.onPress(); await settle();
  assert.equal(view.photoCalls.filter(call => call[0] === 'upload').length, 1, 'retry uses the immutable uploaded draft');
  const saved = editor({ initialProfile: { ...profile, map_photo_path: 'saved-map', mapPhotoUri: 'saved-url' } }); saved.render(); await settle();
  nodes(saved.render()).find(node => node.type === 'Image').props.onError();
  assert.ok(action(saved.render(), '지도 사진 제거'));
  assert.ok(action(saved.render(), '사진 다시 확인'));
  assert.equal(action(saved.render(), '프로필 사진 저장').props.disabled, true, 'load failure cannot clear the saved image');
});
