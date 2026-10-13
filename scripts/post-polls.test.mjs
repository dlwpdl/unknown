import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPostPoll, normalizePoll, STORY_POLL, votePostPoll } from '../src/lib/post-polls.ts';

const saved = { post_id: 'story', question: '어떻게 봐?', options: ['찬성', '반대'], counts: [0, 0], my_vote: null };
test('poll creation rejects duplicate, empty, too long or too few answers', () => {
  assert.equal(normalizePoll(STORY_POLL).options.length, 4);
  for (const options of [['찬성'], ['찬성', ' 찬성 '], ['찬성', ''], ['x'.repeat(81), '반대']]) {
    assert.throws(() => normalizePoll({ question: '어때?', options }), /INVALID_POLL/);
  }
  assert.throws(() => normalizePoll({ question: '', options: ['찬성', '반대'] }), /INVALID_POLL/);
});
test('legacy backend without polls leaves ordinary posts alone', async () => {
  assert.equal(await loadPostPoll({ rpc: async () => ({ error: { code: 'PGRST202' } }) }, 'story'), null);
});
test('a result for another story is never displayed', async () => {
  await assert.rejects(loadPostPoll({ rpc: async () => ({ data: { ...saved, post_id: 'other' } }) }, 'story'), /INVALID_POLL_RESPONSE/);
});
test('the first choice zero and its actual saved vote are verified', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { ...saved, counts: [1, 0], my_vote: 0 } }; } };
  const result = await votePostPoll(client, 'story', 'user', 0);
  assert.equal(result.my_vote, 0);
  assert.equal(calls[0][1].p_user_id, 'user');
  assert.equal(calls[0][1].p_option, 0);
});
test('a missing saved choice is not reported as success', async () => {
  await assert.rejects(votePostPoll({ rpc: async () => ({ data: saved }) }, 'story', 'user', 0), /POLL_VOTE_NOT_VERIFIED/);
});
