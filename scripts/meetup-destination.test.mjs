import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { ticketmasterReference } from '../supabase/functions/_shared/ticketmaster.ts';
import { discoveryCursor, hasOpenSeat, matchesChilling, matchesChillingWindow, sortChillings } from '../src/lib/chilling-discovery.ts';

const place = { id: 'osm:node:123', cityId: 'vancouver', name: 'Test café', category: 'cafe', latitude: 49.28, longitude: -123.12, sourceUrl: 'https://www.openstreetmap.org/node/123' };
function api(places = [place]) {
  const file = new URL('../src/lib/meetup-destination.ts', import.meta.url);
  assert.ok(existsSync(file), 'Destination reference helper is not implemented');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL, require(name) {
      if (name.includes('city-places')) return { getCityPlaces: city => places.filter(p => p.cityId === city) };
      if (name.includes('mock')) return { CITIES: [{ id: 'vancouver', state: 'open' }, { id: 'toronto', state: 'open' }] };
      if (name.includes('ticketmaster')) return { ticketmasterReference };
      throw Error('Unexpected import ' + name);
    },
  });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const route = { placeId: place.id, placeCityId: place.cityId };

test('destination resolution requires an exact existing canonical city, positive identity and source URL', () => {
  const a = api(), valid = a.resolveMeetupDestination(route);
  assert.equal(valid.invalid, false); assert.equal(valid.destination.kind, 'place');
  assert.equal(valid.destination.place.id, place.id);
  for (const bad of [{ ...route, placeId: 'osm:node:999' }, { ...route, placeCityId: 'toronto' }, { ...route, placeId: ['osm:node:123'] }, { ...route, placeId: 'osm:node:0123' }, { ...route, ticketmasterEventId: 'ev1' }]) assert.equal(a.resolveMeetupDestination(bad).invalid, true);
  for (const sourceUrl of ['http://www.openstreetmap.org/node/123', 'https://www.openstreetmap.org/node/123?x=1', 'https://www.openstreetmap.org/node/1234']) assert.equal(api([{ ...place, sourceUrl }]).resolveMeetupDestination(route).invalid, true);
  assert.deepEqual(plain(a.resolveMeetupDestination({})), { destination: null, invalid: false });
});

test('event routes require a valid explicit city and reject conflicting or malformed source parameters', () => {
  const a = api();
  assert.deepEqual(plain(a.resolveMeetupDestination({ ticketmasterEventId: 'EV_1', ticketmasterCityId: 'toronto' })), { destination: { kind: 'event', eventId: 'EV_1', cityId: 'toronto' }, invalid: false });
  for (const params of [{ ticketmasterEventId: 'EV_1' }, { ticketmasterEventId: 'EV%1', ticketmasterCityId: 'toronto' }, { placeCityId: 'vancouver' }, { ...route, ticketmasterCityId: 'toronto' }]) assert.equal(a.resolveMeetupDestination(params).invalid, true);
});

test('readable canonical place tails round trip without exposing the source in prose', () => {
  const a = api(), d = a.resolveMeetupDestination(route).destination;
  const tail = a.placeMeetupTail(d), body = 'Join us.\nA small group.' + tail;
  assert.equal(tail, '\n\n장소: Test café\n장소 정보: https://www.openstreetmap.org/node/123');
  const split = a.splitPlaceMeetupBody(body, 'vancouver');
  assert.equal(split.intro, 'Join us.\nA small group.'); assert.equal(split.details, tail); assert.equal(split.place.id, place.id);
  assert.equal(a.splitPlaceMeetupBody(body).place.id, place.id);
  assert.equal(a.splitPlaceMeetupBody(body, 'toronto'), null);
  assert.equal(a.splitPlaceMeetupBody(body + '\nUntrusted suffix'), null);
  assert.equal(a.splitPlaceMeetupBody(body.replace('/node/123', '/node/1234')), null);
  assert.equal(a.splitPlaceMeetupBody('행사 ID: EV_1' + tail), null);
  assert.equal(a.splitPlaceMeetupBody(body + tail), null);
});

