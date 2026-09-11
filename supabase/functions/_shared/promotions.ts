const products: Record<string, { credits: number; app: string; store: string }> = {
  'com.dlwpdl.gling.credits.900': { credits: 900, app: 'appfaedf65971', store: 'APP_STORE' },
  'com.dlwpdl.gling.credits.1700': { credits: 1700, app: 'appfaedf65971', store: 'APP_STORE' },
  gling_credits_900: { credits: 900, app: 'app6090b6749b', store: 'PLAY_STORE' },
  gling_credits_1700: { credits: 1700, app: 'app6090b6749b', store: 'PLAY_STORE' },
};

// Call only after authenticating the RevenueCat webhook, never with an app-supplied receipt.
export function parsePromotionPurchase(event: Record<string, unknown>, { now = Date.now(), allowSandbox = false } = {}) {
  const product = typeof event.product_id === 'string' ? products[event.product_id] : undefined;
  if (!product || !['NON_RENEWING_PURCHASE', 'CANCELLATION', 'REFUND_REVERSED'].includes(String(event.type))) return null;
  if (event.app_id !== product.app || event.store !== product.store
    || !['PRODUCTION', 'SANDBOX'].includes(String(event.environment))
    || typeof event.app_user_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.app_user_id)
    || typeof event.id !== 'string' || event.id.length < 1 || event.id.length > 256
    || typeof event.transaction_id !== 'string' || event.transaction_id.length < 1 || event.transaction_id.length > 256
    || typeof event.event_timestamp_ms !== 'number' || !Number.isFinite(event.event_timestamp_ms)
    || event.event_timestamp_ms < Date.UTC(2020, 0, 1) || event.event_timestamp_ms > now + 60_000) {
    throw new Error('INVALID_PROMOTION_PURCHASE');
  }
  if (event.environment === 'SANDBOX' && !allowSandbox) return null;
  return {
    event_id: event.id, event_type: event.type as string, user_id: event.app_user_id.toLowerCase(),
    product_id: event.product_id as string, transaction_id: event.transaction_id, store: event.store as string,
    environment: event.environment as string, credits: product.credits,
    occurred_at: new Date(event.event_timestamp_ms).toISOString(),
  };
}
