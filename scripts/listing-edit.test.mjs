import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';
import { buildCommentListRows } from '../src/lib/comment-list.ts';
import { chillingAvailability } from '../src/lib/chilling.ts';
import * as listingDetails from '../src/lib/listing-details.ts';
import { splitPostPhotoCredits } from '../src/lib/post-photo-credits.ts';
import * as maps from '../src/lib/post-maps.ts';

const source = ts.transpileModule(readFileSync(new URL('../src/components/post-detail.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// 글 수정 of the author's own listing, with hooks that keep state between renders so a field change can be saved.
function editScreen(post, { management } = {}) {
  const store = [], edits = [], alerts = [];
  let cursor = 0;
  const exports = {}, jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: {
      useState: init => { const i = cursor++; if (!(i in store)) store[i] = typeof init === 'function' ? init() : init; return [store[i], next => { store[i] = typeof next === 'function' ? next(store[i]) : next; }]; },
      useRef: current => { const i = cursor++; if (!(i in store)) store[i] = { current }; return store[i]; },
      useCallback: fn => fn, useEffect() {}, useLayoutEffect() {},
    },
    'react-native': { View: 'View', Modal: 'Modal', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'web' }, StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) } },
    'expo-router': { useRouter: () => ({ push() {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'author' }, promptLogin() {} }) },
    '@/hooks/use-chat-identity': { useChatIdentity: () => null }, '@/components/clay': { useClay: () => false, useClayBox: () => false, ClayIcon: () => null, ClayPillFill: () => null, ClayBoxFill: () => null, ClayCoinFill: () => null, ClayControlFill: () => null, ClayPhoto: () => null }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16 }, Depth: {} },
    '@/lib/comment-list': { buildCommentListRows },
    '@/lib/post-photo-credits': { splitPostPhotoCredits },
    '@/lib/post-maps': maps,
    '@/lib/listing-details': listingDetails,
    '@/lib/community-data': { editPost: async (...args) => { edits.push(args); }, isContentRejected: () => false },
    '@/lib/feed-data': { loadPublicPost: async () => post },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver' }] },
    '@/lib/promotions': { PROMOTIONS_PREVIEW_ENABLED: false },
    '@/components/chilling-host-profile': { useMeetupParticipation: () => ({ own: false, participation: null, statusLoading: false, statusError: '', retry() {} }),
      MeetupActionBar: 'MeetupActionBar', MeetupChips: 'MeetupChips', MeetupNotes: 'MeetupNotes' },
    '@/lib/chilling': { chillingAvailability },
    '@/lib/meetup-destination': { splitPlaceMeetupBody: () => null },
    '../../supabase/functions/_shared/ticketmaster': { ticketmasterReference: () => null },
  };
  vm.runInNewContext(source, { exports, setTimeout, require: withLanguageImports(name => imports[name] ?? new Proxy({}, { get: (_target, key) => key })) });
  const render = () => { cursor = 0; const wrapper = exports.PostDetail({ post, onClose() {}, editOnOpen: true, management }); return wrapper.type(wrapper.props); };
  const find = type => nodes(render()).find(node => node.type === type);
  const save = async () => { nodes(render()).find(node => node.props?.analyticsId === 'components_post-detail.pressable.13').props.onPress(); await settle(); await settle(); };
  return { render, find, save, edits, alerts };
}

const lead = '렌트 내놓음 · 1베드 · $2,000/월 · 메트로타운 · 주차';
const rent = {
  id: 'rent', kind: 'listing', cityId: 'vancouver', price: 2000, title: '메트로타운 1베드', body: `${lead}\n\n뷰잉은 연락 주세요.`,
  author: { id: 'author', nickname: '공식' }, tag: { slug: 'housing', kind: 'listing', label: '부동산' }, comments: 0, views: 0,
  listingDetails: { type: 'housing', deal: 'rent_offer', rooms: '1b', area: 'metrotown', includes: ['parking'], lead },
};

