type RecordValue = Record<string, unknown>;
export type VerifiedEntitlement = {
  tier: 'plus' | 'premium';
  expires_at: string;
  product_id: string;
  store: string;
  will_renew: boolean;
};

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('INVALID_REVENUECAT_RESPONSE');
  return Date.parse(value);
}

export function parseRevenueCatMembership(input: unknown, { now = Date.now(), allowSandbox = false } = {}) {
  if (!record(input) || typeof input.request_date_ms !== 'number'
    || !Number.isFinite(input.request_date_ms) || input.request_date_ms > now + 60_000
    || !record(input.subscriber) || !record(input.subscriber.entitlements) || !record(input.subscriber.subscriptions)) {
    throw new Error('INVALID_REVENUECAT_RESPONSE');
  }
  const entitlements: VerifiedEntitlement[] = [];
  for (const tier of ['plus', 'premium'] as const) {
    const entitlement = input.subscriber.entitlements[`gling_${tier}`];
    if (entitlement === undefined) continue;
    if (!record(entitlement) || typeof entitlement.product_identifier !== 'string') throw new Error('INVALID_REVENUECAT_RESPONSE');
    // Only time-limited subscriptions are sold; lifetime/promotional grants are not membership.
    if (entitlement.expires_date === null) continue;
    let expiresAt = timestamp(entitlement.expires_date);
    const purchase = input.subscriber.subscriptions[entitlement.product_identifier];
    if (!record(purchase) || purchase.refunded_at != null) continue;
    if (purchase.is_sandbox !== false && !(allowSandbox && purchase.is_sandbox === true)) continue;
    if (purchase.store !== 'app_store' && purchase.store !== 'play_store' && !(allowSandbox && purchase.store === 'test_store')) continue;
    if (purchase.grace_period_expires_date != null) expiresAt = Math.max(expiresAt, timestamp(purchase.grace_period_expires_date));
    if (expiresAt <= now) continue;
    entitlements.push({
      tier,
      expires_at: new Date(expiresAt).toISOString().replace('.000Z', 'Z'),
      product_id: entitlement.product_identifier,
      store: purchase.store,
      will_renew: purchase.unsubscribe_detected_at == null,
    });
  }
  return { entitlements, observedAt: new Date(input.request_date_ms).toISOString() };
}

export function webhookUserIds(input: unknown): string[] {
  if (!record(input) || !record(input.event) || typeof input.event.id !== 'string'
    || input.event.id.length < 1 || input.event.id.length > 256 || typeof input.event.type !== 'string') throw new Error('INVALID_WEBHOOK');
  const event = input.event;
  const values = [event.app_user_id, event.original_app_user_id];
  for (const field of ['aliases', 'transferred_from', 'transferred_to']) {
    if (event[field] !== undefined && !Array.isArray(event[field])) throw new Error('INVALID_WEBHOOK');
    values.push(...(event[field] as unknown[] | undefined ?? []));
  }
  if (values.length > 100) throw new Error('INVALID_WEBHOOK');
  return [...new Set(values.filter((value): value is string => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)).map((value) => value.toLowerCase()))];
}

export async function deleteRevenueCatCustomer(userId: string, apiKey: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok && response.status !== 404) throw new Error('BILLING_DELETE_FAILED');
}
