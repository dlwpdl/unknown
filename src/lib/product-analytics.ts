import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductEventKind = 'notification_push_open' | 'notification_inbox_open' | 'event_view' | 'event_website' | 'place_view' | 'place_directions' | 'place_website' | 'client_error' | 'photo_upload_error' | 'map_error';
export type ProductEvent = { kind: ProductEventKind; targetId?: string | null; cityId?: string | null; platform: string };
export const ACQUISITION_SOURCES = ['unknown', 'direct', 'instagram', 'threads', 'search', 'facebook', 'website', 'kakao', 'naver', 'share'] as const;
export type AcquisitionSource = typeof ACQUISITION_SOURCES[number];

export async function recordProductEvent(client: SupabaseClient, event: ProductEvent) {
  const { error } = await client.rpc('record_product_event', {
    p_kind: event.kind, p_target_id: event.targetId ?? null,
    p_city_id: event.cityId ?? null, p_platform: event.platform,
  });
  if (error) throw error;
}

export function getAcquisitionSource(entryUrl: string | null): AcquisitionSource {
  try {
    if (!entryUrl) return 'unknown';
    const url = new URL(entryUrl);
    if (url.protocol !== 'gling:' && !(url.protocol === 'https:' && url.hostname === 'gling.ej-entertainment.com')) return 'unknown';
    const source = url.searchParams.get('utm_source')?.trim().toLowerCase();
    return source !== 'unknown' && (ACQUISITION_SOURCES as readonly string[]).includes(source ?? '') ? source as AcquisitionSource : 'unknown';
  } catch { return 'unknown'; }
}
