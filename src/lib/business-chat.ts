import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatMessageRecord, ConversationIdentity, ConversationPreview, ReportReason } from './community-data.ts';
import type { FeedCursor } from './feed-data.ts';
import { businessMediaUrl } from './business-media.ts';
import { MAX_POST_IMAGES } from './image-upload.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail = () => { throw new Error('BUSINESS_CHAT_READ_FAILED'); };
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function identity(value: unknown): ConversationIdentity {
  const row = object(value);
  if (!['user', 'business'].includes(String(row.kind)) || !uuid(row.id) || typeof row.name !== 'string' || !row.name.trim()
    || row.name.length > 300 || row.avatar_path !== null && typeof row.avatar_path !== 'string') return fail();
  const path = row.avatar_path as string | null;
  const avatarUri = path && row.kind === 'business' ? businessMediaUrl(path) : null;
  if (row.kind === 'business' && path && (!avatarUri || !path.startsWith(`business-profile/${row.id}/avatar/`))) return fail();
  return { kind: row.kind as ConversationIdentity['kind'], id: row.id, name: row.name, avatar_path: path, avatarUri };
}

export function mapBusinessConversation(value: unknown, userId?: string, asBusinessId?: string | null): ConversationPreview {
  const row = object(value), self = identity(row.self_identity), other = identity(row.other_identity);
  if (row.kind !== 'business' || !uuid(row.id) || !['active', 'ended', 'pending', 'rejected', 'cancelled'].includes(String(row.status))
    || !instant(row.latest_at) || row.latest_body !== null && typeof row.latest_body !== 'string'
    || self.kind === 'user' && other.kind === 'user' || self.kind === other.kind && self.id === other.id) return fail();
  if (asBusinessId !== undefined && (asBusinessId === null
    ? self.kind !== 'user' || self.id !== userId
    : self.kind !== 'business' || self.id !== asBusinessId)) return fail();
  return { id: row.id, kind: 'business', status: row.status as ConversationPreview['status'], requesterId: null,
    groupPostId: null, meetupCategory: null, title: other.name, isGroupHost: false,
    otherUser: { id: other.id, nickname: other.name, verificationLevel: other.kind === 'business' ? 2 : 0 },
    latestBody: row.latest_body as string | null, latestAt: row.latest_at, selfIdentity: self, otherIdentity: other };
}

function scope(conversation: ConversationPreview) {
  if (conversation.kind !== 'business' || !conversation.selfIdentity || !conversation.otherIdentity || !uuid(conversation.id)) return fail();
  return { p_as_business_id: conversation.selfIdentity.kind === 'business' ? conversation.selfIdentity.id : null };
}
async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data as unknown;
}
async function savedId(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const result = await rpc(client, name, args);
  if (!uuid(result)) return fail();
  return result;
}

export async function startBusinessConversation(client: SupabaseClient, other: { businessId: string } | { userId: string }, asBusinessId: string | null, postId?: string) {
  const recipient = other as { businessId?: string; userId?: string };
  if (asBusinessId !== null && !uuid(asBusinessId) || postId !== undefined && !uuid(postId)
    || Number(uuid(recipient.businessId)) + Number(uuid(recipient.userId)) !== 1
    || asBusinessId === null && !uuid(recipient.businessId)) throw new Error('INVALID_BUSINESS_CHAT_RECIPIENT');
  return savedId(client, 'start_business_conversation', { p_as_business_id: asBusinessId,
    p_other_user_id: recipient.userId ?? null, p_other_business_id: recipient.businessId ?? null, p_post_id: postId ?? null });
}

