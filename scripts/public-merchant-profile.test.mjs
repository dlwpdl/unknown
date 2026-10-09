import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { publicMerchantId } from '../src/lib/public-web.ts';

const merchantId = '11111111-1111-4111-8111-111111111111';
const postId = '22222222-2222-4222-8222-222222222222';
const reviewId = '33333333-3333-4333-8333-333333333333';
const review = { id: reviewId, nickname: '이웃', score: 8.5, body: '전체 인증 이용 후기입니다. 줄바꿈과 마지막 문장까지 보여야 해요.\n마지막 문장.', created_at: '2026-10-08T12:00:00Z', receipt_status: 'verified' };
const page = { merchant_id: merchantId, merchant_name: '동네 가게', rating_average: 8.3, review_count: 4, reviews: [review], has_more: false };
const profile = { id: merchantId, name: '동네 가게', city_id: 'vancouver', city_name: '밴쿠버', industry: '카페', services: '등록된 업체 소개\n편하게 들러 주세요.', address: '123 Main St', review_post_id: postId, avatarUri: 'signed-avatar', bannerUri: 'signed-banner', imageLoadFailed: false };
const companyPost = { id: postId, title: '이번 주 동네 소식', body: '공개 게시글 본문 미리보기', tag: { slug: 'business', label: '업체' }, createdAtLabel: '1시간 전', imageThumbs: ['signed-thumb'], imageUris: ['signed-original'] };
const companyJob = { ...companyPost, id: '44444444-4444-4444-8444-444444444444', title: '함께 일할 동료를 찾아요', tag: { slug: 'jobs', label: '구인구직' }, listingStatus: 'active' };
const postPage = { merchant_id: merchantId, kind: 'posts', post_count: 7, job_count: 2, posts: [companyPost], has_more: false, nextOffset: 1 };
const settle = () => new Promise(setImmediate);

function app(file = '../src/components/public-web/merchant-profile.tsx', { rpc = async () => ({ data: page }), loadProfile = async () => profile, loadPosts = async () => postPage, path = '/company', query = { id: merchantId } } = {}) {
  assert.ok(existsSync(new URL(file, import.meta.url)), 'Public merchant profile has not been implemented.');
  const state = [], cleanup = new Map(), feedback = [], calls = [], postCalls = [];
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanup.get(slot)?.(); state[slot] = deps; const end = fn(); if (end) cleanup.set(slot, end); } },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'expo-router/head': { __esModule: true, default: 'Head' }, 'expo-router': { useLocalSearchParams: () => query, usePathname: () => path },
    'expo-asset': { Asset: { fromModule: () => ({ uri: 'local-logo' }) } },
    '@/lib/interaction-feedback': { InteractionFeedbackProvider: 'FeedbackProvider', useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/public-web-client': { publicWebClient: { rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return rpc(name, args); } } },
    '@/lib/merchant-profile': { loadMerchantProfile: loadProfile, loadMerchantProfilePosts: (...args) => { postCalls.push(args.slice(1)); return loadPosts(...args); } }, '@/lib/public-web': { publicMerchantId, publicWebTarget: () => 'gling://' },
    '@/constants/theme': { WebNightColors: {} }, '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }], TAGS: [] },
    '@/lib/public-seo': { PUBLIC_SITE: 'https://gling.example' }, '@/i18n/ko': { t: {} },
    './analytics': { useReaderAnalytics() {} }, './merchant-profile': { PublicMerchantProfile: 'CompanyProfile', PublicMerchantProfileLink: 'CompanyLink' },
  };
  const exports = {}, source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8') + (file.endsWith('/merchant-profile.tsx') ? '\nexports.ProfilePage=ProfilePage;exports.PublicReviews=PublicReviews;exports.ProfileRatings=typeof ProfileRatings===\"function\"?ProfileRatings:null;exports.RatingVisual=typeof RatingVisual===\"function\"?RatingVisual:null;exports.PublicProfilePosts=typeof PublicProfilePosts===\"function\"?PublicProfilePosts:null;' : ''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, Date, Intl, URLSearchParams, window: { location: { pathname: path } } });
  return { exports, feedback, calls, postCalls, render(name, props = {}) { index = 0; return exports[name](props); }, unmount() { cleanup.forEach(fn => fn()); cleanup.clear(); } };
}
const nodes = root => Array.isArray(root) ? root.flatMap(nodes) : !root || typeof root !== 'object' || !root.props ? [] : [root, ...nodes(root.props.children)];
const text = root => nodes(root).flatMap(node => [node.props?.children].flat().filter(value => typeof value === 'string' || typeof value === 'number')).join(' ');
const button = (root, label) => nodes(root).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node).replace(/[ \t]+/g, ' ').includes(label)));
const tabs = root => nodes(root).filter(node => node.props.role === 'tab');
const component = (root, name) => nodes(root).find(node => typeof node.type === 'function' && node.type.name === name);

