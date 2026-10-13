import type { SupabaseClient } from '@supabase/supabase-js';

export type PollDraft = { question: string; options: string[] };
export type PostPoll = PollDraft & { post_id: string; counts: number[]; my_vote: number | null };
export const STORY_POLL: PollDraft = {
  question: '이 상황, 이해돼?',
  options: ['남 · 이해돼', '남 · 이해 안 돼', '여 · 이해돼', '여 · 이해 안 돼'],
};

export function normalizePoll(poll: PollDraft): PollDraft {
  const question = poll.question.trim(), options = poll.options.map(value => value.trim());
  if (!question || Array.from(question).length > 120 || options.length < 2 || options.length > 6
    || options.some(value => !value || Array.from(value).length > 80) || new Set(options).size !== options.length) {
    throw new Error('INVALID_POLL');
  }
  return { question, options };
}

function resultFor(postId: string, data: PostPoll | null): PostPoll | null {
  if (!data) return null;
  if (data.post_id !== postId || !Array.isArray(data.options) || !Array.isArray(data.counts)
    || data.options.length !== data.counts.length || data.counts.some(value => !Number.isSafeInteger(value) || value < 0)
    || (data.my_vote !== null && (!Number.isInteger(data.my_vote) || data.my_vote < 0 || data.my_vote >= data.options.length))) {
    throw new Error('INVALID_POLL_RESPONSE');
  }
  normalizePoll(data);
  return data;
}

export async function loadPostPoll(client: SupabaseClient, postId: string): Promise<PostPoll | null> {
  const result = await client.rpc('get_post_poll', { p_post_id: postId });
  if (result.error?.code === 'PGRST202') return null;
  if (result.error) throw result.error;
  return resultFor(postId, result.data);
}

export async function votePostPoll(client: SupabaseClient, postId: string, userId: string, option: number): Promise<PostPoll> {
  const result = await client.rpc('vote_post_poll', { p_post_id: postId, p_option: option, p_user_id: userId });
  if (result.error) throw result.error;
  const poll = resultFor(postId, result.data);
  if (!poll || poll.my_vote === null) throw new Error('POLL_VOTE_NOT_VERIFIED');
  return poll;
}
