import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as admin from '../src/lib/admin.ts';
import * as labels from '../src/lib/admin-labels.ts';
import * as userData from '../src/lib/admin-user-data.ts';
import * as conversations from '../src/lib/admin-conversations.ts';
import { filterReportRows } from '../src/components/admin/admin-report-filter.ts';

function view(width = 390, { file = 'admin-report-queue', name = 'AdminReportQueue', initialState = [], extra = {}, append = '' } = {}) {
  const state = [...initialState]; let index = 0;
  const imports = {
    react: { useEffect() {}, useRef: initial => ({ current: initial }), useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; } },
    'react/jsx-runtime': { Fragment: 'Fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'web' }, View: 'View', Pressable: 'Pressable', Text: 'Text', FlatList: 'FlatList', TextInput: 'TextInput', ScrollView: 'ScrollView', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width }) },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/constants/theme': { Colors: { admin: {} }, Spacing: {} },
    '@/lib/admin': admin, '@/lib/admin-labels': labels, '@/lib/admin-layout': { isCompactAdminWidth: value => value < 720 },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/components/admin/admin-trust-review-content': { isTrustTarget: () => false },
    './admin-report-filter': { filterReportRows },
    '@/lib/admin-user-data': userData, '@/lib/mock': { CITIES: [] }, ...extra,
    './admin-table-controls': Object.fromEntries(['AdminFilterBar', 'AdminFilterReset', 'AdminMultiFilter', 'AdminSearch', 'AdminTableSummary'].map(name => [name, name])),
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../src/components/admin/${file}.tsx`, import.meta.url), 'utf8') + append, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, Date, Intl, document: { getElementById: () => ({ focus() {} }) } });
  return props => { index = 0; return exports[name](props); };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
const find = (tree, type, label) => nodes(tree).find(node => node.type === type && text(node) === label);
const report = { id: 'report-a', reported_user_id: 'member-a', reporter_id: 'member-b', target_type: 'post', target_id: 'post-a', reason_code: 'spam', details: '신고 설명', status: 'open', created_at: '2026-10-14T10:00:00Z', evidence: { body: '접수 당시 내용' } };
const props = { reports: [report], profiles: new Map(), actions: [], resolving: false, onUser() {}, onResolve: async () => [] };

const kit = { '@/components/admin/admin-ui': Object.fromEntries(['AdminButton', 'AdminCard', 'AdminDock', 'AdminFacts', 'AdminInfo', 'AdminMoreMenu', 'AdminPill', 'AdminTrace'].map(name => [name, name])) };
const rowCheck = tree => nodes(tree).find(node => node.type === 'input' && node.props?.['aria-label']?.endsWith('신고 선택'));

test('compact report back closes detail, retaining filter, checked ID and note when reopened', () => {
  const render = view(390, { extra: kit }); let tree = render(props);
  assert.ok(nodes(tree).some(node => node.props?.label === '접수 당시 원본' && node.props.value === '접수 당시 내용'), 'compact case retains captured evidence');
  const input = () => nodes(tree).find(node => node.props?.accessibilityLabel === '신고 처리 메모');
  nodes(tree).find(node => node.type === 'AdminSearch').props.onChange('신고'); tree = render(props);
  input().props.onChangeText('판단 근거 초안'); tree = render(props);
  rowCheck(tree).props.onChange({ target: { checked: true } }); tree = render(props);
  find(tree, 'button', '‹ 목록으로').props.onClick(); tree = render(props);
  assert.equal(nodes(tree).some(node => node.props?.role === 'dialog'), false);
  const row = nodes(tree).find(node => node.type === 'button' && node.props?.['aria-controls'] === 'admin-report-detail');
  assert.equal(nodes(tree).find(node => node.type === 'AdminSearch').props.value, '신고');
  assert.equal(input().props.value, '판단 근거 초안', 'closed detail content remains mounted');
  assert.equal(row.props['aria-pressed'], true, 'closing preserves selection');
  row.props.onClick(); tree = render(props);
  assert.equal(input().props.value, '판단 근거 초안');
  assert.equal(rowCheck(tree).props.checked, true);
});

test('desktop selects first report and preserves all exact case action bindings', async () => {
  const calls = [], render = view(1200, { extra: kit }); let tree = render({ ...props, onResolve: async (...args) => { calls.push(args); return []; } });
  assert.ok(nodes(tree).some(node => node.props?.nativeID === 'admin-report-detail'));
  const dock = nodes(tree).find(node => node.type === 'AdminDock');
  assert.ok(nodes(dock).some(node => node.props?.accessibilityLabel === '신고 처리 메모'), 'memo sits in the decision dock');
  for (const label of ['기각', '경고', '콘텐츠 전체 숨김', '계정 정지']) await nodes(dock).find(node => node.type === 'AdminButton' && (node.props.accessibilityLabel ?? node.props.label) === label).props.onPress();
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [['report-a', 'dismissed'], ['report-a', 'warned'], ['report-a', 'hidden'], ['report-a', 'blocked']]);
});

test('member filter drafts and activity identity survive account and filter disclosures', () => {
  const profile = { id: 'member-a', nickname: '이웃', account_type: 'member', account_status: 'suspended', account_status_note: '제한 사유 확인 필요', verification_level: 2, auth_role: 'member', created_at: '2026-10-14T10:00:00Z' };
  const render = view(1200, { file: 'admin-user-review', name: 'AdminUserReview', initialState: [{ profile, counts: [{ kind: 'post', count: 7 }], identities: [] }] });
  const userProps = { userId: 'member-a', profiles: new Map(), onTrustLevelChange() {} };
  let tree = render(userProps);
  const button = prefix => nodes(tree).find(node => node.type?.name === 'Button' && node.props.label.startsWith(prefix));
  const timelineKey = () => nodes(tree).find(node => node.type?.name === 'ActivityTimeline').props.filters;
  const originalFilters = timelineKey();
  button('상세 조회 조건').props.onPress(); tree = render(userProps);
  nodes(tree).find(node => node.props?.accessibilityLabel === '활동 내용 검색').props.onChangeText('아직 적용하지 않은 검색'); tree = render(userProps);
  button('상세 조회 조건').props.onPress(); tree = render(userProps);
  const retained = nodes(tree).find(node => node.props?.accessibilityLabel === '활동 내용 검색');
  assert.equal(retained.props.value, '아직 적용하지 않은 검색');
  assert.ok(nodes(tree).some(node => node.type === 'View' && node.props?.style?.display === 'none' && nodes(node).includes(retained)), 'closed content stays mounted');
  find(tree, 'Pressable', '계정 관리').props.onPress(); tree = render(userProps);
  find(tree, 'Pressable', '활동 기록').props.onPress(); tree = render(userProps);
  assert.equal(timelineKey(), originalFilters, 'toggles retain applied filters and timeline key');
  assert.equal(nodes(tree).find(node => node.props?.accessibilityLabel === '활동 내용 검색').props.value, '아직 적용하지 않은 검색');
  assert.ok(nodes(tree).some(node => node.props?.value === '제한 사유 확인 필요'));
  assert.ok(text(tree).includes('게시글 7'));
  button('상세 조회 조건').props.onPress(); tree = render(userProps);
  const kinds = nodes(tree).filter(node => node.props?.accessibilityRole === 'radio');
  assert.equal(kinds.length, Object.keys(userData.ACTIVITY_KINDS).length, 'every rare kind remains reachable');
  kinds.find(node => text(node).startsWith('안전 검토')).props.onPress(); tree = render(userProps);
  button('상세 조회 조건').props.onPress(); tree = render(userProps);
  const selectedKind = nodes(tree).find(node => node.props?.accessibilityRole === 'radio' && node.props['aria-checked']);
  assert.ok(text(selectedKind).startsWith('안전 검토'));
  assert.equal(selectedKind.props.tabIndex, 0, 'closing advanced filters retains the selected rare kind in the keyboard group');
});


const room = { id: 'room-exact', title: '산책 대화', kind: 'direct', participants: [{ id: 'member-a', nickname: '이웃', city_id: null }], risk_level: 'critical', status: 'reviewing', signal_count: 1, message_count: 1, pending_analysis: 2, reopened: true };
const panelImports = { '@/lib/admin-conversations': conversations, './admin-conversation-styles': { conversationStyles: {} }, '@/lib/chat-details': { chatImagePaths: message => message.image_paths ?? [] } };

test('reply IDs and photo paths are disclosed while reply markers and photo failures remain visible', () => {
  const render = view(1200, { file: 'admin-conversation-panels', name: 'ConversationThread', extra: panelImports });
  const message = { id: 'message-exact', sender_id: 'member-a', created_at: '2026-10-14T10:00:00Z', body: '사진 확인', reply_to_id: 'reply-exact', image_paths: ['private/original.jpg'], kind: 'image' };
  const tree = render({ detail: { conversation: room, messages: [message], signals: [] }, loading: false, error: '', focusId: null });
  const messageTree = nodes(tree).find(node => node.type === 'FlatList').props.renderItem({ item: message, index: 0 });
  assert.ok(text(messageTree).includes('이전 메시지에 답장'));
  assert.ok(text(messageTree).includes('사진을 표시할 수 없어요.'));
  const disclosure = nodes(messageTree).find(node => node.type === 'details');
  assert.ok(text(disclosure).includes('reply-exact'));
  assert.ok(text(disclosure).includes('private/original.jpg'));
  assert.ok(text(disclosure).includes('message-exact'));
  assert.ok(!nodes(messageTree).filter(node => node.type === 'Text' && !nodes(disclosure).includes(node)).some(node => /reply-exact|private\/original/.test(text(node))));
});

test('review history disclosure retains current draft and urgent/reopened/unanalysed signals', () => {
  const render = view(1200, { file: 'admin-conversation-panels', name: 'ConversationReviewPanel', extra: panelImports });
  const draft = { status: 'reviewing', note: '저장 전 판단 근거' }, changes = [];
  const detail = { conversation: room, signals: [{ id: 'signal', message_id: 'message-exact', source: 'ai', category: '확인 필요', severity: 'critical', excerpt: '보존된 문구', reasons: ['검토 사유'], created_at: '2026-10-14T10:00:00Z' }], review_history: [{ id: 'history', status: 'clear', note: '과거 검토 근거', created_at: '2026-10-13T10:00:00Z', actor_name: '운영자' }] };
  const reviewProps = { detail, draft, saving: false, saveError: '', notice: '', onDraft: change => changes.push(change) };
  let tree = render(reviewProps);
  const history = nodes(tree).find(node => node.type === 'details' && text(node).includes('저장된 검토 이력'));
  history.props.onToggle(); tree = render(reviewProps);
  assert.equal(nodes(tree).find(node => node.props?.testID === 'conversation-review-note').props.value, draft.note);
  assert.equal(changes.length, 0);
  assert.ok(text(tree).includes('새 신호가 생겨 재검토'));
  assert.ok(text(tree).includes('AI 분석 대기 2건'));
  assert.ok(text(tree).includes('긴급'));
  assert.ok(text(tree).includes('최근 저장된 검토'));
  assert.ok(text(history).includes('과거 검토 근거'));
});


test('trust state labels distinguish attendance evidence from private review inclusion', () => {
  for (const [targetType, status, expected] of [['meetup_attendance', 'pending', '참석 증빙 검토 대기'], ['meetup_attendance', 'rejected', '참석 증빙 확인 거절'], ['manner_review', 'needs_review', '운영자 검토 필요'], ['manner_review', 'published', '행동 평가 반영 중']]) {
    const render = view(1200, { file: 'admin-trust-review-content', name: 'Content', append: '\nexports.Content = Content;', initialState: [{ text: '기존 비공개 원문', status, authorId: 'member-a', updatedAt: 'version-exact' }], extra: { '@/hooks/use-theme': { useTheme: () => ({}) } } });
    const tree = render({ targetType, targetId: 'target-exact' });
    assert.ok(text(tree).includes(expected));
    assert.ok(text(tree).includes('원문 조회와 판단은 모두 감사 기록'));
    if (targetType === 'meetup_attendance') assert.ok(text(tree).includes('독립 증거'));
  }
});


test('member activity opens first with fixed keyboard tabs and keeps private account information in its own pane', () => {
  const profile = { id: 'member-a', nickname: '이웃', account_type: 'member', account_status: 'suspended', verification_level: 2, auth_role: 'member', created_at: '2026-10-14T10:00:00Z', email: 'private@example.test' };
  const render = view(390, { file: 'admin-user-review', name: 'AdminUserReview', initialState: [{ profile, counts: [], identities: [] }] });
  const props = { userId: 'member-a', profiles: new Map() };
  let tree = render(props);
  const tabs = nodes(tree).filter(n => n.props?.accessibilityRole === 'tab');
  assert.deepEqual(tabs.map(text), ['활동 기록', '계정 관리', '정보']);
  assert.equal(tabs[0].props['aria-selected'], true);
  assert.equal(tabs[0].props.tabIndex, 0);
  const scroll = nodes(tree).find(n => n.props?.nativeID === 'admin-member-scroll');
  assert.ok(scroll); assert.equal(nodes(scroll).some(n => n.props?.accessibilityRole === 'tab'), false);
  const pane = id => nodes(tree).find(n => n.props?.nativeID === `admin-member-${id}`);
  assert.equal(pane('activity').props.style.display, 'flex');
  assert.equal(pane('info').props.style.display, 'none');
  assert.ok(nodes(pane('info')).some(n => n.props?.value === 'private@example.test'));
  const timeline = nodes(tree).find(n => n.type?.name === 'ActivityTimeline');
  tabs[1].props.onPress(); tree = render(props);
  assert.equal(pane('management').props.style.display, 'flex');
  assert.equal(pane('activity').props.style.display, 'none');
  assert.equal(nodes(tree).find(n => n.type?.name === 'ActivityTimeline').props.filters, timeline.props.filters);
});

test('member timeline folds long text without discarding the original or changing conversation targets', () => {
  const body = '보존할 원문입니다. '.repeat(30);
  const event = { event_key: 'event-a', kind: 'message', title: '대화 메시지', body, occurred_at: '2026-10-14T10:00:00Z', actor_id: 'member-a', context_id: 'room-exact' };
  const render = view(390, { file: 'admin-user-review', name: 'ActivityTimeline', append: '\nexports.ActivityTimeline = ActivityTimeline;', initialState: [{ total: 2, rows: [event, { ...event, event_key: 'empty-event', body: null }], nextCursor: null }, null, false] });
  const opened = [], props = { userId: 'member-a', filters: userData.EMPTY_ACTIVITY_FILTERS, profiles: new Map(), nickname: '이웃', onConversation: id => opened.push(id) };
  let tree = render(props);
  const original = () => nodes(tree).find(n => n.type === 'Text' && text(n) === body);
  assert.equal(original().props.numberOfLines, 2);
  assert.ok(text(tree).includes('추가 내용 없음'));
  nodes(tree).find(n => n.props?.label === '원문 펼치기').props.onPress(); tree = render(props);
  assert.equal(original().props.numberOfLines, undefined);
  nodes(tree).find(n => n.props?.label === '이 대화 앞뒤 내용 보기').props.onPress();
  assert.deepEqual(opened, ['room-exact']);
  nodes(tree).find(n => n.props?.label === '원문 접기').props.onPress(); tree = render(props);
  assert.equal(original().props.numberOfLines, 2); assert.equal(text(original()), body);
});
