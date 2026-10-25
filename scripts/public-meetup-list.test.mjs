import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { toQR } from 'toqr';
import * as chilling from '../src/lib/chilling.ts';
import { ControlMetrics, ControlMotion, Typography } from '../src/constants/design-system.ts';

const id = '41000000-0000-4000-8000-000000000001';
const meetup = (patch = {}) => ({ id, cityId: 'vancouver', title: 'Synthetic fixture meetup', body: 'PRIVATE_CONTACT_MUST_NOT_RENDER',
  imageThumbs: ['https://images.example.invalid/meetup.webp'], room: { id: 'room', title: 'Synthetic room', memberCount: 7, capacity: 12,
    eventKind: 'once', startsAt: '2099-01-10T20:00:00Z', endsAt: '2099-01-10T22:00:00Z', timezone: 'America/Vancouver', address: 'PRIVATE_ADDRESS_MUST_NOT_RENDER' }, ...patch });
const elements = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
function mount(file, name, initialProps = {}) {
  const slots = [], feedback = [], qrCalls = [];
  let cursor = 0, language = 'ko', props = initialProps, failQr = false;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, n) => !Object.is(value, slots[i].deps[n]))) slots[i] = { value: fn(), deps }; return slots[i].value; },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/components/public-web/${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require(name) {
      if (name.endsWith('.css')) return {};
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
      if (name === '@/hooks/use-language') return { useLanguage: () => ({ language, locale: language === 'ko' ? 'ko-KR' : 'en-CA', tr: value => language === 'en' && value === '밴쿠버' ? 'Vancouver' : value }) };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({ background: '#0D0C10', card: '#1A1820', text: '#F4F0FC', textSecondary: '#BDB5CF', accent: '#CBB9FF', accentInk: '#241B37', line: '#393340' }) };
      if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
      if (name === '@/constants/design-system') return { ControlMetrics, ControlMotion, Typography };
      if (name === '@/constants/theme') return { Spacing: { two: 8, three: 16, four: 24 } };
      if (name === '@/lib/chilling') return chilling;
      if (name === '@/lib/mock') return { CITIES: [{ id: 'vancouver', name: '밴쿠버' }] };
      if (name === 'toqr') return { toQR: url => { qrCalls.push(url); if (failQr) throw Error('ENCODER_UNAVAILABLE'); return toQR(url); } };
      throw Error(`Unexpected import ${name}`);
    },
  });
  return { render(next) { if (next) props = next; cursor = 0; return exports[name](props); }, feedback, qrCalls, language(value) { language = value; }, failQr() { failQr = true; } };
}
const props = (patch = {}) => ({ posts: [meetup()], cityName: 'Vancouver', loading: false, failed: false, onRetry() {}, ...patch });

test('public meetup cards show only supplied meetup metadata and preserve the same web/app post ID', () => {
  const ui = mount('meetup-list.tsx', 'PublicMeetupList', props({ posts: [meetup(), meetup({ id: 'ordinary', room: undefined, title: 'Not a meetup' })] }));
  const tree = ui.render(), nodes = elements(tree), body = text(tree);
  assert.equal(nodes.filter(n => n.type === 'article').length, 1);
  assert.ok(body.includes('Synthetic fixture meetup') && body.includes('7') && body.includes('12') && body.includes('밴쿠버'));
  assert.equal(body.includes('PRIVATE_CONTACT'), false); assert.equal(body.includes('PRIVATE_ADDRESS'), false); assert.equal(body.includes('Not a meetup'), false);
  const read = nodes.find(n => n.props?.href === `/post?id=${id}`), join = nodes.find(n => n.props?.href === `gling://meetup-join?postId=${id}`);
  assert.ok(read && join); read.props.onClick(); join.props.onClick(); assert.deepEqual(ui.feedback, ['selection', 'selection']);
  assert.ok(nodes.some(n => n.type === 'img' && n.props.loading === 'lazy'));
});

test('schedule, city and app-only explanation follow the current language without changing supplied content', () => {
  const ui = mount('meetup-list.tsx', 'PublicMeetupList', props()); ui.language('en');
  const tree = ui.render(), body = text(tree);
  assert.ok(body.includes(chilling.chillingSchedule(meetup().room, 'en-CA')));
  assert.ok(body.includes('Vancouver') && body.includes('Synthetic fixture meetup'));
  assert.match(body, /join|Joining/); assert.match(body, /chat/); assert.match(body, /app/);
  const create = elements(tree).find(n => n.props?.href === 'gling://meetup-create'); assert.ok(create); create.props.onClick(); assert.deepEqual(ui.feedback, ['selection']);
});

test('ended, closed and full meetups do not promise an available joining action', () => {
  for (const patch of [{ endsAt: '2020-01-10T22:00:00Z' }, { closed: true }, { memberCount: 12 }]) {
    const ui = mount('meetup-list.tsx', 'PublicMeetupList', props({ posts: [meetup({ room: { ...meetup().room, ...patch } })] })); ui.language('en');
    const tree = ui.render(), app = elements(tree).find(n => n.props?.className?.includes('public-meetup-app'));
    assert.equal(app.props.href, `gling://post/${id}`);
    assert.match(text(tree), /Ended|Closed|Full/); assert.match(text(app), /View/); assert.doesNotMatch(text(app), /Join/);
  }
});

