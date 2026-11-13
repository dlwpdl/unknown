import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';
import * as chatIdentity from '../src/lib/chat-identity.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join(' ') : '';

function menu() {
  const feedback = [], routes = [];
  const jsx = (type, props) => ({ type, props });
  const imports = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    // The host quest row (#174) loads after mount; this test only needs it absent.
    react: { useState: value => [value, () => {}], useEffect() {} },
    '@/lib/host-quests': { loadMyHostQuest: async () => null, showQuestEntry: () => false }, '@/lib/supabase': { supabase: {} },
    'expo-router': { useRouter: () => ({ push: route => routes.push(route), canGoBack: () => true, back() {}, replace() {} }) },
    'react-native': { Alert: { alert() {} }, StyleSheet: { create: value => value }, View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/symbol-view': { SymbolView: 'SymbolView' },
    '@/components/merchant-account-connections': { MerchantAccountEntry: 'MerchantAccountEntry' },
    '@/components/linked-account-entry': { LinkedAccountEntry: 'LinkedAccountEntry' },
    '@/components/list-card': { ListCard: 'ListCard' },
    '@/components/clay': { useClayBox: () => false, ClayBoxFill: () => null },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/themed-view': { ThemedView: 'View' },
    '@/constants/theme': { MaxContentWidth: 800, Spacing: {} },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-unread-count': { useUnreadCount: () => 0 },
    '@/hooks/use-chat-identity': { useChatIdentity: () => chatIdentity.chatBusinessIdentity('member') },
    '@/lib/auth': { useAuth: () => ({ trustLevel: 1, signOut() {}, me: { id: 'member', nickname: '이웃' } }) },
    '@/lib/membership-provider': { useMembership: () => ({ membership: null }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/promotions': { PROMOTIONS_PREVIEW_ENABLED: false },
    '@/lib/chat-identity': chatIdentity,
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/profile/menu.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: withLanguageImports(name => { if (name in imports) return imports[name]; throw Error(name); }) });
  return { feedback, routes, render: () => exports.default() };
}
const personal = tree => nodes(tree).find(node => node.props?.analyticsId === 'chat.identity.personal');

test('writing as a business, ··· offers the way back to personal and it clears the shared business identity', () => {
  chatIdentity.resetChatIdentity();
  const app = menu();
  assert.equal(personal(app.render()), undefined, 'a personal profile has nothing to go back to');
  chatIdentity.selectChatBusiness('member', { id: 'biz-a', name: 'Gling App Review' });
  const row = personal(app.render());
  assert.ok(row, 'the return row shows while posting as the business (QA G38-2)');
  assert.match(text(row), /개인으로 돌아가기/);
  assert.match(text(row), /지금은 Gling App Review 이름으로 쓰는 중/);
  assert.equal(nodes(row).some(node => node.props?.name?.ios === 'chevron.right'), false, 'an in-place switch does not look like it opens a page');
  row.props.onPress();
  assert.equal(chatIdentity.chatBusinessIdentity('member'), null, 'the chat tab, meetup detail and header read the same store');
  assert.deepEqual(app.feedback, ['selection']);
  assert.deepEqual(app.routes, []);
  assert.equal(personal(app.render()), undefined);
  chatIdentity.resetChatIdentity();
});
