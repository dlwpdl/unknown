import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as aiDraft from '../src/lib/ai-draft.ts';
import { chillingProfilePreview } from '../src/lib/chilling-data.ts';
import { meetupAllowed, isFestivalEvent, ticketmasterReference } from '../supabase/functions/_shared/ticketmaster.ts';
import * as designSystem from '../src/constants/design-system.ts';
import * as chilling from '../src/lib/chilling.ts';
import { translateUi, translationsFor } from '../src/i18n/index.ts';

import { splitEventMeetupBody, visibleMeetupBody, meetupDestination } from './test-meetup-source-imports.mjs';

test('AI edits only the invitation while saved event details stay intact', () => {
  const details = '\n\n장소: Fortune Sound Club, Vancouver\n행사 ID: rZ7HnEZ1AfG3e7\n티켓·최신 일정: https://ticketmaster.evyy.net/example';
  const source = `함께 갈 분을 찾아요.${details}`;
  const parts = splitEventMeetupBody(source);
  assert.equal(parts.intro, '함께 갈 분을 찾아요.');
  assert.equal(parts.details, details);
  assert.equal(`새 소개예요.${parts.details}`, `새 소개예요.${details}`);
  assert.deepEqual(splitEventMeetupBody('일반 모임 소개'), { intro: '일반 모임 소개', details: '' });
});

test('event meetup descriptions hide saved references while keeping old and new links', () => {
  const intro = '페스티벌에 함께 가요.';
  const current = `${intro}\n\n행사 ID: G5vYZabc`;
  const legacy = `${intro}\n\n장소: Toronto\n출처: Ticketmaster\n행사 ID: G5vYZabc\n티켓·최신 일정: https://ticketmaster.ca/example`;
  assert.deepEqual(splitEventMeetupBody(current), { intro, details: '\n\n행사 ID: G5vYZabc' });
  assert.equal(visibleMeetupBody(current), intro);
  assert.equal(visibleMeetupBody(legacy), intro);
  assert.equal(visibleMeetupBody('일반 모임 소개'), '일반 모임 소개');
});

const generated = { categorySlug: 'meetup', title: '함께 산책해요', body: '편하게 걸으며 이야기해요.', hashtags: [], purpose: '이웃과 알아가요.', activities: ['인사를 나눠요.', '편한 속도로 걸어요.'], fit: '산책을 좋아하는 분', preparation: [], applicationQuestion: '어떤 산책을 좋아하세요?' };
export const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];

