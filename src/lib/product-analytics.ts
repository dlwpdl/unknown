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

export function knownAcquisitionSource(value: string | null | undefined): AcquisitionSource {
  const source = value?.trim().toLowerCase() ?? '';
  return (ACQUISITION_SOURCES as readonly string[]).includes(source) ? source as AcquisitionSource : 'unknown';
}

export function getAcquisitionSource(entryUrl: string | null): AcquisitionSource {
  try {
    if (!entryUrl) return 'unknown';
    const url = new URL(entryUrl);
    if (url.protocol !== 'gling:' && !(url.protocol === 'https:' && url.hostname === 'gling.ej-entertainment.com')) return 'unknown';
    return knownAcquisitionSource(url.searchParams.get('utm_source'));
  } catch { return 'unknown'; }
}

// Google Play's install referrer is a bare query ("utm_source=instagram&utm_campaign=bio"); its own "google-play" is not one of our channels.
export function getInstallReferrerSource(referrer: string | null): AcquisitionSource {
  try { return knownAcquisitionSource(new URLSearchParams(referrer ?? '').get('utm_source')); } catch { return 'unknown'; }
}
