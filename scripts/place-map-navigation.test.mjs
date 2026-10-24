import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as discovery from '../src/lib/discovery.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const parse = path => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = (root, predicate) => {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root); return found;
};
const evaluate = (expression, context) => vm.runInNewContext(ts.transpileModule(`(${expression})`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const map = parse('src/app/map.tsx');
const catalog = JSON.parse(read('src/lib/city-places.catalog.json'));
const selected = Object.values(catalog.cities).flatMap(city => city.recommendations.map(pick => ({
  ...city.places.find(place => place.id === pick.placeId), recommendation: pick,
})));

test('Home, full list and detail map controls preserve the canonical city/place identity', () => {
  assert.equal(typeof discovery.placeMapRoute, 'function');
  for (const [path, analyticsId] of [
    ['src/components/city-popular-places.tsx', 'today.places.place-open'],
    ['src/app/places/index.tsx', 'places.open'],
    ['src/app/places/[id].tsx', 'places.open'],
  ]) {
    const file = parse(path);
    const control = nodes(file, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.attributes.properties.some(prop => prop.name?.text === 'analyticsId' && prop.initializer?.text === analyticsId))[0];
    assert.ok(control, `${path}: map entry exists`);
    const handler = control.attributes.properties.find(prop => prop.name?.text === 'onPress').initializer.expression;
    for (const place of selected) {
      let route, feedback;
      evaluate(handler.getText(file), { place, cityId: place.cityId, city: { id: place.cityId },
        placeMapRoute: discovery.placeMapRoute,
        router: { push: value => { route = value; }, navigate: value => { route = value; } },
        play: value => { feedback = value; },
      })();
      assert.equal(route.pathname, '/map');
      assert.equal(route.params.cityId, place.cityId);
      assert.equal(route.params.placeId, place.id);
      assert.equal(feedback, 'selection');
      const marker = discovery.mergeCityTop25([discovery.discoveryPlace(place)], route.params.cityId)[0];
      assert.equal(marker.place.id, route.params.placeId);
      assert.equal(marker.latitude, place.latitude);
      assert.equal(marker.longitude, place.longitude);
      assert.equal(new URL(discovery.directionsUrl(marker, 'google')).searchParams.get('destination'), `${place.latitude},${place.longitude}`);
    }
  }
});

test('each explicit place-map action carries a fresh request while keeping canonical identity', () => {
  const place = selected[0], first = discovery.placeMapRoute(place), second = discovery.placeMapRoute(place);
  assert.equal(first.params.cityId, place.cityId); assert.equal(first.params.placeId, place.id);
  assert.equal(second.params.cityId, first.params.cityId); assert.equal(second.params.placeId, first.params.placeId);
  assert.equal(typeof first.params.placeRequest, 'string');
  assert.notEqual(first.params.placeRequest, second.params.placeRequest, 'same-place actions must remain distinct');
});

test('a consumed map target preserves later filters and pan on Back; a fresh same-place action refocuses', () => {
  const effect = nodes(map, node => ts.isCallExpression(node) && node.expression.getText(map) === 'useEffect'
    && node.arguments[0]?.getText(map).includes('targetFocusRef'))[0];
  assert.ok(effect, 'the actual map applies an explicit canonical target');
  const calls = {}, context = { isFocused: true, targetId: undefined, targetLatitude: undefined, targetLongitude: undefined,
    targetRecommended: true, targetVisited: false, placeRequest: 'first-entry', targetFocusRef: { current: null }, locationRevision: { current: 7 }, Date,
  };
  for (const name of ['setLocating', 'setLocationError', 'setSelectedFilters', 'setQuery', 'setSearch', 'setMode', 'setSelectedId', 'setCenter', 'setDateFilter', 'setDate']) {
    context[name] = value => { calls[name] = value; };
  }
  const focus = () => evaluate(effect.arguments[0].getText(map), context)();
  focus(); assert.equal(calls.setCenter, undefined, 'catalog not ready');
  Object.assign(context, { targetId: 'place:vancouver:osm:way:123', targetLatitude: 49.28, targetLongitude: -123.12 });
  focus();
  assert.equal(calls.setSelectedId, context.targetId);
  assert.deepEqual(Array.from(calls.setSelectedFilters), ['top25']);
  assert.equal(calls.setCenter.latitude, 49.28);
  assert.equal(calls.setCenter.longitude, -123.12);
  assert.equal(calls.setMode, 'map');
  assert.equal(calls.setQuery, ''); assert.equal(calls.setSearch, '');
  assert.equal(context.locationRevision.current, 8, 'old in-flight GPS result cannot override explicit target');
  Object.assign(calls, { setCenter: 'later-user-pan-or-GPS', setSelectedFilters: ['festival'], setDateFilter: 'weekend',
    setDate: '2026-10-24', setQuery: 'music', setSearch: 'music', setSelectedId: 'event:selected' });
  focus();
  assert.equal(calls.setCenter, 'later-user-pan-or-GPS');
  context.isFocused = false; focus();
  context.isFocused = true; focus();
  assert.equal(calls.setCenter, 'later-user-pan-or-GPS', 'normal Back must preserve the current map camera');
  assert.deepEqual(Array.from(calls.setSelectedFilters), ['festival'], 'normal Back must retain the selected category');
  assert.equal(calls.setDateFilter, 'weekend'); assert.equal(calls.setDate, '2026-10-24');
  assert.equal(calls.setQuery, 'music'); assert.equal(calls.setSearch, 'music'); assert.equal(calls.setSelectedId, 'event:selected');
  assert.equal(context.locationRevision.current, 8, 'ordinary focus does not create a fresh location request');
  context.isFocused = false; context.placeRequest = 'repeat-explicit-entry'; focus();
  assert.equal(calls.setCenter, 'later-user-pan-or-GPS', 'a hidden map waits for the new request to be focused');
  context.isFocused = true; focus();
  assert.equal(calls.setCenter.latitude, 49.28, 'a new same-place action must refocus, including reused map routes');
  assert.deepEqual(Array.from(calls.setSelectedFilters), ['top25']); assert.equal(calls.setSelectedId, context.targetId);
  assert.equal(context.locationRevision.current, 9);
  calls.setCenter = 'later-pan-after-repeat'; focus(); assert.equal(calls.setCenter, 'later-pan-after-repeat');
  Object.assign(context, { targetId: 'place:toronto:osm:node:456', targetLatitude: 43.65, targetLongitude: -79.38, targetRecommended: false });
  focus(); assert.equal(calls.setCenter.latitude, 43.65);
  assert.deepEqual(Array.from(calls.setSelectedFilters), [], 'archived detail identity remains reachable without a Top 50 badge');
  context.placeRequest = undefined; focus();
  calls.setCenter = 'legacy-link-later-pan';
  context.isFocused = false; focus(); context.isFocused = true; focus();
  assert.equal(calls.setCenter, 'legacy-link-later-pan', 'legacy links without a request are consumed once too');
  Object.assign(context, { targetVisited: true, placeRequest: 'explicit-team-visited-place' });
  focus();
  assert.deepEqual(Array.from(calls.setSelectedFilters), ['visited']);
  assert.equal(calls.setSelectedId, context.targetId);
  calls.setCenter = 'later-pan-after-visited';
  context.isFocused = false; focus(); context.isFocused = true; focus();
  assert.equal(calls.setCenter, 'later-pan-after-visited', 'Back from an attested visit must preserve the current map');
});

test('curated canonical pins survive the existing 500-result cap', () => {
  const expression = nodes(map, node => ts.isVariableDeclaration(node) && node.name.getText(map) === 'publicItems')[0].initializer;
  const place = selected.find(place => place.cityId === 'vancouver');
  const catalogItems = [discovery.discoveryPlace(place)];
  const posts = Array.from({ length: 500 }, (_, index) => ({
    id: `post:${index}`, source: 'post', cityId: 'vancouver', category: 'housing',
    post: { id: `${index}`, author: { id: 'u' }, kind: 'listing', listingStatus: 'open', expiresAt: '2099-01-01T00:00:00Z' },
  }));
  const publicItems = evaluate(expression.getText(map), { current: { items: posts }, catalogItems, hidden: () => false,
    now: Date.now(), discoveryEvent: discovery.discoveryEvent });
  const visible = discovery.mergeCityTop25(publicItems, 'vancouver').slice(0, 500);
  assert.ok(visible.some(item => item.id === catalogItems[0].id));
});

test('curated reasons use language en with locale en-CA, preserving Korean and missing-English fallback', () => {
  for (const path of ['src/app/places/index.tsx', 'src/app/places/[id].tsx', 'src/app/map.tsx']) {
    const file = parse(path);
    const expression = nodes(file, node => ts.isConditionalExpression(node) && node.getText(file).includes('.reasonEn')).at(-1);
    assert.ok(expression, path);
    for (const language of ['ko', 'en']) for (const reasonEn of ['English photo-spot reason', undefined]) {
      const hook = { language, locale: language === 'ko' ? 'ko-KR' : 'en-CA' }, context = {};
      for (const binding of nodes(file, node => ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
        && node.initializer?.getText(file) === 'useLanguage()')) {
        for (const element of binding.name.elements) context[element.name.getText(file)] = hook[element.propertyName?.text ?? element.name.getText(file)];
      }
      const reason = { reason: '한국어 사진 명소 설명', reasonEn };
      Object.assign(context, { place: { recommendation: reason }, item: { top25: reason } });
      assert.equal(evaluate(expression.getText(file), context), language === 'en' && reasonEn ? reasonEn : reason.reason, `${path}: ${language}`);
    }
  }
});

test('place saving passes the raw canonical identity and city without a client business alias', () => {
  const file = parse('src/app/places/[id].tsx');
  const expression = nodes(file, node => ts.isCallExpression(node) && node.expression.getText(file) === 'useSavedEntry')[0];
  const place = { id: 'osm:way:37063023', cityId: 'vancouver', name: 'Stanley Park' };
  const result = evaluate(expression.getText(file), { place, city: { id: 'vancouver' }, useSavedEntry: (target, visible) => ({ target, visible }) });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { target: { kind: 'place', id: place.id, cityId: place.cityId }, visible: true });
});

test('late place-to-business links cannot redirect a new viewer, target, city, visibility or focus scope', async () => {
  const file = parse('src/app/places/[id].tsx');
  const layout = nodes(file, node => ts.isCallExpression(node) && node.expression.getText(file) === 'useLayoutEffect' && node.getText(file).includes('linkScope'))[0];
  const lookup = nodes(file, node => ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' && node.getText(file).includes('loadCityBusinessLinks'))[0];
  for (const boundary of ['viewer', 'target', 'city', 'visibility', 'focus', 'auth-loading']) {
    const pending = [], routes = [], effects = [], dependencies = [], cleanup = [];
    let index = 0;
    const register = immediate => (fn, deps) => {
      const slot = index++;
      if (dependencies[slot] && deps.every((value, i) => Object.is(value, dependencies[slot][i]))) return;
      dependencies[slot] = deps;
      const apply = () => { cleanup[slot]?.(); cleanup[slot] = fn(); };
      if (immediate) apply(); else effects.push(apply);
    };
    const context = { targetId: 'osm:node:42', loadedCityId: 'vancouver', userId: 'viewer', isFocused: true, isAuthLoading: false,
      hidden: () => false, linkScope: { current: null }, supabase: {}, AbortController,
      router: { replace: route => routes.push(route) }, loadCityBusinessLinks: () => new Promise(resolve => pending.push(resolve)),
      useLayoutEffect: register(true), useEffect: register(false) };
    vm.runInNewContext(ts.transpileModule(`globalThis.render=()=>{${layout.getText(file)};${lookup.getText(file)};}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    context.render(); effects.splice(0).forEach(fn => fn());
    if (boundary === 'viewer') context.userId = 'another';
    if (boundary === 'target') context.targetId = 'osm:node:43';
    if (boundary === 'city') context.loadedCityId = 'toronto';
    if (boundary === 'visibility') context.hidden = () => true;
    if (boundary === 'focus') context.isFocused = false;
    if (boundary === 'auth-loading') context.isAuthLoading = true;
    index = 0; context.render();
    // Resolve between layout and passive cleanup, before the old AbortController is cancelled.
    pending[0]({ 'osm:node:42': 'old-business' }); await new Promise(setImmediate);
    assert.equal(routes.length, 0, boundary);
    effects.splice(0).forEach(fn => fn()); cleanup.forEach(fn => fn?.());
  }
});