function message(value: unknown, conversation: ConversationPreview): ChatMessageRecord {
  const row = object(value), endpoints = [conversation.selfIdentity!, conversation.otherIdentity!];
  const sender = endpoints.find(endpoint => endpoint.id === row.sender_id && endpoint.kind === row.sender_kind);
  if (!sender || !uuid(row.id) || row.conversation_id !== conversation.id || !instant(row.created_at)
    || typeof row.sender_name !== 'string' || typeof row.body !== 'string' || typeof row.is_mine !== 'boolean'
    || row.is_mine !== (sender.id === conversation.selfIdentity!.id && sender.kind === conversation.selfIdentity!.kind)
    || !['text', 'image', 'location'].includes(String(row.kind))) return fail();
  for (const field of ['edited_at', 'deleted_at']) if (row[field] != null && !instant(row[field])) return fail();
  if (row.reply_to_id != null && !uuid(row.reply_to_id)) return fail();
  const paths = Array.isArray(row.image_paths) && row.image_paths.length ? row.image_paths : row.image_path ? [row.image_path] : [];
  const prefix = `${sender.id}/${conversation.id}_`;
  if (paths.length > MAX_POST_IMAGES || new Set(paths).size !== paths.length || paths.some(path => typeof path !== 'string'
    || !path.startsWith(prefix) || !/^[a-z0-9-]+\.webp$/i.test(path.slice(prefix.length)))) return fail();
  if (!row.deleted_at && row.kind === 'image' && !paths.length || (row.deleted_at || row.kind !== 'image') && paths.length) return fail();
  if (!row.deleted_at && row.kind === 'location' && (typeof row.latitude !== 'number' || typeof row.longitude !== 'number'
    || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude) || Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180)) return fail();
  let reply: ChatMessageRecord['reply'] = null;
  if (row.reply_to != null) {
    const parent = object(row.reply_to);
    if (!uuid(parent.id) || parent.id !== row.reply_to_id || !endpoints.some(endpoint => endpoint.id === parent.sender_id && endpoint.kind === parent.sender_kind)
      || typeof parent.body !== 'string' || !['text', 'image', 'location'].includes(String(parent.kind))) return fail();
    reply = { id: parent.id, sender_id: parent.sender_id as string, body: parent.body,
      kind: parent.kind as ChatMessageRecord['kind'], deleted_at: parent.deleted_at as string | null };
  }
  const author = identity({ kind: sender.kind, id: sender.id, name: row.sender_name, avatar_path: row.avatar_path ?? null });
  if (row.hearts != null && (!Number.isSafeInteger(row.hearts) || (row.hearts as number) < 0)
    || row.mine_reacted != null && typeof row.mine_reacted !== 'boolean') return fail();
  return { id: row.id, conversation_id: conversation.id, sender_id: sender.id, sender_kind: sender.kind,
    sender_nickname: row.sender_name, avatarUri: author.avatarUri, is_mine: row.is_mine, body: row.deleted_at ? '삭제된 메시지입니다.' : row.body,
    created_at: row.created_at, kind: row.kind as ChatMessageRecord['kind'], image_path: paths[0] as string ?? null,
    image_paths: paths as string[], latitude: row.latitude as number | null, longitude: row.longitude as number | null,
    location_label: typeof row.location_label === 'string' ? row.location_label : null,
    edited_at: row.edited_at as string | null, deleted_at: row.deleted_at as string | null,
    reply_to_id: row.reply_to_id as string | null, reply, hearts: row.hearts as number ?? 0, mine_reacted: row.mine_reacted === true };
}

