import type { SupabaseClient } from '@supabase/supabase-js';

export const CONVERSATION_REVIEW_STATUS = {
  new: '미검토', reviewing: '검토 중', clear: '위반 없음', action: '조치 필요', closed: '조치 완료',
} as const;
export type ConversationReviewStatus = keyof typeof CONVERSATION_REVIEW_STATUS;
export const CONVERSATION_RISK_LABEL = { none: '신호 없음', low: '낮음', medium: '보통', high: '높음', critical: '긴급' } as const;
export type ConversationRisk = keyof typeof CONVERSATION_RISK_LABEL;
export type ConversationFilters = {
  city: string; scope: 'pending' | 'all' | 'done'; kind: 'all' | 'direct' | 'group';
  risk: 'all' | 'none' | 'low' | 'medium' | 'high'; since: string | null; query: string; sort: 'risk' | 'recent';
};
export type ConversationMember = { id: string; nickname: string; city_id: string | null };
export type ConversationReview = {
  id: string; conversation_id: string; actor_id: string; actor_name: string | null;
  status: ConversationReviewStatus; note: string; last_signal_at: string | null; created_at: string;
};
export type ConversationCase = {
  id: string; kind: 'direct' | 'group' | 'business'; title: string | null; participants: ConversationMember[];
  latest_message_at: string; latest_excerpt: string; message_count: number;
  risk_level: ConversationRisk; signal_count: number; latest_signal_at: string | null;
  pending_analysis: number; status: ConversationReviewStatus; reopened: boolean; review: ConversationReview | null;
};
export type ConversationPage = {
  rows: ConversationCase[]; counts: { all: number; pending: number; done: number; high: number };
  nextOffset: number | null; generatedAt: string;
};
export type ConversationMessage = {
  id: string; conversation_id: string; sender_id: string; body: string; created_at: string;
  image_path?: string | null; image_paths?: string[]; reply_to_id?: string | null;
  kind?: 'text' | 'image' | 'location'; latitude?: number | null; longitude?: number | null;
};
export type ConversationSignal = {
  id: string; source: 'keyword' | 'ai'; message_id: string; message_at: string | null;
  category: string; severity: Exclude<ConversationRisk, 'none'>; reasons: string[];
  excerpt: string; created_at: string;
};
export type ConversationCursor = { at: string; id: string };
export type ConversationDetail = {
  conversation: ConversationCase; messages: ConversationMessage[]; signals: ConversationSignal[];
  review_history: ConversationReview[]; nextCursor: ConversationCursor | null; hasNewer: boolean; generatedAt: string;
};

export async function loadAdminConversations(client: SupabaseClient, filters: ConversationFilters, offset = 0): Promise<ConversationPage> {
  const { data, error } = await client.rpc('get_admin_conversations', {
    p_city: filters.city, p_scope: filters.scope, p_kind: filters.kind, p_risk: filters.risk,
    p_since: filters.since, p_query: filters.query.trim(), p_sort: filters.sort, p_offset: offset,
  });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data;
}

export async function loadAdminConversation(client: SupabaseClient, conversationId: string, cursor: ConversationCursor | null = null, focusMessageId: string | null = null): Promise<ConversationDetail> {
  const { data, error } = await client.rpc('get_admin_conversation', {
    p_conversation_id: conversationId, p_before: cursor?.at ?? null,
    p_before_id: cursor?.id ?? null, p_focus_message_id: focusMessageId,
  });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data;
}

export async function saveAdminConversationReview(client: SupabaseClient, conversationId: string, status: ConversationReviewStatus, note: string, expectedReviewId: string | null, expectedSignalAt: string | null): Promise<ConversationReview> {
  const trimmed = note.trim();
  if (!Object.hasOwn(CONVERSATION_REVIEW_STATUS, status)) throw new Error('검토 상태를 확인해 주세요.');
  if (!trimmed || trimmed.length > 1000) throw new Error('판단 근거나 검토 메모를 1~1,000자로 적어 주세요.');
  const { data, error } = await client.rpc('save_admin_conversation_review', {
    p_conversation_id: conversationId, p_status: status, p_note: trimmed,
    p_expected_review_id: expectedReviewId, p_expected_signal_at: expectedSignalAt,
  });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data;
}

export function mergeConversationMessages(current: ConversationMessage[], next: ConversationMessage[]): ConversationMessage[] {
  // Preserve raw cursor timestamps and use microseconds to break Date's millisecond ties.
  return [...new Map([...current, ...next].map(message => [message.id, message])).values()]
    .sort((a, b) => {
      const millis = Date.parse(a.created_at) - Date.parse(b.created_at);
      const micros = Number((a.created_at.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'))
        - Number((b.created_at.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'));
      return millis || micros || a.id.localeCompare(b.id);
    });
}
