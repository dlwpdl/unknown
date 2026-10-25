import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as editor from '../src/lib/merchant-profile-editor.ts';
import * as shops from '../src/lib/webshops.ts';
import { businessMediaUrl } from '../src/lib/business-media.ts';
import { serveBusinessMedia } from '../supabase/functions/_shared/business-media.ts';
import { withLanguageImports } from './test-language-imports.mjs';
import { saveMerchantContact } from '../src/lib/merchant-conveniences.ts';

const merchant = '13410000-0000-4000-8000-000000000001', other = '13410000-0000-4000-8000-000000000002';
const user = '13400000-0000-4000-8000-000000000001', path = `${user}/${merchant}_13420000-0000-4000-8000-000000000001.webp`;
const publicPath = `business-profile/${merchant}/map/${'a'.repeat(32)}`;
const profile = { id: merchant, can_edit: true, avatar_path: null, banner_path: null, updated_at: '2026-10-24T18:00:00Z' };
const place = { id: 'osm:node:123', cityId: 'vancouver', name: 'Branch', photo: { uri: 'https://place.test/original.webp', imageSha256: 'original', artist: 'Original credit' } };
const row = { placeKey: place.id, merchantId: merchant, photoPath: publicPath, cityId: place.cityId };
function client(data, error = null) {
  const calls = [];
  return { calls, rpc: async (...args) => { calls.push(args); return { data, error }; }, storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: 'https://private.test/preview.webp' })) }) }) } };
}

test('legacy editor reads normalize a missing map photo; photo save verifies all roles and current revision', async () => {
  assert.equal((await editor.loadMyMerchantProfile(client(profile), merchant)).map_photo_path, null);
  assert.equal(typeof editor.saveMyMerchantProfilePhotos, 'function');
  const patch = { avatarPath: null, bannerPath: null, mapPhotoPath: path, updatedAt: profile.updated_at };
  const db = client({ ...profile, map_photo_path: path });
  const saved = await editor.saveMyMerchantProfilePhotos(db, merchant, patch);
  assert.equal(saved.mapPhotoUri, 'https://private.test/preview.webp');
  assert.deepEqual(db.calls[0], ['save_my_merchant_profile_photos', { p_merchant_id: merchant, p_avatar_path: null, p_banner_path: null, p_map_photo_path: path, p_expected_updated_at: profile.updated_at }]);
  for (const data of [profile, { ...profile, id: other, map_photo_path: path }, { ...profile, map_photo_path: null }]) {
    await assert.rejects(editor.saveMyMerchantProfilePhotos(client(data), merchant, patch), /MERCHANT_PROFILE_SAVE_NOT_VERIFIED/);
  }
  await assert.rejects(editor.saveMyMerchantProfilePhotos(client(null, { message: 'MERCHANT_ACCESS_REQUIRED' }), merchant, patch), /MERCHANT_ACCESS_REQUIRED/);
  await assert.rejects(editor.saveMyMerchantProfilePhotos(client(null, { message: 'MERCHANT_PROFILE_CHANGED' }), merchant, patch), /MERCHANT_PROFILE_CHANGED/);
});

