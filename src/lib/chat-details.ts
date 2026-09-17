import type { SupabaseClient } from '@supabase/supabase-js';

type TimedMessage = { sender_id: string; created_at: string };
export function chatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getHours() < 12 ? '오전' : '오후'} ${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function showChatMessageTime(message: TimedMessage, next?: TimedMessage) {
  return !next || message.sender_id !== next.sender_id ||
    Math.floor(Date.parse(message.created_at) / 60000) !== Math.floor(Date.parse(next.created_at) / 60000);
}

export function chatDateLabel(value: string, previous?: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || previous && date.toDateString() === new Date(previous).toDateString()) return null;
  if (date.toDateString() === now.toDateString()) return '오늘';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '어제';
  return `${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export type ChatMember = { id: string; nickname: string; avatar_path: string | null; is_host: boolean; avatarUrl?: string };
export async function loadChatMembers(client: SupabaseClient, conversationId: string): Promise<ChatMember[]> {
  const result = await client.rpc('get_conversation_members', { p_conversation_id: conversationId });
  if (result.error) throw result.error;
  const members = (result.data ?? []) as ChatMember[];
  const paths = members.flatMap((member) => member.avatar_path ? [member.avatar_path] : []);
  if (!paths.length) return members;
  // Photos are optional; a storage outage must not hide the participant list.
  try {
    const signed = await client.storage.from('avatars').createSignedUrls(paths, 3600);
    const urls = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    return members.map((member) => ({ ...member, avatarUrl: urls.get(member.avatar_path ?? '') ?? undefined }));
  } catch { return members; }
}
