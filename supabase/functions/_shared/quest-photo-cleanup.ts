// 모임장 퀘스트 인증샷 정리: 지울 때가 된 사진을 Storage API로 지운다(SQL로는 파일 바이트를 못 지운다).
type CleanupOptions = {
  secret?: string;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
};
type Due = { id: string | null; path: string };
const PATH = /^[0-9a-f-]{36}\/[^/]+(\/[^/]+)?\.webp$/;
const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function handleQuestPhotoCleanup(request: Request, options: CleanupOptions): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!options.secret) return json({ error: 'CLEANUP_NOT_CONFIGURED' }, 503);
  // Same scheduled caller and secret as push delivery; the body is ignored so callers cannot choose files.
  if (request.headers.get('x-push-secret') !== options.secret) return json({ error: 'UNAUTHORIZED' }, 401);
  const claimed = await options.rpc('claim_host_quest_photo_cleanup', { p_limit: 100 });
  if (claimed.error) return json({ error: 'CLAIM_FAILED' }, 500);
  const due = ((claimed.data ?? []) as Due[]).filter((row) => typeof row?.path === 'string' && PATH.test(row.path));
  if (!due.length) return json({ deleted: 0 });
  const removed = await options.remove(due.map((row) => row.path));
  if (removed.error) return json({ error: 'REMOVE_FAILED' }, 500);
  const ids = due.flatMap((row) => (row.id ? [row.id] : []));
  const finished = ids.length ? await options.rpc('finish_host_quest_photo_cleanup', { p_ids: ids }) : { error: null };
  if (finished.error) return json({ error: 'FINISH_FAILED' }, 500);
  return json({ deleted: due.length });
}
