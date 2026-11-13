import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSavedItems, loadSavedItemState, loadSavedPlaceState, setSavedPlaceState, setSavedItem, loadSavedFolders, saveSavedFolder, loadSavedFolder, loadFriendFolders, setSavedFolderCover, setSavedNote, loadPlaceFriendFolders, deleteSavedFolder, setSavedItemFolders } from '../src/lib/saved-items.ts';

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
  const c = client({ id: folder, name: 'Food', visibility: 'friends', description: null, cover: null, placeCount: 0 });
  assert.deepEqual(await saveSavedFolder(c, null, ' Food ', 'friends', '  '), { id: folder, name: 'Food', visibility: 'friends', description: null });
  assert.deepEqual(c.calls[0], ['save_saved_folder', { p_folder_id: null, p_name: 'Food', p_visibility: 'friends', p_description: null }]);
  assert.deepEqual(await saveSavedFolder(c, folder, 'Trips', 'friends', null), { id: folder, name: 'Food', visibility: 'friends', description: null });
  await assert.rejects(saveSavedFolder(c, folder, 'Trips', 'private', null), /INVALID_SAVED_RESPONSE/, 'a visibility the server did not confirm is not success');
  await assert.rejects(saveSavedFolder(c, folder, 'Trips', 'friends', '주말 산책'), /INVALID_SAVED_RESPONSE/, 'a description the server did not keep is not success');
  await assert.rejects(saveSavedFolder(c, folder, 'Trips', 'public', null), /INVALID_SAVED_FOLDER/);
  await assert.rejects(saveSavedFolder(c, folder, 'Trips', 'friends', '가'.repeat(151)), /INVALID_SAVED_FOLDER/);
  const described = client({ id: folder, name: 'Food', visibility: 'friends', description: '주말 산책 코스', cover: null, placeCount: 0 });
  await saveSavedFolder(described, folder, 'Food', 'friends', ' 주말\n산책   코스 ');
  assert.equal(described.calls[0][1].p_description, '주말 산책 코스', 'line breaks and runs of spaces fold into one line');
  assert.deepEqual(await loadSavedFolders(client([{ id: folder, name: 'Food' }])), [{ id: folder, name: 'Food' }], 'an older server sends no visibility');
  await assert.rejects(loadSavedFolders(client([{ id: folder, name: 'Food', visibility: 'everyone' }])), /INVALID_SAVED_RESPONSE/);
  const memberships = client(true);
  await setSavedItemFolders(memberships, place, [folder]);
  assert.deepEqual(memberships.calls[0], ['set_saved_item_folders', { p_kind: 'place', p_id: place.id, p_city_id: 'vancouver', p_folder_ids: [folder] }]);
  await deleteSavedFolder(memberships, folder);
  await assert.rejects(setSavedItemFolders(memberships, place, [folder, folder]), /INVALID_SAVED_FOLDER/);
  await assert.rejects(saveSavedFolder(c, null, '  ', 'friends', null), /INVALID_SAVED_FOLDER/);
  await assert.rejects(deleteSavedFolder(client(false), folder), /FOLDER_DELETE_NOT_VERIFIED/);
  await assert.rejects(setSavedItemFolders(client(false), place, []), /FOLDERS_NOT_VERIFIED/);
});

test('G1 save kinds: status rides on the canonical state, older servers fall back, mismatches are refused', async () => {
  const been = { ...state, status: 'been' };
  const c = client(been);
  assert.deepEqual(await loadSavedPlaceState(c, place), been);
  assert.deepEqual(c.calls[0], ['get_saved_place_state', { p_kind: 'place', p_id: place.id, p_city_id: 'vancouver' }]);
  assert.deepEqual(await setSavedPlaceState(c, place, 'been'), been);
  assert.deepEqual(c.calls[1], ['set_saved_place_state', { p_kind: 'place', p_id: place.id, p_city_id: 'vancouver', p_status: 'been' }]);
  await assert.rejects(setSavedPlaceState(client({ ...state, status: 'want' }), place, 'been'), /SAVE_NOT_VERIFIED/);
  await assert.rejects(setSavedPlaceState(client(been), place, null), /SAVE_NOT_VERIFIED/);
  const unsaved = { ...state, saved: false, savedAt: null, folderIds: [], status: null };
  assert.deepEqual(await setSavedPlaceState(client(unsaved), place, null), unsaved);
  for (const bad of [{ ...state, status: null }, { ...unsaved, status: 'want' }, { ...state, status: 'loved' }]) await assert.rejects(loadSavedPlaceState(client(bad), place), /INVALID_SAVED_RESPONSE/);
  await assert.rejects(setSavedPlaceState(client(been), place, 'loved'), /INVALID_SAVED_TARGET/);
  await assert.rejects(loadSavedPlaceState(client(been), { kind: 'user', id: person }), /INVALID_SAVED_TARGET/);
  const calls = [];
  const old = { rpc: async (name, args) => { calls.push(name); return name === 'get_saved_place_state' ? { data: null, error: { code: 'PGRST202', message: 'missing' } } : { data: state, error: null }; } };
  const fallback = await loadSavedPlaceState(old, place);
  assert.equal(fallback.status, undefined, 'an older server keeps the plain toggle');
  assert.deepEqual(calls, ['get_saved_place_state', 'get_saved_item_state']);
});

