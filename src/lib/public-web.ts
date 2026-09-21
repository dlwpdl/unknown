const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function publicWebTarget(path: string, postId?: string) {
  const id = postId ?? path.match(/^\/post\/([^/]+)\/?$/)?.[1];
  if (id && UUID.test(id)) return `gling://post/${id}`;
  if (['/chat', '/compose', '/meetup-create', '/meetups'].includes(path)) return `gling:/${path}`;
  return 'gling://';
}

// Defense in depth for this read-only client, not a replacement for server RLS.
export function publicWebFetch(baseUrl: string, key: string, transport: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const allowed = url.origin === new URL(baseUrl).origin && request.method === 'POST' && (
      /^\/rest\/v1\/rpc\/(get_public_feed_page_v2|get_public_post|get_public_comments_page)$/.test(url.pathname)
      || url.pathname === '/storage/v1/object/sign/post-images'
    );
    if (!allowed) throw new Error('PUBLIC_WEB_READ_ONLY');
    const headers = new Headers(request.headers);
    headers.set('apikey', key);
    headers.set('Authorization', `Bearer ${key}`);
    return transport(request.url, { method: request.method, headers, body: await request.text(), signal: request.signal, credentials: 'omit' });
  };
}
