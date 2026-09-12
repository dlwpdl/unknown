import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
const style = value => Object.assign({}, ...[value].flat(Infinity));
const flush = () => new Promise(resolve => setImmediate(resolve));

function screen(path, imports) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { Fragment: 'Fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { ActivityIndicator: 'ActivityIndicator', View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ background: '#fff', text: '#123', accent: '#b34' }) };
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports.default;
}

test('every profile header can go back or leave a direct entry, with accessible motion and touch settings', () => {
  let hasHistory = false, reducedMotion = false;
  const actions = [];
  const ProfileLayout = screen('../src/app/profile/_layout.tsx', {
    'expo-router': { Stack: Object.assign(() => {}, { Screen: 'Screen' }), useRouter: () => ({
      canGoBack: () => hasHistory, back: () => actions.push('back'), replace: path => actions.push(path),
    }) },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native-reanimated': { useReducedMotion: () => reducedMotion },
    '@/i18n/ko': { t: { tabs: { profile: '나' }, profile: { guidelines: '이용 수칙', settings: '설정' } } },
    '@/lib/promotions': { PROMOTIONS_PREVIEW_ENABLED: false },
  });
  for (const name of ['index', 'membership', 'settings', 'guidelines', 'promotions']) {
    const options = ProfileLayout().props.screenOptions({ route: { name } });
    const button = options.headerLeft();
    assert.equal(button.props.accessibilityLabel, '뒤로가기');
    assert.equal(button.props.accessibilityRole, 'button');
    assert.ok(button.props.style({ pressed: false }).minWidth >= 44);
    assert.ok(button.props.style({ pressed: false }).minHeight >= 44);
    assert.ok(button.props.style({ pressed: true }).opacity < button.props.style({ pressed: false }).opacity);
    assert.equal(options.animation, 'default');
    hasHistory = false;
    button.props.onPress();
    assert.equal(actions.at(-1), name === 'index' ? '/' : '/profile');
    hasHistory = true;
    button.props.onPress();
    assert.equal(actions.at(-1), 'back');
  }
  reducedMotion = true;
  assert.equal(ProfileLayout().props.screenOptions({ route: { name: 'membership' } }).animation, 'none');
  assert.equal(nodes(ProfileLayout()).find(node => node.props.name === 'promotions').props.options.headerShown, false);
});

test('shared posts remain escapable during loading, failure and absence, and never show an old ID response', async () => {
  let id = 'first', commentId, hasHistory = false, cursor = 0, effect, cleanup, effectId, accountId = 'first-account';
  const states = [], requests = new Map(), actions = [];
  const SharedPostRoute = screen('../src/app/post/[id].tsx', {
    'expo-router': { useLocalSearchParams: () => ({ id, commentId }), useRouter: () => ({
      canGoBack: () => hasHistory, back: () => actions.push('back'), replace: path => actions.push(path),
    }) },
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], next => { states[index] = next; }];
      },
      useEffect(run, dependencies) {
        const nextId = dependencies.join(':');
        if (nextId !== effectId) effect = () => { cleanup?.(); cleanup = run(); effectId = nextId; };
      },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/post-detail': { PostDetail: 'PostDetail' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/themed-view': { ThemedView: 'View' },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: accountId } }) },
    '@/lib/supabase': { supabase: {} },
    '@/lib/feed-data': { loadPublicPost(_, postId) {
      return new Promise((resolve, reject) => requests.set(postId, { resolve, reject }));
    } },
  });
  const render = () => { cursor = 0; return SharedPostRoute(); };
  const commit = () => { const next = effect; effect = undefined; next?.(); };
  const detail = tree => nodes(tree).find(node => node.type === 'PostDetail');
  const back = tree => {
    const safe = nodes(tree).find(node => node.type === 'SafeAreaView');
    assert.ok(safe.props.edges.includes('top'));
    const button = nodes(safe).find(node => node.props.accessibilityLabel === '뒤로가기');
    assert.ok(button, 'a visible return button exists inside the safe area');
    assert.ok(style(button.props.style({ pressed: false })).minHeight >= 44);
    assert.ok(style(button.props.style({ pressed: false })).minWidth >= 44);
    return button;
  };
  let tree = render();
  back(tree).props.onPress();
  assert.equal(actions.at(-1), '/');
  assert.ok(nodes(tree).some(node => node.type === 'ActivityIndicator'));
  commit();
  requests.get('first').resolve({ id: 'first' });
  await flush();
  tree = render();
  assert.equal(detail(tree).props.post.id, 'first');
  commentId = '40111111-1111-1111-1111-111111111111';
  assert.equal(detail(render()).props.commentId, commentId);
  commentId = '40AAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
  assert.equal(detail(render()).props.commentId, commentId.toLowerCase());
  commentId = ['40111111-1111-1111-1111-111111111111'];
  assert.equal(detail(render()).props.commentId, undefined);
  commentId = 'invalid';
  assert.equal(detail(render()).props.commentId, undefined);
  hasHistory = true;
  detail(tree).props.onClose();
  assert.equal(actions.at(-1), 'back');
  hasHistory = false;
  detail(tree).props.onClose();
  assert.equal(actions.at(-1), '/');

  id = 'slow';
  tree = render();
  assert.equal(detail(tree), undefined, 'old content disappears before the changed-ID effect runs');
  back(tree);
  commit();
  id = 'latest';
  render(); commit();
  requests.get('latest').resolve({ id: 'latest' });
  await flush();
  requests.get('slow').resolve({ id: 'slow' });
  await flush();
  assert.equal(detail(render()).props.post.id, 'latest');
  accountId = 'second-account';
  tree = render();
  assert.equal(detail(tree), undefined, 'account changes hide cached account-specific post fields immediately');
  commit();
  requests.get('latest').resolve({ id: 'latest', likedByMe: false });
  await flush();
  assert.equal(detail(render()).props.post.likedByMe, false);

  id = 'stale-error';
  render(); commit();
  id = 'error';
  render(); commit();
  requests.get('stale-error').reject(new Error('old request failed'));
  await flush();
  assert.ok(nodes(render()).some(node => node.type === 'ActivityIndicator'));
  requests.get('error').reject(new Error('offline'));
  await flush();
  tree = render();
  assert.match(text(tree), /글을 불러오지 못했어요/);
  hasHistory = true;
  back(tree).props.onPress();
  assert.equal(actions.at(-1), 'back');

  id = 'missing';
  render(); commit();
  requests.get('missing').resolve(null);
  await flush();
  tree = render();
  assert.match(text(tree), /글을 찾을 수 없어요/);
  back(tree);
  id = undefined;
  tree = render(); commit();
  back(tree);
  assert.equal(requests.has(''), false, 'missing route IDs do not issue invalid requests');
  assert.equal(nodes(tree).some(node => node.type === 'ActivityIndicator'), false);
  cleanup?.();
});