test('same destination matching is exact and city scoped, including node1 versus node10 and event ID substrings', () => {
  const other = { ...place, id: 'osm:node:1234', sourceUrl: 'https://www.openstreetmap.org/node/1234' }, a = api([place, other]), d = a.resolveMeetupDestination(route).destination;
  const good = { cityId: 'vancouver', body: 'Hello' + a.placeMeetupTail(d) };
  assert.equal(a.matchesMeetupDestination(good, d), true);
  assert.equal(a.matchesMeetupDestination({ ...good, cityId: 'toronto' }, d), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Mention ' + place.sourceUrl }, d), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Hello\n\n장소: Other\n장소 정보: ' + other.sourceUrl }, d), false);
  const event = a.resolveMeetupDestination({ ticketmasterEventId: 'EV_1', ticketmasterCityId: 'vancouver' }).destination;
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Join\n\n행사 ID: EV_1' }, event), true);
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Join\n\n행사 ID: EV_10' }, event), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: '행사 ID: EV_1\n행사 ID: EV_2' }, event), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: '행사 ID: EV_1' + a.placeMeetupTail(d) }, event), false);
});

test('server queries escape literal ILIKE wildcards while retaining exact source identity', () => {
  const a = api(), d = a.resolveMeetupDestination(route).destination;
  assert.equal(a.meetupDestinationQuery(d), place.sourceUrl);
  const event = a.resolveMeetupDestination({ ticketmasterEventId: 'EV_1', ticketmasterCityId: 'vancouver' }).destination;
  assert.equal(a.meetupDestinationQuery(event), 'EV\\_1');
});

test('editing an invitation preserves the exact canonical tail through the actual save handler', async () => {
  const a = api(), destination = a.resolveMeetupDestination(route).destination, tail = a.placeMeetupTail(destination);
  const source = readFileSync(new URL('../src/components/post-detail.tsx', import.meta.url), 'utf8');
  const save = source.slice(source.indexOf('  const savePost = '), source.indexOf('  const confirmDeletePost = '));
  const original = { id: 'post-1', cityId: place.cityId, body: 'Old invitation' + tail }, writes = [], exports = {};
  vm.runInNewContext(ts.transpileModule(save + '\nexports.save=savePost;', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, postDraft: { title: ' New title ', body: 'Edited invitation' }, postEditBusy: { current: false }, linkedEventDetails: a.splitPlaceMeetupBody(original.body, place.cityId).details,
    post: original, postImages: null, management: null, me: { id: 'host' }, active: { current: true }, supabase: {},
    editPost: async (_client, id, patch) => writes.push({ id, ...patch }), loadPublicPost: async () => ({ ...original, ...writes[0] }),
    setSavingPost() {}, setPost() {}, setPostDraft() {}, setPostImages() {}, play() {}, onPostChanged() {}, Alert: { alert: () => assert.fail('Unexpected edit error') }, tr: value => value,
  });
  await exports.save();
  assert.equal(writes.length, 1); assert.equal(writes[0].body, 'Edited invitation' + tail);
  assert.equal(a.matchesMeetupDestination({ ...original, body: writes[0].body }, destination), true);
});

