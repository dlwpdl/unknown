import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as aiDraft from '../src/lib/ai-draft.ts';
import { chillingProfilePreview } from '../src/lib/chilling-data.ts';
import { meetupAllowed, isFestivalEvent, ticketmasterReference } from '../supabase/functions/_shared/ticketmaster.ts';
import * as designSystem from '../src/constants/design-system.ts';

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
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];

function form({ params = {}, sourceEvent, catalogReady = true, language = 'ko' } = {}) {
  const slots = [], requests = [], writes = [], feedback = [], layouts = [], effects = [];
  let at = 0;
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
  const theme = { text: '#F6F3F0', background: '#0B0B12', backgroundElement: '#222231', backgroundSelected: '#343443', card: '#171722', line: '#343443', textSecondary: '#B7B4C3', accent: '#CBB9FF', accentDepth: '#8169B1', accentInk: '#171123' };
  const t = { write: { creatingDraft: '만드는 중…', polishDraft: 'AI로 다듬기', createDraft: 'AI로 초안 만들기', reviewDraft: '초안을 확인해 주세요.', aiErrorTitle: '초안 오류', aiErrorBody: '다시 시도해 주세요.' }, actionErrors: {} };
  const imports = {
    react: {
      useState: initial => { const i = slot(initial); return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
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
    'react-native': { View: 'View', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' }, StyleSheet: { create: x => x, hairlineWidth: 1 }, Alert: { alert() {} }, DeviceEventEmitter: { emit() {} } },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ replace() {}, push() {} }) },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/hooks/use-language': { useLanguage: () => ({ language, tr: s => s, t }) },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'host' }, isAdmin: false }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버' } }) },
    '@/lib/membership-provider': { useMembership: () => ({ membership: {}, refresh() {} }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/supabase': { supabase: { functions: { invoke: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) } } },
    '@/lib/chilling-data': { chillingProfilePreview, getChillingError: error => error.message, loadChillingProfile: async () => hostProfile, createChillingEvent: async (_client, value) => { writes.push(value); return 'new-meetup'; } },
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
  const edit = (label, value) => { const input = find(label); assert.ok(input, label); input.props.onChangeText(value); };
  const flushEffects = () => effects.splice(0).forEach(effect => effect());
  return { render, find, edit, requests, writes, feedback, unmount, loadEvent: flushEffects, changeProfileRevision: revision => { hostProfile = { ...hostProfile, revision }; },
    hydrateCatalog: () => { catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8')); render(); flushEffects(); },
    preview: () => nodes(render()).find(n => typeof n.type === 'string' && n.type === 'MeetupAiDraftPreview'),
    generate: () => { find('app_meetup-create.ai-draft').props.onPress(); },
  };
}
const settle = () => new Promise(setImmediate);

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

test('the event bridge pre-fills an English invitation for English users and keeps the Korean source reference', async () => {
  const sourceEvent = { id: 'event-en', name: 'Example Festival', country: 'CA', status: 'onsale', startsAt: new Date(Date.now() + 7 * 86400000).toISOString(), ticketUrl: 'https://ticketmaster.ca/example', timeUnconfirmed: false };
  const ko = form({ params: { ticketmasterEventId: sourceEvent.id, ticketmasterCityId: 'vancouver' }, sourceEvent });
  ko.loadEvent(); await settle();
  assert.equal(ko.find('모임 제목').props.value, 'Example Festival 같이 가요');
  const app = form({ params: { ticketmasterEventId: sourceEvent.id, ticketmasterCityId: 'vancouver' }, sourceEvent, language: 'en' });
  app.loadEvent(); await settle();
  assert.equal(app.find('모임 제목').props.value, "Let's go to Example Festival");
  assert.equal(app.find('모임 소개').props.value, "Looking for people to go to Example Festival with. Who's in?");
  app.generate();
  assert.equal(JSON.stringify(app.requests[0].args).includes('행사 ID'), false);
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
  app.edit('모임 제목', '기존 제목'); app.edit('모임 소개', '기존 소개'); app.edit('신청할 때 물어볼 질문', '기존 질문');
  const picker = nodes(app.render()).find(node => node.type === 'MeetupTemplatePicker');
  assert.equal(picker.props.onApply({ title: '새 제목', body: '가'.repeat(5000), applicationQuestion: '새 질문', category: 'hobby' }), false);
  assert.equal(app.find('모임 제목').props.value, '기존 제목');
  assert.equal(app.find('모임 소개').props.value, '기존 소개');
  assert.equal(app.find('신청할 때 물어볼 질문').props.value, '기존 질문');
  assert.equal(app.writes.length, 0);
});

test('a sports title selected during generation is preserved and a result after unmount is ignored', async () => {
  const app = form(); app.edit('모임 주제', '운동'); app.generate();
  const sports = nodes(app.render()).find(n => n.props?.accessibilityRole === 'radio' && nodes(n).some(child => child.props?.children === '스포츠'));
  sports.props.onPress(); app.find('app_meetup-create.sport').props.onPress();
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
