import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as designSystem from '../src/constants/design-system.ts';
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
    useEffect(fn, deps = [], layout = false) {
      const index = cursor++, previous = hooks[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      const state = hooks[index] = { deps, layout, cleanup: previous?.cleanup };
      effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
    },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  react.useLayoutEffect = (fn, deps) => react.useEffect(fn, deps, true);
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (ctx.rpc) return ctx.rpc(name, args);
    const data = name === 'get_meetup_templates' ? { canUse: true, templates: [template] }
      : name === 'get_meetup_host_tools' ? hostState
        : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: '모임 멤버' }]
          : name === 'get_meetup_host_aggregates' ? { applications: 2, approvals: 1, confirmedAttendance: 3, repeatParticipants: 1 }
            : name === 'propose_meetup_dates' ? [{ startsAt: '2031-01-01T18:00:00Z', endsAt: '2031-01-01T19:00:00Z' }, { startsAt: '2031-01-08T18:00:00Z', endsAt: '2031-01-08T19:00:00Z' }]
              : name === 'invite_next_meetup_waitlist' ? true
                : name === 'get_meetup_fee_payments' ? ctx.payments ?? []
                  : ['set_meetup_fee', 'set_meetup_fee_paid'].includes(name) ? null : ownerId;
    return { data, error: null };
  };
  // The host reads the saved fee from the public meetup row.
  const from = table => ({ select: () => ({ eq: (_, id) => ({ maybeSingle: async () => {
    calls.push(['select', table, id]);
    return { data: { room_preview: ctx.fee ? { fee: ctx.fee } : {} }, error: null };
  } }) }) });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { StyleSheet: { create: value => value }, View: 'View', TextInput: 'TextInput', Alert: { alert: (...args) => alerts.push(args) }, Platform: { get OS() { return ctx.platform ?? 'ios'; } } },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/chilling-date-input': { ChillingDateInput: 'ChillingDateInput' },
    '@/hooks/use-language': { useLanguage: () => ({ language: ctx.language, locale: ctx.language === 'ko' ? 'ko-KR' : 'en-CA', tr: text => text }) },
    '@/hooks/use-theme': { useTheme: () => ctx.theme }, '@/lib/auth': { useAuth: () => ctx.auth },
    '@/constants/design-system': designSystem,
    'expo-router': { useIsFocused: () => ctx.focused !== false },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
    '@/lib/supabase': { supabase: { rpc, from } }, '@/lib/meetup-host-tools': tools,
  };
  const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; }, Date, Intl, JSON, confirm: message => { alerts.push(['web', message]); return ctx.confirm ?? false; } });
  const render = () => { dirty = false; cursor = 0; tree = exports[exportName](props); effects.splice(0).forEach(fn => fn()); };
  const flush = async () => {
    for (let i = 0; i < 20; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length) return tree; }
    throw new Error('component did not settle');
  };
  return { ctx, calls, feedback, alerts, get tree() { return tree; }, flush,
    update(next) { props = { ...props, ...next }; dirty = true; },
    rerender() { dirty = true; },
    unmount() { hooks.forEach(value => value?.cleanup?.()); },
    unmountLayout() { hooks.filter(value => value?.layout).forEach(value => value.cleanup?.()); },
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

test('five thousand roster records keep cohost choices bounded and every eligible name remains reachable', async () => {
  const ids = Array.from({ length: 4999 }, (_, i) => `a1610000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`);
  const roster = [{ userId: ownerId, displayName: 'Host' }, ...ids.map((userId, i) => ({ userId, displayName: `Member ${String(i + 1).padStart(4, '0')}` }))];
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => ({ data: name === 'get_meetup_host_tools' ? { ...hostState, candidates: ids, cohosts: [] }
    : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? roster : name === 'get_meetup_host_aggregates' ? { applications: 5000, approvals: 5000, confirmedAttendance: 0, repeatParticipants: 0 } : null }) });
  await ui.flush();
  const choices = () => nodes(ui.tree).filter(node => node.props?.analyticsId === 'meetup_host_tools.control.10');
  assert.ok(choices().length > 0);
  assert.ok(choices().length <= 20, `Rendered ${choices().length} candidates instead of at most20.`);
  const search = () => nodes(ui.tree).find(node => node.props?.testID === 'meetup-host-candidate-search');
  search().props.onChangeText('Member 4999'); await ui.flush();
  assert.equal(choices().length, 1); choices()[0].props.onPress(); await ui.flush();
  const invitation = ui.calls.find(([name]) => name === 'invite_meetup_cohost');
  assert.equal(invitation[1].p_user_id, ids.at(-1)); assert.equal(invitation[1].p_post_id, postId);
  search().props.onChangeText(''); await ui.flush();
  let pages = 1;
  while (true) {
    const next = nodes(ui.tree).find(node => node.props?.analyticsId === 'meetup_host_tools.candidates.next');
    assert.ok(choices().length <= 20);
    if (next.props.disabled) break;
    next.props.onPress(); await ui.flush(); pages++;
    assert.ok(pages <= 250);
  }
  assert.equal(pages, 250); assert.ok(choices().some(node => text(node).includes('Member 4999')));
  const previous = nodes(ui.tree).find(node => node.props?.analyticsId === 'meetup_host_tools.candidates.previous');
  assert.equal(previous.props.disabled, false); previous.props.onPress(); await ui.flush();
  assert.equal(choices().some(node => text(node).includes('Member 4999')), false);
});

