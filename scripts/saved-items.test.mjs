import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSavedItems, loadSavedItemState, setSavedItem, loadSavedFolders, createSavedFolder, renameSavedFolder, deleteSavedFolder, setSavedItemFolders } from '../src/lib/saved-items.ts';

const merchant = 'e2310000-0000-4000-8000-000000000001';
const person = 'e2300000-0000-4000-8000-000000000002';
const folder = 'e2320000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T20:00:00.000Z';
const place = { kind: 'place', id: 'partner:jimoco-coquitlam', cityId: 'vancouver' };
const target = { kind: 'merchant', id: merchant, cityId: 'vancouver' };
const state = { target, saved: true, available: true, savedAt: stamp, folderIds: [folder] };
function client(data, error = null) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return { data, error }; } };
}

test('place state and mutation use one server-authoritative canonical merchant response', async () => {
  const c = client(state);
  assert.deepEqual(await loadSavedItemState(c, place), state);
  assert.deepEqual(c.calls[0], ['get_saved_item_state', { p_kind: 'place', p_id: place.id, p_city_id: 'vancouver' }]);
  assert.deepEqual(await setSavedItem(c, place, true), state);
  assert.deepEqual(c.calls[1], ['set_saved_item', { p_kind: 'place', p_id: place.id, p_city_id: 'vancouver', p_saved: true }]);
  assert.equal(c.calls.length, 2, 'no second company mutation or client-side mapping');
});

test('invalid targets never reach a transport and failed mutations never become success', async () => {
  const c = client(state);
  for (const bad of [{ kind: 'user', id: 'not-a-uuid' }, { kind: 'other', id: person }, { kind: 'place', id: 'osm:node:1' }, { ...place, cityId: '../vancouver' }, { ...place, id: 'osm:node:0' }, { ...place, id: 'partner:unknown/other' }]) {
    await assert.rejects(loadSavedItemState(c, bad), /INVALID_SAVED_TARGET/);
  }
  assert.equal(c.calls.length, 0);
  await assert.rejects(setSavedItem(client(null, { message: 'SAVED_TARGET_UNAVAILABLE' }), place, true), /SAVED_TARGET_UNAVAILABLE/);
  await assert.rejects(setSavedItem(client({ ...state, saved: false, savedAt: null, folderIds: [] }), place, true), /SAVE_NOT_VERIFIED/);
  await assert.rejects(loadSavedItemState(client({ ...state, target: { kind: 'user', id: person } }), { kind: 'user', id: merchant }), /INVALID_SAVED_RESPONSE/);
  await assert.rejects(loadSavedItemState(client({ ...state, target: { ...target, cityId: 'toronto' } }), place), /INVALID_SAVED_RESPONSE/);
});

test('unified pages preserve save-time cursors, filter/query/folder and simple card data', async () => {
  const item = { key: `merchant:vancouver:${merchant}`, target, savedAt: stamp, title: 'Jimoco', subtitle: 'Vancouver', cityId: 'vancouver', hasWebshop: true, folderIds: [folder] };
  const cursor = { savedAt: stamp, key: item.key };
  const page = { items: [item], hasMore: true, nextCursor: cursor };
  const c = client(page);
  assert.deepEqual(await loadSavedItems(c, { filter: 'places', query: ' Jimoco ', folderId: folder, cursor }), page);
  assert.deepEqual(c.calls[0], ['get_saved_items', { p_filter: 'places', p_query: 'Jimoco', p_folder_id: folder, p_before_saved_at: stamp, p_before_key: item.key }]);
  for (const data of [{ ...page, items: [item, item] }, { ...page, nextCursor: null }, { ...page, items: [{ ...item, folderIds: ['private-owner'] }] }, { ...page, items: [{ ...item, imageUrl: 'javascript:bad' }] }]) {
    await assert.rejects(loadSavedItems(client(data)), /INVALID_SAVED_RESPONSE/);
  }
  await assert.rejects(loadSavedItems(c, { filter: 'businesses' }), /INVALID_SAVED_QUERY/);
  await assert.rejects(loadSavedItems(c, { cursor: { savedAt: 'invalid', key: item.key } }), /INVALID_SAVED_CURSOR/);
});

test('private folder calls validate ownership identifiers and require verified server results', async () => {
  const c = client({ id: folder, name: 'Food' });
  assert.deepEqual(await createSavedFolder(c, ' Food '), { id: folder, name: 'Food' });
  assert.deepEqual(c.calls[0], ['create_saved_folder', { p_name: 'Food' }]);
  assert.deepEqual(await renameSavedFolder(c, folder, 'Trips'), { id: folder, name: 'Food' });
  assert.deepEqual(await loadSavedFolders(client([{ id: folder, name: 'Food' }])), [{ id: folder, name: 'Food' }]);
  const memberships = client(true);
  await setSavedItemFolders(memberships, place, [folder]);
  assert.deepEqual(memberships.calls[0], ['set_saved_item_folders', { p_kind: 'place', p_id: place.id, p_city_id: 'vancouver', p_folder_ids: [folder] }]);
  await deleteSavedFolder(memberships, folder);
  await assert.rejects(setSavedItemFolders(memberships, place, [folder, folder]), /INVALID_SAVED_FOLDER/);
  await assert.rejects(createSavedFolder(c, '  '), /INVALID_SAVED_FOLDER/);
  await assert.rejects(deleteSavedFolder(client(false), folder), /FOLDER_DELETE_NOT_VERIFIED/);
  await assert.rejects(setSavedItemFolders(client(false), place, []), /FOLDERS_NOT_VERIFIED/);
});
