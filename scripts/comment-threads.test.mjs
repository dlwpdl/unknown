import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { createThreadComment, loadCommentThreadContext, loadCommentThreadPage } from '../src/lib/comment-threads.ts';
import { t } from '../src/i18n/ko.ts';

test('댓글과 답글은 별도 최신순 커서로 읽고 전체 댓글 수에 의존하지 않는다', async () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({
    id: `reply-${31 - index}`, post_id: 'post', author_id: 'author', body: '답글',
    like_count: 2, liked_by_me: true, created_at: '2026-09-12T12:00:00.123456+00:00',
    author_nickname: '수달', author_verification_level: 3, parent_id: 'root',
    reply_to_id: 'other-reply', reply_to_nickname: '참새', reply_count: 0,
  }));
  const calls = [];
  const client = { rpc: async (name, params) => {
    calls.push({ name, params });
    return { data: calls.length === 1 ? rows : [rows[30]], error: null };
  } };
  const first = await loadCommentThreadPage(client, 'post', 'root');
  assert.equal(first.comments.length, 30);
  assert.deepEqual(first.cursor, { id: 'reply-2', createdAt: rows[29].created_at });
  assert.deepEqual(first.comments[0], {
    id: 'reply-31', authorId: 'author', nickname: '수달', body: '답글',
    likes: 2, likedByMe: true, verified: true, trustLevel: 3,
    createdAt: rows[0].created_at, parentId: 'root', replyToId: 'other-reply',
    replyToNickname: '참새', replyCount: 0,
  });
  const last = await loadCommentThreadPage(client, 'post', 'root', first.cursor);
  assert.equal(last.cursor, null);
  assert.deepEqual(calls[1], { name: 'get_comment_thread_page', params: {
    p_post_id: 'post', p_parent_id: 'root', p_before_created: rows[29].created_at,
    p_before_id: 'reply-2', p_limit: 31,
  } });

  const root = await loadCommentThreadPage({ rpc: async (name, params) => {
    assert.equal(params.p_parent_id, null);
    assert.equal(params.p_before_id, null);
    return { data: [{ ...rows[0], parent_id: null, reply_to_id: null, reply_to_nickname: null, reply_count: 400 }], error: null };
  } }, 'post');
  assert.equal(root.cursor, null);
  assert.equal(root.comments[0].replyCount, 400);
  assert.equal(root.comments[0].replyToNickname, undefined);
});

test('작성 RPC는 직접 답하는 댓글을 보내고 서버 오류를 유지한다', async () => {
  const client = { rpc: async (name, params) => {
    assert.equal(name, 'create_thread_comment');
    assert.deepEqual(params, { p_post_id: 'post', p_body: '답글', p_reply_to_id: 'reply' });
    return { data: 'new-comment', error: null };
  } };
  assert.equal(await createThreadComment(client, 'post', '  답글  ', 'reply'), 'new-comment');
  const error = { message: 'content_rejected' };
  const rejected = { rpc: async () => ({ data: null, error }) };
  await assert.rejects(createThreadComment(rejected, 'post', '답글'), (value) => value === error);
  await assert.rejects(loadCommentThreadPage(rejected, 'post'), (value) => value === error);
  await assert.rejects(loadCommentThreadContext(rejected, 'post', 'reply'), (value) => value === error);
  assert.deepEqual(await loadCommentThreadContext({ rpc: async (name, params) => {
    assert.equal(name, 'get_comment_thread_context');
    assert.deepEqual(params, { p_post_id: 'post', p_comment_id: 'hidden' });
    return { data: [], error: null };
  } }, 'post', 'hidden'), [], 'a hidden target never falls back to raw comment fields');
});

