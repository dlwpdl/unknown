import assert from 'node:assert/strict';
import test from 'node:test';
import { chatSuggestions, loadChatSuggestionContext, sendSuggestedMessage } from '../src/lib/chat-suggestions.ts';

const context = (category, extra = {}) => ({ category, postId: 'post', title: '원문', authorId: 'author', listingStatus: 'open', ...extra });

test('추천은 거래·렌트 제공/구함·모임의 양쪽 역할을 구분한다', () => {
  assert.match(chatSuggestions(context('used'), false)[0], /관심|판매/);
  assert.match(chatSuggestions(context('used'), true)[0], /판매/);
  assert.match(chatSuggestions(context('housing_offer'), false).join(' '), /뷰잉|입주/);
  assert.match(chatSuggestions(context('housing_wanted'), true).join(' '), /집|방|구하고/);
  assert.match(chatSuggestions(context('housing_wanted'), false).join(' '), /소개|방/);
  assert.match(chatSuggestions(context('meetup'), false).join(' '), /참여|준비/);
  assert.match(chatSuggestions(context('meetup'), true).join(' '), /참여|모임/);
});

test('출처가 없으면 일반 인사만 제안하고 마감된 글에 판매중이라고 제안하지 않는다', () => {
  assert.deepEqual(chatSuggestions(null, false), ['안녕하세요! 반갑습니다.']);
  assert.deepEqual(chatSuggestions(context('used', { listingStatus: 'closed' }), true), []);
  for (const category of ['used', 'housing_offer', 'housing_wanted', 'meetup']) {
    const suggestions = chatSuggestions(context(category), false);
    assert.ok(suggestions.length <= 3);
    assert.ok(suggestions.every(body => body.length > 0 && body.length < 150));
  }
});

test('맥락을 클라이언트 글 정보로 만들지 않고 현재 대화의 서버 RPC로 읽는다', async () => {
  const calls = [], value = context('used');
  const client = { rpc: async (...args) => { calls.push(args); return { data: value }; } };
  assert.deepEqual(await loadChatSuggestionContext(client, 'room'), value);
  assert.deepEqual(calls, [['get_chat_suggestion_context', { p_conversation_id: 'room' }]]);
});

test('추천 클릭은 정확한 문장과 동일 client ID를 보내며 서버 오류를 숨기지 않는다', async () => {
  const calls = [], clientId = 'aa000000-0000-4000-8000-000000000001';
  const client = { rpc: async (...args) => { calls.push(args); return { data: 'message-id' }; } };
  assert.equal(await sendSuggestedMessage(client, 'room', '안녕하세요! 아직 판매 중인가요?', clientId), 'message-id');
  assert.deepEqual(calls, [['send_suggested_message', { p_conversation_id: 'room', p_body: '안녕하세요! 아직 판매 중인가요?', p_client_id: clientId }]]);
  await assert.rejects(sendSuggestedMessage({ rpc: async () => ({ error: new Error('BLOCKED') }) }, 'room', '안녕하세요', clientId), /BLOCKED/);
  await assert.rejects(sendSuggestedMessage(client, 'room', ' ', clientId), /INVALID_MESSAGE/);
  await assert.rejects(sendSuggestedMessage(client, 'room', '안녕하세요', 'bad'), /INVALID_SEND_ID/);
});