test('retained host mutations cannot dispatch after layout unmount, account, focus or capability changes', async () => {
  for (const boundary of ['layout', 'account', 'focus', 'capability']) {
    let canInvite = true;
    const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => ({ data: name === 'get_meetup_host_tools' ? { ...hostState, canInvite }
      : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: 'Member' }] : null }) });
    await ui.flush();
    const retained = nodes(ui.tree).find(node => node.props?.analyticsId === 'meetup_host_tools.control.10').props.onPress;
    if (boundary === 'layout') ui.unmountLayout();
    else if (boundary === 'account') { ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other-account' } }; ui.rerender(); await ui.flush(); }
    else if (boundary === 'focus') { ui.ctx.focused = false; ui.rerender(); await ui.flush(); }
    else { canInvite = false; button(ui, '상태 다시 확인').props.onPress(); await ui.flush(); }
    const before = ui.calls.length; retained(); await ui.flush();
    assert.deepEqual(ui.calls.slice(before), [], boundary);
    ui.unmount();
  }
});

test('a pending host mutation cannot refresh or celebrate through the next viewer after layout cleanup', async () => {
  let finish;
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => name === 'invite_meetup_cohost'
    ? new Promise(resolve => { finish = () => resolve({ data: null }); })
    : { data: name === 'get_meetup_host_tools' ? hostState : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: 'Member' }] : null } });
  await ui.flush(); nodes(ui.tree).find(node => node.props?.analyticsId === 'meetup_host_tools.control.10').props.onPress(); await ui.flush();
  assert.equal(ui.calls.filter(([name]) => name === 'invite_meetup_cohost').length, 1);
  ui.unmountLayout(); ui.ctx.auth = { ...ui.ctx.auth, me: { id: 'other-account' } };
  const before = ui.calls.length; finish(); await ui.flush();
  assert.equal(ui.calls.length, before); assert.equal(ui.feedback.includes('success'), false);
  ui.unmount();
});

test('a host mutation finishing after blur and refocus cannot apply old success to the new focus', async () => {
  let finish;
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => name === 'invite_meetup_cohost'
    ? new Promise(resolve => { finish = () => resolve({ data: null }); })
    : { data: name === 'get_meetup_host_tools' ? hostState : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: 'Member' }] : null } });
  await ui.flush(); nodes(ui.tree).find(node => node.props?.analyticsId === 'meetup_host_tools.control.10').props.onPress(); await ui.flush();
  ui.ctx.focused = false; ui.rerender(); await ui.flush();
  ui.ctx.focused = true; ui.rerender(); await ui.flush();
  const before = ui.calls.length; finish(); await ui.flush();
  assert.equal(ui.calls.length, before); assert.equal(ui.feedback.includes('success'), false);
  assert.equal(nodes(ui.tree).find(node => node.props?.analyticsId === 'meetup_host_tools.control.10').props.disabled, false, 'The new focus is usable after the old operation settles.');
  ui.unmount();
});

test('retained session proposal cannot dispatch during the layout-to-passive unmount gap', async () => {
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }); await ui.flush();
  const dates = nodes(ui.tree).filter(node => node.type === 'ChillingDateInput');
  dates[0].props.onChange('2031-01-01T18:00:00Z'); dates[1].props.onChange('2031-01-01T19:00:00Z'); await ui.flush();
  const propose = button(ui, '4회 날짜 미리보기').props.onPress;
  ui.unmountLayout(); const before = ui.calls.length; propose(); await ui.flush();
  assert.equal(ui.calls.length, before); ui.unmount();
});