export function form({ params = {}, sourceEvent, catalogReady = true, membership = {}, loadProfile, create, chooseKind = true, language = 'ko', themeOverride } = {}) {
  const slots = [], requests = [], writes = [], feedback = [], layouts = [], effects = [], alerts = [], routes = [], profileReads = [], updates = [], events = [];
  let at = 0, focused, focusCleanup;
  let catalog = catalogReady ? JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8')) : null;
  const destinations = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/meetup-destination.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: destinations, require(name) {
      if (name.includes('city-places')) return { getCityPlaces: city => catalog?.cities[city]?.places ?? [] };
      if (name.includes('mock')) return { CITIES: [{ id: 'vancouver', state: 'open' }, { id: 'toronto', state: 'open' }] };
      if (name.includes('ticketmaster')) return { ticketmasterReference };
      throw Error('Unexpected destination import ' + name);
    },
  });
  let hostProfile = { version: 2, revision: 'revision-one', displayName: '호스트', cityId: 'vancouver', intro: '함께 걸어요', interests: ['산책'], promptOne: '이야기해요', promptTwo: '편한 모임', photoPaths: [], publicPhotoPath: null };
  const slot = initial => { const i = at++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return i; };
  const jsx = (type, props) => ({ type, props });
  const theme = themeOverride ?? { text: '#F6F3F0', background: '#0B0B12', backgroundElement: '#222231', backgroundSelected: '#343443', card: '#171722', line: '#343443', textSecondary: '#B7B4C3', accent: '#CBB9FF', accentDepth: '#8169B1', accentInk: '#171123' };
  const t = translationsFor(language);
  const imports = {
    react: {
      useCallback: callback => callback,
      useState: initial => { const i = slot(initial); return [slots[i], next => { updates.push(i); slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
      useRef: initial => slots[slot(() => ({ current: initial }))],
      useEffect: (callback, deps) => {
        const i = at++, previous = slots[i];
        if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps?.[index]))) {
          slots[i] = { deps };
          effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = callback(); });
        }
      },
      useLayoutEffect: callback => layouts.push(callback),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' }, StyleSheet: { create: x => x, hairlineWidth: 1 }, Alert: { alert: (...args) => alerts.push(args) }, DeviceEventEmitter: { emit: value => events.push(value) } },
    'expo-router': { useLocalSearchParams: () => params, useFocusEffect: callback => { focused = callback; }, usePreventRemove() {}, useRouter: () => ({ replace: path => routes.push(path), push: path => routes.push(path) }) },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/hooks/use-language': { useLanguage: () => ({ language, tr: (s, ...args) => translateUi(language, s, ...args), t }) },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'host' }, isAdmin: false }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버' } }) },
    '@/lib/membership-provider': { useMembership: () => ({ membership, refresh() {} }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/supabase': { supabase: { functions: { invoke: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) } } },
    '@/lib/chilling-data': { chillingProfilePreview, getChillingError: error => error.message, getChillingErrorCode: error => error.message, loadChillingProfile: async (_client, preview) => { profileReads.push(preview); return loadProfile ? loadProfile(hostProfile) : hostProfile; }, createChillingEvent: async (_client, value) => { writes.push(value); return create ? create(value) : 'new-meetup'; } },
    '@/lib/chilling': chilling,
    '@/lib/community-data': { getCommunityActionError: () => null, MEETUPS_CHANGED_EVENT: 'meetups.changed' },
    '@/lib/behavior-analytics': { behavior() {} },
    '@/components/relationship-slot-card': { relationshipSlotData: () => ({ available: 3, active: 0, limit: 3 }) },
    '@/lib/ai-draft': aiDraft, '@/lib/meetup-ai': { splitEventMeetupBody },
    '@/lib/meetup-destination': destinations, '@/hooks/use-city-places': { useCityPlacesRevision: () => 0 },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }, { id: 'toronto', name: '토론토', state: 'open' }] },
    '@/constants/theme': { Depth: { control: {} }, Spacing: { two: 8, three: 16, five: 32 } },
    '@/constants/design-system': designSystem,
  };
  const bridge = ts.createSourceFile('ticketmaster.ts', readFileSync(new URL('../src/lib/ticketmaster.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const bridgeExports = {};
  const bridgeSource = bridge.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'eventMeetupDraft').getText(bridge);
  vm.runInNewContext(ts.transpileModule(bridgeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: bridgeExports, meetupAllowed, eventNotice: () => '', Date });
  imports['@/lib/ticketmaster'] = { eventMeetupDraft: bridgeExports.eventMeetupDraft, meetupAllowed, isFestivalEvent, loadTicketmasterEvent: async () => ({ event: sourceEvent }) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/meetup-create.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => imports[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
  });
  const render = () => { at = 0; return exports.default().type(); };
  render(); const unmount = layouts[0]?.();
  const find = key => nodes(render()).find(n => n.props?.analyticsId === key || n.props?.accessibilityLabel === key);
  const openAssistance = () => { const toggle = find('meetup-create.assistance'); if (toggle && !toggle.props.accessibilityState.expanded) toggle.props.onPress(); };
  const edit = (label, value) => { if (label === '모임 주제') openAssistance(); const input = find(label); assert.ok(input, label); input.props.onChangeText(value); };
  if (chooseKind) nodes(render()).find(node => node.type === 'MeetupKindSwitch')?.props.onChange('once');
  const flushEffects = () => effects.splice(0).forEach(effect => effect());
  return { render, find, edit, openAssistance, requests, writes, feedback, alerts, routes, profileReads, updates, events, unmount: () => { focusCleanup?.(); unmount?.(); }, focus: () => { focusCleanup?.(); focusCleanup = focused?.(); }, blur: () => focusCleanup?.(), loadEvent: flushEffects, changeProfileRevision: revision => { hostProfile = { ...hostProfile, revision }; }, removeProfile: () => { hostProfile = null; },
    hydrateCatalog: () => { catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8')); render(); flushEffects(); },
    preview: () => nodes(render()).find(n => typeof n.type === 'string' && n.type === 'MeetupAiDraftPreview'),
    generate: () => { openAssistance(); find('app_meetup-create.ai-draft').props.onPress(); },
  };
}
const settle = () => new Promise(setImmediate);

test('generic creation requires an explicit type, while a valid type handoff initializes the form', async () => {
  const app = form({ chooseKind: false });
  assert.equal(nodes(app.render()).find(node => node.type === 'MeetupKindSwitch').props.value, null);
  app.edit('모임 제목', '산책'); app.edit('모임 소개', '함께 걸어요');
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 0); assert.equal(app.profileReads.length, 0);
  assert.ok(nodes(app.render()).some(node => node.props?.accessibilityRole === 'alert'));
  nodes(app.render()).find(node => node.type === 'MeetupKindSwitch').props.onChange('group');
  assert.equal(nodes(app.render()).find(node => node.type === 'MeetupKindSwitch').props.value, 'group');
  const handoff = form({ params: { kind: 'group' }, chooseKind: false });
  assert.equal(nodes(handoff.render()).find(node => node.type === 'MeetupKindSwitch').props.value, 'group');
  assert.ok(handoff.find('활동 주기'));
  const malformed = form({ params: { kind: ['once', 'group'] }, chooseKind: false });
  assert.equal(nodes(malformed.render()).find(node => node.type === 'MeetupKindSwitch').props.value, null);
});

test('host form starts with readable sections while optional help and advanced settings remain accessible', () => {
  const app = form(), tree = app.render();
  const headings = nodes(tree).filter(node => node.props?.accessibilityRole === 'header');
  assert.ok(headings.some(node => node.props.children === '01. 어떤 모임인가요?'));
  assert.ok(headings.some(node => node.props.children === '02. 언제, 어디서 만나요?'));
  assert.ok(headings.some(node => node.props.children === '내 모임 프로필'));
  assert.equal(app.find('app_meetup-create.ai-draft'), undefined);
  app.openAssistance(); assert.ok(app.find('app_meetup-create.ai-draft'));
  assert.equal(app.find('권장 최소 나이, 만 나이'), undefined);
  app.find('meetup-create.advanced').props.onPress(); assert.ok(app.find('권장 최소 나이, 만 나이'));
  assert.equal(app.writes.length, 0);
});

test('returning from the shared meetup-profile editor refreshes consent without replacing the meetup draft', async () => {
  const app = form();
  app.edit('모임 제목', '보존할 제목'); app.edit('모임 소개', '보존할 소개');
  app.focus(); await settle();
  assert.equal(app.find('meetup-create.host-consent')?.props.accessibilityState.checked, false);
  app.find('meetup-create.host-consent').props.onPress();
  app.find('meetup-create.profile-edit').props.onPress();
  assert.equal(app.routes.at(-1), '/meetup-profile');
  app.blur(); app.changeProfileRevision('edited-revision'); app.focus(); await settle();
  assert.equal(app.find('모임 제목').props.value, '보존할 제목');
  assert.equal(app.find('모임 소개').props.value, '보존할 소개');
  assert.equal(app.find('meetup-create.host-consent').props.accessibilityState.checked, false);
  assert.equal(app.writes.length, 0, 'Returning or loading a profile must never publish it.');
  app.find('meetup-create.host-consent').props.onPress();
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes[0].hostProfileRevision, 'edited-revision');
  assert.ok(app.profileReads.every(preview => preview === 'hosting'));
});

