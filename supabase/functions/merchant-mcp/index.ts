// @ts-nocheck
// eslint-disable-next-line import/no-unresolved -- Deno resolves the native npm: specifier.
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { handleMerchantMcpRequest } from '../_shared/merchant-mcp-http.ts';

const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const auth = url && key ? createClient(url, key, options).auth : null;
const service = url && serviceKey ? createClient(url, serviceKey, options) : null;
const allowedOrigins = ['https://gling.ej-entertainment.com', 'https://dlwpdl.github.io', 'https://chatgpt.com', 'https://claude.ai',
  ...(Deno.env.get('GLING_MCP_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean)];

Deno.serve(async request => {
  if (!url || !auth || !service) return Response.json({ error: 'MCP_NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return handleMerchantMcpRequest(request, { resource: `${url}/functions/v1/merchant-mcp`, allowedOrigins }, async token => {
    const { data, error } = await auth.getClaims(token);
    if (error || !data) throw new Error('AUTH_REQUIRED');
    return data.claims;
  }, async (actor, name, args) => {
    const { data, error } = await service.rpc('dispatch_merchant_mcp', { p_actor_id: actor.actorId, p_client_id: actor.clientId,
      p_connection_id: actor.connectionId, p_session_id: actor.sessionId, p_tool: name, p_arguments: args });
    if (error) throw new Error(error.message);
    return data;
  });
});