test('session confirmation does not mark an old focus created after blur and refocus', async () => {
  let finish;
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => name === 'confirm_meetup_occurrence'
    ? new Promise(resolve => { finish = () => resolve({ data: postId }); })
    : { data: name === 'get_meetup_host_tools' ? hostState : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: 'Member' }]
      : name === 'propose_meetup_dates' ? [{ startsAt: '2031-01-01T18:00:00Z', endsAt: '2031-01-01T19:00:00Z' }] : null } });
  await ui.flush();
  const dates = nodes(ui.tree).filter(node => node.type === 'ChillingDateInput');
  dates[0].props.onChange('2031-01-01T18:00:00Z'); dates[1].props.onChange('2031-01-01T19:00:00Z'); await ui.flush();
  button(ui, '4회 날짜 미리보기').props.onPress(); await ui.flush();
  button(ui, '이 날짜 확인·등록').props.onPress(); await ui.flush();
  assert.equal(ui.calls.filter(([name]) => name === 'confirm_meetup_occurrence').length, 1);
  ui.ctx.focused = false; ui.rerender(); await ui.flush(); ui.ctx.focused = true; ui.rerender(); await ui.flush();
  finish(); await ui.flush();
  assert.doesNotMatch(text(ui.tree), /등록됨/); assert.equal(ui.feedback.includes('success'), true, 'Only the earlier date-preview feedback was delivered.');
  assert.equal(ui.feedback.filter(value => value === 'success').length, 1); ui.unmount();
});

test('waitlist surface exposes own status, sends only explicit consent and no roster request', async () => {
  const ui = mount('meetup-host-tools', 'MeetupWaitlist', { postId }, { auth: { isAuthed: true, me: { id: memberId } }, rpc: async name => ({ data: name === 'get_meetup_host_tools' ? { ...hostState, tier: 'free', isHost: false, canJoinWaitlist: true, candidates: [], waitlistCount: null } : null }) });
  await ui.flush();
  assert.equal(ui.calls.length, 1);
  button(ui, '초대 알림 받기').props.onPress(); await ui.flush();
  assert.deepEqual(ui.calls.find(([name]) => name === 'set_meetup_waitlist'), ['set_meetup_waitlist', { p_post_id: postId, p_opt_in: true }]);
  assert.equal(ui.calls.some(([name]) => ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name)), false);
  assert.equal(ui.calls.some(([name]) => name === 'respond_meetup_request'), false);
});

test('owner names come only from scoped roster and metric failures never show invented zeroes', async () => {
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => name === 'get_meetup_host_tools' ? { data: hostState }
    : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? { data: [{ userId: memberId, displayName: '모임 전용 이름' }] }
      : { error: { message: 'PREMIUM_REQUIRED' } } });
  await ui.flush();
  assert.match(text(ui.tree), /모임 전용 이름 초대/);
  assert.match(text(ui.tree), /수치를 추정하지 않아요/);
  assert.doesNotMatch(text(ui.tree), /신청(?:자|한 사람) 0명/);
  assert.doesNotMatch(text(ui.tree), /상태를 확인하지 못했어요/, 'a metric failure shows only its own message');
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
  await failed.flush(); assert.equal(failed.tree, null, 'an unverified viewer never sees a host panel shell');
});

test('non-hosts see nothing while loading or after the state confirms they are not hosts', async () => {
  let finish;
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { auth: { isAuthed: true, me: { id: memberId } },
    rpc: () => new Promise(resolve => { finish = () => resolve({ data: { ...hostState, isHost: false, tier: 'free', candidates: [] } }); }) });
  await ui.flush(); assert.equal(ui.tree, null, 'loading');
  finish(); await ui.flush(); assert.equal(ui.tree, null, 'loaded non-host');
});