test('invalid capacity is shown at the input and fixed CTA, focuses that input, and never opens profile setup', async () => {
  const app = form(), moves = [];
  app.edit('모임 제목', '산책'); app.edit('모임 소개', '함께 산책해요'); app.edit('정원, 2명부터 50명', '51');
  const tree = app.render();
  const input = app.find('정원, 2명부터 50명');
  input.props.ref?.({ focus: () => moves.push('focus') });
  const field = nodes(tree).find(node => node.props?.onLayout && nodes(node).some(child => child.props?.accessibilityLabel === '정원, 2명부터 50명'));
  field?.props.onLayout({ nativeEvent: { layout: { y: 640 } } });
  const scroll = nodes(tree).find(node => node.props?.analyticsId === 'app_meetup-create.scrollview.1');
  if (scroll.props.ref) scroll.props.ref.current = { scrollTo: value => moves.push(value.y) };
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.deepEqual(moves, [640, 'focus']);
  const result = app.render();
  assert.equal(nodes(result).filter(node => node.props?.accessibilityRole === 'alert').length, 1, 'A field-owned error is announced once, at its field.');
  const footer = nodes(result).find(node => node.type === 'View' && node.props?.children?.some?.(child => child?.props?.analyticsId === 'app_meetup-create.pressable.4'));
  assert.equal(nodes(footer).some(node => node.props?.accessibilityRole === 'alert'), false);
  assert.equal(app.alerts.length, 0); assert.equal(app.writes.length, 0);
});

