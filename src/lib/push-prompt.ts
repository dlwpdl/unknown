import { DeviceEventEmitter } from 'react-native';
import { PUSH_PROMPT_EVENT, type PushPromptReason } from '@/lib/notification-preferences';

/** Ask the root PushInvite to offer push right after this action; it decides whether the sheet may open. */
export function requestPushPrompt(reason: PushPromptReason) {
  DeviceEventEmitter.emit(PUSH_PROMPT_EVENT, { reason });
}
