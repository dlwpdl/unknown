import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const settle = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
const id = 'osm:node:703754423';
const rating = value => ({ [id]: { cityId: 'vancouver', placeId: id, average: value, count: 1 } });
function view(load = async () => rating(8)) {
  let viewer = 'member-a', session, loading = false, state = [], index = 0, focused, cleanup;
  const calls = [], exports = {};
  const imports = {
    react: {
      useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value; }]; },
      useCallback(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot].deps[i])) state[slot] = { fn, deps }; return state[slot].fn; },
    },
    'expo-router': { useFocusEffect(fn) { if (fn !== focused) { cleanup?.(); focused = fn; cleanup = fn(); } } },
    '@/lib/auth': { useAuth: () => ({ isAuthed: viewer != null, me: { id: viewer ?? 'guest' }, isAuthLoading: loading }) },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => { const who = session === undefined ? viewer : session; return { data: { session: who ? { user: { id: who } } : null }, error: null }; } } } },
    '@/lib/place-reviews': { loadPlaceRatingSummaries: async (...args) => { calls.push(args); return load(...args); } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/hooks/use-place-review-summaries.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => imports[name] });
  return { calls, viewer(value) { viewer = value; }, session(value) { session = value; }, loading(value) { loading = value; },
    blur() { cleanup?.(); }, focus() { cleanup = focused(); },
    render(city = 'vancouver', ids = [id]) { index = 0; return exports.usePlaceReviewSummaries(city, ids); } };
}

test('one focus request batches stable place IDs and does not refetch on an ordinary rerender', async () => {
  const ui = view(); ui.render('vancouver', [id, id]); await settle();
  assert.equal(ui.render('vancouver', [id])[id].average, 8);
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0][2].length, 1);
});

test('a blur before the session check finishes does not start a background rating request', async () => {
  const ui = view(); ui.render(); ui.blur(); await settle(); assert.equal(ui.calls.length, 0);
});

test('late results cannot cross an account change', async () => {
  const a = deferred(), b = deferred(); let count = 0;
  const ui = view(() => ++count === 1 ? a.promise : b.promise);
  ui.render(); await settle(); ui.viewer('member-b'); assert.equal(Object.keys(ui.render()).length, 0); await settle();
  a.resolve(rating(9)); await settle(); assert.equal(Object.keys(ui.render()).length, 0);
  b.resolve(rating(7)); await settle(); assert.equal(ui.render()[id].average, 7);
});

test('loading an account hides previous scores until identity is settled', async () => {
  const ui = view(); ui.render(); await settle(); assert.equal(ui.render()[id].average, 8);
  ui.loading(true); assert.equal(Object.keys(ui.render()).length, 0);
});

test('a stale client session cannot run an aggregate query under the wrong viewer key', async () => {
  const ui = view(); ui.viewer(null); ui.session('old-account'); ui.render(); await settle(); assert.equal(ui.calls.length, 0);
});

test('an outage keeps known scores for the same scope but never creates zero-review data', async () => {
  let count = 0; const ui = view(async () => { if (++count > 1) throw Error('offline'); return rating(8); });
  ui.render(); await settle(); ui.blur(); ui.focus(); await settle(); assert.equal(ui.render()[id].average, 8);
  assert.equal(Object.keys(ui.render('toronto')).length, 0); await settle(); assert.equal(Object.keys(ui.render('toronto')).length, 0);
});
