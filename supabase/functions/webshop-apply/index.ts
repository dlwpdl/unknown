// @ts-nocheck -- Supabase Deno runtime; request logic is in handler.ts with portable Node checks.
// eslint-disable-next-line import/no-unresolved -- Deno resolves npm specifiers.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendAdminEmail } from '../_shared/admin-email.ts';
import { handleWebshopApply, PUBLIC_ORIGIN } from './handler.ts';

const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
});
// Extra origins (a local web build) are explicit configuration, never taken from the request; the same list as event-link.
const origins = [PUBLIC_ORIGIN, ...(Deno.env.get('EVENT_LINK_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean)];

Deno.serve((request) => handleWebshopApply(request, {
  origins,
  // The existing event-link salt; the hash input starts with 'webshop-apply:' so the two caps never share a key.
  ipSalt: Deno.env.get('EVENT_LINK_IP_SALT') ?? '',
  sendMail: sendAdminEmail,
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error('WEBSHOP_APPLY_UNAVAILABLE');
    return data;
  },
}));