test('postponing required one-account profile setup explicitly returns to the preserved draft', async () => {
  const app = form(); app.removeProfile();
  app.edit('모임 제목', '내 초안'); app.edit('모임 소개', '나중에 이어서 쓸 소개');
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  const prompt = app.alerts.at(-1);
  assert.match(prompt[1], /한 번|하나/);
  const cancel = prompt[2].find(item => item.style === 'cancel');
  assert.match(cancel.text, /작성.*돌아가기/);
  assert.equal(typeof cancel.onPress, 'function'); cancel.onPress();
  assert.equal(app.find('모임 제목').props.value, '내 초안');
  assert.equal(app.routes.length, 0); assert.equal(app.writes.length, 0);
  app.unmount(); const afterUnmount = app.updates.length;
  cancel.onPress(); assert.equal(app.updates.length, afterUnmount, 'A retained native alert action cannot update a departed account form.');
});

test('profile preview reads resolving after blur or unmount cannot update the preserved form', async () => {
  const pending = [], app = form({ loadProfile: profile => new Promise(resolve => pending.push({ profile, resolve })) });
  app.focus(); app.blur();
  const beforeBlurReply = app.updates.length;
  pending[0].resolve(pending[0].profile); await settle();
  assert.equal(app.updates.length, beforeBlurReply);
  app.focus(); app.unmount();
  const beforeUnmountReply = app.updates.length;
  pending[1].resolve(pending[1].profile); await settle();
  assert.equal(app.updates.length, beforeUnmountReply);
  assert.equal(app.writes.length, 0); assert.equal(app.routes.length, 0);
});

test('a created meetup response cannot navigate or celebrate a form that blurred, refocused, or unmounted, but still refreshes lists', async () => {
  for (const leave of ['blur', 'refocus', 'unmount']) {
    let resolve;
    const app = form({ create: () => new Promise(done => { resolve = done; }) });
    app.focus(); await settle(); app.edit('모임 제목', '산책'); app.edit('모임 소개', '함께 걸어요');
    app.find('meetup-create.host-consent').props.onPress();
    app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
    assert.equal(app.writes.length, 1);
    if (leave === 'unmount') app.unmount();
    else { app.blur(); if (leave === 'refocus') { app.focus(); await settle(); } }
    resolve('created-server-post'); await settle();
    assert.deepEqual(app.routes, []);
    assert.equal(app.feedback.includes('meetupCreated'), false);
    assert.deepEqual(app.events, ['meetups.changed'], 'The meetup exists, so lists refresh even after the host left.');
    assert.equal(app.writes.length, 1, 'The completed server post is neither deleted nor dispatched again.');
  }
});

test('a retained profile-setup action cannot push a new screen after its request loses focus', async () => {
  const app = form(); app.removeProfile(); app.focus(); await settle();
  app.edit('모임 제목', '내 모임'); app.edit('모임 소개', '내 소개');
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  const setup = app.alerts.at(-1)[2].find(item => item.style !== 'cancel').onPress;
  app.blur(); app.focus(); await settle(); setup();
  assert.deepEqual(app.routes, []);
});

test('capacity input and submitted draft use the actual unexpired personal membership limit', async () => {
  const app = form({ membership: { tier: 'plus', expiresAt: new Date(Date.now() + 3600000).toISOString() } });
  assert.equal(app.find('정원, 2명부터 5000명').props.maxLength, 4);
  app.edit('모임 제목', '큰 모임'); app.edit('모임 소개', '함께 만나요'); app.edit('정원, 2명부터 5000명', '5000');
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 0, 'Paid capacity never bypasses the per-meetup profile consent.');
  app.find('meetup-create.host-consent').props.onPress();
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes[0].event.capacity, 5000);
  const expired = form({ membership: { tier: 'premium', expiresAt: '2020-01-01T00:00:00Z', businessSubscription: { tier: 'premium' } } });
  assert.equal(expired.find('정원, 2명부터 50명').props.maxLength, 2, 'Business membership and expired personal access do not raise the free limit.');
});

