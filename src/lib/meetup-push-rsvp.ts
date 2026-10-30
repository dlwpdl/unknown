import type { SupabaseClient } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';

import { tr } from '@/i18n';
import { markNotificationsRead } from '@/lib/community-data';
import { setMeetupRsvp } from '@/lib/meetup-convenience';

// The push worker (supabase/functions/_shared/push-notifications.ts) attaches this category to member reminders only.
export const MEETUP_RSVP_CATEGORY = 'meetup_rsvp';
const GOING = 'meetup_rsvp_going', NOT_GOING = 'meetup_rsvp_not_going';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One save per press even when it arrives twice (listener + last response, or a re-run effect). A failure frees it for a retry.
const handled = new Set<string>();

/** '갈게요 / 못 가요' on meetup reminder pushes. Answering stays in the background; tapping the body still opens the meetup. */
export function registerMeetupRsvpCategory() {
  // No isAuthenticationRequired: the session sits in AsyncStorage (readable on a locked phone once unlocked after boot)
  // and an answer can be changed on the meetup post at any time.
  const options = { opensAppToForeground: false };
  return Notifications.setNotificationCategoryAsync(MEETUP_RSVP_CATEGORY, [
    { identifier: GOING, buttonTitle: tr('갈게요'), options },
    { identifier: NOT_GOING, buttonTitle: tr('못 가요'), options },
  ]);
}

/** Saves a reminder button press with the meetup card's own RSVP call. False means "not a button": the caller handles it. */
export function answerMeetupRsvpFromPush(client: SupabaseClient, userId: string, response: Notifications.NotificationResponse): boolean {
  const going = response.actionIdentifier === GOING ? true : response.actionIdentifier === NOT_GOING ? false : null;
  if (going === null) return false;
  const { identifier, content } = response.notification.request;
  const key = `${identifier}:${response.actionIdentifier}`;
  if (handled.has(key)) return true;
  handled.add(key);
  Notifications.clearLastNotificationResponse();
  const data = content.data ?? {};
  const postId = typeof data.postId === 'string' && uuid.test(data.postId) ? data.postId : null;
  const notificationId = typeof data.notificationId === 'string' && uuid.test(data.notificationId) ? data.notificationId : null;
  void (async () => {
    try {
      if (!postId || !notificationId || data.userId !== userId) throw new Error('RSVP_PUSH_INVALID');
      // A reminder whose meetup moved, closed or already started leaves the inbox; don't record it against another time.
      const reminder = await client.from('user_notifications').select('id').eq('id', notificationId).maybeSingle();
      if (reminder.error || !reminder.data) throw new Error('RSVP_REMINDER_STALE');
      await setMeetupRsvp(client, postId, going);
      // Android keeps a notification after a button press; iOS has already removed it.
      await Notifications.dismissNotificationAsync(identifier).catch(() => {});
      await markNotificationsRead(client, [notificationId]).catch(() => {});
    } catch {
      handled.delete(key);
      // The press happened outside the app, so the failure has to come back as a notification that opens the meetup.
      await Notifications.scheduleNotificationAsync({
        content: { title: tr('글링'), body: tr('알림에서 누른 답을 저장하지 못했어요. 모임 글에서 다시 골라 주세요.'),
          data: { userId, category: 'meetups', route: postId ? `/post/${postId}` : '/notifications' } },
        trigger: { channelId: 'gling-activity' },
      }).catch(() => {});
    }
  })();
  return true;
}