test('session times: end follows start, server time codes get specific copy and a single page has no pager', async () => {
  let failure = 'SESSION_OVERLAP';
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => name === 'propose_meetup_dates' ? { error: { message: failure } }
    : { data: name === 'get_meetup_host_tools' ? hostState : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: 'Member' }] : null } });
  await ui.flush();
  const pickers = () => nodes(ui.tree).filter(node => node.type === 'ChillingDateInput');
  assert.ok(Date.parse(pickers()[0].props.value) > Date.now(), 'start defaults to the future');
  assert.equal(Date.parse(pickers()[1].props.value) - Date.parse(pickers()[0].props.value), 7200000);
  pickers()[0].props.onChange('2031-01-01T18:00:00.000Z'); await ui.flush();
  assert.equal(pickers()[1].props.value, '2031-01-01T20:00:00.000Z');
  button(ui, '4회 날짜 미리보기').props.onPress(); await ui.flush();
  assert.match(text(ui.tree), /같은 시간에 이미 등록된 회차가 있어요/);
  failure = 'INVALID_SESSION_TIME'; button(ui, '4회 날짜 미리보기').props.onPress(); await ui.flush();
  assert.match(text(ui.tree), /종료 시간은 시작 이후여야 해요/);
  assert.doesNotMatch(text(ui.tree), /연결·참가 권한/);
  assert.equal(nodes(ui.tree).filter(node => node.props?.accessibilityRole === 'alert').length, 1);
  assert.doesNotMatch(text(ui.tree), /1\/1 페이지/, 'a single page has no pager');
  assert.equal(nodes(ui.tree).some(node => node.props?.analyticsId === 'meetup_host_tools.candidates.next'), false);
});

test('cohost removal needs a destructive confirmation on native and web', async () => {
  const state = { ...hostState, cohosts: [{ userId: memberId, status: 'accepted' }] };
  for (const platform of ['ios', 'web']) {
    const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { platform, rpc: async name => ({ data: name === 'get_meetup_host_tools' ? state
      : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: 'Member' }] : null }) });
    await ui.flush();
    const remove = () => nodes(ui.tree).find(node => node.props?.analyticsId === 'meetup_host_tools.control.9');
    assert.equal(remove().props.style.at(-1).borderColor, themes.light.danger);
    remove().props.onPress(); await ui.flush();
    assert.equal(ui.calls.some(([name]) => name === 'remove_meetup_cohost'), false, platform);
    if (platform === 'web') { ui.ctx.confirm = true; remove().props.onPress(); }
    else { assert.equal(ui.alerts[0][2][1].style, 'destructive'); ui.alerts[0][2][1].onPress(); }
    await ui.flush();
    assert.equal(ui.calls.filter(([name]) => name === 'remove_meetup_cohost').length, 1, platform);
  }
});

test('web template deletion uses a browser confirm instead of the no-op Alert', async () => {
  const ui = mount('meetup-template-picker', 'MeetupTemplatePicker', { draft, onApply() {} }, { platform: 'web' });
  await ui.flush(); button(ui, '질문 모음').props.onPress(); await ui.flush();
  button(ui, '이 템플릿 삭제').props.onPress(); await ui.flush();
  assert.equal(ui.calls.some(([name]) => name === 'delete_meetup_template'), false);
  ui.ctx.confirm = true; button(ui, '이 템플릿 삭제').props.onPress(); await ui.flush();
  assert.equal(ui.calls.filter(([name]) => name === 'delete_meetup_template').length, 1);
});

