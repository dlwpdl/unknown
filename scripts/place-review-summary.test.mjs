import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { tr, setActiveLanguage } from '../src/i18n/index.ts';

const file = new URL('../src/components/place-review-summary.tsx', import.meta.url);
function view(external = [{ score: 4.5, count: 28661 }]) {
  const exports = {}, imports = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', StyleSheet: { create: value => value } },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/merchant-rating-bar': { GlingRatingIcon: 'GlingRatingIcon' },
    '@/hooks/use-language': { useLanguage: () => ({ tr, locale: 'en' }) },
    '@/lib/place-external-ratings': { getPlaceExternalRatings: () => external },
  };
  if (existsSync(file)) vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => imports[name] });
  return exports;
}
const nodes = n => !n || typeof n !== 'object' ? [] : [n, ...Object.values(n).flatMap(v => Array.isArray(v) ? v.flatMap(nodes) : nodes(v))];
const text = n => n?.props ? text(n.props.children) : Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const own = { cityId: 'vancouver', placeId: 'osm:node:703754423', average: 8.8, count: 12 };

test('Gling stays primary even when the external review count is vastly larger', () => {
  const api = view(); assert.equal(typeof api.getPlaceReviewRating, 'function');
  const rating = api.getPlaceReviewRating(own.cityId, own.placeId, own);
  assert.equal(rating.score, 8.8); assert.equal(rating.source, 'gling'); assert.equal(rating.count, 12);
  assert.equal(rating.externalScore, 9, 'external score is separately converted from five to ten');
  setActiveLanguage('ko'); const tree = api.PlaceReviewSummary({ rating, compact: true });
  assert.match(text(tree), /8\.8/); assert.match(text(tree), /12/); assert.doesNotMatch(text(tree), /9\.0/);
  assert.equal(nodes(tree).find(n => n.type === 'GlingRatingIcon').props.score, 8.8);
});

test('external numeric fallback shows the score without claiming Gling ratings or conversion copy', () => {
  const api = view(); const rating = api.getPlaceReviewRating(own.cityId, own.placeId, { ...own, average: null, count: 0 });
  assert.equal(rating.score, 9); assert.equal(rating.source, 'external');
  setActiveLanguage('ko'); assert.match(text(api.PlaceReviewSummary({ rating })), /9\.0.*\/10/);
  assert.doesNotMatch(text(api.PlaceReviewSummary({ rating })), /외부|환산/);
  assert.doesNotMatch(text(api.PlaceReviewSummary({ rating })), /글링.*평가/);
  const unknown = api.getPlaceReviewRating(own.cityId, own.placeId);
  assert.equal(unknown.count, null, 'a missing server response must not invent zero Gling ratings');
});

test('no-score entries invite a first review only when the empty count is known', () => {
  const api = view([]); setActiveLanguage('ko');
  const empty = api.getPlaceReviewRating(own.cityId, own.placeId, { ...own, average: null, count: 0 });
  assert.equal(empty.score, null); assert.match(text(api.PlaceReviewSummary({ rating: empty })), /첫 리뷰/);
  const unknown = api.getPlaceReviewRating(own.cityId, own.placeId);
  assert.doesNotMatch(text(api.PlaceReviewSummary({ rating: unknown })), /첫 리뷰|0\.0/);
});
