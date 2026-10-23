// @ts-nocheck -- Supabase Deno runtime; request logic has portable Node checks.
// eslint-disable-next-line import/no-unresolved -- Deno resolves npm specifiers.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleWebshopRedirect } from './handler.ts';

Deno.serve((request) => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  return handleWebshopRedirect(request, {
    descriptor: async (merchantId) => {
      const { data, error } = await client.rpc('get_public_webshop', { p_merchant_id: merchantId });
      if (error) throw new Error('WEBSHOP_UNAVAILABLE');
      return data;
    },
    resolve: async ({ merchantId, eventId, session, platform, source }) => {
      const { data, error } = await client.rpc('resolve_webshop_redirect', {
        p_merchant_id: merchantId, p_event_id: eventId, p_session: session, p_platform: platform, p_source: source,
      });
      if (error) {
        if (error.message === 'WEBSHOP_UNAVAILABLE') return null;
        throw new Error('WEBSHOP_UNAVAILABLE');
      }
      return data;
    },
  });
});
