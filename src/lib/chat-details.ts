import type { SupabaseClient } from '@supabase/supabase-js';

type TimedMessage = { sender_id: string; created_at: string };
export type MeetupChatIcon = 'sunset' | 'sports-shoe' | 'popcorn' | 'beer' | 'disco-ball' | 'microphone' | 'ticket';

// Specific meetup plans win over the broad category; older rooms may have no category.
export function meetupChatIcon(category: string | null | undefined, title: string): MeetupChatIcon {
  if (/노을|일몰|선셋|sunset/i.test(title)) return 'sunset';
  if (/영화|시네마|극장|팝콘|movie|cinema|film/i.test(title)) return 'popcorn';
  if (category === 'sports' || /운동|스포츠|골프|테니스|러닝|조깅|농구|축구|풋살|트레킹|등산|배드민턴|요가|run(ning)?|soccer|tennis|hiking/i.test(title)) return 'sports-shoe';
  if (category === 'festival' || category === 'party' || /페스티벌|축제|파티|클럽|클러빙|디제이|댄스|festival|party|clubbing|dj\b/i.test(title)) return 'disco-ball';
  if (/맥주|한잔|술자리|펍|비어|beer|pub/i.test(title)) return 'beer';
  if (/공연|콘서트|라이브|노래방|밴드|live|concert|karaoke/i.test(title)) return 'microphone';
  return 'ticket';
}
export function firstUnreadMessageIndex(messages: TimedMessage[], readAt: string | null, userId: string) {
  const time = readAt ? Date.parse(readAt) : 0;
  return messages.findIndex((message) => message.sender_id !== userId && Date.parse(message.created_at) > time);
}
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

// 쪽지함 목록은 오늘이면 시각, 지난 날짜면 날짜를 보여 준다.
export function chatListTime(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === now.toDateString() ? chatMessageTime(value) : chatDateLabel(value, undefined, now) ?? '';
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