test('one city batch accepts only opaque same-business photos and preserves exact place identity', async () => {
  assert.equal(typeof shops.loadCityBusinessMapPhotos, 'function');
  const db = client([row]);
  const photos = await shops.loadCityBusinessMapPhotos(db, place.cityId);
  assert.deepEqual(db.calls, [['get_city_business_map_photos', { p_city_id: place.cityId }]]);
  const item = { id: `place:${place.cityId}:${place.id}`, cityId: place.cityId, source: 'place', sourceId: place.id, place };
  const bound = shops.bindBusinessPlaces([item], { [place.id]: merchant }, [], photos)[0];
  assert.equal(bound.place.mapPhotoUri, businessMediaUrl(publicPath));
  assert.equal(bound.place.photo, place.photo);
  assert.equal(bound.id, item.id);
  for (const links of [{}, { [place.id]: other }]) assert.equal(shops.bindBusinessPlaces([item], links, [], photos)[0].place.mapPhotoUri, undefined);
  for (const invalid of [{ ...row, cityId: 'toronto' }, { ...row, merchantId: other }, { ...row, photoPath: path }, { ...row, photoPath: 'https://evil.test/photo.webp' }, { ...row, photoPath: publicPath.replace('/map/', '/avatar/') }]) {
    await assert.rejects(shops.loadCityBusinessMapPhotos(client([invalid]), place.cityId), /INVALID_BUSINESS_MAP_PHOTOS/);
  }
  assert.deepEqual(await shops.loadCityBusinessMapPhotos(client(null, { code: 'PGRST202' }), place.cityId), {});
  assert.deepEqual(await shops.loadCityBusinessMapPhotos(client([]), place.cityId), {});
});

test('contact saving retains the separate representative photo and its retry preview', async () => {
  const value = { ...profile, name: 'Branch', city_id: 'vancouver', city_name: 'Vancouver', industry: '', services: '', address: '', review_post_id: null,
    map_photo_path: path, public_phone: '', business_hours: '' };
  const saved = await saveMerchantContact(client(value), merchant, '', '', profile.updated_at);
  assert.equal(saved.map_photo_path, path);
  assert.equal(saved.mapPhotoUri, 'https://private.test/preview.webp');
});

test('map media uses the public visibility resolver and refuses private, removed or outdated images', async () => {
  const url = businessMediaUrl(publicPath);
  assert.ok(url);
  let downloads = 0;
  const db = { rpc: async (name, args) => { assert.equal(name, 'get_business_public_media'); assert.equal(args.p_kind, 'map'); return { data: { bucket: 'merchant-profile-images', path, version: 'a'.repeat(32) } }; },
    storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob(['map'], { type: 'image/webp' }) }; } }) } };
  assert.equal((await serveBusinessMedia(new Request(url), db)).status, 200);
  for (const data of [null, { bucket: 'merchant-profile-images', path, version: 'b'.repeat(32) }]) {
    assert.equal((await serveBusinessMedia(new Request(url), { ...db, rpc: async () => ({ data }) })).status, 404);
  }
  assert.equal(downloads, 1);
});

test('rendered image prioritizes map photo, falls back with original attribution intact, and retries a new saved version', () => {
  const slots = []; let index = 0;
  const jsx = (type, props) => ({ type, props });
  const imports = { react: { useState: initial => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'Symbol' }, 'react-native': { View: 'View', StyleSheet: { create: value => value, absoluteFill: {} } }, '@/hooks/use-theme': { useTheme: () => ({}) } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/city-place-photo.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: withLanguageImports(name => name.endsWith('.webp') ? 1 : imports[name] ?? {}) });
  const render = value => { index = 0; return exports.CityPlacePhoto({ place: value }).props.children; };
  const withPhoto = { ...place, mapPhotoUri: 'https://public.test/version-one' };
  let image = render(withPhoto); assert.equal(image.props.source.uri, withPhoto.mapPhotoUri);
  assert.equal(image.props.cachePolicy, 'none', 'map media rechecks public visibility instead of reusing persisted private bytes');
  image.props.onError(); image = render(withPhoto); assert.equal(image.props.source.uri, place.photo.uri);
  assert.equal(image.props.cachePolicy, 'memory-disk');
  image.props.onError(); assert.equal(render(withPhoto).type, 'Symbol');
  assert.equal(render({ ...withPhoto, mapPhotoUri: 'https://public.test/version-two' }).props.source.uri, 'https://public.test/version-two');
  assert.equal(place.photo.artist, 'Original credit');
  assert.equal(render({ ...place, photo: null, mapPhotoUri: 'https://public.test/only-photo' }).type, 'Image');
});
