import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { authenticatedChatImages } from '../src/lib/business-chat.ts';
import { chatImagePaths } from '../src/lib/chat-details.ts';

const room = 'c1830000-0000-4000-8000-000000000001', business = 'c1820000-0000-4000-8000-000000000001';
const path = `${business}/${room}_safe.webp`;
function mount(kind = 'business') {
  const hooks = [], effects = [], calls = [], exports = {}; let index = 0;
  const react = { useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = index++; return hooks[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v,j) => v !== hooks[i][j])) { effects[i]?.(); hooks[i] = deps; effects[i] = fn(); } } };
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-aal2-token' } }, error: null }) }, storage: { from(bucket) { assert.equal(bucket, 'chat-images'); return {
    getPublicUrl: value => ({ data: { publicUrl: `https://project.example/storage/v1/object/public/chat-images/${value}` } }),
    createSignedUrls: async paths => { calls.push(paths); return { data: paths.map(path => ({ path, signedUrl: 'legacy-signed-image' })), error: null }; },
  }; } } };
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/admin/admin-conversation-panels.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, JSON, Map, Set, Date, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return Object.fromEntries(['View','Text','FlatList','Pressable','ScrollView','TextInput','Platform'].map(key => [key, key === 'Platform' ? { OS: 'web' } : key]));
    if (name === 'expo-image') return { Image: 'Image' };
    if (name === '@/constants/theme') return { Colors: { admin: {} } };
    if (name === '@/lib/mock') return { CITIES: [] };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/lib/chat-details') return { chatImagePaths };
    if (name === '@/lib/business-chat') return { authenticatedChatImages };
    if (name === '@/lib/supabase') return { supabase: client };
    if (name === './admin-conversation-styles') return { conversationStyles: {} };
    return {};
  } });
  const message = { id: 'message', sender_id: 'private-actor-for-authorized-admin', body: 'Photo', kind: 'image', image_paths: [path], created_at: '2026-10-18T03:00:00Z' };
  const props = { detail: { conversation: { id: room, kind, participants: [], signal_count: 0, pending_analysis: 0 }, messages: [message], signals: [], hasNewer: false }, loading: false, focusId: null, error: '' };
  const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(nodes)];
  return { calls, async image() { index = 0; exports.ConversationThread(props); await new Promise(setImmediate); index = 0; const tree = exports.ConversationThread(props); const list = nodes(tree).find(node => node.type === 'FlatList'); return nodes(list.props.renderItem({ item: message, index: 0 })).find(node => node.type === 'Image'); } };
}

test('audited business image review uses current authorization instead of a shareable signed URL', async () => {
  const view = mount(), image = await view.image();
  assert.equal(view.calls.length, 0);
  assert.ok(image, 'authorized admin still has a visible business attachment');
  assert.equal(image.props.source.headers.Authorization, 'Bearer fixture-aal2-token');
  assert.equal(image.props.source.uri, `https://project.example/storage/v1/object/authenticated/chat-images/${path}`);
  assert.equal(image.props.cachePolicy, 'none');
});

test('existing personal image review retains its signed-image behavior', async () => {
  const view = mount('direct'), image = await view.image();
  assert.deepEqual(view.calls, [[path]]); assert.equal(image.props.source.uri, 'legacy-signed-image');
});