test('public review reads copy only verified public fields, preserve real aggregates and advance past filtered rows', async () => {
  const view = app(), calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return { data: { ...page, my_review: { body: 'PRIVATE_SELF' }, reviews: [
    { ...review, author_id: 'PRIVATE_AUTHOR', receipt_path: 'PRIVATE_IMAGE' }, { ...review, id: 'other', receipt_status: 'pending', body: 'PRIVATE_PENDING' },
  ], has_more: true } }; } };
  const result = await view.exports.loadPublicMerchantReviews(client, postId, 4);
  assert.deepEqual(calls, [['get_merchant_reviews', { p_post_id: postId, p_offset: 4 }]]);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.ratingAverage, 8.3); assert.equal(result.reviewCount, 4);
  assert.equal(result.nextOffset, 6);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  await assert.rejects(view.exports.loadPublicMerchantReviews({ rpc: async () => ({ error: new Error('DENIED') }) }, postId), /DENIED/);
});

test('post links use the server-returned company even when there is no external source URL', async () => {
  const view = app(); view.render('PublicMerchantProfileLink', { postId }); await settle();
  const root = view.render('PublicMerchantProfileLink', { postId });
  const link = nodes(root).find(node => node.type === 'a');
  assert.equal(link.props.href, `/company?id=${merchantId}`);
  const rating = nodes(root).find(node => typeof node.type === 'function' && node.props.page);
  const summary = text(rating.type(rating.props));
  assert.ok(text(root).includes('동네 가게') && summary.includes('8.3') && summary.includes('4'));
  link.props.onClick(); assert.ok(view.feedback.includes('selection'));
});

test('company tabs keep registered profile fields, separate signed banner/logo and a readonly review source', async () => {
  const view = app(); view.render('ProfilePage', { merchantId }); await settle();
  let root = view.render('ProfilePage', { merchantId });
  const images = nodes(root).filter(node => node.type === 'img');
  assert.deepEqual(images.map(node => node.props.src), ['signed-banner', 'signed-avatar']);
  button(root, '소개').props.onClick(); root = view.render('ProfilePage', { merchantId });
  assert.ok(text(root).includes('등록된 업체 소개') && text(root).includes('123 Main St'));
  button(root, '리뷰').props.onClick(); root = view.render('ProfilePage', { merchantId });
  assert.ok(nodes(root).some(node => typeof node.type === 'function' && node.type.name === 'PublicReviews' && node.props.postId === postId));
  assert.ok(!nodes(root).some(node => ['input', 'textarea', 'form'].includes(node.type)));
});

test('profile image failures keep the registered text and a failed retry does not remove the loaded profile', async () => {
  let attempts = 0;
  const view = app(undefined, { loadProfile: async () => {
    if (++attempts > 1) throw new Error('PHOTO_READ_FAILED');
    return { ...profile, avatarUri: null, bannerUri: null, imageLoadFailed: true };
  } });
  view.render('ProfilePage', { merchantId }); await settle();
  let root = view.render('ProfilePage', { merchantId });
  button(root, '소개').props.onClick(); root = view.render('ProfilePage', { merchantId });
  assert.ok(text(root).includes(profile.services));
  assert.ok(!nodes(root).some(node => node.type === 'img'));
  button(root, '사진 다시 불러오기').props.onClick();
  view.render('ProfilePage', { merchantId }); await settle();
  root = view.render('ProfilePage', { merchantId });
  assert.ok(text(root).includes(profile.services) && text(root).includes(profile.address));
  assert.ok(nodes(root).some(node => node.props?.role === 'alert'));
  assert.ok(view.feedback.includes('selection'));
});

