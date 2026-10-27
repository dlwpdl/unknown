import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildListingLead, emptyListingDraft, groupListingsByArea, listingFromDraft, listingPin, listingPriceLabel, matchesListingFilters,
  NO_LISTING_FILTERS, parseListingDetails, parseListingView, stripListingLead, withListingLead,
} from '../src/lib/listing-details.ts';
import { coarseListingPin, findNeighborhood, NEIGHBORHOODS } from '../src/lib/neighborhoods.ts';
import { hydratePublicPosts } from '../src/lib/feed-data.ts';
import { googlePinUrl, withPostMap } from '../src/lib/post-maps.ts';

const draft = (category, patch) => ({ ...emptyListingDraft(category), ...patch });

test('부동산 본문 첫 줄은 시안의 미리보기 순서를 따른다', () => {
  const { details, price, missing } = listingFromDraft('housing', draft('housing', {
    rooms: '1b_den', price: '2,150', moveIn: '2026-11-01', area: 'metrotown', includes: ['parking', 'furnished', 'utilities'],
  }), { title: '메트로타운역 1+덴', cityId: 'vancouver' }, 'ko');
  assert.deepEqual(missing, []);
  assert.equal(price, 2150);
  assert.equal(details.lead, '렌트 내놓음 · 1+덴 · $2,150/월 · 11월 1일부터 · 메트로타운 · 가구·유틸 포함, 주차');
  assert.equal(listingPriceLabel({ type: 'housing', deal: 'rent_wanted' }, 1900, 'ko'), '예산 ~$1,900/월');
  assert.equal(listingPriceLabel({ type: 'housing', deal: 'sale' }, 1189000, 'ko'), '$1,189,000');
});

test('구인구직·중고거래 첫 줄과 영어 첫 줄', () => {
  const jobs = listingFromDraft('jobs', draft('jobs', { price: '17.85', jobTypes: ['part', 'weekend'], area: 'downtown', hours: '토·일 11–19시', duties: '주문 받기, 서빙', apply: ['chat'] }),
    { title: '홀 서버 (주말)', cityId: 'vancouver' }, 'ko');
  assert.equal(jobs.details.lead, '구인 · 홀 서버 (주말) · 시급 $17.85 · 파트타임, 주말만 · 다운타운 · 토·일 11–19시\n하는 일: 주문 받기, 서빙\n지원 방법: 글링 대화');
  assert.equal(listingPriceLabel(jobs.details, jobs.price, 'ko'), '$17.85/시간');
  const used = listingFromDraft('used', draft('used', { price: '40', condition: 'like_new', area: 'joyce' }), { title: '책상', cityId: 'vancouver' }, 'ko');
  assert.equal(used.details.lead, '팝니다 · $40 · 거의 새 것 · 조이스');
  const free = listingFromDraft('used', draft('used', { free: true, offers: true, condition: 'used', area: 'joyce' }), { title: '카시트', cityId: 'vancouver' }, 'ko');
  assert.equal(free.price, 0);
  assert.equal(free.details.offers, undefined, 'free giveaways do not take offers');
  assert.equal(listingPriceLabel(free.details, 0, 'ko'), '무료 나눔');
  const english = buildListingLead({ type: 'housing', deal: 'rent_offer', rooms: '1b_den', moveIn: '2026-11-01', area: 'metrotown', includes: ['furnished', 'utilities', 'parking'] },
    { title: '', price: 2150, cityId: 'vancouver' }, 'en');
  assert.equal(english, 'For rent · 1BR + den · $2,150/mo · From Nov 1 · Metrotown · Furnished, Utilities included, Parking');
});

