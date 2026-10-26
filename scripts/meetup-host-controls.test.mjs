import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
// Real meetup-room-summary helpers with synthetic RPC, Alert and router boundaries.
function load({ os = 'ios', fail } = {}) {
  const calls = [];
  const exports = {};
  const source = readFileSync(new URL('../src/components/meetup-room-summary.tsx', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, globalThis: { confirm: () => { calls.push(['confirm']); return true; }, alert: value => calls.push(['web-alert', value]) },
    require: withLanguageImports(name => {
      if (name === 'react') return { useState: value => [value, () => {}], useEffect() {} };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'react-native') return { StyleSheet: { create: value => value, hairlineWidth: 1 }, View: 'View', Platform: { OS: os },
        Alert: { alert: (...args) => calls.push(['alert', ...args]) }, DeviceEventEmitter: { emit: value => calls.push(['emit', value]) } };
      if (name === '@/lib/chilling-data') return { getChillingError: error => error.message,
        setMeetupRecruiting: async (_client, postId, open) => { calls.push(['rpc', postId, open]); if (fail) throw new Error(fail); } };
      if (name === '@/lib/community-data') return { MEETUPS_CHANGED_EVENT: 'changed' };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
      if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => calls.push(['feedback', kind]) }) };
      if (name === '@/constants/theme') return { Spacing: {} };
      return new Proxy({}, { get: (_target, key) => key });
    }),
  });
  const tr = (text, ...values) => values.reduce((out, value, i) => out.replace(`{${i}}`, value), text);
  const actions = (room, onChanged) => exports.meetupHostActions({ postId: 'meetup', room, tr, play: kind => calls.push(['feedback', kind]), router: { push: route => calls.push(['push', JSON.parse(JSON.stringify(route))]) }, onChanged });
  return { exports, calls, actions };
}

test('closing recruiting confirms first and keeps members and pending requests in the explanation', async () => {
  const ui = load();
  let changed = 0;
  const close = ui.actions({}, () => changed++).find(({ key }) => key === 'recruiting');
  assert.equal(close.label, '모집 마감하기');
  close.onPress();
  const [, title, body, buttons] = ui.calls.find(([name]) => name === 'alert');
  assert.equal(title, '모집을 마감할까요?'); assert.match(body, /멤버와 대기 중인 신청은 그대로/);
  assert.equal(ui.calls.some(([name]) => name === 'rpc'), false, 'nothing changes before confirming');
  buttons.find(({ style }) => style !== 'cancel').onPress(); await tick();
  assert.deepEqual(ui.calls.filter(([name]) => name === 'rpc'), [['rpc', 'meetup', false]]);
  assert.ok(ui.calls.some(([name, value]) => name === 'emit' && value === 'changed')); assert.equal(changed, 1);
});

test('reopening calls the RPC directly; web uses the browser confirm for closing', async () => {
  const ui = load();
  const reopen = ui.actions({ recruitingClosed: true }).find(({ key }) => key === 'recruiting');
  assert.equal(reopen.label, '모집 다시 열기');
  reopen.onPress(); await tick();
  assert.deepEqual(ui.calls.filter(([name]) => name === 'rpc'), [['rpc', 'meetup', true]]);
  assert.equal(ui.calls.some(([name]) => name === 'alert'), false);
  const web = load({ os: 'web' });
  web.actions({}).find(({ key }) => key === 'recruiting').onPress(); await tick();
  assert.deepEqual(web.calls.filter(([name]) => name === 'confirm' || name === 'rpc'), [['confirm'], ['rpc', 'meetup', false]]);
});

test('a refused change warns with the mapped error, edit routes to the edit screen, ended meetups get no actions', async () => {
  const ui = load({ fail: 'MEETUP_CLOSED' });
  ui.actions({ recruitingClosed: true }).find(({ key }) => key === 'recruiting').onPress(); await tick();
  assert.ok(ui.calls.some(([name, value]) => name === 'feedback' && value === 'warning'));
  assert.equal(ui.calls.find(([name]) => name === 'alert')[2], 'MEETUP_CLOSED');
  ui.actions({}).find(({ key }) => key === 'edit').onPress();
  assert.deepEqual(ui.calls.at(-1), ['push', { pathname: '/meetup-edit', params: { postId: 'meetup' } }]);
  assert.equal(ui.actions({ closed: true }).length, 0);
});

test('the approval history choice is off by default, toggles with feedback and uses the registered id', () => {
  const ui = load();
  const values = [];
  const choice = ui.exports.MeetupHistoryChoice({ value: false, onChange: value => values.push(value) });
  assert.equal(choice.props.analyticsId, 'meetup.request.history');
  assert.deepEqual({ ...choice.props.accessibilityState }, { checked: false, disabled: false });
  choice.props.onPress();
  assert.deepEqual(values, [true]); assert.deepEqual(ui.calls.at(-1), ['feedback', 'selection']);
});
