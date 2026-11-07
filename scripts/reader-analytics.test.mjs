import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as product from '../src/lib/product-analytics.ts';

function load({ href = 'https://gling.ej-entertainment.com/', storage = new Map(), fetch, clock = Date } = {}) {
  const slots = [], views = [], exports = {}, transports = [], dwell = [], ticks = [], listeners = {};
  let index = 0, intervals = 0;
  const noop = () => {};
  const listen = (name, handler) => { listeners[name] = handler; };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/public-web/analytics.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://db.example' } }, Date: clock, JSON, fetch, Element: class {},
    document: { hidden: false, documentElement: { scrollHeight: 1 }, addEventListener: listen, removeEventListener: noop },
    window: { location: { href }, scrollY: 0, innerHeight: 1, addEventListener: listen, removeEventListener: noop },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval: tick => { ticks.push(tick); return ++intervals; }, clearInterval: noop, require(name) {
      if (name === '@/lib/product-analytics') return product;
      if (name === 'react') return { useEffect(effect, deps) {
        const i = index++, previous = slots[i];
        if (previous && deps.every((value, j) => value === previous.deps[j])) return;
        previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
      } };
      return { configureBehavior: transport => transports.push(transport), flushBehavior: async () => {}, behavior: (kind, _target, value) => { if (kind === 'dwell') dwell.push(value); }, behaviorScreen: screen => views.push(screen), scrollThresholds: () => [] };
    } });
  const render = (key, ready) => { index = 0; exports.useReaderAnalytics('post', key, ready); };
  return { render, views, transports, intervals: () => intervals, dwell, ticks, listeners };
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

test('공개 reader는 5분 동안 조작이 없으면 머무름을 세지 않고, 다시 조작하면 이어서 센다', () => {
  let now = 1_000_000;
  const { render, dwell, ticks, listeners } = load({ clock: { now: () => now } });
  render('post:id', true);
  const wait = times => { for (let i = 0; i < times; i++) { now += 30000; ticks.at(-1)(); } };
  wait(9);
  assert.equal(dwell.length, 9, '5분이 되기 전에는 실제로 읽는 시간으로 센다');
  wait(10);
  assert.equal(dwell.length, 9, '5분이 지나면 기록이 쌓이지 않는다');
  listeners.scroll();
  wait(1);
  assert.deepEqual(dwell.slice(9), [30000], '스크롤하면 다시 센다');
  wait(20);
  listeners.click({ target: null });
  wait(1);
  assert.equal(dwell.at(-1), 30000, '클릭해도 다시 센다');
  wait(20);
  const counted = dwell.length;
  listeners.pagehide();
  assert.equal(dwell.length, counted, '오래 방치한 탭을 닫을 때도 그 시간을 더하지 않는다');
});
