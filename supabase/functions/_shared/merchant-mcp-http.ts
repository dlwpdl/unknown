import { merchantMcpError, merchantMcpResponse, validateMerchantMcpClaims } from './merchant-mcp.ts';

type Config = { resource: string; allowedOrigins: string[] };
type Actor = ReturnType<typeof validateMerchantMcpClaims>;

export async function handleMerchantMcpRequest(request: Request, config: Config,
  verifySignedClaims: (token: string) => Promise<unknown>, dispatch: (actor: Actor, name: string, args: Record<string, unknown>) => Promise<unknown>) {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, accept, mcp-protocol-version, mcp-session-id',
    'Access-Control-Expose-Headers': 'WWW-Authenticate' };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (origin && !config.allowedOrigins.includes(origin)) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const metadata = `${config.resource}/.well-known/oauth-protected-resource`;
  const path = new URL(request.url).pathname, publicPath = new URL(config.resource).pathname;
  // The gateway may strip /functions/v1 before forwarding to the function worker.
  const workerPath = publicPath.replace(/^\/functions\/v1/, '');
  if ([publicPath, workerPath].some(base => path === `${base}/.well-known/oauth-protected-resource`) && request.method === 'GET') return json({
    resource: config.resource, resource_name: '글링 비즈니스', authorization_servers: [`${new URL(config.resource).origin}/auth/v1`],
    scopes_supported: ['offline_access'], bearer_methods_supported: ['header'], resource_documentation: 'https://gling.ej-entertainment.com/merchant/ai',
  });
  if (path !== publicPath && path !== workerPath) return json({ error: 'NOT_FOUND' }, 404);
  if (request.method !== 'POST') { headers.Allow = 'POST, OPTIONS'; return json({ error: 'METHOD_NOT_ALLOWED' }, 405); }
  const unauthorized = () => {
    headers['WWW-Authenticate'] = `Bearer resource_metadata="${metadata}", scope="offline_access"`;
    return json({ error: 'AUTH_REQUIRED' }, 401);
  };
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{1,16000})$/i)?.[1];
  if (!bearer) return unauthorized();
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'JSON_REQUIRED' }, 415);
  const accept = request.headers.get('accept');
  if (accept && !accept.includes('application/json') && !accept.includes('*/*')) return json({ error: 'JSON_RESPONSE_REQUIRED' }, 406);
  const version = request.headers.get('mcp-protocol-version');
  if (version && !['2025-03-26', '2025-06-18', '2025-11-25'].includes(version)) return json({ error: 'MCP_PROTOCOL_VERSION_UNSUPPORTED' }, 400);
  if (Number(request.headers.get('content-length')) > 40000) return json({ error: 'REQUEST_TOO_LARGE' }, 413);
  let packet: unknown;
  try {
    const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    if (!reader) return json({ error: 'JSON_REQUIRED' }, 400);
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 40000) { await reader.cancel(); return json({ error: 'REQUEST_TOO_LARGE' }, 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch { return json({ error: 'INVALID_JSON' }, 400); }
  let actor: Actor;
  try { actor = validateMerchantMcpClaims(await verifySignedClaims(bearer), config.resource); } catch { return unauthorized(); }
  try {
    // Even discovery and notifications use live grants, never just a valid signature.
    const context = await dispatch(actor, '_context', {}) as { allow_drafts?: unknown; allow_publish?: unknown };
    if (!context || typeof context.allow_drafts !== 'boolean' || typeof context.allow_publish !== 'boolean') throw new Error('MCP_REQUEST_FAILED');
    const response = await merchantMcpResponse(packet, { allow_drafts: context.allow_drafts, allow_publish: context.allow_publish }, (name, args) => dispatch(actor, name, args));
    return response === null ? new Response(null, { status: 202, headers }) : json(response);
  } catch (error) {
    const code = merchantMcpError(error);
    if (code === 'MCP_CONNECTION_REQUIRED') return unauthorized();
    return json({ error: code }, code === 'RATE_LIMITED' ? 429 : code === 'MCP_REQUEST_FAILED' ? 503 : 403);
  }
}