test('missing counts and schedule stay unavailable, while a genuinely supplied zero remains zero', () => {
  const ui = mount('meetup-list.tsx', 'PublicMeetupList', props({ posts: [meetup({ room: { id: 'room', eventKind: 'once' } })] })); ui.language('en');
  assert.match(text(ui.render()), /Schedule needs confirmation/); assert.match(text(ui.render()), /Attendance unavailable/); assert.doesNotMatch(text(ui.render()), /0 members/);
  const zero = ui.render(props({ posts: [meetup({ room: { ...meetup().room, memberCount: 0 } })] })); assert.match(text(zero), /0 members/);
});

test('loading, failure and empty states hide old cards and retry plays feedback once', () => {
  let retries = 0; const ui = mount('meetup-list.tsx', 'PublicMeetupList', props({ loading: true })); ui.language('en');
  assert.match(text(ui.render()), /Loading/); assert.equal(elements(ui.render()).filter(n => n.type === 'article').length, 0);
  const failure = ui.render(props({ failed: true, onRetry: () => retries++ })); const retry = elements(failure).find(n => n.type === 'button');
  assert.ok(retry); retry.props.onClick(); assert.equal(retries, 1); assert.deepEqual(ui.feedback, ['selection']); assert.equal(elements(failure).filter(n => n.type === 'article').length, 0);
  const empty = ui.render(props({ posts: [] })); assert.match(text(empty), /No meetups/); assert.equal(elements(empty).filter(n => n.type === 'article').length, 0);
});

test('a broken thumbnail is removed without losing its meetup or reusing the failure for a new photo', () => {
  const ui = mount('meetup-list.tsx', 'PublicMeetupList', props()); const image = elements(ui.render()).find(n => n.type === 'img'); image.props.onError();
  assert.equal(elements(ui.render()).filter(n => n.type === 'img').length, 0); assert.equal(elements(ui.render()).filter(n => n.type === 'article').length, 1);
  const next = ui.render(props({ posts: [meetup({ imageThumbs: ['https://images.example.invalid/new.webp'] })] })); assert.equal(elements(next).filter(n => n.type === 'img').length, 1);
  elements(next).find(n => n.type === 'img').props.onError(); image.props.onError();
  assert.equal(elements(ui.render()).filter(n => n.type === 'img').length, 0, 'a late error for an old URL cannot resurrect the failed replacement');
});

test('store choices start unselected and encode only the explicitly selected store, with a four-cell quiet zone', () => {
  const ui = mount('app-store-choices.tsx', 'AppStoreChoices'); let tree = ui.render();
  assert.equal(elements(tree).some(n => n.type === 'svg'), false); assert.equal(ui.qrCalls.length, 0);
  elements(tree).find(n => n.type === 'button' && text(n) === 'App Store').props.onClick(); tree = ui.render();
  const ios = 'https://apps.apple.com/ca/app/id6809273242', svg = elements(tree).find(n => n.type === 'svg');
  const size = Math.sqrt(toQR(ios).length); assert.equal(svg.props.viewBox, `0 0 ${size + 8} ${size + 8}`); assert.ok(elements(tree).some(n => n.props?.href === ios)); assert.deepEqual(ui.qrCalls, [ios]);
  const path = elements(svg).find(n => n.type === 'path').props.d; const points = [...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.ok(points.length > 0 && points.every(([x, y]) => x >= 4 && y >= 4 && x < size + 4 && y < size + 4));
  elements(tree).find(n => n.type === 'button' && text(n) === 'Google Play').props.onClick(); tree = ui.render();
  assert.ok(elements(tree).some(n => n.props?.href === 'https://play.google.com/store/apps/details?id=com.dlwpdl.gling')); assert.match(text(tree), /비공개 테스트/); assert.deepEqual(ui.feedback, ['selection', 'selection']);
});

test('store copy follows language changes, link feedback is present and QR failure retains a usable store link', () => {
  const ui = mount('app-store-choices.tsx', 'AppStoreChoices'); ui.failQr();
  elements(ui.render()).find(n => n.type === 'button' && text(n) === 'Google Play').props.onClick(); ui.language('en'); const tree = ui.render();
  assert.equal(elements(tree).some(n => n.type === 'svg'), false); assert.match(text(tree), /private testing/);
  const link = elements(tree).find(n => n.props?.href?.includes('play.google.com')); assert.ok(link); link.props.onClick(); assert.deepEqual(ui.feedback, ['selection', 'selection']);
});

test('static no-script fallback retains both real store links and Android eligibility without a QR or analytics target', () => {
  const ui = mount('app-store-choices.tsx', 'AppStoreChoices'); ui.language('en'); const tree = ui.render();
  const fallback = elements(tree).find(n => n.type === 'noscript'); assert.ok(fallback);
  assert.ok(elements(fallback).some(n => n.props?.href === 'https://apps.apple.com/ca/app/id6809273242'));
  assert.ok(elements(fallback).some(n => n.props?.href === 'https://play.google.com/store/apps/details?id=com.dlwpdl.gling'));
  assert.match(text(fallback), /private testing/); assert.equal(elements(tree).some(n => n.type === 'svg'), false);
  const list = mount('meetup-list.tsx', 'PublicMeetupList', props()).render();
  assert.equal([...elements(tree), ...elements(list)].some(n => n.props?.['data-analytics']), false, 'unknown behavior targets must not invalidate an otherwise valid event batch');
});
