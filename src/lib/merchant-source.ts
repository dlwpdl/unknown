import type { SupabaseClient } from '@supabase/supabase-js';

export function safeMerchantSourceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.port
      || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(url.hostname)
      || /\.(local|internal|localhost)$/i.test(url.hostname)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

// Correlation only; memory-only and never an authentication credential.
const session = `merchant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export function merchantEventId() {
  return globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
export type MerchantSource = { merchant_name: string; original_url: string };
export async function loadMerchantSource(client: SupabaseClient, postId: string): Promise<MerchantSource | null> {
  try {
    const { data, error } = await client.rpc('get_merchant_post_source', { p_post_id: postId });
    if (error || !data || !safeMerchantSourceUrl(data.original_url)) return null;
    return data as MerchantSource;
  } catch { return null; }
}

// A separate anonymous telemetry endpoint keeps the public content client read-only.
export async function trackPublicMerchantSourceClick(postId: string, transport: typeof fetch = fetch) {
  try {
    const response = await transport(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/rpc/record_merchant_source_click`, {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      body: JSON.stringify({ p_post_id: postId, p_platform: 'web', p_session: session, p_event_id: merchantEventId() }),
    });
    return response.ok;
  } catch { return false; }
}
export async function trackMerchantSourceClick(client: SupabaseClient, postId: string, platform: string) {
  try {
    const { error } = await client.rpc('record_merchant_source_click', {
      p_post_id: postId, p_platform: platform, p_session: session, p_event_id: merchantEventId(),
    });
    return !error;
  } catch { return false; } // A telemetry outage must never stop the original from opening.
}
