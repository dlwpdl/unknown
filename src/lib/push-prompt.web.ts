import type { PushPromptReason } from '@/lib/notification-preferences';

/** Web has no push sheet (PushInvite is native-only), so web bundles skip the notification module and its admin RPC name. */
export function requestPushPrompt(_reason: PushPromptReason) {}