test('필수 칸이 비면 올리지 않는다', () => {
  assert.deepEqual(listingFromDraft('housing', draft('housing', {}), { title: 't', cityId: 'vancouver' }, 'ko').missing, ['rooms', 'price', 'area']);
  assert.deepEqual(listingFromDraft('housing', draft('housing', { deal: 'rent_wanted', rooms: 'studio', area: 'downtown' }), { title: 't', cityId: 'vancouver' }, 'ko').missing, []);
  assert.deepEqual(listingFromDraft('jobs', draft('jobs', { payUnit: 'negotiable', price: '20' }), { title: 't', cityId: 'vancouver' }, 'ko').missing, ['area']);
  assert.deepEqual(listingFromDraft('used', draft('used', { price: 'abc' }), { title: 't', cityId: 'vancouver' }, 'ko').missing, ['price', 'condition', 'area']);
  assert.deepEqual(listingFromDraft('used', draft('used', { deal: 'buy', area: 'joyce' }), { title: 't', cityId: 'vancouver' }, 'ko').missing, []);
  // An area outside the post's city is not accepted.
  assert.ok(listingFromDraft('used', draft('used', { deal: 'buy', area: 'koreatown' }), { title: 't', cityId: 'vancouver' }, 'ko').missing.includes('area'));
});

test('새 앱은 첫 줄을 한 번만 보여 주고, 고친 첫 줄이나 옛 글은 그대로 둔다', () => {
  const { details } = listingFromDraft('used', draft('used', { price: '40', condition: 'new', area: 'joyce' }), { title: '책상', cityId: 'vancouver' }, 'ko');
  const body = withListingLead(details.lead, '이사 가서 내놔요.');
  assert.equal(body, '팝니다 · $40 · 새 것 · 조이스\n\n이사 가서 내놔요.');
  const parsed = parseListingDetails(details, body);
  assert.equal(stripListingLead(body, parsed), '이사 가서 내놔요.');
  assert.equal(stripListingLead(withListingLead(details.lead, ''), parsed), '');
  const edited = `팝니다 · $35 · 새 것\n\n이사 가서 내놔요.`;
  assert.equal(stripListingLead(edited, parseListingDetails(details, edited)), edited);
  assert.equal(stripListingLead('옛 글 본문', undefined), '옛 글 본문');
});

test('서버 칸은 믿지 않고 검사한다', () => {
  const body = '구인 · 서버 · 다운타운 · 주말\n\n더 알려줄 것';
  assert.equal(parseListingDetails(null, body), null);
  assert.equal(parseListingDetails({ type: 'housing', deal: 'steal' }, body), null);
  assert.equal(parseListingDetails({ type: 'cars', deal: 'sell' }, body), null);
  const parsed = parseListingDetails({ type: 'jobs', deal: 'hiring', payUnit: 'hour', area: '../x', hours: '주말', duties: '본문에 없는 말', jobTypes: ['part', 'nope'], extra: 1 }, body);
  assert.deepEqual(parsed, { type: 'jobs', deal: 'hiring', payUnit: 'hour', jobTypes: ['part'], hours: '주말' });
  assert.equal(parseListingDetails({ type: 'housing', deal: 'rent_offer', moveIn: '2026-13-40' }, body).moveIn, undefined);
});

test('지도는 정확한 위치 대신 동네 중심만 쓴다', () => {
  const metrotown = findNeighborhood('vancouver', 'metrotown');
  const exact = { latitude: 49.22713, longitude: -123.00012 };
  const coarse = coarseListingPin('vancouver', exact);
  assert.equal(coarse.neighborhood.id, 'metrotown');
  assert.deepEqual([coarse.latitude, coarse.longitude], [metrotown.latitude, metrotown.longitude]);
  const far = coarseListingPin('vancouver', { latitude: 50.123456, longitude: -122.987654 });
  assert.deepEqual([far.latitude, far.longitude], [50.12, -122.99]);
  // An older post that pinned an exact point is snapped too.
  const oldPost = { cityId: 'vancouver', body: withPostMap('집 내놔요', googlePinUrl(exact), '우리 집'), listingDetails: undefined, price: 2000 };
  const pin = listingPin(oldPost, 'ko');
  assert.notEqual(pin.latitude, exact.latitude);
  assert.equal(pin.name, '메트로타운');
  for (const city of Object.values(NEIGHBORHOODS)) for (const item of city) {
    assert.ok(Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && /^[a-z0-9-]+$/.test(item.id));
    assert.ok(String(item.latitude).split('.')[1].length <= 3, `${item.id} stays coarse`);
  }
  const posts = [
    { cityId: 'vancouver', body: '', price: 2150, listingDetails: { type: 'housing', deal: 'rent_offer', area: 'metrotown' } },
    { cityId: 'vancouver', body: '', price: 1900, listingDetails: { type: 'housing', deal: 'rent_offer', area: 'metrotown' } },
    { cityId: 'vancouver', body: '', price: 2350, listingDetails: { type: 'housing', deal: 'rent_offer', area: 'burquitlam' } },
    { cityId: 'vancouver', body: '위치 없는 글', price: 10, listingDetails: undefined },
  ];
  assert.deepEqual(groupListingsByArea(posts, 'ko').map(({ id, label, posts }) => [id, label, posts.length]), [
    ['area:metrotown', '메트로타운 · 2', 2], ['area:burquitlam', '$2,350/월', 1],
  ]);
});

