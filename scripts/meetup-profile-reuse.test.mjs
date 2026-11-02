import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as data from '../src/lib/chilling-data.ts';
import * as photoOrder from '../src/lib/meetup-profile-photos.ts';
import { CITIES } from '../src/lib/mock.ts';
import { translateUi } from '../src/i18n/index.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
export const saved = { version: 2, revision: 'saved', displayName: '산책친구', cityId: 'vancouver', intro: '주말에 걸어요', interests: ['산책'], promptOne: '함께 걸어요', promptTwo: '느긋하게', promptOneId: 'meet', promptTwoId: 'join', photoPaths: [], publicPhotoPath: null, shareWithMembers: false, preferences: { activities: [], availability: '', pace: 'any' } };
const owner = '00000000-0000-4000-8000-000000000001';
export function profile(value, { upload, failSave = true, language = 'ko', theme = {} } = {}) {
  const slots = [], effects = [], writes = [], routes = [], uploads = [], cleanup = [];
  let at = 0, actor = owner, focused, focusCleanup, guard;
  const effect = (fn, deps) => { const i = at++, previous = slots[i]; if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) { slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } };
  const react = {
    useState(initial) { const i = at++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = at++; return slots[i] ??= { current: initial }; },
    useEffect: effect, useLayoutEffect: effect, useCallback: fn => fn,
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AccessibilityInfo: { announceForAccessibility() {} }, View: 'View', TextInput: 'Input', KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', StyleSheet: { create: x => x }, Platform: { OS: 'web' }, Keyboard: { dismiss() {} } },
    'expo-router': { usePreventRemove: when => { guard = when; }, useLocalSearchParams: () => ({}), useFocusEffect: fn => { focused = fn; }, useRouter: () => ({ canGoBack: () => true, back: () => routes.push('back') }) },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' }, launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'fixture-photo' }] }) },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/hooks/use-language': { useLanguage: () => ({ language, tr: (s, ...args) => translateUi(language, s, ...args) }) },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: actor, cityId: 'vancouver' } }) },
    '@/lib/chilling-data': { ...data, loadChillingProfile: async () => value, getChillingError: () => '저장하지 못했어요. 다시 시도해 주세요.' },
    '@/lib/supabase': { supabase: { rpc: async (name, args) => { assert.equal(name, 'save_chilling_profile'); writes.push(args.p_profile); return { data: null, error: failSave ? Error('save failed') : null }; } } },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/chilling-profile-media': { removeUnsavedMeetupPhotos: async (_client, paths) => cleanup.push(paths), uploadMeetupProfilePhoto: async (_client, user, image) => { uploads.push({ user, image }); return upload ? upload() : `${owner}/new-photo.webp`; } },
    '@/lib/post-image-picker': { preparePostImage: async () => ({ uri: 'fixture-photo', base64: 'fixture', mimeType: 'image/webp' }) },
    '@/lib/meetup-profile-photos': photoOrder, '@/lib/mock': { CITIES }, '@/constants/theme': { Spacing: {}, Depth: {} },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/meetup-profile.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => imports[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
  });
  return { writes, routes, uploads, cleanup, guarded: () => guard, setAccount: id => { actor = id; }, focus: () => { focusCleanup = focused?.(); }, blur: () => focusCleanup?.(), unmount: () => { focusCleanup?.(); slots.forEach(slot => slot?.cleanup?.()); }, render() { at = 0; const route = exports.default(), result = route.type(route.props); effects.splice(0).forEach(fn => fn()); return result; } };
}

const openItem = (app, title) => nodes(app.render()).find(node => node.props?.analyticsId === 'meetup-profile.edit-item' && node.props.title === title).props.onPress();

test('a complete account meetup profile opens its item list and keeps save failures at the fixed CTA', async () => {
  const app = profile(saved); app.render(); await new Promise(setImmediate);
  let tree = app.render();
  const save = nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8');
  assert.ok(save, 'A returning owner sees the list of saved items rather than starting registration at step one.');
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
    openItem(app, '모임 사진');
    action('app_meetup-profile.pressable.5'); await new Promise(setImmediate);
    action('app_meetup-profile.pressable.8'); await new Promise(setImmediate);
    assert.equal(app.uploads.length, 1);
    if (leave === 'account') { app.unmount(); app.setAccount('00000000-0000-4000-8000-000000000002'); }
    else if (leave === 'refocus') { app.blur(); app.focus(); }
    finishUpload(`${owner}/new-photo.webp`); await new Promise(setImmediate);
    assert.deepEqual(JSON.parse(JSON.stringify(app.cleanup)), leave === 'stay' ? [] : [[`${owner}/new-photo.webp`]], 'An abandoned save removes the photo it already uploaded.');
    assert.equal(app.writes.length, leave === 'stay' ? 1 : 0);
    assert.deepEqual(app.routes, leave === 'stay' ? ['back'] : []);
    if (leave === 'stay') assert.equal(app.writes[0].publicPhotoPath, null, 'Saving a photo must not select it for public sharing.');
  }
});