test('a place invitation keeps its source city and immutable reference through AI and explicit host consent', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8'));
  const place = catalog.cities.toronto.places.find(item => item.category === 'cafe');
  const destination = meetupDestination.resolveMeetupDestination({ placeId: place.id, placeCityId: place.cityId }).destination;
  const tail = meetupDestination.placeMeetupTail(destination);
  const app = form({ params: { placeId: place.id, placeCityId: place.cityId } });
  const invitation = app.find('모임 소개').props.value;
  assert.ok(invitation.includes(place.name)); assert.equal(visibleMeetupBody(invitation + tail), invitation);
  app.generate();
  assert.equal(app.requests[0].args[1].body.bodyHint, invitation);
  assert.equal(JSON.stringify(app.requests[0].args).includes(place.sourceUrl), false, 'source metadata stays outside the AI prose');
  app.requests[0].resolve({ data: { draft: generated } }); await settle(); app.preview().props.onApply();
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle(); assert.equal(app.writes.length, 0);
  app.find('meetup-create.host-consent').props.onPress(); app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 1); assert.equal(app.writes[0].cityId, 'toronto');
  assert.ok(app.writes[0].body.endsWith(tail)); assert.equal(meetupDestination.splitPlaceMeetupBody(app.writes[0].body, 'toronto').place.id, place.id);
  assert.equal('placeId' in app.writes[0].event, false, 'the existing SQL event contract is unchanged');
});

test('an invalid destination cannot silently create a meetup in the preferred city', async () => {
  const app = form({ params: { placeId: 'osm:node:999999999999999999', placeCityId: 'vancouver' } });
  const submit = app.find('app_meetup-create.pressable.4'); assert.equal(submit.props.disabled, true);
  await submit.props.onPress(); assert.equal(app.writes.length, 0); assert.equal(app.requests.length, 0);
});

test('a cold place link unlocks after catalog hydration and preserves edits through a later refresh', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8'));
  const place = catalog.cities.toronto.places.find(item => item.category === 'cafe');
  const tail = `\n\n장소: ${place.name}\n장소 정보: ${place.sourceUrl}`;
  const app = form({ params: { placeId: place.id, placeCityId: 'toronto' }, catalogReady: false });
  assert.equal(app.find('app_meetup-create.pressable.4').props.disabled, true);
  assert.equal(app.find('모임 소개').props.editable, false);
  app.hydrateCatalog();
  assert.equal(app.find('app_meetup-create.pressable.4').props.disabled, false);
  assert.equal(app.find('모임 소개').props.editable, true);
  assert.ok(app.find('모임 제목').props.value.includes(place.name));
  assert.ok(app.find('모임 소개').props.value.includes(place.name));
  app.edit('모임 제목', '직접 쓴 제목'); app.edit('모임 소개', '직접 쓴 소개');
  app.hydrateCatalog();
  assert.equal(app.find('모임 제목').props.value, '직접 쓴 제목');
  assert.equal(app.find('모임 소개').props.value, '직접 쓴 소개');
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 0);
  app.find('meetup-create.host-consent').props.onPress();
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].cityId, 'toronto');
  assert.equal(app.writes[0].body, '직접 쓴 소개' + tail);
});

test('topic generation renders a preview without publishing or changing form facts', async () => {
  const app = form();
  app.edit('모임 주제', '주말 산책'); app.generate();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].args[0], 'draft-post');
  assert.equal(app.requests[0].args[1].body.intent, 'meetup');
  assert.equal(app.requests[0].args[1].body.topic, '주말 산책');
  const before = nodes(app.render()).filter(n => n.type === 'ChillingDateInput').map(n => n.props.value);
  app.requests[0].resolve({ data: { draft: generated } }); await settle();
  assert.equal(app.find('모임 제목').props.value, '');
  assert.equal(app.find('모임 소개').props.value, '');
  assert.ok(app.preview(), 'explicit preview is rendered');
  app.preview().props.onApply();
  assert.equal(app.find('모임 제목').props.value, generated.title);
  assert.ok(app.find('모임 소개').props.value.includes(generated.purpose));
  assert.equal(app.find('신청할 때 물어볼 질문').props.value, generated.applicationQuestion);
  assert.deepEqual(nodes(app.render()).filter(n => n.type === 'ChillingDateInput').map(n => n.props.value), before);
  assert.equal(app.find('정원, 2명부터 50명').props.value, '6');
  assert.equal(app.writes.length, 0);
});

