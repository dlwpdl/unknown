type PushJob = {
  id: string; lease_id: string; token: string; user_id: string; notification_id: string;
  category: string; body: string; route: string | null; ticket_id: string | null;
};
type WorkerOptions = {
  secret?: string; expoAccessToken?: string; fetcher?: typeof fetch;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
type Result = 'ticket' | 'provider_accepted' | 'retry' | 'failed' | 'device_not_registered' | 'receipt_pending';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuid = new RegExp(`^${UUID}$`, 'i');
const routePattern = new RegExp(`^(?:/post/${UUID}(?:\\?commentId=${UUID})?|/chat\\?(?:conversationId=${UUID}(?:&view=requests)?|requestId=${UUID}|view=requests)|/profile/(?:guidelines|settings)|/notifications)$`, 'i');
const json = (value: unknown, status = 200) => Response.json(value, { status });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function resultFor(value: unknown, receipt: boolean): { result: Result; ticketId?: string; error?: string } {
  if (!object(value)) return { result: receipt ? 'receipt_pending' : 'retry', error: 'INVALID_EXPO_RESPONSE' };
  if (value.status === 'ok') {
    if (receipt) return { result: 'provider_accepted' };
    if (typeof value.id === 'string' && uuid.test(value.id)) return { result: 'ticket', ticketId: value.id };
  }
  if (value.status === 'error' && object(value.details) && typeof value.details.error === 'string') {
    const code = value.details.error;
    if (code === 'DeviceNotRegistered') return { result: 'device_not_registered', error: code };
    if (code === 'MessageRateExceeded' || code === 'UnknownError') return { result: 'retry', error: code };
    // Persist only allowlisted codes. Provider messages can contain push tokens.
    return { result: 'failed', error: ['MessageTooBig', 'MismatchSenderId', 'InvalidCredentials'].includes(code) ? code : 'EXPO_REJECTED' };
  }
  return { result: receipt ? 'receipt_pending' : 'retry', error: 'INVALID_EXPO_RESPONSE' };
}

export async function handlePushNotifications(request: Request, options: WorkerOptions): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!options.secret) return json({ error: 'PUSH_NOTIFICATIONS_NOT_CONFIGURED' }, 503);
  if (request.headers.get('x-push-secret') !== options.secret) return json({ error: 'UNAUTHORIZED' }, 401);
  const fetcher = options.fetcher ?? fetch;
  const counts = { tickets: 0, providerAccepted: 0, retrying: 0, failed: 0 };
  // No request body is consumed: callers cannot choose recipients, tokens, text, or routes.
  for (const phase of ['receipt', 'send'] as const) {
    const claimed = await options.rpc('claim_push_notifications', { p_phase: phase, p_limit: 100 });
    if (claimed.error) return json({ error: 'CLAIM_FAILED' }, 500);
    const jobs = (claimed.data ?? []) as PushJob[];
    if (!jobs.length) continue;
    let results: ReturnType<typeof resultFor>[];
    try {
      const response = await fetcher(`https://exp.host/--/api/v2/push/${phase === 'send' ? 'send' : 'getReceipts'}`, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', ...(options.expoAccessToken ? { Authorization: `Bearer ${options.expoAccessToken}` } : {}) },
        body: JSON.stringify(phase === 'receipt' ? { ids: jobs.map((job) => job.ticket_id) } : jobs.map((job) => ({
          to: job.token, title: '글링', body: job.body, sound: 'default', channelId: 'gling-activity', ttl: 300,
          // Expo has no send idempotency key. Stable IDs collapse ambiguous retry copies on devices.
          collapseId: job.notification_id, tag: job.notification_id,
          data: { notificationId: job.notification_id, userId: job.user_id, category: job.category,
            route: job.route && routePattern.test(job.route) ? job.route : '/notifications' },
        }))),
      });
      if (!response.ok) {
        const transient = response.status === 408 || response.status === 429 || response.status >= 500;
        results = jobs.map(() => ({ result: phase === 'receipt' && transient ? 'receipt_pending' : transient ? 'retry' : 'failed', error: `EXPO_HTTP_${response.status}` }));
      } else {
        const payload: unknown = await response.json();
        if (!object(payload) || payload.errors || (phase === 'send' ? !Array.isArray(payload.data) || payload.data.length !== jobs.length : !object(payload.data))) {
          throw new Error('INVALID_EXPO_RESPONSE');
        }
        const data = payload.data as Record<string, unknown> & unknown[];
        results = jobs.map((job, index) => resultFor(phase === 'send' ? data[index] : data[job.ticket_id!], phase === 'receipt'));
      }
    } catch {
      results = jobs.map(() => ({ result: phase === 'receipt' ? 'receipt_pending' : 'retry', error: 'EXPO_UNAVAILABLE' }));
    }
    const completed = await Promise.all(jobs.map(async (job, index) => {
      const outcome = results[index];
      const saved = await options.rpc('complete_push_notification', {
        p_id: job.id, p_lease_id: job.lease_id, p_result: outcome.result,
        p_ticket_id: outcome.ticketId ?? null, p_error: outcome.error ?? null,
      });
      if (saved.error) return false;
      if (outcome.result === 'ticket') counts.tickets += 1;
      else if (outcome.result === 'provider_accepted') counts.providerAccepted += 1;
      else if (outcome.result === 'retry' || outcome.result === 'receipt_pending') counts.retrying += 1;
      else counts.failed += 1;
      return true;
    }));
    if (completed.includes(false)) return json({ error: 'RESULT_SAVE_FAILED' }, 500);
  }
  return json(counts);
}