test('leaving an edited own profile asks first, an untouched one leaves freely', async () => {
  const app = profile(saved); app.render(); await new Promise(setImmediate);
  app.render(); app.render();
  assert.equal(app.guarded(), false, 'The loaded profile itself is not an unsaved change.');
  openItem(app, '모임에서 쓸 이름');
  nodes(app.render()).find(node => node.props?.accessibilityLabel === '모임에서 쓸 이름').props.onChangeText('새 이름');
  nodes(app.render()).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.1').props.onPress();
  app.render();
  assert.equal(app.guarded(), true);
});

test('one item opens straight from the list, the arrow returns to the list and the edit stays in the draft', async () => {
  const app = profile(saved, { failSave: false }); app.render(); await new Promise(setImmediate);
  let tree = app.render();
  assert.equal(nodes(tree).some(node => node.props?.accessibilityLabel === '모임에서 쓸 이름'), false);
  assert.ok(nodes(tree).some(node => node.type === 'ListRow' && node.props.title === '공개 호스트 사진'), 'The public photo setting is on the list itself.');
  assert.ok(nodes(tree).some(node => node.type === 'WhoSees'), 'Who sees what stays visible next to the list.');
  openItem(app, '모임에서 쓸 이름'); tree = app.render();
  const input = nodes(tree).find(node => node.props?.accessibilityLabel === '모임에서 쓸 이름');
  assert.equal(input.props.autoFocus, true);
  assert.equal(nodes(tree).some(node => node.props?.analyticsId === 'app_meetup-profile.pressable.5'), false, 'Only the chosen item opens.');
  input.props.onChangeText('새 이름'); tree = app.render();
  assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8'), 'Saving is one tap away from the item.');
  nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.1').props.onPress(); tree = app.render();
  assert.equal(nodes(tree).find(node => node.props?.analyticsId === 'meetup-profile.edit-item' && node.props.title === '모임에서 쓸 이름').props.detail, '새 이름');
  nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8').props.onPress(); await new Promise(setImmediate);
  assert.equal(app.writes[0].displayName, '새 이름');
  assert.deepEqual(app.routes, ['back']);
});

test('emptying a required item from its list blocks saving and names what is missing', async () => {
  const app = profile(saved); app.render(); await new Promise(setImmediate);
  openItem(app, '모임에서 쓸 이름');
  nodes(app.render()).find(node => node.props?.accessibilityLabel === '모임에서 쓸 이름').props.onChangeText('  ');
  const tree = app.render();
  assert.equal(nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8').props.disabled, true);
  assert.ok(nodes(tree).some(node => typeof node.props?.children === 'string' && node.props.children.includes('남은 필수 항목')));
});

test('first-time steps show the shared explanation once and keep the public photo on the review step', async () => {
  const note = '일반 프로필과 별개로 계정당 하나를 만들고, 모든 모임에서 함께 사용해요.';
  const app = profile({ ...saved, intro: '' }); app.render(); await new Promise(setImmediate);
  const seen = [];
  nodes(app.render()).find(node => node.props?.accessibilityLabel === '한 줄 소개 직접 입력').props.onPress();
  nodes(app.render()).find(node => node.props?.accessibilityLabel === '한 줄 소개 직접 입력').props.onChangeText('안녕하세요');
  for (let step = 0; step < 5; step++) {
    const tree = app.render();
    seen.push(nodes(tree).filter(node => node.props?.children === note).length);
    if (step < 4) nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.13').props.onPress();
    else assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'meetup-profile.public-photo-none'), 'Choosing the public photo no longer needs the public tab.');
  }
  assert.deepEqual(seen, [1, 0, 0, 0, 0]);
});

test('moving a photo by button or by drag saves the new order and keeps the public photo on the same picture', async () => {
  const [a, b, c] = ['a', 'b', 'c'].map(name => `${owner}/${name}.webp`);
  for (const how of ['button', 'drag']) {
    const app = profile({ ...saved, photoPaths: [a, b, c], publicPhotoPath: a, photoUris: ['ua', 'ub', 'uc'] }, { failSave: false }); app.render(); await new Promise(setImmediate);
    assert.equal(app.render() && app.guarded(), false);
    openItem(app, '모임 사진');
    let tree = app.render();
    assert.equal(nodes(tree).find(node => node.props?.accessibilityLabel === '모임 사진 1 위로 옮기기').props.disabled, true, 'The top photo cannot go further up.');
    if (how === 'button') {
      nodes(tree).find(node => node.props?.accessibilityLabel === '모임 사진 1 아래로 옮기기').props.onPress();
      nodes(app.render()).find(node => node.props?.accessibilityLabel === '모임 사진 2 아래로 옮기기').props.onPress();
    } else {
      const row = nodes(tree).find(node => node.type === 'MeetupProfilePhotoRow');
      row.props.onLift(); tree = app.render();
      assert.equal(nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.scrollview.1').props.scrollEnabled, false, 'The list holds still under a drag.');
      assert.equal(nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8').props.disabled, true, 'Saving waits for the drop.');
      row.props.onOver(2); assert.deepEqual(nodes(app.render()).filter(node => node.type === 'MeetupProfilePhotoRow').map(node => node.props.offset), [0, -1, -1]);
      row.props.onDrop(2);
    }
    tree = app.render();
    assert.equal(app.guarded(), true);
    nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-profile.pressable.8').props.onPress(); await new Promise(setImmediate);
    assert.deepEqual([...app.writes[0].photoPaths], [b, c, a]);
    assert.equal(app.writes[0].publicPhotoPath, a);
  }
});
