import assert from 'node:assert/strict';
import * as meetupSections from '../src/lib/meetup-sections.ts';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as designSystem from '../src/constants/design-system.ts';
import * as chilling from '../src/lib/chilling.ts';
import { translateUi } from '../src/i18n/index.ts';
import { ticketmasterReference } from '../supabase/functions/_shared/ticketmaster.ts';
import { splitEventMeetupBody } from './test-meetup-source-imports.mjs';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const settle = () => new Promise(setImmediate);
const place = { id: 'osm:node:123', cityId: 'vancouver', name: 'Test café', sourceUrl: 'https://www.openstreetmap.org/node/123' };
const placeTail = `\n\n장소: ${place.name}\n장소 정보: ${place.sourceUrl}`;
const start = new Date(Date.now() + 2 * 86400000); start.setMinutes(0, 0, 0);
const onceRoom = { id: 'p1', title: '노을', memberCount: 3, capacity: 6, verifiedOnly: false, eventKind: 'once', category: 'casual', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: 'America/Vancouver', cadence: null };

const destinations = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/meetup-destination.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: destinations, URL, require(name) {
    if (name.includes('city-places')) return { getCityPlaces: city => city === place.cityId ? [place] : [] };
    if (name.includes('mock')) return { CITIES: [{ id: 'vancouver', state: 'open' }] };
    if (name.includes('ticketmaster')) return { ticketmasterReference };
    throw Error('Unexpected import ' + name);
  },
});
const screenSource = ts.transpileModule(readFileSync(new URL('../src/app/meetup-edit.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function screen({ meId = 'host', meetup = { id: 'p1', cityId: 'vancouver', title: '노을 보러 가요', body: `같이 걸어요.${placeTail}`, room: onceRoom, authorId: 'host' }, configure, edit } = {}) {
  const slots = [], effects = [], layouts = [], feedback = [], alerts = [], events = [], routes = [], configured = [], edited = [];
  let at = 0, guard = { enabled: false };
  const slot = initial => { const i = at++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return i; };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: {
      useState: initial => { const i = slot(initial); return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
      useRef: initial => slots[slot(() => ({ current: initial }))],
      useEffect: (callback, deps) => { const i = at++, previous = slots[i]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { slots[i] = { deps }; effects.push(callback); } },
      useLayoutEffect: callback => layouts.push(callback),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' }, StyleSheet: { create: x => x, hairlineWidth: 1 }, Alert: { alert: (...args) => alerts.push(args) }, DeviceEventEmitter: { emit: value => events.push(value) } },
    'expo-router': { useLocalSearchParams: () => ({ postId: 'p1' }), usePreventRemove: (enabled, callback) => { guard = { enabled, callback }; }, useRouter: () => ({ back: () => routes.push('back'), canGoBack: () => true, replace: path => routes.push(path) }) },
    '@/hooks/use-language': { useLanguage: () => ({ tr: (s, ...args) => translateUi('ko', s, ...args) }) },
    '@/hooks/use-theme': { useTheme: () => ({ text: '#000', background: '#fff', backgroundSelected: '#eee', card: '#fff', line: '#ddd', textSecondary: '#666', accent: '#70f' }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: meId }, promptLogin() {} }) },
    '@/lib/membership-provider': { useMembership: () => ({ membership: null }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/chilling-data': { getChillingError: error => error.message, getChillingErrorCode: error => error.message },
    '@/lib/chilling': { ...chilling, configureChillingEvent: async (_client, postId, draft) => { configured.push({ postId, draft }); if (configure) await configure(draft); } },
    '@/lib/community-data': { MEETUPS_CHANGED_EVENT: 'meetups.changed', editPost: async (_client, postId, patch) => { edited.push({ postId, patch }); if (edit) await edit(patch); } },
    '@/lib/feed-data': { loadPublicMeetupContext: async () => meetup },
    '@/lib/meetup-ai': { splitEventMeetupBody }, '@/lib/meetup-sections': meetupSections,
    '@/lib/meetup-destination': destinations,
    '@/lib/supabase': { supabase: {} },
    '@/constants/theme': { Spacing: { two: 8, three: 16, five: 32 } },
    '@/constants/design-system': designSystem,
  };
  const exports = {};
  vm.runInNewContext(screenSource, { exports, Intl, Date, require: name => imports[name] ?? new Proxy({}, { get: (_, key) => String(key) }) });
  const render = () => { at = 0; const route = exports.default(); return route.type(route.props); };
  render(); layouts.forEach(run => run());
  const flush = async () => { effects.splice(0).forEach(run => run()); await settle(); return render(); };
  const find = key => nodes(render()).find(n => n.props?.analyticsId === key || n.props?.accessibilityLabel === key);
  const edit_ = (label, value) => { const input = find(label); assert.ok(input, label); input.props.onChangeText(value); render(); };
  const save = async () => { find('meetup.manage.edit').props.onPress(); await settle(); return render(); };
  return { render, flush, find, edit: edit_, save, feedback, alerts, events, routes, configured, edited, guard: () => guard };
}

test('non-host and missing meetups get a blocked state without any edit controls', async () => {
  const other = screen({ meId: 'member' }), tree = await other.flush();
  const card = nodes(tree).find(node => node.type === 'StateCard');
  assert.equal(card.props.kind, 'blocked'); assert.equal(card.props.title, '호스트만 수정할 수 있어요');
  assert.equal(other.find('meetup.manage.edit'), undefined); assert.equal(other.find('모임 제목'), undefined);
  const missing = screen({ meetup: null });
  assert.equal(nodes(await missing.flush()).find(node => node.type === 'StateCard').props.kind, 'empty');
  const ended = screen({ meetup: { id: 'p1', cityId: 'vancouver', title: 't', body: 'b', room: { ...onceRoom, closed: true }, authorId: 'host' } });
  assert.equal(nodes(await ended.flush()).find(node => node.type === 'StateCard').props.title, '종료된 모임이에요');
});

test('title/body save edits only the intro and preserves place and event machine lines', async () => {
  const app = screen(); await app.flush();
  assert.equal(app.find('모임 소개').props.value, '같이 걸어요.', 'machine place lines are not editable');
  app.edit('모임 제목', '  새 제목 '); app.edit('모임 소개', '새 소개예요. ');
  await app.save();
  assert.equal(app.configured.length, 0, 'unchanged schedule is not resent');
  assert.deepEqual(JSON.parse(JSON.stringify(app.edited)), [{ postId: 'p1', patch: { title: '새 제목', body: `새 소개예요.${placeTail}` } }]);
  assert.deepEqual(app.feedback.slice(-1), ['success']); assert.deepEqual(app.events, ['meetups.changed']); assert.deepEqual(app.routes, ['back']);

  const eventTail = '\n\n행사 ID: G5vYZabc';
  const event = screen({ meetup: { id: 'p1', cityId: 'vancouver', title: '공연', body: `공연 같이 가요.${eventTail}`, room: onceRoom, authorId: 'host' } });
  await event.flush();
  assert.equal(event.find('모임 소개').props.value, '공연 같이 가요.');
  event.edit('모임 소개', '바뀐 소개'); await event.save();
  assert.equal(event.edited[0].patch.body, `바뀐 소개${eventTail}`);
});

test('schedule save calls configureChillingEvent with the kind unchanged', async () => {
  const app = screen(); await app.flush();
  const later = new Date(start.getTime() + 86400000).toISOString();
  nodes(app.render()).find(node => node.type === 'ChillingDateInput' && node.props.label === '시작').props.onChange(later);
  app.edit('정원 (호스트 포함)', '8');
  await app.save();
  assert.equal(app.configured.length, 1); assert.equal(app.edited.length, 0);
  const { draft } = app.configured[0];
  assert.equal(draft.kind, 'once'); assert.equal(draft.capacity, 8); assert.equal(draft.startsAt, later);
  assert.equal(Date.parse(draft.endsAt) - Date.parse(draft.startsAt), 3600000, 'moving the start keeps the duration');
  assert.equal(draft.timezone, 'America/Vancouver'); assert.equal(draft.category, 'casual');
  assert.equal(nodes(app.render()).some(node => node.type === 'MeetupKindSwitch'), false, 'kind is shown, not editable');

  const group = screen({ meetup: { id: 'p1', cityId: 'vancouver', title: '러닝', body: '매주 뛰어요', room: { ...onceRoom, eventKind: 'group', startsAt: null, endsAt: null, timezone: null, cadence: '매주 토요일' }, authorId: 'host' } });
  await group.flush(); group.edit('활동 주기', '매주 일요일'); await group.save();
  assert.equal(group.configured[0].draft.kind, 'group'); assert.equal(group.configured[0].draft.cadence, '매주 일요일');
});

test('capacity below current members is rejected with a clear message, locally and from the server', async () => {
  const app = screen(); await app.flush();
  app.edit('정원 (호스트 포함)', '2');
  const local = await app.save();
  assert.equal(app.configured.length, 0);
  assert.match(nodes(local).find(node => node.props?.accessibilityRole === 'alert').props.children, /현재 멤버 3명보다 적게 줄일 수 없어요/);
  assert.equal(app.feedback.at(-1), 'warning');

  const raced = screen({ configure: () => { throw new Error('EVENT_CAPACITY_BELOW_MEMBERS'); } }); await raced.flush();
  raced.edit('정원 (호스트 포함)', '4');
  const tree = await raced.save();
  assert.match(nodes(tree).find(node => node.props?.accessibilityRole === 'alert').props.children, /이미 참여한 멤버보다 적게 줄일 수 없어요/);
  assert.deepEqual(raced.routes, [], 'a rejected save stays on the form');
});

test('discard guard engages only after an edit and confirms before leaving', async () => {
  const app = screen(); await app.flush();
  assert.equal(app.guard().enabled, false);
  app.edit('모임 제목', '바뀐 제목');
  assert.equal(app.guard().enabled, true);
  let left = 0; app.guard().callback({ repeat: () => left++ });
  const [heading, , actions] = app.alerts.at(-1);
  assert.equal(heading, '수정 중인 내용을 버리고 나갈까요?');
  actions.find(action => action.style === 'cancel').onPress?.(); assert.equal(left, 0);
  actions.find(action => action.style === 'destructive').onPress(); assert.equal(left, 1);
  app.edit('모임 제목', '노을 보러 가요');
  assert.equal(app.guard().enabled, false, 'reverting the edit clears the guard');
});
