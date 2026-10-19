import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as tools from '../src/lib/meetup-host-tools.ts';

const postId = 'a1620000-0000-0000-0000-000000000001';
const ownerId = 'a1610000-0000-0000-0000-000000000001';
const memberId = 'a1610000-0000-0000-0000-000000000002';
const draft = { title: '산책', body: '함께 걸어요', applicationQuestion: '어떤 길을 좋아하세요?' };
const template = { id: memberId, name: '질문 모음', draft: { title: '', body: '', applicationQuestion: '처음 오시나요?' }, updatedAt: '2030-01-01' };
const hostState = { tier: 'premium', isHost: true, isCohost: false, canManageSessions: true, canInvite: true,
  kind: 'group', available: true, canJoinWaitlist: false, waitlist: null, waitlistCount: 1, cohosts: [], candidates: [memberId] };
export const themes = {
  light: { card: '#FFFFFF', line: '#DFDAE9', text: '#211D2B', textSecondary: '#625C70', backgroundSelected: '#EDE6FA', accent: '#6E4AA2', danger: '#B33246', background: '#F7F7FB' },
  dark: { card: '#171722', line: '#343443', text: '#F6F3F0', textSecondary: '#B7B4C3', backgroundSelected: '#343443', accent: '#CBB9FF', danger: '#FF8585', background: '#0B0B12' },
};

// Match the repo's product-entrances hook harness: real TSX and helpers, mocked native/network boundaries.
export function mount(file, exportName, initialProps = {}, options = {}) {
  const hooks = [], effects = [], calls = [], feedback = [], alerts = [];
  const ctx = { language: 'ko', theme: themes.light, auth: { isAuthed: true, me: { id: ownerId } }, ...options };
  let cursor = 0, dirty = true, tree, props = initialProps;
  const react = {
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof value === 'function' ? value() : value;
      return [hooks[index], next => { const value = typeof next === 'function' ? next(hooks[index]) : next;
        if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }];
    },
    useEffect(fn, deps = []) {
      const index = cursor++, previous = hooks[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      const state = hooks[index] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
    },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  react.useLayoutEffect = react.useEffect;
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (ctx.rpc) return ctx.rpc(name, args);
    const data = name === 'get_meetup_templates' ? { canUse: true, templates: [template] }
      : name === 'get_meetup_host_tools' ? hostState
        : name === 'get_chilling_roster' ? [{ userId: memberId, displayName: '모임 멤버' }]
          : name === 'get_meetup_host_aggregates' ? { applications: 2, approvals: 1, confirmedAttendance: 3, repeatParticipants: 1 }
            : name === 'propose_meetup_dates' ? [{ startsAt: '2031-01-01T18:00:00Z', endsAt: '2031-01-01T19:00:00Z' }, { startsAt: '2031-01-08T18:00:00Z', endsAt: '2031-01-08T19:00:00Z' }]
              : name === 'invite_next_meetup_waitlist' ? true : ownerId;
    return { data, error: null };
  };
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { StyleSheet: { create: value => value }, View: 'View', TextInput: 'TextInput', Alert: { alert: (...args) => alerts.push(args) } },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/chilling-date-input': { ChillingDateInput: 'ChillingDateInput' },
    '@/hooks/use-language': { useLanguage: () => ({ language: ctx.language, locale: ctx.language === 'ko' ? 'ko-KR' : 'en-CA', tr: text => text }) },
    '@/hooks/use-theme': { useTheme: () => ctx.theme }, '@/lib/auth': { useAuth: () => ctx.auth },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
    '@/lib/supabase': { supabase: { rpc } }, '@/lib/meetup-host-tools': tools,
  };
  const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; }, Date, Intl, JSON });
  const render = () => { dirty = false; cursor = 0; tree = exports[exportName](props); effects.splice(0).forEach(fn => fn()); };
  const flush = async () => {
    for (let i = 0; i < 20; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length) return tree; }
    throw new Error('component did not settle');
  };
  return { ctx, calls, feedback, alerts, get tree() { return tree; }, flush,
    update(next) { props = { ...props, ...next }; dirty = true; },
    rerender() { dirty = true; },
    unmount() { hooks.forEach(value => value?.cleanup?.()); },
  };
}
export const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
export const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : !tree || typeof tree !== 'object' ? '' : [tree.props?.children].flat(Infinity).map(text).join(' ');
const button = (ui, label) => { const found = nodes(ui.tree).find(node => node.type === 'Pressable' && text(node).includes(label)); assert.ok(found, `Missing button ${label}`); return found; };

