import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const config = require('../app.config.js');

test('merchant web selects only its own router root and preserves public/admin builds', () => {
  const before = { ...process.env };
  const base = { plugins: ['expo-router', 'expo-image'], experiments: { typedRoutes: true } };
  try {
    delete process.env.GLING_LOCAL_ADMIN; delete process.env.GLING_PUBLIC_WEB; delete process.env.CI;
    process.env.GLING_MERCHANT_WEB = '1';
    const merchant = config({ config: base });
    assert.deepEqual(merchant.plugins[0], ['expo-router', { root: './src/merchant-web' }]);
    assert.equal(merchant.experiments.typedRoutes, false);
    delete process.env.GLING_MERCHANT_WEB; process.env.GLING_PUBLIC_WEB = '1';
    assert.deepEqual(config({ config: base }).plugins[0], ['expo-router', { root: './src/web' }]);
    process.env.GLING_LOCAL_ADMIN = '1';
    assert.throws(() => config({ config: base }), /Only one web workspace/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});

function component(file, name, { auth, rpc, postLoader, workspaceLoader, callback = null } = {}) {
  const exports = {}, state = [], effects = [], calls = [], events = {};
  let index = 0;
  const imports = {
    react: { useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
      useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
      useEffect(fn) { effects.push(fn); }, useLayoutEffect(fn) { fn(); } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', Modal: 'Modal', Platform: { OS: 'web' }, StyleSheet: { create: x => x, hairlineWidth: 1 }, AppState: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router/head': { default: 'Head' }, 'expo-image': { Image: 'Image' },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/gling-loader': { GlingLoader: 'Loader' },
    '@/components/merchant-naver-cafe': { MerchantNaverCallback: 'MerchantNaverCallback', captureMerchantNaverCallback: () => callback },
    '@/components/merchant-workspace': { MerchantWorkspace: 'MerchantWorkspace' }, '@/components/post-detail': { PostDetail: 'PostDetail' },
    '@/hooks/use-theme': { useTheme: () => ({ background: '#0B0B12', card: '#171722', line: '#343443', accent: '#CBB9FF' }) },
    '@/lib/auth': { useAuth: () => auth },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.push(['feedback', kind]) }) },
    '@/lib/merchant-workspace': { getMyMerchantAccess: async client => rpc(client), loadMerchantWorkspace: workspaceLoader },
    '@/lib/merchant-posts': { editMerchantPost: async (...args) => calls.push(['edit', args]), removeMerchantPost: async (...args) => calls.push(['remove', args]) },
    '@/lib/feed-data': { loadPublicPost: postLoader },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: auth.me.id } } } }) } } },
  };
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { if (name.startsWith('@/assets/')) return 'brand.png'; if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; }, window: { addEventListener(name, fn) { events[name] = fn; }, removeEventListener(name) { delete events[name]; } }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
  return { render(props) { index = 0; return exports[name](props); }, async effect() { const cleanups = effects.splice(0).map(fn => fn()); await Promise.resolve(); await Promise.resolve(); return () => cleanups.forEach(fn => fn?.()); }, calls, events };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const authed = () => ({ me: { id: 'owner', nickname: '가게 담당자' }, isAuthed: true, isAuthLoading: false, authError: null, signOut: async () => {}, promptLogin() {} });

test('merchant web cannot mount management when current server access is false', async () => {
  const auth = authed(), screen = component('../src/merchant-web/index.tsx', 'default', { auth, rpc: async () => false });
  screen.render(); await screen.effect();
  assert.ok(!nodes(screen.render()).some(n => n.type === 'MerchantWorkspace'));
  assert.ok(nodes(screen.render()).some(n => n.props?.children === '업체 관리 권한이 필요해요'));
});
test('merchant web access belongs to one account and does not carry across account switches', async () => {
  const auth = authed(), screen = component('../src/merchant-web/index.tsx', 'default', { auth, rpc: async () => true });
  screen.render(); await screen.effect();
  assert.ok(nodes(screen.render()).some(n => n.type === 'MerchantWorkspace'));
  auth.me = { id: 'other', nickname: '다른 계정' };
  assert.ok(!nodes(screen.render()).some(n => n.type === 'MerchantWorkspace'));
});
test('merchant post open requires current access and current linked post rather than a stale row', async () => {
  const auth = authed(); let access = false, links = [{ post_id: 'post-1' }], reads = 0;
  const manager = component('../src/components/merchant-web-posts.tsx', 'MerchantWebPosts', { auth, rpc: async () => access, workspaceLoader: async () => ({ posts: links, merchant: { owner_id: 'owner', owner_verified_at: '2026-10-08' } }), postLoader: async (client, id) => { reads++; return { id, title: '저장본', author: { id: 'owner' } }; } });
  const props = { merchantId: 'mine', posts: [{ post_id: 'post-1', title: '글', displayed_views: 2 }] };
  const open = () => nodes(manager.render(props)).find(n => n.props?.accessibilityLabel === '글 · 글과 사진 열기').props.onPress();
  await open(); assert.equal(reads, 0);
  access = true; links = []; await open(); assert.equal(reads, 0);
  links = [{ post_id: 'post-1' }]; await open(); assert.equal(reads, 1);
  assert.ok(nodes(manager.render(props)).some(n => n.type === 'PostDetail' && n.props.post.author.id === 'owner'));
  auth.me = { id: 'other' };
  assert.ok(!nodes(manager.render(props)).some(n => n.type === 'PostDetail'));
});
test('saved detail readback reaches merchant list and deletion closes safely', async () => {
  const auth = authed(); let refreshes = 0;
  const manager = component('../src/components/merchant-web-posts.tsx', 'MerchantWebPosts', { auth, rpc: async () => true, workspaceLoader: async () => ({ posts: [{ post_id: 'post-1' }], merchant: { owner_id: 'owner', owner_verified_at: '2026-10-08' } }), postLoader: async (client, id) => ({ id, title: '원래 제목', author: { id: 'owner' } }) });
  const props = { merchantId: 'mine', posts: [{ post_id: 'post-1', title: '글', displayed_views: 2 }], onChanged() { refreshes++; } };
  await nodes(manager.render(props)).find(n => n.props?.accessibilityLabel === '글 · 글과 사진 열기').props.onPress();
  let detail = nodes(manager.render(props)).find(n => n.type === 'PostDetail');
  detail.props.onPostChanged({ id: 'post-1', title: '바뀐 제목', author: { id: 'owner' } });
  assert.ok(nodes(manager.render(props)).some(n => n.props?.accessibilityLabel === '바뀐 제목 · 글과 사진 열기'));
  detail = nodes(manager.render(props)).find(n => n.type === 'PostDetail');
  detail.props.onPostRemoved('post-1'); detail.props.onClose();
  assert.equal(refreshes, 1);
  assert.ok(!nodes(manager.render(props)).some(n => n.type === 'PostDetail'));
});