test('public review cards expand the whole text and score-only reviews without private images or write controls', async () => {
  const view = app(undefined, { rpc: async () => ({ data: { ...page, reviews: [review, { ...review, id: 'score-only', body: null }] } }) });
  const props = { merchantId, postId };
  view.render('PublicReviews', props); await settle();
  let root = view.render('PublicReviews', props);
  assert.ok(text(root).includes('상품·서비스 이용 리뷰'));
  const expand = nodes(root).find(node => node.type === 'button' && node.props['aria-expanded'] === false);
  expand.props.onClick(); root = view.render('PublicReviews', props);
  assert.ok(nodes(root).some(node => node.type === 'p' && node.props.children === review.body && !node.props.hidden));
  assert.ok(text(root).includes('점수만 남긴'));
  assert.ok(!nodes(root).some(node => ['img', 'input', 'textarea', 'form'].includes(node.type)));
});

test('late public review reads are ignored after the company component unmounts', async () => {
  let resolve;
  const view = app(undefined, { rpc: () => new Promise(done => { resolve = done; }) });
  const props = { merchantId, postId };
  view.render('PublicReviews', props); view.unmount(); resolve({ data: page }); await settle();
  assert.ok(!text(view.render('PublicReviews', props)).includes(review.body));
});

test('a late response for a previous post cannot restore its company link', async () => {
  const resolves = [];
  const view = app(undefined, { rpc: () => new Promise(done => resolves.push(done)) });
  view.render('PublicMerchantProfileLink', { postId });
  const nextPostId = '44444444-4444-4444-8444-444444444444';
  view.render('PublicMerchantProfileLink', { postId: nextPostId });
  resolves[0]({ data: page }); await settle();
  assert.equal(view.render('PublicMerchantProfileLink', { postId: nextPostId }), null);
  resolves[1]({ data: page }); await settle();
  assert.equal(nodes(view.render('PublicMerchantProfileLink', { postId: nextPostId })).find(node => node.type === 'a').props.href, `/company?id=${merchantId}`);
});

test('a mismatched company review response stays hidden and a failed read can retry', async () => {
  let attempts = 0;
  const view = app(undefined, { rpc: async () => ({ data: ++attempts === 1 ? { ...page, merchant_id: '44444444-4444-4444-8444-444444444444' } : page }) });
  const props = { merchantId, postId };
  view.render('PublicReviews', props); await settle();
  let root = view.render('PublicReviews', props);
  assert.ok(!text(root).includes(review.body));
  button(root, '다시 시도').props.onClick();
  view.render('PublicReviews', props); await settle();
  root = view.render('PublicReviews', props);
  assert.ok(text(root).includes(review.body));
  assert.ok(view.feedback.includes('selection'));
});

test('public company query and pretty-path routing render a profile instead of loading a feed', () => {
  for (const path of ['/company', `/company/${merchantId}`]) {
    const view = app('../src/components/public-web/reader.tsx', { path });
    const root = view.render('default');
    assert.ok(nodes(root).some(node => node.type === 'CompanyProfile' && node.props.merchantId === merchantId), path);
    assert.equal(view.calls.length, 0);
  }
});

const workReview = { ...review, id: '55555555-5555-4555-8555-555555555555', review_kind: 'employment', body: '전체 인증 근무 후기입니다.' };
const workPage = { ...page, review_kind: 'employment', rating_average: 7.25, review_count: 3, reviews: [workReview] };

test('employment reads use all three RPC arguments and copy only verified employment rows', async () => {
  const view = app(), calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return { data: {
    ...workPage, my_review: { body: 'PRIVATE_SELF' }, reviews: [
      { ...workReview, proof_path: 'PRIVATE_PROOF', author_id: 'PRIVATE_AUTHOR' },
      { ...workReview, receipt_status: 'pending', body: 'PRIVATE_UNVERIFIED_WORK' },
      { ...review, review_kind: 'usage', body: 'WRONG_USAGE_DOMAIN' },
      { ...workReview, review_kind: undefined, body: 'MISSING_WORK_DOMAIN' },
    ], has_more: true,
  } }; } };
  const result = await view.exports.loadPublicMerchantReviews(client, postId, 4, 'employment');
  assert.deepEqual(calls, [['get_merchant_reviews', { p_post_id: postId, p_offset: 4, p_review_kind: 'employment' }]]);
  assert.equal(result.reviewKind, 'employment');
  assert.equal(result.ratingAverage, 7.25); assert.equal(result.reviewCount, 3);
  assert.equal(result.reviews.length, 1); assert.equal(result.nextOffset, 8);
  assert.equal(result.reviews[0].body, workReview.body);
  assert.ok(!/PRIVATE_|WRONG_|MISSING_/.test(JSON.stringify(result)));
});

