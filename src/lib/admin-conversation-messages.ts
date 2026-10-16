import type { SupabaseClient } from '@supabase/supabase-js';

import { ADMIN_PAGE_SIZE, loadAdminProfilesByIds, logAdminAccess, type AdminConversation, type AdminMessage, type AdminProfile } from '@/lib/admin-data';
import { referencedUserIds } from '@/lib/admin-labels';

export type AdminConversationPage = { rows: AdminMessage[]; total: number; profiles: AdminProfile[] };

export async function loadAdminConversationMessages(client: SupabaseClient, conversationId: string, offset = 0): Promise<AdminConversationPage> {
  if (!conversationId.trim() || !Number.isInteger(offset) || offset < 0) throw new Error('INVALID_CONVERSATION_PAGE');
  await logAdminAccess(client, 'conversations', null, conversationId);
  const result = await client.from('messages').select('*', { count: 'exact' }).eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + ADMIN_PAGE_SIZE - 1);
  if (result.error) throw new Error(result.error.message);
  if (!Array.isArray(result.data) || result.count == null) throw new Error('ADMIN_CONVERSATION_DATA_MISSING');
  const rows = result.data as AdminMessage[];
  return { rows, total: result.count, profiles: await loadAdminProfilesByIds(client, referencedUserIds({ messages: rows })) };
}

export async function loadAdminMeetupConversations(client: SupabaseClient, postId: string): Promise<{ conversations: AdminConversation[]; profiles: AdminProfile[] }> {
  if (!postId.trim()) throw new Error('INVALID_MEETUP');
  await logAdminAccess(client, 'conversations', null, postId);
  const result = await client.from('conversations').select('*').eq('group_post_id', postId)
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (result.error) throw new Error(result.error.message);
  if (!Array.isArray(result.data)) throw new Error('ADMIN_CONVERSATION_DATA_MISSING');
  const conversations = result.data as AdminConversation[];
  return { conversations, profiles: await loadAdminProfilesByIds(client, referencedUserIds({ conversations })) };
}