test('edits during a pending request and after preview are protected, including edit-then-undo', async () => {
  const app = form();
  app.edit('모임 주제', '산책'); app.generate();
  assert.equal(app.find('모임 제목').props.editable, true, 'writing stays available while AI works');
  app.edit('모임 제목', '직접 쓴 제목');
  app.edit('모임 소개', '직접 쓴 소개'); app.edit('모임 소개', '');
  app.requests[0].resolve({ data: { draft: generated } }); await settle();
  app.edit('신청할 때 물어볼 질문', '직접 쓴 질문');
  app.preview().props.onApply();
  assert.equal(app.find('모임 제목').props.value, '직접 쓴 제목');
  assert.equal(app.find('모임 소개').props.value, '');
  assert.equal(app.find('신청할 때 물어볼 질문').props.value, '직접 쓴 질문');
});

test('selected apply, retry, malformed output and duplicate presses preserve the current draft', async () => {
  const app = form();
  app.edit('모임 주제', '산책'); app.generate(); app.generate();
  assert.equal(app.requests.length, 1, 'one in-flight request');
  app.requests[0].reject(new Error('offline')); await settle();
  assert.ok(nodes(app.render()).some(n => n.props?.accessibilityRole === 'alert'));
  app.generate(); assert.equal(app.requests.length, 2);
  app.requests[1].resolve({ data: { draft: { ...generated, capacity: 50 } } }); await settle();
  assert.equal(app.preview(), undefined);
  assert.equal(app.find('모임 제목').props.value, '');
  app.generate(); app.requests[2].resolve({ data: { draft: generated } }); await settle();
  app.preview().props.onToggle('body'); app.preview().props.onToggle('question'); app.preview().props.onApply();
  assert.equal(app.find('모임 제목').props.value, generated.title);
  assert.equal(app.find('모임 소개').props.value, '');
  assert.equal(app.find('신청할 때 물어볼 질문').props.value, '어떤 분위기의 모임을 기대하세요?');
});

test('an applied outline longer than 1000 characters can be refined without truncating its facts', () => {
  const app = form(), introduction = '직접 적은 모임 소개'.repeat(150);
  app.edit('모임 소개', introduction); app.generate();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].args[1].body.bodyHint, introduction);
});

test('the schedule waits for a chosen kind and a loaded event, keeps its duration and rejects a past start', async () => {
  const dates = app => nodes(app.render()).filter(n => n.type === 'ChillingDateInput');
  const generic = form({ chooseKind: false });
  assert.equal(dates(generic).length, 0); assert.equal(nodes(generic.render()).some(n => n.type === 'MeetupPolicyNotice'), false);
  nodes(generic.render()).find(n => n.type === 'MeetupKindSwitch').props.onChange('once');
  const [start, end] = dates(generic);
  assert.ok([start, end].every(n => Math.abs(n.props.minimumDate.getTime() - Date.now()) < 60000), 'Pickers cannot offer past times.');
  const duration = Date.parse(end.props.value) - Date.parse(start.props.value);
  const later = new Date(Date.parse(start.props.value) + 3 * 86400000).toISOString();
  start.props.onChange(later);
  assert.equal(Date.parse(dates(generic)[1].props.value) - Date.parse(later), duration);
  dates(generic)[0].props.onChange(new Date(Date.now() - 3600000).toISOString());
  generic.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(generic.writes.length, 0); assert.equal(generic.profileReads.length, 0);
  assert.equal(nodes(generic.render()).filter(n => n.props?.accessibilityRole === 'alert').length, 1);

  const sourceEvent = { id: 'event-race', name: 'Race Festival', country: 'CA', status: 'onsale', startsAt: new Date(Date.now() + 7 * 86400000).toISOString(), ticketUrl: 'https://ticketmaster.ca/example', timeUnconfirmed: false };
  const event = form({ params: { ticketmasterEventId: sourceEvent.id, ticketmasterCityId: 'vancouver' }, sourceEvent });
  assert.ok(dates(event).every(n => n.props.disabled), 'Pickers stay locked until the event prefill lands.');
  assert.equal(nodes(event.render()).some(n => n.props?.children === '모임 종료는 행사 시작 2시간 뒤로 임시 설정했어요. 실제 만날 시간과 종료 시간을 확인해 주세요.'), false);
  event.loadEvent(); await settle();
  assert.ok(dates(event).every(n => !n.props.disabled));
  assert.equal(dates(event)[0].props.value, sourceEvent.startsAt);
});