export async function loadBusinessChatMessages(client: SupabaseClient, conversation: ConversationPreview, options: { before?: FeedCursor; messageIds?: string[] } = {}) {
  const args = scope(conversation), ids = options.messageIds ? [...new Set(options.messageIds)] : null;
  if (ids && ids.length > 50) throw new Error('MESSAGE_BATCH_TOO_LARGE');
  if (ids?.some(id => !uuid(id)) || options.before && (!uuid(options.before.id) || !instant(options.before.createdAt))) return fail();
  const page = object(await rpc(client, 'get_business_chat_messages', { p_conversation_id: conversation.id, ...args, p_limit: 50,
    p_before_created: options.before?.createdAt ?? null, p_before_id: options.before?.id ?? null, p_message_ids: ids }));
  const current = mapBusinessConversation(page.conversation);
  if (current.id !== conversation.id || current.selfIdentity!.id !== conversation.selfIdentity!.id
    || current.selfIdentity!.kind !== conversation.selfIdentity!.kind || current.otherIdentity!.id !== conversation.otherIdentity!.id
    || current.otherIdentity!.kind !== conversation.otherIdentity!.kind || !Array.isArray(page.items) || page.items.length > 50
    || page.read_at !== null && !instant(page.read_at)) return fail();
  const messages = page.items.map(row => message(row, current)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  if (new Set(messages.map(row => row.id)).size !== messages.length) return fail();
  if (ids && messages.some(row => !ids.includes(row.id))) return fail();
  if (page.cursor !== null && (!uuid(object(page.cursor).id) || !instant(object(page.cursor).createdAt))) return fail();
  if (messages.some(row => row.kind === 'image' && !row.deleted_at)) {
    const paths = [...new Set(messages.flatMap(row => row.deleted_at ? [] : row.image_paths ?? []))];
    const sources = await authenticatedChatImages(client, paths);
    const images = new Map(paths.map((path, index) => [path, sources[index]]));
    for (const row of messages) if (row.kind === 'image' && !row.deleted_at) row.imageSources = row.image_paths!.map(path => images.get(path)!);
  }
  return { messages, conversation: current, cursor: page.cursor as FeedCursor | null, readAt: page.read_at as string | null };
}

export async function authenticatedChatImages(client: SupabaseClient, paths: string[]) {
  const session = await client.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken) throw new Error('AUTH_REQUIRED');
  return paths.map(path => ({
    uri: client.storage.from('chat-images').getPublicUrl(path).data.publicUrl.replace('/object/public/', '/object/authenticated/'),
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
}

export type BusinessMessageInput = { clientId: string; body?: string; kind?: 'text' | 'image' | 'location'; imagePaths?: string[];
  latitude?: number; longitude?: number; replyToId?: string | null; locationLabel?: string };
export async function sendBusinessChatMessage(client: SupabaseClient, conversation: ConversationPreview, input: BusinessMessageInput) {
  if (!uuid(input.clientId)) throw new Error('INVALID_BUSINESS_CHAT_MESSAGE');
  return savedId(client, 'send_business_chat_message', { p_conversation_id: conversation.id, ...scope(conversation),
    p_client_id: input.clientId, p_body: input.body?.trim() ?? '', p_kind: input.kind ?? 'text', p_image_paths: input.imagePaths ?? [],
    p_latitude: input.latitude ?? null, p_longitude: input.longitude ?? null, p_reply_to_id: input.replyToId ?? null,
    p_location_label: input.locationLabel?.trim() || null });
}
export async function editBusinessChatMessage(client: SupabaseClient, conversation: ConversationPreview, id: string, body: string, editedAt: string | null = null) {
  return message(await rpc(client, 'edit_business_chat_message', { p_message_id: id, ...scope(conversation), p_body: body.trim(), p_expected_edited_at: editedAt }), conversation);
}
export async function deleteBusinessChatMessage(client: SupabaseClient, conversation: ConversationPreview, id: string, editedAt: string | null = null) {
  return message(await rpc(client, 'delete_business_chat_message', { p_message_id: id, ...scope(conversation), p_expected_edited_at: editedAt }), conversation);
}
export async function markBusinessChatRead(client: SupabaseClient, conversation: ConversationPreview, id: string) {
  await rpc(client, 'mark_business_chat_read', { p_conversation_id: conversation.id, ...scope(conversation), p_message_id: id });
}
export async function setBusinessChatReaction(client: SupabaseClient, conversation: ConversationPreview, id: string, reacted: boolean) {
  const result = object(await rpc(client, 'set_business_chat_reaction', { p_message_id: id, ...scope(conversation), p_reacted: reacted }));
  if (!Number.isSafeInteger(result.hearts) || (result.hearts as number) < 0 || typeof result.mine !== 'boolean') return fail();
  return { hearts: result.hearts as number, mine: result.mine };
}
export const reportBusinessChatMessage = (client: SupabaseClient, conversation: ConversationPreview, id: string, reason: ReportReason, details?: string) =>
  savedId(client, 'report_business_chat_message', { p_message_id: id, ...scope(conversation), p_reason_code: reason, p_details: details?.trim() || null });
export async function endBusinessConversation(client: SupabaseClient, conversation: ConversationPreview) {
  await rpc(client, 'end_business_conversation', { p_conversation_id: conversation.id, ...scope(conversation) });
}
export async function blockBusinessConversation(client: SupabaseClient, conversation: ConversationPreview) {
  await rpc(client, 'block_business_conversation', { p_conversation_id: conversation.id, ...scope(conversation) });
}

type BusinessChatEvent = { conversationId: string; messageId?: string; businessId?: string | null };
type Subscription = { listeners: Set<(event: BusinessChatEvent) => void>; channel: ReturnType<SupabaseClient['channel']> | null; closing: Promise<unknown> | null };
// Supabase reuses topics: the inbox, room, and filter remount share one channel lifecycle.
const subscriptions = new WeakMap<SupabaseClient, Map<string, Subscription>>();
export function subscribeBusinessChat(client: SupabaseClient, userId: string, changed: (event: BusinessChatEvent) => void) {
  if (!uuid(userId)) return fail();
  let users = subscriptions.get(client);
  if (!users) { users = new Map(); subscriptions.set(client, users); }
  let current = users.get(userId);
  if (!current) { current = { listeners: new Set(), channel: null, closing: null }; users.set(userId, current); }
  const entry = current;
  const start = () => {
    entry.channel = client.channel(`business-chat:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'business_chat_changed' }, ({ payload }) => {
        if (payload && uuid(payload.conversation_id) && (payload.message_id == null || uuid(payload.message_id))
          && (payload.recipient_business_id == null || uuid(payload.recipient_business_id))) {
          for (const listener of entry.listeners) listener({ conversationId: payload.conversation_id, messageId: payload.message_id ?? undefined,
            businessId: payload.recipient_business_id ?? null });
        }
      }).subscribe();
  };
  const listener = (event: BusinessChatEvent) => changed(event);
  entry.listeners.add(listener);
  if (!entry.channel && !entry.closing) start();
  return () => {
    entry.listeners.delete(listener);
    void Promise.resolve().then(() => {
      if (entry.listeners.size || entry.closing || !entry.channel) return;
      const channel = entry.channel; entry.channel = null;
      entry.closing = client.removeChannel(channel).catch(() => {}).finally(() => {
        entry.closing = null;
        if (entry.listeners.size) start();
        else if (users.get(userId) === entry) users.delete(userId);
      });
    });
  };
}
