/// <reference types="node" />
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import sharePreview from './vercel-share-preview.ts';

export default async function nodeSharePreview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = request.url?.startsWith('/') ? request.url : '/invalid';
  const method = request.method === 'GET' || request.method === 'HEAD' ? request.method : 'POST';
  const result = await sharePreview(new Request(`https://gling-share-preview.vercel.app${path}`, { method }));
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await result.arrayBuffer()));
}
