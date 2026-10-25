import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { parseAiDraftResponse } from '../src/lib/ai-draft.ts';
import { tr } from '../src/i18n/index.ts';

const source = ts.createSourceFile('merchant-workspace.tsx', readFileSync(new URL('../src/components/merchant-workspace.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, values) {
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found, name);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(found.getText(source) + `\nexports.run = ${name};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Error, Response, tr, ...values });
  return exports.run;
}

test('AI generation preserves photos, requires facts and discards results after account changes', async () => {
  const calls = [], changes = [], editor = { title: '', body: '', tag_slug: 'food', kind: 'story', image_paths: ['photo-a'] };
  const state = { data: { merchant: { city_name: '밴쿠버' } }, facts: '토요일부터 CAD12 도시락', busyRef: { current: false }, editor,
    id: 'merchant-a', me: { id: 'owner-a' }, mounted: { current: true }, purpose: '메뉴·서비스 소개',
    run: async callback => callback(), confirmAction: async () => true, parseAiDraftResponse,
    changeDraft: change => changes.push(change), setAiDraftReady() {}, setDraftStep() {},
    supabase: { functions: { invoke: async (...args) => { calls.push(args); return { data: { draft: { categorySlug: 'food', title: '새 도시락', body: '원문', hashtags: [] } }, error: null }; } }, auth: { getSession: async () => ({ data: { session: { user: { id: 'owner-b' } } } }) } },
  };
  await assert.rejects(handler('generateDraft', state)(), /ACCOUNT_CHANGED/);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'draft-post'); assert.equal(calls[0][1].body.intent, 'merchant_promotion');
  assert.equal(changes.length, 0); assert.deepEqual(editor.image_paths, ['photo-a']);
  calls.length = 0;
  await handler('generateDraft', { ...state, facts: '  ' })(); assert.equal(calls.length, 0);
});

test('saving before channel selection retains ordered photos and advances only after a successful save', async () => {
  const events = [], photos = [{ path: 'photo-a', uri: 'uri-a' }, { uri: 'new-photo' }];
  const state = { editor: { id: 'draft-a', title: ' 제목 ', body: ' 본문 ', original_url: '', image_paths: ['photo-a'] },
    id: 'merchant-a', me: { id: 'owner-a' }, draftPhotos: photos, mounted: { current: true }, editorReload: { current: null }, supabase: {},
    run: async callback => callback(), saveMerchantDraftImages: async (...args) => { events.push(['save', ...args]); return ['photo-a', 'photo-b']; },
    setDraftPhotos: value => events.push(['photos', value]), setEditor: value => events.push(['editor', value]), setDirty: value => events.push(['dirty', value]), setDraftStep: value => events.push(['step', value]),
  };
  await handler('saveEditor', state)('channels');
  assert.equal(events[0][0], 'save'); assert.equal(events[0][2], 'merchant-a'); assert.equal(events[0][3], 'owner-a');
  assert.equal(events[0][5], photos);
  assert.deepEqual(Array.from(state.editorReload.current.image_paths), ['photo-a', 'photo-b']);
  assert.equal(state.editorReload.current.title, '제목'); assert.equal(state.editorReload.current.body, '본문');
  assert.deepEqual(events.at(-1), ['step', 'channels']);
  events.length = 0;
  await assert.rejects(handler('saveEditor', { ...state, saveMerchantDraftImages: async () => { throw Error('offline'); } })('channels'), /offline/);
  assert.equal(events.length, 0, 'failed save preserves the editor, photos, dirty state and current step');
});

test('the business-web home generates from its own notes into the freshly opened draft without asking to replace a stale editor', async () => {
  const calls = [], edits = [], confirms = [];
  const state = { data: { merchant: { city_name: '밴쿠버' } }, facts: '', purpose: '가게 소식', busyRef: { current: false },
    editor: { title: '예전 초안', body: '예전 본문', tag_slug: 'festival', kind: 'story', image_paths: [] }, emptyDraft: () => ({ title: '', body: '', tag_slug: 'life', kind: 'story', image_paths: [] }),
    id: 'merchant-a', me: { id: 'owner-a' }, mounted: { current: true }, run: async callback => callback(), parseAiDraftResponse,
    confirmAction: async () => { confirms.push(true); return true; }, changeDraft: () => { throw new Error('stale editor must not be merged'); },
    setEditor: update => edits.push(update({ id: 'new-draft', title: '', body: '', kind: 'story' })), setDirty() {}, setPreparedChannels() {}, setAiDraftReady() {}, setDraftStep() {},
    supabase: { functions: { invoke: async (...args) => { calls.push(args); return { data: { draft: { categorySlug: 'jobs', title: '주말 알바', body: '토·일 오전', hashtags: [] } }, error: null }; } }, auth: { getSession: async () => ({ data: { session: { user: { id: 'owner-a' } } } }) } },
  };
  await handler('generateDraft', state)({ facts: ' 토·일 오전 알바 1명 ', purpose: '구인구직' });
  assert.equal(confirms.length, 0);
  assert.equal(calls[0][1].body.bodyHint, '토·일 오전 알바 1명'); assert.equal(calls[0][1].body.purpose, '구인구직'); assert.equal(calls[0][1].body.selectedCategory, 'life');
  assert.equal(edits[0].id, 'new-draft'); assert.equal(edits[0].title, '주말 알바'); assert.equal(edits[0].kind, 'listing');
});