test('필터는 목록과 지도에 똑같이 걸린다', () => {
  const housing = { price: 2150, listingDetails: { type: 'housing', deal: 'rent_offer', rooms: '1b_den', moveIn: '2026-11-01' } };
  const used = { price: 40, listingDetails: { type: 'used', deal: 'sell', condition: 'like_new' } };
  const legacy = { price: 30, listingDetails: undefined };
  const today = '2026-10-27';
  assert.ok(matchesListingFilters(legacy, NO_LISTING_FILTERS, today));
  assert.ok(matchesListingFilters(housing, { ...NO_LISTING_FILTERS, rooms: ['1b_den', '1b'], maxPrice: 2500, moveInBy: '2026-11-30' }, today));
  assert.ok(!matchesListingFilters(housing, { ...NO_LISTING_FILTERS, maxPrice: 2000 }, today));
  assert.ok(!matchesListingFilters(housing, { ...NO_LISTING_FILTERS, moveInBy: '2026-10-31' }, today));
  assert.ok(matchesListingFilters({ ...housing, listingDetails: { ...housing.listingDetails, moveIn: 'now' } }, { ...NO_LISTING_FILTERS, moveInBy: '2026-10-31' }, today));
  assert.ok(matchesListingFilters(used, { ...NO_LISTING_FILTERS, deal: 'sell', conditions: ['like_new'] }, today));
  assert.ok(!matchesListingFilters(used, { ...NO_LISTING_FILTERS, deal: 'buy' }, today));
  assert.ok(!matchesListingFilters(legacy, { ...NO_LISTING_FILTERS, maxPrice: 100 }, today), 'a post without fields cannot prove it matches');
});

test('중고거래 보기 선택은 목록이 기본이고 그리드만 기억한다', () => {
  assert.equal(parseListingView(null), 'list');
  assert.equal(parseListingView('grid'), 'grid');
  assert.equal(parseListingView('{"x":1}'), 'list');
});

test('칸이 없는 옛 글과 서버 마이그레이션 전에는 지금처럼 보인다', async () => {
  const post = { id: '00000000-0000-4000-8000-000000000001', cityId: 'vancouver', kind: 'listing', tag: { id: 19, slug: 'used', label: '중고거래', kind: 'post' }, body: '팝니다 · $40\n\n본문', title: '책상', imagePaths: [] };
  const story = { ...post, id: '00000000-0000-4000-8000-000000000002', kind: 'story', tag: { id: 1, slug: 'life', label: '라이프', kind: 'post' } };
  const calls = [];
  const before = await hydratePublicPosts({ rpc: async (name, params) => { calls.push([name, params]); return { error: { code: 'PGRST202' } }; } }, [post, story]);
  assert.equal(before[0].listingDetails, undefined);
  assert.deepEqual(calls.find(([name]) => name === 'get_public_post_listing_details')[1], { p_post_ids: [post.id] }, 'only listing categories are asked');
  const after = await hydratePublicPosts({ rpc: async name => name === 'get_public_post_listing_details'
    ? { data: [{ post_id: post.id, details: { type: 'used', deal: 'sell', lead: '팝니다 · $40' } }, { post_id: 'not-mine', details: { type: 'used', deal: 'sell' } }], error: null }
    : { data: [], error: null } }, [post, story]);
  assert.deepEqual(after[0].listingDetails, { type: 'used', deal: 'sell', lead: '팝니다 · $40' });
  assert.equal(after[1].listingDetails, undefined);
  const mismatched = await hydratePublicPosts({ rpc: async name => name === 'get_public_post_listing_details'
    ? { data: [{ post_id: post.id, details: { type: 'housing', deal: 'rent_offer' } }], error: null } : { data: [], error: null } }, [post]);
  assert.equal(mismatched[0].listingDetails, undefined, 'fields from another category are ignored');
  const noListings = [];
  await hydratePublicPosts({ rpc: async name => { noListings.push(name); return { data: [], error: null }; } }, [story]);
  assert.deepEqual(noListings, ['get_public_post_businesses']);
});

