import assert from 'node:assert/strict';
import test from 'node:test';
import { PLACE_STATUS, PLACE_SUBCATEGORIES, SITUATION_SUBCATEGORIES, discoveryRefines, pinSubcategory, placeHot, placeStatuses, priceLabel } from '../src/lib/discovery.ts';
import { uiEnglish } from '../src/i18n/ui-en.ts';

test('price chip text shows a run as a range and a gap as separate levels', () => {
  assert.equal(priceLabel([]), '');
  assert.equal(priceLabel([2]), '$$');
  assert.equal(priceLabel([2, 1]), '$–$$');
  assert.equal(priceLabel([1, 2, 3, 4]), '$–$$$$');
  assert.equal(priceLabel([3, 1]), '$ · $$$');
  assert.equal(priceLabel([1, 1, 9, 0]), '$', 'unknown and repeated levels are dropped');
});

test('price and sub-filters leave out places without the value instead of assuming a match', () => {
  const item = place => ({ place });
  const cheap = item({ priceLevel: 1, subcategories: ['lunch', 'solo'] }), dear = item({ priceLevel: 4, subcategories: ['date'] }), blank = item({}), event = {};
  const keep = (levels, subs) => [cheap, dear, blank, event].filter(value => discoveryRefines(value, levels, subs));
  assert.deepEqual(keep([], []), [cheap, dear, blank, event]);
  assert.deepEqual(keep([1, 2], []), [cheap]);
  assert.deepEqual(keep([], ['date', 'solo']), [cheap, dear], 'several sub-filters are a union');
  assert.deepEqual(keep([4], ['solo']), []);
});

test('sub-filter ids are unique and belong to the owner-chosen categories', () => {
  assert.equal(new Set(PLACE_SUBCATEGORIES.map(value => value.id)).size, PLACE_SUBCATEGORIES.length);
  assert.deepEqual([...new Set(PLACE_SUBCATEGORIES.map(value => value.filter))], ['dining', 'nightlife', 'cafe', 'places']);
  assert.deepEqual(PLACE_SUBCATEGORIES.filter(value => value.filter === 'dining').map(value => value.label), ['아침', '점심', '저녁', '늦은 밤', '혼밥', '데이트',
    '한식', '일식', '중식', '베트남', '태국', '인도 음식', '이탈리안', '멕시칸', '버거', '피자', '해산물', '비건']);
  assert.deepEqual(PLACE_SUBCATEGORIES.filter(value => value.filter === 'nightlife').map(value => value.label), ['이자카야', '포차', '노래방', '스피크이지', '칵테일 바', '와인 바', '스포츠 바', '재즈', '펍·술집', '클럽', '바', '브루어리', '라이브 음악', '해피아워']);
  assert.deepEqual(PLACE_SUBCATEGORIES.filter(value => value.filter === 'cafe').map(value => value.label), ['아이스크림', '디저트', '브런치', '작업하기 좋은 곳', '베이커리', '버블티', '말차', '로스터리']);
  assert.deepEqual(PLACE_SUBCATEGORIES.filter(value => value.filter === 'places').map(value => value.label), ['공원', '해변', '정원', '전망대', '산책·하이킹', '박물관', '미술관·갤러리', '도서관', '동물원·아쿠아리움', '역사 명소', '시장', '공연장', '영화관', '볼링', '오락실', '방탈출']);
});

test('a pin names the kind of place, never a situation chip like 점심', () => {
  const name = values => pinSubcategory(values)?.label;
  assert.equal(name(['lunch', 'korean']), '한식');
  assert.equal(name(['work_friendly', 'bakery']), '베이커리');
  assert.equal(name(['happy_hour', 'pub', 'sports_bar']), '스포츠 바', 'list order, not the place\'s order, picks the specific one');
  assert.equal(name(['dessert', 'ice_cream']), '아이스크림');
  assert.equal(name(['pub', 'jazz']), '재즈', 'a jazz bar is named for its music, not 펍·술집');
  assert.equal(name(['a-later-value']), undefined, 'an id this app version does not know names nothing');
  assert.equal(name(['a-later-value', 'korean']), '한식');
  assert.equal(name(['breakfast', 'lunch', 'dinner', 'late_night', 'solo', 'date', 'work_friendly', 'happy_hour']), undefined, 'only situations: the pin names its category');
  assert.equal(name(undefined), undefined);
  for (const id of SITUATION_SUBCATEGORIES) assert.ok(PLACE_SUBCATEGORIES.some(option => option.id === id), id);
});

test('every sub-filter label has an English translation', () => {
  for (const { label } of PLACE_SUBCATEGORIES) assert.ok(Object.hasOwn(uiEnglish, label), label);
});

test('place states: 새로 생김 within 90 days of opening, 뜨는 중 from the server or an outside mention within 60 days, 인기 from the server, 친구가 저장 from friends', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const opened = on => ({ opened: { on, sourceUrl: 'https://example.com/open' } }), hot = since => ({ hot: { since, sourceUrl: 'https://example.com/hot', sourceName: 'Fixture Daily' } });
  assert.deepEqual(placeStatuses(undefined, null, false, now), []);
  assert.deepEqual(placeStatuses(opened('2026-11-13'), null, false, now), ['new'], 'opening today is new');
  assert.deepEqual(placeStatuses(opened('2026-08-15'), null, false, now), ['new'], '90 days ago still counts');
  assert.deepEqual(placeStatuses(opened('2026-08-14'), null, false, now), [], 'older is not');
  assert.deepEqual(placeStatuses(opened('2026-11-20'), null, false, now), [], 'a future opening is not new yet');
  assert.deepEqual(placeStatuses(hot('2026-10-01'), null, false, now), ['trending']);
  assert.deepEqual(placeStatuses(hot('2026-09-13'), null, false, now), [], 'an outside mention lapses after 60 days');
  assert.equal(placeHot(hot('2026-09-13'), now), null);
  assert.equal(placeHot(hot('2026-10-01'), now).sourceName, 'Fixture Daily');
  assert.deepEqual(placeStatuses(undefined, 'trending', false, now), ['trending']);
  assert.deepEqual(placeStatuses(undefined, 'popular', true, now), ['popular', 'friends']);
  assert.deepEqual(placeStatuses({ ...opened('2026-11-01'), ...hot('2026-11-01') }, 'popular', true, now), ['new', 'trending', 'popular', 'friends'], 'the pin shows the first; every filter still finds it');
  for (const id of Object.keys(PLACE_STATUS)) {
    assert.match(PLACE_STATUS[id].color, /^#[0-9A-F]{6}$/, 'a plain hex value crosses into the map');
    for (const text of [PLACE_STATUS[id].label, PLACE_STATUS[id].empty]) assert.ok(uiEnglish[text], `English for ${text}`);
  }
  assert.equal(new Set(Object.values(PLACE_STATUS).map(value => value.color)).size, 4, 'each state has its own colour');
});
