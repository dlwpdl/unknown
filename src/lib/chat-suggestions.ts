import type { SupabaseClient } from '@supabase/supabase-js';

export type ChatSuggestionContext = {
  category: 'used' | 'housing_offer' | 'housing_wanted' | 'housing' | 'meetup' | 'generic';
  postId: string; title: string; authorId: string; listingStatus: 'open' | 'partial' | 'closed' | null;
};

export function chatSuggestions(context: ChatSuggestionContext | null, isAuthor: boolean): string[] {
  if (context?.listingStatus === 'closed') return [];
  switch (context?.category) {
    case 'used': return isAuthor
      ? ['안녕하세요! 네, 아직 판매 중입니다.', '거래 가능한 시간과 장소를 알려주실까요?', '죄송해요, 거래가 완료됐어요.']
      : ['안녕하세요! 이 상품에 관심이 있어 연락드려요. 아직 판매 중인가요?', '언제, 어디서 거래할 수 있을까요?', '상품 상태를 조금 더 알려주실 수 있나요?'];
    case 'housing_offer': return isAuthor
      ? ['안녕하세요! 입주를 희망하시는 시기를 알려주실까요?', '뷰잉 가능한 시간을 알려주실까요?', '궁금한 조건을 말씀해 주세요.']
      : ['안녕하세요! 올려주신 집에 관심이 있어 연락드려요.', '입주 가능한 날짜와 비용을 알려주실 수 있나요?', '뷰잉을 예약할 수 있을까요?'];
    case 'housing_wanted': return isAuthor
      ? ['안녕하세요! 네, 아직 집을 구하고 있어요.', '집 위치와 입주 가능한 날짜를 알려주실까요?', '월세와 포함되는 비용을 알려주실까요?']
      : ['안녕하세요! 찾으시는 조건에 맞는 집을 소개해 드리고 싶어요.', '언제부터 입주를 원하시나요?', '찾으시는 집의 조건을 더 알려주실까요?'];
    case 'housing': return ['안녕하세요! 올려주신 주거 글을 보고 연락드려요.', '입주 시기와 조건을 조금 더 알려주실 수 있나요?', '가능한 시간을 알려주실까요?'];
    case 'meetup': return isAuthor
      ? ['안녕하세요! 모임에 관심 가져주셔서 감사해요.', '참여하고 싶은 날짜를 알려주실까요?', '궁금한 점을 편하게 말씀해 주세요.']
      : ['안녕하세요! 모임에 관심이 있어 연락드려요. 참여할 수 있을까요?', '처음 참여해도 괜찮을까요?', '준비물이나 참가 비용이 있나요?'];
    default: return ['안녕하세요! 반갑습니다.'];
  }
}

export async function loadChatSuggestionContext(client: SupabaseClient, conversationId: string): Promise<ChatSuggestionContext | null> {
  const result = await client.rpc('get_chat_suggestion_context', { p_conversation_id: conversationId });
  if (result.error) throw result.error;
  return result.data;
}

export async function sendSuggestedMessage(client: SupabaseClient, conversationId: string, body: string, clientId: string): Promise<string> {
  if (!body.trim() || body.length > 2000) throw new Error('INVALID_MESSAGE');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId)) throw new Error('INVALID_SEND_ID');
  const result = await client.rpc('send_suggested_message', { p_conversation_id: conversationId, p_body: body.trim(), p_client_id: clientId });
  if (result.error) throw result.error;
  if (typeof result.data !== 'string' || !result.data) throw new Error('MESSAGE_SEND_NOT_VERIFIED');
  return result.data;
}
