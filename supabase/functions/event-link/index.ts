// @ts-nocheck -- Supabase Deno runtime; request logic is in handler.ts with portable Node checks.
// eslint-disable-next-line import/no-unresolved -- Deno resolves npm specifiers.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleEventLink, PUBLIC_ORIGIN } from './handler.ts';

const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
});
// Extra origins (a local web build) are explicit configuration, never taken from the request.
const origins = [PUBLIC_ORIGIN, ...(Deno.env.get('EVENT_LINK_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean)];

Deno.serve((request) => handleEventLink(request, {
  origins,
  ipSalt: Deno.env.get('EVENT_LINK_IP_SALT') ?? '',
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error('EVENT_LINK_UNAVAILABLE');
    return data;
  },
}));
