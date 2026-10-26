// Offline HTML only: real changed TSX through the existing hook fixture + React Native Web.
// No browser, server, backend, native device or external request is used by this helper.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountParticipant, participantPost, participantProfile } from './meetup-participant-ui.test.mjs';
import * as designSystem from '../src/constants/design-system.ts';
import * as flatHelpers from '../src/lib/flat-control.ts';
import * as chilling from '../src/lib/chilling.ts';
import * as hostTools from '../src/lib/meetup-host-tools.ts';
import { translateUi, translationsFor } from '../src/i18n/index.ts';

const require = createRequire(import.meta.url), web = require('react-native-web');
const output = resolve(process.argv[2] ?? '/Users/ash/Desktop/Git/unknown/output/qa/gling-meetup-participant-20261025');
mkdirSync(output, { recursive: true });
const photoPath = '/Users/ash/Desktop/Git/unknown/output/design/gling-meetup-six-concepts-20261025/assets/stanley-park.webp';
const photo = 'data:image/webp;base64,' + readFileSync(photoPath).toString('base64');
const photoSha = createHash('sha256').update(readFileSync(photoPath)).digest('hex');
const colorsSource = readFileSync(new URL('../src/constants/theme.ts', import.meta.url), 'utf8');
const themeExports = {};
vm.runInNewContext(ts.transpileModule(colorsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: themeExports, require: name => name === 'react-native' ? web : {} });
const files = [], used = new Set();
for (const language of ['ko', 'en']) for (const mode of ['light', 'dark']) for (const width of [320, 390, 1024]) {
  const theme = themeExports.Colors[mode];
  const imports = {
    react: React, 'react/jsx-runtime': jsx, 'react-native': { ...web, Platform: { ...web.Platform, OS: 'ios' } },
    'expo-router': { useRouter: () => ({ push() {} }) }, 'react-native-reanimated': { useReducedMotion: () => true },
    'expo-image': { Image: ({ contentFit, recyclingKey, cachePolicy, ...props }) => React.createElement(web.Image, { ...props, resizeMode: contentFit ?? 'cover' }) },
    'expo-symbols': { SymbolView: ({ size, tintColor }) => React.createElement(web.Text, { accessible: false, style: { color: tintColor, width: size, height: size, fontSize: size, lineHeight: size, textAlign: 'center' } }, '⌄') },
    '@/constants/theme': themeExports, '@/constants/design-system': designSystem, '@/lib/chilling': chilling,
    '@/hooks/use-language': { useLanguage: () => ({ language, locale: language === 'ko' ? 'ko-KR' : 'en-CA', t: translationsFor(language), tr: (value, ...args) => translateUi(language, value, ...args) }) },
    '@/hooks/use-theme': { useTheme: () => theme }, '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'viewer', nickname: '하늘' } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) }, '@/lib/flat-control': flatHelpers,
    '@/lib/behavior-analytics': { behavior() {}, behaviorView() { return ''; }, scrollThresholds() { return []; } },
    '@/lib/feed-data': { getPostImageSource: () => ({ uri: photo }) }, '@/lib/community-data': { recordPostShare() {} }, '@/lib/supabase': { supabase: {} }, '@/lib/meetup-host-tools': hostTools,
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver' }] },
    '@/lib/chilling-data': { CHILLING_PROMPTS: { meet: '어떤 만남을 좋아하나요?', join: '함께 하고 싶은 것' } },
    '@/components/chat-identity-switcher': { ChatIdentitySwitcher: () => null }, '@/components/report-sheet': { ReportSheet: () => null }, '@/components/post-share-sheet': { PostShareSheet: () => null }, '@/components/trust-badge': { TrustBadge: () => null },
  };
  function compile(name) {
    const exports = {}, path = `src/components/${name}.tsx`; used.add(path);
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => { assert.ok(name in imports, `Unmocked import ${name}`); return imports[name]; }, Date, Intl });
    imports['@/components/' + name] = exports; return exports;
  }
  const { ThemedText } = compile('themed-text'); compile('flat-pressable'); const controls = compile('analytics-controls');
  imports['@/components/glass-surface'] = { GlassSurface: ({ children, style }) => React.createElement(web.View, { style: [{ borderWidth: 1, borderColor: theme.line, backgroundColor: theme.backgroundElement }, style] }, children) };
  const { MeetupKindSwitch } = compile('meetup-kind-switch'), { ChillingProfileCard } = compile('chilling-profile-card'), { ChillingEvent, ChillingEventSchedule } = compile('chilling-event'), { RaisedActionButton } = compile('raised-action-button'), { StateCard } = compile('state-card'), { ProfileAvatarButton } = compile('profile-avatar-button');
  const base = { language, width, theme };
  const discovery = mountParticipant('discovery', base), mine = mountParticipant('mine', { ...base, myItems: ['host', 'approved', 'pending'].map((role, i) => ({ ...participantPost, id: String(i), role, authorId: 'host', conversationId: role === 'pending' ? null : 'conversation' })) });
  const joinForm = mountParticipant('join', base), result = mountParticipant('join', { ...base, request: { id: 'request', status: 'pending' } });
  await Promise.all([discovery.flush(), mine.flush(), joinForm.flush(), result.flush()]);
  const components = { View: web.View, TabContent: web.View, ThemedView: web.View, TextInput: web.TextInput, ThemedText, Pressable: controls.Pressable, ScrollView: controls.ScrollView, Symbol: imports['expo-symbols'].SymbolView, GlassSurface: imports['@/components/glass-surface'].GlassSurface, MeetupKindSwitch, ChillingEvent, ChillingEventSchedule, ChillingProfileCard, RaisedActionButton, StateCard, ProfileAvatarButton, Fragment: React.Fragment };
  function element(node, index) {
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (!node || typeof node !== 'object') return null;
    const { children, ...props } = node.props ?? {};
    if (['Modal', 'UserSheet', 'GlingLoader', 'MeetupPolicyNotice'].includes(node.type)) return null;
    if (node.type === 'FlatList') return React.createElement(web.ScrollView, { key: index, contentContainerStyle: props.contentContainerStyle }, element(props.ListHeaderComponent), ...props.data.map((item, i) => element(props.renderItem({ item, index: i }), item.id)), element(props.ListFooterComponent));
    const Component = components[node.type]; assert.ok(Component, `Unrendered actual node ${String(node.type)}`);
    // The hook fixture's Animated values are fixed initial states; no animation/native effects run.
    const cleanStyle = value => Array.isArray(value) ? value.map(cleanStyle) : value && typeof value === 'object' ? Object.keys(value).length === 1 && 'value' in value ? value.value : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanStyle(item)])) : value;
    const style = props.style && cleanStyle(props.style);
    return React.createElement(Component, { ...props, ...(style ? { style } : {}), key: index }, ...[children].flat(Infinity).map(element));
  }
  const snapshots = [['discover', discovery.tree], ['mine', mine.tree], ['apply', joinForm.tree], ['pending', result.tree]];
  const appName = `Participant${language}${mode}${width}`;
  web.AppRegistry.registerComponent(appName, () => () => React.createElement(web.View, { style: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 } }, ...snapshots.map(([name, tree]) => React.createElement(web.View, { key: name, style: { width: width === 1024 ? 460 : width, maxWidth: '100%', height: 920, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.background }, nativeID: name }, element(tree)))));
  const app = web.AppRegistry.getApplication(appName, {});
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${renderToStaticMarkup(app.getStyleElement())}<style>html,body{margin:0;background:${theme.background};color:${theme.text};font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}body{max-width:100%;overflow-wrap:anywhere}h1{font-size:14px;font-weight:400;margin:8px}</style></head><body><h1>Synthetic fixtures · actual TSX · ${language}/${mode}/${width} · system symbols and glass are static adapters</h1>${renderToStaticMarkup(app.element)}</body></html>`;
  const path = join(output, `${language}-${mode}-${width}.html`); writeFileSync(path, html); files.push(path);
  for (const ui of [discovery, mine, joinForm, result]) ui.unmount();
}
for (const file of ['src/app/(tabs)/meetups.tsx', 'src/app/meetup-join.tsx', 'src/components/my-meetups.tsx', 'src/lib/chilling-discovery.ts']) used.add(file);
const sourceHashes = Object.fromEntries([...used].map(path => [path, createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex')]));
writeFileSync(join(output, 'render-fixtures.json'), JSON.stringify({ createdAt: new Date().toISOString(), scope: 'Actual component TSX and real Gling text/control styles via RN Web SSR; synthetic rows/session only; offline HTML generated, browser/native not executed by this worker. Static system symbol/glass adapters; original photo from approved concept pack. Native font/layout/interaction still require Root QA.', sourceHashes, photo: { path: photoPath, sha256: photoSha }, files }, null, 2));
console.log(JSON.stringify({ output, files: files.length, manifest: join(output, 'render-fixtures.json') }));
