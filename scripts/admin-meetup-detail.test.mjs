import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const exports = {};
const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-meetups.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const host = ({ children }) => React.createElement('div', null, children);
vm.runInNewContext(`${source}\nexports.MeetupDetail = MeetupDetail;`, { exports, Intl, Date, require(name) {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'react-native') return { View: host };
  if (name.endsWith('/themed-text')) return { ThemedText: host };
  if (name.endsWith('/interaction-feedback')) return { useInteractionFeedback: () => ({ play() {} }) };
  if (name.endsWith('/admin-meetups')) return { adminMeetupState: () => 'open', MEETUP_STATES: { open: '모집 중' } };
  if (name.endsWith('/chilling')) return { chillingKind: () => 'once', chillingSchedule: () => '토요일 오후 2시', recommendedAgeLabel: room => room.ageLabel ?? '연령대 무관' };
  if (name.endsWith('/admin-labels')) return { displayName: (_, id) => id };
  if (name.endsWith('/mock')) return { CITIES: [{ id: 'vancouver', name: '밴쿠버' }] };
  return {};
} });

const post = {
  id: 'meetup-example-id', title: '주말 산책', body: '공원을 천천히 걸어요.', author_id: 'host', city_id: 'vancouver',
  created_at: '2026-10-14T12:00:00Z', room_preview: { memberCount: 3, capacity: 8, applicationQuestion: '어떤 분위기를 기대하세요?' },
};
const render = changes => renderToStaticMarkup(React.createElement(exports.MeetupDetail, {
  post: { ...post, ...changes }, hostName: '예시 주최자', refreshSignal: 0, onUser() {}, onClose() {},
}));

test('meetup overview keeps the introduction and people first, with optional fields in a closed disclosure', () => {
  const html = render();
  const firstView = html.split('<details')[0].replace(/<[^>]*>/g, '');
  assert.ok(firstView.includes(post.body));
  assert.ok(firstView.includes('예시 주최자'));
  assert.ok(firstView.includes('3 / 8명'));
  assert.ok(!firstView.includes(post.room_preview.applicationQuestion));
  assert.ok(!firstView.includes('전체 회원 참여'));
  assert.ok(!firstView.includes(post.id));
  assert.match(html, /<details[^>]*>\s*<summary[^>]*>참여 조건·운영 정보<\/summary>/);
  assert.ok(html.includes(post.room_preview.applicationQuestion));
  assert.ok(html.includes(post.id));
});

test('restricted eligibility stays visible before optional operational details', () => {
  const html = render({ room_preview: { ...post.room_preview, verifiedOnly: true, ageLabel: '20대 권장' } });
  const firstView = html.split('<details')[0].replace(/<[^>]*>/g, '');
  assert.ok(firstView.includes('인증 회원만 참여'));
  assert.ok(firstView.includes('20대 권장'));
});

test('a long meetup introduction can expand without discarding the original content', () => {
  const body = '긴 소개 문장과 실제 원문을 그대로 보존합니다. '.repeat(25);
  const html = render({ body });
  assert.match(html, /aria-expanded="false"[^>]*>소개 전체 보기/);
  assert.ok(html.includes(body));
  assert.ok(!render().includes('소개 전체 보기'));
});