test('English hosts get an English event invitation with the fixed reference tail', () => {
  const bridge = ts.createSourceFile('ticketmaster.ts', readFileSync(new URL('../src/lib/ticketmaster.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const out = {};
  vm.runInNewContext(ts.transpileModule(bridge.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'eventMeetupDraft').getText(bridge), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: out, meetupAllowed: () => true, eventNotice: () => '', Date });
  const event = { id: 'EV_9', name: 'Night Market', startsAt: '2030-01-02T00:00:00Z' };
  assert.deepEqual([out.eventMeetupDraft(event, 'en').title, out.eventMeetupDraft(event, 'en').body], ["Let's go to Night Market", "I'd like to go to Night Market. Who's in?\n\n행사 ID: EV_9"]);
  assert.deepEqual([out.eventMeetupDraft(event).title, out.eventMeetupDraft(event).body], ['Night Market 같이 가요', 'Night Market, 함께 가실 분을 찾아요.\n\n행사 ID: EV_9']);
  assert.deepEqual(splitEventMeetupBody(out.eventMeetupDraft(event, 'en').body), { intro: "I'd like to go to Night Market. Who's in?", details: '\n\n행사 ID: EV_9' });
});

test('the event bridge preserves its seeded schedule and saved source when applying and publishing an invitation', async () => {
  const sourceEvent = { id: 'event-example', name: 'Example Festival', country: 'CA', status: 'onsale', startsAt: new Date(Date.now() + 7 * 86400000).toISOString(), ticketUrl: 'https://ticketmaster.ca/example', timeUnconfirmed: false };
  const app = form({ params: { ticketmasterEventId: sourceEvent.id, ticketmasterCityId: 'vancouver' }, sourceEvent });
  app.loadEvent(); await settle();
  const before = nodes(app.render()).filter(n => n.type === 'ChillingDateInput').map(n => n.props.value);
  app.generate();
  assert.equal(app.requests[0].args[1].body.intent, 'event_meetup');
  assert.equal(app.requests[0].args[1].body.bodyHint, 'Example Festival, 함께 가실 분을 찾아요.');
  assert.equal(JSON.stringify(app.requests[0].args).includes('행사 ID'), false);
  app.requests[0].resolve({ data: { draft: generated } }); await settle();
  app.preview().props.onApply();
  assert.deepEqual(nodes(app.render()).filter(n => n.type === 'ChillingDateInput').map(n => n.props.value), before);
  nodes(app.render()).find(n => n.type === 'RaisedActionButton').props.onPress(); await settle();
  assert.equal(app.writes.length, 0, 'first publish only reveals the public host profile');
  app.find('meetup-create.host-consent').props.onPress();
  nodes(app.render()).find(n => n.type === 'RaisedActionButton').props.onPress(); await settle();
  assert.equal(app.writes.length, 1);
  assert.ok(app.writes[0].body.endsWith('\n\n행사 ID: event-example'));
  assert.equal(app.writes[0].event.startsAt, sourceEvent.startsAt);
  assert.equal(app.writes[0].event.capacity, 6);
});

test('publishing requires consent to the current host profile revision', async () => {
  const app = form(); app.edit('모임 제목', '산책해요'); app.edit('모임 소개', '느긋하게 걸어요.');
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 0);
  app.find('meetup-create.host-consent').props.onPress(); app.changeProfileRevision('revision-two');
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 0, 'a profile changed elsewhere needs a fresh preview');
  assert.equal(app.find('meetup-create.host-consent').props.accessibilityState.checked, false);
  app.find('meetup-create.host-consent').props.onPress();
  app.find('app_meetup-create.pressable.4').props.onPress(); await settle();
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].hostProfileRevision, 'revision-two');
});

test('a template applied during AI generation is preserved by selected AI application', async () => {
  const app = form(); app.edit('모임 주제', '산책'); app.generate();
  const picker = nodes(app.render()).find(node => node.type === 'MeetupTemplatePicker');
  picker.props.onApply({ title: '저장한 제목', body: '저장한 소개', applicationQuestion: '저장한 질문', category: 'hobby' });
  app.requests[0].resolve({ data: { draft: generated } }); await settle(); app.preview().props.onApply();
  assert.equal(app.find('모임 제목').props.value, '저장한 제목');
  assert.equal(app.find('모임 소개').props.value, '저장한 소개');
  assert.equal(app.find('신청할 때 물어볼 질문').props.value, '저장한 질문');
  assert.equal(app.writes.length, 0);
});

