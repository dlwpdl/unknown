import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { DISCOVERY_CATEGORIES, discoveryPlace, mergeCityTop25 } from '../src/lib/discovery.ts';
import * as maps from '../src/lib/post-maps.ts';

const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function DiscoveryCard('), end = source.indexOf('function GlingVisitedBadge(', start);
const jsx = (type, props) => ({ type, props });
const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(nodes)];
function render(item) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source.slice(start, end) + '\nexports.render=DiscoveryCard;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: () => ({ jsx, jsxs: jsx }), useTheme: () => ({}), useLanguage: () => ({ tr: value => value, locale: 'ko-KR' }),
    useContentTranslation: () => ({ display: { title: item.post?.title ?? item.title } }), visibleTranslationSource: () => ({}),
    postPublicAddress: maps.postPublicAddress, getPostImageSource: post => post.imageUris?.[0] ? { uri: post.imageUris[0] } : undefined,
    DISCOVERY_CATEGORIES, hasAdLabel: () => false, located: value => value.latitude !== null && value.longitude !== null,
    eventTime: () => '오늘 18:00', eventPriceLabel: () => 'CA$25', styles: {}, StyleSheet: { absoluteFill: {} }, View: 'View', Pressable: 'Pressable', Image: 'Image', CityPlacePhoto: 'CityPlacePhoto', SymbolView: 'SymbolView', ThemedText: 'Text', PostAdLabel: 'AdLabel', TranslationControl: 'Translation',
  });
  return exports.render({ item, viewerScope: 'test', onOpen() {} });
}
const post = { id: 'one', kind: 'listing', title: '1베드 콘도', body: '공개 매물\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12\n위치: 123 Robson St · West End', imageUris: [] };
const housing = { id: 'post:one', source: 'post', category: 'housing', title: post.title, label: '123 Robson St · West End', latitude: 49.28, longitude: -123.12, price: 2400, post };

test('housing cards lead with the registered price, retain the listing description and show the public address', () => {
  const tree = render(housing), texts = nodes(tree).filter(n => n.type === 'Text').map(n => n.props.children);
  assert.equal(nodes(tree).find(n => n.type === 'Text' && n.props.type === 'smallBold').props.children, 'CA$2,400');
  assert.ok(texts.includes('1베드 콘도'));
  assert.ok(texts.includes('123 Robson St · West End'));
});
test('coordinate-only housing never turns a pin, prose or a private-looking body address into a displayed address', () => {
  const tree = render({ ...housing, label: '공개 위치', price: null, post: { ...post, body: '연락 후 주소: 999 Hidden Rd\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12' } });
  const text = nodes(tree).filter(n => n.type === 'Text').map(n => n.props.children).join(' ');
  assert.ok(text.includes('상세주소 미등록'));
  assert.ok(text.includes('가격 미등록'));
  assert.equal(text.includes('999 Hidden Rd'), false);
  assert.equal(text.includes('49.28'), false);
});
test('used items retain the product name and price, and catalog places use the licensed same-place image', () => {
  const used = render({ ...housing, category: 'used', title: '원목 책상', price: 80, post: { ...post, title: '원목 책상' } });
  const text = nodes(used).filter(n => n.type === 'Text').map(n => n.props.children);
  assert.ok(text.includes('원목 책상')); assert.ok(text.includes('CA$80'));
  const place = render({ source: 'place', category: 'cafe', title: '카페 A', label: '공개 주소', latitude: 49.28, longitude: -123.12, price: null, imageUri: 'https://upload.wikimedia.org/example-licensed-photo.jpg' });
  assert.equal(nodes(place).find(n => n.type === 'Image').props.source.uri, 'https://upload.wikimedia.org/example-licensed-photo.jpg');
});

test('merging the same catalog place into a Top 25 selection preserves its existing licensed image', () => {
  const place = { id: 'osm:node:photo-place', cityId: 'vancouver', name: 'Photo place', category: 'places', address: 'Public address', latitude: 49.28, longitude: -123.12, photo: { uri: 'https://upload.wikimedia.org/example-licensed-photo.jpg' } };
  const item = discoveryPlace(place);
  const pick = { id: place.id, cityId: place.cityId, title: place.name, label: place.address, category: 'place', latitude: place.latitude, longitude: place.longitude, reason: 'Source-checked selection', sourceUrl: 'https://example.org/photo-place', postIds: [] };
  assert.equal(mergeCityTop25([item], place.cityId, [pick])[0].imageUri, place.photo.uri);
});

test('catalog map cards reuse the offline-capable same-place photo while a post keeps its scoped image', () => {
  const place = { id: 'osm:way:58754861', cityId: 'vancouver', name: 'Granville Island', category: 'places', address: '', latitude: 49.27, longitude: -123.13, photo: { uri: 'https://upload.wikimedia.org/verified-place.jpg' } };
  const item = discoveryPlace(place), tree = render(item);
  assert.equal(nodes(tree).find(node => node.type === 'CityPlacePhoto')?.props.place, place);
  const withPost = render({ ...item, post: { ...post, imageUris: ['https://example.org/scoped-post.jpg'] } });
  assert.equal(nodes(withPost).some(node => node.type === 'CityPlacePhoto'), false);
  assert.equal(nodes(withPost).find(node => node.type === 'Image')?.props.source.uri, 'https://example.org/scoped-post.jpg');
});