test('template preview is explicit and question-only apply preserves title/body', async () => {
  const applied = [], ui = mount('meetup-template-picker', 'MeetupTemplatePicker', { draft, onApply: value => applied.push(value) });
  await ui.flush();
  button(ui, '질문 모음').props.onPress(); await ui.flush();
  assert.equal(applied.length, 0);
  assert.match(text(ui.tree), /적용 전 미리보기/);
  button(ui, '이 초안 적용').props.onPress(); await ui.flush();
  assert.deepEqual(applied, [{ ...draft, applicationQuestion: '처음 오시나요?' }]);
  assert.equal(ui.calls.filter(([name]) => name === 'get_meetup_templates').length, 2, 'apply rechecks current server entitlement');
  assert.ok(ui.feedback.includes('success'));
});

test('template application rechecks expiry and preserves edits made during that check', async () => {
  const applied = [], ui = mount('meetup-template-picker', 'MeetupTemplatePicker', { draft, onApply: value => applied.push(value) });
  await ui.flush(); button(ui, '질문 모음').props.onPress(); await ui.flush();
  let resolve;
  ui.ctx.rpc = async () => new Promise(done => { resolve = done; });
  button(ui, '이 초안 적용').props.onPress();
  ui.update({ draft: { ...draft, body: '기다리는 동안 수정했어요' } }); await ui.flush();
  resolve({ data: { canUse: true, templates: [template] } }); await ui.flush();
  assert.equal(applied.length, 0);
  assert.match(text(ui.tree), /작성 중인 내용이 바뀌었어요/);
  ui.ctx.rpc = async () => ({ data: { canUse: false, templates: [template] } });
  button(ui, '이 초안 적용').props.onPress(); await ui.flush();
  assert.equal(applied.length, 0);
  assert.equal(button(ui, '이 초안 적용').props.disabled, true);
});

test('template deletion requires explicit destructive confirmation', async () => {
  const ui = mount('meetup-template-picker', 'MeetupTemplatePicker', { draft, onApply() {} });
  await ui.flush(); button(ui, '질문 모음').props.onPress(); await ui.flush();
  button(ui, '이 템플릿 삭제').props.onPress();
  assert.equal(ui.calls.some(([name]) => name === 'delete_meetup_template'), false);
  assert.equal(ui.alerts[0][2][0].style, 'cancel');
  ui.alerts[0][2][1].onPress(); await ui.flush();
  assert.equal(ui.calls.filter(([name]) => name === 'delete_meetup_template').length, 1);
});

test('parent rejection keeps template preview open and never reports an applied draft', async () => {
  const ui = mount('meetup-template-picker', 'MeetupTemplatePicker', { draft, onApply: () => false });
  await ui.flush(); button(ui, '질문 모음').props.onPress(); await ui.flush();
  button(ui, '이 초안 적용').props.onPress(); await ui.flush();
  assert.doesNotMatch(text(ui.tree), /초안에 적용했어요/);
  assert.match(text(ui.tree), /적용 전 미리보기/);
  assert.equal(ui.feedback.includes('success'), false);
});