test('review aggregates reject a different domain while legacy usage keeps the old RPC call', async () => {
  const view = app(), calls = [];
  await assert.rejects(view.exports.loadPublicMerchantReviews({ rpc: async () => ({ data: workPage }) }, postId), /MERCHANT_REVIEWS_READ_FAILED/);
  await assert.rejects(view.exports.loadPublicMerchantReviews({ rpc: async () => ({ data: page }) }, postId, 0, 'employment'), /MERCHANT_REVIEWS_READ_FAILED/);
  const result = await view.exports.loadPublicMerchantReviews({ rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return { data: { ...page, reviews: [review, workReview] } }; } }, postId);
  assert.deepEqual(calls, [['get_merchant_reviews', { p_post_id: postId, p_offset: 0 }]]);
  assert.equal(result.reviewKind, 'usage'); assert.equal(result.reviews.length, 1);
});

test('profile metrics retain independent real aggregates and select the corresponding review list', async () => {
  const selected = [];
  const view = app(undefined, { rpc: async (_name, args) => ({ data: args.p_review_kind === 'employment' ? workPage : page }) });
  const props = { merchantId, postId, selectedKind: 'usage', onSelect: kind => selected.push(kind) };
  view.render('ProfileRatings', props); await settle();
  const root = view.render('ProfileRatings', props);
  const metrics = nodes(root).filter(node => node.type === 'button' && node.props['data-review-kind']);
  assert.equal(metrics.length, 2);
  for (const metric of metrics) {
    const rating = nodes(metric).find(node => typeof node.type === 'function' && node.props.page);
    const rendered = rating.type(rating.props), kind = metric.props['data-review-kind'];
    assert.ok(text(rendered).includes(kind === 'usage' ? '8.3' : '7.3'));
    assert.ok(metric.props['aria-label'].includes(`인증 후기 ${kind === 'usage' ? '4' : '3'}개`));
  }
  metrics.find(node => node.props['data-review-kind'] === 'employment').props.onClick();
  assert.deepEqual(selected, ['employment']); assert.ok(view.feedback.includes('selection'));
  const profileView = app(); profileView.render('ProfilePage', { merchantId }); await settle();
  let profileRoot = profileView.render('ProfilePage', { merchantId });
  nodes(profileRoot).find(node => typeof node.type === 'function' && node.type.name === 'ProfileRatings').props.onSelect('employment');
  profileRoot = profileView.render('ProfilePage', { merchantId });
  assert.ok(nodes(profileRoot).some(node => typeof node.type === 'function' && node.type.name === 'PublicReviews' && node.props.kind === 'employment'));
});

test('a failed employment metric keeps the independent usage statistic', async () => {
  const view = app(undefined, { rpc: async (_name, args) => args.p_review_kind ? { error: new Error('EMPLOYMENT_READ_FAILED') } : { data: page } });
  const props = { merchantId, postId, selectedKind: 'usage', onSelect() {} };
  view.render('ProfileRatings', props); await settle();
  const root = view.render('ProfileRatings', props);
  const metrics = nodes(root).filter(node => node.type === 'button' && node.props['data-review-kind']);
  const usage = metrics.find(node => node.props['data-review-kind'] === 'usage');
  const rating = nodes(usage).find(node => typeof node.type === 'function' && node.props.page);
  assert.ok(text(rating.type(rating.props)).includes('8.3'));
  assert.ok(metrics.find(node => node.props['data-review-kind'] === 'employment').props['aria-label'].includes('조회 실패'));
});

test('usage sparkles and the continuous employment bar use the same once-rounded average as the number', async () => {
  const view = app(); view.render('PublicMerchantProfileLink', { postId }); await settle();
  const root = view.render('PublicMerchantProfileLink', { postId });
  const rating = nodes(root).find(node => typeof node.type === 'function' && node.props.page);
  const rendered = rating.type({ ...rating.props, page: { ...page, ratingAverage: 8.25, reviewCount: 4 } });
  assert.ok(text(rendered).includes('8.3'));
  const visual = nodes(rendered).find(node => typeof node.type === 'function' && node.type.name === 'RatingVisual');
  assert.equal(visual.props.scoreTenths, 83);
  for (const kind of ['usage', 'employment']) {
    const units = nodes(view.exports.RatingVisual({ kind, scoreTenths: 83 })).filter(node => node.props?.['data-portion'] != null);
    assert.equal(units.length, 10); assert.equal(units[8].props['data-portion'], 30);
    assert.equal(units[9].props['data-portion'], 0);
    assert.ok(nodes(view.exports.RatingVisual({ kind, scoreTenths: 83 })).some(node => kind === 'usage' ? node.type === 'path' && node.props.d?.includes('19 11') : node.props?.className === 'reader-company-rating-segment'));
  }
});