function discovery({ pages, hidden = () => false, eventResult = null } = {}) {
  const a = api(), destination = eventResult ? a.resolveMeetupDestination({ ticketmasterEventId: 'EV_1', ticketmasterCityId: 'vancouver' }).destination : a.resolveMeetupDestination(route).destination;
  const source = readFileSync(new URL('../src/app/(tabs)/meetups.tsx', import.meta.url), 'utf8');
  const fetch = source.slice(source.indexOf('  const fetchPage = '), source.indexOf('  useFocusEffect('));
  const filters = source.slice(source.indexOf('  const filtered = '), source.indexOf('  const clearFilters = '));
  const empty = source.slice(source.indexOf('      ListEmptyComponent={') + '      ListEmptyComponent={'.length, source.indexOf('      ListFooterComponent=')).trim().slice(0, -1);
  const city = source.slice(source.indexOf('  const city = CITIES.find'), source.indexOf('\n', source.indexOf('  const city = CITIES.find')));
  const exports = {}, calls = []; let posts = [], cursor = null, loading = false, error = false, label = '', pageIndex = 0;
  const context = {
    exports, CITIES: [{ id: 'vancouver', state: 'open' }, { id: 'toronto', state: 'open' }], preferredCity: { id: 'toronto', state: 'open' }, destination, sourceInvalid: false,
    useCallback: fn => fn, version: { current: 0 }, busy: { current: false }, failedCursor: { current: null }, query: '', scope: 'guest', kind: 'once', category: 'all', dateWindow: 'all', seatsOnly: false,
    get posts() { return posts; }, get cursor() { return cursor; }, get loading() { return loading; }, get error() { return error; }, get sourceLabel() { return label; },
    setPosts: value => { posts = typeof value === 'function' ? value(posts) : value; }, setCursor: value => { cursor = value; }, setLoading: value => { loading = value; }, setError: value => { error = value; },
    setSourceLabel: value => { label = value; }, setSourceError() {}, supabase: {}, TAGS: [{ id: 4, kind: 'meetup' }],
    loadPublicFeed: async (_client, city, _tag, query, after) => { calls.push({ city, query, after }); return pages[pageIndex++]; },
    loadTicketmasterEvent: async () => ({ event: eventResult }), meetupAllowed: () => true,
    appendUniquePosts: (current, next) => [...current, ...next.filter(p => !current.some(old => old.id === p.id))], discoveryCursor, matchesChilling, matchesChillingWindow, hasOpenSeat, sortChillings, hidden,
    matchesMeetupDestination: a.matchesMeetupDestination, meetupDestinationQuery: a.meetupDestinationQuery,
    tr: value => value, copy: value => value, theme: {}, listOpacity: 1, StateCard: 'StateCard', View: 'View', GlingLoader: 'Loader', Animated: { View: 'Animated' }, clearDestination() {}, setSearch() {}, setQuery() {}, clearFilters() {},
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
  };
  const code = `${city}\n${fetch}\nexports.fetch=fetchPage;exports.snapshot=()=>{${filters}\nreturn {visible,cursor,error,empty:(${empty})};};`;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return { ...exports, calls };
}
const meetup = (id, body) => ({ id, body, title: 'Join us', cityId: 'vancouver', author: { id: 'host' }, createdAt: '2030-01-01T00:00:00Z', sortAt: '2030-01-01T00:00:00Z', room: { eventKind: 'once', closed: false, startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-02T02:00:00Z', capacity: 6, memberCount: 1 } });

test('the actual discovery keeps the raw cursor through a filtered-empty page and finds the exact place on the next page in its source city', async () => {
  const a = api(), tail = a.placeMeetupTail(a.resolveMeetupDestination(route).destination);
  const raw = Array.from({ length: 30 }, (_, i) => meetup('raw' + i, 'Another place' + tail.replace('/node/123', '/node/1234')));
  const ui = discovery({ pages: [raw, [meetup('exact', 'Hello' + tail)]] });
  await ui.fetch(); const first = ui.snapshot();
  assert.equal(first.visible.length, 0); assert.equal(first.cursor.id, 'raw29');
  assert.equal(first.empty.props.children.props.title, '아직 모든 모임을 확인하지 않았어요');
  await ui.fetch(first.cursor); const second = ui.snapshot();
  assert.deepEqual(plain(second.visible).map(p => p.id), ['exact']); assert.equal(second.cursor, null);
  assert.ok(ui.calls.every(call => call.city === 'vancouver' && call.query === place.sourceUrl));
  assert.equal(ui.calls[1].after.id, 'raw29');
});

test('existing hidden and closed filters still apply to exact destination references without discarding the raw cursor', async () => {
  const a = api(), body = 'Hello' + a.placeMeetupTail(a.resolveMeetupDestination(route).destination);
  for (const hidden of [false, true]) {
    const raw = Array.from({ length: 30 }, (_, i) => meetup('p' + i, body));
    if (!hidden) raw.forEach(p => { p.room.closed = true; });
    const ui = discovery({ pages: [raw], hidden: () => hidden }); await ui.fetch();
    assert.equal(ui.snapshot().visible.length, 0); assert.equal(ui.snapshot().cursor.id, 'p29');
    assert.equal(ui.snapshot().empty.props.children.props.title, '아직 모든 모임을 확인하지 않았어요');
  }
});

test('an event response for another identity never starts a destination feed read or shows a final empty result', async () => {
  const ui = discovery({ pages: [], eventResult: { id: 'EV_10', name: 'Other event' } }); await ui.fetch();
  assert.equal(ui.calls.length, 0); assert.equal(ui.snapshot().error, true); assert.equal(ui.snapshot().empty, undefined);
});

test('a late event prefill keeps actual manual draft edits while still attaching its verified source', async () => {
  const source = readFileSync(new URL('../src/app/meetup-create.tsx', import.meta.url), 'utf8');
  const editor = source.slice(source.indexOf('  const editDraftField = '), source.indexOf('  useLayoutEffect('));
  const field = source.slice(source.indexOf('  const field = '), source.indexOf('  const changeKind = '));
  const effect = source.slice(source.indexOf('  useEffect(() => {\n    if (!ticketmasterEventId'), source.indexOf('  const createAiDraft = '));
  let resolve, callback, title = '', body = '', details = '', eventReady = false;
  const exports = {}, context = {
    exports, language: 'ko', ticketmasterEventId: 'EV_1', ticketmasterCityId: 'vancouver', isAuthed: true, eventAttempt: 0, invalidDestination: false, loadedEvent: { current: '' }, sourceEdited: { current: false },
    useEffect: fn => { callback = fn; }, loadTicketmasterEvent: () => new Promise(done => { resolve = done; }),
    eventMeetupDraft: event => ({ title: event.name, body: 'Generated intro\n\n행사 ID: ' + event.id, startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-02T02:00:00Z' }),
    splitEventMeetupBody: value => ({ intro: value.split('\n\n')[0], details: value.slice(value.indexOf('\n\n')) }), isFestivalEvent: () => false,
    setTitle: value => { title = value; }, setBody: value => { body = value; }, setQuestion() {}, setDraftRevision() {}, setDraftEdited() {}, setAiDraftReady() {},
    setEventDetails: value => { details = value; }, setSourceEvent() {}, setEvent() {}, setEventReady: value => { eventReady = value; }, setEventError() {},
    View: 'View', ThemedText: 'Text', TextInput: 'Input', styles: {}, theme: {}, saving: false, get eventReady() { return eventReady; },
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
  };
  vm.runInNewContext(ts.transpileModule(editor + '\n' + effect + '\n' + field + '\nexports.edit=editDraftField;exports.field=field;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const cleanup = callback();
  const edit = (name, value) => exports.field(name, '', next => exports.edit(name, next), '', 60).props.children[1].props.onChangeText(value);
  edit('title', 'My manual title'); edit('body', 'Keep my writing');
  resolve({ event: { id: 'EV_1', name: 'Verified event' } }); await new Promise(setImmediate);
  assert.equal(title, 'My manual title'); assert.equal(body, 'Keep my writing'); assert.equal(details, '\n\n행사 ID: EV_1'); assert.equal(eventReady, true); cleanup();
});

test('the public caption hands a valid canonical place to the app with fresh map requests and hides unknown references', () => {
  const a = api(), source = readFileSync(new URL('../src/components/public-web/reader.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('function PlaceSourceAction(');
  assert.ok(start >= 0, 'Public place source caption is missing');
  const fragment = source.slice(start, source.indexOf('function PostAuthor(', start));
  const exports = {}, feedback = []; let request = 0;
  vm.runInNewContext(ts.transpileModule(fragment + '\nexports.render=PlaceSourceAction;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, URLSearchParams, splitPlaceMeetupBody: a.splitPlaceMeetupBody, CITIES: [{ id: 'vancouver', name: '밴쿠버' }],
    ControlMetrics: { action: 48 }, useLanguage: () => ({ language: 'en', tr: value => value === '밴쿠버' ? 'Vancouver' : value }),
    useInteractionFeedback: () => ({ play: value => feedback.push(value) }),
    placeMapRoute: item => ({ params: { cityId: item.cityId, placeId: item.id, placeRequest: String(++request) } }),
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
  });
  const destination = a.resolveMeetupDestination(route).destination, post = { cityId: place.cityId, room: {}, body: 'Invitation' + a.placeMeetupTail(destination) };
  const action = exports.render({ post }).props.children;
  assert.ok(action.props.children.includes('Test café')); assert.ok(action.props.children.includes('Vancouver')); assert.ok(action.props.children.includes('View in app map'));
  const first = action.props.href, event = { currentTarget: { href: first } };
  action.props.onClick(event); assert.notEqual(event.currentTarget.href, first);
  const params = new URL(event.currentTarget.href).searchParams;
  assert.equal(params.get('placeId'), place.id); assert.equal(params.get('cityId'), place.cityId); assert.deepEqual(feedback, ['selection']);
  assert.equal(exports.render({ post: { ...post, body: post.body.replace('/node/123', '/node/1234') } }), null);
  assert.equal(exports.render({ post: { ...post, room: null } }), null);
});