test('proposals are read-only until each explicit creation and duplicate presses are guarded', async () => {
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId });
  await ui.flush();
  assert.equal(button(ui, '4회 날짜 미리보기').props.disabled, true);
  assert.equal(nodes(ui.tree).filter(node => node.props?.accessibilityRole === 'radio' && node.props.accessibilityState.checked).length, 1);
  const pickers = nodes(ui.tree).filter(node => node.type === 'ChillingDateInput');
  pickers[0].props.onChange('2031-01-01T18:00:00Z'); pickers[1].props.onChange('2031-01-01T19:00:00Z'); await ui.flush();
  button(ui, '4회 날짜 미리보기').props.onPress(); await ui.flush();
  assert.equal(ui.calls.filter(([name]) => name === 'propose_meetup_dates').length, 1);
  assert.equal(ui.calls.some(([name]) => name === 'confirm_meetup_occurrence'), false);
  const create = button(ui, '이 날짜 확인·등록'); create.props.onPress(); create.props.onPress(); await ui.flush();
  const creations = ui.calls.filter(([name]) => name === 'confirm_meetup_occurrence');
  assert.equal(creations.length, 1);
  assert.equal(creations[0][1].p_starts_at, '2031-01-01T18:00:00Z');
  assert.equal(nodes(ui.tree).filter(node => node.type === 'Pressable' && text(node) === '등록됨').length, 1);
});

test('waitlist surface exposes own status, sends only explicit consent and no roster request', async () => {
  const ui = mount('meetup-host-tools', 'MeetupWaitlist', { postId }, { auth: { isAuthed: true, me: { id: memberId } }, rpc: async name => ({ data: name === 'get_meetup_host_tools' ? { ...hostState, tier: 'free', isHost: false, canJoinWaitlist: true, candidates: [], waitlistCount: null } : null }) });
  await ui.flush();
  assert.equal(ui.calls.length, 1);
  button(ui, '초대 알림 받기').props.onPress(); await ui.flush();
  assert.deepEqual(ui.calls.find(([name]) => name === 'set_meetup_waitlist'), ['set_meetup_waitlist', { p_post_id: postId, p_opt_in: true }]);
  assert.equal(ui.calls.some(([name]) => name === 'get_chilling_roster'), false);
  assert.equal(ui.calls.some(([name]) => name === 'respond_meetup_request'), false);
});

test('owner names come only from scoped roster and metric failures never show invented zeroes', async () => {
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => name === 'get_meetup_host_tools' ? { data: hostState }
    : name === 'get_chilling_roster' ? { data: [{ userId: memberId, displayName: '모임 전용 이름' }] }
      : { error: { message: 'PREMIUM_REQUIRED' } } });
  await ui.flush();
  assert.match(text(ui.tree), /모임 전용 이름 초대/);
  assert.match(text(ui.tree), /수치를 추정하지 않아요/);
  assert.doesNotMatch(text(ui.tree), /신청(?:자|한 사람) 0명/);
  assert.equal(ui.calls.some(([name]) => /application|public_user/.test(name)), false);
});

test('both themes and languages render actual controls with accessible labels and retry', async () => {
  for (const language of ['ko', 'en']) for (const theme of Object.values(themes)) {
    const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { language, theme });
    await ui.flush();
    assert.match(text(ui.tree), language === 'ko' ? /호스트 도구/ : /Host tools/);
    const controls = nodes(ui.tree).filter(node => node.type === 'Pressable');
    assert.ok(controls.length > 5);
    assert.ok(controls.every(node => ['button', 'radio'].includes(node.props.accessibilityRole)));
    assert.ok(controls.every(node => typeof node.props.accessibilityState.disabled === 'boolean'));
  }
  const guest = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { auth: { isAuthed: false, me: { id: 'guest' } } });
  await guest.flush(); assert.equal(guest.tree, null); assert.equal(guest.calls.length, 0);
  const failed = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async () => ({ error: { message: 'offline' } }) });
  await failed.flush(); assert.equal(button(failed, '상태 다시 확인').props.disabled, false);
});
