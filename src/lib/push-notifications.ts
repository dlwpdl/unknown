import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AndroidImportance, IosAuthorizationStatus, dismissAllNotificationsAsync, getExpoPushTokenAsync, getPermissionsAsync, requestPermissionsAsync, setNotificationChannelAsync, type NotificationPermissionsStatus } from 'expo-notifications';
import { Platform } from 'react-native';

const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
export const pushSupported = Platform.OS === 'ios' || Platform.OS === 'android';
export const pushConfigured = pushSupported && typeof projectId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);

export async function pushPermissionGranted() {
  const status = await getPermissionsAsync();
  return status.granted || status.ios?.status === IosAuthorizationStatus.PROVISIONAL;
}
// iOS 는 시스템 권한 창을 한 번만 띄운다. '아직 안 물어봄'과 '거절됨'을 구분해야
// 나중에 다시 물어봐도 되는지 판단할 수 있다.
export async function pushPermissionUndetermined() {
  const status = await getPermissionsAsync();
  return !pushStatusAnswered(status);
}
function pushStatusAnswered(status: NotificationPermissionsStatus) {
  if (status.granted) return true;
  if (status.ios?.status === IosAuthorizationStatus.DENIED) return true;
  const ios = status.ios?.status;
  return ios === IosAuthorizationStatus.AUTHORIZED
    || ios === IosAuthorizationStatus.PROVISIONAL
    || ios === IosAuthorizationStatus.EPHEMERAL;
}

export async function registerPushDevice(client: SupabaseClient, userId: string, requestPermission = false) {
  if (!pushConfigured) throw new Error('PUSH_NOT_CONFIGURED');
  if (Platform.OS === 'android') await setNotificationChannelAsync('gling-activity', {
    name: '글링 소식', importance: AndroidImportance.DEFAULT,
  });
  if (!await pushPermissionGranted()) {
    if (!requestPermission) return false;
    const permission = await requestPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== IosAuthorizationStatus.PROVISIONAL) return false;
  }
  const token = (await getExpoPushTokenAsync({ projectId })).data;
  let timezone: string | null = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; }
  catch { /* Messages still work when the device cannot report its timezone. */ }
  const { error } = await client.rpc('register_push_device', {
    p_token: token, p_user_id: userId, p_timezone: timezone,
  });
  if (error) throw error;
  return true;
}

export async function unregisterPushDevice(client: SupabaseClient, userId: string) {
  const { error } = await client.rpc('unregister_push_device', { p_token: null, p_user_id: userId });
  if (error) throw error;
  await dismissAllNotificationsAsync().catch(() => {});
}
