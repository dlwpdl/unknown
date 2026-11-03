import { publicWebClient } from '@/lib/public-web-client';

/** POST to the event-link function: 200 with its data, or the status the page turns into a message (404, 400, 429; 0 = offline). */
export async function callEventLink<T>(body: Record<string, unknown>): Promise<{ status: number; data: T | null }> {
  try {
    const { data, error } = await publicWebClient.functions.invoke('event-link', { body });
    if (!error) return { status: 200, data: data as T };
    const response = (error as { context?: unknown }).context;
    return { status: response instanceof Response ? response.status : 0, data: null };
  } catch { return { status: 0, data: null }; }
}