test('employment pagination keeps kind and offset and a late previous-kind response cannot enter the list', async () => {
  const calls = [];
  const view = app(undefined, { rpc: async (_name, args) => { calls.push(args); return { data: {
    ...workPage, reviews: args.p_offset ? [{ ...workReview, id: 'older-work' }] : [workReview], has_more: !args.p_offset,
  } }; } });
  const props = { merchantId, postId, kind: 'employment' };
  view.render('PublicReviews', props); await settle();
  let root = view.render('PublicReviews', props);
  button(root, '인증 근무 리뷰 더 보기').props.onClick(); await settle();
  root = view.render('PublicReviews', props);
  assert.equal(calls[1].p_review_kind, 'employment'); assert.equal(calls[1].p_offset, 1);
  assert.equal(nodes(root).filter(node => node.props?.className === 'reader-company-review').length, 2);
  assert.ok(text(root).includes('근무 인증') && !text(root).includes('영수증 인증'));
  let resolveUsage;
  const stale = app(undefined, { rpc: (_name, args) => args.p_review_kind ? Promise.resolve({ data: workPage }) : new Promise(done => { resolveUsage = done; }) });
  stale.render('PublicReviews', { merchantId, postId });
  stale.render('PublicReviews', props); await settle();
  resolveUsage({ data: page }); await settle();
  const switched = stale.render('PublicReviews', props);
  assert.ok(text(switched).includes(workReview.body)); assert.ok(!text(switched).includes(review.body));
});

test('an unfinished usage page cannot block employment pagination or merge into its list', async () => {
  let finishUsage;
  const calls = [];
  const view = app(undefined, { rpc: (_name, args) => {
    calls.push(args);
    if (!args.p_review_kind && args.p_offset) return new Promise(done => { finishUsage = done; });
    return Promise.resolve({ data: args.p_review_kind ? { ...workPage, reviews: args.p_offset ? [{ ...workReview, id: 'older-work' }] : [workReview], has_more: !args.p_offset } : { ...page, has_more: true } });
  } });
  const usage = { merchantId, postId }, employment = { merchantId, postId, kind: 'employment' };
  view.render('PublicReviews', usage); await settle();
  button(view.render('PublicReviews', usage), '인증 이용 리뷰 더 보기').props.onClick();
  view.render('PublicReviews', employment); await settle();
  button(view.render('PublicReviews', employment), '인증 근무 리뷰 더 보기').props.onClick(); await settle();
  assert.ok(calls.some(args => args.p_review_kind === 'employment' && args.p_offset === 1));
  finishUsage({ data: { ...page, reviews: [{ ...review, body: 'WRONG_LATE_USAGE_BODY' }], has_more: false } }); await settle();
  const root = view.render('PublicReviews', employment);
  assert.equal(nodes(root).filter(node => node.props.className === 'reader-company-review').length, 2);
  assert.ok(!text(root).includes('WRONG_LATE_USAGE_BODY'));
});

test('approved four tabs start with posts and show only confirmed counts; hiring opens jobs', async () => {
  const view = app(); view.render('ProfilePage', { merchantId }); await settle();
  let root = view.render('ProfilePage', { merchantId });
  assert.deepEqual(tabs(root).map(node => text(node)), ['게시글', '채용', '리뷰', '소개']);
  assert.equal(tabs(root).find(node => node.props['aria-selected']).props['data-tab'], 'posts');
  assert.ok(component(root, 'PublicProfilePosts') && !component(root, 'PublicReviews'));
  assert.ok(!text(root).includes(profile.address));
  component(root, 'PublicProfilePosts').props.onRead({ merchantId, postCount: 7, jobCount: 2 });
  root = view.render('ProfilePage', { merchantId });
  assert.deepEqual(tabs(root).map(node => text(node)), ['게시글 7', '채용 2', '리뷰', '소개']);
  assert.ok(text(button(root, '채용 중')).includes('2건') && text(button(root, '채용 중')).includes('›'));
  button(root, '채용 중').props.onClick(); root = view.render('ProfilePage', { merchantId });
  assert.equal(tabs(root).find(node => node.props['aria-selected']).props['data-tab'], 'jobs');
  assert.equal(component(root, 'PublicProfilePosts').props.kind, 'jobs');
  assert.ok(view.feedback.includes('selection'));
});