test('답글 UI는 좋아요·신고·초안·페이지를 보존하고 계정 및 글 전환을 격리한다', async () => {
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/post-detail.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const root = { id: 'root-comment', authorId: 'neighbor', nickname: '수달', body: '루트 본문', replyCount: 60 };
  const reply = { id: 'reply', authorId: 'other', nickname: '참새', body: '답글 본문', parentId: root.id, replyToNickname: root.nickname, likes: 2 };
  let auth = { isAuthed: true, me: { id: 'account-a', nickname: '나' }, isVerified: true, trustLevel: 2 };
  let post = { id: 'post-a', author: { id: 'author', nickname: '작성자' }, views: 1, comments: 61 };
  let hooks = [], index = 0, pendingEffects = [], mountedKey, tree, failSend = true, failLike = true, failRead = true, releaseSend, commentId, platform = 'ios';
  const alerts = [], reads = [], writes = [], counts = [];
  const exports = {};
  const jsx = (type, props, key) => ({ type, props, key });
  const effect = (fn, deps) => {
    const slot = index++, previous = hooks[slot];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const state = hooks[slot] = { deps, cleanup: previous?.cleanup };
    pendingEffects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
  };
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return {
      useState(initial) {
        const state = hooks, slot = index++;
        if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
        return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
      },
      useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
      useCallback(fn, deps) {
        const slot = index++, previous = hooks[slot];
        if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) hooks[slot] = { fn, deps };
        return hooks[slot].fn;
      },
      useEffect: effect, useLayoutEffect: effect,
    };
    if (name === 'react-native') return new Proxy({ StyleSheet: { create: x => x }, Platform: { get OS() { return platform; } }, Alert: { alert: (...args) => alerts.push(args) } }, { get: (target, key) => target[key] ?? key });
    if (name === 'expo-router') return { useRouter: () => ({ push() {} }) };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === '@/lib/auth') return { useAuth: () => ({ ...auth, promptLogin() {} }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16 } };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/lib/promotions') return { PROMOTIONS_PREVIEW_ENABLED: false };
    if (name === '@/lib/community-data') return {
      recordPostView: async () => 2,
      toggleCommentReaction: async () => { if (failLike) throw new Error('OFFLINE'); },
      isContentRejected: () => false,
    };
    if (name === '@/lib/comment-threads') return {
      loadCommentThreadContext: async (_client, _postId, targetId) => {
        if (targetId === 'hidden') return [];
        if (targetId === 'old-reply') return [{ ...root, id: 'old-root', body: '오래된 루트' }, { ...reply, id: targetId, parentId: 'old-root', body: '오래된 알림 답글' }];
        return [root, reply];
      },
      loadCommentThreadPage: async (_client, postId, parentId, cursor) => {
        reads.push({ postId, parentId, cursor });
        if (failRead) { failRead = false; throw new Error('OFFLINE'); }
        if (parentId) return cursor ? { comments: [{ ...reply, parentId, id: `older-${parentId}`, body: '이전 답글' }], cursor: null }
          : { comments: [{ ...reply, parentId, id: parentId === root.id ? reply.id : 'new-reply' }], cursor: { id: 'reply', createdAt: '2026-09-12T12:00:00.123456Z' } };
        return { comments: [root], cursor: null };
      },
      createThreadComment: async (_client, postId, body, replyToId) => {
        writes.push({ postId, body, replyToId });
        if (failSend) throw new Error('OFFLINE');
        if (releaseSend) await new Promise(resolve => { releaseSend = resolve; });
        return 'created';
      },
    };
    return new Proxy({}, { get: (_target, key) => key });
  } });
  const render = () => {
    const node = exports.PostDetail({ post, commentId, onClose() {}, onCommentCountChange: value => counts.push(value) });
    if (mountedKey !== node.key) {
      for (const hook of hooks) hook?.cleanup?.();
      hooks = []; mountedKey = node.key;
    }
    index = 0; pendingEffects = [];
    tree = node.type(node.props);
    for (const run of pendingEffects) run();
    return tree;
  };
  const nodes = (value) => !value || typeof value !== 'object' ? []
    : [...(value.type ? [value] : []), ...Object.values(value).flatMap(child => nodes(child))];
  const byLabel = label => nodes(tree).find(node => node.props?.accessibilityLabel === label);
  const input = () => nodes(tree).find(node => node.type === 'TextInput');
  const button = text => nodes(tree).find(node => node.type === 'Pressable' && nodes(node.props.children).some(child => child.props?.children === text));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };

  render(); await settle();
  input().props.onChangeText('읽기 실패 중 초안'); render();
  assert.equal(button(t.detail.send).props.disabled, true);
  button('다시 시도').props.onPress(); await settle();
  assert.equal(input().props.value, '읽기 실패 중 초안', 'page retry preserves the draft');
  assert.equal(button(t.detail.loadMoreComments), undefined, '61 total comments do not imply more root pages');
  byLabel('수달의 댓글 답글 60개 보기').props.onPress(); render(); await settle();
  assert.equal(byLabel('수달의 댓글 답글 60개 접기').props.accessibilityState.expanded, true);
  assert.equal(byLabel('수달의 댓글 답글 60개 접기').props['aria-expanded'], true);
  assert.equal(byLabel('참새의 답글 공감 2개').props.style.minHeight, 44);
  byLabel('참새의 답글 공감 2개').props.onPress(); render();
  assert.equal(byLabel('참새의 답글 공감 3개').props.accessibilityState.selected, true);
  await settle();
  assert.equal(byLabel('참새의 답글 공감 2개').props.accessibilityState.selected, false);
  failLike = false;
  byLabel('수달의 댓글 공감 0개').props.onPress(); render(); await settle();
  assert.equal(byLabel('수달의 댓글 공감 1개').props.accessibilityState.selected, true);
  platform = 'web'; render();
  assert.equal(byLabel('수달의 댓글 공감 1개').props['aria-pressed'], true, 'web toggle exposes pressed state as well as the native selected state');
  byLabel('참새의 답글 신고').props.onPress(); render();
  assert.equal(nodes(tree).find(node => node.type === 'ReportSheet').props.targetId, 'reply');
  button('답글 더 보기').props.onPress(); await settle();
  assert.equal(reads.at(-1).cursor.id, 'reply');
  assert.equal(button('답글 더 보기'), undefined);
  byLabel('참새님에게 답글 쓰기').props.onPress(); render();
  input().props.onChangeText('실패해도 남을 초안'); render();
  button(t.detail.send).props.onPress(); await settle();
  assert.equal(input().props.value, '실패해도 남을 초안');
  assert.equal(nodes(tree).find(node => node.props?.accessibilityRole === 'alert').props.children, t.detail.sendErrorBody, 'web failures stay visible where native Alert has no dialog');
  assert.equal(input().props.accessibilityLabel, '참새님에게 답글');
  assert.equal(writes[0].replyToId, 'reply', 'send targets the reply while keeping its root parent');
  failSend = false;
  button(t.detail.send).props.onPress(); await settle();
  assert.equal(input().props.value, '');
  assert.equal(counts.at(-1), 62);
  assert.ok(byLabel('수달의 댓글 답글 61개 접기'));

  input().props.onChangeText('이전 계정 초안'); render();
  releaseSend = true;
  button(t.detail.send).props.onPress(); render();
  const oldKey = mountedKey, oldCounts = counts.length, oldAlerts = alerts.length;
  auth = { ...auth, me: { id: 'account-b', nickname: '다른 계정' } };
  render(); await settle();
  assert.notEqual(mountedKey, oldKey);
  assert.equal(input().props.value, '');
  releaseSend(); await settle();
  assert.equal(counts.length, oldCounts, 'old account send completion cannot update the current post');
  assert.equal(alerts.length, oldAlerts);
  assert.ok(byLabel('수달의 댓글 답글 60개 보기'), 'new account has no previous expanded thread');
  input().props.onChangeText('다른 글에 보이면 안 됨'); render();
  post = { ...post, id: 'post-b' }; render(); await settle();
  assert.equal(input().props.value, '');
  assert.equal(reads.at(-1).postId, 'post-b');

  commentId = 'old-reply'; render(); await settle();
  const bodyCount = body => nodes(tree).filter(node => node.props?.children === body).length;
  assert.equal(bodyCount('오래된 알림 답글'), 1, 'exact old reply appears without scanning all reply pages');
  assert.equal(bodyCount('오래된 루트'), 1, 'root outside first root page is present');
  assert.equal(bodyCount('루트 본문'), 1, 'normal first-page roots remain available');
  const scrolls = [];
  const scroll = nodes(tree).find(node => node.type === 'ScrollView');
  scroll.props.ref.current = { scrollTo: value => scrolls.push(value.y) };
  const layout = () => nodes(tree).find(node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { y: 100 } } });
  layout(); layout();
  assert.deepEqual(scrolls, [100], 'only the initial target reveal moves the scroll');
  button('답글 더 보기').props.onPress(); await settle(); layout();
  assert.deepEqual(scrolls, [100], 'ordinary pagination preserves scroll');
  commentId = 'reply'; render(); await settle();
  assert.equal(bodyCount('루트 본문'), 1, 'a focused root already on the normal page is rendered once');
  assert.equal(bodyCount('답글 본문'), 1, 'focused reply and paginated reply do not duplicate');
  assert.equal(bodyCount('오래된 알림 답글'), 0, 'previous deep-link context disappears immediately');
  commentId = 'hidden'; render(); await settle();
  assert.equal(bodyCount('이 댓글은 확인할 수 없어요.'), 1);
  assert.equal(bodyCount('루트 본문'), 1, 'hidden target does not hide the available post and comments');
});