test('글 수정은 렌트 카드 칸을 보여 주고, 고친 값을 본문 첫 줄·카드·월세로 함께 저장한다', async () => {
  const screen = editScreen(rent);
  const fields = screen.find('ListingFields');
  assert.equal(fields.props.category, 'housing');
  assert.deepEqual([fields.props.value.rooms, fields.props.value.price, fields.props.value.area, fields.props.value.includes], ['1b', '2000', 'metrotown', ['parking']]);
  assert.equal(screen.find('PostBodyEditor').props.value, '뷰잉은 연락 주세요.', 'the first line is shown as fields, not as text to edit');
  assert.equal(screen.find('PostBodyEditor').props.allowLocation, false, 'the neighborhood places the pin, as in 글쓰기');

  fields.props.onChange({ ...fields.props.value, price: '2,150', moveIn: 'now', includes: ['parking', 'laundry'] });
  assert.equal(screen.find('ListingFields').props.lead, '렌트 내놓음 · 1베드 · $2,150/월 · 바로 입주 · 메트로타운 · 주차, 인스위트 세탁기');
  await screen.save();
  assert.equal(screen.edits.length, 1, screen.alerts.join(' | '));
  const [, postId, patch] = screen.edits[0];
  assert.equal(postId, 'rent');
  assert.equal(patch.price, 2150);
  assert.deepEqual(patch.listingDetails.includes, ['parking', 'laundry']);
  assert.equal(patch.listingDetails.moveIn, 'now');
  assert.equal(patch.body, `${patch.listingDetails.lead}\n\n뷰잉은 연락 주세요.`);
  assert.equal(screen.find('ListingFields'), undefined, 'the edit closes after saving');
});

test('그대로 둔 월세는 보내지 않고, 원래 없던 칸은 막지 않으며, 비운 필수 칸만 막는다', async () => {
  const noRooms = { ...rent, listingDetails: { ...rent.listingDetails, rooms: undefined, lead: '렌트 내놓음 · $2,000/월 · 메트로타운 · 주차' } };
  noRooms.body = `${noRooms.listingDetails.lead}\n\n뷰잉은 연락 주세요.`;
  const kept = editScreen(noRooms);
  await kept.save();
  assert.equal(kept.edits.length, 1, 'a value the source never gave stays optional');
  assert.equal('price' in kept.edits[0][2], false, 'an unchanged price is not sent');

  const cleared = editScreen(rent);
  const fields = cleared.find('ListingFields');
  fields.props.onChange({ ...fields.props.value, price: '' });
  await cleared.save();
  assert.equal(cleared.edits.length, 0);
  assert.equal(cleared.alerts[0][0], '빠진 항목이 있어요');
  assert.deepEqual(cleared.find('ListingFields').props.missing, ['price']);
});

test('구인·중고 글도 같은 칸으로 고친다', async () => {
  const jobLead = '구인 · 홀 서버 · 시급 $18 · 파트타임 · 다운타운';
  const job = { ...rent, id: 'job', price: 18, title: '홀 서버', tag: { slug: 'jobs', kind: 'listing', label: '구인구직' }, body: `${jobLead}\n\n주말 가능하신 분`,
    listingDetails: { type: 'jobs', deal: 'hiring', payUnit: 'hour', pay: 18, jobTypes: ['part'], area: 'downtown', lead: jobLead } };
  const jobs = editScreen(job);
  const jobFields = jobs.find('ListingFields');
  assert.equal(jobFields.props.category, 'jobs');
  jobFields.props.onChange({ ...jobFields.props.value, price: '19', jobTypes: ['part', 'weekend'] });
  await jobs.save();
  assert.equal(jobs.edits[0][2].price, 19);
  assert.deepEqual(jobs.edits[0][2].listingDetails.jobTypes, ['part', 'weekend']);

  const usedLead = '팝니다 · $40 · 거의 새 것 · 조이스';
  const used = { ...rent, id: 'used', price: 40, title: '책상', tag: { slug: 'used', kind: 'listing', label: '중고거래' }, body: usedLead,
    listingDetails: { type: 'used', deal: 'sell', condition: 'like_new', area: 'joyce', lead: usedLead } };
  const goods = editScreen(used);
  const usedFields = goods.find('ListingFields');
  usedFields.props.onChange({ ...usedFields.props.value, free: true });
  await goods.save();
  assert.equal(goods.edits[0][2].price, 0);
  assert.equal(goods.edits[0][2].body, '팝니다 · 무료 나눔 · 거의 새 것 · 조이스');
});

test('작성자가 아닌 비즈니스 관리자는 지금처럼 본문만 고친다', () => {
  const screen = editScreen({ ...rent, author: { id: 'staff', nickname: '직원' } }, { management: { edit: async () => {}, remove: async () => {} } });
  assert.equal(screen.find('ListingFields'), undefined);
  assert.equal(screen.find('PostBodyEditor').props.value, rent.body, 'the first line stays in the text so the card keeps matching it');
});
