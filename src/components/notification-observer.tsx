import { useRootNavigationState, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Alert, AppState, DeviceEventEmitter, Linking } from 'react-native';

import { useAuth } from '@/lib/auth';
import { markNotificationsRead } from '@/lib/community-data';
import { adminDashboardUrl, loadNotificationPreferences, NOTIFICATION_PREFERENCES_CHANGED, notificationRoute, type NotificationCategory, type NotificationPreferences } from '@/lib/notification-preferences';
import { pushConfigured, pushSupported, registerPushDevice } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

export function NotificationObserver() {
  const { isAuthed, isAdmin, me } = useAuth();
  const userId = isAuthed ? me.id : null;
  const navigation = useRootNavigationState();
  const router = useRouter();

  useEffect(() => {
    if (!pushSupported || !userId || !navigation?.key) return;
    let active = true;
    let preferences: NotificationPreferences | null = null;
    let registering = false;
    let revision = 0;
    let opened: string | null = null;
    const refresh = async () => {
      if (registering) return;
      registering = true;
      const version = revision;
      try {
        const next = await loadNotificationPreferences(supabase);
        if (!active || version !== revision) return;
        preferences = next;
        if (next.push_enabled && pushConfigured) await registerPushDevice(supabase, userId);
      } catch { /* In-app notifications remain available when device registration is offline. */ }
      finally { registering = false; }
    };
    Notifications.setNotificationHandler({ handleNotification: async (notification) => {
      const data = notification.request.content.data ?? {};
      const enabled = active && data.userId === userId && !!preferences?.push_enabled
        && (data.category === 'system' || preferences?.[data.category as NotificationCategory] === true);
      return { shouldShowBanner: enabled, shouldShowList: enabled, shouldPlaySound: enabled, shouldSetBadge: false };
    } });
    const open = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data ?? {};
      if (!active || data.userId !== userId || opened === response.notification.request.identifier) return;
      opened = response.notification.request.identifier;
      const dashboard = adminDashboardUrl(data.route, isAdmin);
      if (dashboard) void Linking.openURL(dashboard).catch(() => Alert.alert('관리자 대시보드를 열지 못했어요', 'Tailscale 연결과 Mac의 관리자 서버를 확인해 주세요.'));
      else {
        const route = notificationRoute(data.route);
        router.navigate((route?.startsWith('/admin') ? '/notifications' : route ?? '/notifications') as never);
      }
      if (typeof data.notificationId === 'string' && /^[0-9a-f-]{36}$/i.test(data.notificationId)) {
        void markNotificationsRead(supabase, [data.notificationId]).catch(() => {});
      }
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const initial = Notifications.getLastNotificationResponse();
    if (initial) open(initial);
    const responses = Notifications.addNotificationResponseReceivedListener(open);
    const tokens = Notifications.addPushTokenListener(() => void refresh());
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const settings = DeviceEventEmitter.addListener(NOTIFICATION_PREFERENCES_CHANGED,
      (event: { userId: string; preferences: NotificationPreferences }) => {
        if (event.userId === userId) { revision += 1; preferences = event.preferences; }
      });
    void refresh();
    return () => { active = false; responses.remove(); tokens.remove(); foreground.remove(); settings.remove(); Notifications.setNotificationHandler(null); };
  }, [isAdmin, navigation?.key, router, userId]);
  return null;
}
