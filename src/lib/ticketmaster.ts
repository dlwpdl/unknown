import { supabase } from '@/lib/supabase';
import { meetupAllowed, type EventQuery, type TicketmasterEvent } from '../../supabase/functions/_shared/ticketmaster';
export { EVENT_CITIES, EVENT_CATEGORIES, eventMatchesPriceFilter, eventPriceLabel, eventTime, featuredLocalEvents, isFestivalEvent, spotlightLocalEvents, meetupAllowed } from '../../supabase/functions/_shared/ticketmaster';
export type { EventCity, EventCategory, EventPriceFilter, TicketmasterEvent } from '../../supabase/functions/_shared/ticketmaster';
export type EventList = { events: TicketmasterEvent[]; page: number; hasMore: boolean; fetchedAt: string };
export type EventDays = { month: string; days: string[]; complete: boolean; fetchedAt: string };
export const EVENT_CATEGORY_LABELS = { all: '전체', music: '음악', sports: '스포츠', arts: '공연·예술' } as const;
const ERRORS: Record<string, string> = {
  AUTH_REQUIRED: '로그인 후 주변 행사를 확인할 수 있어요.',
  NOT_CONFIGURED: '행사 연결을 준비하고 있어요. 잠시 후 다시 확인해 주세요.',
  RATE_LIMITED: '행사 요청이 많아요. 잠시 후 다시 시도해 주세요.',
  NOT_FOUND: '이 지역에서 해당 행사를 찾을 수 없어요.',
  INVALID_INPUT: '행사 검색 조건을 다시 확인해 주세요.',
  UPSTREAM_TIMEOUT: '행사 정보를 가져오는 데 시간이 걸려요. 다시 시도해 주세요.',
};
async function request<T>(query: Partial<EventQuery>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ticketmaster-events', { body: query });
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    throw new Error(ERRORS[body?.error] ?? '행사 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  }
  if (!data || data.error) throw new Error(ERRORS[data?.error] ?? '행사 정보를 불러오지 못했어요.');
  return data as T;
}
export const loadTicketmasterEvents = (query: Omit<EventQuery, 'eventId'>) => request<EventList>(query);
export const loadTicketmasterEventDays = (cityId: EventQuery['cityId'], category: EventQuery['category'], month: string) => request<EventDays>({ cityId, category, month });
export const loadTicketmasterEvent = (cityId: string, eventId: string) => request<{ event: TicketmasterEvent; fetchedAt: string }>({ cityId: cityId as EventQuery['cityId'], eventId });
export async function recordTicketmasterEventClick(cityId: string, eventId: string) {
  const { error } = await supabase.rpc('record_ticketmaster_event_click', { p_city_id: cityId, p_event_id: eventId });
  if (error) throw error;
}
export function eventNotice(event: TicketmasterEvent) {
  const status: Record<string, string> = { canceled: '취소된 행사예요.', cancelled: '취소된 행사예요.', postponed: '행사 일정이 연기됐어요.', rescheduled: '일정이 변경됐어요. 판매처에서 확인해 주세요.', offsale: '현재 판매가 중단됐어요.' };
  if (status[event.status]) return status[event.status];
  if (event.timeUnconfirmed) return '일정이 확정되면 함께 갈 모임을 열 수 있어요.';
  if (event.startsAt && Date.parse(event.startsAt) <= Date.now()) return '이미 시작된 행사예요.';
  return meetupAllowed(event) ? '' : '판매처에서 행사 상태를 확인해 주세요.';
}
export function eventMeetupDraft(event: TicketmasterEvent) {
  if (!meetupAllowed(event)) throw new Error(eventNotice(event));
  return {
    title: `${event.name.slice(0, 49)} 같이 가요`,
    body: `${event.name}, 함께 가실 분을 찾아요.\n\n행사 ID: ${event.id}`,
    startsAt: event.startsAt!, endsAt: new Date(Date.parse(event.startsAt!) + 2 * 3600_000).toISOString(),
  };
}