const fee = (ui, id) => nodes(ui.tree).find(node => node.props?.analyticsId === id || node.props?.testID === id);
test('host fee section validates on device, saves, marks paid and clears only after confirmation', async () => {
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId });
  await ui.flush();
  assert.equal(fee(ui, 'meetup.fee.save').props.disabled, true);
  assert.equal(fee(ui, 'meetup.fee.clear'), undefined);
  for (const bad of ['0', '10000.01', '1.234', 'abc']) {
    fee(ui, 'meetup-fee-amount').props.onChangeText(bad); await ui.flush();
    assert.equal(fee(ui, 'meetup.fee.save').props.disabled, true, bad); assert.match(text(ui.tree), /10,000달러 이하/, bad);
  }
  fee(ui, 'meetup-fee-amount').props.onChangeText('15.5'); fee(ui, 'meetup-fee-note').props.onChangeText('가'.repeat(201)); await ui.flush();
  assert.match(text(ui.tree), /200자까지/); assert.equal(fee(ui, 'meetup.fee.save').props.disabled, true);
  fee(ui, 'meetup-fee-note').props.onChangeText('  e-Transfer로 보내주세요 ');
  fee(ui, 'meetup.fee.due').props.onPress(); await ui.flush();
  nodes(ui.tree).find(node => node.type === 'ChillingDateInput' && node.props.label === '이 날까지 내주세요').props.onChange(new Date(2031, 10, 1, 12).toISOString()); await ui.flush();
  assert.equal(ui.calls.some(([name]) => name === 'set_meetup_fee'), false);
  ui.ctx.fee = { amount: 15.5, note: 'e-Transfer로 보내주세요', dueOn: '2031-11-01' };
  fee(ui, 'meetup.fee.save').props.onPress(); await ui.flush();
  assert.deepEqual(ui.calls.find(([name]) => name === 'set_meetup_fee'), ['set_meetup_fee', { p_post_id: postId, p_amount: 15.5, p_note: 'e-Transfer로 보내주세요', p_due_on: '2031-11-01' }]);
  assert.match(text(ui.tree), /회비를 저장했어요/);
  assert.equal(fee(ui, 'meetup-fee-amount').props.value, '15.50');
  assert.match(text(ui.tree), /\$15\.50 · 1명 중 0명 냈어요/);
  let paid = fee(ui, 'meetup.fee.paid');
  assert.equal(paid.props.accessibilityRole, 'checkbox'); assert.equal(paid.props.accessibilityState.checked, false); assert.match(text(paid), /아직/);
  // A paid toggle reloads the panel but keeps an unsaved fee edit.
  fee(ui, 'meetup-fee-note').props.onChangeText('수정 중'); ui.ctx.payments = [{ user_id: memberId, paid_at: '2031-01-01T00:00:00Z' }];
  paid.props.onPress(); await ui.flush();
  assert.deepEqual(ui.calls.find(([name]) => name === 'set_meetup_fee_paid'), ['set_meetup_fee_paid', { p_post_id: postId, p_user_id: memberId, p_paid: true }]);
  paid = fee(ui, 'meetup.fee.paid'); assert.equal(paid.props.accessibilityState.checked, true); assert.match(text(paid), /냈음/);
  assert.match(text(ui.tree), /1명 중 1명 냈어요/); assert.equal(fee(ui, 'meetup-fee-note').props.value, '수정 중');
  fee(ui, 'meetup.fee.clear').props.onPress();
  assert.equal(ui.calls.filter(([name]) => name === 'set_meetup_fee').length, 1, 'clearing waits for confirmation');
  ui.ctx.fee = null; ui.alerts.at(-1)[2][1].onPress(); await ui.flush();
  assert.deepEqual(ui.calls.filter(([name]) => name === 'set_meetup_fee').at(-1), ['set_meetup_fee', { p_post_id: postId, p_amount: null }]);
  assert.equal(fee(ui, 'meetup.fee.clear'), undefined); assert.equal(fee(ui, 'meetup.fee.paid'), undefined); assert.equal(fee(ui, 'meetup-fee-amount').props.value, '');
});

test('fee server errors are explained and closed or waitlist-only panels hide fee controls', async () => {
  const ui = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { rpc: async name => name === 'set_meetup_fee' ? { error: { message: 'MEETUP_CLOSED' } }
    : { data: name === 'get_meetup_host_tools' ? hostState : ['get_chilling_roster_v2', 'get_chilling_roster'].includes(name) ? [{ userId: memberId, displayName: 'Member' }] : null } });
  await ui.flush();
  fee(ui, 'meetup-fee-amount').props.onChangeText('5'); await ui.flush();
  fee(ui, 'meetup.fee.save').props.onPress(); await ui.flush();
  assert.match(text(ui.tree), /마감됐거나 끝난 모임이라 바꿀 수 없어요/); assert.ok(ui.feedback.includes('warning'));
  const closed = mount('meetup-host-tools', 'MeetupHostTools', { postId }, { fee: { amount: 5 }, rpc: async name => ({ data: name === 'get_meetup_host_tools' ? { ...hostState, available: false, canManageSessions: false, canInvite: false } : [] }) });
  await closed.flush();
  assert.match(text(closed.tree), /호스트 도구/);
  assert.equal(nodes(closed.tree).some(node => /^meetup\.fee\./.test(node.props?.analyticsId ?? '')), false);
  assert.equal(closed.calls.some(([name]) => name === 'select' || name === 'get_meetup_fee_payments'), false);
  const waitlist = mount('meetup-host-tools', 'MeetupWaitlist', { postId }, { fee: { amount: 5 }, auth: { isAuthed: true, me: { id: memberId } },
    rpc: async name => ({ data: name === 'get_meetup_host_tools' ? { ...hostState, tier: 'free', isHost: false, canJoinWaitlist: true, candidates: [], waitlistCount: null } : null }) });
  await waitlist.flush();
  assert.match(text(waitlist.tree), /모임 대기 신청/);
  assert.equal(nodes(waitlist.tree).some(node => /^meetup\.fee\./.test(node.props?.analyticsId ?? '')), false);
  assert.deepEqual(waitlist.calls.map(([name]) => name), ['get_meetup_host_tools']);
});