test('a friend folder carries places only, and a malformed folder or place is refused', async () => {
  const owner = 'e2300000-0000-4000-8000-000000000009';
  const detail = { id: folder, name: 'Food', visibility: 'friends', description: null, cover: { cityId: 'vancouver', placeKey: 'osm:node:42' }, placeCount: 2, role: 'viewer', owner: { id: owner, nickname: '친구' },
    places: [{ cityId: 'vancouver', placeKey: 'osm:node:42', merchantId: null, name: null, address: null }, { cityId: 'vancouver', placeKey: null, merchantId: merchant.toUpperCase(), name: 'Jimoco', address: 'Austin Ave' }] };
  const c = client(detail);
  const loaded = await loadSavedFolder(c, folder);
  assert.deepEqual(c.calls[0], ['get_saved_folder', { p_folder_id: folder }]);
  assert.equal(loaded.places[1].merchantId, merchant);
  for (const bad of [{ ...detail, role: 'admin' }, { ...detail, id: merchant }, { ...detail, places: [{ ...detail.places[0], placeKey: null }] },
    { ...detail, places: [{ ...detail.places[0], placeKey: 'osm:node:0' }] }, { ...detail, owner: { id: 'x', nickname: 'y' } },
    { ...detail, cover: { cityId: 'vancouver', placeKey: '../x' } }, { ...detail, description: '' }, { ...detail, description: undefined }]) {
    await assert.rejects(loadSavedFolder(client(bad), folder), /INVALID_SAVED_RESPONSE/);
  }
  await assert.rejects(loadSavedFolder(c, 'not-a-folder'), /INVALID_SAVED_FOLDER/);
  const card = { id: folder, name: 'Food', visibility: 'friends', description: '주말 산책', cover: null, placeCount: 2 };
  const list = client([card]);
  assert.deepEqual(await loadFriendFolders(list, owner), [card]);
  assert.deepEqual(list.calls[0], ['get_friend_saved_folders', { p_user_id: owner }]);
  await assert.rejects(loadFriendFolders(client([{ id: folder, name: 'Food', visibility: 'friends', placeCount: -1 }]), owner), /INVALID_SAVED_RESPONSE/);
  await assert.rejects(loadFriendFolders(list, 'me'), /INVALID_PROFILE/);
});

test('a cover is one of the folder places, and the server must confirm the pick', async () => {
  const cover = { cityId: 'vancouver', placeKey: 'osm:node:42' };
  const c = client({ id: folder, name: 'Food', visibility: 'friends', description: null, cover, placeCount: 1 });
  assert.deepEqual((await setSavedFolderCover(c, folder, cover)).cover, cover);
  assert.deepEqual(c.calls[0], ['set_saved_folder_cover', { p_folder_id: folder, p_city_id: 'vancouver', p_place_key: 'osm:node:42' }]);
  await setSavedFolderCover(c, folder, null);
  assert.deepEqual(c.calls[1], ['set_saved_folder_cover', { p_folder_id: folder, p_city_id: null, p_place_key: null }]);
  await assert.rejects(setSavedFolderCover(c, folder, { cityId: 'vancouver', placeKey: 'osm:node:43' }), /INVALID_SAVED_RESPONSE/);
  await assert.rejects(setSavedFolderCover(c, folder, { cityId: 'Vancouver', placeKey: 'osm:node:42' }), /INVALID_SAVED_FOLDER_COVER/);
  assert.equal(c.calls.length, 3, 'a malformed cover never reaches the server');
});

test('a memo is one line the server must keep as written, and a malformed memo is refused', async () => {
  const c = client({ key: `merchant:vancouver:${merchant}`, note: '창가 자리가 좋아요' });
  assert.equal(await setSavedNote(c, place, ' 창가 자리가\n좋아요 '), '창가 자리가 좋아요');
  assert.deepEqual(c.calls[0], ['set_saved_note', { p_kind: 'place', p_id: place.id, p_city_id: 'vancouver', p_note: '창가 자리가 좋아요' }]);
  await assert.rejects(setSavedNote(c, place, '다른 메모'), /NOTE_NOT_VERIFIED/);
  assert.equal(await setSavedNote(client({ key: 'place:x', note: null }), place, '   '), null, 'a blank memo deletes it');
  await assert.rejects(setSavedNote(c, place, '가'.repeat(201)), /INVALID_SAVED_NOTE/);
  await assert.rejects(setSavedNote(c, { kind: 'user', id: 'me' }, '메모'), /INVALID_SAVED_TARGET/);
  const item = { key: `merchant:vancouver:${merchant}`, target, savedAt: stamp, title: 'Jimoco', subtitle: '', folderIds: [] };
  assert.equal((await loadSavedItems(client({ items: [{ ...item, note: '메모' }], hasMore: false, nextCursor: null }))).items[0].note, '메모');
  for (const note of ['', '가'.repeat(201), 7]) await assert.rejects(loadSavedItems(client({ items: [{ ...item, note }], hasMore: false, nextCursor: null })), /INVALID_SAVED_RESPONSE/);
});

test('friend folders on a place carry their owner, at most ten, and a bad place never reaches the server', async () => {
  const owner = 'e2300000-0000-4000-8000-000000000009';
  const row = { id: folder, name: 'Food', visibility: 'friends', description: null, cover: null, placeCount: 1, owner: { id: owner.toUpperCase(), nickname: '친구' } };
  const c = client([row]);
  assert.deepEqual(await loadPlaceFriendFolders(c, 'vancouver', 'osm:node:42'), [{ ...row, owner: { id: owner, nickname: '친구' } }]);
  assert.deepEqual(c.calls[0], ['get_place_friend_folders', { p_city_id: 'vancouver', p_place_key: 'osm:node:42' }]);
  for (const bad of [[{ ...row, owner: null }], Array(11).fill(row)]) await assert.rejects(loadPlaceFriendFolders(client(bad), 'vancouver', 'osm:node:42'), /INVALID_SAVED_RESPONSE/);
  await assert.rejects(loadPlaceFriendFolders(c, 'vancouver', 'osm:node:0'), /INVALID_SAVED_TARGET/);
  assert.equal(c.calls.length, 1);
});
