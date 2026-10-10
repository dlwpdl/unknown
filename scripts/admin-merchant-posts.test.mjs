import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const linked = { post_id: 'post-1', title: '카페 소개', displayed_views: 120, source_clicks: 3, status: 'published' };
const post = { id: 'post-1', title: linked.title, body: '업체가 요청한 소개 본문', tag: { label: '비즈니스' }, author: { id: 'delegate', nickname: '글링 운영자' }, imageUris: ['photo-1', 'photo-2'] };
function app() {
  const state = [], effects = [], pending = [], calls = [], feedback = [];
  let stateIndex = 0, effectIndex = 0;
  let auth = { isAdmin: true, me: { id: 'admin' } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-merchant-posts.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      useState(initial) { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useEffect(fn, deps) { const i = effectIndex++; if (!effects[i] || deps.some((dep, j) => dep !== effects[i].deps[j])) { effects[i]?.cleanup?.(); effects[i] = { fn, deps, changed: true }; } },
    };
    if (name === '@/lib/auth') return { useAuth: () => auth };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
    if (name === '@/lib/feed-data') return {
      loadPublicPost(client, id) { calls.push(id); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
      getPostImageSource: (value, scope, variant, position) => ({ uri: value.imageUris[position] }),
    };
    if (name === '@/lib/supabase') return { supabase: {} };
    if (name === '@/lib/sharing') return { buildSharedPostUrl: id => '/p/' + id };
    throw new Error('Unexpected import: ' + name);
  } });
  let props = { merchantId: 'merchant-1', ownerId: 'owner', linked };
  const render = () => {
    stateIndex = effectIndex = 0;
    const root = exports.AdminMerchantPost(props);
    for (const effect of effects) if (effect.changed) { effect.changed = false; effect.cleanup = effect.fn(); }
    return root;
  };
  return { render, calls, pending, feedback, props(value) { props = { ...props, ...value }; }, auth(value) { auth = value; } };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) { if (node == null || typeof node === 'boolean') return ''; return typeof node === 'string' || typeof node === 'number' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' '); }
function open(view) { view.render().props.onToggle({ currentTarget: { open: true } }); view.render(); }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('expanding a linked post shows its actual author, photos and body without duplicate requests', async () => {
  const view = app();
  assert.equal(view.calls.length, 0);
  open(view); open(view);
  assert.deepEqual(view.calls, ['post-1']);
  view.pending[0].resolve(post); await flush();
  const root = view.render(), all = nodes(root);
  assert.match(text(root), /글링 운영자/);
  assert.match(text(root), /대행·개별 연결/);
  assert.match(text(root), /업체가 요청한 소개 본문/);
  assert.deepEqual(all.filter(node => node.type === 'img').map(node => node.props.src), post.imageUris);
  assert.ok(all.findIndex(node => node.type === 'summary') < all.findIndex(node => node.type === 'img'));
  assert.ok(view.feedback.includes('selection'));
  view.props({ ownerId: 'delegate' });
  assert.match(text(view.render()), /업체 계정 작성/);
});

test('unavailable posts stay unavailable, while a failed read can be retried', async () => {
  const view = app(); open(view);
  view.pending[0].reject(new Error('offline')); await flush();
  const retry = nodes(view.render()).find(node => node.type === 'button');
  assert.ok(retry); retry.props.onClick(); view.render();
  assert.equal(view.calls.length, 2);
  view.pending[1].resolve(null); await flush();
  assert.match(text(view.render()), /공개 중인 글이 아닙니다/);
  assert.equal(nodes(view.render()).filter(node => node.type === 'img').length, 0);
});

test('switching businesses cannot display a late response from the prior business', async () => {
  const view = app(); open(view);
  view.props({ merchantId: 'merchant-2', linked: { ...linked, post_id: 'post-2', title: '다른 업체 글' } });
  view.render();
  view.pending[0].resolve(post); await flush();
  assert.doesNotMatch(text(view.render()), /업체가 요청한 소개 본문/);
  view.pending[1].resolve({ ...post, id: 'post-2', body: '새 업체 본문' }); await flush();
  assert.match(text(view.render()), /새 업체 본문/);
});

test('reopening a failed post clears the prior error when the new read succeeds', async () => {
  const view = app(); open(view);
  view.pending[0].reject(new Error('offline')); await flush();
  view.render().props.onToggle({ currentTarget: { open: false } }); view.render();
  open(view);
  view.pending[1].resolve(post); await flush();
  assert.doesNotMatch(text(view.render()), /불러오지 못했습니다/);
  assert.equal(nodes(view.render()).filter(node => node.type === 'img').length, 2);
});

test('logout and account changes hide cached photos and discard outstanding reads', async () => {
  const view = app(); open(view);
  view.pending[0].resolve(post); await flush();
  assert.equal(nodes(view.render()).filter(node => node.type === 'img').length, 2);
  view.auth({ isAdmin: true, me: { id: 'another-admin' } });
  assert.equal(nodes(view.render()).filter(node => node.type === 'img').length, 0);
  view.auth({ isAdmin: false, me: { id: '' } });
  assert.equal(view.render(), null);
  view.pending[1].resolve(post); await flush();
  assert.equal(view.render(), null);
});