test('confirmed review tab count sums both kinds and disappears when either read fails', async () => {
  const view = app(); view.render('ProfilePage', { merchantId }); await settle();
  let root = view.render('ProfilePage', { merchantId });
  component(root, 'ProfileRatings').props.onRead({ key: `${merchantId}:${postId}`, usage: 4, employment: 3 });
  root = view.render('ProfilePage', { merchantId });
  assert.equal(text(tabs(root).find(node => node.props['data-tab'] === 'reviews')), '리뷰 7');
  component(root, 'ProfileRatings').props.onSelect('employment'); root = view.render('ProfilePage', { merchantId });
  assert.equal(tabs(root).find(node => node.props['aria-selected']).props['data-tab'], 'reviews');
  assert.equal(component(root, 'PublicReviews').props.kind, 'employment');
  button(root, '이용').props.onClick(); root = view.render('ProfilePage', { merchantId });
  assert.equal(component(root, 'PublicReviews').props.kind, 'usage');
  component(root, 'ProfileRatings').props.onRead({ key: `${merchantId}:${postId}`, usage: 4, employment: null });
  root = view.render('ProfilePage', { merchantId });
  assert.equal(text(tabs(root).find(node => node.props['data-tab'] === 'reviews')), '리뷰');
  const reads = [], metrics = app(undefined, { rpc: async (_name, args) => args.p_review_kind ? { error: new Error('WORK_FAILED') } : { data: page } });
  const props = { merchantId, postId, selectedKind: null, onSelect() {}, onRead: counts => reads.push(counts) };
  metrics.render('ProfileRatings', props); await settle();
  assert.equal(reads[0].usage, 4); assert.equal(reads[0].employment, null);
});

test('profile tabs support roving Arrow/Home/End focus and about shows only registered fields', async () => {
  const view = app(); view.render('ProfilePage', { merchantId }); await settle();
  let root = view.render('ProfilePage', { merchantId });
  const focused = [];
  for (const [key, expected] of [['ArrowRight', 'jobs'], ['End', 'about'], ['Home', 'posts'], ['ArrowLeft', 'about']]) {
    let prevented = false;
    tabs(root).find(node => node.props['aria-selected']).props.onKeyDown({ key, preventDefault() { prevented = true; }, currentTarget: { parentElement: { querySelector(selector) { return { focus() { focused.push(selector); } }; } } } });
    root = view.render('ProfilePage', { merchantId });
    assert.ok(prevented); assert.equal(tabs(root).find(node => node.props['aria-selected']).props['data-tab'], expected);
    assert.equal(tabs(root).filter(node => node.props.tabIndex === 0).length, 1);
    assert.ok(focused.at(-1).includes(expected));
  }
  assert.ok(text(root).includes(profile.services) && text(root).includes(profile.address) && text(root).includes(profile.city_name) && text(root).includes(profile.industry));
  assert.ok(!/운영시간|웹사이트|로그인/.test(text(root)));
});

test('public company post rows reuse the shared scoped loader, real post links and signed thumbnails', async () => {
  const counts = [], view = app();
  const props = { merchantId, kind: 'posts', onRead: result => counts.push(result) };
  view.render('PublicProfilePosts', props); await settle();
  const root = view.render('PublicProfilePosts', props);
  assert.deepEqual(view.postCalls, [[merchantId, 'posts', 0, 'public']]);
  const link = nodes(root).find(node => node.type === 'a');
  assert.equal(link.props.href, `/post?id=${postId}`);
  assert.equal(nodes(root).find(node => node.type === 'img').props.src, 'signed-thumb');
  assert.ok(text(root).includes(companyPost.title) && text(root).includes(companyPost.body) && text(root).includes(companyPost.createdAtLabel));
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), [{ merchantId, postCount: 7, jobCount: 2 }]);
  link.props.onClick(); assert.ok(view.feedback.includes('selection'));
  assert.ok(!nodes(root).some(node => ['dialog', 'input', 'textarea', 'form'].includes(node.type)));
});