test('비즈니스 구인글은 posts.price 없이도 시급을 보여 준다', () => {
  const { details, price, missing } = listingFromDraft('jobs', draft('jobs', { price: '17.85', area: 'metrotown', jobTypes: ['part'] }), { title: '홀 서빙', cityId: 'vancouver' }, 'ko');
  assert.deepEqual(missing, []);
  assert.equal(price, 17.85);
  const body = withListingLead(details.lead, '경험 없어도 괜찮아요.\n\n비즈니스에서 직접 게시한 안내입니다.');
  const parsed = parseListingDetails(JSON.parse(JSON.stringify(details)), body);
  assert.equal(listingPriceLabel(parsed, null, 'ko'), '$17.85/시간');
  assert.equal(parseListingDetails({ ...details, pay: 'free' }, body).pay, undefined);
  assert.equal(stripListingLead(body, parsed), '경험 없어도 괜찮아요.\n\n비즈니스에서 직접 게시한 안내입니다.');
});

// Mirrors private.guard_listing_details: the column holds only allow-listed keys, and its free text must
// already be in the body that the content filter and safety review read.
test('저장하는 칸의 글자는 모두 본문 안에 있다 (서버 트리거와 같은 규칙)', () => {
  const keys = { housing: ['type', 'deal', 'rooms', 'moveIn', 'area', 'includes', 'lead'],
    jobs: ['type', 'deal', 'payUnit', 'pay', 'jobTypes', 'area', 'hours', 'duties', 'apply', 'lead'], used: ['type', 'deal', 'offers', 'condition', 'area', 'lead'] };
  const cases = [
    ['housing', draft('housing', { rooms: '2b2b', price: '3200', moveIn: 'now', area: 'metrotown', includes: ['pets'] }), '방 사진은 대화로 보내 드려요'],
    ['jobs', draft('jobs', { price: '20', jobTypes: ['full'], area: 'downtown', hours: '평일 9–6시\n야간 없음', duties: '  재고 정리,\t계산  ', apply: ['email', 'phone'] }), ''],
    ['jobs', draft('jobs', { deal: 'seeking', payUnit: 'negotiable', hours: '주말', duties: '바리스타 경력 3년' }), '연락 주세요'],
    ['used', draft('used', { price: '15', offers: true, condition: 'used', area: 'joyce' }), '직거래만'],
  ];
  for (const language of ['ko', 'en']) for (const [category, item, written] of cases) {
    const { details } = listingFromDraft(category, item, { title: '제목', cityId: 'vancouver' }, language);
    const body = withPostMap(withListingLead(details.lead, written), details.area ? googlePinUrl(findNeighborhood('vancouver', details.area)) : '', '동네');
    assert.deepEqual(Object.keys(details).filter(key => !keys[category].includes(key)), []);
    assert.ok(body.startsWith(details.lead));
    for (const key of ['hours', 'duties']) if (details[key]) assert.ok(body.includes(details[key]), `${category}.${key}`);
    assert.deepEqual(parseListingDetails(details, body), details);
  }
});