test('an imported event rejects an oversized template atomically and keeps the existing draft', async () => {
  const sourceEvent = { id: 'event-budget', name: 'Festival', country: 'CA', status: 'onsale', startsAt: new Date(Date.now() + 7 * 86400000).toISOString(), ticketUrl: 'https://ticketmaster.ca/example', timeUnconfirmed: false };
  const app = form({ params: { ticketmasterEventId: sourceEvent.id, ticketmasterCityId: 'vancouver' }, sourceEvent });
  app.loadEvent(); await settle();
  app.edit('모임 제목', '기존 제목'); app.edit('모임 소개', '기존 소개'); app.edit('신청할 때 물어볼 질문', '기존 질문'); app.openAssistance();
  const picker = nodes(app.render()).find(node => node.type === 'MeetupTemplatePicker');
  assert.equal(picker.props.onApply({ title: '새 제목', body: '가'.repeat(5000), applicationQuestion: '새 질문', category: 'hobby' }), false);
  assert.equal(app.find('모임 제목').props.value, '기존 제목');
  assert.equal(app.find('모임 소개').props.value, '기존 소개');
  assert.equal(app.find('신청할 때 물어볼 질문').props.value, '기존 질문');
  assert.equal(app.writes.length, 0);
});

test('a sports category and title chosen during generation are preserved and a result after unmount is ignored', async () => {
  const app = form(); app.edit('모임 주제', '운동'); app.generate(); app.find('meetup-create.advanced').props.onPress();
  const sports = nodes(app.render()).find(n => n.props?.accessibilityRole === 'radio' && nodes(n).some(child => child.props?.children === '스포츠'));
  sports.props.onPress(); assert.equal(app.find('app_meetup-create.sport'), undefined, 'Sport chips had no persisted effect and were removed.');
  app.edit('모임 제목', '테니스 같이해요');
  app.requests[0].resolve({ data: { draft: generated } }); await settle(); app.preview().props.onApply();
  assert.notEqual(app.find('모임 제목').props.value, generated.title);
  const leaving = form(); leaving.edit('모임 주제', '산책'); leaving.generate(); leaving.unmount();
  leaving.requests[0].resolve({ data: { draft: generated } }); await settle();
  assert.equal(leaving.preview(), undefined); assert.equal(leaving.find('모임 제목').props.value, '');
});

function previewControl(language, overrides = {}) {
  const feedback = [], actions = [];
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const imports = {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View', StyleSheet: { create: x => x, hairlineWidth: 1 } },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/hooks/use-language': { useLanguage: () => ({ language }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/constants/theme': { Depth: { control: {} }, Spacing: { two: 8, three: 16 } }, '@/lib/ai-draft': aiDraft,
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/meetup-ai-draft-preview.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => imports[name] ?? new Proxy({}, { get: (_, key) => String(key) }) });
  const tree = exports.MeetupAiDraftPreview({ fields: aiDraft.meetupAiDraftFields(generated, language), selected: { title: true, body: true, question: true }, protectedFields: { title: true, body: false, question: false }, disabled: false, onToggle: field => actions.push(field), onApply: () => actions.push('apply'), onDismiss: () => actions.push('dismiss'), ...overrides });
  return { tree, feedback, actions, find: id => nodes(tree).find(n => n.props?.analyticsId === `meetup.ai-preview.${id}`) };
}

test('the actual preview renders accessible selections in both languages and gives feedback on each action', () => {
  for (const language of ['ko', 'en']) {
    const app = previewControl(language);
    assert.equal(app.find('select.title').props.accessibilityState.disabled, true);
    assert.equal(app.find('select.title').props.accessibilityState.checked, false);
    assert.equal(app.find('select.body').props.accessibilityState.checked, true);
    assert.equal(app.find('select.body').props.accessibilityLabel, language === 'en' ? 'Meetup introduction' : '모임 소개');
    app.find('select.body').props.onPress(); app.find('apply').props.onPress(); app.find('dismiss').props.onPress();
    assert.deepEqual(app.actions, ['body', 'apply', 'dismiss']); assert.deepEqual(app.feedback, ['selection', 'selection', 'selection']);
    const none = previewControl(language, { selected: { title: false, body: false, question: false } });
    assert.equal(none.find('apply').props.disabled, true);
    const protectedOnly = previewControl(language, { protectedFields: { title: true, body: true, question: true } });
    assert.equal(protectedOnly.find('apply').props.disabled, true);
  }
});
