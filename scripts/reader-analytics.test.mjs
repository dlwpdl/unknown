import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as product from '../src/lib/product-analytics.ts';

function load({ href = 'https://gling.ej-entertainment.com/', storage = new Map(), fetch } = {}) {
  const slots = [], views = [], exports = {}, transports = [];
  let index = 0, intervals = 0;
  const noop = () => {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/public-web/analytics.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://db.example' } }, Date, JSON, fetch,
    document: { hidden: false, addEventListener: noop, removeEventListener: noop },
    window: { location: { href }, addEventListener: noop, removeEventListener: noop },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval: () => ++intervals, clearInterval: noop, require(name) {
      if (name === '@/lib/product-analytics') return product;
      if (name === 'react') return { useEffect(effect, deps) {
        const i = index++, previous = slots[i];
        if (previous && deps.every((value, j) => value === previous.deps[j])) return;
        previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
      } };
      return { configureBehavior: transport => transports.push(transport), flushBehavior: async () => {}, behavior: noop, behaviorScreen: screen => views.push(screen), scrollThresholds: () => [] };
    } });
  const render = (key, ready) => { index = 0; exports.useReaderAnalytics('post', key, ready); };
  return { render, views, transports, intervals: () => intervals };
}

test('공개 reader의 첫 조회는 hydration 후 한 번만 시작한다', () => {
  const { render, views, intervals } = load();
  render('post:null', false);
  assert.equal(views.length, 0);
  assert.equal(intervals(), 0);
  render('post:actual-id', true);
  render('post:actual-id', true);
  assert.deepEqual(views, ['post']);
  assert.equal(intervals(), 1);
  render('post:second-id', true);
  assert.equal(views.length, 2);
});

test('웹 행동 기록은 이 탭의 첫 유입 채널을 다음 페이지에서도 보낸다', async () => {
  const storage = new Map(), bodies = [];
  const fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true }; };
  const send = async page => { const { render, transports } = load({ href: page, storage, fetch }); render('feed', true); await transports.find(Boolean)({ session: 's', events: [] }); };
  await send('https://gling.ej-entertainment.com/?utm_source=kakao');
  await send('https://gling.ej-entertainment.com/vancouver');
  await send('https://gling.ej-entertainment.com/?utm_source=naver');
  assert.deepEqual(bodies.map(body => body.p_source), ['kakao', 'kakao', 'kakao']);
  storage.set('gling.entry-source', 'private-user-input');
  await send('https://gling.ej-entertainment.com/');
  assert.equal(bodies.at(-1).p_source, 'unknown', 'a tampered stored value never reaches the server allowlist');
});
