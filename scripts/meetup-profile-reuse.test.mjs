import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as data from '../src/lib/chilling-data.ts';
import { CITIES } from '../src/lib/mock.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const saved = { version: 2, revision: 'saved', displayName: '산책친구', cityId: 'vancouver', intro: '주말에 걸어요', interests: ['산책'], promptOne: '함께 걸어요', promptTwo: '느긋하게', promptOneId: 'meet', promptTwoId: 'join', photoPaths: [], publicPhotoPath: null, shareWithMembers: false, preferences: { activities: [], availability: '', pace: 'any' } };
const owner = '00000000-0000-4000-8000-000000000001';
function profile(value, { upload, failSave = true } = {}) {
  const slots = [], effects = [], writes = [], routes = [], uploads = [], cleanup = [];
  let at = 0, actor = owner, focused, focusCleanup;
  const effect = (fn, deps) => { const i = at++, previous = slots[i]; if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) { slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } };
  const react = {
    useState(initial) { const i = at++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = at++; return slots[i] ??= { current: initial }; },
    useEffect: effect, useLayoutEffect: effect, useCallback: fn => fn,
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', TextInput: 'Input', KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', StyleSheet: { create: x => x }, Platform: { OS: 'web' }, Keyboard: { dismiss() {} } },
    'expo-router': { useLocalSearchParams: () => ({}), useFocusEffect: fn => { focused = fn; }, useRouter: () => ({ canGoBack: () => true, back: () => routes.push('back') }) },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' }, launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'fixture-photo' }] }) },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/hooks/use-language': { useLanguage: () => ({ language: 'ko', tr: (s, ...args) => s.replace(/\{(\d+)\}/g, (_, i) => args[i]) }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: actor, cityId: 'vancouver' } }) },
    '@/lib/chilling-data': { ...data, loadChillingProfile: async () => value, getChillingError: () => '저장하지 못했어요. 다시 시도해 주세요.' },
    '@/lib/supabase': { supabase: { rpc: async (name, args) => { assert.equal(name, 'save_chilling_profile'); writes.push(args.p_profile); return { data: null, error: failSave ? Error('save failed') : null }; } } },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/chilling-profile-media': { removeUnsavedMeetupPhotos: async (_client, paths) => cleanup.push(paths), uploadMeetupProfilePhoto: async (_client, user, image) => { uploads.push({ user, image }); return upload ? upload() : `${owner}/new-photo.webp`; } },
    '@/lib/post-image-picker': { preparePostImage: async () => ({ uri: 'fixture-photo', base64: 'fixture', mimeType: 'image/webp' }) },
    '@/lib/mock': { CITIES }, '@/constants/theme': { Spacing: {}, Depth: {} },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/meetup-profile.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => imports[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
  });
  return { writes, routes, uploads, cleanup, setAccount: id => { actor = id; }, focus: () => { focusCleanup = focused?.(); }, blur: () => focusCleanup?.(), unmount: () => { focusCleanup?.(); slots.forEach(slot => slot?.cleanup?.()); }, render() { at = 0; const route = exports.default(), result = route.type(route.props); effects.splice(0).forEach(fn => fn()); return result; } };
}

test('a complete account meetup profile opens its existing review and keeps save failures at the fixed CTA', async () => {
  const app = profile(saved); app.render(); await new Promise(setImmediate);
  let tree = app.render();
  const save = nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8');
  assert.ok(save, 'A returning owner reviews the saved profile rather than starting registration at step one.');
  assert.equal(nodes(tree).some(node => node.props?.analyticsId === 'app_meetup-profile.pressable.13'), false);
  save.props.onPress(); await new Promise(setImmediate); tree = app.render();
  assert.equal(app.writes.length, 1); assert.equal(app.writes[0].displayName, saved.displayName);
  assert.equal(app.routes.length, 0, 'A failed save must not return as though it succeeded.');
  const footer = nodes(tree).find(node => node.type === 'View' && [node.props?.children].flat().some(child => child?.props?.analyticsId === 'app_meetup-profile.pressable.8'));
  assert.ok(nodes(footer).some(node => node.props?.accessibilityRole === 'alert'));
});

test('a missing or incomplete meetup profile still begins at the first required setup step', async () => {
  for (const value of [null, { ...saved, intro: '' }]) {
    const app = profile(value); app.render(); await new Promise(setImmediate);
    const tree = app.render();
    assert.equal(nodes(tree).some(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8'), false);
    assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'app_meetup-profile.pressable.13'));
    assert.equal(app.writes.length, 0);
  }
});

test('a retained completed-profile save cannot write old account data after unmount or a new account commit', async () => {
  for (const leave of ['unmount', 'account']) {
    const app = profile(saved, { failSave: false }); app.render(); await new Promise(setImmediate);
    const save = nodes(app.render()).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8').props.onPress;
    if (leave === 'unmount') app.unmount();
    app.setAccount('00000000-0000-4000-8000-000000000002');
    if (leave === 'account') app.render();
    save(); await new Promise(setImmediate);
    assert.equal(app.writes.length, 0); assert.equal(app.cleanup.length, 0); assert.equal(app.routes.length, 0);
  }
});

test('photo completion saves only in the original live scope, never after account departure or refocus', async () => {
  for (const leave of ['stay', 'account', 'refocus']) {
    let finishUpload;
    const app = profile(saved, { failSave: false, upload: () => new Promise(resolve => { finishUpload = resolve; }) });
    app.render(); await new Promise(setImmediate); app.focus();
    const action = id => nodes(app.render()).find(node => node.props?.analyticsId === id).props.onPress();
    for (let i = 0; i < 4; i++) action('app_meetup-profile.pressable.1');
    action('app_meetup-profile.pressable.5'); await new Promise(setImmediate);
    for (let i = 0; i < 4; i++) action('app_meetup-profile.pressable.13');
    action('app_meetup-profile.pressable.8'); await new Promise(setImmediate);
    assert.equal(app.uploads.length, 1);
    if (leave === 'account') { app.unmount(); app.setAccount('00000000-0000-4000-8000-000000000002'); }
    else if (leave === 'refocus') { app.blur(); app.focus(); }
    finishUpload(`${owner}/new-photo.webp`); await new Promise(setImmediate);
    assert.equal(app.cleanup.length, 0);
    assert.equal(app.writes.length, leave === 'stay' ? 1 : 0);
    assert.deepEqual(app.routes, leave === 'stay' ? ['back'] : []);
    if (leave === 'stay') assert.equal(app.writes[0].publicPhotoPath, null, 'Saving a photo must not select it for public sharing.');
  }
});
