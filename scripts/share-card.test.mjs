import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clampShareText, listShareCard, placeShareCard, savedListPlaces, SHARE_CARD_PIXELS, SHARE_CARD_SIZE, shareCardCaptureSize, shareCardImage, shareCardSenderName } from '../src/lib/share-card.ts';

const city = { name: '밴쿠버', englishName: 'Vancouver', province: 'BC' };
const photo = (id, extra = {}) => ({ placeId: id, cityId: 'vancouver', uri: `https://upload.wikimedia.org/${id}.jpg`, sourceUrl: `https://commons.wikimedia.org/${id}`,
  artist: `Artist ${id}`, license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', imageSha256: `sha-${id}`, ...extra });
const place = (id, extra = {}) => ({ id: `osm:node:${id}`, cityId: 'vancouver', name: `Place ${id}`, category: 'cafe', latitude: 49.28, longitude: -123.12,
  address: '123 Main St', sourceUrl: `https://www.openstreetmap.org/node/${id}`, openingHours: 'Mo-Fr 08:00-17:00', ...extra });

test('the card is 9:16 and exports at story size', () => {
  assert.equal(SHARE_CARD_SIZE.width * 16, SHARE_CARD_SIZE.height * 9);
  assert.deepEqual([SHARE_CARD_SIZE.width * 3, SHARE_CARD_SIZE.height * 3], [1080, 1920]);
});

test('a place card carries the licensed photo with its credit and nothing the app does not have', () => {
  const card = placeShareCard(place(1, { photo: photo(1), mapPhotoUri: 'https://example.com/business.jpg' }), city, 'ko');
  assert.equal(card.photo.photo.imageSha256, 'sha-1');
  assert.equal(card.photo.mapPhotoUri, undefined, 'a business map photo never replaces the licensed one on a shared image');
  assert.equal(card.credit, '사진: Artist 1 · CC BY-SA 4.0');
  assert.deepEqual([card.eyebrow, card.badge, card.footer, card.sender], ['카페', '밴쿠버', '글링 지도에서 볼 수 있어요', null]);
  const shown = [card.eyebrow, card.title, card.badge, card.more, card.empty, card.credit, card.sender, card.footer, card.label, card.message].join('\n');
  assert.equal(shown.includes('08:00'), false, 'opening hours are not shown as an open state');
  assert.deepEqual(Object.keys(card).sort(), ['badge', 'credit', 'empty', 'eyebrow', 'footer', 'items', 'kind', 'label', 'message', 'more', 'photo', 'sender', 'title']);
  assert.match(card.message, /^Place 1\n카페 · 밴쿠버\nhttps:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Place\+1/);
});

test('a place without a licensed photo has no photo and no credit; Openverse photos keep the place screen note', () => {
  const bare = placeShareCard(place(2, { photo: null, mapPhotoUri: 'https://example.com/business.jpg' }), city, 'en');
  assert.deepEqual([bare.photo, bare.credit, bare.eyebrow, bare.badge], [null, null, 'Cafés', 'Vancouver']);
  const openverse = placeShareCard(place(3, { category: 'food', photo: photo(3, { discoveredVia: 'Openverse' }) }), city, 'en');
  assert.equal(openverse.credit, 'Photo: Artist 3 · CC BY-SA 4.0\nPhotos found with Openverse. This service isn’t endorsed or certified by Openverse.');
  assert.equal(openverse.eyebrow, 'Restaurants');
});

test('very long or multi-line names are cut on the card but kept whole in the text share', () => {
  const name = `  ${'아주 긴 장소 이름 '.repeat(12)}\n2층  `;
  const card = placeShareCard(place(4, { name }), city, 'ko');
  assert.equal(Array.from(card.title).length, 60);
  assert.ok(card.title.endsWith('…') && !card.title.includes('\n') && !card.title.includes('  '));
  assert.ok(card.message.startsWith(name.trim()));
  assert.equal(clampShareText('🍜'.repeat(5), 3), '🍜🍜…', 'emoji are cut whole');
  assert.equal(clampShareText('짧은 이름', 40), '짧은 이름');
});

test('the sender is the member’s own nickname, off for personas and unknown accounts', () => {
  assert.equal(shareCardSenderName('다은', { provider: 'kakao' }), '다은');
  assert.equal(shareCardSenderName('다은', { provider: 'email', gling_persona: { kind: 'gling_operated_character' } }), null);
  assert.equal(shareCardSenderName('다은', null), null);
  assert.equal(shareCardSenderName('   ', {}), null);
  assert.equal(Array.from(shareCardSenderName('가'.repeat(40), {})).length, 20);
  assert.equal(placeShareCard(place(5), city, 'ko', '다은').sender, '다은님이 공유했어요');
  assert.equal(placeShareCard(place(5), city, 'en', '다은').sender, 'Shared by 다은');
  assert.ok(placeShareCard(place(5), city, 'ko', '다은').label.includes('다은님이 공유했어요'));
});

test('a list card shows the first three places, the rest as a count, and credits only the photos it shows', () => {
  const places = [1, 2, 3, 4, 5].map(id => place(id, { photo: id === 2 ? null : photo(id) }));
  const card = listShareCard('비 오는 날 갈 곳', places, 5, 'ko', null);
  assert.deepEqual(card.items.map(item => [item.name, item.photo?.photo.imageSha256 ?? null]), [['Place 1', 'sha-1'], ['Place 2', null], ['Place 3', 'sha-3']]);
  assert.deepEqual([card.badge, card.more, card.empty, card.eyebrow], ['장소 5곳', '외 2곳', null, '장소 목록']);
  assert.equal(card.credit, '사진: Artist 1 · CC BY-SA 4.0 / Artist 3 · CC BY-SA 4.0');
  assert.equal(card.message, '비 오는 날 갈 곳\n· Place 1\n· Place 2\n· Place 3\n· Place 4\n· Place 5');
});

test('an empty list, an unknown total and a repeated photo stay honest', () => {
  const empty = listShareCard('빈 목록', [], 0, 'ko');
  assert.deepEqual([empty.items, empty.badge, empty.more, empty.credit, empty.empty, empty.message], [[], '장소 0곳', null, null, '아직 담긴 장소가 없어요', '빈 목록']);
  const partial = listShareCard('반만 불러온 목록', [place(1)], null, 'en');
  assert.deepEqual([partial.badge, partial.more, partial.empty], [null, null, null]);
  const same = photo(9);
  assert.equal(listShareCard('같은 사진', [place(1, { photo: same }), place(2, { photo: same })], 2, 'ko').credit, '사진: Artist 9 · CC BY-SA 4.0');
  const longer = listShareCard('일부만 가진 목록', [place(1), place(2)], 7, 'en');
  assert.deepEqual([longer.badge, longer.more], ['7 places', '+5 more']);
  assert.ok(longer.message.endsWith('\n+5 more'));
  assert.deepEqual([listShareCard('하나', [place(1)], 1, 'en').badge, listShareCard('하나', [place(1)], 1, 'ko').badge], ['1 place', '장소 1곳'], 'one place reads as one, not "1 places"');
});

test('a saved list keeps its catalog places in order and skips businesses, posts and unknown cities', () => {
  let reads = 0;
  const catalog = { vancouver: [place(1), place(2)], toronto: [place(7, { cityId: 'toronto' })] };
  const lookup = cityId => { reads++; if (!catalog[cityId]) throw new Error('INVALID_CITY'); return catalog[cityId]; };
  const items = [
    { target: { kind: 'place', id: 'osm:node:2', cityId: 'vancouver' } }, { target: { kind: 'merchant', id: 'b1910000-0000-4000-8000-000000000001' } },
    { target: { kind: 'place', id: 'osm:node:7', cityId: 'toronto' } }, { target: { kind: 'post', id: 'b19a0000-0000-4000-8000-000000000001' } },
    { target: { kind: 'place', id: 'osm:node:1', cityId: 'vancouver' } }, { target: { kind: 'place', id: 'osm:node:9', cityId: 'vancouver' } },
    { target: { kind: 'place', id: 'osm:node:3', cityId: 'atlantis' } },
  ];
  assert.deepEqual(savedListPlaces(items, lookup).map(row => row.id), ['osm:node:2', 'osm:node:7', 'osm:node:1']);
  assert.equal(reads, 3, 'each city catalog is read once');
});

test('a one-place list shows that place, says one place and adds no "more" line', () => {
  const card = listShareCard('하나만', [place(1, { photo: photo(1) })], 1, 'ko');
  assert.deepEqual([card.items.length, card.items[0].name, card.badge, card.more, card.empty], [1, 'Place 1', '장소 1곳', null, null]);
  assert.equal(card.credit, '사진: Artist 1 · CC BY-SA 4.0');
  assert.equal(card.message, '하나만\n· Place 1');
});

// Fake image modules: `captures` maps a view to its file path, or to an Error that capture throws.
function fakeModules({ available = true, captures = new Map(), shareError = null } = {}) {
  const calls = { captured: [], shared: [] };
  return { calls, modules: {
    isAvailableAsync: async () => { if (available instanceof Error) throw available; return available; },
    captureRef: async (view, options) => { calls.captured.push([view, options]); const out = captures.get(view); if (!out || out instanceof Error) throw out ?? new Error('no view'); return out; },
    shareAsync: async (url, options) => { calls.shared.push([url, options]); if (shareError) throw shareError; },
  } };
}

test('the image comes out as the 1080×1920 story frame on both platforms', () => {
  assert.equal(SHARE_CARD_PIXELS.width * 16, SHARE_CARD_PIXELS.height * 9);
  assert.deepEqual(shareCardCaptureSize('ios', 3), { width: 360, height: 640 }, 'iOS sizes are points drawn at the screen scale');
  assert.deepEqual(shareCardCaptureSize('ios', 2), { width: 540, height: 960 });
  assert.deepEqual(shareCardCaptureSize('android', 2.625), { width: 1080, height: 1920 }, 'Android sizes are whole pixels');
});

test('the story-size card is shared first as a PNG file', async () => {
  const story = { id: 'story' }, preview = { id: 'preview' };
  const { modules, calls } = fakeModules({ captures: new Map([[story, '/tmp/ReactNative/story.png'], [preview, '/tmp/ReactNative/preview.png']]) });
  assert.equal(await shareCardImage(modules, [story, preview], 'ios', 3), true);
  assert.deepEqual(calls.captured, [[story, { format: 'png', result: 'tmpfile', width: 360, height: 640 }]]);
  assert.deepEqual(calls.shared, [['file:///tmp/ReactNative/story.png', { mimeType: 'image/png', UTI: 'public.png' }]]);
});

test('when the off-screen capture fails or is not mounted, the preview card is captured instead', async () => {
  const story = { id: 'story' }, preview = { id: 'preview' };
  const failed = fakeModules({ captures: new Map([[story, new Error('drawViewHierarchyInRect was not successful')], [preview, 'file:///data/cache/preview.png']]) });
  assert.equal(await shareCardImage(failed.modules, [story, preview], 'android', 2.625), true);
  assert.deepEqual(failed.calls.captured.map(([view]) => view), [story, preview]);
  assert.deepEqual(failed.calls.shared.map(([url]) => url), ['file:///data/cache/preview.png'], 'an Android file URI is not prefixed twice');
  const unmounted = fakeModules({ captures: new Map([[preview, '/tmp/preview.png']]) });
  assert.equal(await shareCardImage(unmounted.modules, [null, preview], 'ios', 2), true);
  assert.deepEqual(unmounted.calls.captured.map(([view]) => view), [preview]);
});

test('no image modules, no file sharing or no capture falls back to the text share', async () => {
  const story = { id: 'story' }, preview = { id: 'preview' };
  assert.equal(await shareCardImage(null, [story, preview], 'ios', 3), false, 'web, or an older binary without the native modules');
  for (const available of [false, new Error('isAvailableAsync failed')]) {
    const { modules, calls } = fakeModules({ available, captures: new Map([[story, '/tmp/story.png']]) });
    assert.equal(await shareCardImage(modules, [story, preview], 'ios', 3), false);
    assert.deepEqual([calls.captured, calls.shared], [[], []], 'nothing is captured when the device cannot share files');
  }
  const broken = fakeModules({ captures: new Map([[story, new Error('RNViewShot is undefined')], [preview, new Error('RNViewShot is undefined')]]) });
  assert.equal(await shareCardImage(broken.modules, [story, preview], 'android', 3), false);
  assert.deepEqual(broken.calls.shared, []);
  assert.equal(await shareCardImage(fakeModules().modules, [null, null], 'ios', 3), false);
});

test('a share sheet that fails after a good capture is reported, not retried as text', async () => {
  const story = { id: 'story' };
  const { modules } = fakeModules({ captures: new Map([[story, '/tmp/story.png']]), shareError: new Error('MissingCurrentViewControllerException') });
  await assert.rejects(shareCardImage(modules, [story], 'ios', 3), /MissingCurrentViewController/);
});

test('the image modules load only where they exist, so an older binary or the web never crashes on import', () => {
  const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const native = read('lib/share-card-image.ts'), web = read('lib/share-card-image.web.ts'), sheet = read('components/share-card.tsx');
  assert.match(native, /if \(!requireOptionalNativeModule\('ExpoSharing'\)\) return null;/);
  assert.ok(native.indexOf("requireOptionalNativeModule('ExpoSharing')") < native.indexOf("require('expo-sharing')"), 'checked before expo-sharing looks up its native module');
  assert.doesNotMatch(native, /^import .*(expo-sharing|react-native-view-shot)/m);
  assert.doesNotMatch(web, /expo-sharing'|react-native-view-shot'|require\(/);
  assert.match(web, /return null;/);
  assert.doesNotMatch(sheet, /from 'expo-sharing'|from 'react-native-view-shot'/);
  assert.equal(sheet.match(/export async function exportShareCard\(/g)?.length, 1);
  assert.match(sheet, /exportShareCard\(card, \[story, view\]\)/, 'story-size card first, then the preview');
  assert.match(sheet, /return result\.action === Share\.sharedAction;/, 'the text share stays as the last fallback');
});

test('iOS can save the card to Photos: the add-only photo permission is in the build config and both languages', () => {
  const json = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
  const english = json('app.json').expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription;
  assert.ok(english);
  assert.equal(json('locales/en.json').ios.NSPhotoLibraryAddUsageDescription, english);
  assert.ok(json('locales/ko.json').ios.NSPhotoLibraryAddUsageDescription);
  assert.equal(json('package.json').dependencies['expo-sharing'], '~58.0.20');
  assert.equal(json('package.json').dependencies['react-native-view-shot'], '6.1.1');
  assert.equal(json('app.json').expo.plugins.includes('expo-sharing'), false, 'the receive-share plugin is not needed to send');
});