test('verified merchant owner manages linked Gling-authored post without impersonating its author', async () => {
  const auth = authed(); let verified = null;
  const manager = component('../src/components/merchant-web-posts.tsx', 'MerchantWebPosts', { auth, rpc: async () => true, workspaceLoader: async () => ({ posts: [{ post_id: 'post-1' }], merchant: { owner_id: 'owner', owner_verified_at: verified } }), postLoader: async (client, id) => ({ id, title: '소개글', author: { id: 'gling-author' } }) });
  const props = { merchantId: 'mine', posts: [{ post_id: 'post-1', title: '글', displayed_views: 2 }] };
  const open = () => nodes(manager.render(props)).find(n => n.props?.accessibilityLabel === '글 · 글과 사진 열기').props.onPress();
  await open();
  let detail = nodes(manager.render(props)).find(n => n.type === 'PostDetail');
  assert.equal(detail.props.management, undefined);
  detail.props.onClose(); verified = '2026-10-08'; await open();
  detail = nodes(manager.render(props)).find(n => n.type === 'PostDetail');
  assert.equal(detail.props.post.author.id, 'gling-author');
  assert.equal(detail.props.post.id, 'post-1');
  const replacement = { userId: 'owner', images: [{ path: 'gling-author/photo.jpg' }] };
  await detail.props.management.edit('post-1', { title: '새 제목', body: '실제 본문' }, replacement);
  const edit = manager.calls.find(call => call[0] === 'edit');
  assert.equal(edit[1][1], 'mine'); assert.equal(edit[1][2], 'post-1');
  assert.equal(edit[1][4], replacement);
  await detail.props.management.remove('post-1');
  assert.equal(manager.calls.find(call => call[0] === 'remove')[1][1], 'mine');
});

test('latest access revocation wins even if an older permission check arrives late', async () => {
  const auth = authed(); const pending = [];
  const screen = component('../src/merchant-web/index.tsx', 'default', { auth, rpc: () => new Promise(resolve => pending.push(resolve)) });
  screen.render(); await screen.effect();
  screen.events.focus();
  pending[1](false); await Promise.resolve(); await Promise.resolve();
  pending[0](true); await Promise.resolve(); await Promise.resolve();
  assert.ok(!nodes(screen.render()).some(n => n.type === 'MerchantWorkspace'));
});
test('logged-out web shows the ordinary login action and does not query merchant data', async () => {
  const auth = { ...authed(), isAuthed: false }; let rightsRead = 0, logins = 0;
  auth.promptLogin = () => logins++;
  const screen = component('../src/merchant-web/index.tsx', 'default', { auth, rpc: async () => { rightsRead++; return true; } });
  const tree = screen.render(); await screen.effect();
  assert.equal(rightsRead, 0);
  nodes(tree).find(n => n.props?.accessibilityLabel === '글링 계정으로 로그인').props.onPress();
  assert.equal(logins, 1);
  assert.ok(screen.calls.some(call => call[0] === 'feedback'));
});

test('OAuth completion waits for current merchant rights and uses only the server-bound merchant result', async () => {
  const auth = authed(), callback = { state: 'opaque-state', code: 'opaque-code', result: 'finish' };
  const screen = component('../src/merchant-web/index.tsx', 'default', { auth, rpc: async () => true, callback });
  screen.render(); await screen.effect();
  let tree = screen.render();
  const finish = nodes(tree).find(n => n.type === 'MerchantNaverCallback');
  assert.ok(finish);
  assert.equal(finish.props.callback, callback);
  assert.equal(nodes(tree).find(n => n.type === 'MerchantWorkspace').props.initialMerchantId, undefined);
  finish.props.onConnected('server-bound-merchant');
  tree = screen.render();
  const workspace = nodes(tree).find(n => n.type === 'MerchantWorkspace');
  assert.equal(workspace.props.initialMerchantId, 'server-bound-merchant');
  assert.equal(workspace.props.initialTab, 'channels');
  assert.ok(!nodes(tree).some(n => n.type === 'MerchantNaverCallback'), 'consumed callback must not remount and exchange twice');
  auth.me = { id: 'other', nickname: '다른 계정' };
  tree = screen.render();
  assert.ok(!nodes(tree).some(n => n.type === 'MerchantNaverCallback' || n.type === 'MerchantWorkspace'));
  const no = component('../src/merchant-web/index.tsx', 'default', { auth, rpc: async () => false, callback });
  no.render(); await no.effect();
  assert.ok(!nodes(no.render()).some(n => n.type === 'MerchantNaverCallback'));
});
