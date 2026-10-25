import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function profile() {
  let authenticated = true;
  let canGoBack = true;
  const routes = [], feedback = [], shares = [];
  const imports = {
    react: { useEffect() {}, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'react/jsx-runtime': { Fragment: 'Fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-router': { Stack: { Screen: 'Screen' }, useRouter: () => ({ push: route => routes.push(route), canGoBack: () => canGoBack, back: () => routes.push('back'), replace: route => routes.push(route) }) },
    'expo-symbols': { SymbolView: 'SymbolView' }, 'expo-image': { Image: 'Image' }, 'expo-image-picker': {},
    'react-native': { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'ios' }, Animated: { Value: class {}, View: 'AnimatedView' }, Share: { share: async value => shares.push(value) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'react-native-reanimated': { __esModule: true, default: { View: 'View' }, useReducedMotion: () => true, FadeIn: { duration() {} }, FadeInDown: { duration() {} } },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/merchant-account-connections': { MerchantAccountEntry: 'MerchantAccountEntry' },
    '@/components/chat-identity-switcher': { ChatIdentitySwitcher: 'ChatIdentitySwitcher' },
    '@/components/gling-loader': { GlingLoader: 'Loader' }, '@/components/login-panel': { LoginPanel: 'LoginPanel' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/themed-view': { ThemedView: 'View' }, '@/components/trust-badge': { TrustBadge: 'TrustBadge' },
    '@/constants/theme': { Depth: {}, Spacing: {}, TabBarHeight: 49, MaxContentWidth: 800 },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ({ isAuthed: authenticated, me: { id: 'member', nickname: '이웃' }, trustLevel: 1 }) },
    '@/lib/membership-provider': { useMembership: () => ({ membership: { tier: 'free' } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/hooks/use-unread-count': { useUnreadCount: () => 3 },
    '@/i18n/ko': { t: { auth: { reasonProfile: '내 프로필' }, profile: { settings: '설정', changePhoto: '사진 변경', location: () => '', stats: () => '' }, notifications: { title: '알림' }, trust: { short: () => '' } } },
    '@/lib/mock': { CITIES: [], TAGS: [] }, '@/lib/community-data': {}, '@/lib/feed-data': {}, '@/lib/meetup-ai': {}, '@/lib/promotions': { PROMOTIONS_PREVIEW_ENABLED: false }, '@/lib/supabase': {},
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/profile/index.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, process: { env: {} }, require: withLanguageImports(name => { if (name in imports) return imports[name]; throw Error(name); }) });
  return { render: exports.default, routes, feedback, shares, signOut() { authenticated = false; }, signIn() { authenticated = true; }, setCanGoBack(value) { canGoBack = value; } };
}

test('profile header offers the shared switcher before invite and settings, then clears actions on sign-out', async () => {
  const app = profile(), tree = app.render(), header = nodes(tree).find(n => n.type === 'Screen').props.options.headerRight();
  const switcher = nodes(header).find(n => n.type === 'ChatIdentitySwitcher');
  assert.equal(switcher?.props.target, 'business');
  assert.equal(header.props.children[0], switcher);
  const photo = nodes(tree).find(n => n.props?.analyticsId === 'app_profile_index.pressable.1');
  assert.equal(photo.props.accessibilityLabel, '사진 변경', 'The own-photo control remains an editor, separate from profile switching.');
  assert.equal(typeof photo.props.onPress, 'function');
  nodes(header).find(n => n.props.analyticsId === 'app_profile_index.pressable.8').props.onPress();
  assert.equal(app.routes.at(-1), '/profile/settings');
  assert.equal(app.feedback.at(-1), 'selection');
  nodes(header).find(n => n.props.analyticsId === 'app_profile_index.invite').props.onPress();
  assert.equal(app.shares.length, 1); assert.match(app.shares[0].message, /https:\/\/gling\.ej-entertainment\.com/);
  assert.equal(nodes(tree).filter(n => n.type === 'ScrollView').length, 1);
  app.signOut();
  const guest = app.render();
  assert.ok(nodes(guest).some(n => n.type === 'LoginPanel'));
  const guestHeader = nodes(guest).find(n => n.type === 'Screen');
  assert.ok(guestHeader, 'the signed-out render must clear previously configured native header actions');
  assert.equal(guestHeader.props.options.headerRight(), null);
});

test('guest profile hides the extra native header, preserves an exit, and restores the member header', () => {
  const app = profile();
  app.signOut();
  const guest = app.render();
  assert.equal(nodes(guest).find(n => n.type === 'Screen').props.options.headerShown, false);
  const login = nodes(guest).find(n => n.type === 'LoginPanel');
  assert.equal(typeof login.props.onClose, 'function');
  login.props.onClose();
  assert.equal(app.routes.at(-1), 'back');
  app.setCanGoBack(false);
  login.props.onClose();
  assert.equal(app.routes.at(-1), '/');
  app.signIn();
  assert.equal(nodes(app.render()).find(n => n.type === 'Screen').props.options.headerShown, true);
});