test('company job paging retains its kind/raw offset, blocks duplicate requests and merges unique posts', async () => {
  let finishMore;
  const view = app(undefined, { loadPosts: async (_client, id, kind, offset) => offset ? new Promise(done => { finishMore = done; }) : { ...postPage, merchant_id: id, kind, posts: [companyJob], has_more: true, nextOffset: 4 } });
  const props = { merchantId, kind: 'jobs' };
  view.render('PublicProfilePosts', props); await settle();
  const more = button(view.render('PublicProfilePosts', props), '채용 더 보기');
  more.props.onClick(); more.props.onClick();
  assert.equal(view.postCalls.length, 2); assert.deepEqual(view.postCalls[1], [merchantId, 'jobs', 4, 'public']);
  const older = { ...companyJob, id: '55555555-5555-4555-8555-555555555555', title: '이전 채용' };
  finishMore({ ...postPage, kind: 'jobs', posts: [companyJob, older], nextOffset: 6 }); await settle();
  const root = view.render('PublicProfilePosts', props);
  assert.equal(nodes(root).filter(node => node.type === 'a').length, 2);
  assert.ok(text(root).includes(older.title)); assert.ok(view.feedback.includes('success'));
});

test('a failed company page read preserves current rows and retries the failed offset', async () => {
  let finishRetry, attempts = 0;
  const view = app(undefined, { loadPosts: async (_client, _id, _kind, offset) => {
    if (!offset) return { ...postPage, has_more: true };
    if (++attempts === 1) throw new Error('READ_FAILED');
    return new Promise(done => { finishRetry = done; });
  } });
  const props = { merchantId, kind: 'posts' };
  view.render('PublicProfilePosts', props); await settle();
  button(view.render('PublicProfilePosts', props), '게시글 더 보기').props.onClick(); await settle();
  let root = view.render('PublicProfilePosts', props);
  assert.ok(text(root).includes(companyPost.title) && nodes(root).some(node => node.props.role === 'alert'));
  button(root, '다시 시도').props.onClick(); root = view.render('PublicProfilePosts', props);
  assert.ok(text(root).includes(companyPost.title)); assert.equal(view.postCalls.at(-1)[2], 1);
  finishRetry({ ...postPage, posts: [{ ...companyPost, id: '66666666-6666-4666-8666-666666666666' }], nextOffset: 2 }); await settle();
  root = view.render('PublicProfilePosts', props);
  assert.equal(nodes(root).filter(node => node.type === 'a').length, 2);
  assert.ok(!nodes(root).some(node => node.props.role === 'alert'));
});

test('late company/tab reads cannot restore old rows and inaccessible is distinct from confirmed zero jobs', async () => {
  let finishOld;
  const other = '77777777-7777-4777-8777-777777777777';
  const view = app(undefined, { loadPosts: (_client, id, kind) => id === merchantId ? new Promise(done => { finishOld = done; }) : Promise.resolve({ ...postPage, merchant_id: id, kind, posts: [companyJob] }) });
  view.render('PublicProfilePosts', { merchantId, kind: 'posts' });
  const props = { merchantId: other, kind: 'jobs' };
  view.render('PublicProfilePosts', props); await settle();
  finishOld(postPage); await settle();
  const root = view.render('PublicProfilePosts', props);
  assert.ok(text(root).includes(companyJob.title) && !text(root).includes(companyPost.title));
  const unavailable = app(undefined, { loadPosts: async () => null });
  unavailable.render('PublicProfilePosts', props); await settle();
  assert.ok(text(unavailable.render('PublicProfilePosts', props)).includes('현재 공개된 업체 글을 확인할 수 없어요'));
  assert.ok(!text(unavailable.render('PublicProfilePosts', props)).includes('채용이 없어요'));
  let returned = false;
  const empty = app(undefined, { loadPosts: async () => ({ ...postPage, merchant_id: other, kind: 'jobs', posts: [], job_count: 0 }) });
  const emptyProps = { ...props, onPosts: () => { returned = true; } };
  empty.render('PublicProfilePosts', emptyProps); await settle();
  const emptyRoot = empty.render('PublicProfilePosts', emptyProps);
  assert.ok(text(emptyRoot).includes('채용이 없어요'));
  button(emptyRoot, '게시글 보기').props.onClick(); assert.ok(returned && empty.feedback.includes('selection'));
});
