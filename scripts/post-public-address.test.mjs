import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';
import { buildCommentListRows } from '../src/lib/comment-list.ts';
import { splitPostPhotoCredits } from '../src/lib/post-photo-credits.ts';
import * as maps from '../src/lib/post-maps.ts';

const pin = 'https://www.google.com/maps/search/?api=1&query=49.2827,-123.1207';
const search = 'https://www.google.com/maps/search/?api=1&query=1100+Chestnut+Street%2C+Vancouver';
const prose = '뷰잉은 연락 주세요. 비공개 세부 안내: 402호, 999 Hidden Street';

test('public address uses only the attached label, preserving the submitted place or address', () => {
  for (const label of ['1100 Chestnut Street, Vancouver', '그랜빌마켓', '공개로 적은 402호, 1100 Chestnut Street']) {
    assert.equal(maps.postPublicAddress?.(maps.withPostMap(prose, pin, label)), label);
  }
});

test('missing public address never falls back to main prose, a bare label or an invalid map', () => {
  for (const body of [prose, `${prose}\n위치: 1100 Chestnut Street`, `${prose}\nGoogle 지도: https://evil.test/maps?query=1100+Chestnut+Street\n위치: 1100 Chestnut Street`, maps.withPostMap(prose, 'https://maps.app.goo.gl/AbCd123')]) {
    assert.equal(maps.postPublicAddress?.(body), null);
  }
});

test('an unlabeled validated map can supply its public text query but never coordinates or URL payloads', () => {
  assert.equal(maps.postPublicAddress?.(maps.withPostMap(prose, search)), '1100 Chestnut Street, Vancouver');
  assert.equal(maps.postPublicAddress?.(`${prose}\nhttps://maps.google.com/?q=Kitsilano%2C+Vancouver`), 'Kitsilano, Vancouver');
  for (const query of ['내 위치', '선택한 위치', '공개 위치', '49.2827,-123.1207', '(+49.2827, -123.1207)', '49.2827 N, 123.1207 W', '49.2827 -123.1207', '49°16′12″N,123°07′26″W', 'javascript:alert(1)', 'https://evil.test/address', 'Vancouver\u0000hidden']) {
    const url = `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`;
    assert.equal(maps.postPublicAddress?.(maps.withPostMap(prose, url)), null, query);
  }
});

test('generic or coordinate labels are not addresses; only an available public text query is a fallback', () => {
  for (const label of ['내 위치', '선택한 위치', '공개 위치', '  선택한 위치  ', '49.2827,-123.1207', '(49.2827, -123.1207)', '49.2827 N, 123.1207 W']) {
    assert.equal(maps.postPublicAddress?.(maps.withPostMap(prose, pin, label)), null, label);
    assert.equal(maps.postPublicAddress?.(maps.withPostMap(prose, search, label)), '1100 Chestnut Street, Vancouver', label);
  }
  assert.equal(maps.postPublicAddress?.(`${prose}\nGoogle 지도: ${pin}\n위치: Vancouver\u0000hidden`), null);
});

test('the public label belongs to the current attachment, not a preceding map', () => {
  const body = `${maps.withPostMap(prose, pin, '이전 장소')}\nGoogle 지도: ${search}`;
  assert.equal(maps.postPublicAddress?.(body), '1100 Chestnut Street, Vancouver');
});

const source = ts.transpileModule(readFileSync(new URL('../src/components/post-detail.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => nodes(tree).filter(node => node.type === 'ThemedText').map(node => node.props.children).flat(Infinity).filter(value => typeof value === 'string').join(' ');

function renderDetail(post, { isAuthed = true, hidden = false } = {}) {
  const exports = {}, jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: { useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: current => ({ current }), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {} },
    'react-native': { View: 'View', Modal: 'Modal', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' }, StyleSheet: { create: value => value } },
    'expo-router': { useRouter: () => ({ push() {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed, me: { id: 'viewer' }, promptLogin() {} }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => () => hidden },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16 }, Depth: {} },
    '@/lib/comment-list': { buildCommentListRows },
    '@/lib/post-photo-credits': { splitPostPhotoCredits },
    '@/lib/post-maps': maps,
    '@/lib/promotions': { PROMOTIONS_PREVIEW_ENABLED: false },
  };
  vm.runInNewContext(source, { exports, require: withLanguageImports(name => imports[name] ?? new Proxy({}, { get: (_target, key) => key })) });
  const wrapper = exports.PostDetail({ post, onClose() {} });
  return typeof wrapper?.type === 'function' ? wrapper.type(wrapper.props) : wrapper;
}

const listing = body => ({ id: 'housing', kind: 'listing', body, title: '룸 렌트', author: { id: 'owner', nickname: '작성자', neighborhood: '999 Private Profile Street' }, tag: { slug: 'housing', kind: 'listing', label: '부동산' }, comments: 0, views: 0 });

test('housing detail shows the submitted public address or the missing-address state without changing the body', () => {
  for (const [body, expected] of [[maps.withPostMap(prose, pin, '1100 Chestnut Street, Vancouver'), '1100 Chestnut Street, Vancouver'], [maps.withPostMap(prose, pin, '선택한 위치'), '상세주소 미등록'], [prose, '상세주소 미등록']]) {
    const tree = renderDetail(listing(body));
    const card = nodes(tree).find(node => node.type === 'PostCard');
    const sectionText = text(card.props.afterBody);
    assert.ok(sectionText.includes('주소·위치'));
    assert.ok(sectionText.includes(expected), sectionText);
    assert.ok(!sectionText.includes('402호') && !sectionText.includes('999 Hidden Street') && !sectionText.includes('999 Private Profile Street'));
    assert.equal(card.props.post.body, body);
  }
});

test('address section is limited to visible authenticated housing listings', () => {
  const post = listing(maps.withPostMap(prose, pin, '1100 Chestnut Street'));
  for (const other of [{ ...post, kind: 'story' }, { ...post, tag: { ...post.tag, slug: 'used' } }]) {
    const card = nodes(renderDetail(other)).find(node => node.type === 'PostCard');
    assert.ok(!text(card.props.afterBody).includes('주소·위치'));
  }
  assert.equal(renderDetail(post, { hidden: true }), null);
  const guest = renderDetail(post, { isAuthed: false });
  assert.ok(!nodes(guest).some(node => node.type === 'PostCard'));
  assert.ok(!JSON.stringify(guest).includes('1100 Chestnut Street'));
});
