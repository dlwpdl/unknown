import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const exports = {};
const source = readFileSync(new URL('../src/components/public-web/city-stories-home.tsx', import.meta.url), 'utf8');
const modules = { react: React, 'react/jsx-runtime': jsxRuntime,
  '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
  '@/lib/hashtags': { hasAdLabel: () => false },
  './city-stories-credits.json': JSON.parse(readFileSync(new URL('../src/components/public-web/city-stories-credits.json', import.meta.url), 'utf8')),
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  { exports, require: name => modules[name] ?? {} });
const posts = [{ id: '12345678-1234-1234-1234-123456789abc', cityId: 'vancouver', title: '우리 동네 실제 공개 글', body: '허용된 짧은 소개만', tag: { label: '라이프', slug: 'life' }, author: { nickname: '동네이웃' }, createdAtLabel: '오늘' }];
test('approved home renders real supplied public posts and canonical article links without mock content', () => {
  const markup = renderToStaticMarkup(React.createElement(exports.default, {
    city: { id: 'vancouver', name: '밴쿠버' }, cities: [{ id: 'vancouver', name: '밴쿠버' }], tags: [], posts,
    loading: false, failed: false, more: false, busy: false, onMore() {}, onRetry() {},
  }));
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /이 도시가/);
  assert.match(markup, /우리 동네 실제 공개 글/);
  assert.match(markup, /허용된 짧은 소개만/);
  assert.match(markup, /href="\/posts\/12345678-1234-1234-1234-123456789abc"/);
  assert.doesNotMatch(markup, /시안용|예시 콘텐츠|글링 에디터|서른 넘어 이민/);
  assert.match(markup, /name="city"/);
  assert.match(markup, /name="tag"/);
});
test('loaded-story search handles Korean text, whitespace and an empty result without mutating data', () => {
  assert.equal(exports.filterCityStories(posts, '  동네 ').length, 1);
  assert.equal(exports.filterCityStories(posts, '없는말').length, 0);
  assert.equal(exports.filterCityStories(posts, '').length, 1);
  assert.equal(posts.length, 1);
});
